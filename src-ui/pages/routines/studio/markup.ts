import type { RoutineStudioState } from "../../../types.js";
import type { RoutineStudioModuleView } from "../model.js";

type BuildRoutineStudioMarkupParams = {
  studio: RoutineStudioState;
  moduleAssets: RoutineStudioModuleView[];
  complexModuleAssets: Array<{ id: string; name: string; stepCount: number; totalMinutes: number }>;
  totalMinutes: number;
  routineStudioContexts: string[];
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

export function buildRoutineStudioMarkup(params: BuildRoutineStudioMarkupParams): string {
  const { studio, moduleAssets, complexModuleAssets, totalMinutes, routineStudioContexts, escapeHtml } = params;
  const selectedApplyTemplate = complexModuleAssets.find((asset) => asset.id === studio.applyTemplateId);
  const scheduleTitle = selectedApplyTemplate?.name || studio.draftName;
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
      </nav>
      ${studio.subPage === "schedule" ? `
        <div class="rs-schedule-page">
          <section class="rs-schedule-props">
            <h3 class="rs-schedule-title">${escapeHtml(scheduleTitle)}</h3>
            <p class="small">保存済みのルーティンを選んで今日のスケジュールに適用します。</p>
            <label class="rs-field">保存済みルーティン
              <select id="studio-apply-template">
                <option value="">選択してください</option>
                ${complexModuleAssets
                  .map(
                    (cm) =>
                      `<option value="${escapeHtml(cm.id)}" ${cm.id === studio.applyTemplateId ? "selected" : ""}>${escapeHtml(cm.name)} (${cm.stepCount} steps)</option>`,
                  )
                  .join("")}
              </select>
            </label>
            <label class="rs-field">開始時刻<input id="studio-trigger-time" type="time" value="${escapeHtml(studio.triggerTime)}" /></label>
            ${studio.lastApplyResult ? `<p class="small rs-apply-status">${escapeHtml(studio.lastApplyResult)}</p>` : ""}
          </section>
          <footer class="rs-schedule-actions">
            <button type="button" id="studio-apply-today" class="rs-btn rs-btn-primary" ${complexModuleAssets.length === 0 ? "disabled" : ""}>今日に適用</button>
          </footer>
        </div>
      ` : `
        <div class="routine-studio-layout">
          <aside class="rs-library">
            <div class="rs-search-wrap">
              <input id="studio-search-input" type="search" placeholder="モジュールを検索..." value="${escapeHtml(studio.search)}" />
            </div>
            <div class="rs-assets">
              ${(() => {
                const grouped = moduleAssets.reduce((acc: Record<string, RoutineStudioModuleView[]>, m) => {
                  const cat = String(m.category || "General");
                  if (!acc[cat]) acc[cat] = [];
                  acc[cat].push(m);
                  return acc;
                }, {});
                const cats = Object.keys(grouped).sort((a, b) => a.localeCompare(b));
                const modParts =
                  cats.length === 0
                    ? ""
                    : cats
                        .map(
                          (cat) => `
                  <section class="rs-asset-group" data-studio-asset-group>
                    <h4 class="rs-asset-group-title">${escapeHtml(cat)}</h4>
                    ${(grouped[cat] || [])
                      .map(
                        (module) => `
                      <article class="rs-asset-card" data-studio-draggable="true" data-studio-asset-kind="module" data-studio-asset-id="${escapeHtml(module.id)}" data-studio-search-text="${escapeHtml(`${module.name} ${module.description || ""} ${module.category || ""}`)}">
                        <div class="rs-asset-head">
                          <p class="rs-asset-title">${escapeHtml(module.name)}</p>
                          <span class="rs-asset-duration">${module.durationMinutes}m</span>
                        </div>
                        <p class="rs-asset-subtitle">${escapeHtml(module.description || "")}</p>
                        <div class="rs-asset-actions">
                          <button type="button" class="rs-btn rs-btn-secondary" data-studio-insert-kind="module" data-studio-insert-id="${escapeHtml(module.id)}">追加</button>
                          <button type="button" class="rs-icon-btn" title="編集" data-studio-module-edit="${escapeHtml(module.id)}">&#9998;</button>
                          <button type="button" class="rs-icon-btn is-danger" title="削除" data-studio-module-delete="${escapeHtml(module.id)}">&#10005;</button>
                        </div>
                      </article>
                    `,
                      )
                      .join("")}
                  </section>
                `,
                        )
                        .join("");
                const cmParts =
                  complexModuleAssets.length === 0
                    ? ""
                    : `
                  <section class="rs-asset-group" data-studio-asset-group>
                    <h4 class="rs-asset-group-title">複合モジュール</h4>
                    ${complexModuleAssets
                      .map(
                        (cm) => `
                      <article class="rs-asset-card" data-studio-draggable="true" data-studio-asset-kind="template" data-studio-asset-id="${escapeHtml(cm.id)}" data-studio-search-text="${escapeHtml(`${cm.name} ${cm.stepCount} ${cm.totalMinutes}`)}">
                        <div class="rs-asset-head">
                          <p class="rs-asset-title">${escapeHtml(cm.name)}<span class="rs-badge">複合</span></p>
                          <span class="rs-asset-duration">${cm.totalMinutes}m</span>
                        </div>
                        <p class="rs-asset-subtitle">${cm.stepCount} ステップ</p>
                        <div class="rs-asset-actions">
                          <button type="button" class="rs-btn rs-btn-secondary" data-studio-insert-kind="template" data-studio-insert-id="${escapeHtml(cm.id)}">追加</button>
                          <button type="button" class="rs-btn rs-btn-ghost" data-studio-load-template="${escapeHtml(cm.id)}">読込</button>
                          <button type="button" class="rs-icon-btn is-danger" title="削除" data-studio-recipe-delete="${escapeHtml(cm.id)}">&#10005;</button>
                        </div>
                      </article>
                    `,
                      )
                      .join("")}
                  </section>
                `;
                const emptyState = '<p class="small" id="studio-assets-empty" hidden>モジュールが見つかりません。</p>';
                if (!modParts && !cmParts) return '<p class="small" id="studio-assets-empty">モジュールが見つかりません。</p>';
                return modParts + cmParts + emptyState;
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
                    : studio.canvasEntries
                        .map(
                          (entry, index) => `
                    <article class="rs-canvas-card ${studio.selectedEntryId === entry.entryId ? "is-selected" : ""}" data-studio-entry-id="${escapeHtml(entry.entryId)}" draggable="true" data-studio-canvas-entry="${escapeHtml(entry.entryId)}">
                      <header class="rs-canvas-card-head">
                        <span class="rs-drag-handle" aria-hidden="true" title="ドラッグして並び順を変更">&#x2807;</span>
                        <button type="button" class="rs-canvas-index" data-studio-select-entry="${escapeHtml(entry.entryId)}">${index + 1}</button>
                        <div class="rs-canvas-meta">
                          <p class="rs-canvas-title">${escapeHtml(entry.title || `Step ${index + 1}`)}</p>
                          <p class="rs-canvas-subtitle">${escapeHtml(entry.subtitle || "")}</p>
                        </div>
                        <span class="rs-canvas-duration">${Math.max(1, Number(entry.durationMinutes) || 0)}m</span>
                        <div class="rs-canvas-actions">
                          <button type="button" class="rs-icon-btn" data-studio-move="${escapeHtml(entry.entryId)}" data-studio-dir="up" ${index === 0 ? "disabled" : ""}>↑</button>
                          <button type="button" class="rs-icon-btn" data-studio-move="${escapeHtml(entry.entryId)}" data-studio-dir="down" ${index === studio.canvasEntries.length - 1 ? "disabled" : ""}>↓</button>
                          <button type="button" class="rs-icon-btn is-danger" data-studio-remove="${escapeHtml(entry.entryId)}">×</button>
                          <button type="button" class="rs-icon-btn" title="詳細設定" data-studio-entry-settings="${escapeHtml(entry.entryId)}">&#9881;</button>
                        </div>
                      </header>
                    </article>
                  `,
                        )
                        .join('<div class="rs-canvas-connector" aria-hidden="true"></div>')
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
      `}
      ${
        studio.entryEditorEntryId
          ? (() => {
              const editEntry = studio.canvasEntries.find((e) => String(e.entryId || "") === studio.entryEditorEntryId);
              if (!editEntry) return "";
              const eid = escapeHtml(editEntry.entryId);
              return `
        <div class="rs-modal-overlay" id="entry-editor-overlay">
          <div class="rs-modal rs-modal--wide" role="dialog" aria-modal="true" aria-labelledby="entry-editor-title">
            <header class="rs-modal-head">
              <h4 class="rs-modal-title" id="entry-editor-title">ステップ詳細設定: ${escapeHtml(editEntry.title)}</h4>
              <button type="button" class="rs-modal-close" id="studio-entry-editor-close" aria-label="閉じる">&#10005;</button>
            </header>
            <div class="rs-entry-grid">
              <label class="rs-field">タイトル<input data-studio-entry-field="title" data-studio-entry-id="${eid}" value="${escapeHtml(editEntry.title)}" /></label>
              <label class="rs-field">分<input data-studio-entry-field="durationMinutes" data-studio-entry-id="${eid}" type="number" min="1" value="${Math.max(
                1,
                Number(editEntry.durationMinutes) || 1,
              )}" /></label>
              <label class="rs-field">モジュール
                <select data-studio-entry-field="moduleId" data-studio-entry-id="${eid}">
                  <option value="">なし</option>
                  ${studio.modules
                    .map((m) => `<option value="${escapeHtml(m.id)}" ${m.id === editEntry.moduleId ? "selected" : ""}>${escapeHtml(m.name)}</option>`)
                    .join("")}
                </select>
              </label>
              <label class="rs-field rs-field-full">ノート
                <textarea class="rs-textarea" data-studio-entry-field="note" data-studio-entry-id="${eid}">${escapeHtml(editEntry.note || "")}</textarea>
              </label>
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
          ? `
        <div class="rs-modal-overlay" id="module-editor-overlay">
          <div class="rs-modal" role="dialog" aria-modal="true">
            <header class="rs-modal-head">
              <h4 class="rs-modal-title">${studio.editingModuleId ? "モジュールを編集" : "新規モジュール"}</h4>
            </header>
            <div class="rs-inline-fields">
              <label class="rs-field">ID<input id="studio-module-id" value="${escapeHtml(studio.moduleEditor.id)}" ${studio.editingModuleId ? "disabled" : ""} /></label>
              <label class="rs-field">名前<input id="studio-module-name" value="${escapeHtml(studio.moduleEditor.name)}" /></label>
            </div>
            <div class="rs-inline-fields">
              <label class="rs-field">カテゴリ<input id="studio-module-category" value="${escapeHtml(studio.moduleEditor.category)}" /></label>
              <label class="rs-field">分<input id="studio-module-duration" type="number" min="1" value="${Math.max(
                1,
                Number(studio.moduleEditor.durationMinutes) || 1,
              )}" /></label>
            </div>
            <label class="rs-field">説明<input id="studio-module-description" value="${escapeHtml(studio.moduleEditor.description)}" /></label>
            <label class="rs-field">アイコン<input id="studio-module-icon" value="${escapeHtml(studio.moduleEditor.icon)}" /></label>
            <div class="rs-modal-actions">
              <button type="button" id="studio-module-save" class="rs-btn rs-btn-primary">保存</button>
              <button type="button" id="studio-module-cancel" class="rs-btn rs-btn-ghost">キャンセル</button>
            </div>
          </div>
        </div>
      `
          : ""
      }
    </section>
  `;
}
