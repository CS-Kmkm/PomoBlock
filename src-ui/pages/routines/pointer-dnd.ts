import type { RoutineStudioDragKind, RoutineStudioEntry, UiState } from "../../types.js";

type DragPayload = { kind: RoutineStudioDragKind; id: string };

type BindPointerDndParams = {
  appRoot: HTMLElement;
  studio: UiState["routineStudio"];
  rerender: () => void;
  addAssetToCanvas: (
    kind: Exclude<RoutineStudioDragKind, "entry">,
    id: string,
    replace?: boolean,
    insertIndex?: number,
  ) => boolean;
  applyCanvasEntries: (nextEntries: RoutineStudioEntry[], recordHistory?: boolean) => void;
  resolveDropInsertIndex: (dropzone: HTMLElement, clientY: number) => number;
  clearDropIndicator: (dropzone: HTMLElement) => void;
  paintDropIndicator: (dropzone: HTMLElement, insertIndex: number) => void;
};

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
  } = params;

  let activeDrag: DragPayload | null = null;
  let dragGhost: HTMLElement | null = null;
  let dragSource: HTMLElement | null = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
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

  const commitStudioDrop = (clientX: number, clientY: number) => {
    const dz = document.getElementById("routine-studio-dropzone");
    if (!dz) {
      activeDrag = null;
      return;
    }
    const dzRect = dz.getBoundingClientRect();
    const inside = clientX >= dzRect.left && clientX <= dzRect.right && clientY >= dzRect.top && clientY <= dzRect.bottom;
    const insertIndex = studio.dragInsertIndex >= 0 ? studio.dragInsertIndex : studio.canvasEntries.length;
    clearDropIndicator(dz);
    if (!inside || !activeDrag) {
      activeDrag = null;
      return;
    }
    const { kind, id } = activeDrag;
    activeDrag = null;

    if (kind === "entry") {
      const sourceIndex = studio.canvasEntries.findIndex((entry) => entry.entryId === id);
      if (sourceIndex < 0) return;
      const target = Math.max(0, Math.min(insertIndex, studio.canvasEntries.length));
      const nextEntries = [...studio.canvasEntries];
      const [moved] = nextEntries.splice(sourceIndex, 1);
      if (!moved) return;
      const adjusted = target > sourceIndex ? target - 1 : target;
      nextEntries.splice(Math.max(0, adjusted), 0, moved);
      applyCanvasEntries(nextEntries, true);
      studio.selectedEntryId = moved.entryId;
    } else {
      addAssetToCanvas(kind, id, false, insertIndex);
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
      paintDropIndicator(dz, resolveDropInsertIndex(dz, event.clientY));
    } else {
      clearDropIndicator(dz);
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
    const labelEl = sourceEl.querySelector(".rs-asset-title, .rs-canvas-title");
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

  appRoot.querySelectorAll(".rs-drag-handle").forEach((handle) => {
    const handleEl = handle as HTMLElement;
    const onPointerDown = (event: PointerEvent) => {
      const card = handleEl.closest("[data-studio-canvas-entry]") as HTMLElement | null;
      if (!card) return;
      const id = card.dataset.studioCanvasEntry || "";
      if (!id) return;
      startStudioDrag(event, { kind: "entry", id }, card);
    };
    handleEl.addEventListener("pointerdown", onPointerDown);
    cleanups.push(() => handleEl.removeEventListener("pointerdown", onPointerDown));
  });

  return () => {
    detachDocumentDragHandlers();
    cleanupDragVisuals();
    activeDrag = null;
    cleanups.splice(0).forEach((cleanup) => cleanup());
  };
}
