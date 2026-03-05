import type { Block, Module, PomodoroState, Recipe, ReflectionSummary, SyncedEvent, Task } from "./types.js";
import { isUnknownCommandError } from "./utils/command-errors.js";

export type CommandPayload = Record<string, unknown>;

type AuthResponse = {
  account_id: string;
  status: string;
  authorization_url?: string;
  expires_at?: string;
};

type SyncCalendarResponse = {
  account_id: string;
  added: number;
  updated: number;
  deleted: number;
  next_sync_token?: string;
  calendar_id: string;
};

type CarryOverTaskResponse = {
  task_id: string;
  from_block_id: string;
  to_block_id: string;
  status: string;
};

type ApplyStudioResult = {
  template_id: string;
  date: string;
  requested_start_at: string;
  requested_end_at: string;
  applied_start_at: string;
  applied_end_at: string;
  shifted: boolean;
  conflict_count: number;
  block_id: string;
};

export interface CommandMap {
  bootstrap: { payload: { root?: string }; response: { workspace_root: string; database_path: string } };
  authenticate_google: {
    payload: { account_id?: string; accountId?: string; authorization_code?: string; authorizationCode?: string };
    response: AuthResponse;
  };
  authenticate_google_sso: {
    payload: { account_id?: string; accountId?: string; force_reauth?: boolean; forceReauth?: boolean };
    response: AuthResponse;
  };
  sync_calendar: {
    payload: { account_id?: string; accountId?: string; time_min?: string; timeMin?: string; time_max?: string; timeMax?: string };
    response: SyncCalendarResponse;
  };
  generate_blocks: { payload: { date: string; account_id?: string; accountId?: string }; response: Block[] };
  generate_today_blocks: { payload: { account_id?: string; accountId?: string }; response: Block[] };
  generate_one_block: { payload: { date: string; account_id?: string; accountId?: string }; response: Block[] };
  approve_blocks: { payload: { block_ids: string[]; blockIds?: string[] }; response: Block[] };
  delete_block: { payload: { block_id: string; blockId?: string }; response: boolean };
  adjust_block_time: { payload: { block_id: string; blockId?: string; start_at: string; startAt?: string; end_at: string; endAt?: string }; response: Block };
  relocate_if_needed: { payload: { block_id: string; blockId?: string; account_id?: string; accountId?: string }; response: Block | null };
  list_blocks: { payload: { date?: string }; response: Block[] };
  list_synced_events: { payload: { account_id?: string; accountId?: string; time_min?: string; timeMin?: string; time_max?: string; timeMax?: string }; response: SyncedEvent[] };
  get_pomodoro_state: { payload: {}; response: PomodoroState };
  start_pomodoro: { payload: { block_id: string; blockId?: string; task_id?: string | null; taskId?: string | null }; response: PomodoroState };
  start_block_timer: { payload: { block_id: string; blockId?: string; task_id?: string | null; taskId?: string | null }; response: PomodoroState };
  pause_timer: { payload: { reason?: string }; response: PomodoroState };
  resume_timer: { payload: {}; response: PomodoroState };
  next_step: { payload: {}; response: PomodoroState };
  pause_pomodoro: { payload: { reason?: string }; response: PomodoroState };
  resume_pomodoro: { payload: {}; response: PomodoroState };
  advance_pomodoro: { payload: {}; response: PomodoroState };
  list_tasks: { payload: {}; response: Task[] };
  create_task: { payload: { title: string; description?: string; estimated_pomodoros?: number; estimatedPomodoros?: number }; response: Task };
  update_task: {
    payload: {
      task_id: string;
      taskId?: string;
      title?: string;
      description?: string;
      estimated_pomodoros?: number;
      estimatedPomodoros?: number;
      status?: string;
    };
    response: Task;
  };
  delete_task: { payload: { task_id: string; taskId?: string }; response: boolean };
  split_task: { payload: { task_id: string; taskId?: string; parts: number }; response: Task[] };
  carry_over_task: {
    payload: { task_id: string; taskId?: string; from_block_id: string; fromBlockId?: string; candidate_block_ids?: string[]; candidateBlockIds?: string[] };
    response: CarryOverTaskResponse;
  };
  list_recipes: { payload: {}; response: Recipe[] };
  create_recipe: { payload: { payload: Record<string, unknown> }; response: Recipe };
  update_recipe: { payload: { recipe_id: string; recipeId?: string; payload: Record<string, unknown> }; response: Recipe };
  delete_recipe: { payload: { recipe_id: string; recipeId?: string }; response: boolean };
  list_modules: { payload: {}; response: Module[] };
  create_module: { payload: { payload: Record<string, unknown> }; response: Module };
  update_module: { payload: { module_id: string; moduleId?: string; payload: Record<string, unknown> }; response: Module };
  delete_module: { payload: { module_id: string; moduleId?: string }; response: boolean };
  apply_studio_template_to_today: {
    payload: {
      template_id: string;
      templateId?: string;
      date: string;
      trigger_time: string;
      triggerTime?: string;
      conflict_policy?: string;
      conflictPolicy?: string;
      account_id?: string;
      accountId?: string;
    };
    response: ApplyStudioResult;
  };
  get_reflection_summary: { payload: { start?: string; end?: string }; response: ReflectionSummary };
}

type CommandName = keyof CommandMap;
type PayloadOf<K extends CommandName> = CommandMap[K]["payload"];
type ResponseOf<K extends CommandName> = CommandMap[K]["response"];

type TauriInvoke = <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;

const commandArgAliases: Record<string, Array<[string, string]>> = {
  authenticate_google: [
    ["account_id", "accountId"],
    ["authorization_code", "authorizationCode"],
  ],
  authenticate_google_sso: [
    ["account_id", "accountId"],
    ["force_reauth", "forceReauth"],
  ],
  sync_calendar: [
    ["account_id", "accountId"],
    ["time_min", "timeMin"],
    ["time_max", "timeMax"],
  ],
  generate_blocks: [["account_id", "accountId"]],
  generate_today_blocks: [["account_id", "accountId"]],
  generate_one_block: [["account_id", "accountId"]],
  approve_blocks: [["block_ids", "blockIds"]],
  delete_block: [["block_id", "blockId"]],
  adjust_block_time: [
    ["block_id", "blockId"],
    ["start_at", "startAt"],
    ["end_at", "endAt"],
  ],
  list_synced_events: [
    ["account_id", "accountId"],
    ["time_min", "timeMin"],
    ["time_max", "timeMax"],
  ],
  start_pomodoro: [
    ["block_id", "blockId"],
    ["task_id", "taskId"],
  ],
  start_block_timer: [
    ["block_id", "blockId"],
    ["task_id", "taskId"],
  ],
  pause_timer: [["reason", "reason"]],
  interrupt_timer: [["reason", "reason"]],
  update_recipe: [["recipe_id", "recipeId"]],
  delete_recipe: [["recipe_id", "recipeId"]],
  update_module: [["module_id", "moduleId"]],
  delete_module: [["module_id", "moduleId"]],
  apply_studio_template_to_today: [
    ["template_id", "templateId"],
    ["trigger_time", "triggerTime"],
    ["conflict_policy", "conflictPolicy"],
    ["account_id", "accountId"],
  ],
  create_task: [["estimated_pomodoros", "estimatedPomodoros"]],
  update_task: [
    ["task_id", "taskId"],
    ["estimated_pomodoros", "estimatedPomodoros"],
  ],
  delete_task: [["task_id", "taskId"]],
  split_task: [["task_id", "taskId"]],
  carry_over_task: [
    ["task_id", "taskId"],
    ["from_block_id", "fromBlockId"],
    ["candidate_block_ids", "candidateBlockIds"],
  ],
  relocate_if_needed: [
    ["block_id", "blockId"],
    ["account_id", "accountId"],
  ],
};

function resolveTauriInvoke(): TauriInvoke | null {
  return window.__TAURI__?.core?.invoke ?? window.__TAURI__?.invoke ?? window.__TAURI_INTERNALS__?.invoke ?? null;
}

export function normalizeCommandPayload<K extends CommandName>(name: K, payload: PayloadOf<K> = {} as PayloadOf<K>): PayloadOf<K> {
  const normalized: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
  const aliases = commandArgAliases[name as string] ?? [];
  for (const [snakeKey, camelKey] of aliases) {
    const hasSnake = Object.prototype.hasOwnProperty.call(normalized, snakeKey);
    const hasCamel = Object.prototype.hasOwnProperty.call(normalized, camelKey);
    if (hasSnake && !hasCamel) {
      normalized[camelKey] = normalized[snakeKey];
    } else if (hasCamel && !hasSnake) {
      normalized[snakeKey] = normalized[camelKey];
    }
  }
  return normalized as PayloadOf<K>;
}

export function isTauriRuntimeAvailable(): boolean {
  return Boolean(resolveTauriInvoke());
}

export async function invokeCommand<K extends CommandName>(
  name: K,
  payload: PayloadOf<K> = {} as PayloadOf<K>,
  mockInvoke?: (name: string, payload: Record<string, unknown>) => Promise<unknown>
): Promise<ResponseOf<K>> {
  const normalizedPayload = normalizeCommandPayload(name, payload);
  const tauriInvoke = resolveTauriInvoke();
  if (tauriInvoke) {
    return tauriInvoke<ResponseOf<K>>(name, normalizedPayload as Record<string, unknown>);
  }
  if (!mockInvoke) {
    throw new Error("mockInvoke is required when Tauri runtime is not available");
  }
  const result = await mockInvoke(name, normalizedPayload as Record<string, unknown>);
  return result as ResponseOf<K>;
}

export async function safeInvoke<K extends CommandName>(
  name: K,
  payload: PayloadOf<K> = {} as PayloadOf<K>,
  setStatus?: (message: string) => void,
  mockInvoke?: (name: string, payload: Record<string, unknown>) => Promise<unknown>
): Promise<ResponseOf<K>> {
  try {
    const result = await invokeCommand(name, payload, mockInvoke);
    setStatus?.(`${name} success`);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus?.(`${name} failed: ${message}`);
    throw error;
  }
}

export async function safeInvokeWithFallback<K1 extends CommandName, K2 extends CommandName>(
  primaryName: K1,
  payload: PayloadOf<K1>,
  fallbackName: K2,
  fallbackPayload: PayloadOf<K2>,
  setStatus?: (message: string) => void,
  mockInvoke?: (name: string, payload: Record<string, unknown>) => Promise<unknown>
): Promise<ResponseOf<K1> | ResponseOf<K2>> {
  try {
    return await safeInvoke(primaryName, payload, setStatus, mockInvoke);
  } catch (error) {
    if (!isUnknownCommandError(error)) {
      throw error;
    }
    return safeInvoke(fallbackName, fallbackPayload, setStatus, mockInvoke);
  }
}

export async function invokeCommandWithProgress<K extends CommandName>(
  name: K,
  payload: PayloadOf<K>,
  options: {
    isLongRunning: (name: string) => boolean;
    onBegin: (name: string) => Promise<void> | void;
    onFinish: (success: boolean) => void;
    setStatus?: (message: string) => void;
    mockInvoke?: (name: string, payload: Record<string, unknown>) => Promise<unknown>;
  }
): Promise<ResponseOf<K>> {
  if (!options.isLongRunning(name)) {
    return safeInvoke(name, payload, options.setStatus, options.mockInvoke);
  }
  await options.onBegin(name);
  try {
    const result = await safeInvoke(name, payload, options.setStatus, options.mockInvoke);
    options.onFinish(true);
    return result;
  } catch (error) {
    options.onFinish(false);
    throw error;
  }
}
