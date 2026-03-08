import type { Block, PomodoroState, Recipe, Task, UiState } from "../../types.js";

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

type WeekRendererDeps = {
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

export function renderWeekSequenceItems({ uiState, escapeHtml }: Pick<WeekRendererDeps, "uiState" | "escapeHtml">): string {
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
        <article class="week-sequence-item">
          <div class="week-sequence-icon" aria-hidden="true">${escapeHtml(name.slice(0, 1).toUpperCase())}</div>
          <div class="week-sequence-content">
            <p class="week-sequence-title">${escapeHtml(name)}</p>
            <p class="week-sequence-meta">${escapeHtml(autoDriveMode)} / ${stepCount} steps</p>
          </div>
        </article>
      `;
    })
    .join("");
}

export function renderWeekLibraryLinks(): string {
  return `
    <ul class="week-library-links">
      <li><a href="#/insights">History</a></li>
      <li><a href="#/routines">Templates</a></li>
    </ul>
  `;
}

export function renderWeekStatusCard(deps: WeekRendererDeps): string {
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
    <section class="week-right-section week-right-section--status">
      <h3>Current Status</h3>
      <div class="week-status-card">
        <span class="pill week-status-pill">${phaseLabel}</span>
        <p class="week-status-title">${escapeHtml(currentTitle)}</p>
        <p class="week-status-subtitle">Block: ${escapeHtml(state.current_block_id || "-")}</p>
        <p class="week-status-subtitle">Task: ${escapeHtml(focusTask?.title || "-")}</p>
        <div class="week-status-time" data-week-status-time>${toTimerText(displayRemainingSeconds)}</div>
        <div class="week-status-controls">
          <button class="week-status-action week-status-action--secondary" data-week-timer-action="${controls.leftAction}" aria-label="${controls.leftLabel}" title="${controls.leftLabel}" ${controls.leftDisabled ? "disabled" : ""}><span class="now-control-icon" aria-hidden="true">${controls.leftIcon}</span><span class="now-visually-hidden">${controls.leftLabel}</span></button>
          <button class="week-status-action week-status-action--primary" data-week-timer-action="${controls.primaryAction}" aria-label="${controls.primaryLabel}" title="${controls.primaryLabel}" ${controls.primaryDisabled ? "disabled" : ""}><span class="now-control-icon" aria-hidden="true">${controls.primaryIcon}</span><span class="now-visually-hidden">${controls.primaryLabel}</span></button>
          <button class="week-status-action week-status-action--secondary" data-week-timer-action="${controls.rightAction}" aria-label="${controls.rightLabel}" title="${controls.rightLabel}" ${controls.rightDisabled ? "disabled" : ""}><span class="now-control-icon" aria-hidden="true">${controls.rightIcon}</span><span class="now-visually-hidden">${controls.rightLabel}</span></button>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${progressPercent}%"></div></div>
      </div>
    </section>
  `;
}

export function renderWeekTaskPanel({ uiState, normalizePomodoroState, resolveCurrentFocusTask, escapeHtml }: Pick<WeekRendererDeps, "uiState" | "normalizePomodoroState" | "resolveCurrentFocusTask" | "escapeHtml">): string {
  const state = normalizePomodoroState(uiState.pomodoro || {});
  const focusTask = resolveCurrentFocusTask(state);
  const focusTaskId = focusTask?.id || "";
  const activeTasks = uiState.tasks.filter((task: Task) => task.status !== "completed");
  const visibleTasks = activeTasks.slice(0, 5);
  const overflowCount = Math.max(0, activeTasks.length - visibleTasks.length);
  return `
    <section class="week-right-section week-right-section--tasks">
      <div class="row spread">
        <h3>Active Micro-Tasks</h3>
        <span class="small">${focusTask ? `Current: ${escapeHtml(focusTask.title || "(untitled)")}` : "Current: -"}</span>
      </div>
      <ul class="week-task-list">
        ${visibleTasks.length === 0 ? '<li class="week-task-empty">未完了タスクはありません。</li>' : visibleTasks
          .map(
            (task: Task) => `
            <li class="week-task-item">
              <span class="week-task-bullet ${task.id === focusTaskId ? "is-active" : ""}" aria-hidden="true"></span>
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

export function renderWeekTimelinePanel({
  uiState,
  blockTitle,
  formatHHmm,
  escapeHtml,
}: Pick<WeekRendererDeps, "uiState" | "blockTitle" | "formatHHmm" | "escapeHtml">): string {
  const timelineBlocks = [...uiState.blocks]
    .sort((left: Block, right: Block) => new Date(left.start_at).getTime() - new Date(right.start_at).getTime())
    .slice(0, 10);
  return `
    <section class="week-timeline-panel">
      <div class="row spread">
        <h3>Week Timeline</h3>
        <span class="small">${uiState.blocks.length} items</span>
      </div>
      <ul class="week-timeline-list">
        ${
          timelineBlocks.length === 0
            ? '<li class="week-timeline-empty">予定はまだありません。</li>'
            : timelineBlocks
                .map((block: Block) => {
                  const title = blockTitle(block) || "Untitled Block";
                  const timeRange = `${formatHHmm(block.start_at)} - ${formatHHmm(block.end_at)}`;
                  return `
                    <li class="week-timeline-item">
                      <div class="week-timeline-time">${escapeHtml(timeRange)}</div>
                      <div class="week-timeline-content">
                        <p class="week-timeline-title">${escapeHtml(title)}</p>
                        <p class="week-timeline-meta">${escapeHtml(block.firmness || "draft")} / ${escapeHtml(
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

export function renderWeekNotesPanel({ uiState, normalizePomodoroState, resolveCurrentFocusTask, escapeHtml }: Pick<WeekRendererDeps, "uiState" | "normalizePomodoroState" | "resolveCurrentFocusTask" | "escapeHtml">): string {
  const activeTask = resolveCurrentFocusTask(normalizePomodoroState(uiState.pomodoro || {})) || null;
  const defaultNote = activeTask ? `Now focusing: ${activeTask.title || "(untitled)"}` : "Type notes here...";
  return `
    <section class="week-right-section week-right-section--notes">
      <div class="row spread">
        <h3>Session Notes</h3>
        <span class="small">${activeTask ? "active task linked" : "free form"}</span>
      </div>
      <textarea class="week-notes-input" placeholder="${escapeHtml(defaultNote)}"></textarea>
    </section>
  `;
}

export function renderWeekAmbientPanel(): string {
  return `
    <section class="week-right-footer">
      <div class="week-ambient-cover" aria-hidden="true">A</div>
      <div class="week-ambient-meta">
        <p class="week-ambient-title">Deep Focus Ambient</p>
        <p class="week-ambient-source">Brain.fm</p>
      </div>
      <div class="week-ambient-controls" aria-hidden="true">| |</div>
    </section>
  `;
}
