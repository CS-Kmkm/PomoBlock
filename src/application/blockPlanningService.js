import { BlockGenerator } from "../domain/blockGenerator.js";

export class BlockPlanningService {
  constructor({ policy, storageRepository }) {
    this.generator = new BlockGenerator(policy);
    this.storageRepository = storageRepository;
  }

  planDay(date, existingEvents, options = {}) {
    const blocks = this.generator.generateBlocks(date, existingEvents, options);
    for (const block of blocks) {
      this.storageRepository.saveBlock(block);
    }
    return blocks;
  }

  relocateIfNeeded(block, existingEvents) {
    return this.generator.relocateBlock(block, existingEvents);
  }
}
