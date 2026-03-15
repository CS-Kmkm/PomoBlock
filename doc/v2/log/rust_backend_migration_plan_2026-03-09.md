# Rust Backend Migration Plan

Date: 2026-03-09

## Goal

`src-tauri` を唯一の backend 実装として確立し、`src/` に残っている Node/TypeScript の backend 系ロジックを段階的に縮退させる。

目的は以下の 3 点。

- 実行時 backend の SoT を 1 つに固定する
- SQLite/Git/Calendar/OAuth/Timer の本番実装を Rust に統一する
- デスクトップ製品としての性能・保守性・完成度を引き上げる

## Current State

現状は UI からの主要コマンドがすでに Tauri command 経由で Rust 実装に接続されている。

- `src-tauri/src/lib.rs`
- `src-tauri/src/application/commands.rs`
- `src-ui/tauri-contracts.ts`

一方で、Node/TypeScript 側にも backend 系の責務が残っている。

- `src/domain/*`
- `src/application/*`
- `src/infrastructure/localStorageRepository.ts`
- `src/cli.ts`
- `tests/*`

このため、backend ロジックの責務が Rust と TS に分散している。

## Decision

移行は実施する。

ただし、単純に Node/TypeScript の実装を Rust に写すのではなく、先に Rust 側を分割・整理してから残りのロジックを吸収する。

特に `src-tauri/src/application/commands.rs` は肥大化しているため、移行の最初の対象はこのファイルの責務分割とする。

## Scope

移行対象:

- Block generation / block operations
- Pomodoro state and timer flow
- Task / Reflection / Routine application services
- SQLite persistence
- Git / calendar / OAuth integration
- Bootstrap / CLI responsibilities
- Backend test suite

移行対象外:

- `src-ui` の表示ロジック
- Tauri command contract 自体の大枠

## Migration Principles

1. 新しい backend 機能は Rust にのみ追加する
2. UI から見た command contract は原則維持する
3. Node/TS 側は移行完了まで reference implementation として扱う
4. Rust 側で仕様が固まった機能から TS 実装を削除する
5. 各段階で commit を分け、巻き戻し可能にする

## Execution Plan

### Phase 0: SoT Declaration

目的:

- `src-tauri` を本番 backend の SoT として明文化する
- `src/` への新規 backend 投資を止める

作業:

- 開発ルールを doc に記載
- backend 系の新規変更先を Rust に固定
- TS 側は移行完了まで保守限定にする

完了条件:

- team が「本番 backend は Rust」と判断できる

### Phase 1: Tauri Backend Refactor Baseline

目的:

- `commands.rs` の巨大化を抑え、移行先として成立する構造にする

作業:

- `src-tauri/src/application/commands.rs` を分割
- 少なくとも以下の単位へ整理する
  - `blocks`
  - `tasks`
  - `pomodoro`
  - `reflection`
  - `calendar`
  - `bootstrap`
- `lib.rs` は command の公開と wiring のみに寄せる

完了条件:

- feature ごとの修正が単一巨大ファイルに集中しない

### Phase 2: Block Domain Consolidation

目的:

- block generation / planning の SoT を Rust に固定する

主対象:

- `src/domain/blockGenerator.ts`
- `src/application/blockPlanningService.ts`
- `src/application/blockOperationsService.ts`

作業:

- 既存 TS の仕様を Rust service に移植
- Rust 側の `generate_blocks_impl` と関連ロジックを service/repository に分離
- ブロック生成、承認、削除、再配置、時間調整の挙動を Rust テストで固定

完了条件:

- Block 系ユースケースの仕様確認が Rust 実装だけで完結する

### Phase 3: Pomodoro Engine Consolidation

目的:

- タイマー状態遷移の SoT を Rust に固定する

主対象:

- `src/domain/pomodoroTimer.ts`

作業:

- focus / break / pause / resume / advance の遷移を Rust へ統一
- `get_pomodoro_state` / `start_pomodoro` / `pause_*` / `resume_*` / `advance_*` 系のテストを Rust に集約
- 再起動時の状態整合性を確認

完了条件:

- Timer 仕様の回帰確認が Rust テストのみで成立する

### Phase 4: Task / Reflection / Routine Migration

目的:

- アプリケーションサービス層を Rust 側へ寄せる

主対象:

- `src/application/taskManager.ts`
- `src/application/reflectionService.ts`
- `src/application/routineManager.ts`

作業:

- task update / carry over / reflection summary / routine application の仕様を Rust に実装
- UI から使うコマンド単位で contract を維持しながら内部実装を移行

完了条件:

- task / reflection / routine の主要ロジックが TS backend に依存しない

### Phase 5: Persistence and CLI Unification

目的:

- SQLite と CLI の Rust 統一を完了する

主対象:

- `src/infrastructure/localStorageRepository.ts`
- `src/application/bootstrap.ts`
- `src/cli.ts`

作業:

- DB 永続化責務を Rust repository に寄せ切る
- schema の SoT を Rust 側へ固定
- `init` / `status` 相当の CLI を Rust へ移す

完了条件:

- Node/TS の backend 実行がなくてもプロダクト運用が成立する

### Phase 6: Test Migration and Legacy Removal

目的:

- Node backend の役割を終了させる

主対象:

- `tests/*`
- `src/domain/*`
- `src/application/*`
- `src/infrastructure/*`

作業:

- 主要な backend テストを Rust テストへ移植
- 不要になった TS backend 実装を削除または `legacy` 化
- `npm run build:node` 依存を縮小または廃止

完了条件:

- 本番 backend とテストの主軸が Rust に移っている

## Recommended Commit Sequence

1. `docs(architecture): add rust backend migration plan`
2. `refactor(tauri): split command handlers by domain`
3. `refactor(tauri): extract block services from command module`
4. `feat(tauri): migrate block planning logic from ts backend`
5. `feat(tauri): migrate pomodoro engine from ts backend`
6. `feat(tauri): migrate task and reflection services`
7. `feat(cli): replace node bootstrap cli with rust cli`
8. `test(rust): migrate backend regression coverage`
9. `chore: remove legacy node backend modules`

## Risks

- `commands.rs` 分割前に機能移植を始めると Rust 側がさらに保守しづらくなる
- TS と Rust の仕様差分が一時的に増える可能性がある
- test migration を後回しにすると削除判断が曖昧になる

## Success Criteria

- UI の主要コマンドが Rust 実装のみで成立する
- backend の SoT が Rust に固定されている
- block / pomodoro / task / reflection の回帰テストが Rust 側にある
- Node/TS backend を削除しても製品品質が落ちない
