import type { RoutineStudioDragKind, RoutineStudioEntry, UiState } from "../../types.js";
import type { FolderDropTarget } from "./studio/folder-dnd.js";
import { moveStudioEntryGroupToIndex, removeStudioEntryGroup } from "./studio/entry-groups.js";
import { clearFolderDropIndicators, resolveActiveFolderDrop } from "./studio/folder-dnd.js";

type DragPayload = { kind: RoutineStudioDragKind; id: string };

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
};

export function resolveCommittedFolderDropTarget<T>(params: {
  dragKind: RoutineStudioDragKind | "";
  activeFolderDrop: T | null;
  resolveLatestFolderDrop: () => T | null;
}): T | null {
  const { dragKind, activeFolderDrop, resolveLatestFolderDrop } = params;
  if (dragKind !== "module") {
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

  const updateFolderDropTarget = (clientX: number, clientY: number) => {
    if (!activeDrag || activeDrag.kind !== "module") {
      clearFolderDropIndicators(appRoot);
      activeFolderDrop = null;
      return;
    }
    activeFolderDrop = resolveActiveFolderDrop({
      appRoot,
      clientX,
      clientY,
      draggedModuleId: activeDrag.id,
    });
  };

  const commitStudioDrop = (clientX: number, clientY: number) => {
    const dz = document.getElementById("routine-studio-dropzone");
    if (!dz || !activeDrag) {
      activeDrag = null;
      clearFolderDropIndicators(appRoot);
      return;
    }
    const dzRect = dz.getBoundingClientRect();
    const inside = clientX >= dzRect.left && clientX <= dzRect.right && clientY >= dzRect.top && clientY <= dzRect.bottom;
    const insertIndex = studio.dragInsertIndex >= 0 ? studio.dragInsertIndex : studio.canvasEntries.length;
    const drag = activeDrag;
    const folderDrop = resolveCommittedFolderDropTarget({
      dragKind: drag.kind,
      activeFolderDrop,
      resolveLatestFolderDrop: () =>
        resolveActiveFolderDrop({
          appRoot,
          clientX,
          clientY,
          draggedModuleId: drag.id,
        }),
    });
    activeDrag = null;
    clearDropIndicator(dz);
    clearFolderDropIndicators(appRoot);
    activeFolderDrop = null;
    if (!inside && drag.kind === "entry") {
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
    if (!inside) {
      if (drag.kind === "module" && folderDrop) {
        void moveModuleAsset(drag.id, folderDrop.folderId, folderDrop.beforeModuleId || undefined);
      }
      return;
    }
    const { kind, id } = drag;

    if (kind === "entry") {
      const nextEntries = moveStudioEntryGroupToIndex(studio.canvasEntries, id, insertIndex);
      applyCanvasEntries(nextEntries, true);
      studio.selectedEntryId = id;
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
    if (!dz) return;
    const dzRect = dz.getBoundingClientRect();
    if (event.clientX >= dzRect.left && event.clientX <= dzRect.right && event.clientY >= dzRect.top && event.clientY <= dzRect.bottom) {
      clearFolderDropIndicators(appRoot);
      activeFolderDrop = null;
      paintDropIndicator(dz, resolveDropInsertIndex(dz, event.clientY));
    } else {
      clearDropIndicator(dz);
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
    const labelEl = sourceEl.querySelector(".rs-asset-title, .rs-canvas-title, .rs-canvas-group-step-title");
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
      if ((event.target as HTMLElement | null)?.closest("button, a")) return;
      startStudioDrag(event, { kind, id }, el);
    };
    el.addEventListener("pointerdown", onPointerDown);
    cleanups.push(() => el.removeEventListener("pointerdown", onPointerDown));
  });

  appRoot.querySelectorAll("[data-studio-canvas-entry]").forEach((node) => {
    const card = node as HTMLElement;
    const onPointerDown = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest("button, input, select, textarea, a")) {
        return;
      }
      const id = card.dataset.studioCanvasEntry || "";
      if (!id) return;
      startStudioDrag(event, { kind: "entry", id }, card);
    };
    card.addEventListener("pointerdown", onPointerDown);
    cleanups.push(() => card.removeEventListener("pointerdown", onPointerDown));
  });

  return () => {
    detachDocumentDragHandlers();
    cleanupDragVisuals();
    clearFolderDropIndicators(appRoot);
    activeDrag = null;
    activeFolderDrop = null;
    cleanups.splice(0).forEach((cleanup) => cleanup());
  };
}
