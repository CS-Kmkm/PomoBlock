# Implementation Snapshot (2026-02-26): Now UI Refresh and Today Sync

## Scope

This document records the UI/behavior changes implemented for:

- `Now` page redesign (3-column layout, central timer, 3-button controls)
- timer behavior fixes (local 1-second countdown + backend resync handling)
- `Today` page synchronization with active timer task

No backend API changes were made.

## Changed Files

- `src-ui/app.js`
- `src-ui/styles.css`

## Now Page: Layout and Controls

### Layout

`Now` was rebuilt into:

- left rail: today's timeline blocks
- center pane: circular timer + control cluster + current objective
- right rail: next-step tasks (complete + reorder within session)
- bottom bar: strict metrics only (Buffer Available / Deferred Tasks / Focus Completion if available)

`route-now` and `view-root--now` classes were added to isolate route-specific styling.

### 3-button control model

Control responsibilities were changed to:

- left button: Reset
- center button: Start / Pause / Resume (state-dependent)
- right button: Next

Current command mapping:

- center `Start` -> `start_block_timer` (fallback: `start_pomodoro`)
- center `Pause` -> `pause_timer` (fallback: `pause_pomodoro`)
- center `Resume` -> `resume_timer` (fallback: `resume_pomodoro`)
- left `Reset` -> `interrupt_timer(reason=manual_reset)` (fallback: `complete_pomodoro`)
- right `Next` -> `next_step` (fallback: `advance_pomodoro`)

To prevent broken transitions from double clicks, UI action lock state (`actionInFlight`) is used while command execution is in progress.

## Timer Rendering Behavior

### Countdown update model

- local UI countdown ticks every second
- backend state is refreshed every 5 seconds
- same-phase resync does not visually rewind remaining time

### Circular ring semantics

The circular ring highlight now represents **remaining time**, not elapsed time:

- more remaining time -> larger highlighted arc
- as time decreases -> highlighted arc shrinks

## Task Synchronization Between Today and Now

A shared task resolver was introduced so both pages point to the same current task source:

1. `pomodoro.current_task_id` (if available)
2. fallback task with `status === "in_progress"`

Applied effects:

- `Today > Current Status` now shows timer-linked task
- `Today > Active Micro-Tasks` active bullet follows timer-linked task
- `Today > Session Notes` default text follows timer-linked task
- 5-second route polling now updates both timer state and task list on `today` and `now`

## Session-local Task Ordering (Now Right Rail)

- task reorder (up/down) is session-local only
- no backend persistence
- order is reconciled after task reloads:
  - missing IDs are removed
  - new IDs are appended

## Validation Run

Executed successfully after implementation:

- `node --check src-ui/app.js`
- `npm test` (34/34 pass)

