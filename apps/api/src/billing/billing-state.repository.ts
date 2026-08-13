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
import type { Pool, PoolClient } from "pg";
import {
  createTenantJsonStateRepository,
  type TenantJsonStateRepository,
} from "../persistence/tenant-json-state.repository";

export const BILLING_STATE_REPOSITORY = Symbol("BILLING_STATE_REPOSITORY");

export interface PersistedBillingStateRecord {
  schemaVersion: 1;
  organizationId: string;
  customerExternalId: string;
  providerCustomerId?: string | undefined;
  plan: BillingPlanResponse | null;
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
  private readonly stateRepository: TenantJsonStateRepository<PersistedBillingStateRecord>;

  constructor(rootDirectory: string) {
    this.stateRepository = createTenantJsonStateRepository({
      directoryPath: rootDirectory,
      validate: isPersistedBillingStateRecord,
      normalize: normalizePersistedBillingStateRecord,
      quarantineCorrupt: false,
      trailingNewline: true,
    });
  }

  async load(organizationId: string) {
    return this.stateRepository.load(organizationId);
  }

  async save(state: PersistedBillingStateRecord) {
    this.stateRepository.save(state);
  }
}

export class PostgresBillingStateRepository implements BillingStateRepository {
  constructor(private readonly database: Pick<Pool, "connect">) {}

  async load(organizationId: string) {
    const client = await this.database.connect();
    try {
      const result = await client.query<{ state: unknown }>(
        `select state
         from billing_tenant_states
         where tenant_id = $1`,
        [organizationId],
      );
      const state = result.rows[0]?.state;
      if (state === undefined) {
        return null;
      }
      if (!isPersistedBillingStateRecord(state, organizationId)) {
        throw new Error(`Stored billing state for ${organizationId} is invalid.`);
      }

      return cloneState(normalizePersistedBillingStateRecord(state));
    } finally {
      client.release();
    }
  }

  async save(state: PersistedBillingStateRecord) {
    const client = await this.database.connect();
    try {
      await client.query("begin");
      await ensureTenantShell(client, state.organizationId);
      await client.query(
        `insert into billing_tenant_states (tenant_id, state, updated_at)
         values ($1, $2::jsonb, $3)
         on conflict (tenant_id) do update set
           state = excluded.state,
           updated_at = excluded.updated_at`,
        [state.organizationId, JSON.stringify(state), state.updatedAt],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

function cloneState(state: PersistedBillingStateRecord): PersistedBillingStateRecord {
  return {
    ...state,
    plan: state.plan === null ? null : { ...state.plan },
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

function isPersistedBillingStateRecord(
  value: unknown,
  organizationId: string,
): value is PersistedBillingStateRecord {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<PersistedBillingStateRecord>;

  return (
    candidate.schemaVersion === 1 &&
    candidate.organizationId === organizationId &&
    typeof candidate.customerExternalId === "string" &&
    candidate.plan !== undefined &&
    candidate.subscription !== undefined &&
    Array.isArray(candidate.usage) &&
    candidate.budgetPolicy !== undefined &&
    (candidate.budgetDecisions === undefined || Array.isArray(candidate.budgetDecisions)) &&
    Array.isArray(candidate.entitlements) &&
    Array.isArray(candidate.invoices) &&
    Array.isArray(candidate.checkouts) &&
    Array.isArray(candidate.usageEvents) &&
    (candidate.telephonyMinuteEvents === undefined || Array.isArray(candidate.telephonyMinuteEvents)) &&
    (candidate.runtimeCostEvents === undefined || Array.isArray(candidate.runtimeCostEvents)) &&
    (candidate.processedWebhookIds === undefined || Array.isArray(candidate.processedWebhookIds)) &&
    typeof candidate.updatedAt === "string"
  );
}

function normalizePersistedBillingStateRecord(
  record: PersistedBillingStateRecord,
): PersistedBillingStateRecord {
  return {
    ...record,
    budgetDecisions: record.budgetDecisions ?? [],
    telephonyMinuteEvents: record.telephonyMinuteEvents ?? [],
    runtimeCostEvents: record.runtimeCostEvents ?? [],
    processedWebhookIds: record.processedWebhookIds ?? [],
  };
}

async function ensureTenantShell(client: PoolClient, organizationId: string) {
  await client.query(
    `insert into tenants (id, slug, name)
     values ($1, $1, $1)
     on conflict (id) do nothing`,
    [organizationId],
  );
}
