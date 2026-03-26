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
- Bugs: `today` ルートの定期更新漏れを修正（5秒ポーリング対象に追加）
- Maintainability: `renderWeekDetailsPage` をモード引数化し、`timer-controls.ts` の型を `types.ts` / week renderer へ統一
- Commit: `5a4fe39` `feat(ui): add today route and unify localized timer controls`
- Commit: `39d2b25` `fix(routines): stabilize mid-width layout and localize schedule labels`
- Commit: `7bc35f9` `docs(progress): record current app review remediation phases`

## Open
- レビュー文書に含まれる全論点を 1 回で完全解消するのは規模が大きいため、今回は高影響領域を優先して段階改善した。
- 環境に `node` 実行バイナリがないため、`npm run build:ui` / `typecheck` は未実行。
