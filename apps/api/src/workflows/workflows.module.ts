import { Module } from "@nestjs/common";

import { IntegrationsModule } from "../integrations/integrations.module";
import { MemoryModule } from "../memory/memory.module";
import { PostgresPoolService } from "../database/postgres-pool.service";
import {
  PUBLISHED_WORKFLOW_MANIFEST_REPOSITORY,
} from "./published-workflow-manifest.repository";
import { PostgresPublishedWorkflowManifestRepository } from "./postgres-published-workflow-manifest.repository";
import { WorkflowsController } from "./workflows.controller";
import { WorkflowsService } from "./workflows.service";

@Module({
  imports: [IntegrationsModule, MemoryModule],
  controllers: [WorkflowsController],
  providers: [
    PostgresPoolService,
    WorkflowsService,
    {
      provide: PUBLISHED_WORKFLOW_MANIFEST_REPOSITORY,
      useFactory: (postgresPoolService: PostgresPoolService) =>
        new PostgresPublishedWorkflowManifestRepository(postgresPoolService.pool),
      inject: [PostgresPoolService],
    },
  ],
  exports: [WorkflowsService, PUBLISHED_WORKFLOW_MANIFEST_REPOSITORY],
})
export class WorkflowsModule {}
