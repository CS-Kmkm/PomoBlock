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
