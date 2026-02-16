import test from "node:test";
import assert from "node:assert/strict";
import { createPomodoroLog } from "../src/domain/models.js";
import { PomodoroTimer } from "../src/domain/pomodoroTimer.js";

class FakeClock {
  constructor(now = "2026-02-16T09:00:00.000Z") {
    this.current = new Date(now);
  }

  now() {
    return new Date(this.current);
  }

  advance(seconds) {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}

class MemoryPomodoroLogRepository {
  constructor() {
    this.logs = new Map();
  }

  save(logInput) {
    const log = createPomodoroLog(logInput);
    this.logs.set(log.id, log);
    return log;
  }

  load(startAt, endAt) {
    const from = new Date(startAt).getTime();
    const to = new Date(endAt).getTime();
    return [...this.logs.values()]
      .filter((log) => {
        const start = new Date(log.startTime).getTime();
        return start >= from && start <= to;
      })
      .sort((left, right) => left.startTime.localeCompare(right.startTime));
  }

  all() {
    return [...this.logs.values()];
  }
}

test("Feature: blocksched, Property 15: starting pomodoro activates running timer", () => {
  for (let run = 0; run < 100; run += 1) {
    const clock = new FakeClock();
    const repository = new MemoryPomodoroLogRepository();
    const focusSeconds = 600 + Math.floor(Math.random() * 1800);
    const breakSeconds = 120 + Math.floor(Math.random() * 600);
    const timer = new PomodoroTimer({
      logRepository: repository,
      focusSeconds,
      breakSeconds,
      clock,
    });

    const state = timer.start(`block-${run}`, run % 2 === 0 ? `task-${run}` : null);
    assert.equal(state.phase, "focus");
    assert.equal(state.remainingSeconds, focusSeconds);
    assert.equal(state.currentBlockId, `block-${run}`);
    assert.equal(repository.all().length, 1);
  }
});

test("Feature: blocksched, Property 16: break phase starts automatically after focus ends", () => {
  for (let run = 0; run < 100; run += 1) {
    const clock = new FakeClock();
    const repository = new MemoryPomodoroLogRepository();
    const focusSeconds = 300 + Math.floor(Math.random() * 1200);
    const breakSeconds = 120 + Math.floor(Math.random() * 600);
    const timer = new PomodoroTimer({
      logRepository: repository,
      focusSeconds,
      breakSeconds,
      clock,
    });

    timer.start(`block-${run}`, null);
    clock.advance(focusSeconds);
    const state = timer.tick(focusSeconds);

    assert.equal(state.phase, "break");
    assert.equal(state.remainingSeconds, breakSeconds);
    const logs = repository.all();
    assert.equal(logs.some((log) => log.phase === "focus" && log.endTime !== null), true);
    assert.equal(logs.some((log) => log.phase === "break" && log.endTime === null), true);
  }
});

test("Feature: blocksched, Property 17: interruption reason and time are logged on pause", () => {
  for (let run = 0; run < 100; run += 1) {
    const clock = new FakeClock();
    const repository = new MemoryPomodoroLogRepository();
    const timer = new PomodoroTimer({
      logRepository: repository,
      focusSeconds: 1500,
      breakSeconds: 300,
      clock,
    });

    timer.start(`block-${run}`, `task-${run}`);
    clock.advance(60 + Math.floor(Math.random() * 600));
    timer.pause("incoming_meeting");

    const interrupted = repository
      .all()
      .find((log) => log.phase === "focus" && log.interruptionReason === "incoming_meeting");
    assert.notEqual(interrupted, undefined);
    assert.notEqual(interrupted.endTime, null);
  }
});

test("Feature: blocksched, Property 18: complete or interrupted sessions are persisted as logs", () => {
  for (let run = 0; run < 100; run += 1) {
    const clock = new FakeClock();
    const repository = new MemoryPomodoroLogRepository();
    const timer = new PomodoroTimer({
      logRepository: repository,
      focusSeconds: 900,
      breakSeconds: 300,
      clock,
    });

    timer.start(`block-${run}`, `task-${run}`);

    if (run % 2 === 0) {
      clock.advance(450);
      timer.complete();
      const logs = repository.all();
      assert.equal(logs.some((log) => log.phase === "focus" && log.endTime !== null), true);
    } else {
      clock.advance(300);
      timer.pause("context_switch");
      clock.advance(60);
      timer.resume();
      clock.advance(120);
      timer.complete();
      const logs = repository.all();
      assert.equal(
        logs.some((log) => log.interruptionReason === "context_switch" && log.endTime !== null),
        true
      );
      assert.equal(logs.filter((log) => log.phase === "focus").length >= 2, true);
    }

    assert.equal(timer.getState().phase, "idle");
  }
});
