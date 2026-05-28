import {
  ConflictException,
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import {
  applyTelephonyCallControlEventToSession,
  assignTelephonyNumberRoute,
  createTelephonyCallControlEvent,
  createTelephonyConnection,
  createTelephonyCallControlCommands,
  createTelephonyExecutionCommands,
  createTelephonyExecutionSession,
  createTelephonyProviderHeartbeat,
  defaultRecordingPolicy,
  importTwilioPhoneNumbers,
  provisionTelephonyPhoneNumber,
  resolveInboundCall,
  resolveOutboundCall,
  verifyTwilioWebhookSignature,
  type ImportedTelephonyPhoneNumber,
  type InboundCallResolution,
  type TelephonyCallControlEvent,
  type TelephonyConnection,
  type TelephonyConnectionOwnershipMode,
  type TelephonyExecutionCommand,
  type TelephonyExecutionSession,
  type TelephonyProvider,
  type TelephonyProviderHeartbeat,
  type TelephonyRecordingPolicy,
} from "@zara/core";

import { AuditLogService } from "../compliance/audit-log.service";
import type {
  TelephonyCredentialVaultEntry,
  TelephonyDispatchRecord,
  TelephonyOutboundAbusePolicy,
  TelephonyOutboundCompliancePolicy,
  TelephonyHealthCheck,
  TelephonyStateStore,
  TelephonyStateResponse,
  TelephonyWebhookEvent,
} from "./telephony.models";
import {
  TELEPHONY_STATE_REPOSITORY,
  type PersistedTelephonyStateRecord,
  type TelephonyStateRepository,
} from "./telephony-state.repository";
import { TelephonySecretVault } from "./telephony-secret-vault";
import {
  renderTwilioConnectStreamTwiML,
  renderTwilioRejectTwiML,
} from "./twilio-media-streams.bridge";

const localTwilioWebhookUrl = "http://127.0.0.1/telephony/webhooks/twilio";
const localTwilioMediaStreamBaseUrl = "wss://127.0.0.1/telephony/twilio/media-streams";
const safeTakeoverMessage =
  "I am connecting you with a specialist now. If the transfer drops, we will call you back using the number on this call.";
const safeCallbackMessage =
  "A specialist is not available on this line right now. We will call you back at the number we have for this call.";

@Injectable()
export class TelephonyService implements OnModuleInit, OnModuleDestroy {
  private readonly stateByOrganizationId = new Map<string, TelephonyStateStore>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(TELEPHONY_STATE_REPOSITORY)
    private readonly stateRepository: TelephonyStateRepository,
    private readonly secretVault: TelephonySecretVault,
    @Optional()
    private readonly auditLogService?: AuditLogService,
  ) {}

  onModuleInit() {
    const intervalMs = Number.parseInt(
      process.env.ZARA_TELEPHONY_HEARTBEAT_INTERVAL_MS ?? "0",
      10,
    );

    if (Number.isFinite(intervalMs) && intervalMs > 0) {
      this.heartbeatTimer = setInterval(() => {
        void this.runScheduledHeartbeatSweep();
      }, intervalMs);
      this.heartbeatTimer.unref?.();
    }
  }

  onModuleDestroy() {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async getState(organizationId: string): Promise<TelephonyStateResponse> {
    return cloneState(await this.getOrCreateState(organizationId));
  }

  async createConnection(input: {
    organizationId: string;
    actorUserId: string;
    label: string;
    ownershipMode: TelephonyConnectionOwnershipMode;
    provider: TelephonyProvider;
    region: string;
    blockRoutingOnHealthFailure: boolean;
    recordingPolicy?: TelephonyRecordingPolicy | undefined;
    accountSid?: string | undefined;
    authToken?: string | undefined;
    username?: string | undefined;
    secret?: string | undefined;
    sip?: { domain: string; codecs: string[] } | undefined;
  }) {
    const state = await this.getOrCreateState(input.organizationId);
    const connectionId = `telephony-${input.organizationId}-${state.connections.length + 1}`;
    const sharedSecret = resolveSecret(input);
    const connection = createTelephonyConnection({
      id: connectionId,
      tenantId: input.organizationId,
      label: input.label,
      ownershipMode: input.ownershipMode,
      provider: input.provider,
      region: input.region,
      createdBy: input.actorUserId,
      recordingPolicy: input.recordingPolicy ?? defaultRecordingPolicy(),
      blockRoutingOnHealthFailure: input.blockRoutingOnHealthFailure,
      ...(input.ownershipMode === "platform_managed"
        ? {}
        : {
            credentials: {
              ...(input.accountSid === undefined ? {} : { accountSid: input.accountSid }),
              ...(input.username === undefined ? {} : { username: input.username }),
              secret: sharedSecret,
            },
            credentialKeyVersion: this.secretVault.currentKeyVersion,
          }),
      ...(input.sip === undefined ? {} : { sip: input.sip }),
      webhookBaseUrl: localTwilioWebhookUrl,
    });

    state.connections = [...state.connections, connection];
    state.credentialVault.set(connection.id, {
      ...(input.accountSid === undefined ? {} : { accountSid: input.accountSid }),
      ...(input.authToken === undefined ? {} : { authToken: input.authToken }),
      ...(input.username === undefined ? {} : { username: input.username }),
      ...(input.secret === undefined ? {} : { secret: input.secret }),
    });
    await this.persistState(state);

    return {
      state: cloneState(state),
      connection: cloneConnection(connection),
    };
  }

  async validateConnection(input: { organizationId: string; connectionId: string }) {
    const state = await this.getOrCreateState(input.organizationId);
    const connection = requireConnection(state, input.organizationId, input.connectionId);
    const evaluation = evaluateConnectionHealth({
      connection,
      vault: state.credentialVault.get(connection.id),
      phoneNumbers: state.phoneNumbers,
    });
    const healthCheck: TelephonyHealthCheck = {
      id: `${connection.id}:health:${state.healthChecks.length + 1}`,
      connectionId: connection.id,
      status: evaluation.status,
      blocking:
        evaluation.status === "failed" ? connection.blockRoutingOnHealthFailure : false,
      checkedAt: new Date().toISOString(),
      message: evaluation.message,
    };

    state.connections = state.connections.map((candidate) =>
      candidate.id === connection.id
        ? {
            ...candidate,
            healthStatus: healthCheck.status,
            status: healthCheck.status === "failed" ? "degraded" : "active",
          }
        : candidate,
    );
    state.healthChecks = [healthCheck, ...state.healthChecks].slice(0, 20);
    await this.persistState(state);

    return {
      state: cloneState(state),
      healthCheck: cloneHealthCheck(healthCheck),
    };
  }

  async runConnectionHeartbeat(input: {
    organizationId: string;
    connectionId: string;
    scheduled: boolean;
  }) {
    const state = await this.getOrCreateState(input.organizationId);
    const connection = requireConnection(state, input.organizationId, input.connectionId);
    const evaluation = evaluateConnectionHealth({
      connection,
      vault: state.credentialVault.get(connection.id),
      phoneNumbers: state.phoneNumbers,
    });
    const routedNumberCount = state.phoneNumbers.filter(
      (phoneNumber) =>
        phoneNumber.connectionId === connection.id && phoneNumber.status === "routed",
    ).length;
    const heartbeatAt = new Date().toISOString();
    const heartbeat = createTelephonyProviderHeartbeat({
      tenantId: input.organizationId,
      connection,
      status: evaluation.status,
      blocking:
        evaluation.status === "failed" ? connection.blockRoutingOnHealthFailure : false,
      scheduled: input.scheduled,
      latencyMs: resolveHeartbeatLatency(connection),
      at: heartbeatAt,
      routedNumberCount,
    });
    const healthCheck: TelephonyHealthCheck = {
      id: `${connection.id}:health:${state.healthChecks.length + 1}`,
      connectionId: connection.id,
      status: heartbeat.status,
      blocking: heartbeat.blocking,
      checkedAt: heartbeat.at,
      message: heartbeat.message,
      scheduled: heartbeat.scheduled,
      latencyMs: heartbeat.latencyMs,
      diagnostics: [...heartbeat.diagnostics],
    };

    state.connections = state.connections.map((candidate) =>
      candidate.id === connection.id
        ? {
            ...candidate,
            healthStatus: heartbeat.status,
            status: heartbeat.status === "failed" ? "degraded" : "active",
          }
        : candidate,
    );
    state.healthChecks = [healthCheck, ...state.healthChecks].slice(0, 20);
    state.providerHeartbeats = [heartbeat, ...state.providerHeartbeats].slice(0, 30);
    await this.persistState(state);

    return {
      state: cloneState(state),
      heartbeat: cloneProviderHeartbeat(heartbeat),
      healthCheck: cloneHealthCheck(healthCheck),
    };
  }

  async importTwilioNumbers(input: { organizationId: string; connectionId: string }) {
    const state = await this.getOrCreateState(input.organizationId);
    const connection = requireConnection(state, input.organizationId, input.connectionId);

    if (connection.provider !== "twilio") {
      throw new ConflictException("Only Twilio connections can import provider phone numbers.");
    }

    const importedNumbers = importTwilioPhoneNumbers({
      tenantId: input.organizationId,
      connectionId: input.connectionId,
      existingNumbers: state.phoneNumbers,
      availableNumbers: buildAvailableTwilioNumbers(connection.externalReference ?? connection.id),
    });

    state.phoneNumbers = [...state.phoneNumbers, ...importedNumbers];
    await this.persistState(state);

    return {
      state: cloneState(state),
      importedNumbers: importedNumbers.map(clonePhoneNumber),
    };
  }

  async registerPhoneNumber(input: {
    organizationId: string;
    connectionId: string;
    phoneNumber: string;
    friendlyName: string;
    externalNumberId?: string | undefined;
  }) {
    const state = await this.getOrCreateState(input.organizationId);
    const connection = requireConnection(state, input.organizationId, input.connectionId);

    if (connection.provider === "twilio" && connection.ownershipMode === "byo_provider_account") {
      throw new ConflictException("Twilio BYO connections must import provider numbers instead of manual registration.");
    }

    const phoneNumber = provisionTelephonyPhoneNumber({
      tenantId: input.organizationId,
      connection,
      existingNumbers: state.phoneNumbers,
      phoneNumber: input.phoneNumber,
      friendlyName: input.friendlyName,
      externalNumberId: input.externalNumberId,
    });

    state.phoneNumbers = [...state.phoneNumbers, phoneNumber];
    await this.persistState(state);

    return {
      state: cloneState(state),
      phoneNumber: clonePhoneNumber(phoneNumber),
    };
  }

  async assignNumberRoute(input: {
    organizationId: string;
    numberId: string;
    publishedVersionId: string;
    workflowLabel: string;
    workspaceId: string;
    recordingPolicy?: TelephonyRecordingPolicy | undefined;
  }) {
    const state = await this.getOrCreateState(input.organizationId);
    requirePhoneNumber(state, input.organizationId, input.numberId);

    state.phoneNumbers = assignTelephonyNumberRoute({
      phoneNumbers: state.phoneNumbers,
      numberId: input.numberId,
      publishedVersionId: input.publishedVersionId,
      workflowLabel: input.workflowLabel,
      workspaceId: input.workspaceId,
      recordingPolicy: input.recordingPolicy,
    });
    await this.persistState(state);

    return {
      state: cloneState(state),
    };
  }

  async dispatchInboundCall(input: {
    organizationId: string;
    toPhoneNumber: string;
    fromPhoneNumber: string;
    callSid: string;
    source?: "manual" | "webhook" | undefined;
    testCall?: boolean | undefined;
  }) {
    const state = await this.getOrCreateState(input.organizationId);
    const now = new Date().toISOString();
    const resolution = resolveInboundCall({
      toPhoneNumber: input.toPhoneNumber,
      fromPhoneNumber: input.fromPhoneNumber,
      callSid: input.callSid,
      phoneNumbers: state.phoneNumbers,
      connections: state.connections,
      now,
    });
    const dispatch = buildDispatchRecord({
      organizationId: input.organizationId,
      resolution,
      toPhoneNumber: input.toPhoneNumber,
      fromPhoneNumber: input.fromPhoneNumber,
      source: input.source ?? "manual",
    });
    const execution = buildExecutionArtifacts({
      state,
      organizationId: input.organizationId,
      dispatch,
      testCall: input.testCall ?? false,
      now,
    });

    state.dispatches = [dispatch, ...state.dispatches].slice(0, 40);
    if (execution !== null) {
      state.executionSessions = upsertExecutionSession(state.executionSessions, execution.session);
      state.executionCommands = upsertExecutionCommands(
        state.executionCommands,
        execution.commands,
      );
    }
    await this.persistState(state);

    return {
      state: cloneState(state),
      dispatch: cloneDispatch(dispatch),
      ...(execution === null ? {} : { session: cloneExecutionSession(execution.session) }),
    };
  }

  async dispatchOutboundCall(input: {
    organizationId: string;
    toPhoneNumber: string;
    fromPhoneNumber: string;
    callSid: string;
    publishedVersionId: string;
    workflowLabel: string;
    workspaceId: string;
    consentGranted: boolean;
    budgetRemainingUsd: number;
    estimatedCostUsd: number;
    localHour: number;
    callingWindow: { startHour: number; endHour: number };
    actorUserId?: string | undefined;
    abusePolicy?: TelephonyOutboundAbusePolicy | undefined;
    compliancePolicy?: TelephonyOutboundCompliancePolicy | undefined;
    now?: string | undefined;
  }) {
    const state = await this.getOrCreateState(input.organizationId);
    const now = input.now ?? new Date().toISOString();
    const abuseEvaluation = evaluateOutboundAbusePolicy({
      state,
      now,
      policy: input.abusePolicy,
    });
    const complianceEvaluation = evaluateOutboundCompliancePolicy({
      toPhoneNumber: input.toPhoneNumber,
      localHour: input.localHour,
      policy: input.compliancePolicy,
    });
    const resolution = resolveOutboundCall({
      toPhoneNumber: input.toPhoneNumber,
      fromPhoneNumber: input.fromPhoneNumber,
      callSid: input.callSid,
      phoneNumbers: state.phoneNumbers,
      connections: state.connections,
      publishedVersionId: input.publishedVersionId,
      workflowLabel: input.workflowLabel,
      workspaceId: input.workspaceId,
      consentGranted: input.consentGranted,
      budgetRemainingUsd: input.budgetRemainingUsd,
      estimatedCostUsd: input.estimatedCostUsd,
      localHour: input.localHour,
      callingWindow: input.callingWindow,
      abuseAllowed: abuseEvaluation.allowed,
      abuseBlockedReason: abuseEvaluation.reason,
      dncAllowed: complianceEvaluation.dncAllowed,
      dncBlockedReason: complianceEvaluation.dncBlockedReason,
      timezoneAllowed: complianceEvaluation.timezoneAllowed,
      timezoneDetail: complianceEvaluation.timezoneDetail,
      timezoneBlockedReason: complianceEvaluation.timezoneBlockedReason,
      callingWindowOverrideAllowed: complianceEvaluation.overrideAllowed,
    });
    const dispatch = buildOutboundDispatchRecord({
      organizationId: input.organizationId,
      resolution,
      toPhoneNumber: input.toPhoneNumber,
      fromPhoneNumber: input.fromPhoneNumber,
      now,
    });
    const execution = buildExecutionArtifacts({
      state,
      organizationId: input.organizationId,
      dispatch,
      testCall: false,
      now,
    });

    state.dispatches = [dispatch, ...state.dispatches].slice(0, 40);
    if (
      abuseEvaluation.allowed === false &&
      input.abusePolicy?.pauseTenantOnViolation === true
    ) {
      state.connections = state.connections.map((connection) => ({
        ...connection,
        status: "disabled",
        healthStatus: "failed",
      }));
      if (this.auditLogService !== undefined) {
        await this.auditLogService.record({
          tenantId: input.organizationId,
          actorUserId: input.actorUserId,
          action: "telephony.outbound_abuse_paused",
          target: {
            type: "tenant",
            id: input.organizationId,
          },
          outcome: "failed",
          metadata: {
            callSid: input.callSid,
            windowSeconds: input.abusePolicy.windowSeconds,
            maxCallsPerWindow: input.abusePolicy.maxCallsPerWindow,
            recentOutboundCallCount: abuseEvaluation.recentOutboundCallCount,
          },
          occurredAt: now,
        });
      }
    }
    if (execution !== null) {
      state.executionSessions = upsertExecutionSession(state.executionSessions, execution.session);
      state.executionCommands = upsertExecutionCommands(
        state.executionCommands,
        execution.commands,
      );
    }
    if (
      resolution.disposition === "queued" &&
      complianceEvaluation.overrideAllowed &&
      input.compliancePolicy?.override !== undefined &&
      this.auditLogService !== undefined
    ) {
      await this.auditLogService.record({
        tenantId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "telephony.outbound_compliance_override",
        target: {
          type: "outbound_call",
          id: input.callSid,
        },
        outcome: "succeeded",
        metadata: {
          reason: input.compliancePolicy.override.reason,
          approvedByUserId: input.compliancePolicy.override.approvedByUserId,
          toPhoneNumber: input.toPhoneNumber,
          timezone: input.compliancePolicy.timezone ?? "unknown",
          localHour: input.localHour,
        },
        occurredAt: now,
      });
    }
    await this.persistState(state);

    return {
      state: cloneState(state),
      dispatch: cloneDispatch(dispatch),
      ...(execution === null ? {} : { session: cloneExecutionSession(execution.session) }),
    };
  }

  async runConnectionTestCall(input: {
    organizationId: string;
    connectionId: string;
    phoneNumberId: string;
    fromPhoneNumber: string;
    callSid: string;
  }) {
    const state = await this.getOrCreateState(input.organizationId);
    const connection = requireConnection(state, input.organizationId, input.connectionId);
    const phoneNumber = requirePhoneNumber(state, input.organizationId, input.phoneNumberId);

    if (phoneNumber.connectionId !== connection.id) {
      throw new ConflictException(
        `Telephony number '${phoneNumber.id}' does not belong to connection '${connection.id}'.`,
      );
    }

    if (phoneNumber.publishedVersionId === undefined) {
      throw new ConflictException(
        "Assign a published workflow route to the phone number before running a test call.",
      );
    }

    return this.dispatchInboundCall({
      organizationId: input.organizationId,
      toPhoneNumber: phoneNumber.phoneNumber,
      fromPhoneNumber: input.fromPhoneNumber,
      callSid: input.callSid,
      source: "manual",
      testCall: true,
    });
  }

  async rotateCredentialEnvelopes(input: {
    organizationId: string;
    actorUserId?: string | undefined;
  }) {
    const state = await this.getOrCreateState(input.organizationId);
    const rotatedConnectionIds = [...state.credentialVault.entries()]
      .filter(([, credential]) => hasStoredCredentialMaterial(credential))
      .map(([connectionId]) => connectionId);

    state.connections = state.connections.map((connection) =>
      rotatedConnectionIds.includes(connection.id) && connection.credentialReference !== undefined
        ? {
            ...connection,
            credentialReference: {
              ...connection.credentialReference,
              keyVersion: this.secretVault.currentKeyVersion,
            },
          }
        : connection,
    );
    await this.persistState(state);
    if (this.auditLogService !== undefined) {
      await this.auditLogService.record({
        tenantId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "telephony.credentials_rotated",
        target: {
          type: "telephony_credentials",
          id: input.organizationId,
        },
        outcome: "succeeded",
        metadata: {
          rotatedConnectionCount: rotatedConnectionIds.length,
        },
      });
    }

    return {
      state: cloneState(state),
      rotatedConnectionCount: rotatedConnectionIds.length,
    };
  }

  async deleteRetainedCallData(input: { organizationId: string; retainAfter: string }) {
    const state = await this.getOrCreateState(input.organizationId);
    const dispatchesBefore = state.dispatches.length;
    const callControlEventsBefore = state.callControlEvents.length;

    state.dispatches = state.dispatches.filter(
      (dispatch) => !isBeforeTimestamp(dispatch.createdAt, input.retainAfter),
    );
    state.executionSessions = state.executionSessions.filter(
      (session) => !isBeforeTimestamp(session.createdAt, input.retainAfter),
    );
    state.executionCommands = state.executionCommands.filter(
      (command) => !isBeforeTimestamp(command.requestedAt, input.retainAfter),
    );
    state.callControlEvents = state.callControlEvents.filter(
      (event) => !isBeforeTimestamp(event.at, input.retainAfter),
    );
    state.webhookEvents = state.webhookEvents.filter(
      (event) => !isBeforeTimestamp(event.receivedAt, input.retainAfter),
    );
    await this.persistState(state);

    return {
      organizationId: input.organizationId,
      retainAfter: input.retainAfter,
      deletedCounts: {
        calls: dispatchesBefore - state.dispatches.length,
        transcripts: callControlEventsBefore - state.callControlEvents.length,
      },
    };
  }

  async runScheduledHeartbeatSweep() {
    const organizationIds = new Set([
      ...this.stateByOrganizationId.keys(),
      ...(await this.stateRepository.listOrganizationIds()),
    ]);
    const heartbeats: TelephonyProviderHeartbeat[] = [];

    for (const organizationId of organizationIds) {
      const state = await this.getOrCreateState(organizationId);
      for (const connection of state.connections) {
        const heartbeatResponse = await this.runConnectionHeartbeat({
          organizationId,
          connectionId: connection.id,
          scheduled: true,
        });
        heartbeats.push(heartbeatResponse.heartbeat);
      }
    }

    return {
      heartbeats,
    };
  }

  async authorizeTwilioMediaStream(input: { callSessionId: string }) {
    const organizationIds = new Set([
      ...this.stateByOrganizationId.keys(),
      ...(await this.stateRepository.listOrganizationIds()),
    ]);

    for (const organizationId of organizationIds) {
      const state = await this.getOrCreateState(organizationId);
      const session = state.executionSessions.find(
        (candidate) =>
          candidate.callSessionId === input.callSessionId &&
          candidate.bridgeKind === "twilio-programmable-voice" &&
          candidate.direction === "inbound" &&
          candidate.status !== "blocked" &&
          candidate.status !== "completed",
      );

      if (session === undefined) {
        continue;
      }

      const expectedCallSid = deriveTwilioCallSidFromSession(input.callSessionId);
      if (expectedCallSid === undefined) {
        continue;
      }

      return {
        organizationId,
        dispatchId: session.dispatchId,
        connectionId: session.connectionId,
        callSessionId: session.callSessionId,
        expectedCallSid,
      };
    }

    return null;
  }

  async recordTwilioMediaStreamLifecycle(input: {
    organizationId: string;
    callSessionId: string;
    streamSid: string;
    status: "active" | "completed";
    at?: string | undefined;
  }) {
    const state = await this.getOrCreateState(input.organizationId);
    const session = state.executionSessions.find(
      (candidate) => candidate.callSessionId === input.callSessionId,
    );
    if (session === undefined) {
      return;
    }

    const diagnostic =
      input.status === "active"
        ? `Twilio Media Stream ${input.streamSid} connected to the PSTN bridge.`
        : `Twilio Media Stream ${input.streamSid} stopped cleanly.`;
    state.executionSessions = upsertExecutionSession(state.executionSessions, {
      ...session,
      status: input.status,
      diagnostics: [...session.diagnostics, diagnostic].slice(-12),
      updatedAt: input.at ?? new Date().toISOString(),
    });
    await this.persistState(state);
  }

  async recordCallControlEvent(input: {
    organizationId: string;
    callSessionId: string;
    dispatchId: string;
    eventType:
      | "dtmf.received"
      | "voicemail.detected"
      | "transfer.requested"
      | "transfer.failed"
      | "failover.triggered"
      | "callback.scheduled";
    digit?: string | undefined;
    transferTarget?: string | undefined;
    fallbackTarget?: string | undefined;
    callbackNumber?: string | undefined;
    actorUserId?: string | undefined;
    callerMessage?: string | undefined;
    at?: string | undefined;
  }) {
    const state = await this.getOrCreateState(input.organizationId);
    const dispatch = state.dispatches.find(
      (candidate) =>
        candidate.id === input.dispatchId &&
        candidate.callSessionId === input.callSessionId &&
        candidate.tenantId === input.organizationId,
    );

    if (dispatch === undefined) {
      throw new NotFoundException(
        `Telephony dispatch '${input.dispatchId}' was not found for call '${input.callSessionId}'.`,
      );
    }

    const event = createTelephonyCallControlEvent({
      tenantId: input.organizationId,
      dispatchId: input.dispatchId,
      callSessionId: input.callSessionId,
      eventType: input.eventType,
      digit: input.digit,
      transferTarget: input.transferTarget,
      fallbackTarget: input.fallbackTarget,
      callbackNumber: input.callbackNumber,
      actorUserId: input.actorUserId,
      callerMessage: input.callerMessage,
      at: input.at,
    });

    state.callControlEvents = [event, ...state.callControlEvents].slice(0, 60);
    const existingSession = state.executionSessions.find(
      (candidate) =>
        candidate.callSessionId === input.callSessionId && candidate.dispatchId === input.dispatchId,
    );
    const session =
      existingSession === undefined
        ? null
        : applyTelephonyCallControlEventToSession({
            session: existingSession,
            event,
          });
    const commands =
      session === null
        ? []
        : createTelephonyCallControlCommands({
            session,
            event,
          });
    if (session !== null) {
      state.executionSessions = upsertExecutionSession(state.executionSessions, session);
      state.executionCommands = upsertExecutionCommands(state.executionCommands, commands);
    }
    await this.persistState(state);

    return {
      state: cloneState(state),
      event: cloneCallControlEvent(event),
      ...(session === null ? {} : { session: cloneExecutionSession(session) }),
    };
  }

  async resolveHumanFallback(input: {
    organizationId: string;
    callSessionId: string;
    dispatchId: string;
    actorUserId: string;
    transferTarget?: string | undefined;
    callbackNumber?: string | undefined;
    now?: string | undefined;
  }) {
    const state = await this.getOrCreateState(input.organizationId);
    const dispatch = state.dispatches.find(
      (candidate) =>
        candidate.id === input.dispatchId &&
        candidate.callSessionId === input.callSessionId &&
        candidate.tenantId === input.organizationId,
    );

    if (dispatch === undefined) {
      throw new NotFoundException(
        `Telephony dispatch '${input.dispatchId}' was not found for call '${input.callSessionId}'.`,
      );
    }

    const existingSession = state.executionSessions.find(
      (candidate) =>
        candidate.callSessionId === input.callSessionId && candidate.dispatchId === input.dispatchId,
    );

    if (existingSession === undefined) {
      throw new NotFoundException(
        `Telephony execution session for call '${input.callSessionId}' was not found.`,
      );
    }

    const canTransfer = supportsLiveHumanTransfer(existingSession) && isValidE164PhoneNumber(input.transferTarget);
    const callbackNumber = resolveCallbackNumber(input.callbackNumber, dispatch.fromPhoneNumber);

    if (!canTransfer && !isValidE164PhoneNumber(callbackNumber)) {
      throw new ConflictException("Callback number is invalid or unavailable for this provider fallback.");
    }

    const action = canTransfer ? "takeover" : "callback";
    const providerCapability = canTransfer ? "live-transfer" : "callback-only";
    const callerMessage = action === "takeover" ? safeTakeoverMessage : safeCallbackMessage;
    const fallbackTarget = action === "callback" ? `Callback ${callbackNumber}` : undefined;
    const event = createTelephonyCallControlEvent({
      tenantId: input.organizationId,
      dispatchId: input.dispatchId,
      callSessionId: input.callSessionId,
      eventType: action === "takeover" ? "transfer.requested" : "callback.scheduled",
      transferTarget: action === "takeover" ? input.transferTarget : undefined,
      callbackNumber: action === "callback" ? callbackNumber : undefined,
      fallbackTarget,
      actorUserId: input.actorUserId,
      callerMessage,
      at: input.now,
    });
    const session = applyTelephonyCallControlEventToSession({
      session: existingSession,
      event,
    });
    const commands = createTelephonyCallControlCommands({
      session,
      event,
    });

    state.callControlEvents = [event, ...state.callControlEvents].slice(0, 60);
    state.executionSessions = upsertExecutionSession(state.executionSessions, session);
    state.executionCommands = upsertExecutionCommands(state.executionCommands, commands);
    await this.persistState(state);

    return {
      state: cloneState(state),
      fallback: {
        action,
        providerCapability,
        callerMessage,
        auditEventId: event.id,
      },
      event: cloneCallControlEvent(event),
      session: cloneExecutionSession(session),
    };
  }

  async handleTwilioWebhook(input: {
    signature: string | undefined;
    payload: Record<string, string>;
  }) {
    const signature = input.signature?.trim();
    if (signature === undefined || signature.length === 0) {
      throw new UnauthorizedException("Twilio webhook signature is required.");
    }

    const match = await this.findVerifiedTwilioConnection(input.payload, signature);
    if (match === undefined) {
      throw new UnauthorizedException("Unable to verify the Twilio webhook signature.");
    }

    const { organizationId, state, connection } = match;
    const eventSid = input.payload.EventSid ?? input.payload.CallSid ?? `${connection.id}:unknown-event`;
    if (state.processedWebhookEventIds.has(eventSid)) {
      return {
        duplicate: true,
        twiml: renderTwilioRejectTwiML("busy"),
      };
    }

    state.processedWebhookEventIds.add(eventSid);
    const event: TelephonyWebhookEvent = {
      id: `${connection.id}:${eventSid}`,
      tenantId: organizationId,
      connectionId: connection.id,
      accountSid: input.payload.AccountSid ?? connection.externalReference ?? "unknown",
      callSid: input.payload.CallSid ?? "unknown-call",
      eventSid,
      eventType: input.payload.EventType ?? "unknown",
      receivedAt: new Date().toISOString(),
      duplicate: false,
    };
    state.webhookEvents = [event, ...state.webhookEvents].slice(0, 50);

    if (input.payload.EventType === "incoming.call") {
      const dispatchResponse = await this.dispatchInboundCall({
        organizationId,
        toPhoneNumber: input.payload.To ?? "",
        fromPhoneNumber: input.payload.From ?? "",
        callSid: input.payload.CallSid ?? eventSid,
        source: "webhook",
      });

      return {
        duplicate: false,
        event: cloneWebhookEvent(event),
        dispatch: dispatchResponse.dispatch,
        twiml: renderTwiMLForTwilioDispatch({
          organizationId,
          connectionId: connection.id,
          dispatch: dispatchResponse.dispatch,
        }),
      };
    }

    await this.persistState(state);

    return {
      duplicate: false,
      event: cloneWebhookEvent(event),
      twiml: renderTwilioRejectTwiML("rejected"),
    };
  }

  private async findVerifiedTwilioConnection(payload: Record<string, string>, signature: string) {
    const accountSid = payload.AccountSid;
    if (accountSid === undefined) {
      return undefined;
    }

    const organizationIds = new Set([
      ...this.stateByOrganizationId.keys(),
      ...(await this.stateRepository.listOrganizationIds()),
    ]);

    for (const organizationId of organizationIds) {
      const state = await this.getOrCreateState(organizationId);

      for (const connection of state.connections) {
        if (connection.provider !== "twilio" || connection.externalReference !== accountSid) {
          continue;
        }

        const authToken = state.credentialVault.get(connection.id)?.authToken;
        if (authToken === undefined) {
          continue;
        }

        const verified = verifyTwilioWebhookSignature({
          url: localTwilioWebhookUrl,
          parameters: payload,
          authToken,
          signature,
        });

        if (verified) {
          return { organizationId, state, connection };
        }
      }
    }

    return undefined;
  }

  private async getOrCreateState(organizationId: string): Promise<TelephonyStateStore> {
    const existingState = this.stateByOrganizationId.get(organizationId);
    if (existingState !== undefined) {
      return existingState;
    }

    const persistedState = await this.stateRepository.load(organizationId);
    if (persistedState !== null) {
      const hydratedState = hydrateState(persistedState, this.secretVault);
      this.stateByOrganizationId.set(organizationId, hydratedState);
      return hydratedState;
    }

    const nextState: TelephonyStateStore = {
      organizationId,
      connections: [],
      phoneNumbers: [],
      healthChecks: [],
      providerHeartbeats: [],
      dispatches: [],
      executionSessions: [],
      executionCommands: [],
      webhookEvents: [],
      callControlEvents: [],
      credentialVault: new Map<string, TelephonyCredentialVaultEntry>(),
      processedWebhookEventIds: new Set<string>(),
    };

    this.stateByOrganizationId.set(organizationId, nextState);
    return nextState;
  }

  private async persistState(state: TelephonyStateStore) {
    await this.stateRepository.save(dehydrateState(state, this.secretVault));
  }
}

function resolveSecret(input: {
  ownershipMode: TelephonyConnectionOwnershipMode;
  authToken?: string | undefined;
  secret?: string | undefined;
}) {
  if (input.ownershipMode === "platform_managed") {
    return "platform-managed-secret";
  }

  const sharedSecret = input.authToken ?? input.secret;
  if (sharedSecret === undefined || sharedSecret.trim().length === 0) {
    throw new ConflictException("Bring-your-own telephony connections require a shared secret.");
  }

  return sharedSecret;
}

function evaluateConnectionHealth(input: {
  connection: TelephonyConnection;
  vault: TelephonyCredentialVaultEntry | undefined;
  phoneNumbers: ImportedTelephonyPhoneNumber[];
}) {
  const { connection, vault, phoneNumbers } = input;
  switch (connection.ownershipMode) {
    case "platform_managed":
      return {
        status: "healthy" as const,
        message: `${connection.label} is ready to provision Zara-managed numbers.`,
      };
    case "byo_provider_account":
      if (connection.provider !== "twilio") {
        return {
          status: "failed" as const,
          message: "Only Twilio BYO provider accounts are currently supported.",
        };
      }

      if (connection.externalReference?.startsWith("AC") !== true) {
        return {
          status: "failed" as const,
          message: "Twilio validation requires a valid account SID that starts with AC.",
        };
      }

      if ((vault?.authToken?.trim().length ?? 0) === 0) {
        return {
          status: "failed" as const,
          message: "Add a Twilio auth token before validating the provider account.",
        };
      }

      return {
        status: "healthy" as const,
        message: `${connection.label} passed the provider credential check.`,
      };
    case "byo_sip_trunk": {
      if ((connection.sip?.domain.trim().length ?? 0) === 0) {
        return {
          status: "failed" as const,
          message: "Add a SIP domain before validating the trunk.",
        };
      }

      if ((vault?.username?.trim().length ?? 0) === 0) {
        return {
          status: "failed" as const,
          message: "Add a SIP username before validating the trunk.",
        };
      }

      if ((vault?.secret?.trim().length ?? 0) === 0) {
        return {
          status: "failed" as const,
          message: "Add a SIP secret before validating the trunk.",
        };
      }

      const dids = phoneNumbers.filter((candidate) => candidate.connectionId === connection.id);
      if (dids.length === 0) {
        return {
          status: "warning" as const,
          message: "Attach at least one SIP DID before validating route health.",
        };
      }

      const routedDids = dids.filter((candidate) => candidate.status === "routed");
      if (routedDids.length === 0) {
        return {
          status: "warning" as const,
          message: "Add a published workflow route to a SIP DID before sending live traffic.",
        };
      }

      return {
        status: "healthy" as const,
        message: `${connection.label} validated with ${routedDids.length} routed DID${routedDids.length === 1 ? "" : "s"}.`,
      };
    }
  }
}

function requireConnection(
  state: TelephonyStateStore,
  organizationId: string,
  connectionId: string,
) {
  const connection = state.connections.find(
    (candidate) => candidate.id === connectionId && candidate.tenantId === organizationId,
  );

  if (connection === undefined) {
    throw new NotFoundException(`Telephony connection '${connectionId}' was not found.`);
  }

  return connection;
}

function requirePhoneNumber(
  state: TelephonyStateStore,
  organizationId: string,
  numberId: string,
) {
  const phoneNumber = state.phoneNumbers.find(
    (candidate) => candidate.id === numberId && candidate.tenantId === organizationId,
  );

  if (phoneNumber === undefined) {
    throw new NotFoundException(`Telephony number '${numberId}' was not found.`);
  }

  return phoneNumber;
}

function buildAvailableTwilioNumbers(seed: string) {
  const digits = seed.replace(/\D+/g, "").slice(-4).padStart(4, "0");

  return [
    {
      sid: `PN${digits}1001`,
      phoneNumber: `+1415555${digits}`,
      friendlyName: "Support line",
      capabilities: {
        voice: true,
        sms: true,
      },
    },
    {
      sid: `PN${digits}2002`,
      phoneNumber: `+1415666${digits}`,
      friendlyName: "Reception line",
      capabilities: {
        voice: true,
        sms: false,
      },
    },
    {
      sid: `PN${digits}3003`,
      phoneNumber: `+1415777${digits}`,
      friendlyName: "SMS campaigns",
      capabilities: {
        voice: false,
        sms: true,
      },
    },
  ];
}

function buildDispatchRecord(input: {
  organizationId: string;
  resolution: InboundCallResolution;
  toPhoneNumber: string;
  fromPhoneNumber: string;
  source: "manual" | "webhook";
}): TelephonyDispatchRecord {
  return {
    id: `${input.resolution.callSessionId ?? input.resolution.phoneNumberId ?? "dispatch"}:${input.source}`,
    tenantId: input.organizationId,
    direction: "inbound",
    toPhoneNumber: input.toPhoneNumber,
    fromPhoneNumber: input.fromPhoneNumber,
    createdAt: new Date().toISOString(),
    source: input.source,
    ...input.resolution,
  };
}

function buildOutboundDispatchRecord(input: {
  organizationId: string;
  resolution: ReturnType<typeof resolveOutboundCall>;
  toPhoneNumber: string;
  fromPhoneNumber: string;
  now?: string | undefined;
}): TelephonyDispatchRecord {
  return {
    id: `${input.resolution.callSessionId ?? input.resolution.phoneNumberId ?? "outbound"}:manual`,
    tenantId: input.organizationId,
    direction: "outbound",
    toPhoneNumber: input.toPhoneNumber,
    fromPhoneNumber: input.fromPhoneNumber,
    createdAt: input.now ?? new Date().toISOString(),
    source: "manual",
    ...input.resolution,
  };
}

function buildExecutionArtifacts(input: {
  state: TelephonyStateStore;
  organizationId: string;
  dispatch: TelephonyDispatchRecord;
  testCall: boolean;
  now: string;
}) {
  if (
    input.dispatch.callSessionId === undefined ||
    input.dispatch.connectionId === undefined ||
    (input.dispatch.disposition !== "routed" &&
      input.dispatch.disposition !== "fallback" &&
      input.dispatch.disposition !== "queued")
  ) {
    return null;
  }

  const connection = input.state.connections.find(
    (candidate) =>
      candidate.id === input.dispatch.connectionId &&
      candidate.tenantId === input.organizationId,
  );

  if (connection === undefined) {
    return null;
  }

  const session = createTelephonyExecutionSession({
    tenantId: input.organizationId,
    dispatchId: input.dispatch.id,
    connection,
    direction: input.dispatch.direction,
    disposition: input.dispatch.disposition,
    toPhoneNumber: input.dispatch.toPhoneNumber,
    fromPhoneNumber: input.dispatch.fromPhoneNumber,
    callSessionId: input.dispatch.callSessionId,
    workflowLabel: input.dispatch.workflowLabel,
    workspaceId: input.dispatch.workspaceId,
    testCall: input.testCall,
    outageMode: input.dispatch.outageMode,
    recordingConsent: input.dispatch.recordingConsent,
    now: input.now,
  });

  return {
    session,
    commands: createTelephonyExecutionCommands({
      session,
      connection,
      now: input.now,
    }),
  };
}

function renderTwiMLForTwilioDispatch(input: {
  organizationId: string;
  connectionId: string;
  dispatch: TelephonyDispatchRecord;
}) {
  if (
    input.dispatch.disposition !== "routed" ||
    input.dispatch.callSessionId === undefined ||
    input.dispatch.publishedVersionId === undefined
  ) {
    return renderTwilioRejectTwiML("busy");
  }

  return renderTwilioConnectStreamTwiML({
    mediaStreamBaseUrl: localTwilioMediaStreamBaseUrl,
    callSessionId: input.dispatch.callSessionId,
    organizationId: input.organizationId,
    connectionId: input.connectionId,
    publishedVersionId: input.dispatch.publishedVersionId,
    ...(input.dispatch.workspaceId === undefined
      ? {}
      : { workspaceId: input.dispatch.workspaceId }),
  });
}

function resolveHeartbeatLatency(connection: TelephonyConnection) {
  switch (connection.ownershipMode) {
    case "platform_managed":
      return 84;
    case "byo_provider_account":
      return 112;
    case "byo_sip_trunk":
      return 96;
  }
}

function upsertExecutionSession(
  sessions: TelephonyExecutionSession[],
  session: TelephonyExecutionSession,
) {
  return [
    session,
    ...sessions.filter((candidate) => candidate.callSessionId !== session.callSessionId),
  ].slice(0, 40);
}

function upsertExecutionCommands(
  commands: TelephonyExecutionCommand[],
  nextCommands: TelephonyExecutionCommand[],
) {
  return [
    ...nextCommands,
    ...commands.filter(
      (candidate) => nextCommands.some((nextCommand) => nextCommand.id === candidate.id) === false,
    ),
  ].slice(0, 80);
}

function hasStoredCredentialMaterial(
  credential: TelephonyCredentialVaultEntry | undefined,
) {
  if (credential === undefined) {
    return false;
  }

  return Object.values(credential).some(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
}

function hydrateState(
  persistedState: PersistedTelephonyStateRecord,
  secretVault: TelephonySecretVault,
): TelephonyStateStore {
  const credentialVault = new Map<string, TelephonyCredentialVaultEntry>();
  const degradedConnectionIds = new Set<string>();

  for (const credential of persistedState.credentials) {
    try {
      credentialVault.set(credential.connectionId, secretVault.open(credential.envelope));
    } catch {
      degradedConnectionIds.add(credential.connectionId);
    }
  }

  const connections = persistedState.connections.map((connection) =>
    degradedConnectionIds.has(connection.id)
      ? {
          ...cloneConnection(connection),
          status: "degraded" as const,
          healthStatus: "failed" as const,
          ...(connection.credentialReference === undefined
            ? {}
            : {
                credentialReference: {
                  ...connection.credentialReference,
                  preview: "unavailable",
                },
              }),
        }
      : cloneConnection(connection),
  );
  const recoveredHealthChecks = connections
    .filter((connection) => degradedConnectionIds.has(connection.id))
    .map((connection, index) => ({
      id: `${connection.id}:health:recover:${index + 1}`,
      connectionId: connection.id,
      status: "failed" as const,
      blocking: connection.blockRoutingOnHealthFailure,
      checkedAt: new Date().toISOString(),
      message: `${connection.label} credentials could not be decrypted. Reconnect or rotate secrets before routing traffic.`,
      scheduled: false,
      latencyMs: 0,
      diagnostics: ["Stored credential envelope could not be decrypted with the available key material."],
    }));

  return {
    organizationId: persistedState.organizationId,
    connections,
    phoneNumbers: persistedState.phoneNumbers.map(clonePhoneNumber),
    healthChecks: [
      ...recoveredHealthChecks,
      ...persistedState.healthChecks.map(cloneHealthCheck),
    ].slice(0, 20),
    providerHeartbeats: (persistedState.providerHeartbeats ?? []).map(cloneProviderHeartbeat),
    dispatches: persistedState.dispatches.map(cloneDispatch),
    executionSessions: (persistedState.executionSessions ?? []).map(cloneExecutionSession),
    executionCommands: (persistedState.executionCommands ?? []).map(cloneExecutionCommand),
    webhookEvents: persistedState.webhookEvents.map(cloneWebhookEvent),
    callControlEvents: (persistedState.callControlEvents ?? []).map(cloneCallControlEvent),
    credentialVault,
    processedWebhookEventIds: new Set(persistedState.processedWebhookEventIds),
  };
}

function dehydrateState(
  state: TelephonyStateStore,
  secretVault: TelephonySecretVault,
): PersistedTelephonyStateRecord {
  return {
    schemaVersion: 1,
    organizationId: state.organizationId,
    connections: state.connections.map(cloneConnection),
    phoneNumbers: state.phoneNumbers.map(clonePhoneNumber),
    healthChecks: state.healthChecks.map(cloneHealthCheck),
    providerHeartbeats: state.providerHeartbeats.map(cloneProviderHeartbeat),
    dispatches: state.dispatches.map(cloneDispatch),
    executionSessions: state.executionSessions.map(cloneExecutionSession),
    executionCommands: state.executionCommands.map(cloneExecutionCommand),
    webhookEvents: state.webhookEvents.map(cloneWebhookEvent),
    callControlEvents: state.callControlEvents.map(cloneCallControlEvent),
    credentials: [...state.credentialVault.entries()].map(([connectionId, credential]) => ({
      connectionId,
      envelope: secretVault.seal(credential),
    })),
    processedWebhookEventIds: [...state.processedWebhookEventIds.values()],
  };
}

function cloneState(state: TelephonyStateStore): TelephonyStateResponse {
  return {
    organizationId: state.organizationId,
    connections: state.connections.map(cloneConnection),
    phoneNumbers: state.phoneNumbers.map(clonePhoneNumber),
    healthChecks: state.healthChecks.map(cloneHealthCheck),
    providerHeartbeats: state.providerHeartbeats.map(cloneProviderHeartbeat),
    dispatches: state.dispatches.map(cloneDispatch),
    executionSessions: state.executionSessions.map(cloneExecutionSession),
    executionCommands: state.executionCommands.map(cloneExecutionCommand),
    webhookEvents: state.webhookEvents.map(cloneWebhookEvent),
    callControlEvents: state.callControlEvents.map(cloneCallControlEvent),
  };
}

function cloneConnection(connection: TelephonyConnection): TelephonyConnection {
  return {
    ...connection,
    recordingPolicy: {
      ...connection.recordingPolicy,
    },
    ...(connection.credentialReference === undefined
      ? {}
      : {
          credentialReference: {
            ...connection.credentialReference,
          },
        }),
    ...(connection.sip === undefined
      ? {}
      : {
          sip: {
            ...connection.sip,
            codecs: [...connection.sip.codecs],
          },
        }),
  };
}

function clonePhoneNumber(phoneNumber: ImportedTelephonyPhoneNumber): ImportedTelephonyPhoneNumber {
  return {
    ...phoneNumber,
    ...(phoneNumber.recordingPolicy === undefined
      ? {}
      : {
          recordingPolicy: {
            ...phoneNumber.recordingPolicy,
          },
        }),
  };
}

function cloneHealthCheck(healthCheck: TelephonyHealthCheck): TelephonyHealthCheck {
  return {
    ...healthCheck,
    ...(healthCheck.diagnostics === undefined
      ? {}
      : { diagnostics: [...healthCheck.diagnostics] }),
  };
}

function cloneDispatch(dispatch: TelephonyDispatchRecord): TelephonyDispatchRecord {
  return {
    ...dispatch,
    recording: {
      ...dispatch.recording,
    },
    recordingConsent: cloneRecordingConsent(
      dispatch.recordingConsent,
      dispatch.recording,
      dispatch.createdAt,
    ),
    ...(dispatch.policyChecks === undefined
      ? {}
      : {
          policyChecks: {
            consent: { ...dispatch.policyChecks.consent },
            budget: { ...dispatch.policyChecks.budget },
            callingWindow: { ...dispatch.policyChecks.callingWindow },
            callerId: { ...dispatch.policyChecks.callerId },
            dnc: {
              ...(dispatch.policyChecks.dnc ?? {
                status: "passed" as const,
                detail: "Destination is not on the tenant do-not-call list.",
              }),
            },
            timezone: {
              ...(dispatch.policyChecks.timezone ?? {
                status: "passed" as const,
                detail: "Destination timezone is known for safe calling.",
              }),
            },
            abuse: {
              ...(dispatch.policyChecks.abuse ?? {
                status: "passed" as const,
                detail: "Outbound abuse policy passed.",
              }),
            },
          },
        }),
  };
}

function cloneRecordingConsent(
  consent: TelephonyDispatchRecord["recordingConsent"] | undefined,
  recording: TelephonyDispatchRecord["recording"],
  recordedAt: string,
) {
  if (consent !== undefined) {
    return {
      ...consent,
    };
  }

  if (!recording.enabled || recording.consentMode === "disabled") {
    return {
      state: "recording_disabled" as const,
      noticeRequired: false,
      consentMode: recording.consentMode,
      message: recording.consentMessage,
      recordedAt,
      reason: "Recording is disabled for this call.",
    };
  }

  if (recording.consentMode === "two-party") {
    return {
      state: "notice_queued" as const,
      noticeRequired: true,
      consentMode: recording.consentMode,
      message: recording.consentMessage,
      recordedAt,
      reason: "Two-party recording consent requires a notice before call recording.",
    };
  }

  return {
    state: "not_required" as const,
    noticeRequired: false,
    consentMode: recording.consentMode,
    message: recording.consentMessage,
    recordedAt,
    reason: "Single-party recording policy does not require a pre-recording notice.",
  };
}

function cloneProviderHeartbeat(
  heartbeat: TelephonyProviderHeartbeat,
): TelephonyProviderHeartbeat {
  return {
    ...heartbeat,
    diagnostics: [...heartbeat.diagnostics],
  };
}

function cloneExecutionSession(
  session: TelephonyExecutionSession,
): TelephonyExecutionSession {
  return {
    ...session,
    ...(session.recordingConsent === undefined
      ? {}
      : {
          recordingConsent: {
            ...session.recordingConsent,
          },
        }),
    diagnostics: [...session.diagnostics],
  };
}

function cloneExecutionCommand(
  command: TelephonyExecutionCommand,
): TelephonyExecutionCommand {
  return {
    ...command,
    payload: {
      ...command.payload,
    },
  };
}

function isBeforeTimestamp(timestamp: string, cutoff: string) {
  return new Date(timestamp).getTime() < new Date(cutoff).getTime();
}

function evaluateOutboundAbusePolicy(input: {
  state: TelephonyStateStore;
  now: string;
  policy?: TelephonyOutboundAbusePolicy | undefined;
}) {
  if (input.policy === undefined) {
    return {
      allowed: true,
      recentOutboundCallCount: 0,
    };
  }

  const nowMs = Date.parse(input.now);
  const windowStartMs = nowMs - input.policy.windowSeconds * 1000;
  const recentOutboundCallCount = input.state.dispatches.filter((dispatch) => {
    const createdAtMs = Date.parse(dispatch.createdAt);

    return (
      dispatch.direction === "outbound" &&
      dispatch.disposition === "queued" &&
      createdAtMs >= windowStartMs &&
      createdAtMs <= nowMs
    );
  }).length;

  if (recentOutboundCallCount >= input.policy.maxCallsPerWindow) {
    return {
      allowed: false,
      recentOutboundCallCount,
      reason: "Outbound abuse rate limit exceeded for this tenant.",
    };
  }

  return {
    allowed: true,
    recentOutboundCallCount,
  };
}

function evaluateOutboundCompliancePolicy(input: {
  toPhoneNumber: string;
  localHour: number;
  policy?: TelephonyOutboundCompliancePolicy | undefined;
}) {
  if (input.policy === undefined) {
    return {
      dncAllowed: true,
      timezoneAllowed: true,
      timezoneDetail: "Destination timezone is known for safe calling.",
      overrideAllowed: false,
    };
  }

  const normalizedDestination = normalizePhoneNumber(input.toPhoneNumber);
  const dncBlocked = input.policy.dncPhoneNumbers
    .map(normalizePhoneNumber)
    .includes(normalizedDestination);
  const timezone = input.policy.timezone?.trim();
  const localTime = input.policy.localTime?.trim();
  const overrideAllowed = isValidComplianceOverride(input.policy.override);

  if (dncBlocked) {
    return {
      dncAllowed: false,
      dncBlockedReason: "Outbound call blocked because the destination is on the tenant do-not-call list.",
      timezoneAllowed: timezone !== undefined && timezone.length > 0 && localTime !== undefined && localTime.length > 0,
      timezoneDetail: buildTimezoneDetail(timezone, localTime, input.localHour),
      timezoneBlockedReason: "Destination timezone is required before outbound calling.",
      overrideAllowed: false,
    };
  }

  if (timezone === undefined || timezone.length === 0 || localTime === undefined || localTime.length === 0) {
    return {
      dncAllowed: true,
      timezoneAllowed: false,
      timezoneBlockedReason: "Destination timezone is required before outbound calling.",
      overrideAllowed: false,
    };
  }

  return {
    dncAllowed: true,
    timezoneAllowed: true,
    timezoneDetail: buildTimezoneDetail(timezone, localTime, input.localHour),
    overrideAllowed,
  };
}

function buildTimezoneDetail(
  timezone: string | undefined,
  localTime: string | undefined,
  localHour: number,
) {
  if (timezone === undefined || localTime === undefined) {
    return "Destination timezone is required before outbound calling.";
  }

  return `Destination timezone ${timezone} resolved local time ${localTime} at hour ${localHour}:00.`;
}

function isValidComplianceOverride(
  override: TelephonyOutboundCompliancePolicy["override"] | undefined,
) {
  return (
    override !== undefined &&
    override.reason.trim().length > 0 &&
    override.approvedByUserId.trim().length > 0
  );
}

function normalizePhoneNumber(value: string) {
  return value.replace(/[^\d+]/g, "");
}

function cloneWebhookEvent(event: TelephonyWebhookEvent): TelephonyWebhookEvent {
  return {
    ...event,
  };
}

function cloneCallControlEvent(
  event: TelephonyCallControlEvent,
): TelephonyCallControlEvent {
  return {
    ...event,
    payload: {
      ...event.payload,
    },
  };
}

function supportsLiveHumanTransfer(session: TelephonyExecutionSession) {
  return session.bridgeKind === "platform-edge" || session.bridgeKind === "twilio-programmable-voice";
}

function resolveCallbackNumber(
  requestedCallbackNumber: string | undefined,
  dispatchFromNumber: string,
) {
  return requestedCallbackNumber?.trim() ?? dispatchFromNumber;
}

function deriveTwilioCallSidFromSession(callSessionId: string) {
  return callSessionId.endsWith(":telephony")
    ? callSessionId.slice(0, -":telephony".length)
    : undefined;
}

function isValidE164PhoneNumber(value: string | undefined) {
  return value !== undefined && /^\+[1-9]\d{7,14}$/.test(value);
}
