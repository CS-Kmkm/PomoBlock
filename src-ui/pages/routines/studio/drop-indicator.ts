import type { RoutineStudioState } from "../../../types.js";
import { collectStudioEntryGroups } from "./entry-groups.js";

export function resolveStudioDropInsertIndex(studio: RoutineStudioState, dropzone: HTMLElement, clientY: number): number {
  const cards = Array.from(dropzone.querySelectorAll<HTMLElement>("[data-studio-canvas-entry]"));
  const groups = collectStudioEntryGroups(studio.canvasEntries);
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    if (!card) {
      continue;
    }
    const rect = card.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      return groups[index]?.start ?? studio.canvasEntries.length;
    }
  }
  return studio.canvasEntries.length;
}

export function clearStudioDropIndicator(studio: RoutineStudioState, dropzone: HTMLElement): void {
  dropzone.classList.remove("is-over", "is-insert-end");
  dropzone.querySelectorAll(".is-insert-target").forEach((node) => (node as HTMLElement).classList.remove("is-insert-target"));
  studio.dragInsertIndex = -1;
}

export function paintStudioDropIndicator(studio: RoutineStudioState, dropzone: HTMLElement, insertIndex: number): void {
  clearStudioDropIndicator(studio, dropzone);
  const cards = Array.from(dropzone.querySelectorAll<HTMLElement>(".rs-canvas-card"));
  const groups = collectStudioEntryGroups(studio.canvasEntries);
  const entryCount = studio.canvasEntries.length;
  dropzone.classList.add("is-over");
  if (cards.length === 0) {
    studio.dragInsertIndex = 0;
    return;
  }
  if (insertIndex >= entryCount) {
    dropzone.classList.add("is-insert-end");
    studio.dragInsertIndex = entryCount;
    return;
  }
  if (insertIndex >= 0 && insertIndex < entryCount) {
    const targetIndex = groups.findIndex((group) => group.start >= insertIndex);
    const targetCard = targetIndex >= 0 ? cards[targetIndex] : null;
    if (targetCard) {
      targetCard.classList.add("is-insert-target");
      studio.dragInsertIndex = groups[targetIndex]?.start ?? insertIndex;
      return;
    }
  }
  studio.dragInsertIndex = entryCount;
}
