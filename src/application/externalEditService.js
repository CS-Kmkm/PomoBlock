function toIsoDateTime(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  if (typeof value === "object") {
    if (typeof value.dateTime === "string") {
      const parsed = new Date(value.dateTime);
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
    if (typeof value.date === "string") {
      const parsed = new Date(`${value.date}T00:00:00.000Z`);
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
  }

  return null;
}

function normalizeRemoteEvent(event) {
  const id = event.id ?? event.eventId ?? null;
  const startAt = toIsoDateTime(event.startAt ?? event.start);
  const endAt = toIsoDateTime(event.endAt ?? event.end);
  if (!id || !startAt || !endAt) {
    return null;
  }

  return {
    id,
    startAt,
    endAt,
    deleted: Boolean(event.deleted),
  };
}

export class ExternalEditService {
  constructor({ storageRepository, notificationService = null }) {
    this.storageRepository = storageRepository;
    this.notificationService = notificationService;
  }

  syncExternalChanges(remoteEventsInput = []) {
    const remoteEvents = remoteEventsInput.map(normalizeRemoteEvent).filter(Boolean);
    const localBlocks = this.storageRepository
      .loadAllBlocks()
      .filter((block) => block.calendarEventId !== null);
    const localByEventId = new Map(localBlocks.map((block) => [block.calendarEventId, block]));
    const remoteByEventId = new Map(remoteEvents.map((event) => [event.id, event]));

    const result = {
      added: [],
      updated: [],
      deleted: [],
    };

    for (const remoteEvent of remoteEvents) {
      const localBlock = localByEventId.get(remoteEvent.id) ?? null;
      if (remoteEvent.deleted) {
        if (localBlock) {
          this.storageRepository.deleteBlock(localBlock.id);
          result.deleted.push(localBlock.id);
          this.notify("external_block_deleted", { blockId: localBlock.id, eventId: remoteEvent.id });
        }
        continue;
      }

      if (!localBlock) {
        const date = remoteEvent.startAt.slice(0, 10);
        const created = this.storageRepository.saveBlock({
          instance: `external:${remoteEvent.id}:${date}`,
          date,
          startAt: remoteEvent.startAt,
          endAt: remoteEvent.endAt,
          type: "admin",
          firmness: "soft",
          source: "calendar",
          sourceId: remoteEvent.id,
          calendarEventId: remoteEvent.id,
        });
        result.added.push(created);
        this.notify("external_event_added", {
          blockId: created.id,
          eventId: remoteEvent.id,
        });
        continue;
      }

      if (localBlock.startAt !== remoteEvent.startAt || localBlock.endAt !== remoteEvent.endAt) {
        const updated = this.storageRepository.saveBlock({
          ...localBlock,
          startAt: remoteEvent.startAt,
          endAt: remoteEvent.endAt,
        });
        result.updated.push(updated);
        this.notify("external_block_updated", {
          blockId: updated.id,
          eventId: remoteEvent.id,
        });
      }
    }

    for (const localBlock of localBlocks) {
      if (!remoteByEventId.has(localBlock.calendarEventId)) {
        this.storageRepository.deleteBlock(localBlock.id);
        result.deleted.push(localBlock.id);
        this.notify("external_block_deleted", {
          blockId: localBlock.id,
          eventId: localBlock.calendarEventId,
        });
      }
    }

    return result;
  }

  notify(type, payload) {
    this.notificationService?.notify?.(type, payload);
  }
}
