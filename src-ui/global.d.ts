export {};

type TauriInvoke = <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;

declare global {
  interface Document {
    getElementById(elementId: string): HTMLElement;
  }

  interface HTMLElement {
    value: string;
    checked: boolean;
    dataset: DOMStringMap;
    closest(selectors: string): Element | null;
  }

  interface EventTarget {
    value: string;
    checked: boolean;
    dataset: DOMStringMap;
    closest(selectors: string): Element | null;
  }

  interface Window {
    __TAURI__?: {
      core?: {
        invoke?: TauriInvoke;
      };
      invoke?: TauriInvoke;
    };
    __TAURI_INTERNALS__?: {
      invoke?: TauriInvoke;
    };
  }
}
