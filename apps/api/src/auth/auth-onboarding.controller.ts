import { Body, Controller, HttpCode, Post, Req, Res } from "@nestjs/common";

import type { AuthOnboardingHttpRequest, AuthOnboardingHttpResponse } from "./auth-onboarding.gateway";
import { AuthOnboardingService } from "./auth-onboarding.service";

@Controller("api/auth/onboarding")
export class AuthOnboardingController {
  constructor(private readonly authOnboardingService: AuthOnboardingService) {}

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
