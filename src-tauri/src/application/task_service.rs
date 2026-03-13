use crate::application::commands::legacy;
use crate::domain::models::Task;
use crate::infrastructure::error::InfraError;
use chrono::Utc;
use std::collections::HashSet;

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
        let title = title.trim();
        if title.is_empty() {
            return Err(InfraError::InvalidConfig(
                "title must not be empty".to_string(),
            ));
        }

        let task = Task {
            id: legacy::next_id("tsk"),
            title: title.to_string(),
            description: description
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned),
            estimated_pomodoros,
            completed_pomodoros: 0,
            status: crate::domain::models::TaskStatus::Pending,
            created_at: Utc::now(),
        };

        {
            let mut runtime = legacy::lock_runtime(self.state)?;
            runtime.task_order.push(task.id.clone());
            runtime.tasks.insert(task.id.clone(), task.clone());
        }

        self.state
            .log_info("create_task", &format!("created task_id={}", task.id));
        Ok(task)
    }

    pub fn list_tasks(&self) -> Result<Vec<Task>, InfraError> {
        let runtime = legacy::lock_runtime(self.state)?;
        let mut tasks = runtime
            .task_order
            .iter()
            .filter_map(|task_id| runtime.tasks.get(task_id).cloned())
            .collect::<Vec<_>>();
        tasks.sort_by(|left, right| left.created_at.cmp(&right.created_at));
        Ok(tasks)
    }

    pub fn update_task(
        &self,
        task_id: String,
        title: Option<String>,
        description: Option<String>,
        estimated_pomodoros: Option<u32>,
        status: Option<String>,
    ) -> Result<Task, InfraError> {
        let task_id = task_id.trim();
        if task_id.is_empty() {
            return Err(InfraError::InvalidConfig(
                "task_id must not be empty".to_string(),
            ));
        }

        let mut runtime = legacy::lock_runtime(self.state)?;
        let Some(task) = runtime.tasks.get_mut(task_id) else {
            return Err(InfraError::InvalidConfig(format!("task not found: {}", task_id)));
        };

        if let Some(title) = title {
            let title = title.trim();
            if title.is_empty() {
                return Err(InfraError::InvalidConfig(
                    "title must not be empty".to_string(),
                ));
            }
            task.title = title.to_string();
        }

        if let Some(description) = description {
            let description = description.trim();
            task.description = if description.is_empty() {
                None
            } else {
                Some(description.to_string())
            };
        }

        if let Some(estimated) = estimated_pomodoros {
            task.estimated_pomodoros = Some(estimated);
        }

        if let Some(status) = status {
            task.status = legacy::parse_task_status(&status)?;
        }

        let updated = task.clone();
        drop(runtime);
        self.state
            .log_info("update_task", &format!("updated task_id={task_id}"));
        Ok(updated)
    }

    pub fn delete_task(&self, task_id: String) -> Result<bool, InfraError> {
        let task_id = task_id.trim();
        if task_id.is_empty() {
            return Err(InfraError::InvalidConfig(
                "task_id must not be empty".to_string(),
            ));
        }

        let mut runtime = legacy::lock_runtime(self.state)?;
        let removed = runtime.tasks.remove(task_id).is_some();
        if !removed {
            return Ok(false);
        }
        runtime.task_order.retain(|candidate| candidate != task_id);
        legacy::unassign_task(&mut runtime, task_id);
        if runtime.pomodoro.current_task_id.as_deref() == Some(task_id) {
            runtime.pomodoro.current_task_id = None;
        }

        self.state
            .log_info("delete_task", &format!("deleted task_id={task_id}"));
        Ok(true)
    }

    pub fn split_task(&self, task_id: String, parts: u32) -> Result<Vec<Task>, InfraError> {
        let task_id = task_id.trim();
        if task_id.is_empty() {
            return Err(InfraError::InvalidConfig(
                "task_id must not be empty".to_string(),
            ));
        }
        if parts < 2 {
            return Err(InfraError::InvalidConfig("parts must be >= 2".to_string()));
        }

        let mut runtime = legacy::lock_runtime(self.state)?;
        let Some(parent) = runtime.tasks.get_mut(task_id) else {
            return Err(InfraError::InvalidConfig(format!("task not found: {}", task_id)));
        };
        let parent_title = parent.title.clone();
        let parent_description = parent.description.clone();
        let child_estimated_pomodoros = parent
            .estimated_pomodoros
            .map(|value| value.div_ceil(parts).max(1));
        parent.status = crate::domain::models::TaskStatus::Deferred;

        if runtime.pomodoro.current_task_id.as_deref() == Some(task_id) {
            runtime.pomodoro.current_task_id = None;
        }
        legacy::unassign_task(&mut runtime, task_id);

        let mut children = Vec::new();
        let now = Utc::now();
        for index in 1..=parts {
            let child = Task {
                id: legacy::next_id("tsk"),
                title: format!("{parent_title} ({index}/{parts})"),
                description: parent_description.clone(),
                estimated_pomodoros: child_estimated_pomodoros,
                completed_pomodoros: 0,
                status: crate::domain::models::TaskStatus::Pending,
                created_at: now,
            };
            runtime.task_order.push(child.id.clone());
            runtime.tasks.insert(child.id.clone(), child.clone());
            children.push(child);
        }

        drop(runtime);
        legacy::append_audit_log(
            self.state.database_path(),
            "task_split",
            &serde_json::json!({
                "taskId": task_id,
                "childTaskIds": children.iter().map(|child| child.id.clone()).collect::<Vec<_>>(),
            }),
        )?;
        self.state.log_info(
            "split_task",
            &format!("split task_id={task_id} into {} children", children.len()),
        );
        Ok(children)
    }

    pub fn carry_over_task(
        &self,
        task_id: String,
        from_block_id: String,
        candidate_block_ids: Option<Vec<String>>,
    ) -> Result<legacy::CarryOverTaskResponse, InfraError> {
        let task_id = task_id.trim();
        if task_id.is_empty() {
            return Err(InfraError::InvalidConfig(
                "task_id must not be empty".to_string(),
            ));
        }
        let from_block_id = from_block_id.trim();
        if from_block_id.is_empty() {
            return Err(InfraError::InvalidConfig(
                "from_block_id must not be empty".to_string(),
            ));
        }

        let normalized_candidates = candidate_block_ids
            .unwrap_or_default()
            .into_iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect::<HashSet<_>>();

        let mut runtime = legacy::lock_runtime(self.state)?;
        if !runtime.tasks.contains_key(task_id) {
            return Err(InfraError::InvalidConfig(format!("task not found: {}", task_id)));
        }
        let Some(from_block) = runtime.blocks.get(from_block_id).map(|stored| stored.block.clone()) else {
            return Err(InfraError::InvalidConfig(format!(
                "block not found: {}",
                from_block_id
            )));
        };

        let mut candidates = runtime
            .blocks
            .values()
            .map(|stored| stored.block.clone())
            .filter(|block| block.id != from_block.id)
            .filter(|block| block.date == from_block.date)
            .filter(|block| block.start_at >= from_block.end_at)
            .filter(|block| {
                normalized_candidates.is_empty() || normalized_candidates.contains(block.id.as_str())
            })
            .collect::<Vec<_>>();
        candidates.sort_by(|left, right| left.start_at.cmp(&right.start_at));

        let next_block = candidates
            .into_iter()
            .find(|block| !runtime.task_assignments_by_block.contains_key(block.id.as_str()))
            .ok_or_else(|| InfraError::InvalidConfig("no available block for carry-over".to_string()))?;

        legacy::assign_task_to_block(&mut runtime, task_id, next_block.id.as_str());
        if let Some(task) = runtime.tasks.get_mut(task_id) {
            task.status = crate::domain::models::TaskStatus::InProgress;
        }

        let status = runtime
            .tasks
            .get(task_id)
            .map(|task| legacy::task_status_as_str(&task.status).to_string())
            .unwrap_or_else(|| "in_progress".to_string());
        let response = legacy::CarryOverTaskResponse {
            task_id: task_id.to_string(),
            from_block_id: from_block_id.to_string(),
            to_block_id: next_block.id,
            status,
        };

        drop(runtime);
        legacy::append_audit_log(
            self.state.database_path(),
            "task_carried_over",
            &serde_json::json!({
                "taskId": response.task_id,
                "fromBlockId": response.from_block_id,
                "toBlockId": response.to_block_id,
            }),
        )?;
        self.state.log_info(
            "carry_over_task",
            &format!(
                "carried task_id={} from_block_id={} to_block_id={}",
                response.task_id, response.from_block_id, response.to_block_id
            ),
        );
        Ok(response)
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
