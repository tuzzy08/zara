import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  BillingCheckoutResponse,
  BillingBudgetPolicyResponse,
  BillingBudgetDecisionResponse,
  BillingEntitlementResponse,
  BillingInvoiceResponse,
  BillingPlanResponse,
  BillingSubscriptionResponse,
  BillingUsageMetricResponse,
  RuntimeCostEventResponse,
  TelephonyMinuteEventResponse,
  UsageBillingEventResponse,
} from "./billing.models";

export const BILLING_STATE_REPOSITORY = Symbol("BILLING_STATE_REPOSITORY");

export interface PersistedBillingStateRecord {
  schemaVersion: 1;
  organizationId: string;
  customerExternalId: string;
  providerCustomerId?: string | undefined;
  plan: BillingPlanResponse;
  subscription: BillingSubscriptionResponse;
  usage: BillingUsageMetricResponse[];
  budgetPolicy: BillingBudgetPolicyResponse;
  budgetDecisions: BillingBudgetDecisionResponse[];
  entitlements: BillingEntitlementResponse[];
  invoices: BillingInvoiceResponse[];
  checkouts: BillingCheckoutResponse[];
  usageEvents: UsageBillingEventResponse[];
  telephonyMinuteEvents: TelephonyMinuteEventResponse[];
  runtimeCostEvents: RuntimeCostEventResponse[];
  processedWebhookIds: string[];
  updatedAt: string;
}

export interface BillingStateRepository {
  load: (organizationId: string) => Promise<PersistedBillingStateRecord | null>;
  save: (state: PersistedBillingStateRecord) => Promise<void>;
}

export class InMemoryBillingStateRepository implements BillingStateRepository {
  private readonly states = new Map<string, PersistedBillingStateRecord>();

  async load(organizationId: string) {
    const state = this.states.get(organizationId);
    return state === undefined ? null : cloneState(state);
  }

  async save(state: PersistedBillingStateRecord) {
    this.states.set(state.organizationId, cloneState(state));
  }
}

export class FileBillingStateRepository implements BillingStateRepository {
  constructor(private readonly rootDirectory: string) {}

  async load(organizationId: string) {
    try {
      const raw = await readFile(this.resolveStatePath(organizationId), "utf8");
      return JSON.parse(raw) as PersistedBillingStateRecord;
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }

      throw error;
    }
  }

  async save(state: PersistedBillingStateRecord) {
    const statePath = this.resolveStatePath(state.organizationId);
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  private resolveStatePath(organizationId: string) {
    return join(this.rootDirectory, `${encodeURIComponent(organizationId)}.json`);
  }
}

function cloneState(state: PersistedBillingStateRecord): PersistedBillingStateRecord {
  return {
    ...state,
    plan: { ...state.plan },
    subscription: { ...state.subscription },
    usage: state.usage.map((usage) => ({ ...usage })),
    budgetPolicy: { ...state.budgetPolicy },
    budgetDecisions: (state.budgetDecisions ?? []).map((budgetDecision) => ({
      ...budgetDecision,
      reasons: [...budgetDecision.reasons],
      projected: { ...budgetDecision.projected },
    })),
    entitlements: state.entitlements.map((entitlement) => ({ ...entitlement })),
    invoices: state.invoices.map((invoice) => ({ ...invoice })),
    checkouts: state.checkouts.map((checkout) => ({ ...checkout })),
    usageEvents: state.usageEvents.map((usageEvent) => ({ ...usageEvent })),
    telephonyMinuteEvents: (state.telephonyMinuteEvents ?? []).map((telephonyMinuteEvent) => ({
      ...telephonyMinuteEvent,
    })),
    runtimeCostEvents: (state.runtimeCostEvents ?? []).map((runtimeCostEvent) => ({
      ...runtimeCostEvent,
      components: runtimeCostEvent.components.map((component) => ({ ...component })),
      missingRates: [...runtimeCostEvent.missingRates],
    })),
    processedWebhookIds: [...state.processedWebhookIds],
  };
}

function isNotFoundError(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
