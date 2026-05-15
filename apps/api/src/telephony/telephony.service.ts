import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  assignTelephonyNumberRoute,
  createTelephonyCallControlEvent,
  createTelephonyConnection,
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
  type TelephonyProvider,
  type TelephonyRecordingPolicy,
} from "@zara/core";

import type {
  TelephonyCredentialVaultEntry,
  TelephonyDispatchRecord,
  TelephonyHealthCheck,
  TelephonyStateResponse,
  TelephonyStateStore,
  TelephonyWebhookEvent,
} from "./telephony.models";
import {
  FileTelephonyStateRepository,
  type PersistedTelephonyStateRecord,
} from "./telephony-state.repository";
import { TelephonySecretVault } from "./telephony-secret-vault";

const localTwilioWebhookUrl = "http://127.0.0.1/telephony/webhooks/twilio";

@Injectable()
export class TelephonyService {
  private readonly stateByOrganizationId = new Map<string, TelephonyStateStore>();

  constructor(
    private readonly stateRepository: FileTelephonyStateRepository,
    private readonly secretVault: TelephonySecretVault,
  ) {}

  getState(organizationId: string): TelephonyStateResponse {
    return cloneState(this.getOrCreateState(organizationId));
  }

  createConnection(input: {
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
    const state = this.getOrCreateState(input.organizationId);
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
    this.persistState(state);

    return {
      state: cloneState(state),
      connection: cloneConnection(connection),
    };
  }

  validateConnection(input: { organizationId: string; connectionId: string }) {
    const state = this.getOrCreateState(input.organizationId);
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
    this.persistState(state);

    return {
      state: cloneState(state),
      healthCheck: cloneHealthCheck(healthCheck),
    };
  }

  importTwilioNumbers(input: { organizationId: string; connectionId: string }) {
    const state = this.getOrCreateState(input.organizationId);
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
    this.persistState(state);

    return {
      state: cloneState(state),
      importedNumbers: importedNumbers.map(clonePhoneNumber),
    };
  }

  registerPhoneNumber(input: {
    organizationId: string;
    connectionId: string;
    phoneNumber: string;
    friendlyName: string;
    externalNumberId?: string | undefined;
  }) {
    const state = this.getOrCreateState(input.organizationId);
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
    this.persistState(state);

    return {
      state: cloneState(state),
      phoneNumber: clonePhoneNumber(phoneNumber),
    };
  }

  assignNumberRoute(input: {
    organizationId: string;
    numberId: string;
    publishedVersionId: string;
    workflowLabel: string;
    workspaceId: string;
    recordingPolicy?: TelephonyRecordingPolicy | undefined;
  }) {
    const state = this.getOrCreateState(input.organizationId);
    requirePhoneNumber(state, input.organizationId, input.numberId);

    state.phoneNumbers = assignTelephonyNumberRoute({
      phoneNumbers: state.phoneNumbers,
      numberId: input.numberId,
      publishedVersionId: input.publishedVersionId,
      workflowLabel: input.workflowLabel,
      workspaceId: input.workspaceId,
      recordingPolicy: input.recordingPolicy,
    });
    this.persistState(state);

    return {
      state: cloneState(state),
    };
  }

  dispatchInboundCall(input: {
    organizationId: string;
    toPhoneNumber: string;
    fromPhoneNumber: string;
    callSid: string;
    source?: "manual" | "webhook" | undefined;
  }) {
    const state = this.getOrCreateState(input.organizationId);
    const resolution = resolveInboundCall({
      toPhoneNumber: input.toPhoneNumber,
      fromPhoneNumber: input.fromPhoneNumber,
      callSid: input.callSid,
      phoneNumbers: state.phoneNumbers,
      connections: state.connections,
      now: new Date().toISOString(),
    });
    const dispatch = buildDispatchRecord({
      organizationId: input.organizationId,
      resolution,
      toPhoneNumber: input.toPhoneNumber,
      fromPhoneNumber: input.fromPhoneNumber,
      source: input.source ?? "manual",
    });

    state.dispatches = [dispatch, ...state.dispatches].slice(0, 40);
    this.persistState(state);

    return {
      state: cloneState(state),
      dispatch: cloneDispatch(dispatch),
    };
  }

  dispatchOutboundCall(input: {
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
  }) {
    const state = this.getOrCreateState(input.organizationId);
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
    });
    const dispatch = buildOutboundDispatchRecord({
      organizationId: input.organizationId,
      resolution,
      toPhoneNumber: input.toPhoneNumber,
      fromPhoneNumber: input.fromPhoneNumber,
    });

    state.dispatches = [dispatch, ...state.dispatches].slice(0, 40);
    this.persistState(state);

    return {
      state: cloneState(state),
      dispatch: cloneDispatch(dispatch),
    };
  }

  recordCallControlEvent(input: {
    organizationId: string;
    callSessionId: string;
    dispatchId: string;
    eventType:
      | "dtmf.received"
      | "voicemail.detected"
      | "transfer.requested"
      | "transfer.failed"
      | "failover.triggered";
    digit?: string | undefined;
    transferTarget?: string | undefined;
    fallbackTarget?: string | undefined;
  }) {
    const state = this.getOrCreateState(input.organizationId);
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
    });

    state.callControlEvents = [event, ...state.callControlEvents].slice(0, 60);
    this.persistState(state);

    return {
      state: cloneState(state),
      event: cloneCallControlEvent(event),
    };
  }

  handleTwilioWebhook(input: {
    signature: string | undefined;
    payload: Record<string, string>;
  }) {
    const signature = input.signature?.trim();
    if (signature === undefined || signature.length === 0) {
      throw new UnauthorizedException("Twilio webhook signature is required.");
    }

    const match = this.findVerifiedTwilioConnection(input.payload, signature);
    if (match === undefined) {
      throw new UnauthorizedException("Unable to verify the Twilio webhook signature.");
    }

    const { organizationId, state, connection } = match;
    const eventSid = input.payload.EventSid ?? input.payload.CallSid ?? `${connection.id}:unknown-event`;
    if (state.processedWebhookEventIds.has(eventSid)) {
      return {
        duplicate: true,
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
      const dispatchResponse = this.dispatchInboundCall({
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
      };
    }

    this.persistState(state);

    return {
      duplicate: false,
      event: cloneWebhookEvent(event),
    };
  }

  private findVerifiedTwilioConnection(payload: Record<string, string>, signature: string) {
    const accountSid = payload.AccountSid;
    if (accountSid === undefined) {
      return undefined;
    }

    const organizationIds = new Set([
      ...this.stateByOrganizationId.keys(),
      ...this.stateRepository.listOrganizationIds(),
    ]);

    for (const organizationId of organizationIds) {
      const state = this.getOrCreateState(organizationId);

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

  private getOrCreateState(organizationId: string): TelephonyStateStore {
    const existingState = this.stateByOrganizationId.get(organizationId);
    if (existingState !== undefined) {
      return existingState;
    }

    const persistedState = this.stateRepository.load(organizationId);
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
      dispatches: [],
      webhookEvents: [],
      callControlEvents: [],
      credentialVault: new Map<string, TelephonyCredentialVaultEntry>(),
      processedWebhookEventIds: new Set<string>(),
    };

    this.stateByOrganizationId.set(organizationId, nextState);
    return nextState;
  }

  private persistState(state: TelephonyStateStore) {
    this.stateRepository.save(dehydrateState(state, this.secretVault));
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
}): TelephonyDispatchRecord {
  return {
    id: `${input.resolution.callSessionId ?? input.resolution.phoneNumberId ?? "outbound"}:manual`,
    tenantId: input.organizationId,
    direction: "outbound",
    toPhoneNumber: input.toPhoneNumber,
    fromPhoneNumber: input.fromPhoneNumber,
    createdAt: new Date().toISOString(),
    source: "manual",
    ...input.resolution,
  };
}

function hydrateState(
  persistedState: PersistedTelephonyStateRecord,
  secretVault: TelephonySecretVault,
): TelephonyStateStore {
  return {
    organizationId: persistedState.organizationId,
    connections: persistedState.connections.map(cloneConnection),
    phoneNumbers: persistedState.phoneNumbers.map(clonePhoneNumber),
    healthChecks: persistedState.healthChecks.map(cloneHealthCheck),
    dispatches: persistedState.dispatches.map(cloneDispatch),
    webhookEvents: persistedState.webhookEvents.map(cloneWebhookEvent),
    callControlEvents: (persistedState.callControlEvents ?? []).map(cloneCallControlEvent),
    credentialVault: new Map(
      persistedState.credentials.map((credential) => [
        credential.connectionId,
        secretVault.open(credential.envelope),
      ]),
    ),
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
    dispatches: state.dispatches.map(cloneDispatch),
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
    dispatches: state.dispatches.map(cloneDispatch),
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
  };
}

function cloneDispatch(dispatch: TelephonyDispatchRecord): TelephonyDispatchRecord {
  return {
    ...dispatch,
    recording: {
      ...dispatch.recording,
    },
    ...(dispatch.policyChecks === undefined
      ? {}
      : {
          policyChecks: {
            consent: { ...dispatch.policyChecks.consent },
            budget: { ...dispatch.policyChecks.budget },
            callingWindow: { ...dispatch.policyChecks.callingWindow },
            callerId: { ...dispatch.policyChecks.callerId },
          },
        }),
  };
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
