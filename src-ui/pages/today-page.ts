import type { PageRenderDeps } from "../types.js";

export function renderTodayPage(deps: PageRenderDeps): void {
  const { uiState, appRoot } = deps;
  const helpers = {
    ...deps.commonHelpers,
    ...deps.calendarHelpers,
    ...deps.nowHelpers,
    ...deps.routineHelpers,
    ...deps.taskHelpers,
  };
  const fallbackDate = helpers.isoDate(new Date());
  const selectedDate = uiState.dashboardDate || fallbackDate;
  const weeklyModel = helpers.buildWeeklyPlannerModel(selectedDate, uiState.blocks, uiState.calendarEvents);

  appRoot.innerHTML = `
    <section class="today-layout">
      <aside class="today-left-rail">
        <section class="today-left-section today-left-section--sequences">
          <div class="today-rail-head">
            <h3>Micro Sequences</h3>
            <p class="small">Drag to calendar to schedule</p>
          </div>
          <div class="today-sequence-list">${helpers.renderTodaySequenceItems()}</div>
        </section>
        <section class="today-left-section today-left-section--library">
          <h3>Library</h3>
          ${helpers.renderTodayLibraryLinks()}
        </section>
        <div class="today-left-spacer" aria-hidden="true"></div>
        <div class="today-left-footer">
          <a class="today-create-sequence" href="#/routines">+ Create Sequence</a>
        </div>
      </aside>

      <section class="today-main-pane">
        <header class="today-main-head">
          <div>
            <h2>Weekly Planner</h2>
            <p>${helpers.escapeHtml((weeklyModel as { weekLabel?: string }).weekLabel || "")}</p>
          </div>
          <div class="today-main-head-actions">
            <span class="pill">${helpers.escapeHtml(selectedDate)}</span>
            <a href="#/details" class="today-manage-btn">Details</a>
          </div>
        </header>
        <section class="panel today-planner-shell">${helpers.renderWeeklyPlannerCalendar(weeklyModel)}</section>
      </section>

      <aside class="today-right-rail">
        ${helpers.renderTodayStatusCard()}
        ${helpers.renderTodayTaskPanel()}
        ${helpers.renderTodayNotesPanel()}
        ${helpers.renderTodayAmbientPanel()}
      </aside>
    </section>
  `;

  appRoot.querySelectorAll("[data-today-timer-action]").forEach((node) => {
    node.addEventListener("click", async (event: Event) => {
      const action = (event.currentTarget as HTMLElement | null)?.dataset.todayTimerAction;
      await helpers.executeTimerAction(action || "", () => renderTodayPage(deps));
    });
  });

  helpers.bindDailyCalendarInteractions(() => renderTodayPage(deps));
}
