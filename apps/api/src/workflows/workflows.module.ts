import { Module } from "@nestjs/common";

import { IntegrationsModule } from "../integrations/integrations.module";
import { MemoryModule } from "../memory/memory.module";
import { WorkflowsController } from "./workflows.controller";
import { WorkflowsService } from "./workflows.service";

@Module({
  imports: [IntegrationsModule, MemoryModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
