import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";

import type { CreateLiveSandboxSessionRequest } from "./sandbox-live-sessions.models";
import { SandboxLiveSessionsService } from "./sandbox-live-sessions.service";

@Controller("organizations/:organizationId/sandbox/live-sessions")
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
  createSession(
    @Param("organizationId") organizationId: string,
    @Body() body: CreateLiveSandboxSessionRequest,
  ) {
    return {
      session: this.sandboxLiveSessionsService.createSession(organizationId, body),
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

  @Post(":sessionId/reconnect")
  @HttpCode(200)
  reconnectSession(
    @Param("organizationId") organizationId: string,
    @Param("sessionId") sessionId: string,
    @Body() body: { actorUserId: string; now?: string | undefined },
  ) {
    return {
      session: this.sandboxLiveSessionsService.issueReconnectToken({
        organizationId,
        sessionId,
        actorUserId: body.actorUserId,
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
  ) {
    return {
      session: this.sandboxLiveSessionsService.endSession({
        organizationId,
        sessionId,
        actorUserId: body.actorUserId,
        now: body.now,
      }),
    };
  }
}
