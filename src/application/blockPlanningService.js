import { BlockGenerator } from "../domain/blockGenerator.js";

function toInterval(entity) {
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

function overlaps(left, right) {
  return left.start < right.end && right.start < left.end;
}

export class BlockPlanningService {
  constructor({
    policy,
    storageRepository,
    calendarGateway = null,
    notificationService = null,
  }) {
    this.generator = new BlockGenerator(policy);
    this.storageRepository = storageRepository;
    this.calendarGateway = calendarGateway;
    this.notificationService = notificationService;
  }

  planDay(date, existingEvents, options = {}) {
    const blocks = this.generator.generateBlocks(date, existingEvents, options);
    const saved = [];

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

  relocateIfNeeded(block, existingEvents) {
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
