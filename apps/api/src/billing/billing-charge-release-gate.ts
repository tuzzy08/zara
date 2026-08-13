export interface BillingChargeReleaseRecord {
  environment: "production";
  catalogId: string;
  releaseId: string;
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  approvalExpiresAt: string;
  billingApprovalId: string;
  billingApprovalRole: string;
  billingApprovedBy: string;
  billingApprovedAt: string;
  billingApprovalExpiresAt: string;
  billingApprovalCatalogId: string;
  billingApprovalReleaseId: string;
  securityApprovalId: string;
  securityApprovalRole: string;
  securityApprovedBy: string;
  securityApprovedAt: string;
  securityApprovalExpiresAt: string;
  securityApprovalCatalogId: string;
  securityApprovalReleaseId: string;
  releaseApprovalId: string;
  releaseApprovalRole: string;
  releaseApprovedBy: string;
  releaseApprovedAt: string;
  releaseApprovalExpiresAt: string;
  releaseApprovalCatalogId: string;
  releaseApprovalReleaseId: string;
  internalCanaryEvidenceId: string;
  internalCanaryResult: string;
  internalCanaryType: string;
  internalCanaryCatalogId: string;
  internalCanaryReleaseId: string;
  internalCanaryTenantId: string;
  internalCanaryCompletedAt: string;
  internalCanaryExpiresAt: string;
  selectedTenantCanaryEvidenceId: string;
  selectedTenantCanaryResult: string;
  selectedTenantCanaryType: string;
  selectedTenantCanaryCatalogId: string;
  selectedTenantCanaryReleaseId: string;
  selectedTenantId: string;
  selectedTenantConsentId: string;
  selectedTenantCanaryApprovedEvents: Array<{
    outboxId: string;
    ledgerEntryId: string;
  }>;
  selectedTenantCanaryCompletedAt: string;
  selectedTenantCanaryExpiresAt: string;
  reconciliationEvidenceId: string;
  reconciliationResult: string;
  reconciliationCatalogId: string;
  reconciliationReleaseId: string;
  reconciliationTenantId: string;
  reconciliationCompletedAt: string;
  reconciliationExpiresAt: string;
  drillEvidenceId: string;
  drillResult: string;
  drillCatalogId: string;
  drillReleaseId: string;
  drillTenantId: string;
  drillsCompletedAt: string;
  drillsExpiresAt: string;
  deliveryStopped: boolean;
  stopReason: string | undefined;
}

export interface BillingChargeReleaseRepository {
  findProductionRelease(): Promise<BillingChargeReleaseRecord | undefined>;
}

export interface BillingChargeReleaseCheck {
  deliveryEnabled: boolean;
  catalogId: string;
  releaseId: string;
  now: string;
}

export class BillingChargeReleaseGate {
  constructor(private readonly repository: BillingChargeReleaseRepository) {}

  async assertDeliveryAllowed(input: BillingChargeReleaseCheck) {
    if (!input.deliveryEnabled) {
      return { allowed: false as const, reason: "feature_flag_disabled" as const };
    }
    const record = await this.repository.findProductionRelease();
    if (record === undefined) {
      throw new Error("No production charge-release approval is recorded.");
    }
    if (record.catalogId !== input.catalogId) {
      throw new Error("Charge-release evidence does not match the billing catalog.");
    }
    if (record.releaseId !== input.releaseId) {
      throw new Error("Charge-release evidence does not match the release candidate.");
    }
    if (record.approvalId.trim() === "" || record.approvedBy.trim() === "") {
      throw new Error("The production charge approval identity is incomplete.");
    }
    requireApproval(record, "billing", input);
    requireApproval(record, "security", input);
    requireApproval(record, "release", input);
    requireEvidenceScope({
      evidenceId: record.internalCanaryEvidenceId,
      result: record.internalCanaryResult,
      catalogId: record.internalCanaryCatalogId,
      releaseId: record.internalCanaryReleaseId,
      expectedCatalogId: input.catalogId,
      expectedReleaseId: input.releaseId,
      invalidResultMessage: "The bound internal-tenant canary did not pass.",
      invalidScopeMessage: "The bound internal-tenant canary does not match the release scope.",
    });
    if (record.internalCanaryType !== "internal") {
      throw new Error("The bound internal-tenant canary has the wrong type.");
    }
    if (record.internalCanaryTenantId.trim() === "") {
      throw new Error("The internal-tenant canary tenant is missing.");
    }
    requireEvidenceScope({
      evidenceId: record.selectedTenantCanaryEvidenceId,
      result: record.selectedTenantCanaryResult,
      catalogId: record.selectedTenantCanaryCatalogId,
      releaseId: record.selectedTenantCanaryReleaseId,
      expectedCatalogId: input.catalogId,
      expectedReleaseId: input.releaseId,
      invalidResultMessage: "The bound selected-tenant canary did not pass.",
      invalidScopeMessage: "The bound selected-tenant canary does not match the release scope.",
    });
    if (record.selectedTenantCanaryType !== "selected_tenant") {
      throw new Error("The bound selected-tenant canary has the wrong type.");
    }
    if (record.selectedTenantId.trim() === "") {
      throw new Error("The selected-tenant canary tenant is missing.");
    }
    if (record.selectedTenantConsentId.trim() === "") {
      throw new Error("The selected-tenant canary consent is missing.");
    }
    if (record.selectedTenantId === record.internalCanaryTenantId) {
      throw new Error("The selected-tenant canary must use a separate tenant.");
    }
    requireEvidenceScope({
      evidenceId: record.reconciliationEvidenceId,
      result: record.reconciliationResult === "matched" ? "passed" : record.reconciliationResult,
      catalogId: record.reconciliationCatalogId,
      releaseId: record.reconciliationReleaseId,
      expectedCatalogId: input.catalogId,
      expectedReleaseId: input.releaseId,
      invalidResultMessage: "The bound reconciliation did not pass.",
      invalidScopeMessage: "The bound reconciliation does not match the release scope.",
    });
    if (record.reconciliationTenantId !== record.selectedTenantId) {
      throw new Error("The bound reconciliation does not match the selected tenant.");
    }
    requireEvidenceScope({
      evidenceId: record.drillEvidenceId,
      result: record.drillResult,
      catalogId: record.drillCatalogId,
      releaseId: record.drillReleaseId,
      expectedCatalogId: input.catalogId,
      expectedReleaseId: input.releaseId,
      invalidResultMessage: "The bound drill report did not pass.",
      invalidScopeMessage: "The bound drill report does not match the release scope.",
    });
    if (record.drillTenantId !== record.selectedTenantId) {
      throw new Error("The bound drill report does not match the selected tenant.");
    }
    if (record.deliveryStopped) {
      throw new Error(
        `Charge delivery is stopped: ${record.stopReason ?? "No stop reason was recorded."}`,
      );
    }
    requireCurrent(record.approvedAt, record.approvalExpiresAt, input.now,
      "The production charge approval is not current.");
    requireCurrent(
      record.internalCanaryCompletedAt,
      record.internalCanaryExpiresAt,
      input.now,
      "The internal-tenant canary is not current.",
    );
    requireCurrent(
      record.selectedTenantCanaryCompletedAt,
      record.selectedTenantCanaryExpiresAt,
      input.now,
      "The selected-tenant canary is not current.",
    );
    requireCurrent(
      record.reconciliationCompletedAt,
      record.reconciliationExpiresAt,
      input.now,
      "The successful reconciliation is not current.",
    );
    requireCurrent(
      record.drillsCompletedAt,
      record.drillsExpiresAt,
      input.now,
      "The charge release drills are not current.",
    );
    return { allowed: true as const, reason: "approved" as const };
  }
}

function requireApproval(
  record: BillingChargeReleaseRecord,
  role: "billing" | "security" | "release",
  check: BillingChargeReleaseCheck,
) {
  const approval = role === "billing" ? {
    id: record.billingApprovalId,
    role: record.billingApprovalRole,
    approvedBy: record.billingApprovedBy,
    approvedAt: record.billingApprovedAt,
    expiresAt: record.billingApprovalExpiresAt,
    catalogId: record.billingApprovalCatalogId,
    releaseId: record.billingApprovalReleaseId,
  } : role === "security" ? {
    id: record.securityApprovalId,
    role: record.securityApprovalRole,
    approvedBy: record.securityApprovedBy,
    approvedAt: record.securityApprovedAt,
    expiresAt: record.securityApprovalExpiresAt,
    catalogId: record.securityApprovalCatalogId,
    releaseId: record.securityApprovalReleaseId,
  } : {
    id: record.releaseApprovalId,
    role: record.releaseApprovalRole,
    approvedBy: record.releaseApprovedBy,
    approvedAt: record.releaseApprovedAt,
    expiresAt: record.releaseApprovalExpiresAt,
    catalogId: record.releaseApprovalCatalogId,
    releaseId: record.releaseApprovalReleaseId,
  };
  if (approval.id.trim() === "" || approval.approvedBy.trim() === "" || approval.role !== role) {
    throw new Error(`The ${role} approval is missing or invalid.`);
  }
  if (approval.catalogId !== check.catalogId || approval.releaseId !== check.releaseId) {
    throw new Error(`The ${role} approval does not match the release scope.`);
  }
  requireCurrent(
    approval.approvedAt,
    approval.expiresAt,
    check.now,
    `The ${role} approval is not current.`,
  );
}

function requireEvidenceScope(input: {
  evidenceId: string;
  result: string;
  catalogId: string;
  releaseId: string;
  expectedCatalogId: string;
  expectedReleaseId: string;
  invalidResultMessage: string;
  invalidScopeMessage: string;
}) {
  if (input.evidenceId.trim() === "" || input.result !== "passed") {
    throw new Error(input.invalidResultMessage);
  }
  if (
    input.catalogId !== input.expectedCatalogId
    || input.releaseId !== input.expectedReleaseId
  ) {
    throw new Error(input.invalidScopeMessage);
  }
}

export class BillingChargeDeliveryGuard {
  constructor(
    private readonly gate: BillingChargeReleaseGate,
    private readonly config: {
      deliveryEnabled: boolean;
      catalogId: string;
      releaseId: string;
    },
  ) {}

  assertDeliveryAllowed(now: string) {
    return this.gate.assertDeliveryAllowed({ ...this.config, now });
  }
}

function requireCurrent(
  completedAt: string,
  expiresAt: string,
  now: string,
  message: string,
) {
  const nowMs = Date.parse(now);
  const completedMs = Date.parse(completedAt);
  const expiresMs = Date.parse(expiresAt);
  if (
    !Number.isFinite(nowMs)
    || !Number.isFinite(completedMs)
    || !Number.isFinite(expiresMs)
    || completedMs > nowMs
    || expiresMs <= nowMs
  ) {
    throw new Error(message);
  }
}
