import type {
  CreateTelephonyCallSetupInput,
  TelephonyIncrementalRepository,
} from "./telephony-incremental.repository";

export class InMemoryTelephonyIncrementalRepository implements TelephonyIncrementalRepository {
  readonly webhookEvents: Parameters<TelephonyIncrementalRepository["insertWebhookEvent"]>[0][] = [];
  readonly dispatches: Parameters<TelephonyIncrementalRepository["insertDispatch"]>[0][] = [];
  readonly callSetups: CreateTelephonyCallSetupInput[] = [];
  readonly phoneTestCheckpoints:
    Parameters<TelephonyIncrementalRepository["recordPhoneTestCheckpoint"]>[0][] = [];
  failCallSetup = false;
  failPhoneTestCheckpoint = false;

  async insertWebhookEvent(event: Parameters<TelephonyIncrementalRepository["insertWebhookEvent"]>[0]) {
    const existing = this.webhookEvents.find(
      (candidate) =>
        candidate.tenantId === event.tenantId &&
        candidate.connectionId === event.connectionId &&
        candidate.eventSid === event.eventSid,
    );
    if (existing !== undefined) {
      return { outcome: "existing" as const, receivedAt: existing.receivedAt };
    }
    this.webhookEvents.push(structuredClone(event));
    return { outcome: "inserted" as const, receivedAt: event.receivedAt };
  }

  async insertDispatch(dispatch: Parameters<TelephonyIncrementalRepository["insertDispatch"]>[0]) {
    const existing = this.dispatches.find(
      (candidate) => candidate.tenantId === dispatch.tenantId && candidate.id === dispatch.id,
    );
    if (existing !== undefined) return { outcome: "existing" as const };
    this.dispatches.push(structuredClone(dispatch));
    return { outcome: "inserted" as const };
  }

  async createCallSetup(input: CreateTelephonyCallSetupInput) {
    if (this.failCallSetup) throw new Error("database unavailable");
    const existingIndex = this.callSetups.findIndex(
      (candidate) =>
        candidate.dispatch.tenantId === input.dispatch.tenantId &&
        candidate.executionSession.callSessionId === input.executionSession.callSessionId,
    );
    if (existingIndex >= 0) {
      this.callSetups[existingIndex] = structuredClone(input);
      return { outcome: "existing" as const, mediaToken: "retained" as const };
    }
    this.callSetups.push(structuredClone(input));
    return { outcome: "inserted" as const, mediaToken: "created" as const };
  }

  async transitionExecutionSession() {
    return { outcome: "not_found" as const };
  }

  async claimMediaToken() {
    return { outcome: "not_found" as const };
  }

  async deleteExpiredMediaTokens() {
    return { deletedCount: 0 };
  }

  async recordPhoneTestCheckpoint(
    checkpoint: Parameters<TelephonyIncrementalRepository["recordPhoneTestCheckpoint"]>[0],
  ) {
    if (this.failPhoneTestCheckpoint) throw new Error("checkpoint database unavailable");
    const existing = this.phoneTestCheckpoints.find(
      (candidate) =>
        candidate.tenantId === checkpoint.tenantId &&
        candidate.testRouteSessionId === checkpoint.testRouteSessionId &&
        candidate.checkpoint === checkpoint.checkpoint,
    );
    if (existing !== undefined) return { outcome: "existing" as const };
    this.phoneTestCheckpoints.push(structuredClone(checkpoint));
    return { outcome: "inserted" as const };
  }
}
