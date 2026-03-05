import type { Block, Task } from "../domain/models.js";

type AuditLogRow = {
  id: number;
  event_type: string;
  payload_json: string | null;
  created_at: string;
};

type TaskAuditLog = {
  id: number;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

type StorageRepositoryPort = {
  saveTask(taskInput: Partial<Task> & Pick<Task, "title">): Task;
  loadTasks(): Task[];
  loadBlockById(blockId: string): Block | null;
  saveBlock(blockInput: Partial<Block> & Pick<Block, "startAt" | "endAt">): Block;
  appendAuditLog(eventType: string, payload: Record<string, unknown>): void;
  loadAuditLogs(limit: number): AuditLogRow[];
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function parseAuditLog(row: AuditLogRow): TaskAuditLog {
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.payload_json ?? "{}");
    if (parsed && typeof parsed === "object") {
      payload = parsed as Record<string, unknown>;
    }
  } catch {
    payload = {};
  }

  return {
    id: row.id,
    eventType: row.event_type,
    payload,
    createdAt: row.created_at,
  };
}

export class TaskRepository {
  private readonly storageRepository: StorageRepositoryPort;

  constructor(storageRepository: StorageRepositoryPort) {
    this.storageRepository = storageRepository;
  }

  save(taskInput: Partial<Task> & Pick<Task, "title">): Task {
    return this.storageRepository.saveTask(taskInput);
  }

  list(): Task[] {
    return this.storageRepository.loadTasks();
  }

  getById(taskId: string): Task | null {
    const found = this.list().find((task) => task.id === taskId);
    return found ?? null;
  }

  update(taskId: string, updates: Partial<Task>): Task {
    const existing = this.getById(taskId);
    assert(existing, `task not found: ${taskId}`);
    return this.save({ ...existing, ...updates, id: taskId, title: existing.title });
  }

  assignToBlock(taskId: string, blockId: string): Block {
    const block = this.storageRepository.loadBlockById(blockId);
    assert(block, `block not found: ${blockId}`);

    const updated = this.storageRepository.saveBlock({
      ...block,
      taskId,
      taskRefs: block.taskRefs.includes(taskId) ? block.taskRefs : [...block.taskRefs, taskId],
    });

    this.storageRepository.appendAuditLog("task_selected", {
      taskId,
      blockId,
      selectedAt: new Date().toISOString(),
    });

    return updated;
  }

  recordCarryOver(taskId: string, fromBlockId: string, toBlockId: string): void {
    this.storageRepository.appendAuditLog("task_carried_over", {
      taskId,
      fromBlockId,
      toBlockId,
      createdAt: new Date().toISOString(),
    });
  }

  recordSplit(taskId: string, childTaskIds: string[]): void {
    this.storageRepository.appendAuditLog("task_split", {
      taskId,
      childTaskIds,
      createdAt: new Date().toISOString(),
    });
  }

  listTaskAuditLogs(limit = 100): TaskAuditLog[] {
    return this.storageRepository
      .loadAuditLogs(limit)
      .map(parseAuditLog)
      .filter((row) => row.eventType.startsWith("task_"));
  }
}
