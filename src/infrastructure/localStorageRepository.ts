import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createBlock, createPomodoroLog, createTask } from "../domain/models.js";
import type { Block, PomodoroLog, Task } from "../domain/models.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCHEMA_SQL = readFileSync(join(__dirname, "sql", "schema.sql"), "utf8");

type BlockRow = {
  id: string;
  instance: string;
  date: string;
  start_time: string;
  end_time: string;
  type: Block["type"];
  firmness: Block["firmness"];
  planned_pomodoros: number;
  status: Block["status"];
  source: string;
  source_id: string | null;
  task_refs: string | null;
  calendar_event_id: string | null;
  task_id: string | null;
  created_at: string;
};

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  estimated_pomodoros: number | null;
  completed_pomodoros: number;
  status: Task["status"];
  created_at: string;
};

type PomodoroLogRow = {
  id: string;
  block_id: string;
  task_id: string | null;
  start_time: string;
  end_time: string | null;
  phase: PomodoroLog["phase"];
  interruption_reason: string | null;
};

type SyncStateRow = {
  sync_token: string | null;
  last_sync_time: string;
};

type SuppressionRow = {
  instance: string;
  suppressed_at: string;
  reason: string | null;
};

type AuditLogRow = {
  id: number;
  event_type: string;
  payload_json: string | null;
  created_at: string;
};

type DeleteTaskBlockRow = {
  id: string;
  task_id: string | null;
  task_refs: string | null;
};

type SyncStateInput = {
  syncToken?: string | null;
  lastSyncTime?: string | Date | null;
};

function toIso(value: string | Date): string {
  return new Date(value).toISOString();
}

function removeTaskRef(taskRefsJson: string | null, taskId: string): string {
  const refs = parseTaskRefs(taskRefsJson);
  return JSON.stringify(refs.filter((ref) => ref !== taskId));
}

function parseTaskRefs(taskRefsJson: string | null): string[] {
  try {
    const refs: unknown = JSON.parse(taskRefsJson ?? "[]");
    if (!Array.isArray(refs)) {
      return [];
    }
    return refs.filter((ref): ref is string => typeof ref === "string");
  } catch {
    return [];
  }
}

function hasTaskRef(taskRefsJson: string | null, taskId: string): boolean {
  return parseTaskRefs(taskRefsJson).includes(taskId);
}

export class LocalStorageRepository {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA foreign_keys = ON;");
  }

  initSchema(): void {
    this.db.exec(SCHEMA_SQL);
  }

  close(): void {
    this.db.close();
  }

  saveBlock(blockInput: Partial<Block> & Pick<Block, "startAt" | "endAt">): Block {
    const block = createBlock(blockInput);
    const statement = this.db.prepare(`
      INSERT INTO blocks (
        id, instance, date, start_time, end_time, type, firmness, planned_pomodoros,
        status, source, source_id, task_refs, calendar_event_id, task_id, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        instance = excluded.instance,
        date = excluded.date,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        type = excluded.type,
        firmness = excluded.firmness,
        planned_pomodoros = excluded.planned_pomodoros,
        status = excluded.status,
        source = excluded.source,
        source_id = excluded.source_id,
        task_refs = excluded.task_refs,
        calendar_event_id = excluded.calendar_event_id,
        task_id = excluded.task_id,
        created_at = excluded.created_at
    `);

    statement.run(
      block.id,
      block.instance,
      block.date,
      block.startAt,
      block.endAt,
      block.type,
      block.firmness,
      block.plannedPomodoros,
      block.status,
      block.source,
      block.sourceId,
      JSON.stringify(block.taskRefs),
      block.calendarEventId,
      block.taskId,
      block.createdAt
    );

    return block;
  }

  loadBlocks(date: string): Block[] {
    const statement = this.db.prepare(`SELECT * FROM blocks WHERE date = ? ORDER BY start_time ASC`);
    const rows = statement.all(date) as BlockRow[];
    return rows.map((row) => this.mapBlockRow(row));
  }

  loadAllBlocks(): Block[] {
    const rows = this.db
      .prepare(`SELECT * FROM blocks ORDER BY date ASC, start_time ASC`)
      .all() as BlockRow[];
    return rows.map((row) => this.mapBlockRow(row));
  }

  loadBlockById(blockId: string): Block | null {
    const row = this.db.prepare(`SELECT * FROM blocks WHERE id = ?`).get(blockId) as BlockRow | undefined;
    if (!row) {
      return null;
    }

    return this.mapBlockRow(row);
  }

  saveTask(taskInput: Partial<Task> & Pick<Task, "title">): Task {
    const task = createTask(taskInput);
    const statement = this.db.prepare(`
      INSERT INTO tasks (
        id, title, description, estimated_pomodoros, completed_pomodoros, status, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        estimated_pomodoros = excluded.estimated_pomodoros,
        completed_pomodoros = excluded.completed_pomodoros,
        status = excluded.status
    `);

    statement.run(
      task.id,
      task.title,
      task.description,
      task.estimatedPomodoros,
      task.completedPomodoros,
      task.status,
      task.createdAt
    );
    return task;
  }

  loadTasks(): Task[] {
    const statement = this.db.prepare(`SELECT * FROM tasks ORDER BY created_at ASC`);
    const rows = statement.all() as TaskRow[];
    return rows.map((row) =>
      createTask({
        id: row.id,
        title: row.title,
        description: row.description,
        estimatedPomodoros: row.estimated_pomodoros,
        completedPomodoros: row.completed_pomodoros,
        status: row.status,
        createdAt: row.created_at,
      })
    );
  }

  savePomodoroLog(logInput: Partial<PomodoroLog> & Pick<PomodoroLog, "blockId" | "startTime">): PomodoroLog {
    const log = createPomodoroLog(logInput);
    const statement = this.db.prepare(`
      INSERT INTO pomodoro_logs (
        id, block_id, task_id, start_time, end_time, phase, interruption_reason
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        block_id = excluded.block_id,
        task_id = excluded.task_id,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        phase = excluded.phase,
        interruption_reason = excluded.interruption_reason
    `);

    statement.run(
      log.id,
      log.blockId,
      log.taskId,
      log.startTime,
      log.endTime,
      log.phase,
      log.interruptionReason
    );
    return log;
  }

  loadPomodoroLogs(startAt: string | Date, endAt: string | Date): PomodoroLog[] {
    const statement = this.db.prepare(`
      SELECT * FROM pomodoro_logs
      WHERE start_time >= ? AND start_time <= ?
      ORDER BY start_time ASC
    `);
    const rows = statement.all(toIso(startAt), toIso(endAt)) as PomodoroLogRow[];
    return rows.map((row) =>
      createPomodoroLog({
        id: row.id,
        blockId: row.block_id,
        taskId: row.task_id,
        phase: row.phase,
        startTime: row.start_time,
        endTime: row.end_time,
        interruptionReason: row.interruption_reason,
      })
    );
  }

  saveSyncState(state: SyncStateInput): void {
    const statement = this.db.prepare(`
      INSERT INTO sync_state (id, sync_token, last_sync_time)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        sync_token = excluded.sync_token,
        last_sync_time = excluded.last_sync_time
    `);
    statement.run(state.syncToken ?? null, toIso(state.lastSyncTime ?? new Date()));
  }

  loadSyncState(): { syncToken: string | null; lastSyncTime: string } | null {
    const row = this.db
      .prepare(`SELECT sync_token, last_sync_time FROM sync_state WHERE id = 1`)
      .get() as SyncStateRow | undefined;

    if (!row) {
      return null;
    }
    return {
      syncToken: row.sync_token,
      lastSyncTime: row.last_sync_time,
    };
  }

  saveSuppression(instance: string, reason: string | null = null): void {
    const statement = this.db.prepare(`
      INSERT INTO suppressions (instance, suppressed_at, reason)
      VALUES (?, ?, ?)
      ON CONFLICT(instance) DO UPDATE SET
        suppressed_at = excluded.suppressed_at,
        reason = excluded.reason
    `);
    statement.run(instance, new Date().toISOString(), reason);
  }

  removeSuppression(instance: string): void {
    this.db.prepare(`DELETE FROM suppressions WHERE instance = ?`).run(instance);
  }

  loadSuppressions(): SuppressionRow[] {
    return this.db.prepare(`SELECT * FROM suppressions ORDER BY suppressed_at ASC`).all() as SuppressionRow[];
  }

  appendAuditLog(eventType: string, payload: Record<string, unknown>): void {
    this.db
      .prepare(`
      INSERT INTO audit_logs (event_type, payload_json, created_at)
      VALUES (?, ?, ?)
    `)
      .run(eventType, JSON.stringify(payload ?? {}), new Date().toISOString());
  }

  loadAuditLogs(limit = 100): AuditLogRow[] {
    return this.db
      .prepare(`
      SELECT * FROM audit_logs
      ORDER BY id DESC
      LIMIT ?
    `)
      .all(limit) as AuditLogRow[];
  }

  deletePomodoroLog(logId: string): void {
    this.db.prepare(`DELETE FROM pomodoro_logs WHERE id = ?`).run(logId);
  }

  clearPomodoroLogs(): void {
    this.db.prepare(`DELETE FROM pomodoro_logs`).run();
  }

  deleteBlock(blockId: string): void {
    this.db.prepare(`DELETE FROM pomodoro_logs WHERE block_id = ?`).run(blockId);
    this.db.prepare(`DELETE FROM blocks WHERE id = ?`).run(blockId);
  }

  deleteTask(taskId: string): void {
    this.db.prepare(`DELETE FROM pomodoro_logs WHERE task_id = ?`).run(taskId);

    const relatedBlocks = this.db
      .prepare(`SELECT id, task_id, task_refs FROM blocks WHERE task_id = ? OR task_refs LIKE ?`)
      .all(taskId, `%\"${taskId}\"%`) as DeleteTaskBlockRow[];
    for (const row of relatedBlocks) {
      const hasTaskIdMatch = row.task_id === taskId;
      const hasTaskRefMatch = hasTaskRef(row.task_refs, taskId);
      if (!hasTaskIdMatch && !hasTaskRefMatch) {
        continue;
      }

      this.db
        .prepare(`
        UPDATE blocks
        SET task_id = CASE WHEN task_id = ? THEN NULL ELSE task_id END,
            task_refs = ?
        WHERE id = ?
      `)
        .run(taskId, removeTaskRef(row.task_refs, taskId), row.id);
    }

    this.db.prepare(`DELETE FROM tasks WHERE id = ?`).run(taskId);
  }

  clearSyncState(): void {
    this.db.prepare(`DELETE FROM sync_state WHERE id = 1`).run();
  }

  clearSuppressions(): void {
    this.db.prepare(`DELETE FROM suppressions`).run();
  }

  clearAuditLogs(): void {
    this.db.prepare(`DELETE FROM audit_logs`).run();
  }

  private mapBlockRow(row: BlockRow): Block {
    return createBlock({
      id: row.id,
      instance: row.instance,
      date: row.date,
      startAt: row.start_time,
      endAt: row.end_time,
      type: row.type,
      firmness: row.firmness,
      plannedPomodoros: row.planned_pomodoros,
      status: row.status,
      source: row.source,
      sourceId: row.source_id,
      taskRefs: JSON.parse(row.task_refs ?? "[]") as string[],
      calendarEventId: row.calendar_event_id,
      taskId: row.task_id,
      createdAt: row.created_at,
    });
  }
}
