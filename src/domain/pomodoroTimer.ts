import { randomUUID } from "node:crypto";
import type { PomodoroLog } from "./models.js";

// Legacy reference implementation during the Rust backend migration.
// Production timer behavior is sourced from `src-tauri/`.

type Clock = {
  now(): Date;
};

type PomodoroState = {
  currentBlockId: string | null;
  currentTaskId: string | null;
  phase: "idle" | "focus" | "break" | "paused";
  remainingSeconds: number;
  startTime: string | null;
};

type ActivePhase = "focus" | "break";

type PomodoroLogRepositoryPort = {
  save(logInput: Partial<PomodoroLog> & Pick<PomodoroLog, "blockId" | "startTime">): PomodoroLog;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function validateId(value: string, fieldName: string): void {
  assert(typeof value === "string" && value.trim().length > 0, `${fieldName} is required`);
}

function nowIso(clock: Clock): string {
  return clock.now().toISOString();
}

function cloneState(state: PomodoroState): PomodoroState {
  return {
    currentBlockId: state.currentBlockId,
    currentTaskId: state.currentTaskId,
    phase: state.phase,
    remainingSeconds: state.remainingSeconds,
    startTime: state.startTime,
  };
}

export class PomodoroTimer {
  private readonly logRepository: PomodoroLogRepositoryPort;
  private readonly focusSeconds: number;
  private readonly breakSeconds: number;
  private readonly clock: Clock;
  private pausedPhase: ActivePhase | null;
  private activeLog: PomodoroLog | null;
  private state: PomodoroState;

  constructor({
    logRepository,
    focusSeconds = 25 * 60,
    breakSeconds = 5 * 60,
    clock = { now: () => new Date() },
  }: {
    logRepository: PomodoroLogRepositoryPort;
    focusSeconds?: number;
    breakSeconds?: number;
    clock?: Clock;
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

  start(blockId: string, taskId: string | null = null): PomodoroState {
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

  pause(reason: string | null = null): PomodoroState {
    assert(this.state.phase === "focus" || this.state.phase === "break", "timer is not running");
    this.endActiveLog({ interruptionReason: reason ?? "paused" });
    this.pausedPhase = this.state.phase;
    this.state.phase = "paused";
    return this.getState();
  }

  resume(): PomodoroState {
    assert(this.state.phase === "paused", "timer is not paused");
    assert(this.pausedPhase !== null, "paused phase is missing");
    assert(this.state.currentBlockId !== null, "block id is missing");

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

  tick(seconds = 1): PomodoroState {
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
      assert(this.state.currentBlockId !== null, "block id is missing");
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

  complete(): PomodoroState {
    if (this.state.phase === "idle") {
      return this.getState();
    }

    this.endActiveLog();
    this.resetToIdle();
    return this.getState();
  }

  getState(): PomodoroState {
    return cloneState(this.state);
  }

  private endActiveLog({ interruptionReason = null }: { interruptionReason?: string | null } = {}): void {
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

  private resetToIdle(): void {
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
