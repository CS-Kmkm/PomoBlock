# Node Legacy Retirement Review

Date: 2026-03-14

Related plan: `doc/v2/node_legacy_retirement_plan_2026-03-12.md`

## Goal Review

この作業の目的は、`src/` 配下の Node/TypeScript backend を段階的に退役させ、`src-tauri/` の Rust backend を唯一の SoT に固定することである。

期待する最終状態は次の通り。

- 本番 backend の実装責務は Rust のみが持つ
- Tauri command 名と CLI surface は維持する
- Node backend 用の build/test/toolchain は不要になる
- 旧 `legacy.rs` 依存は消し、必要な shared helper は専用 module へ再配置する

## Current Review

### 1. 達成できていること

- Node 側の backend 実装は大半が削除済みで、block / pomodoro / task / reflection / catalog 系の本体は Rust へ移行済み
- command 層は `blocks.rs`, `tasks.rs`, `pomodoro.rs`, `reflection.rs`, `catalog.rs`, `calendar.rs` に分割され、`commands/mod.rs` が export façade を担う構成へ整理済み
- `legacy.rs` に残っていた block/task/pomodoro/reflection/catalog wrapper は削除済み
- `AppState` / runtime state は `commands/state.rs`、task assignment/status は `task_runtime.rs`、audit log は `audit_log.rs`、pomodoro log I/O は `pomodoro_log_store.rs` に抽出済み
- `calendar/auth` helper の抽出も完了しており、旧 `legacy.rs` は `commands/regression_tests.rs` へ置き換え済み
- Rust 側の回帰は維持されており、`cargo test --manifest-path src-tauri/Cargo.toml` は 2026-03-14 時点で `98 passed / 0 failed`

### 2. まだ残っているもの

- `commands/regression_tests.rs` は依然として大きく、property regression の集約先として残っている
- test helper の置き場が `commands/state.rs` / `commands/mod.rs` に散っており、test support module の整理余地がある
- review 文書自体が段階完了前提の記述を多く含んでおり、次フェーズ用の更新が必要

## Assessment

### Good

- 方針は崩れていない。Node backend 撤去と同時に Rust 内部責務の分割が進んでいる
- block / task / pomodoro / reflection の command wrapper 除去は成立しており、旧 `legacy.rs` の肥大化は解消済み
- 既存 external interface を壊さずに内側だけを置き換える進め方になっている

### Risk

- regression tests が `commands/regression_tests.rs` に集約されたままだと、今度は test-only の巨大 module になりやすい
- test helper を production module に置き続けると、将来の command 再整理時に依存関係が読みづらくなる
- calendar/auth/sync は相互依存が残っており、最後にまとめて触るとリスクが高い

## Remaining Work Review

優先度順では次が妥当。

### P1: regression test module の再配置

- `commands/regression_tests.rs` を domain/service ごとの test module へ分割
- property test 群の責務に応じて配置を揃える
- `commands` 配下に test-only 巨大 module を残さない

### P2: test support helper の整理

- `seed_synced_events_for_tests`
- suppression / relocation helper
- temporary workspace helper

これらを test support module に寄せ、production module の test-only export を減らす。

### P3: docs と cleanup の同期

- review 文書の更新
- `legacy` という名称が残っている説明の整理
- 最終 cleanup 条件の再定義

## Current Conclusion

2026-03-14 時点で、このリファクタは「後戻りが必要な状態」ではない。  
一方で「Node legacy retirement 完了」と言える状態でもまだない。

現在地は次の表現が正確である。

- Node backend の主要実装撤去はほぼ完了
- Rust command 層の分割は成立
- shared state / calendar-auth 分割は完了し、残る中心は test/support 層の整理である

## Recommended Next Step

次の 1 サイクルでは、test/support 層を整えるために以下を優先する。

1. `commands/regression_tests.rs` の property test を責務ごとに分割する
2. test helper を専用 support module へ移す
3. review/plan 文書を現状に合わせて更新する

この順なら、production code の分離完了状態を維持したまま、test/support 層の見通しも揃えられる。
