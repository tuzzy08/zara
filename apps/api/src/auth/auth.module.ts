import { Module } from "@nestjs/common";

import { WorkspacesModule } from "../workspaces/workspaces.module.js";
import { AuthAccountSecurityController } from "./auth-account-security.controller.js";
import { AuthAccountSecurityService } from "./auth-account-security.service.js";
import { AuthContextController } from "./auth-context.controller.js";
import { AuthInvitationsController } from "./auth-invitations.controller.js";
import { AuthInvitationsGateway } from "./auth-invitations.gateway.js";
import { AuthInvitationsService } from "./auth-invitations.service.js";
import { AuthOnboardingController } from "./auth-onboarding.controller.js";
import { AuthOnboardingGateway } from "./auth-onboarding.gateway.js";
import { AuthOnboardingService } from "./auth-onboarding.service.js";
import { BetterAuthController } from "./better-auth.controller.js";
import { OrganizationAccessService } from "./organization-access/organization-access.service.js";

@Module({
  imports: [WorkspacesModule],
  controllers: [
    AuthAccountSecurityController,
    AuthContextController,
    AuthInvitationsController,
    AuthOnboardingController,
    BetterAuthController,
  ],
  providers: [
    AuthAccountSecurityService,
    AuthInvitationsGateway,
    AuthInvitationsService,
    AuthOnboardingGateway,
    AuthOnboardingService,
    OrganizationAccessService,
  ],
  exports: [OrganizationAccessService],
})
export class AuthModule {}
