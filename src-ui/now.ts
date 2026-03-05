import type { Block, PomodoroState, Task, UiState } from "./types.js";

type UnknownRecord = Record<string, unknown>;
type NowUiState = UiState["nowUi"];
type PomodoroStateLike = PomodoroState;

export function normalizePomodoroState(state: unknown): PomodoroStateLike {
  const source = (state ?? {}) as UnknownRecord;
  const toSafeNumber = (value: unknown) => (Number.isFinite(value) ? Math.max(0, Number(value)) : 0);
  return {
    current_block_id: typeof source.current_block_id === "string" ? source.current_block_id : null,
    current_task_id: typeof source.current_task_id === "string" ? source.current_task_id : null,
    phase: typeof source.phase === "string" ? source.phase : "idle",
    remaining_seconds: toSafeNumber(source.remaining_seconds),
    start_time: typeof source.start_time === "string" ? source.start_time : null,
    total_cycles: toSafeNumber(source.total_cycles),
    completed_cycles: toSafeNumber(source.completed_cycles),
    current_cycle: toSafeNumber(source.current_cycle),
  };
}

export function pomodoroPhaseLabel(phase: unknown): string {
  switch (phase) {
    case "focus":
      return "集中";
    case "break":
      return "休憩";
    case "paused":
      return "一時停止中";
    default:
      return "待機";
  }
}

export function blockDurationMinutes(block: Block | unknown): number {
  const source = (block ?? {}) as UnknownRecord;
  const startMs = new Date(String(source.start_at ?? "")).getTime();
  const endMs = new Date(String(source.end_at ?? "")).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return 0;
  }
  return Math.max(1, Math.round((endMs - startMs) / 60000));
}

export function blockPomodoroTarget(block: Block | unknown, breakDurationMinutes: number): number {
  const source = (block ?? {}) as UnknownRecord;
  const planned = Number(source.planned_pomodoros);
  if (Number.isFinite(planned) && planned > 0) {
    return Math.max(1, Math.floor(planned));
  }
  const duration = blockDurationMinutes(block);
  const cycleMinutes = 25 + Math.max(1, Math.floor(breakDurationMinutes || 5));
  return Math.max(1, Math.floor(duration / cycleMinutes));
}

export function pomodoroProgressPercent(state: unknown): number {
  const source = (state ?? {}) as UnknownRecord;
  const total = Math.max(1, Number(source.total_cycles) || 0);
  return Math.max(0, Math.min(100, Math.round((Math.min(Number(source.completed_cycles) || 0, total) / total) * 100)));
}

export function syncNowTaskOrder(nowUi: NowUiState, tasksInput: Task[] | unknown): void {
  const tasks: Task[] = Array.isArray(tasksInput) ? (tasksInput as Task[]) : [];
  const ids = tasks
    .map((task) => (typeof task?.id === "string" ? String(task.id) : ""))
    .filter((taskId) => taskId.length > 0);
  const idSet = new Set(ids);
  const nextOrder = nowUi.taskOrder.filter((taskId) => idSet.has(taskId));
  ids.forEach((taskId) => {
    if (!nextOrder.includes(taskId)) {
      nextOrder.push(taskId);
    }
  });
  nowUi.taskOrder = nextOrder;
}

export function getNowOrderedTasks(nowUi: NowUiState, tasksInput: Task[] | unknown, includeCompleted = false): Task[] {
  const tasks: Task[] = Array.isArray(tasksInput) ? (tasksInput as Task[]) : [];
  syncNowTaskOrder(nowUi, tasks);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const ordered: Task[] = nowUi.taskOrder
    .map((taskId) => byId.get(taskId))
    .filter((task): task is Task => Boolean(task));
  return includeCompleted ? ordered : ordered.filter((task) => task.status !== "completed");
}

export function resolveNowDayBounds(reference: Date = new Date()): { dayStartMs: number; dayEndMs: number } {
  const start = new Date(reference);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { dayStartMs: start.getTime(), dayEndMs: end.getTime() };
}

export function resolveNowBlocks(
  blocksInput: Block[] | unknown,
  reference: Date = new Date()
): Array<{ block: Block; startMs: number; endMs: number }> {
  const blocks: Block[] = Array.isArray(blocksInput) ? (blocksInput as Block[]) : [];
  const { dayStartMs, dayEndMs } = resolveNowDayBounds(reference);
  return [...blocks]
    .map((block) => {
      const source = (block ?? {}) as UnknownRecord;
      const startMs = new Date(String(source.start_at ?? "")).getTime();
      const endMs = new Date(String(source.end_at ?? "")).getTime();
      return { block, startMs, endMs };
    })
    .filter(
      ({ startMs, endMs }) =>
        Number.isFinite(startMs) &&
        Number.isFinite(endMs) &&
        endMs > startMs &&
        endMs > dayStartMs &&
        startMs < dayEndMs
    )
    .sort((left, right) => left.startMs - right.startMs);
}

export function resolveNowAutoStartBlock(
  blocksInput: Block[] | unknown,
  stateInput: PomodoroStateLike | unknown,
  reference: Date = new Date()
): Block | null {
  const state = normalizePomodoroState(stateInput);
  const todayBlocks = resolveNowBlocks(blocksInput, reference);
  if (state.current_block_id) {
    const current = todayBlocks.find(({ block }) => block.id === state.current_block_id);
    if (current) {
      return current.block;
    }
  }
  const nowMs = Date.now();
  const active = todayBlocks.find(({ startMs, endMs }) => startMs <= nowMs && nowMs < endMs);
  if (active) {
    return active.block;
  }
  const upcoming = todayBlocks.find(({ startMs }) => startMs >= nowMs);
  if (upcoming) {
    return upcoming.block;
  }
  return todayBlocks[0]?.block ?? null;
}

export function resolveNowAutoStartTask(
  nowUi: NowUiState,
  tasksInput: Task[] | unknown,
  stateInput: PomodoroStateLike | unknown
): Task | null {
  const state = normalizePomodoroState(stateInput);
  const ordered = getNowOrderedTasks(nowUi, tasksInput);
  if (state.current_task_id) {
    const current = ordered.find((task) => task.id === state.current_task_id);
    if (current) {
      return current;
    }
  }
  return ordered.find((task) => task.status === "in_progress") || ordered.find((task) => task.status === "pending") || null;
}

export function syncNowTimerDisplay(nowUi: NowUiState, stateInput: unknown, fallbackStateInput: unknown): void {
  const state = normalizePomodoroState(stateInput || fallbackStateInput || {});
  const remainingSeconds = Math.max(0, Math.floor(state.remaining_seconds || 0));
  const previousPhase = nowUi.lastPhase;
  const previousDisplay = Math.max(0, Math.floor(nowUi.displayRemainingSeconds || 0));
  const runningPhase = state.phase === "focus" || state.phase === "break";
  const previousRunningPhase = previousPhase === "focus" || previousPhase === "break";
  const runningPhaseSwitched = runningPhase && previousRunningPhase && previousPhase !== state.phase;

  if (nowUi.lastSyncEpochMs === 0) {
    nowUi.phaseTotalSeconds = Math.max(1, remainingSeconds);
    nowUi.displayRemainingSeconds = remainingSeconds;
  } else if (runningPhaseSwitched) {
    nowUi.phaseTotalSeconds = Math.max(1, remainingSeconds);
    nowUi.displayRemainingSeconds = remainingSeconds;
  } else if (runningPhase) {
    if (!previousRunningPhase) {
      if (previousPhase !== "paused" || nowUi.phaseTotalSeconds <= 0) {
        nowUi.phaseTotalSeconds = Math.max(1, remainingSeconds);
      }
      if (previousPhase === "paused" && previousDisplay > 0) {
        nowUi.displayRemainingSeconds = Math.min(previousDisplay, remainingSeconds);
      } else {
        nowUi.displayRemainingSeconds = remainingSeconds;
      }
    } else {
      nowUi.displayRemainingSeconds = Math.min(previousDisplay, remainingSeconds);
      if (previousDisplay <= 0 && remainingSeconds > 0) {
        nowUi.displayRemainingSeconds = remainingSeconds;
      }
      if (remainingSeconds > nowUi.phaseTotalSeconds) {
        nowUi.phaseTotalSeconds = Math.max(1, remainingSeconds);
      }
    }
  } else if (state.phase === "paused") {
    if (previousDisplay > 0) {
      nowUi.displayRemainingSeconds = Math.min(previousDisplay, remainingSeconds);
    } else {
      nowUi.displayRemainingSeconds = remainingSeconds;
    }
    if (nowUi.phaseTotalSeconds <= 0) {
      nowUi.phaseTotalSeconds = Math.max(1, remainingSeconds);
    }
  } else {
    nowUi.phaseTotalSeconds = Math.max(1, remainingSeconds || nowUi.phaseTotalSeconds || 1);
    nowUi.displayRemainingSeconds = remainingSeconds;
  }
  nowUi.lastPhase = state.phase;
  nowUi.lastSyncEpochMs = Date.now();
}

export function nowBufferAvailableMinutes(blocksInput: Block[] | unknown, reference: Date = new Date()): number {
  const nowMs = reference.getTime();
  const { dayEndMs } = resolveNowDayBounds(reference);
  const availableWindowMs = Math.max(0, dayEndMs - nowMs);
  if (availableWindowMs <= 0) {
    return 0;
  }
  const intervals = resolveNowBlocks(blocksInput, reference)
    .map(({ startMs, endMs }) => ({
      startMs: Math.max(startMs, nowMs),
      endMs: Math.min(endMs, dayEndMs),
    }))
    .filter((interval) => interval.endMs > interval.startMs)
    .sort((left, right) => left.startMs - right.startMs);

  let occupiedMs = 0;
  let cursorStart = -1;
  let cursorEnd = -1;
  intervals.forEach((interval) => {
    if (cursorStart < 0) {
      cursorStart = interval.startMs;
      cursorEnd = interval.endMs;
      return;
    }
    if (interval.startMs > cursorEnd) {
      occupiedMs += cursorEnd - cursorStart;
      cursorStart = interval.startMs;
      cursorEnd = interval.endMs;
      return;
    }
    cursorEnd = Math.max(cursorEnd, interval.endMs);
  });
  if (cursorStart >= 0 && cursorEnd > cursorStart) {
    occupiedMs += cursorEnd - cursorStart;
  }
  return Math.max(0, Math.floor((availableWindowMs - occupiedMs) / 60000));
}

export function resolveCurrentFocusTask(
  tasksInput: Task[] | unknown,
  stateInput: PomodoroStateLike | unknown
): Task | null {
  const state = normalizePomodoroState(stateInput || {});
  const tasks: Task[] = Array.isArray(tasksInput) ? (tasksInput as Task[]) : [];
  if (state.current_task_id) {
    const linked = tasks.find((task) => task.id === state.current_task_id) || null;
    if (linked) {
      return linked;
    }
  }
  return tasks.find((task) => task.status === "in_progress") || null;
}
