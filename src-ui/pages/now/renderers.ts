import type { PomodoroState, Task, UiState } from "../../types.js";

type NowNotesRendererDeps = {
  uiState: UiState;
  escapeHtml: (value: unknown) => string;
  normalizePomodoroState: (state: unknown) => PomodoroState;
  resolveCurrentFocusTask: (stateInput?: PomodoroState) => Task | null;
};

export function renderNowNotesPanel({
  uiState,
  escapeHtml,
  normalizePomodoroState,
  resolveCurrentFocusTask,
}: NowNotesRendererDeps): string {
  const activeTask = resolveCurrentFocusTask(normalizePomodoroState(uiState.pomodoro || {})) || null;
  const defaultNote = activeTask ? `Now focusing: ${activeTask.title || "(untitled)"}` : "Type notes here...";

  return `
    <section class="now-notes-panel">
      <div class="row spread">
        <h3>Session Notes</h3>
        <span class="small">${activeTask ? "active task linked" : "free form"}</span>
      </div>
      <textarea class="now-notes-input" placeholder="${escapeHtml(defaultNote)}"></textarea>
    </section>
  `;
}
