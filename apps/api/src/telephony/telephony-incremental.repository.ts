import type {
  TelephonyCallLifecycleStage,
  TelephonyCallLifecycleState,
  TelephonyExecutionSession,
  TelephonyExecutionSessionStatus,
  TelephonyPhoneTestResult,
  PstnRuntimePath,
  RuntimeProfileId,
} from "@zara/core";

import type {
  TelephonyDispatchRecord,
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

export interface IncrementalTelephonyMediaToken extends TelephonyMediaStreamTokenRecord {
  tenantId: string;
}

export interface CreateTelephonyCallSetupInput {
  dispatch: TelephonyDispatchRecord;
  executionSession: TelephonyExecutionSession & {
    lifecycleState: TelephonyCallLifecycleState;
  };
  mediaToken: IncrementalTelephonyMediaToken;
}

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
}

export interface TelephonyMediaAuthorization {
  tenantId: string;
  callSessionId: string;
  dispatchId: string;
  connectionId: string;
  runtimePath: PstnRuntimePath;
}

export type TelephonyMediaTokenClaimOutcome =
  | { outcome: "claimed"; authorization: TelephonyMediaAuthorization }
  | { outcome: "already_claimed" | "expired" | "conflict" | "not_found" };

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
  createCallSetup(input: CreateTelephonyCallSetupInput): Promise<TelephonyCallSetupOutcome>;
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
