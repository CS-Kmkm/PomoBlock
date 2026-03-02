type TaskLike = {
  id: string;
  title: string;
  description: string | null;
  estimatedPomodoros: number | null;
  completedPomodoros: number;
  status: string;
};

type BlockLike = {
  id: string;
  taskId: string | null;
  startAt?: string;
};

type TaskRepositoryPort = {
  save(taskInput: Partial<TaskLike> & { title: string }): TaskLike;
  list(): TaskLike[];
  getById(taskId: string): TaskLike | null;
  update(taskId: string, updates: Partial<TaskLike>): TaskLike;
  assignToBlock(taskId: string, blockId: string): BlockLike;
  recordSplit(taskId: string, childTaskIds: string[]): void;
  recordCarryOver(taskId: string, fromBlockId: string, toBlockId: string): void;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function sortByStart(blocks: BlockLike[]): BlockLike[] {
  return [...blocks].sort((left, right) => (left.startAt ?? "").localeCompare(right.startAt ?? ""));
}

export class TaskManager {
  private readonly taskRepository: TaskRepositoryPort;

  constructor({ taskRepository }: { taskRepository: TaskRepositoryPort; storageRepository: unknown }) {
    this.taskRepository = taskRepository;
  }

  createTask(title: string, description: string | null = null, estimatedPomodoros: number | null = null): TaskLike {
    return this.taskRepository.save({
      title,
      description,
      estimatedPomodoros,
      status: "pending",
    });
  }

  listTasks(): TaskLike[] {
    return this.taskRepository.list();
  }

  listAvailableTasks(): TaskLike[] {
    return this.listTasks().filter((task) => task.status !== "completed");
  }

  assignTaskToBlock(taskId: string, blockId: string): BlockLike {
    const task = this.taskRepository.getById(taskId);
    assert(task, `task not found: ${taskId}`);
    this.taskRepository.update(taskId, { status: "in_progress" });
    return this.taskRepository.assignToBlock(taskId, blockId);
  }

  markTaskCompleted(taskId: string): TaskLike {
    const task = this.taskRepository.getById(taskId);
    assert(task, `task not found: ${taskId}`);
    return this.taskRepository.update(taskId, {
      status: "completed",
      completedPomodoros: (task.completedPomodoros ?? 0) + 1,
    });
  }

  splitTask(taskId: string, parts: number): TaskLike[] {
    assert(Number.isInteger(parts) && parts >= 2, "parts must be >= 2");
    const task = this.taskRepository.getById(taskId);
    assert(task, `task not found: ${taskId}`);

    const children: TaskLike[] = [];
    const estimated = task.estimatedPomodoros ?? null;
    const childEstimate = estimated === null ? null : Math.max(1, Math.ceil(estimated / parts));

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

  carryOverTask(taskId: string, fromBlockId: string, candidateBlocks: BlockLike[]): string {
    assert(Array.isArray(candidateBlocks), "candidateBlocks must be an array");
    const nextBlock = sortByStart(candidateBlocks).find((block) => !block.taskId);
    assert(nextBlock, "no available block for carry-over");

    this.taskRepository.assignToBlock(taskId, nextBlock.id);
    this.taskRepository.recordCarryOver(taskId, fromBlockId, nextBlock.id);
    return nextBlock.id;
  }
}
