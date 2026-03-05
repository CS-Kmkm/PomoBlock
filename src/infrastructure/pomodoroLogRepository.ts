import type { PomodoroLog } from "../domain/models.js";

type PomodoroLogStoragePort = {
  savePomodoroLog(logInput: Partial<PomodoroLog> & Pick<PomodoroLog, "blockId" | "startTime">): PomodoroLog;
  loadPomodoroLogs(startAt: string, endAt: string): PomodoroLog[];
};

export class PomodoroLogRepository {
  private readonly storageRepository: PomodoroLogStoragePort;

  constructor(storageRepository: PomodoroLogStoragePort) {
    this.storageRepository = storageRepository;
  }

  save(logInput: Partial<PomodoroLog> & Pick<PomodoroLog, "blockId" | "startTime">): PomodoroLog {
    return this.storageRepository.savePomodoroLog(logInput);
  }

  load(startAt: string, endAt: string): PomodoroLog[] {
    return this.storageRepository.loadPomodoroLogs(startAt, endAt);
  }
}
