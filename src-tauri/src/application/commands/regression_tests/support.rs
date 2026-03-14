use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

pub(crate) const BLOCK_GENERATION_TARGET_MS: u128 = 30_000;

static NEXT_TEMP_WORKSPACE: AtomicUsize = AtomicUsize::new(0);

pub(crate) use crate::application::calendar_runtime::{
    collect_relocation_target_block_ids, save_suppression,
};
pub(crate) use crate::application::commands::auth::{
    load_oauth_config_from_lookup, DEFAULT_ACCOUNT_ID,
};
pub(crate) use crate::application::commands::state::{
    lock_runtime, AppState, RuntimeState, StoredBlock,
};
pub(crate) use crate::application::configured_recipes;
pub(crate) use crate::application::policy_service::load_runtime_policy;
pub(crate) use crate::application::pomodoro_session_plan;
pub(crate) use crate::application::time_slots::{intervals_overlap, Interval};
pub(crate) use crate::domain::models::{Block, TaskStatus};
pub(crate) use crate::infrastructure::error::InfraError;
pub(crate) use chrono::{DateTime, NaiveDate, Utc};

pub(crate) struct TempWorkspace {
    path: PathBuf,
}

impl TempWorkspace {
    pub(crate) fn new() -> Self {
        let sequence = NEXT_TEMP_WORKSPACE.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "pomblock-command-tests-{}-{}",
            std::process::id(),
            sequence
        ));
        fs::create_dir_all(&path).expect("create temp workspace");
        Self { path }
    }

    pub(crate) fn app_state(&self) -> AppState {
        AppState::new(self.path.clone()).expect("initialize app state")
    }
}

impl Drop for TempWorkspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}
