import { createHash } from "node:crypto";

import type {
  BillingProviderEvidenceReport,
  BillingProviderEvidenceSource,
} from "./billing-production-reconciliation-evidence";
import type { BillingCycleEvidenceInput } from "./billing-usage-reconciliation.service";
import type {
  OpenAiOrganizationCostFact,
  OpenAiOrganizationUsageFact,
  OpenAiProjectBillingClient,
} from "./openai-organization-billing.client";

export interface OpenAiTenantProjectMappingReader {
  getProjectId(input: BillingCycleEvidenceInput): Promise<string | null>;
}

export class OpenAiDirectBillingEvidenceSource implements BillingProviderEvidenceSource {
  constructor(
    private readonly mappings: OpenAiTenantProjectMappingReader,
    private readonly client: OpenAiProjectBillingClient,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async collectCycle(input: BillingCycleEvidenceInput): Promise<BillingProviderEvidenceReport | null> {
    const collectedAt = this.now();
    const cycleStart = Date.parse(input.cycleStartsAt);
    const cycleEnd = Date.parse(input.cycleEndsAt);
    const collectionTime = Date.parse(collectedAt);
    if (!Number.isFinite(cycleStart) || !Number.isFinite(cycleEnd) || cycleStart >= cycleEnd) {
      throw new Error("OpenAI billing evidence cycle is invalid.");
    }
    if (!Number.isFinite(collectionTime) || collectionTime < cycleEnd) {
      throw new Error("OpenAI billing evidence cycle is not complete.");
    }
    const projectId = (await this.mappings.getProjectId({
      ...input,
    }))?.trim();
    if (!projectId) return null;
    const evidence = await this.client.getProjectCycleEvidence({
      projectId,
      cycleStartsAt: input.cycleStartsAt,
      cycleEndsAt: input.cycleEndsAt,
    });
    const facts = [
      ...evidence.usage.map((fact) => usageFact(fact)),
      ...evidence.costs.map((fact) => costFact(fact)),
    ];
    const sourceDigest = digest({ input, projectId, facts });
    return {
      provider: "openai",
      evidenceKind: "runtime_usage",
      sourceReportId: `openai-organization:${sourceDigest}`,
      payload: {
        // The official organization APIs return token usage and costs. They do
        // not return realtime duration. Do not convert tokens to billed seconds.
        quantities: {},
        projectId,
        source: {
          kind: "organization_usage_and_costs",
          generatedAt: collectedAt,
        },
        facts,
      },
    };
  }
}

function usageFact(fact: OpenAiOrganizationUsageFact) {
  return {
    id: `openai-usage:${digest(fact)}`,
    kind: "usage" as const,
    ...fact,
  };
}

function costFact(fact: OpenAiOrganizationCostFact) {
  return {
    id: `openai-cost:${digest(fact)}`,
    kind: "cost" as const,
    ...fact,
  };
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
