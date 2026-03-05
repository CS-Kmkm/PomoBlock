import type { Module } from "../types.js";

type BindRoutineStudioAsyncEventsParams = {
  appRoot: HTMLElement;
  resolveModule: (moduleId: string) => Module | null;
  openModuleEditor: (module: Module | null) => void;
  closeModuleEditor: () => void;
  closeEntryEditor: () => void;
  onRefreshAssets: () => Promise<void>;
  onSaveModule: () => Promise<void>;
  onDeleteModule: (moduleId: string) => Promise<void>;
  onSaveTemplate: () => Promise<void>;
  onApplyToday: () => Promise<void>;
  onDeleteRecipe: (recipeId: string) => Promise<void>;
};

export function bindRoutineStudioAsyncEvents(params: BindRoutineStudioAsyncEventsParams): void {
  const {
    appRoot,
    resolveModule,
    openModuleEditor,
    closeModuleEditor,
    closeEntryEditor,
    onRefreshAssets,
    onSaveModule,
    onDeleteModule,
    onSaveTemplate,
    onApplyToday,
    onDeleteRecipe,
  } = params;

  document.getElementById("studio-refresh-recipes")?.addEventListener("click", () => {
    void onRefreshAssets();
  });

  document.getElementById("studio-new-module")?.addEventListener("click", () => {
    openModuleEditor(null);
  });

  document.getElementById("studio-module-cancel")?.addEventListener("click", closeModuleEditor);

  document.getElementById("module-editor-overlay")?.addEventListener("click", (e: Event) => {
    if (e.target === e.currentTarget) {
      closeModuleEditor();
    }
  });

  document.getElementById("entry-editor-overlay")?.addEventListener("click", (e: Event) => {
    if (e.target === e.currentTarget) {
      closeEntryEditor();
    }
  });
  document.getElementById("studio-entry-editor-close")?.addEventListener("click", closeEntryEditor);
  document.getElementById("studio-entry-editor-close-btn")?.addEventListener("click", closeEntryEditor);

  document.getElementById("studio-module-save")?.addEventListener("click", () => {
    void onSaveModule();
  });

  appRoot.querySelectorAll("[data-studio-module-edit]").forEach((node) => {
    node.addEventListener("click", () => {
      const moduleId = (node as HTMLElement).dataset.studioModuleEdit || "";
      if (!moduleId) return;
      const module = resolveModule(moduleId);
      if (!module) return;
      openModuleEditor(module);
    });
  });

  appRoot.querySelectorAll("[data-studio-module-delete]").forEach((node) => {
    node.addEventListener("click", () => {
      const moduleId = (node as HTMLElement).dataset.studioModuleDelete || "";
      if (!moduleId) return;
      void onDeleteModule(moduleId);
    });
  });

  document.getElementById("studio-save-template")?.addEventListener("click", () => {
    void onSaveTemplate();
  });

  document.getElementById("studio-apply-today")?.addEventListener("click", () => {
    void onApplyToday();
  });

  appRoot.querySelectorAll("[data-studio-recipe-delete]").forEach((node) => {
    node.addEventListener("click", () => {
      const recipeId = (node as HTMLElement).dataset.studioRecipeDelete || "";
      if (!recipeId) return;
      void onDeleteRecipe(recipeId);
    });
  });
}
