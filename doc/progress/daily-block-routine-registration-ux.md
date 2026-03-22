# Today内ブロック/ルーティーン登録UX改善

## Requirements
- 1日の中でブロック登録をより素早く行えること。
- 1日の中でルーティーン適用をより素早く行えること。
- Today画面の操作導線を中心に改善し、登録操作の往復を減らすこと。
- 実装はタスクを分割し、段階コミットすること。

## Progress
- [done] 現状コード調査（Today/Now/Routines/commands）
- [done] Today画面のクイック登録導線を実装
- [done] サブエージェントレビュー（bugs / maintainability）反映
- [doing] 検証と最終コミット

## Review And Commits
- Bugs: `routine_studio` 以外の候補表示、空時刻送信の2件を指摘。いずれも修正済み。
- Maintainability: Today詳細にコマンド分岐重複の指摘。生成処理を関数化して重複を縮小。
- Commit: pending

## Open
- `apply_studio_template_to_today` が使えない環境では既存ルーティーン編集画面へのフォールバック導線を維持する。
- この実行環境では `node` 未解決のため `npm run build:ui` を実行できず、型ビルド確認はユーザー環境依存。
