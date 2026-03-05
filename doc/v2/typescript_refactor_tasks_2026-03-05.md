# TypeScript Refactor 実装タスク (2026-03-05)

元ドキュメント: `doc/v2/typescript_refactor_review_2026-03-05.md`

## 1. タスク定義ルール
- ID形式: `TSR-xxx`
- 優先度: `P0` (最優先), `P1` (重要), `P2` (改善)
- 状態: `todo`, `doing`, `done`, `blocked`
- 完了条件: 各タスクの「Done条件」をすべて満たすこと

## 2. 競合防止ルール (必須)
- `src-ui/app-runtime.ts` を PHASE-1 で触るのは Agent B のみ。
- Agent C は PHASE-1 で `src-ui/runtime/*` の新規/分離先実装のみ行い、`app-runtime.ts` を編集しない。
- Agent E が PHASE-2 で B/C を取り込んだ上で `app-runtime.ts` 統合と TSR-007 を実施する。
- 同じファイルを複数エージェントが同時編集しない。

## 3. 実装タスク一覧

| ID | 状態 | 優先度 | タスク | 担当フェーズ | 変更対象 | Done条件 |
| --- | --- | --- | --- | --- | --- | --- |
| TSR-001 | todo | P0 | `resolveNowAutoStartBlock` の時刻依存修正 | PHASE-1(A) | `src-ui/now.ts` | `Date.now()` を使わず `reference` ベースで判定する |
| TSR-002 | todo | P0 | `now.ts` 時刻系ロジックの単体テスト追加 | PHASE-1(A) | `tests/*` | `reference` 指定の境界ケースを含む |
| TSR-003 | todo | P1 | `isUnknownCommandError` の共通化 | PHASE-1(A) | `src-ui/commands.ts`, `src-ui/tauri-contracts.ts`, `src-ui/utils/*` | 単一実装に統合 |
| TSR-004 | todo | P1 | `app-runtime.ts` から `mockInvoke` を分離 | PHASE-1(B) | `src-ui/app-runtime.ts`, `src-ui/mock/*` | mockInvoke 本体が外出し、挙動維持 |
| TSR-005 | todo | P1 | deps factory 分離 | PHASE-1(C) + PHASE-2(E) | `src-ui/runtime/*`, `src-ui/app-runtime.ts` | 分離先実装 + 統合完了 |
| TSR-006 | todo | P1 | timer loop 分離 | PHASE-1(C) + PHASE-2(E) | `src-ui/runtime/*`, `src-ui/app-runtime.ts` | 分離先実装 + 統合完了 |
| TSR-007 | todo | P2 | `app-runtime.ts` の薄いラッパー関数削減 | PHASE-2(E) | `src-ui/app-runtime.ts` | adapter最小化、可読性向上 |
| TSR-008 | todo | P2 | `task_refs` 検索改善(短期) | PHASE-1(D) | `src/infrastructure/localStorageRepository.ts` | 誤更新リスクを低減 |
| TSR-009 | todo | P2 | repository分割方針の設計文書化 | PHASE-1(D) | `doc/v2/*` | 分割単位/移行順を明記 |
| TSR-010 | todo | P1 | 統合回帰確認 | PHASE-2(E) | `npm run typecheck`, `npm test` | typecheck/test + 手動確認完了 |

## 4. 実行順
1. PHASE-1: A/B/C/D を並列実行
2. A, D を先にマージ
3. B, C を順次マージ
4. PHASE-2: E が最新 `main` で TSR-005/006 統合、TSR-007、TSR-010 を実施

## 5. PR分割
- PR-A: TSR-001〜003
- PR-B: TSR-004
- PR-C: TSR-005/006 (foundation: runtime files only)
- PR-D: TSR-008/009
- PR-E: TSR-005/006 integration + TSR-007 + TSR-010
