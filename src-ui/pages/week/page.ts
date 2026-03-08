import { attachWeekScrollStrip } from "./scroll-strip.js";
import { buildWeekPageModel } from "./model.js";
import type { PageRenderDeps } from "../../types.js";

function renderWeekSidebar(deps: PageRenderDeps): string {
  const helpers = {
    ...deps.routineHelpers,
    ...deps.taskHelpers,
  };

  return `
    <aside class="week-right-rail">
      <div data-week-status-panel>${helpers.renderWeekStatusCard()}</div>
      <section class="week-right-section week-right-section--sequences" data-week-sequence-panel>
        <div class="week-rail-head">
          <h3>Micro Sequences</h3>
          <p class="small">Drag to calendar to schedule</p>
        </div>
        <div class="week-sequence-list week-sequence-list--rail">${helpers.renderWeekSequenceItems()}</div>
        <a class="week-create-sequence" href="#/routines">+ Create Sequence</a>
      </section>
      <div data-week-task-panel>${helpers.renderWeekTaskPanel()}</div>
      <section class="week-right-section week-right-section--library" data-week-library-panel>
        <h3>Library</h3>
        ${helpers.renderWeekLibraryLinks()}
      </section>
      <div data-week-notes-panel>${helpers.renderWeekNotesPanel()}</div>
      <div data-week-ambient-panel>${helpers.renderWeekAmbientPanel()}</div>
    </aside>
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
        <header class="week-main-head">
          <div>
            <h2>Week Planner</h2>
            <p>${helpers.escapeHtml(model.plannerModel.weekLabel || "")}</p>
          </div>
          <div class="week-main-head-actions">
            ${showJumpToToday ? '<button type="button" class="week-manage-btn" data-week-jump-today>今日へ戻る</button>' : ""}
          </div>
        </header>
        <p class="week-week-hint small">
          前後3日を含む7日を表示します。横スクロールは日単位で吸着し、端へ近づくと次のバッファを読み込みます。
        </p>
        <section class="panel week-planner-shell" data-week-planner tabindex="0">
          ${helpers.renderWeeklyPlannerCalendar(model.plannerModel)}
        </section>
      </section>

      ${renderWeekSidebar(deps)}
    </section>
  `;

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
