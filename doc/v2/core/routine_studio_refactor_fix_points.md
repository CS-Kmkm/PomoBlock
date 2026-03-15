# Routine Studio 修正要点（機能分割・型定義）

本ドキュメントは、`src-ui/pages/routines-*.ts` の現状レビューをもとに、
「どこをどう直すべきか」を実装に落とせる粒度で整理したもの。

## 1. 主要課題（優先度順）

### P0-1: `renderRoutinesEvents` の責務過多
- 対象: `src-ui/pages/routines-events.ts`
- 問題:
  - 1関数で状態正規化、描画、イベント配線、API呼び出し、DnD連携を同時に実施。
  - 変更時の影響範囲が広く、回帰原因の切り分けが難しい。
- 修正要点:
  - 以下の責務単位に分割する。
    - `studio-state.ts`: 正規化、履歴管理、Entry更新ロジック
    - `studio-actions.ts`: 永続化/API呼び出し（save/apply/delete/update）
    - `studio-bindings.ts`: DOMイベント登録
    - `studio-render.ts`: 画面描画呼び出し（既存 `routines-view.ts` と整合）

### P0-2: 型が広すぎて安全性が不足
- 対象:
  - `src-ui/types.ts` (`RoutineStudioState`)
  - `src-ui/pages/routines-events.ts`
  - `src-ui/pages/routines-pointer-dnd.ts`
- 問題:
  - `canvasEntries/history` が `Record<string, unknown>` ベース。
  - 多数の `unknown` キャスト依存で、プロパティ名誤りがコンパイル時に検知されない。
  - DnD の `kind` が `string` で許容値が不明確。
- 修正要点:
  - `RoutineStudioEntry` 型を定義し `canvasEntries/history` を具体化。
  - `RoutineStudioModuleEditor` 型を定義し `moduleEditor: JsonObject | null` を置換。
  - `DragPayload.kind` を `"module" | "template" | "entry"` の union に限定。
  - `addAssetToCanvas` も `kind` を同じ union 型に合わせる。

### P1-1: 数値正規化で `NaN` 混入リスク
- 対象: `normalizeModule`, `normalizeEntry`, `normalizeModuleEditor`, module save payload
- 問題:
  - `Math.max(1, Number(value))` は `value` が不正文字列だと `NaN` を返しうる。
- 修正要点:
  - `toPositiveInt(value, fallback)` の共通ヘルパを導入。
  - すべての duration 系入力を共通関数経由に統一する。

### P1-2: DnD状態のモジュールグローバル化
- 対象: `src-ui/pages/routines-pointer-dnd.ts`
- 問題:
  - `routineStudioActiveDrag` などがファイルスコープで共有される。
  - 将来の再利用・複数マウント・テスト時に衝突しやすい。
- 修正要点:
  - `createRoutineStudioPointerDnd()` ファクトリ化し、インスタンスローカル状態へ移行。
  - `bind` 時に `dispose` を返し、再描画時の解除を明示化する。

### P2-1: 不要定義・責務境界の曖昧さ
- 対象: `src-ui/pages/routines-model.ts`
- 問題:
  - `routineStudioMacroTargets` が未使用。
  - `routines-page.ts` は pass-through のみで拡張ポイントが不明確。
- 修正要点:
  - 未使用定義は削除または利用箇所を追加。
  - `routines-page.ts` は「ページエントリとして残す理由」をコメントで明示、不要なら統合。

## 2. 推奨リファクタリング順序

1. 型固定（P0-2）
2. 状態ロジック分離（P0-1 の state 部）
3. APIアクション分離（P0-1 の action 部）
4. イベント配線分離（P0-1 の binding 部）
5. DnDファクトリ化（P1-2）
6. NaN対策統一（P1-1）
7. 未使用定義整理（P2-1）

## 3. 受け入れ条件（DoD）

- `RoutineStudioState` から `Record<string, unknown>` ベースの entry/history が除去されている。
- `routines-events.ts` の主要責務が複数ファイルへ分割され、単一ファイル集中が解消されている。
- DnD の `kind` が union 型でコンパイル時に制約される。
- duration 入力の全経路で `NaN` が入らない。
- 既存機能（追加・削除・並び替え・保存・今日適用・Undo/Redo）が回帰しない。

## 4. 実装時の注意点

- 分割時は「描画更新のトリガー責務」を1箇所に集約し、二重 `rerender()` を避ける。
- `safeInvoke` 呼び出しは action 層で集中管理し、UI層から直接呼びすぎない。
- 型導入は一括置換ではなく、`RoutineStudioEntry` から段階的に適用して差分を小さく保つ。
