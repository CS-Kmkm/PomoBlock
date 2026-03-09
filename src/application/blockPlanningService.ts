// Legacy reference implementation during the Rust backend migration.
// Production block planning behavior is sourced from `src-tauri/`.

import { BlockGenerator } from "../domain/blockGenerator.js";
import type { Block, Policy } from "../domain/models.js";

type Interval = {
  start: Date;
  end: Date;
};

type EventLike = {
  startAt?: string;
  endAt?: string;
  start?: string;
  end?: string;
};

type BlockGenerationOptions = {
  existingBlocks?: Block[];
  source?: string;
  sourceId?: string | null;
  maxBlocks?: number;
  idFactory?: () => string;
};

type StorageRepositoryPort = {
  saveBlock(blockInput: Partial<Block> & Pick<Block, "startAt" | "endAt">): Block;
};

type CalendarGateway = {
  createDraftBlockEvent?: (block: Block) => string;
  updateEvent?: (eventId: string, block: Block) => void;
};

type NotificationService = {
  notify?: (type: string, payload: Record<string, unknown>) => void;
};

function toInterval(entity: EventLike | null | undefined): Interval | null {
  const startValue = entity?.startAt ?? entity?.start ?? null;
  const endValue = entity?.endAt ?? entity?.end ?? null;
  if (!startValue || !endValue) {
    return null;
  }

  const start = new Date(startValue);
  const end = new Date(endValue);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return null;
  }

  return { start, end };
}

function overlaps(left: Interval, right: Interval): boolean {
  return left.start < right.end && right.start < left.end;
}

export class BlockPlanningService {
  private readonly generator: BlockGenerator;
  private readonly storageRepository: StorageRepositoryPort;
  private readonly calendarGateway: CalendarGateway | null;
  private readonly notificationService: NotificationService | null;

  constructor({
    policy,
    storageRepository,
    calendarGateway = null,
    notificationService = null,
  }: {
    policy: Partial<Policy>;
    storageRepository: StorageRepositoryPort;
    calendarGateway?: CalendarGateway | null;
    notificationService?: NotificationService | null;
  }) {
    this.generator = new BlockGenerator(policy);
    this.storageRepository = storageRepository;
    this.calendarGateway = calendarGateway;
    this.notificationService = notificationService;
  }

  planDay(date: string, existingEvents: EventLike[], options: BlockGenerationOptions = {}): Block[] {
    const blocks = this.generator.generateBlocks(date, existingEvents, options);
    const saved: Block[] = [];

    for (const generatedBlock of blocks) {
      let block = this.storageRepository.saveBlock(generatedBlock);
      if (this.calendarGateway?.createDraftBlockEvent) {
        const calendarEventId = this.calendarGateway.createDraftBlockEvent(block);
        block = this.storageRepository.saveBlock({
          ...block,
          firmness: "draft",
          calendarEventId,
        });
      }
      saved.push(block);
    }

    return saved;
  }

  relocateIfNeeded(block: Block, existingEvents: EventLike[]): Block | null {
    const blockInterval = toInterval(block);
    if (!blockInterval) {
      return null;
    }

    const collides = existingEvents.some((event) => {
      const eventInterval = toInterval(event);
      return eventInterval ? overlaps(blockInterval, eventInterval) : false;
    });

    if (!collides) {
      return null;
    }

    const relocated = this.generator.relocateBlock(block, existingEvents);
    if (!relocated) {
      this.notificationService?.notify?.("manual_adjustment_required", {
        blockId: block.id,
        date: block.date,
      });
      return null;
    }

    const saved = this.storageRepository.saveBlock(relocated);
    if (saved.calendarEventId && this.calendarGateway?.updateEvent) {
      this.calendarGateway.updateEvent(saved.calendarEventId, saved);
    }

    return saved;
  }
}
