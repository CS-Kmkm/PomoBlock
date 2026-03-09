# Rust Backend Source Of Truth

Date: 2026-03-09

## Rule

- Production backend SoT is `src-tauri/`.
- New backend behavior must be implemented in Rust.
- `src/` backend modules are migration-time reference implementations only.

## Operational Notes

- Keep the Tauri command contract stable unless there is a deliberate contract migration.
- Treat `src/` backend logic as maintenance-only while Rust parity is being completed.
- `npm run init` and `npm run status` remain supported entrypoints during migration, but their implementation source should move to Rust.
- Remove or isolate TypeScript backend modules only after equivalent Rust behavior is covered by Rust tests.
