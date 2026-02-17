import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BlockOperationsService } from "../src/application/blockOperationsService.js";
import { BlockPlanningService } from "../src/application/blockPlanningService.js";
import { ExternalEditService } from "../src/application/externalEditService.js";
import { ReflectionService } from "../src/application/reflectionService.js";
import { TaskManager } from "../src/application/taskManager.js";
import { createPolicy } from "../src/domain/models.js";
import { PomodoroTimer } from "../src/domain/pomodoroTimer.js";
import { LocalStorageRepository } from "../src/infrastructure/localStorageRepository.js";
import { PomodoroLogRepository } from "../src/infrastructure/pomodoroLogRepository.js";
import { TaskRepository } from "../src/infrastructure/taskRepository.js";

class FakeClock {
  constructor(now) {
    this.current = new Date(now);
  }

  now() {
    return new Date(this.current);
  }

  advance(seconds) {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}

function createContext() {
  const tempDir = mkdtempSync(join(tmpdir(), "pomblock-e2e-"));
  const dbPath = join(tempDir, "pomblock.sqlite");
  const storageRepository = new LocalStorageRepository(dbPath);
  storageRepository.initSchema();

  return {
    tempDir,
    storageRepository,
  };
}

function cleanupContext({ tempDir, storageRepository }) {
  storageRepository.close();
  rmSync(tempDir, { recursive: true, force: true });
}

test("Feature: blocksched, Task 23.1: end-to-end workflow covers auth, sync, block generation, approval, pomodoro, and reflection", () => {
  const context = createContext();
  try {
    const date = "2026-02-16";
    const notifications = [];

    const authGateway = {
      authenticate() {
        return {
          status: "authenticated",
          accessToken: "token-e2e",
        };
      },
    };
    const authResult = authGateway.authenticate();
    assert.equal(authResult.status, "authenticated");
    assert.equal(authResult.accessToken.length > 0, true);

    const syncService = new ExternalEditService({
      storageRepository: context.storageRepository,
      notificationService: {
        notify(type, payload) {
          notifications.push({ type, payload });
        },
      },
    });

    const syncResult = syncService.syncExternalChanges([
      {
        id: "external-evt-1",
        startAt: "2026-02-16T09:00:00.000Z",
        endAt: "2026-02-16T09:30:00.000Z",
      },
    ]);
    assert.equal(syncResult.added.length, 1);
    assert.equal(syncResult.updated.length, 0);
    assert.equal(syncResult.deleted.length, 0);

    const policy = createPolicy({
      workHours: {
        start: "09:00",
        end: "18:00",
        days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      },
      blockDurationMinutes: 50,
      breakDurationMinutes: 10,
      minBlockGapMinutes: 5,
    });

    const createdDraftEvents = [];
    const updatedEvents = [];
    const blockPlanningService = new BlockPlanningService({
      policy,
      storageRepository: context.storageRepository,
      calendarGateway: {
        createDraftBlockEvent(block) {
          const eventId = `generated-${createdDraftEvents.length + 1}`;
          createdDraftEvents.push({ eventId, blockId: block.id });
          return eventId;
        },
      },
      notificationService: {
        notify(type, payload) {
          notifications.push({ type, payload });
        },
      },
    });

    const generatedBlocks = blockPlanningService.planDay(
      date,
      syncResult.added.map((event) => ({
        startAt: event.startAt,
        endAt: event.endAt,
      })),
      {
        source: "routine",
        sourceId: "daily-focus",
        maxBlocks: 2,
      }
    );

    assert.equal(generatedBlocks.length > 0, true);
    assert.equal(createdDraftEvents.length, generatedBlocks.length);
    assert.equal(generatedBlocks.every((block) => block.firmness === "draft"), true);

    const blockOperationsService = new BlockOperationsService({
      storageRepository: context.storageRepository,
      calendarGateway: {
        updateEvent(eventId, block) {
          updatedEvents.push({ eventId, block });
        },
      },
    });

    const approvedBlocks = blockOperationsService.approveBlocks([generatedBlocks[0].id]);
    assert.equal(approvedBlocks.length, 1);
    assert.equal(approvedBlocks[0].firmness, "soft");
    assert.equal(updatedEvents.length, 1);

    const taskRepository = new TaskRepository(context.storageRepository);
    const taskManager = new TaskManager({
      taskRepository,
      storageRepository: context.storageRepository,
    });
    const task = taskManager.createTask("End-to-end task", "task for workflow test", 1);
    taskManager.assignTaskToBlock(task.id, approvedBlocks[0].id);

    const assignedBlock = context.storageRepository.loadBlockById(approvedBlocks[0].id);
    assert.equal(assignedBlock.taskId, task.id);

    const clock = new FakeClock("2026-02-16T10:00:00.000Z");
    const pomodoroLogRepository = new PomodoroLogRepository(context.storageRepository);
    const pomodoroTimer = new PomodoroTimer({
      logRepository: pomodoroLogRepository,
      focusSeconds: 1200,
      breakSeconds: 300,
      clock,
    });

    const started = pomodoroTimer.start(assignedBlock.id, task.id);
    assert.equal(started.phase, "focus");
    assert.equal(started.currentBlockId, assignedBlock.id);
    assert.equal(started.currentTaskId, task.id);

    clock.advance(1200);
    const afterFocus = pomodoroTimer.tick(1200);
    assert.equal(afterFocus.phase, "break");

    clock.advance(60);
    const completed = pomodoroTimer.complete();
    assert.equal(completed.phase, "idle");

    const reflectionService = new ReflectionService({
      pomodoroLogRepository,
    });
    const summary = reflectionService.aggregate(
      "2026-02-16T00:00:00.000Z",
      "2026-02-17T00:00:00.000Z"
    );

    assert.equal(summary.completedCount, 1);
    assert.equal(summary.totalWorkSeconds >= 1200, true);
    assert.equal(summary.logs.some((log) => log.blockId === assignedBlock.id), true);
    assert.equal(summary.logs.some((log) => log.taskId === task.id), true);
    assert.equal(notifications.some((entry) => entry.type === "external_event_added"), true);
  } finally {
    cleanupContext(context);
  }
});
