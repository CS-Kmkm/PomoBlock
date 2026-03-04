export function resolveDropInsertIndex(dropzone: HTMLElement, clientY: number) {
  const cards = Array.from(dropzone.querySelectorAll("[data-studio-canvas-entry]"));
  for (let index = 0; index < cards.length; index += 1) {
    const rect = (cards[index] as HTMLElement).getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return index;
  }
  return cards.length;
}

export function clearDropIndicator(dropzone: HTMLElement) {
  dropzone.querySelectorAll(".rs-drop-indicator").forEach((node) => node.remove());
}

export function paintDropIndicator(dropzone: HTMLElement, insertIndex: number) {
  clearDropIndicator(dropzone);
  const cards = Array.from(dropzone.querySelectorAll("[data-studio-canvas-entry]"));
  const indicator = document.createElement("div");
  indicator.className = "rs-drop-indicator";
  if (insertIndex >= cards.length) {
    dropzone.appendChild(indicator);
    return;
  }
  const target = cards[insertIndex];
  if (target instanceof HTMLElement) {
    target.parentElement?.insertBefore(indicator, target);
  } else {
    dropzone.appendChild(indicator);
  }
}
