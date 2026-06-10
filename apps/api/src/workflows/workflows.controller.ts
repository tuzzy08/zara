import { Body, Controller, Param, Post } from "@nestjs/common";

import { type PublishWorkflowRequest, WorkflowsService } from "./workflows.service";

@Controller("organizations/:organizationId/workflows")
export class WorkflowsController {
  constructor(private readonly workflowsService: WorkflowsService) {}

  @Post(":workflowId/publish")
  async publishWorkflow(
    @Param("organizationId") organizationId: string,
    @Param("workflowId") workflowId: string,
    @Body() body: PublishWorkflowRequest,
  ) {
    return this.workflowsService.publishWorkflow({
      organizationId,
      workflowId,
      request: body,
    });
  }
}
