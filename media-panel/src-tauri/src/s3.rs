use std::collections::HashSet;
use std::path::{Path, PathBuf};

use aws_sdk_s3::config::{BehaviorVersion, Credentials, Region};
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::Client;
use serde::{Deserialize, Serialize};

use crate::cache;

const COVER_FILE: &str = "cover.jpg";
const BANNER_FILE: &str = "banner.jpg";
const ICON_FILE: &str = "icon.png";
const METADATA_FILE: &str = "metadata.json";
const VIDEO_THUMB_FILE: &str = "thumb.jpg";

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
    std::env::var(name)
        .map(|value| value.trim().to_string())
        .ok()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| Error::Message(format!("Defina {name} no arquivo .env do painel.")))
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
    let public_base_url = std::env::var("AWS_S3_PUBLIC_BASE_URL")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("https://{bucket}.s3.{region}.amazonaws.com"));

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
            let text = String::from_utf8_lossy(&collected.into_bytes());
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
    let (image_objects, video_objects) = tokio::try_join!(
        list_keys(&settings, &format!("{game}/images/")),
        list_keys(&settings, &format!("{game}/videos/")),
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

    let (has_cover, has_banner, has_icon, image_objects, video_objects, metadata) = tokio::try_join!(
        object_exists(&settings, &cover_key),
        object_exists(&settings, &banner_key),
        object_exists(&settings, &icon_key),
        list_keys(&settings, &format!("{game}/images/")),
        list_keys(&settings, &format!("{game}/videos/")),
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
    let body = ByteStream::from_path(&source)
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
