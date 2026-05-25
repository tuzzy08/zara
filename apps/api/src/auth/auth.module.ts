import { Module } from "@nestjs/common";

import { BetterAuthController } from "./better-auth.controller";
import { OrganizationAccessService } from "./organization-access/organization-access.service";

@Module({
  controllers: [BetterAuthController],
  providers: [OrganizationAccessService],
  exports: [OrganizationAccessService],
})
export class AuthModule {}
