# Routine Page Adjustments

## Requirements
- 定型予定の72h表示で、当日24h帯が一目で分かるように視認性を上げる
- 中央ペインの高さを他ペイン同様に1画面内へ収め、中央ペイン内スクロールで調整できるようにする
- 「前日/翌日 +24h」の説明文は出さない

## Progress
- [done] 現状の72hタイムライン表示とスクロール崩れ箇所を特定
- [done] 当日24h帯を強調するラベル付きハイライトへ更新
- [done] 中央ペインを1画面内に収め、中央ペイン内スクロールへ寄せるレイアウト調整
- [done] レビュー指摘2件（空枠DnDターゲット反映、dayOffset読込順序）を修正
- [doing] 最終確認（`node.exe` 不在のため静的確認中心）
- [next] 実行環境の `node.exe` が利用可能なら `build:ui` を再実行

## Review And Commits
- Bugs: `pointer-dnd.ts` で空枠エリアも挿入ターゲット計算に含めるよう修正、`actions.ts` で `dayOffset` を加味した読込順ソートへ修正
- Maintainability: viewport差し引き値をCSS変数化して重複を削減
- Commit: pending

## Verification
- `git diff --check` passed for the edited files
- `npm run build:ui` could not run in this shell because `node.exe` is not available
- `npm run typecheck` is blocked for the same reason

## Open
- `node.exe` が見つかれば `src-ui/dist` を再生成してテストまで通す
