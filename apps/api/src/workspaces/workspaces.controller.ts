import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put } from "@nestjs/common";
import type { TenantRole } from "@zara/core";

import { WorkspacesService } from "./workspaces.service";

@Controller("organizations/:organizationId/workspaces")
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get("state")
  getWorkspaceState(@Param("organizationId") organizationId: string) {
    return this.workspacesService.getWorkspaceState(organizationId);
  }

  @Post()
  createWorkspace(
    @Param("organizationId") organizationId: string,
    @Body() body: { name: string; actorUserId: string },
  ) {
    return {
      state: this.workspacesService.createWorkspace({
        organizationId,
        name: body.name,
        actorUserId: body.actorUserId,
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
  ) {
    return {
      state: this.workspacesService.mutateWorkspace({
        organizationId,
        workspaceId,
        actorUserId: body.actorUserId,
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
    @Body() body: { actorUserId: string },
  ) {
    return {
      state: this.workspacesService.markWorkspaceAccessed({
        organizationId,
        workspaceId,
        actorUserId: body.actorUserId,
      }),
    };
  }

  @Put(":workspaceId/memberships/:userId")
  setMembershipRole(
    @Param("organizationId") organizationId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("userId") userId: string,
    @Body() body: { role: TenantRole; actorUserId: string },
  ) {
    return {
      state: this.workspacesService.setMembershipRole({
        organizationId,
        workspaceId,
        userId,
        role: body.role,
        actorUserId: body.actorUserId,
      }),
    };
  }

  @Post(":workspaceId/memberships/:userId/revoke")
  @HttpCode(200)
  revokeMembership(
    @Param("organizationId") organizationId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("userId") userId: string,
    @Body() body: { actorUserId: string },
  ) {
    return {
      state: this.workspacesService.revokeMembership({
        organizationId,
        workspaceId,
        userId,
        actorUserId: body.actorUserId,
      }),
    };
  }
}
