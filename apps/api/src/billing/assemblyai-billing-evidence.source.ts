import type {
  BillingProviderEvidenceReport,
  BillingProviderEvidenceSource,
} from "./billing-production-reconciliation-evidence";
import type { BillingCycleEvidenceInput } from "./billing-usage-reconciliation.service";

const UNQUALIFIED_DURATION_EVIDENCE =
  "AssemblyAI billing evidence is unavailable: production duration coverage and supplier costs are not qualified.";

/**
 * AssemblyAI documents the provider Termination session_duration_seconds value
 * as the streaming billing source. Local sandbox capture does not qualify
 * standard PSTN coverage, supplier costs, or a completed production cycle.
 * This source must fail closed instead of using Zara-measured runtime seconds.
 */
export class AssemblyAiBillingEvidenceSource implements BillingProviderEvidenceSource {
  collectCycle(input: BillingCycleEvidenceInput): Promise<BillingProviderEvidenceReport> {
    void input;
    return Promise.reject(new Error(UNQUALIFIED_DURATION_EVIDENCE));
  }
}
