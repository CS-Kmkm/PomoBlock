# PomBlock v2 実装スナップショット（2026-02-25）

## 1. 概要

本ドキュメントは、2026-02-25 時点で実装済みの v2 対応内容を記録する。
対象は「v2 の中核導線を成立させるための第一段階実装」であり、既存 API との互換レイヤを維持したまま移行可能な状態にした。

## 2. 実装済み範囲

### 2.1 ドメイン/設定（Recipe + AutoDrive）

- `Recipe` / `RecipeStep` / `BlockContents` / `AutoDriveMode` を Rust ドメインに追加。
- `Block` に `recipe_id` / `auto_drive_mode` / `contents` を追加。
- `Routine` に `recipe_id` / `auto_drive_mode` を追加。
- `recipes.json` を新設し、既定設定にも組み込み。
- `policies.json` に v2 キーを追加。
  - `generation.todayAutoGenerate`
  - `generation.generateOnAppStart`
  - `timer.defaultAutoDriveMode`
  - `timer.overrunPolicy`

### 2.2 Tauri API

- Recipe 管理 API を追加。
  - `list_recipes`
  - `create_recipe`
  - `update_recipe`
  - `delete_recipe`
- タイマー操作 API（v2 名）を追加。
  - `start_block_timer`
  - `next_step`
  - `pause_timer`
  - `interrupt_timer`
  - `resume_timer`
- 日次生成 API を追加。
  - `generate_today_blocks`
- 既存 pomodoro API は互換のため維持し、新 API は既存実装を活用する互換レイヤ構成とした。

### 2.3 生成ロジック

- ブロック生成時に `recipe_id` / `auto_drive_mode` を解決して `Block` に埋め込むよう変更。
- 解決優先順位:
  1. routine/template 側の明示指定
  2. block type 対応レシピ
  3. 既定レシピ（`rcp-*-default`）
- Auto 生成ブロック（`rtn:auto:*`）にもレシピを付与。

### 2.4 UI（4画面 IA への再編）

- ナビゲーションを v2 4画面へ変更。
  - `Today`
  - `Now`
  - `Routines`
  - `Insights`
- `Today`:
  - 同期 + 当日再生成 + タイムライン確認導線を維持。
  - 起動時に `generate_today_blocks`（fallback: `generate_blocks`）を実行。
- `Now`:
  - `Start / Next / Pause / Interrupt / Resume` を提供。
  - 新 API 優先 + 旧 API fallback。
- `Routines`:
  - Recipe 一覧/作成/更新/削除 UI を追加。
- `Insights`:
  - 既存 reflection を改名し、完了率表示を追加。

## 3. 互換性方針

- 旧 API は維持（`start_pomodoro` など）。
- UI は新 API 優先で呼び出し、未実装環境では旧 API にフォールバックする。
- これにより段階移行中でも既存機能の動作を維持できる。

## 4. テスト結果

実行日: 2026-02-25

- `npm run rust:check` : 成功（warning のみ）
- `cargo test --lib` : 51 passed
- `npm test` : 34 passed
- `node --check src-ui/app.js` : 成功

## 5. 未対応/次フェーズ

- `auto` / `auto-silent` の「時刻到達で常駐自動開始」スケジューラ本体。
- `RecipeStep` の厳密な実行エンジン（現状は pomodoro 互換レイヤ中心）。
- `Routines` の本格エディタ（現状は JSON ベース編集）。
- Insights の週次トレンド分析拡張。
- 実行ログ永続化/アーカイブの v2 完全統一。
