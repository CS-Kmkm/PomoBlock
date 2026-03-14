use crate::application::calendar_window::parse_datetime_input;
use crate::application::commands::{legacy, AppState};
use crate::domain::models::PomodoroPhase;
use crate::infrastructure::error::InfraError;
use chrono::{Duration, Utc};
use serde::Serialize;

pub struct ReflectionService<'a> {
    state: &'a AppState,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReflectionLogItem {
    pub id: String,
    pub block_id: String,
    pub task_id: Option<String>,
    pub phase: String,
    pub start_time: String,
    pub end_time: Option<String>,
    pub interruption_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReflectionSummaryResponse {
    pub start: String,
    pub end: String,
    pub completed_count: u32,
    pub interrupted_count: u32,
    pub total_focus_minutes: i64,
    pub logs: Vec<ReflectionLogItem>,
}

impl<'a> ReflectionService<'a> {
    pub fn new(state: &'a AppState) -> Self {
        Self { state }
    }

    pub fn get_summary(
        &self,
        start: Option<String>,
        end: Option<String>,
    ) -> Result<ReflectionSummaryResponse, InfraError> {
        let default_start = Utc::now() - Duration::days(7);
        let start = match start {
            Some(raw) => parse_datetime_input(&raw, "start")?,
            None => default_start,
        };
        let end = match end {
            Some(raw) => parse_datetime_input(&raw, "end")?,
            None => Utc::now(),
        };
        if end <= start {
            return Err(InfraError::InvalidConfig(
                "end must be greater than start".to_string(),
            ));
        }

        let logs_in_range = legacy::load_pomodoro_logs(self.state.database_path(), start, end)?;

        let completed_count = logs_in_range
            .iter()
            .filter(|log| log.phase == PomodoroPhase::Focus && log.interruption_reason.is_none())
            .count() as u32;
        let interrupted_count = logs_in_range
            .iter()
            .filter(|log| log.interruption_reason.is_some())
            .count() as u32;

        let total_focus_minutes = logs_in_range
            .iter()
            .filter(|log| log.phase == PomodoroPhase::Focus)
            .filter_map(|log| log.end_time.map(|end_time| (end_time - log.start_time).num_minutes()))
            .filter(|duration_minutes| *duration_minutes > 0)
            .sum();

        let logs = logs_in_range
            .into_iter()
            .map(|log| ReflectionLogItem {
                id: log.id,
                block_id: log.block_id,
                task_id: log.task_id,
                phase: match log.phase {
                    PomodoroPhase::Focus => "focus",
                    PomodoroPhase::Break => "break",
                    PomodoroPhase::LongBreak => "long_break",
                    PomodoroPhase::Paused => "paused",
                }
                .to_string(),
                start_time: log.start_time.to_rfc3339(),
                end_time: log.end_time.map(|value| value.to_rfc3339()),
                interruption_reason: log.interruption_reason,
            })
            .collect::<Vec<_>>();

        Ok(ReflectionSummaryResponse {
            start: start.to_rfc3339(),
            end: end.to_rfc3339(),
            completed_count,
            interrupted_count,
            total_focus_minutes,
            logs,
        })
    }
}
