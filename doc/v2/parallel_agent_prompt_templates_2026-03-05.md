# Parallel Agent Prompt Templates (TSR, Conflict-Safe)

用途: `doc/v2/typescript_refactor_tasks_2026-03-05.md` を、ファイル競合なしで並列実装する。

## 共通テンプレート

```text
あなたは担当タスクのみ実装してください。

前提:
- 参照: doc/v2/typescript_refactor_tasks_2026-03-05.md
- 参照: doc/v2/typescript_refactor_review_2026-03-05.md
- 作業は現在の worktree のみ

必須ルール:
- Allowed ファイルのみ変更
- Forbidden ファイルは変更しない
- 変更は最小差分
- 実行結果を最後に報告 (タスクID/変更ファイル/コマンド結果/残課題)

実施:
1. 担当タスクを実装
2. npm run typecheck
3. 関連テストがあれば実行
4. 結果報告
5. 実行結果をcommitメッセージに反映してコミット
```

## Agent A (PHASE-1)
- Worktree: `C:\Users\Koshi\PomoBlock.worktrees\tsr-a-safety`
- Branch: `codex/tsr-a-safety`
- Tasks: `TSR-001, TSR-002, TSR-003`
- Allowed:
  - `src-ui/now.ts`
  - `src-ui/commands.ts`
  - `src-ui/tauri-contracts.ts`
  - `src-ui/utils/*`
  - `tests/*`
- Forbidden:
  - `src-ui/app-runtime.ts`

## Agent B (PHASE-1)
- Worktree: `C:\Users\Koshi\PomoBlock.worktrees\tsr-b-mock-split`
- Branch: `codex/tsr-b-mock-split`
- Tasks: `TSR-004`
- Allowed:
  - `src-ui/app-runtime.ts`
  - `src-ui/mock/*`
- Forbidden:
  - `src-ui/runtime/*` (import整備以外)

## Agent C (PHASE-1)
- Worktree: `C:\Users\Koshi\PomoBlock.worktrees\tsr-c-runtime-foundation`
- Branch: `codex/tsr-c-runtime-foundation`
- Tasks: `TSR-005/006 foundation`
- Allowed:
  - `src-ui/runtime/*` (新規作成/分離先実装)
  - `doc/v2/*` (必要時)
- Forbidden:
  - `src-ui/app-runtime.ts`

補足:
- Cは「統合しない」。統合はAgent Eが担当。

## Agent D (PHASE-1)
- Worktree: `C:\Users\Koshi\PomoBlock.worktrees\tsr-d-storage`
- Branch: `codex/tsr-d-storage`
- Tasks: `TSR-008, TSR-009`
- Allowed:
  - `src/infrastructure/localStorageRepository.ts`
  - `doc/v2/*`
- Forbidden:
  - `src-ui/app-runtime.ts`

## Agent E (PHASE-2, integration)
- Worktree: `C:\Users\Koshi\PomoBlock.worktrees\tsr-e-runtime-integration`
- Branch: `codex/tsr-e-runtime-integration`
- Start after: `B/C merge + latest main`
- Tasks: `TSR-005/006 integration + TSR-007 + TSR-010`
- Allowed:
  - `src-ui/app-runtime.ts`
  - `src-ui/runtime/*`
  - `tests/*`
  - `doc/v2/*`
- Forbidden:
  - なし

実施順:
1. `main` 最新取り込み
2. Cで作った runtime 分離ファイルを使って app-runtime 統合
3. 薄いラッパー削減
4. `npm run typecheck && npm test`
5. 回帰結果を文書化

## 推奨コミットメッセージ
- `feat(TSR-001): use reference time in now auto start selection`
- `test(TSR-002): add deterministic tests for now auto start logic`
- `refactor(TSR-003): centralize unknown command error helper`
- `refactor(TSR-004): extract mock invoke handlers from app runtime`
- `refactor(TSR-005): add runtime deps factory foundation`
- `refactor(TSR-006): add runtime timer loop foundation`
- `refactor(TSR-005): integrate deps factory into app runtime`
- `refactor(TSR-006): integrate timer loop into app runtime`
- `refactor(TSR-007): remove redundant runtime wrappers`
- `fix(TSR-008): harden task_refs matching before updates`
- `docs(TSR-009): add repository split design memo`
- `chore(TSR-010): run integration regression checks`
