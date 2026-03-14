use crate::application::commands::state::AppState;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

static NEXT_TEMP_WORKSPACE: AtomicUsize = AtomicUsize::new(0);

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
