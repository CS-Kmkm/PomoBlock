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
        <span class="small">AUTO-SAVED 14:22</span>
      </div>
      <textarea class="now-notes-input" placeholder="${escapeHtml(defaultNote)}"></textarea>
      <div class="now-notes-toolbar">
        <span>B</span>
        <span>&#8801;</span>
        <span>&#128206;</span>
      </div>
    </section>
  `;
}
