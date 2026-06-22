import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";

import { TenantAuth, type TenantAuthContext, TenantOrganizationGuard } from "../auth/tenant-auth";
import type {
  CreateLiveSandboxSessionRequest,
  LiveSandboxPostCallCrmSyncTarget,
} from "./sandbox-live-sessions.models";
import { SandboxLiveSessionsService } from "./sandbox-live-sessions.service";

@Controller("organizations/:organizationId/sandbox/live-sessions")
@UseGuards(TenantOrganizationGuard)
export class SandboxLiveSessionsController {
  constructor(private readonly sandboxLiveSessionsService: SandboxLiveSessionsService) {}

  @Get()
  listSessions(
    @Param("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId?: string | undefined,
    @Query("includeEnded") includeEnded?: string | undefined,
  ) {
    return {
      sessions: this.sandboxLiveSessionsService.listSessions({
        organizationId,
        ...(workspaceId !== undefined ? { workspaceId } : {}),
        includeEnded: includeEnded === "true",
      }),
    };
  }

  @Post()
  async createSession(
    @Param("organizationId") organizationId: string,
    @Body() body: CreateLiveSandboxSessionRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      session: await this.sandboxLiveSessionsService.createSession(organizationId, {
        ...body,
        actorUserId: tenantAuth.userId,
      }),
    };
  }

  @Get("telemetry")
  getTelemetryAggregate(
    @Param("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId?: string | undefined,
  ) {
    return {
      telemetry: this.sandboxLiveSessionsService.getTelemetryAggregate({
        organizationId,
        ...(workspaceId !== undefined ? { workspaceId } : {}),
      }),
    };
  }

  @Get("escalations")
  listEscalations(
    @Param("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId?: string | undefined,
    @Query("now") now?: string | undefined,
  ) {
    return {
      escalations: this.sandboxLiveSessionsService.listEscalations({
        organizationId,
        ...(workspaceId !== undefined ? { workspaceId } : {}),
        ...(now !== undefined ? { now } : {}),
      }),
    };
  }

  @Post("escalations/:escalationId/accept")
  @HttpCode(200)
  acceptEscalation(
    @Param("organizationId") organizationId: string,
    @Param("escalationId") escalationId: string,
    @Body() body: { actorUserId: string; now?: string | undefined },
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      escalation: this.sandboxLiveSessionsService.acceptEscalation({
        organizationId,
        escalationId,
        actorUserId: tenantAuth.userId,
        now: body.now,
      }),
    };
  }

  @Post("escalations/:escalationId/decline")
  @HttpCode(200)
  declineEscalation(
    @Param("organizationId") organizationId: string,
    @Param("escalationId") escalationId: string,
    @Body() body: { actorUserId: string; reason?: string | undefined; now?: string | undefined },
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      escalation: this.sandboxLiveSessionsService.declineEscalation({
        organizationId,
        escalationId,
        actorUserId: tenantAuth.userId,
        reason: body.reason,
        now: body.now,
      }),
    };
  }

  @Get(":sessionId/events")
  getSessionEvents(
    @Param("organizationId") organizationId: string,
    @Param("sessionId") sessionId: string,
    @Query("afterSequence") afterSequence?: string | undefined,
  ) {
    return {
      sessionId,
      events: this.sandboxLiveSessionsService.getSessionEvents({
        organizationId,
        sessionId,
        ...(afterSequence !== undefined ? { afterSequence: Number(afterSequence) } : {}),
      }),
    };
  }

  @Get(":sessionId/memory")
  getSessionMemory(
    @Param("organizationId") organizationId: string,
    @Param("sessionId") sessionId: string,
  ) {
    return {
      sessionId,
      memory: this.sandboxLiveSessionsService.getSessionMemory({
        organizationId,
        sessionId,
      }),
    };
  }

  @Post(":sessionId/summary")
  createPostCallSummary(
    @Param("organizationId") organizationId: string,
    @Param("sessionId") sessionId: string,
    @Body()
    body: {
      actorUserId: string;
      crmSyncTarget?: LiveSandboxPostCallCrmSyncTarget | undefined;
      now?: string | undefined;
    },
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      summary: this.sandboxLiveSessionsService.createPostCallSummary({
        organizationId,
        sessionId,
        actorUserId: tenantAuth.userId,
        crmSyncTarget: body.crmSyncTarget,
        now: body.now,
      }),
    };
  }

  @Get(":sessionId/quality")
  getSessionQualityReport(
    @Param("organizationId") organizationId: string,
    @Param("sessionId") sessionId: string,
  ) {
    return {
      quality: this.sandboxLiveSessionsService.getSessionQualityReport({
        organizationId,
        sessionId,
      }),
    };
  }

  @Get(":sessionId/crm-sync")
  getPostCallCrmSyncStatuses(
    @Param("organizationId") organizationId: string,
    @Param("sessionId") sessionId: string,
  ) {
    return {
      crmSyncStatuses: this.sandboxLiveSessionsService.getPostCallCrmSyncStatuses({
        organizationId,
        sessionId,
      }),
    };
  }

  @Post(":sessionId/crm-sync/:summaryId/retry")
  @HttpCode(200)
  retryPostCallCrmSync(
    @Param("organizationId") organizationId: string,
    @Param("sessionId") sessionId: string,
    @Param("summaryId") summaryId: string,
    @Body() body: { actorUserId: string; now?: string | undefined },
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      crmSyncStatus: this.sandboxLiveSessionsService.retryPostCallCrmSync({
        organizationId,
        sessionId,
        summaryId,
        actorUserId: tenantAuth.userId,
        now: body.now,
      }),
    };
  }

  @Post(":sessionId/reconnect")
  @HttpCode(200)
  reconnectSession(
    @Param("organizationId") organizationId: string,
    @Param("sessionId") sessionId: string,
    @Body() body: { actorUserId: string; now?: string | undefined },
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      session: this.sandboxLiveSessionsService.issueReconnectToken({
        organizationId,
        sessionId,
        actorUserId: tenantAuth.userId,
        now: body.now,
      }),
    };
  }

  @Get(":sessionId")
  getSession(
    @Param("organizationId") organizationId: string,
    @Param("sessionId") sessionId: string,
  ) {
    return {
      session: this.sandboxLiveSessionsService.getSession(organizationId, sessionId),
    };
  }

  @Post(":sessionId/end")
  @HttpCode(200)
  endSession(
    @Param("organizationId") organizationId: string,
    @Param("sessionId") sessionId: string,
    @Body() body: { actorUserId: string; now?: string | undefined },
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      session: this.sandboxLiveSessionsService.endSession({
        organizationId,
        sessionId,
        actorUserId: tenantAuth.userId,
        now: body.now,
      }),
    };
  }
}
