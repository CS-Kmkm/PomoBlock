import type { Block, PomodoroState, Task, UiState } from "../../types.js";
import type { TimerControlModel } from "../../timer-controls.js";

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
      <h3>現在の状態</h3>
      <div class="week-status-card">
        <span class="pill week-status-pill">${phaseLabel}</span>
        <p class="week-status-title">${escapeHtml(currentTitle)}</p>
        <p class="week-status-subtitle">ブロック: ${escapeHtml(state.current_block_id || "-")}</p>
        <p class="week-status-subtitle">タスク: ${escapeHtml(focusTask?.title || "-")}</p>
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
        <h3>進行中タスク</h3>
        <span class="small">${focusTask ? `現在: ${escapeHtml(focusTask.title || "(untitled)")}` : "現在: -"}</span>
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
        <h3>週のタイムライン</h3>
        <span class="small">${uiState.blocks.length} 件</span>
      </div>
      <ul class="week-timeline-list">
        ${
          timelineBlocks.length === 0
            ? '<li class="week-timeline-empty">予定はまだありません。</li>'
            : timelineBlocks
                .map((block: Block) => {
                  const title = blockTitle(block) || "無題ブロック";
                  const timeRange = `${formatHHmm(block.start_at)} - ${formatHHmm(block.end_at)}`;
                  return `
                    <li class="week-timeline-item">
                      <div class="week-timeline-time">${escapeHtml(timeRange)}</div>
                      <div class="week-timeline-content">
                        <p class="week-timeline-title">${escapeHtml(title)}</p>
                        <p class="week-timeline-meta">${escapeHtml(block.firmness || "draft")} / ${escapeHtml(
                          block.source || "自動生成"
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
