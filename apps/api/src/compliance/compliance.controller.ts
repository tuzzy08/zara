import { Body, Controller, Get, Param, Post } from "@nestjs/common";

import type { CreateRetentionJobRequest } from "./compliance.models";
import { ComplianceService } from "./compliance.service";

@Controller("organizations/:organizationId/compliance")
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Get("audit-logs")
  async listAuditLogs(@Param("organizationId") organizationId: string) {
    return {
      auditLogs: await this.complianceService.listAuditLogs(organizationId),
    };
  }

  @Get("readiness")
  async getReadiness(@Param("organizationId") organizationId: string) {
    return {
      readiness: this.complianceService.getReadiness(organizationId),
    };
  }

  @Post("retention-jobs")
  async createRetentionJob(
    @Param("organizationId") organizationId: string,
    @Body() body: CreateRetentionJobRequest,
  ) {
    return {
      job: await this.complianceService.createRetentionJob(organizationId, body),
    };
  }
}
