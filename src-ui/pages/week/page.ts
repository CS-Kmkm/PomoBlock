import { attachWeekScrollStrip } from "./scroll-strip.js";
import { buildWeekPageModel } from "./model.js";
import { bindPaneResizers } from "../../pane-resizer.js";
import type { PageRenderDeps } from "../../types.js";

function renderWeekSidebar(deps: PageRenderDeps): string {
  const helpers = {
    ...deps.routineHelpers,
    ...deps.taskHelpers,
  };

  return `
    <aside class="week-right-rail">
      <div data-week-status-panel>${helpers.renderWeekStatusCard()}</div>
      <div data-week-task-panel>${helpers.renderWeekTaskPanel()}</div>
    </aside>
  `;
}

function renderWeekHero(model: ReturnType<typeof buildWeekPageModel>, todayDateKey: string, showJumpToToday: boolean, escapeHtml: (value: unknown) => string): string {
  return `
    <section class="week-main-hero">
      <header class="week-main-head">
        <div class="week-main-head-copy">
          <h2>Weekly Flow</h2>
          <p class="week-main-date">${escapeHtml(model.visibleRangeLabel)}</p>
        </div>
        <div class="week-main-head-actions">
          <button type="button" class="week-nav-btn" aria-label="previous week">&#8249;</button>
          <button type="button" class="week-today-btn ${showJumpToToday ? "" : "is-current"}" data-week-jump-today>Today</button>
          <button type="button" class="week-nav-btn" aria-label="next week">&#8250;</button>
        </div>
      </header>
      <p class="week-week-hint small">Selected: ${escapeHtml(model.selectedDateLabel)} / Today: ${escapeHtml(todayDateKey)}</p>
    </section>
  `;
}

function bindWeekTimerActions(deps: PageRenderDeps): void {
  const helpers = {
    ...deps.nowHelpers,
  };

  deps.appRoot.querySelectorAll("[data-week-timer-action]").forEach((node) => {
    node.addEventListener("click", async (event: Event) => {
      const action = (event.currentTarget as HTMLElement | null)?.dataset.weekTimerAction;
      await helpers.executeTimerAction(action || "", () => renderWeekPage(deps));
    });
  });
}

export function renderWeekPage(deps: PageRenderDeps): void {
  const { uiState, appRoot, services } = deps;
  const helpers = {
    ...deps.commonHelpers,
    ...deps.calendarHelpers,
  };
  const model = buildWeekPageModel(deps);
  const todayDateKey = helpers.isoDate(new Date());
  const showJumpToToday = model.selectedDate !== todayDateKey;

  appRoot.innerHTML = `
    <section class="week-layout">
      <section class="week-main-pane">
        ${renderWeekHero(model, todayDateKey, showJumpToToday, helpers.escapeHtml)}
        <section class="panel week-planner-shell" data-week-planner tabindex="0">
          ${helpers.renderWeeklyPlannerCalendar(model.plannerModel)}
        </section>
      </section>

      <div class="pane-splitter" data-pane-resize="week-right" role="separator" aria-orientation="vertical" aria-label="Resize right panel" tabindex="0"></div>
      ${renderWeekSidebar(deps)}
    </section>
  `;

  bindPaneResizers(appRoot, [
    {
      layoutSelector: ".week-layout",
      handleSelector: "[data-pane-resize='week-right']",
      paneSelector: ".week-right-rail",
      cssVar: "--week-right-width",
      storageKey: "pane-width:week:right",
      edge: "right",
      minWidth: 260,
      maxWidth: 520,
      mainMinWidth: 480,
    },
  ]);

  appRoot.querySelector("[data-week-jump-today]")?.addEventListener("click", async () => {
    await services.runUiAction(async () => {
      uiState.weekView.bufferAnchorDate = todayDateKey;
      await deps.refreshCoreData(todayDateKey);
      renderWeekPage(deps);
    });
  });

  appRoot.querySelectorAll("[data-week-open-details]").forEach((node) => {
    node.addEventListener("click", (event: Event) => {
      const dateKey = (event.currentTarget as HTMLElement | null)?.dataset.weekOpenDetails;
      if (!dateKey) {
        return;
      }
      uiState.dashboardDate = dateKey;
      uiState.weekView.bufferAnchorDate = dateKey;
      window.location.hash = "#/week/details";
    });
  });

  bindWeekTimerActions(deps);

  attachWeekScrollStrip({
    appRoot,
    uiState,
    selectedDate: model.selectedDate,
    bufferDateKeys: model.bufferDateKeys,
    visibleStartIndex: model.visibleStartIndex,
    onSelectDate: (dateKey) => {
      if (!dateKey || uiState.dashboardDate === dateKey) {
        return;
      }
      uiState.dashboardDate = dateKey;
      renderWeekPage(deps);
    },
    onBufferEdge: (dateKey) => {
      if (!dateKey || uiState.weekView.isPrefetching || uiState.weekView.bufferAnchorDate === dateKey) {
        return;
      }
      void services.runUiAction(async () => {
        uiState.weekView.isPrefetching = true;
        try {
          uiState.weekView.bufferAnchorDate = dateKey;
          await deps.refreshCoreData(dateKey);
          renderWeekPage(deps);
        } finally {
          uiState.weekView.isPrefetching = false;
        }
      });
    },
  });

  helpers.bindDailyCalendarInteractions(() => renderWeekPage(deps));
}
