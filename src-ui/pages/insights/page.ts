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

  appRoot.innerHTML = `
    <section class="view-head">
      <div>
        <h2>Insights</h2>
        <p>日次・週次の実行傾向を確認して、次のルーチン改善に繋げます。</p>
      </div>
    </section>
    <div class="panel row">
      <label>開始 <input id="reflection-start" type="date" value="${start}" /></label>
      <label>終了 <input id="reflection-end" type="date" value="${end}" /></label>
      <button id="reflection-load" class="btn-primary">集計</button>
    </div>
    <div class="grid three" style="margin-top:14px">
      <div class="panel metric"><span class="small">完了数</span><b>${summary?.completed_count ?? 0}</b></div>
      <div class="panel metric"><span class="small">中断数</span><b>${summary?.interrupted_count ?? 0}</b></div>
      <div class="panel metric"><span class="small">完了率</span><b>${completionRate}%</b></div>
    </div>
    <div class="panel metric" style="margin-top:14px"><span class="small">集中分</span><b>${summary?.total_focus_minutes ?? 0}m</b></div>
    <div class="panel" style="margin-top:14px">
      <p class="small">目標 240m に対する進捗</p>
      <div class="bar-track"><div class="bar-fill" style="width:${focusPercent}%"></div></div>
    </div>
    <div class="panel" style="margin-top:14px">
      <h3>ログ</h3>
      <div class="log-list">
        ${(summary?.logs ?? [])
          .map(
            (log: unknown) => `
            <div class="panel">
              <p><b>${(log as { phase?: string }).phase ?? ""}</b> / ${(log as { block_id?: string }).block_id ?? ""}</p>
              <p class="small">${helpers.formatTime((log as { start_time?: string }).start_time ?? null)} - ${helpers.formatTime((log as { end_time?: string }).end_time ?? null)}</p>
              <p class="small">reason: ${(log as { interruption_reason?: string | null }).interruption_reason ?? "-"}</p>
            </div>`
          )
          .join("")}
      </div>
    </div>
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
