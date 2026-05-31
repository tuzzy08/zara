import { Module } from "@nestjs/common";

import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AuthContextController } from "./auth-context.controller";
import { BetterAuthController } from "./better-auth.controller";
import { OrganizationAccessService } from "./organization-access/organization-access.service";

@Module({
  imports: [WorkspacesModule],
  controllers: [AuthContextController, BetterAuthController],
  providers: [OrganizationAccessService],
  exports: [OrganizationAccessService],
})
export class AuthModule {}
