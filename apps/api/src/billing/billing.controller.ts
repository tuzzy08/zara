import { Body, Controller, Get, Headers, Inject, NotFoundException, Param, Patch, Post, Req, Res, UseGuards, type RawBodyRequest } from "@nestjs/common";
import type { IncomingMessage } from "node:http";

import {
  TenantAuth,
  type TenantAuthContext,
  TenantOrganizationGuard,
  withTenantActor,
} from "../auth/tenant-auth";
import { BillingService } from "./billing.service";
import type {
  CreateBillingCheckoutRequest,
  CreateBudgetCheckRequest,
  CreateCustomerPortalRequest,
  CreatePaygCheckoutRequest,
  CreateRuntimeCostEventRequest,
  CreateTelephonyMinuteEventRequest,
  CreateUsageBillingEventRequest,
  PolarWebhookPayload,
  UpdateBudgetPolicyRequest,
} from "./billing.models";

export const ALLOW_LEGACY_BILLING_USAGE_TEST_FIXTURE = Symbol(
  "ALLOW_LEGACY_BILLING_USAGE_TEST_FIXTURE",
);

@Controller()
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    @Inject(ALLOW_LEGACY_BILLING_USAGE_TEST_FIXTURE)
    private readonly allowLegacyUsageTestFixture: boolean,
  ) {}

  @Get("organizations/:organizationId/billing/state")
  @UseGuards(TenantOrganizationGuard)
  async getBillingState(@Param("organizationId") organizationId: string) {
    return {
      billing: await this.billingService.getBillingState(organizationId),
    };
  }

  @Post("organizations/:organizationId/billing/checkout")
  @UseGuards(TenantOrganizationGuard)
  async createCheckout(
    @Param("organizationId") organizationId: string,
    @Body() body: CreateBillingCheckoutRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      checkout: await this.billingService.createCheckout(organizationId, withTenantActor(body, tenantAuth)),
    };
  }

  @Post("organizations/:organizationId/billing/customer-portal")
  @UseGuards(TenantOrganizationGuard)
  async createCustomerPortal(
    @Param("organizationId") organizationId: string,
    @Body() body: CreateCustomerPortalRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      portal: await this.billingService.createCustomerPortal(organizationId, withTenantActor(body, tenantAuth)),
    };
  }

  @Post("organizations/:organizationId/billing/payg-checkout")
  @UseGuards(TenantOrganizationGuard)
  async createPaygCheckout(
    @Param("organizationId") organizationId: string,
    @Body() body: CreatePaygCheckoutRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      checkout: await this.billingService.createPaygCheckout(
        organizationId,
        withTenantActor(body, tenantAuth),
      ),
    };
  }

  @Patch("organizations/:organizationId/billing/budget-policy")
  @UseGuards(TenantOrganizationGuard)
  async updateBudgetPolicy(
    @Param("organizationId") organizationId: string,
    @Body() body: UpdateBudgetPolicyRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      budgetPolicy: await this.billingService.updateBudgetPolicy(organizationId, withTenantActor(body, tenantAuth)),
    };
  }

  @Post("organizations/:organizationId/billing/budget-checks")
  @UseGuards(TenantOrganizationGuard)
  async createBudgetCheck(
    @Param("organizationId") organizationId: string,
    @Body() body: CreateBudgetCheckRequest,
    @Res({ passthrough: true }) response: { status: (statusCode: number) => void },
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    response.status(200);

    return {
      budgetDecision: await this.billingService.createBudgetCheck(organizationId, withTenantActor(body, tenantAuth)),
    };
  }

  @Post("organizations/:organizationId/billing/usage-events")
  @UseGuards(TenantOrganizationGuard)
  async createUsageEvent(
    @Param("organizationId") organizationId: string,
    @Body() body: CreateUsageBillingEventRequest,
    @Res({ passthrough: true }) response: { status: (statusCode: number) => void },
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    this.assertLegacyUsageTestFixture();
    const usageEvent = await this.billingService.createUsageBillingEvent(
      organizationId,
      withTenantActor(body, tenantAuth),
    );
    response.status(usageEvent.duplicate === true ? 200 : 201);

    return {
      usageEvent,
    };
  }

  @Post("organizations/:organizationId/billing/telephony-minute-events")
  @UseGuards(TenantOrganizationGuard)
  async createTelephonyMinuteEvent(
    @Param("organizationId") organizationId: string,
    @Body() body: CreateTelephonyMinuteEventRequest,
    @Res({ passthrough: true }) response: { status: (statusCode: number) => void },
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    this.assertLegacyUsageTestFixture();
    const telephonyMinuteEvent = await this.billingService.createTelephonyMinuteEvent(
      organizationId,
      withTenantActor(body, tenantAuth),
    );
    response.status(telephonyMinuteEvent.duplicate === true ? 200 : 201);

    return {
      telephonyMinuteEvent,
    };
  }

  @Post("organizations/:organizationId/billing/runtime-cost-events")
  @UseGuards(TenantOrganizationGuard)
  async createRuntimeCostEvent(
    @Param("organizationId") organizationId: string,
    @Body() body: CreateRuntimeCostEventRequest,
    @Res({ passthrough: true }) response: { status: (statusCode: number) => void },
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    this.assertLegacyUsageTestFixture();
    const runtimeCostEvent = await this.billingService.createRuntimeCostEvent(
      organizationId,
      withTenantActor(body, tenantAuth),
    );
    response.status(runtimeCostEvent.duplicate === true ? 200 : 201);

    return {
      runtimeCostEvent,
    };
  }

  @Post("billing/polar/webhooks")
  async handlePolarWebhook(
    @Req() request: RawBodyRequest<IncomingMessage>,
    @Headers() headers: Record<string, string | undefined>,
    @Headers("webhook-id") eventId: string | undefined,
    @Headers("webhook-signature") signature: string | undefined,
    @Body() payload: PolarWebhookPayload,
    @Res({ passthrough: true }) response: { status: (statusCode: number) => void },
  ) {
    const webhook = await this.billingService.handlePolarWebhook({
      eventId,
      signature,
      headers,
      payload,
      rawBody: request.rawBody,
    });
    response.status(webhook.replay === true ? 200 : 201);

    return {
      webhook,
    };
  }

  private assertLegacyUsageTestFixture() {
    if (!this.allowLegacyUsageTestFixture) {
      throw new NotFoundException("Billing usage mutations are server-owned.");
    }
  }
}
