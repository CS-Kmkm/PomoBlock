# PomBlock v1.1 実装レビューレポート

**対象ブランチ:** v1.1  
**レビュー日:** 2026-02-21  
**参照ドキュメント:**
- `initial_doc/blocksched_concept.md` (v1.2)
- `initial_doc/blocksched_spec.md` (v1.2)
- `initial_doc/issues.md`
- `.kiro/specs/blocksched/requirements.md`
- `.kiro/specs/blocksched/design.md`
- `.kiro/specs/blocksched/tasks.md`

---

## 1. エグゼクティブサマリー

PomBlock v1.1 は、コンセプトの中核インフラ（OAuth・差分同期・ポモドーロ・SQLite 永続化）は堅実に実装されている。一方、「計画→実行→再計画」サイクルを閉じるために不可欠な **suppression（削除復活防止）の生成フロー接続**、**割り込み自動再配置**、**タスク繰り越し/分割の UI 公開** が未達成であり、v1 の成功指標（重複生成なし・勝手な復活なし）を満たせていない。

---

## 2. 評価サマリー表

### 2.1 コンセプト・仕様ドキュメント（initial_doc）対応

| Epic | 項目 | 評価 | 主な根拠 |
|------|------|:----:|---------|
| E0 基盤 | ドメインモデル・DB基盤・設定読み込み | ✅ | `models.js/rs`・SQLite スキーマ完備 |
| E1 Calendar同期 | OAuth・syncToken・bs_*マッパー・410復旧 | ✅ | `CalendarSyncService`・`WindowsCredentialManagerStore` |
| E2 生成MVP | 重複防止のみ。suppression 未接続・テンプレ/ルーティーン未参照 | ⚠️ | `generate_blocks_impl` に suppressions 照合なし |
| E3 配置戦略 | keep 戦略のみ。Freebusy 未使用・shift 未実装 | ⚠️ | `BlockGenerator.relocateBlock` あり、shift 戦略なし |
| E4 実行導線 | Tauri コマンド実装済み。Node.js CLI は最小限 | ⚠️ | `cli.js` は `init`/`status` のみ |
| E5 実績ログ | ポモドーロ全ライフサイクル・監査ログ完備 | ✅ | `PomodoroRuntimeState`・`audit_logs` テーブル |
| E6 Git同期 | 機密除外は実装。実 Git 連携はモック | ⚠️ | `GitRepository` はファイルコピーベース |
| E7 品質保証 | TZ/DST 回帰テスト不足。統合テスト未着手 | ❌ | `policy.js` が UTC 固定でTZ未考慮 |

### 2.2 要件定義書（.kiro/specs）対応

| 要件 | タイトル | 評価 | 主な根拠 |
|------|---------|:----:|---------|
| 要件1 | Google Calendar 認証 | ✅ | keyring / proptest P1〜P3 実装済み |
| 要件2 | Google Calendar 同期 | ✅ | syncToken・リトライ・proptest P5〜P7 |
| 要件3 | ブロック生成 | ⚠️ | 自動生成タイミング・suppression 未接続 |
| 要件4 | ブロック確認と承認 | ⚠️ | 承認 UI あり、自動フロー未接続 |
| 要件5 | ポモドーロ実行 | ✅ | 全フェーズ実装・proptest P15〜P18 |
| 要件6 | タスク選択（JIT） | ⚠️ | ロジックあり、繰り越し UI 未公開 |
| 要件7 | 割り込み処理 | ❌ | 自動再配置なし、Tauri 命令未公開 |
| 要件8 | 未完タスク繰り越し | ❌ | JS ロジックあり、Tauri/UI から操作不可 |
| 要件9 | ルーティーン・テンプレ管理 | ⚠️ | JS 側はファイルコピーモック、Rust 実装なし |
| 要件10 | ポリシー管理 | ⚠️ | 基本フィールドのみ。override 評価は部分的 |
| 要件11 | ローカルデータ管理 | ✅ | SQLite CRUD・Credential Manager |
| 要件12 | UI 応答性 | ✅ | プログレスバー・非同期処理済み |
| 要件13 | エラーハンドリング | ✅ | 指数バックオフリトライ・ログ記録 |
| 要件14 | 外部編集の許容 | ⚠️ | 変更検出あり、自動再配置なし |
| 要件15 | 振り返り | ✅ | 集計・グラフ UI・proptest P32 |

---

## 3. 充足項目の詳細

### 3.1 E1 / 要件1・2: OAuth と Calendar 同期

- **`WindowsCredentialManagerStore`** が `keyring` クレートを通じて Windows Credential Manager にトークンを安全保存（要件 1.2・1.5 充足）
- **`OAuthManager.ensure_access_token()`** が有効トークン→再利用、期限切れ→silent refresh、リフレッシュ失敗→再認証フローと完全に網羅（要件 1.3・1.4 充足）
- **`CalendarSyncService`** が syncToken 差分同期・HTTP 410 時の自動フル再同期・指数バックオフリトライを実装（要件 2.1〜2.3 充足）
- **`isSensitivePath()`** でトークン・`state/`・`logs/` のパスへの Git コミットを拒否（要件 1.5・9.5 充足）
- Rust 側プロパティテスト: `oauth.rs` に P1〜P3 の `proptest!` 3件、`calendar_sync.rs` に P5〜P7 の `proptest!` 3件

### 3.2 E0 / ドメインモデルと基盤

- `Block`・`Task`・`PomodoroLog`・`Routine`・`Template`・`Policy` を JS（`models.js`）と Rust（`models.rs`）の双方で定義
- `instance` キー方式（`tpl:<id>:<date>`・`rtn:<id>:<date>`・`man:<id>`）が仕様通りに実装
- SQLite テーブル: `blocks`・`tasks`・`pomodoro_logs`・`sync_state`・`suppressions`・`audit_logs` が完備
- `bootstrapWorkspace` で `config/`・`state/`・`logs/` の初期化フローが確立

### 3.3 E5 / 要件5: ポモドーロ実行

- Rust 側 `PomodoroRuntimeState` が Focus / Break / Paused / Idle の完全なライフサイクルを管理
- `start_pomodoro` → `advance_pomodoro`（Focus→Break 自動遷移）→ `pause_pomodoro` / `resume_pomodoro` → `complete_pomodoro` の全コマンドが Tauri で公開済み
- 割り込み理由・開始/終了時刻を `PomodoroLog` に記録し、`get_reflection_summary` で集計可能
- `audit_logs` テーブルで主要イベントの監査ログを保持

### 3.4 要件12・13: UI 応答性とエラーハンドリング

- `beginLongRunningProgress` / `finishLongRunningProgress` によるプログレスインジケーター実装（要件 12.2 充足）
- UI は `window.__TAURI__` の有無によってモックに自動フォールバック（開発・テスト容易性）
- `CalendarSyncService` の `RetryPolicy`（max_attempts=3, 指数バックオフ）が API 失敗を自動リトライ

---

## 4. 未充足・乖離項目の詳細

### 4.1 【重大】suppression が生成フローに未接続

**関連:** BS-023・BS-024 / コンセプト §7「重複生成/勝手な復活が起きない」

仕様では「差分同期で `status=cancelled` + `bs_instance` を受信したら `state/suppressions` に記録し、自動生成で尊重する」とある。DB の `suppressions` テーブルと `saveSuppression()` / `loadSuppressions()` API は存在するが、`generate_blocks_impl` 内でこれらが参照されていない。

```rust
// commands.rs generate_blocks_impl — suppressions チェックが存在しない
if existing_instances.insert(instance.clone()) && existing_ranges.insert(range_key) {
    // ← ここで loadSuppressions() を参照してフィルタする必要がある
    generated.push(StoredBlock { ... });
}
```

**影響:** ユーザーがカレンダーで削除したブロックが毎朝自動復活する。

---

### 4.2 【重大】テンプレ・ルーティーン定義が生成に未接続

**関連:** BS-020・BS-021 / 仕様 §4.2「期待インスタンス集合（テンプレ＋ルーティーン）を作成」

現実装は「勤務時間内の空き時間を均等分割して `rtn:auto:<date>:<index>` を割り当てる」単純方式。`config/templates.json` と `config/routines.json` は初期化時に生成されるが、ブロック生成時には参照されない。

**影響:** テンプレートやルーティーンを設定しても反映されない。インスタンスキーが固定的なため、テンプレ由来ブロックの冪等生成が機能しない。

---

### 4.3 【重大】割り込み自動再配置が未実装

**関連:** 要件7 / design.md プロパティ23

`BlockPlanningService.relocateIfNeeded()` が JS 側に存在するが、Tauri コマンドとして公開されておらず、UI から起動できない。カレンダーに新しい予定が追加されても、重複するブロックは自動的には再配置されない。

**影響:** 要件 7.2「重複するブロックを別の空き時間に再配置」が事実上未達成。

---

### 4.4 【重大】タスク繰り越し・分割が UI から操作不可

**関連:** 要件8 / BS-051 / tasks.md タスク10.2・10.3

`TaskManager.carryOverTask()` と `splitTask()` は JS 側に実装済みでテストも通過しているが、対応する Tauri コマンド（`carry_over_task`・`split_task`）が `lib.rs` に存在しない。`app.js` の UI にも操作パスがない。

---

### 4.5 【中】タイムゾーン処理の不備

**関連:** BS-070 / 仕様 §10「ユーザーTZを単一の真実として保持」

`policy.js` の `workWindowForDate()` と `filterSlots()` が時刻を UTC 固定（`T${HH:MM}:00.000Z`）で構築しており、ローカルTZが考慮されていない。Rust 側 `commands.rs` も `Utc.from_utc_datetime()` で UTC として扱う。

```javascript
// policy.js — UTC 固定（JST 環境では9時間ずれる）
const workStart = new Date(`${datePart}T${policy.workHours.start}:00.000Z`);
```

**影響:** JST（UTC+9）などの非 UTC 環境では、勤務時間外にブロックが生成される可能性がある。

---

### 4.6 【中】`extendedProperties` のキー名不一致

**関連:** 仕様 §3.1 / design.md §Google Calendar Event 構造

設計書（`design.md`）と仕様書（`blocksched_spec.md`）、実装（`event_mapper.rs`）の間でキー名が統一されていない。

| 設計書（design.md） | 仕様書（spec.md） | 実装（event_mapper.rs） |
|---|---|---|
| `pomblock_block_id` | `bs_id` | `bs_block_id` |
| `pomblock_firmness` | `bs_firm` | `bs_firmness` |
| `pomblock_task_id` | `bs_pp`（ポモドーロ数） | `bs_planned_pomodoros` |
| *(なし)* | `bs_v`, `bs_app`, `bs_kind` | *(なし)* |

また、仕様で必須とされているバージョン識別キー（`bs_v="1"`, `bs_app="blocksched"`, `bs_kind="block"`）が実装に存在しない。

**影響:** 将来の互換性確保が困難。ドキュメントを見て実装しようとすると混乱が生じる。

---

### 4.7 【中】Freebusy API が未使用（shift 戦略・E3 未着手）

**関連:** BS-030〜033 / 仕様 §7 / design.md §4. Policy Engine

仕様では空き枠探索に Google Freebusy API を使い、Blocks カレンダー以外のカレンダーの予定も busy 判定に含めるとしているが、現実装は `sync_calendar` で同期したイベント一覧のみを使う。shift 戦略（`maxShiftMinutes`・`createIfNoSlot`）も未実装。

---

### 4.8 【中】Git 同期が実 Git でない

**関連:** BS-060 / 要件9 / tasks.md タスク11.1

`Cargo.toml` に `git2 = "0.19"` が追加されているが、実際の `GitRepository` は JS 側のファイルコピーベース（`_remote/` ディレクトリへのローカルコピー）のみで、Rust 側の Git 操作実装が存在しない。設定ファイルの実際のリモートリポジトリへの同期は未実装。

---

### 4.9 【低】tasks.md のチェック状態と実装のずれ

`tasks.md` ではタスク1〜22がすべて `[x]` だが、以下は実装が追いついていない：

| タスク | チェック状態 | 実際の状態 |
|---|:---:|---|
| 11.1 GitRepository（libgit2） | ✅ | JS側ファイルコピーのみ、Rust実装なし |
| 15.1 外部編集→自動再配置 | ✅ | 検出のみ、再配置Tauri命令なし |
| 18.4 タスク操作コマンド（繰り越し・分割） | ✅ | `list_tasks`/`create_task` のみ公開 |
| 19.1 TypeScript UI（React/Vue/Svelte） | ✅ | バニラ JavaScript で実装 |
| 22.1 自動生成の毎朝スケジューリング | ✅ | タスクスケジューラ連携コードなし |

---

## 5. 優先度別対応ロードマップ

### P0（v1 リリースブロッカー）

| # | 対応内容 | 関連 Issue |
|---|---------|-----------|
| 1 | `generate_blocks_impl` に `loadSuppressions()` の照合を追加 | BS-024 |
| 2 | `calendar_sync` で `status=cancelled` + `bs_instance` を `suppressions` テーブルに記録する処理を追加 | BS-023 |
| 3 | `workWindowForDate()` と `filterSlots()` をユーザーTZで計算するよう修正 | BS-070 |
| 4 | `bs_v`, `bs_app`, `bs_kind` を `encode_block_event` に追加 | BS-012 |

### P1（v1 機能完成）

| # | 対応内容 | 関連 Issue |
|---|---------|-----------|
| 5 | `carry_over_task` / `split_task` を Tauri コマンドとして公開し UI に追加 | BS-051 |
| 6 | `relocate_if_needed` を Tauri コマンドとして公開し同期後に自動起動 | 要件7 |
| 7 | テンプレート・ルーティーン定義を `generate_blocks_impl` で参照するよう変更 | BS-020〜022 |
| 8 | キャッチアップ生成（PCオフ後の起動時補完）を `bootstrap` に追加 | BS-041 |

### P2（品質・運用改善）

| # | 対応内容 | 関連 Issue |
|---|---------|-----------|
| 9 | Freebusy API を使った busy 収集と shift 戦略の実装 | BS-030〜032 |
| 10 | Rust 側 `GitRepository`（libgit2 使用）の実装 | BS-060 |
| 11 | TZ/DST 回帰テストの追加 | BS-070 |
| 12 | `design.md` のキー名と実装（`bs_*`）の統一・ドキュメント修正 | ドキュメント整合 |
| 13 | Node.js CLI に `sync` / `generate` / `catchup` / `suppress` コマンドを追加 | BS-040 |

---

## 6. テストカバレッジ評価

### 実装済みテスト

| テストファイル / モジュール | 内容 | proptest |
|---|---|:---:|
| `oauth.rs` | P1〜P3 OAuth ラウンドトリップ・再認証 | ✅ |
| `calendar_sync.rs` | P5〜P7 差分同期・SyncToken・キャッシュ | ✅ |
| `models.rs` (Rust) | P8 ブロック生成重複回避（部分） | ✅ |
| `event_mapper.rs` (Rust) | encode/decode 往復テスト | — |
| `blockGenerator.test.js` | 空き枠探索・重複回避 | — |
| `blockPlanningService.test.js` | 計画サービス | — |
| `blockOperationsService.test.js` | 承認・削除・時刻調整 | — |
| `pomodoroTimer.test.js` | タイマーライフサイクル | — |
| `taskManager.test.js` | 繰り越し・分割含む | — |
| `externalEditService.test.js` | P31 外部編集検出・通知 | — |
| `reflectionService.test.js` | P32 集計正確性 | — |
| `e2eWorkflow.test.js` | 統合ワークフロー | — |

### 未実装テスト（tasks.md でチェック済みだが実態なし）

- P9 ポリシーに基づく勤務時間制約（Rust 側）
- P11 重複時間帯での生成防止（Rust 側）
- P23 重複時のブロック再配置（Rust 側）
- P24〜P26 タスク繰り越し・分割・ログ（Tauri 未公開のため統合テスト不可）
- P27〜P28 Git ラウンドトリップ（実 Git 実装が前提）
- TZ/DST 境界の回帰テスト（BS-070）

---

## 7. アーキテクチャ上の懸念事項

### 7.1 JS 層と Rust 層の機能重複

`src/` 配下の JS 実装（`blockGenerator.js`・`blockPlanningService.js`・`externalEditService.js` 等）と `src-tauri/` の Rust 実装が並立しており、ビジネスロジックが2か所に存在する。JS 側はテスト用・開発用として有用だが、**suppression チェックや TZ 計算のバグが一方にしか修正されないリスク**がある。

### 7.2 ランタイム状態のメモリ保持

`RuntimeState`（Rust）がブロック・タスク・ポモドーロ状態をすべてメモリ上の `HashMap` で管理している。アプリ再起動時に `sync_calendar` と `list_blocks` を呼ばないとメモリ上にブロックが存在しない状態になる。起動シーケンスの明示化が必要。

### 7.3 `design.md` の技術スタック記述と実装の乖離

`design.md` は「TypeScript + React/Vue/Svelte」と明記しているが、実装はバニラ JavaScript（`app.js` の 1274 行単一ファイル）。フレームワーク不使用自体は問題ではないが、ドキュメントの更新が必要。

---

## 8. 結論

PomBlock v1.1 は、認証・同期・ポモドーロ・振り返りという **実行導線の根幹** は高い品質で実装されている。しかし「重複生成/勝手な復活が起きない」というコンセプトの最重要成功指標に直結する **suppression フロー** と **TZ 処理** が未接続・不備の状態であり、現時点では v1 リリース要件を満たしていない。

P0 の4件（suppression 接続・TZ 修正・bs_v キー追加・削除検出記録）を優先実装することで、コアコンセプトの充足に大きく近づく。
