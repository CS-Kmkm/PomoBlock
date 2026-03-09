type ReflectionLog = {
  interruptionReason: string | null;
  phase: string;
  endTime: string | null;
  startTime: string;
  [key: string]: unknown;
};

type PomodoroLogRepositoryPort = {
  load(startAt: string, endAt: string): ReflectionLog[];
};

type ReflectionAggregate = {
  startAt: string;
  endAt: string;
  completedCount: number;
  interruptedCount: number;
  totalWorkSeconds: number;
  totalWorkMinutes: number;
  logs: ReflectionLog[];
};

function toTimestamp(value: string): number {
  return new Date(value).getTime();
}

export class ReflectionService {
  private readonly pomodoroLogRepository: PomodoroLogRepositoryPort;

  constructor({ pomodoroLogRepository }: { pomodoroLogRepository: PomodoroLogRepositoryPort }) {
    this.pomodoroLogRepository = pomodoroLogRepository;
  }

  aggregate(startAt: string, endAt: string): ReflectionAggregate {
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

  getLogs(startAt: string, endAt: string): ReflectionLog[] {
    return this.pomodoroLogRepository.load(startAt, endAt);
  }
}
// Legacy reference implementation during the Rust backend migration.
// Production reflection aggregation behavior is sourced from `src-tauri/`.
