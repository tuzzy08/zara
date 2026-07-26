import type {
  ImportedTelephonyPhoneNumber,
  TelephonyConnection,
  TelephonyHealthStatus,
} from "@zara/core";

import type {
  CreateTelephonyCallExecutionInput,
  CreateTelephonyCallSetupInput,
  TelephonyIncrementalRepository,
  TelephonyPremiumDispatchRepository,
  UpdateTelephonyPhoneTestProjectionInput,
} from "./telephony-incremental.repository";
import {
  createSuccessfulPhoneTestChecklist,
  requiredPhoneTestCheckpoints,
} from "./telephony-incremental.repository";

export class InMemoryTelephonyIncrementalRepository implements TelephonyPremiumDispatchRepository {
  readonly webhookEvents: Parameters<TelephonyIncrementalRepository["insertWebhookEvent"]>[0][] = [];
  readonly dispatches: Parameters<TelephonyIncrementalRepository["insertDispatch"]>[0][] = [];
  readonly callExecutions: CreateTelephonyCallExecutionInput[] = [];
  readonly callSetups: CreateTelephonyCallSetupInput[] = [];
  readonly callControlMutations:
    Parameters<TelephonyIncrementalRepository["recordCallControlMutation"]>[0][] = [];
  readonly phoneTestProjections: Array<{
    tenantId: string;
    phoneNumberId: string;
    connectionId: string;
    testRoute: UpdateTelephonyPhoneTestProjectionInput["testRoute"];
    phoneTestResults: UpdateTelephonyPhoneTestProjectionInput["phoneTestResults"];
  }> = [];
  readonly connectionTenants = new Map<string, string>();
  readonly connectionAdmissionPostures = new Map<
    string,
    {
      status: TelephonyConnection["status"];
      healthStatus: TelephonyHealthStatus;
      blockRoutingOnHealthFailure: boolean;
    }
  >();
  readonly disabledConnectionIds = new Set<string>();
  readonly phoneTestCheckpoints:
    Parameters<TelephonyIncrementalRepository["recordPhoneTestCheckpoint"]>[0][] = [];
  readonly executionSessionTransitions:
    Parameters<TelephonyIncrementalRepository["transitionExecutionSession"]>[0][] = [];
  readonly callLifecycleTransitions:
    Parameters<TelephonyIncrementalRepository["transitionCallLifecycle"]>[0][] = [];
  readonly mediaTokenClaims:
    Parameters<TelephonyIncrementalRepository["claimMediaToken"]>[0][] = [];
  readonly connectionHealthObservations:
    Parameters<TelephonyIncrementalRepository["recordConnectionHealthObservation"]>[0][] = [];
  readonly premiumOwners = new Map<
    string,
    { workerId: string; ownerEpoch: number; leaseExpiresAtMs?: number }
  >();
  failCallSetup = false;
  failPhoneTestCheckpoint = false;
  failPhoneTestProjection = false;
  callLifecycleConflictsRemaining = 0;

  loadPhoneNumberProjections(
    tenantId: string,
    phoneNumbers: readonly ImportedTelephonyPhoneNumber[],
  ) {
    for (const phoneNumber of phoneNumbers) {
      const projection = {
        tenantId,
        phoneNumberId: phoneNumber.id,
        connectionId: phoneNumber.connectionId,
        testRoute: structuredClone(phoneNumber.testRoute ?? null),
        phoneTestResults: structuredClone(phoneNumber.phoneTestResults ?? null),
      };
      const existingIndex = this.phoneTestProjections.findIndex(
        (candidate) =>
          candidate.tenantId === tenantId && candidate.phoneNumberId === phoneNumber.id,
      );
      if (existingIndex === -1) {
        this.phoneTestProjections.push(projection);
      } else {
        this.phoneTestProjections[existingIndex] = projection;
      }
    }
  }

  loadConnections(tenantId: string, connectionIds: readonly string[]) {
    for (const connectionId of connectionIds) {
      this.connectionTenants.set(connectionId, tenantId);
      this.connectionAdmissionPostures.set(connectionId, {
        status: "active",
        healthStatus: "healthy",
        blockRoutingOnHealthFailure: true,
      });
    }
  }

  setConnectionAdmissionPosture(
    connectionId: string,
    posture: {
      status: TelephonyConnection["status"];
      healthStatus: TelephonyHealthStatus;
      blockRoutingOnHealthFailure: boolean;
    },
  ) {
    this.connectionAdmissionPostures.set(connectionId, structuredClone(posture));
  }

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
    const existing = this.callSetups.find(
      (candidate) =>
        candidate.dispatch.tenantId === input.dispatch.tenantId &&
        candidate.executionSession.callSessionId === input.executionSession.callSessionId,
    );
    if (existing !== undefined) {
      if (
        !callSetupExecutionMatches(existing, input) ||
        !mediaTokenOwnershipMatches(existing.mediaToken, input.mediaToken) ||
        existing.mediaToken.consumedAt !== undefined
      ) {
        return { outcome: "conflict" as const };
      }
      if (mediaTokenMatches(existing.mediaToken, input.mediaToken)) {
        return { outcome: "existing" as const, mediaToken: "retained" as const };
      }
      existing.mediaToken = structuredClone(input.mediaToken);
      return { outcome: "existing" as const, mediaToken: "rotated" as const };
    }
    this.callSetups.push(structuredClone(input));
    return { outcome: "inserted" as const, mediaToken: "created" as const };
  }

  async createCallExecution(input: CreateTelephonyCallExecutionInput) {
    const existing = this.findCallExecution(
      input.dispatch.tenantId,
      input.executionSession.callSessionId,
    );
    if (existing !== undefined) {
      return { outcome: sameJson(existing, input) ? "existing" as const : "conflict" as const };
    }
    this.callExecutions.push(structuredClone(input));
    return { outcome: "inserted" as const };
  }

  async loadCallMutationContext(
    input: Parameters<TelephonyIncrementalRepository["loadCallMutationContext"]>[0],
  ) {
    const execution = this.findCallExecution(input.tenantId, input.callSessionId);
    if (execution === undefined) return { outcome: "not_found" as const };
    const version =
      (execution.executionSession as typeof execution.executionSession & { version?: number })
        .version ?? 0;
    return {
      outcome: "found" as const,
      context: {
        dispatch: structuredClone(execution.dispatch),
        executionSession: structuredClone(execution.executionSession),
        version,
      },
    };
  }

  async recordCallControlMutation(
    input: Parameters<TelephonyIncrementalRepository["recordCallControlMutation"]>[0],
  ) {
    const execution = this.findCallExecution(input.tenantId, input.callSessionId);
    if (
      execution === undefined ||
      execution.dispatch.id !== input.dispatchId ||
      execution.executionSession.dispatchId !== input.dispatchId
    ) {
      return { outcome: "not_found" as const };
    }
    const version =
      (execution.executionSession as typeof execution.executionSession & { version?: number })
        .version ?? 0;
    const existing = this.callControlMutations.find(
      (candidate) =>
        candidate.tenantId === input.tenantId && candidate.event.id === input.event.id,
    );
    if (existing !== undefined) {
      return sameJson(existing.event, input.event) &&
        sameJson(existing.executionCommands, input.executionCommands)
        ? { outcome: "existing" as const, version }
        : { outcome: "conflict" as const, version };
    }
    if (
      version !== input.expectedVersion ||
      execution.executionSession.status !== input.expectedStatus ||
      ["terminated", "completed", "blocked"].includes(execution.executionSession.status)
    ) {
      return { outcome: "conflict" as const, version };
    }
    execution.executionSession.status = input.session.status;
    execution.executionSession.outageMode = input.session.outageMode ?? undefined;
    execution.executionSession.fallbackTarget = input.session.fallbackTarget ?? undefined;
    execution.executionSession.diagnostics = structuredClone(input.session.diagnostics);
    execution.executionSession.updatedAt = input.session.updatedAt;
    Object.assign(execution.executionSession, { version: version + 1 });
    this.callControlMutations.push(structuredClone(input));
    return { outcome: "updated" as const, version: version + 1 };
  }

  async updatePhoneTestProjection(
    input: Parameters<TelephonyIncrementalRepository["updatePhoneTestProjection"]>[0],
  ) {
    if (this.failPhoneTestProjection) {
      throw new Error("phone-test projection database unavailable");
    }
    const projection = this.phoneTestProjections.find(
      (candidate) =>
        candidate.tenantId === input.tenantId &&
        candidate.phoneNumberId === input.phoneNumberId,
    );
    if (projection === undefined) return { outcome: "not_found" as const };
    if (
      sameJson(projection.testRoute, input.testRoute) &&
      sameJson(projection.phoneTestResults, input.phoneTestResults)
    ) {
      return { outcome: "existing" as const };
    }
    if (
      !sameJson(projection.testRoute, input.expectedTestRoute) ||
      !sameJson(projection.phoneTestResults, input.expectedPhoneTestResults)
    ) {
      return { outcome: "conflict" as const };
    }
    projection.testRoute = structuredClone(input.testRoute);
    projection.phoneTestResults = structuredClone(input.phoneTestResults);
    return { outcome: "updated" as const };
  }

  async deletePhoneNumber(
    input: Parameters<TelephonyIncrementalRepository["deletePhoneNumber"]>[0],
  ) {
    const deleted = removeMatching(
      this.phoneTestProjections,
      (projection) =>
        projection.tenantId === input.tenantId &&
        projection.phoneNumberId === input.phoneNumberId,
    );
    if (deleted === 0) return { outcome: "not_found" as const };
    removeMatching(
      this.phoneTestCheckpoints,
      (checkpoint) =>
        checkpoint.tenantId === input.tenantId &&
        checkpoint.phoneNumberId === input.phoneNumberId,
    );
    return { outcome: "deleted" as const };
  }

  async recordOutboundAbuseBlock(
    input: Parameters<TelephonyIncrementalRepository["recordOutboundAbuseBlock"]>[0],
  ) {
    if (input.dispatch.direction !== "outbound" || input.dispatch.disposition !== "blocked") {
      throw new Error("Outbound abuse handling requires a blocked outbound dispatch.");
    }
    const connectionIds = [...new Set(input.connectionIds)].sort();
    if (connectionIds.length === 0) {
      throw new Error("At least one telephony connection is required for abuse handling.");
    }
    if (
      connectionIds.some(
        (connectionId) => this.connectionTenants.get(connectionId) !== input.dispatch.tenantId,
      )
    ) {
      return { outcome: "conflict" as const, connectionCount: 0 };
    }
    const existing = this.dispatches.find(
      (candidate) =>
        candidate.tenantId === input.dispatch.tenantId && candidate.id === input.dispatch.id,
    );
    if (existing !== undefined && !sameJson(existing, input.dispatch)) {
      return { outcome: "conflict" as const, connectionCount: 0 };
    }
    for (const connectionId of connectionIds) this.disabledConnectionIds.add(connectionId);
    if (existing !== undefined) {
      return { outcome: "existing" as const, connectionCount: connectionIds.length };
    }
    this.dispatches.push(structuredClone(input.dispatch));
    return { outcome: "inserted" as const, connectionCount: connectionIds.length };
  }

  async deleteRetainedCallData(
    input: Parameters<TelephonyIncrementalRepository["deleteRetainedCallData"]>[0],
  ) {
    const cutoff = Date.parse(input.retainAfter);
    if (!Number.isFinite(cutoff)) throw new Error("Retention cutoff must be a valid timestamp.");
    const executions = this.allCallExecutions();
    const expiredDispatchIds = new Set(
      [
        ...executions.map(({ dispatch }) => dispatch),
        ...this.dispatches,
      ]
        .filter(
          (dispatch) =>
            dispatch.tenantId === input.tenantId &&
            Date.parse(dispatch.createdAt) < cutoff,
        )
        .map(({ id }) => id),
    );
    const expiredSessionIds = new Set(
      executions
        .filter(
          ({ dispatch, executionSession }) =>
            dispatch.tenantId === input.tenantId &&
            (expiredDispatchIds.has(dispatch.id) ||
              Date.parse(executionSession.createdAt) < cutoff),
        )
        .map(({ executionSession }) => executionSession.id),
    );
    const expiredCallSessionIds = new Set(
      executions
        .filter(({ executionSession }) => expiredSessionIds.has(executionSession.id))
        .map(({ executionSession }) => executionSession.callSessionId),
    );
    const webhookEvents = removeMatching(
      this.webhookEvents,
      (event) =>
        event.tenantId === input.tenantId && Date.parse(event.receivedAt) < cutoff,
    );
    let executionCommands = 0;
    for (const execution of executions) {
      executionCommands += removeMatching(
        execution.executionCommands,
        (command) =>
          command.tenantId === input.tenantId &&
          (Date.parse(command.requestedAt) < cutoff ||
            expiredDispatchIds.has(command.dispatchId) ||
            expiredSessionIds.has(command.sessionId)),
      );
    }
    for (const mutation of this.callControlMutations) {
      executionCommands += removeMatching(
        mutation.executionCommands,
        (command) =>
          command.tenantId === input.tenantId &&
          (Date.parse(command.requestedAt) < cutoff ||
            expiredDispatchIds.has(command.dispatchId) ||
            expiredSessionIds.has(command.sessionId)),
      );
    }
    const callControlEvents = removeMatching(
      this.callControlMutations,
      ({ event }) =>
        event.tenantId === input.tenantId &&
        (Date.parse(event.at) < cutoff ||
          expiredDispatchIds.has(event.dispatchId) ||
          expiredCallSessionIds.has(event.callSessionId)),
    );
    const mediaTokens = removeMatching(
      this.callSetups,
      ({ dispatch, executionSession, mediaToken }) =>
        dispatch.tenantId === input.tenantId &&
        (Date.parse(mediaToken.createdAt) < cutoff ||
          expiredDispatchIds.has(dispatch.id) ||
          expiredSessionIds.has(executionSession.id)),
    );
    const executionSessions =
      removeMatching(
        this.callExecutions,
        ({ dispatch, executionSession }) =>
          dispatch.tenantId === input.tenantId &&
          (expiredDispatchIds.has(dispatch.id) ||
            expiredSessionIds.has(executionSession.id)),
      ) + mediaTokens;
    const standaloneDispatches = removeMatching(
      this.dispatches,
      (dispatch) =>
        dispatch.tenantId === input.tenantId && expiredDispatchIds.has(dispatch.id),
    );
    return {
      tenantId: input.tenantId,
      retainAfter: input.retainAfter,
      deletedCounts: {
        webhookEvents,
        callControlEvents,
        executionCommands,
        executionSessions,
        mediaTokens,
        dispatches: executionSessions + standaloneDispatches,
      },
    };
  }

  async recordConnectionHealthObservation(
    input: Parameters<TelephonyIncrementalRepository["recordConnectionHealthObservation"]>[0],
  ) {
    if (this.connectionTenants.get(input.connectionId) !== input.tenantId) {
      return { outcome: "not_found" as const };
    }
    this.connectionHealthObservations.push(structuredClone(input));
    const abuseBlocked = this.disabledConnectionIds.has(input.connectionId);
    const existingPosture = this.connectionAdmissionPostures.get(input.connectionId);
    if (existingPosture !== undefined) {
      this.connectionAdmissionPostures.set(input.connectionId, {
        ...existingPosture,
        status: abuseBlocked ? "disabled" : input.connectionStatus,
        healthStatus: abuseBlocked ? "failed" : input.healthStatus,
      });
    }
    return {
      outcome: "updated" as const,
      connectionStatus: abuseBlocked ? ("disabled" as const) : input.connectionStatus,
      healthStatus: abuseBlocked ? ("failed" as const) : input.healthStatus,
    };
  }

  async loadConnectionAdmissionPosture(
    input: Parameters<TelephonyIncrementalRepository["loadConnectionAdmissionPosture"]>[0],
  ) {
    if (this.connectionTenants.get(input.connectionId) !== input.tenantId) {
      return { outcome: "not_found" as const };
    }
    const posture = this.connectionAdmissionPostures.get(input.connectionId);
    if (posture === undefined) {
      return { outcome: "not_found" as const };
    }
    return {
      outcome: "found" as const,
      posture: structuredClone(posture),
    };
  }

  async deleteConnection(
    input: Parameters<TelephonyIncrementalRepository["deleteConnection"]>[0],
  ) {
    const executions = this.allCallExecutions();
    const owned =
      this.connectionTenants.get(input.connectionId) === input.tenantId ||
      executions.some(
        ({ dispatch, executionSession }) =>
          dispatch.tenantId === input.tenantId &&
          executionSession.connectionId === input.connectionId,
      ) ||
      this.phoneTestProjections.some(
        (projection) =>
          projection.tenantId === input.tenantId &&
          projection.connectionId === input.connectionId,
      );
    if (!owned) return { outcome: "not_found" as const };
    const targetExecutions = executions.filter(
      ({ dispatch, executionSession }) =>
        dispatch.tenantId === input.tenantId &&
        (dispatch.connectionId === input.connectionId ||
          executionSession.connectionId === input.connectionId),
    );
    const dispatchIds = new Set(targetExecutions.map(({ dispatch }) => dispatch.id));
    const sessionIds = new Set(
      targetExecutions.map(({ executionSession }) => executionSession.id),
    );
    const callSessionIds = new Set(
      targetExecutions.map(({ executionSession }) => executionSession.callSessionId),
    );
    const phoneNumberIds = new Set(
      this.phoneTestProjections
        .filter(
          (projection) =>
            projection.tenantId === input.tenantId &&
            projection.connectionId === input.connectionId,
        )
        .map(({ phoneNumberId }) => phoneNumberId),
    );
    const phoneTestCheckpoints = removeMatching(
      this.phoneTestCheckpoints,
      (checkpoint) =>
        checkpoint.tenantId === input.tenantId &&
        phoneNumberIds.has(checkpoint.phoneNumberId),
    );
    const phoneNumbers = removeMatching(
      this.phoneTestProjections,
      (projection) =>
        projection.tenantId === input.tenantId &&
        projection.connectionId === input.connectionId,
    );
    const webhookEvents = removeMatching(
      this.webhookEvents,
      (event) =>
        event.tenantId === input.tenantId &&
        event.connectionId === input.connectionId,
    );
    const callControlCommandCount = this.callControlMutations
      .filter(
        ({ event }) =>
          event.tenantId === input.tenantId &&
          (dispatchIds.has(event.dispatchId) || callSessionIds.has(event.callSessionId)),
      )
      .reduce((count, mutation) => count + mutation.executionCommands.length, 0);
    const callControlEvents = removeMatching(
      this.callControlMutations,
      ({ event }) =>
        event.tenantId === input.tenantId &&
        (dispatchIds.has(event.dispatchId) || callSessionIds.has(event.callSessionId)),
    );
    const executionCommands =
      callControlCommandCount +
      targetExecutions.reduce(
        (count, execution) => count + execution.executionCommands.length,
        0,
      );
    const mediaTokens = removeMatching(
      this.callSetups,
      ({ dispatch, executionSession }) =>
        dispatch.tenantId === input.tenantId &&
        (dispatchIds.has(dispatch.id) || sessionIds.has(executionSession.id)),
    );
    const tokenlessSessions = removeMatching(
      this.callExecutions,
      ({ dispatch, executionSession }) =>
        dispatch.tenantId === input.tenantId &&
        (dispatchIds.has(dispatch.id) || sessionIds.has(executionSession.id)),
    );
    const standaloneDispatches = removeMatching(
      this.dispatches,
      (dispatch) =>
        dispatch.tenantId === input.tenantId &&
        dispatch.connectionId === input.connectionId,
    );
    this.connectionTenants.delete(input.connectionId);
    this.connectionAdmissionPostures.delete(input.connectionId);
    return {
      outcome: "deleted" as const,
      deletedCounts: {
        connections: 1,
        phoneNumbers,
        phoneTestCheckpoints,
        webhookEvents,
        callControlEvents,
        executionCommands,
        executionSessions: mediaTokens + tokenlessSessions,
        mediaTokens,
        dispatches: mediaTokens + tokenlessSessions + standaloneDispatches,
      },
    };
  }

  async transitionExecutionSession(
    input: Parameters<TelephonyIncrementalRepository["transitionExecutionSession"]>[0],
  ) {
    this.executionSessionTransitions.push(structuredClone(input));
    const setup = this.findCallExecution(input.tenantId, input.callSessionId);
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
    if (
      input.workerId !== undefined
      && setup.dispatch.runtimePath !== "pstn-premium-realtime"
    ) {
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
    const ownerEpoch = input.workerId === undefined ? undefined : 1;
    if (input.workerId !== undefined) {
      this.premiumOwners.set(
        `${input.tenantId}:${input.callSessionId}`,
        { workerId: input.workerId, ownerEpoch: 1 },
      );
    }
    return {
      outcome: "claimed" as const,
      ...(ownerEpoch === undefined ? {} : { ownerEpoch }),
      authorization: {
        tenantId: setup.executionSession.tenantId,
        callSessionId: setup.executionSession.callSessionId,
        dispatchId: setup.executionSession.dispatchId,
        connectionId: setup.executionSession.connectionId,
        runtimePath: setup.dispatch.runtimePath,
      },
    };
  }

  async loadPremiumDispatchSnapshot(
    input: Parameters<
      TelephonyPremiumDispatchRepository["loadPremiumDispatchSnapshot"]
    >[0],
  ) {
    const setup = this.callSetups.find(
      (candidate) =>
        candidate.dispatch.tenantId === input.tenantId
        && candidate.executionSession.callSessionId === input.callSessionId,
    );
    return setup?.premiumDispatchSnapshot === undefined
      ? { outcome: "not_found" as const }
      : {
          outcome: "found" as const,
          snapshot: structuredClone(setup.premiumDispatchSnapshot),
        };
  }

  async fencePremiumCallOwnership(
    input: Parameters<
      TelephonyPremiumDispatchRepository["fencePremiumCallOwnership"]
    >[0],
  ) {
    const owner = this.premiumOwners.get(
      `${input.tenantId}:${input.callSessionId}`,
    );
    const leaseExpiresAtMs = Date.parse(input.leaseExpiresAt);
    if (
      owner?.workerId !== input.workerId
      || owner.ownerEpoch !== input.ownerEpoch
      || !Number.isFinite(leaseExpiresAtMs)
      || leaseExpiresAtMs <= Date.now()
    ) {
      return { outcome: "not_owner" as const };
    }
    owner.leaseExpiresAtMs = Math.max(
      owner.leaseExpiresAtMs ?? 0,
      leaseExpiresAtMs,
    );
    return { outcome: "owned" as const, ownerEpoch: owner.ownerEpoch };
  }

  async reconcileExpiredPremiumCallOwners(
    input: Parameters<
      TelephonyPremiumDispatchRepository["reconcileExpiredPremiumCallOwners"]
    >[0],
  ) {
    const beforeMs = Date.parse(input.before);
    let reconciledCount = 0;
    for (const [key, owner] of this.premiumOwners) {
      if (
        reconciledCount >= input.limit
        || owner.leaseExpiresAtMs === undefined
        || owner.leaseExpiresAtMs > beforeMs
      ) {
        continue;
      }
      const separator = key.indexOf(":");
      const tenantId = key.slice(0, separator);
      const callSessionId = key.slice(separator + 1);
      const setup = this.findCallExecution(tenantId, callSessionId);
      if (
        setup === undefined
        || setup.dispatch.runtimePath !== "pstn-premium-realtime"
        || ["completed", "failed", "expired"].includes(
          setup.executionSession.lifecycleState.stage,
        )
      ) {
        continue;
      }
      setup.executionSession.lifecycleState = {
        stage: "failed",
        observedAt: input.before,
        reasonCode: "premium_call_owner_lease_expired",
      };
      setup.executionSession.status = "terminated";
      setup.executionSession.updatedAt = input.before;
      Object.assign(setup.executionSession, {
        version:
          ((setup.executionSession as typeof setup.executionSession & {
            version?: number;
          }).version ?? 0) + 1,
      });
      reconciledCount += 1;
    }
    return { reconciledCount };
  }

  async loadCallRuntimeContext(
    input: Parameters<TelephonyIncrementalRepository["loadCallRuntimeContext"]>[0],
  ) {
    const setup = this.findCallExecution(input.tenantId, input.callSessionId);
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
    const setup = this.findCallExecution(
      input.tenantId,
      input.callSessionId,
    )!;
    if (input.ownership !== undefined) {
      const owner = this.premiumOwners.get(
        `${input.tenantId}:${input.callSessionId}`,
      );
      if (
        owner?.workerId !== input.ownership.workerId
        || owner.ownerEpoch !== input.ownership.ownerEpoch
        || owner.leaseExpiresAtMs === undefined
        || owner.leaseExpiresAtMs <= Date.now()
      ) {
        return { outcome: "conflict" as const, version: loaded.context.version };
      }
    }
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
        candidate.callSessionId === checkpoint.callSessionId &&
        candidate.checkpoint === checkpoint.checkpoint,
    );
    if (existing !== undefined) return { outcome: "existing" as const };
    this.phoneTestCheckpoints.push(structuredClone(checkpoint));
    return { outcome: "inserted" as const };
  }

  async recordPhoneTestCheckpointByCall(
    input: Parameters<TelephonyIncrementalRepository["recordPhoneTestCheckpointByCall"]>[0],
  ) {
    const setup = this.findCallExecution(input.tenantId, input.callSessionId);
    if (setup === undefined) return { outcome: "not_found" as const };
    if (
      setup.dispatch.routeMode !== "test_route" ||
      setup.dispatch.phoneNumberId === undefined ||
      setup.dispatch.testRouteSessionId === undefined
    ) {
      return { outcome: "not_applicable" as const };
    }
    const checkpoint = {
      id: `${input.tenantId}:${input.callSessionId}:${input.checkpoint}`,
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
        candidate.callSessionId === checkpoint.callSessionId &&
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

  private findCallExecution(tenantId: string, callSessionId: string) {
    return (
      this.callSetups.find(
        (candidate) =>
          candidate.executionSession.tenantId === tenantId &&
          candidate.executionSession.callSessionId === callSessionId,
      ) ??
      this.callExecutions.find(
        (candidate) =>
          candidate.executionSession.tenantId === tenantId &&
          candidate.executionSession.callSessionId === callSessionId,
      )
    );
  }

  private allCallExecutions(): CreateTelephonyCallExecutionInput[] {
    return [...this.callSetups, ...this.callExecutions];
  }
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function callSetupExecutionMatches(
  existing: CreateTelephonyCallSetupInput,
  input: CreateTelephonyCallSetupInput,
) {
  const existingCommands = [...existing.executionCommands].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const inputCommands = [...input.executionCommands].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  return (
    sameJson(
      { ...existing.dispatch, createdAt: undefined },
      { ...input.dispatch, createdAt: undefined },
    ) &&
    sameJson(
      {
        ...existing.executionSession,
        createdAt: undefined,
        updatedAt: undefined,
        diagnostics: undefined,
        policyState: undefined,
      },
      {
        ...input.executionSession,
        createdAt: undefined,
        updatedAt: undefined,
        diagnostics: undefined,
        policyState: undefined,
      },
    ) &&
    sameJson(existingCommands, inputCommands)
  );
}

function mediaTokenOwnershipMatches(
  existing: CreateTelephonyCallSetupInput["mediaToken"],
  input: CreateTelephonyCallSetupInput["mediaToken"],
) {
  return (
    existing.tenantId === input.tenantId &&
    existing.callSessionId === input.callSessionId &&
    existing.dispatchId === input.dispatchId &&
    existing.connectionId === input.connectionId
  );
}

function mediaTokenMatches(
  existing: CreateTelephonyCallSetupInput["mediaToken"],
  input: CreateTelephonyCallSetupInput["mediaToken"],
) {
  return (
    existing.tokenHash === input.tokenHash &&
    existing.expiresAt === input.expiresAt &&
    existing.createdAt === input.createdAt
  );
}

function removeMatching<T>(items: T[], predicate: (item: T) => boolean) {
  const retained = items.filter((item) => !predicate(item));
  const removed = items.length - retained.length;
  items.splice(0, items.length, ...retained);
  return removed;
}
