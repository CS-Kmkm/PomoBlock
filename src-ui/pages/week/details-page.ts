import type { PageRenderDeps } from "../../types.js";

export type WeekDetailsPageMode = "details" | "today";

export function renderWeekDetailsPage(deps: PageRenderDeps, options: { mode?: WeekDetailsPageMode } = {}): void {
  const { uiState, appRoot, services, setStatus } = deps;
  const helpers = {
    ...deps.commonHelpers,
    ...deps.calendarHelpers,
  };
  const fallbackDate = helpers.isoDate(new Date());
  const isTodayRoute = options.mode === "today";
  const selectedDate = isTodayRoute ? fallbackDate : uiState.dashboardDate || fallbackDate;
  const pageTitle = isTodayRoute ? "Today" : "日別詳細";
  const pageDescription = isTodayRoute
    ? "今日の詳細表示と運用操作をまとめて行います。"
    : `中央の日付 ${helpers.escapeHtml(selectedDate)} の詳細表示と管理操作を行います。`;
  const backHref = isTodayRoute ? "#/now" : "#/week";
  const backLabel = isTodayRoute ? "実行中へ" : "週ビューへ戻る";
  const selectedBlocks = uiState.blocks.filter((block) => block.date === selectedDate);
  const blockTableRows = helpers.blockRows(selectedBlocks);
  const totalBlockMinutes = selectedBlocks.reduce((sum, block) => {
    const start = new Date(block.start_at).getTime();
    const end = new Date(block.end_at).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return sum;
    return sum + Math.round((end - start) / 60000);
  }, 0);
  const operationHint = isTodayRoute
    ? "まず同期、次に再生成、最後に再読込で状態を整えると安定します。"
    : "日付を切り替えて確認し、必要な日だけ同期・再生成してください。";
  const rerender = () => renderWeekDetailsPage(deps, options);

  appRoot.innerHTML = `
    <section class="view-head">
      <div>
        <h2>${pageTitle}</h2>
        <p>${pageDescription}</p>
      </div>
      <a href="${backHref}" class="week-manage-btn">${backLabel}</a>
    </section>
    <section class="panel week-ux-summary">
      <div class="week-ux-summary-main">
        <h3>${isTodayRoute ? "今日の運用サマリー" : "日別運用サマリー"}</h3>
        <p class="small">${operationHint}</p>
      </div>
      <div class="week-ux-summary-metrics">
        <span class="pill">ブロック ${selectedBlocks.length}件</span>
        <span class="pill">合計 ${totalBlockMinutes}分</span>
        <span class="pill">アカウント ${helpers.escapeHtml(helpers.normalizeAccountId(uiState.accountId))}</span>
      </div>
      <div class="week-ux-summary-actions">
        <a href="#/now" class="btn-secondary">実行画面を開く</a>
        <a href="#/routines" class="btn-secondary">ルーティンを編集</a>
      </div>
    </section>
    <section class="panel week-controls-panel">
      <div class="week-controls-grid">
        <label>日付 <input id="dashboard-date" type="date" value="${selectedDate}" ${isTodayRoute ? "disabled" : ""} /></label>
        <label>アカウント <input id="dashboard-account-id" value="${helpers.normalizeAccountId(uiState.accountId)}" /></label>
      </div>
      <div class="week-controls-actions">
        <button id="dashboard-sync" class="btn-primary">同期</button>
        <button id="dashboard-generate" class="btn-secondary">本日再生成</button>
        <button id="dashboard-refresh" class="btn-secondary">再読込</button>
      </div>
      <div class="week-controls-danger">
        <button id="dashboard-reset-blocks" class="btn-warn">ブロックリセット</button>
        <p class="small">注意: 対象日のブロックを削除します。</p>
      </div>
    </section>
    ${helpers.renderDailyCalendar(selectedDate, {
      panelClass: "week-advanced-calendar",
      includeDetail: true,
    })}
    <section class="panel week-block-table">
      <h3>中央日のブロック</h3>
      <table>
        <thead><tr><th>ID</th><th>開始</th><th>終了</th><th>Firmness</th></tr></thead>
        <tbody>${blockTableRows || '<tr><td colspan="4" class="week-blocks-empty">ブロックがありません。同期または本日再生成を実行してください。</td></tr>'}</tbody>
      </table>
    </section>
  `;

  const getSelectedDate = () => {
    const raw = (document.getElementById("dashboard-date") as HTMLInputElement | null)?.value;
    return raw && raw.trim() ? raw.trim() : uiState.dashboardDate || fallbackDate;
  };
  const getSelectedAccount = () =>
    helpers.normalizeAccountId(
      (document.getElementById("dashboard-account-id") as HTMLInputElement | null)?.value ||
        helpers.normalizeAccountId(uiState.accountId)
    );

  document.getElementById("dashboard-date")?.addEventListener("change", async () => {
    if (isTodayRoute) {
      return;
    }
    await services.runUiAction(async () => {
      const date = getSelectedDate();
      uiState.weekView.bufferAnchorDate = date;
      await deps.refreshCoreData(date);
      rerender();
    });
  });

  document.getElementById("dashboard-account-id")?.addEventListener("change", async () => {
    await services.runUiAction(async () => {
      uiState.accountId = getSelectedAccount();
      const date = getSelectedDate();
      uiState.weekView.bufferAnchorDate = date;
      await deps.refreshCoreData(date);
      rerender();
    });
  });

  document.getElementById("dashboard-sync")?.addEventListener("click", async () => {
    await services.runUiAction(async () => {
      uiState.accountId = getSelectedAccount();
      const date = getSelectedDate();
      uiState.weekView.bufferAnchorDate = date;
      await deps.authenticateAndSyncCalendar(date);
      await deps.refreshCoreData(date);
      rerender();
    });
  });

  document.getElementById("dashboard-generate")?.addEventListener("click", async () => {
    await services.runUiAction(async () => {
      uiState.accountId = getSelectedAccount();
      const date = getSelectedDate();
      try {
        await services.invokeCommandWithProgress("generate_today_blocks", helpers.withAccount({}));
      } catch (error) {
        if (!helpers.isUnknownCommandError(error)) {
          throw error;
        }
        await services.invokeCommandWithProgress("generate_blocks", helpers.withAccount({ date }));
      }
      await deps.refreshCoreData(date);
      rerender();
    });
  });

  document.getElementById("dashboard-reset-blocks")?.addEventListener("click", async () => {
    if (!window.confirm(`本当に ${selectedDate} のブロックをリセットしますか？`)) {
      return;
    }
    await services.runUiAction(async () => {
      uiState.accountId = getSelectedAccount();
      const date = getSelectedDate();
      const deletedCount = await helpers.resetBlocksForDate(date);
      await deps.refreshCoreData(date);
      setStatus(`ブロックを削除しました: ${deletedCount}件 (${date})`);
      rerender();
    });
  });

  document.getElementById("dashboard-refresh")?.addEventListener("click", async () => {
    await services.runUiAction(async () => {
      const date = getSelectedDate();
      uiState.weekView.bufferAnchorDate = date;
      await deps.refreshCoreData(date);
      rerender();
    });
  });

  helpers.bindDailyCalendarInteractions(() => rerender());
}
