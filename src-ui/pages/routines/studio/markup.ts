import type { RoutineScheduleGroupSummary, RoutineScheduleRecurrence, RoutineStudioState } from "../../../types.js";
import type { RoutineStudioFolderView } from "../model.js";
import { ROUTINE_STUDIO_DEFAULT_FOLDER_ID, routineStudioFolderLabel } from "../model.js";
import { canMoveStudioEntryGroup, collectStudioEntryGroups } from "./entry-groups.js";

const weekdayOptions = [
  { id: "sun", label: "日" },
  { id: "mon", label: "月" },
  { id: "tue", label: "火" },
  { id: "wed", label: "水" },
  { id: "thu", label: "木" },
  { id: "fri", label: "金" },
  { id: "sat", label: "土" },
];

function scheduleRecurrenceLabelForRecurrence(recurrence: RoutineScheduleRecurrence): string {
  if (recurrence.repeatType === "monthly_date") {
    return `毎月 ${Math.max(1, Number(recurrence.dayOfMonth) || 1)} 日`;
  }
  if (recurrence.repeatType === "monthly_nth") {
    const weekday = weekdayOptions.find((option) => option.id === recurrence.nthWeekday)?.label || recurrence.nthWeekday;
    return `毎月 第${Math.max(1, Number(recurrence.nthWeek) || 1)}${weekday}`;
  }
  const labels = weekdayOptions
    .filter((option) => recurrence.weekdays.includes(option.id))
    .map((option) => option.label);
  return labels.length > 0 ? `毎週 ${labels.join("・")}` : "毎週";
}

function scheduleRecurrenceLabel(studio: RoutineStudioState): string {
  return scheduleRecurrenceLabelForRecurrence(studio.scheduleRecurrence);
}

type BuildRoutineStudioMarkupParams = {
  studio: RoutineStudioState;
  folderAssets: RoutineStudioFolderView[];
  complexModuleAssets: Array<{ id: string; name: string; category: string; stepCount: number; totalMinutes: number }>;
  allComplexModuleAssets: Array<{ id: string; name: string; category: string; stepCount: number; totalMinutes: number }>;
  totalMinutes: number;
  routineStudioContexts: string[];
  scheduleDayCalendarHtml: string;
  savedScheduleGroups: RoutineScheduleGroupSummary[];
  currentDraftScheduleValue: string;
  scheduleWindowStartMinutes: number;
  scheduleWindowDurationMinutes: number;
  showExtendedScheduleWindow: boolean;
  escapeHtml: (value: unknown) => string;
};

export function buildRoutineStudioLoadingMarkup(): string {
  return `
      <section class="routine-studio-root">
        <header class="routine-studio-toolbar">
          <div>
            <h2>Routine Studio</h2>
            <p>モジュールを読み込み中...</p>
          </div>
        </header>
      </section>
    `;
}

function buildRoutineStudioEditorWorkspace(params: {
  studio: RoutineStudioState;
  folderAssets: RoutineStudioFolderView[];
  totalMinutes: number;
  routineStudioContexts: string[];
  escapeHtml: (value: unknown) => string;
  canvasGroups: ReturnType<typeof collectStudioEntryGroups>;
}): string {
  const { studio, folderAssets, totalMinutes, routineStudioContexts, escapeHtml, canvasGroups } = params;
  return `
        <div class="routine-studio-layout">
          <aside class="rs-library">
            <div class="rs-library-tools">
              <div class="rs-search-wrap">
                <input id="studio-search-input" type="search" placeholder="モジュールを検索..." value="${escapeHtml(studio.search)}" />
              </div>
              <div class="rs-library-actions">
                <button type="button" id="studio-new-folder" class="rs-icon-btn" title="フォルダー追加" aria-label="フォルダー追加">+</button>
              </div>
            </div>
            <div class="rs-assets">
              ${(() => {
                const modParts =
                  folderAssets.length === 0
                    ? ""
                    : folderAssets
                        .map(
                          (folder) => `
                  <section class="rs-asset-group rs-folder-group" data-studio-asset-group data-studio-folder-group="true" data-studio-folder-id="${escapeHtml(folder.id)}">
                    <div class="rs-asset-group-head">
                      <h4 class="rs-asset-group-title">${escapeHtml(routineStudioFolderLabel(folder))}</h4>
                      <div class="rs-folder-actions">
                        ${folder.id === ROUTINE_STUDIO_DEFAULT_FOLDER_ID ? "" : `<button type="button" class="rs-icon-btn is-danger" title="削除" aria-label="フォルダーを削除" data-studio-folder-delete="${escapeHtml(folder.id)}">&#128465;</button>`}
                      </div>
                    </div>
                    <div class="rs-folder-dropzone" data-studio-folder-dropzone="${escapeHtml(folder.id)}">
                      ${folder.modules
                        .map(
                          (module) => `
                      <article class="rs-asset-card rs-asset-card--compact" data-studio-draggable="true" data-studio-asset-kind="module" data-studio-asset-id="${escapeHtml(module.id)}" data-studio-search-text="${escapeHtml(`${module.name} ${module.description || ""} ${module.category || ""}`)}">
                        <div class="rs-asset-head">
                          <p class="rs-asset-title">${escapeHtml(module.name)}</p>
                          <span class="rs-asset-duration">${module.durationMinutes}m</span>
                        </div>
                        <div class="rs-asset-foot">
                          <p class="rs-asset-subtitle">${escapeHtml(module.description || "")}</p>
                          <div class="rs-asset-actions rs-asset-actions-inline">
                            <button type="button" class="rs-icon-btn" title="追加" aria-label="モジュールを追加" data-studio-insert-kind="module" data-studio-insert-id="${escapeHtml(module.id)}">+</button>
                            <button type="button" class="rs-icon-btn" title="編集" data-studio-module-edit="${escapeHtml(module.id)}">&#9998;</button>
                            <button type="button" class="rs-icon-btn is-danger" title="削除" data-studio-module-delete="${escapeHtml(module.id)}">&#128465;</button>
                          </div>
                        </div>
                      </article>
                    `,
                        )
                        .join("")}
                      ${folder.templates
                        .map(
                          (cm) => `
                      <article class="rs-asset-card rs-asset-card--compact" data-studio-draggable="true" data-studio-asset-kind="template" data-studio-asset-id="${escapeHtml(cm.id)}" data-studio-search-text="${escapeHtml(`${cm.name} ${cm.stepCount} ${cm.totalMinutes}`)}">
                        <div class="rs-asset-head">
                          <p class="rs-asset-title">${escapeHtml(cm.name)}<span class="rs-badge">複合</span></p>
                          <span class="rs-asset-duration">${cm.totalMinutes}m</span>
                        </div>
                        <div class="rs-asset-foot">
                          <p class="rs-asset-subtitle">${cm.stepCount} ステップ</p>
                          <div class="rs-asset-actions rs-asset-actions-inline">
                            <button type="button" class="rs-icon-btn" title="追加" aria-label="複合モジュールを追加" data-studio-insert-kind="template" data-studio-insert-id="${escapeHtml(cm.id)}">+</button>
                            <button type="button" class="rs-icon-btn is-danger" title="削除" data-studio-recipe-delete="${escapeHtml(cm.id)}">&#128465;</button>
                          </div>
                        </div>
                      </article>
                    `,
                        )
                        .join("")}
                      <p class="small rs-folder-empty" data-studio-folder-empty ${folder.modules.length > 0 || folder.templates.length > 0 ? "hidden" : ""}>このフォルダーにはモジュールがありません。</p>
                    </div>
                  </section>
                `,
                        )
                        .join("");
                const emptyState = '<p class="small" id="studio-assets-empty" hidden>モジュールが見つかりません。</p>';
                if (!modParts) return '<p class="small" id="studio-assets-empty">モジュールが見つかりません。</p>';
                return modParts + emptyState;
              })()}
            </div>
          </aside>
          <div class="pane-splitter" data-pane-resize="rs-left" role="separator" aria-orientation="vertical" aria-label="Resize left panel" tabindex="0"></div>
          <section class="rs-canvas">
            <header class="rs-canvas-head">
              <div>
                <h3>ルーティンキャンバス</h3>
                <p>モジュールをドラッグして追加</p>
              </div>
              <div class="rs-history-actions">
                <button type="button" id="studio-undo" class="rs-btn rs-btn-ghost" ${studio.historyIndex <= 0 ? "disabled" : ""}>元に戻す</button>
                <button type="button" id="studio-redo" class="rs-btn rs-btn-ghost" ${studio.historyIndex >= studio.history.length - 1 ? "disabled" : ""}>やり直す</button>
              </div>
            </header>
            <div class="rs-canvas-body">
              <div id="routine-studio-dropzone" class="rs-dropzone">
                ${
                  studio.canvasEntries.length === 0
                    ? '<div class="rs-drop-empty"><p class="rs-drop-empty-title">モジュールをドラッグ</p><p class="small">追加ボタンからも追加できます</p></div>'
                    : canvasGroups
                        .map((group) => {
                          const anchor = group.entries[0];
                          if (!anchor) return "";
                          const moveUpDisabled = !canMoveStudioEntryGroup(studio.canvasEntries, anchor.entryId, "up");
                          const moveDownDisabled = !canMoveStudioEntryGroup(studio.canvasEntries, anchor.entryId, "down");
                          const moveUpLabel = group.isGrouped ? "複合モジュールを上へ" : "上へ";
                          const moveDownLabel = group.isGrouped ? "複合モジュールを下へ" : "下へ";
                          const removeLabel = group.isGrouped ? "複合モジュールを削除" : "削除";
                          const isSelected = group.entries.some((entry) => String(entry.entryId || "") === studio.selectedEntryId);
                          const title = group.isGrouped ? anchor.subtitle || anchor.title || `Step ${group.start + 1}` : anchor.title || `Step ${group.start + 1}`;
                          const subtitle = group.isGrouped ? `${group.entries.length} ステップ` : anchor.subtitle || "";
                          const duration = group.isGrouped ? group.totalMinutes : Math.max(1, Number(anchor.durationMinutes) || 0);
                          const indexLabel = group.isGrouped ? `${group.start + 1}-${group.end + 1}` : `${group.start + 1}`;
                          return `
                    <article class="rs-canvas-card ${group.isGrouped ? "rs-canvas-card--grouped" : ""} ${isSelected ? "is-selected" : ""}" data-studio-entry-id="${escapeHtml(anchor.entryId)}" data-studio-entry-group-id="${escapeHtml(group.groupId || "")}" data-studio-canvas-entry="${escapeHtml(anchor.entryId)}">
                      <header class="rs-canvas-card-head">
                        <span class="rs-drag-handle" aria-hidden="true" title="ドラッグして並び順を変更">&#x2807;</span>
                        <button type="button" class="rs-canvas-index" data-studio-select-entry="${escapeHtml(anchor.entryId)}">${indexLabel}</button>
                        <div class="rs-canvas-meta">
                          <p class="rs-canvas-title">${escapeHtml(title)}${group.isGrouped ? '<span class="rs-badge">複合</span>' : ""}</p>
                          <p class="rs-canvas-subtitle">${escapeHtml(subtitle)}</p>
                        </div>
                        <span class="rs-canvas-duration">${duration}m</span>
                        <div class="rs-canvas-actions">
                          <button type="button" class="rs-icon-btn" title="${moveUpLabel}" aria-label="${moveUpLabel}" data-studio-move="${escapeHtml(anchor.entryId)}" data-studio-dir="up" ${moveUpDisabled ? "disabled" : ""}>↑</button>
                          <button type="button" class="rs-icon-btn" title="${moveDownLabel}" aria-label="${moveDownLabel}" data-studio-move="${escapeHtml(anchor.entryId)}" data-studio-dir="down" ${moveDownDisabled ? "disabled" : ""}>↓</button>
                          <button type="button" class="rs-icon-btn is-danger" title="${removeLabel}" aria-label="${removeLabel}" data-studio-remove="${escapeHtml(anchor.entryId)}">×</button>
                          <button type="button" class="rs-icon-btn" title="${group.isGrouped ? "複合モジュールを編集" : "詳細設定"}" data-studio-entry-settings="${escapeHtml(anchor.entryId)}">&#9881;</button>
                        </div>
                      </header>
                      ${
                        group.isGrouped
                          ? `
                        <div class="rs-canvas-group-steps">
                          ${group.entries
                            .map(
                              (entry, stepIndex) => `
                            <button type="button" class="rs-canvas-group-step ${studio.selectedEntryId === entry.entryId ? "is-selected" : ""}" data-studio-select-entry="${escapeHtml(entry.entryId)}">
                              <span class="rs-canvas-group-step-index">${group.start + stepIndex + 1}</span>
                              <span class="rs-canvas-group-step-title">${escapeHtml(entry.title || `Step ${group.start + stepIndex + 1}`)}</span>
                              <span class="rs-canvas-group-step-duration">${Math.max(1, Number(entry.durationMinutes) || 0)}m</span>
                            </button>
                          `,
                            )
                            .join("")}
                        </div>
                      `
                          : ""
                      }
                    </article>
                  `;
                        })
                        .join("")
                }
              </div>
            </div>
          </section>
          <div class="pane-splitter" data-pane-resize="rs-right" role="separator" aria-orientation="vertical" aria-label="Resize right panel" tabindex="0"></div>
          <aside class="rs-intel">
            <header class="rs-intel-head">
              <h3 data-studio-title>${escapeHtml(studio.draftName)}</h3>
              <p class="small">編集済み</p>
              <div class="rs-total">${totalMinutes}<span> min</span></div>
            </header>
            <div class="rs-intel-body">
              <details class="rs-properties" open>
                <summary class="rs-properties-summary">プロパティ</summary>
                <label class="rs-field">ルーティン名<input id="studio-draft-name" value="${escapeHtml(studio.draftName)}" /></label>
                <label class="rs-field">コンテキスト<select id="studio-context">${routineStudioContexts
                  .map((ctx) => `<option value="${escapeHtml(ctx)}" ${ctx === studio.context ? "selected" : ""}>${escapeHtml(ctx)}</option>`)
                  .join("")}</select></label>
                <label class="rs-field rs-toggle" for="studio-auto-start"><span>タイマー自動開始</span><input id="studio-auto-start" type="checkbox" ${
                  studio.autoStart ? "checked" : ""
                } /></label>
              </details>
            </div>
            <footer class="rs-intel-actions">
              <button type="button" id="studio-save-template" class="rs-btn rs-btn-primary">保存</button>
              <button type="button" id="studio-clear-canvas" class="rs-btn rs-btn-ghost">キャンバスをリセット</button>
            </footer>
          </aside>
        </div>
  `;
}

function buildRoutineStudioScheduleCenterMarkup(params: {
  studio: RoutineStudioState;
  scheduleTitle: string;
  scheduleDayCalendarHtml: string;
  scheduleWindowStartMinutes: number;
  scheduleWindowDurationMinutes: number;
  showExtendedScheduleWindow: boolean;
  escapeHtml: (value: unknown) => string;
}): string {
  const { studio, scheduleTitle, scheduleDayCalendarHtml, scheduleWindowStartMinutes, scheduleWindowDurationMinutes, showExtendedScheduleWindow, escapeHtml } = params;
  return `
          <section class="rs-schedule-main">
            <header class="rs-schedule-head">
              <div>
                <h3 class="rs-schedule-title">${escapeHtml(scheduleTitle)}</h3>
                <p class="small">Now の左ペインのように 1 日の定型予定を並べ、左の編集ワークスペースからアセットをドラッグして追加します。</p>
              </div>
              <div class="rs-schedule-head-meta">
                <span class="rs-badge">${escapeHtml(scheduleRecurrenceLabel(studio))}</span>
                <span class="small">${studio.scheduleEntries.length} 件</span>
              </div>
            </header>
            <section class="rs-schedule-day">
              <header class="rs-schedule-section-head">
                <div>
                  <h4>1日のスケジュール</h4>
                  <p class="small">${showExtendedScheduleWindow ? "日跨ぎ予定があるため前後日も表示しています" : "当日24hを表示しています。日跨ぎ予定のみ前後日に拡張します"}</p>
                </div>
                <button type="button" id="studio-schedule-add-gap" class="rs-btn rs-btn-ghost">空スロット追加</button>
              </header>
              <div id="routine-schedule-dropzone" class="rs-schedule-now-dropzone ${showExtendedScheduleWindow ? "is-extended-window" : "is-day-window"}" data-studio-schedule-dropzone="true" data-schedule-window-start-minutes="${scheduleWindowStartMinutes}" data-schedule-window-duration-minutes="${scheduleWindowDurationMinutes}">
                <div class="rs-schedule-zone-markers ${showExtendedScheduleWindow ? "is-extended-window" : "is-day-window"}" aria-hidden="true">
                  ${
                    showExtendedScheduleWindow
                      ? `
                  <div class="rs-schedule-zone-marker is-before"><span>-24h</span></div>
                  <div class="rs-schedule-zone-marker is-today"><span>当日</span></div>
                  <div class="rs-schedule-zone-marker is-after"><span>+24h</span></div>
                  `
                      : `<div class="rs-schedule-zone-marker is-today is-full"><span>当日</span></div>`
                  }
                </div>
                ${scheduleDayCalendarHtml}
              </div>
            </section>
          </section>
  `;
}

function buildRoutineStudioScheduleLeftMarkup(params: {
  studio: RoutineStudioState;
  folderAssets: RoutineStudioFolderView[];
  escapeHtml: (value: unknown) => string;
}): string {
  const { studio, folderAssets, escapeHtml } = params;
  return `
            <section class="rs-library rs-library--schedule">
              <div class="rs-library-tools">
                <div class="rs-search-wrap">
                  <input id="studio-search-input" type="search" placeholder="モジュールを検索..." value="${escapeHtml(studio.search)}" />
                </div>
                <div class="rs-library-actions">
                  <button type="button" id="studio-new-folder" class="rs-icon-btn" title="フォルダー追加" aria-label="フォルダー追加">+</button>
                </div>
              </div>
              <div class="rs-assets">
                ${(() => {
                  const modParts =
                    folderAssets.length === 0
                      ? ""
                      : folderAssets
                          .map(
                            (folder) => `
                    <section class="rs-asset-group rs-folder-group" data-studio-asset-group data-studio-folder-group="true" data-studio-folder-id="${escapeHtml(folder.id)}">
                      <div class="rs-asset-group-head">
                        <h4 class="rs-asset-group-title">${escapeHtml(routineStudioFolderLabel(folder))}</h4>
                        <div class="rs-folder-actions">
                          ${folder.id === ROUTINE_STUDIO_DEFAULT_FOLDER_ID ? "" : `<button type="button" class="rs-icon-btn is-danger" title="削除" aria-label="フォルダーを削除" data-studio-folder-delete="${escapeHtml(folder.id)}">&#128465;</button>`}
                        </div>
                      </div>
                      <div class="rs-folder-dropzone" data-studio-folder-dropzone="${escapeHtml(folder.id)}">
                        ${folder.modules
                          .map(
                            (module) => `
                        <article class="rs-asset-card rs-asset-card--compact" data-studio-draggable="true" data-studio-asset-kind="module" data-studio-asset-id="${escapeHtml(module.id)}" data-studio-search-text="${escapeHtml(`${module.name} ${module.description || ""} ${module.category || ""}`)}">
                          <div class="rs-asset-head">
                            <p class="rs-asset-title">${escapeHtml(module.name)}</p>
                            <span class="rs-asset-duration">${module.durationMinutes}m</span>
                          </div>
                          <div class="rs-asset-foot">
                            <p class="rs-asset-subtitle">${escapeHtml(module.description || "")}</p>
                            <div class="rs-asset-actions rs-asset-actions-inline">
                              <button type="button" class="rs-icon-btn" title="追加" aria-label="モジュールを追加" data-studio-insert-kind="module" data-studio-insert-id="${escapeHtml(module.id)}">+</button>
                              <button type="button" class="rs-icon-btn" title="編集" data-studio-module-edit="${escapeHtml(module.id)}">&#9998;</button>
                              <button type="button" class="rs-icon-btn is-danger" title="削除" data-studio-module-delete="${escapeHtml(module.id)}">&#128465;</button>
                            </div>
                          </div>
                        </article>
                      `,
                          )
                          .join("")}
                        ${folder.templates
                          .map(
                            (cm) => `
                        <article class="rs-asset-card rs-asset-card--compact" data-studio-draggable="true" data-studio-asset-kind="template" data-studio-asset-id="${escapeHtml(cm.id)}" data-studio-search-text="${escapeHtml(`${cm.name} ${cm.stepCount} ${cm.totalMinutes}`)}">
                          <div class="rs-asset-head">
                            <p class="rs-asset-title">${escapeHtml(cm.name)}<span class="rs-badge">複合</span></p>
                            <span class="rs-asset-duration">${cm.totalMinutes}m</span>
                          </div>
                          <div class="rs-asset-foot">
                            <p class="rs-asset-subtitle">${cm.stepCount} ステップ</p>
                            <div class="rs-asset-actions rs-asset-actions-inline">
                              <button type="button" class="rs-icon-btn" title="追加" aria-label="複合モジュールを追加" data-studio-insert-kind="template" data-studio-insert-id="${escapeHtml(cm.id)}">+</button>
                              <button type="button" class="rs-icon-btn is-danger" title="削除" data-studio-recipe-delete="${escapeHtml(cm.id)}">&#128465;</button>
                            </div>
                          </div>
                        </article>
                      `,
                          )
                          .join("")}
                        <p class="small rs-folder-empty" data-studio-folder-empty ${folder.modules.length > 0 || folder.templates.length > 0 ? "hidden" : ""}>このフォルダーにはモジュールがありません。</p>
                      </div>
                    </section>
                  `,
                          )
                          .join("");
                  const emptyState = '<p class="small" id="studio-assets-empty" hidden>モジュールが見つかりません。</p>';
                  if (!modParts) return '<p class="small" id="studio-assets-empty">モジュールが見つかりません。</p>';
                  return modParts + emptyState;
                })()}
              </div>
            </section>
  `;
}

function buildRoutineStudioScheduleRightMarkup(params: {
  studio: RoutineStudioState;
  currentDraftScheduleValue: string;
  selectedApplyTemplate: { id: string; name: string } | undefined;
  allComplexModuleAssets: Array<{ id: string; name: string; category: string; stepCount: number; totalMinutes: number }>;
  savedScheduleGroups: RoutineScheduleGroupSummary[];
  escapeHtml: (value: unknown) => string;
}): string {
  const { studio, currentDraftScheduleValue, selectedApplyTemplate, allComplexModuleAssets, savedScheduleGroups, escapeHtml } = params;
  const knownGroupIds = new Set([currentDraftScheduleValue, ...allComplexModuleAssets.map((cm) => cm.id)]);
  return `
          <aside class="rs-schedule-side">
            <section class="rs-schedule-props">
              <h4>繰り返し設定</h4>
              <label class="rs-field">スケジュールセット
                <select id="studio-schedule-group">
                  <option value="${escapeHtml(currentDraftScheduleValue)}" ${studio.scheduleGroupId === currentDraftScheduleValue ? "selected" : ""}>現在の下書き (${escapeHtml(studio.draftName)})</option>
                  ${allComplexModuleAssets
                    .map(
                      (cm) =>
                        `<option value="${escapeHtml(cm.id)}" ${cm.id === studio.scheduleGroupId ? "selected" : ""}>${escapeHtml(cm.name)} (${cm.stepCount} ステップ)</option>`,
                    )
                    .join("")}
                  ${savedScheduleGroups
                    .filter((group) => !knownGroupIds.has(group.groupId))
                    .map(
                      (group) =>
                        `<option value="${escapeHtml(group.groupId)}" ${group.groupId === studio.scheduleGroupId ? "selected" : ""}>${escapeHtml(group.name)} (${group.entryCount} 件)</option>`,
                    )
                    .join("")}
                </select>
              </label>
              <div class="rs-repeat-tabs" role="tablist" aria-label="繰り返し種別">
                <button type="button" class="rs-subnav-tab ${studio.scheduleRecurrence.repeatType === "weekly" ? "is-active" : ""}" data-studio-repeat-type="weekly">毎週</button>
                <button type="button" class="rs-subnav-tab ${studio.scheduleRecurrence.repeatType === "monthly_date" ? "is-active" : ""}" data-studio-repeat-type="monthly_date">毎月日付</button>
                <button type="button" class="rs-subnav-tab ${studio.scheduleRecurrence.repeatType === "monthly_nth" ? "is-active" : ""}" data-studio-repeat-type="monthly_nth">第n曜日</button>
              </div>
              ${
                studio.scheduleRecurrence.repeatType === "weekly"
                  ? `
                <div class="rs-weekday-grid">
                  ${weekdayOptions
                    .map(
                      (option) => `
                    <label class="rs-choice-chip">
                      <input type="checkbox" data-studio-repeat-weekday="${option.id}" ${studio.scheduleRecurrence.weekdays.includes(option.id) ? "checked" : ""} />
                      <span>${option.label}</span>
                    </label>
                  `,
                    )
                    .join("")}
                </div>
              `
                  : studio.scheduleRecurrence.repeatType === "monthly_date"
                    ? `<label class="rs-field">毎月何日<input id="studio-repeat-day-of-month" type="number" min="1" max="31" value="${Math.max(1, Number(studio.scheduleRecurrence.dayOfMonth) || 1)}" /></label>`
                    : `
                <div class="rs-inline-fields">
                  <label class="rs-field">第何週
                    <select id="studio-repeat-nth-week">
                      ${[1, 2, 3, 4, 5]
                        .map((value) => `<option value="${value}" ${value === studio.scheduleRecurrence.nthWeek ? "selected" : ""}>第${value}</option>`)
                        .join("")}
                    </select>
                  </label>
                  <label class="rs-field">曜日
                    <select id="studio-repeat-nth-weekday">
                      ${weekdayOptions
                        .map((option) => `<option value="${option.id}" ${option.id === studio.scheduleRecurrence.nthWeekday ? "selected" : ""}>${option.label}</option>`)
                        .join("")}
                    </select>
                  </label>
                </div>
              `
              }
              <div class="rs-inline-fields">
                <label class="rs-field">開始日<input id="studio-repeat-start-date" type="date" value="${escapeHtml(studio.scheduleRecurrence.startDate)}" /></label>
                <label class="rs-field">終了日<input id="studio-repeat-end-date" type="date" value="${escapeHtml(studio.scheduleRecurrence.endDate)}" /></label>
              </div>
              ${
                studio.scheduleSelectedEntryId
                  ? (() => {
                      const selectedEntry = studio.scheduleEntries.find((entry) => entry.id === studio.scheduleSelectedEntryId);
                      if (!selectedEntry) return "";
                      return `
                <div class="rs-schedule-detail">
                  <h5>選択中の予定</h5>
                  <label class="rs-field">タイトル<input value="${escapeHtml(selectedEntry.title)}" data-studio-schedule-field="title" data-studio-schedule-id="${escapeHtml(selectedEntry.id)}" /></label>
                  <label class="rs-field">開始時刻<input type="time" value="${escapeHtml(selectedEntry.startTime)}" data-studio-schedule-field="startTime" data-studio-schedule-id="${escapeHtml(selectedEntry.id)}" /></label>
                  <label class="rs-field">日オフセット
                    <select data-studio-schedule-field="dayOffset" data-studio-schedule-id="${escapeHtml(selectedEntry.id)}">
                      <option value="-1" ${Number(selectedEntry.dayOffset || 0) === -1 ? "selected" : ""}>-1日 (前日)</option>
                      <option value="0" ${Number(selectedEntry.dayOffset || 0) === 0 ? "selected" : ""}>0日 (当日)</option>
                      <option value="1" ${Number(selectedEntry.dayOffset || 0) === 1 ? "selected" : ""}>+1日 (翌日)</option>
                    </select>
                  </label>
                  <label class="rs-field">分<input type="number" min="1" value="${Math.max(1, Number(selectedEntry.durationMinutes) || 1)}" data-studio-schedule-field="durationMinutes" data-studio-schedule-id="${escapeHtml(selectedEntry.id)}" /></label>
                </div>
              `;
                    })()
                  : ""
              }
              ${studio.lastApplyResult ? `<p class="small rs-apply-status">${escapeHtml(studio.lastApplyResult)}</p>` : ""}
            </section>
            <footer class="rs-schedule-actions">
              <button type="button" id="studio-save-schedule" class="rs-btn rs-btn-primary">定期予定を保存</button>
              <button type="button" id="studio-apply-today" class="rs-btn rs-btn-secondary" ${studio.scheduleEntries.length === 0 ? "disabled" : ""}>今日に適用</button>
            </footer>
          </aside>
  `;
}

function buildRoutineStudioSavedSchedulesPage(params: {
  studio: RoutineStudioState;
  savedScheduleGroups: RoutineScheduleGroupSummary[];
  escapeHtml: (value: unknown) => string;
}): string {
  const { studio, savedScheduleGroups, escapeHtml } = params;
  return `
        <section class="rs-saved-page">
          <header class="rs-saved-page-head">
            <div>
              <h3>登録済み定期予定</h3>
              <p class="small">保存済みの定期予定を一覧し、編集対象の選択や削除を行います。開始日・終了日は編集画面で変更して保存してください。</p>
            </div>
            <span class="rs-badge">${savedScheduleGroups.length}</span>
          </header>
          <div class="rs-saved-schedules-list rs-saved-schedules-list--page">
            ${
              savedScheduleGroups.length === 0
                ? `<section class="rs-empty-state"><p>まだ登録された定期予定はありません。</p><p class="small">定型予定化ページでスケジュールを保存すると、ここに表示されます。</p></section>`
                : savedScheduleGroups
                    .map(
                      (group) => `
              <article class="rs-saved-schedule-card ${group.groupId === studio.scheduleGroupId ? "is-active" : ""}">
                <div class="rs-saved-schedule-main">
                  <span class="rs-saved-schedule-name">${escapeHtml(group.name)}</span>
                  <span class="rs-saved-schedule-meta">${group.entryCount}件 / ${escapeHtml(scheduleRecurrenceLabelForRecurrence(group.recurrence))}</span>
                  <span class="rs-saved-schedule-period">${escapeHtml(group.recurrence.startDate || "開始日未設定")} - ${escapeHtml(group.recurrence.endDate || "終了日未設定")}</span>
                </div>
                <div class="rs-saved-schedule-actions">
                  <button type="button" class="rs-btn rs-btn-ghost" data-studio-saved-schedule-select="${escapeHtml(group.groupId)}">編集</button>
                  <button type="button" class="rs-btn rs-btn-danger" data-studio-saved-schedule-delete="${escapeHtml(group.groupId)}">削除</button>
                </div>
              </article>
            `,
                    )
                    .join("")
            }
          </div>
        </section>
  `;
}

export function buildRoutineStudioMarkup(params: BuildRoutineStudioMarkupParams): string {
  const { studio, folderAssets, allComplexModuleAssets, totalMinutes, routineStudioContexts, scheduleDayCalendarHtml, savedScheduleGroups, currentDraftScheduleValue, scheduleWindowStartMinutes, scheduleWindowDurationMinutes, showExtendedScheduleWindow, escapeHtml } = params;
  const selectedApplyTemplate = allComplexModuleAssets.find((asset) => asset.id === studio.scheduleGroupId);
  const scheduleTitle = selectedApplyTemplate?.name || studio.draftName;
  const availableFolders = studio.moduleFolders.length > 0 ? studio.moduleFolders : [{ id: ROUTINE_STUDIO_DEFAULT_FOLDER_ID, name: "" }];
  const canvasGroups = collectStudioEntryGroups(studio.canvasEntries);
  const editGroup = studio.entryEditorEntryId
    ? canvasGroups.find((group) => group.entries.some((entry) => String(entry.entryId || "") === studio.entryEditorEntryId))
    : null;
  return `
    <section class="routine-studio-root">
      <header class="routine-studio-toolbar">
        <div>
          <h2>Routine Studio</h2>
          <p>モジュールを選んで組み立て、ルーティンを作る。</p>
        </div>
        <div class="rs-toolbar-actions">
          <button type="button" id="studio-refresh-recipes" class="rs-btn rs-btn-secondary">アセット更新</button>
          <button type="button" id="studio-new-module" class="rs-btn rs-btn-secondary">モジュールを追加</button>
        </div>
      </header>
      <nav class="rs-subnav">
        <button type="button" class="rs-subnav-tab ${studio.subPage === "editor" ? "is-active" : ""}" data-studio-subpage="editor">ルーティン編集</button>
        <button type="button" class="rs-subnav-tab ${studio.subPage === "schedule" ? "is-active" : ""}" data-studio-subpage="schedule">定型予定化</button>
        <button type="button" class="rs-subnav-tab ${studio.subPage === "saved-schedules" ? "is-active" : ""}" data-studio-subpage="saved-schedules">登録済み定期予定</button>
      </nav>
      ${studio.subPage === "schedule" ? `
        <div class="rs-schedule-page rs-schedule-three-pane">
          <aside class="rs-schedule-left">
            <header class="rs-schedule-pane-head">
              <div>
                <h3>ルーティン編集</h3>
                <p class="small">フォルダ別のルーティン一覧から中央へドラッグして予定化します</p>
              </div>
            </header>
            ${buildRoutineStudioScheduleLeftMarkup({
              studio,
              folderAssets,
              escapeHtml,
            })}
          </aside>
          <div class="pane-splitter" data-pane-resize="rs-schedule-left" role="separator" aria-orientation="vertical" aria-label="Resize left panel" tabindex="0"></div>
          ${buildRoutineStudioScheduleCenterMarkup({
            studio,
            scheduleTitle,
            scheduleDayCalendarHtml,
            scheduleWindowStartMinutes,
            scheduleWindowDurationMinutes,
            showExtendedScheduleWindow,
            escapeHtml,
          })}
          <div class="pane-splitter" data-pane-resize="rs-schedule-right" role="separator" aria-orientation="vertical" aria-label="Resize right panel" tabindex="0"></div>
          ${buildRoutineStudioScheduleRightMarkup({
            studio,
            currentDraftScheduleValue,
            selectedApplyTemplate,
            allComplexModuleAssets,
            savedScheduleGroups,
            escapeHtml,
          })}
        </div>
      ` : studio.subPage === "saved-schedules" ? `
        ${buildRoutineStudioSavedSchedulesPage({
          studio,
          savedScheduleGroups,
          escapeHtml,
        })}
      ` : `
        ${buildRoutineStudioEditorWorkspace({
          studio,
          folderAssets,
          totalMinutes,
          routineStudioContexts,
          escapeHtml,
          canvasGroups,
        })}
      `}
      ${
        editGroup
          ? (() => {
              const editEntries = editGroup.entries;
              const editEntry = editEntries[0];
              if (!editEntry) return "";
              const groupTitle = editGroup.isGrouped ? editEntry.subtitle || editEntry.title : editEntry.title;
              return `
        <div class="rs-modal-overlay" id="entry-editor-overlay">
          <div class="rs-modal rs-modal--wide" role="dialog" aria-modal="true" aria-labelledby="entry-editor-title">
            <header class="rs-modal-head">
              <h4 class="rs-modal-title" id="entry-editor-title">${editGroup.isGrouped ? `複合モジュールを編集: ${escapeHtml(groupTitle)}` : `ステップ詳細設定: ${escapeHtml(editEntry.title)}`}</h4>
              <button type="button" class="rs-modal-close" id="studio-entry-editor-close" aria-label="閉じる">&#10005;</button>
            </header>
            <div class="${editGroup.isGrouped ? "rs-entry-stack" : "rs-entry-grid"}">
              ${editEntries
                .map((entry, stepIndex) => {
                  const eid = escapeHtml(entry.entryId);
                  return `
              <section class="${editGroup.isGrouped ? "rs-entry-step-card" : "rs-entry-grid"}">
                ${
                  editGroup.isGrouped
                    ? `<header class="rs-entry-step-head"><h5>${stepIndex + 1}. ${escapeHtml(entry.title || `Step ${stepIndex + 1}`)}</h5><span>${Math.max(1, Number(entry.durationMinutes) || 0)}m</span></header>`
                    : ""
                }
                <div class="rs-entry-grid">
                  <label class="rs-field">タイトル<input data-studio-entry-field="title" data-studio-entry-id="${eid}" value="${escapeHtml(entry.title)}" /></label>
                  <label class="rs-field">分<input data-studio-entry-field="durationMinutes" data-studio-entry-id="${eid}" type="number" min="1" value="${Math.max(
                    1,
                    Number(entry.durationMinutes) || 1,
                  )}" /></label>
                  <label class="rs-field">モジュール
                    <select data-studio-entry-field="moduleId" data-studio-entry-id="${eid}">
                      <option value="">なし</option>
                      ${studio.modules
                        .map((m) => `<option value="${escapeHtml(m.id)}" ${m.id === entry.moduleId ? "selected" : ""}>${escapeHtml(m.name)}</option>`)
                        .join("")}
                    </select>
                  </label>
                  <label class="rs-field rs-field-full">ノート
                    <textarea class="rs-textarea" data-studio-entry-field="note" data-studio-entry-id="${eid}">${escapeHtml(entry.note || "")}</textarea>
                  </label>
                </div>
              </section>
            `;
                })
                .join("")}
            </div>
            <div class="rs-modal-actions">
              <button type="button" id="studio-entry-editor-close-btn" class="rs-btn rs-btn-primary">閉じる</button>
            </div>
          </div>
        </div>
        `;
            })()
          : ""
      }
      ${
        studio.moduleEditor
          ? (() => {
              const moduleEditor = studio.moduleEditor;
              return `
        <div class="rs-modal-overlay" id="module-editor-overlay">
          <div class="rs-modal" role="dialog" aria-modal="true">
            <header class="rs-modal-head">
              <h4 class="rs-modal-title">${studio.editingModuleId ? "モジュールを編集" : "新規モジュール"}</h4>
            </header>
            <div class="rs-inline-fields">
              <label class="rs-field">ID<input id="studio-module-id" value="${escapeHtml(moduleEditor.id)}" ${studio.editingModuleId ? "disabled" : ""} /></label>
              <label class="rs-field">名前<input id="studio-module-name" value="${escapeHtml(moduleEditor.name)}" /></label>
            </div>
            <div class="rs-inline-fields">
              <label class="rs-field">フォルダー
                <select id="studio-module-category">
                  ${availableFolders
                    .map(
                      (folder) =>
                        `<option value="${escapeHtml(folder.id)}" ${folder.id === moduleEditor.category ? "selected" : ""}>${escapeHtml(routineStudioFolderLabel(folder))}</option>`,
                    )
                    .join("")}
                </select>
              </label>
              <label class="rs-field">分<input id="studio-module-duration" type="number" min="1" value="${Math.max(
                1,
                Number(moduleEditor.durationMinutes) || 1,
              )}" /></label>
            </div>
            <label class="rs-field">説明<input id="studio-module-description" value="${escapeHtml(moduleEditor.description)}" /></label>
            <label class="rs-field">アイコン<input id="studio-module-icon" value="${escapeHtml(moduleEditor.icon)}" /></label>
            <div class="rs-modal-actions">
              <button type="button" id="studio-module-save" class="rs-btn rs-btn-primary">保存</button>
              <button type="button" id="studio-module-cancel" class="rs-btn rs-btn-ghost">キャンセル</button>
            </div>
          </div>
        </div>
      `;
            })()
          : ""
      }
    </section>
  `;
}
