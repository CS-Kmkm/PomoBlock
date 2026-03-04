import type { Block, PomodoroState, Recipe, Task, UiState } from "./types.js";

type TimerControlModel = {
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
};

type TodayRendererDeps = {
  uiState: UiState;
  escapeHtml: (value: unknown) => string;
  blockTitle: (block: { id?: string } | null | undefined) => string;
  formatHHmm: (value: string | null | undefined) => string;
  normalizePomodoroState: (state: unknown) => PomodoroState;
  pomodoroPhaseLabel: (phase: unknown) => string;
  pomodoroProgressPercent: (state: unknown) => number;
  resolveCurrentFocusTask: (stateInput?: PomodoroState) => Task | null;
  resolveTimerControlModel: (stateInput?: unknown) => TimerControlModel;
  toTimerText: (seconds: number | null | undefined) => string;
};

export function renderTodaySequenceItems({ uiState, escapeHtml }: Pick<TodayRendererDeps, "uiState" | "escapeHtml">): string {
  const recipes = Array.isArray(uiState.recipes) ? uiState.recipes : [];
  if (recipes.length === 0) {
    return '<p class="small">シーケンスがありません。Routinesで追加してください。</p>';
  }
  return recipes
    .slice(0, 8)
    .map((recipe: Recipe) => {
      const name = typeof recipe?.name === "string" && recipe.name.trim() ? recipe.name.trim() : "Untitled";
      const autoDriveMode = typeof recipe?.auto_drive_mode === "string" && recipe.auto_drive_mode.trim() ? recipe.auto_drive_mode.trim() : "manual";
      const stepCount = Array.isArray(recipe?.steps) ? recipe.steps.length : 0;
      return `
        <article class="today-sequence-item">
          <div class="today-sequence-icon" aria-hidden="true">${escapeHtml(name.slice(0, 1).toUpperCase())}</div>
          <div class="today-sequence-content">
            <p class="today-sequence-title">${escapeHtml(name)}</p>
            <p class="today-sequence-meta">${escapeHtml(autoDriveMode)} / ${stepCount} steps</p>
          </div>
        </article>
      `;
    })
    .join("");
}

export function renderTodayLibraryLinks(): string {
  return `
    <ul class="today-library-links">
      <li><a href="#/insights">History</a></li>
      <li><a href="#/routines">Templates</a></li>
    </ul>
  `;
}

export function renderTodayStatusCard(deps: TodayRendererDeps): string {
  const { uiState, normalizePomodoroState, resolveTimerControlModel, pomodoroPhaseLabel, resolveCurrentFocusTask, blockTitle, pomodoroProgressPercent, toTimerText, escapeHtml } = deps;
  const state = normalizePomodoroState(uiState.pomodoro || {});
  const controls = resolveTimerControlModel(state);
  const phaseLabel = pomodoroPhaseLabel(state.phase);
  const focusTask = resolveCurrentFocusTask(state);
  const currentBlock = state.current_block_id ? uiState.blocks.find((block: Block) => block.id === state.current_block_id) || null : null;
  const currentTitle = currentBlock ? blockTitle(currentBlock) || currentBlock.id : "-";
  const progressPercent = pomodoroProgressPercent(state);
  const displayRemainingSeconds =
    uiState.nowUi.lastSyncEpochMs > 0 ? Math.max(0, Math.floor(uiState.nowUi.displayRemainingSeconds || 0)) : Math.max(0, Math.floor(state.remaining_seconds || 0));
  return `
    <section class="today-right-section today-right-section--status">
      <h3>Current Status</h3>
      <div class="today-status-card">
        <span class="pill today-status-pill">${phaseLabel}</span>
        <p class="today-status-title">${escapeHtml(currentTitle)}</p>
        <p class="today-status-subtitle">Block: ${escapeHtml(state.current_block_id || "-")}</p>
        <p class="today-status-subtitle">Task: ${escapeHtml(focusTask?.title || "-")}</p>
        <div class="today-status-time" data-today-status-time>${toTimerText(displayRemainingSeconds)}</div>
        <div class="today-status-controls">
          <button class="today-status-action today-status-action--secondary" data-today-timer-action="${controls.leftAction}" aria-label="${controls.leftLabel}" title="${controls.leftLabel}" ${controls.leftDisabled ? "disabled" : ""}><span class="now-control-icon" aria-hidden="true">${controls.leftIcon}</span><span class="now-visually-hidden">${controls.leftLabel}</span></button>
          <button class="today-status-action today-status-action--primary" data-today-timer-action="${controls.primaryAction}" aria-label="${controls.primaryLabel}" title="${controls.primaryLabel}" ${controls.primaryDisabled ? "disabled" : ""}><span class="now-control-icon" aria-hidden="true">${controls.primaryIcon}</span><span class="now-visually-hidden">${controls.primaryLabel}</span></button>
          <button class="today-status-action today-status-action--secondary" data-today-timer-action="${controls.rightAction}" aria-label="${controls.rightLabel}" title="${controls.rightLabel}" ${controls.rightDisabled ? "disabled" : ""}><span class="now-control-icon" aria-hidden="true">${controls.rightIcon}</span><span class="now-visually-hidden">${controls.rightLabel}</span></button>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${progressPercent}%"></div></div>
      </div>
    </section>
  `;
}

export function renderTodayTaskPanel({ uiState, normalizePomodoroState, resolveCurrentFocusTask, escapeHtml }: Pick<TodayRendererDeps, "uiState" | "normalizePomodoroState" | "resolveCurrentFocusTask" | "escapeHtml">): string {
  const state = normalizePomodoroState(uiState.pomodoro || {});
  const focusTask = resolveCurrentFocusTask(state);
  const focusTaskId = focusTask?.id || "";
  const activeTasks = uiState.tasks.filter((task: Task) => task.status !== "completed");
  const visibleTasks = activeTasks.slice(0, 5);
  const overflowCount = Math.max(0, activeTasks.length - visibleTasks.length);
  return `
    <section class="today-right-section today-right-section--tasks">
      <div class="row spread">
        <h3>Active Micro-Tasks</h3>
        <span class="small">${focusTask ? `Current: ${escapeHtml(focusTask.title || "(untitled)")}` : "Current: -"}</span>
      </div>
      <ul class="today-task-list">
        ${visibleTasks.length === 0 ? '<li class="today-task-empty">未完了タスクはありません。</li>' : visibleTasks
          .map(
            (task: Task) => `
            <li class="today-task-item">
              <span class="today-task-bullet ${task.id === focusTaskId ? "is-active" : ""}" aria-hidden="true"></span>
              <span>${escapeHtml(task.title || "(untitled)")}</span>
            </li>
          `
          )
          .join("")}
      </ul>
      ${overflowCount > 0 ? `<p class="small">他 ${overflowCount} 件</p>` : ""}
    </section>
  `;
}

export function renderTodayTimelinePanel({
  uiState,
  blockTitle,
  formatHHmm,
  escapeHtml,
}: Pick<TodayRendererDeps, "uiState" | "blockTitle" | "formatHHmm" | "escapeHtml">): string {
  const timelineBlocks = [...uiState.blocks]
    .sort((left: Block, right: Block) => new Date(left.start_at).getTime() - new Date(right.start_at).getTime())
    .slice(0, 10);
  return `
    <section class="today-timeline-panel">
      <div class="row spread">
        <h3>Today's Timeline</h3>
        <span class="small">${uiState.blocks.length} items</span>
      </div>
      <ul class="today-timeline-list">
        ${
          timelineBlocks.length === 0
            ? '<li class="today-timeline-empty">予定はまだありません。</li>'
            : timelineBlocks
                .map((block: Block) => {
                  const title = blockTitle(block) || "Untitled Block";
                  const timeRange = `${formatHHmm(block.start_at)} - ${formatHHmm(block.end_at)}`;
                  return `
                    <li class="today-timeline-item">
                      <div class="today-timeline-time">${escapeHtml(timeRange)}</div>
                      <div class="today-timeline-content">
                        <p class="today-timeline-title">${escapeHtml(title)}</p>
                        <p class="today-timeline-meta">${escapeHtml(block.firmness || "draft")} / ${escapeHtml(
                          block.source || "generated"
                        )}</p>
                      </div>
                    </li>
                  `;
                })
                .join("")
        }
      </ul>
    </section>
  `;
}

export function renderTodayNotesPanel({ uiState, normalizePomodoroState, resolveCurrentFocusTask, escapeHtml }: Pick<TodayRendererDeps, "uiState" | "normalizePomodoroState" | "resolveCurrentFocusTask" | "escapeHtml">): string {
  const activeTask = resolveCurrentFocusTask(normalizePomodoroState(uiState.pomodoro || {})) || null;
  const defaultNote = activeTask ? `Now focusing: ${activeTask.title || "(untitled)"}` : "Type notes here...";
  return `
    <section class="today-right-section today-right-section--notes">
      <div class="row spread">
        <h3>Session Notes</h3>
        <span class="small">${activeTask ? "active task linked" : "free form"}</span>
      </div>
      <textarea class="today-notes-input" placeholder="${escapeHtml(defaultNote)}"></textarea>
    </section>
  `;
}

export function renderTodayAmbientPanel(): string {
  return `
    <section class="today-right-footer">
      <div class="today-ambient-cover" aria-hidden="true">A</div>
      <div class="today-ambient-meta">
        <p class="today-ambient-title">Deep Focus Ambient</p>
        <p class="today-ambient-source">Brain.fm</p>
      </div>
      <div class="today-ambient-controls" aria-hidden="true">| |</div>
    </section>
  `;
}
