import type { Recipe, RoutineStudioState } from "../../../types.js";
import type { RoutineStudioFolderView, RoutineStudioModuleView } from "../model.js";
import { ROUTINE_STUDIO_DEFAULT_FOLDER_ID, routineStudioRecipeCategory } from "../model.js";

type BuildStudioAssetsParams = {
  studio: RoutineStudioState;
  recipes: Recipe[];
  normalizeModule: (module: unknown, index: number) => RoutineStudioModuleView;
  isRoutineStudioRecipe: (recipe: unknown) => boolean;
  routineStudioStepDurationMinutes: (step: unknown) => number;
};

export function buildStudioAssets(params: BuildStudioAssetsParams): {
  moduleAssets: RoutineStudioModuleView[];
  folderAssets: RoutineStudioFolderView[];
  complexModuleAssets: Array<{ id: string; name: string; category: string; stepCount: number; totalMinutes: number; sortOrder: number }>;
  allComplexModuleAssets: Array<{ id: string; name: string; category: string; stepCount: number; totalMinutes: number; sortOrder: number }>;
  totalMinutes: number;
} {
  const { studio, recipes, normalizeModule, isRoutineStudioRecipe, routineStudioStepDurationMinutes } = params;
  const searchNeedle = studio.search.trim().toLowerCase();

  const moduleAssets = studio.modules.map((module, index) => normalizeModule(module, index)).filter((module) => {
    if (!searchNeedle) return true;
    return `${module.name} ${module.description} ${module.category}`.toLowerCase().includes(searchNeedle);
  });
  const folderAssets: RoutineStudioFolderView[] = [];
  const seenFolderIds = new Set<string>();
  const configuredFolders = Array.isArray(studio.moduleFolders) ? studio.moduleFolders : [];
  configuredFolders.forEach((folder) => {
    const id = String(folder?.id || "").trim();
    if (!id || seenFolderIds.has(id)) return;
    seenFolderIds.add(id);
    folderAssets.push({
      id,
      name: String(folder?.name || id).trim() || id,
      modules: moduleAssets.filter((module) => module.category === id),
      templates: [],
    });
  });
  moduleAssets.forEach((module) => {
    const id = String(module.category || "").trim();
    if (!id || seenFolderIds.has(id)) return;
    seenFolderIds.add(id);
    folderAssets.push({
      id,
      name: id,
      modules: moduleAssets.filter((candidate) => candidate.category === id),
      templates: [],
    });
  });

  const allComplexModuleAssets = recipes
    .filter((recipe) => isRoutineStudioRecipe(recipe))
    .map((recipe, index) => {
      const steps = Array.isArray(recipe?.steps) ? recipe.steps : [];
      const totalMinutes = steps.reduce((sum, step) => sum + routineStudioStepDurationMinutes(step), 0);
      const studioMeta = (recipe?.studioMeta as Record<string, unknown> | undefined) || {};
      const orderValue = Number(studioMeta.order);
      return {
        id: String(recipe.id || ""),
        name: String(recipe.name || recipe.id || "Untitled"),
        category: routineStudioRecipeCategory(recipe, String(studio.moduleFolders[0]?.id || ROUTINE_STUDIO_DEFAULT_FOLDER_ID)),
        stepCount: steps.length,
        totalMinutes,
        sortOrder: Number.isFinite(orderValue) ? orderValue : index * 100,
      };
    })
    .sort((left, right) =>
      left.category.localeCompare(right.category) ||
      left.sortOrder - right.sortOrder ||
      left.name.localeCompare(right.name),
    );

  const complexModuleAssets = allComplexModuleAssets.filter((cm) => {
      if (!searchNeedle) return true;
      return cm.name.toLowerCase().includes(searchNeedle);
    });

  allComplexModuleAssets.forEach((template) => {
    const folderId = String(template.category || "").trim() || ROUTINE_STUDIO_DEFAULT_FOLDER_ID;
    let targetFolder = folderAssets.find((folder) => folder.id === folderId);
    if (!targetFolder) {
      targetFolder = {
        id: folderId,
        name: folderId,
        modules: [],
        templates: [],
      };
      folderAssets.push(targetFolder);
    }
    if (!searchNeedle || template.name.toLowerCase().includes(searchNeedle)) {
      targetFolder.templates.push(template);
    }
  });

  const totalMinutes = studio.canvasEntries.reduce((sum, entry) => sum + (Number(entry.durationMinutes) || 0), 0);

  return { moduleAssets, folderAssets, complexModuleAssets, allComplexModuleAssets, totalMinutes };
}
