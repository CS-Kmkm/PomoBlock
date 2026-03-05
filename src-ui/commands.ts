import {
  invokeCommand as invokeTauriCommand,
  invokeCommandWithProgress as invokeTauriCommandWithProgress,
  isTauriRuntimeAvailable as isTauriAvailable,
  safeInvoke as safeTauriInvoke,
  safeInvokeWithFallback as safeTauriInvokeWithFallback,
} from "./tauri-contracts.js";
import { isUnknownCommandError } from "./utils/command-errors.js";

export type CommandPayload = Record<string, unknown>;
export type MockInvoke = (name: string, payload: CommandPayload) => Promise<unknown>;

export type CommandApiOptions = {
  setStatus: (message: string) => void;
  mockInvoke: MockInvoke;
  isLongRunning: (name: string) => boolean;
  onBegin: (name: string) => Promise<void> | void;
  onFinish: (success: boolean) => void;
};

export function createCommandApi(options: CommandApiOptions) {
  return {
    isTauriRuntimeAvailable(): boolean {
      return isTauriAvailable();
    },

    async invokeCommand(name: string, payload: CommandPayload = {}): Promise<unknown> {
      return invokeTauriCommand(name as never, payload as never, options.mockInvoke);
    },

    async safeInvoke(name: string, payload: CommandPayload = {}): Promise<unknown> {
      return safeTauriInvoke(name as never, payload as never, options.setStatus, options.mockInvoke);
    },

    async safeInvokeWithFallback(
      primaryName: string,
      payload: CommandPayload,
      fallbackName: string,
      fallbackPayload: CommandPayload = payload
    ): Promise<unknown> {
      return safeTauriInvokeWithFallback(
        primaryName as never,
        payload as never,
        fallbackName as never,
        fallbackPayload as never,
        options.setStatus,
        options.mockInvoke
      );
    },

    async invokeCommandWithProgress(name: string, payload: CommandPayload = {}): Promise<unknown> {
      return invokeTauriCommandWithProgress(name as never, payload as never, {
        isLongRunning: options.isLongRunning,
        onBegin: options.onBegin,
        onFinish: options.onFinish,
        setStatus: options.setStatus,
        mockInvoke: options.mockInvoke,
      });
    },
  };
}

export { isUnknownCommandError };
