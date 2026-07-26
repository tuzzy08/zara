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
import { randomUUID } from "node:crypto";
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
  type TelephonyCallLifecycleStage,
  type TelephonyCallLifecycleState,
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
  computeTelephonyPremiumDispatchSnapshotChecksum,
  TELEPHONY_INCREMENTAL_REPOSITORY,
  type TelephonyCallRuntimeContext,
  type TelephonyIncrementalRepository,
  type TelephonyPremiumDispatchRepository,
  type TelephonyPremiumDispatchSnapshot,
} from "./telephony-incremental.repository";
import {
  TELEPHONY_STATE_REPOSITORY,
  type PersistedTelephonyStateRecord,
  type TelephonyStateRepository,
} from "./telephony-state.repository";
import { PstnAdmissionCoordinator } from "./pstn-admission-coordinator";
import { PremiumPstnDispatchSnapshotResolver } from "./premium-pstn-dispatch-snapshot-resolver";
import { resolvePremiumPstnRequiredProviders } from "./premium-pstn-worker-requirements";
import {
  PSTN_PREMIUM_WORKER_AVAILABILITY,
  type PstnPremiumWorkerAvailability,
} from "../realtime-worker/pstn-premium-worker-availability";
import {
  isPstnRealtimeWorkerId,
  isPstnRealtimeWorkerReleaseId,
} from "./pstn-realtime-worker-routing-contract";
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
  readSignedOneTimeStreamToken,
  resolveOneTimeStreamTokenSecret,
} from "../security/one-time-stream-token";

const localTwilioWebhookUrl = "http://127.0.0.1/telephony/webhooks/twilio";
const localTwilioMediaStreamBaseUrl = "wss://127.0.0.1/telephony/twilio/media-streams";
const twilioMediaStreamTokenTtlMs = 5 * 60 * 1000;
const pstnLifecycleTransitionMaxAttempts = 10;
const pstnPremiumWorkerReselectionMaxAttempts = 64;
const safeTakeoverMessage =
  "I am connecting you with a specialist now. If the transfer drops, we will call you back using the number on this call.";
const safeCallbackMessage =
  "A specialist is not available on this line right now. We will call you back at the number we have for this call.";

@Injectable()
export class TelephonyService implements OnModuleInit, OnModuleDestroy {
  private readonly stateByOrganizationId = new Map<string, TelephonyStateStore>();
  private readonly configurationPersistenceByOrganizationId = new Map<
    string,
    Promise<void>
  >();
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
    @Inject(TELEPHONY_INCREMENTAL_REPOSITORY)
    private readonly incrementalRepository: TelephonyPremiumDispatchRepository,
    private readonly pstnAdmissionCoordinator: PstnAdmissionCoordinator,
    private readonly premiumDispatchSnapshotResolver: PremiumPstnDispatchSnapshotResolver,
    @Optional()
    private readonly auditLogService?: AuditLogService,
    @Optional()
    private readonly billingService?: BillingService,
    @Optional()
    @Inject(pstnCallObservabilityRecorderToken)
    private readonly pstnObservabilityRecorder?: PstnCallObservabilityRecorder,
    @Optional()
    @Inject(PSTN_PREMIUM_WORKER_AVAILABILITY)
    private readonly premiumWorkerAvailability?: PstnPremiumWorkerAvailability,
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
    await this.persistConfigurationState(state);

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
    await this.incrementalRepository.deleteConnection({
      tenantId: input.organizationId,
      connectionId: connection.id,
    });
    const connectionSessionIds = new Set(
      state.executionSessions
        .filter((session) => session.connectionId === connection.id)
        .map((session) => session.id),
    );
    const connectionDispatchIds = new Set([
      ...state.dispatches
        .filter((dispatch) => dispatch.connectionId === connection.id)
        .map((dispatch) => dispatch.id),
      ...state.executionSessions
        .filter((session) => session.connectionId === connection.id)
        .map((session) => session.dispatchId),
    ]);

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
    state.dispatches = state.dispatches.filter(
      (dispatch) => !connectionDispatchIds.has(dispatch.id),
    );
    state.callControlEvents = state.callControlEvents.filter(
      (event) => !connectionDispatchIds.has(event.dispatchId),
    );
    state.webhookEvents = state.webhookEvents.filter(
      (event) => event.connectionId !== connection.id,
    );
    state.credentialVault.delete(connection.id);
    await this.persistConfigurationState(state);

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
    const checkedAt = new Date().toISOString();
    const healthCheck: TelephonyHealthCheck = {
      id: `${connection.id}:health:${checkedAt}:${randomUUID()}`,
      connectionId: connection.id,
      status: evaluation.status,
      blocking:
        evaluation.status === "failed" ? connection.blockRoutingOnHealthFailure : false,
      checkedAt,
      message: evaluation.message,
    };
    const persisted =
      await this.incrementalRepository.recordConnectionHealthObservation({
        tenantId: input.organizationId,
        connectionId: connection.id,
        connectionStatus:
          healthCheck.status === "failed" ? "degraded" : "active",
        healthStatus: healthCheck.status,
        healthCheck,
      });
    if (persisted.outcome === "not_found") {
      throw new NotFoundException(
        `Telephony connection '${connection.id}' was not found for this organization.`,
      );
    }

    state.connections = state.connections.map((candidate) =>
      candidate.id === connection.id
        ? {
            ...candidate,
            healthStatus: persisted.healthStatus,
            status: persisted.connectionStatus,
          }
        : candidate,
    );
    state.healthChecks = [healthCheck, ...state.healthChecks].slice(0, 20);

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
    const heartbeat = {
      ...createTelephonyProviderHeartbeat({
        tenantId: input.organizationId,
        connection,
        status: evaluation.status,
        blocking:
          evaluation.status === "failed"
            ? connection.blockRoutingOnHealthFailure
            : false,
        scheduled: input.scheduled,
        latencyMs: resolveHeartbeatLatency(connection),
        at: heartbeatAt,
        routedNumberCount,
      }),
      id: `${connection.id}:heartbeat:${heartbeatAt}:${randomUUID()}`,
    };
    const healthCheck: TelephonyHealthCheck = {
      id: `${connection.id}:health:${heartbeatAt}:${randomUUID()}`,
      connectionId: connection.id,
      status: heartbeat.status,
      blocking: heartbeat.blocking,
      checkedAt: heartbeat.at,
      message: heartbeat.message,
      scheduled: heartbeat.scheduled,
      latencyMs: heartbeat.latencyMs,
      diagnostics: [...heartbeat.diagnostics],
    };
    const persisted =
      await this.incrementalRepository.recordConnectionHealthObservation({
        tenantId: input.organizationId,
        connectionId: connection.id,
        connectionStatus:
          heartbeat.status === "failed" ? "degraded" : "active",
        healthStatus: heartbeat.status,
        healthCheck,
        heartbeat,
      });
    if (persisted.outcome === "not_found") {
      throw new NotFoundException(
        `Telephony connection '${connection.id}' was not found for this organization.`,
      );
    }

    state.connections = state.connections.map((candidate) =>
      candidate.id === connection.id
        ? {
            ...candidate,
            healthStatus: persisted.healthStatus,
            status: persisted.connectionStatus,
          }
        : candidate,
    );
    state.healthChecks = [healthCheck, ...state.healthChecks].slice(0, 20);
    state.providerHeartbeats = [heartbeat, ...state.providerHeartbeats].slice(0, 30);
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
    await this.persistConfigurationState(state);

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
    await this.persistConfigurationState(state);

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
    await this.incrementalRepository.deletePhoneNumber({
      tenantId: input.organizationId,
      phoneNumberId: phoneNumber.id,
    });

    state.phoneNumbers = deleteTelephonyPhoneNumber({
      phoneNumbers: state.phoneNumbers,
      tenantId: input.organizationId,
      numberId: input.numberId,
    });
    await this.persistConfigurationState(state);

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
    await this.persistConfigurationState(state);

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

    let nextPhoneNumbers: ImportedTelephonyPhoneNumber[];
    try {
      nextPhoneNumbers = createPstnTestRoute({
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

    await this.commitPhoneTestProjection({
      organizationId: input.organizationId,
      previousPhoneNumbers: state.phoneNumbers,
      nextPhoneNumbers,
      conflictMessage:
        "PSTN phone-test state changed while the phone test was being started.",
    });
    state.phoneNumbers = nextPhoneNumbers;
    const updatedPhoneNumber = requirePhoneNumber(state, input.organizationId, input.numberId);

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

    const observedAt = input.at ?? new Date().toISOString();
    const nextPhoneNumbers = completePstnPhoneTest({
      phoneNumbers: state.phoneNumbers,
      numberId: input.numberId,
      sessionId: input.sessionId,
      status: input.status,
      reason: input.reason,
      at: observedAt,
    });
    await this.commitPhoneTestProjection({
      organizationId: input.organizationId,
      previousPhoneNumbers: state.phoneNumbers,
      nextPhoneNumbers,
      conflictMessage:
        "PSTN phone-test state changed while the phone test was being completed.",
    });
    state.phoneNumbers = nextPhoneNumbers;
    const updatedPhoneNumber = requirePhoneNumber(state, input.organizationId, input.numberId);
    if (testExecutionSession !== undefined) {
      const reason = `pstn_phone_test_${input.status}`;
      try {
        await this.transitionPstnCallLifecycle({
          organizationId: input.organizationId,
          callSessionId: testExecutionSession.callSessionId,
          nextState: {
            stage: input.status === "expired" ? "expired" : "failed",
            observedAt,
            reasonCode: sanitizePstnLifecycleReasonCode(reason),
          },
          nextStatus: "terminated",
        });
      } finally {
        await this.terminateProviderCallForExecutionSession({
          state,
          organizationId: input.organizationId,
          session: testExecutionSession,
          reason,
        });
      }
    }
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
    const activationPhoneNumbers = await this.projectLatestSuccessfulPhoneTest({
      organizationId: input.organizationId,
      phoneNumbers: state.phoneNumbers,
      phoneNumber,
    });
    const evaluation = evaluateTelephonyLiveRouteActivation({
      phoneNumbers: activationPhoneNumbers,
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
      phoneNumbers: activationPhoneNumbers,
      numberId: input.numberId,
      connection,
      actorUserId: input.actorUserId,
      now,
      policy,
      override: input.override,
    });
    state.phoneNumbers = activation.phoneNumbers;
    const updatedPhoneNumber = requirePhoneNumber(state, input.organizationId, input.numberId);
    await this.persistConfigurationState(state);
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
    await this.persistConfigurationState(state);
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
    const activationPhoneNumbers = await this.projectLatestSuccessfulPhoneTest({
      organizationId: input.organizationId,
      phoneNumbers: state.phoneNumbers,
      phoneNumber,
    });
    const activation = resumeTelephonyLiveRoute({
      phoneNumbers: activationPhoneNumbers,
      numberId: input.numberId,
      connection,
      actorUserId: input.actorUserId,
      now,
      policy,
      override: input.override,
    });

    state.phoneNumbers = activation.phoneNumbers;
    const updatedPhoneNumber = requirePhoneNumber(state, input.organizationId, input.numberId);
    await this.persistConfigurationState(state);
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

  private async projectLatestSuccessfulPhoneTest(input: {
    organizationId: string;
    phoneNumbers: ImportedTelephonyPhoneNumber[];
    phoneNumber: ImportedTelephonyPhoneNumber;
  }) {
    const liveRoute = input.phoneNumber.liveRoute;
    if (liveRoute === undefined) return input.phoneNumbers;
    const latest = await this.incrementalRepository.loadLatestSuccessfulPhoneTest({
      tenantId: input.organizationId,
      phoneNumberId: input.phoneNumber.id,
      publishedVersionId: liveRoute.publishedVersionId,
      runtimeProfile: liveRoute.runtimeProfile,
    });
    return input.phoneNumbers.map((phoneNumber) =>
      phoneNumber.id === input.phoneNumber.id
        ? {
            ...phoneNumber,
            phoneTestResults: latest === null ? [] : [latest],
          }
        : phoneNumber,
    );
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
    const prepared = await this.prepareInboundCall({
      ...input,
      isolateState: true,
    });
    await this.persistPreparedCallExecution(prepared);
    const state = await this.getOrCreateState(input.organizationId);
    this.commitInboundProjection(state, prepared);

    return {
      state: cloneState(state),
      dispatch: cloneDispatch(prepared.dispatch),
      ...(prepared.execution === null
        ? {}
        : { session: cloneExecutionSession(prepared.execution.session) }),
    };
  }

  private async prepareInboundCall(input: {
    organizationId: string;
    toPhoneNumber: string;
    fromPhoneNumber: string;
    callSid: string;
    source?: "manual" | "webhook" | undefined;
    testCall?: boolean | undefined;
    now?: string | undefined;
    isolateState?: boolean | undefined;
    connectionAdmissionPosture?: {
      connectionId: string;
      status: TelephonyConnection["status"];
      healthStatus: TelephonyConnection["healthStatus"];
      blockRoutingOnHealthFailure: boolean;
    } | undefined;
  }) {
    const currentState = await this.getOrCreateState(input.organizationId);
    const state = input.isolateState === true ? structuredClone(currentState) : currentState;
    if (input.connectionAdmissionPosture !== undefined) {
      const posture = input.connectionAdmissionPosture;
      state.connections = state.connections.map((connection) =>
        connection.id === posture.connectionId
          ? {
              ...connection,
              status: posture.status,
              healthStatus: posture.healthStatus,
              blockRoutingOnHealthFailure:
                posture.blockRoutingOnHealthFailure,
            }
          : connection
      );
    }
    const previousPhoneNumbers = currentState.phoneNumbers.map(clonePhoneNumber);
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
    return {
      state,
      dispatch,
      execution,
      phoneTestProjection: resolvePhoneTestProjectionUpdate(
        previousPhoneNumbers,
        state.phoneNumbers,
      ),
    };
  }

  private async persistPreparedCallExecution(
    prepared: Awaited<ReturnType<TelephonyService["prepareInboundCall"]>>,
  ) {
    const callOutcome =
      prepared.execution === null
        ? await this.incrementalRepository.insertDispatch(prepared.dispatch)
        : await this.incrementalRepository.createCallExecution({
            dispatch: prepared.dispatch,
            executionSession: requireLifecycleState(prepared.execution.session),
            executionCommands: prepared.execution.commands,
          });
    if (callOutcome.outcome === "conflict") {
      throw new ConflictException("Inbound call conflicts with an existing call.");
    }

    await this.persistPreparedPhoneTestProjection(prepared);
  }

  private async persistPreparedPhoneTestProjection(
    prepared: Awaited<ReturnType<TelephonyService["prepareInboundCall"]>>,
  ) {
    if (prepared.phoneTestProjection === null) return;
    const projectionOutcome = await this.incrementalRepository.updatePhoneTestProjection({
      tenantId: prepared.dispatch.tenantId,
      ...prepared.phoneTestProjection,
    });
    if (
      projectionOutcome.outcome === "conflict" ||
      projectionOutcome.outcome === "not_found"
    ) {
      throw new ConflictException(
        "PSTN phone-test state changed while the inbound call was being recorded.",
      );
    }
  }

  private async commitPhoneTestProjection(input: {
    organizationId: string;
    previousPhoneNumbers: ImportedTelephonyPhoneNumber[];
    nextPhoneNumbers: ImportedTelephonyPhoneNumber[];
    conflictMessage: string;
  }) {
    const projection = resolvePhoneTestProjectionUpdate(
      input.previousPhoneNumbers,
      input.nextPhoneNumbers,
    );
    if (projection === null) return;
    const outcome = await this.incrementalRepository.updatePhoneTestProjection({
      tenantId: input.organizationId,
      ...projection,
    });
    if (outcome.outcome === "conflict" || outcome.outcome === "not_found") {
      throw new ConflictException(input.conflictMessage);
    }
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

    let committedDispatch = dispatch;
    let committedExecution = execution;
    if (execution === null) {
      const outcome =
        abuseEvaluation.allowed === false &&
        input.abusePolicy?.pauseTenantOnViolation === true
          ? await this.incrementalRepository.recordOutboundAbuseBlock({
              dispatch,
              connectionIds: state.connections.map(({ id }) => id),
            })
          : await this.incrementalRepository.insertDispatch(dispatch);
      if (outcome.outcome === "conflict") {
        throw new ConflictException("Outbound call dispatch conflicts with an existing call.");
      }
    } else {
      const outcome = await this.incrementalRepository.createCallExecution({
        dispatch,
        executionSession: requireLifecycleState(execution.session),
        executionCommands: execution.commands,
      });
      if (outcome.outcome === "conflict") {
        throw new ConflictException("Outbound call execution conflicts with an existing call.");
      }
      if (outcome.outcome === "blocked") {
        committedDispatch = {
          ...dispatch,
          disposition: "blocked",
          reason: "Outbound calling is paused pending abuse review.",
          callSessionId: undefined,
        };
        committedExecution = null;
      }
    }
    state.dispatches = [committedDispatch, ...state.dispatches].slice(0, 40);
    if (
      abuseEvaluation.allowed === false &&
      input.abusePolicy?.pauseTenantOnViolation === true
    ) {
      state.connections = state.connections.map((connection) => ({
        ...connection,
        status: "disabled",
        healthStatus: "failed",
      }));
    }
    if (committedExecution !== null) {
      state.executionSessions = upsertExecutionSession(
        state.executionSessions,
        committedExecution.session,
      );
      state.executionCommands = upsertExecutionCommands(
        state.executionCommands,
        committedExecution.commands,
      );
    }
    if (
      abuseEvaluation.allowed === false &&
      input.abusePolicy?.pauseTenantOnViolation === true &&
      this.auditLogService !== undefined
    ) {
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
    if (
      committedDispatch.disposition === "queued" &&
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

    return {
      state: cloneState(state),
      dispatch: cloneDispatch(committedDispatch),
      ...(committedExecution === null
        ? {}
        : { session: cloneExecutionSession(committedExecution.session) }),
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
    await this.persistConfigurationState(state);
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
    const terminalCallSessionIds = new Set<string>();
    const terminalDispatchIds = new Set<string>();
    for (const session of state.executionSessions) {
      const loaded = await this.incrementalRepository.loadCallMutationContext({
        tenantId: input.organizationId,
        callSessionId: session.callSessionId,
      });
      if (
        loaded.outcome === "found" &&
        isTerminalPstnLifecycleStage(
          loaded.context.executionSession.lifecycleState.stage,
        ) &&
        isBeforeTimestamp(
          loaded.context.executionSession.updatedAt,
          input.retainAfter,
        )
      ) {
        terminalCallSessionIds.add(
          loaded.context.executionSession.callSessionId,
        );
        terminalDispatchIds.add(loaded.context.dispatch.id);
      }
    }
    const sessionDispatchIds = new Set(
      state.executionSessions.map((session) => session.dispatchId),
    );
    const blockedDispatchIds = new Set(
      state.dispatches
        .filter(
          (dispatch) =>
            dispatch.disposition === "blocked" &&
            !sessionDispatchIds.has(dispatch.id) &&
            isBeforeTimestamp(dispatch.createdAt, input.retainAfter),
        )
        .map((dispatch) => dispatch.id),
    );
    const deletedDispatchIds = new Set([
      ...terminalDispatchIds,
      ...blockedDispatchIds,
    ]);
    const durableDeletion = await this.incrementalRepository.deleteRetainedCallData({
      tenantId: input.organizationId,
      retainAfter: input.retainAfter,
    });

    state.dispatches = state.dispatches.filter(
      (dispatch) => !deletedDispatchIds.has(dispatch.id),
    );
    state.executionSessions = state.executionSessions.filter(
      (session) => !terminalCallSessionIds.has(session.callSessionId),
    );
    state.executionCommands = state.executionCommands.filter(
      (command) => !terminalCallSessionIds.has(command.callSessionId),
    );
    state.callControlEvents = state.callControlEvents.filter(
      (event) => !terminalCallSessionIds.has(event.callSessionId),
    );
    state.webhookEvents = state.webhookEvents.filter(
      (event) =>
        !(
          isBeforeTimestamp(event.receivedAt, input.retainAfter) &&
          (terminalCallSessionIds.has(event.callSid) ||
            terminalCallSessionIds.has(`${event.callSid}:telephony`) ||
            blockedDispatchIds.has(`${event.callSid}:telephony:webhook`))
        ),
    );

    return {
      organizationId: input.organizationId,
      retainAfter: input.retainAfter,
      deletedCounts: {
        calls: durableDeletion.deletedCounts.dispatches,
        transcripts: durableDeletion.deletedCounts.callControlEvents,
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

  async authorizeTwilioMediaStream(input: {
    callSessionId: string;
    token: string;
    workerId?: string | undefined;
    workerReleaseId?: string | undefined;
  }) {
    const claims = readTwilioMediaStreamTokenClaims({
      secret: this.mediaStreamTokenSecret,
      token: input.token,
      callSessionId: input.callSessionId,
    });
    const organizationId = claims?.scope.organizationId;
    const dispatchId = claims?.scope.dispatchId;
    const connectionId = claims?.scope.connectionId;
    const providerAccountId = claims?.scope.providerAccountId;
    const expectedCallSid = deriveTwilioCallSidFromSession(input.callSessionId);
    if (
      claims === undefined ||
      organizationId === undefined ||
      dispatchId === undefined ||
      connectionId === undefined ||
      providerAccountId === undefined ||
      expectedCallSid === undefined ||
      (
        claims.scope.runtimePath === "pstn-premium-realtime"
        && (
          claims.scope.workerId !== input.workerId
          || claims.scope.workerReleaseId !== input.workerReleaseId
        )
      ) ||
      (
        claims.scope.runtimePath === "pstn-sandwich"
        && (
          input.workerId !== undefined
          || input.workerReleaseId !== undefined
        )
      )
    ) {
      warnTwilioPstnDiagnostic(this.logger, "media_authorization_failed", {
        callSessionId: input.callSessionId,
        reason: "invalid_signed_token",
      });
      return null;
    }

    const claim = await this.incrementalRepository.claimMediaToken({
      tenantId: organizationId,
      callSessionId: input.callSessionId,
      dispatchId,
      connectionId,
      tokenHash: hashOneTimeStreamToken(input.token),
      ...(input.workerId === undefined ? {} : { workerId: input.workerId }),
    });
    if (claim.outcome === "claimed") {
      logTwilioPstnDiagnostic(this.logger, "media_authorized", {
        organizationId,
        dispatchId,
        connectionId,
        providerAccountId,
        callSessionId: input.callSessionId,
        expectedCallSid,
      });
      return {
        organizationId,
        dispatchId,
        connectionId,
        providerAccountId,
        callSessionId: input.callSessionId,
        expectedCallSid,
        runtimePath: claim.authorization.runtimePath,
        ...(claim.ownerEpoch === undefined
          ? {}
          : { ownerEpoch: claim.ownerEpoch }),
      };
    }

    if (claim.outcome === "expired") {
      await this.transitionPstnCallLifecycle({
        organizationId,
        callSessionId: input.callSessionId,
        nextState: {
          stage: "expired",
          observedAt: new Date().toISOString(),
          reasonCode: "media_token_expired",
        },
        nextStatus: "terminated",
      });
    }

    warnTwilioPstnDiagnostic(this.logger, "media_authorization_failed", {
      callSessionId: input.callSessionId,
      reason: `token_${claim.outcome}`,
    });

    return null;
  }

  inspectTwilioMediaStreamRuntime(input: {
    callSessionId: string;
    token: string;
  }) {
    const claims = readTwilioMediaStreamTokenClaims({
      secret: this.mediaStreamTokenSecret,
      token: input.token,
      callSessionId: input.callSessionId,
    });
    return claims === undefined
      ? null
      : {
          runtimePath: claims.scope.runtimePath,
          ...(claims.scope.workerId === undefined
            ? {}
            : { workerId: claims.scope.workerId }),
          ...(claims.scope.workerReleaseId === undefined
            ? {}
            : { workerReleaseId: claims.scope.workerReleaseId }),
        };
  }

  loadPremiumDispatchSnapshot(input: {
    organizationId: string;
    callSessionId: string;
  }) {
    return this.incrementalRepository.loadPremiumDispatchSnapshot({
      tenantId: input.organizationId,
      callSessionId: input.callSessionId,
    });
  }

  fencePremiumCallOwnership(input: {
    organizationId: string;
    callSessionId: string;
    workerId: string;
    ownerEpoch: number;
    leaseExpiresAt: string;
  }) {
    return this.incrementalRepository.fencePremiumCallOwnership({
      tenantId: input.organizationId,
      callSessionId: input.callSessionId,
      workerId: input.workerId,
      ownerEpoch: input.ownerEpoch,
      leaseExpiresAt: input.leaseExpiresAt,
    });
  }

  async recordTwilioMediaStreamLifecycle(input: {
    organizationId: string;
    callSessionId: string;
    streamSid: string;
    status: "active" | "completed";
    at?: string | undefined;
  }) {
    const at = input.at ?? new Date().toISOString();
    const transition = await this.transitionPstnCallLifecycle({
      organizationId: input.organizationId,
      callSessionId: input.callSessionId,
      nextState: {
        stage: input.status,
        observedAt: at,
      },
      nextStatus: input.status,
    });
    if (transition.outcome === "not_found") {
      warnTwilioPstnDiagnostic(this.logger, "media_lifecycle_session_missing", {
        organizationId: input.organizationId,
        callSessionId: input.callSessionId,
        streamSid: input.streamSid,
        status: input.status,
      });
      return;
    }
    if (transition.outcome === "ignored") return;

    await this.incrementalRepository.recordPhoneTestCheckpointByCall({
      tenantId: input.organizationId,
      callSessionId: input.callSessionId,
      checkpoint: input.status === "active" ? "mediaWebSocketConnected" : "cleanEnd",
      observedAt: at,
    });
    if (input.status === "completed") {
      await this.incrementalRepository.recordPhoneTestCheckpointByCall({
        tenantId: input.organizationId,
        callSessionId: input.callSessionId,
        checkpoint: "noFatalError",
        observedAt: at,
      });
    }
    logTwilioPstnDiagnostic(this.logger, "media_lifecycle_recorded", {
      organizationId: input.organizationId,
      callSessionId: input.callSessionId,
      streamSid: input.streamSid,
      status: input.status,
      dispatchId: transition.context.dispatchId,
      connectionId: transition.context.connectionId,
    });
  }

  async recordPstnPhoneTestCheckpoint(input: {
    organizationId: string;
    callSessionId: string;
    checkpoint: TelephonyPhoneTestCheckpoint;
    at?: string | undefined;
  }) {
    const outcome = await this.incrementalRepository.recordPhoneTestCheckpointByCall({
      tenantId: input.organizationId,
      callSessionId: input.callSessionId,
      checkpoint: input.checkpoint,
      observedAt: input.at ?? new Date().toISOString(),
    });
    return { outcome: outcome.outcome };
  }

  async recordPstnCallLifecycle(input: {
    organizationId: string;
    callSessionId: string;
    stage: TelephonyCallLifecycleStage;
    at?: string | undefined;
    reasonCode?: string | undefined;
    ownership?: {
      workerId: string;
      ownerEpoch: number;
    } | undefined;
  }) {
    const nextStatus =
      input.stage === "active"
        ? "active"
        : input.stage === "completed"
          ? "completed"
          : input.stage === "failed" || input.stage === "expired"
            ? "terminated"
            : undefined;
    return this.transitionPstnCallLifecycle({
      organizationId: input.organizationId,
      callSessionId: input.callSessionId,
      nextState: {
        stage: input.stage,
        observedAt: input.at ?? new Date().toISOString(),
        ...(input.reasonCode === undefined
          ? {}
          : { reasonCode: sanitizePstnLifecycleReasonCode(input.reasonCode) }),
      },
      nextStatus,
      ...(input.ownership === undefined
        ? {}
        : { ownership: input.ownership }),
    });
  }

  async loadPstnCallRuntimeContext(input: {
    organizationId: string;
    callSessionId: string;
  }) {
    return this.incrementalRepository.loadCallRuntimeContext({
      tenantId: input.organizationId,
      callSessionId: input.callSessionId,
    });
  }

  private async transitionPstnCallLifecycle(input: {
    organizationId: string;
    callSessionId: string;
    nextState: TelephonyCallLifecycleState;
    nextStatus?: TelephonyExecutionSession["status"] | undefined;
    ownership?: {
      workerId: string;
      ownerEpoch: number;
    } | undefined;
  }): Promise<
    | { outcome: "applied"; context: TelephonyCallRuntimeContext }
    | { outcome: "ignored"; context: TelephonyCallRuntimeContext }
    | { outcome: "not_found" }
  > {
    const terminal = isTerminalPstnLifecycleStage(input.nextState.stage);
    let releaseAdmission = false;
    try {
      for (
        let attempt = 0;
        attempt < pstnLifecycleTransitionMaxAttempts;
        attempt += 1
      ) {
        const loaded =
          await this.incrementalRepository.loadCallRuntimeContext({
            tenantId: input.organizationId,
            callSessionId: input.callSessionId,
          });
        if (loaded.outcome === "not_found") {
          releaseAdmission = terminal;
          return loaded;
        }

        const { context } = loaded;
        const current = context.lifecycleState;
        if (isTerminalPstnLifecycleStage(current.stage)) {
          releaseAdmission = terminal;
          return { outcome: "ignored", context };
        }
        if (
          isStalePstnLifecycleObservation(current, input.nextState) ||
          !canTransitionPstnLifecycle(current.stage, input.nextState.stage)
        ) {
          releaseAdmission = false;
          return { outcome: "ignored", context };
        }

        const transition =
          await this.incrementalRepository.transitionCallLifecycle({
            tenantId: input.organizationId,
            callSessionId: input.callSessionId,
            expectedVersion: context.version,
            expectedStage: current.stage,
            nextState: input.nextState,
            nextStatus: input.nextStatus,
            ...(input.ownership === undefined
              ? {}
              : { ownership: input.ownership }),
          });
        if (
          transition.outcome === "updated" ||
          transition.outcome === "existing"
        ) {
          releaseAdmission = terminal;
          return { outcome: "applied", context };
        }
        if (transition.outcome === "not_found") {
          releaseAdmission = terminal;
          return { outcome: "not_found" };
        }
      }

      const current =
        await this.incrementalRepository.loadCallRuntimeContext({
          tenantId: input.organizationId,
          callSessionId: input.callSessionId,
        });
      if (current.outcome === "found") {
        releaseAdmission =
          terminal &&
          isTerminalPstnLifecycleStage(current.context.lifecycleState.stage);
        return { outcome: "ignored", context: current.context };
      }
      releaseAdmission = terminal;
      return { outcome: "not_found" };
    } finally {
      if (releaseAdmission) {
        await this.pstnAdmissionCoordinator
          .release(input.organizationId, input.callSessionId)
          .catch(() => undefined);
      }
    }
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
      at: input.at ?? new Date().toISOString(),
    });
    return this.persistCallControlEvent({
      organizationId: input.organizationId,
      callSessionId: input.callSessionId,
      dispatchId: input.dispatchId,
      event,
    });
  }

  private async persistCallControlEvent(input: {
    organizationId: string;
    callSessionId: string;
    dispatchId: string;
    event: TelephonyCallControlEvent;
  }) {
    for (let attempt = 0; attempt < pstnLifecycleTransitionMaxAttempts; attempt += 1) {
      const loaded = await this.incrementalRepository.loadCallMutationContext({
        tenantId: input.organizationId,
        callSessionId: input.callSessionId,
      });
      if (loaded.outcome === "not_found") {
        throw new NotFoundException(
          `Telephony execution session for call '${input.callSessionId}' was not found.`,
        );
      }
      if (loaded.context.dispatch.id !== input.dispatchId) {
        throw new NotFoundException(
          `Telephony dispatch '${input.dispatchId}' was not found for call '${input.callSessionId}'.`,
        );
      }
      if (
        loaded.context.executionSession.status === "terminated" ||
        loaded.context.executionSession.status === "completed" ||
        loaded.context.executionSession.status === "blocked"
      ) {
        throw new ConflictException(
          `Telephony call '${input.callSessionId}' is already terminal.`,
        );
      }

      const session = applyTelephonyCallControlEventToSession({
        session: loaded.context.executionSession,
        event: input.event,
      });
      const commands = createTelephonyCallControlCommands({
        session,
        event: input.event,
      });
      const outcome = await this.incrementalRepository.recordCallControlMutation({
        tenantId: input.organizationId,
        callSessionId: input.callSessionId,
        dispatchId: input.dispatchId,
        expectedVersion: loaded.context.version,
        expectedStatus: loaded.context.executionSession.status,
        session: {
          status: session.status,
          outageMode: session.outageMode ?? null,
          fallbackTarget: session.fallbackTarget ?? null,
          diagnostics: session.diagnostics,
          updatedAt: session.updatedAt,
        },
        event: input.event,
        executionCommands: commands,
        retryCount: attempt,
      });
      if (outcome.outcome === "conflict") continue;
      if (outcome.outcome === "not_found") {
        throw new NotFoundException(
          `Telephony execution session for call '${input.callSessionId}' was not found.`,
        );
      }

      const state = await this.getOrCreateState(input.organizationId);
      state.callControlEvents = [
        input.event,
        ...state.callControlEvents.filter(({ id }) => id !== input.event.id),
      ].slice(0, 60);
      state.executionSessions = upsertExecutionSession(state.executionSessions, session);
      state.executionCommands = upsertExecutionCommands(state.executionCommands, commands);
      return {
        state: cloneState(state),
        event: cloneCallControlEvent(input.event),
        session: cloneExecutionSession(session),
      };
    }

    throw new ConflictException(
      `Telephony call '${input.callSessionId}' changed too frequently to record the call-control event.`,
    );
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
    const now = input.now ?? new Date().toISOString();

    for (let attempt = 0; attempt < pstnLifecycleTransitionMaxAttempts; attempt += 1) {
      const loaded = await this.incrementalRepository.loadCallMutationContext({
        tenantId: input.organizationId,
        callSessionId: input.callSessionId,
      });
      if (loaded.outcome === "not_found") {
        throw new NotFoundException(
          `Telephony execution session for call '${input.callSessionId}' was not found.`,
        );
      }
      const session = loaded.context.executionSession;
      if (
        session.status === "terminated" ||
        session.status === "completed" ||
        session.status === "blocked"
      ) {
        const state = await this.getOrCreateState(input.organizationId);
        state.executionSessions = upsertExecutionSession(state.executionSessions, session);
        return {
          state: cloneState(state),
          session: cloneExecutionSession(session),
        };
      }
      const updatedSession = applyTelephonyActiveCallPolicy({
        session,
        now,
        graceUntil: input.graceUntil,
        policy,
      });
      const outcome = await this.incrementalRepository.transitionExecutionSession({
        tenantId: input.organizationId,
        callSessionId: input.callSessionId,
        expectedVersion: loaded.context.version,
        expectedStatus: session.status,
        nextStatus: updatedSession.status,
        updatedAt: updatedSession.updatedAt,
        diagnostics: updatedSession.diagnostics,
        policyState: updatedSession.policyState ?? null,
      });
      if (outcome.outcome === "conflict") continue;
      if (outcome.outcome === "not_found") {
        throw new NotFoundException(
          `Telephony execution session for call '${input.callSessionId}' was not found.`,
        );
      }

      const state = await this.getOrCreateState(input.organizationId);
      state.executionSessions = upsertExecutionSession(
        state.executionSessions,
        updatedSession,
      );
      if (updatedSession.status === "terminated") {
        const reason =
          updatedSession.policyState?.state ?? "runtime_policy_terminated";
        try {
          await this.transitionPstnCallLifecycle({
            organizationId: input.organizationId,
            callSessionId: input.callSessionId,
            nextState: {
              stage: "failed",
              observedAt: now,
              reasonCode: sanitizePstnLifecycleReasonCode(reason),
            },
            nextStatus: "terminated",
          });
        } finally {
          await this.terminateProviderCallForExecutionSession({
            state,
            organizationId: input.organizationId,
            session: updatedSession,
            reason,
          });
        }
      }
      return {
        state: cloneState(state),
        session: cloneExecutionSession(updatedSession),
      };
    }

    throw new ConflictException(
      `Telephony call '${input.callSessionId}' changed too frequently to apply runtime policy.`,
    );
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
    const loaded = await this.incrementalRepository.loadCallMutationContext({
      tenantId: input.organizationId,
      callSessionId: input.callSessionId,
    });
    if (loaded.outcome === "not_found") {
      throw new NotFoundException(
        `Telephony execution session for call '${input.callSessionId}' was not found.`,
      );
    }
    const { dispatch, executionSession } = loaded.context;
    if (dispatch.id !== input.dispatchId) {
      throw new NotFoundException(
        `Telephony dispatch '${input.dispatchId}' was not found for call '${input.callSessionId}'.`,
      );
    }

    const canTransfer =
      supportsLiveHumanTransfer(executionSession) &&
      isValidE164PhoneNumber(input.transferTarget);
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
      at: input.now ?? new Date().toISOString(),
    });
    const persisted = await this.persistCallControlEvent({
      organizationId: input.organizationId,
      callSessionId: input.callSessionId,
      dispatchId: input.dispatchId,
      event,
    });

    return {
      state: persisted.state,
      fallback: {
        action,
        providerCapability,
        callerMessage,
        auditEventId: event.id,
      },
      event: persisted.event,
      session: persisted.session,
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
    const receivedAt = new Date().toISOString();
    const event: TelephonyWebhookEvent = {
      id: `${connection.id}:${eventSid}`,
      tenantId: organizationId,
      connectionId: connection.id,
      accountSid: payload.AccountSid ?? connection.externalReference ?? "unknown",
      callSid: payload.CallSid ?? "unknown-call",
      eventSid,
      eventType: payload.EventType ?? "unknown",
      receivedAt,
      duplicate: false,
    };
    let webhookOutcome: Awaited<ReturnType<TelephonyIncrementalRepository["insertWebhookEvent"]>>;
    try {
      webhookOutcome = await this.incrementalRepository.insertWebhookEvent(event);
    } catch (error) {
      return this.failTwilioAnswerPersistence({
        organizationId,
        connectionId: connection.id,
        callSid: payload.CallSid,
        eventSid,
        reasonCode: "webhook_event_persistence_failed",
        error,
      });
    }
    if (webhookOutcome.outcome === "conflict") {
      return this.failTwilioAnswerPersistence({
        organizationId,
        connectionId: connection.id,
        callSid: payload.CallSid,
        eventSid,
        reasonCode: "webhook_event_conflict",
      });
    }

    const authoritativeReceivedAt = webhookOutcome.receivedAt;
    event.receivedAt = authoritativeReceivedAt;
    const duplicate = webhookOutcome.outcome === "existing";
    if (duplicate) {
      logTwilioPstnDiagnostic(this.logger, "webhook_duplicate", {
        organizationId,
        connectionId: connection.id,
        accountSid: payload.AccountSid,
        callSid: payload.CallSid,
        eventSid,
      });
    }
    state.webhookEvents = [
      event,
      ...state.webhookEvents.filter(
        (candidate) =>
          candidate.connectionId !== event.connectionId ||
          candidate.eventSid !== event.eventSid,
      ),
    ].slice(0, 50);

    if (
      duplicate
      && isTwilioIncomingVoiceWebhook(payload)
      && payload.CallSid !== undefined
    ) {
      const callSessionId = `${payload.CallSid}:telephony`;
      let existingCall: Awaited<
        ReturnType<
          TelephonyIncrementalRepository["loadCallMutationContext"]
        >
      >;
      try {
        existingCall =
          await this.incrementalRepository.loadCallMutationContext({
            tenantId: organizationId,
            callSessionId,
          });
      } catch (error) {
        return this.failTwilioAnswerPersistence({
          organizationId,
          connectionId: connection.id,
          callSid: payload.CallSid,
          eventSid,
          reasonCode: "call_setup_persistence_failed",
          error,
        });
      }
      if (existingCall.outcome === "found") {
        const { dispatch, executionSession } = existingCall.context;
        if (
          isTerminalPstnLifecycleStage(
            executionSession.lifecycleState.stage,
          )
        ) {
          return this.failTwilioAnswerPersistence({
            organizationId,
            connectionId: connection.id,
            callSid: payload.CallSid,
            eventSid,
            reasonCode: "call_setup_persistence_conflict",
          });
        }
        const runtimePath = dispatch.runtimePath;
        if (
          executionSession.connectionId !== connection.id
          || dispatch.connectionId !== connection.id
          || dispatch.disposition !== "routed"
          || dispatch.callSessionId !== callSessionId
          || dispatch.publishedVersionId === undefined
          || (
            runtimePath !== "pstn-sandwich"
            && runtimePath !== "pstn-premium-realtime"
          )
          || payload.AccountSid === undefined
        ) {
          return this.failTwilioAnswerPersistence({
            organizationId,
            connectionId: connection.id,
            callSid: payload.CallSid,
            eventSid,
            reasonCode: "call_setup_persistence_conflict",
          });
        }
        let premiumWorkerTarget:
          | TelephonyPremiumDispatchSnapshot["workerTarget"]
          | undefined;
        if (runtimePath === "pstn-premium-realtime") {
          try {
            const snapshot =
              await this.incrementalRepository.loadPremiumDispatchSnapshot({
                tenantId: organizationId,
                callSessionId,
              });
            if (snapshot.outcome !== "found") {
              return this.failTwilioAnswerPersistence({
                organizationId,
                connectionId: connection.id,
                callSid: payload.CallSid,
                eventSid,
                reasonCode: "premium_dispatch_snapshot_unavailable",
              });
            }
            premiumWorkerTarget = snapshot.snapshot.workerTarget;
          } catch (error) {
            return this.failTwilioAnswerPersistence({
              organizationId,
              connectionId: connection.id,
              callSid: payload.CallSid,
              eventSid,
              reasonCode: "premium_dispatch_snapshot_unavailable",
              error,
            });
          }
        }
        const expiresAt = new Date(
          Date.parse(authoritativeReceivedAt)
            + twilioMediaStreamTokenTtlMs,
        ).toISOString();
        if (Date.parse(expiresAt) <= Date.now()) {
          return this.failTwilioAnswerPersistence({
            organizationId,
            connectionId: connection.id,
            callSid: payload.CallSid,
            eventSid,
            reasonCode: "media_token_expired",
          });
        }
        const streamToken = createOneTimeStreamToken({
          secret: this.mediaStreamTokenSecret,
          subject: callSessionId,
          scope: {
            organizationId,
            dispatchId: dispatch.id,
            connectionId: connection.id,
            providerAccountId: payload.AccountSid,
            runtimePath,
            ...(premiumWorkerTarget === undefined
              ? {}
              : {
                  workerId: premiumWorkerTarget.workerId,
                  workerReleaseId: premiumWorkerTarget.releaseId,
                }),
          },
          expiresAt,
          nonce: hashOneTimeStreamToken(
            `${organizationId}\0${connection.id}\0${eventSid}\0${payload.CallSid}`,
          ),
        });
        const twiml = renderTwiMLForTwilioDispatch({
          organizationId,
          connectionId: connection.id,
          dispatch,
          streamToken: streamToken.token,
          premiumWorkerTarget,
        });
        logTwilioPstnDiagnostic(this.logger, "twiml_replayed", {
          organizationId,
          connectionId: connection.id,
          accountSid: payload.AccountSid,
          callSid: payload.CallSid,
          eventSid,
          callSessionId,
          dispatchId: dispatch.id,
          runtimePath,
          expiresAt,
          twimlAction: describeTwilioTwiMLAction(twiml),
        });
        return {
          duplicate: true,
          event: cloneWebhookEvent(event),
          dispatch: cloneDispatch(dispatch),
          twiml,
        };
      }
    }

    if (isTwilioIncomingVoiceWebhook(payload)) {
      let durableConnection: Awaited<
        ReturnType<
          TelephonyIncrementalRepository["loadConnectionAdmissionPosture"]
        >
      >;
      try {
        durableConnection =
          await this.incrementalRepository.loadConnectionAdmissionPosture({
            tenantId: organizationId,
            connectionId: connection.id,
          });
      } catch (error) {
        return this.failTwilioAnswerPersistence({
          organizationId,
          connectionId: connection.id,
          callSid: payload.CallSid,
          eventSid,
          reasonCode: "provider_health_posture_unavailable",
          error,
        });
      }
      if (durableConnection.outcome === "not_found") {
        return this.failTwilioAnswerPersistence({
          organizationId,
          connectionId: connection.id,
          callSid: payload.CallSid,
          eventSid,
          reasonCode: "provider_health_posture_unavailable",
        });
      }
      const dispatchResponse = await this.prepareInboundCall({
        organizationId,
        toPhoneNumber: payload.To ?? "",
        fromPhoneNumber: payload.From ?? "",
        callSid: payload.CallSid ?? eventSid,
        source: "webhook",
        now: authoritativeReceivedAt,
        isolateState: true,
        connectionAdmissionPosture: {
          connectionId: connection.id,
          ...durableConnection.posture,
        },
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
      let mediaStreamToken: { token: string; expiresAt: string } | null = null;
      let premiumWorkerTarget:
        | TelephonyPremiumDispatchSnapshot["workerTarget"]
        | undefined;
      if (dispatchResponse.execution === null) {
        let dispatchOutcome: Awaited<ReturnType<TelephonyIncrementalRepository["insertDispatch"]>>;
        try {
          dispatchOutcome = await this.incrementalRepository.insertDispatch(
            dispatchResponse.dispatch,
          );
        } catch (error) {
          return this.failTwilioAnswerPersistence({
            organizationId,
            connectionId: connection.id,
            callSid: payload.CallSid,
            eventSid,
            reasonCode: "dispatch_persistence_failed",
            error,
          });
        }
        if (dispatchOutcome.outcome === "conflict") {
          return this.failTwilioAnswerPersistence({
            organizationId,
            connectionId: connection.id,
            callSid: payload.CallSid,
            eventSid,
            reasonCode: "dispatch_persistence_conflict",
          });
        }
        try {
          await this.persistPreparedPhoneTestProjection(dispatchResponse);
        } catch (error) {
          return this.failTwilioAnswerPersistence({
            organizationId,
            connectionId: connection.id,
            callSid: payload.CallSid,
            eventSid,
            reasonCode: "phone_test_projection_persistence_failed",
            error,
          });
        }
        this.commitInboundProjection(state, dispatchResponse);
      } else {
        const callSessionId =
          dispatchResponse.execution.session.callSessionId;
        const runtimePath = dispatchResponse.dispatch.runtimePath;
        if (
          runtimePath !== "pstn-sandwich" &&
          runtimePath !== "pstn-premium-realtime"
        ) {
          return this.failTwilioAnswerPersistence({
            organizationId,
            connectionId: connection.id,
            callSid: payload.CallSid,
            eventSid,
            reasonCode: "runtime_path_unavailable",
          });
        }
        const providerAccountId = payload.AccountSid;
        if (providerAccountId === undefined) {
          return this.failTwilioAnswerPersistence({
            organizationId,
            connectionId: connection.id,
            callSid: payload.CallSid,
            eventSid,
            reasonCode: "provider_account_identity_missing",
          });
        }
        if (duplicate) {
          try {
            const existingCall =
              await this.incrementalRepository.loadCallRuntimeContext({
                tenantId: organizationId,
                callSessionId,
              });
            if (
              existingCall.outcome === "found" &&
              isTerminalPstnLifecycleStage(
                existingCall.context.lifecycleState.stage,
              )
            ) {
              return this.failTwilioAnswerPersistence({
                organizationId,
                connectionId: connection.id,
                callSid: payload.CallSid,
                eventSid,
                reasonCode: "call_setup_persistence_conflict",
              });
            }
          } catch (error) {
            return this.failTwilioAnswerPersistence({
              organizationId,
              connectionId: connection.id,
              callSid: payload.CallSid,
              eventSid,
              reasonCode: "call_setup_persistence_failed",
              error,
            });
          }
        }
        let premiumDispatchSnapshot:
          | TelephonyPremiumDispatchSnapshot
          | undefined;
        let unresolvedPremiumSnapshot:
          | {
              resolution: Awaited<
                ReturnType<PremiumPstnDispatchSnapshotResolver["resolve"]>
              >;
              requiredProviders: ReturnType<
                typeof resolvePremiumPstnRequiredProviders
              >;
              workspaceId: string;
              publishedVersionId: string;
            }
          | undefined;
        if (runtimePath === "pstn-premium-realtime") {
          const publishedVersionId =
            dispatchResponse.dispatch.publishedVersionId;
          const workspaceId = dispatchResponse.dispatch.workspaceId;
          if (
            publishedVersionId === undefined
            || workspaceId === undefined
          ) {
            return this.failTwilioAnswerPersistence({
              organizationId,
              connectionId: connection.id,
              callSid: payload.CallSid,
              eventSid,
              reasonCode: "premium_dispatch_snapshot_unavailable",
            });
          }
          if (duplicate) {
            try {
              const existingSnapshot =
                await this.incrementalRepository.loadPremiumDispatchSnapshot({
                  tenantId: organizationId,
                  callSessionId,
                });
              if (existingSnapshot.outcome === "found") {
                premiumDispatchSnapshot = existingSnapshot.snapshot;
                premiumWorkerTarget =
                  existingSnapshot.snapshot.workerTarget;
              }
            } catch (error) {
              return this.failTwilioAnswerPersistence({
                organizationId,
                connectionId: connection.id,
                callSid: payload.CallSid,
                eventSid,
                reasonCode: "premium_dispatch_snapshot_unavailable",
                error,
              });
            }
          }
          if (premiumDispatchSnapshot === undefined) {
            let resolution: Awaited<
              ReturnType<
                PremiumPstnDispatchSnapshotResolver["resolve"]
              >
            >;
            try {
              resolution =
                await this.premiumDispatchSnapshotResolver.resolve({
                  organizationId,
                  workspaceId,
                  publishedVersionId,
                });
            } catch (error) {
              return this.failTwilioAnswerPersistence({
                organizationId,
                connectionId: connection.id,
                callSid: payload.CallSid,
                eventSid,
                reasonCode: "premium_dispatch_snapshot_unavailable",
                error,
              });
            }
            const requiredPremiumProviders =
              resolvePremiumPstnRequiredProviders({
                manifest: resolution.resolvedManifest,
                defaultProvider:
                  resolution.resolvedConversationPolicy.defaultProvider,
              });
            let workerSelection:
              | Awaited<
                  ReturnType<PstnPremiumWorkerAvailability["select"]>
                >
              | undefined;
            try {
              workerSelection =
                await this.premiumWorkerAvailability?.select(
                  requiredPremiumProviders,
                );
            } catch {
              workerSelection = undefined;
            }
            if (workerSelection?.status !== "available") {
              return this.failTwilioAdmission({
                organizationId,
                connectionId: connection.id,
                callSid: payload.CallSid,
                eventSid,
                callSessionId,
                reasonCode: "premium_worker_unavailable",
                limitingDimension: "worker",
              });
            }
            premiumWorkerTarget = workerSelection.worker;
            unresolvedPremiumSnapshot = {
              resolution,
              requiredProviders: requiredPremiumProviders,
              workspaceId,
              publishedVersionId,
            };
          }
        }
        const excludedWorkerIds: string[] = [];
        let admission: Awaited<
          ReturnType<PstnAdmissionCoordinator["reserve"]>
        >;
        while (true) {
          admission = await this.pstnAdmissionCoordinator.reserve({
            tenantId: organizationId,
            callSessionId,
            provider: connection.provider,
            providerAccountId,
            runtime: runtimePath,
            ...(premiumWorkerTarget === undefined
              ? {}
              : {
                  workerId: premiumWorkerTarget.workerId,
                  workerReleaseId: premiumWorkerTarget.releaseId,
                }),
            providerAvailable:
              durableConnection.posture.status !== "disabled" &&
              (durableConnection.posture.healthStatus !== "failed" ||
                !durableConnection.posture.blockRoutingOnHealthFailure),
          });
          if (admission.outcome === "admitted") {
            break;
          }
          if (
            admission.reasonCode === "worker_concurrency_limit"
            && unresolvedPremiumSnapshot !== undefined
            && premiumWorkerTarget !== undefined
          ) {
            excludedWorkerIds.push(premiumWorkerTarget.workerId);
            if (
              excludedWorkerIds.length
              >= pstnPremiumWorkerReselectionMaxAttempts
            ) {
              return this.failTwilioAdmission({
                organizationId,
                connectionId: connection.id,
                callSid: payload.CallSid,
                eventSid,
                callSessionId,
                reasonCode: admission.reasonCode,
                limitingDimension: admission.limitingDimension,
              });
            }
            let retrySelection:
              | Awaited<
                  ReturnType<PstnPremiumWorkerAvailability["select"]>
                >
              | undefined;
            try {
              retrySelection =
                await this.premiumWorkerAvailability?.select(
                  unresolvedPremiumSnapshot.requiredProviders,
                  excludedWorkerIds,
                );
            } catch {
              retrySelection = undefined;
            }
            if (
              retrySelection?.status === "available"
              && !excludedWorkerIds.includes(retrySelection.worker.workerId)
            ) {
              premiumWorkerTarget = retrySelection.worker;
              continue;
            }
          }
          return this.failTwilioAdmission({
            organizationId,
            connectionId: connection.id,
            callSid: payload.CallSid,
            eventSid,
            callSessionId,
            reasonCode: admission.reasonCode,
            limitingDimension: admission.limitingDimension,
          });
        }
        if (
          unresolvedPremiumSnapshot !== undefined
          && premiumWorkerTarget !== undefined
        ) {
          const snapshotWithoutChecksum = {
            schemaVersion: 1 as const,
            tenantId: organizationId,
            workspaceId: unresolvedPremiumSnapshot.workspaceId,
            callSessionId,
            dispatchId: dispatchResponse.execution.session.dispatchId,
            publishedVersionId:
              unresolvedPremiumSnapshot.publishedVersionId,
            resolvedManifest:
              unresolvedPremiumSnapshot.resolution.resolvedManifest,
            resolvedConversationPolicy:
              unresolvedPremiumSnapshot.resolution
                .resolvedConversationPolicy,
            workerTarget: {
              workerId: premiumWorkerTarget.workerId,
              releaseId: premiumWorkerTarget.releaseId,
              mediaStreamBaseUrl:
                premiumWorkerTarget.mediaStreamBaseUrl,
            },
            createdAt: authoritativeReceivedAt,
          };
          premiumDispatchSnapshot = {
            ...snapshotWithoutChecksum,
            checksum:
              computeTelephonyPremiumDispatchSnapshotChecksum(
                snapshotWithoutChecksum,
              ),
          };
        }

        let callSetupPersisted = false;
        try {
          const expiresAt = new Date(
            Date.parse(authoritativeReceivedAt) + twilioMediaStreamTokenTtlMs,
          ).toISOString();
          if (Date.parse(expiresAt) <= Date.now()) {
            return this.failTwilioAnswerPersistence({
              organizationId,
              connectionId: connection.id,
              callSid: payload.CallSid,
              eventSid,
              reasonCode: "media_token_expired",
            });
          }
          const streamToken = createOneTimeStreamToken({
            secret: this.mediaStreamTokenSecret,
            subject: callSessionId,
            scope: {
              organizationId,
              dispatchId: dispatchResponse.execution.session.dispatchId,
              connectionId: dispatchResponse.execution.session.connectionId,
              providerAccountId,
              runtimePath,
              ...(premiumWorkerTarget === undefined
                ? {}
                : {
                    workerId: premiumWorkerTarget.workerId,
                    workerReleaseId: premiumWorkerTarget.releaseId,
                  }),
            },
            expiresAt,
            nonce: hashOneTimeStreamToken(
              `${organizationId}\0${connection.id}\0${eventSid}\0${payload.CallSid ?? eventSid}`,
            ),
          });
          const tokenRecord: TelephonyMediaStreamTokenRecord = {
            callSessionId,
            dispatchId: dispatchResponse.execution.session.dispatchId,
            connectionId: dispatchResponse.execution.session.connectionId,
            tokenHash: streamToken.tokenHash,
            expiresAt,
            createdAt: authoritativeReceivedAt,
          };
          let callSetupOutcome: Awaited<
            ReturnType<TelephonyIncrementalRepository["createCallSetup"]>
          >;
          try {
            callSetupOutcome =
              await this.incrementalRepository.createCallSetup({
                dispatch: dispatchResponse.dispatch,
                executionSession: dispatchResponse.execution.session,
                executionCommands: dispatchResponse.execution.commands,
                mediaToken: {
                  tenantId: organizationId,
                  ...tokenRecord,
                },
                ...(premiumDispatchSnapshot === undefined
                  ? {}
                  : { premiumDispatchSnapshot }),
              });
          } catch (error) {
            let persistedSetup: Awaited<
              ReturnType<
                TelephonyIncrementalRepository["loadCallRuntimeContext"]
              >
            >;
            try {
              persistedSetup =
                await this.incrementalRepository.loadCallRuntimeContext({
                  tenantId: organizationId,
                  callSessionId,
                });
            } catch {
              return this.failTwilioAnswerPersistence({
                organizationId,
                connectionId: connection.id,
                callSid: payload.CallSid,
                eventSid,
                reasonCode: "call_setup_persistence_failed",
                error,
              });
            }
            if (
              persistedSetup.outcome !== "found" ||
              persistedSetup.context.dispatchId !==
                dispatchResponse.execution.session.dispatchId ||
              persistedSetup.context.connectionId !==
                dispatchResponse.execution.session.connectionId ||
              persistedSetup.context.runtimePath !== runtimePath ||
              isTerminalPstnLifecycleStage(
                persistedSetup.context.lifecycleState.stage,
              )
            ) {
              return this.failTwilioAnswerPersistence({
                organizationId,
                connectionId: connection.id,
                callSid: payload.CallSid,
                eventSid,
                reasonCode: "call_setup_persistence_failed",
                error,
              });
            }
            callSetupOutcome = {
              outcome: "existing",
              mediaToken: "retained",
            };
          }
          if (callSetupOutcome.outcome === "conflict") {
            return this.failTwilioAnswerPersistence({
              organizationId,
              connectionId: connection.id,
              callSid: payload.CallSid,
              eventSid,
              reasonCode: "call_setup_persistence_conflict",
            });
          }
          callSetupPersisted = true;
          if (
            dispatchResponse.dispatch.routeMode === "test_route" &&
            dispatchResponse.dispatch.phoneNumberId !== undefined &&
            dispatchResponse.dispatch.testRouteSessionId !== undefined
          ) {
            for (const checkpoint of [
              "allowedCallerMatched",
              "verifiedWebhook",
            ]) {
              try {
                const checkpointOutcome =
                  await this.incrementalRepository.recordPhoneTestCheckpoint({
                    id: `${organizationId}:${callSessionId}:${checkpoint}`,
                    tenantId: organizationId,
                    phoneNumberId:
                      dispatchResponse.dispatch.phoneNumberId,
                    callSessionId,
                    testRouteSessionId:
                      dispatchResponse.dispatch.testRouteSessionId,
                    checkpoint,
                    observedAt: authoritativeReceivedAt,
                  });
                if (
                  checkpointOutcome.outcome === "conflict" ||
                  checkpointOutcome.outcome === "not_found"
                ) {
                  const failure = {
                    organizationId,
                    connectionId: connection.id,
                    callSid: payload.CallSid,
                    eventSid,
                    callSessionId,
                    observedAt: authoritativeReceivedAt,
                    reasonCode:
                      "phone_test_checkpoint_persistence_conflict",
                  };
                  return callSetupOutcome.outcome === "inserted"
                    ? this.failPersistedTwilioCallSetup(failure)
                    : this.failTwilioAnswerPersistence(failure);
                }
              } catch (error) {
                const failure = {
                  organizationId,
                  connectionId: connection.id,
                  callSid: payload.CallSid,
                  eventSid,
                  callSessionId,
                  observedAt: authoritativeReceivedAt,
                  reasonCode:
                    "phone_test_checkpoint_persistence_failed",
                  error,
                };
                return callSetupOutcome.outcome === "inserted"
                  ? this.failPersistedTwilioCallSetup(failure)
                  : this.failTwilioAnswerPersistence(failure);
              }
            }
          }

          try {
            await this.persistPreparedPhoneTestProjection(dispatchResponse);
          } catch (error) {
            const failure = {
              organizationId,
              connectionId: connection.id,
              callSid: payload.CallSid,
              eventSid,
              callSessionId,
              observedAt: authoritativeReceivedAt,
              reasonCode: "phone_test_projection_persistence_failed",
              error,
            };
            return callSetupOutcome.outcome === "inserted"
              ? this.failPersistedTwilioCallSetup(failure)
              : this.failTwilioAnswerPersistence(failure);
          }
          this.commitInboundProjection(state, dispatchResponse);
          mediaStreamToken = {
            token: streamToken.token,
            expiresAt,
          };
          logTwilioPstnDiagnostic(this.logger, "media_token_minted", {
            organizationId,
            callSessionId: tokenRecord.callSessionId,
            dispatchId: tokenRecord.dispatchId,
            connectionId: tokenRecord.connectionId,
            expiresAt,
            persistenceOutcome: callSetupOutcome.outcome,
            tokenDisposition: callSetupOutcome.mediaToken,
          });
        } finally {
          if (!callSetupPersisted) {
            logTwilioPstnDiagnostic(
              this.logger,
              "webhook_admission_claim_retained",
              {
                organizationId,
                connectionId: connection.id,
                callSid: payload.CallSid,
                eventSid,
                callSessionId,
                admissionDisposition: admission.disposition,
                leaseExpiresAt: admission.leaseExpiresAt,
              },
            );
          }
        }
      }
      const twiml = renderTwiMLForTwilioDispatch({
        organizationId,
        connectionId: connection.id,
        dispatch: dispatchResponse.dispatch,
        streamToken: mediaStreamToken?.token,
        premiumWorkerTarget,
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
        mediaStreamBaseUrl:
          premiumWorkerTarget?.mediaStreamBaseUrl
          ?? resolveTwilioMediaStreamBaseUrl(),
        streamParameterPresent: mediaStreamToken !== null,
        twimlAction: describeTwilioTwiMLAction(twiml),
      });

      return {
        duplicate,
        event: cloneWebhookEvent(event),
        dispatch: dispatchResponse.dispatch,
        twiml,
      };
    }

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
      duplicate,
      event: cloneWebhookEvent(event),
      twiml: renderTwilioRejectTwiML("rejected"),
    };
  }

  private failTwilioAnswerPersistence(input: {
    organizationId: string;
    connectionId: string;
    callSid?: string | undefined;
    eventSid: string;
    reasonCode: string;
    error?: unknown;
  }) {
    warnTwilioPstnDiagnostic(this.logger, "webhook_answer_persistence_failed", {
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      callSid: input.callSid,
      eventSid: input.eventSid,
      reasonCode: input.reasonCode,
      ...(input.error === undefined
        ? {}
        : { error: safeTwilioDiagnosticErrorMessage(input.error) }),
    });
    return {
      duplicate: false,
      reasonCode: input.reasonCode,
      twiml: renderTwilioUnavailableTwiML(
        "This Zara voice line is temporarily unavailable. Please try again later.",
      ),
    };
  }

  private async failPersistedTwilioCallSetup(input: {
    organizationId: string;
    connectionId: string;
    callSid?: string | undefined;
    eventSid: string;
    callSessionId: string;
    observedAt: string;
    reasonCode: string;
    error?: unknown;
  }) {
    try {
      await this.recordPstnCallLifecycle({
        organizationId: input.organizationId,
        callSessionId: input.callSessionId,
        stage: "failed",
        at: input.observedAt,
        reasonCode: input.reasonCode,
      });
    } catch (lifecycleError) {
      warnTwilioPstnDiagnostic(
        this.logger,
        "call_setup_terminalization_failed",
        {
          organizationId: input.organizationId,
          connectionId: input.connectionId,
          callSid: input.callSid,
          eventSid: input.eventSid,
          callSessionId: input.callSessionId,
          reasonCode: input.reasonCode,
          error: safeTwilioDiagnosticErrorMessage(lifecycleError),
        },
      );
    }
    return this.failTwilioAnswerPersistence(input);
  }

  private failTwilioAdmission(input: {
    organizationId: string;
    connectionId: string;
    callSid?: string | undefined;
    eventSid: string;
    callSessionId: string;
    reasonCode: string;
    limitingDimension?: string | undefined;
  }) {
    warnTwilioPstnDiagnostic(this.logger, "webhook_admission_denied", {
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      callSid: input.callSid,
      eventSid: input.eventSid,
      callSessionId: input.callSessionId,
      reasonCode: input.reasonCode,
      limitingDimension: input.limitingDimension,
    });
    return {
      duplicate: false,
      reasonCode: input.reasonCode,
      twiml: renderTwilioUnavailableTwiML(
        "This Zara voice line is temporarily unavailable. Please try again later.",
      ),
    };
  }

  private commitInboundProjection(
    state: TelephonyStateStore,
    prepared: Awaited<ReturnType<TelephonyService["prepareInboundCall"]>>,
  ) {
    state.dispatches = [
      prepared.dispatch,
      ...state.dispatches.filter((candidate) => candidate.id !== prepared.dispatch.id),
    ].slice(0, 40);
    if (prepared.execution !== null) {
      state.executionSessions = upsertExecutionSession(
        state.executionSessions,
        prepared.execution.session,
      );
      state.executionCommands = upsertExecutionCommands(
        state.executionCommands,
        prepared.execution.commands,
      );
    }
    if (prepared.phoneTestProjection !== null) {
      const preparedPhoneNumber = prepared.state.phoneNumbers.find(
        (candidate) => candidate.id === prepared.phoneTestProjection?.phoneNumberId,
      );
      if (preparedPhoneNumber !== undefined) {
        state.phoneNumbers = state.phoneNumbers.map((candidate) =>
          candidate.id === preparedPhoneNumber.id ? preparedPhoneNumber : candidate,
        );
      }
    }
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

    const lifecycleUpdate = resolveTwilioStatusLifecycleUpdate(payload);
    if (payload.CallSid !== undefined && lifecycleUpdate !== undefined) {
      await this.transitionPstnCallLifecycle({
        organizationId: match.organizationId,
        callSessionId: `${payload.CallSid}:telephony`,
        nextState: lifecycleUpdate.lifecycleState,
        nextStatus: lifecycleUpdate.status,
      });
    }
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
    };

    this.stateByOrganizationId.set(organizationId, nextState);
    return nextState;
  }

  private async persistConfigurationState(state: TelephonyStateStore) {
    const previous =
      this.configurationPersistenceByOrganizationId.get(state.organizationId) ??
      Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this.stateRepository.save(dehydrateState(state, this.secretVault)));
    this.configurationPersistenceByOrganizationId.set(state.organizationId, current);

    try {
      await current;
    } finally {
      if (
        this.configurationPersistenceByOrganizationId.get(state.organizationId) ===
        current
      ) {
        this.configurationPersistenceByOrganizationId.delete(state.organizationId);
      }
    }
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
  premiumWorkerTarget?:
    | TelephonyPremiumDispatchSnapshot["workerTarget"]
    | undefined;
}) {
  if (input.dispatch.disposition === "blocked") {
    return renderTwilioUnavailableTwiML("This Zara voice line is temporarily unavailable. Please try again later.");
  }

  if (
    input.dispatch.disposition !== "routed" ||
    input.dispatch.callSessionId === undefined ||
    input.dispatch.publishedVersionId === undefined ||
    input.streamToken === undefined ||
    (
      input.dispatch.runtimePath === "pstn-premium-realtime"
      && input.premiumWorkerTarget === undefined
    )
  ) {
    return renderTwilioRejectTwiML("busy");
  }

  return renderTwilioConnectStreamTwiML({
    mediaStreamBaseUrl:
      input.premiumWorkerTarget?.mediaStreamBaseUrl
      ?? resolveTwilioMediaStreamBaseUrl(),
    callSessionId: input.dispatch.callSessionId,
    streamToken: input.streamToken,
    organizationId: input.organizationId,
    connectionId: input.connectionId,
    publishedVersionId: input.dispatch.publishedVersionId,
    runtimePath: input.dispatch.runtimePath ?? "pstn-sandwich",
    ...(input.premiumWorkerTarget === undefined
      ? {}
      : {
          workerId: input.premiumWorkerTarget.workerId,
          workerReleaseId: input.premiumWorkerTarget.releaseId,
        }),
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

function resolveTwilioMediaStreamBaseUrl(
  env: Record<string, string | undefined> = process.env,
) {
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

function resolvePhoneTestProjectionUpdate(
  previousPhoneNumbers: ImportedTelephonyPhoneNumber[],
  nextPhoneNumbers: ImportedTelephonyPhoneNumber[],
) {
  for (const next of nextPhoneNumbers) {
    const previous = previousPhoneNumbers.find(({ id }) => id === next.id);
    if (previous === undefined) continue;
    const expectedTestRoute = previous.testRoute ?? null;
    const expectedPhoneTestResults = previous.phoneTestResults ?? null;
    const testRoute = next.testRoute ?? null;
    const phoneTestResults = next.phoneTestResults ?? null;
    if (
      JSON.stringify(expectedTestRoute) === JSON.stringify(testRoute) &&
      JSON.stringify(expectedPhoneTestResults) === JSON.stringify(phoneTestResults)
    ) {
      continue;
    }
    return {
      phoneNumberId: next.id,
      expectedTestRoute,
      expectedPhoneTestResults,
      testRoute,
      phoneTestResults,
    };
  }
  return null;
}

function requireLifecycleState(
  session: TelephonyExecutionSession,
): TelephonyExecutionSession & { lifecycleState: TelephonyCallLifecycleState } {
  if (session.lifecycleState === undefined) {
    throw new Error("New telephony execution sessions require an explicit lifecycle state.");
  }
  return {
    ...session,
    lifecycleState: session.lifecycleState,
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

function readTwilioMediaStreamTokenClaims(input: {
  secret: Buffer;
  token: string;
  callSessionId: string;
}) {
  const claims = readSignedOneTimeStreamToken({
    secret: input.secret,
    token: input.token,
    expectedSubject: input.callSessionId,
  });
  const runtimePath = claims?.scope.runtimePath;
  const organizationId = claims?.scope.organizationId;
  const dispatchId = claims?.scope.dispatchId;
  const connectionId = claims?.scope.connectionId;
  const providerAccountId = claims?.scope.providerAccountId;
  const workerId = claims?.scope.workerId;
  const workerReleaseId = claims?.scope.workerReleaseId;
  const expectedScopeKeys = runtimePath === "pstn-premium-realtime"
    ? [
        "connectionId",
        "dispatchId",
        "organizationId",
        "providerAccountId",
        "runtimePath",
        "workerId",
        "workerReleaseId",
      ]
    : [
        "connectionId",
        "dispatchId",
        "organizationId",
        "providerAccountId",
        "runtimePath",
      ];
  if (
    claims === undefined
    || organizationId === undefined
    || dispatchId === undefined
    || connectionId === undefined
    || providerAccountId === undefined
    || (runtimePath !== "pstn-sandwich"
      && runtimePath !== "pstn-premium-realtime")
    || (runtimePath === "pstn-premium-realtime"
      && (
        !isPstnRealtimeWorkerId(workerId)
        || !isPstnRealtimeWorkerReleaseId(workerReleaseId)
      ))
    || (runtimePath === "pstn-sandwich"
      && (workerId !== undefined || workerReleaseId !== undefined))
    || JSON.stringify(Object.keys(claims.scope).sort())
      !== JSON.stringify(expectedScopeKeys)
  ) {
    return undefined;
  }
  return {
    ...claims,
    scope: {
      organizationId,
      dispatchId,
      connectionId,
      providerAccountId,
      runtimePath,
      ...(workerId === undefined ? {} : { workerId }),
      ...(workerReleaseId === undefined ? {} : { workerReleaseId }),
    },
  };
}

function deriveTwilioCallSidFromSession(callSessionId: string) {
  return callSessionId.endsWith(":telephony")
    ? callSessionId.slice(0, -":telephony".length)
    : undefined;
}

function resolveTwilioStatusLifecycleUpdate(payload: Record<string, string>) {
  const callStatus = payload.CallStatus?.trim().toLowerCase();
  if (callStatus === undefined) return undefined;

  let stage: TelephonyCallLifecycleStage;
  let status: TelephonyExecutionSession["status"] | undefined;
  if (["queued", "initiated", "ringing"].includes(callStatus)) {
    stage = "ringing";
  } else if (["answered", "in-progress"].includes(callStatus)) {
    stage = "active";
    status = "active";
  } else if (callStatus === "completed") {
    stage = "completed";
    status = "completed";
  } else if (["busy", "no-answer", "canceled", "failed"].includes(callStatus)) {
    stage = "failed";
    status = "terminated";
  } else {
    return undefined;
  }

  const providerSequence = parseTwilioSequenceNumber(payload.SequenceNumber);
  const errorCode = payload.ErrorCode?.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  const reasonCode =
    stage === "failed"
      ? [`twilio_${callStatus.replace(/[^a-z0-9-]/g, "")}`, errorCode]
          .filter((value): value is string => value !== undefined && value.length > 0)
          .join("_")
          .slice(0, 96)
      : undefined;

  return {
    lifecycleState: {
      stage,
      observedAt: new Date().toISOString(),
      ...(providerSequence === undefined ? {} : { providerSequence }),
      ...(reasonCode === undefined ? {} : { reasonCode }),
    } satisfies TelephonyCallLifecycleState,
    ...(status === undefined ? {} : { status }),
  };
}

function parseTwilioSequenceNumber(value: string | undefined) {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) ? sequence : undefined;
}

function isTerminalPstnLifecycleStage(stage: TelephonyCallLifecycleStage) {
  return stage === "completed" || stage === "failed" || stage === "expired";
}

function isStalePstnLifecycleObservation(
  current: TelephonyCallLifecycleState,
  next: TelephonyCallLifecycleState,
) {
  if (
    current.stage === next.stage &&
    current.providerSequence === undefined &&
    next.providerSequence === undefined
  ) {
    return true;
  }
  if (next.providerSequence !== undefined && current.providerSequence !== undefined) {
    return next.providerSequence <= current.providerSequence;
  }
  if (next.providerSequence !== undefined || current.providerSequence !== undefined) {
    return false;
  }
  return false;
}

function sanitizePstnLifecycleReasonCode(value: string) {
  const sanitized = value.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 96);
  return sanitized.length === 0 ? "unspecified" : sanitized;
}

function canTransitionPstnLifecycle(
  current: TelephonyCallLifecycleStage,
  next: TelephonyCallLifecycleStage,
) {
  if (current === next || isTerminalPstnLifecycleStage(next)) return true;
  const allowed: Record<TelephonyCallLifecycleStage, TelephonyCallLifecycleStage[]> = {
    ringing: ["media-connected", "provider-ready", "active", "handoff", "draining"],
    "media-connected": ["provider-ready", "active", "handoff", "draining"],
    "provider-ready": ["active", "handoff", "draining"],
    active: ["handoff", "draining"],
    handoff: ["active", "draining"],
    draining: [],
    completed: [],
    failed: [],
    expired: [],
  };
  return allowed[current].includes(next);
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
