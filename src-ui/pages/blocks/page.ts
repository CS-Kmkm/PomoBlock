import type { PageRenderDeps } from "../../types.js";

export function renderBlocksPage(deps: PageRenderDeps): void {
  const { uiState, appRoot, services, setStatus } = deps;
  const helpers = {
    ...deps.commonHelpers,
    ...deps.calendarHelpers,
    ...deps.nowHelpers,
    ...deps.routineHelpers,
    ...deps.taskHelpers,
  };
  const initialVisible = 50;
  const today = uiState.dashboardDate || helpers.isoDate(new Date());
  const visibleCount = Math.max(1, Math.floor(uiState.blocksVisibleCount || initialVisible));
  const visibleBlocks = uiState.blocks.slice(0, visibleCount);
  const hasMoreBlocks = uiState.blocks.length > visibleBlocks.length;

  appRoot.innerHTML = `
    <section class="view-head">
      <div>
        <h2>ブロック管理</h2>
        <p>生成済みブロックの確認・承認・調整・削除を行います。</p>
      </div>
      <label>日付 <input id="block-date" type="date" value="${today}" /></label>
      <label>Account <input id="block-account-id" value="${helpers.normalizeAccountId(uiState.accountId)}" /></label>
    </section>
    <div class="panel row">
      <button id="block-load" class="btn-secondary">再読み込み</button>
      <button id="block-generate-partial" class="btn-secondary">1件生成</button>
      <button id="block-generate-bulk" class="btn-primary">一括生成</button>
      <button id="block-reset-all" class="btn-warn">全削除</button>
    </div>
    ${helpers.renderDailyCalendar(today)}
    <div class="grid">
      ${visibleBlocks
        .map(
          (block: unknown) => `
          <article class="panel">
            <div class="row spread">
              <h3>${helpers.blockDisplayName(block as { start_at: string; end_at: string; id?: string })}</h3>
              <span class="pill">${(block as { firmness?: string }).firmness ?? ""}</span>
            </div>
            <div class="row" style="margin-top:10px">
              <label style="flex:1">
                Title
                <input
                  type="text"
                  value="${helpers.escapeHtml(helpers.blockTitle(block as { id?: string } | null | undefined))}"
                  data-block-title-input="${helpers.escapeHtml((block as { id?: string }).id || "")}"
                  placeholder="タイトル未設定"
                />
              </label>
              <button type="button" class="btn-secondary" data-block-title-save="${helpers.escapeHtml((block as { id?: string }).id || "")}">タイトル保存</button>
            </div>
            <p class="small">開始: ${helpers.formatTime((block as { start_at?: string }).start_at || null)} / 終了: ${helpers.formatTime((block as { end_at?: string }).end_at || null)}</p>
            <div class="grid two" style="margin-top:10px">
              <label>開始 <input id="start-${(block as { id?: string }).id}" type="datetime-local" value="${helpers.toLocalInputValue((block as { start_at?: string }).start_at || null)}" /></label>
              <label>終了 <input id="end-${(block as { id?: string }).id}" type="datetime-local" value="${helpers.toLocalInputValue((block as { end_at?: string }).end_at || null)}" /></label>
            </div>
            <div class="row" style="margin-top:10px">
              <button class="btn-primary" data-approve="${(block as { id?: string }).id}">承認</button>
              <button class="btn-secondary" data-adjust="${(block as { id?: string }).id}">時間調整</button>
              <button class="btn-warn" data-relocate="${(block as { id?: string }).id}">再配置</button>
              <button class="btn-danger" data-delete="${(block as { id?: string }).id}">削除</button>
            </div>
          </article>`
        )
        .join("")}
    </div>
    <div class="panel row spread">
      <span class="small">表示件数 ${visibleBlocks.length} / ${uiState.blocks.length}</span>
      ${hasMoreBlocks ? '<button id="block-show-more" class="btn-secondary">さらに表示</button>' : ""}
    </div>
  `;

  const reload = async () => {
    const date = (document.getElementById("block-date") as HTMLInputElement).value || today;
    const accountInput = document.getElementById("block-account-id") as HTMLInputElement | null;
    if (accountInput) {
      uiState.accountId = helpers.normalizeAccountId(accountInput.value);
    }
    uiState.dashboardDate = date;
    uiState.blocks = (await services.safeInvoke("list_blocks", { date })) as typeof uiState.blocks;
    uiState.calendarEvents = (await services.safeInvoke(
      "list_synced_events",
      helpers.withAccount(helpers.toSyncWindowPayload(date))
    )) as typeof uiState.calendarEvents;
    uiState.blocksVisibleCount = initialVisible;
    renderBlocksPage(deps);
  };

  const getSelectedDate = () => (document.getElementById("block-date") as HTMLInputElement).value || today;
  const getSelectedAccount = () =>
    helpers.normalizeAccountId((document.getElementById("block-account-id") as HTMLInputElement).value);

  document.getElementById("block-load")?.addEventListener("click", async () => {
    await services.runUiAction(reload);
  });

  document.getElementById("block-generate-partial")?.addEventListener("click", async () => {
    await services.runUiAction(async () => {
      uiState.accountId = getSelectedAccount();
      const date = getSelectedDate();
      const generated = (await services.safeInvoke("generate_one_block", helpers.withAccount({ date }))) as unknown[];
      setStatus(generated.length === 0 ? "1件生成できる空きがありません" : "ブロックを1件生成しました");
      await reload();
    });
  });

  document.getElementById("block-generate-bulk")?.addEventListener("click", async () => {
    await services.runUiAction(async () => {
      uiState.accountId = getSelectedAccount();
      const date = getSelectedDate();
      const generated = (await services.invokeCommandWithProgress("generate_blocks", helpers.withAccount({ date }))) as unknown[];
      setStatus(`${generated.length}件のブロックを生成しました`);
      await reload();
    });
  });

  document.getElementById("block-reset-all")?.addEventListener("click", async () => {
    await services.runUiAction(async () => {
      const date = getSelectedDate();
      uiState.accountId = getSelectedAccount();
      const deletedCount = await helpers.resetBlocksForDate(date);
      await deps.refreshCoreData(date);
      setStatus(`${deletedCount}件のブロックを削除しました (${date})`);
      renderBlocksPage(deps);
    });
  });

  document.getElementById("block-date")?.addEventListener("change", async () => {
    await services.runUiAction(reload);
  });
  document.getElementById("block-account-id")?.addEventListener("change", async () => {
    await services.runUiAction(reload);
  });

  appRoot.querySelectorAll("[data-approve]").forEach((node) => {
    node.addEventListener("click", async () => {
      await services.runUiAction(async () => {
        const id = (node as HTMLElement).dataset.approve;
        await services.safeInvoke("approve_blocks", { block_ids: [id] });
        await reload();
      });
    });
  });

  appRoot.querySelectorAll("[data-delete]").forEach((node) => {
    node.addEventListener("click", async () => {
      await services.runUiAction(async () => {
        const id = (node as HTMLElement).dataset.delete;
        await services.safeInvoke("delete_block", { block_id: id });
        await reload();
      });
    });
  });

  appRoot.querySelectorAll("[data-adjust]").forEach((node) => {
    node.addEventListener("click", async () => {
      await services.runUiAction(async () => {
        const id = (node as HTMLElement).dataset.adjust;
        const start = (document.getElementById(`start-${id}`) as HTMLInputElement).value;
        const end = (document.getElementById(`end-${id}`) as HTMLInputElement).value;
        await services.safeInvoke("adjust_block_time", {
          block_id: id,
          start_at: helpers.fromLocalInputValue(start),
          end_at: helpers.fromLocalInputValue(end),
        });
        await reload();
      });
    });
  });

  appRoot.querySelectorAll("[data-relocate]").forEach((node) => {
    node.addEventListener("click", async () => {
      await services.runUiAction(async () => {
        const id = (node as HTMLElement).dataset.relocate;
        await services.safeInvoke("relocate_if_needed", helpers.withAccount({ block_id: id }));
        await reload();
      });
    });
  });

  document.getElementById("block-show-more")?.addEventListener("click", () => {
    uiState.blocksVisibleCount = Math.min(uiState.blocks.length, visibleCount + initialVisible);
    renderBlocksPage(deps);
  });

  helpers.bindDailyCalendarInteractions(() => renderBlocksPage(deps));
}
