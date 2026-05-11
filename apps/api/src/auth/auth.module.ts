import { Module } from "@nestjs/common";

import { OrganizationAccessService } from "./organization-access/organization-access.service";

@Module({
  providers: [OrganizationAccessService],
  exports: [OrganizationAccessService],
})
export class AuthModule {}
