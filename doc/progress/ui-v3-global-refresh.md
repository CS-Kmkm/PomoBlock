# UI V3 Global Refresh

## Requirements
- Weekly, Now, Routine Canvas, 定期予定の登録, 管理画面を添付イメージ寄りの新レイアウトへ刷新する
- ヘッダーは全ページ共通コンポーネント化し、各ページから利用する
- 現状未実装の機能はモックでよい
- subagent と git worktree を使って並列実装する
- 画面ごとに適切なコミットを行う
- 成果物と記録を `doc/v3` に保存する

## Progress
- [done] 対象ページと既存レンダリング構造を確認
- [done] 共通ヘッダー差し込み点、worktree 構成、subagent 担当分割を定義
- [done] 並列用 worktree を作成して Weekly / Now / Routines / Settings-Docs を分担
- [done] Weekly を `5e6876c` から取り込み
- [done] Routines を `a9251092d7cc04bd28b7de274618028308919650` から取り込み
- [doing] 共通ヘッダー、Now、Settings/Admin、`doc/v3` を main で統合
- [next] 残り差分をコミットし、検証結果を確定

## Review And Commits
- Bugs: pending
- Maintainability: pending
- Commit: `fb9387e` (`feat(week): refresh weekly planner shell`)
- Commit: `24f3f40` (`feat(routines): refresh studio views`)
- Commit: pending for shared shell / now / settings docs

## Open
- Node / build 実行可否を確認し、可能なら UI build とテストを回す
