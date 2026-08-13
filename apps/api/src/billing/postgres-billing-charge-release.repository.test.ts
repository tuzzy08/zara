import { newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PostgresBillingChargeReleaseRepository } from "./postgres-billing-charge-release.repository";

describe("PostgresBillingChargeReleaseRepository", () => {
  let pool: InstanceType<ReturnType<ReturnType<typeof newDb>["adapters"]["createPg"]>["Pool"]>;

  beforeEach(() => {
    const database = newDb();
    database.public.none(`
      create table billing_charge_release_approvals (
        id text primary key, approval_role text not null, catalog_id text not null,
        release_id text not null, approved_by text not null,
        approved_at timestamptz not null, expires_at timestamptz not null
      );
      create table billing_release_canary_reports (
        tenant_id text not null, id text not null, result text not null, canary_type text not null,
        catalog_id text not null, release_id text not null, tenant_consent_id text,
        completed_at timestamptz not null, valid_until timestamptz not null, report jsonb not null,
        primary key (tenant_id,id)
      );
      create table billing_reconciliation_reports (
        tenant_id text not null, id text not null, status text not null,
        catalog_id text not null, release_id text not null,
        created_at timestamptz not null, valid_until timestamptz not null,
        primary key (tenant_id,id)
      );
      create table billing_release_drill_reports (
        tenant_id text not null, id text not null, status text not null,
        catalog_id text not null, release_id text not null,
        executed_at timestamptz not null, valid_until timestamptz not null,
        primary key (tenant_id,id)
      );
      create table billing_charge_release_controls (
        environment text primary key, catalog_id text not null, release_id text not null,
        approval_id text not null, approved_by text not null,
        approved_at timestamptz not null, approval_expires_at timestamptz not null,
        internal_canary_completed_at timestamptz not null,
        internal_canary_expires_at timestamptz not null,
        selected_tenant_canary_completed_at timestamptz not null,
        selected_tenant_canary_expires_at timestamptz not null,
        reconciliation_completed_at timestamptz not null,
        reconciliation_expires_at timestamptz not null,
        drills_completed_at timestamptz not null, drills_expires_at timestamptz not null,
        delivery_stopped boolean not null default true, stop_reason text,
        stopped_at timestamptz, updated_at timestamptz not null,
        billing_approval_id text not null, security_approval_id text not null,
        release_approval_id text not null,
        internal_canary_tenant_id text not null, internal_canary_evidence_id text not null,
        selected_tenant_id text not null, selected_tenant_canary_evidence_id text not null,
        reconciliation_tenant_id text not null, reconciliation_evidence_id text not null,
        drill_tenant_id text not null, drill_evidence_id text not null
      )
    `);
    const adapter = database.adapters.createPg();
    pool = new adapter.Pool();
  });

  afterEach(async () => pool.end());

  it("reads the persisted production approval and evidence without a default", async () => {
    const repository = new PostgresBillingChargeReleaseRepository(pool);

    await expect(repository.findProductionRelease()).resolves.toBeUndefined();
    await seedRelease(pool);

    await expect(repository.findProductionRelease()).resolves.toMatchObject({
      environment: "production",
      catalogId: "catalog-v1",
      releaseId: "release-248",
      approvalId: "approval-248",
      billingApprovalId: "approval-billing",
      securityApprovalId: "approval-security",
      releaseApprovalId: "approval-release",
      internalCanaryEvidenceId: "canary-internal",
      selectedTenantCanaryEvidenceId: "canary-selected",
      selectedTenantConsentId: "consent-248",
      reconciliationEvidenceId: "reconciliation-248",
      reconciliationResult: "matched",
      drillEvidenceId: "drills-248",
      drillResult: "passed",
      deliveryStopped: false,
    });
  });

  it("records an emergency stop without deleting billing facts", async () => {
    const repository = new PostgresBillingChargeReleaseRepository(pool);
    await seedRelease(pool);

    await repository.stopDelivery({
      reason: "Reconciliation mismatch.",
      stoppedAt: "2026-08-12T12:00:00.000Z",
    });

    await expect(repository.findProductionRelease()).resolves.toMatchObject({
      deliveryStopped: true,
      stopReason: "Reconciliation mismatch.",
    });
  });
});

async function seedRelease(pool: { query(sql: string): Promise<unknown> }) {
  await pool.query(`
    insert into billing_charge_release_approvals values
      ('approval-billing','billing','catalog-v1','release-248','billing-owner','2026-08-12T10:00:00Z','2026-08-13T10:00:00Z'),
      ('approval-security','security','catalog-v1','release-248','security-owner','2026-08-12T10:01:00Z','2026-08-13T10:01:00Z'),
      ('approval-release','release','catalog-v1','release-248','release-owner','2026-08-12T10:02:00Z','2026-08-13T10:02:00Z');
    insert into billing_release_canary_reports values
      ('tenant-internal','canary-internal','passed','internal','catalog-v1','release-248',null,'2026-08-12T10:05:00Z','2026-08-13T10:05:00Z','{}'),
      ('tenant-selected','canary-selected','passed','selected_tenant','catalog-v1','release-248','consent-248','2026-08-12T10:10:00Z','2026-08-13T10:10:00Z','{"approvedChargeEvents":[{"outboxId":"outbox-1","ledgerEntryId":"ledger-1"}]}');
    insert into billing_reconciliation_reports values
      ('tenant-selected','reconciliation-248','matched','catalog-v1','release-248','2026-08-12T10:15:00Z','2026-08-13T10:15:00Z');
    insert into billing_release_drill_reports values
      ('tenant-selected','drills-248','passed','catalog-v1','release-248','2026-08-12T10:20:00Z','2026-08-13T10:20:00Z');
    insert into billing_charge_release_controls values (
      'production','catalog-v1','release-248','approval-248','billing-owner@zara.ai',
      '2026-08-12T10:00:00Z','2026-08-13T10:00:00Z',
      '2026-08-12T10:05:00Z','2026-08-13T10:05:00Z',
      '2026-08-12T10:10:00Z','2026-08-13T10:10:00Z',
      '2026-08-12T10:15:00Z','2026-08-13T10:15:00Z',
      '2026-08-12T10:20:00Z','2026-08-13T10:20:00Z',
      false,null,null,'2026-08-12T10:20:00Z',
      'approval-billing','approval-security','approval-release',
      'tenant-internal','canary-internal','tenant-selected','canary-selected',
      'tenant-selected','reconciliation-248','tenant-selected','drills-248'
    );
  `);
}
