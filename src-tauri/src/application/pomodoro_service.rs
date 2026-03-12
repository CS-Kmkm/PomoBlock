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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::block_service::BlockService;
    use crate::application::reflection_service::ReflectionService;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_TEMP_WORKSPACE: AtomicUsize = AtomicUsize::new(0);

    struct TempWorkspace {
        path: PathBuf,
    }

    impl TempWorkspace {
        fn new() -> Self {
            let sequence = NEXT_TEMP_WORKSPACE.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "pomoblock-pomodoro-service-tests-{}-{}",
                std::process::id(),
                sequence
            ));
            fs::create_dir_all(&path).expect("create temp workspace");
            Self { path }
        }

        fn app_state(&self) -> legacy::AppState {
            legacy::AppState::new(self.path.clone()).expect("initialize app state")
        }
    }

    impl Drop for TempWorkspace {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

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
