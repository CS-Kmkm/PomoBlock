import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBlock, createTask } from "../src/domain/models.js";
import { LocalStorageRepository } from "../src/infrastructure/localStorageRepository.js";

test("Feature: blocksched, Property 30: deleted local data is fully removed", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pomblock-storage-delete-"));
  const dbPath = join(tempDir, "pomblock.sqlite");
  const repository = new LocalStorageRepository(dbPath);
  repository.initSchema();

  const block = createBlock({
    id: "block-1",
    instance: "rtn:rtn_focus:2026-02-16:0",
    date: "2026-02-16",
    startAt: "2026-02-16T09:00:00.000Z",
    endAt: "2026-02-16T09:50:00.000Z",
    type: "deep",
    source: "routine",
    sourceId: "rtn_focus",
    taskRefs: ["task-1"],
    taskId: "task-1",
  });
  repository.saveBlock(block);

  const task = createTask({
    id: "task-1",
    title: "Persist and delete me",
    estimatedPomodoros: 3,
  });
  repository.saveTask(task);

  repository.savePomodoroLog({
    id: "log-1",
    blockId: block.id,
    taskId: task.id,
    phase: "focus",
    startTime: "2026-02-16T09:00:00.000Z",
    endTime: "2026-02-16T09:25:00.000Z",
  });
  repository.saveSyncState({
    syncToken: "sync-token",
    lastSyncTime: "2026-02-16T00:00:00.000Z",
  });
  repository.saveSuppression(block.instance, "deleted by user");
  repository.appendAuditLog("task_selected", { taskId: task.id, blockId: block.id });

  repository.deletePomodoroLog("log-1");
  assert.equal(
    repository.loadPomodoroLogs("2026-02-16T00:00:00.000Z", "2026-02-16T23:59:59.000Z").length,
    0
  );

  repository.savePomodoroLog({
    id: "log-2",
    blockId: block.id,
    taskId: task.id,
    phase: "focus",
    startTime: "2026-02-16T10:00:00.000Z",
    endTime: "2026-02-16T10:25:00.000Z",
  });
  repository.deleteTask(task.id);
  assert.equal(repository.loadTasks().length, 0);
  const blockAfterTaskDelete = repository.loadBlockById(block.id);
  assert.equal(blockAfterTaskDelete.taskId, null);
  assert.equal(blockAfterTaskDelete.taskRefs.includes(task.id), false);
  assert.equal(
    repository.loadPomodoroLogs("2026-02-16T00:00:00.000Z", "2026-02-16T23:59:59.000Z").length,
    0
  );

  repository.deleteBlock(block.id);
  assert.equal(repository.loadBlocks("2026-02-16").length, 0);

  repository.clearSyncState();
  assert.equal(repository.loadSyncState(), null);

  repository.clearSuppressions();
  assert.equal(repository.loadSuppressions().length, 0);

  repository.clearAuditLogs();
  assert.equal(repository.loadAuditLogs().length, 0);

  repository.close();
  rmSync(tempDir, { recursive: true, force: true });
});
