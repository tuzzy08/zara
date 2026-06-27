import { Module } from "@nestjs/common";
import { join } from "node:path";

import { AgentsController } from "./agents.controller";
import { AgentsService } from "./agents.service";
import {
  AGENTS_STATE_REPOSITORY,
  FileAgentsStateRepository,
} from "./agents-state.repository";

@Module({
  controllers: [AgentsController],
  providers: [
    AgentsService,
    {
      provide: AGENTS_STATE_REPOSITORY,
      useFactory: () =>
        new FileAgentsStateRepository(
          process.env.ZARA_AGENTS_STATE_DIR ?? join(process.cwd(), ".zara", "agents"),
        ),
    },
  ],
  exports: [AgentsService],
})
export class AgentsModule {}
