CREATE TABLE IF NOT EXISTS blocks (
    id TEXT PRIMARY KEY,
    instance TEXT NOT NULL,
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    type TEXT NOT NULL,
    firmness TEXT NOT NULL,
    planned_pomodoros INTEGER NOT NULL,
    status TEXT NOT NULL,
    source TEXT NOT NULL,
    source_id TEXT,
    task_refs TEXT NOT NULL DEFAULT '[]',
    calendar_event_id TEXT,
    task_id TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blocks_date ON blocks(date);
CREATE INDEX IF NOT EXISTS idx_blocks_instance ON blocks(instance);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    estimated_pomodoros INTEGER,
    completed_pomodoros INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pomodoro_logs (
    id TEXT PRIMARY KEY,
    block_id TEXT NOT NULL,
    task_id TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT,
    phase TEXT NOT NULL,
    interruption_reason TEXT,
    FOREIGN KEY (block_id) REFERENCES blocks(id),
    FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS sync_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    sync_token TEXT,
    last_sync_time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suppressions (
    instance TEXT PRIMARY KEY,
    suppressed_at TEXT NOT NULL,
    reason TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
