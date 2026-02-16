import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskManager } from "../src/application/taskManager.js";
import { createBlock } from "../src/domain/models.js";
import { LocalStorageRepository } from "../src/infrastructure/localStorageRepository.js";
import { TaskRepository } from "../src/infrastructure/taskRepository.js";

function createContext() {
  const tempDir = mkdtempSync(join(tmpdir(), "pomblock-task-manager-"));
  const dbPath = join(tempDir, "pomblock.sqlite");
  const storage = new LocalStorageRepository(dbPath);
  storage.initSchema();
  const taskRepository = new TaskRepository(storage);
  const taskManager = new TaskManager({
    taskRepository,
    storageRepository: storage,
  });

  return { tempDir, storage, taskRepository, taskManager };
}

function cleanupContext({ tempDir, storage }) {
  storage.close();
  rmSync(tempDir, { recursive: true, force: true });
}

function seedBlock(storage, { id, date, startAt, endAt }) {
  storage.saveBlock(
    createBlock({
      id,
      instance: `rtn:rtn_focus:${date}:${id}`,
      date,
      startAt,
      endAt,
      type: "deep",
      firmness: "draft",
      source: "routine",
      sourceId: "rtn_focus",
    })
  );
}

test("Feature: blocksched, Property 21: tasks are not pre-assigned before block starts", () => {
  const context = createContext();
  try {
    seedBlock(context.storage, {
      id: "block-1",
      date: "2026-02-16",
      startAt: "2026-02-16T09:00:00.000Z",
      endAt: "2026-02-16T09:50:00.000Z",
    });
    const block = context.storage.loadBlockById("block-1");
    assert.equal(block.taskId, null);
  } finally {
    cleanupContext(context);
  }
});

test("Feature: blocksched, Property 19/20: task assignment links task to block and writes audit logs", () => {
  const context = createContext();
  try {
    for (let run = 0; run < 100; run += 1) {
      const blockId = `block-${run}`;
      seedBlock(context.storage, {
        id: blockId,
        date: "2026-02-16",
        startAt: "2026-02-16T09:00:00.000Z",
        endAt: "2026-02-16T09:50:00.000Z",
      });

      const task = context.taskManager.createTask(`Task ${run}`, "assignment test", 2);
      context.taskManager.assignTaskToBlock(task.id, blockId);

      const block = context.storage.loadBlockById(blockId);
      assert.equal(block.taskId, task.id);
      assert.equal(block.taskRefs.includes(task.id), true);
    }

    const logs = context.taskRepository.listTaskAuditLogs(500);
    const selectedLogs = logs.filter((row) => row.eventType === "task_selected");
    assert.equal(selectedLogs.length >= 100, true);
  } finally {
    cleanupContext(context);
  }
});

test("Feature: blocksched, Property 24/26: carry-over re-links task to next block and logs history", () => {
  const context = createContext();
  try {
    seedBlock(context.storage, {
      id: "block-from",
      date: "2026-02-16",
      startAt: "2026-02-16T09:00:00.000Z",
      endAt: "2026-02-16T09:50:00.000Z",
    });
    seedBlock(context.storage, {
      id: "block-next",
      date: "2026-02-16",
      startAt: "2026-02-16T10:00:00.000Z",
      endAt: "2026-02-16T10:50:00.000Z",
    });

    const task = context.taskManager.createTask("Carry task", null, 3);
    context.taskManager.assignTaskToBlock(task.id, "block-from");
    const nextBlockId = context.taskManager.carryOverTask(task.id, "block-from", [
      { ...context.storage.loadBlockById("block-next") },
    ]);

    assert.equal(nextBlockId, "block-next");
    assert.equal(context.storage.loadBlockById("block-next").taskId, task.id);

    const logs = context.taskRepository.listTaskAuditLogs();
    assert.equal(logs.some((row) => row.eventType === "task_carried_over"), true);
  } finally {
    cleanupContext(context);
  }
});

test("Feature: blocksched, Property 25/26: task split creates children and logs split history", () => {
  const context = createContext();
  try {
    const parent = context.taskManager.createTask("Large task", "split test", 8);
    const children = context.taskManager.splitTask(parent.id, 4);

    assert.equal(children.length, 4);
    assert.equal(children.every((child) => child.title.startsWith("Large task")), true);
    assert.equal(children.every((child) => child.estimatedPomodoros === 2), true);

    const refreshedParent = context.taskRepository.getById(parent.id);
    assert.equal(refreshedParent.status, "deferred");

    const logs = context.taskRepository.listTaskAuditLogs();
    assert.equal(logs.some((row) => row.eventType === "task_split"), true);
  } finally {
    cleanupContext(context);
  }
});
