import { createCommandApi, isUnknownCommandError } from "../commands.js";

type CommandApiOptions = Parameters<typeof createCommandApi>[0];

export interface CommandService {
  isTauriRuntimeAvailable(): boolean;
  invokeCommand(name: string, payload?: Record<string, unknown>): Promise<unknown>;
  safeInvoke(name: string, payload?: Record<string, unknown>): Promise<unknown>;
  safeInvokeWithFallback(
    primaryName: string,
    payload: Record<string, unknown>,
    fallbackName: string,
    fallbackPayload?: Record<string, unknown>
  ): Promise<unknown>;
  invokeCommandWithProgress(name: string, payload?: Record<string, unknown>): Promise<unknown>;
  runUiAction(action: () => Promise<void>): Promise<void>;
}

type CreateCommandServiceOptions = CommandApiOptions & {
  runUiAction: (action: () => Promise<void>) => Promise<void>;
};

export function createCommandService(options: CreateCommandServiceOptions): CommandService {
  const api = createCommandApi(options);
  return {
    ...api,
    runUiAction: options.runUiAction,
  };
}

export { isUnknownCommandError };
