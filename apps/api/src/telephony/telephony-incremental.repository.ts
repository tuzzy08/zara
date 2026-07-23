import type { TelephonyExecutionSession, TelephonyExecutionSessionStatus } from "@zara/core";

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
  executionSession: TelephonyExecutionSession;
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
  tokenHash: string;
}

export type TelephonyMediaTokenClaimOutcome = {
  outcome: "claimed" | "already_claimed" | "expired" | "conflict" | "not_found";
};

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

export interface TelephonyIncrementalRepository {
  insertWebhookEvent(event: TelephonyWebhookEvent): Promise<TelephonyWebhookInsertOutcome>;
  insertDispatch(dispatch: TelephonyDispatchRecord): Promise<TelephonyInsertOutcome>;
  createCallSetup(input: CreateTelephonyCallSetupInput): Promise<TelephonyCallSetupOutcome>;
  transitionExecutionSession(
    input: TransitionTelephonyExecutionSessionInput,
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
}

export const TELEPHONY_INCREMENTAL_REPOSITORY = Symbol("TELEPHONY_INCREMENTAL_REPOSITORY");
