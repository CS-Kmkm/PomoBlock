use thiserror::Error;

#[derive(Debug, Error)]
pub enum InfraError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Invalid config: {0}")]
    InvalidConfig(String),
    #[error("Credential error: {0}")]
    Credential(String),
    #[error("OAuth error: {0}")]
    OAuth(String),
    #[error("Sync token expired")]
    SyncTokenExpired,
}
