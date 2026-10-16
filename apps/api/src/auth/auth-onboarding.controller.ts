import { Body, Controller, Get, Header, HttpCode, Post, Req, Res } from "@nestjs/common";

import type { AuthOnboardingHttpRequest, AuthOnboardingHttpResponse } from "./auth-onboarding.gateway";
import { AuthOnboardingService } from "./auth-onboarding.service";

@Controller("api/auth/onboarding")
export class AuthOnboardingController {
  constructor(private readonly authOnboardingService: AuthOnboardingService) {}

  @Get("verification-status")
  @Header("Cache-Control", "no-store")
  verificationStatus(@Req() request: AuthOnboardingHttpRequest) {
    return this.authOnboardingService.verificationStatus(request);
  }

  @Post("complete")
  @HttpCode(200)
  complete(@Req() request: AuthOnboardingHttpRequest, @Res({ passthrough: true }) response: AuthOnboardingHttpResponse) {
    return this.authOnboardingService.complete(request, response);
  }

  @Post("signup")
  @HttpCode(200)
  signup(
    @Req() request: AuthOnboardingHttpRequest,
    @Res({ passthrough: true }) response: AuthOnboardingHttpResponse,
    @Body() body: unknown,
  ) {
    return this.authOnboardingService.signup(request, response, body);
  }
}
