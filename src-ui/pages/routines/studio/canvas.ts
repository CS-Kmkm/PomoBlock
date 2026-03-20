import type { Module, Recipe, RoutineStudioDragKind, RoutineStudioEntry, RoutineStudioState } from "../../../types.js";
import { nextRoutineStudioEntryGroupId } from "../model.js";

type RecipeMatcher = (recipe: unknown) => boolean;

export function moduleToStudioEntry(module: Module, normalizeEntry: (entry: unknown, index: number) => RoutineStudioEntry): RoutineStudioEntry {
  const durationMinutes = Number(module.durationMinutes || 0) || 5;
  const checklist = Array.isArray(module.checklist) ? module.checklist.map(String).filter(Boolean) : [];
  const pomodoro = module.pomodoro && typeof module.pomodoro === "object" ? { ...module.pomodoro } : null;
  const executionHints =
    module.executionHints && typeof module.executionHints === "object" ? { ...module.executionHints } : null;
  const stepType = String(module.stepType || "micro");
  return normalizeEntry(
    {
      sourceKind: "module",
      sourceId: module.id,
      moduleId: module.id,
      title: String(module.name || module.id),
      subtitle: String(module.description || module.category || ""),
      durationMinutes,
      note: "",
      stepType,
      checklist,
      pomodoro,
      executionHints,
      overrunPolicy: String(module.overrunPolicy || "wait"),
      rawStep: {
        type: stepType,
        title: String(module.name || module.id),
        durationSeconds: Math.max(60, durationMinutes * 60),
        moduleId: module.id,
        ...(checklist.length > 0 ? { checklist } : {}),
        ...(pomodoro ? { pomodoro } : {}),
        ...(executionHints ? { executionHints } : {}),
        ...(module.overrunPolicy ? { overrunPolicy: String(module.overrunPolicy) } : {}),
      },
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
  const groupId = nextRoutineStudioEntryGroupId();
  const steps = Array.isArray(source.steps) ? source.steps : [];
  if (steps.length === 0) {
    return [
      normalizeEntry(
        {
          sourceKind: "template",
          sourceId: source.id || "",
          groupId,
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
    {
      const stepRecord = (step as Record<string, unknown>) || {};
      return normalizeEntry(
        {
          sourceKind: "template",
          sourceId: source.id || "",
          groupId,
          moduleId: String(stepRecord.moduleId || stepRecord.module_id || ""),
          title: String(stepRecord.title || `Step ${index + 1}`),
          subtitle: source.name || source.id || "複合モジュール",
          durationMinutes: routineStudioStepDurationMinutes(step),
          note: String(stepRecord.note || ""),
          stepType: String(stepRecord.type || stepRecord.stepType || stepRecord.step_type || "micro"),
          checklist: Array.isArray(stepRecord.checklist) ? stepRecord.checklist.map(String).filter(Boolean) : [],
          pomodoro: stepRecord.pomodoro && typeof stepRecord.pomodoro === "object" ? { ...stepRecord.pomodoro } : null,
          executionHints:
            (stepRecord.executionHints && typeof stepRecord.executionHints === "object" ? { ...stepRecord.executionHints } : null) ||
            (stepRecord.execution_hints && typeof stepRecord.execution_hints === "object" ? { ...stepRecord.execution_hints } : null),
          overrunPolicy: String(stepRecord.overrunPolicy || stepRecord.overrun_policy || "wait"),
          rawStep: { ...stepRecord },
        },
        index,
      );
    },
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
  return (kind: Exclude<RoutineStudioDragKind, "entry">, id: string, insertIndex: number = studio.canvasEntries.length): boolean => {
    if (!id) return false;
    const clampedInsertIndex = Math.max(0, Math.min(Number(insertIndex) || 0, studio.canvasEntries.length));
    if (kind === "module") {
      const module = studio.modules.find((candidate) => candidate.id === id);
      if (!module) return false;
      const next = moduleToEntry(module);
      const nextEntries = [...studio.canvasEntries];
      nextEntries.splice(clampedInsertIndex, 0, { ...next });
      applyCanvasEntries(nextEntries, true);
      studio.selectedEntryId = next.entryId;
      return true;
    }
    if (kind === "template") {
      const recipe = recipes.find((candidate) => candidate.id === id && isRoutineStudioRecipe(candidate));
      if (!recipe) return false;
      const entries = recipeToEntries(recipe);
      const nextEntries = [...studio.canvasEntries];
      nextEntries.splice(clampedInsertIndex, 0, ...entries);
      applyCanvasEntries(nextEntries, true);
      syncFromRecipe(recipe);
      studio.selectedEntryId = entries[0]?.entryId || studio.selectedEntryId;
      return true;
    }
    return false;
  };
}
