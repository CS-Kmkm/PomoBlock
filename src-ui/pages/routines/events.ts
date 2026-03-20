import type { Module, PageRenderDeps, RoutineScheduleAssetKind, RoutineScheduleEntry, RoutineStudioEntry } from "../../types.js";
import {
  cloneValue,
  isRoutineStudioRecipe,
  routineStudioContexts,
  routineStudioSeedFolders,
  routineStudioSeedModules,
  nextRoutineScheduleEntryId,
  routineStudioSlug,
  routineStudioStepDurationMinutes,
  toPositiveInt,
} from "./model.js";
import { bindRoutineStudioPointerDnd } from "./pointer-dnd.js";
import {
  applyStudioCanvasEntries,
  createEmptyStudioModuleEditor,
  normalizeRoutineScheduleEntry,
  normalizeRoutineScheduleRecurrence,
  normalizeStudioEntry,
  normalizeStudioModule,
  normalizeStudioModuleFolder,
  normalizeStudioModuleEditor,
  pushStudioHistorySnapshot,
  readStudioEntryId,
  toEntryRecords,
  updateStudioEntry,
} from "./state.js";
import {
  clearStudioDropIndicator,
  paintStudioDropIndicator,
  resolveStudioDropInsertIndex,
} from "./studio/drop-indicator.js";
import { buildStudioAssets } from "./studio/assets.js";
import { createAddAssetToCanvas, moduleToStudioEntry, recipeToStudioEntries } from "./studio/canvas.js";
import { bootstrapStudioState, normalizeStudioState, syncStudioFromRecipe } from "./studio/lifecycle.js";
import {
  closeStudioEntryEditor,
  closeStudioModuleEditor,
  openStudioModuleEditor,
  resolveStudioModule,
} from "./studio/module-editor.js";
import { buildRoutineStudioLoadingMarkup, buildRoutineStudioMarkup } from "./studio/markup.js";
import { bindRoutineStudioEditorEvents } from "./studio/bindings.js";
import { bindRoutineStudioAsyncEvents } from "./studio/async-bindings.js";
import {
  applyStudioTemplateToToday,
  buildStudioModulePayload,
  createStudioModuleFolder,
  deleteStudioModule,
  deleteStudioModuleFolder,
  deleteStudioRecipe,
  loadRoutineScheduleGroup,
  moveStudioModule,
  persistStudioTemplate,
  refreshStudioAssets,
  saveRoutineScheduleGroup,
  saveStudioModule,
} from "./studio/actions.js";
import { renderRoutinesMarkup } from "./view.js";
import { bindPaneResizers } from "../../pane-resizer.js";


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
  const isUnknownCommandError = helpers.isUnknownCommandError;
  const renderRoutines = () => renderRoutinesEvents(deps);
    const recipes = Array.isArray(uiState.recipes) ? uiState.recipes : [];
    const studio = uiState.routineStudio;
    const normalizeModule = normalizeStudioModule;
    const normalizeModuleFolder = normalizeStudioModuleFolder;
    const normalizeEntry = normalizeStudioEntry;
    const normalizeScheduleEntry = normalizeRoutineScheduleEntry;
    const normalizeScheduleRecurrence = normalizeRoutineScheduleRecurrence;
    const normalizeModuleEditor = normalizeStudioModuleEditor;
    const readEntryId = readStudioEntryId;
    const createEmptyModuleEditor = () => normalizeModuleEditor({
        ...createEmptyStudioModuleEditor(),
        category: String(studio.moduleFolders?.[0]?.id || "General"),
    });
    normalizeStudioState({
        studio,
        normalizeModule,
        normalizeModuleFolder,
        normalizeEntry,
        normalizeScheduleEntry,
        normalizeScheduleRecurrence,
        normalizeModuleEditor,
        toEntryRecords,
        contextDefault: routineStudioContexts[0] || "Work - Deep Focus",
        slugify: routineStudioSlug,
    });
    if (!studio.assetsLoaded) {
        renderRoutinesMarkup(appRoot, buildRoutineStudioLoadingMarkup());
        if (!studio.assetsLoading) {
            studio.assetsLoading = true;
            runUiAction(async () => {
                const refreshed = await refreshStudioAssets({
                    safeInvoke: (command, payload) => safeInvoke(command, payload),
                    normalizeModule,
                    normalizeModuleFolder,
                    fallbackModules: cloneValue(routineStudioSeedModules),
                    fallbackModuleFolders: cloneValue(routineStudioSeedFolders),
                });
                uiState.recipes = refreshed.recipes;
                studio.modules = refreshed.modules;
                studio.moduleFolders = refreshed.moduleFolders;
                studio.assetsLoaded = true;
                studio.assetsLoading = false;
                renderRoutines();
            });
        }
        return;
    }
    const moduleToEntry = (module: Module): RoutineStudioEntry => moduleToStudioEntry(module, normalizeEntry);
    const recipeToEntries = (recipe: unknown): RoutineStudioEntry[] =>
        recipeToStudioEntries(recipe, normalizeEntry, routineStudioStepDurationMinutes);
    const syncFromRecipe = (recipe: unknown) => syncStudioFromRecipe(studio, recipe);
    bootstrapStudioState({
        studio,
        recipes,
        isRoutineStudioRecipe,
        syncFromRecipe,
        recipeToEntries,
        moduleToEntry,
        cloneValue,
    });
    const pushHistory = () => pushStudioHistorySnapshot({
        studio,
        cloneValue,
        normalizeEntry,
    });
    const applyCanvasEntries = (nextEntries: RoutineStudioEntry[], recordHistory = true) => applyStudioCanvasEntries({
        studio,
        nextEntries,
        normalizeEntry,
        toEntryRecords,
        readEntryId,
        recordHistory,
        pushHistory,
    });
    const addAssetToCanvas = createAddAssetToCanvas({
        studio,
        recipes,
        isRoutineStudioRecipe,
        moduleToEntry,
        recipeToEntries,
        applyCanvasEntries,
        syncFromRecipe,
    });
    const sanitizeDeletedModuleEntries = (entries: RoutineStudioEntry[], deletedModuleId: string): RoutineStudioEntry[] =>
        entries.map((entry, index) => {
            if (String(entry.moduleId || "") !== deletedModuleId) {
                return normalizeEntry(entry, index);
            }
            const rawStep = { ...(entry.rawStep || {}) } as Record<string, unknown>;
            delete rawStep.moduleId;
            delete rawStep.module_id;
            return normalizeEntry({
                ...entry,
                moduleId: "",
                rawStep,
            }, index);
        });
    const { folderAssets, complexModuleAssets, allComplexModuleAssets, totalMinutes } = buildStudioAssets({
        studio,
        recipes,
        normalizeModule,
        isRoutineStudioRecipe,
        routineStudioStepDurationMinutes,
    });
        renderRoutinesMarkup(appRoot, buildRoutineStudioMarkup({
        studio,
        folderAssets,
        complexModuleAssets,
        allComplexModuleAssets,
        totalMinutes,
        routineStudioContexts,
        escapeHtml,
    }));
    bindPaneResizers(appRoot, [
      {
        layoutSelector: ".routine-studio-layout",
        handleSelector: "[data-pane-resize='rs-left']",
        paneSelector: ".rs-library",
        cssVar: "--rs-left-width",
        storageKey: "pane-width:routines:left",
        edge: "left",
        minWidth: 220,
        maxWidth: 420,
        mainMinWidth: 420,
        oppositePaneSelector: ".rs-intel",
        splitterCount: 2,
      },
      {
        layoutSelector: ".routine-studio-layout",
        handleSelector: "[data-pane-resize='rs-right']",
        paneSelector: ".rs-intel",
        cssVar: "--rs-right-width",
        storageKey: "pane-width:routines:right",
        edge: "right",
        minWidth: 260,
        maxWidth: 460,
        mainMinWidth: 420,
        oppositePaneSelector: ".rs-library",
        splitterCount: 2,
      },
    ]);
    const rerender = () => renderRoutines();
    const sortScheduleEntries = (entries: RoutineScheduleEntry[]): RoutineScheduleEntry[] =>
        [...entries].sort((left, right) => String(left.startTime || "").localeCompare(String(right.startTime || "")));
    const fallbackScheduleGroupId = `rtngrp-${routineStudioSlug(studio.draftName || "routine-schedule") || "routine-schedule"}`;
    const activeScheduleGroupId = String(studio.scheduleGroupId || studio.templateId || fallbackScheduleGroupId).trim();
    studio.scheduleGroupId = activeScheduleGroupId;
    const persistTemplate = async () => persistStudioTemplate({
        studio,
        recipes: uiState.recipes,
        safeInvoke: (command, payload) => safeInvoke(command, payload),
    });
    const readField = (id: string) =>
        (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null)?.value || "";
    const openModuleEditor = (module: Module | null) =>
        openStudioModuleEditor(studio, normalizeModuleEditor, createEmptyModuleEditor, module);
    const updateEntry = (entryId: string, updater: (entry: RoutineStudioEntry) => RoutineStudioEntry) => updateStudioEntry({
        studio,
        entryId,
        updater,
        normalizeEntry,
        applyCanvasEntries,
    });
    const resolveDropInsertIndex = (dropzone: HTMLElement, clientY: number) =>
        resolveStudioDropInsertIndex(studio, dropzone, clientY);
    const clearDropIndicator = (dropzone: HTMLElement) => clearStudioDropIndicator(studio, dropzone);
    const paintDropIndicator = (dropzone: HTMLElement, insertIndex: number) =>
        paintStudioDropIndicator(studio, dropzone, insertIndex);
    const closeModuleEditor = () => {
        closeStudioModuleEditor(studio);
        rerender();
    };
    const closeEntryEditor = () => {
        closeStudioEntryEditor(studio);
        rerender();
    };
    const resolveModule = (moduleId: string): Module | null => resolveStudioModule(studio, moduleId);
    const addScheduleAsset = (kind: RoutineScheduleAssetKind, id: string): boolean => {
        const normalizedId = String(id || "").trim();
        const lastEntry = sortScheduleEntries(studio.scheduleEntries).slice(-1)[0];
        const startTime = (() => {
            if (!lastEntry) return "09:00";
            const [hh, mm] = String(lastEntry.startTime || "09:00").split(":").map((value) => Number(value || 0));
            const total = hh * 60 + mm + Math.max(1, Number(lastEntry.durationMinutes) || 0);
            const nextHours = Math.floor(total / 60) % 24;
            const nextMinutes = total % 60;
            return `${String(nextHours).padStart(2, "0")}:${String(nextMinutes).padStart(2, "0")}`;
        })();
        if (normalizedId === "__empty__") {
            const entry = normalizeScheduleEntry({
                id: nextRoutineScheduleEntryId(),
                assetKind: "module",
                assetId: "",
                recipeId: "",
                moduleId: "",
                title: "Untitled Slot",
                subtitle: "空きスロット",
                startTime,
                durationMinutes: 30,
            }, studio.scheduleEntries.length);
            studio.scheduleEntries = sortScheduleEntries([...studio.scheduleEntries, entry]);
            studio.scheduleSelectedEntryId = entry.id;
            studio.scheduleDirty = true;
            return true;
        }
        if (kind === "module") {
            const module = studio.modules.find((candidate) => candidate.id === normalizedId);
            if (!module) return false;
            const entry = normalizeScheduleEntry({
                id: nextRoutineScheduleEntryId(),
                assetKind: "module",
                assetId: module.id,
                recipeId: "",
                moduleId: module.id,
                title: String(module.name || module.id),
                subtitle: String(module.description || module.category || "モジュール"),
                startTime,
                durationMinutes: Math.max(1, Number(module.durationMinutes) || 1),
            }, studio.scheduleEntries.length);
            studio.scheduleEntries = sortScheduleEntries([...studio.scheduleEntries, entry]);
            studio.scheduleSelectedEntryId = entry.id;
            studio.scheduleDirty = true;
            return true;
        }
        const recipe = recipes.find((candidate) => candidate.id === normalizedId && isRoutineStudioRecipe(candidate));
        if (!recipe) return false;
        const durationMinutes = recipeToEntries(recipe).reduce((sum, entry) => sum + Math.max(1, Number(entry.durationMinutes) || 0), 0);
        const entry = normalizeScheduleEntry({
            id: nextRoutineScheduleEntryId(),
            assetKind: "template",
            assetId: recipe.id,
            recipeId: recipe.id,
            moduleId: "",
            title: String(recipe.name || recipe.id),
            subtitle: "複合モジュール",
            startTime,
            durationMinutes: Math.max(1, durationMinutes || 1),
        }, studio.scheduleEntries.length);
        studio.scheduleEntries = sortScheduleEntries([...studio.scheduleEntries, entry]);
        studio.scheduleSelectedEntryId = entry.id;
        studio.scheduleDirty = true;
        return true;
    };
    const updateScheduleField = (entryId: string, field: string, value: string): boolean => {
        const index = studio.scheduleEntries.findIndex((entry) => entry.id === entryId);
        if (index < 0) return false;
        const nextEntries = studio.scheduleEntries.map((entry, currentIndex) => normalizeScheduleEntry(entry, currentIndex));
        const entry = nextEntries[index];
        if (!entry) return false;
        if (field === "title") {
            entry.title = String(value || "").trim() || entry.title;
        } else if (field === "durationMinutes") {
            entry.durationMinutes = toPositiveInt(value, entry.durationMinutes || 1);
        } else if (field === "startTime") {
            entry.startTime = /^\d{2}:\d{2}$/.test(String(value || "")) ? String(value) : entry.startTime;
        } else {
            return false;
        }
        studio.scheduleEntries = sortScheduleEntries(nextEntries);
        studio.scheduleSelectedEntryId = entryId;
        studio.scheduleDirty = true;
        return true;
    };
    if (studio.subPage === "schedule" && activeScheduleGroupId && activeScheduleGroupId !== studio.scheduleLoadedGroupId && !studio.__scheduleLoading) {
        studio.__scheduleLoading = true;
        runUiAction(async () => {
            try {
                const loaded = await loadRoutineScheduleGroup({
                    safeInvoke: (command, payload) => safeInvoke(command, payload),
                    groupId: activeScheduleGroupId,
                    normalizeScheduleEntry,
                    fallbackTitle: studio.draftName,
                });
                studio.scheduleEntries = loaded.entries;
                studio.scheduleRecurrence = normalizeScheduleRecurrence(loaded.recurrence);
                studio.scheduleLoadedGroupId = activeScheduleGroupId;
                studio.scheduleSelectedEntryId = String(loaded.entries[0]?.id || "");
                studio.scheduleDirty = false;
            } catch (error) {
                if (!isUnknownCommandError(error)) {
                    throw error;
                }
                studio.scheduleEntries = [];
                studio.scheduleLoadedGroupId = activeScheduleGroupId;
            } finally {
                studio.__scheduleLoading = false;
                rerender();
            }
        });
    }
    const onRefreshAssets = async () => {
        await runUiAction(async () => {
            const refreshed = await refreshStudioAssets({
                safeInvoke: (command, payload) => safeInvoke(command, payload),
                normalizeModule,
                normalizeModuleFolder,
                fallbackModules: cloneValue(routineStudioSeedModules),
                fallbackModuleFolders: cloneValue(routineStudioSeedFolders),
            });
            uiState.recipes = refreshed.recipes;
            studio.modules = refreshed.modules;
            studio.moduleFolders = refreshed.moduleFolders;
            rerender();
        });
    };
    const onCreateFolder = async () => {
        const name = window.prompt("新しいフォルダー名を入力してください。", "")?.trim() || "";
        if (!name) {
            return;
        }
        await runUiAction(async () => {
            await createStudioModuleFolder({
                safeInvoke: (command, payload) => safeInvoke(command, payload),
                name,
            });
            const refreshed = await refreshStudioAssets({
                safeInvoke: (command, payload) => safeInvoke(command, payload),
                normalizeModule,
                normalizeModuleFolder,
                fallbackModules: cloneValue(routineStudioSeedModules),
                fallbackModuleFolders: cloneValue(routineStudioSeedFolders),
            });
            uiState.recipes = refreshed.recipes;
            studio.modules = refreshed.modules;
            studio.moduleFolders = refreshed.moduleFolders;
            if (studio.moduleEditor && !studio.moduleEditor.category) {
                studio.moduleEditor.category = name;
            }
            setStatus(`folder created: ${name}`);
            rerender();
        });
    };
    const onDeleteFolder = async (folderId: string) => {
        const targetFolder = studio.moduleFolders.find((folder) => folder.id === folderId);
        const label = String(targetFolder?.name || folderId);
        if (!window.confirm(`フォルダー「${label}」を削除します。`)) {
            return;
        }
        await runUiAction(async () => {
            const deleted = await deleteStudioModuleFolder({
                safeInvoke: (command, payload) => safeInvoke(command, payload),
                folderId,
            });
            if (!deleted) {
                setStatus(`folder not found: ${folderId}`);
                return;
            }
            const refreshed = await refreshStudioAssets({
                safeInvoke: (command, payload) => safeInvoke(command, payload),
                normalizeModule,
                normalizeModuleFolder,
                fallbackModules: cloneValue(routineStudioSeedModules),
                fallbackModuleFolders: cloneValue(routineStudioSeedFolders),
            });
            uiState.recipes = refreshed.recipes;
            studio.modules = refreshed.modules;
            studio.moduleFolders = refreshed.moduleFolders;
            if (studio.moduleEditor && studio.moduleEditor.category === folderId) {
                studio.moduleEditor.category = String(studio.moduleFolders[0]?.id || "General");
            }
            setStatus(`folder deleted: ${label}`);
            rerender();
        });
    };
    const onMoveModule = async (moduleId: string, folderId: string, beforeModuleId?: string) => {
        await runUiAction(async () => {
            const modules = await moveStudioModule({
                safeInvoke: (command, payload) => safeInvoke(command, payload),
                normalizeModule,
                moduleId,
                folderId,
                ...(beforeModuleId ? { beforeModuleId } : {}),
            });
            if (modules.length > 0) {
                studio.modules = modules;
            }
            if (studio.moduleEditor && (studio.editingModuleId === moduleId || studio.moduleEditor.id === moduleId)) {
                studio.moduleEditor.category = folderId;
            }
            setStatus(`module moved: ${moduleId} -> ${folderId}`);
            rerender();
        });
    };
    const onSaveModule = async () => {
        await runUiAction(async () => {
            const moduleName = readField("studio-module-name").trim();
            const rawId = readField("studio-module-id").trim();
            const moduleId = studio.editingModuleId || rawId || `mod-${routineStudioSlug(moduleName || "module") || "module"}`;
            const existingModule = studio.editingModuleId ? resolveModule(studio.editingModuleId) : null;
            const payload = buildStudioModulePayload({
                editingModuleId: studio.editingModuleId,
                existingModule,
                moduleId,
                moduleName,
                category: readField("studio-module-category").trim() || String(studio.moduleFolders[0]?.id || "General"),
                description: readField("studio-module-description").trim(),
                icon: readField("studio-module-icon").trim() || "module",
                durationMinutes: toPositiveInt(readField("studio-module-duration"), 1),
            });
            studio.modules = await saveStudioModule({
                safeInvoke: (command, invokePayload) => safeInvoke(command, invokePayload),
                normalizeModule,
                editingModuleId: studio.editingModuleId,
                payload,
            });
            studio.moduleEditor = null;
            studio.editingModuleId = "";
            setStatus(`module saved: ${moduleId}`);
            rerender();
        });
    };
    const onDeleteModule = async (moduleId: string) => {
        await runUiAction(async () => {
            const result = await deleteStudioModule({
                safeInvoke: (command, payload) => safeInvoke(command, payload),
                moduleId,
                normalizeModule,
            });
            if (!result.deleted) {
                setStatus(`module not found: ${moduleId}`);
                return;
            }
            studio.modules = result.modules;
            const sanitizedCanvasEntries = sanitizeDeletedModuleEntries(studio.canvasEntries, moduleId);
            studio.canvasEntries = toEntryRecords(sanitizedCanvasEntries);
            studio.history = studio.history.map((snapshot) => sanitizeDeletedModuleEntries(snapshot, moduleId));
            if (studio.selectedEntryId && studio.canvasEntries.every((entry) => entry.entryId !== studio.selectedEntryId)) {
                studio.selectedEntryId = readEntryId(studio.canvasEntries[0]);
            }
            if (studio.editingModuleId === moduleId) {
                studio.editingModuleId = "";
                studio.moduleEditor = null;
            }
            setStatus(`module deleted: ${moduleId}`);
            rerender();
        });
    };
    const prevDndDispose = studio.__pointerDndDispose;
    if (typeof prevDndDispose === "function") {
        prevDndDispose();
    }
    studio.__pointerDndDispose = bindRoutineStudioPointerDnd({
        appRoot,
        studio,
        rerender,
        addAssetToCanvas,
        applyCanvasEntries,
        resolveDropInsertIndex,
        clearDropIndicator,
        paintDropIndicator,
        moveModuleAsset: onMoveModule,
    });
    const onSaveTemplate = async () => {
        await runUiAction(async () => {
            const id = await persistTemplate();
            studio.applyTemplateId = id;
            setStatus(`template saved: ${id}`);
            rerender();
        });
    };
    const onSaveSchedule = async () => {
        await runUiAction(async () => {
            const saved = await saveRoutineScheduleGroup({
                safeInvoke: (command, payload) => safeInvoke(command, payload),
                studio,
                recipes: uiState.recipes,
                modules: studio.modules,
                normalizeScheduleEntry,
            });
            studio.scheduleEntries = saved.entries;
            studio.scheduleRecurrence = normalizeScheduleRecurrence(saved.recurrence);
            studio.scheduleLoadedGroupId = studio.scheduleGroupId;
            studio.scheduleDirty = false;
            setStatus(`schedule saved: ${studio.scheduleGroupId}`);
            rerender();
        });
    };
    const onApplyToday = async () => {
        await runUiAction(async () => {
            if (studio.subPage === "schedule" && studio.scheduleEntries.length > 0) {
                const saved = await saveRoutineScheduleGroup({
                    safeInvoke: (command, payload) => safeInvoke(command, payload),
                    studio,
                    recipes: uiState.recipes,
                    modules: studio.modules,
                    normalizeScheduleEntry,
                });
                studio.scheduleEntries = saved.entries;
                studio.scheduleLoadedGroupId = studio.scheduleGroupId;
                studio.scheduleDirty = false;
                const results: string[] = [];
                for (const entry of saved.entries) {
                    const recipeId = String(entry.recipeId || entry.assetId || "").trim();
                    if (!recipeId) continue;
                    const result = await applyStudioTemplateToToday({
                        safeInvoke: (command, payload) => safeInvoke(command, payload),
                        refreshCoreData,
                        withAccount,
                        isoDate,
                        formatHHmm,
                        templateId: recipeId,
                        triggerTime: entry.startTime,
                    });
                    results.push(`${entry.startTime} ${entry.title}: ${result}`);
                }
                studio.lastApplyResult = results.join(" / ");
                setStatus(`applied schedule: ${saved.entries.length} items`);
                rerender();
                return;
            }
            const id = String(studio.applyTemplateId || "").trim();
            if (!id) {
                throw new Error("適用する保存済みルーティンを選択してください。");
            }
            studio.lastApplyResult = await applyStudioTemplateToToday({
                safeInvoke: (command, payload) => safeInvoke(command, payload),
                refreshCoreData,
                withAccount,
                isoDate,
                formatHHmm,
                templateId: id,
                triggerTime: studio.triggerTime,
            });
            setStatus(`applied to today: ${id}`);
            rerender();
        });
    };
    const onDeleteRecipe = async (recipeId: string) => {
        await runUiAction(async () => {
            const result = await deleteStudioRecipe({
                safeInvoke: (command, payload) => safeInvoke(command, payload),
                recipeId,
            });
            if (!result.deleted) {
                setStatus(`recipe not found: ${recipeId}`);
                return;
            }
            uiState.recipes = result.recipes;
            if (studio.applyTemplateId === recipeId) {
                const nextRecipeId = result.recipes.find((recipe) => isRoutineStudioRecipe(recipe))?.id;
                studio.applyTemplateId = String(nextRecipeId || "");
            }
            setStatus(`recipe deleted: ${recipeId}`);
            rerender();
        });
    };
    bindRoutineStudioAsyncEvents({
        appRoot,
        resolveModule,
        openModuleEditor: (module) => {
            openModuleEditor(module);
            rerender();
        },
        closeModuleEditor,
        closeEntryEditor,
        onRefreshAssets,
        onCreateFolder,
        onDeleteFolder,
        onSaveModule,
        onDeleteModule,
        onSaveTemplate,
        onSaveSchedule,
        onApplyToday,
        onDeleteRecipe,
    });
    bindRoutineStudioEditorEvents({
        appRoot,
        studio,
        rerender,
        addAssetToCanvas,
        applyCanvasEntries,
        updateEntry,
        normalizeEntry,
        toEntryRecords,
        readEntryId,
        toPositiveInt,
        contextDefault: routineStudioContexts[0] || "Work - Deep Focus",
        cloneValue,
        addScheduleAsset,
        updateScheduleField,
    });
}



