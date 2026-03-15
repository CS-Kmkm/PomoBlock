use crate::application::calendar_window::parse_datetime_input;
use crate::domain::models::{PomodoroLog, PomodoroPhase};
use crate::infrastructure::error::InfraError;
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use std::path::Path;

fn parse_pomodoro_phase(value: &str) -> Result<PomodoroPhase, InfraError> {
    match value.trim() {
        "focus" => Ok(PomodoroPhase::Focus),
        "break" => Ok(PomodoroPhase::Break),
        "long_break" => Ok(PomodoroPhase::LongBreak),
        "paused" => Ok(PomodoroPhase::Paused),
        other => Err(InfraError::InvalidConfig(format!(
            "unsupported pomodoro phase: {}",
            other
        ))),
    }
}

pub(crate) fn pomodoro_phase_as_str(value: &PomodoroPhase) -> &'static str {
    match value {
        PomodoroPhase::Focus => "focus",
        PomodoroPhase::Break => "break",
        PomodoroPhase::LongBreak => "long_break",
        PomodoroPhase::Paused => "paused",
    }
}

pub(crate) fn save_pomodoro_log(database_path: &Path, log: &PomodoroLog) -> Result<(), InfraError> {
    let connection = Connection::open(database_path)?;
    connection.execute(
        "INSERT INTO pomodoro_logs (id, block_id, task_id, start_time, end_time, phase, interruption_reason)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
           block_id = excluded.block_id,
           task_id = excluded.task_id,
           start_time = excluded.start_time,
           end_time = excluded.end_time,
           phase = excluded.phase,
           interruption_reason = excluded.interruption_reason",
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

pub(crate) fn load_pomodoro_logs(
    database_path: &Path,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
) -> Result<Vec<PomodoroLog>, InfraError> {
    let connection = Connection::open(database_path)?;
    let mut statement = connection.prepare(
        "SELECT id, block_id, task_id, start_time, end_time, phase, interruption_reason
         FROM pomodoro_logs
         WHERE start_time >= ?1 AND start_time <= ?2
         ORDER BY start_time ASC",
    )?;
    let mut rows = statement.query(params![start.to_rfc3339(), end.to_rfc3339()])?;
    let mut logs = Vec::new();
    while let Some(row) = rows.next()? {
        let start_time = parse_datetime_input(&row.get::<_, String>(3)?, "pomodoro_logs.start_time")?;
        let end_time = row
            .get::<_, Option<String>>(4)?
            .map(|value| parse_datetime_input(&value, "pomodoro_logs.end_time"))
            .transpose()?;
        logs.push(PomodoroLog {
            id: row.get(0)?,
            block_id: row.get(1)?,
            task_id: row.get(2)?,
            start_time,
            end_time,
            phase: parse_pomodoro_phase(&row.get::<_, String>(5)?)?,
            interruption_reason: row.get(6)?,
        });
    }
    Ok(logs)
}
