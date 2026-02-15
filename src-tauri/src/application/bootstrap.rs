use crate::infrastructure::config::{ensure_default_configs, load_configs};
use crate::infrastructure::error::InfraError;
use crate::infrastructure::storage::initialize_database;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub struct BootstrapResult {
    pub workspace_root: PathBuf,
    pub database_path: PathBuf,
}

pub fn bootstrap_workspace(workspace_root: &Path) -> Result<BootstrapResult, InfraError> {
    let config_dir = workspace_root.join("config");
    let state_dir = workspace_root.join("state");
    let logs_dir = workspace_root.join("logs");
    let database_path = state_dir.join("pomblock.sqlite");

    fs::create_dir_all(&config_dir)?;
    fs::create_dir_all(&state_dir)?;
    fs::create_dir_all(&logs_dir)?;

    ensure_default_configs(&config_dir)?;
    let _ = load_configs(&config_dir)?;
    initialize_database(&database_path)?;

    Ok(BootstrapResult {
        workspace_root: workspace_root.to_path_buf(),
        database_path,
    })
}
