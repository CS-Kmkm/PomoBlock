import type { Recipe, RoutineStudioState } from "../types.js";
import type { RoutineStudioModuleView } from "./routines-model.js";

type BuildStudioAssetsParams = {
  studio: RoutineStudioState;
  recipes: Recipe[];
  normalizeModule: (module: unknown, index: number) => RoutineStudioModuleView;
  isRoutineStudioRecipe: (recipe: unknown) => boolean;
  routineStudioStepDurationMinutes: (step: unknown) => number;
};

export function buildStudioAssets(params: BuildStudioAssetsParams): {
  moduleAssets: RoutineStudioModuleView[];
  complexModuleAssets: Array<{ id: string; name: string; stepCount: number; totalMinutes: number }>;
  totalMinutes: number;
} {
  const { studio, recipes, normalizeModule, isRoutineStudioRecipe, routineStudioStepDurationMinutes } = params;
  const searchNeedle = studio.search.trim().toLowerCase();

  const moduleAssets = studio.modules.map((module, index) => normalizeModule(module, index)).filter((module) => {
    if (!searchNeedle) return true;
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
      if (!searchNeedle) return true;
      return cm.name.toLowerCase().includes(searchNeedle);
    });

  const totalMinutes = studio.canvasEntries.reduce((sum, entry) => sum + (Number(entry.durationMinutes) || 0), 0);

  return { moduleAssets, complexModuleAssets, totalMinutes };
}
