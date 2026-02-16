import test from "node:test";
import assert from "node:assert/strict";
import { ReflectionService } from "../src/application/reflectionService.js";

class MemoryPomodoroLogRepository {
  constructor(logs) {
    this.logs = logs;
  }

  load(startAt, endAt) {
    const from = new Date(startAt).getTime();
    const to = new Date(endAt).getTime();
    return this.logs.filter((log) => {
      const start = new Date(log.startTime).getTime();
      return start >= from && start <= to;
    });
  }
}

test("Feature: blocksched, Property 32: reflection aggregates match underlying logs", () => {
  const rangeStart = "2026-02-16T00:00:00.000Z";
  const rangeEnd = "2026-02-18T00:00:00.000Z";

  for (let run = 0; run < 100; run += 1) {
    const base = Date.parse("2026-02-16T08:00:00.000Z");
    const size = 1 + Math.floor(Math.random() * 40);
    const logs = [];
    let expectedCompleted = 0;
    let expectedInterrupted = 0;
    let expectedTotalSeconds = 0;

    for (let index = 0; index < size; index += 1) {
      const phase = Math.random() < 0.7 ? "focus" : "break";
      const start = new Date(base + index * 1800_000);
      const durationSeconds = 300 + Math.floor(Math.random() * 1800);
      const hasEnd = Math.random() < 0.95;
      const hasInterruption = Math.random() < 0.3;
      const interruptionReason = hasInterruption ? "interrupted" : null;
      const end = hasEnd ? new Date(start.getTime() + durationSeconds * 1000) : null;

      const log = {
        id: `log-${run}-${index}`,
        blockId: `block-${run}`,
        taskId: `task-${run}`,
        phase,
        startTime: start.toISOString(),
        endTime: end ? end.toISOString() : null,
        interruptionReason,
      };
      logs.push(log);

      if (interruptionReason) {
        expectedInterrupted += 1;
      }
      if (phase === "focus" && end) {
        expectedTotalSeconds += durationSeconds;
        if (!interruptionReason) {
          expectedCompleted += 1;
        }
      }
    }

    const repository = new MemoryPomodoroLogRepository(logs);
    const service = new ReflectionService({ pomodoroLogRepository: repository });
    const aggregated = service.aggregate(rangeStart, rangeEnd);

    assert.equal(aggregated.completedCount, expectedCompleted);
    assert.equal(aggregated.interruptedCount, expectedInterrupted);
    assert.equal(aggregated.totalWorkSeconds, expectedTotalSeconds);
    assert.equal(aggregated.totalWorkMinutes, Math.floor(expectedTotalSeconds / 60));
    assert.equal(aggregated.logs.length, logs.length);
  }
});
