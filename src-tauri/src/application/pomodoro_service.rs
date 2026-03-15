use crate::application::audit_log::append_audit_log;
use crate::application::commands::{lock_runtime, AppState};
use crate::application::configured_recipes;
use crate::application::id_factory::next_id;
use crate::application::policy_service::load_runtime_policy;
use crate::application::pomodoro_log_store::save_pomodoro_log;
use crate::application::pomodoro_session_plan;
use crate::application::task_runtime::assign_task_to_block;
use crate::domain::models::{PomodoroLog, PomodoroPhase, TaskStatus};
use crate::infrastructure::error::InfraError;
use chrono::{DateTime, Utc};
use serde::Serialize;

const POMODORO_FOCUS_SECONDS: u32 = 25 * 60;
const POMODORO_BREAK_SECONDS: u32 = 5 * 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PomodoroRuntimePhase {
    Idle,
    Focus,
    Break,
    Paused,
}

impl PomodoroRuntimePhase {
    fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Focus => "focus",
            Self::Break => "break",
            Self::Paused => "paused",
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct PomodoroRuntimeState {
    current_block_id: Option<String>,
    pub(crate) current_task_id: Option<String>,
    phase: PomodoroRuntimePhase,
    paused_phase: Option<PomodoroRuntimePhase>,
    remaining_seconds: u32,
    start_time: Option<DateTime<Utc>>,
    total_cycles: u32,
    completed_cycles: u32,
    current_cycle: u32,
    focus_seconds: u32,
    break_seconds: u32,
    active_log: Option<PomodoroLog>,
    completed_logs: Vec<PomodoroLog>,
}

impl Default for PomodoroRuntimeState {
    fn default() -> Self {
        Self {
            current_block_id: None,
            current_task_id: None,
            phase: PomodoroRuntimePhase::Idle,
            paused_phase: None,
            remaining_seconds: 0,
            start_time: None,
            total_cycles: 0,
            completed_cycles: 0,
            current_cycle: 0,
            focus_seconds: POMODORO_FOCUS_SECONDS,
            break_seconds: POMODORO_BREAK_SECONDS,
            active_log: None,
            completed_logs: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PomodoroStateResponse {
    pub current_block_id: Option<String>,
    pub current_task_id: Option<String>,
    pub phase: String,
    pub remaining_seconds: u32,
    pub start_time: Option<String>,
    pub total_cycles: u32,
    pub completed_cycles: u32,
    pub current_cycle: u32,
}

pub struct PomodoroService<'a> {
    state: &'a AppState,
}

impl<'a> PomodoroService<'a> {
    pub fn new(state: &'a AppState) -> Self {
        Self { state }
    }

    pub fn start_pomodoro(
        &self,
        block_id: String,
        task_id: Option<String>,
    ) -> Result<PomodoroStateResponse, InfraError> {
        let block_id = block_id.trim();
        if block_id.is_empty() {
            return Err(InfraError::InvalidConfig(
                "block_id must not be empty".to_string(),
            ));
        }

        let policy = load_runtime_policy(self.state.config_dir());
        let mut runtime = lock_runtime(self.state)?;
        let block = runtime
            .blocks
            .get(block_id)
            .map(|stored| stored.block.clone())
            .ok_or_else(|| InfraError::InvalidConfig(format!("block not found: {}", block_id)))?;

        let normalized_task_id = task_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);
        if let Some(task_id) = normalized_task_id.as_deref() {
            if !runtime.tasks.contains_key(task_id) {
                return Err(InfraError::InvalidConfig(format!("task not found: {}", task_id)));
            }
        }

        if runtime.pomodoro.phase != PomodoroRuntimePhase::Idle {
            return Err(InfraError::InvalidConfig(
                "timer must be idle before start".to_string(),
            ));
        }

        let recipes = configured_recipes::load_configured_recipes(self.state.config_dir());
        let session_plan = pomodoro_session_plan::build_pomodoro_session_plan(
            &block,
            policy.break_duration_minutes,
            &recipes,
        );
        let now = Utc::now();
        runtime.pomodoro.current_block_id = Some(block_id.to_string());
        runtime.pomodoro.current_task_id = normalized_task_id;
        if let Some(task_id) = runtime.pomodoro.current_task_id.clone() {
            assign_task_to_block(&mut runtime, task_id.as_str(), block_id);
            if let Some(task) = runtime.tasks.get_mut(task_id.as_str()) {
                if task.status != TaskStatus::Completed {
                    task.status = TaskStatus::InProgress;
                }
            }
        }
        runtime.pomodoro.total_cycles = session_plan.total_cycles;
        runtime.pomodoro.completed_cycles = 0;
        runtime.pomodoro.current_cycle = 1;
        runtime.pomodoro.focus_seconds = session_plan.focus_seconds;
        runtime.pomodoro.break_seconds = session_plan.break_seconds;
        runtime.pomodoro.paused_phase = None;
        start_pomodoro_phase(&mut runtime.pomodoro, PomodoroRuntimePhase::Focus, now)?;

        if let Some(task_id) = runtime.pomodoro.current_task_id.clone() {
            append_audit_log(
                self.state.database_path(),
                "task_selected",
                &serde_json::json!({
                    "taskId": task_id,
                    "blockId": block_id,
                }),
            )?;
        }
        self.state
            .log_info("start_pomodoro", &format!("started block_id={}", block_id));
        Ok(to_pomodoro_state_response(&runtime.pomodoro))
    }

    pub fn start_block_timer(
        &self,
        block_id: String,
        task_id: Option<String>,
    ) -> Result<PomodoroStateResponse, InfraError> {
        self.start_pomodoro(block_id, task_id)
    }

    pub fn next_step(&self) -> Result<PomodoroStateResponse, InfraError> {
        self.advance_pomodoro()
    }

    pub fn pause_timer(
        &self,
        reason: Option<String>,
    ) -> Result<PomodoroStateResponse, InfraError> {
        self.pause_pomodoro(reason)
    }

    pub fn resume_timer(&self) -> Result<PomodoroStateResponse, InfraError> {
        self.resume_pomodoro()
    }

    pub fn interrupt_timer(
        &self,
        reason: Option<String>,
    ) -> Result<PomodoroStateResponse, InfraError> {
        let mut runtime = lock_runtime(self.state)?;
        if runtime.pomodoro.phase == PomodoroRuntimePhase::Idle {
            return Ok(to_pomodoro_state_response(&runtime.pomodoro));
        }

        let interruption_reason = reason
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| "interrupted".to_string());
        if let Some(log) = finish_active_log(
            &mut runtime.pomodoro,
            Utc::now(),
            Some(interruption_reason.clone()),
        ) {
            save_pomodoro_log(self.state.database_path(), &log)?;
        }
        reset_pomodoro_session(&mut runtime.pomodoro);
        self.state.log_info(
            "interrupt_timer",
            &format!("interrupted active timer reason={}", interruption_reason),
        );
        Ok(to_pomodoro_state_response(&runtime.pomodoro))
    }

    pub fn pause_pomodoro(
        &self,
        reason: Option<String>,
    ) -> Result<PomodoroStateResponse, InfraError> {
        let mut runtime = lock_runtime(self.state)?;
        if runtime.pomodoro.phase != PomodoroRuntimePhase::Focus
            && runtime.pomodoro.phase != PomodoroRuntimePhase::Break
        {
            return Err(InfraError::InvalidConfig("timer is not running".to_string()));
        }

        let interruption_reason = reason
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| "paused".to_string());

        if let Some(log) = finish_active_log(
            &mut runtime.pomodoro,
            Utc::now(),
            Some(interruption_reason.clone()),
        ) {
            save_pomodoro_log(self.state.database_path(), &log)?;
        }

        runtime.pomodoro.paused_phase = Some(runtime.pomodoro.phase);
        runtime.pomodoro.phase = PomodoroRuntimePhase::Paused;
        runtime.pomodoro.remaining_seconds = runtime
            .pomodoro
            .remaining_seconds
            .min(runtime.pomodoro.focus_seconds.max(runtime.pomodoro.break_seconds));

        self.state
            .log_info("pause_pomodoro", "paused active pomodoro timer");
        Ok(to_pomodoro_state_response(&runtime.pomodoro))
    }

    pub fn resume_pomodoro(&self) -> Result<PomodoroStateResponse, InfraError> {
        let mut runtime = lock_runtime(self.state)?;
        if runtime.pomodoro.phase != PomodoroRuntimePhase::Paused {
            return Err(InfraError::InvalidConfig("timer is not paused".to_string()));
        }

        let resume_phase = runtime
            .pomodoro
            .paused_phase
            .take()
            .ok_or_else(|| InfraError::InvalidConfig("paused phase is missing".to_string()))?;
        let phase = match resume_phase {
            PomodoroRuntimePhase::Focus => PomodoroPhase::Focus,
            PomodoroRuntimePhase::Break => PomodoroPhase::Break,
            _ => {
                return Err(InfraError::InvalidConfig(
                    "cannot resume to idle or paused phase".to_string(),
                ));
            }
        };

        let block_id = runtime
            .pomodoro
            .current_block_id
            .clone()
            .ok_or_else(|| InfraError::InvalidConfig("current block is missing".to_string()))?;
        let now = Utc::now();

        runtime.pomodoro.phase = resume_phase;
        runtime.pomodoro.start_time = Some(now);
        runtime.pomodoro.active_log = Some(PomodoroLog {
            id: next_id("pom"),
            block_id,
            task_id: runtime.pomodoro.current_task_id.clone(),
            phase,
            start_time: now,
            end_time: None,
            interruption_reason: None,
        });

        self.state
            .log_info("resume_pomodoro", "resumed paused pomodoro timer");
        Ok(to_pomodoro_state_response(&runtime.pomodoro))
    }

    pub fn advance_pomodoro(&self) -> Result<PomodoroStateResponse, InfraError> {
        let mut runtime = lock_runtime(self.state)?;
        if runtime.pomodoro.phase != PomodoroRuntimePhase::Focus
            && runtime.pomodoro.phase != PomodoroRuntimePhase::Break
        {
            return Err(InfraError::InvalidConfig("timer is not running".to_string()));
        }

        let now = Utc::now();
        if let Some(log) = finish_active_log(&mut runtime.pomodoro, now, None) {
            save_pomodoro_log(self.state.database_path(), &log)?;
        }
        match runtime.pomodoro.phase {
            PomodoroRuntimePhase::Focus => {
                let total_cycles = runtime.pomodoro.total_cycles.max(1);
                runtime.pomodoro.completed_cycles = runtime
                    .pomodoro
                    .completed_cycles
                    .saturating_add(1)
                    .min(total_cycles);
                start_pomodoro_phase(&mut runtime.pomodoro, PomodoroRuntimePhase::Break, now)?;
                if runtime.pomodoro.completed_cycles >= total_cycles {
                    self.state
                        .log_info("advance_pomodoro", "advanced to final break phase");
                } else {
                    self.state
                        .log_info("advance_pomodoro", "advanced to break phase");
                }
            }
            PomodoroRuntimePhase::Break => {
                let total_cycles = runtime.pomodoro.total_cycles.max(1);
                if runtime.pomodoro.completed_cycles >= total_cycles {
                    reset_pomodoro_session(&mut runtime.pomodoro);
                    self.state.log_info(
                        "advance_pomodoro",
                        "completed all cycles in block session",
                    );
                } else {
                    start_pomodoro_phase(&mut runtime.pomodoro, PomodoroRuntimePhase::Focus, now)?;
                    self.state
                        .log_info("advance_pomodoro", "advanced to focus phase");
                }
            }
            _ => {}
        }

        Ok(to_pomodoro_state_response(&runtime.pomodoro))
    }

    pub fn complete_pomodoro(&self) -> Result<PomodoroStateResponse, InfraError> {
        let mut runtime = lock_runtime(self.state)?;
        if runtime.pomodoro.phase == PomodoroRuntimePhase::Idle {
            return Ok(to_pomodoro_state_response(&runtime.pomodoro));
        }

        let interruption_reason = if runtime.pomodoro.phase == PomodoroRuntimePhase::Focus
            || runtime.pomodoro.phase == PomodoroRuntimePhase::Break
        {
            Some("manual_complete".to_string())
        } else {
            None
        };
        if let Some(log) = finish_active_log(&mut runtime.pomodoro, Utc::now(), interruption_reason)
        {
            save_pomodoro_log(self.state.database_path(), &log)?;
        }
        reset_pomodoro_session(&mut runtime.pomodoro);

        self.state
            .log_info("complete_pomodoro", "completed pomodoro session");
        Ok(to_pomodoro_state_response(&runtime.pomodoro))
    }

    pub fn get_state(&self) -> Result<PomodoroStateResponse, InfraError> {
        let runtime = lock_runtime(self.state)?;
        Ok(to_pomodoro_state_response(&runtime.pomodoro))
    }
}

fn start_pomodoro_phase(
    runtime: &mut PomodoroRuntimeState,
    phase: PomodoroRuntimePhase,
    now: DateTime<Utc>,
) -> Result<(), InfraError> {
    let block_id = runtime
        .current_block_id
        .clone()
        .ok_or_else(|| InfraError::InvalidConfig("current block is missing".to_string()))?;
    let log_phase = match phase {
        PomodoroRuntimePhase::Focus => PomodoroPhase::Focus,
        PomodoroRuntimePhase::Break => PomodoroPhase::Break,
        _ => {
            return Err(InfraError::InvalidConfig(
                "start_pomodoro_phase only supports focus or break".to_string(),
            ));
        }
    };

    runtime.phase = phase;
    runtime.paused_phase = None;
    runtime.remaining_seconds = match phase {
        PomodoroRuntimePhase::Focus => runtime.focus_seconds,
        PomodoroRuntimePhase::Break => runtime.break_seconds,
        _ => 0,
    };
    runtime.start_time = Some(now);
    let total_cycles = runtime.total_cycles.max(1);
    runtime.current_cycle = match phase {
        PomodoroRuntimePhase::Focus => runtime.completed_cycles.saturating_add(1).min(total_cycles),
        PomodoroRuntimePhase::Break => runtime.completed_cycles.min(total_cycles),
        _ => 0,
    };
    runtime.active_log = Some(PomodoroLog {
        id: next_id("pom"),
        block_id,
        task_id: runtime.current_task_id.clone(),
        phase: log_phase,
        start_time: now,
        end_time: None,
        interruption_reason: None,
    });
    Ok(())
}

fn finish_active_log(
    runtime: &mut PomodoroRuntimeState,
    end_time: DateTime<Utc>,
    interruption_reason: Option<String>,
) -> Option<PomodoroLog> {
    if let Some(mut active) = runtime.active_log.take() {
        active.end_time = Some(end_time);
        active.interruption_reason = interruption_reason;
        runtime.completed_logs.push(active.clone());
        return Some(active);
    }
    None
}

fn reset_pomodoro_session(runtime: &mut PomodoroRuntimeState) {
    runtime.current_block_id = None;
    runtime.current_task_id = None;
    runtime.phase = PomodoroRuntimePhase::Idle;
    runtime.paused_phase = None;
    runtime.remaining_seconds = 0;
    runtime.start_time = None;
    runtime.total_cycles = 0;
    runtime.completed_cycles = 0;
    runtime.current_cycle = 0;
    runtime.focus_seconds = POMODORO_FOCUS_SECONDS;
    runtime.break_seconds = POMODORO_BREAK_SECONDS;
    runtime.active_log = None;
}

fn to_pomodoro_state_response(state: &PomodoroRuntimeState) -> PomodoroStateResponse {
    PomodoroStateResponse {
        current_block_id: state.current_block_id.clone(),
        current_task_id: state.current_task_id.clone(),
        phase: state.phase.as_str().to_string(),
        remaining_seconds: state.remaining_seconds,
        start_time: state.start_time.map(|value| value.to_rfc3339()),
        total_cycles: state.total_cycles,
        completed_cycles: state.completed_cycles,
        current_cycle: state.current_cycle,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::block_service::BlockService;
    use crate::application::reflection_service::ReflectionService;
    use crate::application::test_support::workspace::TempWorkspace;

    #[tokio::test]
    async fn property_16_break_phase_starts_automatically_after_focus_ends() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let blocks = BlockService::new(&state)
            .generate_blocks("2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");
        let service = PomodoroService::new(&state);

        let started = service
            .start_pomodoro(blocks[0].id.clone(), None)
            .expect("start pomodoro");
        let advanced = service.advance_pomodoro().expect("advance pomodoro");

        assert_eq!(started.phase, "focus");
        assert_eq!(advanced.phase, "break");
        assert_eq!(advanced.completed_cycles, 1);
        assert!(advanced.remaining_seconds > 0);
    }

    #[tokio::test]
    async fn property_18_complete_or_interrupted_sessions_are_persisted_as_logs() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let blocks = BlockService::new(&state)
            .generate_blocks("2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");
        let service = PomodoroService::new(&state);

        let _ = service
            .start_pomodoro(blocks[0].id.clone(), None)
            .expect("start first pomodoro");
        let _ = service.complete_pomodoro().expect("complete first pomodoro");

        let _ = service
            .start_pomodoro(blocks[1].id.clone(), None)
            .expect("start second pomodoro");
        let _ = service
            .pause_pomodoro(Some("context-switch".to_string()))
            .expect("pause second pomodoro");
        let _ = service.resume_pomodoro().expect("resume second pomodoro");
        let _ = service.complete_pomodoro().expect("complete second pomodoro");

        let summary = ReflectionService::new(&state)
            .get_summary(None, None)
            .expect("reflection summary");

        assert!(summary.logs.iter().any(|log| {
            log.phase == "focus" && log.end_time.is_some()
        }));
        assert!(summary.logs.iter().any(|log| {
            log.interruption_reason.as_deref() == Some("context-switch")
        }));
    }
}
