import { bindPaneResizers } from "../../pane-resizer.js";
import type { PageRenderDeps } from "../../types.js";

export function renderNowPage(deps: PageRenderDeps): void {
  const { uiState, appRoot, services } = deps;
  const helpers = {
    ...deps.commonHelpers,
    ...deps.calendarHelpers,
    ...deps.nowHelpers,
  };
  const state = helpers.normalizePomodoroState(uiState.pomodoro || {});
  if (uiState.nowUi.lastSyncEpochMs === 0) {
    helpers.syncNowTimerDisplay(state);
  }

  const nowMs = Date.now();
  const todayDate = helpers.isoDate(new Date());
  const todayBlocks = helpers.resolveNowBlocks();
  const todayPlannerModel = helpers.buildPlannerStripModel([todayDate], todayDate, uiState.blocks, uiState.calendarEvents) as {
    days?: Array<{ blockItems?: unknown[]; eventItems?: unknown[] }>;
  };
  const todayScheduleCount =
    (Array.isArray(todayPlannerModel.days?.[0]?.blockItems) ? todayPlannerModel.days[0].blockItems.length : 0) +
    (Array.isArray(todayPlannerModel.days?.[0]?.eventItems) ? todayPlannerModel.days[0].eventItems.length : 0);
  const orderedTasks = helpers.getNowOrderedTasks(true);
  const openTasks = orderedTasks.filter((task) => task.status !== "completed");
  const currentBlockId = typeof state.current_block_id === "string" ? state.current_block_id : null;
  const activeScheduleBlock =
    currentBlockId !== null
      ? todayBlocks.find(({ block }) => block.id === currentBlockId)?.block || null
      : todayBlocks.find(({ startMs, endMs }) => startMs <= nowMs && nowMs < endMs)?.block || null;
  const runningBlock = currentBlockId
    ? todayBlocks.find(({ block }) => block.id === currentBlockId)?.block || null
    : null;
  const runningTask = helpers.resolveCurrentFocusTask(state);
  const autoStartBlock = helpers.resolveNowAutoStartBlock(state);
  const autoStartTask = helpers.resolveNowAutoStartTask(state);
  const displayRemainingSeconds = Math.max(0, Math.floor(uiState.nowUi.displayRemainingSeconds || 0));
  const phaseTotalSeconds = Math.max(1, Math.floor(uiState.nowUi.phaseTotalSeconds || displayRemainingSeconds || 1));
  const phase = typeof state.phase === "string" ? state.phase : "idle";
  const phaseProgress =
    phase === "idle" ? 0 : Math.max(0, Math.min(100, Math.round((displayRemainingSeconds / phaseTotalSeconds) * 100)));
  const phaseLabel = helpers.pomodoroPhaseLabel(phase);
  const deferredCount = uiState.tasks.filter((task) => task.status === "deferred").length;
  const bufferMinutes = helpers.nowBufferAvailableMinutes();
  const reflectionLogs = Array.isArray(uiState.reflection?.logs) ? uiState.reflection.logs : null;
  const focusCompletion =
    reflectionLogs && reflectionLogs.length > 0
      ? Math.round(((uiState.reflection?.completed_count ?? 0) / reflectionLogs.length) * 100)
      : null;
  const objectiveTitle =
    (runningTask?.title as string | undefined) ||
    (runningBlock
      ? helpers.blockTitle(runningBlock as { id?: string } | null | undefined) || String(runningBlock.id || "")
      : (autoStartTask?.title as string | undefined) ||
        (autoStartBlock
          ? helpers.blockTitle(autoStartBlock as { id?: string } | null | undefined) || String(autoStartBlock.id || "")
          : "準備完了"));
  const objectiveBlockId = String(runningBlock?.id || autoStartBlock?.id || "-");
  const totalCycles = Number(state.total_cycles || 0);
  const currentCycle = Number(state.current_cycle || 1);
  const currentStep = totalCycles > 0 ? Math.max(1, Math.min(currentCycle || 1, totalCycles)) : 1;
  const totalSteps =
    totalCycles > 0 ? totalCycles : Math.max(1, Number((autoStartBlock?.planned_pomodoros as number | undefined) || 1));
  const controls = helpers.resolveTimerControlModel(state);
  const notesPanel = helpers.renderNowNotesPanel();
  const sessionStatusCards = [
    { label: "TODAY'S FOCUS", value: `${bufferMinutes}m` },
    { label: "SESSIONS", value: focusCompletion === null ? `${openTasks.length}` : `${Math.round((focusCompletion / 100) * 12)} / 12` },
  ];
  const activeScheduleTitle = activeScheduleBlock
    ? helpers.blockTitle(activeScheduleBlock as { id?: string } | null | undefined) || String(activeScheduleBlock.id || "")
    : "進行中の予定はありません";
  const nextTask = openTasks.find((task) => String(task.id || "") !== String(runningTask?.id || ""));
  const nextTaskTitle = nextTask ? String(nextTask.title || "(untitled)") : "No next task";
  const mobileSchedule = helpers.renderDailyCalendar(todayDate, {
    panelClass: "now-mobile-schedule",
    forceMode: "simple",
    syncSelection: false,
    preferredSelection: activeScheduleBlock ? { kind: "block", id: String(activeScheduleBlock.id || "") } : null,
    showHeader: false,
    showMetrics: false,
    showViewToggle: false,
    includeDetail: false,
    includeTimeline: true,
    compactSummary: true,
  });

  appRoot.innerHTML = `
    <section class="now-mobile-schedule-shell">
      <header class="now-mobile-head">
        <div>
          <h3>今日のスケジュール</h3>
          <p class="small">${helpers.escapeHtml(todayDate)}</p>
        </div>
        <p class="small">${todayScheduleCount} 件</p>
      </header>
      ${mobileSchedule}
    </section>

    <section class="now-layout">
      <aside class="now-left-rail">
        <header class="now-rail-head">
          <div class="now-rail-title-group">
            <p class="now-rail-kicker">Schedule</p>
            <h3>今日のスケジュール</h3>
            <p class="small">${helpers.escapeHtml(todayDate)}</p>
          </div>
          <span class="pill now-rail-pill">${todayScheduleCount} 件</span>
        </header>
        <div class="now-schedule-wrap">
          ${helpers.renderSingleDayPlannerCalendar(todayPlannerModel)}
        </div>
      </aside>
      <div class="pane-splitter" data-pane-resize="now-left" role="separator" aria-orientation="vertical" aria-label="Resize left panel" tabindex="0"></div>

      <section class="now-main-pane">
        <p class="now-mode-label">${helpers.escapeHtml(phaseLabel)} MODE</p>
        <div class="now-ring-shell">
          <div class="now-ring" style="--now-progress:${phaseProgress}%;">
            <div class="now-ring-core">
              <p class="now-ring-time">${helpers.toTimerText(displayRemainingSeconds)}</p>
              <p class="now-ring-caption">${phase === "focus" ? "FOCUSING" : helpers.escapeHtml(phaseLabel)}</p>
            </div>
          </div>
        </div>
        <div class="now-active-task-block">
          <p class="now-active-task-kicker">ACTIVE TASK</p>
          <p class="now-active-task-id">${helpers.escapeHtml(objectiveBlockId)}</p>
          <p class="now-active-task-title">${helpers.escapeHtml(objectiveTitle)}</p>
        </div>
        <div class="now-controls">
          <button id="now-left-action" class="now-control now-control--secondary" data-now-action="${String(controls.leftAction || "")}" aria-label="${String(controls.leftLabel || "")}" title="${String(controls.leftLabel || "")}" ${controls.leftDisabled ? "disabled" : ""}><span class="now-control-icon" aria-hidden="true">${String(controls.leftIcon || "")}</span><span class="now-visually-hidden">${String(controls.leftLabel || "")}</span></button>
          <button id="now-primary-action" class="now-control now-control--primary" data-now-action="${String(controls.primaryAction || "")}" aria-label="${String(controls.primaryLabel || "")}" title="${String(controls.primaryLabel || "")}" ${controls.primaryDisabled ? "disabled" : ""}><span class="now-control-icon" aria-hidden="true">${String(controls.primaryIcon || "")}</span><span class="now-visually-hidden">${String(controls.primaryLabel || "")}</span></button>
          <button id="now-right-action" class="now-control now-control--secondary" data-now-action="${String(controls.rightAction || "")}" aria-label="${String(controls.rightLabel || "")}" title="${String(controls.rightLabel || "")}" ${controls.rightDisabled ? "disabled" : ""}><span class="now-control-icon" aria-hidden="true">${String(controls.rightIcon || "")}</span><span class="now-visually-hidden">${String(controls.rightLabel || "")}</span></button>
        </div>
        <div class="now-session-pill"><span class="now-session-dot"></span>Focus active: ${helpers.escapeHtml(objectiveBlockId)} <span class="now-session-divider"></span> End Session</div>
      </section>
      <div class="pane-splitter" data-pane-resize="now-right" role="separator" aria-orientation="vertical" aria-label="Resize right panel" tabindex="0"></div>

      <aside class="now-right-rail">
        <section class="now-side-section">
          <div class="row spread">
            <h3>Current Task</h3>
            <span class="small">...</span>
          </div>
          <article class="now-side-card now-side-card--current">
            <p class="now-side-card-kicker">In Progress</p>
            <p class="now-side-card-title">${helpers.escapeHtml(objectiveBlockId)}</p>
            <p class="small">Started 15m ago</p>
          </article>
        </section>
        <section class="now-side-section">
          <div class="row spread">
            <h3>Next Task</h3>
            <span class="small">View All</span>
          </div>
          <article class="now-side-card now-side-card--next">
            <p class="small">Coming up in 45m</p>
            <p class="now-side-card-title">${helpers.escapeHtml(nextTaskTitle)}</p>
            <p class="small">${helpers.escapeHtml(nextTask ? String(nextTask.status || "planned") : "queue empty")}</p>
          </article>
        </section>
        <div class="now-desktop-notes">${notesPanel}</div>
        <div class="now-status-grid now-status-grid--footer">
          ${sessionStatusCards
            .map(
              (item) => `
                <div class="now-status-item">
                  <span class="now-status-label">${helpers.escapeHtml(item.label)}</span>
                  <strong class="now-status-value">${helpers.escapeHtml(item.value)}</strong>
                </div>
              `,
            )
            .join("")}
        </div>
      </aside>
    </section>
    <section class="now-mobile-notes-shell">
      ${notesPanel}
    </section>
  `;

  bindPaneResizers(appRoot, [
    {
      layoutSelector: ".now-layout",
      handleSelector: "[data-pane-resize='now-left']",
      paneSelector: ".now-left-rail",
      cssVar: "--now-left-width",
      storageKey: "pane-width:now:left",
      edge: "left",
      minWidth: 180,
      maxWidth: 420,
      mainMinWidth: 360,
      oppositePaneSelector: ".now-right-rail",
      splitterCount: 2,
    },
    {
      layoutSelector: ".now-layout",
      handleSelector: "[data-pane-resize='now-right']",
      paneSelector: ".now-right-rail",
      cssVar: "--now-right-width",
      storageKey: "pane-width:now:right",
      edge: "right",
      minWidth: 220,
      maxWidth: 460,
      mainMinWidth: 360,
      oppositePaneSelector: ".now-left-rail",
      splitterCount: 2,
    },
  ]);

  ["now-left-action", "now-primary-action", "now-right-action"].forEach((id) => {
    document.getElementById(id)?.addEventListener("click", async (event: Event) => {
      const action = (event.currentTarget as HTMLElement | null)?.dataset.nowAction;
      await helpers.executeTimerAction(action || "", () => renderNowPage(deps));
    });
  });

  appRoot.querySelectorAll("[data-now-task-complete]").forEach((node) => {
    node.addEventListener("click", async () => {
      const taskId = (node as HTMLElement).dataset.nowTaskComplete;
      if (!taskId) return;
      await services.runUiAction(async () => {
        await services.safeInvoke("update_task", { task_id: taskId, status: "completed" });
        uiState.tasks = (await services.safeInvoke("list_tasks")) as typeof uiState.tasks;
        helpers.syncNowTaskOrder(uiState.tasks);
        renderNowPage(deps);
      });
    });
  });

  appRoot.querySelectorAll("[data-now-task-move]").forEach((node) => {
    node.addEventListener("click", () => {
      const element = node as HTMLElement;
      const taskId = element.dataset.nowTaskMove;
      const direction = element.dataset.nowTaskDir;
      if (!taskId || (direction !== "up" && direction !== "down")) return;
      const visibleIds = helpers.getNowOrderedTasks().map((task) => String(task.id || ""));
      const visibleIndex = visibleIds.indexOf(taskId);
      if (visibleIndex < 0) return;
      const swapVisibleIndex = direction === "up" ? visibleIndex - 1 : visibleIndex + 1;
      if (swapVisibleIndex < 0 || swapVisibleIndex >= visibleIds.length) return;
      const swapId = visibleIds[swapVisibleIndex];
      const nextOrder = [...uiState.nowUi.taskOrder];
      const sourceIndex = nextOrder.indexOf(taskId);
      if (!swapId) return;
      const targetIndex = nextOrder.indexOf(swapId);
      if (sourceIndex < 0 || targetIndex < 0) return;
      const sourceValue = nextOrder[sourceIndex];
      const targetValue = nextOrder[targetIndex];
      if (!sourceValue || !targetValue) return;
      [nextOrder[sourceIndex], nextOrder[targetIndex]] = [targetValue, sourceValue];
      uiState.nowUi.taskOrder = nextOrder;
      renderNowPage(deps);
    });
  });

  helpers.bindDailyCalendarInteractions(() => renderNowPage(deps));
}
