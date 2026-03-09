use crate::application::commands::legacy;
use crate::infrastructure::error::InfraError;

pub struct PomodoroService<'a> {
    state: &'a legacy::AppState,
}

impl<'a> PomodoroService<'a> {
    pub fn new(state: &'a legacy::AppState) -> Self {
        Self { state }
    }

    pub fn start_pomodoro(
        &self,
        block_id: String,
        task_id: Option<String>,
    ) -> Result<legacy::PomodoroStateResponse, InfraError> {
        legacy::start_pomodoro_impl(self.state, block_id, task_id)
    }

    pub fn start_block_timer(
        &self,
        block_id: String,
        task_id: Option<String>,
    ) -> Result<legacy::PomodoroStateResponse, InfraError> {
        legacy::start_block_timer_impl(self.state, block_id, task_id)
    }

    pub fn next_step(&self) -> Result<legacy::PomodoroStateResponse, InfraError> {
        legacy::next_step_impl(self.state)
    }

    pub fn pause_timer(
        &self,
        reason: Option<String>,
    ) -> Result<legacy::PomodoroStateResponse, InfraError> {
        legacy::pause_timer_impl(self.state, reason)
    }

    pub fn resume_timer(&self) -> Result<legacy::PomodoroStateResponse, InfraError> {
        legacy::resume_timer_impl(self.state)
    }

    pub fn interrupt_timer(
        &self,
        reason: Option<String>,
    ) -> Result<legacy::PomodoroStateResponse, InfraError> {
        legacy::interrupt_timer_impl(self.state, reason)
    }

    pub fn pause_pomodoro(
        &self,
        reason: Option<String>,
    ) -> Result<legacy::PomodoroStateResponse, InfraError> {
        legacy::pause_pomodoro_impl(self.state, reason)
    }

    pub fn resume_pomodoro(&self) -> Result<legacy::PomodoroStateResponse, InfraError> {
        legacy::resume_pomodoro_impl(self.state)
    }

    pub fn advance_pomodoro(&self) -> Result<legacy::PomodoroStateResponse, InfraError> {
        legacy::advance_pomodoro_impl(self.state)
    }

    pub fn complete_pomodoro(&self) -> Result<legacy::PomodoroStateResponse, InfraError> {
        legacy::complete_pomodoro_impl(self.state)
    }

    pub fn get_state(&self) -> Result<legacy::PomodoroStateResponse, InfraError> {
        legacy::get_pomodoro_state_impl(self.state)
    }
}
