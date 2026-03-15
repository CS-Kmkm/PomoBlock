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
    days?: Array<{ combinedItems?: unknown[] }>;
  };
  const todayScheduleCount = Array.isArray(todayPlannerModel.days?.[0]?.combinedItems) ? todayPlannerModel.days[0].combinedItems.length : 0;
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
          : "Ready"));
  const objectiveBlockId = String(runningBlock?.id || autoStartBlock?.id || "-");
  const totalCycles = Number(state.total_cycles || 0);
  const currentCycle = Number(state.current_cycle || 1);
  const currentStep = totalCycles > 0 ? Math.max(1, Math.min(currentCycle || 1, totalCycles)) : 1;
  const totalSteps =
    totalCycles > 0 ? totalCycles : Math.max(1, Number((autoStartBlock?.planned_pomodoros as number | undefined) || 1));
  const controls = helpers.resolveTimerControlModel(state) as Record<string, unknown>;
  const notesPanel = helpers.renderNowNotesPanel();
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
  });

  appRoot.innerHTML = `
    <section class="now-mobile-schedule-shell">
      <header class="now-mobile-head">
        <div>
          <h3>Today's Schedule</h3>
          <p class="small">${helpers.escapeHtml(todayDate)}</p>
        </div>
        <p class="small">${todayScheduleCount} items</p>
      </header>
      ${mobileSchedule}
    </section>

    <section class="now-layout">
      <aside class="now-left-rail">
        <header class="now-left-head">
          <div>
            <h3>Today's Schedule</h3>
            <p class="small">${helpers.escapeHtml(todayDate)}</p>
          </div>
          <p class="small">${todayScheduleCount} items</p>
        </header>
        <div class="now-schedule-wrap">
          ${helpers.renderSingleDayPlannerCalendar(todayPlannerModel)}
        </div>
      </aside>

      <section class="now-main-pane">
        <p class="now-mode-label">${helpers.escapeHtml(phaseLabel)} MODE</p>
        <div class="now-ring" style="--now-progress:${phaseProgress}%;">
          <div class="now-ring-core">
            <p class="now-ring-time">${helpers.toTimerText(displayRemainingSeconds)}</p>
            <p class="now-ring-caption">${helpers.escapeHtml(objectiveTitle)}</p>
          </div>
        </div>
        <div class="now-controls">
          <button id="now-left-action" class="now-control now-control--secondary" data-now-action="${String(controls.leftAction || "")}" aria-label="${String(controls.leftLabel || "")}" title="${String(controls.leftLabel || "")}" ${controls.leftDisabled ? "disabled" : ""}><span class="now-control-icon" aria-hidden="true">${String(controls.leftIcon || "")}</span><span class="now-visually-hidden">${String(controls.leftLabel || "")}</span></button>
          <button id="now-primary-action" class="now-control now-control--primary" data-now-action="${String(controls.primaryAction || "")}" aria-label="${String(controls.primaryLabel || "")}" title="${String(controls.primaryLabel || "")}" ${controls.primaryDisabled ? "disabled" : ""}><span class="now-control-icon" aria-hidden="true">${String(controls.primaryIcon || "")}</span><span class="now-visually-hidden">${String(controls.primaryLabel || "")}</span></button>
          <button id="now-right-action" class="now-control now-control--secondary" data-now-action="${String(controls.rightAction || "")}" aria-label="${String(controls.rightLabel || "")}" title="${String(controls.rightLabel || "")}" ${controls.rightDisabled ? "disabled" : ""}><span class="now-control-icon" aria-hidden="true">${String(controls.rightIcon || "")}</span><span class="now-visually-hidden">${String(controls.rightLabel || "")}</span></button>
        </div>
        <section class="now-objective-card">
          <div class="row spread">
            <h3>Current Objective</h3>
            <span class="pill">Step ${currentStep} of ${totalSteps}</span>
          </div>
          <p>${helpers.escapeHtml(objectiveTitle)}</p>
          <p class="small">Block: ${helpers.escapeHtml(objectiveBlockId)}</p>
        </section>
      </section>

      <aside class="now-right-rail">
        <header class="row spread">
          <h3>Next Steps</h3>
          <span class="small">${openTasks.length} open</span>
        </header>
        <div class="now-task-list">
          ${
            openTasks.length === 0
              ? '<p class="small now-empty">No open tasks.</p>'
              : openTasks
                  .map((task, index) => {
                    const upDisabled = index === 0;
                    const downDisabled = index === openTasks.length - 1;
                    return `
                      <article class="now-task-item ${task.status === "in_progress" ? "is-active" : ""}">
                        <div>
                          <p class="now-task-title">${helpers.escapeHtml(String(task.title || "(untitled)"))}</p>
                          <p class="small">${helpers.escapeHtml(String(task.status || ""))}${Number.isFinite(task.estimated_pomodoros as number) ? ` / est ${task.estimated_pomodoros}` : ""}</p>
                        </div>
                        <div class="now-task-actions">
                          <button class="btn-secondary now-order-btn" data-now-task-move="${helpers.escapeHtml(String(task.id || ""))}" data-now-task-dir="up" ${upDisabled ? "disabled" : ""}>↑</button>
                          <button class="btn-secondary now-order-btn" data-now-task-move="${helpers.escapeHtml(String(task.id || ""))}" data-now-task-dir="down" ${downDisabled ? "disabled" : ""}>↓</button>
                          <button class="btn-primary now-complete-btn" data-now-task-complete="${helpers.escapeHtml(String(task.id || ""))}">Done</button>
                        </div>
                      </article>
                    `;
                  })
                  .join("")
          }
        </div>
        <div class="now-desktop-notes">${notesPanel}</div>
      </aside>
    </section>
    <section class="now-mobile-notes-shell">
      ${notesPanel}
    </section>
    <section class="now-bottom-bar">
      <div class="now-bottom-item"><span>Buffer Available</span><strong>${bufferMinutes}m</strong></div>
      <div class="now-bottom-item"><span>Deferred Tasks</span><strong>${deferredCount}</strong></div>
      ${focusCompletion === null ? "" : `<div class="now-bottom-item"><span>Focus Completion</span><strong>${focusCompletion}%</strong></div>`}
    </section>
  `;

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
