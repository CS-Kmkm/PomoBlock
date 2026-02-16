export class PomodoroLogRepository {
  constructor(storageRepository) {
    this.storageRepository = storageRepository;
  }

  save(logInput) {
    return this.storageRepository.savePomodoroLog(logInput);
  }

  load(startAt, endAt) {
    return this.storageRepository.loadPomodoroLogs(startAt, endAt);
  }
}
