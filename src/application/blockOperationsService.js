function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export class BlockOperationsService {
  constructor({ storageRepository, calendarGateway = null }) {
    this.storageRepository = storageRepository;
    this.calendarGateway = calendarGateway;
  }

  approveBlocks(blockIds) {
    assert(Array.isArray(blockIds), "blockIds must be an array");
    const approved = [];
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

  deleteBlock(blockId) {
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

  adjustBlockTime(blockId, startAt, endAt) {
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
