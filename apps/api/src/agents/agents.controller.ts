import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common";

import { TenantAuth, type TenantAuthContext, TenantOrganizationGuard } from "../auth/tenant-auth";
import type { CreateReusableAgentRequest, UpdateReusableAgentToolbeltRequest } from "./agents.models";
import { AgentsService } from "./agents.service";

@Controller("organizations/:organizationId/agents")
@UseGuards(TenantOrganizationGuard)
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get()
  async listReusableAgents(
    @Param("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId?: string | undefined,
  ) {
    return {
      agents: await this.agentsService.listReusableAgents({
        organizationId,
        workspaceId: workspaceId ?? "",
      }),
    };
  }

  @Post()
  async createReusableAgent(
    @Param("organizationId") organizationId: string,
    @Body() body: CreateReusableAgentRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      agent: await this.agentsService.createReusableAgent({
        organizationId,
        actorRole: tenantAuth.role,
        actorUserId: tenantAuth.userId,
        workspaceId: body.workspaceId,
        name: body.name,
        agentClass: body.agentClass,
        instructions: body.instructions,
        defaultLanguage: body.defaultLanguage,
        runtimeProfile: body.runtimeProfile,
      }),
    };
  }

  @Put(":agentId/toolbelt")
  async replaceReusableAgentToolbelt(
    @Param("organizationId") organizationId: string,
    @Param("agentId") agentId: string,
    @Body() body: UpdateReusableAgentToolbeltRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      agent: await this.agentsService.replaceReusableAgentToolbelt({
        organizationId,
        agentId,
        actorRole: tenantAuth.role,
        actorUserId: tenantAuth.userId,
        workspaceId: body.workspaceId,
        assignments: body.assignments,
      }),
    };
  }
}
