import { Injectable } from "@nestjs/common";

import type {
  BillingCycleEvidenceInput,
  BillingDraftInvoiceEvidence,
  BillingDraftInvoiceEvidenceSource,
  BillingPolarMeterEvidenceSource,
  BillingProviderUsageEvidenceSource,
  ExternalMeterEvidence,
} from "./billing-usage-reconciliation.service";

export interface BillingProviderUsageEvidenceReader {
  readProviderUsage(input: BillingCycleEvidenceInput): Promise<ExternalMeterEvidence | null>;
}

export interface BillingPolarMeterEvidenceReader {
  readPolarMeters(input: BillingCycleEvidenceInput): Promise<ExternalMeterEvidence | null>;
}

export interface BillingDraftInvoiceEvidenceReader {
  readDraftInvoice(input: BillingCycleEvidenceInput): Promise<BillingDraftInvoiceEvidence | null>;
}

@Injectable()
export class BillingProviderUsageEvidenceAdapter
implements BillingProviderUsageEvidenceSource {
  constructor(private readonly reader: BillingProviderUsageEvidenceReader) {}

  loadTenantCycleEvidence(input: BillingCycleEvidenceInput) {
    return this.reader.readProviderUsage(input);
  }
}

@Injectable()
export class BillingPolarMeterEvidenceAdapter
implements BillingPolarMeterEvidenceSource {
  constructor(private readonly reader: BillingPolarMeterEvidenceReader) {}

  loadTenantCycleEvidence(input: BillingCycleEvidenceInput) {
    return this.reader.readPolarMeters(input);
  }
}

@Injectable()
export class BillingDraftInvoiceEvidenceAdapter
implements BillingDraftInvoiceEvidenceSource {
  constructor(private readonly reader: BillingDraftInvoiceEvidenceReader) {}

  loadTenantCycleEvidence(input: BillingCycleEvidenceInput) {
    return this.reader.readDraftInvoice(input);
  }
}
