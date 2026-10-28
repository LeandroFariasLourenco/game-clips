use std::path::PathBuf;

fn load_dotenv() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for path in [
        manifest_dir.join("../.env"),
        manifest_dir.join(".env"),
        PathBuf::from(".env"),
    ] {
        if path.is_file() {
            let _ = dotenvy::from_path(&path);
            return;
        }
    }
}

#[tokio::main]
async fn main() {
    load_dotenv();
    match media_panel_lib::s3::list_games(false).await {
        Ok(catalog) => {
            println!("{} pasta(s) na raiz do bucket:", catalog.games.len());
            for game in catalog.games {
                println!("- {}", game.name);
            }
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
