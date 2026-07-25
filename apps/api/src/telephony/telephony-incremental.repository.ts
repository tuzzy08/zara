import { createHash } from "node:crypto";

import type {
  CompiledRuntimeManifest,
  ImportedTelephonyPhoneNumber,
  TelephonyCallLifecycleStage,
  TelephonyCallLifecycleState,
  TelephonyCallControlEvent,
  TelephonyExecutionCommand,
  TelephonyExecutionSession,
  TelephonyExecutionSessionStatus,
  TelephonyConnection,
  TelephonyHealthStatus,
  TelephonyPhoneTestResult,
  TelephonyProviderHeartbeat,
  PstnRuntimePath,
  RuntimeProfileId,
} from "@zara/core";
import type { PremiumRealtimeConversationPolicy } from "../premium-realtime-policy/premium-realtime-conversation-policy.models";

import type {
  TelephonyDispatchRecord,
  TelephonyHealthCheck,
  TelephonyMediaStreamTokenRecord,
  TelephonyWebhookEvent,
} from "./telephony.models";

export type TelephonyInsertOutcome = { outcome: "inserted" | "existing" | "conflict" };
export type TelephonyWebhookInsertOutcome =
  | { outcome: "inserted" | "existing"; receivedAt: string }
  | { outcome: "conflict" };

export type TelephonyCallSetupOutcome =
  | { outcome: "inserted"; mediaToken: "created" }
  | { outcome: "existing"; mediaToken: "retained" | "rotated" }
  | { outcome: "conflict" };

export type TelephonyCallExecutionOutcome =
  | { outcome: "inserted" | "existing" | "conflict" }
  | { outcome: "blocked"; reasonCode: "outbound_abuse_blocked" };

export interface IncrementalTelephonyMediaToken extends TelephonyMediaStreamTokenRecord {
  tenantId: string;
}

export interface CreateTelephonyCallExecutionInput {
  dispatch: TelephonyDispatchRecord;
  executionSession: TelephonyExecutionSession & {
    lifecycleState: TelephonyCallLifecycleState;
  };
  executionCommands: TelephonyExecutionCommand[];
}

export interface CreateTelephonyCallSetupInput extends CreateTelephonyCallExecutionInput {
  mediaToken: IncrementalTelephonyMediaToken;
  premiumDispatchSnapshot?: TelephonyPremiumDispatchSnapshot | undefined;
}

export interface TelephonyPremiumDispatchSnapshot {
  schemaVersion: 1;
  tenantId: string;
  workspaceId: string;
  callSessionId: string;
  dispatchId: string;
  publishedVersionId: string;
  resolvedManifest: CompiledRuntimeManifest;
  resolvedConversationPolicy: PremiumRealtimeConversationPolicy;
  workerTarget: {
    workerId: string;
    releaseId: string;
    mediaStreamBaseUrl: string;
  };
  createdAt: string;
  checksum: string;
}

export function computeTelephonyPremiumDispatchSnapshotChecksum(
  snapshot: Omit<TelephonyPremiumDispatchSnapshot, "checksum">,
) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalizeSnapshotJson(snapshot)))
    .digest("hex");
}

function canonicalizeSnapshotJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeSnapshotJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalizeSnapshotJson(entry)]),
  );
}

export interface LoadTelephonyCallMutationContextInput {
  tenantId: string;
  callSessionId: string;
}

export interface TelephonyCallMutationContext {
  dispatch: TelephonyDispatchRecord;
  executionSession: TelephonyExecutionSession & {
    lifecycleState: TelephonyCallLifecycleState;
  };
  version: number;
}

export type TelephonyCallMutationContextOutcome =
  | { outcome: "found"; context: TelephonyCallMutationContext }
  | { outcome: "not_found" };

export interface TelephonyExecutionSessionMutation {
  status: TelephonyExecutionSessionStatus;
  outageMode: TelephonyExecutionSession["outageMode"] | null;
  fallbackTarget: string | null;
  diagnostics: string[];
  updatedAt: string;
}

export interface RecordTelephonyCallControlMutationInput {
  tenantId: string;
  callSessionId: string;
  dispatchId: string;
  expectedVersion: number;
  expectedStatus: TelephonyExecutionSessionStatus;
  session: TelephonyExecutionSessionMutation;
  event: TelephonyCallControlEvent;
  executionCommands: TelephonyExecutionCommand[];
  retryCount?: number | undefined;
}

export type TelephonyCallControlMutationOutcome = {
  outcome: "updated" | "existing" | "conflict" | "not_found";
  version?: number | undefined;
};

export interface UpdateTelephonyPhoneTestProjectionInput {
  tenantId: string;
  phoneNumberId: string;
  expectedTestRoute: ImportedTelephonyPhoneNumber["testRoute"] | null;
  expectedPhoneTestResults: TelephonyPhoneTestResult[] | null;
  testRoute: ImportedTelephonyPhoneNumber["testRoute"] | null;
  phoneTestResults: TelephonyPhoneTestResult[] | null;
}

export type TelephonyPhoneTestProjectionUpdateOutcome = {
  outcome: "updated" | "existing" | "conflict" | "not_found";
};

export interface RecordTelephonyOutboundAbuseBlockInput {
  dispatch: TelephonyDispatchRecord;
  connectionIds: string[];
}

export type TelephonyOutboundAbuseBlockOutcome = {
  outcome: "inserted" | "existing" | "conflict";
  connectionCount: number;
};

export interface DeleteTelephonyRetainedCallDataInput {
  tenantId: string;
  retainAfter: string;
}

export interface TelephonyRuntimeDeletionCounts {
  webhookEvents: number;
  callControlEvents: number;
  executionCommands: number;
  executionSessions: number;
  mediaTokens: number;
  dispatches: number;
}

export interface DeleteTelephonyRetainedCallDataOutcome {
  tenantId: string;
  retainAfter: string;
  deletedCounts: TelephonyRuntimeDeletionCounts;
}

export interface RecordTelephonyConnectionHealthObservationInput {
  tenantId: string;
  connectionId: string;
  connectionStatus: TelephonyConnection["status"];
  healthStatus: TelephonyHealthStatus;
  healthCheck: TelephonyHealthCheck;
  heartbeat?: TelephonyProviderHeartbeat | undefined;
}

export type RecordTelephonyConnectionHealthObservationOutcome =
  | {
      outcome: "updated";
      connectionStatus: TelephonyConnection["status"];
      healthStatus: TelephonyHealthStatus;
    }
  | { outcome: "not_found" };

export interface LoadTelephonyConnectionAdmissionPostureInput {
  tenantId: string;
  connectionId: string;
}

export type TelephonyConnectionAdmissionPostureOutcome =
  | {
      outcome: "found";
      posture: {
        status: TelephonyConnection["status"];
        healthStatus: TelephonyHealthStatus;
        blockRoutingOnHealthFailure: boolean;
      };
    }
  | { outcome: "not_found" };

export interface DeleteTelephonyConnectionInput {
  tenantId: string;
  connectionId: string;
}

export interface DeleteTelephonyPhoneNumberInput {
  tenantId: string;
  phoneNumberId: string;
}

export type DeleteTelephonyPhoneNumberOutcome =
  | { outcome: "deleted" }
  | { outcome: "not_found" };

export interface TelephonyConnectionDeletionCounts extends TelephonyRuntimeDeletionCounts {
  connections: number;
  phoneNumbers: number;
  phoneTestCheckpoints: number;
}

export type DeleteTelephonyConnectionOutcome =
  | { outcome: "deleted"; deletedCounts: TelephonyConnectionDeletionCounts }
  | { outcome: "not_found" };

export interface TransitionTelephonyExecutionSessionInput {
  tenantId: string;
  callSessionId: string;
  expectedVersion: number;
  expectedStatus: TelephonyExecutionSessionStatus;
  nextStatus: TelephonyExecutionSessionStatus;
  updatedAt: string;
  diagnostics?: string[] | undefined;
  policyState?: TelephonyExecutionSession["policyState"] | null | undefined;
}

export type TelephonyTransitionOutcome = {
  outcome: "updated" | "existing" | "conflict" | "not_found";
  version?: number | undefined;
};

export interface ClaimTelephonyMediaTokenInput {
  tenantId: string;
  callSessionId: string;
  dispatchId: string;
  connectionId: string;
  tokenHash: string;
  workerId?: string | undefined;
}

export interface TelephonyMediaAuthorization {
  tenantId: string;
  callSessionId: string;
  dispatchId: string;
  connectionId: string;
  runtimePath: PstnRuntimePath;
}

export type TelephonyMediaTokenClaimOutcome =
  | {
      outcome: "claimed";
      authorization: TelephonyMediaAuthorization;
      ownerEpoch?: number | undefined;
    }
  | { outcome: "already_claimed" | "expired" | "conflict" | "not_found" };

export interface LoadTelephonyPremiumDispatchSnapshotInput {
  tenantId: string;
  callSessionId: string;
}

export type TelephonyPremiumDispatchSnapshotOutcome =
  | { outcome: "found"; snapshot: TelephonyPremiumDispatchSnapshot }
  | { outcome: "not_found" };

export interface FenceTelephonyPremiumCallOwnershipInput {
  tenantId: string;
  callSessionId: string;
  workerId: string;
  ownerEpoch: number;
}

export type TelephonyPremiumCallOwnershipFenceOutcome =
  | { outcome: "owned"; ownerEpoch: number }
  | { outcome: "not_owner" | "not_found" };

export interface DeleteExpiredTelephonyMediaTokensInput {
  tenantId: string;
  before: string;
}

export interface TelephonyPhoneTestCheckpointRecord {
  id: string;
  tenantId: string;
  phoneNumberId: string;
  callSessionId: string;
  testRouteSessionId: string;
  checkpoint: string;
  observedAt: string;
}

export interface LoadTelephonyCallRuntimeContextInput {
  tenantId: string;
  callSessionId: string;
}

export interface TelephonyCallRuntimeContext extends TelephonyMediaAuthorization {
  disposition: TelephonyDispatchRecord["disposition"];
  phoneNumberId?: string | undefined;
  publishedVersionId?: string | undefined;
  workspaceId?: string | undefined;
  workflowLabel?: string | undefined;
  routeMode?: string | undefined;
  runtimeProfile?: string | undefined;
  testRouteSessionId?: string | undefined;
  status: TelephonyExecutionSessionStatus;
  version: number;
  lifecycleState: TelephonyCallLifecycleState;
}

export type TelephonyCallRuntimeContextOutcome =
  | { outcome: "found"; context: TelephonyCallRuntimeContext }
  | { outcome: "not_found" };

export interface TransitionTelephonyCallLifecycleInput {
  tenantId: string;
  callSessionId: string;
  expectedVersion: number;
  expectedStage: TelephonyCallLifecycleStage;
  nextState: TelephonyCallLifecycleState;
  nextStatus?: TelephonyExecutionSessionStatus | undefined;
}

export interface RecordTelephonyPhoneTestCheckpointByCallInput {
  tenantId: string;
  callSessionId: string;
  checkpoint: string;
  observedAt: string;
}

export interface LoadLatestSuccessfulPhoneTestInput {
  tenantId: string;
  phoneNumberId: string;
  publishedVersionId: string;
  runtimeProfile: RuntimeProfileId;
}

export interface TelephonyIncrementalRepository {
  insertWebhookEvent(event: TelephonyWebhookEvent): Promise<TelephonyWebhookInsertOutcome>;
  insertDispatch(dispatch: TelephonyDispatchRecord): Promise<TelephonyInsertOutcome>;
  createCallExecution(
    input: CreateTelephonyCallExecutionInput,
  ): Promise<TelephonyCallExecutionOutcome>;
  createCallSetup(input: CreateTelephonyCallSetupInput): Promise<TelephonyCallSetupOutcome>;
  loadCallMutationContext(
    input: LoadTelephonyCallMutationContextInput,
  ): Promise<TelephonyCallMutationContextOutcome>;
  recordCallControlMutation(
    input: RecordTelephonyCallControlMutationInput,
  ): Promise<TelephonyCallControlMutationOutcome>;
  updatePhoneTestProjection(
    input: UpdateTelephonyPhoneTestProjectionInput,
  ): Promise<TelephonyPhoneTestProjectionUpdateOutcome>;
  recordOutboundAbuseBlock(
    input: RecordTelephonyOutboundAbuseBlockInput,
  ): Promise<TelephonyOutboundAbuseBlockOutcome>;
  deleteRetainedCallData(
    input: DeleteTelephonyRetainedCallDataInput,
  ): Promise<DeleteTelephonyRetainedCallDataOutcome>;
  recordConnectionHealthObservation(
    input: RecordTelephonyConnectionHealthObservationInput,
  ): Promise<RecordTelephonyConnectionHealthObservationOutcome>;
  loadConnectionAdmissionPosture(
    input: LoadTelephonyConnectionAdmissionPostureInput,
  ): Promise<TelephonyConnectionAdmissionPostureOutcome>;
  deleteConnection(
    input: DeleteTelephonyConnectionInput,
  ): Promise<DeleteTelephonyConnectionOutcome>;
  deletePhoneNumber(
    input: DeleteTelephonyPhoneNumberInput,
  ): Promise<DeleteTelephonyPhoneNumberOutcome>;
  transitionExecutionSession(
    input: TransitionTelephonyExecutionSessionInput,
  ): Promise<TelephonyTransitionOutcome>;
  loadCallRuntimeContext(
    input: LoadTelephonyCallRuntimeContextInput,
  ): Promise<TelephonyCallRuntimeContextOutcome>;
  transitionCallLifecycle(
    input: TransitionTelephonyCallLifecycleInput,
  ): Promise<TelephonyTransitionOutcome>;
  claimMediaToken(
    input: ClaimTelephonyMediaTokenInput,
  ): Promise<TelephonyMediaTokenClaimOutcome>;
  deleteExpiredMediaTokens(
    input: DeleteExpiredTelephonyMediaTokensInput,
  ): Promise<{ deletedCount: number }>;
  recordPhoneTestCheckpoint(
    checkpoint: TelephonyPhoneTestCheckpointRecord,
  ): Promise<TelephonyInsertOutcome | { outcome: "not_found" }>;
  recordPhoneTestCheckpointByCall(
    input: RecordTelephonyPhoneTestCheckpointByCallInput,
  ): Promise<TelephonyInsertOutcome | { outcome: "not_found" | "not_applicable" }>;
  loadLatestSuccessfulPhoneTest(
    input: LoadLatestSuccessfulPhoneTestInput,
  ): Promise<TelephonyPhoneTestResult | null>;
}

export interface TelephonyPremiumDispatchRepository extends TelephonyIncrementalRepository {
  loadPremiumDispatchSnapshot(
    input: LoadTelephonyPremiumDispatchSnapshotInput,
  ): Promise<TelephonyPremiumDispatchSnapshotOutcome>;
  fencePremiumCallOwnership(
    input: FenceTelephonyPremiumCallOwnershipInput,
  ): Promise<TelephonyPremiumCallOwnershipFenceOutcome>;
}

export const requiredPhoneTestCheckpoints = [
  "verifiedWebhook",
  "allowedCallerMatched",
  "mediaWebSocketConnected",
  "inboundFrameReceived",
  "transcriptCreated",
  "agentResponseGenerated",
  "outboundAudioSent",
  "cleanEnd",
  "noFatalError",
] as const;

export function createSuccessfulPhoneTestChecklist(): TelephonyPhoneTestResult["checklist"] {
  return {
    verifiedWebhook: true,
    allowedCallerMatched: true,
    mediaWebSocketConnected: true,
    inboundFrameReceived: true,
    transcriptCreated: true,
    agentResponseGenerated: true,
    outboundAudioSent: true,
    cleanEnd: true,
    noFatalError: true,
  };
}

export const TELEPHONY_INCREMENTAL_REPOSITORY = Symbol("TELEPHONY_INCREMENTAL_REPOSITORY");
