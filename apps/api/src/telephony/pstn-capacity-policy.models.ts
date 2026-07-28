import type {
  PstnAdmissionReasonCode,
  PstnCallAdmissionLimits,
  PstnCallAdmissionTokenBucket,
} from "./pstn-call-admission";
import type { PstnAdmissionRuntimePath } from "./pstn-admission-config";

export type PstnCapacityTelemetryStatus = "fresh" | "stale" | "unavailable";
export type PstnCapacityReductionScope =
  | "global"
  | "provider"
  | "provider_account"
  | "tenant"
  | "runtime"
  | "worker";

export interface PstnCapacityTemporaryReduction {
  id: string;
  scope: PstnCapacityReductionScope;
  key?: string | undefined;
  maxConcurrentCalls: number;
  startsAt: string;
  expiresAt: string;
  reason: string;
}

export interface PstnCapacityPolicy {
  schemaVersion: 1;
  version: number;
  limits: {
    global: number;
    provider: number;
    tenantDefault: number;
    worker: number;
    runtime: Record<PstnAdmissionRuntimePath, number>;
  };
  cps: {
    global: PstnCallAdmissionTokenBucket;
    providerAccount: PstnCallAdmissionTokenBucket;
  };
  providerQuotas: Record<string, number>;
  providerAccountQuotas: Record<string, number>;
  tenantAllowances: Record<string, number>;
  workerLimits: Record<string, number>;
  temporaryReductions: PstnCapacityTemporaryReduction[];
  updatedBy: string;
  updatedAt: string;
}

export interface PstnCapacityPolicyAuditEntry {
  id: string;
  policyVersion: number;
  actorUserId: string;
  reason: string;
  before: PstnCapacityPolicy;
  after: PstnCapacityPolicy;
  occurredAt: string;
}

export interface UpdatePstnCapacityPolicyInput {
  expectedVersion: number;
  reason: string;
  limits?: Partial<{
    global: number;
    provider: number;
    tenantDefault: number;
    worker: number;
    runtime: Partial<Record<PstnAdmissionRuntimePath, number>>;
  }> | undefined;
  cps?: Partial<{
    global: Partial<PstnCallAdmissionTokenBucket>;
    providerAccount: Partial<PstnCallAdmissionTokenBucket>;
  }> | undefined;
  providerQuotas?: Record<string, number> | undefined;
  providerAccountQuotas?: Record<string, number> | undefined;
  tenantAllowances?: Record<string, number> | undefined;
  workerLimits?: Record<string, number> | undefined;
  temporaryReductions?: PstnCapacityTemporaryReduction[] | undefined;
}

export interface PstnResolvedAdmissionPolicy {
  policyVersion: number;
  limits: PstnCallAdmissionLimits;
  cps: {
    global: PstnCallAdmissionTokenBucket;
    providerAccount: PstnCallAdmissionTokenBucket;
  };
  activeReductionIds: string[];
}

export interface PstnTenantCapacityRejection {
  occurredAt: string;
  reasonCode: PstnAdmissionReasonCode;
}

export interface PstnTenantCapacityUsage {
  activeUse: number | null;
  telemetryStatus: PstnCapacityTelemetryStatus;
  recentRejections: PstnTenantCapacityRejection[];
}

export interface PstnTenantCapacityPosture {
  capturedAt: string;
  telemetryStatus: PstnCapacityTelemetryStatus;
  effectiveAllowance: number;
  activeUse: number | null;
  remainingCapacity: number | null;
  saturated: boolean | null;
  operationalState: "healthy" | "degraded" | "saturated" | "unavailable";
  recentRejections: Array<{
    occurredAt: string;
    code: "capacity_reached" | "provider_unavailable" | "retry_later";
    message: string;
  }>;
}
