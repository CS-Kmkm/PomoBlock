use crate::domain::models::{
    AutoDriveMode, Block, BlockContents, Firmness, PomodoroLog, PomodoroPhase, Task, TaskStatus,
};
use crate::infrastructure::error::InfraError;
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::path::{Path, PathBuf};

const SCHEMA_SQL: &str = include_str!("../../sql/schema.sql");

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredBlockRecord {
    pub block: Block,
    pub task_id: Option<String>,
    pub calendar_event_id: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncStateRecord {
    pub sync_token: Option<String>,
    pub last_sync_time: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SuppressionRecord {
    pub instance: String,
    pub suppressed_at: DateTime<Utc>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuditLogRecord {
    pub id: i64,
    pub event_type: String,
    pub payload: Value,
    pub created_at: DateTime<Utc>,
}

pub struct LocalRepository {
    path: PathBuf,
}

impl LocalRepository {
    pub fn new(path: impl AsRef<Path>) -> Result<Self, InfraError> {
        let path = path.as_ref().to_path_buf();
        let connection = Connection::open(&path)?;
        connection.execute_batch(SCHEMA_SQL)?;
        Ok(Self { path })
    }

    fn connection(&self) -> Result<Connection, InfraError> {
        Ok(Connection::open(&self.path)?)
    }

    pub fn save_block(&self, record: &StoredBlockRecord) -> Result<(), InfraError> {
        let connection = self.connection()?;
        connection.execute(
            r#"
            INSERT INTO blocks (
                id, instance, date, start_time, end_time, type, firmness, planned_pomodoros,
                status, source, source_id, task_refs, calendar_event_id, task_id, created_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, 'deep', ?6, ?7, 'planned', ?8, ?9, ?10, ?11, ?12, ?13)
            ON CONFLICT(id) DO UPDATE SET
                instance = excluded.instance,
                date = excluded.date,
                start_time = excluded.start_time,
                end_time = excluded.end_time,
                firmness = excluded.firmness,
                planned_pomodoros = excluded.planned_pomodoros,
                source = excluded.source,
                source_id = excluded.source_id,
                task_refs = excluded.task_refs,
                calendar_event_id = excluded.calendar_event_id,
                task_id = excluded.task_id,
                created_at = excluded.created_at
            "#,
            params![
                record.block.id,
                record.block.instance,
                record.block.date,
                record.block.start_at.to_rfc3339(),
                record.block.end_at.to_rfc3339(),
                firmness_as_str(&record.block.firmness),
                record.block.planned_pomodoros,
                record.block.source,
                record.block.source_id,
                serde_json::to_string(&record.block.contents.task_refs)?,
                record.calendar_event_id,
                record.task_id,
                record.created_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn load_blocks(&self, date: &str) -> Result<Vec<StoredBlockRecord>, InfraError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            r#"
            SELECT id, instance, date, start_time, end_time, firmness, planned_pomodoros,
                   source, source_id, task_refs, calendar_event_id, task_id, created_at
            FROM blocks
            WHERE date = ?1
            ORDER BY start_time ASC
            "#,
        )?;
        let rows = statement.query_map(params![date], map_block_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(InfraError::from)
    }

    pub fn load_block_by_id(&self, block_id: &str) -> Result<Option<StoredBlockRecord>, InfraError> {
        let connection = self.connection()?;
        connection
            .query_row(
                r#"
                SELECT id, instance, date, start_time, end_time, firmness, planned_pomodoros,
                       source, source_id, task_refs, calendar_event_id, task_id, created_at
                FROM blocks
                WHERE id = ?1
                "#,
                params![block_id],
                map_block_row,
            )
            .optional()
            .map_err(InfraError::from)
    }

    pub fn delete_block(&self, block_id: &str) -> Result<(), InfraError> {
        let connection = self.connection()?;
        connection.execute("DELETE FROM pomodoro_logs WHERE block_id = ?1", params![block_id])?;
        connection.execute("DELETE FROM blocks WHERE id = ?1", params![block_id])?;
        Ok(())
    }

    pub fn save_task(&self, task: &Task) -> Result<(), InfraError> {
        let connection = self.connection()?;
        connection.execute(
            r#"
            INSERT INTO tasks (
                id, title, description, estimated_pomodoros, completed_pomodoros, status, created_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                description = excluded.description,
                estimated_pomodoros = excluded.estimated_pomodoros,
                completed_pomodoros = excluded.completed_pomodoros,
                status = excluded.status,
                created_at = excluded.created_at
            "#,
            params![
                task.id,
                task.title,
                task.description,
                task.estimated_pomodoros,
                task.completed_pomodoros,
                task_status_as_str(&task.status),
                task.created_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn load_tasks(&self) -> Result<Vec<Task>, InfraError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            r#"
            SELECT id, title, description, estimated_pomodoros, completed_pomodoros, status, created_at
            FROM tasks
            ORDER BY created_at ASC
            "#,
        )?;
        let rows = statement.query_map([], |row| {
            Ok(Task {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                estimated_pomodoros: row.get(3)?,
                completed_pomodoros: row.get(4)?,
                status: parse_task_status(&row.get::<_, String>(5)?).map_err(sql_conversion_error)?,
                created_at: parse_datetime(&row.get::<_, String>(6)?).map_err(sql_conversion_error)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(InfraError::from)
    }

    pub fn delete_task(&self, task_id: &str) -> Result<(), InfraError> {
        let connection = self.connection()?;
        connection.execute("DELETE FROM pomodoro_logs WHERE task_id = ?1", params![task_id])?;

        let mut statement = connection.prepare(
            r#"
            SELECT id, task_refs
            FROM blocks
            WHERE task_id = ?1 OR task_refs LIKE ?2
            "#,
        )?;
        let like_pattern = format!("%\"{task_id}\"%");
        let rows = statement.query_map(params![task_id, like_pattern], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })?;
        let related_blocks = rows.collect::<Result<Vec<_>, _>>()?;
        for (block_id, task_refs_json) in related_blocks {
            let updated_refs = remove_task_ref(task_refs_json.as_deref(), task_id);
            connection.execute(
                r#"
                UPDATE blocks
                SET task_id = CASE WHEN task_id = ?1 THEN NULL ELSE task_id END,
                    task_refs = ?2
                WHERE id = ?3
                "#,
                params![task_id, updated_refs, block_id],
            )?;
        }

        connection.execute("DELETE FROM tasks WHERE id = ?1", params![task_id])?;
        Ok(())
    }

    pub fn save_pomodoro_log(&self, log: &PomodoroLog) -> Result<(), InfraError> {
        let connection = self.connection()?;
        connection.execute(
            r#"
            INSERT INTO pomodoro_logs (id, block_id, task_id, start_time, end_time, phase, interruption_reason)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(id) DO UPDATE SET
                block_id = excluded.block_id,
                task_id = excluded.task_id,
                start_time = excluded.start_time,
                end_time = excluded.end_time,
                phase = excluded.phase,
                interruption_reason = excluded.interruption_reason
            "#,
            params![
                log.id,
                log.block_id,
                log.task_id,
                log.start_time.to_rfc3339(),
                log.end_time.map(|value| value.to_rfc3339()),
                pomodoro_phase_as_str(&log.phase),
                log.interruption_reason,
            ],
        )?;
        Ok(())
    }

    pub fn load_pomodoro_logs(
        &self,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<Vec<PomodoroLog>, InfraError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            r#"
            SELECT id, block_id, task_id, start_time, end_time, phase, interruption_reason
            FROM pomodoro_logs
            WHERE start_time >= ?1 AND start_time <= ?2
            ORDER BY start_time ASC
            "#,
        )?;
        let rows = statement.query_map(params![start.to_rfc3339(), end.to_rfc3339()], |row| {
            Ok(PomodoroLog {
                id: row.get(0)?,
                block_id: row.get(1)?,
                task_id: row.get(2)?,
                start_time: parse_datetime(&row.get::<_, String>(3)?).map_err(sql_conversion_error)?,
                end_time: row
                    .get::<_, Option<String>>(4)?
                    .map(|value| parse_datetime(&value))
                    .transpose()
                    .map_err(sql_conversion_error)?,
                phase: parse_pomodoro_phase(&row.get::<_, String>(5)?).map_err(sql_conversion_error)?,
                interruption_reason: row.get(6)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(InfraError::from)
    }

    pub fn delete_pomodoro_log(&self, log_id: &str) -> Result<(), InfraError> {
        let connection = self.connection()?;
        connection.execute("DELETE FROM pomodoro_logs WHERE id = ?1", params![log_id])?;
        Ok(())
    }

    pub fn save_sync_state(&self, state: &SyncStateRecord) -> Result<(), InfraError> {
        let connection = self.connection()?;
        connection.execute(
            r#"
            INSERT INTO sync_state (id, sync_token, last_sync_time)
            VALUES (1, ?1, ?2)
            ON CONFLICT(id) DO UPDATE SET
                sync_token = excluded.sync_token,
                last_sync_time = excluded.last_sync_time
            "#,
            params![state.sync_token, state.last_sync_time.to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn load_sync_state(&self) -> Result<Option<SyncStateRecord>, InfraError> {
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT sync_token, last_sync_time FROM sync_state WHERE id = 1",
                [],
                |row| {
                    Ok(SyncStateRecord {
                        sync_token: row.get(0)?,
                        last_sync_time: parse_datetime(&row.get::<_, String>(1)?)
                            .map_err(sql_conversion_error)?,
                    })
                },
            )
            .optional()
            .map_err(InfraError::from)
    }

    pub fn clear_sync_state(&self) -> Result<(), InfraError> {
        let connection = self.connection()?;
        connection.execute("DELETE FROM sync_state WHERE id = 1", [])?;
        Ok(())
    }

    pub fn save_suppression(&self, instance: &str, reason: Option<&str>) -> Result<(), InfraError> {
        let connection = self.connection()?;
        connection.execute(
            r#"
            INSERT INTO suppressions (instance, suppressed_at, reason)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(instance) DO UPDATE SET
                suppressed_at = excluded.suppressed_at,
                reason = excluded.reason
            "#,
            params![instance, Utc::now().to_rfc3339(), reason],
        )?;
        Ok(())
    }

    pub fn load_suppressions(&self) -> Result<Vec<SuppressionRecord>, InfraError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT instance, suppressed_at, reason FROM suppressions ORDER BY suppressed_at ASC",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(SuppressionRecord {
                instance: row.get(0)?,
                suppressed_at: parse_datetime(&row.get::<_, String>(1)?)
                    .map_err(sql_conversion_error)?,
                reason: row.get(2)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(InfraError::from)
    }

    pub fn clear_suppressions(&self) -> Result<(), InfraError> {
        let connection = self.connection()?;
        connection.execute("DELETE FROM suppressions", [])?;
        Ok(())
    }

    pub fn append_audit_log(&self, event_type: &str, payload: &Value) -> Result<(), InfraError> {
        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO audit_logs (event_type, payload_json, created_at) VALUES (?1, ?2, ?3)",
            params![event_type, serde_json::to_string(payload)?, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn load_audit_logs(&self, limit: usize) -> Result<Vec<AuditLogRecord>, InfraError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            r#"
            SELECT id, event_type, payload_json, created_at
            FROM audit_logs
            ORDER BY id DESC
            LIMIT ?1
            "#,
        )?;
        let rows = statement.query_map(params![i64::try_from(limit).unwrap_or(i64::MAX)], |row| {
            Ok(AuditLogRecord {
                id: row.get(0)?,
                event_type: row.get(1)?,
                payload: serde_json::from_str(&row.get::<_, String>(2)?)
                    .unwrap_or_else(|_| Value::Object(Default::default())),
                created_at: parse_datetime(&row.get::<_, String>(3)?)
                    .map_err(sql_conversion_error)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(InfraError::from)
    }

    pub fn clear_audit_logs(&self) -> Result<(), InfraError> {
        let connection = self.connection()?;
        connection.execute("DELETE FROM audit_logs", [])?;
        Ok(())
    }
}

fn map_block_row(row: &rusqlite::Row<'_>) -> Result<StoredBlockRecord, rusqlite::Error> {
    let task_refs_json: Option<String> = row.get(9)?;
    Ok(StoredBlockRecord {
        block: Block {
            id: row.get(0)?,
            instance: row.get(1)?,
            date: row.get(2)?,
            start_at: parse_datetime(&row.get::<_, String>(3)?)
                .map_err(|error| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error)))?,
            end_at: parse_datetime(&row.get::<_, String>(4)?)
                .map_err(|error| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error)))?,
            firmness: parse_firmness(&row.get::<_, String>(5)?)
                .map_err(|error| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error)))?,
            planned_pomodoros: row.get(6)?,
            source: row.get(7)?,
            source_id: row.get(8)?,
            recipe_id: "rcp-default".to_string(),
            auto_drive_mode: AutoDriveMode::Manual,
            contents: BlockContents {
                task_refs: parse_task_refs(task_refs_json.as_deref()),
                memo: None,
                checklist: Vec::new(),
                time_splits: Vec::new(),
            },
        },
        calendar_event_id: row.get(10)?,
        task_id: row.get(11)?,
        created_at: parse_datetime(&row.get::<_, String>(12)?)
            .map_err(|error| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error)))?,
    })
}

fn sql_conversion_error(error: InfraError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(error),
    )
}

fn parse_datetime(value: &str) -> Result<DateTime<Utc>, InfraError> {
    Ok(DateTime::parse_from_rfc3339(value)
        .map_err(|error| InfraError::InvalidConfig(format!("invalid datetime: {error}")))?
        .with_timezone(&Utc))
}

fn parse_task_refs(value: Option<&str>) -> Vec<String> {
    value
        .and_then(|json| serde_json::from_str::<Vec<String>>(json).ok())
        .unwrap_or_default()
}

fn remove_task_ref(value: Option<&str>, task_id: &str) -> String {
    serde_json::to_string(
        &parse_task_refs(value)
            .into_iter()
            .filter(|candidate| candidate != task_id)
            .collect::<Vec<_>>(),
    )
    .unwrap_or_else(|_| "[]".to_string())
}

fn firmness_as_str(value: &Firmness) -> &'static str {
    match value {
        Firmness::Draft => "draft",
        Firmness::Soft => "soft",
        Firmness::Hard => "hard",
    }
}

fn parse_firmness(value: &str) -> Result<Firmness, InfraError> {
    match value {
        "draft" => Ok(Firmness::Draft),
        "soft" => Ok(Firmness::Soft),
        "hard" => Ok(Firmness::Hard),
        _ => Err(InfraError::InvalidConfig(format!("invalid firmness: {value}"))),
    }
}

fn task_status_as_str(value: &TaskStatus) -> &'static str {
    match value {
        TaskStatus::Pending => "pending",
        TaskStatus::InProgress => "in_progress",
        TaskStatus::Completed => "completed",
        TaskStatus::Deferred => "deferred",
    }
}

fn parse_task_status(value: &str) -> Result<TaskStatus, InfraError> {
    match value {
        "pending" => Ok(TaskStatus::Pending),
        "in_progress" => Ok(TaskStatus::InProgress),
        "completed" => Ok(TaskStatus::Completed),
        "deferred" => Ok(TaskStatus::Deferred),
        _ => Err(InfraError::InvalidConfig(format!("invalid task status: {value}"))),
    }
}

fn pomodoro_phase_as_str(value: &PomodoroPhase) -> &'static str {
    match value {
        PomodoroPhase::Focus => "focus",
        PomodoroPhase::Break => "break",
        PomodoroPhase::LongBreak => "long_break",
        PomodoroPhase::Paused => "paused",
    }
}

fn parse_pomodoro_phase(value: &str) -> Result<PomodoroPhase, InfraError> {
    match value {
        "focus" => Ok(PomodoroPhase::Focus),
        "break" => Ok(PomodoroPhase::Break),
        "long_break" => Ok(PomodoroPhase::LongBreak),
        "paused" => Ok(PomodoroPhase::Paused),
        _ => Err(InfraError::InvalidConfig(format!("invalid pomodoro phase: {value}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_TEMP_DB: AtomicUsize = AtomicUsize::new(0);

    struct TempDb {
        path: PathBuf,
    }

    impl TempDb {
        fn new() -> Self {
            let sequence = NEXT_TEMP_DB.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!(
                "pomoblock-local-repository-tests-{}-{}",
                std::process::id(),
                sequence
            ));
            fs::create_dir_all(&dir).expect("create temp dir");
            Self {
                path: dir.join("pomoblock.sqlite"),
            }
        }

        fn repository(&self) -> LocalRepository {
            LocalRepository::new(&self.path).expect("create repository")
        }
    }

    impl Drop for TempDb {
        fn drop(&mut self) {
            if let Some(parent) = self.path.parent() {
                let _ = fs::remove_dir_all(parent);
            }
        }
    }

    fn sample_block(id: &str) -> StoredBlockRecord {
        StoredBlockRecord {
            block: Block {
                id: id.to_string(),
                instance: format!("rtn:rtn_focus:2026-02-16:{id}"),
                date: "2026-02-16".to_string(),
                start_at: DateTime::parse_from_rfc3339("2026-02-16T09:00:00Z")
                    .expect("start")
                    .with_timezone(&Utc),
                end_at: DateTime::parse_from_rfc3339("2026-02-16T09:50:00Z")
                    .expect("end")
                    .with_timezone(&Utc),
                firmness: Firmness::Draft,
                planned_pomodoros: 1,
                source: "routine".to_string(),
                source_id: Some("rtn_focus".to_string()),
                recipe_id: "rcp-default".to_string(),
                auto_drive_mode: AutoDriveMode::Manual,
                contents: BlockContents {
                    task_refs: Vec::new(),
                    memo: None,
                    checklist: Vec::new(),
                    time_splits: Vec::new(),
                },
            },
            task_id: None,
            calendar_event_id: Some("evt-1".to_string()),
            created_at: DateTime::parse_from_rfc3339("2026-02-16T08:55:00Z")
                .expect("created at")
                .with_timezone(&Utc),
        }
    }

    fn sample_task(id: &str) -> Task {
        Task {
            id: id.to_string(),
            title: "Write sync layer".to_string(),
            description: Some("repository roundtrip".to_string()),
            estimated_pomodoros: Some(4),
            completed_pomodoros: 0,
            status: TaskStatus::Pending,
            created_at: DateTime::parse_from_rfc3339("2026-02-16T08:00:00Z")
                .expect("created at")
                .with_timezone(&Utc),
        }
    }

    fn sample_log(block_id: &str, task_id: Option<&str>, id: &str) -> PomodoroLog {
        PomodoroLog {
            id: id.to_string(),
            block_id: block_id.to_string(),
            task_id: task_id.map(ToOwned::to_owned),
            phase: PomodoroPhase::Focus,
            start_time: DateTime::parse_from_rfc3339("2026-02-16T09:00:00Z")
                .expect("start time")
                .with_timezone(&Utc),
            end_time: Some(
                DateTime::parse_from_rfc3339("2026-02-16T09:25:00Z")
                    .expect("end time")
                    .with_timezone(&Utc),
            ),
            interruption_reason: None,
        }
    }

    #[test]
    fn repository_roundtrip_covers_blocks_tasks_logs_sync_and_suppressions() {
        let temp_db = TempDb::new();
        let repository = temp_db.repository();
        let block = sample_block("block-1");
        let task = sample_task("task-1");
        let sync_state = SyncStateRecord {
            sync_token: Some("sync-token-1".to_string()),
            last_sync_time: DateTime::parse_from_rfc3339("2026-02-16T00:00:00Z")
                .expect("sync time")
                .with_timezone(&Utc),
        };

        repository.save_block(&block).expect("save block");
        repository.save_task(&task).expect("save task");
        repository
            .save_pomodoro_log(&sample_log(&block.block.id, Some(&task.id), "log-1"))
            .expect("save log");
        repository.save_sync_state(&sync_state).expect("save sync state");
        repository
            .save_suppression(&block.block.instance, Some("user deleted block"))
            .expect("save suppression");

        let loaded_block = repository
            .load_blocks("2026-02-16")
            .expect("load blocks")
            .pop()
            .expect("one block");
        let loaded_task = repository
            .load_tasks()
            .expect("load tasks")
            .pop()
            .expect("one task");
        let loaded_log = repository
            .load_pomodoro_logs(
                block.block.start_at - Duration::hours(1),
                block.block.end_at + Duration::hours(1),
            )
            .expect("load logs")
            .pop()
            .expect("one log");
        let loaded_sync_state = repository
            .load_sync_state()
            .expect("load sync state")
            .expect("sync state");
        let loaded_suppression = repository
            .load_suppressions()
            .expect("load suppressions")
            .pop()
            .expect("one suppression");

        assert_eq!(loaded_block.block.id, block.block.id);
        assert_eq!(loaded_task.id, task.id);
        assert_eq!(loaded_log.id, "log-1");
        assert_eq!(loaded_sync_state.sync_token.as_deref(), Some("sync-token-1"));
        assert_eq!(loaded_suppression.instance, block.block.instance);
    }

    #[test]
    fn property_30_deleted_local_data_is_fully_removed() {
        let temp_db = TempDb::new();
        let repository = temp_db.repository();
        let mut block = sample_block("block-1");
        block.task_id = Some("task-1".to_string());
        block.block.contents.task_refs = vec!["task-1".to_string()];
        let task = sample_task("task-1");

        repository.save_block(&block).expect("save block");
        repository.save_task(&task).expect("save task");
        repository
            .save_pomodoro_log(&sample_log("block-1", Some("task-1"), "log-1"))
            .expect("save log");
        repository
            .save_sync_state(&SyncStateRecord {
                sync_token: Some("sync-token".to_string()),
                last_sync_time: Utc::now(),
            })
            .expect("save sync state");
        repository
            .save_suppression(&block.block.instance, Some("deleted by user"))
            .expect("save suppression");
        repository
            .append_audit_log("task_selected", &serde_json::json!({"taskId":"task-1","blockId":"block-1"}))
            .expect("append audit log");

        repository.delete_pomodoro_log("log-1").expect("delete log");
        assert!(repository
            .load_pomodoro_logs(block.block.start_at - Duration::hours(1), block.block.end_at + Duration::hours(1))
            .expect("load logs")
            .is_empty());

        repository
            .save_pomodoro_log(&sample_log("block-1", Some("task-1"), "log-2"))
            .expect("save log");
        repository.delete_task("task-1").expect("delete task");

        assert!(repository.load_tasks().expect("load tasks").is_empty());
        let updated_block = repository
            .load_block_by_id("block-1")
            .expect("load block")
            .expect("block exists");
        assert!(updated_block.task_id.is_none());
        assert!(!updated_block
            .block
            .contents
            .task_refs
            .contains(&"task-1".to_string()));
        assert!(repository
            .load_pomodoro_logs(block.block.start_at - Duration::hours(1), block.block.end_at + Duration::hours(1))
            .expect("load logs")
            .is_empty());

        repository.delete_block("block-1").expect("delete block");
        assert!(repository
            .load_blocks("2026-02-16")
            .expect("load blocks")
            .is_empty());

        repository.clear_sync_state().expect("clear sync state");
        repository.clear_suppressions().expect("clear suppressions");
        repository.clear_audit_logs().expect("clear audit logs");

        assert!(repository.load_sync_state().expect("load sync state").is_none());
        assert!(repository
            .load_suppressions()
            .expect("load suppressions")
            .is_empty());
        assert!(repository.load_audit_logs(100).expect("load audit logs").is_empty());
    }
}
