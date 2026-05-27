import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";

import {
  getPlatformAdminContext,
  PlatformAdminGuard,
} from "./platform-admin.guard";
import {
  canRunSupportAction,
  canMutatePlatform,
  PlatformAdminService,
} from "./platform-admin.service";
import type {
  UpdateRuntimePromptPolicyInput,
} from "../runtime-prompt-policy/runtime-prompt-policy.models";
import type {
  PlatformBillingControls,
  PlatformOrganizationStatus,
} from "./platform-admin.models";

@Controller("platform-admin")
@UseGuards(PlatformAdminGuard)
export class PlatformAdminController {
  constructor(private readonly platformAdminService: PlatformAdminService) {}

  @Get("dashboard")
  getDashboard() {
    return {
      dashboard: this.platformAdminService.getDashboard(),
    };
  }

  @Get("organizations")
  listOrganizations() {
    return {
      organizations: this.platformAdminService.listOrganizations(),
    };
  }

  @Get("organizations/:organizationId")
  getOrganization(@Param("organizationId") organizationId: string) {
    return {
      organization: this.platformAdminService.getOrganization(organizationId),
    };
  }

  @Patch("organizations/:organizationId/status")
  updateOrganizationStatus(
    @Req() request: Record<string | symbol, unknown>,
    @Param("organizationId") organizationId: string,
    @Body() body: { status: PlatformOrganizationStatus; reason: string },
  ) {
    const context = getPlatformAdminContext(request);
    assertCanMutate(context.platformRole);

    return this.platformAdminService.updateOrganizationStatus(context, organizationId, body);
  }

  @Get("users")
  listUsers() {
    return {
      users: this.platformAdminService.listUsers(),
    };
  }

  @Post("users/:userId/support-actions")
  createSupportAction(
    @Req() request: Record<string | symbol, unknown>,
    @Param("userId") userId: string,
    @Body() body: { action: "mark_membership_reviewed"; organizationId: string },
  ) {
    const context = getPlatformAdminContext(request);

    if (!canRunSupportAction(context.platformRole)) {
      throw new ForbiddenException("Readonly platform roles cannot run support actions.");
    }

    return this.platformAdminService.createSupportAction(context, userId, body);
  }

  @Get("telephony")
  listTelephonyConnections() {
    return {
      connections: this.platformAdminService.listTelephonyConnections(),
    };
  }

  @Get("integrations")
  listIntegrationConnections() {
    return {
      connectors: this.platformAdminService.listIntegrationConnections(),
    };
  }

  @Get("runtime/health")
  listRuntimeHealth() {
    return {
      providers: this.platformAdminService.listRuntimeProviders(),
    };
  }

  @Get("runtime/prompt-policy")
  async getRuntimePromptPolicy() {
    return {
      promptPolicy: await this.platformAdminService.getRuntimePromptPolicy(),
    };
  }

  @Patch("runtime/prompt-policy")
  async updateRuntimePromptPolicy(
    @Req() request: Record<string | symbol, unknown>,
    @Body() body: UpdateRuntimePromptPolicyInput,
  ) {
    const context = getPlatformAdminContext(request);
    assertCanMutate(context.platformRole);

    return this.platformAdminService.updateRuntimePromptPolicy(context, body);
  }

  @Patch("organizations/:organizationId/billing-controls")
  updateBillingControls(
    @Req() request: Record<string | symbol, unknown>,
    @Param("organizationId") organizationId: string,
    @Body() body: Partial<PlatformBillingControls>,
  ) {
    const context = getPlatformAdminContext(request);
    assertCanMutate(context.platformRole);

    return this.platformAdminService.updateBillingControls(context, organizationId, body);
  }

  @Get("audit-logs")
  listAuditLogs(
    @Query("actorUserId") actorUserId?: string,
    @Query("tenantId") tenantId?: string,
    @Query("action") action?: string,
  ) {
    return {
      auditLogs: this.platformAdminService.listAuditLogs({
        actorUserId,
        tenantId,
        action,
      }),
    };
  }

  @Post("organizations/:organizationId/impersonation-sessions")
  createImpersonationSession(
    @Req() request: Record<string | symbol, unknown>,
    @Param("organizationId") organizationId: string,
    @Body()
    body: {
      targetUserId: string;
      reason: string;
      destructiveActionsAllowed?: boolean | undefined;
      ttlMinutes?: number | undefined;
    },
  ) {
    const context = getPlatformAdminContext(request);
    assertCanMutate(context.platformRole);

    return this.platformAdminService.createImpersonationSession(context, organizationId, body);
  }

  @Delete("impersonation-sessions/:sessionId")
  revokeImpersonationSession(
    @Req() request: Record<string | symbol, unknown>,
    @Param("sessionId") sessionId: string,
  ) {
    const context = getPlatformAdminContext(request);
    assertCanMutate(context.platformRole);

    return this.platformAdminService.revokeImpersonationSession(context, sessionId);
  }

  @Get("abuse-compliance/reviews")
  listAbuseComplianceReviews() {
    return {
      reviews: this.platformAdminService.listReviews(),
    };
  }

  @Post("abuse-compliance/reviews/:reviewId/decision")
  @HttpCode(200)
  decideAbuseComplianceReview(
    @Req() request: Record<string | symbol, unknown>,
    @Param("reviewId") reviewId: string,
    @Body() body: { decision: "dismissed" | "escalated"; note: string },
  ) {
    const context = getPlatformAdminContext(request);
    assertCanMutate(context.platformRole);

    return this.platformAdminService.decideReview(context, reviewId, body);
  }
}

function assertCanMutate(platformRole: Parameters<typeof canMutatePlatform>[0]) {
  if (!canMutatePlatform(platformRole)) {
    throw new ForbiddenException("Readonly platform roles cannot mutate platform operations.");
  }
}
