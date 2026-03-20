import type { Module, ModuleFolder, Recipe, RoutineScheduleEntry, RoutineScheduleRecurrence, RoutineStudioState } from "../../../types.js";
import { routineStudioSlug } from "../model.js";

type SafeInvoke = (command: string, payload: Record<string, unknown>) => Promise<unknown>;

type BuildRecipePayloadParams = {
  studio: RoutineStudioState;
};

type PersistRecipeParams = {
  studio: RoutineStudioState;
  recipes: Recipe[];
  safeInvoke: SafeInvoke;
};

type RefreshStudioAssetsParams = {
  safeInvoke: SafeInvoke;
  normalizeModule: (module: unknown, index: number) => Module;
  normalizeModuleFolder: (folder: unknown, index: number) => ModuleFolder;
  fallbackModules: Module[];
  fallbackModuleFolders: ModuleFolder[];
};

type SaveStudioModuleParams = {
  safeInvoke: SafeInvoke;
  normalizeModule: (module: unknown, index: number) => Module;
  editingModuleId: string;
  payload: Record<string, unknown>;
};

type BuildStudioModulePayloadParams = {
  editingModuleId: string;
  existingModule: Module | null;
  moduleId: string;
  moduleName: string;
  category: string;
  description: string;
  icon: string;
  durationMinutes: number;
};

type ApplyStudioTemplateToTodayParams = {
  safeInvoke: SafeInvoke;
  refreshCoreData: (date?: string) => Promise<void>;
  withAccount: (payload?: Record<string, unknown>) => Record<string, unknown>;
  isoDate: (value: Date) => string;
  formatHHmm: (value: string | null | undefined) => string;
  templateId: string;
  triggerTime: string;
};

type SaveRoutineScheduleGroupParams = {
  safeInvoke: SafeInvoke;
  studio: RoutineStudioState;
  recipes: Recipe[];
  modules: Module[];
  normalizeScheduleEntry: (entry: unknown, index: number) => RoutineScheduleEntry;
};

type LoadRoutineScheduleGroupParams = {
  safeInvoke: SafeInvoke;
  groupId: string;
  normalizeScheduleEntry: (entry: unknown, index: number) => RoutineScheduleEntry;
  fallbackTitle?: string;
};

type SavedRoutineRecord = {
  id: string;
  scheduleGroupId: string;
  recipeId: string;
  default: {
    start: string;
    durationMinutes: number;
  };
  schedule: Record<string, unknown>;
  title: string;
  subtitle: string;
  assetKind: string;
  assetId: string;
  moduleId?: string;
  startDate?: string;
  endDate?: string;
};

export function buildStudioModulePayload(params: BuildStudioModulePayloadParams): Record<string, unknown> {
  const { editingModuleId, existingModule, moduleId, moduleName, category, description, icon, durationMinutes } = params;
  const resolvedId = editingModuleId || moduleId;
  const base = existingModule ? { ...existingModule } : {};
  return {
    ...base,
    id: resolvedId,
    name: moduleName || resolvedId,
    category: category || "General",
    description,
    icon: icon || "module",
    durationMinutes: Math.max(1, Number(durationMinutes) || 1),
  };
}

export function buildStudioRecipePayload(params: BuildRecipePayloadParams): Record<string, unknown> {
  const { studio } = params;
  if (studio.canvasEntries.length === 0) {
    throw new Error("キャンバスが空です。モジュールを追加してください。");
  }
  const name = studio.draftName.trim() || "Routine Draft";
  const slugBase = routineStudioSlug(studio.templateId || name) || "routine-studio";
  const id = slugBase.startsWith("rcp-") ? slugBase : `rcp-${slugBase}`;
  studio.templateId = id;
  const steps = studio.canvasEntries.map((entry, index) => {
    const durationSeconds = Math.max(60, Math.round((Number(entry.durationMinutes) || 1) * 60));
    const step: Record<string, unknown> = { ...(entry.rawStep || {}) };
    step.id = `step-${index + 1}`;
    step.type = String(entry.stepType || step.type || "micro");
    step.title = String(entry.title || `Step ${index + 1}`);
    step.durationSeconds = durationSeconds;
    delete step.duration_seconds;
    const groupId = String(entry.groupId || "").trim();
    if (groupId) {
      step.groupId = groupId;
    } else {
      delete step.groupId;
      delete step.group_id;
    }
    const moduleId = String(entry.moduleId || "").trim();
    if (moduleId) {
      step.moduleId = moduleId;
    } else {
      delete step.moduleId;
      delete step.module_id;
    }
    const note = String(entry.note || "").trim();
    if (note) {
      step.note = note;
    } else {
      delete step.note;
    }
    if (entry.checklist.length > 0) {
      step.checklist = [...entry.checklist];
    } else {
      delete step.checklist;
    }
    if (entry.pomodoro) {
      step.pomodoro = { ...entry.pomodoro };
    } else {
      delete step.pomodoro;
    }
    if (entry.executionHints) {
      step.executionHints = { ...entry.executionHints };
    } else {
      delete step.executionHints;
      delete step.execution_hints;
    }
    if (entry.overrunPolicy) {
      step.overrunPolicy = entry.overrunPolicy;
    } else {
      delete step.overrunPolicy;
      delete step.overrun_policy;
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
      context: studio.context,
    },
    steps,
  };
}

function buildScheduleObject(recurrence: RoutineScheduleRecurrence): Record<string, unknown> {
  if (recurrence.repeatType === "monthly_date") {
    return {
      type: "monthly",
      dayOfMonth: Math.max(1, Math.min(31, Number(recurrence.dayOfMonth) || 1)),
    };
  }
  if (recurrence.repeatType === "monthly_nth") {
    return {
      type: "monthly_nth",
      nthWeek: Math.max(1, Math.min(5, Number(recurrence.nthWeek) || 1)),
      weekday: String(recurrence.nthWeekday || "mon").toLowerCase(),
    };
  }
  return {
    type: "weekly",
    days: Array.isArray(recurrence.weekdays) ? recurrence.weekdays.map((value) => String(value || "").toLowerCase()).filter(Boolean) : ["mon"],
  };
}

function buildModuleCompanionRecipe(params: {
  entry: RoutineScheduleEntry;
  module: Module;
  recipeId: string;
}): Record<string, unknown> {
  const { entry, module, recipeId } = params;
  const durationMinutes = Math.max(1, Number(entry.durationMinutes || module.durationMinutes || 1));
  const checklist = Array.isArray(module.checklist) ? module.checklist.map(String).filter(Boolean) : [];
  const pomodoro = module.pomodoro && typeof module.pomodoro === "object" ? { ...module.pomodoro } : null;
  const executionHints = module.executionHints && typeof module.executionHints === "object" ? { ...module.executionHints } : null;
  return {
    id: recipeId,
    name: String(entry.title || module.name || recipeId),
    autoDriveMode: "manual",
    steps: [
      {
        id: "step-1",
        type: String(module.stepType || "micro"),
        title: String(entry.title || module.name || recipeId),
        durationSeconds: durationMinutes * 60,
        moduleId: String(module.id || ""),
        ...(checklist.length > 0 ? { checklist } : {}),
        ...(pomodoro ? { pomodoro } : {}),
        ...(executionHints ? { executionHints } : {}),
        ...(module.overrunPolicy ? { overrunPolicy: String(module.overrunPolicy) } : {}),
      },
    ],
    studioMeta: {
      version: 1,
      kind: "routine_studio_schedule_module",
      sourceModuleId: String(module.id || ""),
    },
  };
}

function buildSavedRoutineRecord(params: {
  groupId: string;
  entry: RoutineScheduleEntry;
  recurrence: RoutineScheduleRecurrence;
  recipeId: string;
}): SavedRoutineRecord {
  const { groupId, entry, recurrence, recipeId } = params;
  return {
    id: `rtn-${routineStudioSlug(`${groupId}-${entry.id}`) || entry.id}`,
    scheduleGroupId: groupId,
    recipeId,
    default: {
      start: entry.startTime,
      durationMinutes: Math.max(1, Number(entry.durationMinutes) || 1),
    },
    schedule: buildScheduleObject(recurrence),
    title: entry.title,
    subtitle: entry.subtitle,
    assetKind: entry.assetKind,
    assetId: entry.assetId,
    ...(entry.moduleId ? { moduleId: entry.moduleId } : {}),
    ...(recurrence.startDate ? { startDate: recurrence.startDate } : {}),
    ...(recurrence.endDate ? { endDate: recurrence.endDate } : {}),
  };
}

export async function loadRoutineScheduleGroup(params: LoadRoutineScheduleGroupParams): Promise<{
  entries: RoutineScheduleEntry[];
  recurrence: RoutineScheduleRecurrence;
}> {
  const { safeInvoke, groupId, normalizeScheduleEntry, fallbackTitle = "Scheduled Item" } = params;
  const routinesResult = await safeInvoke("list_routines", {});
  const routines = Array.isArray(routinesResult) ? (routinesResult as Array<Record<string, unknown>>) : [];
  const matched = routines.filter((routine) => String(routine.scheduleGroupId || routine.schedule_group_id || "") === groupId);
  const routineStart = (routine: Record<string, unknown>) => {
    const defaults = (routine.default as Record<string, unknown> | undefined) || {};
    return String(defaults.start || routine.start || "");
  };
  matched.sort((left, right) => routineStart(left).localeCompare(routineStart(right)));
  const first = (matched[0] || {}) as Record<string, unknown>;
  const recurrenceSource = ((first.schedule as Record<string, unknown> | undefined) || {}) as Record<string, unknown>;
  const weekdays = Array.isArray(recurrenceSource.days)
    ? recurrenceSource.days.map(String)
    : recurrenceSource.weekday
      ? [String(recurrenceSource.weekday)]
      : ["mon", "tue", "wed", "thu", "fri"];
  const recurrence: RoutineScheduleRecurrence = {
    repeatType:
      String(recurrenceSource.type || "weekly").toLowerCase() === "monthly_nth"
        ? "monthly_nth"
        : String(recurrenceSource.type || "weekly").toLowerCase() === "monthly"
          ? "monthly_date"
          : "weekly",
    weekdays,
    dayOfMonth: Math.max(1, Number(recurrenceSource.dayOfMonth || recurrenceSource.day_of_month || 1)),
    nthWeek: Math.max(1, Number(recurrenceSource.nthWeek || recurrenceSource.nth_week || 1)),
    nthWeekday: String(recurrenceSource.weekday || "mon").toLowerCase(),
    startDate: String(first.startDate || first.start_date || ""),
    endDate: String(first.endDate || first.end_date || ""),
  };
  return {
    entries: matched.map((routine, index) =>
      normalizeScheduleEntry(
        {
          id: String(routine.id || `schedule-entry-${index + 1}`),
          assetKind: String(routine.assetKind || routine.asset_kind || "template").toLowerCase() === "module" ? "module" : "template",
          assetId: String(routine.assetId || routine.asset_id || routine.recipeId || routine.recipe_id || ""),
          recipeId: String(routine.recipeId || routine.recipe_id || ""),
          moduleId: String(routine.moduleId || routine.module_id || ""),
          title: String(routine.title || routine.name || fallbackTitle),
          subtitle: String(routine.subtitle || ""),
          startTime: String((routine.default as Record<string, unknown> | undefined)?.start || routine.start || "09:00"),
          durationMinutes: Number((routine.default as Record<string, unknown> | undefined)?.durationMinutes || routine.durationMinutes || 25),
        },
        index,
      ),
    ),
    recurrence,
  };
}

export async function saveRoutineScheduleGroup(params: SaveRoutineScheduleGroupParams): Promise<{
  entries: RoutineScheduleEntry[];
  recurrence: RoutineScheduleRecurrence;
}> {
  const { safeInvoke, studio, recipes, modules, normalizeScheduleEntry } = params;
  const groupId =
    String(studio.scheduleGroupId || studio.applyTemplateId || studio.templateId || "").trim() ||
    `rtngrp-${routineStudioSlug(studio.draftName || "routine-schedule") || "routine-schedule"}`;
  studio.scheduleGroupId = groupId;
  const recurrence = studio.scheduleRecurrence;
  const nextEntries = studio.scheduleEntries
    .map((entry, index) => normalizeScheduleEntry(entry, index))
    .filter((entry) => String(entry.assetId || entry.recipeId || "").trim().length > 0);
  const recipeIds = new Set(recipes.map((recipe) => String(recipe.id || "")));
  const persistedRoutines: SavedRoutineRecord[] = [];
  for (const [index, entry] of nextEntries.entries()) {
    let recipeId = String(entry.recipeId || "").trim();
    if (entry.assetKind === "template") {
      recipeId = String(entry.assetId || recipeId).trim();
    } else {
      const module = modules.find((candidate) => candidate.id === entry.assetId);
      if (!module) {
        throw new Error(`module not found: ${entry.assetId}`);
      }
      recipeId = recipeId || `rcp-schedule-${routineStudioSlug(`${groupId}-${entry.id || index}`) || index}`;
      const payload = buildModuleCompanionRecipe({ entry, module, recipeId });
      if (recipeIds.has(recipeId)) {
        await safeInvoke("update_recipe", { recipe_id: recipeId, payload });
      } else {
        const created = (await safeInvoke("create_recipe", { payload })) as Recipe;
        recipes.push(created);
        recipeIds.add(recipeId);
      }
      nextEntries[index] = normalizeScheduleEntry({ ...entry, recipeId, moduleId: module.id }, index);
    }
    persistedRoutines.push(buildSavedRoutineRecord({
      groupId,
      entry: nextEntries[index] || entry,
      recurrence,
      recipeId,
    }));
  }
  await safeInvoke("save_routine_schedule_group", {
    payload: {
      group_id: groupId,
      routines: persistedRoutines,
    },
  });
  return {
    entries: nextEntries,
    recurrence,
  };
}

export async function persistStudioTemplate(params: PersistRecipeParams): Promise<string> {
  const { studio, recipes, safeInvoke } = params;
  const payload = buildStudioRecipePayload({ studio });
  const payloadId = String(payload.id || "");
  const payloadName = String(payload.name || "");
  const exists = recipes.some((recipe) => String(recipe?.id || "") === payloadId);
  if (exists) {
    await safeInvoke("update_recipe", { recipe_id: payloadId, payload });
  } else {
    await safeInvoke("create_recipe", { payload });
  }
  const updatedRecipes = await safeInvoke("list_recipes", {});
  if (Array.isArray(updatedRecipes)) {
    recipes.splice(0, recipes.length, ...(updatedRecipes as Recipe[]));
  }
  studio.templateId = payloadId;
  studio.draftName = payloadName || studio.draftName;
  return payloadId;
}

export async function refreshStudioAssets(
  params: RefreshStudioAssetsParams,
): Promise<{ recipes: Recipe[]; modules: Module[]; moduleFolders: ModuleFolder[] }> {
  const { safeInvoke, normalizeModule, normalizeModuleFolder, fallbackModules, fallbackModuleFolders } = params;
  const [recipesResult, modulesResult, foldersResult] = await Promise.all([
    safeInvoke("list_recipes", {}),
    safeInvoke("list_modules", {}).catch(() => fallbackModules),
    safeInvoke("list_module_folders", {}).catch(() => fallbackModuleFolders),
  ]);
  return {
    recipes: Array.isArray(recipesResult) ? (recipesResult as Recipe[]) : [],
    modules: Array.isArray(modulesResult) ? modulesResult.map((module, index) => normalizeModule(module, index)) : [],
    moduleFolders: Array.isArray(foldersResult)
      ? foldersResult.map((folder, index) => normalizeModuleFolder(folder, index))
      : [],
  };
}

export async function saveStudioModule(params: SaveStudioModuleParams): Promise<Module[]> {
  const { safeInvoke, normalizeModule, editingModuleId, payload } = params;
  if (editingModuleId) {
    await safeInvoke("update_module", { module_id: editingModuleId, payload });
  } else {
    await safeInvoke("create_module", { payload });
  }
  const modulesResult = await safeInvoke("list_modules", {});
  return Array.isArray(modulesResult) ? modulesResult.map((module, index) => normalizeModule(module, index)) : [];
}

export async function deleteStudioModule(params: {
  safeInvoke: SafeInvoke;
  moduleId: string;
  normalizeModule: (module: unknown, index: number) => Module;
}): Promise<{ deleted: boolean; modules: Module[] }> {
  const { safeInvoke, moduleId, normalizeModule } = params;
  const deleted = Boolean(await safeInvoke("delete_module", { module_id: moduleId }));
  if (!deleted) {
    return { deleted: false, modules: [] };
  }
  const modulesResult = await safeInvoke("list_modules", {});
  return {
    deleted: true,
    modules: Array.isArray(modulesResult) ? modulesResult.map((module, index) => normalizeModule(module, index)) : [],
  };
}

export async function deleteStudioRecipe(params: {
  safeInvoke: SafeInvoke;
  recipeId: string;
}): Promise<{ deleted: boolean; recipes: Recipe[] }> {
  const { safeInvoke, recipeId } = params;
  const deleted = Boolean(await safeInvoke("delete_recipe", { recipe_id: recipeId }));
  if (!deleted) {
    return { deleted: false, recipes: [] };
  }
  const recipes = await safeInvoke("list_recipes", {});
  return { deleted: true, recipes: Array.isArray(recipes) ? (recipes as Recipe[]) : [] };
}

export async function createStudioModuleFolder(params: {
  safeInvoke: SafeInvoke;
  name: string;
}): Promise<ModuleFolder> {
  const { safeInvoke, name } = params;
  return (await safeInvoke("create_module_folder", { name })) as ModuleFolder;
}

export async function deleteStudioModuleFolder(params: {
  safeInvoke: SafeInvoke;
  folderId: string;
}): Promise<boolean> {
  const { safeInvoke, folderId } = params;
  return Boolean(await safeInvoke("delete_module_folder", { folder_id: folderId }));
}

export async function moveStudioModuleFolder(params: {
  safeInvoke: SafeInvoke;
  folderId: string;
  direction: string;
}): Promise<ModuleFolder[]> {
  const { safeInvoke, folderId, direction } = params;
  const folders = await safeInvoke("move_module_folder", { folder_id: folderId, direction });
  return Array.isArray(folders) ? (folders as ModuleFolder[]) : [];
}

export async function moveStudioModule(params: {
  safeInvoke: SafeInvoke;
  normalizeModule: (module: unknown, index: number) => Module;
  moduleId: string;
  folderId: string;
  beforeModuleId?: string;
}): Promise<Module[]> {
  const { safeInvoke, normalizeModule, moduleId, folderId, beforeModuleId } = params;
  const modules = await safeInvoke("move_module", {
    module_id: moduleId,
    folder_id: folderId,
    ...(beforeModuleId ? { before_module_id: beforeModuleId } : {}),
  });
  return Array.isArray(modules) ? modules.map((module, index) => normalizeModule(module, index)) : [];
}

export async function applyStudioTemplateToToday(params: ApplyStudioTemplateToTodayParams): Promise<string> {
  const { safeInvoke, refreshCoreData, withAccount, isoDate, formatHHmm, templateId, triggerTime } = params;
  const targetDate = isoDate(new Date());
  const result = (await safeInvoke(
    "apply_studio_template_to_today",
    withAccount({
      template_id: templateId,
      date: targetDate,
      trigger_time: triggerTime || "09:00",
      conflict_policy: "shift",
    }),
  )) as Record<string, unknown>;
  await refreshCoreData(targetDate);
  const requested = formatHHmm(String(result?.requested_start_at || ""));
  const applied = formatHHmm(String(result?.applied_start_at || ""));
  return result?.shifted ? `Shifted ${requested} -> ${applied} (${result?.conflict_count || 0} conflicts)` : `Applied at ${applied}`;
}
