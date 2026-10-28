use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::s3::{GameDetails, GameSummary};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogCache {
    pub version: u32,
    pub updated_at: String,
    pub games: Vec<GameSummary>,
}

pub fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache")
}

fn catalog_path() -> PathBuf {
    root().join("catalog.json")
}

fn games_dir() -> PathBuf {
    root().join("games")
}

fn safe_name(name: &str) -> Option<String> {
    let value = name.trim();
    if value.is_empty() || value.contains("..") || value.contains('/') || value.contains('\\') {
        return None;
    }
    Some(value.to_string())
}

fn game_meta_path(name: &str) -> Option<PathBuf> {
    Some(games_dir().join(format!("{}.json", safe_name(name)?)))
}

pub fn read_catalog() -> Option<CatalogCache> {
    let raw = fs::read_to_string(catalog_path()).ok()?;
    let catalog: CatalogCache = serde_json::from_str(&raw).ok()?;
    if catalog.version != 1 {
        return None;
    }
    Some(catalog)
}

pub fn write_catalog(games: &[GameSummary]) -> Result<CatalogCache, String> {
    fs::create_dir_all(games_dir()).map_err(|error| error.to_string())?;
    let catalog = CatalogCache {
        version: 1,
        updated_at: chrono_like_now(),
        games: games.to_vec(),
    };
    fs::write(
        catalog_path(),
        serde_json::to_string_pretty(&catalog).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    Ok(catalog)
}

pub fn read_game(name: &str) -> Option<GameDetails> {
    let path = game_meta_path(name)?;
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn write_game(details: &GameDetails) -> Result<(), String> {
    fs::create_dir_all(games_dir()).map_err(|error| error.to_string())?;
    let path = game_meta_path(&details.name).ok_or_else(|| "Nome de jogo inválido.".to_string())?;
    let mut cached = details.clone();
    cached.cached_at = Some(chrono_like_now());
    fs::write(
        path,
        serde_json::to_string_pretty(&cached).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

pub fn invalidate_game(name: &str) {
    if let Some(path) = game_meta_path(name) {
        let _ = fs::remove_file(path);
    }
}

pub fn remove_catalog_game(name: &str) {
    let Some(catalog) = read_catalog() else { return };
    let games: Vec<_> = catalog
        .games
        .into_iter()
        .filter(|game| game.name != name)
        .collect();
    let _ = write_catalog(&games);
}

pub fn remove_game_assets(name: &str) {
    invalidate_game(name);
    if let Some(path) = asset_path(name) {
        let _ = fs::remove_dir_all(path);
    }
}

pub fn asset_path(key: &str) -> Option<PathBuf> {
    let value = key.trim().trim_start_matches('/');
    if value.is_empty() || value.contains("..") || value.contains('\\') {
        return None;
    }
    Some(root().join("images").join(Path::new(value)))
}

fn chrono_like_now() -> String {
    // RFC 3339 enough for cache labels; std clock without extra crate.
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{millis}")
}
