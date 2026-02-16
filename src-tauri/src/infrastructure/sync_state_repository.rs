use crate::infrastructure::error::InfraError;
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncState {
    pub sync_token: Option<String>,
    pub last_sync_time: DateTime<Utc>,
}

pub trait SyncStateRepository: Send + Sync {
    fn load(&self) -> Result<Option<SyncState>, InfraError>;
    fn save(&self, sync_token: Option<&str>, last_sync_time: DateTime<Utc>) -> Result<(), InfraError>;
}

#[derive(Debug, Clone)]
pub struct SqliteSyncStateRepository {
    db_path: PathBuf,
}

impl SqliteSyncStateRepository {
    pub fn new(db_path: impl AsRef<Path>) -> Self {
        Self {
            db_path: db_path.as_ref().to_path_buf(),
        }
    }

    fn connect(&self) -> Result<Connection, InfraError> {
        Connection::open(&self.db_path).map_err(InfraError::from)
    }
}

impl SyncStateRepository for SqliteSyncStateRepository {
    fn load(&self) -> Result<Option<SyncState>, InfraError> {
        let connection = self.connect()?;
        let row: Option<(Option<String>, String)> = connection
            .query_row(
                "SELECT sync_token, last_sync_time FROM sync_state WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;

        let Some((sync_token, last_sync_time_raw)) = row else {
            return Ok(None);
        };

        let parsed = DateTime::parse_from_rfc3339(&last_sync_time_raw).map_err(|error| {
            InfraError::InvalidConfig(format!(
                "invalid sync_state.last_sync_time '{}': {error}",
                last_sync_time_raw
            ))
        })?;

        Ok(Some(SyncState {
            sync_token,
            last_sync_time: parsed.with_timezone(&Utc),
        }))
    }

    fn save(&self, sync_token: Option<&str>, last_sync_time: DateTime<Utc>) -> Result<(), InfraError> {
        let connection = self.connect()?;
        connection.execute(
            "INSERT INTO sync_state (id, sync_token, last_sync_time)
             VALUES (1, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET
               sync_token = excluded.sync_token,
               last_sync_time = excluded.last_sync_time",
            params![sync_token, last_sync_time.to_rfc3339()],
        )?;
        Ok(())
    }
}

#[derive(Debug, Default)]
pub struct InMemorySyncStateRepository {
    state: Mutex<Option<SyncState>>,
}

impl SyncStateRepository for InMemorySyncStateRepository {
    fn load(&self) -> Result<Option<SyncState>, InfraError> {
        let state = self
            .state
            .lock()
            .map_err(|error| InfraError::InvalidConfig(format!("sync state lock poisoned: {error}")))?;
        Ok(state.clone())
    }

    fn save(&self, sync_token: Option<&str>, last_sync_time: DateTime<Utc>) -> Result<(), InfraError> {
        let mut state = self
            .state
            .lock()
            .map_err(|error| InfraError::InvalidConfig(format!("sync state lock poisoned: {error}")))?;
        *state = Some(SyncState {
            sync_token: sync_token.map(ToOwned::to_owned),
            last_sync_time,
        });
        Ok(())
    }
}
