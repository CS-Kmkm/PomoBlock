import type { PageRenderDeps } from "../types.js";

export function renderDetailsPage(deps: PageRenderDeps): void {
  const { uiState, appRoot, services, setStatus, helpers } = deps;
  const fallbackDate = helpers.isoDate(new Date());
  const selectedDate = uiState.dashboardDate || fallbackDate;

  appRoot.innerHTML = `
    <section class="view-head">
      <div>
        <h2>Details</h2>
        <p>Today の詳細表示と管理操作をこのページで行います。</p>
      </div>
      <a href="#/today" class="today-manage-btn">Back to Today</a>
    </section>
    <section class="panel today-controls-panel">
      <div class="today-controls-grid">
        <label>日付 <input id="dashboard-date" type="date" value="${selectedDate}" /></label>
        <label>Account <input id="dashboard-account-id" value="${helpers.normalizeAccountId(uiState.accountId)}" /></label>
      </div>
      <div class="today-controls-actions">
        <button id="dashboard-sync" class="btn-primary">同期</button>
        <button id="dashboard-generate" class="btn-secondary">本日再生成</button>
        <button id="dashboard-reset-blocks" class="btn-warn">ブロックリセット</button>
        <button id="dashboard-refresh" class="btn-secondary">再読込</button>
      </div>
    </section>
    ${helpers.renderDailyCalendar(selectedDate, {
      panelClass: "today-advanced-calendar",
      includeDetail: true,
    })}
    <section class="panel today-block-table">
      <h3>今日のブロック</h3>
      <table>
        <thead><tr><th>ID</th><th>開始</th><th>終了</th><th>Firmness</th></tr></thead>
        <tbody>${helpers.blockRows(uiState.blocks)}</tbody>
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
    await services.runUiAction(async () => {
      const date = getSelectedDate();
      await deps.refreshCoreData(date);
      renderDetailsPage(deps);
    });
  });

  document.getElementById("dashboard-account-id")?.addEventListener("change", async () => {
    await services.runUiAction(async () => {
      uiState.accountId = getSelectedAccount();
      const date = getSelectedDate();
      await deps.refreshCoreData(date);
      renderDetailsPage(deps);
    });
  });

  document.getElementById("dashboard-sync")?.addEventListener("click", async () => {
    await services.runUiAction(async () => {
      uiState.accountId = getSelectedAccount();
      const date = getSelectedDate();
      await deps.authenticateAndSyncCalendar(date);
      await deps.refreshCoreData(date);
      renderDetailsPage(deps);
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
      renderDetailsPage(deps);
    });
  });

  document.getElementById("dashboard-reset-blocks")?.addEventListener("click", async () => {
    await services.runUiAction(async () => {
      uiState.accountId = getSelectedAccount();
      const date = getSelectedDate();
      const deletedCount = await helpers.resetBlocksForDate(date);
      await deps.refreshCoreData(date);
      setStatus(`ブロックを削除しました: ${deletedCount}件 (${date})`);
      renderDetailsPage(deps);
    });
  });

  document.getElementById("dashboard-refresh")?.addEventListener("click", async () => {
    await services.runUiAction(async () => {
      const date = getSelectedDate();
      await deps.refreshCoreData(date);
      renderDetailsPage(deps);
    });
  });

  helpers.bindDailyCalendarInteractions(() => renderDetailsPage(deps));
}
