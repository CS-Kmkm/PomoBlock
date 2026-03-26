# Routine Schedule Planner

## Requirements
- 定型予定化を Now ページ左側のような 1 日スケジュール一覧 UI にする
- その一覧に GUI でモジュールまたは複合モジュールを挿入できる
- 毎週の曜日指定、毎月の日付指定、第 n 曜日指定の定期設定をできるようにする
- 定期予定の開始日と終了日をカレンダー入力で指定できるようにする
- 設定内容を保存して再読込できるようにする

## Progress
- [done] 既存の Routine/Now UI と既存スケジュール解釈の調査
- [done] routines.json 向けの list/save/delete CRUD と mock 経路を実装
- [done] 定期予定の date range, weekly, monthly, nth weekday 判定を backend に追加
- [done] 互換コマンド `list_routines` / `save_routine_schedule_group` を追加
- [done] 定型予定化 UI を 1 日スケジュール一覧 + GUI 挿入 + 繰り返し設定に刷新
- [done] 保存時の schedule group 解決と Tauri payload 形状を修正
- [done] Rust regression tests を追加
- [done] `cargo test routine_schedule --lib`
- [done] `cargo test configured_block_plans --lib`
- [blocked] `npm run build:ui` はこの環境で Node.js 未検出のため未実施

## Review And Commits
- Bugs: pending
- Maintainability: pending
- Commit: pending

## Open
- モジュール単体の定期予定は保存時に単一ステップ recipe を自動生成して routines.json から参照する方針
