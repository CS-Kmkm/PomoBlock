use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

static NEXT_TEMP_CONFIG_DIR: AtomicUsize = AtomicUsize::new(0);

pub(crate) struct TempConfigDir {
    path: PathBuf,
}

impl TempConfigDir {
    pub(crate) fn new(prefix: &str, label: &str) -> Self {
        let sequence = NEXT_TEMP_CONFIG_DIR.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "pomoblock-{prefix}-{label}-{}-{}",
            std::process::id(),
            sequence
        ));
        fs::create_dir_all(&path).expect("create temp config dir");
        Self { path }
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn join(&self, child: &str) -> PathBuf {
        self.path.join(child)
    }
}

impl Drop for TempConfigDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

pub(crate) fn write_json(path: &Path, value: serde_json::Value) {
    fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
    fs::write(path, format!("{}\n", serde_json::to_string_pretty(&value).expect("json")))
        .expect("write json");
}
