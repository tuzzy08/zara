import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";

import { TenantAuth, type TenantAuthContext, TenantOrganizationGuard } from "../auth/tenant-auth";
import { type PublishWorkflowRequest, WorkflowsService } from "./workflows.service";

@Controller("organizations/:organizationId/workflows")
@UseGuards(TenantOrganizationGuard)
export class WorkflowsController {
  constructor(private readonly workflowsService: WorkflowsService) {}

  @Post(":workflowId/publish")
  async publishWorkflow(
    @Param("organizationId") organizationId: string,
    @Param("workflowId") workflowId: string,
    @Body() body: PublishWorkflowRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return this.workflowsService.publishWorkflow({
      organizationId,
      workflowId,
      request: {
        ...body,
        actorUserId: tenantAuth.userId,
      },
    });
  }
}
