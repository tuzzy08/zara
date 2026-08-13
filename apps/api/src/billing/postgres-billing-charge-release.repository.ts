import type { Pool } from "pg";

import type {
  BillingChargeReleaseRecord,
  BillingChargeReleaseRepository,
} from "./billing-charge-release-gate";

interface ReleaseRow {
  environment: string;
  catalog_id: string;
  release_id: string;
  approval_id: string;
  approved_by: string;
  approved_at: Date | string;
  approval_expires_at: Date | string;
  drills_completed_at: Date | string;
  drills_expires_at: Date | string;
  delivery_stopped: boolean;
  stop_reason: string | null;
  billing_approval_id: string;
  billing_approval_role: string;
  billing_approved_by: string;
  billing_approved_at: Date | string;
  billing_approval_expires_at: Date | string;
  billing_approval_catalog_id: string;
  billing_approval_release_id: string;
  security_approval_id: string;
  security_approval_role: string;
  security_approved_by: string;
  security_approved_at: Date | string;
  security_approval_expires_at: Date | string;
  security_approval_catalog_id: string;
  security_approval_release_id: string;
  release_approval_id: string;
  release_approval_role: string;
  release_approved_by: string;
  release_approved_at: Date | string;
  release_approval_expires_at: Date | string;
  release_approval_catalog_id: string;
  release_approval_release_id: string;
  internal_canary_evidence_id: string;
  internal_canary_result: string;
  internal_canary_type: string;
  internal_canary_catalog_id: string;
  internal_canary_release_id: string;
  internal_canary_tenant_id: string;
  internal_canary_completed_at: Date | string;
  internal_canary_expires_at: Date | string;
  selected_tenant_canary_evidence_id: string;
  selected_tenant_canary_result: string;
  selected_tenant_canary_type: string;
  selected_tenant_canary_catalog_id: string;
  selected_tenant_canary_release_id: string;
  selected_tenant_id: string;
  selected_tenant_consent_id: string;
  selected_tenant_report: unknown;
  selected_tenant_canary_completed_at: Date | string;
  selected_tenant_canary_expires_at: Date | string;
  reconciliation_evidence_id: string;
  reconciliation_result: string;
  reconciliation_catalog_id: string;
  reconciliation_release_id: string;
  reconciliation_tenant_id: string;
  reconciliation_completed_at: Date | string;
  reconciliation_expires_at: Date | string;
  drill_evidence_id: string;
  drill_result: string;
  drill_catalog_id: string;
  drill_release_id: string;
  drill_tenant_id: string;
  drill_completed_at: Date | string;
  drill_expires_at: Date | string;
}

export class PostgresBillingChargeReleaseRepository
  implements BillingChargeReleaseRepository
{
  constructor(private readonly pool: Pick<Pool, "query">) {}

  async findProductionRelease(): Promise<BillingChargeReleaseRecord | undefined> {
    const result = await this.pool.query<ReleaseRow>(`
      select control.*,
        billing.id billing_approval_id, billing.approval_role billing_approval_role,
        billing.approved_by billing_approved_by, billing.approved_at billing_approved_at,
        billing.expires_at billing_approval_expires_at,
        billing.catalog_id billing_approval_catalog_id,
        billing.release_id billing_approval_release_id,
        security.id security_approval_id, security.approval_role security_approval_role,
        security.approved_by security_approved_by, security.approved_at security_approved_at,
        security.expires_at security_approval_expires_at,
        security.catalog_id security_approval_catalog_id,
        security.release_id security_approval_release_id,
        release.id release_approval_id, release.approval_role release_approval_role,
        release.approved_by release_approved_by, release.approved_at release_approved_at,
        release.expires_at release_approval_expires_at,
        release.catalog_id release_approval_catalog_id,
        release.release_id release_approval_release_id,
        internal.id internal_canary_evidence_id, internal.result internal_canary_result,
        internal.canary_type internal_canary_type,
        internal.catalog_id internal_canary_catalog_id, internal.release_id internal_canary_release_id,
        internal.tenant_id internal_canary_tenant_id, internal.completed_at internal_canary_completed_at,
        internal.valid_until internal_canary_expires_at,
        selected.id selected_tenant_canary_evidence_id, selected.result selected_tenant_canary_result,
        selected.canary_type selected_tenant_canary_type,
        selected.catalog_id selected_tenant_canary_catalog_id,
        selected.release_id selected_tenant_canary_release_id,
        selected.tenant_id selected_tenant_id, selected.tenant_consent_id selected_tenant_consent_id,
        selected.report selected_tenant_report,
        selected.completed_at selected_tenant_canary_completed_at,
        selected.valid_until selected_tenant_canary_expires_at,
        reconciliation.id reconciliation_evidence_id, reconciliation.status reconciliation_result,
        reconciliation.catalog_id reconciliation_catalog_id,
        reconciliation.release_id reconciliation_release_id,
        reconciliation.tenant_id reconciliation_tenant_id,
        reconciliation.created_at reconciliation_completed_at,
        reconciliation.valid_until reconciliation_expires_at,
        drill.id drill_evidence_id, drill.status drill_result,
        drill.catalog_id drill_catalog_id, drill.release_id drill_release_id,
        drill.tenant_id drill_tenant_id, drill.executed_at drill_completed_at,
        drill.valid_until drill_expires_at
      from billing_charge_release_controls control
      join billing_charge_release_approvals billing on billing.id = control.billing_approval_id
      join billing_charge_release_approvals security on security.id = control.security_approval_id
      join billing_charge_release_approvals release on release.id = control.release_approval_id
      join billing_release_canary_reports internal
        on internal.tenant_id = control.internal_canary_tenant_id
       and internal.id = control.internal_canary_evidence_id
      join billing_release_canary_reports selected
        on selected.tenant_id = control.selected_tenant_id
       and selected.id = control.selected_tenant_canary_evidence_id
      join billing_reconciliation_reports reconciliation
        on reconciliation.tenant_id = control.reconciliation_tenant_id
       and reconciliation.id = control.reconciliation_evidence_id
      join billing_release_drill_reports drill
        on drill.tenant_id = control.drill_tenant_id
       and drill.id = control.drill_evidence_id
      where control.environment = 'production'
    `);
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return {
      environment: "production",
      catalogId: row.catalog_id,
      releaseId: row.release_id,
      approvalId: row.approval_id,
      approvedBy: row.approved_by,
      approvedAt: iso(row.approved_at),
      approvalExpiresAt: iso(row.approval_expires_at),
      billingApprovalId: row.billing_approval_id,
      billingApprovalRole: row.billing_approval_role,
      billingApprovedBy: row.billing_approved_by,
      billingApprovedAt: iso(row.billing_approved_at),
      billingApprovalExpiresAt: iso(row.billing_approval_expires_at),
      billingApprovalCatalogId: row.billing_approval_catalog_id,
      billingApprovalReleaseId: row.billing_approval_release_id,
      securityApprovalId: row.security_approval_id,
      securityApprovalRole: row.security_approval_role,
      securityApprovedBy: row.security_approved_by,
      securityApprovedAt: iso(row.security_approved_at),
      securityApprovalExpiresAt: iso(row.security_approval_expires_at),
      securityApprovalCatalogId: row.security_approval_catalog_id,
      securityApprovalReleaseId: row.security_approval_release_id,
      releaseApprovalId: row.release_approval_id,
      releaseApprovalRole: row.release_approval_role,
      releaseApprovedBy: row.release_approved_by,
      releaseApprovedAt: iso(row.release_approved_at),
      releaseApprovalExpiresAt: iso(row.release_approval_expires_at),
      releaseApprovalCatalogId: row.release_approval_catalog_id,
      releaseApprovalReleaseId: row.release_approval_release_id,
      internalCanaryEvidenceId: row.internal_canary_evidence_id,
      internalCanaryResult: row.internal_canary_result,
      internalCanaryType: row.internal_canary_type,
      internalCanaryCatalogId: row.internal_canary_catalog_id,
      internalCanaryReleaseId: row.internal_canary_release_id,
      internalCanaryTenantId: row.internal_canary_tenant_id,
      internalCanaryCompletedAt: iso(row.internal_canary_completed_at),
      internalCanaryExpiresAt: iso(row.internal_canary_expires_at),
      selectedTenantCanaryEvidenceId: row.selected_tenant_canary_evidence_id,
      selectedTenantCanaryResult: row.selected_tenant_canary_result,
      selectedTenantCanaryType: row.selected_tenant_canary_type,
      selectedTenantCanaryCatalogId: row.selected_tenant_canary_catalog_id,
      selectedTenantCanaryReleaseId: row.selected_tenant_canary_release_id,
      selectedTenantId: row.selected_tenant_id,
      selectedTenantConsentId: row.selected_tenant_consent_id,
      selectedTenantCanaryApprovedEvents: approvedEvents(row.selected_tenant_report),
      selectedTenantCanaryCompletedAt: iso(row.selected_tenant_canary_completed_at),
      selectedTenantCanaryExpiresAt: iso(row.selected_tenant_canary_expires_at),
      reconciliationEvidenceId: row.reconciliation_evidence_id,
      reconciliationResult: row.reconciliation_result,
      reconciliationCatalogId: row.reconciliation_catalog_id,
      reconciliationReleaseId: row.reconciliation_release_id,
      reconciliationTenantId: row.reconciliation_tenant_id,
      reconciliationCompletedAt: iso(row.reconciliation_completed_at),
      reconciliationExpiresAt: iso(row.reconciliation_expires_at),
      drillEvidenceId: row.drill_evidence_id,
      drillResult: row.drill_result,
      drillCatalogId: row.drill_catalog_id,
      drillReleaseId: row.drill_release_id,
      drillTenantId: row.drill_tenant_id,
      drillsCompletedAt: iso(row.drill_completed_at),
      drillsExpiresAt: iso(row.drill_expires_at),
      deliveryStopped: row.delivery_stopped,
      stopReason: row.stop_reason ?? undefined,
    };
  }

  async stopDelivery(input: { reason: string; stoppedAt: string }) {
    const reason = input.reason.trim();
    if (reason.length === 0) throw new Error("A charge-stop reason is required.");
    const result = await this.pool.query(`
      update billing_charge_release_controls
      set delivery_stopped = true, stop_reason = $1, stopped_at = $2, updated_at = $2
      where environment = 'production'
    `, [reason, input.stoppedAt]);
    if (result.rowCount !== 1) {
      throw new Error("No production charge-release control exists to stop.");
    }
  }
}

function iso(value: Date | string) {
  return new Date(value).toISOString();
}

function approvedEvents(value: unknown) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  const events = (value as Record<string, unknown>).approvedChargeEvents;
  if (!Array.isArray(events)) return [];
  return events.flatMap((event) => {
    if (event === null || typeof event !== "object" || Array.isArray(event)) return [];
    const record = event as Record<string, unknown>;
    return typeof record.outboxId === "string" && record.outboxId.trim() !== ""
      && typeof record.ledgerEntryId === "string" && record.ledgerEntryId.trim() !== ""
      ? [{ outboxId: record.outboxId, ledgerEntryId: record.ledgerEntryId }]
      : [];
  });
}
