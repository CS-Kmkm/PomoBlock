import type { RoutineScheduleAssetKind, RoutineStudioDragKind, RoutineStudioEntry, UiState } from "../../types.js";
import type { FolderDropTarget } from "./studio/folder-dnd.js";
import { moveStudioEntryGroupToIndex, removeStudioEntryGroup } from "./studio/entry-groups.js";
import { clearFolderDropIndicators, resolveActiveFolderDrop } from "./studio/folder-dnd.js";

type StudioDragKind = RoutineStudioDragKind | "schedule-entry";
type DragPayload = { kind: StudioDragKind; id: string };

type BindPointerDndParams = {
  appRoot: HTMLElement;
  studio: UiState["routineStudio"];
  rerender: () => void;
  addAssetToCanvas: (
    kind: Exclude<RoutineStudioDragKind, "entry">,
    id: string,
    insertIndex?: number,
  ) => boolean;
  applyCanvasEntries: (nextEntries: RoutineStudioEntry[], recordHistory?: boolean) => void;
  resolveDropInsertIndex: (dropzone: HTMLElement, clientY: number) => number;
  clearDropIndicator: (dropzone: HTMLElement) => void;
  paintDropIndicator: (dropzone: HTMLElement, insertIndex: number) => void;
  moveModuleAsset: (moduleId: string, targetFolderId: string, beforeModuleId?: string) => Promise<void>;
  moveTemplateAsset: (templateId: string, targetFolderId: string, beforeTemplateId?: string) => Promise<void>;
  addScheduleAsset?: (kind: RoutineScheduleAssetKind, id: string, insertIndex?: number) => boolean;
  moveScheduleEntryToIndex?: (entryId: string, insertIndex: number) => boolean;
  resolveScheduleDropInsertIndex?: (dropzone: HTMLElement, clientY: number) => number;
  clearScheduleDropIndicator?: (dropzone: HTMLElement) => void;
  paintScheduleDropIndicator?: (dropzone: HTMLElement, insertIndex: number) => void;
};

export function resolveCommittedFolderDropTarget<T>(params: {
  dragKind: StudioDragKind | "";
  activeFolderDrop: T | null;
  resolveLatestFolderDrop: () => T | null;
}): T | null {
  const { dragKind, activeFolderDrop, resolveLatestFolderDrop } = params;
  if (dragKind !== "module" && dragKind !== "template") {
    return activeFolderDrop;
  }
  return resolveLatestFolderDrop() ?? activeFolderDrop;
}

export function bindRoutineStudioPointerDnd(params: BindPointerDndParams): () => void {
  const {
    appRoot,
    studio,
    rerender,
    addAssetToCanvas,
    applyCanvasEntries,
    resolveDropInsertIndex,
    clearDropIndicator,
    paintDropIndicator,
    moveModuleAsset,
    moveTemplateAsset,
  } = params;

  let activeDrag: DragPayload | null = null;
  let dragGhost: HTMLElement | null = null;
  let dragSource: HTMLElement | null = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let activeFolderDrop: FolderDropTarget | null = null;
  const cleanups: Array<() => void> = [];

  const cleanupDragVisuals = () => {
    if (dragGhost) {
      dragGhost.remove();
      dragGhost = null;
    }
    if (dragSource) {
      dragSource.classList.remove("is-dragging");
      dragSource = null;
    }
  };

  const isNestedInteractiveTarget = (eventTarget: EventTarget | null, owner: HTMLElement): boolean => {
    const target = eventTarget as HTMLElement | null;
    const interactive = target?.closest("button, input, select, textarea, a");
    return Boolean(interactive && interactive !== owner);
  };

  const escapeSelectorValue = (value: string): string => {
    const css = (window as typeof window & { CSS?: { escape?: (input: string) => string } }).CSS;
    return css?.escape ? css.escape(value) : value.replace(/["\\]/g, "\\$&");
  };

  const getScheduleDropzone = (): HTMLElement | null =>
    document.getElementById("routine-schedule-dropzone") ??
    document.getElementById("routine-studio-schedule-dropzone") ??
    appRoot.querySelector<HTMLElement>("[data-studio-schedule-dropzone]") ??
    appRoot.querySelector<HTMLElement>(".rs-schedule-list");

  const getScheduleItemId = (item: HTMLElement): string => {
    const dataset = item.dataset;
    return (
      dataset.studioScheduleEntry ||
      dataset.studioScheduleItem ||
      dataset.studioScheduleId ||
      dataset.dayItemId ||
      item.getAttribute("data-studio-schedule-id") ||
      item.getAttribute("data-day-item-id") ||
      ""
    );
  };

  const getScheduleItems = (dropzone: HTMLElement): HTMLElement[] =>
    Array.from(
      dropzone.querySelectorAll<HTMLElement>(
        "[data-studio-schedule-entry], [data-studio-schedule-item], [data-studio-schedule-draggable='true'], .rs-schedule-item, .day-entry[data-day-item-id]",
      ),
    );

  const moveScheduleEntryToIndex = (entryId: string, insertIndex: number): boolean => {
    const index = studio.scheduleEntries.findIndex((entry) => entry.id === entryId);
    if (index < 0) return false;
    const clampedInsertIndex = Math.max(0, Math.min(insertIndex, studio.scheduleEntries.length));
    if (clampedInsertIndex === index || clampedInsertIndex === index + 1) {
      return false;
    }
    const next = [...studio.scheduleEntries];
    const [entry] = next.splice(index, 1);
    if (!entry) return false;
    const targetIndex = clampedInsertIndex > index ? clampedInsertIndex - 1 : clampedInsertIndex;
    next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, entry);
    studio.scheduleEntries = next;
    studio.scheduleDirty = true;
    return true;
  };

  const resolveScheduleDropInsertIndex = (dropzone: HTMLElement, clientY: number): number => {
    const provided = params.resolveScheduleDropInsertIndex?.(dropzone, clientY);
    if (typeof provided === "number" && Number.isFinite(provided)) {
      return Math.max(0, Math.floor(provided));
    }
    const items = getScheduleItems(dropzone);
    if (items.length === 0) {
      return 0;
    }
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item) continue;
      const rect = item.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        return index;
      }
    }
    return items.length;
  };

  const clearScheduleDropIndicator = (dropzone: HTMLElement) => {
    if (params.clearScheduleDropIndicator) {
      params.clearScheduleDropIndicator(dropzone);
      return;
    }
    dropzone.classList.remove("is-over", "is-insert-end");
    dropzone.querySelectorAll(".is-insert-target").forEach((node) => {
      node.classList.remove("is-insert-target");
    });
  };

  const paintScheduleDropIndicator = (dropzone: HTMLElement, insertIndex: number) => {
    if (params.paintScheduleDropIndicator) {
      params.paintScheduleDropIndicator(dropzone, insertIndex);
      return;
    }
    clearScheduleDropIndicator(dropzone);
    const items = getScheduleItems(dropzone);
    dropzone.classList.add("is-over");
    if (items.length === 0) {
      return;
    }
    if (insertIndex >= items.length) {
      dropzone.classList.add("is-insert-end");
      return;
    }
    const target = items[Math.max(0, insertIndex)];
    if (target) {
      target.classList.add("is-insert-target");
    }
  };

  const updateFolderDropTarget = (clientX: number, clientY: number) => {
    if (!activeDrag || (activeDrag.kind !== "module" && activeDrag.kind !== "template")) {
      clearFolderDropIndicators(appRoot);
      activeFolderDrop = null;
      return;
    }
    activeFolderDrop = resolveActiveFolderDrop({
      appRoot,
      clientX,
      clientY,
      draggedAssetId: activeDrag.id,
      draggedAssetKind: activeDrag.kind,
    });
  };

  const commitStudioDrop = (clientX: number, clientY: number) => {
    const dz = document.getElementById("routine-studio-dropzone");
    const scheduleDropzone = getScheduleDropzone();
    if (!activeDrag) {
      activeDrag = null;
      clearFolderDropIndicators(appRoot);
      if (scheduleDropzone) {
        clearScheduleDropIndicator(scheduleDropzone);
      }
      return;
    }
    const dzRect = dz?.getBoundingClientRect() ?? null;
    const inside =
      dzRect !== null &&
      clientX >= dzRect.left &&
      clientX <= dzRect.right &&
      clientY >= dzRect.top &&
      clientY <= dzRect.bottom;
    const insertIndex = studio.dragInsertIndex >= 0 ? studio.dragInsertIndex : studio.canvasEntries.length;
    const scheduleRect = scheduleDropzone?.getBoundingClientRect() ?? null;
    const insideSchedule =
      scheduleDropzone !== null &&
      scheduleRect !== null &&
      clientX >= scheduleRect.left &&
      clientX <= scheduleRect.right &&
      clientY >= scheduleRect.top &&
      clientY <= scheduleRect.bottom;
    const scheduleInsertIndex = scheduleDropzone ? resolveScheduleDropInsertIndex(scheduleDropzone, clientY) : studio.scheduleEntries.length;
    const drag = activeDrag;
    const folderDrop = resolveCommittedFolderDropTarget({
      dragKind: drag.kind,
      activeFolderDrop,
      resolveLatestFolderDrop: () =>
        resolveActiveFolderDrop({
          appRoot,
          clientX,
          clientY,
          draggedAssetId: drag.id,
          draggedAssetKind: drag.kind === "template" ? "template" : "module",
        }),
    });
    activeDrag = null;
    if (dz) {
      clearDropIndicator(dz);
    }
    clearFolderDropIndicators(appRoot);
    if (scheduleDropzone) {
      clearScheduleDropIndicator(scheduleDropzone);
    }
    activeFolderDrop = null;
    const isScheduleEntryDrag = drag.kind === "schedule-entry";
    if (isScheduleEntryDrag && insideSchedule) {
      if ((params.moveScheduleEntryToIndex ?? moveScheduleEntryToIndex)(drag.id, scheduleInsertIndex)) {
        rerender();
      }
      return;
    }
    if (!inside && !insideSchedule && drag.kind === "entry") {
      applyCanvasEntries(removeStudioEntryGroup(studio.canvasEntries, drag.id), true);
      if (
        studio.entryEditorEntryId &&
        studio.canvasEntries.every((entry) => String(entry.entryId || "") !== studio.entryEditorEntryId)
      ) {
        studio.entryEditorEntryId = "";
      }
      rerender();
      return;
    }
    if (insideSchedule && scheduleDropzone && (drag.kind === "module" || drag.kind === "template")) {
      const addSchedule = params.addScheduleAsset;
      if (addSchedule) {
        if (addSchedule(drag.kind, drag.id, scheduleInsertIndex)) {
          rerender();
        }
      } else {
        const beforeIds = new Set(studio.scheduleEntries.map((entry) => entry.id));
        const addButton = appRoot.querySelector<HTMLButtonElement>(
          `[data-studio-schedule-add-kind="${escapeSelectorValue(drag.kind)}"][data-studio-schedule-add-id="${escapeSelectorValue(drag.id)}"]`,
        );
        addButton?.click();
        const createdEntry = studio.scheduleEntries.find((entry) => !beforeIds.has(entry.id));
        if (createdEntry && scheduleInsertIndex >= 0 && scheduleInsertIndex < studio.scheduleEntries.length - 1) {
          (params.moveScheduleEntryToIndex ?? moveScheduleEntryToIndex)(createdEntry.id, scheduleInsertIndex);
          rerender();
        }
      }
      return;
    }
    if (!inside) {
      if (drag.kind === "module" && folderDrop) {
        void moveModuleAsset(drag.id, folderDrop.folderId, folderDrop.beforeModuleId || undefined);
      } else if (drag.kind === "template" && folderDrop) {
        void moveTemplateAsset(drag.id, folderDrop.folderId, folderDrop.beforeTemplateId || undefined);
      }
      return;
    }
    const { kind, id } = drag;

    if (kind === "entry") {
      const nextEntries = moveStudioEntryGroupToIndex(studio.canvasEntries, id, insertIndex);
      applyCanvasEntries(nextEntries, true);
      studio.selectedEntryId = id;
    } else if (kind === "schedule-entry") {
      if ((params.moveScheduleEntryToIndex ?? moveScheduleEntryToIndex)(id, scheduleInsertIndex)) {
        rerender();
        return;
      }
    } else {
      addAssetToCanvas(kind, id, insertIndex);
    }
    rerender();
  };

  const onRsDragMove = (event: PointerEvent) => {
    if (!dragGhost) return;
    dragGhost.style.left = `${event.clientX - dragOffsetX}px`;
    dragGhost.style.top = `${event.clientY - dragOffsetY}px`;
    const dz = document.getElementById("routine-studio-dropzone");
    const scheduleDropzone = getScheduleDropzone();
    const dzRect = dz?.getBoundingClientRect() ?? null;
    const insideCanvas =
      dzRect !== null &&
      event.clientX >= dzRect.left &&
      event.clientX <= dzRect.right &&
      event.clientY >= dzRect.top &&
      event.clientY <= dzRect.bottom;
    const scheduleRect = scheduleDropzone?.getBoundingClientRect() ?? null;
    const insideSchedule =
      scheduleDropzone !== null &&
      scheduleRect !== null &&
      event.clientX >= scheduleRect.left &&
      event.clientX <= scheduleRect.right &&
      event.clientY >= scheduleRect.top &&
      event.clientY <= scheduleRect.bottom;
    if (insideCanvas && dz) {
      clearFolderDropIndicators(appRoot);
      if (scheduleDropzone) {
        clearScheduleDropIndicator(scheduleDropzone);
      }
      activeFolderDrop = null;
      paintDropIndicator(dz, resolveDropInsertIndex(dz, event.clientY));
    } else if (insideSchedule && scheduleDropzone && (activeDrag?.kind === "module" || activeDrag?.kind === "template" || activeDrag?.kind === "schedule-entry")) {
      if (dz) {
        clearDropIndicator(dz);
      }
      clearFolderDropIndicators(appRoot);
      activeFolderDrop = null;
      paintScheduleDropIndicator(scheduleDropzone, resolveScheduleDropInsertIndex(scheduleDropzone, event.clientY));
    } else {
      if (dz) {
        clearDropIndicator(dz);
      }
      if (scheduleDropzone) {
        clearScheduleDropIndicator(scheduleDropzone);
      }
      updateFolderDropTarget(event.clientX, event.clientY);
    }
  };

  const detachDocumentDragHandlers = () => {
    document.removeEventListener("pointermove", onRsDragMove);
    document.removeEventListener("pointerup", onRsDragUp);
    document.removeEventListener("pointercancel", onRsDragUp);
  };

  const onRsDragUp = (event: PointerEvent) => {
    detachDocumentDragHandlers();
    cleanupDragVisuals();
    commitStudioDrop(event.clientX, event.clientY);
  };

  const startStudioDrag = (event: PointerEvent, payload: DragPayload, sourceEl: HTMLElement) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    activeDrag = payload;
    dragSource = sourceEl;
    sourceEl.classList.add("is-dragging");
    const rect = sourceEl.getBoundingClientRect();
    dragOffsetX = event.clientX - rect.left;
    dragOffsetY = event.clientY - rect.top;
    dragGhost = document.createElement("div");
    dragGhost.className = "rs-drag-ghost";
    const labelEl = sourceEl.querySelector(
      ".rs-asset-title, .rs-canvas-title, .rs-canvas-group-step-title, .rs-schedule-item-title, .day-entry-title",
    );
    dragGhost.textContent = (labelEl ? labelEl.textContent : null) ?? payload.id;
    dragGhost.style.left = `${event.clientX - dragOffsetX}px`;
    dragGhost.style.top = `${event.clientY - dragOffsetY}px`;
    document.body.appendChild(dragGhost);
    document.addEventListener("pointermove", onRsDragMove);
    document.addEventListener("pointerup", onRsDragUp);
    document.addEventListener("pointercancel", onRsDragUp);
  };

  appRoot.querySelectorAll("[data-studio-draggable='true']").forEach((node) => {
    const el = node as HTMLElement;
    const onPointerDown = (event: PointerEvent) => {
      const kind = (el.dataset.studioAssetKind || "") as Exclude<RoutineStudioDragKind, "entry"> | "";
      const id = el.dataset.studioAssetId || "";
      if (!kind || !id) return;
      if (isNestedInteractiveTarget(event.target, el)) return;
      startStudioDrag(event, { kind, id }, el);
    };
    el.addEventListener("pointerdown", onPointerDown);
    cleanups.push(() => el.removeEventListener("pointerdown", onPointerDown));
  });

  appRoot.querySelectorAll("[data-studio-canvas-entry]").forEach((node) => {
    const card = node as HTMLElement;
    const onPointerDown = (event: PointerEvent) => {
      if (isNestedInteractiveTarget(event.target, card)) {
        return;
      }
      const id = card.dataset.studioCanvasEntry || "";
      if (!id) return;
      startStudioDrag(event, { kind: "entry", id }, card);
    };
    card.addEventListener("pointerdown", onPointerDown);
    cleanups.push(() => card.removeEventListener("pointerdown", onPointerDown));
  });

  appRoot
    .querySelectorAll<HTMLElement>(
      "[data-studio-schedule-draggable='true'], [data-studio-schedule-entry], [data-studio-schedule-item], .rs-schedule-item, .day-entry[data-day-item-id]",
    )
    .forEach((node) => {
      const item = node as HTMLElement;
      const onPointerDown = (event: PointerEvent) => {
        if (isNestedInteractiveTarget(event.target, item)) {
          return;
        }
        const id = getScheduleItemId(item);
        if (!id) return;
        startStudioDrag(event, { kind: "schedule-entry", id }, item);
      };
      item.addEventListener("pointerdown", onPointerDown);
      cleanups.push(() => item.removeEventListener("pointerdown", onPointerDown));
    });

  return () => {
    detachDocumentDragHandlers();
    cleanupDragVisuals();
    clearFolderDropIndicators(appRoot);
    const scheduleDropzone = getScheduleDropzone();
    if (scheduleDropzone) {
      clearScheduleDropIndicator(scheduleDropzone);
    }
    activeDrag = null;
    activeFolderDrop = null;
    cleanups.splice(0).forEach((cleanup) => cleanup());
  };
}
