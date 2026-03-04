import type { Module, Recipe, RoutineStudioDragKind, RoutineStudioEntry, RoutineStudioState } from "../types.js";

type RecipeMatcher = (recipe: unknown) => boolean;

export function moduleToStudioEntry(module: Module, normalizeEntry: (entry: unknown, index: number) => RoutineStudioEntry): RoutineStudioEntry {
  return normalizeEntry(
    {
      sourceKind: "module",
      sourceId: module.id,
      moduleId: module.id,
      title: String(module.name || module.id),
      subtitle: String(module.description || module.category || ""),
      durationMinutes: Number(module.durationMinutes || 0) || 5,
      note: "",
    },
    0,
  );
}

export function recipeToStudioEntries(
  recipe: unknown,
  normalizeEntry: (entry: unknown, index: number) => RoutineStudioEntry,
  routineStudioStepDurationMinutes: (step: unknown) => number,
): RoutineStudioEntry[] {
  const source = (recipe ?? {}) as Record<string, unknown>;
  const steps = Array.isArray(source.steps) ? source.steps : [];
  if (steps.length === 0) {
    return [
      normalizeEntry(
        {
          sourceKind: "template",
          sourceId: source.id || "",
          title: source.name || source.id || "ステップ",
          subtitle: "複合モジュール",
          durationMinutes: 5,
          note: "",
        },
        0,
      ),
    ];
  }
  return steps.map((step, index) =>
    normalizeEntry(
      {
        sourceKind: "template",
        sourceId: source.id || "",
        moduleId: String((step as Record<string, unknown>)?.moduleId || (step as Record<string, unknown>)?.module_id || ""),
        title: String((step as Record<string, unknown>)?.title || `Step ${index + 1}`),
        subtitle: source.name || source.id || "複合モジュール",
        durationMinutes: routineStudioStepDurationMinutes(step),
        note: String((step as Record<string, unknown>)?.note || ""),
      },
      index,
    ),
  );
}

type CreateAddAssetToCanvasParams = {
  studio: RoutineStudioState;
  recipes: Recipe[];
  isRoutineStudioRecipe: RecipeMatcher;
  moduleToEntry: (module: Module) => RoutineStudioEntry;
  recipeToEntries: (recipe: unknown) => RoutineStudioEntry[];
  applyCanvasEntries: (nextEntries: RoutineStudioEntry[], recordHistory?: boolean) => void;
  syncFromRecipe: (recipe: unknown) => void;
};

export function createAddAssetToCanvas(params: CreateAddAssetToCanvasParams) {
  const { studio, recipes, isRoutineStudioRecipe, moduleToEntry, recipeToEntries, applyCanvasEntries, syncFromRecipe } = params;
  return (kind: Exclude<RoutineStudioDragKind, "entry">, id: string, replace = false, insertIndex: number = studio.canvasEntries.length): boolean => {
    if (!id) return false;
    const clampedInsertIndex = Math.max(0, Math.min(Number(insertIndex) || 0, studio.canvasEntries.length));
    if (kind === "module") {
      const module = studio.modules.find((candidate) => candidate.id === id);
      if (!module) return false;
      const next = moduleToEntry(module);
      if (replace) {
        applyCanvasEntries([next], true);
      } else {
        const nextEntries = [...studio.canvasEntries];
        nextEntries.splice(clampedInsertIndex, 0, { ...next });
        applyCanvasEntries(nextEntries, true);
      }
      studio.selectedEntryId = next.entryId;
      return true;
    }
    if (kind === "template") {
      const recipe = recipes.find((candidate) => candidate.id === id && isRoutineStudioRecipe(candidate));
      if (!recipe) return false;
      const entries = recipeToEntries(recipe);
      if (replace) {
        applyCanvasEntries(entries, true);
      } else {
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
}
