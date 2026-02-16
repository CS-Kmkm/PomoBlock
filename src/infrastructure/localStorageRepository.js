import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createBlock, createPomodoroLog, createTask } from "../domain/models.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCHEMA_SQL = readFileSync(join(__dirname, "sql", "schema.sql"), "utf8");

function toIso(value) {
  return new Date(value).toISOString();
}

function removeTaskRef(taskRefsJson, taskId) {
  const refs = JSON.parse(taskRefsJson ?? "[]");
  if (!Array.isArray(refs)) {
    return "[]";
  }
  return JSON.stringify(refs.filter((ref) => ref !== taskId));
}

export class LocalStorageRepository {
  constructor(databasePath) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA foreign_keys = ON;");
  }

  initSchema() {
    this.db.exec(SCHEMA_SQL);
  }

  close() {
    this.db.close();
  }

  saveBlock(blockInput) {
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

  loadBlocks(date) {
    const statement = this.db.prepare(
      `SELECT * FROM blocks WHERE date = ? ORDER BY start_time ASC`
    );
    const rows = statement.all(date);
    return rows.map((row) =>
      createBlock({
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
        taskRefs: JSON.parse(row.task_refs ?? "[]"),
        calendarEventId: row.calendar_event_id,
        taskId: row.task_id,
        createdAt: row.created_at,
      })
    );
  }

  loadBlockById(blockId) {
    const row = this.db.prepare(`SELECT * FROM blocks WHERE id = ?`).get(blockId);
    if (!row) {
      return null;
    }

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
      taskRefs: JSON.parse(row.task_refs ?? "[]"),
      calendarEventId: row.calendar_event_id,
      taskId: row.task_id,
      createdAt: row.created_at,
    });
  }

  saveTask(taskInput) {
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

  loadTasks() {
    const statement = this.db.prepare(`SELECT * FROM tasks ORDER BY created_at ASC`);
    const rows = statement.all();
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

  savePomodoroLog(logInput) {
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

  loadPomodoroLogs(startAt, endAt) {
    const statement = this.db.prepare(`
      SELECT * FROM pomodoro_logs
      WHERE start_time >= ? AND start_time <= ?
      ORDER BY start_time ASC
    `);
    const rows = statement.all(toIso(startAt), toIso(endAt));
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

  saveSyncState(state) {
    const statement = this.db.prepare(`
      INSERT INTO sync_state (id, sync_token, last_sync_time)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        sync_token = excluded.sync_token,
        last_sync_time = excluded.last_sync_time
    `);
    statement.run(state.syncToken ?? null, toIso(state.lastSyncTime ?? new Date()));
  }

  loadSyncState() {
    const row = this.db
      .prepare(`SELECT sync_token, last_sync_time FROM sync_state WHERE id = 1`)
      .get();

    if (!row) {
      return null;
    }
    return {
      syncToken: row.sync_token,
      lastSyncTime: row.last_sync_time,
    };
  }

  saveSuppression(instance, reason = null) {
    const statement = this.db.prepare(`
      INSERT INTO suppressions (instance, suppressed_at, reason)
      VALUES (?, ?, ?)
      ON CONFLICT(instance) DO UPDATE SET
        suppressed_at = excluded.suppressed_at,
        reason = excluded.reason
    `);
    statement.run(instance, new Date().toISOString(), reason);
  }

  removeSuppression(instance) {
    this.db.prepare(`DELETE FROM suppressions WHERE instance = ?`).run(instance);
  }

  loadSuppressions() {
    return this.db.prepare(`SELECT * FROM suppressions ORDER BY suppressed_at ASC`).all();
  }

  appendAuditLog(eventType, payload) {
    this.db
      .prepare(`
      INSERT INTO audit_logs (event_type, payload_json, created_at)
      VALUES (?, ?, ?)
    `)
      .run(eventType, JSON.stringify(payload ?? {}), new Date().toISOString());
  }

  loadAuditLogs(limit = 100) {
    return this.db
      .prepare(`
      SELECT * FROM audit_logs
      ORDER BY id DESC
      LIMIT ?
    `)
      .all(limit);
  }

  deletePomodoroLog(logId) {
    this.db.prepare(`DELETE FROM pomodoro_logs WHERE id = ?`).run(logId);
  }

  clearPomodoroLogs() {
    this.db.prepare(`DELETE FROM pomodoro_logs`).run();
  }

  deleteBlock(blockId) {
    this.db.prepare(`DELETE FROM pomodoro_logs WHERE block_id = ?`).run(blockId);
    this.db.prepare(`DELETE FROM blocks WHERE id = ?`).run(blockId);
  }

  deleteTask(taskId) {
    this.db.prepare(`DELETE FROM pomodoro_logs WHERE task_id = ?`).run(taskId);

    const relatedBlocks = this.db
      .prepare(`SELECT id, task_refs FROM blocks WHERE task_id = ? OR task_refs LIKE ?`)
      .all(taskId, `%${taskId}%`);
    for (const row of relatedBlocks) {
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

  clearSyncState() {
    this.db.prepare(`DELETE FROM sync_state WHERE id = 1`).run();
  }

  clearSuppressions() {
    this.db.prepare(`DELETE FROM suppressions`).run();
  }

  clearAuditLogs() {
    this.db.prepare(`DELETE FROM audit_logs`).run();
  }
}
