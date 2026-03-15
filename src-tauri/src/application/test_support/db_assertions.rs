use crate::infrastructure::error::InfraError;
use rusqlite::{params, Connection};
use serde_json::Value;
use std::path::Path;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AuditLogEntry {
    pub(crate) event_type: String,
    pub(crate) payload: Value,
}

pub(crate) fn load_audit_logs(
    database_path: &Path,
    limit: usize,
) -> Result<Vec<AuditLogEntry>, InfraError> {
    let connection = Connection::open(database_path)?;
    let mut statement = connection.prepare(
        "SELECT event_type, payload_json
         FROM audit_logs
         ORDER BY id ASC
         LIMIT ?1",
    )?;
    let rows = statement.query_map(params![limit], |row| {
        let payload_raw: String = row.get(1)?;
        let payload = serde_json::from_str::<Value>(&payload_raw).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                payload_raw.len(),
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
        Ok(AuditLogEntry {
            event_type: row.get(0)?,
            payload,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(InfraError::from)
}
