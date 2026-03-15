use crate::application::bootstrap::bootstrap_workspace;
use crate::application::pomodoro_service::PomodoroRuntimeState;
use crate::domain::models::{Block, Task};
use crate::infrastructure::calendar_cache::InMemoryCalendarCacheRepository;
use crate::infrastructure::error::InfraError;
use crate::infrastructure::event_mapper::GoogleCalendarEvent;
use chrono::{NaiveDate, Utc};
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

#[derive(Debug, Default)]
pub(crate) struct RuntimeState {
    pub(crate) blocks: HashMap<String, StoredBlock>,
    pub(crate) tasks: HashMap<String, Task>,
    pub(crate) task_order: Vec<String>,
    pub(crate) task_assignments_by_task: HashMap<String, String>,
    pub(crate) task_assignments_by_block: HashMap<String, String>,
    pub(crate) synced_events_by_account: HashMap<String, Vec<GoogleCalendarEvent>>,
    pub(crate) blocks_calendar_ids: HashMap<String, String>,
    pub(crate) pomodoro: PomodoroRuntimeState,
}

#[derive(Debug, Clone)]
pub(crate) struct StoredBlock {
    pub(crate) block: Block,
    pub(crate) calendar_event_id: Option<String>,
    pub(crate) calendar_account_id: Option<String>,
}

pub struct AppState {
    config_dir: PathBuf,
    database_path: PathBuf,
    logs_dir: PathBuf,
    calendar_cache: Arc<InMemoryCalendarCacheRepository>,
    runtime: Mutex<RuntimeState>,
    log_guard: Mutex<()>,
}

impl AppState {
    pub fn new(workspace_root: PathBuf) -> Result<Self, InfraError> {
        let bootstrap = bootstrap_workspace(&workspace_root)?;

        Ok(Self {
            config_dir: bootstrap.config_dir,
            database_path: bootstrap.database_path,
            logs_dir: bootstrap.logs_dir,
            calendar_cache: Arc::new(InMemoryCalendarCacheRepository::default()),
            runtime: Mutex::new(RuntimeState::default()),
            log_guard: Mutex::new(()),
        })
    }

    pub fn config_dir(&self) -> &Path {
        &self.config_dir
    }

    pub fn database_path(&self) -> &Path {
        &self.database_path
    }

    pub(crate) fn calendar_cache(&self) -> Arc<InMemoryCalendarCacheRepository> {
        Arc::clone(&self.calendar_cache)
    }

    pub(crate) fn replace_synced_events(
        &self,
        account_id: &str,
        latest_events: Vec<GoogleCalendarEvent>,
        calendar_id: &str,
    ) -> Result<Vec<GoogleCalendarEvent>, InfraError> {
        let mut runtime = lock_runtime(self)?;
        let previous = runtime
            .synced_events_by_account
            .get(account_id)
            .cloned()
            .unwrap_or_default();
        runtime
            .synced_events_by_account
            .insert(account_id.to_string(), latest_events);
        runtime
            .blocks_calendar_ids
            .insert(account_id.to_string(), calendar_id.to_string());
        Ok(previous)
    }

    pub(crate) fn synced_events_snapshot(
        &self,
        account_id: Option<&str>,
    ) -> Result<Vec<(String, Vec<GoogleCalendarEvent>)>, InfraError> {
        let runtime = lock_runtime(self)?;
        if let Some(account_id) = account_id {
            return Ok(runtime
                .synced_events_by_account
                .get(account_id)
                .cloned()
                .map(|events| vec![(account_id.to_string(), events)])
                .unwrap_or_default());
        }
        Ok(runtime
            .synced_events_by_account
            .iter()
            .map(|(account_id, events)| (account_id.clone(), events.clone()))
            .collect())
    }

    pub fn command_error(&self, command: &str, error: &InfraError) -> String {
        self.log_error(command, &error.to_string());
        error.to_string()
    }

    pub fn log_info(&self, command: &str, message: &str) {
        self.append_log("info", command, message);
    }

    pub fn log_error(&self, command: &str, message: &str) {
        self.append_log("error", command, message);
    }

    fn append_log(&self, level: &str, command: &str, message: &str) {
        let Ok(_guard) = self.log_guard.lock() else {
            return;
        };
        let path = self.logs_dir.join("commands.log");
        let payload = serde_json::json!({
            "timestamp": Utc::now().to_rfc3339(),
            "level": level,
            "command": command,
            "message": message,
        });

        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{}", payload);
        }
    }
}

pub(crate) fn lock_runtime(state: &AppState) -> Result<MutexGuard<'_, RuntimeState>, InfraError> {
    state
        .runtime
        .lock()
        .map_err(|error| InfraError::InvalidConfig(format!("runtime lock poisoned: {error}")))
}

pub(crate) fn block_runtime_snapshot(
    state: &AppState,
    date: NaiveDate,
) -> Result<
    (
        Vec<StoredBlock>,
        HashMap<String, Vec<GoogleCalendarEvent>>,
        HashMap<String, String>,
    ),
    InfraError,
> {
    let runtime = lock_runtime(state)?;
    Ok((
        runtime
            .blocks
            .values()
            .filter(|stored| stored.block.date == date.to_string())
            .cloned()
            .collect(),
        runtime.synced_events_by_account.clone(),
        runtime.blocks_calendar_ids.clone(),
    ))
}

pub(crate) fn studio_runtime_snapshot(
    state: &AppState,
    date: NaiveDate,
) -> Result<
    (
        Vec<StoredBlock>,
        HashMap<String, Vec<GoogleCalendarEvent>>,
        HashMap<String, String>,
    ),
    InfraError,
> {
    block_runtime_snapshot(state, date)
}

pub(crate) fn persist_generated_blocks(
    state: &AppState,
    account_id: &str,
    blocks_calendar_ids: &HashMap<String, String>,
    created: &[StoredBlock],
) -> Result<(), InfraError> {
    let mut runtime = lock_runtime(state)?;
    if let Some(calendar_id) = blocks_calendar_ids.get(account_id).cloned() {
        runtime
            .blocks_calendar_ids
            .insert(account_id.to_string(), calendar_id);
    }
    for stored in created {
        runtime
            .blocks
            .insert(stored.block.id.clone(), stored.clone());
    }
    Ok(())
}

pub(crate) fn persist_generated_block(
    state: &AppState,
    account_id: &str,
    blocks_calendar_ids: &HashMap<String, String>,
    created: StoredBlock,
) -> Result<(), InfraError> {
    persist_generated_blocks(state, account_id, blocks_calendar_ids, std::slice::from_ref(&created))
}
