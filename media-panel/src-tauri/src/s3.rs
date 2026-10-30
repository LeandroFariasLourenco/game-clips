use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use aws_sdk_s3::config::{BehaviorVersion, Credentials, Region};
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::types::MetadataDirective;
use aws_sdk_s3::Client;
use serde::{Deserialize, Serialize};

use crate::cache;

const COVER_FILE: &str = "cover.jpg";
const BANNER_FILE: &str = "banner.jpg";
const ICON_FILE: &str = "icon.png";
const METADATA_FILE: &str = "metadata.json";
const VIDEO_THUMB_FILE: &str = "thumb.jpg";
const DEFAULT_PUBLIC_ASSET_BASE_URL: &str = "https://d3nyc65v53ljin.cloudfront.net";

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Message(String),
    #[error("Falha na AWS S3: {0}")]
    S3(String),
}

impl From<String> for Error {
    fn from(value: String) -> Self {
        Self::Message(value)
    }
}

#[derive(Clone)]
struct Settings {
    bucket: String,
    public_base_url: String,
    client: Client,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSummary {
    pub name: String,
    pub cover_url: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFile {
    pub name: String,
    pub key: String,
    pub url: String,
    pub size: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inserted_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub in_metadata: Option<bool>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameDetails {
    pub name: String,
    pub cover_url: String,
    pub banner_url: String,
    pub icon_url: String,
    pub has_cover: bool,
    pub has_banner: bool,
    pub has_icon: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_metadata: Option<bool>,
    pub images: Vec<MediaFile>,
    pub videos: Vec<MediaFile>,
    #[serde(default)]
    pub from_cache: bool,
    #[serde(default)]
    pub cached_at: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GamesCatalog {
    pub games: Vec<GameSummary>,
    pub from_cache: bool,
    pub cached_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResult {
    pub key: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataResult {
    pub key: String,
    pub url: String,
    pub images: usize,
    pub videos: usize,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct GameMetadataVideo {
    pub url: String,
    #[serde(default)]
    pub thumb: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct GameMetadata {
    #[serde(default)]
    pub images: Vec<String>,
    #[serde(default)]
    pub videos: Vec<GameMetadataVideo>,
}

fn required_env(name: &str) -> Result<String, Error> {
    optional_env(name).ok_or_else(|| Error::Message(format!("Defina {name} no arquivo .env do painel.")))
}

fn optional_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().trim_matches('"').trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_bucket(raw: &str) -> String {
    raw.trim()
        .trim_start_matches("s3://")
        .trim_matches('/')
        .to_string()
}

fn encode_path(segments: &[&str]) -> String {
    segments
        .iter()
        .flat_map(|segment| segment.split('/'))
        .filter(|segment| !segment.is_empty())
        .map(|segment| urlencoding::encode(segment).into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

fn copy_source(bucket: &str, key: &str) -> String {
    format!("{bucket}/{}", encode_path(&[key]))
}

fn split_file_name(name: &str) -> (String, String) {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    match base.rfind('.') {
        Some(index) if index > 0 => (base[..index].to_string(), base[index + 1..].to_string()),
        _ => (base.to_string(), String::new()),
    }
}

fn media_file_label(game: &str) -> String {
    let label = game.replace('_', " ");
    let trimmed = label.trim();
    if trimmed.is_empty() {
        "game".into()
    } else {
        trimmed.to_string()
    }
}

fn is_utc_stamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 18
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[10] == b'T'
        && bytes[17] == b'Z'
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            4 | 7 | 10 | 17 => true,
            _ => byte.is_ascii_digit(),
        })
}

fn parse_standardized_stem(stem: &str) -> Option<(String, u32)> {
    let hash = stem.rfind('#')?;
    let sequence = stem[hash + 1..].parse().ok()?;
    let rest = &stem[..hash];
    let z = rest.find("Z_")?;
    let stamp = &rest[..=z];
    let game = rest.get(z + 2..)?.to_string();
    if !is_utc_stamp(stamp) || game.is_empty() {
        return None;
    }
    Some((game, sequence))
}

fn used_sequences(names: impl IntoIterator<Item = impl AsRef<str>>, game: &str) -> HashSet<u32> {
    let label = media_file_label(game);
    let mut used = HashSet::new();
    for name in names {
        let (stem, _) = split_file_name(name.as_ref());
        if let Some((parsed_game, sequence)) = parse_standardized_stem(&stem) {
            if parsed_game == label {
                used.insert(sequence);
            }
        }
    }
    used
}

fn next_sequence(used: &HashSet<u32>) -> u32 {
    let mut sequence = 1;
    while used.contains(&sequence) {
        sequence += 1;
    }
    sequence
}

fn format_utc_stamp(year: i32, month: u8, day: u8, hour: u8, minute: u8, second: u8) -> String {
    format!("{year:04}-{month:02}-{day:02}T{hour:02}{minute:02}{second:02}Z")
}

fn parse_iso_utc(value: &str) -> Result<(i32, u8, u8, u8, u8, u8), Error> {
    let raw = value.trim();
    if raw.is_empty() {
        return Err(Error::Message("Informe a nova data.".into()));
    }
    let without_z = raw.strip_suffix('Z').unwrap_or(raw);
    let without_offset = without_z
        .split_once('+')
        .map(|(left, _)| left)
        .unwrap_or(without_z);
    let core = without_offset.split('.').next().unwrap_or(without_offset);
    let (date, time) = core
        .split_once('T')
        .ok_or_else(|| Error::Message("Data inválida.".into()))?;
    let date_parts: Vec<_> = date.split('-').collect();
    let time_parts: Vec<_> = time.split(':').collect();
    if date_parts.len() != 3 || time_parts.len() < 2 {
        return Err(Error::Message("Data inválida.".into()));
    }
    let parse_part = |part: &str| {
        part.parse::<u32>()
            .map_err(|_| Error::Message("Data inválida.".into()))
    };
    let year = date_parts[0]
        .parse::<i32>()
        .map_err(|_| Error::Message("Data inválida.".into()))?;
    let month = parse_part(date_parts[1])? as u8;
    let day = parse_part(date_parts[2])? as u8;
    let hour = parse_part(time_parts[0])? as u8;
    let minute = parse_part(time_parts[1])? as u8;
    let second = if time_parts.len() > 2 {
        parse_part(time_parts[2])? as u8
    } else {
        0
    };
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return Err(Error::Message("Data inválida.".into()));
    }
    Ok((year, month, day, hour, minute, second))
}

fn dated_media_file_name(
    current_name: &str,
    stamp: &str,
    game: &str,
    reserved: &[String],
) -> String {
    let (stem, ext) = split_file_name(current_name);
    let (label, sequence) = match parse_standardized_stem(&stem) {
        Some((label, sequence)) => (label, sequence),
        None => (
            media_file_label(game),
            next_sequence(&used_sequences(reserved, game)),
        ),
    };
    let suffix = if ext.is_empty() {
        String::new()
    } else {
        format!(".{ext}")
    };
    format!("{stamp}_{label}#{sequence}{suffix}")
}

fn relabel_media_file_name(current: &str, from_game: &str, to_game: &str) -> String {
    let (stem, ext) = split_file_name(current);
    let Some((label, sequence)) = parse_standardized_stem(&stem) else {
        return current.to_string();
    };
    if label != media_file_label(from_game) {
        return current.to_string();
    }
    let Some(stamp) = stem.get(..18) else {
        return current.to_string();
    };
    if !is_utc_stamp(stamp) {
        return current.to_string();
    }
    let suffix = if ext.is_empty() {
        String::new()
    } else {
        format!(".{ext}")
    };
    format!(
        "{stamp}_{}#{sequence}{suffix}",
        media_file_label(to_game)
    )
}

fn remapped_game_key(key: &str, from_game: &str, to_game: &str) -> String {
    let prefix = format!("{from_game}/");
    if key == from_game || key == prefix {
        return format!("{to_game}/");
    }
    let Some(rest) = key.strip_prefix(&prefix) else {
        return key.to_string();
    };
    let next_rest = rest
        .split('/')
        .map(|segment| {
            if segment.is_empty() {
                segment.to_string()
            } else {
                relabel_media_file_name(segment, from_game, to_game)
            }
        })
        .collect::<Vec<_>>()
        .join("/");
    format!("{to_game}/{next_rest}")
}

fn map_video_destination(source_key: &str, game: &str, old_folder: &str, next_stem: &str) -> String {
    let prefix = format!("{game}/videos/{old_folder}");
    if source_key == prefix || source_key == format!("{prefix}/") {
        return format!("{game}/videos/{next_stem}/");
    }
    let rest = source_key
        .strip_prefix(&format!("{prefix}/"))
        .unwrap_or("");
    let (old_stem, _) = split_file_name(old_folder);
    let (rest_stem, rest_ext) = split_file_name(rest);
    if rest_stem == old_stem {
        let suffix = if rest_ext.is_empty() {
            String::new()
        } else {
            format!(".{rest_ext}")
        };
        return format!("{game}/videos/{next_stem}/{next_stem}{suffix}");
    }
    format!("{game}/videos/{next_stem}/{rest}")
}

fn public_url(base: &str, segments: &[&str]) -> String {
    format!("{}/{}", base.trim_end_matches('/'), encode_path(segments))
}

fn sanitize_game_name(name: &str) -> Result<String, Error> {
    let value = name.trim().split_whitespace().collect::<Vec<_>>().join(" ");
    if value.is_empty() || value == "." || value == ".." {
        return Err(Error::Message("Informe um nome de jogo válido.".into()));
    }
    if value
        .chars()
        .any(|ch| matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0'))
    {
        return Err(Error::Message(
            "O nome não pode conter \\ / : * ? \" < > |".into(),
        ));
    }
    Ok(value)
}

fn mime_of(file_name: &str) -> &'static str {
    let ext = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "json" => "application/json",
        _ => "application/octet-stream",
    }
}

fn file_stem(path: &Path) -> Result<String, Error> {
    path.file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| Error::Message("Não foi possível ler o nome do arquivo.".into()))
}

fn path_file_name(path: &Path) -> Result<String, Error> {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(ToOwned::to_owned)
        .ok_or_else(|| Error::Message("Não foi possível ler o nome do arquivo.".into()))
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

struct TempDir(PathBuf);

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn prepare_clip_script() -> Result<PathBuf, Error> {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf));
    let candidates = [
        manifest.join("../../scripts/prepare-clip-file.cjs"),
        cwd.join("scripts/prepare-clip-file.cjs"),
        cwd.join("../scripts/prepare-clip-file.cjs"),
        exe_dir
            .as_ref()
            .map(|dir| dir.join("../scripts/prepare-clip-file.cjs"))
            .unwrap_or_default(),
    ];
    for path in candidates {
        if path.is_file() {
            return path
                .canonicalize()
                .map_err(|error| Error::Message(format!("Não foi possível resolver {path:?}: {error}")));
        }
    }
    Err(Error::Message(
        "scripts/prepare-clip-file.cjs não encontrado. Rode o painel a partir do repositório, com Node e ffmpeg no PATH.".into(),
    ))
}

fn prepare_uploaded_clip(source: &Path, stem: &str) -> Result<(PathBuf, PathBuf, TempDir), Error> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    let root = std::env::temp_dir().join(format!("game-clips-upload-{stamp}"));
    let folder = root.join(stem);
    std::fs::create_dir_all(&folder)
        .map_err(|error| Error::Message(format!("Não foi possível criar pasta temporária: {error}")))?;
    let dest = folder.join(format!("{stem}.mp4"));
    std::fs::copy(source, &dest)
        .map_err(|error| Error::Message(format!("Não foi possível copiar o clip para preparar: {error}")))?;

    let output = Command::new("node")
        .arg(prepare_clip_script()?)
        .arg("--file")
        .arg(&dest)
        .output()
        .map_err(|error| {
            Error::Message(format!(
                "Não foi possível executar o prepare-clip ({error}). Node e ffmpeg precisam estar no PATH."
            ))
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let details = [stderr.trim(), stdout.trim()]
            .into_iter()
            .find(|line| !line.is_empty())
            .unwrap_or("prepare-clip falhou.");
        return Err(Error::Message(details.to_string()));
    }

    let thumb = folder.join(VIDEO_THUMB_FILE);
    if !thumb.is_file() {
        return Err(Error::Message("Não foi possível gerar thumb.jpg para o clip.".into()));
    }
    Ok((dest, thumb, TempDir(root)))
}

fn image_object_name(path: &Path) -> Result<String, Error> {
    let stem = file_stem(path)?;
    let ext = extension(path);
    let normalized = match ext.as_str() {
        "jpeg" | "jpg" => "jpg",
        "png" => "png",
        other => {
            return Err(Error::Message(format!(
                "Extensão .{other} não é permitida na galeria. Use .jpg ou .png."
            )));
        }
    };
    Ok(format!("{stem}.{normalized}"))
}

fn build_client() -> Result<Settings, Error> {
    let access_key = required_env("AWS_ACCESS_KEY_ID")?;
    let secret_key = required_env("AWS_SECRET_ACCESS_KEY")?;
    let region = std::env::var("AWS_REGION")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            std::env::var("AWS_DEFAULT_REGION")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
        .unwrap_or_else(|| "us-east-1".into());
    let bucket = normalize_bucket(&required_env("AWS_S3_BUCKET")?);
    let public_base_url = optional_env("AWS_S3_PUBLIC_BASE_URL")
        .or_else(|| optional_env("VITE_MEDIA_BUCKET_URL"))
        .unwrap_or_else(|| DEFAULT_PUBLIC_ASSET_BASE_URL.to_string());

    let credentials = Credentials::new(access_key, secret_key, None, None, "media-panel-env");
    let config = aws_sdk_s3::Config::builder()
        .behavior_version(BehaviorVersion::latest())
        .region(Region::new(region))
        .credentials_provider(credentials)
        .build();

    Ok(Settings {
        bucket,
        public_base_url,
        client: Client::from_conf(config),
    })
}

async fn object_exists(settings: &Settings, key: &str) -> Result<bool, Error> {
    match settings
        .client
        .head_object()
        .bucket(&settings.bucket)
        .key(key)
        .send()
        .await
    {
        Ok(_) => Ok(true),
        Err(error) => {
            let code = error.as_service_error().and_then(|err| err.meta().code());
            if code == Some("NotFound") || code == Some("NoSuchKey") {
                return Ok(false);
            }
            let status = error.raw_response().map(|response| response.status().as_u16());
            if status == Some(404) {
                return Ok(false);
            }
            Err(Error::S3(error.to_string()))
        }
    }
}

fn object_timestamp(time: Option<&aws_smithy_types::DateTime>) -> Option<String> {
    time.and_then(|value| value.fmt(aws_smithy_types::date_time::Format::DateTime).ok())
}

fn details_have_file_dates(details: &GameDetails) -> bool {
    details
        .images
        .iter()
        .chain(details.videos.iter())
        .all(|file| file.modified_at.is_some())
}

async fn list_keys(settings: &Settings, prefix: &str) -> Result<Vec<(String, i64, Option<String>)>, Error> {
    let mut objects = Vec::new();
    let mut token: Option<String> = None;

    loop {
        let mut request = settings
            .client
            .list_objects_v2()
            .bucket(&settings.bucket)
            .prefix(prefix);
        if let Some(value) = token.as_deref() {
            request = request.continuation_token(value);
        }

        let page = request
            .send()
            .await
            .map_err(|error| Error::S3(error.to_string()))?;

        for object in page.contents() {
            let Some(key) = object.key() else { continue };
            if key.ends_with('/') {
                continue;
            }
            objects.push((
                key.to_string(),
                object.size().unwrap_or(0),
                object_timestamp(object.last_modified()),
            ));
        }

        if page.is_truncated() == Some(true) {
            token = page.next_continuation_token().map(ToOwned::to_owned);
            if token.is_none() {
                break;
            }
        } else {
            break;
        }
    }

    Ok(objects)
}

fn media_url(settings: &Settings, key: &str) -> String {
    public_url(
        &settings.public_base_url,
        &key.split('/').collect::<Vec<_>>(),
    )
}

fn decode_percent(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(high), Some(low)) = (from_hex(bytes[i + 1]), from_hex(bytes[i + 2])) {
                out.push((high << 4) | low);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn from_hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn normalize_media_path(url_or_key: &str) -> String {
    let raw = url_or_key.trim();
    if raw.is_empty() {
        return String::new();
    }
    let path = if let Some(scheme) = raw.find("://") {
        let after_host = &raw[scheme + 3..];
        after_host
            .find('/')
            .map(|index| &after_host[index..])
            .unwrap_or("")
    } else {
        raw
    };
    decode_percent(path).trim_start_matches('/').to_string()
}

fn metadata_media_paths(metadata: Option<&GameMetadata>) -> (HashSet<String>, HashSet<String>) {
    let mut images = HashSet::new();
    let mut videos = HashSet::new();
    let Some(metadata) = metadata else {
        return (images, videos);
    };
    for url in &metadata.images {
        let path = normalize_media_path(url);
        if !path.is_empty() {
            images.insert(path);
        }
    }
    for clip in &metadata.videos {
        let path = normalize_media_path(&clip.url);
        if !path.is_empty() {
            videos.insert(path);
        }
    }
    (images, videos)
}

fn is_linked_in_metadata(key_or_url: &str, paths: &HashSet<String>) -> bool {
    let path = normalize_media_path(key_or_url);
    !path.is_empty() && paths.contains(&path)
}

fn mark_linked(files: &mut [MediaFile], paths: &HashSet<String>) {
    for file in files {
        file.in_metadata = Some(
            is_linked_in_metadata(&file.key, paths) || is_linked_in_metadata(&file.url, paths),
        );
    }
}

async fn read_stored_metadata(settings: &Settings, game: &str) -> Result<Option<GameMetadata>, Error> {
    match settings
        .client
        .get_object()
        .bucket(&settings.bucket)
        .key(format!("{game}/{METADATA_FILE}"))
        .send()
        .await
    {
        Ok(object) => {
            let collected = object
                .body
                .collect()
                .await
                .map_err(|error| Error::S3(error.to_string()))?;
            let bytes = collected.into_bytes();
            let text = String::from_utf8_lossy(&bytes);
            Ok(serde_json::from_str::<GameMetadata>(&text).ok())
        }
        Err(error) => {
            let code = error.as_service_error().and_then(|err| err.meta().code());
            if code == Some("NotFound") || code == Some("NoSuchKey") {
                return Ok(None);
            }
            let status = error.raw_response().map(|response| response.status().as_u16());
            if status == Some(404) {
                return Ok(None);
            }
            Err(Error::S3(error.to_string()))
        }
    }
}

fn is_gallery_image(file_name: &str) -> bool {
    matches!(
        Path::new(file_name)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "jpg" | "jpeg" | "png"
    )
}

fn is_canonical_video(file_name: &str) -> bool {
    Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .eq_ignore_ascii_case("mp4")
}

fn kind_updates_game_metadata(kind: &str) -> bool {
    kind == "image" || kind == "video"
}

fn listing_from_object_keys(game: &str, keys: &[String]) -> (Vec<String>, Vec<(String, String)>) {
    let prefix = format!("{game}/");
    let mut images = Vec::new();
    let mut videos = Vec::new();

    for key in keys {
        let relative = key.strip_prefix(&prefix).unwrap_or(key.as_str());
        let parts: Vec<&str> = relative.split('/').filter(|part| !part.is_empty()).collect();
        match parts.as_slice() {
            ["images", name] if is_gallery_image(name) => images.push((*name).to_string()),
            ["videos", folder, file_name] if is_canonical_video(file_name) => {
                videos.push(((*folder).to_string(), (*file_name).to_string()));
            }
            _ => {}
        }
    }

    images.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    videos.sort_by(|a, b| {
        a.0.to_lowercase()
            .cmp(&b.0.to_lowercase())
            .then(a.1.to_lowercase().cmp(&b.1.to_lowercase()))
    });
    (images, videos)
}

fn build_game_metadata(
    game: &str,
    public_base_url: &str,
    images: &[String],
    videos: &[(String, String)],
) -> GameMetadata {
    GameMetadata {
        images: images
            .iter()
            .map(|name| public_url(public_base_url, &[game, "images", name]))
            .collect(),
        videos: videos
            .iter()
            .map(|(folder, file_name)| GameMetadataVideo {
                url: public_url(public_base_url, &[game, "videos", folder, file_name]),
                thumb: public_url(public_base_url, &[game, "videos", folder, VIDEO_THUMB_FILE]),
            })
            .collect(),
    }
}

pub async fn get_game_metadata(name: String) -> Result<Option<GameMetadata>, Error> {
    let game = sanitize_game_name(&name)?;
    let settings = build_client()?;
    read_stored_metadata(&settings, &game).await
}

pub async fn refresh_game_metadata(name: String) -> Result<MetadataResult, Error> {
    let game = sanitize_game_name(&name)?;
    let settings = build_client()?;
    let image_prefix = format!("{game}/images/");
    let video_prefix = format!("{game}/videos/");
    let (image_objects, video_objects) = tokio::try_join!(
        list_keys(&settings, &image_prefix),
        list_keys(&settings, &video_prefix),
    )?;
    let keys: Vec<String> = image_objects
        .into_iter()
        .map(|(key, _, _)| key)
        .chain(video_objects.into_iter().map(|(key, _, _)| key))
        .collect();
    let (images, videos) = listing_from_object_keys(&game, &keys);
    let metadata = build_game_metadata(&game, &settings.public_base_url, &images, &videos);
    let body = format!(
        "{}\n",
        serde_json::to_string_pretty(&metadata)
            .map_err(|error| Error::Message(format!("Falha ao serializar metadata.json: {error}")))?
    );
    let key = format!("{game}/{METADATA_FILE}");

    settings
        .client
        .put_object()
        .bucket(&settings.bucket)
        .key(&key)
        .body(ByteStream::from(body.into_bytes()))
        .content_type("application/json; charset=utf-8")
        .cache_control("no-cache")
        .send()
        .await
        .map_err(|error| Error::S3(error.to_string()))?;
    cache::invalidate_game(&game);

    Ok(MetadataResult {
        url: media_url(&settings, &key),
        images: metadata.images.len(),
        videos: metadata.videos.len(),
        key,
    })
}

fn group_videos(settings: &Settings, game: &str, objects: &[(String, i64, Option<String>)]) -> Vec<MediaFile> {
    let prefix = format!("{game}/videos/");
    let mut folder_videos = Vec::new();
    let mut loose = Vec::new();

    for (key, size, modified_at) in objects {
        let Some(relative) = key.strip_prefix(&prefix) else {
            continue;
        };
        if relative.is_empty() {
            continue;
        }
        match relative.split_once('/') {
            None => {
                if is_video_file(relative) {
                    loose.push((relative.to_string(), key.clone(), *size, modified_at.clone()));
                }
            }
            Some((folder, file_name)) => {
                if folder.is_empty() || file_name.is_empty() || file_name.contains('/') {
                    continue;
                }
                if is_video_file(file_name) {
                    folder_videos.push((folder.to_string(), key.clone(), *size, modified_at.clone()));
                }
            }
        }
    }

    let mut videos = Vec::new();
    let mut used_folders = Vec::new();

    for (folder, key, size, modified_at) in folder_videos {
        used_folders.push(folder.clone());
        videos.push(MediaFile {
            name: folder,
            url: media_url(settings, &key),
            key,
            size,
            inserted_at: modified_at.clone(),
            modified_at,
            in_metadata: None,
        });
    }

    for (name, key, size, modified_at) in loose {
        let stem = Path::new(&name)
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or(&name);
        if used_folders.iter().any(|folder| folder == stem) {
            continue;
        }
        videos.push(MediaFile {
            name,
            url: media_url(settings, &key),
            key,
            size,
            inserted_at: modified_at.clone(),
            modified_at,
            in_metadata: None,
        });
    }

    videos.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    videos
}

fn is_video_file(file_name: &str) -> bool {
    matches!(
        Path::new(file_name)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "mp4" | "webm" | "mkv" | "mov" | "avi"
    )
}

pub async fn list_games(refresh: bool) -> Result<GamesCatalog, Error> {
    if !refresh {
        if let Some(catalog) = cache::read_catalog() {
            return Ok(GamesCatalog {
                games: catalog.games,
                from_cache: true,
                cached_at: Some(catalog.updated_at),
            });
        }
    }

    let settings = build_client()?;
    let mut names = Vec::new();
    let mut token: Option<String> = None;

    loop {
        let mut request = settings
            .client
            .list_objects_v2()
            .bucket(&settings.bucket)
            .delimiter("/");
        if let Some(value) = token.as_deref() {
            request = request.continuation_token(value);
        }

        let page = request
            .send()
            .await
            .map_err(|error| Error::S3(error.to_string()))?;

        for prefix in page.common_prefixes() {
            let Some(raw) = prefix.prefix() else { continue };
            let name = raw.trim_end_matches('/').trim();
            if name.is_empty() {
                continue;
            }
            names.push(name.to_string());
        }

        if page.is_truncated() == Some(true) {
            token = page.next_continuation_token().map(ToOwned::to_owned);
            if token.is_none() {
                break;
            }
        } else {
            break;
        }
    }

    names.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    names.dedup();

    let games = names
        .into_iter()
        .map(|name| {
            let cover_url = public_url(&settings.public_base_url, &[&name, COVER_FILE]);
            GameSummary { name, cover_url }
        })
        .collect::<Vec<_>>();
    let catalog = cache::write_catalog(&games).map_err(Error::Message)?;
    Ok(GamesCatalog {
        games,
        from_cache: false,
        cached_at: Some(catalog.updated_at),
    })
}

pub async fn get_game(name: String, refresh: bool) -> Result<GameDetails, Error> {
    let game = sanitize_game_name(&name)?;
    if !refresh {
        if let Some(mut details) = cache::read_game(&game) {
            if details.has_metadata.is_some() && details_have_file_dates(&details) {
                details.from_cache = true;
                return Ok(details);
            }
        }
    }

    let settings = build_client()?;
    let cover_key = format!("{game}/{COVER_FILE}");
    let banner_key = format!("{game}/{BANNER_FILE}");
    let icon_key = format!("{game}/{ICON_FILE}");

    let image_prefix = format!("{game}/images/");
    let video_prefix = format!("{game}/videos/");
    let (has_cover, has_banner, has_icon, image_objects, video_objects, metadata) = tokio::try_join!(
        object_exists(&settings, &cover_key),
        object_exists(&settings, &banner_key),
        object_exists(&settings, &icon_key),
        list_keys(&settings, &image_prefix),
        list_keys(&settings, &video_prefix),
        read_stored_metadata(&settings, &game),
    )?;
    let (image_paths, video_paths) = metadata_media_paths(metadata.as_ref());

    let mut images: Vec<MediaFile> = image_objects
        .into_iter()
        .filter_map(|(key, size, modified_at)| {
            let name = key.rsplit('/').next()?.to_string();
            if name.is_empty() || name.contains('/') {
                return None;
            }
            Some(MediaFile {
                url: media_url(&settings, &key),
                name,
                key,
                size,
                inserted_at: modified_at.clone(),
                modified_at,
                in_metadata: None,
            })
        })
        .collect();
    images.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    mark_linked(&mut images, &image_paths);

    let mut videos = group_videos(&settings, &game, &video_objects);
    mark_linked(&mut videos, &video_paths);

    let details = GameDetails {
        name: game.clone(),
        cover_url: public_url(&settings.public_base_url, &[&game, COVER_FILE]),
        banner_url: public_url(&settings.public_base_url, &[&game, BANNER_FILE]),
        icon_url: public_url(&settings.public_base_url, &[&game, ICON_FILE]),
        has_cover,
        has_banner,
        has_icon,
        has_metadata: Some(metadata.is_some()),
        images,
        videos,
        from_cache: false,
        cached_at: None,
    };
    let _ = cache::write_game(&details);
    Ok(details)
}

pub async fn upload_media(
    game: String,
    kind: String,
    path: String,
    file_name: Option<String>,
) -> Result<UploadResult, Error> {
    let settings = build_client()?;
    let game = sanitize_game_name(&game)?;
    let source = PathBuf::from(&path);
    if !source.is_file() {
        return Err(Error::Message("Arquivo não encontrado.".into()));
    }

    let object_path = file_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| source.clone());
    let ext = extension(&source);
    let key = match kind.as_str() {
        "cover" => {
            if ext != "jpg" && ext != "jpeg" {
                return Err(Error::Message("A capa deve ser um arquivo .jpg.".into()));
            }
            format!("{game}/{COVER_FILE}")
        }
        "banner" => {
            if ext != "jpg" && ext != "jpeg" {
                return Err(Error::Message("O banner deve ser um arquivo .jpg.".into()));
            }
            format!("{game}/{BANNER_FILE}")
        }
        "icon" => {
            if ext != "png" {
                return Err(Error::Message("O ícone deve ser um arquivo .png.".into()));
            }
            format!("{game}/{ICON_FILE}")
        }
        "image" => {
            let name = image_object_name(&object_path)?;
            format!("{game}/images/{name}")
        }
        "video" => {
            if ext != "mp4" {
                return Err(Error::Message("Os clips devem ser arquivos .mp4.".into()));
            }
            let stem = file_stem(&object_path)?;
            format!("{game}/videos/{stem}/{stem}.mp4")
        }
        other => {
            return Err(Error::Message(format!("Tipo de upload desconhecido: {other}")));
        }
    };

    let mime_name = path_file_name(&object_path).or_else(|_| path_file_name(&source))?;
    let stem = file_stem(&object_path).or_else(|_| file_stem(&source))?;
    let mut upload_source = source.clone();
    let mut prepared_thumb: Option<PathBuf> = None;
    let _prepared_dir;
    if kind == "video" {
        let (video, thumb, tmp) = prepare_uploaded_clip(&source, &stem)?;
        upload_source = video;
        prepared_thumb = Some(thumb);
        _prepared_dir = Some(tmp);
    } else {
        _prepared_dir = None;
    }

    let body = ByteStream::from_path(&upload_source)
        .await
        .map_err(|error| Error::Message(format!("Não foi possível ler o arquivo: {error}")))?;

    settings
        .client
        .put_object()
        .bucket(&settings.bucket)
        .key(&key)
        .body(body)
        .content_type(mime_of(&mime_name))
        .send()
        .await
        .map_err(|error| Error::S3(error.to_string()))?;

    if let Some(thumb) = prepared_thumb {
        let thumb_key = format!("{game}/videos/{stem}/{VIDEO_THUMB_FILE}");
        let thumb_body = ByteStream::from_path(&thumb)
            .await
            .map_err(|error| Error::Message(format!("Não foi possível ler thumb.jpg: {error}")))?;
        settings
            .client
            .put_object()
            .bucket(&settings.bucket)
            .key(&thumb_key)
            .body(thumb_body)
            .content_type("image/jpeg")
            .send()
            .await
            .map_err(|error| Error::S3(error.to_string()))?;
        if let (Ok(bytes), Some(path)) = (std::fs::read(&thumb), cache::asset_path(&thumb_key)) {
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::write(path, bytes);
        }
    }

    if kind_updates_game_metadata(&kind) {
        refresh_game_metadata(game.clone()).await?;
    }
    cache::invalidate_game(&game);
    if kind != "video" {
        if let (Ok(bytes), Some(path)) = (std::fs::read(&source), cache::asset_path(&key)) {
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::write(path, bytes);
        }
    }

    Ok(UploadResult {
        url: media_url(&settings, &key),
        key,
        name: None,
    })
}

async fn put_folder(settings: &Settings, key: &str) -> Result<(), Error> {
    let folder = if key.ends_with('/') {
        key.to_string()
    } else {
        format!("{key}/")
    };
    settings
        .client
        .put_object()
        .bucket(&settings.bucket)
        .key(folder)
        .body(ByteStream::from_static(b""))
        .content_type("application/x-directory")
        .send()
        .await
        .map_err(|error| Error::S3(error.to_string()))?;
    Ok(())
}

async fn prefix_exists(settings: &Settings, prefix: &str) -> Result<bool, Error> {
    let page = settings
        .client
        .list_objects_v2()
        .bucket(&settings.bucket)
        .prefix(prefix)
        .max_keys(1)
        .send()
        .await
        .map_err(|error| Error::S3(error.to_string()))?;
    Ok(page.key_count().unwrap_or(0) > 0 || !page.contents().is_empty())
}

async fn list_all_keys(settings: &Settings, prefix: &str) -> Result<Vec<String>, Error> {
    let mut keys = Vec::new();
    let mut token: Option<String> = None;
    loop {
        let mut request = settings
            .client
            .list_objects_v2()
            .bucket(&settings.bucket)
            .prefix(prefix);
        if let Some(value) = token.as_deref() {
            request = request.continuation_token(value);
        }
        let page = request
            .send()
            .await
            .map_err(|error| Error::S3(error.to_string()))?;
        for object in page.contents() {
            if let Some(key) = object.key() {
                keys.push(key.to_string());
            }
        }
        if page.is_truncated() == Some(true) {
            token = page.next_continuation_token().map(ToOwned::to_owned);
            if token.is_none() {
                break;
            }
        } else {
            break;
        }
    }
    Ok(keys)
}

pub async fn create_game(name: String) -> Result<GameDetails, Error> {
    let game = sanitize_game_name(&name)?;
    let catalog = list_games(true).await?;
    if let Some(clash) = catalog
        .games
        .iter()
        .find(|item| item.name.eq_ignore_ascii_case(&game))
    {
        return Err(Error::Message(if clash.name == game {
            format!("Já existe um jogo com a pasta \"{game}\".")
        } else {
            format!(
                "Já existe a pasta \"{}\" (o bucket diferencia maiúsculas/minúsculas).",
                clash.name
            )
        }));
    }

    let settings = build_client()?;
    if prefix_exists(&settings, &format!("{game}/")).await? {
        return Err(Error::Message(format!(
            "Já existe conteúdo na pasta \"{game}/\" do bucket."
        )));
    }

    put_folder(&settings, &format!("{game}/images/")).await?;
    put_folder(&settings, &format!("{game}/videos/")).await?;
    refresh_game_metadata(game.clone()).await?;

    let mut games = catalog.games;
    games.push(GameSummary {
        name: game.clone(),
        cover_url: public_url(&settings.public_base_url, &[&game, COVER_FILE]),
    });
    games.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    cache::write_catalog(&games).map_err(Error::Message)?;

    let details = GameDetails {
        name: game.clone(),
        cover_url: public_url(&settings.public_base_url, &[&game, COVER_FILE]),
        banner_url: public_url(&settings.public_base_url, &[&game, BANNER_FILE]),
        icon_url: public_url(&settings.public_base_url, &[&game, ICON_FILE]),
        has_cover: false,
        has_banner: false,
        has_icon: false,
        has_metadata: Some(true),
        images: Vec::new(),
        videos: Vec::new(),
        from_cache: false,
        cached_at: None,
    };
    let _ = cache::write_game(&details);
    Ok(details)
}

pub async fn rename_game(name: String, next_name: String) -> Result<GameDetails, Error> {
    let from_game = sanitize_game_name(&name)?;
    let to_game = sanitize_game_name(&next_name)?;
    if from_game == to_game {
        return get_game(from_game, true).await;
    }

    let catalog = list_games(true).await?;
    let exists = catalog.games.iter().any(|item| item.name == from_game);
    let settings = build_client()?;
    if !exists && !prefix_exists(&settings, &format!("{from_game}/")).await? {
        return Err(Error::Message(format!(
            "Não existe a pasta \"{from_game}\" no bucket."
        )));
    }
    if let Some(clash) = catalog.games.iter().find(|item| {
        item.name != from_game && item.name.eq_ignore_ascii_case(&to_game)
    }) {
        return Err(Error::Message(if clash.name == to_game {
            format!("Já existe um jogo com a pasta \"{to_game}\".")
        } else {
            format!(
                "Já existe a pasta \"{}\" (o bucket diferencia maiúsculas/minúsculas).",
                clash.name
            )
        }));
    }
    if prefix_exists(&settings, &format!("{to_game}/")).await? {
        return Err(Error::Message(format!(
            "Já existe conteúdo na pasta \"{to_game}/\" do bucket."
        )));
    }

    let keys = list_all_keys(&settings, &format!("{from_game}/")).await?;
    let metadata_key = format!("{from_game}/{METADATA_FILE}");
    let copies: Vec<(String, String)> = keys
        .iter()
        .filter(|key| *key != &metadata_key)
        .map(|from| (from.clone(), remapped_game_key(from, &from_game, &to_game)))
        .collect();

    let source_set: HashSet<String> = keys.iter().cloned().collect();
    for (_, to) in &copies {
        if source_set.contains(to) {
            continue;
        }
        if object_exists(&settings, to).await? {
            return Err(Error::Message(format!(
                "Já existe o arquivo \"{to}\" no bucket."
            )));
        }
    }

    for (from, to) in &copies {
        copy_object_keep_metadata(&settings, from, to).await?;
    }
    for key in &keys {
        settings
            .client
            .delete_object()
            .bucket(&settings.bucket)
            .key(key)
            .send()
            .await
            .map_err(|error| Error::S3(error.to_string()))?;
        cache::forget_asset(key);
    }

    refresh_game_metadata(to_game.clone()).await?;
    cache::remove_catalog_game(&from_game);
    cache::remove_game_assets(&from_game);
    let mut games = cache::read_catalog()
        .map(|catalog| catalog.games)
        .unwrap_or_else(|| catalog.games);
    games.retain(|item| item.name != from_game && item.name != to_game);
    games.push(GameSummary {
        name: to_game.clone(),
        cover_url: public_url(&settings.public_base_url, &[&to_game, COVER_FILE]),
    });
    games.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    cache::write_catalog(&games).map_err(Error::Message)?;

    get_game(to_game, true).await
}

async fn copy_object_keep_metadata(
    settings: &Settings,
    from_key: &str,
    to_key: &str,
) -> Result<(), Error> {
    if from_key == to_key {
        return Ok(());
    }
    settings
        .client
        .copy_object()
        .bucket(&settings.bucket)
        .copy_source(copy_source(&settings.bucket, from_key))
        .key(to_key)
        .metadata_directive(MetadataDirective::Copy)
        .send()
        .await
        .map_err(|error| Error::S3(error.to_string()))?;
    Ok(())
}

pub async fn update_media_date(
    name: String,
    key: String,
    date: String,
) -> Result<UploadResult, Error> {
    let game = sanitize_game_name(&name)?;
    let normalized = key.trim().trim_start_matches('/').to_string();
    if normalized.is_empty()
        || normalized.contains("..")
        || normalized.contains('\\')
        || normalized.contains('\0')
    {
        return Err(Error::Message("Chave de mídia inválida.".into()));
    }

    let (year, month, day, hour, minute, second) = parse_iso_utc(&date)?;
    let stamp = format_utc_stamp(year, month, day, hour, minute, second);
    let settings = build_client()?;
    let image_prefix = format!("{game}/images/");
    let video_prefix = format!("{game}/videos/");

    let mut copies: Vec<(String, String)> = Vec::new();
    let next_name: String;
    let next_key: String;

    if let Some(current_name) = normalized.strip_prefix(&image_prefix) {
        if current_name.is_empty() || current_name.contains('/') {
            return Err(Error::Message(
                "Só é possível alterar a data de screenshots em images/.".into(),
            ));
        }
        let objects = list_keys(&settings, &image_prefix).await?;
        let reserved: Vec<String> = objects
            .iter()
            .filter_map(|(object_key, _, _)| {
                let name = object_key.strip_prefix(&image_prefix)?;
                if name.is_empty() || name.contains('/') || name == current_name {
                    None
                } else {
                    Some(name.to_string())
                }
            })
            .collect();
        next_name = dated_media_file_name(current_name, &stamp, &game, &reserved);
        next_key = format!("{image_prefix}{next_name}");
        copies.push((normalized.clone(), next_key.clone()));
    } else if let Some(relative) = normalized.strip_prefix(&video_prefix) {
        if relative.is_empty() {
            return Err(Error::Message(
                "Só é possível alterar a data de clips em videos/.".into(),
            ));
        }
        let current_name = relative.split_once('/').map(|(folder, _)| folder).unwrap_or(relative);
        let objects = list_keys(&settings, &video_prefix).await?;
        let reserved: Vec<String> = group_videos(&settings, &game, &objects)
            .into_iter()
            .filter(|file| file.name != current_name)
            .map(|file| file.name)
            .collect();
        next_name = dated_media_file_name(current_name, &stamp, &game, &reserved);
        let (next_stem, _) = split_file_name(&next_name);

        match relative.split_once('/') {
            None => {
                next_key = format!("{video_prefix}{next_name}");
                copies.push((normalized.clone(), next_key.clone()));
            }
            Some((folder, rest)) => {
                if folder.is_empty() || rest.is_empty() || rest.contains('/') {
                    return Err(Error::Message(
                        "Só é possível alterar a data de clips em videos/.".into(),
                    ));
                }
                let folder_keys =
                    list_all_keys(&settings, &format!("{game}/videos/{folder}/")).await?;
                let sources = if folder_keys.is_empty() {
                    vec![normalized.clone()]
                } else {
                    folder_keys
                };
                copies = sources
                    .into_iter()
                    .map(|from| {
                        let to = map_video_destination(&from, &game, folder, &next_stem);
                        (from, to)
                    })
                    .collect();
                next_key = copies
                    .iter()
                    .find(|(_, to)| to.ends_with(".mp4"))
                    .map(|(_, to)| to.clone())
                    .unwrap_or_else(|| {
                        format!("{game}/videos/{next_stem}/{next_stem}.mp4")
                    });
            }
        }
    } else {
        return Err(Error::Message(
            "Só é possível alterar a data de screenshots em images/ ou clips em videos/.".into(),
        ));
    }

    let source_set: HashSet<String> = copies.iter().map(|(from, _)| from.clone()).collect();
    for (_, to) in &copies {
        if source_set.contains(to) {
            continue;
        }
        if object_exists(&settings, to).await? {
            return Err(Error::Message(format!(
                "Já existe um arquivo com o nome \"{next_name}\"."
            )));
        }
    }

    let changed: Vec<&(String, String)> = copies
        .iter()
        .filter(|(from, to)| from != to)
        .collect();
    if changed.is_empty() {
        let url = media_url(&settings, &next_key);
        return Ok(UploadResult {
            key: next_key,
            url,
            name: Some(next_name),
        });
    }

    for (from, to) in changed {
        copy_object_keep_metadata(&settings, from, to).await?;
    }
    let dest_set: HashSet<String> = copies.iter().map(|(_, to)| to.clone()).collect();
    for from in &source_set {
        if dest_set.contains(from) {
            continue;
        }
        settings
            .client
            .delete_object()
            .bucket(&settings.bucket)
            .key(from)
            .send()
            .await
            .map_err(|error| Error::S3(error.to_string()))?;
        cache::forget_asset(from);
    }

    refresh_game_metadata(game).await?;

    let url = media_url(&settings, &next_key);
    Ok(UploadResult {
        key: next_key,
        url,
        name: Some(next_name),
    })
}

pub async fn delete_media(name: String, key: String) -> Result<(), Error> {
    let game = sanitize_game_name(&name)?;
    let keys = keys_for_media_delete(&game, &key).await?;
    if keys.is_empty() {
        return Err(Error::Message("Arquivo não encontrado no bucket.".into()));
    }

    let settings = build_client()?;
    for object_key in &keys {
        settings
            .client
            .delete_object()
            .bucket(&settings.bucket)
            .key(object_key)
            .send()
            .await
            .map_err(|error| Error::S3(error.to_string()))?;
        cache::forget_asset(object_key);
    }

    refresh_game_metadata(game).await?;
    Ok(())
}

async fn keys_for_media_delete(game: &str, key: &str) -> Result<Vec<String>, Error> {
    let normalized = key.trim().trim_start_matches('/').to_string();
    if normalized.is_empty()
        || normalized.contains("..")
        || normalized.contains('\\')
        || normalized.contains('\0')
    {
        return Err(Error::Message("Chave de mídia inválida.".into()));
    }

    let image_prefix = format!("{game}/images/");
    let video_prefix = format!("{game}/videos/");

    if let Some(relative) = normalized.strip_prefix(&image_prefix) {
        if relative.is_empty() || relative.contains('/') {
            return Err(Error::Message(
                "Só é possível remover screenshots em images/.".into(),
            ));
        }
        return Ok(vec![normalized]);
    }

    if let Some(relative) = normalized.strip_prefix(&video_prefix) {
        if relative.is_empty() {
            return Err(Error::Message("Só é possível remover clips em videos/.".into()));
        }
        return Ok(match relative.split_once('/') {
            None => vec![normalized],
            Some((folder, rest)) => {
                if folder.is_empty() || rest.is_empty() || rest.contains('/') {
                    return Err(Error::Message(
                        "Só é possível remover clips em videos/.".into(),
                    ));
                }
                let settings = build_client()?;
                let folder_keys =
                    list_all_keys(&settings, &format!("{game}/videos/{folder}/")).await?;
                if folder_keys.is_empty() {
                    vec![normalized]
                } else {
                    folder_keys
                }
            }
        });
    }

    Err(Error::Message(
        "Só é possível remover screenshots em images/ ou clips em videos/.".into(),
    ))
}

pub async fn delete_game(name: String) -> Result<(), Error> {
    let game = sanitize_game_name(&name)?;
    let live = get_game(game.clone(), true).await?;
    if !live.images.is_empty() || !live.videos.is_empty() {
        return Err(Error::Message(format!(
            "Não é possível remover \"{game}\": ainda há {} screenshot(s) e {} clip(s).",
            live.images.len(),
            live.videos.len()
        )));
    }

    let settings = build_client()?;
    let allowed = [
        format!("{game}/"),
        format!("{game}/{COVER_FILE}"),
        format!("{game}/{BANNER_FILE}"),
        format!("{game}/{ICON_FILE}"),
        format!("{game}/{METADATA_FILE}"),
        format!("{game}/images/"),
        format!("{game}/videos/"),
    ];
    let keys = list_all_keys(&settings, &format!("{game}/")).await?;
    if keys.iter().any(|key| !allowed.iter().any(|item| item == key)) {
        return Err(Error::Message(format!(
            "Não é possível remover \"{game}\": a pasta ainda contém arquivos além do branding canônico."
        )));
    }

    for key in keys {
        settings
            .client
            .delete_object()
            .bucket(&settings.bucket)
            .key(key)
            .send()
            .await
            .map_err(|error| Error::S3(error.to_string()))?;
    }

    cache::remove_catalog_game(&game);
    cache::remove_game_assets(&game);
    Ok(())
}
