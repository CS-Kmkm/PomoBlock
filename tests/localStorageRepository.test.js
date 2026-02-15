import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBlock, createTask } from "../src/domain/models.js";
import { LocalStorageRepository } from "../src/infrastructure/localStorageRepository.js";

test("LocalStorageRepository can save and load blocks, tasks, sync state, suppressions", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pomblock-test-"));
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
  });
  repository.saveBlock(block);

  const task = createTask({
    id: "task-1",
    title: "Write sync layer",
    estimatedPomodoros: 4,
  });
  repository.saveTask(task);

  repository.saveSyncState({
    syncToken: "sync-token-1",
    lastSyncTime: "2026-02-16T00:00:00.000Z",
  });
  repository.saveSuppression(block.instance, "user deleted block");

  const loadedBlocks = repository.loadBlocks("2026-02-16");
  const loadedTasks = repository.loadTasks();
  const loadedSyncState = repository.loadSyncState();
  const loadedSuppressions = repository.loadSuppressions();

  assert.equal(loadedBlocks.length, 1);
  assert.equal(loadedBlocks[0].id, "block-1");
  assert.equal(loadedTasks.length, 1);
  assert.equal(loadedTasks[0].id, "task-1");
  assert.equal(loadedSyncState?.syncToken, "sync-token-1");
  assert.equal(loadedSuppressions.length, 1);
  assert.equal(loadedSuppressions[0].instance, block.instance);

  repository.close();
  rmSync(tempDir, { recursive: true, force: true });
});
