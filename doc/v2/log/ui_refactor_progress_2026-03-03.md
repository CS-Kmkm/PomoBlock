# UI Refactor Progress (2026-03-03)

## 目的
- `src-ui/app.ts` / `src-ui/app-context.ts` の肥大化を解消し、画面単位 + API境界単位で責務を分離する。
- 既存挙動を維持しつつ、以後の機能追加時の影響範囲を限定する。

## 現在の到達点（更新: 2026-03-04）
- `src-ui/app.ts` はエントリポイントのみ（`startApp()` 呼び出し）。
- `src-ui/app-context.ts` は薄い再エクスポートに縮小し、実装本体は `src-ui/app-runtime.ts` に移行。
- ページ実装は `src-ui/pages/` に分割済み。`tasks-page.ts` を追加してタスク画面ロジックを独立化済み（ルートは非公開維持）。
- `routines` は `routines-page / routines-events / routines-model / routines-dnd / routines-view / routines-pointer-dnd` に分割済み。
- `PageRenderDeps` は `commonHelpers / calendarHelpers / nowHelpers / routineHelpers / taskHelpers` へ分割済み。
- `app-runtime.ts` の一部共通表示ロジック（時刻/時間帯/所要時間ラベル）を `calendar-view-helpers.ts` へ抽出済み。
- `app-runtime.ts` は `setStatus` / `refreshCoreData` / `refreshNowPanelState` / `authenticateAndSyncCalendar` の型を段階改善済み。

## 実装済みコミット
- `b6f46f3` refactor(ui): split app entry and add page/service scaffolding
- `0deeb44` refactor(ui): extract settings page implementation from app context
- `4752c92` refactor(ui): extract insights page implementation from app context
- `09eed9c` refactor(ui): move details blocks and now page logic out of app context
- `ce4ad28` refactor(ui): migrate today and routines rendering out of app context
- `5fcaebd` refactor(ui): split routines modules and restructure page deps
- `1cd0c8b` refactor(ui): extract routines pointer dnd and today renderers

## 現在のファイル構成（UI）
- `src-ui/app.ts` (2 lines): bootstrap only
- `src-ui/app-context.ts` (~44 lines): `startApp` 再エクスポートのみ
- `src-ui/app-runtime.ts` (~2337 lines): ルーティング/初期化/state/共通ロジック/一部画面補助
- `src-ui/calendar-view-helpers.ts`: カレンダー表示補助（時刻/時間帯/所要時間ラベル）
- `src-ui/services/command-service.ts`: invoke/safeInvoke/progress 実行境界
- `src-ui/pages/today-page.ts`: Today 画面描画
- `src-ui/pages/details-page.ts`: Details 画面描画 + 操作
- `src-ui/pages/now-page.ts`: Now 画面描画 + 操作
- `src-ui/pages/routines-page.ts`: Routines 画面オーケストレータ
- `src-ui/pages/routines-events.ts`: Routines イベント配線（主）
- `src-ui/pages/routines-pointer-dnd.ts`: Routines Pointer DnD配線
- `src-ui/pages/routines-model.ts`: Routines 正規化/履歴補助
- `src-ui/pages/routines-dnd.ts`: DnD補助ロジック
- `src-ui/pages/routines-view.ts`: 描画適用補助
- `src-ui/pages/tasks-page.ts`: Tasks 画面描画 + 操作
- `src-ui/pages/insights-page.ts`: Insights 画面描画
- `src-ui/pages/settings-page.ts`: Settings 画面描画 + 操作
- `src-ui/pages/blocks-page.ts`: Blocks 画面描画 + 操作

## 変更方針（実際に採用したもの）
- 破壊的な全面再設計は避け、段階移行で分離。
- 1回の移行単位ごとに `typecheck` / `build:ui` を通す。
- 既存の command 名・route hash・DOM契約を基本維持。
- 各ページは `PageRenderDeps` の依存注入で `app-context` と結合する。

## 残タスク（優先順）
1. `app-runtime.ts` の更なる分割
- Today/Calendar/Now の共通補助をモジュール単位で追加分離する（`calendar-view-helpers` は分離済み）。

2. 型安全性の改善（継続）
- `app-runtime.ts` に `Unsafe` が残存（現状は主に `mockInvoke`）。`DayBlockDragState` 周辺と command 応答処理の一部は明示型化済み。
- `routines-events.ts` の `Unsafe` は除去済み。応答 payload の境界型をさらに厳密化する。

3. 画面文言の互換確認
- `blocks-page.ts` は主要文言を日本語へ戻し済み。残る英語UI文言がないか画面横断で最終確認する。

## 検証状況
- 直近状態で以下は成功:
- `npm run typecheck`
- `npm run build:ui`

## 次の実装推奨ステップ
1. `app-runtime.ts` から `calendar` 補助と `now` 補助を分離し、ファイル責務を縮小。
2. `Unsafe` が多い関数（`mockInvoke`, `refreshCoreData`, command応答処理）から優先して型を明示化。
3. 文言互換（日本語）を画面横断で確認し必要なら差し戻し。

## 受け入れ基準（次フェーズ）
- `app-context.ts` を 2000 lines 未満に削減。 ✅
- `routines-page.ts` を 4ファイル以上へ分割。 ✅
- `typecheck` / `build:ui` の継続成功。 ✅
- route/hash と command 呼び出し契約を維持。 ✅
