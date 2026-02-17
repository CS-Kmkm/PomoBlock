use crate::application::bootstrap::bootstrap_workspace;
use crate::application::calendar_setup::{BlocksCalendarInitializer, EnsureBlocksCalendarResult};
use crate::application::calendar_sync::CalendarSyncService;
use crate::application::oauth::{EnsureTokenResult, OAuthConfig, OAuthManager};
use crate::domain::models::{
    Block, BlockType, Firmness, PomodoroLog, PomodoroPhase, Task, TaskStatus,
};
use crate::infrastructure::calendar_cache::InMemoryCalendarCacheRepository;
use crate::infrastructure::config::ensure_default_configs;
use crate::infrastructure::credential_store::WindowsCredentialManagerStore;
use crate::infrastructure::error::InfraError;
use crate::infrastructure::event_mapper::{encode_block_event, GoogleCalendarEvent};
use crate::infrastructure::google_calendar_client::ReqwestGoogleCalendarClient;
use crate::infrastructure::oauth_client::ReqwestOAuthClient;
use crate::infrastructure::storage::initialize_database;
use crate::infrastructure::sync_state_repository::SqliteSyncStateRepository;
use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveTime, TimeZone, Utc, Weekday};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Instant;
use tokio::task::JoinSet;

const DEFAULT_REDIRECT_URI: &str = "http://127.0.0.1:8080/oauth2/callback";
const DEFAULT_SCOPE: &str = "https://www.googleapis.com/auth/calendar";
const POMODORO_FOCUS_SECONDS: u32 = 25 * 60;
const POMODORO_BREAK_SECONDS: u32 = 5 * 60;
const BLOCK_CREATION_CONCURRENCY: usize = 4;
const BLOCK_GENERATION_TARGET_MS: u128 = 30_000;

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn next_id(prefix: &str) -> String {
    let sequence = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{}-{sequence}", Utc::now().timestamp_micros())
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
        let config_dir = workspace_root.join("config");
        let logs_dir = workspace_root.join("logs");

        ensure_default_configs(&config_dir)?;
        initialize_database(&bootstrap.database_path)?;

        Ok(Self {
            config_dir,
            database_path: bootstrap.database_path,
            logs_dir,
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

#[derive(Debug, Default)]
struct RuntimeState {
    blocks: HashMap<String, StoredBlock>,
    tasks: HashMap<String, Task>,
    task_order: Vec<String>,
    synced_events: Vec<GoogleCalendarEvent>,
    blocks_calendar_id: Option<String>,
    pomodoro: PomodoroRuntimeState,
}

#[derive(Debug, Clone)]
struct StoredBlock {
    block: Block,
    calendar_event_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PomodoroRuntimePhase {
    Idle,
    Focus,
    Break,
    Paused,
}

impl PomodoroRuntimePhase {
    fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Focus => "focus",
            Self::Break => "break",
            Self::Paused => "paused",
        }
    }
}

#[derive(Debug, Clone)]
struct PomodoroRuntimeState {
    current_block_id: Option<String>,
    current_task_id: Option<String>,
    phase: PomodoroRuntimePhase,
    paused_phase: Option<PomodoroRuntimePhase>,
    remaining_seconds: u32,
    start_time: Option<DateTime<Utc>>,
    active_log: Option<PomodoroLog>,
    completed_logs: Vec<PomodoroLog>,
}

impl Default for PomodoroRuntimeState {
    fn default() -> Self {
        Self {
            current_block_id: None,
            current_task_id: None,
            phase: PomodoroRuntimePhase::Idle,
            paused_phase: None,
            remaining_seconds: 0,
            start_time: None,
            active_log: None,
            completed_logs: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AuthenticateGoogleResponse {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authorization_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncCalendarResponse {
    pub added: usize,
    pub updated: usize,
    pub deleted: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_sync_token: Option<String>,
    pub calendar_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PomodoroStateResponse {
    pub current_block_id: Option<String>,
    pub current_task_id: Option<String>,
    pub phase: String,
    pub remaining_seconds: u32,
    pub start_time: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReflectionLogItem {
    pub id: String,
    pub block_id: String,
    pub task_id: Option<String>,
    pub phase: String,
    pub start_time: String,
    pub end_time: Option<String>,
    pub interruption_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReflectionSummaryResponse {
    pub start: String,
    pub end: String,
    pub completed_count: u32,
    pub interrupted_count: u32,
    pub total_focus_minutes: i64,
    pub logs: Vec<ReflectionLogItem>,
}

#[derive(Debug, Clone)]
struct RuntimePolicy {
    work_start: NaiveTime,
    work_end: NaiveTime,
    work_days: HashSet<Weekday>,
    block_duration_minutes: u32,
    min_block_gap_minutes: u32,
}

impl Default for RuntimePolicy {
    fn default() -> Self {
        Self {
            work_start: NaiveTime::from_hms_opt(9, 0, 0).expect("valid fixed time"),
            work_end: NaiveTime::from_hms_opt(18, 0, 0).expect("valid fixed time"),
            work_days: HashSet::from([
                Weekday::Mon,
                Weekday::Tue,
                Weekday::Wed,
                Weekday::Thu,
                Weekday::Fri,
            ]),
            block_duration_minutes: 50,
            min_block_gap_minutes: 5,
        }
    }
}

#[derive(Debug, Clone)]
struct Interval {
    start: DateTime<Utc>,
    end: DateTime<Utc>,
}

pub async fn authenticate_google_impl(
    state: &AppState,
    authorization_code: Option<String>,
) -> Result<AuthenticateGoogleResponse, InfraError> {
    let oauth_config = load_oauth_config_from_env()?;
    let manager = oauth_manager(oauth_config);

    if let Some(raw_code) = authorization_code {
        let code = raw_code.trim();
        if code.is_empty() {
            return Err(InfraError::InvalidConfig(
                "authorization_code must not be empty".to_string(),
            ));
        }
        let token = manager.authenticate_with_code(code).await?;
        state.log_info(
            "authenticate_google",
            "exchanged authorization code and stored oauth token",
        );
        return Ok(AuthenticateGoogleResponse {
            status: "authenticated".to_string(),
            authorization_url: None,
            expires_at: Some(token.expires_at.to_rfc3339()),
        });
    }

    match manager.ensure_access_token().await? {
        EnsureTokenResult::Existing(token) => Ok(AuthenticateGoogleResponse {
            status: "existing".to_string(),
            authorization_url: None,
            expires_at: Some(token.expires_at.to_rfc3339()),
        }),
        EnsureTokenResult::Refreshed(token) => Ok(AuthenticateGoogleResponse {
            status: "refreshed".to_string(),
            authorization_url: None,
            expires_at: Some(token.expires_at.to_rfc3339()),
        }),
        EnsureTokenResult::ReauthenticationRequired => {
            let auth_state = next_id("oauth-state");
            let authorization_url = manager.build_authorization_url(&auth_state)?;
            Ok(AuthenticateGoogleResponse {
                status: "reauthentication_required".to_string(),
                authorization_url: Some(authorization_url),
                expires_at: None,
            })
        }
    }
}

pub async fn sync_calendar_impl(
    state: &AppState,
    time_min: Option<String>,
    time_max: Option<String>,
) -> Result<SyncCalendarResponse, InfraError> {
    let access_token = required_access_token().await?;
    let (window_start, window_end) = resolve_sync_window(time_min, time_max)?;
    let calendar_client = Arc::new(ReqwestGoogleCalendarClient::new());
    let calendar_id =
        ensure_blocks_calendar_id(state.config_dir(), &access_token, Arc::clone(&calendar_client))
            .await?;

    let sync_state_repo = Arc::new(SqliteSyncStateRepository::new(state.database_path()));
    let sync_service = CalendarSyncService::new(
        Arc::clone(&calendar_client),
        sync_state_repo,
        Arc::clone(&state.calendar_cache),
    );
    let sync_result = sync_service
        .sync(&access_token, &calendar_id, window_start, window_end)
        .await?;
    let latest_events = sync_service
        .fetch_events(&access_token, &calendar_id, window_start, window_end)
        .await?;

    {
        let mut runtime = lock_runtime(state)?;
        runtime.synced_events = latest_events;
        runtime.blocks_calendar_id = Some(calendar_id.clone());
    }

    state.log_info(
        "sync_calendar",
        &format!(
            "synchronized calendar_id={calendar_id} added={} updated={} deleted={}",
            sync_result.added.len(),
            sync_result.updated.len(),
            sync_result.deleted.len()
        ),
    );

    Ok(SyncCalendarResponse {
        added: sync_result.added.len(),
        updated: sync_result.updated.len(),
        deleted: sync_result.deleted.len(),
        next_sync_token: sync_result.next_sync_token,
        calendar_id,
    })
}

pub async fn generate_blocks_impl(state: &AppState, date: String) -> Result<Vec<Block>, InfraError> {
    let started_at = Instant::now();
    let date = NaiveDate::parse_from_str(date.trim(), "%Y-%m-%d")
        .map_err(|error| InfraError::InvalidConfig(format!("date must be YYYY-MM-DD: {error}")))?;
    let policy = load_runtime_policy(state.config_dir());
    if !policy.work_days.contains(&date.weekday()) {
        return Ok(Vec::new());
    }
    if policy.work_end <= policy.work_start {
        return Ok(Vec::new());
    }

    let window_start = Utc.from_utc_datetime(&date.and_time(policy.work_start));
    let window_end = Utc.from_utc_datetime(&date.and_time(policy.work_end));
    let block_duration = Duration::minutes(policy.block_duration_minutes as i64);
    let gap = Duration::minutes(policy.min_block_gap_minutes as i64);

    let (existing_blocks, synced_events, mut blocks_calendar_id) = {
        let runtime = lock_runtime(state)?;
        (
            runtime
                .blocks
                .values()
                .filter(|stored| stored.block.date == date.to_string())
                .cloned()
                .collect::<Vec<_>>(),
            runtime.synced_events.clone(),
            runtime.blocks_calendar_id.clone(),
        )
    };

    let mut busy_intervals = Vec::new();
    for event in &synced_events {
        if let Some(interval) = event_to_interval(event)
            .and_then(|interval| clip_interval(interval, window_start, window_end))
        {
            busy_intervals.push(interval);
        }
    }
    for stored in &existing_blocks {
        busy_intervals.push(Interval {
            start: stored.block.start_at,
            end: stored.block.end_at,
        });
    }
    let busy_intervals = merge_intervals(busy_intervals);
    let free_slots = free_slots(window_start, window_end, &busy_intervals);

    let mut existing_instances = existing_blocks
        .iter()
        .map(|stored| stored.block.instance.clone())
        .collect::<HashSet<_>>();
    let mut existing_ranges = existing_blocks
        .iter()
        .map(|stored| {
            (
                stored.block.start_at.timestamp_millis(),
                stored.block.end_at.timestamp_millis(),
            )
        })
        .collect::<HashSet<_>>();
    let mut generated = Vec::new();
    let mut instance_index: u32 = 0;

    for slot in free_slots {
        let mut cursor = slot.start;
        while cursor + block_duration <= slot.end {
            let candidate_end = cursor + block_duration;
            let instance = format!("rtn:auto:{}:{}", date, instance_index);
            let range_key = (cursor.timestamp_millis(), candidate_end.timestamp_millis());

            if existing_instances.insert(instance.clone()) && existing_ranges.insert(range_key) {
                let block = Block {
                    id: next_id("blk"),
                    instance,
                    date: date.to_string(),
                    start_at: cursor,
                    end_at: candidate_end,
                    block_type: BlockType::Deep,
                    firmness: Firmness::Draft,
                    planned_pomodoros: planned_pomodoros(policy.block_duration_minutes),
                    source: "routine".to_string(),
                    source_id: Some("auto".to_string()),
                };
                generated.push(StoredBlock {
                    block,
                    calendar_event_id: None,
                });
            }

            instance_index = instance_index.saturating_add(1);
            cursor = candidate_end + gap;
        }
    }

    if generated.is_empty() {
        return Ok(Vec::new());
    }

    let access_token = try_access_token().await?;
    if blocks_calendar_id.is_none() {
        if let Some(token) = access_token.as_deref() {
            let calendar_client = Arc::new(ReqwestGoogleCalendarClient::new());
            let resolved = ensure_blocks_calendar_id(
                state.config_dir(),
                token,
                Arc::clone(&calendar_client),
            )
            .await?;
            blocks_calendar_id = Some(resolved.clone());
            let mut runtime = lock_runtime(state)?;
            runtime.blocks_calendar_id = Some(resolved);
        }
    }

    if let (Some(token), Some(calendar_id)) = (access_token.as_deref(), blocks_calendar_id.as_deref())
    {
        let calendar_client = Arc::new(ReqwestGoogleCalendarClient::new());
        let sync_state_repo = Arc::new(SqliteSyncStateRepository::new(state.database_path()));
        let sync_service = Arc::new(CalendarSyncService::new(
            Arc::clone(&calendar_client),
            sync_state_repo,
            Arc::clone(&state.calendar_cache),
        ));
        create_calendar_events_for_generated_blocks(sync_service, token, calendar_id, &mut generated)
            .await?;
    }

    {
        let mut runtime = lock_runtime(state)?;
        if let Some(calendar_id) = blocks_calendar_id {
            runtime.blocks_calendar_id = Some(calendar_id);
        }
        for stored in &generated {
            runtime
                .blocks
                .insert(stored.block.id.clone(), stored.clone());
        }
    }

    let elapsed_ms = started_at.elapsed().as_millis();
    state.log_info(
        "generate_blocks",
        &format!(
            "generated {} blocks for {} in {}ms",
            generated.len(),
            date,
            elapsed_ms
        ),
    );
    if elapsed_ms > BLOCK_GENERATION_TARGET_MS {
        state.log_error(
            "generate_blocks",
            &format!(
                "generation for {} exceeded target {}ms (actual={}ms)",
                date, BLOCK_GENERATION_TARGET_MS, elapsed_ms
            ),
        );
    }

    Ok(generated.into_iter().map(|stored| stored.block).collect())
}

pub async fn approve_blocks_impl(
    state: &AppState,
    block_ids: Vec<String>,
) -> Result<Vec<Block>, InfraError> {
    if block_ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut approved_blocks = Vec::new();
    let mut calendar_updates = Vec::new();
    {
        let mut runtime = lock_runtime(state)?;
        for raw_id in block_ids {
            let block_id = raw_id.trim();
            if block_id.is_empty() {
                continue;
            }
            let Some(stored) = runtime.blocks.get_mut(block_id) else {
                continue;
            };
            stored.block.firmness = Firmness::Soft;
            approved_blocks.push(stored.block.clone());
            if let Some(calendar_event_id) = stored.calendar_event_id.clone() {
                calendar_updates.push((calendar_event_id, stored.block.clone()));
            }
        }
    }

    if !calendar_updates.is_empty() {
        let access_token = try_access_token().await?;
        let calendar_id = {
            let runtime = lock_runtime(state)?;
            runtime.blocks_calendar_id.clone()
        };
        if let (Some(token), Some(calendar_id)) = (access_token.as_deref(), calendar_id.as_deref()) {
            let calendar_client = Arc::new(ReqwestGoogleCalendarClient::new());
            let sync_state_repo = Arc::new(SqliteSyncStateRepository::new(state.database_path()));
            let sync_service = CalendarSyncService::new(
                Arc::clone(&calendar_client),
                sync_state_repo,
                Arc::clone(&state.calendar_cache),
            );
            for (event_id, block) in &calendar_updates {
                let event = encode_block_event(block);
                sync_service
                    .update_event(token, calendar_id, event_id, &event)
                    .await?;
            }
        }
    }

    state.log_info(
        "approve_blocks",
        &format!("approved {} blocks", approved_blocks.len()),
    );

    Ok(approved_blocks)
}

pub async fn delete_block_impl(state: &AppState, block_id: String) -> Result<bool, InfraError> {
    let block_id = block_id.trim();
    if block_id.is_empty() {
        return Err(InfraError::InvalidConfig(
            "block_id must not be empty".to_string(),
        ));
    }

    let removed = {
        let mut runtime = lock_runtime(state)?;
        runtime.blocks.remove(block_id)
    };
    let Some(removed) = removed else {
        return Ok(false);
    };

    if let Some(calendar_event_id) = removed.calendar_event_id {
        let access_token = try_access_token().await?;
        let calendar_id = {
            let runtime = lock_runtime(state)?;
            runtime.blocks_calendar_id.clone()
        };

        if let (Some(token), Some(calendar_id)) = (access_token.as_deref(), calendar_id.as_deref())
        {
            let calendar_client = Arc::new(ReqwestGoogleCalendarClient::new());
            let sync_state_repo = Arc::new(SqliteSyncStateRepository::new(state.database_path()));
            let sync_service = CalendarSyncService::new(
                Arc::clone(&calendar_client),
                sync_state_repo,
                Arc::clone(&state.calendar_cache),
            );
            sync_service
                .delete_event(token, calendar_id, &calendar_event_id)
                .await?;
        }
    }

    state.log_info("delete_block", &format!("deleted block_id={block_id}"));
    Ok(true)
}

pub async fn adjust_block_time_impl(
    state: &AppState,
    block_id: String,
    start_at: String,
    end_at: String,
) -> Result<Block, InfraError> {
    let block_id = block_id.trim();
    if block_id.is_empty() {
        return Err(InfraError::InvalidConfig(
            "block_id must not be empty".to_string(),
        ));
    }
    let start = parse_rfc3339_input(&start_at, "start_at")?;
    let end = parse_rfc3339_input(&end_at, "end_at")?;
    if end <= start {
        return Err(InfraError::InvalidConfig(
            "end_at must be after start_at".to_string(),
        ));
    }

    let (updated_block, calendar_event_id) = {
        let mut runtime = lock_runtime(state)?;
        let Some(stored) = runtime.blocks.get_mut(block_id) else {
            return Err(InfraError::InvalidConfig(format!(
                "block not found: {}",
                block_id
            )));
        };
        stored.block.start_at = start;
        stored.block.end_at = end;
        (stored.block.clone(), stored.calendar_event_id.clone())
    };

    if let Some(calendar_event_id) = calendar_event_id {
        let access_token = try_access_token().await?;
        let calendar_id = {
            let runtime = lock_runtime(state)?;
            runtime.blocks_calendar_id.clone()
        };
        if let (Some(token), Some(calendar_id)) = (access_token.as_deref(), calendar_id.as_deref())
        {
            let calendar_client = Arc::new(ReqwestGoogleCalendarClient::new());
            let sync_state_repo = Arc::new(SqliteSyncStateRepository::new(state.database_path()));
            let sync_service = CalendarSyncService::new(
                Arc::clone(&calendar_client),
                sync_state_repo,
                Arc::clone(&state.calendar_cache),
            );
            let event = encode_block_event(&updated_block);
            sync_service
                .update_event(token, calendar_id, &calendar_event_id, &event)
                .await?;
        }
    }

    state.log_info(
        "adjust_block_time",
        &format!("adjusted block_id={block_id} start={} end={}", start, end),
    );
    Ok(updated_block)
}

pub fn list_blocks_impl(state: &AppState, date: Option<String>) -> Result<Vec<Block>, InfraError> {
    let normalized_date = date
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    let runtime = lock_runtime(state)?;
    let mut blocks = runtime
        .blocks
        .values()
        .map(|stored| stored.block.clone())
        .filter(|block| {
            normalized_date
                .as_deref()
                .map(|date| block.date == date)
                .unwrap_or(true)
        })
        .collect::<Vec<_>>();
    blocks.sort_by(|left, right| left.start_at.cmp(&right.start_at));
    Ok(blocks)
}

pub fn create_task_impl(
    state: &AppState,
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
        id: next_id("tsk"),
        title: title.to_string(),
        description: description
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned),
        estimated_pomodoros,
        completed_pomodoros: 0,
        status: TaskStatus::Pending,
        created_at: Utc::now(),
    };

    {
        let mut runtime = lock_runtime(state)?;
        runtime.task_order.push(task.id.clone());
        runtime.tasks.insert(task.id.clone(), task.clone());
    }

    state.log_info("create_task", &format!("created task_id={}", task.id));
    Ok(task)
}

pub fn list_tasks_impl(state: &AppState) -> Result<Vec<Task>, InfraError> {
    let runtime = lock_runtime(state)?;
    let mut tasks = runtime
        .task_order
        .iter()
        .filter_map(|task_id| runtime.tasks.get(task_id).cloned())
        .collect::<Vec<_>>();
    tasks.sort_by(|left, right| left.created_at.cmp(&right.created_at));
    Ok(tasks)
}

pub fn update_task_impl(
    state: &AppState,
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

    let mut runtime = lock_runtime(state)?;
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
        task.status = parse_task_status(&status)?;
    }

    let updated = task.clone();
    drop(runtime);
    state.log_info("update_task", &format!("updated task_id={task_id}"));
    Ok(updated)
}

pub fn delete_task_impl(state: &AppState, task_id: String) -> Result<bool, InfraError> {
    let task_id = task_id.trim();
    if task_id.is_empty() {
        return Err(InfraError::InvalidConfig(
            "task_id must not be empty".to_string(),
        ));
    }

    let mut runtime = lock_runtime(state)?;
    let removed = runtime.tasks.remove(task_id).is_some();
    if !removed {
        return Ok(false);
    }
    runtime.task_order.retain(|candidate| candidate != task_id);
    if runtime.pomodoro.current_task_id.as_deref() == Some(task_id) {
        runtime.pomodoro.current_task_id = None;
    }

    state.log_info("delete_task", &format!("deleted task_id={task_id}"));
    Ok(true)
}

pub fn start_pomodoro_impl(
    state: &AppState,
    block_id: String,
    task_id: Option<String>,
) -> Result<PomodoroStateResponse, InfraError> {
    let block_id = block_id.trim();
    if block_id.is_empty() {
        return Err(InfraError::InvalidConfig(
            "block_id must not be empty".to_string(),
        ));
    }

    let mut runtime = lock_runtime(state)?;
    if !runtime.blocks.contains_key(block_id) {
        return Err(InfraError::InvalidConfig(format!(
            "block not found: {}",
            block_id
        )));
    }

    let normalized_task_id = task_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    if let Some(task_id) = normalized_task_id.as_deref() {
        if !runtime.tasks.contains_key(task_id) {
            return Err(InfraError::InvalidConfig(format!("task not found: {}", task_id)));
        }
    }

    if runtime.pomodoro.phase != PomodoroRuntimePhase::Idle {
        return Err(InfraError::InvalidConfig(
            "timer must be idle before start".to_string(),
        ));
    }

    let now = Utc::now();
    runtime.pomodoro.current_block_id = Some(block_id.to_string());
    runtime.pomodoro.current_task_id = normalized_task_id.clone();
    runtime.pomodoro.phase = PomodoroRuntimePhase::Focus;
    runtime.pomodoro.paused_phase = None;
    runtime.pomodoro.remaining_seconds = POMODORO_FOCUS_SECONDS;
    runtime.pomodoro.start_time = Some(now);
    runtime.pomodoro.active_log = Some(PomodoroLog {
        id: next_id("pom"),
        block_id: block_id.to_string(),
        task_id: normalized_task_id,
        phase: PomodoroPhase::Focus,
        start_time: now,
        end_time: None,
        interruption_reason: None,
    });

    state.log_info("start_pomodoro", &format!("started block_id={}", block_id));
    Ok(to_pomodoro_state_response(&runtime.pomodoro))
}

pub fn pause_pomodoro_impl(
    state: &AppState,
    reason: Option<String>,
) -> Result<PomodoroStateResponse, InfraError> {
    let mut runtime = lock_runtime(state)?;
    if runtime.pomodoro.phase != PomodoroRuntimePhase::Focus
        && runtime.pomodoro.phase != PomodoroRuntimePhase::Break
    {
        return Err(InfraError::InvalidConfig("timer is not running".to_string()));
    }

    let interruption_reason = reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| "paused".to_string());

    if let Some(mut active) = runtime.pomodoro.active_log.take() {
        active.end_time = Some(Utc::now());
        active.interruption_reason = Some(interruption_reason.clone());
        runtime.pomodoro.completed_logs.push(active);
    }

    runtime.pomodoro.paused_phase = Some(runtime.pomodoro.phase);
    runtime.pomodoro.phase = PomodoroRuntimePhase::Paused;
    runtime.pomodoro.remaining_seconds = runtime
        .pomodoro
        .remaining_seconds
        .min(POMODORO_FOCUS_SECONDS.max(POMODORO_BREAK_SECONDS));

    state.log_info("pause_pomodoro", "paused active pomodoro timer");
    Ok(to_pomodoro_state_response(&runtime.pomodoro))
}

pub fn get_pomodoro_state_impl(state: &AppState) -> Result<PomodoroStateResponse, InfraError> {
    let runtime = lock_runtime(state)?;
    Ok(to_pomodoro_state_response(&runtime.pomodoro))
}

pub fn resume_pomodoro_impl(state: &AppState) -> Result<PomodoroStateResponse, InfraError> {
    let mut runtime = lock_runtime(state)?;
    if runtime.pomodoro.phase != PomodoroRuntimePhase::Paused {
        return Err(InfraError::InvalidConfig("timer is not paused".to_string()));
    }

    let resume_phase = runtime
        .pomodoro
        .paused_phase
        .take()
        .ok_or_else(|| InfraError::InvalidConfig("paused phase is missing".to_string()))?;
    let phase = match resume_phase {
        PomodoroRuntimePhase::Focus => PomodoroPhase::Focus,
        PomodoroRuntimePhase::Break => PomodoroPhase::Break,
        _ => {
            return Err(InfraError::InvalidConfig(
                "cannot resume to idle or paused phase".to_string(),
            ));
        }
    };

    let block_id = runtime
        .pomodoro
        .current_block_id
        .clone()
        .ok_or_else(|| InfraError::InvalidConfig("current block is missing".to_string()))?;
    let now = Utc::now();

    runtime.pomodoro.phase = resume_phase;
    runtime.pomodoro.active_log = Some(PomodoroLog {
        id: next_id("pom"),
        block_id,
        task_id: runtime.pomodoro.current_task_id.clone(),
        phase,
        start_time: now,
        end_time: None,
        interruption_reason: None,
    });

    state.log_info("resume_pomodoro", "resumed paused pomodoro timer");
    Ok(to_pomodoro_state_response(&runtime.pomodoro))
}

pub fn complete_pomodoro_impl(state: &AppState) -> Result<PomodoroStateResponse, InfraError> {
    let mut runtime = lock_runtime(state)?;
    if let Some(mut active) = runtime.pomodoro.active_log.take() {
        active.end_time = Some(Utc::now());
        runtime.pomodoro.completed_logs.push(active);
    }

    runtime.pomodoro.current_block_id = None;
    runtime.pomodoro.current_task_id = None;
    runtime.pomodoro.phase = PomodoroRuntimePhase::Idle;
    runtime.pomodoro.paused_phase = None;
    runtime.pomodoro.remaining_seconds = 0;
    runtime.pomodoro.start_time = None;

    state.log_info("complete_pomodoro", "completed pomodoro session");
    Ok(to_pomodoro_state_response(&runtime.pomodoro))
}

pub fn get_reflection_summary_impl(
    state: &AppState,
    start: Option<String>,
    end: Option<String>,
) -> Result<ReflectionSummaryResponse, InfraError> {
    let default_start = Utc::now() - Duration::days(7);
    let start = match start {
        Some(raw) => parse_datetime_input(&raw, "start")?,
        None => default_start,
    };
    let end = match end {
        Some(raw) => parse_datetime_input(&raw, "end")?,
        None => Utc::now(),
    };
    if end <= start {
        return Err(InfraError::InvalidConfig(
            "end must be greater than start".to_string(),
        ));
    }

    let runtime = lock_runtime(state)?;
    let logs_in_range = runtime
        .pomodoro
        .completed_logs
        .iter()
        .filter(|log| log.start_time >= start && log.start_time <= end)
        .cloned()
        .collect::<Vec<_>>();

    let completed_count = logs_in_range
        .iter()
        .filter(|log| log.phase == PomodoroPhase::Focus && log.interruption_reason.is_none())
        .count() as u32;
    let interrupted_count = logs_in_range
        .iter()
        .filter(|log| log.interruption_reason.is_some())
        .count() as u32;

    let total_focus_minutes = logs_in_range
        .iter()
        .filter(|log| log.phase == PomodoroPhase::Focus)
        .filter_map(|log| log.end_time.map(|end_time| (end_time - log.start_time).num_minutes()))
        .filter(|duration_minutes| *duration_minutes > 0)
        .sum();

    let logs = logs_in_range
        .into_iter()
        .map(|log| ReflectionLogItem {
            id: log.id,
            block_id: log.block_id,
            task_id: log.task_id,
            phase: match log.phase {
                PomodoroPhase::Focus => "focus",
                PomodoroPhase::Break => "break",
                PomodoroPhase::LongBreak => "long_break",
                PomodoroPhase::Paused => "paused",
            }
            .to_string(),
            start_time: log.start_time.to_rfc3339(),
            end_time: log.end_time.map(|value| value.to_rfc3339()),
            interruption_reason: log.interruption_reason,
        })
        .collect::<Vec<_>>();

    Ok(ReflectionSummaryResponse {
        start: start.to_rfc3339(),
        end: end.to_rfc3339(),
        completed_count,
        interrupted_count,
        total_focus_minutes,
        logs,
    })
}

fn lock_runtime(state: &AppState) -> Result<MutexGuard<'_, RuntimeState>, InfraError> {
    state
        .runtime
        .lock()
        .map_err(|error| InfraError::InvalidConfig(format!("runtime lock poisoned: {error}")))
}

fn to_pomodoro_state_response(state: &PomodoroRuntimeState) -> PomodoroStateResponse {
    PomodoroStateResponse {
        current_block_id: state.current_block_id.clone(),
        current_task_id: state.current_task_id.clone(),
        phase: state.phase.as_str().to_string(),
        remaining_seconds: state.remaining_seconds,
        start_time: state.start_time.map(|value| value.to_rfc3339()),
    }
}

fn oauth_manager(config: OAuthConfig) -> OAuthManager<WindowsCredentialManagerStore, ReqwestOAuthClient> {
    let credential_store = Arc::new(WindowsCredentialManagerStore::default());
    let oauth_client = Arc::new(ReqwestOAuthClient::new());
    OAuthManager::new(config, credential_store, oauth_client)
}

async fn required_access_token() -> Result<String, InfraError> {
    let oauth_config = load_oauth_config_from_env()?;
    let manager = oauth_manager(oauth_config);
    match manager.ensure_access_token().await? {
        EnsureTokenResult::Existing(token) | EnsureTokenResult::Refreshed(token) => {
            Ok(token.access_token)
        }
        EnsureTokenResult::ReauthenticationRequired => Err(InfraError::OAuth(
            "google authentication required; call authenticate_google with authorization_code"
                .to_string(),
        )),
    }
}

async fn try_access_token() -> Result<Option<String>, InfraError> {
    let oauth_config = match load_oauth_config_from_env() {
        Ok(config) => config,
        Err(InfraError::InvalidConfig(_)) => return Ok(None),
        Err(error) => return Err(error),
    };

    let manager = oauth_manager(oauth_config);
    match manager.ensure_access_token().await? {
        EnsureTokenResult::Existing(token) | EnsureTokenResult::Refreshed(token) => {
            Ok(Some(token.access_token))
        }
        EnsureTokenResult::ReauthenticationRequired => Ok(None),
    }
}

async fn ensure_blocks_calendar_id(
    config_dir: &Path,
    access_token: &str,
    calendar_client: Arc<ReqwestGoogleCalendarClient>,
) -> Result<String, InfraError> {
    let initializer = BlocksCalendarInitializer::new(config_dir, calendar_client);
    let result = initializer.ensure_blocks_calendar(access_token).await?;
    Ok(match result {
        EnsureBlocksCalendarResult::Reused(id)
        | EnsureBlocksCalendarResult::LinkedExisting(id)
        | EnsureBlocksCalendarResult::Created(id) => id,
    })
}

fn load_oauth_config_from_env() -> Result<OAuthConfig, InfraError> {
    load_oauth_config_from_lookup(|key| std::env::var(key).ok())
}

fn load_oauth_config_from_lookup<F>(lookup: F) -> Result<OAuthConfig, InfraError>
where
    F: Fn(&str) -> Option<String>,
{
    let client_id = required_lookup_value(
        &lookup,
        &["POMBLOCK_GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_ID"],
        "google client id",
    )?;
    let client_secret = required_lookup_value(
        &lookup,
        &["POMBLOCK_GOOGLE_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"],
        "google client secret",
    )?;
    let redirect_uri = optional_lookup_value(
        &lookup,
        &["POMBLOCK_GOOGLE_REDIRECT_URI", "GOOGLE_REDIRECT_URI"],
    )
    .unwrap_or_else(|| DEFAULT_REDIRECT_URI.to_string());
    let scopes = optional_lookup_value(&lookup, &["POMBLOCK_GOOGLE_SCOPES", "GOOGLE_SCOPES"])
        .map(|raw| parse_scope_list(&raw))
        .filter(|scopes| !scopes.is_empty())
        .unwrap_or_else(|| vec![DEFAULT_SCOPE.to_string()]);

    Ok(OAuthConfig::new(
        client_id,
        client_secret,
        redirect_uri,
        scopes,
    ))
}

fn required_lookup_value<F>(
    lookup: &F,
    keys: &[&str],
    field_name: &str,
) -> Result<String, InfraError>
where
    F: Fn(&str) -> Option<String>,
{
    optional_lookup_value(lookup, keys).ok_or_else(|| {
        InfraError::InvalidConfig(format!(
            "missing {} (set one of: {})",
            field_name,
            keys.join(", ")
        ))
    })
}

fn optional_lookup_value<F>(lookup: &F, keys: &[&str]) -> Option<String>
where
    F: Fn(&str) -> Option<String>,
{
    for key in keys {
        if let Some(value) = lookup(key) {
            let normalized = value.trim();
            if !normalized.is_empty() {
                return Some(normalized.to_string());
            }
        }
    }
    None
}

fn parse_scope_list(raw: &str) -> Vec<String> {
    raw.split([',', ' ', '\n', '\t'])
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn resolve_sync_window(
    time_min: Option<String>,
    time_max: Option<String>,
) -> Result<(DateTime<Utc>, DateTime<Utc>), InfraError> {
    let default_start = {
        let today = Utc::now().date_naive();
        Utc.from_utc_datetime(&today.and_hms_opt(0, 0, 0).expect("valid midnight"))
    };
    let start = match time_min {
        Some(raw) => parse_datetime_input(&raw, "time_min")?,
        None => default_start,
    };
    let end = match time_max {
        Some(raw) => parse_datetime_input(&raw, "time_max")?,
        None => start + Duration::days(1),
    };
    if end <= start {
        return Err(InfraError::InvalidConfig(
            "time_max must be greater than time_min".to_string(),
        ));
    }
    Ok((start, end))
}

fn parse_datetime_input(value: &str, field_name: &str) -> Result<DateTime<Utc>, InfraError> {
    if let Ok(parsed) = DateTime::parse_from_rfc3339(value) {
        return Ok(parsed.with_timezone(&Utc));
    }
    if let Ok(date) = NaiveDate::parse_from_str(value, "%Y-%m-%d") {
        return Ok(Utc.from_utc_datetime(
            &date.and_hms_opt(0, 0, 0).expect("valid midnight"),
        ));
    }
    Err(InfraError::InvalidConfig(format!(
        "{field_name} must be RFC3339 or YYYY-MM-DD"
    )))
}

fn load_runtime_policy(config_dir: &Path) -> RuntimePolicy {
    let mut policy = RuntimePolicy::default();
    let path = config_dir.join("policies.json");
    let Ok(raw) = fs::read_to_string(path) else {
        return policy;
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return policy;
    };

    if let Some(work_hours) = parsed.get("workHours") {
        if let Some(start) = work_hours.get("start").and_then(serde_json::Value::as_str) {
            if let Ok(parsed_start) = NaiveTime::parse_from_str(start.trim(), "%H:%M") {
                policy.work_start = parsed_start;
            }
        }
        if let Some(end) = work_hours.get("end").and_then(serde_json::Value::as_str) {
            if let Ok(parsed_end) = NaiveTime::parse_from_str(end.trim(), "%H:%M") {
                policy.work_end = parsed_end;
            }
        }
        if let Some(days) = work_hours.get("days").and_then(serde_json::Value::as_array) {
            let parsed_days = days
                .iter()
                .filter_map(serde_json::Value::as_str)
                .filter_map(parse_weekday)
                .collect::<HashSet<_>>();
            if !parsed_days.is_empty() {
                policy.work_days = parsed_days;
            }
        }
    }

    if let Some(value) = parsed
        .get("blockDurationMinutes")
        .and_then(serde_json::Value::as_u64)
    {
        policy.block_duration_minutes = value.max(1) as u32;
    }
    if let Some(value) = parsed
        .get("minBlockGapMinutes")
        .and_then(serde_json::Value::as_u64)
    {
        policy.min_block_gap_minutes = value as u32;
    }

    policy
}

fn parse_weekday(value: &str) -> Option<Weekday> {
    match value.trim().to_ascii_lowercase().as_str() {
        "monday" | "mon" => Some(Weekday::Mon),
        "tuesday" | "tue" => Some(Weekday::Tue),
        "wednesday" | "wed" => Some(Weekday::Wed),
        "thursday" | "thu" => Some(Weekday::Thu),
        "friday" | "fri" => Some(Weekday::Fri),
        "saturday" | "sat" => Some(Weekday::Sat),
        "sunday" | "sun" => Some(Weekday::Sun),
        _ => None,
    }
}

fn parse_task_status(value: &str) -> Result<TaskStatus, InfraError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "pending" => Ok(TaskStatus::Pending),
        "in_progress" | "in-progress" => Ok(TaskStatus::InProgress),
        "completed" => Ok(TaskStatus::Completed),
        "deferred" => Ok(TaskStatus::Deferred),
        other => Err(InfraError::InvalidConfig(format!(
            "unsupported task status: {}",
            other
        ))),
    }
}

fn parse_rfc3339_input(value: &str, field_name: &str) -> Result<DateTime<Utc>, InfraError> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|error| {
            InfraError::InvalidConfig(format!(
                "{field_name} must be RFC3339 date-time: {error}"
            ))
        })
}

fn event_to_interval(event: &GoogleCalendarEvent) -> Option<Interval> {
    let start = DateTime::parse_from_rfc3339(&event.start.date_time)
        .ok()?
        .with_timezone(&Utc);
    let end = DateTime::parse_from_rfc3339(&event.end.date_time)
        .ok()?
        .with_timezone(&Utc);
    if end <= start {
        return None;
    }
    Some(Interval { start, end })
}

fn clip_interval(
    interval: Interval,
    window_start: DateTime<Utc>,
    window_end: DateTime<Utc>,
) -> Option<Interval> {
    if interval.end <= window_start || interval.start >= window_end {
        return None;
    }
    let start = if interval.start < window_start {
        window_start
    } else {
        interval.start
    };
    let end = if interval.end > window_end {
        window_end
    } else {
        interval.end
    };
    (end > start).then_some(Interval { start, end })
}

fn free_slots(
    window_start: DateTime<Utc>,
    window_end: DateTime<Utc>,
    busy_intervals: &[Interval],
) -> Vec<Interval> {
    if window_end <= window_start {
        return Vec::new();
    }

    let mut slots = Vec::new();
    let mut cursor = window_start;
    for interval in busy_intervals {
        if interval.start > cursor {
            slots.push(Interval {
                start: cursor,
                end: interval.start,
            });
        }
        if interval.end > cursor {
            cursor = interval.end;
        }
    }
    if cursor < window_end {
        slots.push(Interval {
            start: cursor,
            end: window_end,
        });
    }
    slots
}

fn merge_intervals(mut intervals: Vec<Interval>) -> Vec<Interval> {
    if intervals.is_empty() {
        return intervals;
    }

    intervals.sort_unstable_by(|left, right| left.start.cmp(&right.start));
    let mut iter = intervals.into_iter();
    let mut merged = vec![iter.next().expect("intervals is non-empty")];
    for interval in iter {
        let last = merged
            .last_mut()
            .expect("merged always contains at least one interval");
        if interval.start <= last.end {
            if interval.end > last.end {
                last.end = interval.end;
            }
            continue;
        }
        merged.push(interval);
    }
    merged
}

fn planned_pomodoros(block_duration_minutes: u32) -> i32 {
    ((block_duration_minutes + 12) / 25).max(1) as i32
}

async fn create_calendar_events_for_generated_blocks(
    sync_service: Arc<
        CalendarSyncService<
            ReqwestGoogleCalendarClient,
            SqliteSyncStateRepository,
            InMemoryCalendarCacheRepository,
        >,
    >,
    access_token: &str,
    calendar_id: &str,
    generated: &mut [StoredBlock],
) -> Result<(), InfraError> {
    if generated.is_empty() {
        return Ok(());
    }

    let mut create_tasks: JoinSet<Result<(usize, String), InfraError>> = JoinSet::new();
    let mut created_event_ids = vec![None; generated.len()];
    let access_token = access_token.to_string();
    let calendar_id = calendar_id.to_string();

    for (index, stored) in generated.iter().enumerate() {
        let sync_service = Arc::clone(&sync_service);
        let access_token = access_token.clone();
        let calendar_id = calendar_id.clone();
        let event = encode_block_event(&stored.block);

        create_tasks.spawn(async move {
            let event_id = sync_service
                .create_event(&access_token, &calendar_id, &event)
                .await?;
            Ok((index, event_id))
        });

        if create_tasks.len() >= BLOCK_CREATION_CONCURRENCY {
            collect_created_event_id(&mut create_tasks, &mut created_event_ids).await?;
        }
    }

    while !create_tasks.is_empty() {
        collect_created_event_id(&mut create_tasks, &mut created_event_ids).await?;
    }

    for (index, event_id) in created_event_ids.into_iter().enumerate() {
        if let Some(event_id) = event_id {
            generated[index].calendar_event_id = Some(event_id);
        }
    }

    Ok(())
}

async fn collect_created_event_id(
    create_tasks: &mut JoinSet<Result<(usize, String), InfraError>>,
    created_event_ids: &mut [Option<String>],
) -> Result<(), InfraError> {
    let Some(join_result) = create_tasks.join_next().await else {
        return Ok(());
    };
    let created = join_result.map_err(|error| {
        InfraError::OAuth(format!("failed to join calendar event creation task: {error}"))
    })??;
    if let Some(slot) = created_event_ids.get_mut(created.0) {
        *slot = Some(created.1);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::event_mapper::CalendarEventDateTime;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_TEMP_WORKSPACE: AtomicUsize = AtomicUsize::new(0);

    struct TempWorkspace {
        path: PathBuf,
    }

    impl TempWorkspace {
        fn new() -> Self {
            let sequence = NEXT_TEMP_WORKSPACE.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "pomblock-command-tests-{}-{}",
                std::process::id(),
                sequence
            ));
            fs::create_dir_all(&path).expect("create temp workspace");
            Self { path }
        }

        fn app_state(&self) -> AppState {
            AppState::new(self.path.clone()).expect("initialize app state")
        }
    }

    impl Drop for TempWorkspace {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn oauth_config_validation_reports_missing_client_id() {
        let result = load_oauth_config_from_lookup(|key| match key {
            "POMBLOCK_GOOGLE_CLIENT_SECRET" => Some("secret".to_string()),
            _ => None,
        });
        match result {
            Err(InfraError::InvalidConfig(message)) => {
                assert!(message.contains("google client id"));
            }
            _ => panic!("expected invalid config error"),
        }
    }

    #[test]
    fn create_task_rejects_empty_title() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let result = create_task_impl(&state, "   ".to_string(), None, None);
        assert!(result.is_err());
    }

    #[test]
    fn create_and_list_tasks_roundtrip() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();

        let created = create_task_impl(
            &state,
            "Write integration tests".to_string(),
            Some("Task 18.5".to_string()),
            Some(2),
        )
        .expect("create task");
        let listed = list_tasks_impl(&state).expect("list tasks");

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, created.id);
        assert_eq!(listed[0].status, TaskStatus::Pending);
    }

    #[tokio::test]
    async fn generate_and_approve_blocks_flow() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();

        let generated = generate_blocks_impl(&state, "2026-02-16".to_string())
            .await
            .expect("generate blocks");
        assert!(!generated.is_empty());
        assert_eq!(generated[0].firmness, Firmness::Draft);

        let approved = approve_blocks_impl(&state, vec![generated[0].id.clone()])
            .await
            .expect("approve block");
        assert_eq!(approved.len(), 1);
        assert_eq!(approved[0].firmness, Firmness::Soft);
    }

    #[test]
    fn start_pomodoro_requires_existing_block() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let result = start_pomodoro_impl(&state, "missing-block".to_string(), None);
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn start_pause_and_get_pomodoro_state_flow() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let generated = generate_blocks_impl(&state, "2026-02-16".to_string())
            .await
            .expect("generate blocks");
        let block_id = generated[0].id.clone();

        let started = start_pomodoro_impl(&state, block_id.clone(), None).expect("start pomodoro");
        assert_eq!(started.phase, "focus");
        assert_eq!(started.current_block_id, Some(block_id.clone()));
        assert_eq!(started.remaining_seconds, POMODORO_FOCUS_SECONDS);

        let paused =
            pause_pomodoro_impl(&state, Some("interruption".to_string())).expect("pause pomodoro");
        assert_eq!(paused.phase, "paused");

        let snapshot = get_pomodoro_state_impl(&state).expect("get pomodoro state");
        assert_eq!(snapshot.phase, "paused");
        assert_eq!(snapshot.current_block_id, Some(block_id));
    }

    #[tokio::test]
    async fn generate_blocks_rejects_invalid_date() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let result = generate_blocks_impl(&state, "not-a-date".to_string()).await;
        assert!(result.is_err());
    }

    #[test]
    fn update_and_delete_task_flow() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let created = create_task_impl(&state, "Original".to_string(), None, Some(1))
            .expect("create task");

        let updated = update_task_impl(
            &state,
            created.id.clone(),
            Some("Updated".to_string()),
            Some("Details".to_string()),
            Some(3),
            Some("in_progress".to_string()),
        )
        .expect("update task");
        assert_eq!(updated.title, "Updated");
        assert_eq!(updated.status, TaskStatus::InProgress);
        assert_eq!(updated.estimated_pomodoros, Some(3));

        let deleted = delete_task_impl(&state, created.id.clone()).expect("delete task");
        assert!(deleted);
        let tasks = list_tasks_impl(&state).expect("list tasks");
        assert!(tasks.is_empty());
    }

    #[tokio::test]
    async fn delete_and_adjust_block_flow() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let generated = generate_blocks_impl(&state, "2026-02-16".to_string())
            .await
            .expect("generate blocks");
        let block = generated[0].clone();

        let shifted = adjust_block_time_impl(
            &state,
            block.id.clone(),
            "2026-02-16T10:00:00Z".to_string(),
            "2026-02-16T10:50:00Z".to_string(),
        )
        .await
        .expect("adjust block");
        assert_eq!(shifted.start_at.to_rfc3339(), "2026-02-16T10:00:00+00:00");

        let deleted = delete_block_impl(&state, block.id.clone())
            .await
            .expect("delete block");
        assert!(deleted);
        let blocks = list_blocks_impl(&state, Some("2026-02-16".to_string())).expect("list blocks");
        assert!(blocks.into_iter().all(|candidate| candidate.id != block.id));
    }

    #[tokio::test]
    async fn resume_complete_and_reflection_flow() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let generated = generate_blocks_impl(&state, "2026-02-16".to_string())
            .await
            .expect("generate blocks");
        let block_id = generated[0].id.clone();

        let _ = start_pomodoro_impl(&state, block_id, None).expect("start");
        let _ = pause_pomodoro_impl(&state, Some("break".to_string())).expect("pause");
        let resumed = resume_pomodoro_impl(&state).expect("resume");
        assert!(resumed.phase == "focus" || resumed.phase == "break");

        let completed = complete_pomodoro_impl(&state).expect("complete");
        assert_eq!(completed.phase, "idle");

        let summary = get_reflection_summary_impl(&state, None, None).expect("summary");
        assert!(summary.interrupted_count >= 1);
    }

    #[tokio::test]
    async fn generate_to_confirm_stays_within_target_for_dense_calendar() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let date = "2026-02-16";
        let day = NaiveDate::parse_from_str(date, "%Y-%m-%d").expect("valid date");
        let day_start = Utc.from_utc_datetime(&day.and_hms_opt(0, 0, 0).expect("midnight"));

        let synced_events = (0..2_000)
            .map(|index| {
                let start = day_start + Duration::minutes(index as i64);
                let end = start + Duration::seconds(30);
                GoogleCalendarEvent {
                    id: Some(format!("evt-{index}")),
                    summary: Some("busy".to_string()),
                    description: None,
                    status: Some("confirmed".to_string()),
                    updated: None,
                    etag: None,
                    start: CalendarEventDateTime {
                        date_time: start.to_rfc3339(),
                        time_zone: None,
                    },
                    end: CalendarEventDateTime {
                        date_time: end.to_rfc3339(),
                        time_zone: None,
                    },
                    extended_properties: None,
                }
            })
            .collect::<Vec<_>>();

        {
            let mut runtime = lock_runtime(&state).expect("runtime lock");
            runtime.synced_events = synced_events;
        }

        let started = Instant::now();
        let _generated = generate_blocks_impl(&state, date.to_string())
            .await
            .expect("generate blocks");
        let _listed = list_blocks_impl(&state, Some(date.to_string())).expect("list blocks");
        let elapsed_ms = started.elapsed().as_millis();
        assert!(
            elapsed_ms < BLOCK_GENERATION_TARGET_MS,
            "generate-to-confirm exceeded target: {elapsed_ms}ms"
        );
    }
}
