# デザインドキュメント: PomBlock

## 概要

PomBlockは、Tauriベースのクロスプラットフォームデスクトップアプリケーションで、Google Calendarを時間情報の唯一の真実として、空き時間を作業ブロックとして確保し、ポモドーロタイマーで実行管理を行います。

### 主要な設計原則

1. **Single Source of Truth**: Google Calendarがすべての時間情報の真実
2. **差分同期**: syncTokenを使用した効率的な同期
3. **外部編集許容**: カレンダー上での直接編集を破綻なく処理
4. **セキュリティ**: 機微情報はローカルのみ、設定はGitで共有
5. **応答性**: UI操作は100ms以内、日次計画は30秒以内

## アーキテクチャ

### レイヤー構成

```
┌─────────────────────────────────────────┐
│         UI Layer (TypeScript)           │
│  - React/Vue/Svelte Components          │
│  - Tauri IPC Commands                   │
└─────────────────────────────────────────┘
                    ↕ IPC
┌─────────────────────────────────────────┐
│      Application Layer (Rust)           │
│  - Command Handlers                     │
│  - Business Logic                       │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│       Domain Layer (Rust)               │
│  - Block, Task, Pomodoro Models         │
│  - Policy, Routine, Template            │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│    Infrastructure Layer (Rust)          │
│  - Google Calendar Sync                 │
│  - Git Repository Sync                  │
│  - Local Storage                        │
│  - OAuth Manager                        │
└─────────────────────────────────────────┘
```

### 技術スタック

- **フロントエンド**: TypeScript + React/Vue/Svelte
- **バックエンド**: Rust (Tauri)
- **外部API**: Google Calendar API v3
- **ローカルストレージ**: SQLite
- **設定同期**: Git (libgit2)
- **認証**: OAuth 2.0 (Windows Credential Manager)

## コンポーネントとインターフェース

### 1. OAuth Manager

**責務**: Google Calendar APIの認証とトークン管理

```rust
pub struct OAuthManager {
    client_id: String,
    client_secret: String,
    credential_store: Box<dyn CredentialStore>,
}

pub trait CredentialStore {
    fn save_token(&self, token: &OAuthToken) -> Result<()>;
    fn load_token(&self) -> Result<Option<OAuthToken>>;
    fn delete_token(&self) -> Result<()>;
}

impl OAuthManager {
    pub async fn authenticate(&self) -> Result<OAuthToken>;
    pub async fn refresh_token(&self, refresh_token: &str) -> Result<OAuthToken>;
    pub fn is_token_valid(&self, token: &OAuthToken) -> bool;
}
```

### 2. Calendar Sync Service

**責務**: Google Calendarとの差分同期

```rust
pub struct CalendarSyncService {
    oauth_manager: Arc<OAuthManager>,
    calendar_client: GoogleCalendarClient,
    sync_state_repo: Arc<SyncStateRepository>,
}

pub struct SyncState {
    pub sync_token: Option<String>,
    pub last_sync_time: DateTime<Utc>,
}

impl CalendarSyncService {
    pub async fn sync(&self) -> Result<SyncResult>;
    pub async fn fetch_events(&self, time_min: DateTime<Utc>, time_max: DateTime<Utc>) -> Result<Vec<CalendarEvent>>;
    pub async fn create_event(&self, event: &CalendarEvent) -> Result<String>;
    pub async fn update_event(&self, event_id: &str, event: &CalendarEvent) -> Result<()>;
    pub async fn delete_event(&self, event_id: &str) -> Result<()>;
}

pub struct SyncResult {
    pub added: Vec<CalendarEvent>,
    pub updated: Vec<CalendarEvent>,
    pub deleted: Vec<String>,
}
```

### 3. Block Generator

**責務**: 空き時間の計算とブロック生成

```rust
pub struct BlockGenerator {
    policy: Arc<Policy>,
    calendar_service: Arc<CalendarSyncService>,
}

pub struct Block {
    pub id: String,
    pub start_time: DateTime<Utc>,
    pub end_time: DateTime<Utc>,
    pub firmness: Firmness,
    pub calendar_event_id: Option<String>,
    pub task_id: Option<String>,
}

pub enum Firmness {
    Draft,   // 生成直後、未承認
    Soft,    // 承認済み、移動可能
    Hard,    // 確定、移動不可
}

impl BlockGenerator {
    pub fn generate_blocks(&self, date: NaiveDate, existing_events: &[CalendarEvent]) -> Result<Vec<Block>>;
    pub fn find_free_slots(&self, date: NaiveDate, existing_events: &[CalendarEvent]) -> Vec<TimeSlot>;
    pub fn relocate_block(&self, block: &Block, existing_events: &[CalendarEvent]) -> Result<Option<Block>>;
}

pub struct TimeSlot {
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
}
```

### 4. Policy Engine

**責務**: 働き方ポリシーの適用

```rust
pub struct Policy {
    pub work_hours: WorkHours,
    pub block_duration: Duration,
    pub break_duration: Duration,
    pub min_block_gap: Duration,
}

pub struct WorkHours {
    pub start: NaiveTime,
    pub end: NaiveTime,
    pub days: Vec<Weekday>,
}

impl Policy {
    pub fn is_within_work_hours(&self, time: DateTime<Utc>) -> bool;
    pub fn filter_slots(&self, slots: Vec<TimeSlot>) -> Vec<TimeSlot>;
}
```

### 5. Pomodoro Timer

**責務**: ポモドーロタイマーの実行と実績記録

```rust
pub struct PomodoroTimer {
    state: Arc<Mutex<PomodoroState>>,
    log_repo: Arc<PomodoroLogRepository>,
}

pub struct PomodoroState {
    pub current_block_id: Option<String>,
    pub current_task_id: Option<String>,
    pub phase: PomodoroPhase,
    pub remaining_seconds: u32,
    pub start_time: Option<DateTime<Utc>>,
}

pub enum PomodoroPhase {
    Idle,
    Focus,
    Break,
    Paused,
}

pub struct PomodoroLog {
    pub id: String,
    pub block_id: String,
    pub task_id: Option<String>,
    pub start_time: DateTime<Utc>,
    pub end_time: Option<DateTime<Utc>>,
    pub phase: PomodoroPhase,
    pub interruption_reason: Option<String>,
}

impl PomodoroTimer {
    pub fn start(&self, block_id: String, task_id: Option<String>) -> Result<()>;
    pub fn pause(&self, reason: Option<String>) -> Result<()>;
    pub fn resume(&self) -> Result<()>;
    pub fn complete(&self) -> Result<()>;
    pub fn get_state(&self) -> PomodoroState;
}
```

### 6. Task Manager

**責務**: タスクの管理とブロックへの割り当て

```rust
pub struct TaskManager {
    task_repo: Arc<TaskRepository>,
}

pub struct Task {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub estimated_pomodoros: Option<u32>,
    pub completed_pomodoros: u32,
    pub status: TaskStatus,
    pub created_at: DateTime<Utc>,
}

pub enum TaskStatus {
    Pending,
    InProgress,
    Completed,
    Deferred,
}

impl TaskManager {
    pub fn create_task(&self, title: String, description: Option<String>) -> Result<Task>;
    pub fn list_available_tasks(&self) -> Result<Vec<Task>>;
    pub fn assign_task_to_block(&self, task_id: &str, block_id: &str) -> Result<()>;
    pub fn mark_task_completed(&self, task_id: &str) -> Result<()>;
    pub fn split_task(&self, task_id: &str, parts: u32) -> Result<Vec<Task>>;
}
```

### 7. Routine & Template Manager

**責務**: ルーティーンとテンプレートの管理

```rust
pub struct RoutineManager {
    git_repo: Arc<GitRepository>,
}

pub struct Routine {
    pub id: String,
    pub name: String,
    pub schedule: Schedule,
    pub template_id: String,
}

pub enum Schedule {
    Daily { time: NaiveTime },
    Weekly { day: Weekday, time: NaiveTime },
    Monthly { day: u32, time: NaiveTime },
}

pub struct Template {
    pub id: String,
    pub name: String,
    pub duration: Duration,
    pub default_tasks: Vec<String>,
}

impl RoutineManager {
    pub fn load_routines(&self) -> Result<Vec<Routine>>;
    pub fn save_routine(&self, routine: &Routine) -> Result<()>;
    pub fn load_templates(&self) -> Result<Vec<Template>>;
    pub fn save_template(&self, template: &Template) -> Result<()>;
    pub fn sync_with_git(&self) -> Result<()>;
}
```

### 8. Git Repository Manager

**責務**: 設定ファイルのGit同期

```rust
pub struct GitRepository {
    repo_path: PathBuf,
    repo: git2::Repository,
}

impl GitRepository {
    pub fn init(path: PathBuf) -> Result<Self>;
    pub fn pull(&self) -> Result<()>;
    pub fn commit_and_push(&self, message: &str, files: &[PathBuf]) -> Result<()>;
    pub fn read_file(&self, path: &str) -> Result<String>;
    pub fn write_file(&self, path: &str, content: &str) -> Result<()>;
}
```

### 9. Local Storage Repository

**責務**: ローカルデータの永続化

```rust
pub struct LocalStorageRepository {
    db: Arc<SqliteConnection>,
}

impl LocalStorageRepository {
    pub fn save_block(&self, block: &Block) -> Result<()>;
    pub fn load_blocks(&self, date: NaiveDate) -> Result<Vec<Block>>;
    pub fn save_pomodoro_log(&self, log: &PomodoroLog) -> Result<()>;
    pub fn load_pomodoro_logs(&self, start: DateTime<Utc>, end: DateTime<Utc>) -> Result<Vec<PomodoroLog>>;
    pub fn save_sync_state(&self, state: &SyncState) -> Result<()>;
    pub fn load_sync_state(&self) -> Result<Option<SyncState>>;
}
```

### 10. Tauri Command Handlers

**責務**: UIからのコマンドを処理

```rust
#[tauri::command]
async fn authenticate_google(state: State<'_, AppState>) -> Result<(), String>;

#[tauri::command]
async fn sync_calendar(state: State<'_, AppState>) -> Result<SyncResult, String>;

#[tauri::command]
async fn generate_blocks(state: State<'_, AppState>, date: String) -> Result<Vec<Block>, String>;

#[tauri::command]
async fn approve_blocks(state: State<'_, AppState>, block_ids: Vec<String>) -> Result<(), String>;

#[tauri::command]
async fn start_pomodoro(state: State<'_, AppState>, block_id: String, task_id: Option<String>) -> Result<(), String>;

#[tauri::command]
async fn pause_pomodoro(state: State<'_, AppState>, reason: Option<String>) -> Result<(), String>;

#[tauri::command]
async fn get_pomodoro_state(state: State<'_, AppState>) -> Result<PomodoroState, String>;

#[tauri::command]
async fn list_tasks(state: State<'_, AppState>) -> Result<Vec<Task>, String>;

#[tauri::command]
async fn create_task(state: State<'_, AppState>, title: String, description: Option<String>) -> Result<Task, String>;
```

## データモデル

### Google Calendar Event 構造

```json
{
  "id": "event_id",
  "summary": "[PomBlock] Work Block",
  "description": "block_id: uuid, firmness: soft",
  "start": {
    "dateTime": "2024-01-15T09:00:00+09:00"
  },
  "end": {
    "dateTime": "2024-01-15T10:00:00+09:00"
  },
  "extendedProperties": {
    "private": {
      "pomblock_block_id": "uuid",
      "pomblock_firmness": "soft",
      "pomblock_task_id": "task_uuid"
    }
  }
}
```

### ローカルデータベーススキーマ

```sql
CREATE TABLE blocks (
    id TEXT PRIMARY KEY,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    firmness TEXT NOT NULL,
    calendar_event_id TEXT,
    task_id TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    estimated_pomodoros INTEGER,
    completed_pomodoros INTEGER DEFAULT 0,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE pomodoro_logs (
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

CREATE TABLE sync_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    sync_token TEXT,
    last_sync_time TEXT NOT NULL
);
```

### Git Repository 構造

```
.pomblock/
├── routines/
│   ├── daily-standup.json
│   └── weekly-review.json
├── templates/
│   ├── deep-work.json
│   └── quick-task.json
└── policy.json
```

**policy.json**:
```json
{
  "work_hours": {
    "start": "09:00",
    "end": "18:00",
    "days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
  },
  "block_duration_minutes": 50,
  "break_duration_minutes": 10,
  "min_block_gap_minutes": 5
}
```

**routine example**:
```json
{
  "id": "uuid",
  "name": "Daily Standup",
  "schedule": {
    "type": "Daily",
    "time": "09:30"
  },
  "template_id": "template_uuid"
}
```

**template example**:
```json
{
  "id": "uuid",
  "name": "Deep Work",
  "duration_minutes": 90,
  "default_tasks": []
}
```

## 正確性プロパティ

*プロパティとは、システムのすべての有効な実行において真であるべき特性や振る舞いです。プロパティは、人間が読める仕様と機械で検証可能な正確性保証の橋渡しとなります。*


### プロパティ1: OAuth トークンのラウンドトリップ

*任意の*有効なOAuthトークンに対して、ローカル安全領域に保存してから読み込んだ場合、元のトークンと同等の値が取得できる

**検証: 要件 1.2**

### プロパティ2: 有効なトークンでの再認証不要

*任意の*有効なOAuthトークンが保存されている場合、Google Calendarへのアクセス時に再認証フローが開始されない

**検証: 要件 1.3**

### プロパティ3: 無効なトークンでの再認証

*任意の*期限切れまたは無効なOAuthトークンに対して、Google Calendarへのアクセス試行時に再認証フローが自動的に開始される

**検証: 要件 1.4**

### プロパティ4: 機微情報のGit除外

*任意の*Git同期操作後、リポジトリにOAuthトークンまたは詳細ログが含まれていない

**検証: 要件 1.5, 9.5**

### プロパティ5: 外部編集の検出と反映

*任意の*Google Calendar上でのイベント変更（追加/更新/削除）に対して、次回同期時にその変更がローカルキャッシュに正しく反映される

**検証: 要件 2.2, 14.1, 14.2**

### プロパティ6: 同期後のSyncToken保存

*任意の*同期操作が完了した後、最新のSyncTokenがローカルストレージに保存されている

**検証: 要件 2.4**

### プロパティ7: 同期後のキャッシュ更新

*任意の*同期操作が完了した後、ローカルキャッシュがGoogle Calendarの最新状態と一致している

**検証: 要件 2.5**

### プロパティ8: ブロック生成時の重複回避

*任意の*既存予定セットに対して、ブロック生成時に生成されるすべてのブロックは既存予定と時間的に重複しない

**検証: 要件 3.3**

### プロパティ9: ポリシーに基づく勤務時間制約

*任意の*ポリシーと既存予定セットに対して、ブロック生成時に生成されるすべてのブロックはポリシーで定義された勤務時間内に収まる

**検証: 要件 3.4, 10.2**

### プロパティ10: 生成ブロックのカレンダー登録

*任意の*ブロック生成操作後、生成されたすべてのブロックがGoogle Calendarに"draft"確定度で登録されている

**検証: 要件 3.5**

### プロパティ11: 重複時間帯での生成防止

*任意の*既存ブロックセットに対して、同じ時間帯に新しいブロックを生成しようとした場合、重複生成が防止される

**検証: 要件 3.6, 14.3**

### プロパティ12: ブロック承認時の確定度更新

*任意の*"draft"確定度のブロックに対して、承認操作後に確定度が"soft"に更新され、Google Calendarに反映される

**検証: 要件 4.2**

### プロパティ13: ブロック削除のカレンダー反映

*任意の*ブロックに対して、削除操作後にGoogle Calendarから該当イベントが削除されている

**検証: 要件 4.3**

### プロパティ14: ブロック時刻調整のカレンダー反映

*任意の*ブロックと新しい時刻に対して、時刻調整操作後にGoogle Calendar上のイベント時刻が更新されている

**検証: 要件 4.4**

### プロパティ15: ポモドーロ開始時のタイマー起動

*任意の*ブロックに対して、開始操作後にポモドーロタイマーが動作状態になっている

**検証: 要件 5.1**

### プロパティ16: 集中時間終了後の休憩開始

*任意の*ポモドーロに対して、集中時間が終了した後、自動的に休憩フェーズに遷移する

**検証: 要件 5.3**

### プロパティ17: ポモドーロ中断時のログ記録

*任意の*ポモドーロに対して、中断操作後に中断時刻と理由がローカルログに記録されている

**検証: 要件 5.4**

### プロパティ18: ポモドーロ実績のログ記録

*任意の*ポモドーロに対して、完了または中断後に実績（開始/終了/中断/再開）がローカルログに記録されている

**検証: 要件 5.5**

### プロパティ19: タスクとブロックの関連付け

*任意の*タスクとブロックに対して、タスク選択操作後にタスクがブロックに正しく関連付けられている

**検証: 要件 6.2**

### プロパティ20: タスク選択のログ記録

*任意の*タスク選択操作に対して、タスク情報がローカルログに記録されている

**検証: 要件 6.3**

### プロパティ21: ブロック開始前のタスク未割り当て

*任意の*未開始ブロックに対して、タスクが事前に割り当てられていない

**検証: 要件 6.4**

### プロパティ22: 新規予定の同期検出

*任意の*Google Calendar上の新しい予定に対して、次回同期時にその予定が検出される

**検証: 要件 7.1**

### プロパティ23: 重複時のブロック再配置

*任意の*新しい予定が既存ブロックと重複する場合、重複するブロックが別の空き時間に再配置され、Google Calendarが更新される

**検証: 要件 7.2, 7.4**

### プロパティ24: タスク繰り越し時の関連付け

*任意の*未完タスクに対して、繰り越し操作後にタスクが次の利用可能なブロックに関連付けられている

**検証: 要件 8.2**

### プロパティ25: タスク分割時の小タスク生成

*任意の*タスクに対して、分割操作後に指定された数の小タスクが生成され記録されている

**検証: 要件 8.3**

### プロパティ26: 繰り越し・分割のログ記録

*任意の*繰り越しまたは分割操作に対して、その履歴がローカルログに記録されている

**検証: 要件 8.4**

### プロパティ27: 設定のGitラウンドトリップ

*任意の*ルーティーン、テンプレート、またはポリシーに対して、Git Repositoryに保存してから読み込んだ場合、元の設定と同等の値が取得できる

**検証: 要件 9.1, 9.2, 9.4, 10.1, 10.4**

### プロパティ28: Git更新後の設定反映

*任意の*Git Repository更新に対して、次回起動時または手動同期時に最新の設定が取得される

**検証: 要件 9.3**

### プロパティ29: ユーザー指定値の優先

*任意の*ポリシーとユーザー指定値に対して、ブロック生成時にユーザー指定値がポリシーより優先される

**検証: 要件 10.3**

### プロパティ30: データ削除の完全性

*任意の*ローカルデータに対して、削除操作後にローカルストレージから該当データが存在しない

**検証: 要件 11.5**

### プロパティ31: 外部編集の変更検出と通知

*任意の*Google Calendar上での外部編集に対して、次回同期時に変更が検出され、ユーザーに通知される

**検証: 要件 14.4**

### プロパティ32: 振り返りデータの集計正確性

*任意の*期間に対して、振り返り機能が表示するポモドーロ実績（完了数、中断数、総作業時間）がローカルログの実際の値と一致する

**検証: 要件 15.1, 15.2**

## エラーハンドリング

### エラー分類

1. **ネットワークエラー**
   - Google Calendar API接続失敗
   - Git Repository同期失敗
   - タイムアウト

2. **認証エラー**
   - OAuthトークン期限切れ
   - 認証フロー失敗
   - 権限不足

3. **データエラー**
   - ローカルデータベース破損
   - JSON解析失敗
   - スキーマ不一致

4. **ビジネスロジックエラー**
   - ブロック生成時の空き時間不足
   - 重複検出
   - ポリシー違反

### エラー処理戦略

**ネットワークエラー**:
- 指数バックオフによる自動リトライ（最大3回）
- リトライ失敗時はユーザーに通知
- オフライン時はローカルキャッシュで動作継続

**認証エラー**:
- トークン期限切れ時は自動リフレッシュ
- リフレッシュ失敗時は再認証フロー開始
- 認証中はUI操作を一時的にブロック

**データエラー**:
- データベース破損検出時はバックアップからの復元を提案
- JSON解析失敗時はデフォルト値を使用
- エラー詳細をローカルログに記録

**ビジネスロジックエラー**:
- 空き時間不足時はユーザーに手動調整を促す
- 重複検出時は既存データを優先
- ポリシー違反時はユーザーに警告を表示

### ログ記録

すべてのエラーは以下の情報とともにローカルログに記録:
- タイムスタンプ
- エラー種別
- エラーメッセージ
- スタックトレース
- コンテキスト情報（実行中の操作、関連データ）

## テスト戦略

### デュアルテストアプローチ

PomBlockの正確性を保証するため、ユニットテストとプロパティベーステストの両方を使用します。

**ユニットテスト**:
- 特定の例やエッジケースの検証
- コンポーネント間の統合ポイントの検証
- エラー条件の検証
- 例: 初回起動時のOAuthフロー、ネットワークエラー時のリトライ、空き時間不足時の通知

**プロパティベーステスト**:
- 普遍的なプロパティの検証
- ランダム化による包括的な入力カバレッジ
- 各プロパティテストは最低100回の反復実行
- 各テストはデザインドキュメントのプロパティを参照
- タグ形式: **Feature: blocksched, Property {番号}: {プロパティテキスト}**

### プロパティベーステストライブラリ

Rustでは**proptest**または**quickcheck**を使用:

```rust
use proptest::prelude::*;

proptest! {
    // Feature: blocksched, Property 8: ブロック生成時の重複回避
    #[test]
    fn test_block_generation_no_overlap(
        existing_events in prop::collection::vec(arb_calendar_event(), 0..20)
    ) {
        let generator = BlockGenerator::new(Arc::new(default_policy()));
        let blocks = generator.generate_blocks(NaiveDate::from_ymd(2024, 1, 15), &existing_events)?;
        
        // すべてのブロックが既存イベントと重複しないことを検証
        for block in &blocks {
            for event in &existing_events {
                assert!(!overlaps(&block, &event));
            }
        }
    }
}
```

TypeScriptでは**fast-check**を使用:

```typescript
import fc from 'fast-check';

// Feature: blocksched, Property 27: 設定のGitラウンドトリップ
test('policy round-trip through Git', () => {
  fc.assert(
    fc.property(fc.record({
      work_hours: arbWorkHours(),
      block_duration_minutes: fc.integer(10, 120),
      break_duration_minutes: fc.integer(5, 30),
    }), async (policy) => {
      const repo = new GitRepository('./test-repo');
      await repo.write_file('policy.json', JSON.stringify(policy));
      const loaded = JSON.parse(await repo.read_file('policy.json'));
      expect(loaded).toEqual(policy);
    }),
    { numRuns: 100 }
  );
});
```

### テストカバレッジ目標

- ユニットテスト: 各コンポーネントの主要パスとエッジケース
- プロパティテスト: デザインドキュメントの全32プロパティ
- 統合テスト: エンドツーエンドのワークフロー（認証→同期→ブロック生成→承認→ポモドーロ実行）

### テストデータ生成

プロパティテストでは以下のアービトラリ（ランダムデータ生成器）を定義:

- `arb_calendar_event()`: ランダムなカレンダーイベント
- `arb_block()`: ランダムなブロック（各確定度）
- `arb_task()`: ランダムなタスク
- `arb_policy()`: ランダムなポリシー
- `arb_routine()`: ランダムなルーティーン
- `arb_template()`: ランダムなテンプレート
- `arb_oauth_token()`: ランダムなOAuthトークン（有効/無効）

エッジケースを含むように設定:
- 空のイベントリスト
- 勤務時間外のイベント
- 重複するイベント
- 非常に短い/長いブロック
- 空白文字のみのタスク名
- 期限切れトークン
