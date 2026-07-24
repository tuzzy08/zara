import type {
  CreateTelephonyCallSetupInput,
  TelephonyIncrementalRepository,
} from "./telephony-incremental.repository";
import {
  createSuccessfulPhoneTestChecklist,
  requiredPhoneTestCheckpoints,
} from "./telephony-incremental.repository";

export class InMemoryTelephonyIncrementalRepository implements TelephonyIncrementalRepository {
  readonly webhookEvents: Parameters<TelephonyIncrementalRepository["insertWebhookEvent"]>[0][] = [];
  readonly dispatches: Parameters<TelephonyIncrementalRepository["insertDispatch"]>[0][] = [];
  readonly callSetups: CreateTelephonyCallSetupInput[] = [];
  readonly phoneTestCheckpoints:
    Parameters<TelephonyIncrementalRepository["recordPhoneTestCheckpoint"]>[0][] = [];
  readonly executionSessionTransitions:
    Parameters<TelephonyIncrementalRepository["transitionExecutionSession"]>[0][] = [];
  readonly callLifecycleTransitions:
    Parameters<TelephonyIncrementalRepository["transitionCallLifecycle"]>[0][] = [];
  readonly mediaTokenClaims:
    Parameters<TelephonyIncrementalRepository["claimMediaToken"]>[0][] = [];
  failCallSetup = false;
  failPhoneTestCheckpoint = false;
  callLifecycleConflictsRemaining = 0;

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

  async transitionExecutionSession(
    input: Parameters<TelephonyIncrementalRepository["transitionExecutionSession"]>[0],
  ) {
    this.executionSessionTransitions.push(structuredClone(input));
    const setup = this.callSetups.find(
      (candidate) =>
        candidate.executionSession.tenantId === input.tenantId &&
        candidate.executionSession.callSessionId === input.callSessionId,
    );
    if (setup === undefined || setup.dispatch.runtimePath === undefined) {
      return { outcome: "not_found" as const };
    }
    const version = (setup.executionSession as typeof setup.executionSession & { version?: number }).version ?? 0;
    if (
      setup.executionSession.status === input.nextStatus &&
      version === input.expectedVersion + 1
    ) {
      return { outcome: "existing" as const, version };
    }
    if (
      setup.executionSession.status !== input.expectedStatus ||
      version !== input.expectedVersion ||
      ["terminated", "completed", "blocked"].includes(setup.executionSession.status)
    ) {
      return { outcome: "conflict" as const, version };
    }
    setup.executionSession.status = input.nextStatus;
    setup.executionSession.updatedAt = input.updatedAt;
    if (input.diagnostics !== undefined) {
      setup.executionSession.diagnostics = structuredClone(input.diagnostics);
    }
    Object.assign(setup.executionSession, { version: version + 1 });
    return { outcome: "updated" as const, version: version + 1 };
  }

  async claimMediaToken(
    input: Parameters<TelephonyIncrementalRepository["claimMediaToken"]>[0],
  ) {
    this.mediaTokenClaims.push(structuredClone(input));
    const setup = this.callSetups.find(
      (candidate) =>
        candidate.mediaToken.tenantId === input.tenantId &&
        candidate.mediaToken.callSessionId === input.callSessionId,
    );
    if (setup === undefined || setup.dispatch.runtimePath === undefined) {
      return { outcome: "not_found" as const };
    }
    if (setup.mediaToken.tokenHash !== input.tokenHash) {
      return { outcome: "conflict" as const };
    }
    if (
      setup.mediaToken.dispatchId !== input.dispatchId ||
      setup.mediaToken.connectionId !== input.connectionId
    ) {
      return { outcome: "conflict" as const };
    }
    if (setup.dispatch.runtimePath === undefined) {
      return { outcome: "conflict" as const };
    }
    if (setup.mediaToken.consumedAt !== undefined) {
      return { outcome: "already_claimed" as const };
    }
    if (["completed", "failed", "expired"].includes(setup.executionSession.lifecycleState.stage)) {
      return { outcome: "conflict" as const };
    }
    if (Date.parse(setup.mediaToken.expiresAt) <= Date.now()) {
      return { outcome: "expired" as const };
    }
    setup.mediaToken.consumedAt = new Date().toISOString();
    return {
      outcome: "claimed" as const,
      authorization: {
        tenantId: setup.executionSession.tenantId,
        callSessionId: setup.executionSession.callSessionId,
        dispatchId: setup.executionSession.dispatchId,
        connectionId: setup.executionSession.connectionId,
        runtimePath: setup.dispatch.runtimePath,
      },
    };
  }

  async loadCallRuntimeContext(
    input: Parameters<TelephonyIncrementalRepository["loadCallRuntimeContext"]>[0],
  ) {
    const setup = this.callSetups.find(
      (candidate) =>
        candidate.executionSession.tenantId === input.tenantId &&
        candidate.executionSession.callSessionId === input.callSessionId,
    );
    if (setup === undefined || setup.dispatch.runtimePath === undefined) {
      return { outcome: "not_found" as const };
    }
    const version =
      (setup.executionSession as typeof setup.executionSession & { version?: number }).version ?? 0;
    return {
      outcome: "found" as const,
      context: {
        tenantId: setup.executionSession.tenantId,
        callSessionId: setup.executionSession.callSessionId,
        dispatchId: setup.executionSession.dispatchId,
        connectionId: setup.executionSession.connectionId,
        disposition: setup.dispatch.disposition,
        ...(setup.dispatch.phoneNumberId === undefined
          ? {}
          : { phoneNumberId: setup.dispatch.phoneNumberId }),
        ...(setup.dispatch.publishedVersionId === undefined
          ? {}
          : { publishedVersionId: setup.dispatch.publishedVersionId }),
        ...(setup.dispatch.workspaceId === undefined
          ? {}
          : { workspaceId: setup.dispatch.workspaceId }),
        ...(setup.dispatch.workflowLabel === undefined
          ? {}
          : { workflowLabel: setup.dispatch.workflowLabel }),
        ...(setup.dispatch.routeMode === undefined ? {} : { routeMode: setup.dispatch.routeMode }),
        ...(setup.dispatch.runtimeProfile === undefined
          ? {}
          : { runtimeProfile: setup.dispatch.runtimeProfile }),
        runtimePath: setup.dispatch.runtimePath,
        ...(setup.dispatch.testRouteSessionId === undefined
          ? {}
          : { testRouteSessionId: setup.dispatch.testRouteSessionId }),
        status: setup.executionSession.status,
        version,
        lifecycleState: structuredClone(setup.executionSession.lifecycleState),
      },
    };
  }

  async transitionCallLifecycle(
    input: Parameters<TelephonyIncrementalRepository["transitionCallLifecycle"]>[0],
  ) {
    this.callLifecycleTransitions.push(structuredClone(input));
    if (this.callLifecycleConflictsRemaining > 0) {
      this.callLifecycleConflictsRemaining -= 1;
      const loaded = await this.loadCallRuntimeContext(input);
      return loaded.outcome === "found"
        ? { outcome: "conflict" as const, version: loaded.context.version }
        : loaded;
    }
    const loaded = await this.loadCallRuntimeContext(input);
    if (loaded.outcome === "not_found") return loaded;
    const setup = this.callSetups.find(
      (candidate) =>
        candidate.executionSession.tenantId === input.tenantId &&
        candidate.executionSession.callSessionId === input.callSessionId,
    )!;
    if (
      loaded.context.version === input.expectedVersion + 1 &&
      JSON.stringify(loaded.context.lifecycleState) === JSON.stringify(input.nextState) &&
      (input.nextStatus === undefined || loaded.context.status === input.nextStatus)
    ) {
      return { outcome: "existing" as const, version: loaded.context.version };
    }
    if (
      loaded.context.version !== input.expectedVersion ||
      loaded.context.lifecycleState.stage !== input.expectedStage ||
      ["completed", "failed", "expired"].includes(loaded.context.lifecycleState.stage)
    ) {
      return { outcome: "conflict" as const, version: loaded.context.version };
    }
    setup.executionSession.lifecycleState = structuredClone(input.nextState);
    setup.executionSession.updatedAt = input.nextState.observedAt;
    if (input.nextStatus !== undefined) setup.executionSession.status = input.nextStatus;
    Object.assign(setup.executionSession, { version: loaded.context.version + 1 });
    return { outcome: "updated" as const, version: loaded.context.version + 1 };
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

  async recordPhoneTestCheckpointByCall(
    input: Parameters<TelephonyIncrementalRepository["recordPhoneTestCheckpointByCall"]>[0],
  ) {
    const setup = this.callSetups.find(
      (candidate) =>
        candidate.dispatch.tenantId === input.tenantId &&
        candidate.executionSession.callSessionId === input.callSessionId,
    );
    if (setup === undefined) return { outcome: "not_found" as const };
    if (
      setup.dispatch.routeMode !== "test_route" ||
      setup.dispatch.phoneNumberId === undefined ||
      setup.dispatch.testRouteSessionId === undefined
    ) {
      return { outcome: "not_applicable" as const };
    }
    const checkpoint = {
      id: `${input.callSessionId}:${input.checkpoint}`,
      tenantId: input.tenantId,
      phoneNumberId: setup.dispatch.phoneNumberId,
      callSessionId: input.callSessionId,
      testRouteSessionId: setup.dispatch.testRouteSessionId,
      checkpoint: input.checkpoint,
      observedAt: input.observedAt,
    };
    const existing = this.phoneTestCheckpoints.find(
      (candidate) =>
        candidate.tenantId === checkpoint.tenantId &&
        candidate.testRouteSessionId === checkpoint.testRouteSessionId &&
        candidate.checkpoint === checkpoint.checkpoint,
    );
    if (existing !== undefined) return { outcome: "existing" as const };
    this.phoneTestCheckpoints.push(checkpoint);
    return { outcome: "inserted" as const };
  }

  async loadLatestSuccessfulPhoneTest(
    input: Parameters<TelephonyIncrementalRepository["loadLatestSuccessfulPhoneTest"]>[0],
  ) {
    const candidates = this.callSetups
      .filter(
        ({ dispatch }) =>
          dispatch.tenantId === input.tenantId &&
          dispatch.phoneNumberId === input.phoneNumberId &&
          dispatch.publishedVersionId === input.publishedVersionId &&
          dispatch.runtimeProfile === input.runtimeProfile &&
          dispatch.routeMode === "test_route" &&
          dispatch.testRouteSessionId !== undefined,
      )
      .map(({ dispatch }) => {
        const checkpoints = this.phoneTestCheckpoints.filter(
          (checkpoint) =>
            checkpoint.tenantId === input.tenantId &&
            checkpoint.callSessionId === dispatch.callSessionId,
        );
        const observed = new Map(
          checkpoints.map((checkpoint) => [checkpoint.checkpoint, checkpoint.observedAt]),
        );
        if (requiredPhoneTestCheckpoints.some((checkpoint) => !observed.has(checkpoint))) {
          return null;
        }
        const completedAt = checkpoints
          .map(({ observedAt }) => observedAt)
          .sort((left, right) => Date.parse(right) - Date.parse(left))[0]!;
        return {
          id: `${dispatch.testRouteSessionId}:passed`,
          tenantId: input.tenantId,
          numberId: input.phoneNumberId,
          sessionId: dispatch.testRouteSessionId!,
          status: "passed" as const,
          reason: "PSTN phone test completed every required checkpoint.",
          checklist: createSuccessfulPhoneTestChecklist(),
          publishedVersionId: input.publishedVersionId,
          runtimeProfile: input.runtimeProfile,
          createdAt: dispatch.createdAt,
          completedAt,
        };
      })
      .filter((candidate) => candidate !== null)
      .sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt));
    return candidates[0] ?? null;
  }
}
