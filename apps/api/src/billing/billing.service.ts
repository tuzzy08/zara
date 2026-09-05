import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { validateEvent, WebhookVerificationError } from "@polar-sh/sdk/webhooks";
import { SDKValidationError } from "@polar-sh/sdk/models/errors/sdkvalidationerror";

import {
  BILLING_STATE_REPOSITORY,
  type BillingStateRepository,
  type PersistedBillingStateRecord,
  PostgresBillingStateRepository,
} from "./billing-state.repository";
import { BILLING_POLAR_CLIENT, type BillingPolarClient } from "./polar-billing.client";
import {
  BILLING_LEDGER_REPOSITORY,
  type BillingEntitlementProjectionRecord,
  type BillingSubscriptionProjectionRecord,
  type PostgresBillingLedgerRepository,
} from "./postgres-billing-ledger.repository";
import { BILLING_READ_MODEL_REPOSITORY, type BillingReadModelRepository } from "./billing-read-model.repository";
import { projectPolarSubscription, selectActiveSubscription } from "./billing-payment-state-policy";
import type {
  BillingActorRole,
  BillingBudgetDecisionResponse,
  BillingBudgetPolicyResponse,
  BillingBudgetWarningResponse,
  BillingTelephonyMinuteAggregateResponse,
  BillingCheckoutResponse,
  BillingEntitlementResponse,
  BillingInvoiceResponse,
  BillingPlanResponse,
  BillingPlanSlug,
  BillingSubscriptionStatus,
  CreateBillingCheckoutRequest,
  CreateBudgetCheckRequest,
  CreateCustomerPortalRequest,
  CreatePaygCheckoutRequest,
  CreateRuntimeCostEventRequest,
  CreateTelephonyMinuteEventRequest,
  CreateUsageBillingEventRequest,
  CustomerPortalResponse,
  PolarBenefitPayload,
  PolarCustomerStateWebhookPayload,
  PolarOrderPaidWebhookPayload,
  PolarOrderRefundedWebhookPayload,
  PolarSubscriptionPastDueWebhookPayload,
  PolarWebhookPayload,
  PolarWebhookResponse,
  RuntimeCostComponentResponse,
  RuntimeCostEventResponse,
  TenantBillingStateResponse,
  TelephonyMinuteEventResponse,
  UpdateBudgetPolicyRequest,
  UsageBillingEventResponse,
  BillingUsageAggregateResponse,
  BillingPaygCheckoutResponse,
} from "./billing.models";

const planNamesBySlug: Record<BillingPlanSlug, string> = {
  starter: "Starter",
  growth: "Growth",
  scale: "Scale",
};

const runtimeRateCatalogs: Record<
  string,
  {
    sttPerMinuteUsd: Record<string, number>;
    modelInputPer1kTokensUsd: Record<string, number>;
    modelOutputPer1kTokensUsd: Record<string, number>;
    ttsPer1kCharactersUsd: Record<string, number>;
  }
> = {
  "runtime-rates-2026-05": {
    sttPerMinuteUsd: {
      "assemblyai-streaming": 0.00025,
    },
    modelInputPer1kTokensUsd: {
      cheap: 0.00005,
      standard: 0.00015,
      sota: 0.0025,
    },
    modelOutputPer1kTokensUsd: {
      cheap: 0.0002,
      standard: 0.0006,
      sota: 0.01,
    },
    ttsPer1kCharactersUsd: {
      "cartesia-sonic-3": 0.03,
    },
  },
};

@Injectable()
export class BillingService {
  constructor(
    @Inject(BILLING_STATE_REPOSITORY)
    private readonly stateRepository: BillingStateRepository,
    @Inject(BILLING_POLAR_CLIENT)
    private readonly polarClient: BillingPolarClient,
    @Inject(BILLING_LEDGER_REPOSITORY)
    private readonly ledgerRepository: Pick<
      PostgresBillingLedgerRepository,
      | "recordPolarWebhookReceipt"
      | "markPolarWebhookProcessed"
      | "markPolarWebhookFailed"
      | "findPolarMappingByProviderId"
      | "applyPaidPaygOrder"
      | "applyPaygOrderRefund"
      | "upsertTenantAccount"
      | "applyPolarCustomerStateProjection"
      | "applyPaidInvoiceProjection"
      | "upsertSubscriptionProjection"
      | "listSubscriptionProjections"
    >,
    @Optional()
    @Inject(BILLING_READ_MODEL_REPOSITORY)
    private readonly readModelRepository?: BillingReadModelRepository,
  ) {}

  async getRuntimeAccessPosture(input: {
    organizationId: string;
    accessContext: "platform_managed_pstn" | "byo_live_runtime";
    now: string;
  }) {
    const subscriptions = await this.ledgerRepository.listSubscriptionProjections(input.organizationId);
    const subscription = subscriptions[0];
    if (subscription?.status === "active" || subscription?.status === "trialing") {
      return {
        subscriptionStatus: subscription.status,
        accessAllowed: true,
        reason: "subscription_active" as const,
      };
    }
    if (subscription?.status === "past_due") {
      if (input.accessContext === "byo_live_runtime") {
        const graceEndsAt = new Date(Date.parse(subscription.updatedAt) + 72 * 60 * 60 * 1_000).toISOString();
        const accessAllowed = Number.isFinite(Date.parse(input.now)) && Date.parse(input.now) < Date.parse(graceEndsAt);
        return {
          subscriptionStatus: "past_due" as const,
          accessAllowed,
          reason: accessAllowed ? ("byo_payment_grace" as const) : ("payment_grace_expired" as const),
          graceEndsAt,
        };
      }
      return {
        subscriptionStatus: "past_due" as const,
        accessAllowed: false,
        reason: "platform_pstn_payment_past_due" as const,
      };
    }
    return {
      subscriptionStatus: "none" as const,
      accessAllowed: false,
      reason: "subscription_inactive" as const,
    };
  }

  async getBillingState(organizationId: string): Promise<TenantBillingStateResponse> {
    if (this.readModelRepository !== undefined && this.stateRepository instanceof PostgresBillingStateRepository) {
      return this.readModelRepository.load(organizationId);
    }
    const state = await this.getOrCreateState(organizationId);
    return toBillingStateResponse(state);
  }

  async createCheckout(organizationId: string, input: CreateBillingCheckoutRequest): Promise<BillingCheckoutResponse> {
    assertBillingAdmin(input.actorRole);
    const state = await this.getOrCreateState(organizationId);
    const environment = process.env.POLAR_SERVER === "production" ? "production" : "sandbox";
    const productId = (await this.readModelRepository?.getSubscriptionProductId(input.planSlug, environment)) ?? null;
    if (productId === null) {
      throw new NotFoundException(`The ${input.planSlug} plan checkout is not configured.`);
    }
    const now = new Date().toISOString();
    const polarCheckout = await this.polarClient.createCheckout({
      externalCustomerId: organizationId,
      productId,
      successUrl: input.successUrl,
      returnUrl: input.returnUrl,
      metadata: {
        organizationId,
        actorUserId: input.actorUserId,
        planSlug: input.planSlug,
      },
    });
    const checkout: BillingCheckoutResponse = {
      id: `billing_checkout_${randomUUID()}`,
      organizationId,
      provider: "polar",
      planSlug: input.planSlug,
      providerCheckoutId: polarCheckout.providerCheckoutId,
      checkoutUrl: polarCheckout.checkoutUrl,
      status: "open",
      createdBy: input.actorUserId,
      createdAt: now,
    };

    await this.ledgerRepository.upsertTenantAccount({
      organizationId,
      provider: "polar",
      createdAt: now,
      updatedAt: now,
    });

    state.checkouts = [checkout, ...state.checkouts];
    state.plan = createPlan(input.planSlug, state.subscription.status, state.plan?.budgetUsedUsd ?? 0);
    state.updatedAt = now;
    await this.stateRepository.save(state);

    return checkout;
  }

  async createCustomerPortal(
    organizationId: string,
    input: CreateCustomerPortalRequest,
  ): Promise<CustomerPortalResponse> {
    assertBillingAdmin(input.actorRole);
    const state = await this.getOrCreateState(organizationId);
    const portal = await this.polarClient.createCustomerPortal({
      externalCustomerId: organizationId,
      returnUrl: input.returnUrl,
    });
    const response: CustomerPortalResponse = {
      organizationId,
      provider: "polar",
      customerPortalUrl: portal.customerPortalUrl,
      createdBy: input.actorUserId,
      createdAt: new Date().toISOString(),
    };

    state.updatedAt = response.createdAt;
    await this.stateRepository.save(state);

    return response;
  }

  async updateBudgetPolicy(
    organizationId: string,
    input: UpdateBudgetPolicyRequest,
  ): Promise<BillingBudgetPolicyResponse> {
    assertBillingAdmin(input.actorRole);
    assertPositive(input.monthlyBudgetUsd, "Monthly budget must be greater than zero.");
    assertPositive(input.callMinuteLimit, "Call minute limit must be greater than zero.");
    assertPositive(input.premiumRuntimeMinuteLimit, "Premium runtime minute limit must be greater than zero.");
    const state = await this.getOrCreateState(organizationId);
    const policy: BillingBudgetPolicyResponse = {
      monthlyBudgetUsd: input.monthlyBudgetUsd,
      callMinuteLimit: input.callMinuteLimit,
      premiumRuntimeMinuteLimit: input.premiumRuntimeMinuteLimit,
      overBudgetBehavior: input.overBudgetBehavior,
      warningThresholdPercent: input.warningThresholdPercent ?? 80,
      updatedBy: input.actorUserId,
      updatedAt: input.now ?? new Date().toISOString(),
    };

    state.budgetPolicy = policy;
    if (state.plan !== null) {
      state.plan = createPlan(state.plan.slug, state.plan.status, state.plan.budgetUsedUsd, policy.monthlyBudgetUsd);
    }
    state.updatedAt = policy.updatedAt;
    await this.stateRepository.save(state);

    return policy;
  }

  async createBudgetCheck(
    organizationId: string,
    input: CreateBudgetCheckRequest,
  ): Promise<BillingBudgetDecisionResponse> {
    assertBillingAdmin(input.actorRole);
    const state = await this.getOrCreateState(organizationId);
    const policy = resolveBudgetPolicy(state);
    const current = getCurrentBudgetUsage(state);
    const projected = {
      budgetUsedUsd: roundMoney(current.budgetUsedUsd + Math.max(0, input.estimatedCostUsd)),
      callMinutes: roundUsage(current.callMinutes + Math.max(0, input.callMinutes ?? 0)),
      premiumRuntimeMinutes: roundUsage(current.premiumRuntimeMinutes + Math.max(0, input.premiumRuntimeMinutes ?? 0)),
    };
    const reasons: BillingBudgetDecisionResponse["reasons"] = [];
    if (projected.budgetUsedUsd > policy.monthlyBudgetUsd) {
      reasons.push("monthly_budget_exceeded");
    }
    if (projected.callMinutes > policy.callMinuteLimit) {
      reasons.push("call_minute_limit_exceeded");
    }
    if (projected.premiumRuntimeMinutes > policy.premiumRuntimeMinuteLimit) {
      reasons.push("premium_runtime_limit_exceeded");
    }

    const action = reasons.length === 0 ? "allow" : policy.overBudgetBehavior;
    const decision: BillingBudgetDecisionResponse = {
      id: `budget_decision_${randomUUID()}`,
      organizationId,
      allowed: action !== "block",
      action,
      overBudgetBehavior: policy.overBudgetBehavior,
      reasons,
      projected,
      checkedAt: input.now ?? new Date().toISOString(),
    };

    state.budgetDecisions = [decision, ...(state.budgetDecisions ?? [])];
    state.updatedAt = decision.checkedAt;
    await this.stateRepository.save(state);

    return decision;
  }

  async createUsageBillingEvent(
    organizationId: string,
    input: CreateUsageBillingEventRequest,
  ): Promise<UsageBillingEventResponse> {
    assertBillingAdmin(input.actorRole);
    if (input.units <= 0) {
      throw new BadRequestException("Usage event units must be greater than zero.");
    }

    const state = await this.getOrCreateState(organizationId);
    const duplicate = state.usageEvents.find((event) => event.idempotencyKey === input.idempotencyKey);
    if (duplicate !== undefined) {
      return {
        ...duplicate,
        duplicate: true,
      };
    }

    const polarUsage = await this.polarClient.ingestUsageEvent({
      externalCustomerId: organizationId,
      externalId: input.idempotencyKey,
      name: input.name,
      units: input.units,
      timestamp: input.occurredAt,
      metadata: {
        ...(input.metadata ?? {}),
        feature: resolveUsageFeature(input),
      },
    });
    const usageEvent: UsageBillingEventResponse = {
      id: `billing_usage_${randomUUID()}`,
      organizationId,
      provider: "polar",
      idempotencyKey: input.idempotencyKey,
      name: input.name,
      feature: resolveUsageFeature(input),
      units: input.units,
      occurredAt: input.occurredAt,
      status: "sent",
      providerEventId: polarUsage.providerEventId,
      sentAt: new Date().toISOString(),
    };

    state.usageEvents = [usageEvent, ...state.usageEvents];
    state.updatedAt = usageEvent.sentAt;
    await this.stateRepository.save(state);

    return usageEvent;
  }

  async createTelephonyMinuteEvent(
    organizationId: string,
    input: CreateTelephonyMinuteEventRequest,
  ): Promise<TelephonyMinuteEventResponse> {
    assertBillingAdmin(input.actorRole);
    const provider = assertNonEmpty(input.provider, "Telephony provider is required.");
    const providerConnectionId = assertNonEmpty(
      input.providerConnectionId,
      "Telephony provider connection is required.",
    );
    const callSessionId = assertNonEmpty(input.callSessionId, "Telephony call session id is required.");
    const state = await this.getOrCreateState(organizationId);
    const duplicate = (state.telephonyMinuteEvents ?? []).find(
      (event) => event.callSessionId === callSessionId && event.providerConnectionId === providerConnectionId,
    );
    if (duplicate !== undefined) {
      return {
        ...duplicate,
        duplicate: true,
      };
    }

    const durationSeconds = calculateDurationSeconds(input.startedAt, input.endedAt);
    const billableMinutes = input.outcome === "failed" ? 0 : Math.ceil(durationSeconds / 60);
    const occurredAt = input.endedAt;
    const event: TelephonyMinuteEventResponse = {
      id: `telephony_minutes_${randomUUID()}`,
      organizationId,
      provider,
      providerConnectionId,
      callSessionId,
      classification: input.outcome,
      durationSeconds,
      billableMinutes,
      roundingPolicy: "round_up_to_next_full_minute",
      ...(input.failureReason === undefined ? {} : { failureReason: input.failureReason }),
      occurredAt,
    };

    state.telephonyMinuteEvents = [event, ...(state.telephonyMinuteEvents ?? [])];

    if (billableMinutes > 0) {
      const idempotencyKey = `telephony-minute-${callSessionId}`;
      const polarUsage = await this.polarClient.ingestUsageEvent({
        externalCustomerId: organizationId,
        externalId: idempotencyKey,
        name: "zara_telephony_minutes",
        units: billableMinutes,
        timestamp: occurredAt,
        metadata: {
          feature: "telephony_minutes",
          provider,
          providerConnectionId,
          callSessionId,
          classification: input.outcome,
        },
      });
      state.usageEvents = [
        {
          id: `billing_usage_${randomUUID()}`,
          organizationId,
          provider: "polar",
          idempotencyKey,
          name: "zara_telephony_minutes",
          feature: "telephony_minutes",
          units: billableMinutes,
          occurredAt,
          status: "sent",
          providerEventId: polarUsage.providerEventId,
          sentAt: new Date().toISOString(),
        },
        ...state.usageEvents,
      ];
    }

    state.updatedAt = new Date().toISOString();
    await this.stateRepository.save(state);

    return event;
  }

  async createRuntimeCostEvent(
    organizationId: string,
    input: CreateRuntimeCostEventRequest,
  ): Promise<RuntimeCostEventResponse> {
    assertBillingAdmin(input.actorRole);
    const sourceRuntimeEventId = assertNonEmpty(input.runtimeEventId, "Runtime event id is required.");
    const sessionId = assertNonEmpty(input.sessionId, "Runtime session id is required.");
    const modelTier = assertNonEmpty(input.modelTier, "Runtime model tier is required.");
    const rateVersion = assertNonEmpty(input.rateVersion, "Runtime rate version is required.");
    const state = await this.getOrCreateState(organizationId);
    const duplicate = (state.runtimeCostEvents ?? []).find(
      (event) => event.sourceRuntimeEventId === sourceRuntimeEventId,
    );
    if (duplicate !== undefined) {
      return {
        ...duplicate,
        duplicate: true,
      };
    }

    const components = buildRuntimeCostComponents(input, modelTier, rateVersion);
    const missingRates = components
      .filter((component) => component.missingRate)
      .map((component) => `${component.kind}:${component.kind.startsWith("model") ? modelTier : component.feature}`);
    const event: RuntimeCostEventResponse = {
      id: `runtime_cost_${randomUUID()}`,
      organizationId,
      sourceRuntimeEventId,
      sessionId,
      ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
      modelTier,
      rateVersion,
      totalUsd: roundMoney(components.reduce((total, component) => total + component.totalUsd, 0)),
      complete: missingRates.length === 0,
      missingRates,
      components,
      occurredAt: input.occurredAt,
    };

    const usageEvents = await this.createRuntimeUsageEvents({
      organizationId,
      sourceRuntimeEventId,
      sessionId,
      workspaceId: input.workspaceId,
      occurredAt: input.occurredAt,
      rateVersion,
      modelTier,
      components: components.filter((component) => !component.missingRate && component.units > 0),
    });

    state.runtimeCostEvents = [event, ...(state.runtimeCostEvents ?? [])];
    state.usageEvents = [...usageEvents, ...state.usageEvents];
    if (state.plan !== null) {
      state.plan = createPlan(
        state.plan.slug,
        state.plan.status,
        roundMoney(state.plan.budgetUsedUsd + event.totalUsd),
      );
    }
    state.updatedAt = new Date().toISOString();
    await this.stateRepository.save(state);

    return event;
  }

  private async createRuntimeUsageEvents(input: {
    organizationId: string;
    sourceRuntimeEventId: string;
    sessionId: string;
    workspaceId?: string | undefined;
    occurredAt: string;
    rateVersion: string;
    modelTier: string;
    components: RuntimeCostComponentResponse[];
  }) {
    const usageEvents: UsageBillingEventResponse[] = [];

    for (const component of input.components) {
      const idempotencyKey = `runtime-cost-${input.sourceRuntimeEventId}-${component.feature}`;
      const polarUsage = await this.polarClient.ingestUsageEvent({
        externalCustomerId: input.organizationId,
        externalId: idempotencyKey,
        name: `zara_runtime_${component.feature}`,
        units: component.units,
        timestamp: input.occurredAt,
        metadata: {
          feature: component.feature,
          runtimeEventId: input.sourceRuntimeEventId,
          sessionId: input.sessionId,
          ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
          rateVersion: input.rateVersion,
          modelTier: input.modelTier,
        },
      });

      usageEvents.push({
        id: `billing_usage_${randomUUID()}`,
        organizationId: input.organizationId,
        provider: "polar",
        idempotencyKey,
        name: `zara_runtime_${component.feature}`,
        feature: component.feature,
        units: component.units,
        occurredAt: input.occurredAt,
        status: "sent",
        providerEventId: polarUsage.providerEventId,
        sentAt: new Date().toISOString(),
      });
    }

    return usageEvents;
  }

  async handlePolarWebhook(input: {
    eventId: string | undefined;
    signature: string | undefined;
    headers?: Record<string, string | undefined> | undefined;
    payload: PolarWebhookPayload;
    rawBody?: Buffer | undefined;
  }): Promise<PolarWebhookResponse> {
    if (input.eventId === undefined || input.eventId.trim().length === 0) {
      throw new BadRequestException("Polar webhook id is required.");
    }

    if (input.signature === undefined || input.signature.trim().length === 0) {
      throw new BadRequestException("Polar webhook signature is required.");
    }

    verifyPolarWebhookSignature({
      rawBody: input.rawBody,
      headers: {
        "webhook-id": input.eventId,
        "webhook-signature": input.signature,
        ...(input.headers ?? {}),
      },
    });

    const organizationId = resolveOrganizationId(input.payload);
    if (organizationId === undefined) {
      throw new BadRequestException("Polar webhook is missing the customer external organization id.");
    }

    const handledAt = new Date().toISOString();
    const receipt = await this.ledgerRepository.recordPolarWebhookReceipt({
      organizationId,
      eventId: input.eventId,
      eventType: input.payload.type,
      payloadHash: createHash("sha256").update(JSON.stringify(input.payload)).digest("hex"),
      receivedAt: handledAt,
    });
    if (receipt.duplicate) {
      return {
        eventId: input.eventId,
        provider: "polar",
        organizationId,
        processed: false,
        replay: true,
        handledAt,
      };
    }
    try {
      const state = await this.getOrCreateState(organizationId);
      if (state.processedWebhookIds.includes(input.eventId)) {
        return {
          eventId: input.eventId,
          provider: "polar",
          organizationId,
          processed: false,
          replay: true,
          handledAt,
        };
      }

      let paygCreditPackOrder = false;
      if (isCustomerStateWebhook(input.payload)) {
        const customer = resolvePolarStateCustomer(input.payload);
        if (customer?.id === undefined) {
          throw new BadRequestException("Polar customer state is missing the customer id.");
        }
        const environment = process.env.POLAR_SERVER === "production" ? "production" : "sandbox";
        const subscriptions: BillingSubscriptionProjectionRecord[] = [];
        const subscriptionPlanSlugs = new Map<string, BillingPlanSlug>();
        for (const subscription of input.payload.data.activeSubscriptions ??
          input.payload.data.active_subscriptions ??
          []) {
          const productId = subscription.productId ?? subscription.product_id;
          if (subscription.id === undefined || productId === undefined) {
            throw new BadRequestException("Polar subscription state is incomplete.");
          }
          const mapping = await this.ledgerRepository.findPolarMappingByProviderId(productId, environment);
          if (mapping?.mappingType !== "product") {
            throw new BadRequestException(`Polar product ${productId} has no billing catalog mapping.`);
          }
          const planSlug = parseBillingPlanSlug(mapping.internalKey);
          subscriptionPlanSlugs.set(productId, planSlug);
          const createdAt = subscription.createdAt ?? subscription.created_at ?? handledAt;
          subscriptions.push({
            id: subscription.id,
            organizationId,
            providerSubscriptionId: subscription.id,
            catalogId: mapping.catalogId,
            planSlug,
            status: subscription.status ?? "unknown",
            currentPeriodEnd: subscription.currentPeriodEnd ?? subscription.current_period_end,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd ?? subscription.cancel_at_period_end ?? false,
            version: 1,
            createdAt,
            updatedAt: subscription.modifiedAt ?? subscription.modified_at ?? createdAt,
          });
        }
        const entitlements: BillingEntitlementProjectionRecord[] = [];
        for (const benefit of input.payload.data.grantedBenefits ?? input.payload.data.granted_benefits ?? []) {
          const benefitId = benefit.benefitId ?? benefit.benefit_id;
          if (benefit.id === undefined || benefitId === undefined) {
            throw new BadRequestException("Polar benefit state is incomplete.");
          }
          const mapping = await this.ledgerRepository.findPolarMappingByProviderId(benefitId, environment);
          if (mapping?.mappingType !== "benefit") {
            throw new BadRequestException(`Polar benefit ${benefitId} has no billing catalog mapping.`);
          }
          const createdAt = benefit.createdAt ?? benefit.created_at ?? handledAt;
          entitlements.push({
            id: benefit.id,
            organizationId,
            providerBenefitId: benefitId,
            key: mapping.internalKey,
            status: "active",
            metadata: {
              benefitType: benefit.benefitType ?? benefit.benefit_type ?? benefit.type ?? "unknown",
            },
            createdAt,
            updatedAt: benefit.modifiedAt ?? benefit.modified_at ?? createdAt,
          });
        }
        await this.ledgerRepository.applyPolarCustomerStateProjection({
          account: {
            organizationId,
            provider: "polar",
            providerCustomerId: customer.id,
            createdAt: handledAt,
            updatedAt: handledAt,
          },
          subscriptions,
          entitlements,
          reconciledAt: handledAt,
        });
        applyCustomerStateWebhook(state, input.payload, subscriptionPlanSlugs);
      } else if (isSubscriptionPastDueWebhook(input.payload)) {
        const subscription = input.payload.data;
        const productId = subscription.productId ?? subscription.product_id;
        const createdAt = subscription.createdAt ?? subscription.created_at;
        const updatedAt = subscription.modifiedAt ?? subscription.modified_at;
        if (
          subscription.id === undefined ||
          subscription.customer?.id === undefined ||
          productId === undefined ||
          subscription.status !== "past_due" ||
          subscription.currency?.toLowerCase() !== "usd" ||
          typeof subscription.amount !== "number" ||
          !Number.isSafeInteger(subscription.amount) ||
          subscription.amount < 0 ||
          typeof createdAt !== "string" ||
          !Number.isFinite(Date.parse(createdAt)) ||
          typeof updatedAt !== "string" ||
          !Number.isFinite(Date.parse(updatedAt))
        ) {
          throw new BadRequestException("Polar payment-failure data is invalid.");
        }
        const mapping = await this.ledgerRepository.findPolarMappingByProviderId(
          productId,
          process.env.POLAR_SERVER === "production" ? "production" : "sandbox",
        );
        if (mapping?.mappingType !== "product") {
          throw new BadRequestException(`Polar product ${productId} has no billing catalog mapping.`);
        }
        const planSlug = parseBillingPlanSlug(mapping.internalKey);
        await this.ledgerRepository.upsertSubscriptionProjection({
          id: subscription.id,
          organizationId,
          providerSubscriptionId: subscription.id,
          catalogId: mapping.catalogId,
          planSlug,
          status: "past_due",
          currentPeriodEnd: subscription.currentPeriodEnd ?? subscription.current_period_end,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd ?? subscription.cancel_at_period_end ?? false,
          version: 1,
          createdAt,
          updatedAt,
        });
        applySubscriptionPastDueWebhook(state, input.payload, planSlug);
      } else if (isOrderPaidWebhook(input.payload)) {
        const orderId = input.payload.data.id;
        const amountMinor = input.payload.data.totalAmount ?? input.payload.data.total_amount;
        const currency = input.payload.data.currency?.toLowerCase();
        const invoiceNumber = input.payload.data.invoiceNumber ?? input.payload.data.invoice_number;
        const issuedAt = input.payload.data.createdAt ?? input.payload.data.created_at;
        if (
          orderId === undefined ||
          typeof amountMinor !== "number" ||
          !Number.isSafeInteger(amountMinor) ||
          amountMinor < 0 ||
          currency !== "usd" ||
          typeof invoiceNumber !== "string" ||
          invoiceNumber.trim() === "" ||
          typeof issuedAt !== "string" ||
          !Number.isFinite(Date.parse(issuedAt)) ||
          input.payload.data.status !== "paid" ||
          input.payload.data.paid !== true
        ) {
          throw new BadRequestException("Polar paid order data is invalid.");
        }
        const productId = input.payload.data.productId ?? input.payload.data.product_id;
        const mapping =
          productId === undefined
            ? null
            : await this.ledgerRepository.findPolarMappingByProviderId(
                productId,
                process.env.POLAR_SERVER === "production" ? "production" : "sandbox",
              );
        paygCreditPackOrder = mapping?.mappingType === "credit_pack" && mapping.internalKey === "payg-5-usd";
        if (paygCreditPackOrder) {
          if (amountMinor !== 500) {
            throw new BadRequestException("The approved PAYG pack is exactly USD 5.00.");
          }
          const createdAt = input.payload.data.createdAt ?? input.payload.data.created_at ?? handledAt;
          await this.ledgerRepository.applyPaidPaygOrder({
            order: {
              id: `payg-order:${orderId}`,
              organizationId,
              providerOrderId: orderId,
              currency: "usd",
              paidAmountMinor: 500,
              grantedCreditMinor: 500,
              status: "paid",
              createdAt,
            },
            grant: {
              id: `payg-grant:${orderId}`,
              organizationId,
              orderId: `payg-order:${orderId}`,
              entryType: "grant",
              amountMinor: 500,
              idempotencyKey: `polar-order:${orderId}:grant`,
              createdAt,
            },
          });
        }
        const createdAt = issuedAt;
        await this.ledgerRepository.applyPaidInvoiceProjection({
          id: `polar-invoice:${orderId}`,
          organizationId,
          providerOrderId: orderId,
          invoiceNumber,
          currency: "usd",
          amountMinor,
          status: "paid",
          issuedAt: createdAt,
          metadata: productId === undefined ? {} : { productId },
          createdAt,
        });
        const subscriptionPlanSlug =
          mapping?.mappingType === "product" ? parseBillingPlanSlug(mapping.internalKey) : undefined;
        applyOrderPaidWebhook(state, input.payload, subscriptionPlanSlug);
      } else if (isOrderRefundedWebhook(input.payload)) {
        const productId = input.payload.data.productId ?? input.payload.data.product_id;
        const mapping =
          productId === undefined
            ? null
            : await this.ledgerRepository.findPolarMappingByProviderId(
                productId,
                process.env.POLAR_SERVER === "production" ? "production" : "sandbox",
              );
        const orderId = input.payload.data.id;
        const totalAmount = input.payload.data.totalAmount ?? input.payload.data.total_amount;
        const refundedAmount = input.payload.data.refundedAmount ?? input.payload.data.refunded_amount;
        const refundedTaxAmount = input.payload.data.refundedTaxAmount ?? input.payload.data.refunded_tax_amount ?? 0;
        const currency = input.payload.data.currency?.toLowerCase();
        if (
          mapping?.mappingType !== "credit_pack" ||
          mapping.internalKey !== "payg-5-usd" ||
          orderId === undefined ||
          totalAmount !== 500 ||
          typeof refundedAmount !== "number" ||
          typeof refundedTaxAmount !== "number" ||
          refundedAmount + refundedTaxAmount !== totalAmount ||
          currency !== "usd"
        ) {
          throw new BadRequestException("Only a full refund of the unused USD 5.00 PAYG pack can be reversed.");
        }
        const refundedAt = input.payload.data.modifiedAt ?? input.payload.data.modified_at ?? handledAt;
        await this.ledgerRepository.applyPaygOrderRefund({
          organizationId,
          providerOrderId: orderId,
          reversal: {
            id: `payg-reversal:${orderId}`,
            organizationId,
            orderId: `payg-order:${orderId}`,
            entryType: "reversal",
            amountMinor: 500,
            idempotencyKey: `polar-order:${orderId}:refund`,
            createdAt: refundedAt,
          },
        });
      }

      state.processedWebhookIds = [input.eventId, ...state.processedWebhookIds];
      state.updatedAt = handledAt;
      await this.stateRepository.save(state);
      await this.ledgerRepository.markPolarWebhookProcessed({
        organizationId,
        eventId: input.eventId,
        processedAt: handledAt,
      });

      return {
        eventId: input.eventId,
        provider: "polar",
        organizationId,
        processed: true,
        handledAt,
      };
    } catch (error) {
      await this.ledgerRepository.markPolarWebhookFailed({
        organizationId,
        eventId: input.eventId,
        error: "Polar webhook processing failed.",
      });
      throw error;
    }
  }

  async createPaygCheckout(
    organizationId: string,
    input: CreatePaygCheckoutRequest,
  ): Promise<BillingPaygCheckoutResponse> {
    assertBillingAdmin(input.actorRole);
    if (this.readModelRepository === undefined) {
      throw new NotFoundException("PAYG checkout is not configured.");
    }
    const environment = process.env.POLAR_SERVER === "production" ? "production" : "sandbox";
    const productId = await this.readModelRepository.getPaygProductId(environment);
    if (productId === null) {
      throw new NotFoundException("The $5 PAYG credit pack is not configured.");
    }
    const now = new Date().toISOString();
    const checkout = await this.polarClient.createCheckout({
      externalCustomerId: organizationId,
      productId,
      successUrl: input.successUrl,
      returnUrl: input.returnUrl,
      metadata: {
        organizationId,
        actorUserId: input.actorUserId,
        offer: "payg-5-usd",
      },
    });
    return {
      id: `billing_payg_checkout_${randomUUID()}`,
      organizationId,
      provider: "polar",
      packAmountMinor: 500,
      currency: "usd",
      providerCheckoutId: checkout.providerCheckoutId,
      checkoutUrl: checkout.checkoutUrl,
      status: "open",
      createdBy: input.actorUserId,
      createdAt: now,
    };
  }

  private async getOrCreateState(organizationId: string): Promise<PersistedBillingStateRecord> {
    const persistedState = await this.stateRepository.load(organizationId);
    if (persistedState !== null) {
      return persistedState;
    }

    const state = createInitialState(organizationId);
    await this.stateRepository.save(state);
    return state;
  }
}

function assertBillingAdmin(role: BillingActorRole | undefined) {
  if (role !== "owner" && role !== "admin") {
    throw new ForbiddenException("Tenant billing admin access is required.");
  }
}

function assertNonEmpty(value: string | undefined, message: string) {
  const normalizedValue = value?.trim();
  if (normalizedValue === undefined || normalizedValue.length === 0) {
    throw new BadRequestException(message);
  }

  return normalizedValue;
}

function assertPositive(value: number, message: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new BadRequestException(message);
  }
}

function calculateDurationSeconds(startedAt: string, endedAt: string) {
  const startedAtMs = Date.parse(startedAt);
  const endedAtMs = Date.parse(endedAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) {
    throw new BadRequestException("Telephony minute events require valid ISO timestamps.");
  }

  const durationMs = endedAtMs - startedAtMs;
  if (durationMs < 0) {
    throw new BadRequestException("Telephony minute event end time must be after start time.");
  }

  return Math.ceil(durationMs / 1000);
}

function createInitialState(organizationId: string): PersistedBillingStateRecord {
  const now = new Date().toISOString();

  return {
    schemaVersion: 1,
    organizationId,
    customerExternalId: organizationId,
    plan: null,
    subscription: {
      provider: "polar",
      status: "none",
      cancelAtPeriodEnd: false,
    },
    usage: [],
    budgetPolicy: createDefaultBudgetPolicy(null, now),
    budgetDecisions: [],
    entitlements: [],
    invoices: [],
    checkouts: [],
    usageEvents: [],
    telephonyMinuteEvents: [],
    runtimeCostEvents: [],
    processedWebhookIds: [],
    updatedAt: now,
  };
}

function createPlan(
  slug: BillingPlanSlug,
  status: BillingSubscriptionStatus,
  budgetUsedUsd: number,
  overrideBudgetLimitUsd?: number | undefined,
): BillingPlanResponse {
  const budgetLimitUsd = overrideBudgetLimitUsd ?? 0;

  return {
    slug,
    name: planNamesBySlug[slug],
    status,
    monthlyBaseUsd: 0,
    includedMinutes: 0,
    budgetLimitUsd,
    budgetUsedUsd,
    budgetWarning: budgetLimitUsd > 0 && budgetUsedUsd / budgetLimitUsd >= 0.8,
    monthlyBaseMinor: null,
    includedStandardRuntimeSeconds: null,
    includedPremiumRuntimeSeconds: null,
  };
}

function toBillingStateResponse(state: PersistedBillingStateRecord): TenantBillingStateResponse {
  const budgetPolicy = resolveBudgetPolicy(state);

  return {
    organizationId: state.organizationId,
    provider: "polar",
    currency: "usd",
    customerExternalId: state.customerExternalId,
    plan: state.plan === null ? null : { ...state.plan },
    subscription: { ...state.subscription },
    usage: state.usage.map((usage) => ({ ...usage })),
    budgetPolicy: { ...budgetPolicy },
    budgetWarnings: createBudgetWarnings(state, budgetPolicy),
    usageAggregates: createUsageAggregates(state),
    telephonyMinuteAggregates: createTelephonyMinuteAggregates(state),
    runtimeCostEvents: (state.runtimeCostEvents ?? []).map((runtimeCostEvent) => ({
      ...runtimeCostEvent,
      components: runtimeCostEvent.components.map((component) => ({
        ...component,
      })),
      missingRates: [...runtimeCostEvent.missingRates],
    })),
    entitlements: state.entitlements.map((entitlement) => ({ ...entitlement })),
    invoices: state.invoices.map((invoice) => ({ ...invoice })),
    payg: {
      packAmountMinor: null,
      paidCreditMinor: 0,
      consumedCreditMinor: 0,
      balanceMinor: 0,
      reservedCreditMinor: 0,
      remainingCreditMinor: 0,
      sessionDebits: [],
    },
    updatedAt: state.updatedAt,
  };
}

function createDefaultBudgetPolicy(
  plan: BillingPlanResponse | null,
  updatedAt = new Date().toISOString(),
): BillingBudgetPolicyResponse {
  return {
    monthlyBudgetUsd: plan?.budgetLimitUsd ?? 0,
    callMinuteLimit: plan?.includedMinutes ?? 0,
    premiumRuntimeMinuteLimit: 0,
    overBudgetBehavior: "block",
    warningThresholdPercent: 80,
    updatedBy: "system",
    updatedAt,
  };
}

function resolveBudgetPolicy(state: PersistedBillingStateRecord): BillingBudgetPolicyResponse {
  return state.budgetPolicy ?? createDefaultBudgetPolicy(state.plan);
}

function getCurrentBudgetUsage(state: PersistedBillingStateRecord) {
  return {
    budgetUsedUsd: state.plan?.budgetUsedUsd ?? 0,
    callMinutes: readUsageMetric(state, "usage-telephony-minutes"),
    premiumRuntimeMinutes: readUsageMetric(state, "usage-premium-realtime-minutes"),
  };
}

function readUsageMetric(state: PersistedBillingStateRecord, usageId: string) {
  if (usageId === "usage-telephony-minutes" && state.telephonyMinuteEvents.length > 0) {
    return state.telephonyMinuteEvents.reduce((total, event) => total + event.billableMinutes, 0);
  }

  if (usageId === "usage-premium-realtime-minutes") {
    const premiumEvents = state.usageEvents.filter((event) => event.feature === "premium_runtime_minutes");
    if (premiumEvents.length > 0) {
      return premiumEvents.reduce((total, event) => total + event.units, 0);
    }
  }

  return state.usage.find((usage) => usage.id === usageId)?.used ?? 0;
}

function createBudgetWarnings(
  state: PersistedBillingStateRecord,
  policy: BillingBudgetPolicyResponse,
): BillingBudgetWarningResponse[] {
  const current = getCurrentBudgetUsage(state);
  const threshold = policy.warningThresholdPercent / 100;

  return [
    createBudgetWarning("monthly_budget_near_limit", current.budgetUsedUsd, policy.monthlyBudgetUsd, threshold),
    createBudgetWarning("call_minutes_near_limit", current.callMinutes, policy.callMinuteLimit, threshold),
    createBudgetWarning(
      "premium_runtime_near_limit",
      current.premiumRuntimeMinutes,
      policy.premiumRuntimeMinuteLimit,
      threshold,
    ),
  ].filter((warning): warning is BillingBudgetWarningResponse => warning !== null);
}

function createBudgetWarning(
  code: BillingBudgetWarningResponse["code"],
  used: number,
  limit: number,
  threshold: number,
) {
  if (limit <= 0) {
    return null;
  }
  const percentUsed = Math.round((used / limit) * 10_000) / 100;
  if (used / limit < threshold) {
    return null;
  }

  return {
    code,
    severity: used >= limit ? "critical" : "warning",
    used,
    limit,
    percentUsed,
  } satisfies BillingBudgetWarningResponse;
}

function buildRuntimeCostComponents(
  input: CreateRuntimeCostEventRequest,
  modelTier: string,
  rateVersion: string,
): RuntimeCostComponentResponse[] {
  const rates = runtimeRateCatalogs[rateVersion];
  const components: Array<Omit<RuntimeCostComponentResponse, "totalUsd" | "missingRate">> = [
    {
      kind: "stt",
      feature: "stt_minutes",
      units: input.usage.sttMinutes ?? 0,
      billingUnits: input.usage.sttMinutes ?? 0,
      unitRateUsd: rates?.sttPerMinuteUsd[input.providers?.stt ?? ""],
    },
    {
      kind: "model_input",
      feature: "model_input_tokens",
      units: input.usage.modelInputTokens ?? 0,
      billingUnits: (input.usage.modelInputTokens ?? 0) / 1000,
      unitRateUsd: rates?.modelInputPer1kTokensUsd[modelTier],
    },
    {
      kind: "model_output",
      feature: "model_output_tokens",
      units: input.usage.modelOutputTokens ?? 0,
      billingUnits: (input.usage.modelOutputTokens ?? 0) / 1000,
      unitRateUsd: rates?.modelOutputPer1kTokensUsd[modelTier],
    },
    {
      kind: "tts",
      feature: "tts_characters",
      units: input.usage.ttsCharacters ?? 0,
      billingUnits: (input.usage.ttsCharacters ?? 0) / 1000,
      unitRateUsd: rates?.ttsPer1kCharactersUsd[input.providers?.tts ?? ""],
    },
  ];

  return components.map((component) => {
    const missingRate = component.units > 0 && component.unitRateUsd === undefined;

    return {
      ...component,
      totalUsd: missingRate ? 0 : roundMoney(component.billingUnits * (component.unitRateUsd ?? 0)),
      missingRate,
    };
  });
}

function roundMoney(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundUsage(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function resolveUsageFeature(input: CreateUsageBillingEventRequest | UsageBillingEventResponse) {
  const explicitFeature = "feature" in input ? input.feature?.trim() : undefined;
  if (explicitFeature !== undefined && explicitFeature.length > 0) {
    return explicitFeature;
  }

  const metadataFeature =
    "metadata" in input && typeof input.metadata?.feature === "string" ? input.metadata.feature.trim() : "";
  if (metadataFeature.length > 0) {
    return metadataFeature;
  }

  return input.name;
}

function createUsageAggregates(state: PersistedBillingStateRecord): BillingUsageAggregateResponse[] {
  const aggregates = new Map<string, BillingUsageAggregateResponse>();

  for (const event of state.usageEvents) {
    const feature = resolveUsageFeature(event);
    const current = aggregates.get(feature);
    if (current === undefined) {
      aggregates.set(feature, {
        organizationId: state.organizationId,
        feature,
        units: event.units,
        eventCount: 1,
        firstOccurredAt: event.occurredAt,
        lastOccurredAt: event.occurredAt,
      });
      continue;
    }

    current.units += event.units;
    current.eventCount += 1;
    if (Date.parse(event.occurredAt) < Date.parse(current.firstOccurredAt)) {
      current.firstOccurredAt = event.occurredAt;
    }
    if (Date.parse(event.occurredAt) > Date.parse(current.lastOccurredAt)) {
      current.lastOccurredAt = event.occurredAt;
    }
  }

  return [...aggregates.values()].sort((left, right) => left.feature.localeCompare(right.feature));
}

function createTelephonyMinuteAggregates(
  state: PersistedBillingStateRecord,
): BillingTelephonyMinuteAggregateResponse[] {
  const aggregates = new Map<string, BillingTelephonyMinuteAggregateResponse>();

  for (const event of state.telephonyMinuteEvents ?? []) {
    const key = `${event.provider}:${event.providerConnectionId}`;
    const current = aggregates.get(key);
    if (current === undefined) {
      aggregates.set(key, {
        organizationId: state.organizationId,
        provider: event.provider,
        providerConnectionId: event.providerConnectionId,
        billableMinutes: event.billableMinutes,
        completedCalls: event.classification === "completed" ? 1 : 0,
        failedCalls: event.classification === "failed" ? 1 : 0,
        transferredCalls: event.classification === "transferred" ? 1 : 0,
        lastOccurredAt: event.occurredAt,
      });
      continue;
    }

    current.billableMinutes += event.billableMinutes;
    current.completedCalls += event.classification === "completed" ? 1 : 0;
    current.failedCalls += event.classification === "failed" ? 1 : 0;
    current.transferredCalls += event.classification === "transferred" ? 1 : 0;
    if (Date.parse(event.occurredAt) > Date.parse(current.lastOccurredAt)) {
      current.lastOccurredAt = event.occurredAt;
    }
  }

  return [...aggregates.values()].sort((left, right) =>
    `${left.provider}:${left.providerConnectionId}`.localeCompare(`${right.provider}:${right.providerConnectionId}`),
  );
}

function resolveOrganizationId(payload: PolarWebhookPayload) {
  if (isCustomerStateWebhook(payload)) {
    const customer = resolvePolarStateCustomer(payload);
    return customer?.externalId ?? customer?.external_id ?? undefined;
  }

  if (isOrderPaidWebhook(payload)) {
    return payload.data.customer?.externalId ?? payload.data.customer?.external_id;
  }

  if (isOrderRefundedWebhook(payload)) {
    return payload.data.customer?.externalId ?? payload.data.customer?.external_id;
  }

  if (isSubscriptionPastDueWebhook(payload)) {
    return payload.data.customer?.externalId ?? payload.data.customer?.external_id;
  }

  return undefined;
}

function isCustomerStateWebhook(payload: PolarWebhookPayload): payload is PolarCustomerStateWebhookPayload {
  return payload.type === "customer.state_changed" && isRecord(payload.data);
}

function isOrderPaidWebhook(payload: PolarWebhookPayload): payload is PolarOrderPaidWebhookPayload {
  return payload.type === "order.paid" && isRecord(payload.data);
}

function isOrderRefundedWebhook(payload: PolarWebhookPayload): payload is PolarOrderRefundedWebhookPayload {
  return payload.type === "order.refunded" && isRecord(payload.data);
}

function isSubscriptionPastDueWebhook(payload: PolarWebhookPayload): payload is PolarSubscriptionPastDueWebhookPayload {
  return payload.type === "subscription.past_due" && isRecord(payload.data);
}

function resolvePolarStateCustomer(
  payload: PolarCustomerStateWebhookPayload,
): PolarCustomerStateWebhookPayload["data"]["customer"] {
  return payload.data.id === undefined
    ? payload.data.customer
    : {
        id: payload.data.id,
        external_id: payload.data.external_id ?? undefined,
      };
}

function applyCustomerStateWebhook(
  state: PersistedBillingStateRecord,
  payload: PolarCustomerStateWebhookPayload,
  subscriptionPlanSlugs: ReadonlyMap<string, BillingPlanSlug>,
) {
  const customer = resolvePolarStateCustomer(payload);
  const subscriptions = payload.data.activeSubscriptions ?? payload.data.active_subscriptions ?? [];
  const selectedProjection = selectActiveSubscription(
    subscriptions
      .filter((subscription) => subscription.id !== undefined)
      .map((subscription) =>
        projectPolarSubscription({
          providerSubscriptionId: subscription.id as string,
          providerStatus: subscription.status ?? "unknown",
          updatedAt:
            subscription.modifiedAt ??
            subscription.modified_at ??
            subscription.createdAt ??
            subscription.created_at ??
            "1970-01-01T00:00:00.000Z",
          now: new Date().toISOString(),
        }),
      ),
  );
  const subscription =
    selectedProjection === undefined
      ? undefined
      : subscriptions.find((candidate) => candidate.id === selectedProjection.providerSubscriptionId);

  if (customer?.id !== undefined) {
    state.providerCustomerId = customer.id;
  }

  if (subscription !== undefined) {
    const productId = subscription.productId ?? subscription.product_id;
    const planSlug = productId === undefined ? undefined : subscriptionPlanSlugs.get(productId);
    if (productId === undefined || planSlug === undefined) {
      throw new BadRequestException("Polar subscription has no billing catalog mapping.");
    }
    const subscriptionStatus = normalizeSubscriptionStatus(subscription.status);
    state.plan = createPlan(planSlug, subscriptionStatus, state.plan?.budgetUsedUsd ?? 0);
    state.subscription = {
      provider: "polar",
      ...(customer?.id !== undefined ? { providerCustomerId: customer.id } : {}),
      ...(subscription.id !== undefined ? { providerSubscriptionId: subscription.id } : {}),
      productId,
      status: subscriptionStatus,
      currentPeriodEnd: subscription.currentPeriodEnd ?? subscription.current_period_end,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd ?? subscription.cancel_at_period_end ?? false,
    };
  } else {
    if (state.plan !== null) state.plan = { ...state.plan, status: "none" };
    state.subscription = {
      provider: "polar",
      ...(customer?.id !== undefined ? { providerCustomerId: customer.id } : {}),
      status: "none",
      cancelAtPeriodEnd: false,
    };
  }

  state.entitlements = (payload.data.grantedBenefits ?? payload.data.granted_benefits ?? [])
    .map(toEntitlement)
    .filter((entitlement): entitlement is BillingEntitlementResponse => entitlement !== null);
}

function applyOrderPaidWebhook(
  state: PersistedBillingStateRecord,
  payload: PolarOrderPaidWebhookPayload,
  subscriptionPlanSlug: BillingPlanSlug | undefined,
) {
  const orderId = payload.data.id;
  if (orderId === undefined || state.invoices.some((invoice) => invoice.providerOrderId === orderId)) {
    return;
  }

  const invoice: BillingInvoiceResponse = {
    id: `polar-invoice:${orderId}`,
    provider: "polar",
    providerOrderId: orderId,
    invoiceNumber: payload.data.invoiceNumber ?? payload.data.invoice_number ?? orderId,
    amountUsd: (payload.data.totalAmount ?? payload.data.total_amount ?? 0) / 100,
    currency: "usd",
    status: "paid",
    createdAt: payload.data.createdAt ?? payload.data.created_at ?? new Date().toISOString(),
  };

  state.invoices = [invoice, ...state.invoices];
  if (subscriptionPlanSlug !== undefined) {
    state.plan = createPlan(subscriptionPlanSlug, "active", state.plan?.budgetUsedUsd ?? 0);
  }
}

function normalizeSubscriptionStatus(status: string | undefined): BillingSubscriptionStatus {
  switch (status) {
    case "trialing":
    case "active":
    case "past_due":
    case "canceled":
      return status;
    default:
      return "none";
  }
}

function applySubscriptionPastDueWebhook(
  state: PersistedBillingStateRecord,
  payload: PolarSubscriptionPastDueWebhookPayload,
  planSlug: BillingPlanSlug,
) {
  const subscription = payload.data;
  const productId = subscription.productId ?? subscription.product_id;
  state.providerCustomerId = subscription.customer?.id;
  state.plan = createPlan(planSlug, "past_due", state.plan?.budgetUsedUsd ?? 0);
  state.subscription = {
    provider: "polar",
    ...(subscription.customer?.id === undefined ? {} : { providerCustomerId: subscription.customer.id }),
    providerSubscriptionId: subscription.id,
    productId,
    status: "past_due",
    currentPeriodEnd: subscription.currentPeriodEnd ?? subscription.current_period_end,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd ?? subscription.cancel_at_period_end ?? false,
  };
}

function parseBillingPlanSlug(value: string): BillingPlanSlug {
  if (value !== "starter" && value !== "growth" && value !== "scale") {
    throw new BadRequestException(`Billing catalog plan ${value} is not supported.`);
  }

  return value;
}

function toEntitlement(benefit: PolarBenefitPayload): BillingEntitlementResponse | null {
  if (benefit.id === undefined) {
    return null;
  }

  return {
    id: benefit.id,
    label: benefit.description ?? benefit.type ?? benefit.id,
    status: "granted",
    source: "polar",
  };
}

function verifyPolarWebhookSignature(input: {
  rawBody: Buffer | undefined;
  headers: Record<string, string | undefined>;
}) {
  const webhookSecret = process.env.POLAR_WEBHOOK_SECRET?.trim();
  if (webhookSecret === undefined || webhookSecret.length === 0) {
    if (process.env.NODE_ENV === "test" || process.env.ZARA_ENV === "local") {
      return;
    }

    throw new ForbiddenException("POLAR_WEBHOOK_SECRET is required for Polar webhook verification.");
  }

  const headers = Object.fromEntries(
    Object.entries(input.headers).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

  try {
    if (input.rawBody === undefined) {
      throw new ForbiddenException("Polar webhook raw body is required.");
    }
    validateEvent(input.rawBody, headers, webhookSecret);
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      throw new ForbiddenException("Polar webhook signature verification failed.");
    }
    if (error instanceof SDKValidationError) {
      throw new BadRequestException("Polar webhook payload is invalid.");
    }

    throw error;
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
