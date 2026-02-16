function toTimestamp(value) {
  return new Date(value).getTime();
}

export class ReflectionService {
  constructor({ pomodoroLogRepository }) {
    this.pomodoroLogRepository = pomodoroLogRepository;
  }

  aggregate(startAt, endAt) {
    const logs = this.pomodoroLogRepository.load(startAt, endAt);
    let completedCount = 0;
    let interruptedCount = 0;
    let totalWorkSeconds = 0;

    for (const log of logs) {
      if (log.interruptionReason) {
        interruptedCount += 1;
      }

      if (log.phase !== "focus") {
        continue;
      }
      if (!log.endTime) {
        continue;
      }

      const durationSeconds = Math.max(0, Math.floor((toTimestamp(log.endTime) - toTimestamp(log.startTime)) / 1000));
      totalWorkSeconds += durationSeconds;
      if (!log.interruptionReason) {
        completedCount += 1;
      }
    }

    return {
      startAt: new Date(startAt).toISOString(),
      endAt: new Date(endAt).toISOString(),
      completedCount,
      interruptedCount,
      totalWorkSeconds,
      totalWorkMinutes: Math.floor(totalWorkSeconds / 60),
      logs,
    };
  }

  getLogs(startAt, endAt) {
    return this.pomodoroLogRepository.load(startAt, endAt);
  }
}
