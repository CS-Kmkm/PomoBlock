export function getById<T extends HTMLElement = HTMLElement>(elementId: string): T | null {
  return document.getElementById(elementId) as T | null;
}

export function requireById<T extends HTMLElement = HTMLElement>(elementId: string): T {
  const element = getById<T>(elementId);
  if (!element) {
    throw new Error(`required element not found: #${elementId}`);
  }
  return element;
}

export function eventTargetAsInput(target: EventTarget | null): HTMLInputElement | null {
  return target instanceof HTMLInputElement ? target : null;
}

export function eventTargetAsElement(target: EventTarget | null): HTMLElement | null {
  return target instanceof HTMLElement ? target : null;
}
