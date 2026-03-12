use crate::application::commands::legacy;
use crate::domain::models::Task;
use crate::infrastructure::error::InfraError;

pub struct TaskService<'a> {
    state: &'a legacy::AppState,
}

impl<'a> TaskService<'a> {
    pub fn new(state: &'a legacy::AppState) -> Self {
        Self { state }
    }

    pub fn create_task(
        &self,
        title: String,
        description: Option<String>,
        estimated_pomodoros: Option<u32>,
    ) -> Result<Task, InfraError> {
        legacy::create_task_impl(self.state, title, description, estimated_pomodoros)
    }

    pub fn list_tasks(&self) -> Result<Vec<Task>, InfraError> {
        legacy::list_tasks_impl(self.state)
    }

    pub fn update_task(
        &self,
        task_id: String,
        title: Option<String>,
        description: Option<String>,
        estimated_pomodoros: Option<u32>,
        status: Option<String>,
    ) -> Result<Task, InfraError> {
        legacy::update_task_impl(
            self.state,
            task_id,
            title,
            description,
            estimated_pomodoros,
            status,
        )
    }

    pub fn delete_task(&self, task_id: String) -> Result<bool, InfraError> {
        legacy::delete_task_impl(self.state, task_id)
    }

    pub fn split_task(&self, task_id: String, parts: u32) -> Result<Vec<Task>, InfraError> {
        legacy::split_task_impl(self.state, task_id, parts)
    }

    pub fn carry_over_task(
        &self,
        task_id: String,
        from_block_id: String,
        candidate_block_ids: Option<Vec<String>>,
    ) -> Result<legacy::CarryOverTaskResponse, InfraError> {
        legacy::carry_over_task_impl(self.state, task_id, from_block_id, candidate_block_ids)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::block_service::BlockService;
    use crate::application::pomodoro_service::PomodoroService;
    use crate::domain::models::TaskStatus;
    use crate::infrastructure::local_repository::LocalRepository;
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
                "pomoblock-task-service-tests-{}-{}",
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
    async fn property_19_20_task_assignment_links_task_to_block_and_records_history_audit() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let task_service = TaskService::new(&state);
        let block_service = BlockService::new(&state);
        let pomodoro_service = PomodoroService::new(&state);

        let task = task_service
            .create_task("Assignment task".to_string(), Some("audit".to_string()), Some(2))
            .expect("create task");
        let blocks = block_service
            .generate_blocks("2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");
        let started = pomodoro_service
            .start_pomodoro(blocks[0].id.clone(), Some(task.id.clone()))
            .expect("start pomodoro with task");
        let repository = LocalRepository::new(state.database_path()).expect("open local repository");
        let audit_logs = repository.load_audit_logs(100).expect("load audit logs");

        assert_eq!(started.current_task_id.as_deref(), Some(task.id.as_str()));
        assert_eq!(
            legacy::assigned_task_for_block_for_tests(&state, &blocks[0].id)
                .expect("assignment lookup")
                .as_deref(),
            Some(task.id.as_str())
        );
        assert!(audit_logs.iter().any(|row| {
            row.event_type == "task_selected"
                && row.payload.get("taskId").and_then(serde_json::Value::as_str)
                    == Some(task.id.as_str())
                && row.payload.get("blockId").and_then(serde_json::Value::as_str)
                    == Some(blocks[0].id.as_str())
        }));
    }

    #[tokio::test]
    async fn property_24_26_carry_over_relinks_task_and_records_history() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let task_service = TaskService::new(&state);
        let block_service = BlockService::new(&state);
        let pomodoro_service = PomodoroService::new(&state);

        let task = task_service
            .create_task("Carry task".to_string(), None, Some(3))
            .expect("create task");
        let mut blocks = block_service
            .generate_blocks("2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");
        blocks.sort_by(|left, right| left.start_at.cmp(&right.start_at));

        let _ = pomodoro_service
            .start_pomodoro(blocks[0].id.clone(), Some(task.id.clone()))
            .expect("start pomodoro with task");
        let result = task_service
            .carry_over_task(
                task.id.clone(),
                blocks[0].id.clone(),
                Some(vec![blocks[1].id.clone()]),
            )
            .expect("carry over task");
        let repository = LocalRepository::new(state.database_path()).expect("open local repository");
        let audit_logs = repository.load_audit_logs(100).expect("load audit logs");

        assert_eq!(result.to_block_id, blocks[1].id);
        assert_eq!(result.status, "in_progress");
        assert_eq!(
            legacy::assigned_task_for_block_for_tests(&state, &blocks[1].id)
                .expect("assignment lookup")
                .as_deref(),
            Some(task.id.as_str())
        );
        assert!(audit_logs.iter().any(|row| {
            row.event_type == "task_carried_over"
                && row.payload.get("taskId").and_then(serde_json::Value::as_str)
                    == Some(task.id.as_str())
        }));
    }

    #[test]
    fn property_25_26_split_creates_children_and_records_history() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let task_service = TaskService::new(&state);

        let parent = task_service
            .create_task("Large task".to_string(), Some("split".to_string()), Some(8))
            .expect("create task");
        let children = task_service
            .split_task(parent.id.clone(), 4)
            .expect("split task");
        let listed = task_service.list_tasks().expect("list tasks");
        let repository = LocalRepository::new(state.database_path()).expect("open local repository");
        let audit_logs = repository.load_audit_logs(100).expect("load audit logs");

        assert_eq!(children.len(), 4);
        assert!(children
            .iter()
            .all(|child| child.title.starts_with("Large task (")));
        let refreshed_parent = listed
            .iter()
            .find(|task| task.id == parent.id)
            .expect("parent task");
        assert_eq!(refreshed_parent.status, TaskStatus::Deferred);
        assert!(audit_logs.iter().any(|row| {
            row.event_type == "task_split"
                && row.payload.get("taskId").and_then(serde_json::Value::as_str)
                    == Some(parent.id.as_str())
        }));
    }
}
