# Node Legacy Retirement Plan

Date: 2026-03-12

## Summary

`src/` 配下の Node/TypeScript backend 実装は、現時点で本番 backend ではない。
本番の SoT は `src-tauri/` であり、Node 実装は legacy / reference implementation / legacy test support の役割に縮退している。

この文書は、Node 実装の現状分類、削除条件、Rust テスト移行条件、実施順を固定するための対応表である。

## Classification Table

| Node/TS file | Current role | Legacy test refs | Rust replacement status | Removal condition | Next action |
| --- | --- | --- | --- | --- | --- |
| `src/cli.ts` | 未使用の旧CLI | なし | Rust CLIで置換済み | 即時削除可 | 最初に削除 |
| `src/index.ts` | `config` のみ再 export | なし | backend 入口としては不要 | 即時削除可 | `config` 専用維持か削除を選ぶ |
| `src/domain/blockGenerator.ts` | legacy block 生成 | `tests/blockGenerator.test.ts`, `tests/e2eWorkflow.test.ts` | Rustで主要 block 生成挙動あり | TS block 系テスト廃止後 | Rust に Property 10/23 と auto-fill 回帰を追加 |
| `src/application/blockPlanningService.ts` | legacy block 計画 | `tests/blockPlanningService.test.ts`, `tests/e2eWorkflow.test.ts` | Rustで生成・再配置・承認の流れあり | Property 10/23 の明示後 | Rust integration test を追加 |
| `src/application/blockOperationsService.ts` | legacy block 操作 | `tests/blockOperationsService.test.ts`, `tests/e2eWorkflow.test.ts` | Rustで approve/delete/adjust あり | Property 12/13/14 を Rust で明示後 | Rust property test 名義へ整理 |
| `src/domain/pomodoroTimer.ts` | legacy timer engine | `tests/pomodoroTimer.test.ts`, `tests/e2eWorkflow.test.ts` | Rustで Property 15/17 とログ永続化の基礎あり | Property 16/18 の追加後 | break 自動遷移と永続化回帰を追加 |
| `src/application/taskManager.ts` | legacy task service | `tests/taskManager.test.ts`, `tests/e2eWorkflow.test.ts` | Rustで create/update/delete/split/carry と Property 21 あり | Property 19/20/24/25/26 を Rust で表現後 | task audit/history を Rust に追加 |
| `src/application/reflectionService.ts` | legacy reflection 集計 | `tests/reflectionService.test.ts`, `tests/e2eWorkflow.test.ts` | Rustで Property 32 相当あり | e2e 依存除去後 | Rust integration test に統合 |
| `src/application/bootstrap.ts` | legacy bootstrap | `tests/bootstrap.test.ts` | Rust bootstrap test と Rust CLI で置換済み | TS bootstrap test 廃止後 | 早期削除候補 |
| `src/infrastructure/localStorageRepository.ts` | legacy SQLite repository | `tests/localStorageRepository.test.ts`, `tests/localStorageDeletion.test.ts`, `tests/e2eWorkflow.test.ts`, `tests/taskManager.test.ts`, `tests/pomodoroLogRepository.test.ts` | Rustで一部永続化済みだが repository 単位の網羅は未完 | Property 30 と round-trip 系の Rust 化後 | Rust repository 回帰を追加 |
| `src/infrastructure/pomodoroLogRepository.ts` | legacy pomodoro log repository | `tests/pomodoroLogRepository.test.ts`, `tests/e2eWorkflow.test.ts` | Rustで pomodoro log 保存/読込あり | repository 観点の Rust test 後 | 専用 Rust test を追加 |
| `src/infrastructure/taskRepository.ts` | legacy task repository | `tests/taskManager.test.ts`, `tests/e2eWorkflow.test.ts` | Rust task service はあるが audit/history repository 表現は未整備 | Rust 側の task history 永続化後 | task audit/history を実装 |
| `src/application/routineManager.ts` | legacy routine/template/policy git 管理 | `tests/gitSync.test.ts` | Rust 置換未完 | Rust git-backed manager 実装後 | 未置換 backend の最優先 |
| `src/infrastructure/gitRepository.ts` | legacy git backend | `tests/gitSync.test.ts` | Rust 置換未完 | Rust git 実装後 | `routineManager` と同時移行 |
| `src/application/externalEditService.ts` | legacy external edit 検知 | `tests/externalEditService.test.ts`, `tests/e2eWorkflow.test.ts` | Rust `calendar_sync` に近い挙動ありだが property 22/31 は未固定 | Rust で外部編集検知を固定後 | sync 系 Rust integration test を追加 |
| `src/domain/policy.ts` | legacy policy helper | `tests/policy.test.ts` | Rust に類似ロジックあり | policy 回帰の Rust 化後 | timezone / override / slot filter の Rust test を追加 |
| `src/domain/models.ts` | legacy model factory / fixture | 多数 | Rust model が SoT | TS legacy tests 終了後 | 最後に削除 |
| `src/application/index.ts` | legacy re-export | 間接依存のみ | backend 用途なし | 実体削除後 | 最終 cleanup |
| `src/infrastructure/index.ts` | legacy re-export | 間接依存のみ | backend 用途なし | 実体削除後 | 最終 cleanup |
| `src/domain/index.ts` | legacy re-export | 間接依存のみ | backend 用途なし | 実体削除後 | 最終 cleanup |
| `src/config/defaults.ts` | Node config support | bootstrap / legacy test 間接依存 | Rust に対応実装あり | TS bootstrap / repo test 終了後 | 最終 cleanup |
| `src/config/loader.ts` | Node config support | bootstrap / legacy test 間接依存 | Rust に対応実装あり | TS bootstrap / repo test 終了後 | 最終 cleanup |
| `src/config/paths.ts` | Node path resolution support | legacy CLI / bootstrap 間接依存 | Rust CLI / bootstrap に対応あり | TS bootstrap / CLI 削除後 | 最終 cleanup |
| `src/config/index.ts` | Node config re-export | 間接依存のみ | Rust SoT あり | Node config 利用終了後 | 最終 cleanup |
| `src/infrastructure/sql/schema.sql` | Node SQLite asset | `build:node` / legacy repo test | Rust schema が本番 SoT | legacy Node repository 廃止後 | 最終 cleanup |

## Removal Priority

### P0: Immediate

- `src/cli.ts`
- `src/index.ts` (`config` 再 export の扱いを決めた後)

### P1: Removable after small Rust test additions

- `src/domain/blockGenerator.ts`
- `src/application/blockPlanningService.ts`
- `src/application/blockOperationsService.ts`
- `src/domain/pomodoroTimer.ts`
- `src/application/bootstrap.ts`
- `src/application/reflectionService.ts`

### P2: Requires Rust backend parity work first

- `src/application/taskManager.ts`
- `src/infrastructure/taskRepository.ts`
- `src/infrastructure/pomodoroLogRepository.ts`
- `src/infrastructure/localStorageRepository.ts`
- `src/application/routineManager.ts`
- `src/infrastructure/gitRepository.ts`
- `src/application/externalEditService.ts`
- `src/domain/policy.ts`
- `src/domain/models.ts`

## Execution Plan

### Phase A: Immediate cleanup

- Delete `src/cli.ts`.
- Decide whether `src/index.ts` remains as a `config`-only compatibility export or is removed entirely.
- Keep README aligned with Rust-first backend operation.

### Phase B: Remove Node block and pomodoro implementations

Required Rust additions:

- Property 10: generated blocks are registered in calendar as draft
- Property 12: approving block updates firmness and calendar event behavior
- Property 13: deleting block is reflected in calendar behavior
- Property 14: adjusting block time updates calendar event time behavior
- Property 16: break phase starts automatically after focus ends
- Property 18: complete or interrupted sessions are persisted as logs
- Property 23: relocation succeeds and manual adjustment fallback is covered explicitly

Then remove:

- `src/domain/blockGenerator.ts`
- `src/application/blockPlanningService.ts`
- `src/application/blockOperationsService.ts`
- `src/domain/pomodoroTimer.ts`

### Phase C: Remove Node task, reflection, bootstrap, and local persistence implementations

Required Rust additions:

- Property 19/20: task assignment links task to block and records history/audit
- Property 24/26: carry-over relinks task and records history
- Property 25/26: split creates children and records history
- Property 30: deleted local data is fully removed
- repository round-trip tests for blocks / tasks / pomodoro logs / sync state / suppressions

Then remove:

- `src/application/taskManager.ts`
- `src/application/reflectionService.ts`
- `src/application/bootstrap.ts`
- `src/infrastructure/taskRepository.ts`
- `src/infrastructure/pomodoroLogRepository.ts`
- `src/infrastructure/localStorageRepository.ts`

### Phase D: Replace remaining Node-only backend capabilities

Required Rust implementations:

- git-backed routine/template/policy manager
- external edit detection / user notification regression coverage
- policy helper regression coverage where behavior is still only asserted in TS

Then remove:

- `src/application/routineManager.ts`
- `src/infrastructure/gitRepository.ts`
- `src/application/externalEditService.ts`
- `src/domain/policy.ts`

### Phase E: Final cleanup

- Remove `src/domain/models.ts`.
- Remove `src/application/index.ts`, `src/infrastructure/index.ts`, `src/domain/index.ts`.
- Remove `src/config/*` Node backend support files if no longer referenced.
- Remove `src/infrastructure/sql/schema.sql`.
- Remove `build:node` and `test:legacy` from `package.json`.
- Retire `tsconfig.node.json` if no longer needed.

## Recommended Commit Sequence

1. `chore(legacy): remove unused node entrypoints`
2. `test(rust): add explicit block and pomodoro parity coverage`
3. `chore(legacy): remove node block and pomodoro modules`
4. `feat(tauri): add task audit and persistence parity`
5. `test(rust): migrate task reflection and repository regression coverage`
6. `chore(legacy): remove node task reflection and sqlite modules`
7. `feat(tauri): add rust git-backed routine manager and external edit handling`
8. `test(rust): migrate git sync and external edit regression coverage`
9. `chore(legacy): remove remaining node backend modules`

## Acceptance Criteria

- Node backend code is no longer on any production path.
- Each removed Node module has equivalent Rust implementation and Rust regression coverage.
- `package.json` no longer requires `build:node` or `test:legacy` for standard product workflows.
- `src/` no longer contains backend application, domain, or infrastructure logic.
