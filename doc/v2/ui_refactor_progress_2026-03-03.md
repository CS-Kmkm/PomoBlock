# UI Refactor Progress (2026-03-03)

## 目的
- `src-ui/app.ts` / `src-ui/app-context.ts` の肥大化を解消し、画面単位 + API境界単位で責務を分離する。
- 既存挙動を維持しつつ、以後の機能追加時の影響範囲を限定する。

## 現在の到達点
- `src-ui/app.ts` はエントリポイントのみ（`startApp()` 呼び出し）。
- ページ実装は `src-ui/pages/` に分割済み。
- コマンド境界は `src-ui/services/command-service.ts` に分離済み。
- `PageRenderDeps` 経由で `app-context.ts` からページへ依存を注入する構成に移行済み。

## 実装済みコミット
- `b6f46f3` refactor(ui): split app entry and add page/service scaffolding
- `0deeb44` refactor(ui): extract settings page implementation from app context
- `4752c92` refactor(ui): extract insights page implementation from app context
- `09eed9c` refactor(ui): move details blocks and now page logic out of app context
- `ce4ad28` refactor(ui): migrate today and routines rendering out of app context

## 現在のファイル構成（UI）
- `src-ui/app.ts` (2 lines): bootstrap only
- `src-ui/app-context.ts` (~2553 lines): ルーティング/初期化/state/共通ロジック/一部画面補助
- `src-ui/services/command-service.ts`: invoke/safeInvoke/progress 実行境界
- `src-ui/pages/today-page.ts`: Today 画面描画
- `src-ui/pages/details-page.ts`: Details 画面描画 + 操作
- `src-ui/pages/now-page.ts`: Now 画面描画 + 操作
- `src-ui/pages/routines-page.ts`: Routines 画面描画 + 操作（最大）
- `src-ui/pages/insights-page.ts`: Insights 画面描画
- `src-ui/pages/settings-page.ts`: Settings 画面描画 + 操作
- `src-ui/pages/blocks-page.ts`: Blocks 画面描画 + 操作

## 変更方針（実際に採用したもの）
- 破壊的な全面再設計は避け、段階移行で分離。
- 1回の移行単位ごとに `typecheck` / `build:ui` を通す。
- 既存の command 名・route hash・DOM契約を基本維持。
- 各ページは `PageRenderDeps` の依存注入で `app-context` と結合する。

## 残タスク（優先順）
1. `app-context.ts` の更なる縮小
- 依然として state 初期化 + mock 実装 + カレンダー操作補助 + task/reflection 画面ロジックが残存。
- 次段で `tasks` 画面・共通 utility を追加分離する。

2. `routines-page.ts` の再分割
- 現在単体で約59KB。以下に再分割推奨:
- `routines-view.ts`（HTML生成）
- `routines-events.ts`（イベント配線）
- `routines-dnd.ts`（DnD専用）
- `routines-model.ts`（正規化・履歴管理）

3. `PageRenderDeps` の整理
- 一時的に `helpers` が肥大化しているため、用途別に小さな依存群へ分割推奨:
- `calendarHelpers`
- `nowHelpers`
- `routineHelpers`
- `taskHelpers`

4. 型安全性の改善
- `Unsafe` / キャストが残っている箇所を `types.ts` の明示型へ段階置換。
- 特に `routines-page.ts` の応答 payload 型を明確化。

5. 画面文言の互換確認
- `blocks-page.ts` の文言は一部英語へ置換済み。互換優先なら日本語へ戻す。

## 検証状況
- 直近状態で以下は成功:
- `npm run typecheck`
- `npm run build:ui`

## 次の実装推奨ステップ
1. `routines-page.ts` を `view/events/dnd/model` へ分割し、`renderRoutinesPage` を薄くする。
2. `app-context.ts` から `renderTasks` と関連ロジックを `pages/tasks-page.ts` へ移設。
3. `PageRenderDeps` の `helpers` をカテゴリ別に分解し、依存注入を縮小。
4. 文言互換（日本語）を確認し必要なら差し戻し。

## 受け入れ基準（次フェーズ）
- `app-context.ts` を 2000 lines 未満に削減。
- `routines-page.ts` を 4ファイル以上へ分割。
- `typecheck` / `build:ui` の継続成功。
- route/hash と command 呼び出し契約を維持。
