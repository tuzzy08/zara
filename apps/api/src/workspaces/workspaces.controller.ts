import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";
import type { TenantRole } from "@zara/core";

import { TenantAuth, type TenantAuthContext, TenantOrganizationGuard } from "../auth/tenant-auth";
import { WorkspacesService } from "./workspaces.service";

@Controller("organizations/:organizationId/workspaces")
@UseGuards(TenantOrganizationGuard)
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get("state")
  getWorkspaceState(@Param("organizationId") organizationId: string) {
    return this.workspacesService.getWorkspaceState(organizationId);
  }

  @Post()
  createWorkspace(
    @Param("organizationId") organizationId: string,
    @Body() body: { name: string },
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      state: this.workspacesService.createWorkspace({
        organizationId,
        name: body.name,
        actorUserId: tenantAuth.userId,
      }),
    };
  }

  @Patch(":workspaceId")
  mutateWorkspace(
    @Param("organizationId") organizationId: string,
    @Param("workspaceId") workspaceId: string,
    @Body()
    body: {
      action: "rename" | "archive" | "restore";
      actorUserId: string;
      nextName?: string | undefined;
      activeSessionCount?: number | undefined;
    },
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      state: this.workspacesService.mutateWorkspace({
        organizationId,
        workspaceId,
        actorUserId: tenantAuth.userId,
        action: body.action,
        nextName: body.nextName,
        activeSessionCount: body.activeSessionCount,
      }),
    };
  }

  @Post(":workspaceId/accessed")
  @HttpCode(200)
  markWorkspaceAccessed(
    @Param("organizationId") organizationId: string,
    @Param("workspaceId") workspaceId: string,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      state: this.workspacesService.markWorkspaceAccessed({
        organizationId,
        workspaceId,
        actorUserId: tenantAuth.userId,
      }),
    };
  }

  @Put(":workspaceId/memberships/:userId")
  setMembershipRole(
    @Param("organizationId") organizationId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("userId") userId: string,
    @Body() body: { role: TenantRole },
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      state: this.workspacesService.setMembershipRole({
        organizationId,
        workspaceId,
        userId,
        role: body.role,
        actorUserId: tenantAuth.userId,
      }),
    };
  }

  @Post(":workspaceId/memberships/:userId/revoke")
  @HttpCode(200)
  revokeMembership(
    @Param("organizationId") organizationId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("userId") userId: string,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      state: this.workspacesService.revokeMembership({
        organizationId,
        workspaceId,
        userId,
        actorUserId: tenantAuth.userId,
      }),
    };
  }
}
