import type {
  BillingProviderEvidenceReport,
  BillingProviderEvidenceSource,
} from "./billing-production-reconciliation-evidence";
import type { BillingCycleEvidenceInput } from "./billing-usage-reconciliation.service";

const MISSING_TERMINATION_EVIDENCE =
  "AssemblyAI billing evidence is unavailable: Zara does not persist provider Termination session_duration_seconds with durable tenant and session scope.";

/**
 * AssemblyAI documents the provider Termination session_duration_seconds value
 * as the streaming billing source. Zara does not yet persist that provider event.
 * This source must fail closed instead of using Zara-measured runtime seconds.
 */
export class AssemblyAiBillingEvidenceSource implements BillingProviderEvidenceSource {
  collectCycle(input: BillingCycleEvidenceInput): Promise<BillingProviderEvidenceReport> {
    void input;
    return Promise.reject(new Error(MISSING_TERMINATION_EVIDENCE));
  }
}
