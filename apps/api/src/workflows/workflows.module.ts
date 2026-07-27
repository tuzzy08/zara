import { Module } from "@nestjs/common";

import { IntegrationsModule } from "../integrations/integrations.module";
import { MemoryModule } from "../memory/memory.module";
import { PublishedWorkflowManifestReadModule } from "./published-workflow-manifest-read.module";
import { WorkflowsController } from "./workflows.controller";
import { WorkflowsService } from "./workflows.service";

@Module({
  imports: [
    IntegrationsModule,
    MemoryModule,
    PublishedWorkflowManifestReadModule,
  ],
  controllers: [WorkflowsController],
  providers: [
    WorkflowsService,
  ],
  exports: [WorkflowsService, PublishedWorkflowManifestReadModule],
})
export class WorkflowsModule {}
