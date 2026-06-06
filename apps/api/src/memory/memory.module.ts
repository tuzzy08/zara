import { Module } from "@nestjs/common";
import { join } from "node:path";

import { IntegrationsModule } from "../integrations/integrations.module";
import { MemoryController } from "./memory.controller";
import {
  FileMemoryStateRepository,
  MEMORY_STATE_REPOSITORY,
} from "./memory-state.repository";
import { MemoryService } from "./memory.service";

@Module({
  imports: [IntegrationsModule],
  controllers: [MemoryController],
  providers: [
    MemoryService,
    {
      provide: MEMORY_STATE_REPOSITORY,
      useFactory: () =>
        new FileMemoryStateRepository(
          process.env.ZARA_MEMORY_STATE_DIR ?? join(process.cwd(), ".zara", "memory"),
        ),
    },
  ],
  exports: [MemoryService],
})
export class MemoryModule {}
