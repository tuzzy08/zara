import { useEffect, useMemo, useReducer } from "react";
import { Link } from "react-router-dom";

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
  ImportedTelephonyPhoneNumber,
  TelephonyRecordingConsentMode,
  TelephonyRecordingPolicy,
  Workspace,
} from "@zara/core";

import {
  assignTelephonyRouteViaApi,
  activateTelephonyLiveRouteViaApi,
  createPlatformManagedConnectionViaApi,
  createSipConnectionViaApi,
  createTwilioConnectionViaApi,
  dispatchInboundTelephonyTestViaApi,
  dispatchOutboundTelephonyCallViaApi,
  fetchTelephonyState,
  importTwilioNumbersViaApi,
  pauseTelephonyLiveRouteViaApi,
  recordTelephonyCallControlEventViaApi,
  registerTelephonyNumberViaApi,
  resumeTelephonyLiveRouteViaApi,
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

function createEmptyTelephonyState(): TelephonyStateResponse {
  return {
    callControlEvents: [],
    connections: [],
    dispatches: [],
    executionCommands: [],
    executionSessions: [],
    healthChecks: [],
    organizationId: tenantId,
    phoneNumbers: [],
    providerHeartbeats: [],
    webhookEvents: [],
  };
}

interface TelephonyResourceState {
  key: string;
  loading: boolean;
  state: TelephonyStateResponse | null;
}

interface TelephonyScreenState {
  telephonyResource: TelephonyResourceState;
  platformDraft: PlatformConnectionDraft;
  twilioDraft: TwilioConnectionDraft;
  sipDraft: SipConnectionDraft;
  dispatchDraft: InboundDispatchDraft;
  outboundDraft: OutboundDispatchDraft;
  controlDraft: CallControlDraft;
  routeSelections: Record<string, string>;
  lastDispatch: TelephonyDispatchRecord | null;
  lastOutboundDispatch: TelephonyDispatchRecord | null;
  lastControlEvent: TelephonyCallControlEvent | null;
  workflowCatalogVersion: number;
}

type TelephonyStateSetter<T> = T | ((current: T) => T);

type TelephonyScreenAction =
  | { type: "set"; field: keyof TelephonyScreenState; value: unknown }
  | { type: "update"; field: keyof TelephonyScreenState; update: (current: unknown) => unknown };

function telephonyScreenReducer(state: TelephonyScreenState, action: TelephonyScreenAction): TelephonyScreenState {
  if (action.type === "update") {
    return {
      ...state,
      [action.field]: action.update(state[action.field]),
    } as TelephonyScreenState;
  }

  return {
    ...state,
    [action.field]: action.value,
  } as TelephonyScreenState;
}

function createInitialTelephonyScreenState(telephonyRequestKey: string): TelephonyScreenState {
  return {
    telephonyResource: {
      key: telephonyRequestKey,
      loading: true,
      state: null,
    },
    platformDraft: createInitialPlatformDraft(),
    twilioDraft: createInitialTwilioDraft(),
    sipDraft: createInitialSipDraft(),
    dispatchDraft: createInitialInboundDispatchDraft(),
    outboundDraft: createInitialOutboundDispatchDraft(),
    controlDraft: createInitialCallControlDraft(),
    routeSelections: {},
    lastDispatch: null,
    lastOutboundDispatch: null,
    lastControlEvent: null,
    workflowCatalogVersion: 0,
  };
}

export function TelephonyScreen(props: TelephonyScreenProps) {
  const model = useTelephonyScreenModel(props);

  return <TelephonyScreenView model={model} />;
}

function useTelephonyScreenModel({
  activeWorkspaceId,
  workspaces,
  showToast,
}: TelephonyScreenProps) {
  const telephonyRequestKey = `${tenantId}:${activeWorkspaceId}`;
  const [screenState, dispatch] = useReducer(
    telephonyScreenReducer,
    telephonyRequestKey,
    createInitialTelephonyScreenState,
  );
  const {
    telephonyResource,
    platformDraft,
    twilioDraft,
    sipDraft,
    dispatchDraft,
    outboundDraft,
    controlDraft,
    routeSelections,
    lastDispatch,
    lastOutboundDispatch,
    lastControlEvent,
    workflowCatalogVersion,
  } = screenState;
  const setTelephonyField = <Field extends keyof TelephonyScreenState>(
    field: Field,
    value: TelephonyStateSetter<TelephonyScreenState[Field]>,
  ) => {
    if (typeof value === "function") {
      dispatch({
        type: "update",
        field,
        update: (current) =>
          (value as (currentValue: TelephonyScreenState[Field]) => TelephonyScreenState[Field])(
            current as TelephonyScreenState[Field],
          ),
      });
      return;
    }

    dispatch({ type: "set", field, value });
  };
  const setTelephonyResource = (value: TelephonyStateSetter<TelephonyResourceState>) => setTelephonyField("telephonyResource", value);
  const setPlatformDraft = (value: TelephonyStateSetter<PlatformConnectionDraft>) => setTelephonyField("platformDraft", value);
  const setTwilioDraft = (value: TelephonyStateSetter<TwilioConnectionDraft>) => setTelephonyField("twilioDraft", value);
  const setSipDraft = (value: TelephonyStateSetter<SipConnectionDraft>) => setTelephonyField("sipDraft", value);
  const setDispatchDraft = (value: TelephonyStateSetter<InboundDispatchDraft>) => setTelephonyField("dispatchDraft", value);
  const setOutboundDraft = (value: TelephonyStateSetter<OutboundDispatchDraft>) => setTelephonyField("outboundDraft", value);
  const setControlDraft = (value: TelephonyStateSetter<CallControlDraft>) => setTelephonyField("controlDraft", value);
  const setRouteSelections = (value: TelephonyStateSetter<Record<string, string>>) => setTelephonyField("routeSelections", value);
  const setLastDispatch = (value: TelephonyDispatchRecord | null) => setTelephonyField("lastDispatch", value);
  const setLastOutboundDispatch = (value: TelephonyDispatchRecord | null) => setTelephonyField("lastOutboundDispatch", value);
  const setLastControlEvent = (value: TelephonyCallControlEvent | null) => setTelephonyField("lastControlEvent", value);
  const setWorkflowCatalogVersion = (value: TelephonyStateSetter<number>) => setTelephonyField("workflowCatalogVersion", value);

  if (telephonyResource.key !== telephonyRequestKey) {
    setTelephonyResource({
      key: telephonyRequestKey,
      loading: true,
      state: null,
    });
  }

  const state = telephonyResource.key === telephonyRequestKey ? telephonyResource.state : null;
  const loading = telephonyResource.key !== telephonyRequestKey || telephonyResource.loading;
  const commitTelephonyState = (nextState: TelephonyStateResponse) => {
    setTelephonyResource((current) => current.key === telephonyRequestKey
      ? {
          key: telephonyRequestKey,
          loading: false,
          state: nextState,
        }
      : current);
  };

  const publishedWorkflows = useMemo(
    () => {
      void workflowCatalogVersion;
      return (
      loadPublishedWorkflowVersionsForWorkspace({
        tenantId,
        workspaceId: activeWorkspaceId,
      })
      );
    },
    [activeWorkspaceId, workflowCatalogVersion],
  );

  const workspaceNameById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name] as const)),
    [workspaces],
  );

  useEffect(() => {
    let cancelled = false;

    void fetchTelephonyState(tenantId)
      .then((nextState) => {
        if (!cancelled) {
          setTelephonyResource((current) => current.key === telephonyRequestKey
            ? {
                key: telephonyRequestKey,
                loading: false,
                state: nextState,
              }
            : current);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setTelephonyResource((current) => current.key === telephonyRequestKey
            ? {
                key: telephonyRequestKey,
                loading: false,
                state: null,
              }
            : current);
          showToast(error instanceof Error ? error.message : "Telephony state could not be loaded.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [showToast, telephonyRequestKey]);

  const contentState = state ?? createEmptyTelephonyState();
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
  const latestRoutedNumber = contentState.phoneNumbers.find((phoneNumber) => phoneNumber.status === "routed");
  const latestWorkflow =
    getLatestPublishedWorkflow(publishedWorkflows, activeWorkspaceId) ?? publishedWorkflows[0];
  const latestCallSessionDispatch = callSessionOptions[0];
  const effectiveDispatchDraft = {
    ...dispatchDraft,
    toPhoneNumber: dispatchDraft.toPhoneNumber.length > 0
      ? dispatchDraft.toPhoneNumber
      : contentState.phoneNumbers[0]?.phoneNumber ?? "",
  };
  const effectiveOutboundDraft = {
    ...outboundDraft,
    fromPhoneNumber: outboundDraft.fromPhoneNumber.length > 0
      ? outboundDraft.fromPhoneNumber
      : latestRoutedNumber?.phoneNumber ?? "",
    selectedWorkflowId: outboundDraft.selectedWorkflowId.length > 0
      ? outboundDraft.selectedWorkflowId
      : latestWorkflow?.id ?? "",
  };
  const effectiveControlDraft = {
    ...controlDraft,
    callSessionId: controlDraft.callSessionId.length > 0
      ? controlDraft.callSessionId
      : latestCallSessionDispatch?.callSessionId ?? "",
    dispatchId: controlDraft.dispatchId.length > 0
      ? controlDraft.dispatchId
      : latestCallSessionDispatch?.id ?? "",
  };
  const resolveRouteSelection = (phoneNumber: ImportedTelephonyPhoneNumber) => {
    const explicitSelection = routeSelections[phoneNumber.id];

    if (explicitSelection !== undefined) {
      return explicitSelection;
    }

    const workspaceWorkflow =
      getLatestPublishedWorkflow(
        publishedWorkflows,
        phoneNumber.liveRoute?.workspaceId ?? activeWorkspaceId,
      ) ?? getLatestPublishedWorkflow(publishedWorkflows, activeWorkspaceId);

    return phoneNumber.liveRoute?.publishedVersionId ?? workspaceWorkflow?.id ?? "";
  };

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

      commitTelephonyState(response.state);
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

      commitTelephonyState(response.state);
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

      commitTelephonyState(response.state);
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

      commitTelephonyState(response.state);
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

      commitTelephonyState(response.state);
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

      commitTelephonyState(response.state);
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

      commitTelephonyState(response.state);
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

      commitTelephonyState(response.state);
      showToast("Voice-capable Twilio numbers imported.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Twilio numbers could not be imported.");
    }
  };

  const saveRoute = async (numberId: string) => {
    const selectedNumber = contentState.phoneNumbers.find((phoneNumber) => phoneNumber.id === numberId);
    const selectedWorkflowId = selectedNumber === undefined
      ? routeSelections[numberId]
      : resolveRouteSelection(selectedNumber);
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
        runtimeProfile: selectedWorkflow.manifestPreview.runtimeProfile,
        recordingPolicy:
          resolveSelectedNumberRecordingPolicy(contentState, numberId) ?? buildRecordingPolicy(platformDraft),
      });

      commitTelephonyState(response.state);
      showToast(`Saved route to ${selectedWorkflow.graph.name}.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Number routing could not be saved.");
    }
  };

  const activateLiveRoute = async (numberId: string) => {
    try {
      const response = await activateTelephonyLiveRouteViaApi({
        organizationId: tenantId,
        numberId,
        actorUserId,
      });

      commitTelephonyState(response.state);
      showToast("Live route activated.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Live route could not be activated.");
    }
  };

  const pauseLiveRoute = async (numberId: string) => {
    try {
      const response = await pauseTelephonyLiveRouteViaApi({
        organizationId: tenantId,
        numberId,
        actorUserId,
      });

      commitTelephonyState(response.state);
      showToast("Live route paused.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Live route could not be paused.");
    }
  };

  const resumeLiveRoute = async (numberId: string) => {
    try {
      const response = await resumeTelephonyLiveRouteViaApi({
        organizationId: tenantId,
        numberId,
        actorUserId,
      });

      commitTelephonyState(response.state);
      showToast("Live route resumed.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Live route could not be resumed.");
    }
  };

  const runInboundDispatch = async () => {
    if (effectiveDispatchDraft.toPhoneNumber.trim().length === 0) {
      showToast("Select a routed number before running an inbound dispatch.");
      return;
    }

    try {
      const response = await dispatchInboundTelephonyTestViaApi({
        organizationId: tenantId,
        toPhoneNumber: effectiveDispatchDraft.toPhoneNumber.trim(),
        fromPhoneNumber: effectiveDispatchDraft.fromPhoneNumber.trim(),
        callSid: effectiveDispatchDraft.callSid.trim(),
      });

      commitTelephonyState(response.state);
      setLastDispatch(response.dispatch);
      showToast("Inbound dispatch test completed.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Inbound dispatch test failed.");
    }
  };

  const runLoopbackTestCall = async () => {
    const selectedNumber = contentState.phoneNumbers.find(
      (phoneNumber) => phoneNumber.phoneNumber === effectiveDispatchDraft.toPhoneNumber,
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
        fromPhoneNumber: effectiveDispatchDraft.fromPhoneNumber.trim(),
        callSid: effectiveDispatchDraft.callSid.trim(),
      });

      commitTelephonyState(response.state);
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
      (workflow) => workflow.id === effectiveOutboundDraft.selectedWorkflowId,
    );

    if (selectedWorkflow === undefined) {
      showToast("Select a published workflow before running outbound dispatch.");
      return;
    }

    if (effectiveOutboundDraft.fromPhoneNumber.trim().length === 0) {
      showToast("Select a caller ID number before running outbound dispatch.");
      return;
    }

    try {
      const response = await dispatchOutboundTelephonyCallViaApi({
        organizationId: tenantId,
        toPhoneNumber: effectiveOutboundDraft.toPhoneNumber.trim(),
        fromPhoneNumber: effectiveOutboundDraft.fromPhoneNumber.trim(),
        callSid: effectiveOutboundDraft.callSid.trim(),
        publishedVersionId: selectedWorkflow.id,
        workflowLabel: selectedWorkflow.graph.name,
        workspaceId: selectedWorkflow.workspaceId ?? activeWorkspaceId,
        consentGranted: effectiveOutboundDraft.consentGranted,
        budgetRemainingUsd: Number(effectiveOutboundDraft.budgetRemainingUsd),
        estimatedCostUsd: Number(effectiveOutboundDraft.estimatedCostUsd),
        localHour: Number(effectiveOutboundDraft.localHour),
        callingWindow: {
          startHour: Number(effectiveOutboundDraft.startHour),
          endHour: Number(effectiveOutboundDraft.endHour),
        },
      });

      commitTelephonyState(response.state);
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
    if (effectiveControlDraft.callSessionId.trim().length === 0 || effectiveControlDraft.dispatchId.trim().length === 0) {
      showToast("Choose a live or recently queued call session before sending call controls.");
      return;
    }

    try {
      const response = await recordTelephonyCallControlEventViaApi({
        organizationId: tenantId,
        callSessionId: effectiveControlDraft.callSessionId.trim(),
        dispatchId: effectiveControlDraft.dispatchId.trim(),
        eventType: effectiveControlDraft.eventType,
        digit:
          effectiveControlDraft.eventType === "dtmf.received" ? effectiveControlDraft.digit.trim() : undefined,
        transferTarget:
          effectiveControlDraft.eventType === "transfer.requested" ||
          effectiveControlDraft.eventType === "transfer.failed"
            ? effectiveControlDraft.transferTarget.trim()
            : undefined,
        fallbackTarget:
          effectiveControlDraft.eventType === "voicemail.detected" ||
          effectiveControlDraft.eventType === "transfer.failed" ||
          effectiveControlDraft.eventType === "failover.triggered"
            ? effectiveControlDraft.fallbackTarget.trim()
            : undefined,
      });

      commitTelephonyState(response.state);
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

      commitTelephonyState(response.state);
      showToast(
        response.rotatedConnectionCount === 0
          ? "No provider credentials needed rotation."
          : `Rotated ${response.rotatedConnectionCount} provider credential ${response.rotatedConnectionCount === 1 ? "envelope" : "envelopes"}.`,
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Credential rotation could not be completed.");
    }
  };

  return {
    activeWorkspaceId,
    activateLiveRoute,
    callSessionOptions,
    contentState,
    createPlatformConnection,
    createSipConnection,
    createTwilioConnection,
    effectiveControlDraft,
    effectiveDispatchDraft,
    effectiveOutboundDraft,
    executionCommands,
    executionSessions,
    importNumbers,
    lastControlEvent,
    lastDispatch,
    lastOutboundDispatch,
    loading,
    metrics,
    pauseLiveRoute,
    platformDraft,
    primaryHealthCheck,
    primaryHealthConnection,
    primaryHeartbeat,
    publishedWorkflows,
    registerPlatformNumber,
    registerSipDid,
    resolveRouteSelection,
    resumeLiveRoute,
    rotateCredentials,
    runConnectionHeartbeat,
    runInboundDispatch,
    runLoopbackTestCall,
    runOutboundDispatch,
    saveRoute,
    setControlDraft,
    setDispatchDraft,
    setOutboundDraft,
    setPlatformDraft,
    setRouteSelections,
    setSipDraft,
    setTwilioDraft,
    setWorkflowCatalogVersion,
    sipDraft,
    submitCallControlEvent,
    twilioDraft,
    validateConnection,
    workspaceNameById,
  };
}

type TelephonyScreenModel = ReturnType<typeof useTelephonyScreenModel>;

function TelephonyScreenView({ model }: { model: TelephonyScreenModel }) {
  return (
    <div className="telephony-page">
      <TelephonyHero metrics={model.metrics} />
      <div className="telephony-grid">
        <TelephonyMainColumn model={model} />
        <TelephonySideColumn model={model} />
      </div>
    </div>
  );
}

function TelephonyHero({ metrics }: { metrics: TelephonyScreenModel["metrics"] }) {
  return (
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
  );
}

function TelephonyMainColumn({ model }: { model: TelephonyScreenModel }) {
  return (
    <div className="telephony-main">
      <TelephonySetupGrid model={model} />
      <TelephonyConnectionsPanel model={model} />
      <TelephonyRoutingPanel model={model} />
    </div>
  );
}

function TelephonySetupGrid({ model }: { model: TelephonyScreenModel }) {
  const {
    createPlatformConnection,
    createSipConnection,
    createTwilioConnection,
    platformDraft,
    registerPlatformNumber,
    registerSipDid,
    setPlatformDraft,
    setSipDraft,
    setTwilioDraft,
    sipDraft,
    twilioDraft,
  } = model;

  return (
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
            <input value={platformDraft.label} onChange={(event) => setPlatformDraft((current) => ({ ...current, label: event.target.value }))} />
          </label>
          <label className="workspace-settings-field">
            <span>Provider rail</span>
            <select
              value={platformDraft.provider}
              onChange={(event) => setPlatformDraft((current) => ({ ...current, provider: event.target.value as PlatformConnectionDraft["provider"] }))}
            >
              <option value="twilio">Twilio</option>
              <option value="signalwire">SignalWire</option>
              <option value="telnyx">Telnyx</option>
            </select>
          </label>
          <label className="workspace-settings-field">
            <span>Region</span>
            <select value={platformDraft.region} onChange={(event) => setPlatformDraft((current) => ({ ...current, region: event.target.value }))}>
              <option value="eu-west-1">EU West</option>
              <option value="us-east-1">US East</option>
            </select>
          </label>
          <label className="workspace-settings-field">
            <span>Provision number</span>
            <input value={platformDraft.phoneNumber} onChange={(event) => setPlatformDraft((current) => ({ ...current, phoneNumber: event.target.value }))} />
          </label>
          <label className="workspace-settings-field">
            <span>Friendly name</span>
            <input value={platformDraft.friendlyName} onChange={(event) => setPlatformDraft((current) => ({ ...current, friendlyName: event.target.value }))} />
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
            <input value={twilioDraft.label} onChange={(event) => setTwilioDraft((current) => ({ ...current, label: event.target.value }))} />
          </label>
          <label className="workspace-settings-field">
            <span>Region</span>
            <select value={twilioDraft.region} onChange={(event) => setTwilioDraft((current) => ({ ...current, region: event.target.value }))}>
              <option value="us-east-1">US East</option>
              <option value="eu-west-1">EU West</option>
            </select>
          </label>
          <label className="workspace-settings-field">
            <span>Twilio account SID</span>
            <input value={twilioDraft.accountSid} onChange={(event) => setTwilioDraft((current) => ({ ...current, accountSid: event.target.value }))} />
          </label>
          <label className="workspace-settings-field">
            <span>Twilio auth token</span>
            <input type="password" value={twilioDraft.authToken} onChange={(event) => setTwilioDraft((current) => ({ ...current, authToken: event.target.value }))} />
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
            <input value={sipDraft.sipDomain} onChange={(event) => setSipDraft((current) => ({ ...current, sipDomain: event.target.value }))} />
          </label>
          <label className="workspace-settings-field">
            <span>Username</span>
            <input value={sipDraft.username} onChange={(event) => setSipDraft((current) => ({ ...current, username: event.target.value }))} />
          </label>
          <label className="workspace-settings-field">
            <span>Secret</span>
            <input type="password" value={sipDraft.secret} onChange={(event) => setSipDraft((current) => ({ ...current, secret: event.target.value }))} />
          </label>
          <label className="workspace-settings-field">
            <span>Codecs</span>
            <input value={sipDraft.codecs} onChange={(event) => setSipDraft((current) => ({ ...current, codecs: event.target.value }))} />
          </label>
          <label className="workspace-settings-field">
            <span>DID number</span>
            <input value={sipDraft.phoneNumber} onChange={(event) => setSipDraft((current) => ({ ...current, phoneNumber: event.target.value }))} />
          </label>
          <label className="workspace-settings-field">
            <span>Friendly name</span>
            <input value={sipDraft.friendlyName} onChange={(event) => setSipDraft((current) => ({ ...current, friendlyName: event.target.value }))} />
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
  );
}

function TelephonyConnectionsPanel({ model }: { model: TelephonyScreenModel }) {
  const { contentState, importNumbers, loading, rotateCredentials, runConnectionHeartbeat, validateConnection } = model;

  return (
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
        <div className="telephony-empty-state">Connect platform, Twilio, or SIP telephony to begin routing live voice traffic.</div>
      ) : (
        <div className="telephony-connection-list">
          {contentState.connections.map((connection) => (
            <article key={connection.id} className="telephony-connection-card">
              <div className="telephony-connection-header">
                <div>
                  <div className="panel-title">{connection.label}</div>
                  <div className="panel-meta">{formatConnectionMode(connection.ownershipMode)} - {connection.region}</div>
                </div>
                <div className="telephony-connection-pills">
                  <span className={resolveHealthPillClassName(connection.healthStatus)}>{formatConnectionHealth(connection.healthStatus)}</span>
                  <span className="status-pill status-pill-neutral">{formatRecordingLabel(connection.recordingPolicy)}</span>
                </div>
              </div>

              <div className="telephony-connection-detail-grid">
                <ConnectionDetail label="Credential" value={connection.credentialReference?.preview ?? "Platform managed"} />
                <ConnectionDetail label="Webhook" value={connection.webhookStatus} />
                <ConnectionDetail label="Provider" value={connection.provider === "custom-sip" ? connection.sip?.domain ?? "custom-sip" : connection.provider} />
                <ConnectionDetail label="Routing guard" value={connection.blockRoutingOnHealthFailure ? "Block on failure" : "Warn only"} />
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
  );
}

function TelephonyRoutingPanel({ model }: { model: TelephonyScreenModel }) {
  const {
    activeWorkspaceId,
    activateLiveRoute,
    contentState,
    pauseLiveRoute,
    platformDraft,
    publishedWorkflows,
    resolveRouteSelection,
    resumeLiveRoute,
    saveRoute,
    setRouteSelections,
    setWorkflowCatalogVersion,
    workspaceNameById,
  } = model;

  return (
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
        <div className="telephony-empty-state">Provision a platform number, import Twilio inventory, or attach a SIP DID to start live routing.</div>
      ) : (
        <table className="telephony-number-table" aria-label="Telephony numbers">
          <thead>
            <tr className="telephony-number-table-head">
              <th scope="col">Number</th>
              <th scope="col">Workflow</th>
              <th scope="col">Workspace</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {contentState.phoneNumbers.map((phoneNumber) => {
              const numberState = resolvePhoneNumberOperatorState(phoneNumber);
              const liveRoute = phoneNumber.liveRoute;
              const activationStatus = liveRoute?.activationStatus;

              return (
                <tr key={phoneNumber.id} className="telephony-number-row">
                  <td>
                    <div className="panel-title">{phoneNumber.phoneNumber}</div>
                    <div className="panel-meta">{phoneNumber.friendlyName} - {formatProvisionSource(phoneNumber.provisionSource)}</div>
                  </td>
                  <td>
                    <label className="workspace-inline-field">
                      <span className="sr-only">{`Workflow route for ${phoneNumber.phoneNumber}`}</span>
                      <select
                        value={resolveRouteSelection(phoneNumber)}
                        onChange={(event) => setRouteSelections((current) => ({ ...current, [phoneNumber.id]: event.target.value }))}
                      >
                        <option value="">Select workflow</option>
                        {publishedWorkflows.map((workflow) => (
                          <option key={workflow.id} value={workflow.id}>{workflow.graph.name}</option>
                        ))}
                      </select>
                    </label>
                  </td>
                  <td className="panel-meta">{workspaceNameById.get(phoneNumber.liveRoute?.workspaceId ?? activeWorkspaceId) ?? "Unassigned"}</td>
                  <td className="telephony-number-status">
                    <span className={`status-pill status-pill-${numberState.tone}`}>{numberState.label}</span>
                    <button aria-label={`Save route for ${phoneNumber.phoneNumber}`} className="workflow-button" type="button" onClick={() => saveRoute(phoneNumber.id)}>
                      <Waves size={15} />
                      <span>Save route</span>
                    </button>
                    {liveRoute !== undefined ? (
                      <Link
                        aria-label={`Launch Phone test for ${phoneNumber.phoneNumber}`}
                        className="workflow-button"
                        to={`/sandbox?mode=phone-test&workflow=${encodeURIComponent(liveRoute.publishedVersionId)}&number=${encodeURIComponent(phoneNumber.id)}`}
                      >
                        <PhoneCall size={15} />
                        <span>Phone test</span>
                      </Link>
                    ) : null}
                    {liveRoute !== undefined && activationStatus !== "active" && activationStatus !== "paused" ? (
                      <button aria-label={`Activate live route for ${phoneNumber.phoneNumber}`} className="workflow-button workflow-button-primary" type="button" onClick={() => activateLiveRoute(phoneNumber.id)}>
                        <BadgeCheck size={15} />
                        <span>Activate live</span>
                      </button>
                    ) : null}
                    {activationStatus === "active" ? (
                      <button aria-label={`Pause live route for ${phoneNumber.phoneNumber}`} className="workflow-button" type="button" onClick={() => pauseLiveRoute(phoneNumber.id)}>
                        <CircleSlash2 size={15} />
                        <span>Pause</span>
                      </button>
                    ) : null}
                    {activationStatus === "paused" ? (
                      <button aria-label={`Resume live route for ${phoneNumber.phoneNumber}`} className="workflow-button workflow-button-primary" type="button" onClick={() => resumeLiveRoute(phoneNumber.id)}>
                        <BadgeCheck size={15} />
                        <span>Resume</span>
                      </button>
                    ) : null}
                    {liveRoute !== undefined && activationStatus !== "active" ? (
                      <div className="telephony-activation-summary" aria-label={`Activation summary for ${phoneNumber.phoneNumber}`}>
                        <span>{liveRoute.workflowLabel}</span>
                        <span>{liveRoute.publishedVersionId}</span>
                        <span>{formatRuntimeProfileLabel(liveRoute.runtimeProfile)}</span>
                        <span>{formatRecordingSummary(phoneNumber.recordingPolicy ?? resolveSelectedNumberRecordingPolicy(contentState, phoneNumber.id) ?? buildRecordingPolicy(platformDraft))}</span>
                        <span>Subscription and budget checked on activation</span>
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function TelephonySideColumn({ model }: { model: TelephonyScreenModel }) {
  return (
    <div className="telephony-side">
      <TelephonyHealthPanel model={model} />
      <TelephonyInboundTestPanel model={model} />
      <TelephonyOutboundPanel model={model} />
      <TelephonyExecutionPanel model={model} />
      <TelephonyLiveControlsPanel model={model} />
      <TelephonyProviderEventsPanel contentState={model.contentState} />
    </div>
  );
}

function TelephonyHealthPanel({ model }: { model: TelephonyScreenModel }) {
  const { primaryHealthCheck, primaryHealthConnection, primaryHeartbeat } = model;

  return (
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
            <p className="panel-meta">{primaryHeartbeat?.message ?? primaryHealthCheck?.message ?? "Run a validation pass to confirm readiness before routing traffic."}</p>
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
            <p className="panel-meta">{formatRecordingSummary(primaryHealthConnection.recordingPolicy)}</p>
          </div>
        </div>
      )}
    </section>
  );
}

function TelephonyInboundTestPanel({ model }: { model: TelephonyScreenModel }) {
  const { contentState, effectiveDispatchDraft, lastDispatch, runInboundDispatch, runLoopbackTestCall, setDispatchDraft } = model;

  return (
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
          <select value={effectiveDispatchDraft.toPhoneNumber} onChange={(event) => setDispatchDraft((current) => ({ ...current, toPhoneNumber: event.target.value }))}>
            <option value="">Select imported number</option>
            {contentState.phoneNumbers.map((phoneNumber) => (
              <option key={phoneNumber.id} value={phoneNumber.phoneNumber}>{phoneNumber.phoneNumber}</option>
            ))}
          </select>
        </label>
        <label className="workspace-settings-field">
          <span>Caller</span>
          <input value={effectiveDispatchDraft.fromPhoneNumber} onChange={(event) => setDispatchDraft((current) => ({ ...current, fromPhoneNumber: event.target.value }))} />
        </label>
        <label className="workspace-settings-field">
          <span>Call SID</span>
          <input value={effectiveDispatchDraft.callSid} onChange={(event) => setDispatchDraft((current) => ({ ...current, callSid: event.target.value }))} />
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
          <span>{lastDispatch === null ? "Awaiting test" : lastDispatch.disposition === "fallback" ? "Provider fallback" : lastDispatch.disposition === "routed" ? "Routed" : "Awaiting test"}</span>
        </div>
        <p className="panel-meta">{lastDispatch?.reason ?? "Pick a live number to confirm the route before voice traffic reaches production."}</p>
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
  );
}

function TelephonyOutboundPanel({ model }: { model: TelephonyScreenModel }) {
  const { contentState, effectiveOutboundDraft, lastOutboundDispatch, publishedWorkflows, runOutboundDispatch, setOutboundDraft } = model;

  return (
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
          <select value={effectiveOutboundDraft.fromPhoneNumber} onChange={(event) => setOutboundDraft((current) => ({ ...current, fromPhoneNumber: event.target.value }))}>
            <option value="">Select routed number</option>
            {contentState.phoneNumbers.flatMap((phoneNumber) =>
              phoneNumber.status === "routed"
                ? [<option key={phoneNumber.id} value={phoneNumber.phoneNumber}>{phoneNumber.phoneNumber}</option>]
                : [],
            )}
          </select>
        </label>
        <label className="workspace-settings-field">
          <span>Destination</span>
          <input value={effectiveOutboundDraft.toPhoneNumber} onChange={(event) => setOutboundDraft((current) => ({ ...current, toPhoneNumber: event.target.value }))} />
        </label>
        <label className="workspace-settings-field">
          <span>Workflow</span>
          <select value={effectiveOutboundDraft.selectedWorkflowId} onChange={(event) => setOutboundDraft((current) => ({ ...current, selectedWorkflowId: event.target.value }))}>
            <option value="">Select workflow</option>
            {publishedWorkflows.map((workflow) => (
              <option key={workflow.id} value={workflow.id}>{workflow.graph.name}</option>
            ))}
          </select>
        </label>
        <label className="workspace-settings-field">
          <span>Budget remaining (USD)</span>
          <input value={effectiveOutboundDraft.budgetRemainingUsd} onChange={(event) => setOutboundDraft((current) => ({ ...current, budgetRemainingUsd: event.target.value }))} />
        </label>
        <label className="workspace-settings-field">
          <span>Estimated cost (USD)</span>
          <input value={effectiveOutboundDraft.estimatedCostUsd} onChange={(event) => setOutboundDraft((current) => ({ ...current, estimatedCostUsd: event.target.value }))} />
        </label>
        <div className="telephony-inline-grid">
          <label className="workspace-settings-field">
            <span>Local hour</span>
            <input value={effectiveOutboundDraft.localHour} onChange={(event) => setOutboundDraft((current) => ({ ...current, localHour: event.target.value }))} />
          </label>
          <label className="workspace-settings-field">
            <span>Start</span>
            <input value={effectiveOutboundDraft.startHour} onChange={(event) => setOutboundDraft((current) => ({ ...current, startHour: event.target.value }))} />
          </label>
          <label className="workspace-settings-field">
            <span>End</span>
            <input value={effectiveOutboundDraft.endHour} onChange={(event) => setOutboundDraft((current) => ({ ...current, endHour: event.target.value }))} />
          </label>
        </div>
        <label className="telephony-checkbox">
          <input checked={effectiveOutboundDraft.consentGranted} type="checkbox" onChange={(event) => setOutboundDraft((current) => ({ ...current, consentGranted: event.target.checked }))} />
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
        <p className="panel-meta">{lastOutboundDispatch?.reason ?? "Run a dry dispatch to verify caller ID, consent, budget, and calling window."}</p>
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
  );
}

function TelephonyExecutionPanel({ model }: { model: TelephonyScreenModel }) {
  const { executionCommands, executionSessions } = model;

  return (
    <section className="surface-card telephony-panel">
      <div className="telephony-section-head">
        <div>
          <div className="eyebrow-copy">Execution</div>
          <div className="subhead-copy telephony-section-title">Provider bridge</div>
        </div>
      </div>

      {executionSessions.length === 0 ? (
        <div className="telephony-empty-state">Provider execution sessions appear here after loopback tests, inbound dispatch, or outbound queueing.</div>
      ) : (
        <div className="telephony-event-list">
          {executionSessions.slice(0, 4).map((session) => (
            <TelephonyExecutionSessionCard key={session.id} executionCommands={executionCommands} session={session} />
          ))}
        </div>
      )}
    </section>
  );
}

function TelephonyExecutionSessionCard({
  executionCommands,
  session,
}: {
  executionCommands: TelephonyScreenModel["executionCommands"];
  session: TelephonyScreenModel["executionSessions"][number];
}) {
  const latestCommand = executionCommands.find((command) => command.sessionId === session.id);

  return (
    <div className="subtle-panel telephony-event-card">
      <div className="telephony-health-title">
        <PhoneCall size={15} />
        <span>{formatExecutionStatus(session.status)}</span>
      </div>
      <div className="panel-title">{session.workflowLabel ?? session.callSessionId}</div>
      <div className="panel-meta">{session.testCall ? "Loopback test" : session.direction} - {formatConnectionMode(session.ownershipMode)}</div>
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
      {latestCommand !== undefined ? <div className="panel-meta">{formatBridgeAction(latestCommand.action)} to {latestCommand.target}</div> : null}
    </div>
  );
}

function TelephonyLiveControlsPanel({ model }: { model: TelephonyScreenModel }) {
  const { callSessionOptions, contentState, effectiveControlDraft, executionSessions, lastControlEvent, setControlDraft, submitCallControlEvent } = model;

  return (
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
            value={effectiveControlDraft.callSessionId}
            onChange={(event) => {
              const selectedDispatch = callSessionOptions.find((dispatch) => dispatch.callSessionId === event.target.value);
              setControlDraft((current) => ({ ...current, callSessionId: event.target.value, dispatchId: selectedDispatch?.id ?? "" }));
            }}
          >
            <option value="">Select call session</option>
            {callSessionOptions.map((dispatch) => (
              <option key={dispatch.id} value={dispatch.callSessionId}>{dispatch.direction} - {dispatch.callSessionId}</option>
            ))}
          </select>
        </label>
        <div className="telephony-control-switcher">
          {callControlModes.map((mode) => (
            <button
              key={mode.value}
              className={effectiveControlDraft.eventType === mode.value ? "telephony-control-tab telephony-control-tab-active" : "telephony-control-tab"}
              type="button"
              onClick={() => setControlDraft((current) => ({ ...current, eventType: mode.value }))}
            >
              <mode.icon size={14} />
              <span>{mode.label}</span>
            </button>
          ))}
        </div>

        {effectiveControlDraft.eventType === "dtmf.received" ? (
          <label className="workspace-settings-field">
            <span>Digit</span>
            <input value={effectiveControlDraft.digit} onChange={(event) => setControlDraft((current) => ({ ...current, digit: event.target.value }))} />
          </label>
        ) : null}

        {effectiveControlDraft.eventType === "transfer.requested" || effectiveControlDraft.eventType === "transfer.failed" ? (
          <label className="workspace-settings-field">
            <span>Transfer target</span>
            <input value={effectiveControlDraft.transferTarget} onChange={(event) => setControlDraft((current) => ({ ...current, transferTarget: event.target.value }))} />
          </label>
        ) : null}

        {effectiveControlDraft.eventType === "voicemail.detected" || effectiveControlDraft.eventType === "transfer.failed" || effectiveControlDraft.eventType === "failover.triggered" ? (
          <label className="workspace-settings-field">
            <span>Fallback path</span>
            <input value={effectiveControlDraft.fallbackTarget} onChange={(event) => setControlDraft((current) => ({ ...current, fallbackTarget: event.target.value }))} />
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
  );
}

function TelephonyProviderEventsPanel({ contentState }: { contentState: TelephonyStateResponse }) {
  return (
    <section className="surface-card telephony-panel">
      <div className="telephony-section-head">
        <div>
          <div className="eyebrow-copy">Provider events</div>
          <div className="subhead-copy telephony-section-title">Webhooks</div>
        </div>
      </div>

      {contentState.webhookEvents.length === 0 ? (
        <div className="telephony-empty-state">Incoming provider callbacks appear here once live voice events start landing.</div>
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

function resolvePhoneNumberOperatorState(phoneNumber: ImportedTelephonyPhoneNumber): {
  label: "Unassigned" | "Test route" | "Ready to activate" | "Live" | "Paused";
  tone: "neutral" | "blue" | "pink" | "red" | "amber";
} {
  if (phoneNumber.status === "disabled") {
    return { label: "Paused", tone: "amber" };
  }

  const waitingStatus = phoneNumber.testRoute?.waitingSession.status;
  if (waitingStatus === "waiting" || waitingStatus === "active") {
    return { label: "Test route", tone: "pink" };
  }

  if (phoneNumber.liveRoute?.activationStatus === "active") {
    return { label: "Live", tone: "blue" };
  }

  const latestPassedTest = phoneNumber.phoneTestResults?.some((result) => result.status === "passed") ?? false;
  if (latestPassedTest && phoneNumber.liveRoute !== undefined) {
    return { label: "Ready to activate", tone: "blue" };
  }

  if (phoneNumber.liveRoute !== undefined) {
    return { label: "Paused", tone: "amber" };
  }

  return { label: "Unassigned", tone: "neutral" };
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

function formatRuntimeProfileLabel(profile: string) {
  switch (profile) {
    case "premium-realtime":
      return "Premium realtime";
    case "balanced":
      return "Balanced";
    default:
      return "Cost optimized";
  }
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
  let latestWorkflow: ReturnType<typeof loadPublishedWorkflowVersionsForWorkspace>[number] | undefined;

  for (const workflow of publishedWorkflows) {
    if ((workflow.workspaceId ?? workspaceId) !== workspaceId) {
      continue;
    }

    if (latestWorkflow === undefined || Date.parse(workflow.createdAt) > Date.parse(latestWorkflow.createdAt)) {
      latestWorkflow = workflow;
    }
  }

  return latestWorkflow;
}
