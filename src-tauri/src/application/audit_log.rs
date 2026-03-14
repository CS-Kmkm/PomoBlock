use crate::infrastructure::error::InfraError;
use chrono::Utc;
use rusqlite::{params, Connection};
use std::path::Path;

pub(crate) fn append_audit_log(
    database_path: &Path,
    event_type: &str,
    payload: &serde_json::Value,
) -> Result<(), InfraError> {
    let connection = Connection::open(database_path)?;
    connection.execute(
        "INSERT INTO audit_logs (event_type, payload_json, created_at) VALUES (?1, ?2, ?3)",
        params![event_type, serde_json::to_string(payload)?, Utc::now().to_rfc3339()],
    )?;
    Ok(())
}
