use crate::infrastructure::config::{ensure_default_configs, load_configs};
use crate::infrastructure::error::InfraError;
use crate::infrastructure::storage::initialize_database;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub struct BootstrapResult {
    pub workspace_root: PathBuf,
    pub config_dir: PathBuf,
    pub state_dir: PathBuf,
    pub logs_dir: PathBuf,
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
        config_dir,
        state_dir,
        logs_dir,
        database_path,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::test_support::workspace::TempWorkspace;

    #[test]
    fn bootstrap_workspace_initializes_config_state_logs_and_database() {
        let workspace = TempWorkspace::new();
        let result = bootstrap_workspace(workspace.path()).expect("bootstrap workspace");

        assert!(result.workspace_root.is_dir());
        assert!(result.config_dir.is_dir());
        assert!(result.state_dir.is_dir());
        assert!(result.logs_dir.is_dir());
        assert!(result.database_path.is_file());
    }
}
