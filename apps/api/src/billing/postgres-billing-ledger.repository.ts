import type { Pool, PoolClient, QueryResultRow } from "pg";
import { isDeepStrictEqual } from "node:util";
import type { BillingPolarMapping } from "./billing-polar-outbox.config";

type Queryable = Pick<Pool | PoolClient, "query">;
type TransactionalDatabase = Pick<Pool, "query" | "connect">;

export const BILLING_LEDGER_REPOSITORY = Symbol("BILLING_LEDGER_REPOSITORY");

export interface BillingTenantAccount {
  organizationId: string;
  provider: "polar";
  providerCustomerId?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface BillingPriceCatalog {
  id: string;
  version: number;
  status: "active";
  currency: "usd";
  effectiveFrom: string;
  checksum: string;
  document: Record<string, unknown>;
  approvedBy: string;
  approvedAt: string;
  createdAt: string;
}

export interface BillingLedgerEntry {
  id: string;
  organizationId: string;
  idempotencyKey: string;
  entryType: "runtime_charge" | "telephony_charge" | "credit" | "adjustment" | "refund";
  catalogId?: string | undefined;
  currency: "usd";
  customerAmountMinor?: number | undefined;
  supplierCostMinor?: number | undefined;
  quantity: number;
  unit: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface BillingAdjustmentRecord {
  id: string;
  organizationId: string;
  ledgerEntryId: string;
  kind: "credit" | "debit";
  amountMinor: number;
  currency: "usd";
  reason: string;
  createdBy: string;
  createdAt: string;
}

export interface BillingOutboxEntry {
  id: string;
  organizationId: string;
  aggregateType: "billing_ledger_entry" | "payg_credit_entry";
  aggregateId: string;
  eventType: "polar.usage.report";
  payload: Record<string, unknown>;
  status: "pending" | "processing" | "delivered" | "dead_letter";
  attemptCount: number;
  nextAttemptAt: string;
  lastError?: string | undefined;
  createdAt: string;
  deliveredAt?: string | undefined;
}

export interface BillingPaygCreditEntry {
  id: string;
  organizationId: string;
  orderId?: string | undefined;
  sessionId?: string | undefined;
  entryType: "grant" | "debit" | "refund" | "reversal" | "adjustment";
  amountMinor: number;
  idempotencyKey: string;
  expiresAt?: string | undefined;
  createdAt: string;
}

export interface BillingSubscriptionProjectionRecord {
  id: string;
  organizationId: string;
  providerSubscriptionId: string;
  catalogId: string;
  planSlug?: string | undefined;
  status: string;
  currentPeriodEnd?: string | undefined;
  cancelAtPeriodEnd: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface BillingEntitlementProjectionRecord {
  id: string;
  organizationId: string;
  providerBenefitId: string;
  key: string;
  status: "active" | "revoked";
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface BillingInvoiceProjectionRecord {
  id: string;
  organizationId: string;
  providerOrderId: string;
  invoiceNumber: string;
  currency: "usd";
  amountMinor: number;
  status: "paid";
  issuedAt: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface BillingWebhookReceiptRecord {
  organizationId: string;
  eventId: string;
  eventType: string;
  payloadHash: string;
  receivedAt: string;
  processedAt?: string | undefined;
  status: "received" | "processed" | "failed";
  error?: string | undefined;
}

export interface BillingPaygOrderRecord {
  id: string;
  organizationId: string;
  providerOrderId: string;
  currency: "usd";
  paidAmountMinor: number;
  grantedCreditMinor: number;
  status: "paid" | "refunded";
  createdAt: string;
}

export class PostgresBillingLedgerRepository {
  constructor(private readonly database: TransactionalDatabase) {}

  async recordPolarWebhookReceipt(input: {
    organizationId: string;
    eventId: string;
    eventType: string;
    payloadHash: string;
    receivedAt: string;
  }) {
    if (!/^[a-f0-9]{64}$/.test(input.payloadHash)) {
      throw new Error("Webhook payload hash must be 64 lowercase hexadecimal characters.");
    }
    try {
      await this.database.query(
        `insert into billing_webhook_receipts (
           tenant_id, provider, event_id, event_type, payload_hash,
           received_at, status
         ) values ($1, 'polar', $2, $3, $4, $5, 'received')`,
        [
          input.organizationId,
          input.eventId,
          input.eventType,
          input.payloadHash,
          input.receivedAt,
        ],
      );
      return { duplicate: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
    const existing = await this.database.query(
      `select event_type, payload_hash
       from billing_webhook_receipts
       where tenant_id = $1 and provider = 'polar' and event_id = $2`,
      [input.organizationId, input.eventId],
    );
    const row = existing.rows[0];
    if (
      row === undefined
      || row.event_type !== input.eventType
      || row.payload_hash !== input.payloadHash
    ) {
      throw new Error("Webhook replay payload does not match the original event.");
    }
    return { duplicate: true };
  }

  async upsertTenantAccount(input: BillingTenantAccount) {
    await this.database.query(
      `insert into billing_customers (
         tenant_id, provider, provider_customer_id, created_at, updated_at
       ) values ($1, 'polar', $2, $3, $4)
       on conflict (tenant_id) do update set
         provider_customer_id = excluded.provider_customer_id,
         updated_at = excluded.updated_at
       where billing_customers.provider_customer_id <> excluded.provider_customer_id
          or (billing_customers.provider_customer_id is null and excluded.provider_customer_id is not null)
          or (billing_customers.provider_customer_id is not null and excluded.provider_customer_id is null)`,
      [
        input.organizationId,
        input.providerCustomerId ?? null,
        input.createdAt,
        input.updatedAt,
      ],
    );
  }

  async listTenantAccounts(): Promise<BillingTenantAccount[]> {
    const result = await this.database.query(
      `select tenant_id, provider, provider_customer_id, created_at, updated_at
       from billing_customers
       where provider = 'polar'
       order by tenant_id asc`,
    );
    return result.rows.map(mapTenantAccount);
  }

  async applyPaidInvoiceProjection(input: BillingInvoiceProjectionRecord) {
    assertNonNegativeSafeInteger(input.amountMinor, "amountMinor");
    if (input.currency !== "usd" || input.status !== "paid") {
      throw new Error("A paid invoice projection must use USD and paid status.");
    }

    const client = await this.database.connect();
    try {
      await client.query("begin");
      const existingBeforeInsert = await client.query(
        `select tenant_id, id, provider_order_id, invoice_number, currency,
                amount_minor, status, issued_at, metadata, created_at
         from billing_invoices
         where provider_order_id = $1
         for update`,
        [input.providerOrderId],
      );
      if (existingBeforeInsert.rows[0] !== undefined) {
        assertInvoiceProjectionMatch(
          mapInvoiceProjection(existingBeforeInsert.rows[0]),
          input,
        );
        await client.query("commit");
        return { duplicate: true };
      }
      const insertResult = await client.query(
        `insert into billing_invoices (
           tenant_id, id, provider_order_id, invoice_number, currency,
           amount_minor, status, issued_at, metadata, created_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
         on conflict (provider_order_id) do nothing
         returning provider_order_id`,
        [
          input.organizationId,
          input.id,
          input.providerOrderId,
          input.invoiceNumber,
          input.currency,
          input.amountMinor,
          input.status,
          input.issuedAt,
          JSON.stringify(input.metadata),
          input.createdAt,
        ],
      );
      if (insertResult.rows.length > 0) {
        await client.query("commit");
        return { duplicate: false };
      }

      const existingResult = await client.query(
        `select tenant_id, id, provider_order_id, invoice_number, currency,
                amount_minor, status, issued_at, metadata, created_at
         from billing_invoices
         where provider_order_id = $1
         for update`,
        [input.providerOrderId],
      );
      const existing = existingResult.rows[0];
      if (existing === undefined) {
        throw new Error("The paid invoice projection could not be read after a conflict.");
      }
      assertInvoiceProjectionMatch(mapInvoiceProjection(existing), input);
      await client.query("commit");
      return { duplicate: true };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async applyPolarCustomerStateProjection(input: {
    account: BillingTenantAccount;
    subscriptions: BillingSubscriptionProjectionRecord[];
    entitlements: BillingEntitlementProjectionRecord[];
    reconciledAt: string;
  }) {
    const client = await this.database.connect();
    let changed = false;
    try {
      await client.query("begin");
      const existingAccountResult = await client.query(
        `select provider_customer_id from billing_customers
         where tenant_id = $1 for update`,
        [input.account.organizationId],
      );
      const existingProviderCustomerId = existingAccountResult.rows[0]?.provider_customer_id;
      changed =
        existingAccountResult.rows[0] === undefined
        || existingProviderCustomerId !== (input.account.providerCustomerId ?? null);
      await client.query(
        `insert into billing_customers (
           tenant_id, provider, provider_customer_id, created_at, updated_at
         ) values ($1, 'polar', $2, $3, $4)
         on conflict (tenant_id) do update set
           provider_customer_id = excluded.provider_customer_id,
           updated_at = excluded.updated_at
         where billing_customers.provider_customer_id <> excluded.provider_customer_id
            or (billing_customers.provider_customer_id is null and excluded.provider_customer_id is not null)
            or (billing_customers.provider_customer_id is not null and excluded.provider_customer_id is null)`,
        [
          input.account.organizationId,
          input.account.providerCustomerId ?? null,
          input.account.createdAt,
          input.account.updatedAt,
        ],
      );
      for (const subscription of input.subscriptions) {
        const result = await client.query(
          `insert into billing_subscriptions (
             tenant_id, id, provider_subscription_id, catalog_id, plan_slug, status,
             current_period_end, cancel_at_period_end, version, created_at, updated_at
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           on conflict (tenant_id, id) do update set
             provider_subscription_id = excluded.provider_subscription_id,
             catalog_id = excluded.catalog_id,
             plan_slug = excluded.plan_slug,
             status = excluded.status,
             current_period_end = excluded.current_period_end,
             cancel_at_period_end = excluded.cancel_at_period_end,
             version = billing_subscriptions.version + 1,
             updated_at = excluded.updated_at
           where excluded.updated_at > billing_subscriptions.updated_at`,
          [
            subscription.organizationId,
            subscription.id,
            subscription.providerSubscriptionId,
            subscription.catalogId,
            subscription.planSlug ?? null,
            subscription.status,
            subscription.currentPeriodEnd ?? null,
            subscription.cancelAtPeriodEnd,
            subscription.version,
            subscription.createdAt,
            subscription.updatedAt,
          ],
        );
        changed = changed || (result.rowCount ?? 0) > 0;
      }
      const activeSubscriptionIds = input.subscriptions.map(
        (subscription) => subscription.providerSubscriptionId,
      );
      const activeIdCondition = activeSubscriptionIds.length === 0
        ? ""
        : `and provider_subscription_id not in (${activeSubscriptionIds
            .map((_, index) => `$${index + 3}`)
            .join(", ")})`;
      const revocationResult = await client.query(
        `update billing_subscriptions
         set status = 'revoked', cancel_at_period_end = false,
             version = version + 1, updated_at = $2
         where tenant_id = $1
           and status not in ('canceled', 'revoked')
           and updated_at < $2
           ${activeIdCondition}`,
        [
          input.account.organizationId,
          input.reconciledAt,
          ...activeSubscriptionIds,
        ],
      );
      changed = changed || (revocationResult.rowCount ?? 0) > 0;
      for (const entitlement of input.entitlements) {
        const result = await client.query(
          `insert into billing_entitlements (
             tenant_id, id, provider_benefit_id, key, status,
             metadata, created_at, updated_at
           ) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
           on conflict (tenant_id, key) do update set
             provider_benefit_id = excluded.provider_benefit_id,
             status = excluded.status,
             metadata = excluded.metadata,
             updated_at = excluded.updated_at
           where excluded.updated_at > billing_entitlements.updated_at`,
          [
            entitlement.organizationId,
            entitlement.id,
            entitlement.providerBenefitId,
            entitlement.key,
            entitlement.status,
            JSON.stringify(entitlement.metadata),
            entitlement.createdAt,
            entitlement.updatedAt,
          ],
        );
        changed = changed || (result.rowCount ?? 0) > 0;
      }
      const activeEntitlementKeys = input.entitlements.map(
        (entitlement) => entitlement.key,
      );
      const activeKeyCondition = activeEntitlementKeys.length === 0
        ? ""
        : `and key not in (${activeEntitlementKeys
            .map((_, index) => `$${index + 3}`)
            .join(", ")})`;
      const entitlementRevocationResult = await client.query(
        `update billing_entitlements
         set status = 'revoked', updated_at = $2
         where tenant_id = $1 and status <> 'revoked' and updated_at < $2
           ${activeKeyCondition}`,
        [
          input.account.organizationId,
          input.reconciledAt,
          ...activeEntitlementKeys,
        ],
      );
      changed = changed || (entitlementRevocationResult.rowCount ?? 0) > 0;
      await client.query("commit");
      return { changed };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async markPolarWebhookProcessed(input: {
    organizationId: string;
    eventId: string;
    processedAt: string;
  }) {
    const result = await this.database.query(
      `update billing_webhook_receipts
       set status = 'processed', processed_at = $3, error = null
       where tenant_id = $1 and provider = 'polar' and event_id = $2`,
      [input.organizationId, input.eventId, input.processedAt],
    );
    if (result.rowCount !== 1) {
      throw new Error(`Polar webhook receipt ${input.eventId} was not found.`);
    }
  }

  async getPolarWebhookReceipt(
    organizationId: string,
    eventId: string,
  ): Promise<BillingWebhookReceiptRecord | null> {
    const result = await this.database.query(
      `select tenant_id, event_id, event_type, payload_hash, received_at,
              processed_at, status, error
       from billing_webhook_receipts
       where tenant_id = $1 and provider = 'polar' and event_id = $2`,
      [organizationId, eventId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapWebhookReceipt(row);
  }

  async upsertSubscriptionProjection(input: BillingSubscriptionProjectionRecord) {
    await this.database.query(
      `insert into billing_subscriptions (
         tenant_id, id, provider_subscription_id, catalog_id, plan_slug, status,
         current_period_end, cancel_at_period_end, version, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (tenant_id, id) do update set
         provider_subscription_id = excluded.provider_subscription_id,
         catalog_id = excluded.catalog_id,
         plan_slug = excluded.plan_slug,
         status = excluded.status,
         current_period_end = excluded.current_period_end,
         cancel_at_period_end = excluded.cancel_at_period_end,
         version = billing_subscriptions.version + 1,
         updated_at = excluded.updated_at
       where excluded.updated_at > billing_subscriptions.updated_at`,
      [
        input.organizationId,
        input.id,
        input.providerSubscriptionId,
        input.catalogId,
        input.planSlug ?? null,
        input.status,
        input.currentPeriodEnd ?? null,
        input.cancelAtPeriodEnd,
        input.version,
        input.createdAt,
        input.updatedAt,
      ],
    );
  }

  async listSubscriptionProjections(
    organizationId: string,
  ): Promise<BillingSubscriptionProjectionRecord[]> {
    const result = await this.database.query(
      `select tenant_id, id, provider_subscription_id, catalog_id, plan_slug, status,
              current_period_end, cancel_at_period_end, version, created_at, updated_at
       from billing_subscriptions
       where tenant_id = $1
       order by updated_at desc, id asc`,
      [organizationId],
    );
    return result.rows.map(mapSubscriptionProjection);
  }

  async listEntitlementProjections(
    organizationId: string,
  ): Promise<BillingEntitlementProjectionRecord[]> {
    const result = await this.database.query(
      `select tenant_id, id, provider_benefit_id, key, status,
              metadata, created_at, updated_at
       from billing_entitlements
       where tenant_id = $1
       order by key asc`,
      [organizationId],
    );
    return result.rows.map(mapEntitlementProjection);
  }

  async applyPaidPaygOrder(input: {
    order: BillingPaygOrderRecord;
    grant: BillingPaygCreditEntry & { entryType: "grant" };
  }) {
    assertApprovedPaygOrder(input);
    const client = await this.database.connect();
    try {
      await client.query("begin");
      const existingOrder = await client.query(
        `select tenant_id, id, provider_order_id, currency, paid_amount_minor,
                granted_credit_minor, status, created_at
         from billing_payg_orders
         where tenant_id = $1 and provider_order_id = $2`,
        [input.order.organizationId, input.order.providerOrderId],
      );
      const existingRow = existingOrder.rows[0];
      if (existingRow !== undefined) {
        assertPaygOrderMatch(mapPaygOrder(existingRow), input.order);
        const existingGrant = await this.getPaygCreditEntryByIdempotencyKeyUsing(
          client,
          input.grant.organizationId,
          input.grant.idempotencyKey,
        );
        if (existingGrant === null) {
          throw new Error("Paid PAYG order exists without its credit grant.");
        }
        assertPaygCreditMatch(existingGrant, input.grant);
        await client.query("commit");
        return { duplicate: true };
      }
      await client.query(
        `insert into billing_payg_orders (
           tenant_id, id, provider_order_id, currency, paid_amount_minor,
           granted_credit_minor, status, created_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          input.order.organizationId,
          input.order.id,
          input.order.providerOrderId,
          input.order.currency,
          input.order.paidAmountMinor,
          input.order.grantedCreditMinor,
          input.order.status,
          input.order.createdAt,
        ],
      );
      await client.query(
        `insert into billing_payg_credit_entries (
           tenant_id, id, order_id, entry_type, amount_minor,
           idempotency_key, session_id, expires_at, created_at
         ) values ($1, $2, $3, 'grant', $4, $5, null, $6, $7)`,
        [
          input.grant.organizationId,
          input.grant.id,
          input.grant.orderId,
          input.grant.amountMinor,
          input.grant.idempotencyKey,
          input.grant.expiresAt ?? null,
          input.grant.createdAt,
        ],
      );
      await client.query("commit");
      return { duplicate: false };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async applyPaygOrderRefund(input: {
    organizationId: string;
    providerOrderId: string;
    reversal: BillingPaygCreditEntry & { entryType: "reversal" };
  }) {
    if (
      input.reversal.organizationId !== input.organizationId
      || input.reversal.amountMinor !== 500
      || input.reversal.orderId === undefined
    ) {
      throw new Error("A PAYG refund must reverse one USD 5.00 grant.");
    }
    const client = await this.database.connect();
    try {
      await client.query("begin");
      const orderResult = await client.query(
        `select tenant_id, id, provider_order_id, currency, paid_amount_minor,
                granted_credit_minor, status, created_at
         from billing_payg_orders
         where tenant_id = $1 and provider_order_id = $2
         for update`,
        [input.organizationId, input.providerOrderId],
      );
      const row = orderResult.rows[0];
      if (row === undefined) throw new Error("Paid PAYG order was not found.");
      const order = mapPaygOrder(row);
      if (input.reversal.orderId !== order.id) {
        throw new Error("PAYG refund reversal does not match its order.");
      }
      const existingReversal = await this.getPaygCreditEntryByIdempotencyKeyUsing(
        client,
        input.organizationId,
        input.reversal.idempotencyKey,
      );
      if (order.status === "refunded") {
        if (existingReversal === null) {
          throw new Error("Refunded PAYG order is missing its reversal.");
        }
        assertPaygCreditMatch(existingReversal, input.reversal);
        await client.query("commit");
        return { duplicate: true };
      }
      const entriesResult = await client.query(
        `select tenant_id, id, order_id, session_id, entry_type, amount_minor,
                idempotency_key, expires_at, created_at
         from billing_payg_credit_entries
         where tenant_id = $1
         order by created_at asc, id asc`,
        [input.organizationId],
      );
      const entries = entriesResult.rows.map(mapPaygCreditEntry);
      if (remainingGrantForOrder(entries, order.id) !== 500) {
        throw new Error("A used PAYG credit pack cannot be refunded.");
      }
      await client.query(
        `insert into billing_payg_credit_entries (
           tenant_id, id, order_id, entry_type, amount_minor,
           idempotency_key, session_id, expires_at, created_at
         ) values ($1, $2, $3, 'reversal', $4, $5, null, null, $6)`,
        [
          input.organizationId,
          input.reversal.id,
          order.id,
          input.reversal.amountMinor,
          input.reversal.idempotencyKey,
          input.reversal.createdAt,
        ],
      );
      await client.query(
        `update billing_payg_orders set status = 'refunded'
         where tenant_id = $1 and id = $2`,
        [input.organizationId, order.id],
      );
      await client.query("commit");
      return { duplicate: false };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async applyApprovedAdjustment(input: BillingAdjustmentRecord) {
    assertApprovedAdjustment(input);
    const client = await this.database.connect();
    try {
      await client.query("begin");
      const originalResult = await client.query(
        `select id from billing_ledger_entries
         where tenant_id = $1 and id = $2`,
        [input.organizationId, input.ledgerEntryId],
      );
      if (originalResult.rows[0] === undefined) {
        throw new Error(`Original ledger entry ${input.ledgerEntryId} was not found.`);
      }
      const existing = await this.getAdjustmentUsing(
        client,
        input.organizationId,
        input.id,
      );
      const duplicate = existing !== null;
      if (existing !== null) {
        assertAdjustmentMatch(existing, input);
      } else {
        await client.query(
          `insert into billing_adjustments (
             tenant_id, id, ledger_entry_id, kind, amount_minor,
             currency, reason, created_by, created_at
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            input.organizationId,
            input.id,
            input.ledgerEntryId,
            input.kind,
            input.amountMinor,
            input.currency,
            input.reason,
            input.createdBy,
            input.createdAt,
          ],
        );
      }
      const ledgerResult = await this.appendLedgerEntryUsing(
        client,
        adjustmentLedgerEntry(input),
      );
      if (ledgerResult.duplicate !== duplicate) {
        throw new Error(`Adjustment ${input.id} has incomplete ledger state.`);
      }
      await client.query(
        `insert into audit_logs (
           id, tenant_id, actor_type, actor_id, action,
           target_type, target_id, metadata, occurred_at
         ) values ($1, $2, 'user', $3, 'billing.adjustment_applied',
                   'billing_adjustment', $4, $5::jsonb, $6)
         on conflict (id) do nothing`,
        [
          `billing-adjustment:${input.organizationId}:${input.id}`,
          input.organizationId,
          input.createdBy,
          input.id,
          JSON.stringify({
            ledgerEntryId: input.ledgerEntryId,
            kind: input.kind,
            amountMinor: input.amountMinor,
          }),
          input.createdAt,
        ],
      );
      const audit = await client.query(
        `select tenant_id, actor_type, actor_id, action, target_type, target_id,
                metadata, occurred_at
         from audit_logs where id = $1`,
        [`billing-adjustment:${input.organizationId}:${input.id}`],
      );
      const auditRow = audit.rows[0];
      const expectedMetadata = {
        ledgerEntryId: input.ledgerEntryId,
        kind: input.kind,
        amountMinor: input.amountMinor,
      };
      if (auditRow === undefined
        || auditRow.tenant_id !== input.organizationId
        || auditRow.actor_type !== "user"
        || auditRow.actor_id !== input.createdBy
        || auditRow.action !== "billing.adjustment_applied"
        || auditRow.target_type !== "billing_adjustment"
        || auditRow.target_id !== input.id
        || !isDeepStrictEqual(auditRow.metadata, expectedMetadata)
        || new Date(String(auditRow.occurred_at)).toISOString() !== input.createdAt) {
        throw new Error(`Adjustment ${input.id} audit record has different data.`);
      }
      await client.query("commit");
      return { adjustment: { ...input }, duplicate };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listAdjustments(organizationId: string): Promise<BillingAdjustmentRecord[]> {
    const result = await this.database.query(
      `select tenant_id, id, ledger_entry_id, kind, amount_minor,
              currency, reason, created_by, created_at
       from billing_adjustments
       where tenant_id = $1
       order by created_at asc, id asc`,
      [organizationId],
    );
    return result.rows.map(mapAdjustment);
  }

  private async getAdjustmentUsing(
    database: Queryable,
    organizationId: string,
    id: string,
  ): Promise<BillingAdjustmentRecord | null> {
    const result = await database.query(
      `select tenant_id, id, ledger_entry_id, kind, amount_minor,
              currency, reason, created_by, created_at
       from billing_adjustments
       where tenant_id = $1 and id = $2`,
      [organizationId, id],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapAdjustment(row);
  }

  async getTenantAccount(organizationId: string): Promise<BillingTenantAccount | null> {
    const result = await this.database.query(
      `select tenant_id, provider, provider_customer_id, created_at, updated_at
       from billing_customers
       where tenant_id = $1`,
      [organizationId],
    );
    const row = result.rows[0];

    return row === undefined ? null : mapTenantAccount(row);
  }

  async publishPriceCatalog(catalog: BillingPriceCatalog) {
    assertCatalogDocument(catalog.document);
    const existingCatalog = await this.getPriceCatalog(catalog.id);
    if (existingCatalog !== null) {
      assertCatalogMatch(existingCatalog, catalog);
      return { catalog: existingCatalog, duplicate: true };
    }

    try {
      await this.database.query(
        `insert into billing_price_catalogs (
           id, version, status, currency, effective_from, checksum,
           catalog_document, approved_by, approved_at, created_at
         ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)`,
        [
          catalog.id,
          catalog.version,
          catalog.status,
          catalog.currency,
          catalog.effectiveFrom,
          catalog.checksum,
          JSON.stringify(catalog.document),
          catalog.approvedBy,
          catalog.approvedAt,
          catalog.createdAt,
        ],
      );
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const concurrentCatalog = await this.getPriceCatalog(catalog.id);
      if (concurrentCatalog === null) {
        throw new Error(`Price catalog ${catalog.id} is immutable.`);
      }
      assertCatalogMatch(concurrentCatalog, catalog);
      return { catalog: concurrentCatalog, duplicate: true };
    }

    return { catalog: { ...catalog, document: { ...catalog.document } }, duplicate: false };
  }

  async getPriceCatalog(id: string): Promise<BillingPriceCatalog | null> {
    const result = await this.database.query(
      `select id, version, status, currency, effective_from, checksum,
              catalog_document, approved_by, approved_at, created_at
       from billing_price_catalogs
       where id = $1`,
      [id],
    );
    const row = result.rows[0];

    if (row === undefined) {
      return null;
    }

    const catalog = mapPriceCatalog(row);
    assertCatalogDocument(catalog.document);
    return catalog;
  }

  async getEffectivePriceCatalog(occurredAt: string): Promise<BillingPriceCatalog | null> {
    const result = await this.database.query(
      `select id, version, status, currency, effective_from, checksum,
              catalog_document, approved_by, approved_at, created_at
       from billing_price_catalogs
       where effective_from <= $1
       order by effective_from desc, version desc
       limit 1`,
      [occurredAt],
    );
    const row = result.rows[0];
    if (row === undefined) return null;

    const catalog = mapPriceCatalog(row);
    assertCatalogDocument(catalog.document);
    return catalog;
  }

  async listPolarMappings(
    catalogId: string,
    environment: "sandbox" | "production",
  ): Promise<BillingPolarMapping[]> {
    const result = await this.database.query(
      `select catalog_id, mapping_type, internal_key, provider_id, environment
       from billing_polar_mappings
       where catalog_id = $1 and environment = $2
       order by mapping_type asc, internal_key asc`,
      [catalogId, environment],
    );
    return result.rows.map((row) => ({
      catalogId: row.catalog_id as string,
      mappingType: row.mapping_type as string,
      internalKey: row.internal_key as string,
      providerId: row.provider_id as string,
      environment: row.environment,
    }));
  }

  async findPolarMappingByProviderId(
    providerId: string,
    environment: "sandbox" | "production",
  ): Promise<BillingPolarMapping | null> {
    const result = await this.database.query(
      `select catalog_id, mapping_type, internal_key, provider_id, environment
       from billing_polar_mappings
       where provider_id = $1 and environment = $2
       order by catalog_id desc
       limit 1`,
      [providerId, environment],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          catalogId: row.catalog_id as string,
          mappingType: row.mapping_type as string,
          internalKey: row.internal_key as string,
          providerId: row.provider_id as string,
          environment: row.environment,
        };
  }

  async appendLedgerEntry(input: BillingLedgerEntry) {
    return this.appendLedgerEntryUsing(this.database, input);
  }

  async appendLedgerEntryWithOutbox(input: {
    ledgerEntry: BillingLedgerEntry;
    outboxEntry: BillingOutboxEntry;
  }) {
    const client = await this.database.connect();
    try {
      await client.query("begin");
      const ledger = await this.appendLedgerEntryUsing(client, input.ledgerEntry);
      const existingOutbox = await this.getOutboxEntryUsing(
        client,
        input.outboxEntry.organizationId,
        input.outboxEntry.id,
      );
      if (existingOutbox === null) {
        await client.query(
        `insert into billing_outbox (
           tenant_id, id, aggregate_type, aggregate_id, event_type, payload,
           status, attempt_count, next_attempt_at, last_error, created_at, delivered_at
         ) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12)`,
        [
          input.outboxEntry.organizationId,
          input.outboxEntry.id,
          input.outboxEntry.aggregateType,
          input.outboxEntry.aggregateId,
          input.outboxEntry.eventType,
          JSON.stringify(input.outboxEntry.payload),
          input.outboxEntry.status,
          input.outboxEntry.attemptCount,
          input.outboxEntry.nextAttemptAt,
          input.outboxEntry.lastError ?? null,
          input.outboxEntry.createdAt,
          input.outboxEntry.deliveredAt ?? null,
        ],
        );
      } else {
        assertOutboxMatch(existingOutbox, input.outboxEntry);
      }
      await client.query("commit");
      return { ledger, outboxEntry: input.outboxEntry };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async appendPaygSessionDebitWithOutbox(input: {
    debit: Omit<BillingPaygCreditEntry, "entryType"> & { entryType?: "debit" };
    outboxEntry: BillingOutboxEntry;
  }) {
    assertPositiveSafeInteger(input.debit.amountMinor, "amountMinor");
    const debit: BillingPaygCreditEntry = { ...input.debit, entryType: "debit" };
    const client = await this.database.connect();
    try {
      await client.query("begin");
      const existing = await this.getPaygCreditEntryByIdempotencyKeyUsing(
        client,
        debit.organizationId,
        debit.idempotencyKey,
      );
      let duplicate = false;
      if (existing === null) {
        await client.query(
          `insert into billing_payg_credit_entries (
             tenant_id, id, order_id, session_id, entry_type, amount_minor,
             idempotency_key, expires_at, created_at
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            debit.organizationId,
            debit.id,
            debit.orderId ?? null,
            debit.sessionId ?? null,
            debit.entryType,
            debit.amountMinor,
            debit.idempotencyKey,
            debit.expiresAt ?? null,
            debit.createdAt,
          ],
        );
      } else {
        assertPaygCreditMatch(existing, debit);
        duplicate = true;
      }
      const existingOutbox = await this.getOutboxEntryUsing(
        client,
        input.outboxEntry.organizationId,
        input.outboxEntry.id,
      );
      if (existingOutbox === null) {
        await insertOutboxEntry(client, input.outboxEntry);
      } else {
        assertOutboxMatch(existingOutbox, input.outboxEntry);
      }
      await client.query("commit");
      return { debit, outboxEntry: input.outboxEntry, duplicate };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listPaygCreditEntries(organizationId: string): Promise<BillingPaygCreditEntry[]> {
    const result = await this.database.query(
      `select tenant_id, id, order_id, session_id, entry_type, amount_minor,
              idempotency_key, expires_at, created_at
       from billing_payg_credit_entries
       where tenant_id = $1
       order by created_at asc, id asc`,
      [organizationId],
    );
    return result.rows.map(mapPaygCreditEntry);
  }

  async listOutboxEntries(organizationId: string): Promise<BillingOutboxEntry[]> {
    const result = await this.database.query(
      `select tenant_id, id, aggregate_type, aggregate_id, event_type, payload,
              status, attempt_count, next_attempt_at, last_error, created_at, delivered_at
       from billing_outbox
       where tenant_id = $1
       order by created_at asc, id asc`,
      [organizationId],
    );
    return result.rows.map(mapOutboxEntry);
  }

  async claimDueOutbox(
    now: string,
    limit: number,
    processingLeaseUntil: string,
    releaseId: string,
  ): Promise<BillingOutboxEntry[]> {
    const client = await this.database.connect();
    try {
      await client.query("begin");
      const due = await client.query(
        `select tenant_id, id, aggregate_type, aggregate_id, event_type, payload,
                status, attempt_count, next_attempt_at, last_error, created_at, delivered_at
         from billing_outbox
         where status = 'pending' and next_attempt_at <= $1
           and payload ->> 'deliveryMode' = 'charge'
           and charge_release_id = $3
           and charge_promoted_at is not null
         order by next_attempt_at asc, created_at asc, id asc
         limit $2
         for update`,
        [now, limit, releaseId],
      );
      const claimed: BillingOutboxEntry[] = [];
      for (const row of due.rows) {
        const updated = await client.query(
          `update billing_outbox
           set status = 'processing', attempt_count = attempt_count + 1,
               next_attempt_at = $3, last_error = null
           where tenant_id = $1 and id = $2
           returning tenant_id, id, aggregate_type, aggregate_id, event_type, payload,
                     status, attempt_count, next_attempt_at, last_error, created_at, delivered_at`,
          [row.tenant_id, row.id, processingLeaseUntil],
        );
        claimed.push(mapOutboxEntry(updated.rows[0] as QueryResultRow));
      }
      await client.query("commit");
      return claimed;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async recoverStaleOutbox(now: string) {
    const result = await this.database.query(
      `update billing_outbox
       set status = 'pending', last_error = 'Recovered stale processing claim.'
       where status = 'processing' and next_attempt_at <= $1
       returning id`,
      [now],
    );
    return result.rowCount ?? result.rows.length;
  }

  async replayDeadLetter(input: {
    organizationId: string;
    id: string;
    nextAttemptAt: string;
    reason: string;
  }) {
    const result = await this.database.query(
      `update billing_outbox
       set status = 'pending', next_attempt_at = $3, last_error = $4
       where tenant_id = $1 and id = $2 and status = 'dead_letter'
       returning tenant_id, id, aggregate_type, aggregate_id, event_type, payload,
                 status, attempt_count, next_attempt_at, last_error, created_at, delivered_at`,
      [input.organizationId, input.id, input.nextAttemptAt, `Operator replay: ${input.reason}`],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error(`Dead-letter outbox event ${input.id} was not found for this tenant.`);
    }
    return mapOutboxEntry(row);
  }

  async markOutboxDelivered(
    organizationId: string,
    id: string,
    deliveredAt: string,
  ) {
    const result = await this.database.query(
      `update billing_outbox
       set status = 'delivered', delivered_at = $3, last_error = null
       where tenant_id = $1 and id = $2 and status = 'processing'
       returning tenant_id, id, aggregate_type, aggregate_id, event_type, payload,
                 status, attempt_count, next_attempt_at, last_error, created_at, delivered_at`,
      [organizationId, id, deliveredAt],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error(`Claimed outbox event ${id} was not found.`);
    }
    return mapOutboxEntry(row);
  }

  async markOutboxFailed(input: {
    organizationId: string;
    id: string;
    error: string;
    nextAttemptAt: string;
    deadLetter: boolean;
  }) {
    const result = await this.database.query(
      `update billing_outbox
       set status = $3, next_attempt_at = $4, last_error = $5
       where tenant_id = $1 and id = $2 and status = 'processing'
       returning tenant_id, id, aggregate_type, aggregate_id, event_type, payload,
                 status, attempt_count, next_attempt_at, last_error, created_at, delivered_at`,
      [
        input.organizationId,
        input.id,
        input.deadLetter ? "dead_letter" : "pending",
        input.nextAttemptAt,
        input.error,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error(`Claimed outbox event ${input.id} was not found.`);
    }
    return mapOutboxEntry(row);
  }

  private async getOutboxEntryUsing(
    database: Queryable,
    organizationId: string,
    id: string,
  ): Promise<BillingOutboxEntry | null> {
    const result = await database.query(
      `select tenant_id, id, aggregate_type, aggregate_id, event_type, payload,
              status, attempt_count, next_attempt_at, last_error, created_at, delivered_at
       from billing_outbox
       where tenant_id = $1 and id = $2`,
      [organizationId, id],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapOutboxEntry(row);
  }

  private async getPaygCreditEntryByIdempotencyKeyUsing(
    database: Queryable,
    organizationId: string,
    idempotencyKey: string,
  ): Promise<BillingPaygCreditEntry | null> {
    const result = await database.query(
      `select tenant_id, id, order_id, session_id, entry_type, amount_minor,
              idempotency_key, expires_at, created_at
       from billing_payg_credit_entries
       where tenant_id = $1 and idempotency_key = $2`,
      [organizationId, idempotencyKey],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapPaygCreditEntry(row);
  }

  private async appendLedgerEntryUsing(database: Queryable, input: BillingLedgerEntry) {
    assertOptionalMoney(input.customerAmountMinor, "customerAmountMinor");
    assertOptionalMoney(input.supplierCostMinor, "supplierCostMinor");
    assertNonNegativeSafeInteger(input.quantity, "quantity");
    const existingEntry = await this.getLedgerEntryByIdempotencyKeyUsing(
      database,
      input.organizationId,
      input.idempotencyKey,
    );
    if (existingEntry !== null) {
      assertIdempotentMatch(existingEntry, input);
      return { entry: existingEntry, duplicate: true };
    }

    try {
      await database.query(
        `insert into billing_ledger_entries (
           id, tenant_id, idempotency_key, entry_type, catalog_id, currency,
           customer_amount_minor, supplier_cost_minor, quantity, unit,
           occurred_at, metadata, created_at
         ) values (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10,
           $11, $12::jsonb, $13
         )`,
        [
          input.id,
          input.organizationId,
          input.idempotencyKey,
          input.entryType,
          input.catalogId ?? null,
          input.currency,
          input.customerAmountMinor ?? null,
          input.supplierCostMinor ?? null,
          input.quantity,
          input.unit,
          input.occurredAt,
          JSON.stringify(input.metadata),
          input.createdAt,
        ],
      );
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const concurrentEntry = await this.getLedgerEntryByIdempotencyKeyUsing(
        database,
        input.organizationId,
        input.idempotencyKey,
      );
      if (concurrentEntry === null) {
        throw error;
      }
      assertIdempotentMatch(concurrentEntry, input);
      return { entry: concurrentEntry, duplicate: true };
    }

    return { entry: { ...input, metadata: { ...input.metadata } }, duplicate: false };
  }

  async listLedgerEntries(organizationId: string): Promise<BillingLedgerEntry[]> {
    const result = await this.database.query(
      `select id, tenant_id, idempotency_key, entry_type, catalog_id, currency,
              customer_amount_minor, supplier_cost_minor, quantity, unit,
              occurred_at, metadata, created_at
       from billing_ledger_entries
       where tenant_id = $1
       order by occurred_at asc, id asc`,
      [organizationId],
    );

    return result.rows.map(mapLedgerEntry);
  }

  private async getLedgerEntryByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string,
  ): Promise<BillingLedgerEntry | null> {
    return this.getLedgerEntryByIdempotencyKeyUsing(
      this.database,
      organizationId,
      idempotencyKey,
    );
  }

  private async getLedgerEntryByIdempotencyKeyUsing(
    database: Queryable,
    organizationId: string,
    idempotencyKey: string,
  ): Promise<BillingLedgerEntry | null> {
    const result = await database.query(
      `select id, tenant_id, idempotency_key, entry_type, catalog_id, currency,
              customer_amount_minor, supplier_cost_minor, quantity, unit,
              occurred_at, metadata, created_at
       from billing_ledger_entries
       where tenant_id = $1 and idempotency_key = $2`,
      [organizationId, idempotencyKey],
    );
    const row = result.rows[0];

    return row === undefined ? null : mapLedgerEntry(row);
  }
}

function mapOutboxEntry(row: QueryResultRow): BillingOutboxEntry {
  return {
    id: row.id as string,
    organizationId: row.tenant_id as string,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id as string,
    eventType: row.event_type,
    payload: row.payload as Record<string, unknown>,
    status: row.status,
    attemptCount: normalizeInteger(row.attempt_count),
    nextAttemptAt: normalizeTimestamp(row.next_attempt_at),
    ...(row.last_error === null ? {} : { lastError: row.last_error as string }),
    createdAt: normalizeTimestamp(row.created_at),
    ...(row.delivered_at === null ? {} : { deliveredAt: normalizeTimestamp(row.delivered_at) }),
  };
}

function mapPaygCreditEntry(row: QueryResultRow): BillingPaygCreditEntry {
  return {
    id: row.id as string,
    organizationId: row.tenant_id as string,
    ...(row.order_id === null ? {} : { orderId: row.order_id as string }),
    ...(row.session_id === null ? {} : { sessionId: row.session_id as string }),
    entryType: row.entry_type,
    amountMinor: normalizeInteger(row.amount_minor),
    idempotencyKey: row.idempotency_key as string,
    ...(row.expires_at === null ? {} : { expiresAt: normalizeTimestamp(row.expires_at) }),
    createdAt: normalizeTimestamp(row.created_at),
  };
}

function mapTenantAccount(row: QueryResultRow): BillingTenantAccount {
  if (row.provider !== "polar") {
    throw new Error(`Unsupported billing provider: ${String(row.provider)}`);
  }

  return {
    organizationId: row.tenant_id as string,
    provider: row.provider,
    ...(row.provider_customer_id === null
      ? {}
      : { providerCustomerId: row.provider_customer_id as string }),
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

function mapSubscriptionProjection(
  row: QueryResultRow,
): BillingSubscriptionProjectionRecord {
  return {
    id: row.id as string,
    organizationId: row.tenant_id as string,
    providerSubscriptionId: row.provider_subscription_id as string,
    catalogId: row.catalog_id as string,
    ...(row.plan_slug === null ? {} : { planSlug: row.plan_slug as string }),
    status: row.status as string,
    ...(row.current_period_end === null
      ? {}
      : { currentPeriodEnd: normalizeTimestamp(row.current_period_end) }),
    cancelAtPeriodEnd: row.cancel_at_period_end as boolean,
    version: normalizeInteger(row.version),
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

function mapEntitlementProjection(
  row: QueryResultRow,
): BillingEntitlementProjectionRecord {
  return {
    id: row.id as string,
    organizationId: row.tenant_id as string,
    providerBenefitId: row.provider_benefit_id as string,
    key: row.key as string,
    status: row.status === "active" ? "active" : "revoked",
    metadata: row.metadata as Record<string, unknown>,
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

function mapWebhookReceipt(row: QueryResultRow): BillingWebhookReceiptRecord {
  if (row.status !== "received" && row.status !== "processed" && row.status !== "failed") {
    throw new Error(`Unsupported webhook receipt status: ${String(row.status)}`);
  }
  return {
    organizationId: row.tenant_id as string,
    eventId: row.event_id as string,
    eventType: row.event_type as string,
    payloadHash: row.payload_hash as string,
    receivedAt: normalizeTimestamp(row.received_at),
    ...(row.processed_at === null
      ? {}
      : { processedAt: normalizeTimestamp(row.processed_at) }),
    status: row.status,
    ...(row.error === null ? {} : { error: row.error as string }),
  };
}

function mapPaygOrder(row: QueryResultRow): BillingPaygOrderRecord {
  if (row.currency !== "usd") {
    throw new Error(`Unsupported PAYG order currency: ${String(row.currency)}`);
  }
  return {
    id: row.id as string,
    organizationId: row.tenant_id as string,
    providerOrderId: row.provider_order_id as string,
    currency: "usd",
    paidAmountMinor: normalizeInteger(row.paid_amount_minor),
    grantedCreditMinor: normalizeInteger(row.granted_credit_minor),
    status: row.status,
    createdAt: normalizeTimestamp(row.created_at),
  };
}

function mapInvoiceProjection(row: QueryResultRow): BillingInvoiceProjectionRecord {
  if (row.currency !== "usd" || row.status !== "paid") {
    throw new Error("Stored invoice has an unsupported currency or status.");
  }
  return {
    id: row.id as string,
    organizationId: row.tenant_id as string,
    providerOrderId: row.provider_order_id as string,
    invoiceNumber: row.invoice_number as string,
    currency: row.currency,
    amountMinor: normalizeInteger(row.amount_minor),
    status: row.status,
    issuedAt: normalizeTimestamp(row.issued_at),
    metadata: row.metadata as Record<string, unknown>,
    createdAt: normalizeTimestamp(row.created_at),
  };
}

function normalizeTimestamp(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(String(value)).toISOString();
}

function mapPriceCatalog(row: QueryResultRow): BillingPriceCatalog {
  if (row.status !== "active" || row.currency !== "usd") {
    throw new Error("Stored price catalog has an unsupported status or currency.");
  }

  return {
    id: row.id as string,
    version: row.version as number,
    status: row.status,
    currency: row.currency,
    effectiveFrom: normalizeTimestamp(row.effective_from),
    checksum: row.checksum as string,
    document: row.catalog_document as Record<string, unknown>,
    approvedBy: row.approved_by as string,
    approvedAt: normalizeTimestamp(row.approved_at),
    createdAt: normalizeTimestamp(row.created_at),
  };
}

function mapLedgerEntry(row: QueryResultRow): BillingLedgerEntry {
  if (row.currency !== "usd") {
    throw new Error(`Unsupported ledger currency: ${String(row.currency)}`);
  }

  return {
    id: row.id as string,
    organizationId: row.tenant_id as string,
    idempotencyKey: row.idempotency_key as string,
    entryType: row.entry_type,
    ...(row.catalog_id === null ? {} : { catalogId: row.catalog_id as string }),
    currency: row.currency,
    ...(row.customer_amount_minor === null
      ? {}
      : { customerAmountMinor: normalizeInteger(row.customer_amount_minor) }),
    ...(row.supplier_cost_minor === null
      ? {}
      : { supplierCostMinor: normalizeInteger(row.supplier_cost_minor) }),
    quantity: normalizeInteger(row.quantity),
    unit: row.unit as string,
    occurredAt: normalizeTimestamp(row.occurred_at),
    metadata: row.metadata as Record<string, unknown>,
    createdAt: normalizeTimestamp(row.created_at),
  };
}

function mapAdjustment(row: QueryResultRow): BillingAdjustmentRecord {
  if (row.currency !== "usd" || (row.kind !== "credit" && row.kind !== "debit")) {
    throw new Error("Stored billing adjustment has unsupported data.");
  }
  return {
    id: row.id as string,
    organizationId: row.tenant_id as string,
    ledgerEntryId: row.ledger_entry_id as string,
    kind: row.kind,
    amountMinor: normalizeInteger(row.amount_minor),
    currency: row.currency,
    reason: row.reason as string,
    createdBy: row.created_by as string,
    createdAt: normalizeTimestamp(row.created_at),
  };
}

function adjustmentLedgerEntry(input: BillingAdjustmentRecord): BillingLedgerEntry {
  return {
    id: `adjustment-ledger:${input.id}`,
    organizationId: input.organizationId,
    idempotencyKey: `adjustment:${input.id}`,
    entryType: "adjustment",
    currency: "usd",
    customerAmountMinor: input.amountMinor,
    quantity: 1,
    unit: "adjustment",
    occurredAt: input.createdAt,
    metadata: {
      adjustmentId: input.id,
      originalLedgerEntryId: input.ledgerEntryId,
      kind: input.kind,
      reason: input.reason,
      createdBy: input.createdBy,
    },
    createdAt: input.createdAt,
  };
}

function normalizeInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Stored billing value is not a safe integer: ${String(value)}`);
  }
  return parsed;
}

function assertOptionalMoney(value: number | undefined, field: string) {
  if (value !== undefined) {
    assertNonNegativeSafeInteger(value, field);
  }
}

function assertNonNegativeSafeInteger(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer.`);
  }
}

function assertPositiveSafeInteger(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer.`);
  }
}

function assertApprovedAdjustment(input: BillingAdjustmentRecord) {
  assertPositiveSafeInteger(input.amountMinor, "amountMinor");
  if (input.currency !== "usd") {
    throw new Error("Billing adjustments must use USD.");
  }
  if (input.kind !== "credit" && input.kind !== "debit") {
    throw new Error("Billing adjustment kind must be credit or debit.");
  }
  if (
    input.id.trim() === "" ||
    input.organizationId.trim() === "" ||
    input.ledgerEntryId.trim() === "" ||
    input.reason.trim() === "" ||
    input.createdBy.trim() === ""
  ) {
    throw new Error("Billing adjustment approval data must be complete.");
  }
}

function isUniqueViolation(error: unknown) {
  if (error === null || typeof error !== "object") {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "23505" || (
    typeof candidate.message === "string" && candidate.message.includes("duplicate key")
  );
}

function assertIdempotentMatch(existing: BillingLedgerEntry, input: BillingLedgerEntry) {
  const normalizedInput: BillingLedgerEntry = {
    ...input,
    metadata: { ...input.metadata },
  };
  if (!isDeepStrictEqual(existing, normalizedInput)) {
    throw new Error(
      `Idempotency key ${input.idempotencyKey} already belongs to a different ledger entry.`,
    );
  }
}

function assertAdjustmentMatch(
  existing: BillingAdjustmentRecord,
  input: BillingAdjustmentRecord,
) {
  if (!isDeepStrictEqual(existing, input)) {
    throw new Error(`Adjustment ${input.id} already has different data.`);
  }
}

function assertOutboxMatch(existing: BillingOutboxEntry, input: BillingOutboxEntry) {
  if (!isDeepStrictEqual(existing, { ...input, payload: { ...input.payload } })) {
    throw new Error(`Outbox event ${input.id} already has different content.`);
  }
}

function assertPaygCreditMatch(
  existing: BillingPaygCreditEntry,
  input: BillingPaygCreditEntry,
) {
  if (!isDeepStrictEqual(existing, input)) {
    throw new Error(
      `Idempotency key ${input.idempotencyKey} already belongs to a different PAYG credit entry.`,
    );
  }
}

function assertApprovedPaygOrder(input: {
  order: BillingPaygOrderRecord;
  grant: BillingPaygCreditEntry & { entryType: "grant" };
}) {
  if (
    input.order.currency !== "usd"
    || input.order.status !== "paid"
    || input.order.paidAmountMinor !== 500
    || input.order.grantedCreditMinor !== 500
    || input.grant.amountMinor !== 500
    || input.grant.orderId !== input.order.id
    || input.grant.organizationId !== input.order.organizationId
  ) {
    throw new Error("The approved PAYG pack is exactly USD 5.00.");
  }
}

function assertPaygOrderMatch(
  existing: BillingPaygOrderRecord,
  input: BillingPaygOrderRecord,
) {
  if (!isDeepStrictEqual(existing, input)) {
    throw new Error(`Polar order ${input.providerOrderId} has different PAYG data.`);
  }
}

function assertInvoiceProjectionMatch(
  existing: BillingInvoiceProjectionRecord,
  input: BillingInvoiceProjectionRecord,
) {
  if (!isDeepStrictEqual(existing, { ...input, metadata: { ...input.metadata } })) {
    throw new Error("Invoice replay payload does not match the original order.");
  }
}

function remainingGrantForOrder(
  entries: BillingPaygCreditEntry[],
  orderId: string,
) {
  let debitRemaining = entries
    .filter((entry) => entry.entryType === "debit")
    .reduce((total, entry) => total + entry.amountMinor, 0);
  for (const grant of entries.filter((entry) => entry.entryType === "grant")) {
    const consumed = Math.min(grant.amountMinor, debitRemaining);
    debitRemaining -= consumed;
    const reversed = entries
      .filter(
        (entry) => entry.entryType === "reversal" && entry.orderId === grant.orderId,
      )
      .reduce((total, entry) => total + entry.amountMinor, 0);
    if (grant.orderId === orderId) {
      return grant.amountMinor - consumed - reversed;
    }
  }
  return 0;
}

async function insertOutboxEntry(database: Queryable, entry: BillingOutboxEntry) {
  await database.query(
    `insert into billing_outbox (
       tenant_id, id, aggregate_type, aggregate_id, event_type, payload,
       status, attempt_count, next_attempt_at, last_error, created_at, delivered_at
     ) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12)`,
    [
      entry.organizationId,
      entry.id,
      entry.aggregateType,
      entry.aggregateId,
      entry.eventType,
      JSON.stringify(entry.payload),
      entry.status,
      entry.attemptCount,
      entry.nextAttemptAt,
      entry.lastError ?? null,
      entry.createdAt,
      entry.deliveredAt ?? null,
    ],
  );
}

function assertCatalogMatch(existing: BillingPriceCatalog, input: BillingPriceCatalog) {
  const normalizedInput: BillingPriceCatalog = {
    ...input,
    document: { ...input.document },
  };
  if (!isDeepStrictEqual(existing, normalizedInput)) {
    throw new Error(`Price catalog ${input.id} is immutable.`);
  }
}

function assertCatalogDocument(value: unknown, path = "document") {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(
        `Price catalog value ${path} must be a non-negative safe integer.`,
      );
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertCatalogDocument(item, `${path}[${index}]`));
    return;
  }

  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      assertCatalogDocument(item, `${path}.${key}`);
    }
  }
}
