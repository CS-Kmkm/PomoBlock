function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sortByStart(blocks) {
  return [...blocks].sort((left, right) => left.startAt.localeCompare(right.startAt));
}

export class TaskManager {
  constructor({ taskRepository, storageRepository }) {
    this.taskRepository = taskRepository;
    this.storageRepository = storageRepository;
  }

  createTask(title, description = null, estimatedPomodoros = null) {
    return this.taskRepository.save({
      title,
      description,
      estimatedPomodoros,
      status: "pending",
    });
  }

  listTasks() {
    return this.taskRepository.list();
  }

  listAvailableTasks() {
    return this.listTasks().filter((task) => task.status !== "completed");
  }

  assignTaskToBlock(taskId, blockId) {
    const task = this.taskRepository.getById(taskId);
    assert(task, `task not found: ${taskId}`);
    this.taskRepository.update(taskId, { status: "in_progress" });
    return this.taskRepository.assignToBlock(taskId, blockId);
  }

  markTaskCompleted(taskId) {
    const task = this.taskRepository.getById(taskId);
    assert(task, `task not found: ${taskId}`);
    return this.taskRepository.update(taskId, {
      status: "completed",
      completedPomodoros: (task.completedPomodoros ?? 0) + 1,
    });
  }

  splitTask(taskId, parts) {
    assert(Number.isInteger(parts) && parts >= 2, "parts must be >= 2");
    const task = this.taskRepository.getById(taskId);
    assert(task, `task not found: ${taskId}`);

    const children = [];
    const estimated = task.estimatedPomodoros ?? null;
    const childEstimate =
      estimated === null ? null : Math.max(1, Math.ceil(estimated / parts));

    for (let index = 1; index <= parts; index += 1) {
      children.push(
        this.taskRepository.save({
          title: `${task.title} (${index}/${parts})`,
          description: task.description,
          estimatedPomodoros: childEstimate,
          status: "pending",
        })
      );
    }

    this.taskRepository.update(taskId, { status: "deferred" });
    this.taskRepository.recordSplit(
      taskId,
      children.map((taskChild) => taskChild.id)
    );
    return children;
  }

  carryOverTask(taskId, fromBlockId, candidateBlocks) {
    assert(Array.isArray(candidateBlocks), "candidateBlocks must be an array");
    const nextBlock = sortByStart(candidateBlocks).find((block) => !block.taskId);
    assert(nextBlock, "no available block for carry-over");

    this.taskRepository.assignToBlock(taskId, nextBlock.id);
    this.taskRepository.recordCarryOver(taskId, fromBlockId, nextBlock.id);
    return nextBlock.id;
  }
}
