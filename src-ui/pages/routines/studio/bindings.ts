import type { RoutineScheduleAssetKind, RoutineStudioDragKind, RoutineStudioEntry, RoutineStudioState } from "../../../types.js";
import { canMoveStudioEntryGroup, moveStudioEntryGroupByDirection, removeStudioEntryGroup } from "./entry-groups.js";

type BindRoutineStudioEditorEventsParams = {
  appRoot: HTMLElement;
  studio: RoutineStudioState;
  rerender: () => void;
  addAssetToCanvas: (kind: Exclude<RoutineStudioDragKind, "entry">, id: string, insertIndex?: number) => boolean;
  applyCanvasEntries: (nextEntries: RoutineStudioEntry[], recordHistory?: boolean) => void;
  updateEntry: (entryId: string, updater: (entry: RoutineStudioEntry) => RoutineStudioEntry) => boolean;
  normalizeEntry: (entry: unknown, index: number) => RoutineStudioEntry;
  toEntryRecords: (entries: RoutineStudioEntry[]) => RoutineStudioEntry[];
  readEntryId: (entry: RoutineStudioEntry | undefined) => string;
  toPositiveInt: (value: unknown, fallback: number, min?: number) => number;
  contextDefault: string;
  cloneValue: <T>(value: T) => T;
  addScheduleAsset: (kind: RoutineScheduleAssetKind, id: string, insertIndex?: number) => boolean;
  updateScheduleField: (entryId: string, field: string, value: string) => boolean;
};

function filterStudioAssets(appRoot: HTMLElement, query: string): void {
  const needle = query.trim().toLowerCase();
  const assetCards = Array.from(appRoot.querySelectorAll<HTMLElement>("[data-studio-search-text]"));
  let visibleCount = 0;
  assetCards.forEach((card) => {
    const haystack = String(card.dataset.studioSearchText || "").toLowerCase();
    const visible = !needle || haystack.includes(needle);
    card.hidden = !visible;
    if (visible) {
      visibleCount += 1;
    }
  });
  appRoot.querySelectorAll<HTMLElement>("[data-studio-asset-group]").forEach((group) => {
    const isFolderGroup = group.dataset.studioFolderGroup === "true";
    const hasVisibleCard = Array.from(group.querySelectorAll<HTMLElement>("[data-studio-search-text]")).some((card) => !card.hidden);
    group.hidden = !isFolderGroup && !hasVisibleCard;
    const folderEmpty = group.querySelector<HTMLElement>("[data-studio-folder-empty]");
    if (folderEmpty) {
      folderEmpty.hidden = hasVisibleCard;
    }
  });
  const emptyState = appRoot.querySelector<HTMLElement>("#studio-assets-empty");
  if (emptyState) {
    emptyState.hidden = visibleCount > 0;
  }
}

function readScheduleEntryId(node: HTMLElement): string {
  return (
    node.dataset.studioScheduleSelect ||
    node.dataset.studioScheduleEntry ||
    node.dataset.dayItemId ||
    node.getAttribute("data-studio-schedule-id") ||
    node.getAttribute("data-day-item-id") ||
    ""
  );
}

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
    addScheduleAsset,
    updateScheduleField,
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
    filterStudioAssets(appRoot, studio.search);
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

  appRoot.querySelectorAll("[data-studio-remove]").forEach((node) => {
    node.addEventListener("click", () => {
      const entryId = (node as HTMLElement).dataset.studioRemove || "";
      applyCanvasEntries(removeStudioEntryGroup(studio.canvasEntries, entryId), true);
      if (
        studio.entryEditorEntryId &&
        studio.canvasEntries.every((entry) => String(entry.entryId || "") !== studio.entryEditorEntryId)
      ) {
        studio.entryEditorEntryId = "";
      }
      rerender();
    });
  });

  appRoot.querySelectorAll("[data-studio-move]").forEach((node) => {
    node.addEventListener("click", () => {
      const element = node as HTMLElement;
      const entryId = element.dataset.studioMove || "";
      const direction = element.dataset.studioDir || "";
      if (direction !== "up" && direction !== "down") return;
      if (!canMoveStudioEntryGroup(studio.canvasEntries, entryId, direction)) return;
      const nextEntries = moveStudioEntryGroupByDirection(studio.canvasEntries, entryId, direction);
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

  document.getElementById("studio-apply-template")?.addEventListener("change", (event: Event) => {
    studio.applyTemplateId = (event.currentTarget as HTMLSelectElement).value || "";
    rerender();
  });

  document.getElementById("studio-schedule-group")?.addEventListener("change", (event: Event) => {
    studio.scheduleGroupId = (event.currentTarget as HTMLSelectElement).value || "";
    rerender();
  });

  document.getElementById("studio-trigger-time")?.addEventListener("change", (event: Event) => {
    studio.triggerTime = (event.currentTarget as HTMLInputElement).value || "09:00";
    rerender();
  });

  document.getElementById("studio-auto-start")?.addEventListener("change", (event: Event) => {
    studio.autoStart = (event.currentTarget as HTMLInputElement).checked;
  });

  appRoot.querySelectorAll("[data-studio-schedule-add-kind]").forEach((node) => {
    node.addEventListener("click", () => {
      const element = node as HTMLElement;
      const kind = element.dataset.studioScheduleAddKind === "module" ? "module" : "template";
      if (addScheduleAsset(kind, element.dataset.studioScheduleAddId || "")) {
        rerender();
      }
    });
  });

  appRoot.querySelectorAll("[data-studio-schedule-select], [data-studio-schedule-entry], [data-day-item-kind='event'][data-day-item-id]").forEach((node) => {
    node.addEventListener("click", () => {
      const scheduleId = readScheduleEntryId(node as HTMLElement);
      if (!scheduleId) return;
      studio.scheduleSelectedEntryId = scheduleId;
      rerender();
    });
  });

  appRoot.querySelectorAll("[data-studio-schedule-field]").forEach((node) => {
    node.addEventListener("change", (event: Event) => {
      const element = event.currentTarget as HTMLElement;
      const scheduleId = element.dataset.studioScheduleId || "";
      const field = element.dataset.studioScheduleField || "";
      const value = (event.currentTarget as HTMLInputElement | HTMLSelectElement).value || "";
      if (!scheduleId || !field) return;
      if (updateScheduleField(scheduleId, field, value)) {
        rerender();
      }
    });
  });

  appRoot.querySelectorAll("[data-studio-saved-schedule-select]").forEach((node) => {
    node.addEventListener("click", () => {
      const groupId = (node as HTMLElement).dataset.studioSavedScheduleSelect || "";
      if (!groupId) return;
      studio.scheduleGroupId = groupId;
      rerender();
    });
  });

  appRoot.querySelectorAll("[data-studio-schedule-remove]").forEach((node) => {
    node.addEventListener("click", () => {
      const scheduleId = (node as HTMLElement).dataset.studioScheduleRemove || "";
      if (!scheduleId) return;
      studio.scheduleEntries = studio.scheduleEntries.filter((entry) => entry.id !== scheduleId);
      if (studio.scheduleSelectedEntryId === scheduleId) {
        studio.scheduleSelectedEntryId = String(studio.scheduleEntries[0]?.id || "");
      }
      studio.scheduleDirty = true;
      rerender();
    });
  });

  appRoot.querySelectorAll("[data-studio-schedule-move]").forEach((node) => {
    node.addEventListener("click", () => {
      const element = node as HTMLElement;
      const scheduleId = element.dataset.studioScheduleMove || "";
      const direction = element.dataset.studioDir || "";
      const index = studio.scheduleEntries.findIndex((entry) => entry.id === scheduleId);
      if (index < 0 || (direction !== "up" && direction !== "down")) return;
      const swapIndex = direction === "up" ? index - 1 : index + 1;
      if (swapIndex < 0 || swapIndex >= studio.scheduleEntries.length) return;
      const next = [...studio.scheduleEntries];
      const current = next[index];
      const swap = next[swapIndex];
      if (!current || !swap) return;
      next[index] = swap;
      next[swapIndex] = current;
      studio.scheduleEntries = next;
      studio.scheduleDirty = true;
      rerender();
    });
  });

  document.getElementById("studio-schedule-add-gap")?.addEventListener("click", () => {
    if (addScheduleAsset("module", "__empty__")) {
      rerender();
    }
  });

  appRoot.querySelectorAll("[data-studio-repeat-type]").forEach((node) => {
    node.addEventListener("click", () => {
      const repeatType = (node as HTMLElement).dataset.studioRepeatType || "weekly";
      if (repeatType !== "weekly" && repeatType !== "monthly_date" && repeatType !== "monthly_nth") return;
      studio.scheduleRecurrence.repeatType = repeatType;
      studio.scheduleDirty = true;
      rerender();
    });
  });

  appRoot.querySelectorAll("[data-studio-repeat-weekday]").forEach((node) => {
    node.addEventListener("change", (event: Event) => {
      const checkbox = event.currentTarget as HTMLInputElement;
      const weekday = checkbox.dataset.studioRepeatWeekday || "";
      const next = new Set(studio.scheduleRecurrence.weekdays);
      if (checkbox.checked) {
        next.add(weekday);
      } else {
        next.delete(weekday);
      }
      studio.scheduleRecurrence.weekdays = [...next];
      studio.scheduleDirty = true;
      rerender();
    });
  });

  document.getElementById("studio-repeat-day-of-month")?.addEventListener("change", (event: Event) => {
    studio.scheduleRecurrence.dayOfMonth = toPositiveInt((event.currentTarget as HTMLInputElement).value, 1);
    studio.scheduleDirty = true;
    rerender();
  });

  document.getElementById("studio-repeat-nth-week")?.addEventListener("change", (event: Event) => {
    studio.scheduleRecurrence.nthWeek = toPositiveInt((event.currentTarget as HTMLSelectElement).value, 1);
    studio.scheduleDirty = true;
    rerender();
  });

  document.getElementById("studio-repeat-nth-weekday")?.addEventListener("change", (event: Event) => {
    studio.scheduleRecurrence.nthWeekday = (event.currentTarget as HTMLSelectElement).value || "mon";
    studio.scheduleDirty = true;
    rerender();
  });

  document.getElementById("studio-repeat-start-date")?.addEventListener("change", (event: Event) => {
    studio.scheduleRecurrence.startDate = (event.currentTarget as HTMLInputElement).value || "";
    studio.scheduleDirty = true;
    rerender();
  });

  document.getElementById("studio-repeat-end-date")?.addEventListener("change", (event: Event) => {
    studio.scheduleRecurrence.endDate = (event.currentTarget as HTMLInputElement).value || "";
    studio.scheduleDirty = true;
    rerender();
  });

  document.getElementById("studio-clear-canvas")?.addEventListener("click", () => {
    applyCanvasEntries([], true);
    studio.selectedEntryId = "";
    rerender();
  });

  filterStudioAssets(appRoot, studio.search);
}
