import { Body, Controller, Get, Headers, Param, Patch, Post, Res } from "@nestjs/common";

import { BillingService } from "./billing.service";
import type {
  CreateBillingCheckoutRequest,
  CreateBudgetCheckRequest,
  CreateCustomerPortalRequest,
  CreateRuntimeCostEventRequest,
  CreateTelephonyMinuteEventRequest,
  CreateUsageBillingEventRequest,
  PolarWebhookPayload,
  UpdateBudgetPolicyRequest,
} from "./billing.models";

@Controller()
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get("organizations/:organizationId/billing/state")
  async getBillingState(@Param("organizationId") organizationId: string) {
    return {
      billing: await this.billingService.getBillingState(organizationId),
    };
  }

  @Post("organizations/:organizationId/billing/checkout")
  async createCheckout(
    @Param("organizationId") organizationId: string,
    @Body() body: CreateBillingCheckoutRequest,
  ) {
    return {
      checkout: await this.billingService.createCheckout(organizationId, body),
    };
  }

  @Post("organizations/:organizationId/billing/customer-portal")
  async createCustomerPortal(
    @Param("organizationId") organizationId: string,
    @Body() body: CreateCustomerPortalRequest,
  ) {
    return {
      portal: await this.billingService.createCustomerPortal(organizationId, body),
    };
  }

  @Patch("organizations/:organizationId/billing/budget-policy")
  async updateBudgetPolicy(
    @Param("organizationId") organizationId: string,
    @Body() body: UpdateBudgetPolicyRequest,
  ) {
    return {
      budgetPolicy: await this.billingService.updateBudgetPolicy(organizationId, body),
    };
  }

  @Post("organizations/:organizationId/billing/budget-checks")
  async createBudgetCheck(
    @Param("organizationId") organizationId: string,
    @Body() body: CreateBudgetCheckRequest,
    @Res({ passthrough: true }) response: { status: (statusCode: number) => void },
  ) {
    response.status(200);

    return {
      budgetDecision: await this.billingService.createBudgetCheck(organizationId, body),
    };
  }

  @Post("organizations/:organizationId/billing/usage-events")
  async createUsageEvent(
    @Param("organizationId") organizationId: string,
    @Body() body: CreateUsageBillingEventRequest,
    @Res({ passthrough: true }) response: { status: (statusCode: number) => void },
  ) {
    const usageEvent = await this.billingService.createUsageBillingEvent(organizationId, body);
    response.status(usageEvent.duplicate === true ? 200 : 201);

    return {
      usageEvent,
    };
  }

  @Post("organizations/:organizationId/billing/telephony-minute-events")
  async createTelephonyMinuteEvent(
    @Param("organizationId") organizationId: string,
    @Body() body: CreateTelephonyMinuteEventRequest,
    @Res({ passthrough: true }) response: { status: (statusCode: number) => void },
  ) {
    const telephonyMinuteEvent = await this.billingService.createTelephonyMinuteEvent(organizationId, body);
    response.status(telephonyMinuteEvent.duplicate === true ? 200 : 201);

    return {
      telephonyMinuteEvent,
    };
  }

  @Post("organizations/:organizationId/billing/runtime-cost-events")
  async createRuntimeCostEvent(
    @Param("organizationId") organizationId: string,
    @Body() body: CreateRuntimeCostEventRequest,
    @Res({ passthrough: true }) response: { status: (statusCode: number) => void },
  ) {
    const runtimeCostEvent = await this.billingService.createRuntimeCostEvent(organizationId, body);
    response.status(runtimeCostEvent.duplicate === true ? 200 : 201);

    return {
      runtimeCostEvent,
    };
  }

  @Post("billing/polar/webhooks")
  async handlePolarWebhook(
    @Headers() headers: Record<string, string | undefined>,
    @Headers("polar-webhook-id") eventId: string | undefined,
    @Headers("polar-webhook-signature") signature: string | undefined,
    @Body() payload: PolarWebhookPayload,
    @Res({ passthrough: true }) response: { status: (statusCode: number) => void },
  ) {
    const webhook = await this.billingService.handlePolarWebhook({
      eventId,
      signature,
      headers,
      payload,
    });
    response.status(webhook.replay === true ? 200 : 201);

    return {
      webhook,
    };
  }
}
