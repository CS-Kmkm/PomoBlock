import type { PageRenderDeps, Task } from "../../types.js";

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
  const pageTitle = isTodayRoute ? "Today Planner" : "日別詳細";
  const pageDescription = isTodayRoute ? "1日の中でブロックとタスクを組み合わせて実行計画を作成します。" : `中央の日付 ${helpers.escapeHtml(selectedDate)} の詳細表示と管理操作を行います。`;
  const backHref = isTodayRoute ? "#/now" : "#/week";
  const backLabel = isTodayRoute ? "実行中へ" : "週ビューへ戻る";
  const selectedBlocks = uiState.blocks.filter((block) => block.date === selectedDate);
  const openTasks = uiState.tasks.filter((task) => task.status !== "completed");
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

  const todayLayout = `
    <section class="today-planner-layout">
      <section class="today-planner-main">
        ${helpers.renderDailyCalendar(selectedDate, {
          panelClass: "week-advanced-calendar",
          includeDetail: true,
        })}
        <section class="panel week-block-table">
          <h3>今日のブロック</h3>
          <table>
            <thead><tr><th>ID</th><th>開始</th><th>終了</th><th>Firmness</th></tr></thead>
            <tbody>${blockTableRows || '<tr><td colspan="4" class="week-blocks-empty">ブロックがありません。同期または本日再生成を実行してください。</td></tr>'}</tbody>
          </table>
        </section>
      </section>
      <aside class="today-planner-side">
        <section class="panel today-task-panel">
          <header class="row spread">
            <h3>今日のタスク</h3>
            <span class="small">${openTasks.length}件 未完了</span>
          </header>
          <div class="today-task-create">
            <label>タイトル<input id="today-task-title" placeholder="例: 提案書の骨子を作る" /></label>
            <label>説明<input id="today-task-description" placeholder="任意" /></label>
            <label>見積もりポモドーロ<input id="today-task-estimate" type="number" min="0" value="1" /></label>
            <button id="today-task-create" class="btn-primary">タスク追加</button>
          </div>
          <div class="today-task-list">
            ${
              openTasks.length === 0
                ? '<p class="small">未完了タスクはありません。</p>'
                : openTasks
                    .map(
                      (task: Task) => `
                <article class="today-task-item">
                  <label class="today-task-title-field">
                    <input id="today-task-title-${task.id}" value="${helpers.escapeHtml(task.title || "")}" />
                  </label>
                  <div class="today-task-meta">
                    <select id="today-task-status-${task.id}">
                      ${["pending", "in_progress", "deferred", "completed"]
                        .map((status) => `<option value="${status}" ${task.status === status ? "selected" : ""}>${status}</option>`)
                        .join("")}
                    </select>
                    <input id="today-task-estimate-${task.id}" type="number" min="0" value="${Number(task.estimated_pomodoros ?? 0)}" />
                    <button class="btn-secondary" data-today-task-save="${task.id}">保存</button>
                  </div>
                </article>
              `
                    )
                    .join("")
            }
          </div>
        </section>
        <section class="panel today-block-task-panel">
          <h3>ブロックにタスクを入れる</h3>
          <p class="small">カレンダーでブロックを選択し、対象タスクを指定して開始します。</p>
          <label>対象ブロック
            <select id="today-target-block">
              <option value="">(ブロックを選択)</option>
              ${selectedBlocks
                .map(
                  (block) =>
                    `<option value="${block.id}" ${uiState.dayCalendarSelection?.kind === "block" && uiState.dayCalendarSelection.id === block.id ? "selected" : ""}>${helpers.escapeHtml(
                      helpers.blockDisplayName(block)
                    )}</option>`
                )
                .join("")}
            </select>
          </label>
          <label>対象タスク
            <select id="today-target-task">
              <option value="">(タスクを選択)</option>
              ${openTasks.map((task) => `<option value="${task.id}">${helpers.escapeHtml(task.title || "(untitled)")}</option>`).join("")}
            </select>
          </label>
          <button id="today-start-block-task" class="btn-primary">この組み合わせで開始</button>
        </section>
      </aside>
    </section>
  `;

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
    ${
      isTodayRoute
        ? todayLayout
        : `${helpers.renderDailyCalendar(selectedDate, {
            panelClass: "week-advanced-calendar",
            includeDetail: true,
          })}
    <section class="panel week-block-table">
      <h3>中央日のブロック</h3>
      <table>
        <thead><tr><th>ID</th><th>開始</th><th>終了</th><th>Firmness</th></tr></thead>
        <tbody>${blockTableRows || '<tr><td colspan="4" class="week-blocks-empty">ブロックがありません。同期または本日再生成を実行してください。</td></tr>'}</tbody>
      </table>
    </section>`
    }
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

  if (isTodayRoute) {
    document.getElementById("today-task-create")?.addEventListener("click", async () => {
      await services.runUiAction(async () => {
        const title = (document.getElementById("today-task-title") as HTMLInputElement | null)?.value?.trim() || "";
        const description = (document.getElementById("today-task-description") as HTMLInputElement | null)?.value?.trim() || "";
        const estimateRaw = (document.getElementById("today-task-estimate") as HTMLInputElement | null)?.value || "0";
        const estimate = Number(estimateRaw);
        if (!title) {
          setStatus("タスクタイトルを入力してください");
          return;
        }
        await services.safeInvoke("create_task", {
          title,
          description: description || null,
          estimated_pomodoros: Number.isFinite(estimate) ? estimate : null,
        });
        uiState.tasks = (await services.safeInvoke("list_tasks")) as typeof uiState.tasks;
        rerender();
      });
    });

    appRoot.querySelectorAll<HTMLElement>("[data-today-task-save]").forEach((node) => {
      node.addEventListener("click", async () => {
        const taskId = node.dataset.todayTaskSave;
        if (!taskId) return;
        await services.runUiAction(async () => {
          const title = (document.getElementById(`today-task-title-${taskId}`) as HTMLInputElement | null)?.value || "";
          const status = (document.getElementById(`today-task-status-${taskId}`) as HTMLSelectElement | null)?.value || "pending";
          const estimateRaw = (document.getElementById(`today-task-estimate-${taskId}`) as HTMLInputElement | null)?.value || "0";
          const estimate = Number(estimateRaw);
          await services.safeInvoke("update_task", {
            task_id: taskId,
            title,
            status,
            estimated_pomodoros: Number.isFinite(estimate) ? estimate : null,
          });
          uiState.tasks = (await services.safeInvoke("list_tasks")) as typeof uiState.tasks;
          rerender();
        });
      });
    });

    document.getElementById("today-start-block-task")?.addEventListener("click", async () => {
      await services.runUiAction(async () => {
        const blockId = (document.getElementById("today-target-block") as HTMLSelectElement | null)?.value || "";
        const taskId = (document.getElementById("today-target-task") as HTMLSelectElement | null)?.value || "";
        if (!blockId || !taskId) {
          setStatus("対象ブロックと対象タスクを選択してください");
          return;
        }
        await services.safeInvoke("start_block_timer", { block_id: blockId, task_id: taskId });
        setStatus("ブロックとタスクを指定して開始しました");
        rerender();
      });
    });
  }

  helpers.bindDailyCalendarInteractions(() => rerender());
}
