import { Module } from "@nestjs/common";
import { join } from "node:path";

import { IntegrationsModule } from "../integrations/integrations.module";
import { createTypeSafeClient, readTypeSafeMode } from "../ai-judgements/typesafe-client";
import { MemoryController } from "./memory.controller";
import {
  FileMemoryStateRepository,
  MEMORY_STATE_REPOSITORY,
} from "./memory-state.repository";
import { MEMORY_JUDGEMENTS, MemoryService } from "./memory.service";

@Module({
  imports: [IntegrationsModule],
  controllers: [MemoryController],
  providers: [
    MemoryService,
    {
      provide: MEMORY_JUDGEMENTS,
      useFactory: () => {
        const memoryMode = readTypeSafeMode(process.env.TYPESAFE_MEMORY_MODE);
        const knowledgeMode = readTypeSafeMode(process.env.TYPESAFE_KNOWLEDGE_MODE);
        const client = memoryMode === "off" && knowledgeMode === "off"
          ? undefined : createTypeSafeClient();
        if ((memoryMode !== "off" || knowledgeMode !== "off") && client === undefined) {
          throw new Error("TypeSafe credentials and model are required for enabled draft modes.");
        }
        return { memoryMode, knowledgeMode, client };
      },
    },
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
