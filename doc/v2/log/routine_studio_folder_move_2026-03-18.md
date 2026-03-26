# Routine Studio Folder Move Investigation

Date: 2026-03-18

## Symptom

On the Routines page, dragging a module in the left library pane onto another folder did not move the module between folders.

## What Was Changed First

The first fix adjusted the frontend drag-and-drop commit path so the folder target is re-evaluated on `pointerup`, not only on the last `pointermove`.

Relevant files:

- `src-ui/pages/routines/pointer-dnd.ts`
- `src-ui/dist/pages/routines/pointer-dnd.js`

This change was still worth keeping because it makes the drop target resolution more reliable when the pointer is released immediately after entering a folder.

## Why That Was Not Enough

The actual workspace state had an empty `config/modules.json`:

```json
{
  "folders": [],
  "modules": [],
  "schema": 1
}
```

The backend currently behaved inconsistently for this file:

- `load_configured_modules()` returned the default seed catalog when the parsed module list was empty.
- `load_configured_module_folders()` only synthesized folders from the parsed file contents.
- `move_module()` mutated the parsed file contents directly.

That meant the UI could render default modules that did not actually exist in `modules.json`. When the user tried to move one of those visible modules, the backend looked for it in the persisted file, failed to find it, and rejected the move.

## Final Root Cause

An empty `modules.json` was treated as:

- seeded/default data for list operations
- persisted/empty data for mutation operations

This split behavior made the left pane appear populated while folder move operations still targeted an empty catalog.

## Final Fix

`src-tauri/src/application/configured_modules.rs` now seeds the default module document whenever `modules.json` parses successfully but contains no modules. If the empty file already has explicit folders, those folders are preserved and merged with the default seed folders.

This makes list and mutation operations consistent:

- the modules shown in the UI now also exist in the document used by `move_module`
- moving seeded modules from an empty catalog now persists correctly

## Regression Coverage

Added a Rust regression test for the reported scenario:

- start with an explicit empty `modules.json`
- verify seeded modules/folders are exposed
- move `mod-pomodoro-focus` into `Communication`
- verify the move is persisted

File:

- `src-tauri/src/application/configured_modules.rs`

## Notes

The frontend `pointerup` refresh fix and the backend empty-catalog seeding fix address different failure modes. The backend inconsistency was the reason the feature still did not work after the first change.
