use crate::application::pomodoro_service::PomodoroService;
use crate::infrastructure::error::InfraError;

pub use crate::application::pomodoro_service::PomodoroStateResponse;

pub fn start_pomodoro_impl(
    state: &super::legacy::AppState,
    block_id: String,
    task_id: Option<String>,
) -> Result<PomodoroStateResponse, InfraError> {
    PomodoroService::new(state).start_pomodoro(block_id, task_id)
}

pub fn start_block_timer_impl(
    state: &super::legacy::AppState,
    block_id: String,
    task_id: Option<String>,
) -> Result<PomodoroStateResponse, InfraError> {
    PomodoroService::new(state).start_block_timer(block_id, task_id)
}

pub fn next_step_impl(state: &super::legacy::AppState) -> Result<PomodoroStateResponse, InfraError> {
    PomodoroService::new(state).next_step()
}

pub fn pause_timer_impl(
    state: &super::legacy::AppState,
    reason: Option<String>,
) -> Result<PomodoroStateResponse, InfraError> {
    PomodoroService::new(state).pause_timer(reason)
}

pub fn resume_timer_impl(state: &super::legacy::AppState) -> Result<PomodoroStateResponse, InfraError> {
    PomodoroService::new(state).resume_timer()
}

pub fn interrupt_timer_impl(
    state: &super::legacy::AppState,
    reason: Option<String>,
) -> Result<PomodoroStateResponse, InfraError> {
    PomodoroService::new(state).interrupt_timer(reason)
}

pub fn pause_pomodoro_impl(
    state: &super::legacy::AppState,
    reason: Option<String>,
) -> Result<PomodoroStateResponse, InfraError> {
    PomodoroService::new(state).pause_pomodoro(reason)
}

pub fn resume_pomodoro_impl(state: &super::legacy::AppState) -> Result<PomodoroStateResponse, InfraError> {
    PomodoroService::new(state).resume_pomodoro()
}

pub fn advance_pomodoro_impl(
    state: &super::legacy::AppState,
) -> Result<PomodoroStateResponse, InfraError> {
    PomodoroService::new(state).advance_pomodoro()
}

pub fn complete_pomodoro_impl(
    state: &super::legacy::AppState,
) -> Result<PomodoroStateResponse, InfraError> {
    PomodoroService::new(state).complete_pomodoro()
}

pub fn get_pomodoro_state_impl(
    state: &super::legacy::AppState,
) -> Result<PomodoroStateResponse, InfraError> {
    PomodoroService::new(state).get_state()
}
