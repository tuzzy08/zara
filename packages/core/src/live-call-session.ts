import type { CallEvent, ID } from "./index";
import {
  createCallEventStream,
  type CallEventReplayOptions,
  type CompiledRuntimeManifest,
  type StreamedCallEvent,
} from "./runtime";
import {
  createTurnRuntimePacket,
  recordRuntimePacketTransfer,
  recordRuntimePacketWarning,
  type AgentTransferContext,
  type AgentToolAssignment,
  type RuntimeWarning,
  type TurnRuntimePacket,
  type TurnRuntimePacketInputSource,
} from "./turn-runtime-packet";

export type LiveCallSessionSource =
  | {
      mode: "browser";
    }
  | {
      mode: "pstn";
      phoneNumberId: ID;
      telephonyConnectionId: ID;
      routeMode: "test_route" | "live_route";
    };

export type LiveCallSessionSourceMode = LiveCallSessionSource["mode"];

export type LiveCallSessionStatus =
  | "waiting"
  | "ringing"
  | "connected"
  | "listening"
  | "thinking"
  | "speaking"
  | "ending"
  | "ended"
  | "failed";

export interface LiveCallSessionSnapshot {
  callSessionId: ID;
  tenantId: ID;
  workspaceId: ID;
  manifestId: ID;
  manifestVersion: number;
  publishedVersionId: ID;
  runtimeProfile: CompiledRuntimeManifest["runtimeProfile"];
  sourceMode: LiveCallSessionSourceMode;
  status: LiveCallSessionStatus;
  startedAt?: string | undefined;
  updatedAt: string;
  phoneNumberId?: ID | undefined;
  telephonyConnectionId?: ID | undefined;
  routeMode?: "test_route" | "live_route" | undefined;
}

export interface LiveCallSessionCoordinator {
  save(snapshot: LiveCallSessionSnapshot): void | Promise<void>;
  load(callSessionId: ID): LiveCallSessionSnapshot | undefined | Promise<LiveCallSessionSnapshot | undefined>;
}

export interface LiveCallSessionExpectedScope {
  tenantId?: ID | undefined;
  workspaceId?: ID | undefined;
  phoneNumberId?: ID | undefined;
  publishedVersionId?: ID | undefined;
  runtimeProfile?: CompiledRuntimeManifest["runtimeProfile"] | undefined;
}

export interface LiveCallSessionTransitionInput {
  status: Exclude<LiveCallSessionStatus, "waiting" | "ringing"> | "ringing";
  packetId?: ID | undefined;
  reason?: string | undefined;
}

export interface LiveCallSessionCreateTurnPacketInput {
  turnId: ID;
  activeRoleId: ID;
  latestCallerTurn: string;
  inputSource: TurnRuntimePacketInputSource;
  language?: string | undefined;
  sttConfidence?: number | undefined;
  conversationSummary?: string | undefined;
  transfer?: {
    nodeId: ID;
    context: AgentTransferContext;
  } | undefined;
  policyWarnings?: RuntimeWarning[] | undefined;
}

export interface CreateLiveCallSessionInput {
  callSessionId: ID;
  manifest: CompiledRuntimeManifest;
  source: LiveCallSessionSource;
  expectedScope?: LiveCallSessionExpectedScope | undefined;
  coordinator?: LiveCallSessionCoordinator | undefined;
  now?: (() => string) | undefined;
  createEventId?: ((type: CallEvent["type"], index: number) => ID) | undefined;
}

export interface LiveCallSession {
  start(): LiveCallSessionSnapshot;
  transition(input: LiveCallSessionTransitionInput): LiveCallSessionSnapshot;
  createTurnPacket(input: LiveCallSessionCreateTurnPacketInput): TurnRuntimePacket;
  getSnapshot(): LiveCallSessionSnapshot;
  getManifest(): CompiledRuntimeManifest;
  replayEvents(options?: CallEventReplayOptions): StreamedCallEvent[];
}

export function createLiveCallSession(input: CreateLiveCallSessionInput): LiveCallSession {
  validateLiveCallSessionScope(input);

  const now = input.now ?? (() => new Date().toISOString());
  const createEventId =
    input.createEventId ?? ((type, index) => `${input.callSessionId}:${type}:${index + 1}`);
  const eventStream = createCallEventStream();
  let snapshot = createInitialSnapshot(input, now());
  const persistSnapshot = () => {
    void input.coordinator?.save(cloneSnapshot(snapshot));
  };

  const publishEvent = (event: CallEvent) => eventStream.publish(event);

  return {
    start() {
      const startedAt = now();
      snapshot = {
        ...snapshot,
        status: input.source.mode === "pstn" ? "waiting" : "connected",
        startedAt,
        updatedAt: startedAt,
      };
      publishEvent({
        id: createEventId("call.started", eventStream.size()),
        callSessionId: input.callSessionId,
        tenantId: input.manifest.tenantId,
        type: "call.started",
        at: startedAt,
        payload: {
          lifecycleStatus: snapshot.status,
          sourceMode: snapshot.sourceMode,
          manifestId: snapshot.manifestId,
          manifestVersion: snapshot.manifestVersion,
          publishedVersionId: snapshot.publishedVersionId,
          runtimeProfile: snapshot.runtimeProfile,
          ...(snapshot.workspaceId !== undefined ? { workspaceId: snapshot.workspaceId } : {}),
          ...(snapshot.phoneNumberId !== undefined ? { phoneNumberId: snapshot.phoneNumberId } : {}),
          ...(snapshot.routeMode !== undefined ? { routeMode: snapshot.routeMode } : {}),
        },
      });
      persistSnapshot();

      return cloneSnapshot(snapshot);
    },
    transition(transitionInput) {
      assertLiveCallSessionTransition(snapshot.status, transitionInput.status);

      const transitionedAt = now();
      const previousStatus = snapshot.status;
      snapshot = {
        ...snapshot,
        status: transitionInput.status,
        updatedAt: transitionedAt,
      };
      publishEvent({
        id: createEventId("call.lifecycle", eventStream.size()),
        callSessionId: input.callSessionId,
        tenantId: input.manifest.tenantId,
        type: "call.lifecycle",
        at: transitionedAt,
        payload: {
          lifecycleStatus: snapshot.status,
          previousStatus,
          sourceMode: snapshot.sourceMode,
          manifestId: snapshot.manifestId,
          manifestVersion: snapshot.manifestVersion,
          publishedVersionId: snapshot.publishedVersionId,
          runtimeProfile: snapshot.runtimeProfile,
          workspaceId: snapshot.workspaceId,
          ...(transitionInput.packetId !== undefined ? { packetId: transitionInput.packetId } : {}),
          ...(transitionInput.reason !== undefined ? { reason: transitionInput.reason } : {}),
          ...(snapshot.phoneNumberId !== undefined ? { phoneNumberId: snapshot.phoneNumberId } : {}),
          ...(snapshot.routeMode !== undefined ? { routeMode: snapshot.routeMode } : {}),
        },
      });
      persistSnapshot();

      return cloneSnapshot(snapshot);
    },
    createTurnPacket(packetInput) {
      const activeRole = input.manifest.roles.find((role) => role.id === packetInput.activeRoleId);
      if (activeRole === undefined) {
        throw new LiveCallSessionError(
          "live_call_session.unknown_active_role",
          `Role '${packetInput.activeRoleId}' is not present in runtime manifest '${input.manifest.manifestId}'.`,
        );
      }

      const startedAt = now();
      let packet = createTurnRuntimePacket({
        ids: {
          tenantId: input.manifest.tenantId,
          workspaceId: snapshot.workspaceId,
          callSessionId: input.callSessionId,
          turnId: packetInput.turnId,
          manifestId: input.manifest.manifestId,
          manifestVersion: input.manifest.version,
        },
        timing: {
          startedAt,
        },
        callerInput: {
          latestCallerTurn: packetInput.latestCallerTurn,
          source: packetInput.inputSource,
          ...(packetInput.language !== undefined ? { language: packetInput.language } : {}),
          ...(packetInput.sttConfidence !== undefined ? { sttConfidence: packetInput.sttConfidence } : {}),
          ...(packetInput.conversationSummary !== undefined
            ? { conversationSummary: packetInput.conversationSummary }
            : {}),
        },
        graph: {
          entryNodeId: input.manifest.entryNodeId,
          currentNodeId: packetInput.activeRoleId,
          frontierNodeIds: [packetInput.activeRoleId],
          activeAgent: {
            id: activeRole.id,
            name: activeRole.name,
            kind: activeRole.kind,
          },
        },
        availableTools: input.manifest.agentToolAssignments
          .filter((assignment) => assignment.roleId === activeRole.id)
          .map(toPacketToolAssignment),
        safety: {
          redactionApplied: input.manifest.telemetry.redactSensitiveData,
        },
      });

      if (packetInput.transfer !== undefined) {
        packet = recordRuntimePacketTransfer(packet, {
          at: startedAt,
          nodeId: packetInput.transfer.nodeId,
          transfer: packetInput.transfer.context,
        });
      }

      for (const warning of packetInput.policyWarnings ?? []) {
        packet = recordRuntimePacketWarning(packet, {
          at: startedAt,
          warning,
        });
      }

      publishEvent({
        id: createEventId("turn.started", eventStream.size()),
        callSessionId: input.callSessionId,
        tenantId: input.manifest.tenantId,
        type: "turn.started",
        at: startedAt,
        payload: {
          packetId: packet.ids.turnId,
          activeRoleId: activeRole.id,
          sourceMode: snapshot.sourceMode,
          inputSource: packetInput.inputSource,
          manifestId: snapshot.manifestId,
          manifestVersion: snapshot.manifestVersion,
          publishedVersionId: snapshot.publishedVersionId,
          workspaceId: snapshot.workspaceId,
        },
      });

      return packet;
    },
    getSnapshot() {
      return cloneSnapshot(snapshot);
    },
    getManifest() {
      return cloneManifest(input.manifest);
    },
    replayEvents(options) {
      return eventStream.replay(options);
    },
  };
}

export function createInMemoryLiveCallSessionCoordinator(): LiveCallSessionCoordinator {
  const snapshots = new Map<ID, LiveCallSessionSnapshot>();

  return {
    save(snapshot) {
      snapshots.set(snapshot.callSessionId, cloneSnapshot(snapshot));
    },
    load(callSessionId) {
      const snapshot = snapshots.get(callSessionId);
      return snapshot === undefined ? undefined : cloneSnapshot(snapshot);
    },
  };
}

export function rehydrateLiveCallSessionSnapshot(input: {
  callSessionId: ID;
  coordinator: LiveCallSessionCoordinator;
  expectedScope?: LiveCallSessionExpectedScope | undefined;
}): LiveCallSessionSnapshot {
  const snapshot = input.coordinator.load(input.callSessionId);
  if (isPromiseLike(snapshot)) {
    throw new LiveCallSessionError(
      "live_call_session.async_coordinator_requires_async_rehydrate",
      "Use an async rehydrate path for asynchronous live call session coordinators.",
    );
  }

  if (snapshot === undefined) {
    throw new LiveCallSessionError(
      "live_call_session.not_found",
      `Live call session '${input.callSessionId}' was not found.`,
    );
  }

  validateLiveCallSessionSnapshotScope(snapshot, input.expectedScope);

  return cloneSnapshot(snapshot);
}

function createInitialSnapshot(
  input: CreateLiveCallSessionInput,
  at: string,
): LiveCallSessionSnapshot {
  const baseSnapshot = {
    callSessionId: input.callSessionId,
    tenantId: input.manifest.tenantId,
    workspaceId: requireWorkspaceId(input.manifest),
    manifestId: input.manifest.manifestId,
    manifestVersion: input.manifest.version,
    publishedVersionId: input.manifest.publishedVersionId,
    runtimeProfile: input.manifest.runtimeProfile,
    sourceMode: input.source.mode,
    status: input.source.mode === "pstn" ? "waiting" : "connected",
    updatedAt: at,
  } satisfies LiveCallSessionSnapshot;

  if (input.source.mode === "browser") {
    return baseSnapshot;
  }

  return {
    ...baseSnapshot,
    phoneNumberId: input.source.phoneNumberId,
    telephonyConnectionId: input.source.telephonyConnectionId,
    routeMode: input.source.routeMode,
  };
}

function cloneSnapshot(snapshot: LiveCallSessionSnapshot): LiveCallSessionSnapshot {
  return structuredClone(snapshot) as LiveCallSessionSnapshot;
}

function cloneManifest(manifest: CompiledRuntimeManifest): CompiledRuntimeManifest {
  return structuredClone(manifest) as CompiledRuntimeManifest;
}

export type LiveCallSessionErrorCode =
  | "live_call_session.unknown_active_role"
  | "live_call_session.not_found"
  | "live_call_session.scope_mismatch"
  | "live_call_session.invalid_transition"
  | "live_call_session.async_coordinator_requires_async_rehydrate";

export class LiveCallSessionError extends Error {
  code: LiveCallSessionErrorCode;

  constructor(code: LiveCallSessionErrorCode, message: string) {
    super(message);
    this.name = "LiveCallSessionError";
    this.code = code;
  }
}

function toPacketToolAssignment(
  assignment: CompiledRuntimeManifest["agentToolAssignments"][number],
): AgentToolAssignment {
  const { roleId: _roleId, ...packetAssignment } = assignment;
  return packetAssignment;
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === "object" && value !== null && "then" in value;
}

function validateLiveCallSessionScope(input: CreateLiveCallSessionInput): void {
  const expectedScope = input.expectedScope;
  const workspaceId = input.manifest.workspaceId;
  if (workspaceId === undefined || workspaceId.length === 0) {
    throw new LiveCallSessionError(
      "live_call_session.scope_mismatch",
      `Runtime manifest '${input.manifest.manifestId}' is missing a workspace scope.`,
    );
  }

  if (expectedScope === undefined) {
    return;
  }

  assertScopeMatch("tenantId", input.manifest.tenantId, expectedScope.tenantId);
  assertScopeMatch("workspaceId", workspaceId, expectedScope.workspaceId);
  assertScopeMatch(
    "publishedVersionId",
    input.manifest.publishedVersionId,
    expectedScope.publishedVersionId,
  );
  assertScopeMatch("runtimeProfile", input.manifest.runtimeProfile, expectedScope.runtimeProfile);

  if (expectedScope.phoneNumberId !== undefined) {
    const actualPhoneNumberId = input.source.mode === "pstn" ? input.source.phoneNumberId : undefined;
    assertScopeMatch("phoneNumberId", actualPhoneNumberId, expectedScope.phoneNumberId);
  }
}

function validateLiveCallSessionSnapshotScope(
  snapshot: LiveCallSessionSnapshot,
  expectedScope: LiveCallSessionExpectedScope | undefined,
): void {
  if (expectedScope === undefined) {
    return;
  }

  assertScopeMatch("tenantId", snapshot.tenantId, expectedScope.tenantId);
  assertScopeMatch("workspaceId", snapshot.workspaceId, expectedScope.workspaceId);
  assertScopeMatch(
    "publishedVersionId",
    snapshot.publishedVersionId,
    expectedScope.publishedVersionId,
  );
  assertScopeMatch("runtimeProfile", snapshot.runtimeProfile, expectedScope.runtimeProfile);
  assertScopeMatch("phoneNumberId", snapshot.phoneNumberId, expectedScope.phoneNumberId);
}

function requireWorkspaceId(manifest: CompiledRuntimeManifest): ID {
  if (manifest.workspaceId === undefined || manifest.workspaceId.length === 0) {
    throw new LiveCallSessionError(
      "live_call_session.scope_mismatch",
      `Runtime manifest '${manifest.manifestId}' is missing a workspace scope.`,
    );
  }

  return manifest.workspaceId;
}

function assertScopeMatch(
  field: keyof LiveCallSessionExpectedScope,
  actual: string | undefined,
  expected: string | undefined,
): void {
  if (expected !== undefined && actual !== expected) {
    throw new LiveCallSessionError(
      "live_call_session.scope_mismatch",
      `Live call session ${field} '${actual ?? "missing"}' does not match expected '${expected}'.`,
    );
  }
}

const liveCallSessionTransitionTable: Record<LiveCallSessionStatus, LiveCallSessionStatus[]> = {
  waiting: ["ringing", "connected", "ending", "failed"],
  ringing: ["connected", "ending", "failed"],
  connected: ["listening", "thinking", "speaking", "ending", "failed"],
  listening: ["thinking", "ending", "failed"],
  thinking: ["listening", "speaking", "ending", "failed"],
  speaking: ["listening", "thinking", "ending", "failed"],
  ending: ["ended", "failed"],
  ended: [],
  failed: [],
};

function assertLiveCallSessionTransition(
  currentStatus: LiveCallSessionStatus,
  nextStatus: LiveCallSessionStatus,
): void {
  if (!liveCallSessionTransitionTable[currentStatus].includes(nextStatus)) {
    throw new LiveCallSessionError(
      "live_call_session.invalid_transition",
      `Live call session cannot transition from '${currentStatus}' to '${nextStatus}'.`,
    );
  }
}
