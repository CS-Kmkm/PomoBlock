export {};

type TauriInvoke = <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;

declare global {
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
