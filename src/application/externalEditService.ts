import type { Block } from "../domain/models.js";

type DateValue = {
  date?: string;
  dateTime?: string;
};

type RemoteEventInput = {
  id?: string;
  eventId?: string;
  start?: string | DateValue;
  end?: string | DateValue;
  startAt?: string;
  endAt?: string;
  deleted?: unknown;
};

type RemoteEvent = {
  id: string;
  startAt: string;
  endAt: string;
  deleted: boolean;
};

type SyncResult = {
  added: Block[];
  updated: Block[];
  deleted: string[];
};

type StorageRepositoryPort = {
  loadAllBlocks(): Block[];
  saveBlock(blockInput: Partial<Block> & Pick<Block, "startAt" | "endAt">): Block;
  deleteBlock(blockId: string): void;
};

type NotificationService = {
  notify?: (type: string, payload: Record<string, unknown>) => void;
};

function toIsoDateTime(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  if (typeof value === "object" && value !== null) {
    const record = value as DateValue;
    if (typeof record.dateTime === "string") {
      const parsed = new Date(record.dateTime);
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
    if (typeof record.date === "string") {
      const parsed = new Date(`${record.date}T00:00:00.000Z`);
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
  }

  return null;
}

function normalizeRemoteEvent(event: RemoteEventInput): RemoteEvent | null {
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
  private readonly storageRepository: StorageRepositoryPort;
  private readonly notificationService: NotificationService | null;

  constructor({
    storageRepository,
    notificationService = null,
  }: {
    storageRepository: StorageRepositoryPort;
    notificationService?: NotificationService | null;
  }) {
    this.storageRepository = storageRepository;
    this.notificationService = notificationService;
  }

  syncExternalChanges(remoteEventsInput: RemoteEventInput[] = []): SyncResult {
    const remoteEvents = remoteEventsInput
      .map(normalizeRemoteEvent)
      .filter((event): event is RemoteEvent => event !== null);
    const localBlocks = this.storageRepository
      .loadAllBlocks()
      .filter((block) => block.calendarEventId !== null);
    const localByEventId = new Map<string, Block>(
      localBlocks
        .map((block) =>
          block.calendarEventId ? ([block.calendarEventId, block] as const) : null
        )
        .filter((entry): entry is readonly [string, Block] => entry !== null)
    );
    const remoteByEventId = new Map(remoteEvents.map((event) => [event.id, event]));

    const result: SyncResult = {
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
          this.notify("external_block_deleted", {
            blockId: localBlock.id,
            eventId: remoteEvent.id,
          });
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
      const eventId = localBlock.calendarEventId;
      if (!eventId) {
        continue;
      }
      if (!remoteByEventId.has(eventId)) {
        this.storageRepository.deleteBlock(localBlock.id);
        result.deleted.push(localBlock.id);
        this.notify("external_block_deleted", {
          blockId: localBlock.id,
          eventId,
        });
      }
    }

    return result;
  }

  notify(type: string, payload: Record<string, unknown>): void {
    this.notificationService?.notify?.(type, payload);
  }
}
