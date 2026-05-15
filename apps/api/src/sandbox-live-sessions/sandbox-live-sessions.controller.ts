import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";

import type { CreateLiveSandboxSessionRequest } from "./sandbox-live-sessions.models";
import { SandboxLiveSessionsService } from "./sandbox-live-sessions.service";

@Controller("organizations/:organizationId/sandbox/live-sessions")
export class SandboxLiveSessionsController {
  constructor(private readonly sandboxLiveSessionsService: SandboxLiveSessionsService) {}

  @Post()
  createSession(
    @Param("organizationId") organizationId: string,
    @Body() body: CreateLiveSandboxSessionRequest,
  ) {
    return {
      session: this.sandboxLiveSessionsService.createSession(organizationId, body),
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
