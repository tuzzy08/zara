import { Module } from "@nestjs/common";

import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AuthContextController } from "./auth-context.controller";
import { AuthOnboardingController } from "./auth-onboarding.controller";
import { AuthOnboardingGateway } from "./auth-onboarding.gateway";
import { AuthOnboardingService } from "./auth-onboarding.service";
import { BetterAuthController } from "./better-auth.controller";
import { OrganizationAccessService } from "./organization-access/organization-access.service";

@Module({
  imports: [WorkspacesModule],
  controllers: [AuthContextController, AuthOnboardingController, BetterAuthController],
  providers: [AuthOnboardingGateway, AuthOnboardingService, OrganizationAccessService],
  exports: [OrganizationAccessService],
})
export class AuthModule {}
