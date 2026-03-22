# Current App Review Remediation

## Requirements
- `doc/current_app_review.md` の指摘に対して、現行アプリの実装を改善する。
- 実装はタスクを分割し、意味のある単位で段階的にコミットする。
- 主要導線、UI/UX、コード保守性の観点で実害の大きい点から優先的に改善する。

## Progress
- [done] レビュー文書の読込と修正対象の要件化
- [done] 実装スライスの分割と並列作業の開始
- [done] Today導線追加、主要文言の日本語統一、タイマー操作アイコンの明確化
- [done] Routine Studio の中間幅レイアウト改善（操作フッターの視認性強化）
- [done] `app-runtime.ts` のタイマー制御モデルを `timer-controls.ts` へ分離
- [doing] 並列レビュー（bugs / maintainability）の取り込み
- [next] 最終整合とコミット整理

## Review And Commits
- Bugs: pending
- Maintainability: pending
- Commit: pending

## Open
- レビュー文書に含まれる全論点を 1 回で完全解消するのは規模が大きいため、今回は高影響領域を優先して段階改善する。
