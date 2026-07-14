import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import {
  applyTelephonyCallControlEventToSession,
  applyTelephonyActiveCallPolicy,
  assignTelephonyNumberRoute,
  activateTelephonyLiveRoute,
  createPstnTestRoute,
  completePstnPhoneTest,
  createTelephonyCallControlEvent,
  createTelephonyConnection,
  deleteTelephonyPhoneNumber,
  createTelephonyCallControlCommands,
  createTelephonyExecutionCommands,
  createTelephonyExecutionSession,
  createTelephonyProviderHeartbeat,
  defaultRecordingPolicy,
  importTwilioPhoneNumbers,
  provisionTelephonyPhoneNumber,
  resolveInboundCall,
  resolveOutboundCall,
  recordPstnPhoneTestCheckpoint,
  pauseTelephonyLiveRoute,
  resumeTelephonyLiveRoute,
  verifyTwilioWebhookSignature,
  evaluateTelephonyLiveRouteActivation,
  type ImportedTelephonyPhoneNumber,
  type InboundCallPolicyChecks,
  type InboundCallResolution,
  type OutboundCallPolicyChecks,
  type OutboundCallResolution,
  type PstnPremiumRealtimeCallStartPolicy,
  type RuntimeProfileId,
  type TelephonyPhoneTestCheckpoint,
  type TelephonyCallControlEvent,
  type TelephonyConnection,
  type TelephonyConnectionOwnershipMode,
  type TelephonyExecutionCommand,
  type TelephonyExecutionSession,
  type TelephonyLiveRouteActivationOverride,
  type TelephonyLiveRoutePolicyPosture,
  type TelephonyProvider,
  type TelephonyProviderHeartbeat,
  type TelephonyRecordingPolicy,
  type TelephonySubscriptionPosture,
  type TelephonyBudgetPosture,
  type TelephonyTenantPosture,
} from "@zara/core";

import { BillingService } from "../billing/billing.service";
import type { TenantBillingStateResponse } from "../billing/billing.models";
import { AuditLogService } from "../compliance/audit-log.service";
import {
  pstnCallObservabilityRecorderToken,
  type PstnCallObservabilityRecorder,
  type PstnCallObservabilityEvent,
} from "../runtime-observability/runtime-observability";
import type {
  TelephonyCredentialVaultEntry,
  TelephonyDispatchRecord,
  TelephonyOutboundAbusePolicy,
  TelephonyOutboundCompliancePolicy,
  TelephonyHealthCheck,
  TelephonyMediaStreamTokenRecord,
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
  TWILIO_NUMBER_INVENTORY_PROVIDER,
  type TwilioNumberInventoryProvider,
} from "./twilio-number-inventory.provider";
import {
  TWILIO_NUMBER_ROUTING_PROVIDER,
  type TwilioMonitorAlertDiagnostic,
  type TwilioNumberRoutingProvider,
  type TwilioRecentCallDiagnostic,
} from "./twilio-number-routing.provider";
import {
  logTwilioPstnDiagnostic,
  safeTwilioDiagnosticErrorMessage,
  warnTwilioPstnDiagnostic,
} from "./twilio-pstn-diagnostics";
import {
  renderTwilioConnectStreamTwiML,
  renderTwilioUnavailableTwiML,
  renderTwilioRejectTwiML,
} from "./twilio-media-streams.bridge";
import {
  createOneTimeStreamToken,
  hashOneTimeStreamToken,
  resolveOneTimeStreamTokenSecret,
  verifyOneTimeStreamToken,
} from "../security/one-time-stream-token";

const localTwilioWebhookUrl = "http://127.0.0.1/telephony/webhooks/twilio";
const localTwilioMediaStreamBaseUrl = "wss://127.0.0.1/telephony/twilio/media-streams";
const twilioMediaStreamTokenTtlMs = 5 * 60 * 1000;
const safeTakeoverMessage =
  "I am connecting you with a specialist now. If the transfer drops, we will call you back using the number on this call.";
const safeCallbackMessage =
  "A specialist is not available on this line right now. We will call you back at the number we have for this call.";

@Injectable()
export class TelephonyService implements OnModuleInit, OnModuleDestroy {
  private readonly stateByOrganizationId = new Map<string, TelephonyStateStore>();
  private readonly mediaStreamTokenSecret = resolveOneTimeStreamTokenSecret();
  private readonly logger = new Logger(TelephonyService.name);
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(TELEPHONY_STATE_REPOSITORY)
    private readonly stateRepository: TelephonyStateRepository,
    private readonly secretVault: TelephonySecretVault,
    @Inject(TWILIO_NUMBER_INVENTORY_PROVIDER)
    private readonly twilioNumberInventory: TwilioNumberInventoryProvider,
    @Inject(TWILIO_NUMBER_ROUTING_PROVIDER)
    private readonly twilioNumberRouting: TwilioNumberRoutingProvider,
    @Optional()
    private readonly auditLogService?: AuditLogService,
    @Optional()
    private readonly billingService?: BillingService,
    @Optional()
    @Inject(pstnCallObservabilityRecorderToken)
    private readonly pstnObservabilityRecorder?: PstnCallObservabilityRecorder,
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
      webhookBaseUrl: resolveTwilioWebhookUrl(),
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

  async validateTwilioCredentials(input: {
    organizationId: string;
    accountSid: string;
    authToken: string;
  }) {
    const accountSid = input.accountSid.trim();
    const authToken = input.authToken.trim();

    if (!accountSid.startsWith("AC") || authToken.length === 0) {
      throw new ConflictException("Enter a valid Twilio Account SID and Auth token.");
    }

    const numbers = await this.fetchTwilioInventory({ accountSid, authToken });

    return {
      valid: true,
      numberCount: numbers.length,
    };
  }

  async deleteConnection(input: {
    organizationId: string;
    connectionId: string;
    actorUserId?: string | undefined;
  }) {
    const state = await this.getOrCreateState(input.organizationId);
    const connection = requireConnection(state, input.organizationId, input.connectionId);
    const connectionSessionIds = new Set(
      state.executionSessions
        .filter((session) => session.connectionId === connection.id)
        .map((session) => session.id),
    );

    state.connections = state.connections.filter((candidate) => candidate.id !== connection.id);
    state.phoneNumbers = state.phoneNumbers.filter(
      (phoneNumber) => phoneNumber.connectionId !== connection.id,
    );
    state.healthChecks = state.healthChecks.filter(
      (healthCheck) => healthCheck.connectionId !== connection.id,
    );
    state.providerHeartbeats = state.providerHeartbeats.filter(
      (heartbeat) => heartbeat.connectionId !== connection.id,
    );
    state.executionSessions = state.executionSessions.filter(
      (session) => session.connectionId !== connection.id,
    );
    state.executionCommands = state.executionCommands.filter(
      (command) => !connectionSessionIds.has(command.sessionId),
    );
    state.webhookEvents = state.webhookEvents.filter(
      (event) => event.connectionId !== connection.id,
    );
    state.mediaStreamTokens = state.mediaStreamTokens.filter(
      (token) => token.connectionId !== connection.id,
    );
    state.credentialVault.delete(connection.id);
    await this.persistState(state);

    if (this.auditLogService !== undefined) {
      await this.auditLogService.record({
        tenantId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "telephony.connection_deleted",
        target: {
          type: "telephony_connection",
          id: connection.id,
        },
        outcome: "succeeded",
        metadata: {
          provider: connection.provider,
          ownershipMode: connection.ownershipMode,
          label: connection.label,
        },
      });
    }

    return {
      state: cloneState(state),
      deletedConnectionId: connection.id,
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
    await this.logTwilioProviderDiagnostics({
      organizationId: input.organizationId,
      connection,
      state,
      reason: "heartbeat",
      scheduled: input.scheduled,
    });

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

    if (connection.ownershipMode !== "byo_provider_account") {
      throw new ConflictException("Twilio number import requires a connected bring-your-own Twilio account.");
    }

    const credential = state.credentialVault.get(connection.id);
    const accountSid = (connection.externalReference ?? credential?.accountSid)?.trim();
    const authToken = (credential?.authToken ?? credential?.secret)?.trim();

    if (
      accountSid === undefined ||
      accountSid.startsWith("AC") === false ||
      authToken === undefined ||
      authToken.length === 0
    ) {
      throw new ConflictException("Twilio number import requires connected account credentials.");
    }

    const availableNumbers = await this.fetchTwilioInventory({
      accountSid,
      authToken,
    });
    const importedNumbers = importTwilioPhoneNumbers({
      tenantId: input.organizationId,
      connectionId: input.connectionId,
      existingNumbers: state.phoneNumbers,
      availableNumbers,
    });

    state.phoneNumbers = [...state.phoneNumbers, ...importedNumbers];
    await this.persistState(state);

    return {
      state: cloneState(state),
      importedNumbers: importedNumbers.map(clonePhoneNumber),
    };
  }

  private async fetchTwilioInventory(input: {
    accountSid: string;
    authToken: string;
  }) {
    try {
      return await this.twilioNumberInventory.listIncomingPhoneNumbers(input);
    } catch (error) {
      throw new ConflictException(resolveSafeTwilioInventoryMessage(error));
    }
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

  async deletePhoneNumber(input: {
    organizationId: string;
    numberId: string;
    actorUserId: string;
  }) {
    const state = await this.getOrCreateState(input.organizationId);
    const phoneNumber = requirePhoneNumber(state, input.organizationId, input.numberId);

    state.phoneNumbers = deleteTelephonyPhoneNumber({
      phoneNumbers: state.phoneNumbers,
      tenantId: input.organizationId,
      numberId: input.numberId,
    });
    await this.persistState(state);

    if (this.auditLogService !== undefined) {
      await this.auditLogService.record({
        tenantId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "telephony.phone_number_deleted",
        target: {
          type: "telephony_phone_number",
          id: phoneNumber.id,
        },
        outcome: "succeeded",
        metadata: {
          provider: phoneNumber.provider,
          provisionSource: phoneNumber.provisionSource,
          phoneNumber: phoneNumber.phoneNumber,
        },
      });
    }

    return {
      state: cloneState(state),
      deletedPhoneNumberId: phoneNumber.id,
    };
  }

  async assignNumberRoute(input: {
    organizationId: string;
    numberId: string;
    publishedVersionId: string;
    workflowLabel: string;
    workspaceId: string;
    runtimeProfile?: RuntimeProfileId | undefined;
    recordingPolicy?: TelephonyRecordingPolicy | undefined;
  }) {
    const state = await this.getOrCreateState(input.organizationId);
    const phoneNumber = requirePhoneNumber(state, input.organizationId, input.numberId);

    await this.configureProviderNumberWebhookForRoute({
      organizationId: input.organizationId,
      phoneNumber,
      state,
    });

    state.phoneNumbers = assignTelephonyNumberRoute({
      phoneNumbers: state.phoneNumbers,
      numberId: input.numberId,
      publishedVersionId: input.publishedVersionId,
      workflowLabel: input.workflowLabel,
      workspaceId: input.workspaceId,
      runtimeProfile: input.runtimeProfile,
      recordingPolicy: input.recordingPolicy,
    });
    await this.persistState(state);

    return {
      state: cloneState(state),
    };
  }

  async createPstnTestRoute(input: {
    organizationId: string;
    numberId: string;
    publishedVersionId: string;
    workflowLabel: string;
    workspaceId: string;
    runtimeProfile: RuntimeProfileId;
    allowedCallerNumbers: string[];
    expiresAt: string;
    now?: string | undefined;
  }) {
    const state = await this.getOrCreateState(input.organizationId);
    const phoneNumber = requirePhoneNumber(state, input.organizationId, input.numberId);

    if (input.publishedVersionId.trim().length === 0) {
      throw new ConflictException("PSTN phone tests require a published workflow version.");
    }

    try {
      state.phoneNumbers = createPstnTestRoute({
        phoneNumbers: state.phoneNumbers,
        numberId: phoneNumber.id,
        publishedVersionId: input.publishedVersionId,
        workflowLabel: input.workflowLabel,
        workspaceId: input.workspaceId,
        runtimeProfile: input.runtimeProfile,
        allowedCallerNumbers: input.allowedCallerNumbers,
        expiresAt: input.expiresAt,
        now: input.now,
      });
    } catch (error) {
      throw new ConflictException(error instanceof Error ? error.message : "Unable to create PSTN test route.");
    }

    const updatedPhoneNumber = requirePhoneNumber(state, input.organizationId, input.numberId);
    await this.persistState(state);

    return {
      state: cloneState(state),
      phoneNumber: clonePhoneNumber(updatedPhoneNumber),
    };
  }

  async completePstnTestRoute(input: {
    organizationId: string;
    numberId: string;
    sessionId: string;
    status: "failed" | "expired" | "unauthorized_caller" | "manually_ended";
    reason: string;
    at?: string | undefined;
  }) {
    const state = await this.getOrCreateState(input.organizationId);
    const phoneNumber = requirePhoneNumber(state, input.organizationId, input.numberId);

    if (phoneNumber.testRoute?.waitingSession.id !== input.sessionId) {
      throw new NotFoundException("PSTN phone test session not found.");
    }

    const shouldTerminateProviderCall =
      (input.status === "expired" || input.status === "manually_ended") &&
      isActivePstnPhoneTestSession(phoneNumber.testRoute.waitingSession.status);
    const testExecutionSession = shouldTerminateProviderCall
      ? findExecutionSessionForPstnPhoneTest({
          state,
          organizationId: input.organizationId,
          numberId: input.numberId,
          sessionId: input.sessionId,
        })
      : undefined;

    state.phoneNumbers = completePstnPhoneTest({
      phoneNumbers: state.phoneNumbers,
      numberId: input.numberId,
      sessionId: input.sessionId,
      status: input.status,
      reason: input.reason,
      at: input.at ?? new Date().toISOString(),
    });
    const updatedPhoneNumber = requirePhoneNumber(state, input.organizationId, input.numberId);
    if (testExecutionSession !== undefined) {
      await this.terminateProviderCallForExecutionSession({
        state,
        organizationId: input.organizationId,
        session: testExecutionSession,
        reason: `pstn_phone_test_${input.status}`,
      });
    }
    await this.persistState(state);

    return {
      state: cloneState(state),
      phoneNumber: clonePhoneNumber(updatedPhoneNumber),
    };
  }

  async activateLiveRoute(input: {
    organizationId: string;
    numberId: string;
    actorUserId: string;
    now?: string | undefined;
    tenantStatus?: TelephonyTenantPosture | undefined;
    override?: Omit<TelephonyLiveRouteActivationOverride, "createdAt"> | undefined;
  }) {
    const state = await this.getOrCreateState(input.organizationId);
    const phoneNumber = requirePhoneNumber(state, input.organizationId, input.numberId);
    const connection = requireConnection(state, input.organizationId, phoneNumber.connectionId);
    const now = input.now ?? new Date().toISOString();
    const policy = await this.resolveLiveRoutePolicyPosture({
      organizationId: input.organizationId,
      tenantStatus: input.tenantStatus,
    });
    const evaluation = evaluateTelephonyLiveRouteActivation({
      phoneNumbers: state.phoneNumbers,
      numberId: input.numberId,
      connection,
      now,
      policy,
      override: input.override,
    });

    if (!evaluation.allowed) {
      throw new ConflictException({
        message: "Live route activation blocked.",
        blocks: evaluation.blocks,
        summary: evaluation.summary,
      });
    }

    const activation = activateTelephonyLiveRoute({
      phoneNumbers: state.phoneNumbers,
      numberId: input.numberId,
      connection,
      actorUserId: input.actorUserId,
      now,
      policy,
      override: input.override,
    });
    state.phoneNumbers = activation.phoneNumbers;
    const updatedPhoneNumber = requirePhoneNumber(state, input.organizationId, input.numberId);
    await this.persistState(state);
    await this.auditLogService?.record({
      tenantId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "telephony.live_route_activated",
      target: {
        type: "telephony_number",
        id: input.numberId,
      },
      outcome: "succeeded",
      metadata: {
        publishedVersionId: activation.activation.summary.publishedVersionId,
        runtimeProfile: activation.activation.summary.runtimeProfile,
        providerConnectionId: activation.activation.summary.providerConnectionId,
        override: activation.activation.summary.override !== undefined,
      },
      occurredAt: now,
    });

    return {
      state: cloneState(state),
      phoneNumber: clonePhoneNumber(updatedPhoneNumber),
      activation: activation.activation,
    };
  }

  async pauseLiveRoute(input: {
    organizationId: string;
    numberId: string;
    actorUserId?: string | undefined;
    now?: string | undefined;
  }) {
    const state = await this.getOrCreateState(input.organizationId);
    requirePhoneNumber(state, input.organizationId, input.numberId);
    const now = input.now ?? new Date().toISOString();

    state.phoneNumbers = pauseTelephonyLiveRoute({
      phoneNumbers: state.phoneNumbers,
      numberId: input.numberId,
      pausedAt: now,
    });
    const updatedPhoneNumber = requirePhoneNumber(state, input.organizationId, input.numberId);
    await this.persistState(state);
    await this.auditLogService?.record({
      tenantId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "telephony.live_route_paused",
      target: {
        type: "telephony_number",
        id: input.numberId,
      },
      outcome: "succeeded",
      metadata: {
        publishedVersionId: updatedPhoneNumber.liveRoute?.publishedVersionId ?? "unknown",
      },
      occurredAt: now,
    });

    return {
      state: cloneState(state),
      phoneNumber: clonePhoneNumber(updatedPhoneNumber),
    };
  }

  async resumeLiveRoute(input: {
    organizationId: string;
    numberId: string;
    actorUserId: string;
    now?: string | undefined;
    tenantStatus?: TelephonyTenantPosture | undefined;
    override?: Omit<TelephonyLiveRouteActivationOverride, "createdAt"> | undefined;
  }) {
    const state = await this.getOrCreateState(input.organizationId);
    const phoneNumber = requirePhoneNumber(state, input.organizationId, input.numberId);
    const connection = requireConnection(state, input.organizationId, phoneNumber.connectionId);
    const now = input.now ?? new Date().toISOString();
    const policy = await this.resolveLiveRoutePolicyPosture({
      organizationId: input.organizationId,
      tenantStatus: input.tenantStatus,
    });
    const activation = resumeTelephonyLiveRoute({
      phoneNumbers: state.phoneNumbers,
      numberId: input.numberId,
      connection,
      actorUserId: input.actorUserId,
      now,
      policy,
      override: input.override,
    });

    state.phoneNumbers = activation.phoneNumbers;
    const updatedPhoneNumber = requirePhoneNumber(state, input.organizationId, input.numberId);
    await this.persistState(state);
    await this.auditLogService?.record({
      tenantId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "telephony.live_route_resumed",
      target: {
        type: "telephony_number",
        id: input.numberId,
      },
      outcome: "succeeded",
      metadata: {
        publishedVersionId: activation.activation.summary.publishedVersionId,
        runtimeProfile: activation.activation.summary.runtimeProfile,
      },
      occurredAt: now,
    });

    return {
      state: cloneState(state),
      phoneNumber: clonePhoneNumber(updatedPhoneNumber),
      activation: activation.activation,
    };
  }

  async dispatchInboundCall(input: {
    organizationId: string;
    toPhoneNumber: string;
    fromPhoneNumber: string;
    callSid: string;
    source?: "manual" | "webhook" | undefined;
    testCall?: boolean | undefined;
    now?: string | undefined;
  }) {
    const state = await this.getOrCreateState(input.organizationId);
    const now = input.now ?? new Date().toISOString();
    const liveCallPolicy = await this.resolveLiveRoutePolicyPosture({
      organizationId: input.organizationId,
    });
    const premiumRealtimePolicy = await this.resolvePstnPremiumRealtimePolicyPosture({
      organizationId: input.organizationId,
    });
    const resolution = resolveInboundCall({
      toPhoneNumber: input.toPhoneNumber,
      fromPhoneNumber: input.fromPhoneNumber,
      callSid: input.callSid,
      phoneNumbers: state.phoneNumbers,
      connections: state.connections,
      now,
      liveCallPolicy,
      premiumRealtimePolicy,
    });
    state.phoneNumbers = recordRejectedPstnTestAttempt({
      phoneNumbers: state.phoneNumbers,
      toPhoneNumber: input.toPhoneNumber,
      fromPhoneNumber: input.fromPhoneNumber,
      now,
    });
    const dispatch = buildDispatchRecord({
      organizationId: input.organizationId,
      resolution,
      callSid: input.callSid,
      toPhoneNumber: input.toPhoneNumber,
      fromPhoneNumber: input.fromPhoneNumber,
      source: input.source ?? "manual",
      now,
    });
    state.phoneNumbers = recordInboundPstnTestCheckpoints({
      phoneNumbers: state.phoneNumbers,
      dispatch,
      source: input.source ?? "manual",
      now,
    });
    const execution = buildExecutionArtifacts({
      state,
      organizationId: input.organizationId,
      dispatch,
      testCall: input.testCall ?? resolution.routeMode === "test_route",
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

    if (phoneNumber.liveRoute === undefined) {
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

  async mintTwilioMediaStreamToken(input: {
    organizationId: string;
    callSessionId: string;
    now?: string | undefined;
  }) {
    const state = await this.getOrCreateState(input.organizationId);
    const session = state.executionSessions.find(
      (candidate) =>
        candidate.callSessionId === input.callSessionId &&
        candidate.bridgeKind === "twilio-programmable-voice" &&
        candidate.direction === "inbound" &&
        candidate.status !== "blocked" &&
        candidate.status !== "completed",
    );
    if (session === undefined) {
      warnTwilioPstnDiagnostic(this.logger, "media_token_session_missing", {
        organizationId: input.organizationId,
        callSessionId: input.callSessionId,
      });
      return null;
    }

    const now = input.now ?? new Date().toISOString();
    const expiresAt = new Date(Date.parse(now) + twilioMediaStreamTokenTtlMs).toISOString();
    const streamToken = createOneTimeStreamToken({
      secret: this.mediaStreamTokenSecret,
      subject: input.callSessionId,
      scope: {
        organizationId: input.organizationId,
        dispatchId: session.dispatchId,
        connectionId: session.connectionId,
      },
      expiresAt,
    });
    const tokenRecord: TelephonyMediaStreamTokenRecord = {
      callSessionId: input.callSessionId,
      dispatchId: session.dispatchId,
      connectionId: session.connectionId,
      tokenHash: streamToken.tokenHash,
      expiresAt,
      createdAt: now,
    };

    state.mediaStreamTokens = [
      tokenRecord,
      ...state.mediaStreamTokens.filter((candidate) => candidate.callSessionId !== input.callSessionId),
    ].slice(0, 80);
    await this.persistState(state);

    logTwilioPstnDiagnostic(this.logger, "media_token_minted", {
      organizationId: input.organizationId,
      callSessionId: input.callSessionId,
      dispatchId: session.dispatchId,
      connectionId: session.connectionId,
      expiresAt,
    });

    return {
      token: streamToken.token,
      expiresAt,
    };
  }

  async authorizeTwilioMediaStream(input: { callSessionId: string; token: string }) {
    const organizationIds = new Set([
      ...this.stateByOrganizationId.keys(),
      ...(await this.stateRepository.listOrganizationIds()),
    ]);
    let failureReason = "session_not_found";

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

      failureReason = "invalid_call_session_id";
      const expectedCallSid = deriveTwilioCallSidFromSession(input.callSessionId);
      if (expectedCallSid === undefined) {
        continue;
      }

      failureReason = "token_not_found";
      const tokenRecord = state.mediaStreamTokens.find(
        (candidate) =>
          candidate.callSessionId === input.callSessionId &&
          candidate.dispatchId === session.dispatchId &&
          candidate.connectionId === session.connectionId,
      );
      const now = new Date().toISOString();
      if (tokenRecord === undefined) {
        continue;
      }

      failureReason = "token_already_consumed";
      if (tokenRecord.consumedAt !== undefined) {
        continue;
      }

      failureReason = "token_hash_mismatch";
      if (tokenRecord.tokenHash !== hashOneTimeStreamToken(input.token)) {
        continue;
      }

      failureReason = "token_expired";
      if (Date.parse(tokenRecord.expiresAt) <= Date.parse(now)) {
        continue;
      }

      failureReason = "token_verification_failed";
      if (!verifyOneTimeStreamToken({
        secret: this.mediaStreamTokenSecret,
        token: input.token,
        expectedSubject: input.callSessionId,
        expectedScope: {
          organizationId,
          dispatchId: session.dispatchId,
          connectionId: session.connectionId,
        },
        now,
      })) {
        continue;
      }

      state.mediaStreamTokens = state.mediaStreamTokens.map((candidate) =>
        candidate === tokenRecord ? { ...candidate, consumedAt: now } : candidate,
      );
      await this.persistState(state);

      logTwilioPstnDiagnostic(this.logger, "media_authorized", {
        organizationId,
        dispatchId: session.dispatchId,
        connectionId: session.connectionId,
        callSessionId: session.callSessionId,
        expectedCallSid,
      });

      const dispatch = state.dispatches.find((candidate) => candidate.id === session.dispatchId);

      return {
        organizationId,
        dispatchId: session.dispatchId,
        connectionId: session.connectionId,
        callSessionId: session.callSessionId,
        expectedCallSid,
        runtimePath: dispatch?.runtimePath ?? "pstn-sandwich",
      };
    }

    warnTwilioPstnDiagnostic(this.logger, "media_authorization_failed", {
      callSessionId: input.callSessionId,
      reason: failureReason,
    });

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
      warnTwilioPstnDiagnostic(this.logger, "media_lifecycle_session_missing", {
        organizationId: input.organizationId,
        callSessionId: input.callSessionId,
        streamSid: input.streamSid,
        status: input.status,
      });
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
    const at = input.at ?? new Date().toISOString();
    state.phoneNumbers = recordPstnPhoneTestCheckpointIfPresent({
      state,
      callSessionId: input.callSessionId,
      checkpoint: input.status === "active" ? "mediaWebSocketConnected" : "cleanEnd",
      at,
    });
    if (input.status === "completed") {
      state.phoneNumbers = recordPstnPhoneTestCheckpointIfPresent({
        state,
        callSessionId: input.callSessionId,
        checkpoint: "noFatalError",
        at,
      });
    }
    await this.persistState(state);
    logTwilioPstnDiagnostic(this.logger, "media_lifecycle_recorded", {
      organizationId: input.organizationId,
      callSessionId: input.callSessionId,
      streamSid: input.streamSid,
      status: input.status,
      dispatchId: session.dispatchId,
      connectionId: session.connectionId,
    });
  }

  async recordPstnPhoneTestCheckpoint(input: {
    organizationId: string;
    callSessionId: string;
    checkpoint: TelephonyPhoneTestCheckpoint;
    at?: string | undefined;
  }) {
    const state = await this.getOrCreateState(input.organizationId);
    state.phoneNumbers = recordPstnPhoneTestCheckpointIfPresent({
      state,
      callSessionId: input.callSessionId,
      checkpoint: input.checkpoint,
      at: input.at ?? new Date().toISOString(),
    });
    await this.persistState(state);

    return {
      state: cloneState(state),
    };
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

  async applyCallRuntimePolicy(input: {
    organizationId: string;
    callSessionId: string;
    now?: string | undefined;
    graceUntil?: string | undefined;
    subscriptionStatus?: TelephonySubscriptionPosture | undefined;
    tenantStatus?: TelephonyTenantPosture | undefined;
    budgetAction?: TelephonyBudgetPosture | undefined;
    budgetReasons?: string[] | undefined;
  }) {
    const state = await this.getOrCreateState(input.organizationId);
    const session = state.executionSessions.find(
      (candidate) =>
        candidate.callSessionId === input.callSessionId &&
        candidate.tenantId === input.organizationId,
    );

    if (session === undefined) {
      throw new NotFoundException(
        `Telephony execution session for call '${input.callSessionId}' was not found.`,
      );
    }

    const defaultPolicy = await this.resolveLiveRoutePolicyPosture({
      organizationId: input.organizationId,
      tenantStatus: input.tenantStatus,
    });
    const policy: TelephonyLiveRoutePolicyPosture = {
      subscriptionStatus: input.subscriptionStatus ?? defaultPolicy.subscriptionStatus,
      tenantStatus: input.tenantStatus ?? defaultPolicy.tenantStatus,
      budgetAction: input.budgetAction ?? defaultPolicy.budgetAction,
      budgetReasons: input.budgetReasons ?? defaultPolicy.budgetReasons,
    };
    const updatedSession = applyTelephonyActiveCallPolicy({
      session,
      now: input.now ?? new Date().toISOString(),
      graceUntil: input.graceUntil,
      policy,
    });

    state.executionSessions = upsertExecutionSession(state.executionSessions, updatedSession);
    if (updatedSession.status === "terminated" && session.status !== "terminated") {
      await this.terminateProviderCallForExecutionSession({
        state,
        organizationId: input.organizationId,
        session: updatedSession,
        reason: updatedSession.policyState?.state ?? "runtime_policy_terminated",
      });
    }
    await this.persistState(state);

    return {
      state: cloneState(state),
      session: cloneExecutionSession(updatedSession),
    };
  }

  private async terminateProviderCallForExecutionSession(input: {
    state: TelephonyStateStore;
    organizationId: string;
    session: TelephonyExecutionSession;
    reason: string;
  }) {
    if (input.session.provider !== "twilio" || input.session.bridgeKind !== "twilio-programmable-voice") {
      return;
    }

    const callSid = deriveTwilioCallSidFromSession(input.session.callSessionId);
    if (callSid === undefined) {
      warnTwilioPstnDiagnostic(this.logger, "provider_call_termination_skipped", {
        organizationId: input.organizationId,
        connectionId: input.session.connectionId,
        callSessionId: input.session.callSessionId,
        reason: "missing_twilio_call_sid",
      });
      return;
    }

    const connection = input.state.connections.find(
      (candidate) =>
        candidate.id === input.session.connectionId &&
        candidate.tenantId === input.organizationId,
    );
    const credentials = connection === undefined
      ? undefined
      : input.state.credentialVault.get(connection.id);
    const accountSid = (connection?.externalReference ?? credentials?.accountSid)?.trim();
    const authToken = credentials?.authToken?.trim();

    if (
      connection === undefined ||
      accountSid === undefined ||
      accountSid.length === 0 ||
      authToken === undefined ||
      authToken.length === 0
    ) {
      warnTwilioPstnDiagnostic(this.logger, "provider_call_termination_skipped", {
        organizationId: input.organizationId,
        connectionId: input.session.connectionId,
        callSessionId: input.session.callSessionId,
        callSid,
        reason: "missing_twilio_credentials",
      });
      return;
    }

    try {
      const call = await this.twilioNumberRouting.terminateCall({
        accountSid,
        authToken,
        callSid,
      });
      logTwilioPstnDiagnostic(this.logger, "provider_call_terminated", {
        organizationId: input.organizationId,
        connectionId: input.session.connectionId,
        dispatchId: input.session.dispatchId,
        callSessionId: input.session.callSessionId,
        callSid,
        reason: input.reason,
        providerStatus: call.status,
      });
    } catch (error) {
      warnTwilioPstnDiagnostic(this.logger, "provider_call_termination_failed", {
        organizationId: input.organizationId,
        connectionId: input.session.connectionId,
        dispatchId: input.session.dispatchId,
        callSessionId: input.session.callSessionId,
        callSid,
        reason: input.reason,
        error: safeTwilioDiagnosticErrorMessage(error),
      });
    }
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
    payload: unknown;
  }) {
    const signature = input.signature?.trim();
    const payload = normalizeTwilioWebhookPayload(input.payload);
    const webhookUrl = resolveTwilioWebhookUrl();
    logTwilioPstnDiagnostic(this.logger, "webhook_received", {
      callbackUrl: webhookUrl,
      accountSid: payload.AccountSid,
      callSid: payload.CallSid,
      eventSid: payload.EventSid,
      eventType: payload.EventType,
      callStatus: payload.CallStatus,
      direction: payload.Direction,
      from: payload.From,
      to: payload.To,
      signaturePresent: signature !== undefined && signature.length > 0,
    });
    if (signature === undefined || signature.length === 0) {
      warnTwilioPstnDiagnostic(this.logger, "webhook_signature_missing", {
        callbackUrl: webhookUrl,
        accountSid: payload.AccountSid,
        callSid: payload.CallSid,
      });
      throw new UnauthorizedException("Twilio webhook signature is required.");
    }

    const match = await this.findVerifiedTwilioConnection(payload, signature, webhookUrl);
    if (match === undefined) {
      warnTwilioPstnDiagnostic(this.logger, "webhook_signature_failed", {
        callbackUrl: webhookUrl,
        accountSid: payload.AccountSid,
        callSid: payload.CallSid,
        eventSid: payload.EventSid,
      });
      throw new UnauthorizedException("Unable to verify the Twilio webhook signature.");
    }

    const { organizationId, state, connection } = match;
    logTwilioPstnDiagnostic(this.logger, "webhook_signature_verified", {
      organizationId,
      connectionId: connection.id,
      accountSid: payload.AccountSid,
      callSid: payload.CallSid,
      eventSid: payload.EventSid,
    });
    const eventSid = payload.EventSid ?? payload.CallSid ?? `${connection.id}:unknown-event`;
    if (state.processedWebhookEventIds.has(eventSid)) {
      logTwilioPstnDiagnostic(this.logger, "webhook_duplicate", {
        organizationId,
        connectionId: connection.id,
        accountSid: payload.AccountSid,
        callSid: payload.CallSid,
        eventSid,
      });
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
      accountSid: payload.AccountSid ?? connection.externalReference ?? "unknown",
      callSid: payload.CallSid ?? "unknown-call",
      eventSid,
      eventType: payload.EventType ?? "unknown",
      receivedAt: new Date().toISOString(),
      duplicate: false,
    };
    state.webhookEvents = [event, ...state.webhookEvents].slice(0, 50);

    if (isTwilioIncomingVoiceWebhook(payload)) {
      const dispatchResponse = await this.dispatchInboundCall({
        organizationId,
        toPhoneNumber: payload.To ?? "",
        fromPhoneNumber: payload.From ?? "",
        callSid: payload.CallSid ?? eventSid,
        source: "webhook",
      });
      this.recordPstnObservability({
        traceId: `twilio:${event.id}`,
        organizationId,
        connectionId: connection.id,
        dispatch: dispatchResponse.dispatch,
        events: [
          {
            type: "webhook.received",
            at: event.receivedAt,
            payload: {
              provider: "twilio",
            },
          },
          {
            type: "route.selected",
            at: event.receivedAt,
            payload: {
              routeMode: dispatchResponse.dispatch.routeMode ?? "blocked",
              targetNodeId: dispatchResponse.dispatch.publishedVersionId ?? "none",
            },
          },
        ],
      });
      logTwilioPstnDiagnostic(this.logger, "webhook_incoming_resolved", {
        organizationId,
        connectionId: connection.id,
        accountSid: payload.AccountSid,
        callSid: payload.CallSid,
        eventSid,
        dispatchId: dispatchResponse.dispatch.id,
        callSessionId: dispatchResponse.dispatch.callSessionId,
        disposition: dispatchResponse.dispatch.disposition,
        routeMode: dispatchResponse.dispatch.routeMode,
        phoneNumberId: dispatchResponse.dispatch.phoneNumberId,
        publishedVersionId: dispatchResponse.dispatch.publishedVersionId,
        runtimeProfile: dispatchResponse.dispatch.runtimeProfile,
        runtimePath: dispatchResponse.dispatch.runtimePath,
        reason: dispatchResponse.dispatch.reason,
      });
      const mediaStreamToken = dispatchResponse.dispatch.callSessionId === undefined
        ? null
        : await this.mintTwilioMediaStreamToken({
            organizationId,
            callSessionId: dispatchResponse.dispatch.callSessionId,
          });
      const twiml = renderTwiMLForTwilioDispatch({
        organizationId,
        connectionId: connection.id,
        dispatch: dispatchResponse.dispatch,
        streamToken: mediaStreamToken?.token,
      });
      logTwilioPstnDiagnostic(this.logger, "twiml_rendered", {
        organizationId,
        connectionId: connection.id,
        accountSid: payload.AccountSid,
        callSid: payload.CallSid,
        eventSid,
        callSessionId: dispatchResponse.dispatch.callSessionId,
        disposition: dispatchResponse.dispatch.disposition,
        routeMode: dispatchResponse.dispatch.routeMode,
        runtimePath: dispatchResponse.dispatch.runtimePath,
        mediaStreamBaseUrl: resolveTwilioMediaStreamBaseUrl(),
        streamParameterPresent: mediaStreamToken !== null,
        twimlAction: describeTwilioTwiMLAction(twiml),
      });

      return {
        duplicate: false,
        event: cloneWebhookEvent(event),
        dispatch: dispatchResponse.dispatch,
        twiml,
      };
    }

    await this.persistState(state);
    logTwilioPstnDiagnostic(this.logger, "webhook_acknowledged", {
      organizationId,
      connectionId: connection.id,
      accountSid: payload.AccountSid,
      callSid: payload.CallSid,
      eventSid,
      eventType: event.eventType,
      twimlAction: "reject",
      reason: "not_incoming_voice",
    });

    return {
      duplicate: false,
      event: cloneWebhookEvent(event),
      twiml: renderTwilioRejectTwiML("rejected"),
    };
  }

  async handleTwilioStatusCallback(input: {
    signature: string | undefined;
    payload: unknown;
  }) {
    const signature = input.signature?.trim();
    const payload = normalizeTwilioWebhookPayload(input.payload);
    const callbackUrl = resolveTwilioStatusCallbackUrl();
    logTwilioPstnDiagnostic(this.logger, "status_callback_received", {
      callbackUrl,
      accountSid: payload.AccountSid,
      callSid: payload.CallSid,
      callStatus: payload.CallStatus,
      direction: payload.Direction,
      from: payload.From,
      to: payload.To,
      sipResponseCode: payload.SipResponseCode,
      errorCode: payload.ErrorCode,
      errorMessage: payload.ErrorMessage,
      sequenceNumber: payload.SequenceNumber,
      signaturePresent: signature !== undefined && signature.length > 0,
    });

    if (signature === undefined || signature.length === 0) {
      warnTwilioPstnDiagnostic(this.logger, "status_callback_signature_missing", {
        callbackUrl,
        accountSid: payload.AccountSid,
        callSid: payload.CallSid,
        callStatus: payload.CallStatus,
      });
      throw new UnauthorizedException("Twilio status callback signature is required.");
    }

    const match = await this.findVerifiedTwilioConnection(payload, signature, callbackUrl);
    if (match === undefined) {
      warnTwilioPstnDiagnostic(this.logger, "status_callback_signature_failed", {
        callbackUrl,
        accountSid: payload.AccountSid,
        callSid: payload.CallSid,
        callStatus: payload.CallStatus,
      });
      throw new UnauthorizedException("Unable to verify the Twilio status callback signature.");
    }

    logTwilioPstnDiagnostic(this.logger, "status_callback_signature_verified", {
      organizationId: match.organizationId,
      connectionId: match.connection.id,
      accountSid: payload.AccountSid,
      callSid: payload.CallSid,
      callStatus: payload.CallStatus,
      direction: payload.Direction,
      from: payload.From,
      to: payload.To,
      sipResponseCode: payload.SipResponseCode,
      errorCode: payload.ErrorCode,
      errorMessage: payload.ErrorMessage,
      sequenceNumber: payload.SequenceNumber,
    });
  }

  private recordPstnObservability(input: {
    traceId: string;
    organizationId: string;
    connectionId?: string | undefined;
    dispatch: TelephonyDispatchRecord;
    events: PstnCallObservabilityEvent[];
  }) {
    void this.pstnObservabilityRecorder?.recordPstnCall({
      traceId: input.traceId,
      call: {
        organizationId: input.organizationId,
        ...(input.dispatch.workspaceId === undefined ? {} : { workspaceId: input.dispatch.workspaceId }),
        callSessionId: input.dispatch.callSessionId ?? input.dispatch.id,
        ...(input.dispatch.phoneNumberId === undefined ? {} : { phoneNumberId: input.dispatch.phoneNumberId }),
        ...(input.connectionId === undefined ? {} : { connectionId: input.connectionId }),
        provider: "twilio",
        routeMode: input.dispatch.routeMode,
        runtimeProfile: input.dispatch.runtimeProfile,
        runtimePath: input.dispatch.runtimePath,
        publishedWorkflowVersionId: input.dispatch.publishedVersionId,
      },
      events: input.events,
    }).catch(() => undefined);
  }

  private async findVerifiedTwilioConnection(payload: Record<string, string>, signature: string, callbackUrl: string) {
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
          url: callbackUrl,
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

  private async resolveLiveRoutePolicyPosture(input: {
    organizationId: string;
    tenantStatus?: TelephonyTenantPosture | undefined;
  }): Promise<TelephonyLiveRoutePolicyPosture> {
    const billing = await this.billingService?.getBillingState(input.organizationId);
    const budget = resolveBillingBudgetPosture(billing);

    return {
      subscriptionStatus: normalizeBillingSubscriptionStatus(billing?.subscription.status),
      tenantStatus: input.tenantStatus ?? "active",
      budgetAction: budget.action,
      budgetReasons: budget.reasons,
    };
  }

  private async configureProviderNumberWebhookForRoute(input: {
    organizationId: string;
    phoneNumber: ImportedTelephonyPhoneNumber;
    state: TelephonyStateStore;
  }) {
    const connection = requireConnection(input.state, input.organizationId, input.phoneNumber.connectionId);

    if (
      connection.provider !== "twilio" ||
      connection.ownershipMode !== "byo_provider_account" ||
      input.phoneNumber.provisionSource !== "provider-import"
    ) {
      return;
    }

    const credentials = input.state.credentialVault.get(connection.id);
    const accountSid = connection.externalReference ?? credentials?.accountSid;
    const authToken = credentials?.authToken;
    const phoneNumberSid = input.phoneNumber.externalNumberId;

    if (
      accountSid === undefined ||
      accountSid.trim().length === 0 ||
      authToken === undefined ||
      authToken.trim().length === 0 ||
      phoneNumberSid === undefined ||
      phoneNumberSid.trim().length === 0
    ) {
      throw new ConflictException("Twilio number webhook configuration requires connected account credentials and an imported number SID.");
    }

    const voiceUrl = resolveTwilioWebhookUrl();
    const statusCallbackUrl = resolveTwilioStatusCallbackUrl();
    logTwilioPstnDiagnostic(this.logger, "route_configuring", {
      organizationId: input.organizationId,
      connectionId: connection.id,
      phoneNumberId: input.phoneNumber.id,
      phoneNumber: input.phoneNumber.phoneNumber,
      providerNumberSid: phoneNumberSid,
      statusCallbackUrl,
      voiceUrl,
    });

    try {
      const readback = await this.twilioNumberRouting.configureIncomingPhoneNumberWebhook({
        accountSid,
        authToken,
        phoneNumberSid,
        statusCallbackUrl,
        voiceUrl,
      });
      logTwilioPstnDiagnostic(this.logger, "route_configured", {
        organizationId: input.organizationId,
        connectionId: connection.id,
        phoneNumberId: input.phoneNumber.id,
        phoneNumber: input.phoneNumber.phoneNumber,
        providerNumberSid: phoneNumberSid,
        statusCallbackUrl,
        voiceUrl,
        readback,
      });
    } catch (error) {
      warnTwilioPstnDiagnostic(this.logger, "route_configuration_failed", {
        organizationId: input.organizationId,
        connectionId: connection.id,
        phoneNumberId: input.phoneNumber.id,
        phoneNumber: input.phoneNumber.phoneNumber,
        providerNumberSid: phoneNumberSid,
        statusCallbackUrl,
        voiceUrl,
        error: safeTwilioDiagnosticErrorMessage(error),
      });
      throw new ConflictException(error instanceof Error ? error.message : "Twilio number webhook configuration failed.");
    }
  }

  private async logTwilioProviderDiagnostics(input: {
    organizationId: string;
    connection: TelephonyConnection;
    state: TelephonyStateStore;
    reason: "heartbeat";
    scheduled: boolean;
  }) {
    const { connection } = input;
    if (connection.provider !== "twilio" || connection.ownershipMode !== "byo_provider_account") {
      return;
    }

    const credentials = input.state.credentialVault.get(connection.id);
    const accountSid = connection.externalReference ?? credentials?.accountSid;
    const authToken = credentials?.authToken;

    if (
      accountSid === undefined ||
      accountSid.trim().length === 0 ||
      authToken === undefined ||
      authToken.trim().length === 0
    ) {
      warnTwilioPstnDiagnostic(this.logger, "provider_diagnostics_skipped", {
        organizationId: input.organizationId,
        connectionId: connection.id,
        provider: connection.provider,
        reason: input.reason,
        scheduled: input.scheduled,
        skippedReason: "missing_credentials",
      });
      return;
    }

    const routedImportedNumbers = input.state.phoneNumbers
      .filter((phoneNumber) =>
        phoneNumber.connectionId === connection.id &&
        phoneNumber.provider === "twilio" &&
        phoneNumber.provisionSource === "provider-import" &&
        phoneNumber.externalNumberId.trim().length > 0 &&
        (phoneNumber.status === "routed" || phoneNumber.liveRoute !== undefined || phoneNumber.testRoute !== undefined),
      )
      .slice(0, 8);

    for (const phoneNumber of routedImportedNumbers) {
      try {
        const readback = await this.twilioNumberRouting.inspectIncomingPhoneNumber({
          accountSid,
          authToken,
          phoneNumberSid: phoneNumber.externalNumberId,
        });
        logTwilioPstnDiagnostic(this.logger, "provider_number_readback", {
          organizationId: input.organizationId,
          connectionId: connection.id,
          phoneNumberId: phoneNumber.id,
          phoneNumber: phoneNumber.phoneNumber,
          providerNumberSid: phoneNumber.externalNumberId,
          reason: input.reason,
          scheduled: input.scheduled,
          readback,
        });

        const recentCalls = await this.twilioNumberRouting.listRecentCallsForNumber({
          accountSid,
          authToken,
          phoneNumber: phoneNumber.phoneNumber,
          limit: 5,
        });
        logTwilioPstnDiagnostic(this.logger, "provider_recent_calls", {
          organizationId: input.organizationId,
          connectionId: connection.id,
          phoneNumberId: phoneNumber.id,
          phoneNumber: phoneNumber.phoneNumber,
          providerNumberSid: phoneNumber.externalNumberId,
          reason: input.reason,
          scheduled: input.scheduled,
          callCount: recentCalls.length,
          calls: recentCalls,
        });

        if (recentCalls.length > 0) {
          const callSids = recentCalls.map((call) => call.sid).filter((sid): sid is string => sid !== undefined);
          const callDetails = await Promise.all(
            callSids.map((callSid) =>
              this.twilioNumberRouting.retrieveCall({
                accountSid,
                authToken,
                callSid,
              }),
            ),
          );
          logTwilioPstnDiagnostic(this.logger, "provider_call_details", {
            organizationId: input.organizationId,
            connectionId: connection.id,
            phoneNumberId: phoneNumber.id,
            phoneNumber: phoneNumber.phoneNumber,
            providerNumberSid: phoneNumber.externalNumberId,
            reason: input.reason,
            scheduled: input.scheduled,
            callCount: callDetails.length,
            calls: callDetails,
          });

          const monitorAlerts = await this.twilioNumberRouting.listRecentMonitorAlerts({
            accountSid,
            authToken,
            limit: 10,
            startDate: resolveTwilioMonitorAlertStartDate(recentCalls),
          });
          const correlatedAlerts = filterTwilioMonitorAlertsForCalls(monitorAlerts, recentCalls);
          logTwilioPstnDiagnostic(this.logger, "provider_monitor_alerts", {
            organizationId: input.organizationId,
            connectionId: connection.id,
            phoneNumberId: phoneNumber.id,
            phoneNumber: phoneNumber.phoneNumber,
            providerNumberSid: phoneNumber.externalNumberId,
            reason: input.reason,
            scheduled: input.scheduled,
            callSids,
            alertCount: correlatedAlerts.length,
            alerts: correlatedAlerts,
          });
        }
      } catch (error) {
        warnTwilioPstnDiagnostic(this.logger, "provider_diagnostics_failed", {
          organizationId: input.organizationId,
          connectionId: connection.id,
          phoneNumberId: phoneNumber.id,
          phoneNumber: phoneNumber.phoneNumber,
          providerNumberSid: phoneNumber.externalNumberId,
          reason: input.reason,
          scheduled: input.scheduled,
          error: safeTwilioDiagnosticErrorMessage(error),
        });
      }
    }
  }

  private async resolvePstnPremiumRealtimePolicyPosture(input: {
    organizationId: string;
  }): Promise<PstnPremiumRealtimeCallStartPolicy> {
    const billing = await this.billingService?.getBillingState(input.organizationId);
    const budget = resolveBillingBudgetPosture(billing);
    const entitlementGranted =
      billing?.entitlements.some(
        (entitlement) =>
          entitlement.id === "benefit-premium-runtime" &&
          entitlement.status === "granted",
      ) ?? false;

    return {
      provider: "openai-realtime",
      capability: {
        provider: "openai-realtime",
        approvedForPstn: true,
        available: true,
        supportsPstnMediaBridge: true,
        supportsOutboundAudio: true,
        supportsNativeInterruption: true,
      },
      entitlement: {
        enabled: entitlementGranted,
        ...(entitlementGranted ? {} : { reason: "Premium realtime PSTN entitlement is not granted for this tenant." }),
      },
      budgetAction: budget.action,
      fallbackPolicy: "block",
    };
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
      mediaStreamTokens: [],
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

function normalizeBillingSubscriptionStatus(
  status: TenantBillingStateResponse["subscription"]["status"] | undefined,
): TelephonySubscriptionPosture {
  switch (status) {
    case "active":
    case "trialing":
    case "none":
    case "past_due":
    case "canceled":
      return status;
    default:
      return "active";
  }
}

function resolveBillingBudgetPosture(
  billing: TenantBillingStateResponse | undefined,
): { action: TelephonyBudgetPosture; reasons: string[] } {
  if (billing === undefined) {
    return { action: "allow", reasons: [] };
  }

  const reasons: string[] = [];
  const totalTelephonyMinutes = billing.telephonyMinuteAggregates.reduce(
    (total, aggregate) => total + aggregate.billableMinutes,
    0,
  );
  const premiumRuntimeUsage = billing.usage.find((usage) =>
    usage.id.includes("premium-realtime"),
  );

  if (billing.plan.budgetUsedUsd >= billing.budgetPolicy.monthlyBudgetUsd) {
    reasons.push("monthly_budget_exceeded");
  }
  if (totalTelephonyMinutes >= billing.budgetPolicy.callMinuteLimit) {
    reasons.push("call_minute_limit_exceeded");
  }
  if (
    premiumRuntimeUsage !== undefined &&
    premiumRuntimeUsage.used >= billing.budgetPolicy.premiumRuntimeMinuteLimit
  ) {
    reasons.push("premium_runtime_limit_exceeded");
  }

  if (reasons.length === 0) {
    return { action: "allow", reasons };
  }

  return {
    action: billing.budgetPolicy.overBudgetBehavior === "block" ? "block" : "warn",
    reasons,
  };
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

function normalizeTwilioWebhookPayload(payload: unknown): Record<string, string> {
  if (payload === null || payload === undefined || typeof payload !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(payload as Record<string, unknown>)
      .flatMap(([key, value]) => {
        if (typeof value === "string") {
          return [[key, value]];
        }

        if (Array.isArray(value)) {
          const firstString = value.find((item): item is string => typeof item === "string");
          return firstString === undefined ? [] : [[key, firstString]];
        }

        if (value === null || value === undefined) {
          return [];
        }

        return [[key, String(value)]];
      }),
  );
}

function resolveTwilioMonitorAlertStartDate(calls: TwilioRecentCallDiagnostic[]) {
  const parsedCallTimes = calls
    .flatMap((call) => [call.startTime, call.endTime])
    .filter((value): value is string => value !== undefined && value.trim().length > 0)
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));

  const earliestCallTime = parsedCallTimes.length === 0
    ? Date.now() - 30 * 60 * 1000
    : Math.min(...parsedCallTimes);

  return toTwilioMonitorDate(new Date(earliestCallTime - 5 * 60 * 1000));
}

function filterTwilioMonitorAlertsForCalls(
  alerts: TwilioMonitorAlertDiagnostic[],
  calls: TwilioRecentCallDiagnostic[],
) {
  const callSids = new Set(calls.map((call) => call.sid).filter((sid): sid is string => sid !== undefined));
  if (callSids.size === 0) {
    return alerts;
  }

  const correlatedAlerts = alerts.filter((alert) =>
    (alert.resourceSid !== undefined && callSids.has(alert.resourceSid)) ||
    (alert.requestUrl?.includes("/telephony/webhooks/twilio") ?? false),
  );

  return correlatedAlerts.length === 0 ? alerts : correlatedAlerts;
}

function toTwilioMonitorDate(date: Date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
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

function resolveSafeTwilioInventoryMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const safeMessages = new Set([
    "Twilio inventory import requires connected account credentials.",
    "Twilio rejected the connected account credentials.",
    "Twilio rate-limited phone number inventory import. Try again shortly.",
    "Twilio phone number inventory is temporarily unavailable.",
    "Twilio phone number inventory request failed.",
    "Could not reach Twilio phone number inventory.",
  ]);

  return safeMessages.has(message) ? message : "Twilio phone number inventory import failed.";
}

function isTwilioIncomingVoiceWebhook(payload: Record<string, string>) {
  const eventType = payload.EventType?.trim();
  if (eventType !== undefined && eventType.length > 0) {
    return eventType === "incoming.call";
  }

  return (
    payload.Direction?.toLowerCase() === "inbound" &&
    payload.CallSid !== undefined &&
    payload.To !== undefined &&
    payload.From !== undefined &&
    isTwilioActiveInboundCallStatus(payload.CallStatus)
  );
}

function isTwilioActiveInboundCallStatus(status: string | undefined) {
  const normalizedStatus = status?.toLowerCase();

  return (
    normalizedStatus === "queued" ||
    normalizedStatus === "initiated" ||
    normalizedStatus === "ringing" ||
    normalizedStatus === "in-progress"
  );
}

function buildDispatchRecord(input: {
  organizationId: string;
  resolution: InboundCallResolution;
  callSid: string;
  toPhoneNumber: string;
  fromPhoneNumber: string;
  source: "manual" | "webhook";
  now: string;
}): TelephonyDispatchRecord {
  return {
    id: `${input.callSid}:telephony:${input.source}`,
    tenantId: input.organizationId,
    direction: "inbound",
    toPhoneNumber: input.toPhoneNumber,
    fromPhoneNumber: input.fromPhoneNumber,
    createdAt: input.now,
    source: input.source,
    ...input.resolution,
  };
}

function recordInboundPstnTestCheckpoints(input: {
  phoneNumbers: ImportedTelephonyPhoneNumber[];
  dispatch: TelephonyDispatchRecord;
  source: "manual" | "webhook";
  now: string;
}) {
  if (
    input.dispatch.routeMode !== "test_route" ||
    input.dispatch.phoneNumberId === undefined ||
    input.dispatch.testRouteSessionId === undefined
  ) {
    return input.phoneNumbers;
  }

  let phoneNumbers = recordPstnPhoneTestCheckpoint({
    phoneNumbers: input.phoneNumbers,
    numberId: input.dispatch.phoneNumberId,
    sessionId: input.dispatch.testRouteSessionId,
    checkpoint: "allowedCallerMatched",
    at: input.now,
  });

  if (input.source === "webhook") {
    phoneNumbers = recordPstnPhoneTestCheckpoint({
      phoneNumbers,
      numberId: input.dispatch.phoneNumberId,
      sessionId: input.dispatch.testRouteSessionId,
      checkpoint: "verifiedWebhook",
      at: input.now,
    });
  }

  return phoneNumbers;
}

function recordRejectedPstnTestAttempt(input: {
  phoneNumbers: ImportedTelephonyPhoneNumber[];
  toPhoneNumber: string;
  fromPhoneNumber: string;
  now: string;
}) {
  const routedNumber = input.phoneNumbers.find(
    (phoneNumber) => normalizeServicePhoneNumber(phoneNumber.phoneNumber) === normalizeServicePhoneNumber(input.toPhoneNumber),
  );

  if (
    routedNumber?.testRoute === undefined ||
    routedNumber.testRoute.waitingSession.status !== "waiting"
  ) {
    return input.phoneNumbers;
  }

  if (Date.parse(routedNumber.testRoute.waitingSession.expiresAt) <= Date.parse(input.now)) {
    return completePstnPhoneTest({
      phoneNumbers: input.phoneNumbers,
      numberId: routedNumber.id,
      sessionId: routedNumber.testRoute.waitingSession.id,
      status: "expired",
      reason: "PSTN phone test expired before a matching caller connected.",
      at: input.now,
    });
  }

  const allowed = routedNumber.testRoute.allowedCallerNumbers.includes(
    normalizeServicePhoneNumber(input.fromPhoneNumber),
  );
  if (allowed) {
    return input.phoneNumbers;
  }

  return completePstnPhoneTest({
    phoneNumbers: input.phoneNumbers,
    numberId: routedNumber.id,
    sessionId: routedNumber.testRoute.waitingSession.id,
    status: "unauthorized_caller",
    reason: "Caller number did not match the PSTN phone test allow list.",
    at: input.now,
  });
}

function recordPstnPhoneTestCheckpointIfPresent(input: {
  state: TelephonyStateStore;
  callSessionId: string;
  checkpoint: TelephonyPhoneTestCheckpoint;
  at: string;
}) {
  const dispatch = input.state.dispatches.find(
    (candidate) => candidate.callSessionId === input.callSessionId,
  );

  if (
    dispatch?.phoneNumberId === undefined ||
    dispatch.testRouteSessionId === undefined
  ) {
    return input.state.phoneNumbers;
  }

  return recordPstnPhoneTestCheckpoint({
    phoneNumbers: input.state.phoneNumbers,
    numberId: dispatch.phoneNumberId,
    sessionId: dispatch.testRouteSessionId,
    checkpoint: input.checkpoint,
    at: input.at,
  });
}

function buildOutboundDispatchRecord(input: {
  organizationId: string;
  resolution: OutboundCallResolution;
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
  streamToken?: string | undefined;
}) {
  if (input.dispatch.disposition === "blocked") {
    return renderTwilioUnavailableTwiML("This Zara voice line is temporarily unavailable. Please try again later.");
  }

  if (
    input.dispatch.disposition !== "routed" ||
    input.dispatch.callSessionId === undefined ||
    input.dispatch.publishedVersionId === undefined ||
    input.streamToken === undefined
  ) {
    return renderTwilioRejectTwiML("busy");
  }

  return renderTwilioConnectStreamTwiML({
    mediaStreamBaseUrl: resolveTwilioMediaStreamBaseUrl(),
    callSessionId: input.dispatch.callSessionId,
    streamToken: input.streamToken,
    organizationId: input.organizationId,
    connectionId: input.connectionId,
    publishedVersionId: input.dispatch.publishedVersionId,
    runtimePath: input.dispatch.runtimePath ?? "pstn-sandwich",
    ...(input.dispatch.workspaceId === undefined
      ? {}
      : { workspaceId: input.dispatch.workspaceId }),
  });
}

function describeTwilioTwiMLAction(twiml: string) {
  if (twiml.includes("<Connect>")) {
    return "connect_stream";
  }

  if (twiml.includes("<Reject")) {
    return "reject";
  }

  if (twiml.includes("<Say>")) {
    return "say";
  }

  return "unknown";
}

function resolveTwilioWebhookUrl(env: Record<string, string | undefined> = process.env) {
  const configuredUrl = env.ZARA_TWILIO_WEBHOOK_URL?.trim();
  if (configuredUrl !== undefined && configuredUrl.length > 0) {
    return trimTrailingSlash(configuredUrl);
  }

  const apiPublicUrl = env.API_PUBLIC_URL?.trim();
  if (apiPublicUrl !== undefined && apiPublicUrl.length > 0) {
    return `${trimTrailingSlash(apiPublicUrl)}/telephony/webhooks/twilio`;
  }

  return localTwilioWebhookUrl;
}

function resolveTwilioStatusCallbackUrl(env: Record<string, string | undefined> = process.env) {
  const configuredUrl = env.ZARA_TWILIO_STATUS_CALLBACK_URL?.trim();
  if (configuredUrl !== undefined && configuredUrl.length > 0) {
    return trimTrailingSlash(configuredUrl);
  }

  return `${resolveTwilioWebhookUrl(env)}/status`;
}

function resolveTwilioMediaStreamBaseUrl(env: Record<string, string | undefined> = process.env) {
  const configuredUrl = env.ZARA_TWILIO_MEDIA_STREAM_BASE_URL?.trim();
  if (configuredUrl !== undefined && configuredUrl.length > 0) {
    return trimTrailingSlash(configuredUrl);
  }

  const apiPublicUrl = env.API_PUBLIC_URL?.trim();
  if (apiPublicUrl !== undefined && apiPublicUrl.length > 0) {
    return `${toWebSocketBaseUrl(trimTrailingSlash(apiPublicUrl))}/telephony/twilio/media-streams`;
  }

  return localTwilioMediaStreamBaseUrl;
}

function toWebSocketBaseUrl(value: string) {
  if (value.startsWith("https://")) {
    return `wss://${value.slice("https://".length)}`;
  }

  if (value.startsWith("http://")) {
    return `ws://${value.slice("http://".length)}`;
  }

  return value;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
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

function findExecutionSessionForPstnPhoneTest(input: {
  state: TelephonyStateStore;
  organizationId: string;
  numberId: string;
  sessionId: string;
}) {
  const dispatch = input.state.dispatches.find(
    (candidate) =>
      candidate.tenantId === input.organizationId &&
      candidate.phoneNumberId === input.numberId &&
      candidate.testRouteSessionId === input.sessionId &&
      candidate.routeMode === "test_route" &&
      candidate.callSessionId !== undefined,
  );

  if (dispatch?.callSessionId === undefined) {
    return undefined;
  }

  return input.state.executionSessions.find(
    (candidate) =>
      candidate.tenantId === input.organizationId &&
      candidate.dispatchId === dispatch.id &&
      candidate.callSessionId === dispatch.callSessionId,
  );
}

function isActivePstnPhoneTestSession(status: string) {
  return status === "waiting" || status === "active";
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
    mediaStreamTokens: (persistedState.mediaStreamTokens ?? []).map(cloneMediaStreamToken),
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
    mediaStreamTokens: state.mediaStreamTokens.map(cloneMediaStreamToken),
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
          policyChecks: cloneDispatchPolicyChecks(dispatch),
        }),
  };
}

function cloneDispatchPolicyChecks(
  dispatch: TelephonyDispatchRecord,
): TelephonyDispatchRecord["policyChecks"] {
  if (dispatch.policyChecks === undefined) {
    return undefined;
  }

  if (dispatch.direction === "inbound") {
    const policyChecks = dispatch.policyChecks as InboundCallPolicyChecks;
    return {
      subscription: { ...policyChecks.subscription },
      budget: { ...policyChecks.budget },
      tenant: { ...policyChecks.tenant },
      liveRoute: { ...policyChecks.liveRoute },
      ...(policyChecks.premiumRealtime === undefined
        ? {}
        : { premiumRealtime: { ...policyChecks.premiumRealtime } }),
    };
  }

  const policyChecks = dispatch.policyChecks as OutboundCallPolicyChecks;
  return {
    consent: { ...policyChecks.consent },
    budget: { ...policyChecks.budget },
    callingWindow: { ...policyChecks.callingWindow },
    callerId: { ...policyChecks.callerId },
    dnc: {
      ...(policyChecks.dnc ?? {
        status: "passed" as const,
        detail: "Destination is not on the tenant do-not-call list.",
      }),
    },
    timezone: {
      ...(policyChecks.timezone ?? {
        status: "passed" as const,
        detail: "Destination timezone is known for safe calling.",
      }),
    },
    abuse: {
      ...(policyChecks.abuse ?? {
        status: "passed" as const,
        detail: "Outbound abuse policy passed.",
      }),
    },
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

function cloneMediaStreamToken(token: TelephonyMediaStreamTokenRecord): TelephonyMediaStreamTokenRecord {
  return {
    ...token,
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

function normalizeServicePhoneNumber(value: string) {
  const digits = value.replace(/\D+/g, "");

  if (digits.startsWith("1") && digits.length === 11) {
    return `+${digits}`;
  }

  if (value.trim().startsWith("+")) {
    return `+${digits}`;
  }

  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

function isValidE164PhoneNumber(value: string | undefined) {
  return value !== undefined && /^\+[1-9]\d{7,14}$/.test(value);
}
