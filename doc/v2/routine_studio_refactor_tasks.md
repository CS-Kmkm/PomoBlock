# Routine Studio リファクタリング タスク分解

本ドキュメントは `doc/v2/routine_studio_refactor_fix_points.md` を実装タスクへ分解したもの。

## 1. 運用ルール
- ID 形式: `RSR-xxx`
- 優先度: `P0`（先行必須） / `P1`（安定化） / `P2`（整理）
- 見積: 1人日換算
- 依存: 先行完了が必要なタスク ID

## 2. タスク一覧

| ID | タイトル | 内容 | 受け入れ条件 | 依存 | 優先度 | 見積 |
| --- | --- | --- | --- | --- | --- | --- |
| RSR-001 | RoutineStudio 専用型の導入 | `RoutineStudioEntry`, `RoutineStudioHistoryEntry`, `RoutineStudioModuleEditor`, `RoutineStudioDragKind` を定義 | `Record<string, unknown>` 依存が中核データから削減され、主要処理が専用型でコンパイル通過 | - | P0 | 0.5日 |
| RSR-002 | `RoutineStudioState` 型の具体化 | `types.ts` の `canvasEntries/history/moduleEditor` を専用型へ置換 | `RoutineStudioState` 上で entry/history/moduleEditor の型が具体化され、`unknown` キャストが減る | RSR-001 | P0 | 0.5日 |
| RSR-003 | 正規化ロジック分離（state層） | `normalizeModule/normalizeEntry/applyCanvasEntries/pushHistory/updateEntry` を `studio-state.ts` へ抽出 | `routines-events.ts` から状態更新ロジックが分離され、関数責務が明確化 | RSR-002 | P0 | 1日 |
| RSR-004 | API操作分離（action層） | `persistTemplate`, module CRUD, recipe apply/delete を `studio-actions.ts` へ抽出 | `safeInvoke` 呼び出しが action 層へ集約され、UI層の直接呼び出しが減る | RSR-003 | P0 | 1日 |
| RSR-005 | イベント配線分離（binding層） | `addEventListener` 群を `studio-bindings.ts` へ抽出 | `routines-events.ts` は描画と依存注入中心になり、イベント配線が別ファイル化 | RSR-003 | P0 | 1日 |
| RSR-006 | DnD 型強化 | `DragPayload.kind` と `addAssetToCanvas(kind)` を union 型に制約 | `kind` に不正文字列を渡すとコンパイルエラーになる | RSR-001 | P1 | 0.5日 |
| RSR-007 | DnD のインスタンス化対応 | `routines-pointer-dnd.ts` をファクトリ化し、グローバル可変状態を除去。`dispose` を実装 | DnD 状態がインスタンスローカル化され、再描画時に明示解除できる | RSR-005,RSR-006 | P1 | 1日 |
| RSR-008 | duration 数値正規化の共通化 | `toPositiveInt(value, fallback)` を導入し duration 系処理を統一 | 不正入力でも `NaN` が state/payload に入らない | RSR-003 | P1 | 0.5日 |
| RSR-009 | 不要定義整理 | `routineStudioMacroTargets` など未使用定義の削除または利用先追加 | 未使用警告が解消され、不要定義が残らない | RSR-005 | P2 | 0.25日 |
| RSR-010 | 回帰確認（最小E2E） | 追加/削除/並び替え/Undo/Redo/保存/今日適用を確認するテストまたは手動検証手順を追加（`doc/v2/routine_studio_regression_checklist.md`） | 上記の主要フローが再現可能で、分割後も動作維持を確認できる | RSR-004,RSR-005,RSR-007,RSR-008 | P0 | 1日 |

## 2.1 実装状況（2026-03-04）
- RSR-001: 完了
- RSR-002: 完了
- RSR-003: 完了
- RSR-004: 完了
- RSR-005: 完了
- RSR-006: 完了
- RSR-007: 完了
- RSR-008: 完了
- RSR-009: 完了（`src-ui/pages/routines-model.ts` および `src-ui/app-runtime.ts` の未使用 `routineStudioMacroTargets` を整理）
- RSR-010: 完了（`doc/v2/routine_studio_regression_checklist.md` を追加）

## 3. 実行順（推奨）
1. RSR-001
2. RSR-002
3. RSR-003
4. RSR-004
5. RSR-005
6. RSR-006
7. RSR-007
8. RSR-008
9. RSR-010
10. RSR-009

## 4. マイルストーン

### M1: 型固定完了
- 対象: RSR-001, RSR-002
- 完了条件: `RoutineStudioState` の中核型が具体化済み

### M2: 責務分割完了
- 対象: RSR-003, RSR-004, RSR-005
- 完了条件: `routines-events.ts` がオーケストレーション中心になっている

### M3: DnD/入力安定化
- 対象: RSR-006, RSR-007, RSR-008
- 完了条件: DnD と duration 入力の不正値耐性が確保される

### M4: 品質確認/整理
- 対象: RSR-010, RSR-009
- 完了条件: 主要フロー回帰なし + 未使用定義整理済み
