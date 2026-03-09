import type { PomodoroState, Task } from "../types.js";

export interface StartPollingLoopOptions {
  getRoute: () => string;
  invokeCommand: (name: string, payload?: Record<string, unknown>) => Promise<unknown>;
  onPomodoroState: (state: PomodoroState) => void;
  onTasks: (tasks: Task[]) => void;
  syncNowTimerDisplay: (stateInput: unknown) => void;
  syncNowTaskOrder: (tasksInput?: Task[]) => void;
  renderNowPage: () => void;
  refreshWeekPage: () => void;
  intervalMs?: number;
}

export interface StartCountdownLoopOptions {
  getRoute: () => string;
  getPomodoroState: () => PomodoroState | null | undefined;
  normalizePomodoroState: (state: unknown) => PomodoroState;
  getDisplayRemainingSeconds: () => number;
  setDisplayRemainingSeconds: (seconds: number) => void;
  renderNowPage: () => void;
  refreshWeekStatusTimerDisplay: () => void;
  intervalMs?: number;
}

export interface RuntimeLoopHandles {
  pollingTimerId: ReturnType<typeof setInterval>;
  countdownTimerId: ReturnType<typeof setInterval>;
  stop: () => void;
}

export function startPollingLoop(options: StartPollingLoopOptions): ReturnType<typeof setInterval> {
  const {
    getRoute,
    invokeCommand,
    onPomodoroState,
    onTasks,
    syncNowTimerDisplay,
    syncNowTaskOrder,
    renderNowPage,
    refreshWeekPage,
    intervalMs = 5000,
  } = options;

  return setInterval(async () => {
    const route = getRoute();
    if (route !== "now" && route !== "week") {
      return;
    }
    try {
      const [pomodoroResult, tasksResult] = await Promise.allSettled([
        invokeCommand("get_pomodoro_state", {}),
        invokeCommand("list_tasks", {}),
      ]);
      if (pomodoroResult.status === "fulfilled") {
        const pomodoroState = pomodoroResult.value as PomodoroState;
        onPomodoroState(pomodoroState);
        syncNowTimerDisplay(pomodoroState);
      }
      if (tasksResult.status === "fulfilled") {
        const tasks = tasksResult.value as Task[];
        onTasks(tasks);
        syncNowTaskOrder(tasks);
      }
      if (route === "now") {
        renderNowPage();
      } else {
        refreshWeekPage();
      }
    } catch {
      // Errors are handled by caller-side invoke wrappers.
    }
  }, intervalMs);
}

export function startCountdownLoop(options: StartCountdownLoopOptions): ReturnType<typeof setInterval> {
  const {
    getRoute,
    getPomodoroState,
    normalizePomodoroState,
    getDisplayRemainingSeconds,
    setDisplayRemainingSeconds,
    renderNowPage,
    refreshWeekStatusTimerDisplay,
    intervalMs = 1000,
  } = options;

  return setInterval(() => {
    const route = getRoute();
    if (route !== "now" && route !== "week") {
      return;
    }
    const state = normalizePomodoroState(getPomodoroState() || {});
    if (state.phase !== "focus" && state.phase !== "break") {
      return;
    }
    const remaining = getDisplayRemainingSeconds();
    if (remaining <= 0) {
      return;
    }
    setDisplayRemainingSeconds(Math.max(0, remaining - 1));
    if (route === "now") {
      renderNowPage();
    } else {
      refreshWeekStatusTimerDisplay();
    }
  }, intervalMs);
}

export function startRuntimeLoops(options: {
  polling: StartPollingLoopOptions;
  countdown: StartCountdownLoopOptions;
}): RuntimeLoopHandles {
  const pollingTimerId = startPollingLoop(options.polling);
  const countdownTimerId = startCountdownLoop(options.countdown);
  return {
    pollingTimerId,
    countdownTimerId,
    stop: () => {
      clearInterval(pollingTimerId);
      clearInterval(countdownTimerId);
    },
  };
}
