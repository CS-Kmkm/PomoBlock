use crate::infrastructure::error::InfraError;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GitHistoryEntry {
    pub message: String,
    pub files: Vec<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct GitBackedConfigRepository {
    repo_path: PathBuf,
    meta_dir: PathBuf,
    remote_dir: PathBuf,
    history_path: PathBuf,
}

impl GitBackedConfigRepository {
    pub fn new(repo_path: impl AsRef<Path>) -> Result<Self, InfraError> {
        let repo_path = repo_path.as_ref().to_path_buf();
        let meta_dir = repo_path.join(".pomblock");
        let remote_dir = meta_dir.join("_remote");
        let history_path = meta_dir.join("git-history.json");

        fs::create_dir_all(&repo_path)?;
        fs::create_dir_all(&meta_dir)?;
        fs::create_dir_all(&remote_dir)?;
        if !history_path.exists() {
            fs::write(&history_path, "[]\n")?;
        }

        Ok(Self {
            repo_path,
            meta_dir,
            remote_dir,
            history_path,
        })
    }

    pub fn pull(&self) -> Result<(), InfraError> {
        for relative_path in walk_files(&self.remote_dir, Path::new(""))? {
            let source = self.remote_dir.join(&relative_path);
            let destination = self.repo_path.join(&relative_path);
            ensure_parent_dir(&destination)?;
            fs::copy(source, destination)?;
        }
        Ok(())
    }

    pub fn commit_and_push(&self, message: &str, files: &[String]) -> Result<(), InfraError> {
        if message.trim().is_empty() {
            return Err(InfraError::InvalidConfig("message is required".to_string()));
        }
        if files.is_empty() {
            return Err(InfraError::InvalidConfig("files are required".to_string()));
        }

        let normalized_files = files
            .iter()
            .map(|file| normalize_relative_path(file))
            .collect::<Result<Vec<_>, _>>()?;

        for relative_path in &normalized_files {
            if is_sensitive_path(relative_path) {
                return Err(InfraError::InvalidConfig(format!(
                    "sensitive path cannot be committed: {relative_path}"
                )));
            }
        }

        for relative_path in &normalized_files {
            let source = self.repo_path.join(relative_path);
            if !source.exists() {
                continue;
            }
            let destination = self.remote_dir.join(relative_path);
            ensure_parent_dir(&destination)?;
            fs::copy(source, destination)?;
        }

        let mut history = self.read_history()?;
        history.push(GitHistoryEntry {
            message: message.trim().to_string(),
            files: normalized_files,
            created_at: chrono::Utc::now().to_rfc3339(),
        });
        fs::write(&self.history_path, format!("{}\n", serde_json::to_string_pretty(&history)?))?;
        Ok(())
    }

    pub fn read_file(&self, relative_path: &str) -> Result<String, InfraError> {
        let normalized = normalize_relative_path(relative_path)?;
        Ok(fs::read_to_string(self.repo_path.join(normalized))?)
    }

    pub fn write_file(&self, relative_path: &str, content: &str) -> Result<(), InfraError> {
        let normalized = normalize_relative_path(relative_path)?;
        let destination = self.repo_path.join(normalized);
        ensure_parent_dir(&destination)?;
        fs::write(destination, content)?;
        Ok(())
    }

    #[cfg(test)]
    pub fn write_remote_file(&self, relative_path: &str, content: &str) -> Result<(), InfraError> {
        let normalized = normalize_relative_path(relative_path)?;
        let destination = self.remote_dir.join(normalized);
        ensure_parent_dir(&destination)?;
        fs::write(destination, content)?;
        Ok(())
    }

    pub fn list_files(&self, relative_dir: &str) -> Result<Vec<String>, InfraError> {
        let normalized = normalize_relative_path(relative_dir)?;
        let dir = self.repo_path.join(&normalized);
        if !dir.exists() {
            return Ok(Vec::new());
        }
        walk_files(&dir, Path::new(""))
    }

    pub fn read_history(&self) -> Result<Vec<GitHistoryEntry>, InfraError> {
        let raw = fs::read_to_string(&self.history_path)?;
        Ok(serde_json::from_str(&raw)?)
    }

    pub fn repo_path(&self) -> &Path {
        &self.repo_path
    }

    pub fn meta_dir(&self) -> &Path {
        &self.meta_dir
    }
}

fn normalize_relative_path(relative_path: &str) -> Result<String, InfraError> {
    let normalized = relative_path.trim().replace('\\', "/");
    let normalized = normalized.trim_start_matches("./").to_string();
    if normalized.is_empty() {
        return Err(InfraError::InvalidConfig("path is required".to_string()));
    }
    if normalized.starts_with('/') {
        return Err(InfraError::InvalidConfig(format!(
            "absolute path is not allowed: {relative_path}"
        )));
    }
    if normalized.split('/').any(|segment| segment == "..") {
        return Err(InfraError::InvalidConfig(format!(
            "path traversal is not allowed: {relative_path}"
        )));
    }
    Ok(normalized)
}

fn is_sensitive_path(relative_path: &str) -> bool {
    let normalized = relative_path.to_ascii_lowercase();
    normalized.contains("oauth")
        || normalized.contains("token")
        || normalized.starts_with("state/")
        || normalized.starts_with("logs/")
        || normalized.contains("pomodoro_log")
}

fn ensure_parent_dir(path: &Path) -> Result<(), InfraError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    Ok(())
}

fn walk_files(base_dir: &Path, current_dir: &Path) -> Result<Vec<String>, InfraError> {
    let root = if current_dir.as_os_str().is_empty() {
        base_dir.to_path_buf()
    } else {
        base_dir.join(current_dir)
    };
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        let relative = if current_dir.as_os_str().is_empty() {
            PathBuf::from(entry.file_name())
        } else {
            current_dir.join(entry.file_name())
        };
        if path.is_dir() {
            files.extend(walk_files(base_dir, &relative)?);
        } else {
            files.push(relative.to_string_lossy().replace('\\', "/"));
        }
    }
    files.sort();
    Ok(files)
}
