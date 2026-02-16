import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBlock } from "../src/domain/models.js";
import { LocalStorageRepository } from "../src/infrastructure/localStorageRepository.js";
import { PomodoroLogRepository } from "../src/infrastructure/pomodoroLogRepository.js";

test("PomodoroLogRepository persists and loads pomodoro logs via local storage", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pomblock-pomo-log-"));
  const dbPath = join(tempDir, "pomblock.sqlite");

  const storage = new LocalStorageRepository(dbPath);
  storage.initSchema();
  storage.saveBlock(
    createBlock({
      id: "block-1",
      instance: "rtn:rtn_focus:2026-02-16:0",
      date: "2026-02-16",
      startAt: "2026-02-16T09:00:00.000Z",
      endAt: "2026-02-16T09:50:00.000Z",
      type: "deep",
      firmness: "soft",
      source: "routine",
      sourceId: "rtn_focus",
    })
  );

  const repository = new PomodoroLogRepository(storage);
  repository.save({
    id: "log-1",
    blockId: "block-1",
    taskId: null,
    phase: "focus",
    startTime: "2026-02-16T09:00:00.000Z",
    endTime: "2026-02-16T09:25:00.000Z",
  });

  const logs = repository.load("2026-02-16T00:00:00.000Z", "2026-02-16T23:59:59.000Z");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].id, "log-1");
  assert.equal(logs[0].phase, "focus");
  assert.equal(logs[0].endTime, "2026-02-16T09:25:00.000Z");

  storage.close();
  rmSync(tempDir, { recursive: true, force: true });
});
