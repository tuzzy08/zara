import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from "@nestjs/common";

import { AuthInvitationsService } from "./auth-invitations.service";
import type { AuthInvitationsHttpRequest, AuthInvitationsHttpResponse } from "./auth-invitations.gateway";

@Controller("api/auth/invitations")
export class AuthInvitationsController {
  constructor(private readonly invitationsService: AuthInvitationsService) {}

  @Post()
  createInvitation(
    @Req() request: AuthInvitationsHttpRequest,
    @Res({ passthrough: true }) response: AuthInvitationsHttpResponse,
    @Body() body: unknown,
  ) {
    return this.invitationsService.create(request, response, body);
  }

  @Get()
  listInvitations(
    @Req() request: AuthInvitationsHttpRequest,
    @Res({ passthrough: true }) response: AuthInvitationsHttpResponse,
    @Query("organizationId") organizationId = "",
  ) {
    return this.invitationsService.list(request, response, organizationId);
  }

  @Post(":invitationId/revoke")
  @HttpCode(200)
  revokeInvitation(
    @Req() request: AuthInvitationsHttpRequest,
    @Res({ passthrough: true }) response: AuthInvitationsHttpResponse,
    @Param("invitationId") invitationId: string,
  ) {
    return this.invitationsService.revoke(request, response, invitationId);
  }

  @Post(":invitationId/accept")
  @HttpCode(200)
  acceptInvitation(
    @Req() request: AuthInvitationsHttpRequest,
    @Res({ passthrough: true }) response: AuthInvitationsHttpResponse,
    @Param("invitationId") invitationId: string,
    @Body() body: unknown,
  ) {
    return this.invitationsService.accept(request, response, invitationId, body);
  }
}
