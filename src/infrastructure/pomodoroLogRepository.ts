type PomodoroLogLike = Record<string, unknown>;

type PomodoroLogStoragePort = {
  savePomodoroLog(logInput: PomodoroLogLike): unknown;
  loadPomodoroLogs(startAt?: string, endAt?: string): unknown;
};

export class PomodoroLogRepository {
  private readonly storageRepository: PomodoroLogStoragePort;

  constructor(storageRepository: PomodoroLogStoragePort) {
    this.storageRepository = storageRepository;
  }

  save(logInput: PomodoroLogLike): unknown {
    return this.storageRepository.savePomodoroLog(logInput);
  }

  load(startAt?: string, endAt?: string): unknown {
    return this.storageRepository.loadPomodoroLogs(startAt, endAt);
  }
}
