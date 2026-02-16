import { randomUUID } from "node:crypto";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function validateId(value, fieldName) {
  assert(typeof value === "string" && value.trim().length > 0, `${fieldName} is required`);
}

function nowIso(clock) {
  return clock.now().toISOString();
}

function cloneState(state) {
  return {
    currentBlockId: state.currentBlockId,
    currentTaskId: state.currentTaskId,
    phase: state.phase,
    remainingSeconds: state.remainingSeconds,
    startTime: state.startTime,
  };
}

export class PomodoroTimer {
  constructor({
    logRepository,
    focusSeconds = 25 * 60,
    breakSeconds = 5 * 60,
    clock = { now: () => new Date() },
  }) {
    assert(logRepository, "logRepository is required");
    assert(Number.isInteger(focusSeconds) && focusSeconds > 0, "focusSeconds must be > 0");
    assert(Number.isInteger(breakSeconds) && breakSeconds > 0, "breakSeconds must be > 0");

    this.logRepository = logRepository;
    this.focusSeconds = focusSeconds;
    this.breakSeconds = breakSeconds;
    this.clock = clock;
    this.pausedPhase = null;
    this.activeLog = null;
    this.state = {
      currentBlockId: null,
      currentTaskId: null,
      phase: "idle",
      remainingSeconds: 0,
      startTime: null,
    };
  }

  start(blockId, taskId = null) {
    validateId(blockId, "blockId");
    if (taskId !== null) {
      validateId(taskId, "taskId");
    }
    assert(this.state.phase === "idle", "timer must be idle before start");

    const startTime = nowIso(this.clock);
    this.state = {
      currentBlockId: blockId,
      currentTaskId: taskId,
      phase: "focus",
      remainingSeconds: this.focusSeconds,
      startTime,
    };
    this.pausedPhase = null;
    this.activeLog = this.logRepository.save({
      id: randomUUID(),
      blockId,
      taskId,
      phase: "focus",
      startTime,
    });

    return this.getState();
  }

  pause(reason = null) {
    assert(
      this.state.phase === "focus" || this.state.phase === "break",
      "timer is not running"
    );
    this.endActiveLog({ interruptionReason: reason ?? "paused" });
    this.pausedPhase = this.state.phase;
    this.state.phase = "paused";
    return this.getState();
  }

  resume() {
    assert(this.state.phase === "paused", "timer is not paused");
    assert(this.pausedPhase !== null, "paused phase is missing");

    this.state.phase = this.pausedPhase;
    this.pausedPhase = null;
    this.activeLog = this.logRepository.save({
      id: randomUUID(),
      blockId: this.state.currentBlockId,
      taskId: this.state.currentTaskId,
      phase: this.state.phase,
      startTime: nowIso(this.clock),
    });

    return this.getState();
  }

  tick(seconds = 1) {
    assert(Number.isInteger(seconds) && seconds > 0, "seconds must be a positive integer");
    if (this.state.phase !== "focus" && this.state.phase !== "break") {
      return this.getState();
    }

    this.state.remainingSeconds = Math.max(0, this.state.remainingSeconds - seconds);
    if (this.state.remainingSeconds > 0) {
      return this.getState();
    }

    if (this.state.phase === "focus") {
      this.endActiveLog();
      this.state.phase = "break";
      this.state.remainingSeconds = this.breakSeconds;
      this.activeLog = this.logRepository.save({
        id: randomUUID(),
        blockId: this.state.currentBlockId,
        taskId: this.state.currentTaskId,
        phase: "break",
        startTime: nowIso(this.clock),
      });
      return this.getState();
    }

    this.endActiveLog();
    this.resetToIdle();
    return this.getState();
  }

  complete() {
    if (this.state.phase === "idle") {
      return this.getState();
    }

    this.endActiveLog();
    this.resetToIdle();
    return this.getState();
  }

  getState() {
    return cloneState(this.state);
  }

  endActiveLog({ interruptionReason = null } = {}) {
    if (!this.activeLog) {
      return;
    }
    this.activeLog = this.logRepository.save({
      ...this.activeLog,
      endTime: nowIso(this.clock),
      interruptionReason,
    });
    this.activeLog = null;
  }

  resetToIdle() {
    this.state = {
      currentBlockId: null,
      currentTaskId: null,
      phase: "idle",
      remainingSeconds: 0,
      startTime: null,
    };
    this.pausedPhase = null;
    this.activeLog = null;
  }
}
