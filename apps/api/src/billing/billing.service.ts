import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { validateEvent, WebhookVerificationError } from "@polar-sh/sdk/webhooks";

import {
  BILLING_STATE_REPOSITORY,
  type BillingStateRepository,
  type PersistedBillingStateRecord,
} from "./billing-state.repository";
import {
  BILLING_POLAR_CLIENT,
  type BillingPolarClient,
} from "./polar-billing.client";
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
  CreateRuntimeCostEventRequest,
  CreateTelephonyMinuteEventRequest,
  CreateUsageBillingEventRequest,
  CustomerPortalResponse,
  PolarBenefitPayload,
  PolarCustomerStateWebhookPayload,
  PolarOrderPaidWebhookPayload,
  PolarSubscriptionPayload,
  PolarWebhookPayload,
  PolarWebhookResponse,
  RuntimeCostComponentResponse,
  RuntimeCostEventResponse,
  TenantBillingStateResponse,
  TelephonyMinuteEventResponse,
  UpdateBudgetPolicyRequest,
  UsageBillingEventResponse,
  BillingUsageAggregateResponse,
} from "./billing.models";

const productIdsByPlanSlug: Record<BillingPlanSlug, string> = {
  starter: "polar_product_starter",
  growth: "polar_product_growth",
  scale: "polar_product_scale",
};

const planNamesBySlug: Record<BillingPlanSlug, string> = {
  starter: "Starter",
  growth: "Growth",
  scale: "Scale",
};

const defaultUsage = [
  {
    id: "usage-runtime-minutes",
    label: "Runtime minutes",
    used: 4820,
    limit: 8000,
    unit: "min",
    costUsd: 318.44,
  },
  {
    id: "usage-premium-realtime-minutes",
    label: "Premium realtime minutes",
    used: 186,
    limit: 300,
    unit: "min",
    costUsd: 214.5,
  },
  {
    id: "usage-telephony-minutes",
    label: "Telephony minutes",
    used: 6230,
    limit: 10000,
    unit: "min",
    costUsd: 209.24,
  },
];

const runtimeRateCatalogs: Record<string, {
  sttPerMinuteUsd: Record<string, number>;
  modelInputPer1kTokensUsd: Record<string, number>;
  modelOutputPer1kTokensUsd: Record<string, number>;
  ttsPer1kCharactersUsd: Record<string, number>;
}> = {
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
  ) {}

  async getBillingState(organizationId: string): Promise<TenantBillingStateResponse> {
    const state = await this.getOrCreateState(organizationId);
    return toBillingStateResponse(state);
  }

  async createCheckout(organizationId: string, input: CreateBillingCheckoutRequest): Promise<BillingCheckoutResponse> {
    assertBillingAdmin(input.actorRole);
    const state = await this.getOrCreateState(organizationId);
    const productId = productIdsByPlanSlug[input.planSlug];
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

    state.checkouts = [checkout, ...state.checkouts];
    state.plan = createPlan(input.planSlug, state.plan.status, state.plan.budgetUsedUsd);
    state.updatedAt = now;
    await this.stateRepository.save(state);

    return checkout;
  }

  async createCustomerPortal(organizationId: string, input: CreateCustomerPortalRequest): Promise<CustomerPortalResponse> {
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
    state.plan = createPlan(state.plan.slug, state.plan.status, state.plan.budgetUsedUsd, policy.monthlyBudgetUsd);
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
      premiumRuntimeMinutes: roundUsage(
        current.premiumRuntimeMinutes + Math.max(0, input.premiumRuntimeMinutes ?? 0),
      ),
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
    const providerConnectionId = assertNonEmpty(input.providerConnectionId, "Telephony provider connection is required.");
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
    state.plan = createPlan(state.plan.slug, state.plan.status, roundMoney(state.plan.budgetUsedUsd + event.totalUsd));
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
  }): Promise<PolarWebhookResponse> {
    if (input.eventId === undefined || input.eventId.trim().length === 0) {
      throw new BadRequestException("Polar webhook id is required.");
    }

    if (input.signature === undefined || input.signature.trim().length === 0) {
      throw new BadRequestException("Polar webhook signature is required.");
    }

    verifyPolarWebhookSignature({
      payload: input.payload,
      headers: {
        "polar-webhook-id": input.eventId,
        "polar-webhook-signature": input.signature,
        ...(input.headers ?? {}),
      },
    });

    const organizationId = resolveOrganizationId(input.payload);
    if (organizationId === undefined) {
      throw new BadRequestException("Polar webhook is missing the customer external organization id.");
    }

    const state = await this.getOrCreateState(organizationId);
    const handledAt = new Date().toISOString();
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

    if (isCustomerStateWebhook(input.payload)) {
      applyCustomerStateWebhook(state, input.payload);
    } else if (isOrderPaidWebhook(input.payload)) {
      applyOrderPaidWebhook(state, input.payload);
    }

    state.processedWebhookIds = [input.eventId, ...state.processedWebhookIds];
    state.updatedAt = handledAt;
    await this.stateRepository.save(state);

    return {
      eventId: input.eventId,
      provider: "polar",
      organizationId,
      processed: true,
      handledAt,
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
  const now = "2026-05-22T00:00:00.000Z";
  const plan = createPlan("growth", "active", 742.18);

  return {
    schemaVersion: 1,
    organizationId,
    customerExternalId: organizationId,
    providerCustomerId: "polar_customer_pending",
    plan,
    subscription: {
      provider: "polar",
      providerCustomerId: "polar_customer_pending",
      providerSubscriptionId: "polar_subscription_pending",
      productId: productIdsByPlanSlug.growth,
      status: "active",
      currentPeriodEnd: "2026-06-22T00:00:00.000Z",
      cancelAtPeriodEnd: false,
    },
    usage: defaultUsage.map((usage) => ({ ...usage })),
    budgetPolicy: createDefaultBudgetPolicy(plan),
    budgetDecisions: [],
    entitlements: [
      {
        id: "benefit-premium-runtime",
        label: "Premium realtime minutes",
        status: "granted",
        source: "polar",
      },
    ],
    invoices: [
      {
        id: "billing_invoice_seed",
        provider: "polar",
        providerOrderId: "polar_order_seed",
        invoiceNumber: "INV-2026-051",
        amountUsd: 129,
        currency: "usd",
        status: "paid",
        createdAt: "2026-05-01T12:00:00.000Z",
      },
    ],
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
  const planDetails: Record<BillingPlanSlug, Pick<BillingPlanResponse, "monthlyBaseUsd" | "includedMinutes" | "budgetLimitUsd">> = {
    starter: {
      monthlyBaseUsd: 49,
      includedMinutes: 1500,
      budgetLimitUsd: 300,
    },
    growth: {
      monthlyBaseUsd: 129,
      includedMinutes: 8000,
      budgetLimitUsd: 900,
    },
    scale: {
      monthlyBaseUsd: 399,
      includedMinutes: 25000,
      budgetLimitUsd: 2400,
    },
  };

  const details = planDetails[slug];

  return {
    slug,
    name: planNamesBySlug[slug],
    status,
    monthlyBaseUsd: details.monthlyBaseUsd,
    includedMinutes: details.includedMinutes,
    budgetLimitUsd: overrideBudgetLimitUsd ?? details.budgetLimitUsd,
    budgetUsedUsd,
    budgetWarning: budgetUsedUsd / (overrideBudgetLimitUsd ?? details.budgetLimitUsd) >= 0.8,
  };
}

function toBillingStateResponse(state: PersistedBillingStateRecord): TenantBillingStateResponse {
  const budgetPolicy = resolveBudgetPolicy(state);

  return {
    organizationId: state.organizationId,
    provider: "polar",
    customerExternalId: state.customerExternalId,
    plan: { ...state.plan },
    subscription: { ...state.subscription },
    usage: state.usage.map((usage) => ({ ...usage })),
    budgetPolicy: { ...budgetPolicy },
    budgetWarnings: createBudgetWarnings(state, budgetPolicy),
    usageAggregates: createUsageAggregates(state),
    telephonyMinuteAggregates: createTelephonyMinuteAggregates(state),
    runtimeCostEvents: (state.runtimeCostEvents ?? []).map((runtimeCostEvent) => ({
      ...runtimeCostEvent,
      components: runtimeCostEvent.components.map((component) => ({ ...component })),
      missingRates: [...runtimeCostEvent.missingRates],
    })),
    entitlements: state.entitlements.map((entitlement) => ({ ...entitlement })),
    invoices: state.invoices.map((invoice) => ({ ...invoice })),
    updatedAt: state.updatedAt,
  };
}

function createDefaultBudgetPolicy(plan: BillingPlanResponse): BillingBudgetPolicyResponse {
  return {
    monthlyBudgetUsd: plan.budgetLimitUsd,
    callMinuteLimit: defaultUsage.find((usage) => usage.id === "usage-telephony-minutes")?.limit ?? plan.includedMinutes,
    premiumRuntimeMinuteLimit:
      defaultUsage.find((usage) => usage.id === "usage-premium-realtime-minutes")?.limit ?? 300,
    overBudgetBehavior: "warn",
    warningThresholdPercent: 80,
    updatedBy: "system",
    updatedAt: "2026-05-22T00:00:00.000Z",
  };
}

function resolveBudgetPolicy(state: PersistedBillingStateRecord): BillingBudgetPolicyResponse {
  return state.budgetPolicy ?? createDefaultBudgetPolicy(state.plan);
}

function getCurrentBudgetUsage(state: PersistedBillingStateRecord) {
  return {
    budgetUsedUsd: state.plan.budgetUsedUsd,
    callMinutes: readUsageMetric(state, "usage-telephony-minutes"),
    premiumRuntimeMinutes: readUsageMetric(state, "usage-premium-realtime-minutes"),
  };
}

function readUsageMetric(state: PersistedBillingStateRecord, usageId: string) {
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
  const percentUsed = limit <= 0 ? 100 : Math.round((used / limit) * 10_000) / 100;
  if (limit > 0 && used / limit < threshold) {
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

  const metadataFeature = "metadata" in input && typeof input.metadata?.feature === "string"
    ? input.metadata.feature.trim()
    : "";
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

  return [...aggregates.values()].sort((left, right) => (
    `${left.provider}:${left.providerConnectionId}`.localeCompare(`${right.provider}:${right.providerConnectionId}`)
  ));
}

function resolveOrganizationId(payload: PolarWebhookPayload) {
  if (isCustomerStateWebhook(payload)) {
    return payload.data.customer?.externalId ?? payload.data.customer?.external_id;
  }

  if (isOrderPaidWebhook(payload)) {
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

function applyCustomerStateWebhook(
  state: PersistedBillingStateRecord,
  payload: PolarCustomerStateWebhookPayload,
) {
  const customer = payload.data.customer;
  const subscriptions = payload.data.activeSubscriptions ?? payload.data.active_subscriptions ?? [];
  const subscription = subscriptions.at(0);

  if (customer?.id !== undefined) {
    state.providerCustomerId = customer.id;
  }

  if (subscription !== undefined) {
    const planSlug = resolvePlanSlug(subscription);
    const subscriptionStatus = normalizeSubscriptionStatus(subscription.status);
    state.plan = createPlan(planSlug, subscriptionStatus, state.plan.budgetUsedUsd);
    state.subscription = {
      provider: "polar",
      ...(customer?.id !== undefined ? { providerCustomerId: customer.id } : {}),
      ...(subscription.id !== undefined ? { providerSubscriptionId: subscription.id } : {}),
      productId: subscription.productId ?? subscription.product_id ?? productIdsByPlanSlug[planSlug],
      status: subscriptionStatus,
      currentPeriodEnd: subscription.currentPeriodEnd ?? subscription.current_period_end,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd ?? subscription.cancel_at_period_end ?? false,
    };
  }

  state.entitlements = (payload.data.grantedBenefits ?? payload.data.granted_benefits ?? [])
    .map(toEntitlement)
    .filter((entitlement): entitlement is BillingEntitlementResponse => entitlement !== null);
}

function applyOrderPaidWebhook(
  state: PersistedBillingStateRecord,
  payload: PolarOrderPaidWebhookPayload,
) {
  const orderId = payload.data.id;
  if (orderId === undefined || state.invoices.some((invoice) => invoice.providerOrderId === orderId)) {
    return;
  }

  const invoice: BillingInvoiceResponse = {
    id: `billing_invoice_${randomUUID()}`,
    provider: "polar",
    providerOrderId: orderId,
    invoiceNumber: payload.data.invoiceNumber ?? payload.data.invoice_number ?? orderId,
    amountUsd: (payload.data.amount ?? 0) / 100,
    currency: "usd",
    status: "paid",
    createdAt: payload.data.createdAt ?? payload.data.created_at ?? new Date().toISOString(),
  };

  state.invoices = [invoice, ...state.invoices];
  const productId = payload.data.productId ?? payload.data.product_id;
  if (productId !== undefined) {
    state.plan = createPlan(resolvePlanSlug({ productId }), "active", state.plan.budgetUsedUsd);
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
      return "active";
  }
}

function resolvePlanSlug(subscription: PolarSubscriptionPayload): BillingPlanSlug {
  const productId = subscription.productId ?? subscription.product_id;
  const match = Object.entries(productIdsByPlanSlug).find(([, candidateProductId]) => candidateProductId === productId);

  if (match === undefined) {
    throw new NotFoundException("Polar product is not mapped to a Zara billing plan.");
  }

  return match[0] as BillingPlanSlug;
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
  payload: PolarWebhookPayload;
  headers: Record<string, string | undefined>;
}) {
  const webhookSecret = process.env.POLAR_WEBHOOK_SECRET?.trim();
  if (webhookSecret === undefined || webhookSecret.length === 0) {
    return;
  }

  const headers = Object.fromEntries(
    Object.entries(input.headers).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

  try {
    validateEvent(JSON.stringify(input.payload), headers, webhookSecret);
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      throw new ForbiddenException("Polar webhook signature verification failed.");
    }

    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
