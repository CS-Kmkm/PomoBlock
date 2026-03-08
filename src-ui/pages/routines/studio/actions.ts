import type { Module, Recipe, RoutineStudioState } from "../../../types.js";
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
  fallbackModules: Module[];
};

type SaveStudioModuleParams = {
  safeInvoke: SafeInvoke;
  normalizeModule: (module: unknown, index: number) => Module;
  editingModuleId: string;
  payload: Record<string, unknown>;
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

export async function refreshStudioAssets(params: RefreshStudioAssetsParams): Promise<{ recipes: Recipe[]; modules: Module[] }> {
  const { safeInvoke, normalizeModule, fallbackModules } = params;
  const [recipesResult, modulesResult] = await Promise.all([
    safeInvoke("list_recipes", {}),
    safeInvoke("list_modules", {}).catch(() => fallbackModules),
  ]);
  return {
    recipes: Array.isArray(recipesResult) ? (recipesResult as Recipe[]) : [],
    modules: Array.isArray(modulesResult) ? modulesResult.map((module, index) => normalizeModule(module, index)) : [],
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
