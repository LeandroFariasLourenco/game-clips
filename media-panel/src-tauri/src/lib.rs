pub mod cache;
pub mod s3;

use std::path::PathBuf;
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
async fn upload_media(game: String, kind: String, path: String) -> Result<s3::UploadResult, String> {
    s3::upload_media(game, kind, path)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn create_game(name: String) -> Result<s3::GameDetails, String> {
    s3::create_game(name).await.map_err(|error| error.to_string())
}

#[tauri::command]
async fn delete_game(name: String) -> Result<(), String> {
    s3::delete_game(name).await.map_err(|error| error.to_string())
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
            create_game,
            delete_game
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn lock_main_window(app: &mut tauri::App) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let size = LogicalSize::new(WINDOW_WIDTH, WINDOW_HEIGHT);
    let _ = window.set_resizable(false);
    let _ = window.set_maximizable(false);
    let _ = window.set_min_size(Some(size));
    let _ = window.set_max_size(Some(size));
    let _ = window.set_size(size);
}
