# Refactor Follow-up Plan (2026-03-05)

## Goal
- Improve maintainability around runtime command handling and module boundaries.
- Reduce risk of regressions by splitting high-churn areas in small, testable steps.
- Establish a clear dead-code policy for transitional modules.

## Scope
- Step 1: Extract `mockInvoke` and mock-state logic from `src-ui/app-runtime.ts`.
- Step 2: Split `src-tauri/src/application/commands.rs` into task/pomodoro submodules.
- Step 3: Organize dead-code warnings with explicit policy and annotations.

## Out of Scope
- Large behavior changes.
- API contract changes between UI and Tauri commands.
- Deleting transitional domain models that are intentionally retained.

## Step Details

### Step 1: UI mock command extraction
- Create a dedicated mock command module in `src-ui`.
- Move mock helpers and `mockInvoke` implementation out of `app-runtime.ts`.
- Keep runtime wiring (`createCommandService`) unchanged from caller perspective.

Acceptance:
- `npm run build:ui` passes.
- `mock mode` behavior remains equivalent.

### Step 2: Rust command module split
- Add `commands/tasks.rs` and `commands/pomodoro.rs`.
- Move task and pomodoro command implementations from `commands.rs`.
- Re-export moved functions so existing call sites remain unchanged.

Acceptance:
- `cargo check` passes.
- Existing tests/command handlers compile without signature changes.

### Step 3: Dead-code warning policy
- Add explicit `dead_code` policy notes and targeted annotations in transitional modules.
- Suppress only intentional transitional warnings.
- Preserve active-module warnings where action is still needed.

Acceptance:
- `cargo check` warning output is reduced and intent is explicit in code comments.

## Commit Plan
1. `docs(refactor): add follow-up plan for steps 1-3`
2. `refactor(ui): extract mock command runtime from app-runtime`
3. `refactor(tauri): split task and pomodoro commands into modules`
4. `chore(rust): apply dead_code policy annotations for transitional modules`
