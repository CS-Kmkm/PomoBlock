mod application;
mod domain;
mod infrastructure;

use application::bootstrap::bootstrap_workspace;
use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Serialize)]
struct BootstrapResponse {
    workspace_root: String,
    database_path: String,
}

#[tauri::command]
fn bootstrap(root: Option<String>) -> Result<BootstrapResponse, String> {
    let workspace_root = match root {
        Some(path) => PathBuf::from(path),
        None => std::env::current_dir().map_err(|error| error.to_string())?,
    };

    let result = bootstrap_workspace(&workspace_root).map_err(|error| error.to_string())?;
    Ok(BootstrapResponse {
        workspace_root: result.workspace_root.display().to_string(),
        database_path: result.database_path.display().to_string(),
    })
}

#[tauri::command]
fn ping() -> &'static str {
    "pong"
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ping, bootstrap])
        .run(tauri::generate_context!())
        .expect("failed to run tauri app");
}
