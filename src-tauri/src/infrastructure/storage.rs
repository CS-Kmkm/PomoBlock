use crate::infrastructure::error::InfraError;
use rusqlite::Connection;
use std::path::Path;

const SCHEMA_SQL: &str = include_str!("../../sql/schema.sql");

pub fn initialize_database(path: &Path) -> Result<(), InfraError> {
    let connection = Connection::open(path)?;
    connection.execute_batch(SCHEMA_SQL)?;
    Ok(())
}
