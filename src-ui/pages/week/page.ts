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
          <p class="week-main-eyebrow">Weekly planner</p>
          <h2>週次プランナー</h2>
          <p class="week-main-lead">
            前後3日を含む7日を表示します。横スクロールは日単位で吸着し、端へ近づくと次のバッファを読み込みます。
          </p>
        </div>
        <div class="week-main-head-actions">
          ${showJumpToToday ? '<button type="button" class="week-manage-btn" data-week-jump-today>今日へ戻る</button>' : ""}
        </div>
      </header>
      <div class="week-main-metrics" aria-label="週次サマリー">
        <article class="week-main-metric">
          <span class="week-main-metric-label">選択日</span>
          <strong>${escapeHtml(model.selectedDateLabel)}</strong>
          <span>${escapeHtml(model.selectedDate)}</span>
        </article>
        <article class="week-main-metric">
          <span class="week-main-metric-label">表示範囲</span>
          <strong>7日間</strong>
          <span>${escapeHtml(model.visibleRangeLabel)}</span>
        </article>
        <article class="week-main-metric">
          <span class="week-main-metric-label">バッファ</span>
          <strong>${escapeHtml(model.bufferDateKeys.length)}日</strong>
          <span>端へ寄ると次の7日を先読み</span>
        </article>
      </div>
      <p class="week-week-hint small">
        現在の基準日は ${escapeHtml(todayDateKey)}。詳細を開くと日別の編集面に移動します。
      </p>
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
