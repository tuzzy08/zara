export type BillingActorRole = "owner" | "admin" | "builder" | "operator" | "viewer";
export type BillingPlanSlug = "starter" | "growth" | "scale";
export type BillingSubscriptionStatus = "none" | "trialing" | "active" | "past_due" | "canceled";
export type BudgetOverageBehavior = "block" | "warn";

export interface BillingPlanResponse {
  slug: BillingPlanSlug;
  name: string;
  status: BillingSubscriptionStatus;
  monthlyBaseUsd: number;
  includedMinutes: number;
  budgetLimitUsd: number;
  budgetUsedUsd: number;
  budgetWarning: boolean;
  currency?: "usd" | undefined;
  monthlyBaseMinor?: number | null | undefined;
  includedStandardRuntimeSeconds?: number | null | undefined;
  includedPremiumRuntimeSeconds?: number | null | undefined;
}

export interface BillingUsageMetricResponse {
  id: string;
  label: string;
  used: number;
  limit?: number | undefined;
  unit: string;
  costUsd: number | null;
  costMinor?: number | null | undefined;
  disposition?: "posted" | "shadow_estimate" | "incomplete" | "non_billable" | "blocked" | undefined;
}

export interface BillingBudgetPolicyResponse {
  monthlyBudgetUsd: number;
  callMinuteLimit: number;
  premiumRuntimeMinuteLimit: number;
  overBudgetBehavior: BudgetOverageBehavior;
  warningThresholdPercent: number;
  updatedBy: string;
  updatedAt: string;
  currency?: "usd" | undefined;
  monthlyBudgetMinor?: number | undefined;
}

export interface BillingBudgetWarningResponse {
  code: "monthly_budget_near_limit" | "call_minutes_near_limit" | "premium_runtime_near_limit";
  severity: "warning" | "critical";
  used: number;
  limit: number;
  percentUsed: number;
}

export interface BillingBudgetDecisionResponse {
  id: string;
  organizationId: string;
  allowed: boolean;
  action: "allow" | "warn" | "block";
  overBudgetBehavior: BudgetOverageBehavior;
  reasons: Array<
    "monthly_budget_exceeded" | "call_minute_limit_exceeded" | "premium_runtime_limit_exceeded"
  >;
  projected: {
    budgetUsedUsd: number;
    callMinutes: number;
    premiumRuntimeMinutes: number;
  };
  checkedAt: string;
}

export interface BillingUsageAggregateResponse {
  organizationId: string;
  feature: string;
  units: number;
  eventCount: number;
  firstOccurredAt: string;
  lastOccurredAt: string;
}

export type TelephonyMinuteClassification = "completed" | "failed" | "transferred";

export interface BillingTelephonyMinuteAggregateResponse {
  organizationId: string;
  provider: string;
  providerConnectionId: string;
  billableMinutes: number;
  completedCalls: number;
  failedCalls: number;
  transferredCalls: number;
  lastOccurredAt: string;
}

export type RuntimeCostComponentKind = "stt" | "model_input" | "model_output" | "tts";

export interface RuntimeCostComponentResponse {
  kind: RuntimeCostComponentKind;
  feature: string;
  units: number;
  billingUnits: number;
  unitRateUsd?: number | undefined;
  totalUsd: number;
  missingRate: boolean;
}

export interface RuntimeCostEventResponse {
  id: string;
  organizationId: string;
  sourceRuntimeEventId: string;
  sessionId: string;
  workspaceId?: string | undefined;
  modelTier: string;
  rateVersion: string;
  totalUsd: number;
  complete: boolean;
  missingRates: string[];
  components: RuntimeCostComponentResponse[];
  occurredAt: string;
  duplicate?: boolean | undefined;
}

export interface BillingInvoiceResponse {
  id: string;
  provider: "polar";
  providerOrderId: string;
  invoiceNumber: string;
  amountUsd: number;
  currency: "usd";
  status: "paid" | "open" | "void" | "refunded" | "unknown";
  createdAt: string;
  amountMinor?: number | undefined;
}

export interface BillingPaygSessionDebitResponse {
  id: string;
  sessionId: string;
  amountMinor: number;
  createdAt: string;
}

export interface BillingPaygBalanceResponse {
  packAmountMinor: number | null;
  paidCreditMinor: number;
  consumedCreditMinor: number;
  balanceMinor: number;
  reservedCreditMinor: number;
  remainingCreditMinor: number;
  sessionDebits: BillingPaygSessionDebitResponse[];
}

export interface BillingEntitlementResponse {
  id: string;
  label: string;
  status: "granted" | "revoked";
  source: "polar";
}

export interface BillingSubscriptionResponse {
  provider: "polar";
  providerCustomerId?: string | undefined;
  providerSubscriptionId?: string | undefined;
  productId?: string | undefined;
  status: BillingSubscriptionStatus;
  currentPeriodEnd?: string | undefined;
  cancelAtPeriodEnd: boolean;
}

export interface TenantBillingStateResponse {
  organizationId: string;
  provider: "polar";
  currency?: "usd" | undefined;
  customerExternalId: string;
  plan: BillingPlanResponse | null;
  subscription: BillingSubscriptionResponse;
  usage: BillingUsageMetricResponse[];
  budgetPolicy: BillingBudgetPolicyResponse | null;
  budgetWarnings: BillingBudgetWarningResponse[];
  usageAggregates: BillingUsageAggregateResponse[];
  telephonyMinuteAggregates: BillingTelephonyMinuteAggregateResponse[];
  runtimeCostEvents: RuntimeCostEventResponse[];
  entitlements: BillingEntitlementResponse[];
  invoices: BillingInvoiceResponse[];
  payg?: BillingPaygBalanceResponse | undefined;
  updatedAt: string;
}

export interface CreateBillingCheckoutRequest {
  actorUserId: string;
  actorRole?: BillingActorRole | undefined;
  planSlug: BillingPlanSlug;
  successUrl: string;
  returnUrl?: string | undefined;
}

export interface BillingCheckoutResponse {
  id: string;
  organizationId: string;
  provider: "polar";
  planSlug: BillingPlanSlug;
  providerCheckoutId: string;
  checkoutUrl: string;
  status: "open";
  createdBy: string;
  createdAt: string;
}

export interface CreateCustomerPortalRequest {
  actorUserId: string;
  actorRole?: BillingActorRole | undefined;
  returnUrl?: string | undefined;
}

export interface UpdateBudgetPolicyRequest {
  actorUserId: string;
  actorRole?: BillingActorRole | undefined;
  monthlyBudgetUsd: number;
  callMinuteLimit: number;
  premiumRuntimeMinuteLimit: number;
  overBudgetBehavior: BudgetOverageBehavior;
  warningThresholdPercent?: number | undefined;
  now?: string | undefined;
}

export interface CreateBudgetCheckRequest {
  actorUserId: string;
  actorRole?: BillingActorRole | undefined;
  requestKind: "call" | "premium_runtime";
  estimatedCostUsd: number;
  callMinutes?: number | undefined;
  premiumRuntimeMinutes?: number | undefined;
  now?: string | undefined;
}

export interface CustomerPortalResponse {
  organizationId: string;
  provider: "polar";
  customerPortalUrl: string;
  createdBy: string;
  createdAt: string;
}

export interface CreateUsageBillingEventRequest {
  actorUserId: string;
  actorRole?: BillingActorRole | undefined;
  idempotencyKey: string;
  name: string;
  feature?: string | undefined;
  units: number;
  occurredAt: string;
  metadata?: Record<string, string | number | boolean> | undefined;
}

export interface UsageBillingEventResponse {
  id: string;
  organizationId: string;
  provider: "polar";
  idempotencyKey: string;
  name: string;
  feature: string;
  units: number;
  occurredAt: string;
  status: "sent";
  providerEventId: string;
  sentAt: string;
  duplicate?: boolean | undefined;
}

export interface CreateTelephonyMinuteEventRequest {
  actorUserId: string;
  actorRole?: BillingActorRole | undefined;
  callSessionId: string;
  provider: string;
  providerConnectionId: string;
  startedAt: string;
  endedAt: string;
  outcome: TelephonyMinuteClassification;
  failureReason?: string | undefined;
}

export interface TelephonyMinuteEventResponse {
  id: string;
  organizationId: string;
  provider: string;
  providerConnectionId: string;
  callSessionId: string;
  classification: TelephonyMinuteClassification;
  durationSeconds: number;
  billableMinutes: number;
  roundingPolicy: "round_up_to_next_full_minute";
  failureReason?: string | undefined;
  occurredAt: string;
  duplicate?: boolean | undefined;
}

export interface CreateRuntimeCostEventRequest {
  actorUserId: string;
  actorRole?: BillingActorRole | undefined;
  runtimeEventId: string;
  sessionId: string;
  workspaceId?: string | undefined;
  occurredAt: string;
  modelTier: string;
  rateVersion: string;
  providers?: {
    stt?: string | undefined;
    model?: string | undefined;
    tts?: string | undefined;
  } | undefined;
  usage: {
    sttMinutes?: number | undefined;
    modelInputTokens?: number | undefined;
    modelOutputTokens?: number | undefined;
    ttsCharacters?: number | undefined;
  };
}

export interface PolarWebhookResponse {
  eventId: string;
  provider: "polar";
  organizationId?: string | undefined;
  processed: boolean;
  replay?: boolean | undefined;
  handledAt: string;
}

export interface PolarCustomerStateWebhookPayload {
  type: "customer.state_changed";
  data: {
    customer?: {
      id?: string | undefined;
      externalId?: string | undefined;
      external_id?: string | undefined;
    } | undefined;
    activeSubscriptions?: PolarSubscriptionPayload[] | undefined;
    active_subscriptions?: PolarSubscriptionPayload[] | undefined;
    grantedBenefits?: PolarBenefitPayload[] | undefined;
    granted_benefits?: PolarBenefitPayload[] | undefined;
  };
}

export interface PolarOrderPaidWebhookPayload {
  type: "order.paid";
  data: {
    id?: string | undefined;
    invoiceNumber?: string | undefined;
    invoice_number?: string | undefined;
    amount?: number | undefined;
    totalAmount?: number | undefined;
    total_amount?: number | undefined;
    currency?: string | undefined;
    status?: string | undefined;
    paid?: boolean | undefined;
    productId?: string | undefined;
    product_id?: string | undefined;
    createdAt?: string | undefined;
    created_at?: string | undefined;
    customer?: {
      id?: string | undefined;
      externalId?: string | undefined;
      external_id?: string | undefined;
    } | undefined;
  };
}

export interface CreatePaygCheckoutRequest {
  actorUserId: string;
  actorRole?: BillingActorRole | undefined;
  successUrl: string;
  returnUrl?: string | undefined;
}

export interface BillingPaygCheckoutResponse {
  id: string;
  organizationId: string;
  provider: "polar";
  packAmountMinor: 500;
  currency: "usd";
  providerCheckoutId: string;
  checkoutUrl: string;
  status: "open";
  createdBy: string;
  createdAt: string;
}

export interface PolarOrderRefundedWebhookPayload {
  type: "order.refunded";
  data: {
    id?: string | undefined;
    totalAmount?: number | undefined;
    total_amount?: number | undefined;
    refundedAmount?: number | undefined;
    refunded_amount?: number | undefined;
    currency?: string | undefined;
    productId?: string | undefined;
    product_id?: string | undefined;
    modifiedAt?: string | undefined;
    modified_at?: string | undefined;
    customer?: {
      id?: string | undefined;
      externalId?: string | undefined;
      external_id?: string | undefined;
    } | undefined;
  };
}

export interface PolarSubscriptionPastDueWebhookPayload {
  type: "subscription.past_due";
  timestamp?: string | undefined;
  data: PolarSubscriptionPayload & {
    amount?: number | undefined;
    currency?: string | undefined;
    customer?: {
      id?: string | undefined;
      externalId?: string | undefined;
      external_id?: string | undefined;
    } | undefined;
  };
}

export type PolarWebhookPayload = PolarCustomerStateWebhookPayload | PolarOrderPaidWebhookPayload | PolarOrderRefundedWebhookPayload | PolarSubscriptionPastDueWebhookPayload | {
  type: string;
  data?: unknown;
};

export interface PolarSubscriptionPayload {
  id?: string | undefined;
  productId?: string | undefined;
  product_id?: string | undefined;
  status?: string | undefined;
  currentPeriodEnd?: string | undefined;
  current_period_end?: string | undefined;
  cancelAtPeriodEnd?: boolean | undefined;
  cancel_at_period_end?: boolean | undefined;
  createdAt?: string | undefined;
  created_at?: string | undefined;
  modifiedAt?: string | undefined;
  modified_at?: string | undefined;
}

export interface PolarBenefitPayload {
  id?: string | undefined;
  benefitId?: string | undefined;
  benefit_id?: string | undefined;
  benefitType?: string | undefined;
  benefit_type?: string | undefined;
  type?: string | undefined;
  description?: string | undefined;
  createdAt?: string | undefined;
  created_at?: string | undefined;
  modifiedAt?: string | undefined;
  modified_at?: string | undefined;
}
