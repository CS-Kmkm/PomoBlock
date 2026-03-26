import type { PageRenderDeps } from "../../types.js";

export function renderInsightsPage(deps: PageRenderDeps): void {
  const { appRoot, uiState, services } = deps;
  const helpers = {
    ...deps.commonHelpers,
    ...deps.calendarHelpers,
    ...deps.nowHelpers,
    ...deps.routineHelpers,
    ...deps.taskHelpers,
  };
  const end = helpers.isoDate(new Date());
  const start = helpers.isoDate(new Date(Date.now() - 6 * 24 * 3600 * 1000));
  const summary = uiState.reflection;
  const focusPercent = summary ? Math.min(100, Math.round((summary.total_focus_minutes / 240) * 100)) : 0;
  const totalLogs = Array.isArray(summary?.logs) ? summary.logs.length : 0;
  const completionRate = totalLogs > 0 ? Math.round(((summary?.completed_count ?? 0) / totalLogs) * 100) : 0;
  const recentLogs = summary?.logs ?? [];

  appRoot.innerHTML = `
    <section class="insights-page">
      <header class="insights-hero">
        <div>
          <p class="insights-kicker">Performance Review</p>
          <h2>Insights</h2>
          <p>日次・週次の実行傾向を確認して、次のルーチン改善に繋げます。</p>
        </div>
        <div class="insights-filterbar">
          <label class="insights-filter-field">開始 <input id="reflection-start" type="date" value="${start}" /></label>
          <label class="insights-filter-field">終了 <input id="reflection-end" type="date" value="${end}" /></label>
          <button id="reflection-load" class="btn-primary">集計</button>
        </div>
      </header>

      <section class="insights-metrics">
        <article class="insights-card insights-card--metric"><span>完了数</span><strong>${summary?.completed_count ?? 0}</strong></article>
        <article class="insights-card insights-card--metric"><span>中断数</span><strong>${summary?.interrupted_count ?? 0}</strong></article>
        <article class="insights-card insights-card--metric"><span>完了率</span><strong>${completionRate}%</strong></article>
        <article class="insights-card insights-card--metric"><span>集中分</span><strong>${summary?.total_focus_minutes ?? 0}m</strong></article>
      </section>

      <section class="insights-grid">
        <article class="insights-card insights-card--primary">
          <div class="insights-card-head">
            <div>
              <p class="insights-kicker">Weekly Goal</p>
              <h3>Focus Progress</h3>
            </div>
            <strong>${focusPercent}%</strong>
          </div>
          <p class="small">目標 240m に対する進捗</p>
          <div class="bar-track"><div class="bar-fill" style="width:${focusPercent}%"></div></div>
        </article>

        <article class="insights-card">
          <div class="insights-card-head">
            <div>
              <p class="insights-kicker">Logs</p>
              <h3>Recent Sessions</h3>
            </div>
            <span class="small">${totalLogs} entries</span>
          </div>
          <div class="insights-log-list">
            ${recentLogs
              .map(
                (log: unknown) => `
                <div class="insights-log-item">
                  <p><b>${(log as { phase?: string }).phase ?? ""}</b> / ${(log as { block_id?: string }).block_id ?? ""}</p>
                  <p class="small">${helpers.formatTime((log as { start_time?: string }).start_time ?? null)} - ${helpers.formatTime((log as { end_time?: string }).end_time ?? null)}</p>
                  <p class="small">理由: ${(log as { interruption_reason?: string | null }).interruption_reason ?? "-"}</p>
                </div>`
              )
              .join("")}
          </div>
        </article>
      </section>
    </section>
  `;

  document.getElementById("reflection-load")?.addEventListener("click", async () => {
    const startDate = (document.getElementById("reflection-start") as HTMLInputElement).value;
    const endDate = (document.getElementById("reflection-end") as HTMLInputElement).value;
    uiState.reflection = (await services.safeInvoke("get_reflection_summary", {
      start: `${startDate}T00:00:00Z`,
      end: `${endDate}T23:59:59Z`,
    })) as typeof uiState.reflection;
    renderInsightsPage(deps);
  });
}
