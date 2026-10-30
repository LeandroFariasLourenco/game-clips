pub mod cache;
pub mod s3;

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::UNIX_EPOCH;
use tauri::{LogicalSize, Manager};

const WINDOW_WIDTH: f64 = 1024.0;
const WINDOW_HEIGHT: f64 = 768.0;

fn load_dotenv() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidates = [
        manifest_dir.join("../.env"),
        manifest_dir.join(".env"),
        PathBuf::from(".env"),
        PathBuf::from("../.env"),
    ];

    for path in candidates {
        if path.is_file() {
            let _ = dotenvy::from_path(&path);
            return;
        }
    }
}

#[tauri::command]
async fn list_games(refresh: Option<bool>) -> Result<s3::GamesCatalog, String> {
    s3::list_games(refresh.unwrap_or(false))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_game(name: String, refresh: Option<bool>) -> Result<s3::GameDetails, String> {
    s3::get_game(name, refresh.unwrap_or(false))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn upload_media(
    game: String,
    kind: String,
    path: String,
    file_name: Option<String>,
) -> Result<s3::UploadResult, String> {
    s3::upload_media(game, kind, path, file_name)
        .await
        .map_err(|error| error.to_string())
}

fn file_mtime_fallback(path: &str) -> Result<i64, String> {
    let modified = std::fs::metadata(path)
        .and_then(|meta| meta.modified())
        .map_err(|error| format!("Não foi possível ler a data de {path}: {error}"))?;
    Ok(modified
        .duration_since(UNIX_EPOCH)
        .or_else(|_| UNIX_EPOCH.duration_since(modified))
        .unwrap_or_default()
        .as_millis() as i64)
}

fn explorer_item_date_ms(paths: &[String]) -> HashMap<String, i64> {
    let mut dates = HashMap::new();
    if paths.is_empty() {
        return dates;
    }

    let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../scripts/lib/read-item-dates.ps1");
    if !script.is_file() {
        return dates;
    }
    let script_path = script.to_string_lossy().into_owned();
    let list_path = std::env::temp_dir().join(format!(
        "game-clips-item-dates-{}-{}.txt",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ));
    let mut list_body = String::from('\u{feff}');
    list_body.push_str(&paths.join("\n"));
    list_body.push('\n');
    if std::fs::write(&list_path, list_body).is_err() {
        return dates;
    }
    let list_path_str = list_path.to_string_lossy().into_owned();

    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            &script_path,
            "-PathList",
            &list_path_str,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();
    let _ = std::fs::remove_file(&list_path);
    let output = match output {
        Ok(output) if output.status.success() => output,
        _ => return dates,
    };

    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let mut parts = line.split('\t');
        let Some(path) = parts.next() else { continue };
        let _iso = parts.next();
        let Some(ms) = parts.next().and_then(|value| value.parse::<i64>().ok()) else {
            continue;
        };
        dates.insert(path.to_string(), ms);
    }

    dates
}

#[tauri::command]
fn file_mtimes(paths: Vec<String>) -> Result<Vec<i64>, String> {
    let explorer = explorer_item_date_ms(&paths);
    paths
        .into_iter()
        .map(|path| {
            if let Some(ms) = explorer.get(&path) {
                return Ok(*ms);
            }
            file_mtime_fallback(&path)
        })
        .collect()
}

#[tauri::command]
async fn create_game(name: String) -> Result<s3::GameDetails, String> {
    s3::create_game(name).await.map_err(|error| error.to_string())
}

#[tauri::command]
async fn delete_game(name: String) -> Result<(), String> {
    s3::delete_game(name).await.map_err(|error| error.to_string())
}

#[tauri::command]
async fn rename_game(name: String, next_name: String) -> Result<s3::GameDetails, String> {
    s3::rename_game(name, next_name)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn delete_media(name: String, key: String) -> Result<(), String> {
    s3::delete_media(name, key)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn update_media_date(
    name: String,
    key: String,
    date: String,
) -> Result<s3::UploadResult, String> {
    s3::update_media_date(name, key, date)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_game_metadata(name: String) -> Result<Option<s3::GameMetadata>, String> {
    s3::get_game_metadata(name)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn refresh_game_metadata(name: String) -> Result<s3::MetadataResult, String> {
    s3::refresh_game_metadata(name)
        .await
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    load_dotenv();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            lock_main_window(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_games,
            get_game,
            upload_media,
            file_mtimes,
            create_game,
            delete_game,
            rename_game,
            delete_media,
            update_media_date,
            get_game_metadata,
            refresh_game_metadata
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn lock_main_window(app: &mut tauri::App) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let size = LogicalSize::new(WINDOW_WIDTH, WINDOW_HEIGHT);
    let _ = window.set_decorations(false);
    let _ = window.set_shadow(true);
    let _ = window.set_resizable(false);
    let _ = window.set_maximizable(false);
    let _ = window.set_min_size(Some(size));
    let _ = window.set_max_size(Some(size));
    let _ = window.set_size(size);
}
