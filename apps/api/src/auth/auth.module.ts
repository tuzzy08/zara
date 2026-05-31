import { Module } from "@nestjs/common";

import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AuthContextController } from "./auth-context.controller";
import { AuthInvitationsController } from "./auth-invitations.controller";
import { AuthInvitationsGateway } from "./auth-invitations.gateway";
import { AuthInvitationsService } from "./auth-invitations.service";
import { AuthOnboardingController } from "./auth-onboarding.controller";
import { AuthOnboardingGateway } from "./auth-onboarding.gateway";
import { AuthOnboardingService } from "./auth-onboarding.service";
import { BetterAuthController } from "./better-auth.controller";
import { OrganizationAccessService } from "./organization-access/organization-access.service";

@Module({
  imports: [WorkspacesModule],
  controllers: [AuthContextController, AuthInvitationsController, AuthOnboardingController, BetterAuthController],
  providers: [
    AuthInvitationsGateway,
    AuthInvitationsService,
    AuthOnboardingGateway,
    AuthOnboardingService,
    OrganizationAccessService,
  ],
  exports: [OrganizationAccessService],
})
export class AuthModule {}
