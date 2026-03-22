import type { Module, PageRenderDeps, RoutineScheduleAssetKind, RoutineScheduleEntry, RoutineScheduleGroupSummary, RoutineStudioEntry } from "../../types.js";
import {
  cloneValue,
  isRoutineStudioRecipe,
  ROUTINE_STUDIO_DEFAULT_FOLDER_ID,
  routineStudioRecipeCategory,
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
  deleteRoutineScheduleGroup,
  listRoutineScheduleGroups,
  loadRoutineScheduleGroup,
  moveStudioModule,
  moveStudioTemplate,
  persistStudioTemplate,
  refreshStudioAssets,
  saveRoutineScheduleGroup,
  saveStudioModule,
} from "./studio/actions.js";
import { renderRoutinesMarkup } from "./view.js";
import { bindPaneResizers } from "../../pane-resizer.js";
import { resolveWeekBufferDateKeys } from "../../time.js";


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
  const invokeCommandWithProgress = services.invokeCommandWithProgress.bind(services);
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
        category: String(studio.moduleFolders?.[0]?.id || ROUTINE_STUDIO_DEFAULT_FOLDER_ID),
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
    const parseScheduleTimeMinutes = (time: string): number => {
        const [hhRaw, mmRaw] = String(time || "").split(":");
        const hh = Number(hhRaw);
        const mm = Number(mmRaw);
        if (!Number.isFinite(hh) || !Number.isFinite(mm)) return 9 * 60;
        return Math.max(0, Math.min(24 * 60 - 1, hh * 60 + mm));
    };
    const normalizeDayOffset = (value: unknown): number => {
        const num = Number(value);
        if (!Number.isFinite(num)) return 0;
        return Math.max(-1, Math.min(1, Math.trunc(num)));
    };
    const toScheduleAbsoluteMinutes = (entry: RoutineScheduleEntry): number =>
        normalizeDayOffset((entry as { dayOffset?: number }).dayOffset) * 24 * 60 + parseScheduleTimeMinutes(String(entry.startTime || "09:00"));
    const formatScheduleTime = (absoluteMinutes: number): { dayOffset: number; startTime: string } => {
        const clamped = Math.max(-24 * 60, Math.min(48 * 60 - 1, Math.round(absoluteMinutes / 5) * 5));
        const dayOffset = Math.max(-1, Math.min(1, Math.floor(clamped / (24 * 60))));
        const minuteInDay = ((clamped % (24 * 60)) + 24 * 60) % (24 * 60);
        const hh = Math.floor(minuteInDay / 60);
        const mm = minuteInDay % 60;
        return {
            dayOffset,
            startTime: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
        };
    };
    const buildSchedulePlannerModel = () => {
        const today = new Date();
        const originDayStart = new Date(today);
        originDayStart.setHours(0, 0, 0, 0);
        const hasCrossDayEntries = studio.scheduleEntries.some((entry) => normalizeDayOffset((entry as { dayOffset?: number }).dayOffset) !== 0);
        const selectedScheduleEntry = studio.scheduleEntries.find((entry) => entry.id === studio.scheduleSelectedEntryId);
        const selectedDayOffset = normalizeDayOffset((selectedScheduleEntry as { dayOffset?: number } | undefined)?.dayOffset);
        const showExtendedScheduleWindow = hasCrossDayEntries || selectedDayOffset !== 0;
        const scheduleWindowStartMinutes = showExtendedScheduleWindow ? -24 * 60 : 0;
        const scheduleWindowDurationMinutes = showExtendedScheduleWindow ? 72 * 60 : 24 * 60;
        const dayStartMs = originDayStart.getTime() + scheduleWindowStartMinutes * 60 * 1000;
        const dayEndMs = dayStartMs + scheduleWindowDurationMinutes * 60 * 1000;
        const sortedEntries = [...studio.scheduleEntries].sort((left, right) => toScheduleAbsoluteMinutes(left) - toScheduleAbsoluteMinutes(right));
        const combinedItems = sortedEntries.map((entry, index) => {
            const startMinutes = toScheduleAbsoluteMinutes(entry);
            const durationMinutes = Math.max(1, Number(entry.durationMinutes) || 1);
            const startMs = originDayStart.getTime() + startMinutes * 60 * 1000;
            const endMs = Math.min(dayEndMs, startMs + durationMinutes * 60 * 1000);
            const id = String(entry.id || `schedule-entry-${index + 1}`);
            return {
                kind: "event",
                id,
                key: `event:${id}`,
                title: String(entry.title || "予定"),
                subtitle: String(entry.subtitle || ""),
                startMs,
                endMs,
                durationMinutes,
                payload: entry,
            };
        });
        const freeItems: Array<{
            kind: string;
            id: string;
            key: string;
            title: string;
            subtitle: string;
            startMs: number;
            endMs: number;
            durationMinutes: number;
            payload: null;
        }> = [];
        let cursorMs = dayStartMs;
        for (let index = 0; index < combinedItems.length; index += 1) {
            const current = combinedItems[index];
            if (!current) continue;
            if (current.startMs > cursorMs) {
                freeItems.push({
                    kind: "free",
                    id: `free-${index}-${cursorMs}`,
                    key: `free:${index}:${cursorMs}`,
                    title: "空き枠",
                    subtitle: "",
                    startMs: cursorMs,
                    endMs: current.startMs,
                    durationMinutes: Math.max(1, Math.round((current.startMs - cursorMs) / 60000)),
                    payload: null,
                });
            }
            cursorMs = Math.max(cursorMs, current.endMs);
        }
        if (cursorMs < dayEndMs) {
            freeItems.push({
                kind: "free",
                id: `free-tail-${cursorMs}`,
                key: `free:tail:${cursorMs}`,
                title: "空き枠",
                subtitle: "",
                startMs: cursorMs,
                endMs: dayEndMs,
                durationMinutes: Math.max(1, Math.round((dayEndMs - cursorMs) / 60000)),
                payload: null,
            });
        }
        const allItems = [...combinedItems, ...freeItems].sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
        const selectedItem = combinedItems.find((item) => item.id === studio.scheduleSelectedEntryId) || combinedItems[0] || null;
        const dateKey = isoDate(today);
        return {
            days: [
                {
                    dayStartMs,
                    dayEndMs,
                    blockIntervals: [],
                    eventIntervals: [],
                    busyIntervals: combinedItems.map((item) => ({ startMs: item.startMs, endMs: item.endMs })),
                    freeIntervals: freeItems.map((item) => ({ startMs: item.startMs, endMs: item.endMs })),
                    blockItems: [],
                    eventItems: combinedItems,
                    freeItems,
                    selectedItem,
                    selection: selectedItem ? { kind: "event", id: selectedItem.id } : null,
                    totals: {
                        blockMinutes: 0,
                        eventMinutes: combinedItems.reduce((sum, item) => sum + item.durationMinutes, 0),
                        freeMinutes: freeItems.reduce((sum, item) => sum + item.durationMinutes, 0),
                    },
                    dayKey: dateKey,
                    dayDate: new Date(originDayStart),
                    dayNumber: String(originDayStart.getDate()).padStart(2, "0"),
                    monthDayLabel: `${originDayStart.getMonth() + 1}/${originDayStart.getDate()}`,
                    weekdayLabel: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][originDayStart.getDay()] || "N/A",
                    isCurrent: true,
                    isToday: true,
                    combinedItems: allItems,
                },
            ],
            selectedItem,
            weekLabel: "",
            selection: selectedItem ? { kind: "event", id: selectedItem.id } : null,
            scheduleWindowStartMinutes,
            scheduleWindowDurationMinutes,
            showExtendedScheduleWindow,
        };
    };
    const schedulePlannerModel = buildSchedulePlannerModel();
    const savedScheduleGroups = Array.isArray(studio.__savedScheduleGroups)
        ? (studio.__savedScheduleGroups as RoutineScheduleGroupSummary[])
        : [];
    const currentDraftScheduleValue = String(studio.templateId || `rtngrp-${routineStudioSlug(studio.draftName || "routine-schedule") || "routine-schedule"}`);
    const scheduleWindowStartMinutes = Number((schedulePlannerModel as { scheduleWindowStartMinutes?: number }).scheduleWindowStartMinutes || 0);
    const scheduleWindowDurationMinutes = Number((schedulePlannerModel as { scheduleWindowDurationMinutes?: number }).scheduleWindowDurationMinutes || 24 * 60);
    const showExtendedScheduleWindow = Boolean((schedulePlannerModel as { showExtendedScheduleWindow?: boolean }).showExtendedScheduleWindow);
    const scheduleDayCalendarHtml = helpers.renderSingleDayPlannerCalendar(schedulePlannerModel as unknown);
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
        scheduleDayCalendarHtml,
        savedScheduleGroups,
        currentDraftScheduleValue,
        scheduleWindowStartMinutes,
        scheduleWindowDurationMinutes,
        showExtendedScheduleWindow,
        escapeHtml,
    }));
    const scheduleDropzone = appRoot.querySelector<HTMLElement>("#routine-schedule-dropzone");
    if (scheduleDropzone) {
        scheduleDropzone.addEventListener("scroll", () => {
            studio.__scheduleScrollTop = scheduleDropzone.scrollTop;
        });
        window.requestAnimationFrame(() => {
            const savedScrollTop = Number(studio.__scheduleScrollTop);
            if (showExtendedScheduleWindow) {
                if (Number.isFinite(savedScrollTop) && savedScrollTop > 0) {
                    scheduleDropzone.scrollTop = savedScrollTop;
                    return;
                }
                const track = scheduleDropzone.querySelector<HTMLElement>(".day-lane-track");
                const targetScrollTop = track ? Math.max(0, track.scrollHeight / 3) : Math.max(0, scheduleDropzone.scrollHeight / 3);
                scheduleDropzone.scrollTop = targetScrollTop;
                studio.__scheduleScrollTop = targetScrollTop;
                return;
            }
            scheduleDropzone.scrollTop = 0;
            studio.__scheduleScrollTop = 0;
        });
    }
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
    if (studio.subPage === "schedule") {
        bindPaneResizers(appRoot, [
          {
            layoutSelector: ".rs-schedule-three-pane",
            handleSelector: "[data-pane-resize='rs-schedule-left']",
            paneSelector: ".rs-schedule-left",
            cssVar: "--rs-schedule-left-width",
            storageKey: "pane-width:routines:schedule:left",
            edge: "left",
            minWidth: 280,
            maxWidth: 720,
            mainMinWidth: 300,
            oppositePaneSelector: ".rs-schedule-side",
            splitterCount: 2,
          },
          {
            layoutSelector: ".rs-schedule-three-pane",
            handleSelector: "[data-pane-resize='rs-schedule-right']",
            paneSelector: ".rs-schedule-side",
            cssVar: "--rs-schedule-right-width",
            storageKey: "pane-width:routines:schedule:right",
            edge: "right",
            minWidth: 260,
            maxWidth: 480,
            mainMinWidth: 300,
            oppositePaneSelector: ".rs-schedule-left",
            splitterCount: 2,
          },
        ]);
    }
    const rerender = () => renderRoutines();
    const sortScheduleEntries = (entries: RoutineScheduleEntry[]): RoutineScheduleEntry[] =>
        [...entries].sort((left, right) => toScheduleAbsoluteMinutes(left) - toScheduleAbsoluteMinutes(right));
    const fallbackScheduleGroupId = `rtngrp-${routineStudioSlug(studio.draftName || "routine-schedule") || "routine-schedule"}`;
    const activeScheduleGroupId = String(studio.scheduleGroupId || studio.templateId || fallbackScheduleGroupId).trim();
    studio.scheduleGroupId = activeScheduleGroupId;
    const refreshSavedScheduleGroups = async () => {
        studio.__savedScheduleGroups = await listRoutineScheduleGroups({
            safeInvoke: (command, payload) => safeInvoke(command, payload),
            recipes: uiState.recipes,
        });
        studio.__savedScheduleGroupsLoaded = true;
        studio.__savedScheduleGroupsDirty = false;
    };
    const regenerateVisibleRoutineBlocks = async () => {
        const anchorDate = String(uiState.dashboardDate || isoDate(new Date())).trim() || isoDate(new Date());
        const weekDateKeys = resolveWeekBufferDateKeys(anchorDate);
        for (const dateKey of weekDateKeys) {
            await invokeCommandWithProgress("generate_blocks", withAccount({ date: dateKey }));
        }
        await refreshCoreData(anchorDate);
    };
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
    const addScheduleAsset = (
        kind: RoutineScheduleAssetKind,
        id: string,
        insertIndex?: number,
        placement?: { startTime: string; dayOffset: number },
    ): boolean => {
        const normalizedId = String(id || "").trim();
        const orderedEntries = [...studio.scheduleEntries];
        const targetIndex = Math.max(0, Math.min(typeof insertIndex === "number" ? insertIndex : orderedEntries.length, orderedEntries.length));
        const resolvedPlacement = placement || (() => {
            const previousEntry = orderedEntries[Math.max(0, targetIndex - 1)];
            if (!previousEntry) return { startTime: "09:00", dayOffset: 0 };
            const previousAbs = toScheduleAbsoluteMinutes(previousEntry);
            const nextAbs = previousAbs + Math.max(1, Number(previousEntry.durationMinutes) || 1);
            return formatScheduleTime(nextAbs);
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
                startTime: resolvedPlacement.startTime,
                dayOffset: resolvedPlacement.dayOffset,
                durationMinutes: 30,
            }, studio.scheduleEntries.length);
            const nextEntries = [...orderedEntries];
            nextEntries.splice(targetIndex, 0, entry);
            studio.scheduleEntries = sortScheduleEntries(nextEntries);
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
                startTime: resolvedPlacement.startTime,
                dayOffset: resolvedPlacement.dayOffset,
                durationMinutes: Math.max(1, Number(module.durationMinutes) || 1),
            }, studio.scheduleEntries.length);
            const nextEntries = [...orderedEntries];
            nextEntries.splice(targetIndex, 0, entry);
            studio.scheduleEntries = sortScheduleEntries(nextEntries);
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
            startTime: resolvedPlacement.startTime,
            dayOffset: resolvedPlacement.dayOffset,
            durationMinutes: Math.max(1, durationMinutes || 1),
        }, studio.scheduleEntries.length);
        const nextEntries = [...orderedEntries];
        nextEntries.splice(targetIndex, 0, entry);
        studio.scheduleEntries = sortScheduleEntries(nextEntries);
        studio.scheduleSelectedEntryId = entry.id;
        studio.scheduleDirty = true;
        return true;
    };
    const moveScheduleEntryToIndex = (entryId: string, insertIndex: number): boolean => {
        const currentIndex = studio.scheduleEntries.findIndex((entry) => entry.id === entryId);
        if (currentIndex < 0) return false;
        const clampedIndex = Math.max(0, Math.min(insertIndex, studio.scheduleEntries.length));
        if (clampedIndex === currentIndex || clampedIndex === currentIndex + 1) return false;
        const nextEntries = [...studio.scheduleEntries];
        const [entry] = nextEntries.splice(currentIndex, 1);
        if (!entry) return false;
        const targetIndex = clampedIndex > currentIndex ? clampedIndex - 1 : clampedIndex;
        nextEntries.splice(Math.max(0, Math.min(targetIndex, nextEntries.length)), 0, entry);
        studio.scheduleEntries = nextEntries.map((item, index) => normalizeScheduleEntry(item, index));
        studio.scheduleSelectedEntryId = entry.id;
        studio.scheduleDirty = true;
        return true;
    };
    const moveScheduleEntryToTime = (entryId: string, placement: { startTime: string; dayOffset: number }): boolean => {
        const currentIndex = studio.scheduleEntries.findIndex((entry) => entry.id === entryId);
        if (currentIndex < 0) return false;
        const nextEntries = studio.scheduleEntries.map((entry, index) => normalizeScheduleEntry(entry, index));
        const current = nextEntries[currentIndex];
        if (!current) return false;
        current.startTime = placement.startTime;
        current.dayOffset = normalizeDayOffset(placement.dayOffset);
        studio.scheduleEntries = sortScheduleEntries(nextEntries);
        studio.scheduleSelectedEntryId = entryId;
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
        } else if (field === "dayOffset") {
            entry.dayOffset = normalizeDayOffset(value);
        } else {
            return false;
        }
        studio.scheduleEntries = sortScheduleEntries(nextEntries);
        studio.scheduleSelectedEntryId = entryId;
        studio.scheduleDirty = true;
        return true;
    };
    if ((studio.subPage === "schedule" || studio.subPage === "saved-schedules") && !studio.__savedScheduleGroupsLoading && (!studio.__savedScheduleGroupsLoaded || studio.__savedScheduleGroupsDirty)) {
        studio.__savedScheduleGroupsLoading = true;
        runUiAction(async () => {
            try {
                await refreshSavedScheduleGroups();
            } finally {
                studio.__savedScheduleGroupsLoading = false;
                rerender();
            }
        });
    }
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
        if (folderId === ROUTINE_STUDIO_DEFAULT_FOLDER_ID) {
            setStatus("default folder cannot be deleted");
            return;
        }
        if (!window.confirm(`フォルダー「${label}」を削除します。`)) {
            return;
        }
        await runUiAction(async () => {
            const moduleIds = studio.modules
                .filter((module) => String(module.category || "") === folderId)
                .map((module) => module.id);
            const templateIds = uiState.recipes
                .filter((recipe) => isRoutineStudioRecipe(recipe) && routineStudioRecipeCategory(recipe, ROUTINE_STUDIO_DEFAULT_FOLDER_ID) === folderId)
                .map((recipe) => String(recipe.id || ""))
                .filter(Boolean);
            for (const moduleId of moduleIds) {
                await deleteStudioModule({
                    safeInvoke: (command, payload) => safeInvoke(command, payload),
                    moduleId,
                    normalizeModule,
                });
            }
            for (const recipeId of templateIds) {
                await deleteStudioRecipe({
                    safeInvoke: (command, payload) => safeInvoke(command, payload),
                    recipeId,
                });
            }
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
                studio.moduleEditor.category = String(studio.moduleFolders[0]?.id || ROUTINE_STUDIO_DEFAULT_FOLDER_ID);
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
    const onMoveTemplate = async (templateId: string, folderId: string, beforeTemplateId?: string) => {
        await runUiAction(async () => {
            const recipes = await moveStudioTemplate({
                safeInvoke: (command, payload) => safeInvoke(command, payload),
                recipes: uiState.recipes,
                templateId,
                folderId,
                ...(beforeTemplateId ? { beforeTemplateId } : {}),
            });
            if (recipes.length > 0) {
                uiState.recipes = recipes;
            }
            setStatus(`template moved: ${templateId} -> ${folderId}${beforeTemplateId ? ` (before ${beforeTemplateId})` : ""}`);
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
                category: readField("studio-module-category").trim() || String(studio.moduleFolders[0]?.id || ROUTINE_STUDIO_DEFAULT_FOLDER_ID),
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
        moveTemplateAsset: onMoveTemplate,
        addScheduleAsset,
        moveScheduleEntryToIndex,
        moveScheduleEntryToTime,
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
            await refreshSavedScheduleGroups();
            await regenerateVisibleRoutineBlocks();
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
                await refreshSavedScheduleGroups();
                const results: string[] = [];
                const sortedSavedEntries = [...saved.entries].sort((left, right) => toScheduleAbsoluteMinutes(left) - toScheduleAbsoluteMinutes(right));
                for (const entry of sortedSavedEntries) {
                    const recipeId = String(entry.recipeId || entry.assetId || "").trim();
                    if (!recipeId) continue;
                    const offsetDays = normalizeDayOffset((entry as { dayOffset?: number }).dayOffset);
                    const targetDateBase = new Date();
                    targetDateBase.setDate(targetDateBase.getDate() + offsetDays);
                    const result = await applyStudioTemplateToToday({
                        safeInvoke: (command, payload) => safeInvoke(command, payload),
                        refreshCoreData,
                        withAccount,
                        isoDate,
                        formatHHmm,
                        templateId: recipeId,
                        triggerTime: entry.startTime,
                        targetDate: isoDate(targetDateBase),
                    });
                    const offsetLabel = offsetDays === 0 ? "" : offsetDays > 0 ? ` (+${offsetDays}d)` : ` (${offsetDays}d)`;
                    results.push(`${entry.startTime}${offsetLabel} ${entry.title}: ${result}`);
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
    const onDeleteScheduleGroup = async (groupId: string) => {
        const currentGroups = Array.isArray(studio.__savedScheduleGroups) ? (studio.__savedScheduleGroups as RoutineScheduleGroupSummary[]) : [];
        const target = currentGroups.find((group) => group.groupId === groupId);
        const label = String(target?.name || groupId);
        if (!window.confirm(`定期予定「${label}」を削除します。`)) {
            return;
        }
        await runUiAction(async () => {
            const deletedCount = await deleteRoutineScheduleGroup({
                safeInvoke: (command, payload) => safeInvoke(command, payload),
                groupId,
            });
            await refreshSavedScheduleGroups();
            if (studio.scheduleGroupId === groupId) {
                studio.scheduleGroupId = fallbackScheduleGroupId;
                studio.scheduleLoadedGroupId = "";
                studio.scheduleEntries = [];
                studio.scheduleSelectedEntryId = "";
                studio.scheduleDirty = false;
            }
            setStatus(deletedCount > 0 ? `schedule deleted: ${label}` : `schedule not found: ${groupId}`);
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
        onDeleteScheduleGroup,
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



