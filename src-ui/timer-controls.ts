import type { Block, PomodoroState } from "./types.js";

export interface TimerControlModel {
  leftAction: string;
  leftLabel: string;
  leftIcon: string;
  leftDisabled: boolean;
  rightAction: string;
  rightLabel: string;
  rightIcon: string;
  rightDisabled: boolean;
  primaryAction: string;
  primaryLabel: string;
  primaryIcon: string;
  primaryDisabled: boolean;
}

export interface TimerControlModelDeps {
  actionInFlight: boolean;
  normalizePomodoroState: (state: unknown) => PomodoroState;
  resolveNowAutoStartBlock: (state: PomodoroState) => Block | null;
}

export function resolveTimerControlModel(
  stateInput: unknown,
  deps: TimerControlModelDeps
): TimerControlModel {
  const state = deps.normalizePomodoroState(stateInput || {});
  const canStart = state.phase === "idle" && Boolean(deps.resolveNowAutoStartBlock(state));
  const isRunningPhase = state.phase === "focus" || state.phase === "break";
  const canPause = isRunningPhase;
  const canNext = isRunningPhase;
  const canStop = isRunningPhase;
  const canResume = state.phase === "paused";
  const controlsDisabled = Boolean(deps.actionInFlight);
  const leftAction = canStop ? "stop" : "";
  const rightAction = canNext ? "next" : "";
  const primaryAction = state.phase === "idle" ? "start" : canPause ? "pause" : canResume ? "resume" : "";

  return {
    leftAction,
    leftLabel: "Stop",
    leftIcon: "?",
    leftDisabled: controlsDisabled || !leftAction,
    rightAction,
    rightLabel: "Next",
    rightIcon: "?",
    rightDisabled: controlsDisabled || !rightAction,
    primaryAction,
    primaryLabel: primaryAction === "start" ? "開始" : primaryAction === "pause" ? "中断" : "再開",
    primaryIcon: primaryAction === "pause" ? "?" : "?",
    primaryDisabled:
      controlsDisabled || !primaryAction || (primaryAction === "start" && !canStart) || (primaryAction === "pause" && !canPause) || (primaryAction === "resume" && !canResume),
  };
}
