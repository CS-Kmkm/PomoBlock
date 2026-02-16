function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseAuditLog(row) {
  return {
    id: row.id,
    eventType: row.event_type,
    payload: JSON.parse(row.payload_json ?? "{}"),
    createdAt: row.created_at,
  };
}

export class TaskRepository {
  constructor(storageRepository) {
    this.storageRepository = storageRepository;
  }

  save(taskInput) {
    return this.storageRepository.saveTask(taskInput);
  }

  list() {
    return this.storageRepository.loadTasks();
  }

  getById(taskId) {
    const found = this.list().find((task) => task.id === taskId);
    return found ?? null;
  }

  update(taskId, updates) {
    const existing = this.getById(taskId);
    assert(existing, `task not found: ${taskId}`);
    return this.save({ ...existing, ...updates, id: taskId });
  }

  assignToBlock(taskId, blockId) {
    const block = this.storageRepository.loadBlockById(blockId);
    assert(block, `block not found: ${blockId}`);

    const updated = this.storageRepository.saveBlock({
      ...block,
      taskId,
      taskRefs: block.taskRefs.includes(taskId)
        ? block.taskRefs
        : [...block.taskRefs, taskId],
    });

    this.storageRepository.appendAuditLog("task_selected", {
      taskId,
      blockId,
      selectedAt: new Date().toISOString(),
    });

    return updated;
  }

  recordCarryOver(taskId, fromBlockId, toBlockId) {
    this.storageRepository.appendAuditLog("task_carried_over", {
      taskId,
      fromBlockId,
      toBlockId,
      createdAt: new Date().toISOString(),
    });
  }

  recordSplit(taskId, childTaskIds) {
    this.storageRepository.appendAuditLog("task_split", {
      taskId,
      childTaskIds,
      createdAt: new Date().toISOString(),
    });
  }

  listTaskAuditLogs(limit = 100) {
    return this.storageRepository
      .loadAuditLogs(limit)
      .map(parseAuditLog)
      .filter((row) => row.eventType.startsWith("task_"));
  }
}
