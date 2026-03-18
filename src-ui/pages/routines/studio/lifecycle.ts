import type { Module, ModuleFolder, Recipe, RoutineStudioEntry, RoutineStudioState } from "../../../types.js";
import { deriveModuleFolders } from "../model.js";

type NormalizeStudioStateParams = {
  studio: RoutineStudioState;
  normalizeModule: (module: unknown, index: number) => Module;
  normalizeModuleFolder: (folder: unknown, index: number) => ModuleFolder;
  normalizeEntry: (entry: unknown, index: number) => RoutineStudioEntry;
  normalizeModuleEditor: (editor: unknown) => RoutineStudioState["moduleEditor"];
  toEntryRecords: (entries: RoutineStudioEntry[]) => RoutineStudioEntry[];
  contextDefault: string;
  slugify: (value: string) => string;
};

type BootstrapStudioStateParams = {
  studio: RoutineStudioState;
  recipes: Recipe[];
  isRoutineStudioRecipe: (recipe: unknown) => boolean;
  syncFromRecipe: (recipe: unknown) => void;
  recipeToEntries: (recipe: unknown) => RoutineStudioEntry[];
  moduleToEntry: (module: Module) => RoutineStudioEntry;
  cloneValue: <T>(value: T) => T;
};

export function normalizeStudioState(params: NormalizeStudioStateParams): void {
  const { studio, normalizeModule, normalizeModuleFolder, normalizeEntry, normalizeModuleEditor, toEntryRecords, contextDefault, slugify } = params;
  studio.assetsLoaded = Boolean(studio.assetsLoaded);
  studio.assetsLoading = Boolean(studio.assetsLoading);
  studio.subPage = ["editor", "schedule"].includes(studio.subPage) ? studio.subPage : "editor";
  studio.search = typeof studio.search === "string" ? studio.search : "";
  studio.draftName = typeof studio.draftName === "string" && studio.draftName.trim() ? studio.draftName : "Routine Draft";
  studio.templateId =
    typeof studio.templateId === "string" && studio.templateId.trim() ? studio.templateId : `rcp-${slugify(studio.draftName) || "routine-studio"}`;
  studio.applyTemplateId = typeof studio.applyTemplateId === "string" ? studio.applyTemplateId : "";
  studio.triggerTime = typeof studio.triggerTime === "string" && /^\d{2}:\d{2}$/.test(studio.triggerTime) ? studio.triggerTime : "09:00";
  studio.context = typeof studio.context === "string" && studio.context.trim() ? studio.context : contextDefault;
  studio.autoStart = Boolean(studio.autoStart);
  studio.modules = Array.isArray(studio.modules) ? studio.modules : [];
  studio.moduleFolders = Array.isArray(studio.moduleFolders) ? studio.moduleFolders : [];
  studio.canvasEntries = Array.isArray(studio.canvasEntries) ? studio.canvasEntries : [];
  studio.history = Array.isArray(studio.history) ? studio.history : [];
  studio.historyIndex = Number.isInteger(studio.historyIndex) ? studio.historyIndex : -1;
  studio.dragInsertIndex = Number.isInteger(studio.dragInsertIndex) ? studio.dragInsertIndex : -1;
  studio.selectedEntryId = typeof studio.selectedEntryId === "string" ? studio.selectedEntryId : "";
  studio.lastApplyResult = typeof studio.lastApplyResult === "string" ? studio.lastApplyResult : "";
  studio.moduleEditor = studio.moduleEditor && typeof studio.moduleEditor === "object" ? studio.moduleEditor : null;
  studio.editingModuleId = typeof studio.editingModuleId === "string" ? studio.editingModuleId : "";
  studio.entryEditorEntryId = typeof studio.entryEditorEntryId === "string" ? studio.entryEditorEntryId : "";
  studio.modules = studio.modules.map(normalizeModule);
  const normalizedFolders = studio.moduleFolders.map(normalizeModuleFolder);
  const derivedFolders = deriveModuleFolders(studio.modules);
  const seenFolderIds = new Set<string>();
  studio.moduleFolders = [...normalizedFolders, ...derivedFolders].filter((folder) => {
    const id = String(folder?.id || "").trim();
    if (!id || seenFolderIds.has(id)) return false;
    seenFolderIds.add(id);
    return true;
  });
  studio.canvasEntries = toEntryRecords(studio.canvasEntries.map((entry, index) => normalizeEntry(entry, index)));
  studio.moduleEditor = studio.moduleEditor ? normalizeModuleEditor(studio.moduleEditor) : null;
  if (studio.moduleEditor && studio.moduleFolders.length > 0) {
    const hasFolder = studio.moduleFolders.some((folder) => folder.id === studio.moduleEditor?.category);
    if (!hasFolder) {
      studio.moduleEditor.category = studio.moduleFolders[0]?.id || "General";
    }
  }
}

export function syncStudioFromRecipe(studio: RoutineStudioState, recipe: unknown): void {
  if (!recipe) return;
  const source = recipe as Record<string, unknown>;
  const autoDriveMode = String(source.auto_drive_mode || source.autoDriveMode || "manual");
  const studioMeta =
    source.studioMeta && typeof source.studioMeta === "object"
      ? (source.studioMeta as Record<string, unknown>)
      : source.studio_meta && typeof source.studio_meta === "object"
        ? (source.studio_meta as Record<string, unknown>)
        : null;
  studio.templateId = String(source.id || studio.templateId);
  studio.applyTemplateId = String(source.id || studio.applyTemplateId);
  studio.draftName = String(source.name || source.id || studio.draftName);
  studio.autoStart = autoDriveMode !== "manual";
  if (studioMeta && typeof studioMeta.context === "string" && studioMeta.context.trim()) {
    studio.context = studioMeta.context.trim();
  }
}

export function bootstrapStudioState(params: BootstrapStudioStateParams): void {
  const { studio, recipes, isRoutineStudioRecipe, syncFromRecipe, recipeToEntries, moduleToEntry, cloneValue } = params;
  const studioRecipes = recipes.filter((recipe) => isRoutineStudioRecipe(recipe));
  if (!studio.bootstrapped) {
    if (studio.canvasEntries.length === 0) {
      studio.canvasEntries = studio.modules.slice(0, 3).map(moduleToEntry);
    }
    if (!studio.applyTemplateId && studioRecipes.length > 0) {
      studio.applyTemplateId = String(studioRecipes[0]?.id || "");
    }
    studio.bootstrapped = true;
    studio.history = [cloneValue(studio.canvasEntries)];
    studio.historyIndex = 0;
    studio.selectedEntryId = String(studio.canvasEntries[0]?.entryId || "");
  }

  if (studio.applyTemplateId && studioRecipes.every((recipe) => String(recipe.id || "") !== studio.applyTemplateId)) {
    studio.applyTemplateId = String(studioRecipes[0]?.id || "");
  }
  if (!studio.applyTemplateId && studioRecipes.length > 0) {
    studio.applyTemplateId = String(studioRecipes[0]?.id || "");
  }

  if (studio.history.length === 0) {
    studio.history = [cloneValue(studio.canvasEntries)];
    studio.historyIndex = 0;
  }
  if (studio.historyIndex < 0 || studio.historyIndex >= studio.history.length) {
    studio.historyIndex = studio.history.length - 1;
  }
  if (!studio.selectedEntryId && studio.canvasEntries.length > 0) {
    studio.selectedEntryId = String(studio.canvasEntries[0]?.entryId || "");
  }
}
