import type { PageRenderDeps } from "../types.js";

export function renderTasksPage(deps: PageRenderDeps): void {
  const { uiState, appRoot, services, setStatus } = deps;

  function blockDisplayName(block: { start_at?: string; end_at?: string; id?: string }) {
    const timeRange = `${helpers.formatHHmm(block?.start_at)}-${helpers.formatHHmm(block?.end_at)}`;
    const title = helpers.blockTitle(block);
    return title ? `${title} (${timeRange})` : timeRange;
  }

  const helpers = {
    ...deps.commonHelpers,
    ...deps.calendarHelpers,
    ...deps.nowHelpers,
    ...deps.routineHelpers,
    ...deps.taskHelpers,
  };

  appRoot.innerHTML = `
    <section class="view-head">
      <div>
        <h2>タスク管理</h2>
        <p>タスクの作成・更新・削除。</p>
      </div>
    </section>
    <div class="panel grid">
      <label>タイトル <input id="task-title" /></label>
      <label>説明 <input id="task-description" /></label>
      <label>見積ポモドーロ <input id="task-estimate" type="number" min="0" value="1" /></label>
      <button id="task-create" class="btn-primary">タスク作成</button>
    </div>
    <div class="panel" style="margin-top:14px">
      <h3>一覧</h3>
      <table>
        <thead><tr><th>Title</th><th>Status</th><th>Estimate</th><th>操作</th></tr></thead>
        <tbody>
          ${uiState.tasks
            .map(
              (task: Unsafe) => `
              <tr>
                <td><input id="title-${task.id}" value="${task.title}" /></td>
                <td>
                  <select id="status-${task.id}">
                    ${["pending", "in_progress", "completed", "deferred"]
                      .map((status: Unsafe) => `<option value="${status}" ${task.status === status ? "selected" : ""}>${status}</option>`)
                      .join("")}
                  </select>
                </td>
                <td><input id="estimate-${task.id}" type="number" min="0" value="${task.estimated_pomodoros ?? 0}" /></td>
                <td>
                  <button class="btn-secondary" data-save-task="${task.id}">保存</button>
                  <input id="split-parts-${task.id}" type="number" min="2" value="2" style="width:68px" />
                  <button class="btn-warn" data-split-task="${task.id}">分割</button>
                  <button class="btn-danger" data-delete-task="${task.id}">削除</button>
                </td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
    <div class="panel" style="margin-top:14px">
      <h3>繰り越し</h3>
      <div class="grid three">
        <label>Task
          <select id="carry-task-id">
            <option value="">(task)</option>
            ${uiState.tasks
              .filter((task: Unsafe) => task.status !== "completed")
              .map((task: Unsafe) => `<option value="${task.id}">${task.title}</option>`)
              .join("")}
          </select>
        </label>
        <label>From Block
          <select id="carry-from-block-id">
            <option value="">(from)</option>
            ${uiState.blocks.map((block: Unsafe) => `<option value="${block.id}">${blockDisplayName(block)}</option>`).join("")}
          </select>
        </label>
        <label>To Block
          <select id="carry-to-block-id">
            <option value="">(to)</option>
            ${uiState.blocks.map((block: Unsafe) => `<option value="${block.id}">${blockDisplayName(block)}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="row" style="margin-top:10px">
        <button id="task-carry-over" class="btn-warn">選択ブロックへ繰り越し</button>
      </div>
    </div>
  `;

  document.getElementById("task-create")?.addEventListener("click", async () => {
    const title = (document.getElementById("task-title") as HTMLInputElement).value.trim();
    const description = (document.getElementById("task-description") as HTMLInputElement).value.trim();
    const estimate = Number((document.getElementById("task-estimate") as HTMLInputElement).value || "0");
    await services.safeInvoke("create_task", {
      title,
      description: description || null,
      estimated_pomodoros: Number.isFinite(estimate) ? estimate : null,
    });
    uiState.tasks = (await services.safeInvoke("list_tasks")) as typeof uiState.tasks;
    renderTasksPage(deps);
  });

  appRoot.querySelectorAll("[data-save-task]").forEach((node: Unsafe) => {
    node.addEventListener("click", async () => {
      const id = (node as HTMLElement).dataset.saveTask;
      const title = (document.getElementById(`title-${id}`) as HTMLInputElement).value;
      const status = (document.getElementById(`status-${id}`) as HTMLSelectElement).value;
      const estimate = Number((document.getElementById(`estimate-${id}`) as HTMLInputElement).value || "0");
      await services.safeInvoke("update_task", {
        task_id: id,
        title,
        estimated_pomodoros: Number.isFinite(estimate) ? estimate : null,
        status,
      });
      uiState.tasks = (await services.safeInvoke("list_tasks")) as typeof uiState.tasks;
      renderTasksPage(deps);
    });
  });

  appRoot.querySelectorAll("[data-delete-task]").forEach((node: Unsafe) => {
    node.addEventListener("click", async () => {
      const id = (node as HTMLElement).dataset.deleteTask;
      await services.safeInvoke("delete_task", { task_id: id });
      uiState.tasks = (await services.safeInvoke("list_tasks")) as typeof uiState.tasks;
      renderTasksPage(deps);
    });
  });

  appRoot.querySelectorAll("[data-split-task]").forEach((node: Unsafe) => {
    node.addEventListener("click", async () => {
      const id = (node as HTMLElement).dataset.splitTask;
      const partsRaw = (document.getElementById(`split-parts-${id}`) as HTMLInputElement).value;
      const parts = Number(partsRaw || "0");
      await services.safeInvoke("split_task", { task_id: id, parts: Number.isFinite(parts) ? parts : 0 });
      uiState.tasks = (await services.safeInvoke("list_tasks")) as typeof uiState.tasks;
      renderTasksPage(deps);
    });
  });

  document.getElementById("task-carry-over")?.addEventListener("click", async () => {
    const taskId = (document.getElementById("carry-task-id") as HTMLSelectElement).value;
    const fromBlockId = (document.getElementById("carry-from-block-id") as HTMLSelectElement).value;
    const toBlockId = (document.getElementById("carry-to-block-id") as HTMLSelectElement).value;
    if (!taskId || !fromBlockId || !toBlockId) {
      setStatus("task / from / to を選択してください");
      return;
    }
    const result = (await services.safeInvoke("carry_over_task", {
      task_id: taskId,
      from_block_id: fromBlockId,
      candidate_block_ids: [toBlockId],
    })) as { task_id?: string; to_block_id?: string };
    setStatus(`task carry-over: ${result.task_id} -> ${result.to_block_id}`);
    uiState.tasks = (await services.safeInvoke("list_tasks")) as typeof uiState.tasks;
    renderTasksPage(deps);
  });
}
