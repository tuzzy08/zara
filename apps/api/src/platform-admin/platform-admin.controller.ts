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
  assertImpersonationSafe,
  assertPlatformMutationAllowed,
  assertSupportActionAllowed,
} from "./platform-admin-auth-posture";
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
  CreateRuntimePromptPolicyAgentClassInput,
  UpdateRuntimePromptPolicyInput,
} from "../runtime-prompt-policy/runtime-prompt-policy.models";
import type {
  UpdateRuntimeRoutePolicyInput,
} from "../runtime-route-policy/runtime-route-policy.models";
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
    assertCanMutate(context);

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
    assertSupportActionAllowed(context.platformAuth);

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

  @Post("organizations/:organizationId/telephony/platform-managed-connections")
  createPlatformManagedTelephonyConnection(
    @Req() request: Record<string | symbol, unknown>,
    @Param("organizationId") organizationId: string,
    @Body() body: {
      label: string;
      provider: "twilio" | "signalwire" | "telnyx";
      region: string;
    },
  ) {
    const context = getPlatformAdminContext(request);
    assertCanMutate(context);

    return this.platformAdminService.createPlatformManagedTelephonyConnection(
      context,
      organizationId,
      body,
    );
  }

  @Get("agent-classes")
  async listAgentClasses() {
    return {
      agentClasses: await this.platformAdminService.listAgentClasses(),
    };
  }

  @Post("agent-classes")
  async createAgentClass(
    @Req() request: Record<string | symbol, unknown>,
    @Body() body: CreateRuntimePromptPolicyAgentClassInput,
  ) {
    const context = getPlatformAdminContext(request);
    assertCanMutate(context);

    return this.platformAdminService.createAgentClass(context, body);
  }

  @Get("runtime/ai-observability")
  getRuntimeAiObservability() {
    return {
      aiObservability: this.platformAdminService.getRuntimeAiObservability(),
    };
  }

  @Get("runtime/prompt-policy")
  async getRuntimePromptPolicy() {
    return {
      promptPolicy: await this.platformAdminService.getRuntimePromptPolicy(),
    };
  }

  @Get("runtime/route-policy")
  async getRuntimeRoutePolicy() {
    return {
      routePolicy: await this.platformAdminService.getRuntimeRoutePolicy(),
    };
  }

  @Patch("runtime/prompt-policy")
  async updateRuntimePromptPolicy(
    @Req() request: Record<string | symbol, unknown>,
    @Body() body: UpdateRuntimePromptPolicyInput,
  ) {
    const context = getPlatformAdminContext(request);
    assertCanMutate(context);

    return this.platformAdminService.updateRuntimePromptPolicy(context, body);
  }

  @Patch("runtime/route-policy")
  async updateRuntimeRoutePolicy(
    @Req() request: Record<string | symbol, unknown>,
    @Body() body: UpdateRuntimeRoutePolicyInput,
  ) {
    const context = getPlatformAdminContext(request);
    assertCanMutate(context);

    return this.platformAdminService.updateRuntimeRoutePolicy(context, body);
  }

  @Patch("organizations/:organizationId/billing-controls")
  updateBillingControls(
    @Req() request: Record<string | symbol, unknown>,
    @Param("organizationId") organizationId: string,
    @Body() body: Partial<PlatformBillingControls>,
  ) {
    const context = getPlatformAdminContext(request);
    assertCanMutate(context);

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
    assertCanMutate(context);
    assertImpersonationSafe(context.platformAuth);

    return this.platformAdminService.createImpersonationSession(context, organizationId, body);
  }

  @Delete("impersonation-sessions/:sessionId")
  revokeImpersonationSession(
    @Req() request: Record<string | symbol, unknown>,
    @Param("sessionId") sessionId: string,
  ) {
    const context = getPlatformAdminContext(request);
    assertCanMutate(context);
    assertImpersonationSafe(context.platformAuth);

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
    assertCanMutate(context);

    return this.platformAdminService.decideReview(context, reviewId, body);
  }
}

function assertCanMutate(context: ReturnType<typeof getPlatformAdminContext>) {
  if (!canMutatePlatform(context.platformRole)) {
    throw new ForbiddenException("Readonly platform roles cannot mutate platform operations.");
  }

  assertPlatformMutationAllowed(context.platformAuth);
}
