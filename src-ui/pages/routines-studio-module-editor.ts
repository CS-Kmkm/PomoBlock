import type { Module, RoutineStudioState } from "../types.js";

export function openStudioModuleEditor(
  studio: RoutineStudioState,
  normalizeModuleEditor: (editor: unknown) => RoutineStudioState["moduleEditor"],
  createEmptyModuleEditor: () => RoutineStudioState["moduleEditor"],
  module: Module | null,
): void {
  if (!module) {
    studio.editingModuleId = "";
    studio.moduleEditor = createEmptyModuleEditor();
    return;
  }
  studio.editingModuleId = module.id;
  studio.moduleEditor = normalizeModuleEditor({ ...module });
}

export function closeStudioModuleEditor(studio: RoutineStudioState): void {
  studio.moduleEditor = null;
  studio.editingModuleId = "";
}

export function closeStudioEntryEditor(studio: RoutineStudioState): void {
  studio.entryEditorEntryId = "";
}

export function resolveStudioModule(studio: RoutineStudioState, moduleId: string): Module | null {
  return studio.modules.find((candidate) => candidate.id === moduleId) || null;
}
