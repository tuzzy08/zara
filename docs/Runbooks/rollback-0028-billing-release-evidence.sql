BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM billing_charge_release_approvals)
    OR EXISTS (SELECT 1 FROM billing_release_canary_reports)
    OR EXISTS (SELECT 1 FROM billing_reconciliation_reports)
    OR EXISTS (SELECT 1 FROM billing_release_drill_reports)
    OR EXISTS (SELECT 1 FROM billing_outbox WHERE charge_release_id is not null)
  THEN
    RAISE EXCEPTION 'Rollback 0028 blocked: release evidence or promoted charge facts exist.';
  END IF;
END
$$;

ALTER TABLE billing_charge_release_controls
  DROP CONSTRAINT billing_charge_release_controls_billing_approval_id_billing_charge_release_approvals_id_fk,
  DROP CONSTRAINT billing_charge_release_controls_security_approval_id_billing_charge_release_approvals_id_fk,
  DROP CONSTRAINT billing_charge_release_controls_release_approval_id_billing_charge_release_approvals_id_fk,
  DROP CONSTRAINT billing_charge_release_controls_internal_canary_fk,
  DROP CONSTRAINT billing_charge_release_controls_selected_canary_fk,
  DROP CONSTRAINT billing_charge_release_controls_reconciliation_fk,
  DROP CONSTRAINT billing_charge_release_controls_drill_fk,
  DROP COLUMN billing_approval_id,
  DROP COLUMN security_approval_id,
  DROP COLUMN release_approval_id,
  DROP COLUMN internal_canary_tenant_id,
  DROP COLUMN internal_canary_evidence_id,
  DROP COLUMN selected_tenant_id,
  DROP COLUMN selected_tenant_canary_evidence_id,
  DROP COLUMN reconciliation_tenant_id,
  DROP COLUMN reconciliation_evidence_id,
  DROP COLUMN drill_tenant_id,
  DROP COLUMN drill_evidence_id;

ALTER TABLE billing_outbox
  DROP CONSTRAINT billing_outbox_charge_promotion_check,
  DROP COLUMN charge_release_id,
  DROP COLUMN charge_promoted_at;

DROP TABLE billing_release_drill_reports;
DROP TABLE billing_release_canary_reports;
DROP TABLE billing_reconciliation_reports;
DROP TABLE billing_charge_release_approvals;

COMMIT;
