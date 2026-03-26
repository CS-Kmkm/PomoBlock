# Routine Studio Schedule Three Pane

## Requirements
- 定型予定化ページを他ページ同様の3ペイン構成にする。
- 左ペインには既存のルーティーン編集ページと同一の画面を表示する。
- 中央ペインには Now の左ペインに近い、1日のスケジュールを縦に並べるUIを置く。
- 中央ペインへモジュール/複合モジュールをドラッグして予定を作成できるようにする。
- 右ペインには既存の繰り返し設定と保存/適用操作を配置する。

## Progress
- [done] 既存の Routine Studio 実装と Now スケジュールUIを確認
- [done] schedule サブページを3ペイン化
- [done] 左ペインを「編集ページ左ペイン相当のフォルダ別一覧」に修正
- [done] 中央スケジュールペインの drag-and-drop 追加 / 並べ替えを接続
- [done] 外側3ペインと内側編集レイアウトの干渉を分離
- [doing] レスポンシブ最終調整

## Review And Commits
- Bugs: subagent review 実施。schedule 挿入時の時刻衝突と並び替え非永続化を修正
- Maintainability: subagent review 実施。旧 schedule layout CSS の未使用部分を削除
- Commit: pending

## Open
- schedule サブページでは左ペインに編集画面を常時表示するため、既存 editor サブページの一部UIを再利用して重複を抑える。
- `npm run typecheck` は `node` コマンド未検出のため未実行。
