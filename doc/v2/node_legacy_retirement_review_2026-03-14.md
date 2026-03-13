# Node Legacy Retirement Review

Date: 2026-03-14

Related plan: `doc/v2/node_legacy_retirement_plan_2026-03-12.md`

## Goal Review

この作業の目的は、`src/` 配下の Node/TypeScript backend を段階的に退役させ、`src-tauri/` の Rust backend を唯一の SoT に固定することである。

期待する最終状態は次の通り。

- 本番 backend の実装責務は Rust のみが持つ
- Tauri command 名と CLI surface は維持する
- Node backend 用の build/test/toolchain は不要になる
- `legacy.rs` は巨大な実装溜まりではなく、最終的に解体可能な最小責務に縮退する

## Current Review

### 1. 達成できていること

- Node 側の backend 実装は大半が削除済みで、block / pomodoro / task / reflection / catalog 系の本体は Rust へ移行済み
- command 層は `blocks.rs`, `tasks.rs`, `pomodoro.rs`, `reflection.rs`, `catalog.rs`, `calendar.rs` に分割され、`commands/mod.rs` が export façade を担う構成へ整理済み
- `legacy.rs` に残っていた block/task/pomodoro/reflection/catalog wrapper は削除済み
- Rust 側の回帰は維持されており、`cargo test --manifest-path src-tauri/Cargo.toml` は 2026-03-14 時点で `98 passed / 0 failed`

### 2. まだ残っているもの

- `legacy.rs` は依然として `AppState`、runtime state、OAuth/browser helper、calendar sync helper、SQLite helper、task audit helper などの shared 実装を保持している
- `commands/*` の多くが `super::legacy::AppState` に依存しており、command 分割は進んだが bootstrap/runtime 分割は未完
- `calendar.rs` は依然として `legacy.rs` から auth command と sync helper を参照しており、calendar/auth/policy の独立は完了していない
- `tasks.rs` は `CarryOverTaskResponse` をまだ `legacy.rs` から re-export している

## Assessment

### Good

- 方針は崩れていない。Node backend 撤去と同時に Rust 内部責務の分割が進んでいる
- block / task / pomodoro / reflection の command wrapper 除去は成立しており、`legacy.rs` の肥大化を止められている
- 既存 external interface を壊さずに内側だけを置き換える進め方になっている

### Risk

- `legacy.rs` が今後も `shared utility sink` として残ると、最終 cleanup 直前で再び分解コストが上がる
- `AppState` と shared runtime helper を切り出さない限り、各 command module は名前だけ分かれていても実質的には `legacy.rs` に縛られ続ける
- calendar/auth/sync は相互依存が残っており、最後にまとめて触るとリスクが高い

## Remaining Work Review

優先度順では次が妥当。

### P1: `AppState` と shared runtime の抽出

- `AppState`
- `RuntimeState`
- shared snapshot / persist helper
- task assignment / audit helper のうち cross-domain に残すもの

これを `legacy.rs` から外さないと、他 module の `super::legacy::*` 依存を外せない。

### P2: calendar/auth helper の分離

- OAuth config loading
- browser launch / SSO callback wait
- calendar credential / token helper
- sync 後 relocate helper

`calendar.rs` が `legacy.rs` に依存している部分をここで切る。

### P3: response type の最終移設

- `CarryOverTaskResponse`
- `AuthenticateGoogleResponse`
- `AppState` re-export の出口整理

## Current Conclusion

2026-03-14 時点で、このリファクタは「後戻りが必要な状態」ではない。  
一方で「Node legacy retirement 完了」と言える状態でもまだない。

現在地は次の表現が正確である。

- Node backend の主要実装撤去はほぼ完了
- Rust command 層の分割は成立
- `legacy.rs` 解体のための shared state / calendar-auth 分割が残っている

## Recommended Next Step

次の 1 サイクルでは、`legacy.rs` をさらに削るために以下を優先する。

1. `AppState` と runtime helper を専用 module へ抽出する
2. `calendar.rs` が `legacy.rs` から取っている helper を calendar/auth module へ移す
3. `CarryOverTaskResponse` など残存 DTO を各 domain/service 側へ移す

この順なら、`legacy.rs` は command 実装の残骸ではなく、削除可能性を評価できる最終段階まで縮小できる。
