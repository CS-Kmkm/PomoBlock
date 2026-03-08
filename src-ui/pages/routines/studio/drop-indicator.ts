import type { RoutineStudioState } from "../../../types.js";
import { resolveDropInsertIndex as resolveDropInsertIndexBase } from "../dnd.js";

export function resolveStudioDropInsertIndex(dropzone: HTMLElement, clientY: number): number {
  return resolveDropInsertIndexBase(dropzone, clientY);
}

export function clearStudioDropIndicator(studio: RoutineStudioState, dropzone: HTMLElement): void {
  dropzone.classList.remove("is-over", "is-insert-end");
  dropzone.querySelectorAll(".is-insert-target").forEach((node) => (node as HTMLElement).classList.remove("is-insert-target"));
  studio.dragInsertIndex = -1;
}

export function paintStudioDropIndicator(studio: RoutineStudioState, dropzone: HTMLElement, insertIndex: number): void {
  clearStudioDropIndicator(studio, dropzone);
  const cards = Array.from(dropzone.querySelectorAll(".rs-canvas-card")) as HTMLElement[];
  dropzone.classList.add("is-over");
  if (cards.length === 0) {
    studio.dragInsertIndex = 0;
    return;
  }
  if (insertIndex >= cards.length) {
    dropzone.classList.add("is-insert-end");
    studio.dragInsertIndex = cards.length;
    return;
  }
  if (insertIndex >= 0 && insertIndex < cards.length) {
    const targetCard = cards[insertIndex];
    if (targetCard) {
      targetCard.classList.add("is-insert-target");
    }
    studio.dragInsertIndex = insertIndex;
    return;
  }
  studio.dragInsertIndex = cards.length;
}
