import { Body, Controller, Get, HttpCode, Param, Post, Req } from "@nestjs/common";

import { AuthAccountSecurityService } from "./auth-account-security.service";

interface AccountSecurityHttpRequest {
  headers: Record<string, string | string[] | undefined>;
  protocol: string;
  get: (header: string) => string | undefined;
}

@Controller("api/auth/account-security")
export class AuthAccountSecurityController {
  constructor(private readonly accountSecurityService: AuthAccountSecurityService) {}

  @Post("password-reset/request")
  @HttpCode(200)
  async requestPasswordReset(@Req() request: AccountSecurityHttpRequest, @Body() body: unknown) {
    return await this.accountSecurityService.requestPasswordReset(request, asRecord(body));
  }

  @Post("email-verification/request")
  @HttpCode(200)
  async requestEmailVerification(@Req() request: AccountSecurityHttpRequest, @Body() body: unknown) {
    return await this.accountSecurityService.requestEmailVerification(request, asRecord(body));
  }

  @Get("sessions")
  async listSessions(@Req() request: AccountSecurityHttpRequest) {
    return await this.accountSecurityService.listSessions(request);
  }

  @Post("sessions/:sessionId/revoke")
  @HttpCode(200)
  async revokeSession(@Req() request: AccountSecurityHttpRequest, @Param("sessionId") sessionId: string) {
    return await this.accountSecurityService.revokeSession(request, sessionId);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}
