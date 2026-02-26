# PomBlock v2コンセプト差分ドキュメント（現行実装同列評価）

作成日: 2026-02-25  
比較基準: `doc/v2/concept.md` vs 現行実装（`src`・`src-ui`・`src-tauri`・`config`）

## 1. 目的と比較範囲
- 本書の目的は、`doc/v2/concept.md` を基準に、現行プロダクトとの差分を実装観点で可視化すること。
- 差分は「欠落」だけでなく「既に一致している点」も含めて整理する。
- 本書は実装者が次の着手判断を追加で行わなくてよい粒度（API/型/設定/優先度）で記述する。

比較対象（同列評価）:
- `src`（Node.js ドメイン/アプリ層、CLI、SQLite リポジトリ）
- `src-ui`（Tauri フロントエンド SPA）
- `src-tauri`（Rust バックエンド、Tauri コマンド、同期・認証）
- `config`（運用設定スキーマ）

## 2. 評価基準と優先度ルール（P0/P1/P2）

### 2.1 適合度
- `一致`: v2要件を現行がほぼ満たす
- `部分一致`: 一部機能はあるが、v2の体験/責務に未達
- `差分`: v2要件に対して未実装または設計不一致

### 2.2 優先度（Impact × Urgency）
- `P0`: v2コンセプトの中核価値（迷わず開始・制約駆動実行）に直結し、未対応だと方向性が成立しない
- `P1`: v2運用を安定させるために必要（継続運用・可観測性・設定整合）
- `P2`: 維持改善・統合整理。P0/P1完了後でも成立する

## 3. 現状スナップショット（機能/画面/API/データ）

### 3.1 機能
- ブロック生成: テンプレート/ルーチンを展開し、未充足時間帯を `rtn:auto:*` で自動補完
- 同期: Google OAuth、syncToken差分同期、cancelledイベントから suppression 保存
- 再配置: 同期差分に応じた自動 `relocate_if_needed` 実行
- 実行: ポモドーロ開始/一時停止/再開/完了/進行（`advance`）
- タスク: 作成/更新/削除/分割/繰り越し

### 3.2 画面
- 現行ナビゲーションは `dashboard / blocks / pomodoro / tasks / reflection (+ settings)`
- v2が要求する `Today / Now / Routines / Insights` の4画面構造とは情報設計が異なる

### 3.3 API（Tauriコマンド）
- 主要コマンド: `generate_blocks`, `sync_calendar`, `start_pomodoro`, `pause_pomodoro`, `resume_pomodoro`, `advance_pomodoro`, `complete_pomodoro`, `list_tasks`, `carry_over_task`, `get_reflection_summary` など
- `Recipe` 管理系コマンドは未定義

### 3.4 データ
- `src` 側は SQLite 永続化（blocks/tasks/pomodoro_logs/suppressions/audit_logs）
- `src-tauri` 側は実行時状態をメモリ保持し、SQLiteは主に sync_state/suppressions 用途
- `Recipe` エンティティおよび `recipes.json` は未導入

## 4. v2との差分マトリクス

| ID | カテゴリ | v2要件 | 現状実装 | 差分 | 影響 | 推奨対応 | 優先度 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G01 | コンセプト軸 | 日常運用の主語を「計画」ではなく「開始」に置く | `dashboard` で同期・生成を手動実行する導線が中心 | 開始より計画操作が前面 | 毎日5分以内で「迷わず着手」の体験が弱い | Today画面を「確認+微調整」に限定し、生成/同期を自動化 | P0 | `doc/v2/concept.md`, `src-ui/app.js:1775`, `src-ui/app.js:1828` |
| G02 | コンセプト軸 | マクロ制約（Block）+ ミクロ制約（Recipe/Timer）の二層 | Block + Pomodoro はあるが Recipe 概念は未導入 | ミクロ制約が「レシピ化」されていない | v2の核である「毎回同じ手順で開始」が成立しない | Recipe中心モデルへ再編 | P0 | `doc/v2/concept.md`, `src-tauri/src/domain/models.rs:25`, `src/domain/models.js:116` |
| G03 | コンセプト軸 | 制約強度 `draft/soft/hard` を使い分ける | `Firmness` と承認で `soft` への昇格を実装 | 概念は概ね一致 | v2移行時の再利用余地が高い | 現行挙動を維持しつつ Recipe連携へ拡張 | P2 | `src-tauri/src/domain/models.rs:6`, `src-tauri/src/application/commands.rs:1222` |
| G04 | ドメインモデル | Blockに必須Recipeを紐づける | Blockは `planned_pomodoros` のみで `recipe_id` なし | Recipe参照軸が欠落 | ブロック開始時の自動選択不能 | `Block.recipe_id` を追加し必須化 | P0 | `doc/v2/concept.md`, `src-tauri/src/domain/models.rs:25`, `src/domain/models.js:116` |
| G05 | ドメインモデル | Block Contents（task list/memo/checklist/time split）を保持 | JS Blockに `taskRefs` はあるが構造化 contents はない。Rust Blockは task参照自体なし | 中身情報モデルが不足 | Now画面での実行補助情報が薄い | `Block.contents` を構造化追加 | P0 | `doc/v2/concept.md`, `src/domain/models.js:139`, `src-tauri/src/domain/models.rs:25` |
| G06 | ドメインモデル | Routine = Block定義 + Recipe定義のセット | Routineは rrule と block属性中心。`recipe_id` なし | Routineの責務がv2より狭い | ルーチン実行の再現性不足 | `Routine.recipe_id` と発生/制約項目を明示追加 | P0 | `doc/v2/concept.md`, `src-tauri/src/domain/models.rs:267`, `src-tauri/src/application/commands.rs:3207` |
| G07 | タイマー実行 | Auto-Drive (`manual`/`auto`/`auto-silent`) | 手動 `start_pomodoro` 起点のみ | 自動開始モード未実装 | 「時間になったら始まる」体験がない | AutoDriveMode導入、ブロック時刻トリガー起動を追加 | P0 | `doc/v2/concept.md`, `src-tauri/src/lib.rs:167`, `src-ui/app.js:2047` |
| G08 | タイマー実行 | レシピのステップ種別（pomodoro/micro/free）実行 | Focus/Break中心の単一セッションモデル | ステップ種別が不足 | マイクロタイマー要件を満たせない | `RecipeStep` 実行エンジンを追加 | P0 | `doc/v2/concept.md`, `src-tauri/src/domain/models.rs:85`, `src/domain/pomodoroTimer.js:97` |
| G09 | タイマー実行 | Now画面で `Next/Pause/Interrupt/Resume` を提供 | Backendに `advance_pomodoro` はあるが、UIは Next/Interrupt を露出していない | UI操作セットが不足 | 実行中の介入がv2要件と不一致 | `next_step` と `interrupt_timer` をUI/コマンドに追加 | P0 | `doc/v2/concept.md`, `src-tauri/src/lib.rs:192`, `src-ui/app.js:2031` |
| G10 | 自動生成 | 毎朝自動生成 + 起動時キャッチアップ | 生成コマンドは手動実行中心。policy項目はあるが導線未接続 | オーケストレーション不足 | 日次運用の自動化が未成立 | `generate_today_blocks` と起動時自動実行フックを実装 | P0 | `doc/v2/concept.md`, `config/policies.json`, `src-ui/app.js:1837`, `src/cli.js:14` |
| G11 | 自動生成 | 生成時に各ブロックへレシピ紐づけ済み | ブロックは duration/pomodoros ベースで生成 | レシピ事前紐付けなし | 開始時に迷いが発生 | 生成時に `recipe_id` を解決して埋める | P0 | `doc/v2/concept.md`, `src-tauri/src/application/commands.rs:3172`, `config/routines.json` |
| G12 | 自動生成 | 未完了タスクを翌日ブロックへ自動吸収 | `carry_over_task` は手動操作で実行 | 自動持ち越し未実装 | タスク再配置の手作業が残る | 日次生成フローに未完了自動割当を追加 | P1 | `doc/v2/concept.md`, `src-tauri/src/lib.rs:259`, `src-ui/app.js:2200` |
| G13 | UI情報設計 | 4画面（Today/Now/Routines/Insights）へ収束 | 現行は `dashboard/blocks/pomodoro/tasks/reflection/settings` | IAがv2と不一致 | 学習コストと操作分散が増える | 画面再編（Today/Now/Routines/Insights）を実施 | P0 | `doc/v2/concept.md`, `src-ui/app.js:10`, `src-ui/index.html:52` |
| G14 | UI情報設計 | Routines内に Routine/Micro/Pomodoro 編集画面 | SettingsにJSONテキスト欄のみ | 専用編集UX不足 | ルーチン整備の継続性が低い | Routines専用エディタ群を実装 | P0 | `doc/v2/concept.md`, `src-ui/app.js:2270` |
| G15 | UI情報設計 | Insightsで日次/週次傾向を可視化 | Reflectionは期間集計とログ一覧中心 | トレンド分析が限定的 | 改善サイクルの解像度不足 | Insightsで週次推移/未完傾向/完了率を追加 | P1 | `doc/v2/concept.md`, `src-ui/app.js:2215`, `src-tauri/src/application/commands.rs:2241` |
| G16 | データ永続化 | 実行ログをローカルDBへ詳細保存 | `src` 側は保存、`src-tauri` 側はメモリ中心 | 実装間で保存戦略が不統一 | 再起動後の再現性が実装ごとに変化 | 永続化責務をTauri側へ統一し単一仕様化 | P1 | `src/infrastructure/localStorageRepository.js:193`, `src-tauri/src/application/commands.rs:150`, `src-tauri/sql/schema.sql` |
| G17 | データ永続化 | ログ肥大化を抑える自動アーカイブ | アーカイブポリシー未定義 | 運用ポリシー欠落 | 長期運用でDB肥大・性能低下リスク | ログ保持期間と集約アーカイブバッチを追加 | P1 | `doc/v2/concept.md`, `src-tauri/sql/schema.sql`, `src/infrastructure/sql/schema.sql` |
| G18 | データ永続化 | 外部反映は日次/週次集計中心 | 集計の外部書き戻し仕様が未実装 | 連携方針の未実装 | ローカル実績と外部可視化が分断 | 集計イベント生成APIを追加（任意ON） | P2 | `doc/v2/concept.md`, `src-tauri/src/application/commands.rs:2241` |
| G19 | 設定/運用 | `recipes.json` を設定スキーマに追加 | 設定は app/calendars/policies/templates/routines/overrides のみ | レシピ定義の保存先なし | Recipe機能実装の前提欠落 | `recipes.json` 新設 + schema=1定義 | P0 | `config`, `src/config/defaults.js`, `src-tauri/src/infrastructure/config.rs` |
| G20 | 設定/運用 | Routineに recipe関連項目を保持 | routineは時刻/期間/block属性中心 | ルーチンとレシピの結合不足 | 自動選択ロジックが構築できない | `routines.json` に `recipeId/autoDriveMode` を追加 | P0 | `doc/v2/concept.md`, `config/routines.json`, `src-tauri/src/application/commands.rs:3207` |
| G21 | 設定/運用 | observed/estimated + soft/hard/temporary上書き運用 | JSは `mode` と重みあり、Tauriは最小上書き | 運用パラメータ体系が不完全/不統一 | 働き方非依存設計の説明可能性が弱い | overrideモデルを統一し由来メタデータを追加 | P1 | `doc/v2/concept.md`, `src/domain/models.js:83`, `src-tauri/src/domain/models.rs:210`, `config/overrides.json` |
| G22 | 同期連携 | 外部編集吸収と削除復活防止 | cancelled同期→suppression保存、再生成時に抑止 | 主要要件は一致 | v2移行時の基盤として活用可能 | 現行方針を維持し、Recipe関連メタを同様に同期 | P2 | `src-tauri/src/application/calendar_sync.rs`, `src-tauri/src/application/commands.rs:932`, `src/application/externalEditService.js` |
| G23 | 同期連携 | OAuth機密の安全保存（ローカル保護） | Windows Credential Manager 保存を実装 | 要件一致（Tauri側） | 認証運用の安全性は確保済み | 維持。複数アカウント運用のUI整備のみ追加 | P2 | `src-tauri/src/application/commands.rs:2335`, `src-tauri/src/infrastructure/credential_store.rs` |
| G24 | 同期連携 | プロダクト全体で一貫したSoTと実装責務 | `src` と `src-tauri` で実装責務が分散し重複 | 仕様解釈が二重化 | v2移行時の実装コストと不整合リスク増大 | v2では Tauri主系へ責務一本化、`src`は補助用途へ整理 | P1 | `src`, `src-tauri`, `package.json` |

## 5. 対応方針（優先度別ロードマップ）

### P0（v2成立に必須）
1. Recipeファーストのドメイン再設計を実施する（G02/G04/G05/G06）。  
理由: v2価値の中核である「迷わず開始」の前提がここで決まるため。
2. Auto-Drive + ステップ実行エンジンを実装する（G07/G08/G09）。  
理由: レシピを実行体験に落とし込む最短経路であり、Now体験の品質を規定するため。
3. Today/Now/Routines/Insightsの4画面へ情報設計を再編する（G01/G13/G14）。  
理由: 画面構成が現行のままではv2の行動導線を表現できないため。
4. 日次自動生成オーケストレーションを導入する（G10/G11）。  
理由: 自動生成と事前レシピ紐付けがないとv2運用は毎日手動になるため。
5. `recipes.json` と routine recipe連携スキーマを追加する（G19/G20）。  
理由: 実装より先に設定契約を固定しないと機能拡張が不安定になるため。

### P1（運用安定化）
1. 未完了タスクの自動持ち越しを生成フローへ組み込む（G12）。  
理由: 再計画コストを下げ、日次運用を閉ループ化するため。
2. 永続化責務を統一し、再起動後の状態再現性を固定する（G16/G24）。  
理由: 実装間差異が残るとv2検証結果が再現不能になるため。
3. Insightsを週次傾向まで拡張する（G15）。  
理由: 振り返り品質が低いと改善サイクルが回らないため。
4. ログアーカイブと保持ポリシーを実装する（G17）。  
理由: 長期運用時の性能/容量リスクを先に制御するため。
5. overrideモデルを observed/estimated 含めて統一する（G21）。  
理由: 働き方非依存の説明可能性と調整容易性を担保するため。

### P2（維持改善）
1. 集計結果の外部反映（任意）を実装する（G18）。  
理由: v2成立には必須ではないが、可視性向上に効くため。
2. 同期・認証の既存強みを維持しRecipeメタへ拡張する（G22/G23）。  
理由: 既に動作する信頼基盤を壊さず拡張できるため。

## 6. 公開API・型・設定スキーマの変更点

### 6.1 追加ドメイン型（新規）
```ts
type AutoDriveMode = "manual" | "auto" | "auto-silent";

type RecipeStepType = "pomodoro" | "micro" | "free";

interface RecipeStep {
  id: string;
  type: RecipeStepType;
  title: string;
  durationSeconds: number;
  pomodoro?: {
    focusSeconds: number;
    breakSeconds: number;
    cycles: number;
    longBreakSeconds?: number;
    longBreakEvery?: number;
  };
  overrunPolicy?: "notify_and_next" | "wait";
}

interface Recipe {
  id: string;
  name: string;
  blockType: "deep" | "shallow" | "admin" | "learning";
  autoDriveMode: AutoDriveMode;
  steps: RecipeStep[];
}

interface BlockContents {
  taskRefs: string[];
  memo?: string;
  checklist?: { id: string; label: string; checked: boolean }[];
  timeSplits?: { label: string; minutes: number }[];
}
```

### 6.2 既存型の拡張（破壊的変更を明示）
```ts
interface Block {
  // 既存項目は維持
  id: string;
  instance: string;
  date: string;
  startAt: string;
  endAt: string;
  type: "deep" | "shallow" | "admin" | "learning";
  firmness: "draft" | "soft" | "hard";
  plannedPomodoros: number;
  source: string;
  sourceId: string | null;

  // 追加項目
  recipeId: string;                 // 必須
  autoDriveMode: AutoDriveMode;     // 必須
  contents: BlockContents;           // 必須（空構造可）
}

interface Routine {
  id: string;
  name: string;
  rrule: string;
  blockType: "deep" | "shallow" | "admin" | "learning";
  firmness: "draft" | "soft" | "hard";
  durationMinutes: number;

  // 追加項目
  recipeId: string;                 // 必須
  autoDriveMode?: AutoDriveMode;    // 未指定時はRecipe継承
}
```

### 6.3 Tauriコマンド拡張候補
- Recipe管理
  - `list_recipes()`
  - `create_recipe(payload)`
  - `update_recipe(recipe_id, payload)`
  - `delete_recipe(recipe_id)`
- タイマー制御（Recipeステップ対応）
  - `start_block_timer(block_id)`
  - `next_step()`
  - `pause_timer(reason?)`
  - `interrupt_timer(reason)`
  - `resume_timer()`
- 自動生成
  - `generate_today_blocks(account_id?)`

移行方針:
- 既存 `start_pomodoro/pause_pomodoro/resume_pomodoro/advance_pomodoro` は互換レイヤとして暫定維持
- 新UIは `start_block_timer` 系へ移行

### 6.4 設定スキーマ拡張
- `recipes.json`（新設）
```json
{
  "schema": 1,
  "recipes": [
    {
      "id": "rcp-morning-micro",
      "name": "朝支度",
      "blockType": "admin",
      "autoDriveMode": "auto",
      "steps": [
        { "id": "s1", "type": "micro", "title": "着替え", "durationSeconds": 180 },
        { "id": "s2", "type": "micro", "title": "朝食", "durationSeconds": 900 }
      ]
    }
  ]
}
```
- `routines.json`（拡張）
  - `recipeId` を必須化
  - 任意で `autoDriveMode` を上書き可能にする
- `policies.json`（拡張）
  - `generation.todayAutoGenerate`
  - `generation.generateOnAppStart`
  - `timer.defaultAutoDriveMode`
  - `timer.overrunPolicy`

## 7. 検証シナリオ（受け入れ条件）

| ID | シナリオ | 手順（要約） | 合格条件 |
| --- | --- | --- | --- |
| S1 | ブロック開始時にレシピ自動選択 | Todayで対象ブロック開始 | `recipeId` が解決済みで選択UIなしで開始可能 |
| S2 | Auto-Drive自動開始/自動遷移 | `auto` / `auto-silent` ブロックを時刻到達させる | 開始と次ステップ遷移が自動で進む |
| S3 | マイクロタイマーステップ進行 | `micro` ステップ列を含むRecipeを実行 | ステップ順序・残時間・完了状態が正しく遷移 |
| S4 | Today表示時に当日生成済み | アプリ起動してTodayを開く | 当日 `draft` ブロックが既に存在 |
| S5 | Now操作セット成立 | 実行中に `Next/Pause/Interrupt/Resume` 操作 | 各操作が状態遷移とログに反映 |
| S6 | Routines編集可能 | Routine/Micro/Pomodoroエディタで編集保存 | 保存後に次回生成へ反映 |
| S7 | Insights傾向可視化 | 1週間分実行データを投入 | 日次/週次推移・完了率・未完傾向が表示 |
| S8 | 再起動後もログ保持 | 実行後に再起動し再表示 | 実行ログと集計値が保持される |

## 8. 根拠一覧（参照ファイル）
- v2基準
  - `doc/v2/concept.md`
- 現行UI
  - `src-ui/index.html`
  - `src-ui/app.js`
  - `src-ui/styles.css`
- 現行Tauri
  - `src-tauri/src/lib.rs`
  - `src-tauri/src/domain/models.rs`
  - `src-tauri/src/application/commands.rs`
  - `src-tauri/src/application/calendar_sync.rs`
  - `src-tauri/src/infrastructure/config.rs`
  - `src-tauri/src/infrastructure/event_mapper.rs`
  - `src-tauri/sql/schema.sql`
- 現行Node実装
  - `src/domain/models.js`
  - `src/domain/pomodoroTimer.js`
  - `src/domain/blockGenerator.js`
  - `src/domain/policy.js`
  - `src/application/blockPlanningService.js`
  - `src/application/taskManager.js`
  - `src/application/reflectionService.js`
  - `src/application/externalEditService.js`
  - `src/infrastructure/localStorageRepository.js`
  - `src/infrastructure/gitRepository.js`
  - `src/infrastructure/sql/schema.sql`
- 設定
  - `config/app.json`
  - `config/policies.json`
  - `config/routines.json`
  - `config/templates.json`
  - `config/overrides.json`
  - `config/calendars.json`
