import type { RoutineStudioDragKind, RoutineStudioEntry, RoutineStudioState } from "../types.js";

type BindRoutineStudioEditorEventsParams = {
  appRoot: HTMLElement;
  studio: RoutineStudioState;
  rerender: () => void;
  addAssetToCanvas: (kind: Exclude<RoutineStudioDragKind, "entry">, id: string, replace?: boolean, insertIndex?: number) => boolean;
  applyCanvasEntries: (nextEntries: RoutineStudioEntry[], recordHistory?: boolean) => void;
  updateEntry: (entryId: string, updater: (entry: RoutineStudioEntry) => RoutineStudioEntry) => boolean;
  normalizeEntry: (entry: unknown, index: number) => RoutineStudioEntry;
  toEntryRecords: (entries: RoutineStudioEntry[]) => RoutineStudioEntry[];
  readEntryId: (entry: RoutineStudioEntry | undefined) => string;
  toPositiveInt: (value: unknown, fallback: number, min?: number) => number;
  contextDefault: string;
  cloneValue: <T>(value: T) => T;
};

export function bindRoutineStudioEditorEvents(params: BindRoutineStudioEditorEventsParams): void {
  const {
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
    contextDefault,
    cloneValue,
  } = params;

  appRoot.querySelectorAll("[data-studio-subpage]").forEach((node) => {
    node.addEventListener("click", () => {
      const page = (node as HTMLElement).dataset.studioSubpage || "";
      studio.subPage = page === "schedule" ? "schedule" : "editor";
      rerender();
    });
  });

  document.getElementById("studio-search-input")?.addEventListener("input", (event: Event) => {
    studio.search = (event.currentTarget as HTMLInputElement).value || "";
    rerender();
  });

  appRoot.querySelectorAll("[data-studio-insert-kind]").forEach((node) => {
    node.addEventListener("click", () => {
      const element = node as HTMLElement;
      const kind = element.dataset.studioInsertKind === "template" ? "template" : "module";
      if (addAssetToCanvas(kind, element.dataset.studioInsertId || "")) {
        rerender();
      }
    });
  });

  appRoot.querySelectorAll("[data-studio-load-template]").forEach((node) => {
    node.addEventListener("click", () => {
      const templateId = (node as HTMLElement).dataset.studioLoadTemplate || "";
      if (addAssetToCanvas("template", templateId, true)) {
        rerender();
      }
    });
  });

  appRoot.querySelectorAll("[data-studio-remove]").forEach((node) => {
    node.addEventListener("click", () => {
      const entryId = (node as HTMLElement).dataset.studioRemove || "";
      applyCanvasEntries(studio.canvasEntries.filter((entry) => String(entry.entryId || "") !== entryId), true);
      rerender();
    });
  });

  appRoot.querySelectorAll("[data-studio-move]").forEach((node) => {
    node.addEventListener("click", () => {
      const element = node as HTMLElement;
      const entryId = element.dataset.studioMove || "";
      const direction = element.dataset.studioDir || "";
      const index = studio.canvasEntries.findIndex((entry) => String(entry.entryId || "") === entryId);
      if (index < 0) return;
      const nextIndex = direction === "up" ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= studio.canvasEntries.length) return;
      const nextEntries = [...studio.canvasEntries];
      const current = nextEntries[index];
      const target = nextEntries[nextIndex];
      if (!current || !target) return;
      [nextEntries[index], nextEntries[nextIndex]] = [target, current];
      applyCanvasEntries(nextEntries, true);
      rerender();
    });
  });

  appRoot.querySelectorAll("[data-studio-select-entry]").forEach((node) => {
    node.addEventListener("click", () => {
      const entryId = (node as HTMLElement).dataset.studioSelectEntry || "";
      if (!entryId) return;
      studio.selectedEntryId = entryId;
      rerender();
    });
  });

  appRoot.querySelectorAll("[data-studio-entry-settings]").forEach((node) => {
    node.addEventListener("click", () => {
      const entryId = (node as HTMLElement).dataset.studioEntrySettings || "";
      if (!entryId) return;
      studio.entryEditorEntryId = entryId;
      rerender();
    });
  });

  appRoot.querySelectorAll("[data-studio-entry-field]").forEach((node) => {
    node.addEventListener("change", (event: Event) => {
      const element = event.currentTarget as HTMLElement;
      const entryId = element.dataset.studioEntryId || "";
      const field = element.dataset.studioEntryField || "";
      const value = (event.currentTarget as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
      if (!entryId || !field) return;
      const changed = updateEntry(entryId, (entry) => {
        if (field === "title") {
          entry.title = String(value || "").trim() || entry.title;
        } else if (field === "durationMinutes") {
          entry.durationMinutes = toPositiveInt(value, 1);
        } else if (field === "moduleId") {
          entry.moduleId = String(value || "").trim();
        } else if (field === "note") {
          entry.note = String(value || "");
        }
        return entry;
      });
      if (changed) rerender();
    });
  });

  document.getElementById("studio-undo")?.addEventListener("click", () => {
    if (studio.historyIndex <= 0) return;
    studio.historyIndex -= 1;
    studio.canvasEntries = toEntryRecords((cloneValue(studio.history[studio.historyIndex] || []) as RoutineStudioEntry[]).map((entry, index) => normalizeEntry(entry, index)));
    studio.selectedEntryId = readEntryId(studio.canvasEntries[0]);
    rerender();
  });

  document.getElementById("studio-redo")?.addEventListener("click", () => {
    if (studio.historyIndex >= studio.history.length - 1) return;
    studio.historyIndex += 1;
    studio.canvasEntries = toEntryRecords((cloneValue(studio.history[studio.historyIndex] || []) as RoutineStudioEntry[]).map((entry, index) => normalizeEntry(entry, index)));
    studio.selectedEntryId = readEntryId(studio.canvasEntries[0]);
    rerender();
  });

  document.getElementById("studio-draft-name")?.addEventListener("input", (event: Event) => {
    studio.draftName = (event.currentTarget as HTMLInputElement).value || "Routine Draft";
    const titleNode = appRoot.querySelector("[data-studio-title]");
    if (titleNode) titleNode.textContent = studio.draftName;
  });

  document.getElementById("studio-context")?.addEventListener("change", (event: Event) => {
    studio.context = (event.currentTarget as HTMLSelectElement).value || contextDefault;
  });

  document.getElementById("studio-trigger-time")?.addEventListener("change", (event: Event) => {
    studio.triggerTime = (event.currentTarget as HTMLInputElement).value || "09:00";
    rerender();
  });

  document.getElementById("studio-auto-start")?.addEventListener("change", (event: Event) => {
    studio.autoStart = (event.currentTarget as HTMLInputElement).checked;
  });

  document.getElementById("studio-clear-canvas")?.addEventListener("click", () => {
    applyCanvasEntries([], true);
    studio.selectedEntryId = "";
    rerender();
  });
}
