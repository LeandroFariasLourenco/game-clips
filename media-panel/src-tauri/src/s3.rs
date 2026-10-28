use std::path::{Path, PathBuf};

use aws_sdk_s3::config::{BehaviorVersion, Credentials, Region};
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::Client;
use serde::{Deserialize, Serialize};

use crate::cache;

const COVER_FILE: &str = "cover.jpg";
const BANNER_FILE: &str = "banner.jpg";
const ICON_FILE: &str = "icon.png";

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

fn file_name(path: &Path) -> Result<String, Error> {
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

async fn list_keys(settings: &Settings, prefix: &str) -> Result<Vec<(String, i64)>, Error> {
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
            objects.push((key.to_string(), object.size().unwrap_or(0)));
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

fn group_videos(settings: &Settings, game: &str, objects: &[(String, i64)]) -> Vec<MediaFile> {
    let prefix = format!("{game}/videos/");
    let mut folder_videos = Vec::new();
    let mut loose = Vec::new();

    for (key, size) in objects {
        let Some(relative) = key.strip_prefix(&prefix) else {
            continue;
        };
        if relative.is_empty() {
            continue;
        }
        match relative.split_once('/') {
            None => {
                if is_video_file(relative) {
                    loose.push((relative.to_string(), key.clone(), *size));
                }
            }
            Some((folder, file_name)) => {
                if folder.is_empty() || file_name.is_empty() || file_name.contains('/') {
                    continue;
                }
                if is_video_file(file_name) {
                    folder_videos.push((folder.to_string(), key.clone(), *size));
                }
            }
        }
    }

    let mut videos = Vec::new();
    let mut used_folders = Vec::new();

    for (folder, key, size) in folder_videos {
        used_folders.push(folder.clone());
        videos.push(MediaFile {
            name: folder,
            url: media_url(settings, &key),
            key,
            size,
        });
    }

    for (name, key, size) in loose {
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
            details.from_cache = true;
            return Ok(details);
        }
    }

    let settings = build_client()?;
    let cover_key = format!("{game}/{COVER_FILE}");
    let banner_key = format!("{game}/{BANNER_FILE}");
    let icon_key = format!("{game}/{ICON_FILE}");

    let (has_cover, has_banner, has_icon, image_objects, video_objects) = tokio::try_join!(
        object_exists(&settings, &cover_key),
        object_exists(&settings, &banner_key),
        object_exists(&settings, &icon_key),
        list_keys(&settings, &format!("{game}/images/")),
        list_keys(&settings, &format!("{game}/videos/")),
    )?;

    let mut images: Vec<MediaFile> = image_objects
        .into_iter()
        .filter_map(|(key, size)| {
            let name = key.rsplit('/').next()?.to_string();
            if name.is_empty() || name.contains('/') {
                return None;
            }
            Some(MediaFile {
                url: media_url(&settings, &key),
                name,
                key,
                size,
            })
        })
        .collect();
    images.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    let details = GameDetails {
        name: game.clone(),
        cover_url: public_url(&settings.public_base_url, &[&game, COVER_FILE]),
        banner_url: public_url(&settings.public_base_url, &[&game, BANNER_FILE]),
        icon_url: public_url(&settings.public_base_url, &[&game, ICON_FILE]),
        has_cover,
        has_banner,
        has_icon,
        images,
        videos: group_videos(&settings, &game, &video_objects),
        from_cache: false,
        cached_at: None,
    };
    let _ = cache::write_game(&details);
    Ok(details)
}

pub async fn upload_media(game: String, kind: String, path: String) -> Result<UploadResult, Error> {
    let settings = build_client()?;
    let game = sanitize_game_name(&game)?;
    let source = PathBuf::from(&path);
    if !source.is_file() {
        return Err(Error::Message("Arquivo não encontrado.".into()));
    }

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
            let name = image_object_name(&source)?;
            format!("{game}/images/{name}")
        }
        "video" => {
            if ext != "mp4" {
                return Err(Error::Message("Os clips devem ser arquivos .mp4.".into()));
            }
            let stem = file_stem(&source)?;
            format!("{game}/videos/{stem}/{stem}.mp4")
        }
        other => {
            return Err(Error::Message(format!("Tipo de upload desconhecido: {other}")));
        }
    };

    let file_name = file_name(&source)?;
    let body = ByteStream::from_path(&source)
        .await
        .map_err(|error| Error::Message(format!("Não foi possível ler o arquivo: {error}")))?;

    settings
        .client
        .put_object()
        .bucket(&settings.bucket)
        .key(&key)
        .body(body)
        .content_type(mime_of(&file_name))
        .send()
        .await
        .map_err(|error| Error::S3(error.to_string()))?;

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
        images: Vec::new(),
        videos: Vec::new(),
        from_cache: false,
        cached_at: None,
    };
    let _ = cache::write_game(&details);
    Ok(details)
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
