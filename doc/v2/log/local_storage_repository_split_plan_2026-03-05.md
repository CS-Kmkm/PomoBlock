# localStorageRepository 分割方針 (TSR-009, 2026-03-05)

対象: `src/infrastructure/localStorageRepository.ts`

## 分割単位
- `block-repository.ts`
  - block の保存/取得/削除
  - `task_refs` 更新を含む block 側操作
- `task-repository.ts`
  - task の保存/取得/削除
  - task 削除時の block 参照解除呼び出し
- `pomodoro-log-repository.ts`
  - pomodoro log の保存/取得/削除/全削除
- `sync-state-repository.ts`
  - sync state の保存/取得/削除
- `suppression-repository.ts`
  - suppression の保存/取得/削除/全削除
- `audit-log-repository.ts`
  - audit log の追加/取得/全削除
- `sqlite-db.ts`
  - `DatabaseSync` 初期化、`initSchema`、`close`

## 移行順 (回帰リスク低減)
1. SQL と row mapper の分離
- 現行クラスの public API は維持し、内部だけを `queries/*` と `mappers/*` に抽出する。

2. 読み取り系 repository の先行分離
- `loadBlocks/loadTasks/loadPomodoroLogs/loadSyncState/loadSuppressions/loadAuditLogs` を各 repository へ移す。
- 呼び出し側の変更を最小化するため、`LocalStorageRepository` は委譲ラッパーとして残す。

3. 書き込み系 repository の分離
- `save*`, `delete*`, `clear*` を順次移す。
- task 削除時の block 更新は `TaskRepository` から `BlockRepository` を呼ぶ形で一本化する。

4. 統合ファサードの縮小
- 既存の `LocalStorageRepository` は後方互換用ファサードとして最小化する。
- 呼び出し側の依存が解消できた時点で直接各 repository を参照する。

5. 最終整理
- 不要な委譲メソッドを削除し、テストを repository 単位に分割する。

## 補足
- 先に `task_refs` の厳密判定 (TSR-008) を入れ、分割前に誤更新リスクを下げる。
- 既存 DB スキーマは維持し、正規化テーブル (`block_task_refs`) は別タスクで段階導入する。
