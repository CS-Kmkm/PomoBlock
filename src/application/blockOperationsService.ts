import type { Block } from "../domain/models.js";

type StorageRepositoryPort = {
  loadBlockById(blockId: string): Block | null;
  saveBlock(blockInput: Partial<Block> & Pick<Block, "startAt" | "endAt">): Block;
  deleteBlock(blockId: string): void;
};

type CalendarGateway = {
  updateEvent?: (eventId: string, block: Block) => void;
  deleteEvent?: (eventId: string) => void;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export class BlockOperationsService {
  private readonly storageRepository: StorageRepositoryPort;
  private readonly calendarGateway: CalendarGateway | null;

  constructor({
    storageRepository,
    calendarGateway = null,
  }: {
    storageRepository: StorageRepositoryPort;
    calendarGateway?: CalendarGateway | null;
  }) {
    this.storageRepository = storageRepository;
    this.calendarGateway = calendarGateway;
  }

  approveBlocks(blockIds: string[]): Block[] {
    assert(Array.isArray(blockIds), "blockIds must be an array");
    const approved: Block[] = [];
    for (const blockId of blockIds) {
      const block = this.storageRepository.loadBlockById(blockId);
      if (!block) {
        continue;
      }

      const updated = this.storageRepository.saveBlock({
        ...block,
        firmness: "soft",
      });
      if (updated.calendarEventId && this.calendarGateway?.updateEvent) {
        this.calendarGateway.updateEvent(updated.calendarEventId, updated);
      }
      approved.push(updated);
    }
    return approved;
  }

  deleteBlock(blockId: string): boolean {
    const block = this.storageRepository.loadBlockById(blockId);
    if (!block) {
      return false;
    }

    if (block.calendarEventId && this.calendarGateway?.deleteEvent) {
      this.calendarGateway.deleteEvent(block.calendarEventId);
    }
    this.storageRepository.deleteBlock(blockId);
    return true;
  }

  adjustBlockTime(blockId: string, startAt: string, endAt: string): Block {
    const block = this.storageRepository.loadBlockById(blockId);
    assert(block, `block not found: ${blockId}`);

    const updated = this.storageRepository.saveBlock({
      ...block,
      startAt,
      endAt,
    });
    if (updated.calendarEventId && this.calendarGateway?.updateEvent) {
      this.calendarGateway.updateEvent(updated.calendarEventId, updated);
    }
    return updated;
  }
}
