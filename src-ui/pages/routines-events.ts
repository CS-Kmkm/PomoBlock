import type { Module, PageRenderDeps } from "../types.js";
import { resolveDropInsertIndex as resolveDropInsertIndexBase } from "./routines-dnd.js";
import {
  cloneValue,
  isRoutineStudioRecipe,
  nextRoutineStudioEntryId,
  routineStudioContexts,
  routineStudioMacroTargets,
  routineStudioSeedModules,
  routineStudioSlug,
  routineStudioStepDurationMinutes,
  type RoutineStudioEntryView,
  type RoutineStudioModuleView,
} from "./routines-model.js";
import { bindRoutineStudioPointerDnd } from "./routines-pointer-dnd.js";
import { renderRoutinesMarkup } from "./routines-view.js";


export function renderRoutinesEvents(deps: PageRenderDeps): void {
  const { uiState, appRoot, services, setStatus } = deps;
  const helpers = {
    ...deps.commonHelpers,
    ...deps.calendarHelpers,
    ...deps.nowHelpers,
    ...deps.routineHelpers,
    ...deps.taskHelpers,
  };
  const safeInvoke = services.safeInvoke.bind(services);
  const runUiAction = services.runUiAction.bind(services);
  const refreshCoreData = deps.refreshCoreData;
  const withAccount = helpers.withAccount;
  const isoDate = helpers.isoDate;
  const formatHHmm = helpers.formatHHmm;
  const escapeHtml = helpers.escapeHtml;
  const renderRoutines = () => renderRoutinesEvents(deps);
    const recipes = Array.isArray(uiState.recipes) ? uiState.recipes : [];
    const studio = uiState.routineStudio;
    studio.assetsLoaded = Boolean(studio.assetsLoaded);
    studio.assetsLoading = Boolean(studio.assetsLoading);
    studio.subPage = ["editor", "schedule"].includes(studio.subPage) ? studio.subPage : "editor";
    studio.search = typeof studio.search === "string" ? studio.search : "";
    studio.draftName =
        typeof studio.draftName === "string" && studio.draftName.trim() ? studio.draftName : "Routine Draft";
    studio.templateId =
        typeof studio.templateId === "string" && studio.templateId.trim()
            ? studio.templateId
            : `rcp-${routineStudioSlug(studio.draftName) || "routine-studio"}`;
    studio.triggerTime =
        typeof studio.triggerTime === "string" && /^\d{2}:\d{2}$/.test(studio.triggerTime) ? studio.triggerTime : "09:00";
    studio.context =
        typeof studio.context === "string" && studio.context.trim() ? studio.context : (routineStudioContexts[0] || "Work - Deep Focus");
    studio.autoStart = Boolean(studio.autoStart);
    studio.modules = Array.isArray(studio.modules) ? studio.modules : [];
    studio.canvasEntries = Array.isArray(studio.canvasEntries) ? studio.canvasEntries : [];
    studio.history = Array.isArray(studio.history) ? studio.history : [];
    studio.historyIndex = Number.isInteger(studio.historyIndex) ? studio.historyIndex : -1;
    studio.dragInsertIndex = Number.isInteger(studio.dragInsertIndex) ? studio.dragInsertIndex : -1;
    studio.selectedEntryId = typeof studio.selectedEntryId === "string" ? studio.selectedEntryId : "";
    studio.lastApplyResult = typeof studio.lastApplyResult === "string" ? studio.lastApplyResult : "";
    studio.moduleEditor = studio.moduleEditor && typeof studio.moduleEditor === "object" ? studio.moduleEditor : null;
    studio.editingModuleId = typeof studio.editingModuleId === "string" ? studio.editingModuleId : "";
    studio.entryEditorEntryId = typeof studio.entryEditorEntryId === "string" ? studio.entryEditorEntryId : "";
    const normalizeModule = (module: unknown, index: number): RoutineStudioModuleView => {
        const source = (module ?? {}) as Record<string, unknown>;
        const id = String(source.id || `mod-${index + 1}`).trim() || `mod-${index + 1}`;
        const durationMinutes = Math.max(1, Number(source.durationMinutes || source.duration_minutes || 1));
        return {
            id,
            name: String(source.name || id),
            category: String(source.category || "General"),
            description: String(source.description || ""),
            icon: String(source.icon || "module"),
            durationMinutes,
        };
    };
    const normalizeEntry = (entry: unknown, index: number): RoutineStudioEntryView => {
        const source = (entry ?? {}) as Record<string, unknown>;
        const durationMinutes = Math.max(1, Number(source.durationMinutes || source.duration_minutes || 5));
        return {
            entryId: String(source.entryId || nextRoutineStudioEntryId()),
            sourceKind: String(source.sourceKind || source.source_kind || "module"),
            sourceId: String(source.sourceId || source.source_id || ""),
            moduleId: String(source.moduleId || source.module_id || ""),
            title: String(source.title || `Step ${index + 1}`),
            subtitle: String(source.subtitle || ""),
            durationMinutes,
            note: String(source.note || ""),
        };
    };
    const normalizeModuleEditor = (editor: unknown): RoutineStudioModuleView => {
        const source = (editor ?? {}) as Record<string, unknown>;
        return {
            id: String(source.id || ""),
            name: String(source.name || ""),
            category: String(source.category || "General"),
            description: String(source.description || ""),
            icon: String(source.icon || "module"),
            durationMinutes: Math.max(1, Number(source.durationMinutes || source.duration_minutes || 5)),
        };
    };
    const toEntryRecords = (entries: RoutineStudioEntryView[]): Array<Record<string, unknown>> =>
        entries.map((entry) => ({ ...entry }));
    const readEntryId = (entry: Record<string, unknown> | undefined): string => String(entry?.entryId || "");
    const createEmptyModuleEditor = () => normalizeModuleEditor({
        id: "",
        name: "",
        category: "General",
        description: "",
        icon: "module",
        durationMinutes: 5,
    });
    studio.modules = studio.modules.map(normalizeModule);
    studio.canvasEntries = toEntryRecords(studio.canvasEntries.map((entry, index) => normalizeEntry(entry, index)));
    studio.moduleEditor = studio.moduleEditor ? normalizeModuleEditor(studio.moduleEditor) : null;
    if (!studio.assetsLoaded) {
        renderRoutinesMarkup(appRoot, `
      <section class="routine-studio-root">
        <header class="routine-studio-toolbar">
          <div>
            <h2>Routine Studio</h2>
            <p>モジュールを読み込み中...</p>
          </div>
        </header>
      </section>
    `);
        if (!studio.assetsLoading) {
            studio.assetsLoading = true;
            runUiAction(async () => {
                const [recipesResult, modulesResult] = await Promise.all([
                    safeInvoke("list_recipes", {}),
                    safeInvoke("list_modules", {}).catch(() => cloneValue(routineStudioSeedModules)),
                ]);
                uiState.recipes = Array.isArray(recipesResult) ? recipesResult : [];
                studio.modules = Array.isArray(modulesResult) ? modulesResult.map(normalizeModule) : [];
                studio.assetsLoaded = true;
                studio.assetsLoading = false;
                renderRoutines();
            });
        }
        return;
    }
    const moduleToEntry = (module: Module): RoutineStudioEntryView => normalizeEntry({
        sourceKind: "module",
        sourceId: module.id,
        moduleId: module.id,
        title: String(module.name || module.id),
        subtitle: String(module.description || module.category || ""),
        durationMinutes: Math.max(1, Number(module.durationMinutes || 0) || 5),
        note: "",
    }, 0);
    const recipeToEntries = (recipe: unknown): RoutineStudioEntryView[] => {
        const source = (recipe ?? {}) as Record<string, unknown>;
        const steps = Array.isArray(source.steps) ? source.steps : [];
        if (steps.length === 0) {
            return [
                normalizeEntry({
                    sourceKind: "template",
                    sourceId: source.id || "",
                    title: source.name || source.id || "ステップ",
                    subtitle: "複合モジュール",
                    durationMinutes: 5,
                    note: "",
                }, 0),
            ];
        }
        return steps.map((step, index) => normalizeEntry({
            sourceKind: "template",
            sourceId: source.id || "",
            moduleId: String((step as Record<string, unknown>)?.moduleId || (step as Record<string, unknown>)?.module_id || ""),
            title: String((step as Record<string, unknown>)?.title || `Step ${index + 1}`),
            subtitle: source.name || source.id || "複合モジュール",
            durationMinutes: routineStudioStepDurationMinutes(step),
            note: String((step as Record<string, unknown>)?.note || ""),
        }, index));
    };
    const syncFromRecipe = (recipe: unknown) => {
        if (!recipe)
            return;
        const source = recipe as Record<string, unknown>;
        const autoDriveMode = String(source.auto_drive_mode || source.autoDriveMode || "manual");
        studio.templateId = String(source.id || studio.templateId);
        studio.draftName = String(source.name || source.id || studio.draftName);
        studio.autoStart = autoDriveMode !== "manual";
    };
    if (!studio.bootstrapped) {
        const studioRecipes = recipes.filter((recipe) => isRoutineStudioRecipe(recipe));
        if (studioRecipes.length > 0) {
            syncFromRecipe(studioRecipes[0]);
            studio.canvasEntries = recipeToEntries(studioRecipes[0]);
        }
        else {
            studio.canvasEntries = studio.modules.slice(0, 3).map(moduleToEntry);
        }
        studio.bootstrapped = true;
        studio.history = [cloneValue(studio.canvasEntries)];
        studio.historyIndex = 0;
        studio.selectedEntryId = String((studio.canvasEntries[0] as Record<string, unknown> | undefined)?.entryId || "");
    }
    if (studio.history.length === 0) {
        studio.history = [cloneValue(studio.canvasEntries)];
        studio.historyIndex = 0;
    }
    if (studio.historyIndex < 0 || studio.historyIndex >= studio.history.length) {
        studio.historyIndex = studio.history.length - 1;
    }
    if (!studio.selectedEntryId && studio.canvasEntries.length > 0) {
        studio.selectedEntryId = String((studio.canvasEntries[0] as Record<string, unknown> | undefined)?.entryId || "");
    }
    const addAssetToCanvas = (kind: string, id: string, replace = false, insertIndex: number = studio.canvasEntries.length) => {
        if (!id)
            return false;
        const clampedInsertIndex = Math.max(0, Math.min(Number(insertIndex) || 0, studio.canvasEntries.length));
        if (kind === "module") {
            const module = studio.modules.find((candidate) => candidate.id === id);
            if (!module)
                return false;
            const next = moduleToEntry(module);
            if (replace) {
                applyCanvasEntries([next], true);
            }
            else {
                const nextEntries = [...studio.canvasEntries];
                nextEntries.splice(clampedInsertIndex, 0, { ...next });
                applyCanvasEntries(nextEntries, true);
            }
            studio.selectedEntryId = next.entryId;
            return true;
        }
        if (kind === "template") {
            const recipe = recipes.find((candidate) => candidate.id === id && isRoutineStudioRecipe(candidate));
            if (!recipe)
                return false;
            const entries = recipeToEntries(recipe);
            if (replace) {
                applyCanvasEntries(entries, true);
            }
            else {
                const nextEntries = [...studio.canvasEntries];
                nextEntries.splice(clampedInsertIndex, 0, ...entries);
                applyCanvasEntries(nextEntries, true);
            }
            syncFromRecipe(recipe);
            studio.selectedEntryId = entries[0]?.entryId || studio.selectedEntryId;
            return true;
        }
        return false;
    };
    const pushHistory = () => {
        const snapshot = cloneValue(studio.canvasEntries.map((entry, index) => normalizeEntry(entry, index)));
        const current = studio.historyIndex >= 0 && studio.historyIndex < studio.history.length
            ? studio.history[studio.historyIndex]
            : null;
        if (current && JSON.stringify(current) === JSON.stringify(snapshot)) {
            return;
        }
        const truncated = studio.history.slice(0, studio.historyIndex + 1);
        truncated.push(snapshot);
        if (truncated.length > 50) {
            truncated.shift();
        }
        studio.history = truncated;
        studio.historyIndex = studio.history.length - 1;
    };
    const applyCanvasEntries = (nextEntries: unknown, recordHistory = true) => {
        const normalizedEntries = (Array.isArray(nextEntries) ? nextEntries : []).map((entry, index) => normalizeEntry(entry, index));
        studio.canvasEntries = toEntryRecords(normalizedEntries);
        if (studio.canvasEntries.length > 0 && !studio.selectedEntryId) {
            studio.selectedEntryId = readEntryId(studio.canvasEntries[0]);
        }
        if (studio.selectedEntryId &&
            studio.canvasEntries.every((entry) => String((entry as Record<string, unknown>).entryId || "") !== studio.selectedEntryId)) {
            studio.selectedEntryId = readEntryId(studio.canvasEntries[0]);
        }
        if (recordHistory) {
            pushHistory();
        }
    };
    const searchNeedle = studio.search.trim().toLowerCase();
    const moduleAssets = studio.modules.map((module, index) => normalizeModule(module, index)).filter((module) => {
        if (!searchNeedle)
            return true;
        return `${module.name} ${module.description} ${module.category}`.toLowerCase().includes(searchNeedle);
    });
    const complexModuleAssets = recipes
        .filter((recipe) => isRoutineStudioRecipe(recipe))
        .map((recipe) => {
        const steps = Array.isArray(recipe?.steps) ? recipe.steps : [];
        const totalMinutes = steps.reduce((sum, step) => sum + routineStudioStepDurationMinutes(step), 0);
        return {
            id: String(recipe.id || ""),
            name: String(recipe.name || recipe.id || "Untitled"),
            stepCount: steps.length,
            totalMinutes,
        };
    })
        .filter((cm) => {
        if (!searchNeedle)
            return true;
        return cm.name.toLowerCase().includes(searchNeedle);
    });
    const totalMinutes = studio.canvasEntries.reduce((sum, entry) => sum + (Number((entry as Record<string, unknown>).durationMinutes) || 0), 0);
    renderRoutinesMarkup(appRoot, `
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
            <h3 class="rs-schedule-title">${escapeHtml(studio.draftName)}</h3>
            <p class="small">保存済みのルーティンを今日のスケジュールに適用します。</p>
            <label class="rs-field">開始時刻<input id="studio-trigger-time" type="time" value="${escapeHtml(studio.triggerTime)}" /></label>
            ${studio.lastApplyResult ? `<p class="small rs-apply-status">${escapeHtml(studio.lastApplyResult)}</p>` : ""}
          </section>
          <footer class="rs-schedule-actions">
            <button type="button" id="studio-apply-today" class="rs-btn rs-btn-primary">今日に適用</button>
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
            if (!acc[cat])
                acc[cat] = [];
            acc[cat].push(m);
            return acc;
        }, {});
        const cats = Object.keys(grouped).sort((a, b) => a.localeCompare(b));
        const modParts = cats.length === 0 ? "" : cats.map((cat) => `
                  <section class="rs-asset-group">
                    <h4 class="rs-asset-group-title">${escapeHtml(cat)}</h4>
                    ${(grouped[cat] || []).map((module) => `
                      <article class="rs-asset-card" data-studio-draggable="true" data-studio-asset-kind="module" data-studio-asset-id="${escapeHtml(module.id)}">
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
                    `).join("")}
                  </section>
                `).join("");
        const cmParts = complexModuleAssets.length === 0 ? "" : `
                  <section class="rs-asset-group">
                    <h4 class="rs-asset-group-title">複合モジュール</h4>
                    ${complexModuleAssets.map((cm) => `
                      <article class="rs-asset-card" data-studio-draggable="true" data-studio-asset-kind="template" data-studio-asset-id="${escapeHtml(cm.id)}">
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
                    `).join("")}
                  </section>
                `;
        if (!modParts && !cmParts)
            return '<p class="small">モジュールが見つかりません。</p>';
        return modParts + cmParts;
    })()}
            </div>
          </aside>
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
                ${studio.canvasEntries.length === 0
        ? '<div class="rs-drop-empty"><p class="rs-drop-empty-title">モジュールをドラッグ</p><p class="small">追加ボタンからも追加できます</p></div>'
        : studio.canvasEntries
            .map((entry, index) => `
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
                  `)
            .join('<div class="rs-canvas-connector" aria-hidden="true"></div>')}
              </div>
            </div>
          </section>
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
                <label class="rs-field rs-toggle" for="studio-auto-start"><span>タイマー自動開始</span><input id="studio-auto-start" type="checkbox" ${studio.autoStart ? "checked" : ""} /></label>
              </details>
            </div>
            <footer class="rs-intel-actions">
              <button type="button" id="studio-save-template" class="rs-btn rs-btn-primary">保存</button>
              <button type="button" id="studio-clear-canvas" class="rs-btn rs-btn-ghost">キャンバスをリセット</button>
            </footer>
          </aside>
        </div>
      `}
      ${studio.entryEditorEntryId ? (() => {
        const editEntry = studio.canvasEntries.find((e) => String((e as Record<string, unknown>).entryId || "") === studio.entryEditorEntryId);
        if (!editEntry)
            return "";
        const eid = escapeHtml(editEntry.entryId);
        return `
        <div class="rs-modal-overlay" id="entry-editor-overlay">
          <div class="rs-modal rs-modal--wide" role="dialog" aria-modal="true" aria-labelledby="entry-editor-title">
            <header class="rs-modal-head">
              <h4 class="rs-modal-title" id="entry-editor-title">ステップ詳細設定 ? ${escapeHtml(editEntry.title)}</h4>
              <button type="button" class="rs-modal-close" id="studio-entry-editor-close" aria-label="閉じる">&#10005;</button>
            </header>
            <div class="rs-entry-grid">
              <label class="rs-field">タイトル<input data-studio-entry-field="title" data-studio-entry-id="${eid}" value="${escapeHtml(editEntry.title)}" /></label>
              <label class="rs-field">分<input data-studio-entry-field="durationMinutes" data-studio-entry-id="${eid}" type="number" min="1" value="${Math.max(1, Number(editEntry.durationMinutes) || 1)}" /></label>
              <label class="rs-field">モジュール
                <select data-studio-entry-field="moduleId" data-studio-entry-id="${eid}">
                  <option value="">なし</option>
                  ${studio.modules.map((m) => `<option value="${escapeHtml(m.id)}" ${m.id === editEntry.moduleId ? "selected" : ""}>${escapeHtml(m.name)}</option>`).join("")}
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
    })() : ""}
      ${studio.moduleEditor ? `
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
              <label class="rs-field">分<input id="studio-module-duration" type="number" min="1" value="${Math.max(1, Number(studio.moduleEditor.durationMinutes) || 1)}" /></label>
            </div>
            <label class="rs-field">説明<input id="studio-module-description" value="${escapeHtml(studio.moduleEditor.description)}" /></label>
            <label class="rs-field">アイコン<input id="studio-module-icon" value="${escapeHtml(studio.moduleEditor.icon)}" /></label>
            <div class="rs-modal-actions">
              <button type="button" id="studio-module-save" class="rs-btn rs-btn-primary">保存</button>
              <button type="button" id="studio-module-cancel" class="rs-btn rs-btn-ghost">キャンセル</button>
            </div>
          </div>
        </div>
      ` : ""}
    </section>
  `);
    const rerender = () => renderRoutines();
    const buildRecipePayload = () => {
        if (studio.canvasEntries.length === 0) {
            throw new Error("キャンバスが空です。モジュールを追加してください。");
        }
        const name = studio.draftName.trim() || "Routine Draft";
        const slugBase = routineStudioSlug(studio.templateId || name) || "routine-studio";
        const id = slugBase.startsWith("rcp-") ? slugBase : `rcp-${slugBase}`;
        studio.templateId = id;
        const steps = studio.canvasEntries.map((entry, index) => {
            const durationSeconds = Math.max(60, Math.round((Number(entry.durationMinutes) || 1) * 60));
            const step: Record<string, unknown> = {
                id: `step-${index + 1}`,
                type: "micro",
                title: String(entry.title || `Step ${index + 1}`),
                durationSeconds,
            };
            const moduleId = String(entry.moduleId || "").trim();
            if (moduleId) {
                step.moduleId = moduleId;
            }
            const note = String(entry.note || "").trim();
            if (note) {
                step.note = note;
            }
            return step;
        });
        return {
            id,
            name,
            autoDriveMode: studio.autoStart ? "auto" : "manual",
            studioMeta: {
                version: 1,
                kind: "routine_studio",
            },
            steps,
        };
    };
    const persistTemplate = async () => {
        const payload = buildRecipePayload();
        const exists = recipes.some((recipe) => String((recipe as Record<string, unknown>).id || "") === payload.id);
        if (exists) {
            await safeInvoke("update_recipe", { recipe_id: payload.id, payload });
        }
        else {
            await safeInvoke("create_recipe", { payload });
        }
        uiState.recipes = (await safeInvoke("list_recipes", {})) as typeof uiState.recipes;
        studio.templateId = payload.id;
        studio.draftName = payload.name;
        return payload.id;
    };
    const readField = (id: string) =>
        (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null)?.value || "";
    const readChecked = (id: string) => Boolean((document.getElementById(id) as HTMLInputElement | null)?.checked);
    const openModuleEditor = (module: Module | null) => {
        if (!module) {
            studio.editingModuleId = "";
            studio.moduleEditor = createEmptyModuleEditor();
            return;
        }
        studio.editingModuleId = module.id;
        studio.moduleEditor = normalizeModuleEditor({ ...module });
    };
    const updateEntry = (entryId: string, updater: (entry: RoutineStudioEntryView) => RoutineStudioEntryView) => {
        const index = studio.canvasEntries.findIndex((entry) => String((entry as Record<string, unknown>).entryId || "") === entryId);
        if (index < 0)
            return false;
        const nextEntries = [...studio.canvasEntries].map((entry, i) => normalizeEntry(entry, i));
        const draft = normalizeEntry(nextEntries[index], index);
        nextEntries[index] = normalizeEntry(updater(draft) || draft, index);
        applyCanvasEntries(nextEntries, true);
        studio.selectedEntryId = entryId;
        return true;
    };
    const resolveDropInsertIndex = (dropzone: HTMLElement, clientY: number) => {
        return resolveDropInsertIndexBase(dropzone, clientY);
    };
    const clearDropIndicator = (dropzone: HTMLElement) => {
        dropzone.classList.remove("is-over", "is-insert-end");
        dropzone.querySelectorAll(".is-insert-target").forEach((node) => (node as HTMLElement).classList.remove("is-insert-target"));
        studio.dragInsertIndex = -1;
    };
    const paintDropIndicator = (dropzone: HTMLElement, insertIndex: number) => {
        clearDropIndicator(dropzone);
        const cards = Array.from(dropzone.querySelectorAll(".rs-canvas-card")) as HTMLElement[];
        dropzone.classList.add("is-over");
        if (cards.length === 0) {
            // 空キャンバス: 末尾挿入として扱う
            studio.dragInsertIndex = 0;
            return;
        }
        if (insertIndex >= cards.length) {
            dropzone.classList.add("is-insert-end");
            studio.dragInsertIndex = cards.length;
            return;
        }
        if (insertIndex >= 0 && insertIndex < cards.length) {
            const targetCard = cards[insertIndex];
            if (targetCard) {
                targetCard.classList.add("is-insert-target");
            }
            studio.dragInsertIndex = insertIndex;
            return;
        }
        studio.dragInsertIndex = cards.length;
    };
    document.getElementById("studio-refresh-recipes")?.addEventListener("click", async () => {
        await runUiAction(async () => {
            const [recipesResult, modulesResult] = await Promise.all([
                safeInvoke("list_recipes", {}),
                safeInvoke("list_modules", {}).catch(() => cloneValue(routineStudioSeedModules)),
            ]);
            uiState.recipes = Array.isArray(recipesResult) ? recipesResult : [];
            studio.modules = Array.isArray(modulesResult) ? modulesResult.map(normalizeModule) : [];
            rerender();
        });
    });
    document.getElementById("studio-new-module")?.addEventListener("click", () => {
        openModuleEditor(null);
        rerender();
    });
    document.getElementById("studio-module-cancel")?.addEventListener("click", () => {
        studio.moduleEditor = null;
        studio.editingModuleId = "";
        rerender();
    });
    document.getElementById("module-editor-overlay")?.addEventListener("click", (e: Event) => {
        if (e.target === e.currentTarget) {
            studio.moduleEditor = null;
            studio.editingModuleId = "";
            rerender();
        }
    });
    document.getElementById("entry-editor-overlay")?.addEventListener("click", (e: Event) => {
        if (e.target === e.currentTarget) {
            studio.entryEditorEntryId = "";
            rerender();
        }
    });
    document.getElementById("studio-entry-editor-close")?.addEventListener("click", () => {
        studio.entryEditorEntryId = "";
        rerender();
    });
    document.getElementById("studio-entry-editor-close-btn")?.addEventListener("click", () => {
        studio.entryEditorEntryId = "";
        rerender();
    });
    document.getElementById("studio-module-save")?.addEventListener("click", async () => {
        await runUiAction(async () => {
            const moduleName = readField("studio-module-name").trim();
            const rawId = readField("studio-module-id").trim();
            const moduleId = studio.editingModuleId || rawId || `mod-${routineStudioSlug(moduleName || "module") || "module"}`;
            const payload = {
                id: moduleId,
                name: moduleName || moduleId,
                category: readField("studio-module-category").trim() || "General",
                description: readField("studio-module-description").trim(),
                icon: readField("studio-module-icon").trim() || "module",
                durationMinutes: Math.max(1, Number(readField("studio-module-duration") || "1")),
            };
            if (studio.editingModuleId) {
                await safeInvoke("update_module", { module_id: studio.editingModuleId, payload });
            }
            else {
                await safeInvoke("create_module", { payload });
            }
            const modulesResult = await safeInvoke("list_modules", {});
            studio.modules = Array.isArray(modulesResult) ? modulesResult.map(normalizeModule) : [];
            studio.moduleEditor = null;
            studio.editingModuleId = "";
            setStatus(`module saved: ${moduleId}`);
            rerender();
        });
    });
    appRoot.querySelectorAll("[data-studio-subpage]").forEach((node) => {
        node.addEventListener("click", () => {
            const page = (node as HTMLElement).dataset.studioSubpage || "";
            studio.subPage = page === "schedule" ? "schedule" : "editor";
            rerender();
        });
    });
    document.getElementById("studio-search-input")?.addEventListener("input", (event: Event) => {
        studio.search = (event.currentTarget as HTMLInputElement).value || "";
        rerender();
    });
    appRoot.querySelectorAll("[data-studio-module-edit]").forEach((node) => {
        node.addEventListener("click", () => {
            const moduleId = (node as HTMLElement).dataset.studioModuleEdit || "";
            const module = studio.modules.find((candidate) => candidate.id === moduleId);
            if (!module)
                return;
            openModuleEditor(module);
            rerender();
        });
    });
    appRoot.querySelectorAll("[data-studio-module-delete]").forEach((node) => {
        node.addEventListener("click", async () => {
            const moduleId = (node as HTMLElement).dataset.studioModuleDelete || "";
            if (!moduleId)
                return;
            await runUiAction(async () => {
                const deleted = await safeInvoke("delete_module", { module_id: moduleId });
                if (!deleted) {
                    setStatus(`module not found: ${moduleId}`);
                    return;
                }
                const modulesResult = await safeInvoke("list_modules", {});
                studio.modules = Array.isArray(modulesResult) ? modulesResult.map(normalizeModule) : [];
                if (studio.editingModuleId === moduleId) {
                    studio.editingModuleId = "";
                    studio.moduleEditor = null;
                }
                setStatus(`module deleted: ${moduleId}`);
                rerender();
            });
        });
    });
    appRoot.querySelectorAll("[data-studio-insert-kind]").forEach((node) => {
        node.addEventListener("click", () => {
            const element = node as HTMLElement;
            if (addAssetToCanvas(element.dataset.studioInsertKind || "", element.dataset.studioInsertId || "")) {
                rerender();
            }
        });
    });
    appRoot.querySelectorAll("[data-studio-load-template]").forEach((node) => {
        node.addEventListener("click", () => {
            const templateId = (node as HTMLElement).dataset.studioLoadTemplate || "";
            if (addAssetToCanvas("template", templateId, true)) {
                rerender();
            }
        });
    });
    appRoot.querySelectorAll("[data-studio-remove]").forEach((node) => {
        node.addEventListener("click", () => {
            const entryId = (node as HTMLElement).dataset.studioRemove || "";
            applyCanvasEntries(studio.canvasEntries.filter((entry) => String((entry as Record<string, unknown>).entryId || "") !== entryId), true);
            rerender();
        });
    });
    appRoot.querySelectorAll("[data-studio-move]").forEach((node) => {
        node.addEventListener("click", () => {
            const element = node as HTMLElement;
            const entryId = element.dataset.studioMove || "";
            const direction = element.dataset.studioDir || "";
            const index = studio.canvasEntries.findIndex((entry) => String((entry as Record<string, unknown>).entryId || "") === entryId);
            if (index < 0)
                return;
            const nextIndex = direction === "up" ? index - 1 : index + 1;
            if (nextIndex < 0 || nextIndex >= studio.canvasEntries.length)
                return;
            const nextEntries = [...studio.canvasEntries];
            const current = nextEntries[index];
            const target = nextEntries[nextIndex];
            if (!current || !target)
                return;
            [nextEntries[index], nextEntries[nextIndex]] = [target, current];
            applyCanvasEntries(nextEntries, true);
            rerender();
        });
    });
    appRoot.querySelectorAll("[data-studio-select-entry]").forEach((node) => {
        node.addEventListener("click", () => {
            const entryId = (node as HTMLElement).dataset.studioSelectEntry || "";
            if (!entryId)
                return;
            studio.selectedEntryId = entryId;
            rerender();
        });
    });
    appRoot.querySelectorAll("[data-studio-entry-settings]").forEach((node) => {
        node.addEventListener("click", () => {
            const entryId = (node as HTMLElement).dataset.studioEntrySettings || "";
            if (!entryId)
                return;
            studio.entryEditorEntryId = entryId;
            rerender();
        });
    });
    appRoot.querySelectorAll("[data-studio-entry-field]").forEach((node) => {
        node.addEventListener("change", (event: Event) => {
            const element = event.currentTarget as HTMLElement;
            const entryId = element.dataset.studioEntryId || "";
            const field = element.dataset.studioEntryField || "";
            const value = (event.currentTarget as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
            if (!entryId || !field)
                return;
            const changed = updateEntry(entryId, (entry) => {
                if (field === "title") {
                    entry.title = String(value || "").trim() || entry.title;
                }
                else if (field === "durationMinutes") {
                    entry.durationMinutes = Math.max(1, Number(value || "1"));
                }
                else if (field === "moduleId") {
                    entry.moduleId = String(value || "").trim();
                }
                else if (field === "note") {
                    entry.note = String(value || "");
                }
                return entry;
            });
            if (changed)
                rerender();
        });
    });
    document.getElementById("studio-undo")?.addEventListener("click", () => {
        if (studio.historyIndex <= 0)
            return;
        studio.historyIndex -= 1;
        studio.canvasEntries = toEntryRecords((cloneValue(studio.history[studio.historyIndex] || []) as unknown[]).map((entry: unknown, index: number) => normalizeEntry(entry, index)));
        studio.selectedEntryId = readEntryId(studio.canvasEntries[0]);
        rerender();
    });
    document.getElementById("studio-redo")?.addEventListener("click", () => {
        if (studio.historyIndex >= studio.history.length - 1)
            return;
        studio.historyIndex += 1;
        studio.canvasEntries = toEntryRecords((cloneValue(studio.history[studio.historyIndex] || []) as unknown[]).map((entry: unknown, index: number) => normalizeEntry(entry, index)));
        studio.selectedEntryId = readEntryId(studio.canvasEntries[0]);
        rerender();
    });
    bindRoutineStudioPointerDnd({
        appRoot,
        studio,
        rerender,
        addAssetToCanvas,
        applyCanvasEntries,
        resolveDropInsertIndex,
        clearDropIndicator,
        paintDropIndicator,
    });
    document.getElementById("studio-draft-name")?.addEventListener("input", (event: Event) => {
        studio.draftName = (event.currentTarget as HTMLInputElement).value || "Routine Draft";
        const titleNode = appRoot.querySelector("[data-studio-title]");
        if (titleNode)
            titleNode.textContent = studio.draftName;
    });
    document.getElementById("studio-context")?.addEventListener("change", (event: Event) => {
        studio.context = (event.currentTarget as HTMLSelectElement).value || routineStudioContexts[0] || "Work - Deep Focus";
    });
    document.getElementById("studio-trigger-time")?.addEventListener("change", (event: Event) => {
        studio.triggerTime = (event.currentTarget as HTMLInputElement).value || "09:00";
        rerender();
    });
    document.getElementById("studio-auto-start")?.addEventListener("change", (event: Event) => {
        studio.autoStart = (event.currentTarget as HTMLInputElement).checked;
    });
    document.getElementById("studio-save-template")?.addEventListener("click", async () => {
        await runUiAction(async () => {
            const id = await persistTemplate();
            setStatus(`template saved: ${id}`);
            rerender();
        });
    });
    document.getElementById("studio-apply-today")?.addEventListener("click", async () => {
        await runUiAction(async () => {
            const id = await persistTemplate();
            const targetDate = isoDate(new Date());
            const result = (await safeInvoke("apply_studio_template_to_today", withAccount({
                template_id: id,
                date: targetDate,
                trigger_time: studio.triggerTime || "09:00",
                conflict_policy: "shift",
            }))) as Record<string, unknown>;
            await refreshCoreData(targetDate);
            const requested = formatHHmm(String(result?.requested_start_at || ""));
            const applied = formatHHmm(String(result?.applied_start_at || ""));
            studio.lastApplyResult = result?.shifted
                ? `Shifted ${requested} -> ${applied} (${result?.conflict_count || 0} conflicts)`
                : `Applied at ${applied}`;
            setStatus(`applied to today: ${id}`);
            rerender();
        });
    });
    appRoot.querySelectorAll("[data-studio-recipe-delete]").forEach((node) => {
        node.addEventListener("click", async () => {
            const recipeId = /** @type {HTMLElement} */ (node).dataset.studioRecipeDelete || "";
            if (!recipeId)
                return;
            await runUiAction(async () => {
                const deleted = await safeInvoke("delete_recipe", { recipe_id: recipeId });
                if (!deleted) {
                    setStatus(`recipe not found: ${recipeId}`);
                    return;
                }
                uiState.recipes = (await safeInvoke("list_recipes", {})) as typeof uiState.recipes;
                setStatus(`recipe deleted: ${recipeId}`);
                rerender();
            });
        });
    });
    document.getElementById("studio-clear-canvas")?.addEventListener("click", () => {
        applyCanvasEntries([], true);
        studio.selectedEntryId = "";
        rerender();
    });
}


