import { useEffect, useMemo, useState } from "react";

import {
  Activity,
  ArrowRightLeft,
  BadgeCheck,
  Bot,
  Cable,
  CircleSlash2,
  KeyRound,
  PhoneCall,
  PhoneForwarded,
  PhoneIncoming,
  PhoneOff,
  Router,
  ShieldCheck,
  TestTube2,
  Voicemail,
  Waves,
} from "lucide-react";
import type {
  TelephonyCallControlEventType,
  TelephonyRecordingConsentMode,
  TelephonyRecordingPolicy,
  Workspace,
} from "@zara/core";

import {
  assignTelephonyRouteViaApi,
  createPlatformManagedConnectionViaApi,
  createSipConnectionViaApi,
  createTwilioConnectionViaApi,
  dispatchInboundTelephonyTestViaApi,
  dispatchOutboundTelephonyCallViaApi,
  fetchTelephonyState,
  importTwilioNumbersViaApi,
  recordTelephonyCallControlEventViaApi,
  registerTelephonyNumberViaApi,
  rotateTelephonyCredentialsViaApi,
  runTelephonyHeartbeatViaApi,
  runTelephonyLoopbackTestViaApi,
  validateTelephonyConnectionViaApi,
  type TelephonyCallControlEvent,
  type TelephonyDispatchRecord,
  type TelephonyStateResponse,
} from "./telephonyApi";
import { loadPublishedWorkflowVersionsForWorkspace } from "./workflowSandboxRegistry";
import { tenantId } from "./workspaceState";

const actorUserId = "user-ops-lead";

interface TelephonyScreenProps {
  activeWorkspaceId: string;
  workspaces: Workspace[];
  showToast: (message: string) => void;
}

interface ConnectionDraftBase {
  label: string;
  region: string;
  consentMode: TelephonyRecordingConsentMode;
  consentMessage: string;
}

interface PlatformConnectionDraft extends ConnectionDraftBase {
  provider: "twilio" | "signalwire" | "telnyx";
  phoneNumber: string;
  friendlyName: string;
}

interface TwilioConnectionDraft extends ConnectionDraftBase {
  accountSid: string;
  authToken: string;
  blockRoutingOnHealthFailure: boolean;
}

interface SipConnectionDraft extends ConnectionDraftBase {
  username: string;
  secret: string;
  sipDomain: string;
  codecs: string;
  phoneNumber: string;
  friendlyName: string;
  blockRoutingOnHealthFailure: boolean;
}

interface InboundDispatchDraft {
  toPhoneNumber: string;
  fromPhoneNumber: string;
  callSid: string;
}

interface OutboundDispatchDraft {
  fromPhoneNumber: string;
  toPhoneNumber: string;
  callSid: string;
  selectedWorkflowId: string;
  consentGranted: boolean;
  budgetRemainingUsd: string;
  estimatedCostUsd: string;
  localHour: string;
  startHour: string;
  endHour: string;
}

interface CallControlDraft {
  callSessionId: string;
  dispatchId: string;
  eventType: TelephonyCallControlEventType;
  digit: string;
  transferTarget: string;
  fallbackTarget: string;
}

function createInitialPlatformDraft(): PlatformConnectionDraft {
  return {
    label: "Zara Edge West",
    region: "eu-west-1",
    provider: "twilio",
    phoneNumber: "+14155550110",
    friendlyName: "Premium support",
    consentMode: "two-party",
    consentMessage: "This line records after consent.",
  };
}

function createInitialTwilioDraft(): TwilioConnectionDraft {
  return {
    label: "Tenant Twilio account",
    region: "us-east-1",
    accountSid: "",
    authToken: "",
    consentMode: "single-party",
    consentMessage: "This call may be recorded for quality assurance.",
    blockRoutingOnHealthFailure: true,
  };
}

function createInitialSipDraft(): SipConnectionDraft {
  return {
    label: "Accra SIP trunk",
    region: "eu-west-1",
    username: "acme-trunk",
    secret: "",
    sipDomain: "sip.acme.example",
    codecs: "opus, pcmu",
    phoneNumber: "+233302001100",
    friendlyName: "Accra trunk DID",
    consentMode: "single-party",
    consentMessage: "This line may be recorded for quality assurance.",
    blockRoutingOnHealthFailure: true,
  };
}

function createInitialInboundDispatchDraft(): InboundDispatchDraft {
  return {
    toPhoneNumber: "",
    fromPhoneNumber: "+233201110001",
    callSid: "CA-inbound-test-001",
  };
}

function createInitialOutboundDispatchDraft(): OutboundDispatchDraft {
  return {
    fromPhoneNumber: "",
    toPhoneNumber: "+14155550999",
    callSid: "CA-outbound-test-001",
    selectedWorkflowId: "",
    consentGranted: true,
    budgetRemainingUsd: "5.00",
    estimatedCostUsd: "0.75",
    localHour: "11",
    startHour: "8",
    endHour: "19",
  };
}

function createInitialCallControlDraft(): CallControlDraft {
  return {
    callSessionId: "",
    dispatchId: "",
    eventType: "dtmf.received",
    digit: "4",
    transferTarget: "+14155550888",
    fallbackTarget: "Billing voicemail",
  };
}

export function TelephonyScreen({
  activeWorkspaceId,
  workspaces,
  showToast,
}: TelephonyScreenProps) {
  const [state, setState] = useState<TelephonyStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [platformDraft, setPlatformDraft] = useState<PlatformConnectionDraft>(() =>
    createInitialPlatformDraft(),
  );
  const [twilioDraft, setTwilioDraft] = useState<TwilioConnectionDraft>(() =>
    createInitialTwilioDraft(),
  );
  const [sipDraft, setSipDraft] = useState<SipConnectionDraft>(() => createInitialSipDraft());
  const [dispatchDraft, setDispatchDraft] = useState<InboundDispatchDraft>(() =>
    createInitialInboundDispatchDraft(),
  );
  const [outboundDraft, setOutboundDraft] = useState<OutboundDispatchDraft>(() =>
    createInitialOutboundDispatchDraft(),
  );
  const [controlDraft, setControlDraft] = useState<CallControlDraft>(() =>
    createInitialCallControlDraft(),
  );
  const [routeSelections, setRouteSelections] = useState<Record<string, string>>({});
  const [lastDispatch, setLastDispatch] = useState<TelephonyDispatchRecord | null>(null);
  const [lastOutboundDispatch, setLastOutboundDispatch] =
    useState<TelephonyDispatchRecord | null>(null);
  const [lastControlEvent, setLastControlEvent] = useState<TelephonyCallControlEvent | null>(null);
  const [workflowCatalogVersion, setWorkflowCatalogVersion] = useState(0);

  const publishedWorkflows = useMemo(
    () =>
      loadPublishedWorkflowVersionsForWorkspace({
        tenantId,
        workspaceId: activeWorkspaceId,
      }),
    [activeWorkspaceId, workflowCatalogVersion],
  );

  const workspaceNameById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name] as const)),
    [workspaces],
  );

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    void fetchTelephonyState(tenantId)
      .then((nextState) => {
        if (!cancelled) {
          setState(nextState);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          showToast(error instanceof Error ? error.message : "Telephony state could not be loaded.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, showToast]);

  useEffect(() => {
    if (state === null) {
      return;
    }

    setRouteSelections((current) => {
      const nextSelections = { ...current };

      for (const phoneNumber of state.phoneNumbers) {
        if ((nextSelections[phoneNumber.id] ?? "").length > 0) {
          continue;
        }

        const workspaceWorkflow =
          getLatestPublishedWorkflow(
            publishedWorkflows,
            phoneNumber.workspaceId ?? activeWorkspaceId,
          ) ?? getLatestPublishedWorkflow(publishedWorkflows, activeWorkspaceId);

        nextSelections[phoneNumber.id] =
          phoneNumber.publishedVersionId ?? workspaceWorkflow?.id ?? "";
      }

      return nextSelections;
    });

    setDispatchDraft((current) =>
      current.toPhoneNumber.length > 0 || state.phoneNumbers.length === 0
        ? current
        : { ...current, toPhoneNumber: state.phoneNumbers[0]!.phoneNumber },
    );

    const latestRoutedNumber = state.phoneNumbers.find((phoneNumber) => phoneNumber.status === "routed");
    const latestWorkflow =
      getLatestPublishedWorkflow(publishedWorkflows, activeWorkspaceId) ?? publishedWorkflows[0];
    const latestDispatch = state.dispatches[0];

    setOutboundDraft((current) => ({
      ...current,
      fromPhoneNumber:
        current.fromPhoneNumber.length > 0
          ? current.fromPhoneNumber
          : latestRoutedNumber?.phoneNumber ?? "",
      selectedWorkflowId:
        current.selectedWorkflowId.length > 0
          ? current.selectedWorkflowId
          : latestWorkflow?.id ?? "",
    }));

    if (latestDispatch !== undefined && latestDispatch.callSessionId !== undefined) {
      setControlDraft((current) => ({
        ...current,
        callSessionId:
          current.callSessionId.length > 0
            ? current.callSessionId
            : (latestDispatch.callSessionId ?? current.callSessionId),
        dispatchId: current.dispatchId.length > 0 ? current.dispatchId : latestDispatch.id,
      }));
    }
  }, [activeWorkspaceId, publishedWorkflows, state]);

  const contentState = state ?? {
    organizationId: tenantId,
    connections: [],
    phoneNumbers: [],
    healthChecks: [],
    providerHeartbeats: [],
    dispatches: [],
    executionSessions: [],
    executionCommands: [],
    webhookEvents: [],
    callControlEvents: [],
  };
  const providerHeartbeats = contentState.providerHeartbeats ?? [];
  const executionSessions = contentState.executionSessions ?? [];
  const executionCommands = contentState.executionCommands ?? [];

  const metrics = useMemo(() => {
    const routedNumbers = contentState.phoneNumbers.filter((phoneNumber) => phoneNumber.status === "routed");
    const outboundQueued = contentState.dispatches.filter(
      (dispatch) => dispatch.direction === "outbound" && dispatch.disposition === "queued",
    );

    return {
      activeConnections: contentState.connections.filter((connection) => connection.status === "active").length,
      routedNumbers: routedNumbers.length,
      outboundQueued: outboundQueued.length,
      liveControls: contentState.callControlEvents.length,
    };
  }, [contentState]);

  const platformConnections = contentState.connections.filter(
    (connection) => connection.ownershipMode === "platform_managed",
  );
  const twilioConnections = contentState.connections.filter(
    (connection) => connection.ownershipMode === "byo_provider_account",
  );
  const sipConnections = contentState.connections.filter(
    (connection) => connection.ownershipMode === "byo_sip_trunk",
  );
  const primaryHealthConnection =
    sipConnections[0] ?? twilioConnections[0] ?? platformConnections[0] ?? null;
  const primaryHealthCheck =
    primaryHealthConnection === null
      ? null
      : contentState.healthChecks.find(
          (candidate) => candidate.connectionId === primaryHealthConnection.id,
        ) ?? null;
  const primaryHeartbeat =
    primaryHealthConnection === null
      ? null
      : providerHeartbeats.find((candidate) => candidate.connectionId === primaryHealthConnection.id) ??
        null;

  const callSessionOptions = contentState.dispatches.filter(
    (dispatch) => dispatch.callSessionId !== undefined,
  );

  const createPlatformConnection = async () => {
    try {
      const response = await createPlatformManagedConnectionViaApi({
        organizationId: tenantId,
        actorUserId,
        label: platformDraft.label,
        region: platformDraft.region,
        provider: platformDraft.provider,
        recordingPolicy: buildRecordingPolicy(platformDraft),
      });

      setState(response.state);
      showToast("Platform telephony edge connected.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Platform telephony could not be connected.");
    }
  };

  const createTwilioConnection = async () => {
    if (twilioDraft.accountSid.trim().length === 0 || twilioDraft.authToken.trim().length === 0) {
      showToast("Twilio account SID and auth token are required.");
      return;
    }

    try {
      const response = await createTwilioConnectionViaApi({
        organizationId: tenantId,
        actorUserId,
        label: twilioDraft.label,
        region: twilioDraft.region,
        accountSid: twilioDraft.accountSid.trim(),
        authToken: twilioDraft.authToken.trim(),
        blockRoutingOnHealthFailure: twilioDraft.blockRoutingOnHealthFailure,
        recordingPolicy: buildRecordingPolicy(twilioDraft),
      });

      setState(response.state);
      showToast("Twilio provider account connected.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Twilio connection could not be created.");
    }
  };

  const createSipConnection = async () => {
    if (sipDraft.secret.trim().length === 0) {
      showToast("SIP secret is required before the trunk can be connected.");
      return;
    }

    try {
      const response = await createSipConnectionViaApi({
        organizationId: tenantId,
        actorUserId,
        label: sipDraft.label,
        region: sipDraft.region,
        username: sipDraft.username.trim(),
        secret: sipDraft.secret.trim(),
        sipDomain: sipDraft.sipDomain.trim(),
        codecs: parseCodecList(sipDraft.codecs),
        blockRoutingOnHealthFailure: sipDraft.blockRoutingOnHealthFailure,
        recordingPolicy: buildRecordingPolicy(sipDraft),
      });

      setState(response.state);
      showToast("SIP trunk connected.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "SIP trunk could not be created.");
    }
  };

  const registerPlatformNumber = async () => {
    const connection = platformConnections[0];
    if (connection === undefined) {
      showToast("Connect a platform telephony edge before provisioning Zara numbers.");
      return;
    }

    try {
      const response = await registerTelephonyNumberViaApi({
        organizationId: tenantId,
        connectionId: connection.id,
        phoneNumber: platformDraft.phoneNumber.trim(),
        friendlyName: platformDraft.friendlyName.trim(),
      });

      setState(response.state);
      showToast("Platform number provisioned.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Platform number could not be provisioned.");
    }
  };

  const registerSipDid = async () => {
    const connection = sipConnections[0];
    if (connection === undefined) {
      showToast("Connect a SIP trunk before adding a DID.");
      return;
    }

    try {
      const response = await registerTelephonyNumberViaApi({
        organizationId: tenantId,
        connectionId: connection.id,
        phoneNumber: sipDraft.phoneNumber.trim(),
        friendlyName: sipDraft.friendlyName.trim(),
      });

      setState(response.state);
      showToast("SIP DID added.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "SIP DID could not be added.");
    }
  };

  const validateConnection = async (connectionId: string) => {
    try {
      const response = await validateTelephonyConnectionViaApi({
        organizationId: tenantId,
        connectionId,
        actorUserId,
      });

      setState(response.state);
      showToast(response.healthCheck.message);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Provider validation failed.");
    }
  };

  const runConnectionHeartbeat = async (connectionId: string) => {
    try {
      const response = await runTelephonyHeartbeatViaApi({
        organizationId: tenantId,
        connectionId,
      });

      setState(response.state);
      showToast(response.heartbeat.message);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Provider heartbeat could not be completed.");
    }
  };

  const importNumbers = async (connectionId: string) => {
    try {
      const response = await importTwilioNumbersViaApi({
        organizationId: tenantId,
        connectionId,
        actorUserId,
      });

      setState(response.state);
      showToast("Voice-capable Twilio numbers imported.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Twilio numbers could not be imported.");
    }
  };

  const saveRoute = async (numberId: string) => {
    const selectedWorkflowId = routeSelections[numberId];
    const selectedWorkflow = publishedWorkflows.find((workflow) => workflow.id === selectedWorkflowId);

    if (selectedWorkflow === undefined) {
      showToast("Publish a workflow for this workspace before assigning number routing.");
      return;
    }

    try {
      const response = await assignTelephonyRouteViaApi({
        organizationId: tenantId,
        numberId,
        actorUserId,
        publishedVersionId: selectedWorkflow.id,
        workflowLabel: selectedWorkflow.graph.name,
        workspaceId: selectedWorkflow.workspaceId ?? activeWorkspaceId,
        recordingPolicy:
          resolveSelectedNumberRecordingPolicy(contentState, numberId) ?? buildRecordingPolicy(platformDraft),
      });

      setState(response.state);
      showToast(`Saved route to ${selectedWorkflow.graph.name}.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Number routing could not be saved.");
    }
  };

  const runInboundDispatch = async () => {
    if (dispatchDraft.toPhoneNumber.trim().length === 0) {
      showToast("Select a routed number before running an inbound dispatch.");
      return;
    }

    try {
      const response = await dispatchInboundTelephonyTestViaApi({
        organizationId: tenantId,
        toPhoneNumber: dispatchDraft.toPhoneNumber.trim(),
        fromPhoneNumber: dispatchDraft.fromPhoneNumber.trim(),
        callSid: dispatchDraft.callSid.trim(),
      });

      setState(response.state);
      setLastDispatch(response.dispatch);
      showToast("Inbound dispatch test completed.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Inbound dispatch test failed.");
    }
  };

  const runLoopbackTestCall = async () => {
    const selectedNumber = contentState.phoneNumbers.find(
      (phoneNumber) => phoneNumber.phoneNumber === dispatchDraft.toPhoneNumber,
    );

    if (selectedNumber === undefined) {
      showToast("Select a routed number before running a loopback test call.");
      return;
    }

    try {
      const response = await runTelephonyLoopbackTestViaApi({
        organizationId: tenantId,
        connectionId: selectedNumber.connectionId,
        phoneNumberId: selectedNumber.id,
        fromPhoneNumber: dispatchDraft.fromPhoneNumber.trim(),
        callSid: dispatchDraft.callSid.trim(),
      });

      setState(response.state);
      setLastDispatch(response.dispatch);
      setControlDraft((current) => ({
        ...current,
        callSessionId: response.session.callSessionId,
        dispatchId: response.session.dispatchId,
      }));
      showToast("Loopback test call started.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Loopback test call could not be started.");
    }
  };

  const runOutboundDispatch = async () => {
    const selectedWorkflow = publishedWorkflows.find(
      (workflow) => workflow.id === outboundDraft.selectedWorkflowId,
    );

    if (selectedWorkflow === undefined) {
      showToast("Select a published workflow before running outbound dispatch.");
      return;
    }

    if (outboundDraft.fromPhoneNumber.trim().length === 0) {
      showToast("Select a caller ID number before running outbound dispatch.");
      return;
    }

    try {
      const response = await dispatchOutboundTelephonyCallViaApi({
        organizationId: tenantId,
        toPhoneNumber: outboundDraft.toPhoneNumber.trim(),
        fromPhoneNumber: outboundDraft.fromPhoneNumber.trim(),
        callSid: outboundDraft.callSid.trim(),
        publishedVersionId: selectedWorkflow.id,
        workflowLabel: selectedWorkflow.graph.name,
        workspaceId: selectedWorkflow.workspaceId ?? activeWorkspaceId,
        consentGranted: outboundDraft.consentGranted,
        budgetRemainingUsd: Number(outboundDraft.budgetRemainingUsd),
        estimatedCostUsd: Number(outboundDraft.estimatedCostUsd),
        localHour: Number(outboundDraft.localHour),
        callingWindow: {
          startHour: Number(outboundDraft.startHour),
          endHour: Number(outboundDraft.endHour),
        },
      });

      setState(response.state);
      setLastOutboundDispatch(response.dispatch);
      setControlDraft((current) => ({
        ...current,
        callSessionId: response.dispatch.callSessionId ?? current.callSessionId,
        dispatchId: response.dispatch.id,
      }));
      showToast(
        response.dispatch.disposition === "queued"
          ? "Outbound dispatch queued."
          : response.dispatch.reason ?? "Outbound dispatch blocked.",
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Outbound dispatch could not be evaluated.");
    }
  };

  const submitCallControlEvent = async () => {
    if (controlDraft.callSessionId.trim().length === 0 || controlDraft.dispatchId.trim().length === 0) {
      showToast("Choose a live or recently queued call session before sending call controls.");
      return;
    }

    try {
      const response = await recordTelephonyCallControlEventViaApi({
        organizationId: tenantId,
        callSessionId: controlDraft.callSessionId.trim(),
        dispatchId: controlDraft.dispatchId.trim(),
        eventType: controlDraft.eventType,
        digit:
          controlDraft.eventType === "dtmf.received" ? controlDraft.digit.trim() : undefined,
        transferTarget:
          controlDraft.eventType === "transfer.requested" ||
          controlDraft.eventType === "transfer.failed"
            ? controlDraft.transferTarget.trim()
            : undefined,
        fallbackTarget:
          controlDraft.eventType === "voicemail.detected" ||
          controlDraft.eventType === "transfer.failed" ||
          controlDraft.eventType === "failover.triggered"
            ? controlDraft.fallbackTarget.trim()
            : undefined,
      });

      setState(response.state);
      setLastControlEvent(response.event);
      showToast(response.event.summary);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Call control event could not be recorded.");
    }
  };

  const rotateCredentials = async () => {
    try {
      const response = await rotateTelephonyCredentialsViaApi({
        organizationId: tenantId,
      });

      setState(response.state);
      showToast(
        response.rotatedConnectionCount === 0
          ? "No provider credentials needed rotation."
          : `Rotated ${response.rotatedConnectionCount} provider credential ${response.rotatedConnectionCount === 1 ? "envelope" : "envelopes"}.`,
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Credential rotation could not be completed.");
    }
  };

  return (
    <div className="telephony-page">
      <section className="surface-card telephony-hero-band">
        <div className="telephony-hero-copy">
          <div className="eyebrow-copy">Telephony</div>
          <h1 className="telephony-page-title">Telephony operations</h1>
          <p className="body-copy telephony-page-copy">
            Run platform lines, tenant Twilio accounts, and SIP trunks from one control surface, then validate inbound and outbound traffic before calls hit production.
          </p>
        </div>

        <div className="telephony-summary-grid">
          <MetricTile icon={Cable} label="Active connections" value={String(metrics.activeConnections)} />
          <MetricTile icon={Router} label="Routed numbers" value={String(metrics.routedNumbers)} />
          <MetricTile icon={PhoneCall} label="Outbound queued" value={String(metrics.outboundQueued)} />
          <MetricTile icon={Waves} label="Call controls" value={String(metrics.liveControls)} />
        </div>
      </section>

      <div className="telephony-grid">
        <div className="telephony-main">
          <div className="telephony-setup-grid">
            <section className="surface-card telephony-panel telephony-setup-card">
              <div className="telephony-section-head">
                <div>
                  <div className="eyebrow-copy">Platform edge</div>
                  <div className="subhead-copy telephony-section-title">Zara-managed telephony</div>
                </div>
                <button className="workflow-button workflow-button-primary" type="button" onClick={createPlatformConnection}>
                  <PhoneCall size={15} />
                  <span>Connect edge</span>
                </button>
              </div>

              <div className="telephony-form-grid telephony-form-grid-compact">
                <label className="workspace-settings-field">
                  <span>Connection label</span>
                  <input
                    value={platformDraft.label}
                    onChange={(event) =>
                      setPlatformDraft((current) => ({ ...current, label: event.target.value }))
                    }
                  />
                </label>
                <label className="workspace-settings-field">
                  <span>Provider rail</span>
                  <select
                    value={platformDraft.provider}
                    onChange={(event) =>
                      setPlatformDraft((current) => ({
                        ...current,
                        provider: event.target.value as PlatformConnectionDraft["provider"],
                      }))
                    }
                  >
                    <option value="twilio">Twilio</option>
                    <option value="signalwire">SignalWire</option>
                    <option value="telnyx">Telnyx</option>
                  </select>
                </label>
                <label className="workspace-settings-field">
                  <span>Region</span>
                  <select
                    value={platformDraft.region}
                    onChange={(event) =>
                      setPlatformDraft((current) => ({ ...current, region: event.target.value }))
                    }
                  >
                    <option value="eu-west-1">EU West</option>
                    <option value="us-east-1">US East</option>
                  </select>
                </label>
                <label className="workspace-settings-field">
                  <span>Provision number</span>
                  <input
                    value={platformDraft.phoneNumber}
                    onChange={(event) =>
                      setPlatformDraft((current) => ({ ...current, phoneNumber: event.target.value }))
                    }
                  />
                </label>
                <label className="workspace-settings-field">
                  <span>Friendly name</span>
                  <input
                    value={platformDraft.friendlyName}
                    onChange={(event) =>
                      setPlatformDraft((current) => ({ ...current, friendlyName: event.target.value }))
                    }
                  />
                </label>
              </div>

              <div className="telephony-row-actions">
                <button className="workflow-button" type="button" onClick={registerPlatformNumber}>
                  <PhoneIncoming size={15} />
                  <span>Provision number</span>
                </button>
              </div>
            </section>

            <section className="surface-card telephony-panel telephony-setup-card">
              <div className="telephony-section-head">
                <div>
                  <div className="eyebrow-copy">BYO provider</div>
                  <div className="subhead-copy telephony-section-title">Twilio account</div>
                </div>
                <button className="workflow-button workflow-button-primary" type="button" onClick={createTwilioConnection}>
                  <PhoneCall size={15} />
                  <span>Connect Twilio</span>
                </button>
              </div>

              <div className="telephony-form-grid telephony-form-grid-compact">
                <label className="workspace-settings-field">
                  <span>Connection label</span>
                  <input
                    value={twilioDraft.label}
                    onChange={(event) =>
                      setTwilioDraft((current) => ({ ...current, label: event.target.value }))
                    }
                  />
                </label>
                <label className="workspace-settings-field">
                  <span>Region</span>
                  <select
                    value={twilioDraft.region}
                    onChange={(event) =>
                      setTwilioDraft((current) => ({ ...current, region: event.target.value }))
                    }
                  >
                    <option value="us-east-1">US East</option>
                    <option value="eu-west-1">EU West</option>
                  </select>
                </label>
                <label className="workspace-settings-field">
                  <span>Twilio account SID</span>
                  <input
                    value={twilioDraft.accountSid}
                    onChange={(event) =>
                      setTwilioDraft((current) => ({ ...current, accountSid: event.target.value }))
                    }
                  />
                </label>
                <label className="workspace-settings-field">
                  <span>Twilio auth token</span>
                  <input
                    type="password"
                    value={twilioDraft.authToken}
                    onChange={(event) =>
                      setTwilioDraft((current) => ({ ...current, authToken: event.target.value }))
                    }
                  />
                </label>
              </div>
            </section>

            <section className="surface-card telephony-panel telephony-setup-card">
              <div className="telephony-section-head">
                <div>
                  <div className="eyebrow-copy">BYO trunk</div>
                  <div className="subhead-copy telephony-section-title">SIP connection</div>
                </div>
                <button className="workflow-button workflow-button-primary" type="button" onClick={createSipConnection}>
                  <Router size={15} />
                  <span>Connect SIP</span>
                </button>
              </div>

              <div className="telephony-form-grid telephony-form-grid-compact">
                <label className="workspace-settings-field">
                  <span>SIP domain</span>
                  <input
                    value={sipDraft.sipDomain}
                    onChange={(event) =>
                      setSipDraft((current) => ({ ...current, sipDomain: event.target.value }))
                    }
                  />
                </label>
                <label className="workspace-settings-field">
                  <span>Username</span>
                  <input
                    value={sipDraft.username}
                    onChange={(event) =>
                      setSipDraft((current) => ({ ...current, username: event.target.value }))
                    }
                  />
                </label>
                <label className="workspace-settings-field">
                  <span>Secret</span>
                  <input
                    type="password"
                    value={sipDraft.secret}
                    onChange={(event) =>
                      setSipDraft((current) => ({ ...current, secret: event.target.value }))
                    }
                  />
                </label>
                <label className="workspace-settings-field">
                  <span>Codecs</span>
                  <input
                    value={sipDraft.codecs}
                    onChange={(event) =>
                      setSipDraft((current) => ({ ...current, codecs: event.target.value }))
                    }
                  />
                </label>
                <label className="workspace-settings-field">
                  <span>DID number</span>
                  <input
                    value={sipDraft.phoneNumber}
                    onChange={(event) =>
                      setSipDraft((current) => ({ ...current, phoneNumber: event.target.value }))
                    }
                  />
                </label>
                <label className="workspace-settings-field">
                  <span>Friendly name</span>
                  <input
                    value={sipDraft.friendlyName}
                    onChange={(event) =>
                      setSipDraft((current) => ({ ...current, friendlyName: event.target.value }))
                    }
                  />
                </label>
              </div>

              <div className="telephony-row-actions">
                <button className="workflow-button" type="button" onClick={registerSipDid}>
                  <PhoneIncoming size={15} />
                  <span>Add DID</span>
                </button>
              </div>
            </section>
          </div>

          <section className="surface-card telephony-panel">
            <div className="telephony-section-head">
              <div>
                <div className="eyebrow-copy">Connections</div>
                <div className="subhead-copy telephony-section-title">Provider state</div>
              </div>
              <div className="telephony-row-actions">
                <button className="workflow-button" type="button" onClick={rotateCredentials}>
                  <KeyRound size={15} />
                  <span>Rotate credentials</span>
                </button>
                {loading ? <div className="panel-meta">Loading</div> : null}
              </div>
            </div>

            {contentState.connections.length === 0 ? (
              <div className="telephony-empty-state">
                Connect platform, Twilio, or SIP telephony to begin routing live voice traffic.
              </div>
            ) : (
              <div className="telephony-connection-list">
                {contentState.connections.map((connection) => (
                  <article key={connection.id} className="telephony-connection-card">
                    <div className="telephony-connection-header">
                      <div>
                        <div className="panel-title">{connection.label}</div>
                        <div className="panel-meta">
                          {formatConnectionMode(connection.ownershipMode)} - {connection.region}
                        </div>
                      </div>
                      <div className="telephony-connection-pills">
                        <span className={resolveHealthPillClassName(connection.healthStatus)}>
                          {formatConnectionHealth(connection.healthStatus)}
                        </span>
                        <span className="status-pill status-pill-neutral">
                          {formatRecordingLabel(connection.recordingPolicy)}
                        </span>
                      </div>
                    </div>

                    <div className="telephony-connection-detail-grid">
                      <ConnectionDetail
                        label="Credential"
                        value={connection.credentialReference?.preview ?? "Platform managed"}
                      />
                      <ConnectionDetail label="Webhook" value={connection.webhookStatus} />
                      <ConnectionDetail
                        label="Provider"
                        value={connection.provider === "custom-sip" ? connection.sip?.domain ?? "custom-sip" : connection.provider}
                      />
                      <ConnectionDetail
                        label="Routing guard"
                        value={connection.blockRoutingOnHealthFailure ? "Block on failure" : "Warn only"}
                      />
                    </div>

                    <div className="telephony-row-actions">
                      <button className="workflow-button" type="button" onClick={() => runConnectionHeartbeat(connection.id)}>
                        <Activity size={15} />
                        <span>Run heartbeat</span>
                      </button>
                      <button className="workflow-button" type="button" onClick={() => validateConnection(connection.id)}>
                        <BadgeCheck size={15} />
                        <span>Validate provider</span>
                      </button>
                      {connection.ownershipMode === "byo_provider_account" ? (
                        <button className="workflow-button" type="button" onClick={() => importNumbers(connection.id)}>
                          <PhoneIncoming size={15} />
                          <span>Import phone numbers</span>
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="surface-card telephony-panel">
            <div className="telephony-section-head">
              <div>
                <div className="eyebrow-copy">Routing</div>
                <div className="subhead-copy telephony-section-title">Live numbers</div>
              </div>
              <button className="workflow-button" type="button" onClick={() => setWorkflowCatalogVersion((current) => current + 1)}>
                <Bot size={15} />
                <span>Reload workflows</span>
              </button>
            </div>

            {contentState.phoneNumbers.length === 0 ? (
              <div className="telephony-empty-state">
                Provision a platform number, import Twilio inventory, or attach a SIP DID to start live routing.
              </div>
            ) : (
              <div className="telephony-number-table" role="table" aria-label="Telephony numbers">
                <div className="telephony-number-table-head" role="row">
                  <span>Number</span>
                  <span>Workflow</span>
                  <span>Workspace</span>
                  <span>Status</span>
                </div>
                {contentState.phoneNumbers.map((phoneNumber) => (
                  <div key={phoneNumber.id} className="telephony-number-row" role="row">
                    <div>
                      <div className="panel-title">{phoneNumber.phoneNumber}</div>
                      <div className="panel-meta">
                        {phoneNumber.friendlyName} - {formatProvisionSource(phoneNumber.provisionSource)}
                      </div>
                    </div>
                    <label className="workspace-inline-field">
                      <span className="sr-only">{`Workflow route for ${phoneNumber.phoneNumber}`}</span>
                      <select
                        value={routeSelections[phoneNumber.id] ?? ""}
                        onChange={(event) =>
                          setRouteSelections((current) => ({
                            ...current,
                            [phoneNumber.id]: event.target.value,
                          }))
                        }
                      >
                        <option value="">Select workflow</option>
                        {publishedWorkflows.map((workflow) => (
                          <option key={workflow.id} value={workflow.id}>
                            {workflow.graph.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="panel-meta">
                      {workspaceNameById.get(phoneNumber.workspaceId ?? activeWorkspaceId) ?? "Unassigned"}
                    </div>
                    <div className="telephony-number-status">
                      <span className={phoneNumber.status === "routed" ? "status-pill status-pill-blue" : "status-pill status-pill-neutral"}>
                        {phoneNumber.status}
                      </span>
                      <button
                        aria-label={`Save route for ${phoneNumber.phoneNumber}`}
                        className="workflow-button"
                        type="button"
                        onClick={() => saveRoute(phoneNumber.id)}
                      >
                        <Waves size={15} />
                        <span>Save route</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="telephony-side">
          <section className="surface-card telephony-panel">
            <div className="telephony-section-head">
              <div>
                <div className="eyebrow-copy">Health</div>
                <div className="subhead-copy telephony-section-title">Provider posture</div>
              </div>
            </div>

            {primaryHealthConnection === null ? (
              <div className="telephony-empty-state">No provider connected yet.</div>
            ) : (
              <div className="telephony-side-stack">
                <div className="subtle-panel telephony-health-card">
                  <div className="telephony-health-title">
                    <Activity size={15} />
                    <span>{formatConnectionHealth(primaryHealthConnection.healthStatus)}</span>
                  </div>
                  <p className="panel-meta">
                    {primaryHeartbeat?.message ??
                      primaryHealthCheck?.message ??
                      "Run a validation pass to confirm readiness before routing traffic."}
                  </p>
                  {primaryHeartbeat?.diagnostics?.length ? (
                    <div className="telephony-policy-grid">
                      {primaryHeartbeat.diagnostics.slice(0, 2).map((diagnostic) => (
                        <div key={diagnostic} className="telephony-policy-chip">
                          <span>{diagnostic}</span>
                          <strong>{primaryHeartbeat.latencyMs}ms</strong>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="subtle-panel telephony-health-card">
                  <div className="telephony-health-title">
                    <ShieldCheck size={15} />
                    <span>Recording policy</span>
                  </div>
                  <p className="panel-meta">
                    {formatRecordingSummary(primaryHealthConnection.recordingPolicy)}
                  </p>
                </div>
              </div>
            )}
          </section>

          <section className="surface-card telephony-panel">
            <div className="telephony-section-head">
              <div>
                <div className="eyebrow-copy">Inbound test</div>
                <div className="subhead-copy telephony-section-title">Dispatch runner</div>
              </div>
            </div>

            <div className="telephony-form-grid telephony-form-grid-compact">
              <label className="workspace-settings-field">
                <span>Destination number</span>
                <select
                  value={dispatchDraft.toPhoneNumber}
                  onChange={(event) =>
                    setDispatchDraft((current) => ({ ...current, toPhoneNumber: event.target.value }))
                  }
                >
                  <option value="">Select imported number</option>
                  {contentState.phoneNumbers.map((phoneNumber) => (
                    <option key={phoneNumber.id} value={phoneNumber.phoneNumber}>
                      {phoneNumber.phoneNumber}
                    </option>
                  ))}
                </select>
              </label>
              <label className="workspace-settings-field">
                <span>Caller</span>
                <input
                  value={dispatchDraft.fromPhoneNumber}
                  onChange={(event) =>
                    setDispatchDraft((current) => ({ ...current, fromPhoneNumber: event.target.value }))
                  }
                />
              </label>
              <label className="workspace-settings-field">
                <span>Call SID</span>
                <input
                  value={dispatchDraft.callSid}
                  onChange={(event) =>
                    setDispatchDraft((current) => ({ ...current, callSid: event.target.value }))
                  }
                />
              </label>
            </div>

            <div className="telephony-row-actions">
              <button className="workflow-button workflow-button-success" type="button" onClick={runInboundDispatch}>
                <TestTube2 size={15} />
                <span>Run inbound dispatch</span>
              </button>
              <button className="workflow-button" type="button" onClick={runLoopbackTestCall}>
                <PhoneCall size={15} />
                <span>Run loopback test call</span>
              </button>
            </div>

            <div className="telephony-dispatch-result subtle-panel">
              <div className="telephony-health-title">
                <ArrowRightLeft size={15} />
                <span>
                  {lastDispatch === null
                    ? "Awaiting test"
                    : lastDispatch.disposition === "fallback"
                      ? "Provider fallback"
                      : lastDispatch.disposition === "routed"
                        ? "Routed"
                        : "Awaiting test"}
                </span>
              </div>
              <p className="panel-meta">
                {lastDispatch?.reason ??
                  "Pick a live number to confirm the route before voice traffic reaches production."}
              </p>
              {lastDispatch?.outageMode === "provider-fallback" ? (
                <div className="telephony-policy-grid">
                  <div className="telephony-policy-chip">
                    <span>Outage mode</span>
                    <strong>provider fallback</strong>
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section className="surface-card telephony-panel">
            <div className="telephony-section-head">
              <div>
                <div className="eyebrow-copy">Outbound</div>
                <div className="subhead-copy telephony-section-title">Dispatch policy gate</div>
              </div>
            </div>

            <div className="telephony-form-grid telephony-form-grid-compact">
              <label className="workspace-settings-field">
                <span>Caller ID</span>
                <select
                  value={outboundDraft.fromPhoneNumber}
                  onChange={(event) =>
                    setOutboundDraft((current) => ({ ...current, fromPhoneNumber: event.target.value }))
                  }
                >
                  <option value="">Select routed number</option>
                  {contentState.phoneNumbers
                    .filter((phoneNumber) => phoneNumber.status === "routed")
                    .map((phoneNumber) => (
                      <option key={phoneNumber.id} value={phoneNumber.phoneNumber}>
                        {phoneNumber.phoneNumber}
                      </option>
                    ))}
                </select>
              </label>
              <label className="workspace-settings-field">
                <span>Destination</span>
                <input
                  value={outboundDraft.toPhoneNumber}
                  onChange={(event) =>
                    setOutboundDraft((current) => ({ ...current, toPhoneNumber: event.target.value }))
                  }
                />
              </label>
              <label className="workspace-settings-field">
                <span>Workflow</span>
                <select
                  value={outboundDraft.selectedWorkflowId}
                  onChange={(event) =>
                    setOutboundDraft((current) => ({
                      ...current,
                      selectedWorkflowId: event.target.value,
                    }))
                  }
                >
                  <option value="">Select workflow</option>
                  {publishedWorkflows.map((workflow) => (
                    <option key={workflow.id} value={workflow.id}>
                      {workflow.graph.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="workspace-settings-field">
                <span>Budget remaining (USD)</span>
                <input
                  value={outboundDraft.budgetRemainingUsd}
                  onChange={(event) =>
                    setOutboundDraft((current) => ({
                      ...current,
                      budgetRemainingUsd: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="workspace-settings-field">
                <span>Estimated cost (USD)</span>
                <input
                  value={outboundDraft.estimatedCostUsd}
                  onChange={(event) =>
                    setOutboundDraft((current) => ({
                      ...current,
                      estimatedCostUsd: event.target.value,
                    }))
                  }
                />
              </label>
              <div className="telephony-inline-grid">
                <label className="workspace-settings-field">
                  <span>Local hour</span>
                  <input
                    value={outboundDraft.localHour}
                    onChange={(event) =>
                      setOutboundDraft((current) => ({ ...current, localHour: event.target.value }))
                    }
                  />
                </label>
                <label className="workspace-settings-field">
                  <span>Start</span>
                  <input
                    value={outboundDraft.startHour}
                    onChange={(event) =>
                      setOutboundDraft((current) => ({ ...current, startHour: event.target.value }))
                    }
                  />
                </label>
                <label className="workspace-settings-field">
                  <span>End</span>
                  <input
                    value={outboundDraft.endHour}
                    onChange={(event) =>
                      setOutboundDraft((current) => ({ ...current, endHour: event.target.value }))
                    }
                  />
                </label>
              </div>
              <label className="telephony-checkbox">
                <input
                  checked={outboundDraft.consentGranted}
                  type="checkbox"
                  onChange={(event) =>
                    setOutboundDraft((current) => ({
                      ...current,
                      consentGranted: event.target.checked,
                    }))
                  }
                />
                <span>Consent confirmed for outbound contact</span>
              </label>
            </div>

            <div className="telephony-row-actions">
              <button className="workflow-button workflow-button-success" type="button" onClick={runOutboundDispatch}>
                <PhoneForwarded size={15} />
                <span>Run outbound policy check</span>
              </button>
            </div>

            <div className="telephony-dispatch-result subtle-panel">
              <div className="telephony-health-title">
                <PhoneCall size={15} />
                <span>{lastOutboundDispatch?.disposition === "queued" ? "Queued" : "Policy gate"}</span>
              </div>
              <p className="panel-meta">
                {lastOutboundDispatch?.reason ??
                  "Run a dry dispatch to verify caller ID, consent, budget, and calling window."}
              </p>
              {lastOutboundDispatch?.policyChecks !== undefined ? (
                <div className="telephony-policy-grid">
                  {Object.entries(lastOutboundDispatch.policyChecks).map(([key, value]) => (
                    <div key={key} className="telephony-policy-chip">
                      <span>{formatPolicyKey(key)}</span>
                      <strong>{value.status}</strong>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          <section className="surface-card telephony-panel">
            <div className="telephony-section-head">
              <div>
                <div className="eyebrow-copy">Execution</div>
                <div className="subhead-copy telephony-section-title">Provider bridge</div>
              </div>
            </div>

            {executionSessions.length === 0 ? (
              <div className="telephony-empty-state">
                Provider execution sessions appear here after loopback tests, inbound dispatch, or outbound queueing.
              </div>
            ) : (
              <div className="telephony-event-list">
                {executionSessions.slice(0, 4).map((session) => (
                  <div key={session.id} className="subtle-panel telephony-event-card">
                    {/*
                      Keep the bridge summary legible: one operator should understand the
                      active media path and the last provider-native action without opening
                      another surface.
                    */}
                    {(() => {
                      const latestCommand = executionCommands.find(
                        (command) => command.sessionId === session.id,
                      );

                      return (
                        <>
                    <div className="telephony-health-title">
                      <PhoneCall size={15} />
                      <span>{formatExecutionStatus(session.status)}</span>
                    </div>
                    <div className="panel-title">{session.workflowLabel ?? session.callSessionId}</div>
                    <div className="panel-meta">
                      {session.testCall ? "Loopback test" : session.direction} - {formatConnectionMode(session.ownershipMode)}
                    </div>
                    <div className="telephony-policy-grid">
                      <div className="telephony-policy-chip">
                        <span>Provider</span>
                        <strong>{session.provider}</strong>
                      </div>
                      <div className="telephony-policy-chip">
                        <span>Bridge</span>
                        <strong>{formatBridgeKind(session.bridgeKind)}</strong>
                      </div>
                      {session.outageMode === "provider-fallback" ? (
                        <div className="telephony-policy-chip">
                          <span>Outage</span>
                          <strong>fallback active</strong>
                        </div>
                      ) : null}
                    </div>
                    {latestCommand !== undefined ? (
                      <div className="panel-meta">
                        {formatBridgeAction(latestCommand.action)} to {latestCommand.target}
                      </div>
                    ) : null}
                        </>
                      );
                    })()}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="surface-card telephony-panel">
            <div className="telephony-section-head">
              <div>
                <div className="eyebrow-copy">Live controls</div>
                <div className="subhead-copy telephony-section-title">DTMF and failover</div>
              </div>
            </div>

            <div className="telephony-form-grid telephony-form-grid-compact">
              <label className="workspace-settings-field">
                <span>Call session</span>
                <select
                  value={controlDraft.callSessionId}
                  onChange={(event) => {
                    const selectedDispatch = callSessionOptions.find(
                      (dispatch) => dispatch.callSessionId === event.target.value,
                    );
                    setControlDraft((current) => ({
                      ...current,
                      callSessionId: event.target.value,
                      dispatchId: selectedDispatch?.id ?? "",
                    }));
                  }}
                >
                  <option value="">Select call session</option>
                  {callSessionOptions.map((dispatch) => (
                    <option key={dispatch.id} value={dispatch.callSessionId}>
                      {dispatch.direction} - {dispatch.callSessionId}
                    </option>
                  ))}
                </select>
              </label>
              <div className="telephony-control-switcher">
                {callControlModes.map((mode) => (
                  <button
                    key={mode.value}
                    className={
                      controlDraft.eventType === mode.value
                        ? "telephony-control-tab telephony-control-tab-active"
                        : "telephony-control-tab"
                    }
                    type="button"
                    onClick={() =>
                      setControlDraft((current) => ({ ...current, eventType: mode.value }))
                    }
                  >
                    <mode.icon size={14} />
                    <span>{mode.label}</span>
                  </button>
                ))}
              </div>

              {controlDraft.eventType === "dtmf.received" ? (
                <label className="workspace-settings-field">
                  <span>Digit</span>
                  <input
                    value={controlDraft.digit}
                    onChange={(event) =>
                      setControlDraft((current) => ({ ...current, digit: event.target.value }))
                    }
                  />
                </label>
              ) : null}

              {controlDraft.eventType === "transfer.requested" ||
              controlDraft.eventType === "transfer.failed" ? (
                <label className="workspace-settings-field">
                  <span>Transfer target</span>
                  <input
                    value={controlDraft.transferTarget}
                    onChange={(event) =>
                      setControlDraft((current) => ({
                        ...current,
                        transferTarget: event.target.value,
                      }))
                    }
                  />
                </label>
              ) : null}

              {controlDraft.eventType === "voicemail.detected" ||
              controlDraft.eventType === "transfer.failed" ||
              controlDraft.eventType === "failover.triggered" ? (
                <label className="workspace-settings-field">
                  <span>Fallback path</span>
                  <input
                    value={controlDraft.fallbackTarget}
                    onChange={(event) =>
                      setControlDraft((current) => ({
                        ...current,
                        fallbackTarget: event.target.value,
                      }))
                    }
                  />
                </label>
              ) : null}
            </div>

            <div className="telephony-row-actions">
              <button className="workflow-button" type="button" onClick={submitCallControlEvent}>
                <Waves size={15} />
                <span>Record call event</span>
              </button>
            </div>

            <div className="telephony-dispatch-result subtle-panel">
              <div className="telephony-health-title">
                <Waves size={15} />
                <span>{lastControlEvent?.summary ?? "Awaiting live control event"}</span>
              </div>
              <p className="panel-meta">
                {lastControlEvent?.fallbackTarget !== undefined
                  ? `Fallback path: ${lastControlEvent.fallbackTarget}`
                  : "Use this rail to simulate DTMF, voicemail, transfer, and failover while a live call is in motion."}
              </p>
              {executionSessions[0]?.status ? (
                <div className="telephony-policy-grid">
                  <div className="telephony-policy-chip">
                    <span>Session</span>
                    <strong>{formatExecutionStatus(executionSessions[0].status)}</strong>
                  </div>
                </div>
              ) : null}
            </div>

            {contentState.callControlEvents.length > 0 ? (
              <div className="telephony-event-list">
                {contentState.callControlEvents.slice(0, 4).map((event) => (
                  <div key={event.id} className="subtle-panel telephony-event-card">
                    <div className="panel-title">{formatCallControlLabel(event.eventType)}</div>
                    <div className="panel-meta">{event.summary}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section className="surface-card telephony-panel">
            <div className="telephony-section-head">
              <div>
                <div className="eyebrow-copy">Provider events</div>
                <div className="subhead-copy telephony-section-title">Webhooks</div>
              </div>
            </div>

            {contentState.webhookEvents.length === 0 ? (
              <div className="telephony-empty-state">
                Incoming provider callbacks appear here once live voice events start landing.
              </div>
            ) : (
              <div className="telephony-event-list">
                {contentState.webhookEvents.map((event) => (
                  <div key={event.id} className="subtle-panel telephony-event-card">
                    <div className="panel-title">{event.eventType}</div>
                    <div className="panel-meta">{event.callSid}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

const callControlModes: Array<{
  value: TelephonyCallControlEventType;
  label: string;
  icon: typeof Waves;
}> = [
  { value: "dtmf.received", label: "DTMF", icon: Waves },
  { value: "voicemail.detected", label: "Voicemail", icon: Voicemail },
  { value: "transfer.requested", label: "Transfer", icon: PhoneForwarded },
  { value: "transfer.failed", label: "Fallback", icon: PhoneOff },
  { value: "failover.triggered", label: "Failover", icon: CircleSlash2 },
];

function MetricTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
}) {
  return (
    <div className="metric-card telephony-metric-card">
      <div className="telephony-metric-label">
        <Icon size={14} />
        <span>{label}</span>
      </div>
      <div className="telephony-metric-value">{value}</div>
    </div>
  );
}

function ConnectionDetail({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="telephony-detail-cell">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function buildRecordingPolicy(draft: ConnectionDraftBase): TelephonyRecordingPolicy {
  return {
    enabled: draft.consentMode !== "disabled",
    consentMode: draft.consentMode,
    consentMessage: draft.consentMessage,
  };
}

function parseCodecList(value: string) {
  return value
    .split(",")
    .map((codec) => codec.trim().toLowerCase())
    .filter((codec) => codec.length > 0);
}

function resolveSelectedNumberRecordingPolicy(
  state: TelephonyStateResponse,
  numberId: string,
) {
  return state.phoneNumbers.find((phoneNumber) => phoneNumber.id === numberId)?.recordingPolicy;
}

function formatConnectionMode(value: string) {
  switch (value) {
    case "platform_managed":
      return "Platform";
    case "byo_sip_trunk":
      return "BYO SIP";
    case "byo_provider_account":
      return "BYO Twilio";
    default:
      return value;
  }
}

function formatConnectionHealth(status: string) {
  switch (status) {
    case "healthy":
      return "Healthy";
    case "warning":
      return "Needs route";
    case "failed":
      return "Failed";
    default:
      return "Unchecked";
  }
}

function resolveHealthPillClassName(status: string) {
  switch (status) {
    case "healthy":
      return "status-pill status-pill-blue";
    case "warning":
      return "status-pill status-pill-amber";
    case "failed":
      return "status-pill status-pill-red";
    default:
      return "status-pill status-pill-neutral";
  }
}

function formatRecordingLabel(policy: TelephonyRecordingPolicy) {
  if (!policy.enabled || policy.consentMode === "disabled") {
    return "Recording off";
  }

  return policy.consentMode === "two-party" ? "Two-party consent" : "Single-party consent";
}

function formatRecordingSummary(policy: TelephonyRecordingPolicy) {
  if (!policy.enabled || policy.consentMode === "disabled") {
    return "Recording is disabled for this route.";
  }

  return `${formatRecordingLabel(policy)}. ${policy.consentMessage}`;
}

function formatProvisionSource(value: string) {
  switch (value) {
    case "platform-pool":
      return "Platform pool";
    case "manual-did":
      return "Manual DID";
    default:
      return "Provider import";
  }
}

function formatPolicyKey(value: string) {
  switch (value) {
    case "callingWindow":
      return "Window";
    case "callerId":
      return "Caller ID";
    default:
      return value.charAt(0).toUpperCase() + value.slice(1);
  }
}

function formatExecutionStatus(value: string) {
  switch (value) {
    case "ringing":
      return "Ringing";
    case "active":
      return "Active";
    case "transfer-pending":
      return "Transfer pending";
    case "failover-active":
      return "Failover active";
    case "voicemail":
      return "Voicemail fallback";
    case "completed":
      return "Completed";
    case "blocked":
      return "Blocked";
    default:
      return value;
  }
}

function formatBridgeKind(value: string) {
  switch (value) {
    case "platform-edge":
      return "Platform edge";
    case "twilio-programmable-voice":
      return "Twilio voice";
    case "sip-trunk":
      return "SIP trunk";
    default:
      return value;
  }
}

function formatBridgeAction(value: string) {
  switch (value) {
    case "platform.edge.accept-call":
      return "Accepted on platform edge";
    case "platform.edge.originate-call":
      return "Originated on platform edge";
    case "platform.edge.transfer":
      return "Transferred on platform edge";
    case "platform.edge.voicemail-fallback":
      return "Moved to voicemail";
    case "platform.edge.failover":
      return "Failed over on platform edge";
    case "twilio.calls.answer":
      return "Answered on Twilio";
    case "twilio.calls.create":
      return "Originated on Twilio";
    case "twilio.calls.redirect.transfer":
      return "Redirected transfer on Twilio";
    case "twilio.calls.redirect.voicemail":
      return "Redirected to voicemail";
    case "twilio.calls.redirect.fallback":
      return "Failed over on Twilio";
    case "sip.invite.accept":
      return "Accepted on SIP trunk";
    case "sip.invite.create":
      return "Originated on SIP trunk";
    case "sip.refer":
      return "Transferred on SIP trunk";
    case "sip.reinvite.voicemail":
      return "Moved to SIP voicemail";
    case "sip.reinvite.failover":
      return "Failed over on SIP trunk";
    default:
      return value;
  }
}

function formatCallControlLabel(value: TelephonyCallControlEventType) {
  switch (value) {
    case "dtmf.received":
      return "DTMF";
    case "voicemail.detected":
      return "Voicemail";
    case "transfer.requested":
      return "Transfer";
    case "transfer.failed":
      return "Transfer failed";
    case "failover.triggered":
      return "Failover";
  }
}

function getLatestPublishedWorkflow(
  publishedWorkflows: ReturnType<typeof loadPublishedWorkflowVersionsForWorkspace>,
  workspaceId: string,
) {
  return publishedWorkflows
    .filter((workflow) => (workflow.workspaceId ?? workspaceId) === workspaceId)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
}
