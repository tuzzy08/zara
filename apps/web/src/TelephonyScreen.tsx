import { useEffect, useMemo, useReducer } from "react";
import { Link } from "react-router-dom";
import { useState } from "react";
import type { ReactNode } from "react";
import {
  Button,
  Card,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@zara/ui";

import {
  Activity,
  ArrowRightLeft,
  BadgeCheck,
  Bot,
  CircleSlash2,
  Clock3,
  Eye,
  EyeOff,
  Hash,
  KeyRound,
  Phone,
  PhoneCall,
  PhoneForwarded,
  PhoneIncoming,
  PhoneOff,
  Plug,
  Repeat2,
  Settings,
  ShieldCheck,
  TestTube2,
  Trash2,
  Voicemail,
  Waves,
  X,
} from "lucide-react";
import type {
  TelephonyCallControlEventType,
  ImportedTelephonyPhoneNumber,
  PublishedWorkflowVersion,
  TelephonyRecordingConsentMode,
  TelephonyRecordingPolicy,
  Workspace,
} from "@zara/core";

import {
  assignTelephonyRouteViaApi,
  activateTelephonyLiveRouteViaApi,
  createSipConnectionViaApi,
  createTwilioConnectionViaApi,
  deleteTelephonyConnectionViaApi,
  deleteTelephonyPhoneNumberViaApi,
  dispatchInboundTelephonyTestViaApi,
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
  validateTwilioCredentialsViaApi,
  type TelephonyCallControlEvent,
  type TelephonyDispatchRecord,
  type TelephonyStateResponse,
} from "./telephonyApi";
import {
  getCallablePhoneNumberOptions,
  getCallSessionControlOptions,
  getTenantPublishedWorkflowOptions,
} from "./telephonyCallsPageModel";
import { ApiError } from "./apiClient";
import { loadPublishedWorkflowVersions } from "./workflowSandboxRegistry";

interface TelephonyScreenProps {
  activeActorUserId: string;
  activeWorkspaceId: string;
  organizationId: string;
  workspaces: Workspace[];
  showToast: (message: string) => void;
}

interface ConnectionDraftBase {
  label: string;
  region: string;
  consentMode: TelephonyRecordingConsentMode;
  consentMessage: string;
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

interface CallControlDraft {
  callSessionId: string;
  dispatchId: string;
  eventType: TelephonyCallControlEventType;
  digit: string;
  transferTarget: string;
  fallbackTarget: string;
}

interface LiveRouteActivationGuidance {
  title: string;
  message: string;
  action: string;
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

function createEmptyTelephonyState(organizationId: string): TelephonyStateResponse {
  return {
    callControlEvents: [],
    connections: [],
    dispatches: [],
    executionCommands: [],
    executionSessions: [],
    healthChecks: [],
    organizationId,
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
  twilioDraft: TwilioConnectionDraft;
  sipDraft: SipConnectionDraft;
  dispatchDraft: InboundDispatchDraft;
  controlDraft: CallControlDraft;
  routeSelections: Record<string, string>;
  pendingOperationIds: Record<string, boolean>;
  lastDispatch: TelephonyDispatchRecord | null;
  lastControlEvent: TelephonyCallControlEvent | null;
  workflowCatalogVersion: number;
  activationGuidanceByNumberId: Record<string, LiveRouteActivationGuidance | undefined>;
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
    twilioDraft: createInitialTwilioDraft(),
    sipDraft: createInitialSipDraft(),
    dispatchDraft: createInitialInboundDispatchDraft(),
    controlDraft: createInitialCallControlDraft(),
    routeSelections: {},
    pendingOperationIds: {},
    lastDispatch: null,
    lastControlEvent: null,
    workflowCatalogVersion: 0,
    activationGuidanceByNumberId: {},
  };
}

export function TelephonyScreen(props: TelephonyScreenProps) {
  const model = useTelephonyScreenModel(props);

  return <TelephonyScreenView model={model} />;
}

function useTelephonyScreenModel({
  activeActorUserId,
  activeWorkspaceId,
  organizationId,
  workspaces,
  showToast,
}: TelephonyScreenProps) {
  const telephonyRequestKey = `${organizationId}:${activeWorkspaceId}`;
  const [screenState, dispatch] = useReducer(
    telephonyScreenReducer,
    telephonyRequestKey,
    createInitialTelephonyScreenState,
  );
  const {
    telephonyResource,
    twilioDraft,
    sipDraft,
    dispatchDraft,
    controlDraft,
    routeSelections,
    pendingOperationIds,
    lastDispatch,
    lastControlEvent,
    workflowCatalogVersion,
    activationGuidanceByNumberId,
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
  const setTwilioDraft = (value: TelephonyStateSetter<TwilioConnectionDraft>) => setTelephonyField("twilioDraft", value);
  const setSipDraft = (value: TelephonyStateSetter<SipConnectionDraft>) => setTelephonyField("sipDraft", value);
  const setDispatchDraft = (value: TelephonyStateSetter<InboundDispatchDraft>) => setTelephonyField("dispatchDraft", value);
  const setControlDraft = (value: TelephonyStateSetter<CallControlDraft>) => setTelephonyField("controlDraft", value);
  const setRouteSelections = (value: TelephonyStateSetter<Record<string, string>>) => setTelephonyField("routeSelections", value);
  const setPendingOperationIds = (value: TelephonyStateSetter<Record<string, boolean>>) => setTelephonyField("pendingOperationIds", value);
  const setLastDispatch = (value: TelephonyDispatchRecord | null) => setTelephonyField("lastDispatch", value);
  const setLastControlEvent = (value: TelephonyCallControlEvent | null) => setTelephonyField("lastControlEvent", value);
  const setWorkflowCatalogVersion = (value: TelephonyStateSetter<number>) => setTelephonyField("workflowCatalogVersion", value);
  const setActivationGuidanceByNumberId = (value: TelephonyStateSetter<Record<string, LiveRouteActivationGuidance | undefined>>) =>
    setTelephonyField("activationGuidanceByNumberId", value);

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
  const setOperationPending = (operationId: string, pending: boolean) => {
    setPendingOperationIds((current) => {
      if (pending) {
        return {
          ...current,
          [operationId]: true,
        };
      }

      const next = { ...current };
      delete next[operationId];
      return next;
    });
  };
  const runOperation = async <Response,>(
    operationId: string,
    operation: () => Promise<Response>,
  ): Promise<Response | null> => {
    if (pendingOperationIds[operationId] === true) {
      return null;
    }

    setOperationPending(operationId, true);
    try {
      return await operation();
    } finally {
      setOperationPending(operationId, false);
    }
  };
  const isOperationPending = (operationId: string) => pendingOperationIds[operationId] === true;

  const publishedWorkflows = useMemo(
    () => {
      void workflowCatalogVersion;
      return getTenantPublishedWorkflowOptions({
        tenantId: organizationId,
        versions: loadPublishedWorkflowVersions(),
      });
    },
    [organizationId, workflowCatalogVersion],
  );

  const workspaceNameById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name] as const)),
    [workspaces],
  );

  useEffect(() => {
    let cancelled = false;

    void fetchTelephonyState(organizationId)
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
  }, [organizationId, showToast, telephonyRequestKey]);

  const contentState = state ?? createEmptyTelephonyState(organizationId);
  const executionSessions = contentState.executionSessions ?? [];
  const executionCommands = contentState.executionCommands ?? [];

  const metrics = useMemo(() => {
    const routedNumbers = contentState.phoneNumbers.filter((phoneNumber) => phoneNumber.status === "routed");

    return {
      activeConnections: contentState.connections.filter((connection) => connection.status === "active").length,
      routedNumbers: routedNumbers.length,
      liveRoutes: contentState.phoneNumbers.filter((phoneNumber) => phoneNumber.liveRoute?.activationStatus === "active").length,
      recentCalls: contentState.dispatches.length,
    };
  }, [contentState]);

  const sipConnections = contentState.connections.filter(
    (connection) => connection.ownershipMode === "byo_sip_trunk",
  );

  const callablePhoneNumberOptions = getCallablePhoneNumberOptions(contentState.phoneNumbers);
  const callControlSessionOptions = getCallSessionControlOptions(contentState);
  const latestCallSessionOption = callControlSessionOptions[0];
  const effectiveDispatchDraft = {
    ...dispatchDraft,
    toPhoneNumber: dispatchDraft.toPhoneNumber.length > 0
      ? dispatchDraft.toPhoneNumber
      : callablePhoneNumberOptions[0]?.value ?? "",
  };
  const effectiveControlDraft = {
    ...controlDraft,
    callSessionId: controlDraft.callSessionId.length > 0
      ? controlDraft.callSessionId
      : latestCallSessionOption?.callSessionId ?? "",
    dispatchId: controlDraft.dispatchId.length > 0
      ? controlDraft.dispatchId
      : latestCallSessionOption?.dispatchId ?? "",
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

  const createTwilioConnection = async () => {
    if (twilioDraft.accountSid.trim().length === 0 || twilioDraft.authToken.trim().length === 0) {
      showToast("Twilio account SID and auth token are required.");
      return;
    }

    try {
      const response = await runOperation("twilio:create", async () => {
        await validateTwilioCredentialsViaApi({
          organizationId,
          accountSid: twilioDraft.accountSid.trim(),
          authToken: twilioDraft.authToken.trim(),
        });
        return createTwilioConnectionViaApi({
          organizationId,
          actorUserId: activeActorUserId,
          label: twilioDraft.label,
          region: twilioDraft.region,
          accountSid: twilioDraft.accountSid.trim(),
          authToken: twilioDraft.authToken.trim(),
          blockRoutingOnHealthFailure: twilioDraft.blockRoutingOnHealthFailure,
          recordingPolicy: buildRecordingPolicy(twilioDraft),
        });
      });
      if (response === null) {
        return false;
      }

      commitTelephonyState(response.state);
      setTwilioDraft((current) => ({ ...current, authToken: "" }));
      showToast("Twilio provider account connected.");
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Twilio connection could not be created.");
      return false;
    }
  };

  const createSipConnection = async () => {
    if (sipDraft.secret.trim().length === 0) {
      showToast("SIP secret is required before the trunk can be connected.");
      return;
    }

    try {
      const response = await runOperation("sip:create", () => createSipConnectionViaApi({
        organizationId,
        actorUserId: activeActorUserId,
        label: sipDraft.label,
        region: sipDraft.region,
        username: sipDraft.username.trim(),
        secret: sipDraft.secret.trim(),
        sipDomain: sipDraft.sipDomain.trim(),
        codecs: parseCodecList(sipDraft.codecs),
        blockRoutingOnHealthFailure: sipDraft.blockRoutingOnHealthFailure,
        recordingPolicy: buildRecordingPolicy(sipDraft),
      }));
      if (response === null) {
        return false;
      }

      commitTelephonyState(response.state);
      setSipDraft((current) => ({ ...current, secret: "" }));
      showToast("SIP trunk connected.");
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "SIP trunk could not be created.");
      return false;
    }
  };

  const registerSipDid = async () => {
    const connection = sipConnections[0];
    if (connection === undefined) {
      showToast("Connect a SIP trunk before adding a DID.");
      return;
    }

    try {
      const response = await runOperation("sip:register-number", () => registerTelephonyNumberViaApi({
        organizationId,
        connectionId: connection.id,
        phoneNumber: sipDraft.phoneNumber.trim(),
        friendlyName: sipDraft.friendlyName.trim(),
      }));
      if (response === null) {
        return;
      }

      commitTelephonyState(response.state);
      showToast("SIP DID added.");
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "SIP DID could not be added.");
      return false;
    }
  };

  const validateConnection = async (connectionId: string) => {
    try {
      const response = await runOperation(`connection:${connectionId}:validate`, () => validateTelephonyConnectionViaApi({
        organizationId,
        connectionId,
        actorUserId: activeActorUserId,
      }));
      if (response === null) {
        return;
      }

      commitTelephonyState(response.state);
      showToast(response.healthCheck.message);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Provider validation failed.");
    }
  };

  const runConnectionHeartbeat = async (connectionId: string) => {
    try {
      const response = await runOperation(`connection:${connectionId}:heartbeat`, () => runTelephonyHeartbeatViaApi({
        organizationId,
        connectionId,
      }));
      if (response === null) {
        return;
      }

      commitTelephonyState(response.state);
      showToast(response.heartbeat.message);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Provider heartbeat could not be completed.");
    }
  };

  const importNumbers = async (connectionId: string) => {
    try {
      const response = await runOperation(`connection:${connectionId}:import`, () => importTwilioNumbersViaApi({
        organizationId,
        connectionId,
        actorUserId: activeActorUserId,
      }));
      if (response === null) {
        return;
      }

      commitTelephonyState(response.state);
      showToast("Voice-capable Twilio numbers imported.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Twilio numbers could not be imported.");
    }
  };

  const deleteConnection = async (connectionId: string) => {
    try {
      const response = await runOperation(`connection:${connectionId}:delete`, () => deleteTelephonyConnectionViaApi({
        organizationId,
        connectionId,
        actorUserId: activeActorUserId,
      }));
      if (response === null) {
        return;
      }

      commitTelephonyState(response.state);
      showToast("Telephony connection deleted.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Telephony connection could not be deleted.");
    }
  };

  const deletePhoneNumber = async (numberId: string) => {
    try {
      const response = await runOperation(`number:${numberId}:delete`, () => deleteTelephonyPhoneNumberViaApi({
        organizationId,
        numberId,
        actorUserId: activeActorUserId,
      }));
      if (response === null) {
        return;
      }

      commitTelephonyState(response.state);
      showToast("Imported number removed.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Imported number could not be removed.");
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
      const response = await runOperation(`number:${numberId}:route`, () => assignTelephonyRouteViaApi({
        organizationId,
        numberId,
        actorUserId: activeActorUserId,
        publishedVersionId: selectedWorkflow.id,
        workflowLabel: selectedWorkflow.graph.name,
        workspaceId: selectedWorkflow.workspaceId ?? activeWorkspaceId,
        runtimeProfile: selectedWorkflow.manifestPreview.runtimeProfile,
        recordingPolicy:
          resolveSelectedNumberRecordingPolicy(contentState, numberId) ?? buildRecordingPolicy(twilioDraft),
      }));
      if (response === null) {
        return;
      }

      commitTelephonyState(response.state);
      setActivationGuidanceByNumberId((current) => clearNumberGuidance(current, numberId));
      showToast(`Saved route to ${selectedWorkflow.graph.name}.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Number routing could not be saved.");
    }
  };

  const activateLiveRoute = async (numberId: string) => {
    const selectedNumber = contentState.phoneNumbers.find((phoneNumber) => phoneNumber.id === numberId);

    try {
      const response = await runOperation(`number:${numberId}:activate`, () => activateTelephonyLiveRouteViaApi({
        organizationId,
        numberId,
        actorUserId: activeActorUserId,
      }));
      if (response === null) {
        return;
      }

      commitTelephonyState(response.state);
      setActivationGuidanceByNumberId((current) => clearNumberGuidance(current, numberId));
      showToast("Live route activated.");
    } catch (error) {
      const guidance = resolveLiveRouteActivationGuidance(error, selectedNumber);
      setActivationGuidanceByNumberId((current) => ({
        ...current,
        [numberId]: guidance,
      }));
      showToast(guidance.title);
    }
  };

  const pauseLiveRoute = async (numberId: string) => {
    try {
      const response = await runOperation(`number:${numberId}:pause`, () => pauseTelephonyLiveRouteViaApi({
        organizationId,
        numberId,
        actorUserId: activeActorUserId,
      }));
      if (response === null) {
        return;
      }

      commitTelephonyState(response.state);
      showToast("Live route paused.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Live route could not be paused.");
    }
  };

  const resumeLiveRoute = async (numberId: string) => {
    try {
      const response = await runOperation(`number:${numberId}:resume`, () => resumeTelephonyLiveRouteViaApi({
        organizationId,
        numberId,
        actorUserId: activeActorUserId,
      }));
      if (response === null) {
        return;
      }

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
      const response = await runOperation("dispatch:inbound", () => dispatchInboundTelephonyTestViaApi({
        organizationId,
        toPhoneNumber: effectiveDispatchDraft.toPhoneNumber.trim(),
        fromPhoneNumber: effectiveDispatchDraft.fromPhoneNumber.trim(),
        callSid: effectiveDispatchDraft.callSid.trim(),
      }));
      if (response === null) {
        return;
      }

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
      const response = await runOperation("dispatch:loopback", () => runTelephonyLoopbackTestViaApi({
        organizationId,
        connectionId: selectedNumber.connectionId,
        phoneNumberId: selectedNumber.id,
        fromPhoneNumber: effectiveDispatchDraft.fromPhoneNumber.trim(),
        callSid: effectiveDispatchDraft.callSid.trim(),
      }));
      if (response === null) {
        return;
      }

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

  const submitCallControlEvent = async () => {
    if (effectiveControlDraft.callSessionId.trim().length === 0 || effectiveControlDraft.dispatchId.trim().length === 0) {
      showToast("Choose a live or recently queued call session before sending call controls.");
      return;
    }

    try {
      const response = await runOperation("call-control:record", () => recordTelephonyCallControlEventViaApi({
        organizationId,
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
      }));
      if (response === null) {
        return;
      }

      commitTelephonyState(response.state);
      setLastControlEvent(response.event);
      showToast(response.event.summary);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Call control event could not be recorded.");
    }
  };

  const rotateCredentials = async () => {
    try {
      const response = await runOperation("credentials:rotate", () => rotateTelephonyCredentialsViaApi({
        organizationId,
      }));
      if (response === null) {
        return;
      }

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
    activationGuidanceByNumberId,
    callControlSessionOptions,
    callablePhoneNumberOptions,
    contentState,
    createSipConnection,
    createTwilioConnection,
    deleteConnection,
    deletePhoneNumber,
    effectiveControlDraft,
    effectiveDispatchDraft,
    executionCommands,
    executionSessions,
    importNumbers,
    isOperationPending,
    lastControlEvent,
    lastDispatch,
    loading,
    metrics,
    pauseLiveRoute,
    publishedWorkflows,
    registerSipDid,
    resolveRouteSelection,
    resumeLiveRoute,
    rotateCredentials,
    runConnectionHeartbeat,
    runInboundDispatch,
    runLoopbackTestCall,
    saveRoute,
    setControlDraft,
    setDispatchDraft,
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
      <h1 className="sr-only">Telephony operations</h1>
      <TelephonyHero metrics={model.metrics} />
      <TelephonyMainColumn model={model} />
      <div className="telephony-operations-grid">
        <TelephonyInboundTestPanel model={model} />
        <TelephonyExecutionPanel model={model} />
        <TelephonyLiveControlsPanel model={model} />
        <TelephonyProviderEventsPanel contentState={model.contentState} />
      </div>
    </div>
  );
}

function TelephonyHero({ metrics }: { metrics: TelephonyScreenModel["metrics"] }) {
  return (
    <section className="telephony-overview-strip telephony-motion-overview" aria-label="Telephony overview">
      <MetricTile icon={Phone} label="Active connections" value={String(metrics.activeConnections)} />
      <MetricTile icon={Hash} label="Routed numbers" value={String(metrics.routedNumbers)} />
      <MetricTile icon={Repeat2} label="Live routes" value={String(metrics.liveRoutes)} />
      <MetricTile icon={Clock3} label="Recent calls" value={String(metrics.recentCalls)} />
    </section>
  );
}

function TelephonyMainColumn({ model }: { model: TelephonyScreenModel }) {
  return (
    <div className="telephony-main">
      <TelephonyProviderSetup model={model} />
      <TelephonyConnectionTable model={model} />
      <TelephonyRoutingPanel model={model} />
    </div>
  );
}

function TelephonyProviderSetup({ model }: { model: TelephonyScreenModel }) {
  const [dialog, setDialog] = useState<"twilio" | "sip" | "sip-did" | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const twilioConfigured = model.contentState.connections.some(
    (connection) => connection.ownershipMode === "byo_provider_account" && connection.provider === "twilio",
  );
  const sipConfigured = model.contentState.connections.some(
    (connection) => connection.ownershipMode === "byo_sip_trunk",
  );

  const manageConnections = () => {
    document.getElementById("telephony-connections")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section className="telephony-providers" aria-labelledby="telephony-providers-title">
      <div className="telephony-section-heading">
        <div>
          <div className="eyebrow-copy">Voice infrastructure</div>
          <h2 id="telephony-providers-title">Providers</h2>
        </div>
        <p>Connect and manage your telephony providers.</p>
      </div>

      <div className="telephony-provider-list">
        <ProviderRow
          configured={twilioConfigured}
          icon={<TwilioLogo />}
          name="Twilio"
          onAction={twilioConfigured ? manageConnections : () => setDialog("twilio")}
        />
        <ProviderRow
          configured={sipConfigured}
          icon={<SipProviderIcon />}
          name="SIP"
          onAction={sipConfigured ? () => setDialog("sip-did") : () => setDialog("sip")}
        />
      </div>

      {dialog === "twilio" ? (
        <TwilioConnectionDialog
          model={model}
          showSecret={showSecret}
          onShowSecret={() => setShowSecret((current) => !current)}
          onClose={() => setDialog(null)}
          onSubmit={async () => {
            if (await model.createTwilioConnection()) {
              setDialog(null);
            }
          }}
        />
      ) : null}
      {dialog === "sip" ? (
        <SipConnectionDialog
          model={model}
          showSecret={showSecret}
          onShowSecret={() => setShowSecret((current) => !current)}
          onClose={() => setDialog(null)}
          onSubmit={async () => {
            if (await model.createSipConnection()) {
              setDialog(null);
            }
          }}
        />
      ) : null}
      {dialog === "sip-did" ? (
        <SipDidDialog
          model={model}
          onClose={() => setDialog(null)}
          onSubmit={async () => {
            if (await model.registerSipDid()) {
              setDialog(null);
              manageConnections();
            }
          }}
        />
      ) : null}
    </section>
  );
}

function ProviderRow({
  configured,
  icon,
  name,
  onAction,
}: {
  configured: boolean;
  icon: ReactNode;
  name: string;
  onAction: () => void;
}) {
  return (
    <div className="telephony-provider-row telephony-motion-provider">
      <div className="telephony-provider-identity">
        <div className="telephony-provider-logo" aria-hidden="true">{icon}</div>
        <div>
          <strong>{name}</strong>
          <span className="telephony-provider-status">
            <span className={`telephony-led ${configured ? "is-configured" : ""}`} />
            {configured ? "Configured" : "Not configured"}
          </span>
        </div>
      </div>
      <Button aria-label={`${configured ? "Manage" : "Connect"} ${name}`} className="workflow-button telephony-provider-connect telephony-provider-connect-bordered telephony-motion-button" type="button" variant="outline" onClick={onAction}>
        {configured ? <Settings size={16} /> : <Plug size={16} />}
        <span>{configured ? "Manage" : "Connect"}</span>
      </Button>
    </div>
  );
}

function TwilioLogo() {
  return (
    <span className="twilio-logo-mark">
      <span /><span /><span /><span />
    </span>
  );
}

function SipProviderIcon() {
  return (
    <span className="sip-provider-mark">
      <Phone size={22} />
      <Settings size={12} />
    </span>
  );
}

function ConnectionDialogShell({
  children,
  description,
  onClose,
  title,
}: {
  children: ReactNode;
  description: string;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="telephony-dialog-backdrop telephony-motion-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="telephony-connection-dialog telephony-dialog-motion" role="dialog" aria-modal="true" aria-label={title}>
        <div className="telephony-dialog-header">
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <button className="telephony-dialog-close" type="button" aria-label={`Close ${title}`} onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function TwilioConnectionDialog({ model, onClose, onShowSecret, onSubmit, showSecret }: {
  model: TelephonyScreenModel;
  onClose: () => void;
  onShowSecret: () => void;
  onSubmit: () => Promise<void>;
  showSecret: boolean;
}) {
  const pending = model.isOperationPending("twilio:create");
  return (
    <ConnectionDialogShell title="Connect Twilio" description="Enter your Twilio account credentials to connect." onClose={onClose}>
      <div className="telephony-dialog-form">
        <label><span>Connection name</span><Input aria-label="Connection name" placeholder="e.g. Main account" value={model.twilioDraft.label} onChange={(event) => model.setTwilioDraft((current) => ({ ...current, label: event.target.value }))} /></label>
        <label><span>Account SID</span><Input aria-label="Account SID" placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value={model.twilioDraft.accountSid} onChange={(event) => model.setTwilioDraft((current) => ({ ...current, accountSid: event.target.value }))} /></label>
        <label><span>Auth token</span><span className="telephony-secret-field"><Input aria-label="Auth token" placeholder="Your auth token" type={showSecret ? "text" : "password"} value={model.twilioDraft.authToken} onChange={(event) => model.setTwilioDraft((current) => ({ ...current, authToken: event.target.value }))} /><button type="button" aria-label={showSecret ? "Hide auth token" : "Show auth token"} onClick={onShowSecret}>{showSecret ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
        <label><span>Region</span><Select aria-label="Region" value={model.twilioDraft.region} onChange={(event) => model.setTwilioDraft((current) => ({ ...current, region: event.target.value }))}><option value="us-east-1">US East (Virginia)</option><option value="eu-west-1">EU West (Ireland)</option></Select></label>
      </div>
      <div className="telephony-dialog-note"><ShieldCheck size={15} /><span>Your credentials are encrypted and stored securely.</span></div>
      <div className="telephony-dialog-actions">
        <Button className="workflow-button" type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button aria-busy={pending} className="workflow-button workflow-button-primary" disabled={pending} type="button" onClick={() => void onSubmit()}><ShieldCheck size={16} /><span>{pending ? "Validating" : "Validate and connect"}</span></Button>
      </div>
    </ConnectionDialogShell>
  );
}

function SipConnectionDialog({ model, onClose, onShowSecret, onSubmit, showSecret }: {
  model: TelephonyScreenModel;
  onClose: () => void;
  onShowSecret: () => void;
  onSubmit: () => Promise<void>;
  showSecret: boolean;
}) {
  const pending = model.isOperationPending("sip:create");
  return (
    <ConnectionDialogShell title="Connect SIP" description="Enter the credentials supplied by your SIP provider." onClose={onClose}>
      <div className="telephony-dialog-form telephony-dialog-form-two-column">
        <label><span>Connection name</span><Input value={model.sipDraft.label} onChange={(event) => model.setSipDraft((current) => ({ ...current, label: event.target.value }))} /></label>
        <label><span>Region</span><Select value={model.sipDraft.region} onChange={(event) => model.setSipDraft((current) => ({ ...current, region: event.target.value }))}><option value="us-east-1">US East</option><option value="eu-west-1">EU West</option></Select></label>
        <label><span>SIP domain</span><Input value={model.sipDraft.sipDomain} onChange={(event) => model.setSipDraft((current) => ({ ...current, sipDomain: event.target.value }))} /></label>
        <label><span>Username</span><Input value={model.sipDraft.username} onChange={(event) => model.setSipDraft((current) => ({ ...current, username: event.target.value }))} /></label>
        <label><span>Secret</span><span className="telephony-secret-field"><Input aria-label="Secret" type={showSecret ? "text" : "password"} value={model.sipDraft.secret} onChange={(event) => model.setSipDraft((current) => ({ ...current, secret: event.target.value }))} /><button type="button" aria-label={showSecret ? "Hide secret" : "Show secret"} onClick={onShowSecret}>{showSecret ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
        <label><span>Codecs</span><Input value={model.sipDraft.codecs} onChange={(event) => model.setSipDraft((current) => ({ ...current, codecs: event.target.value }))} /></label>
      </div>
      <div className="telephony-dialog-note"><ShieldCheck size={15} /><span>Your credentials are encrypted and stored securely.</span></div>
      <div className="telephony-dialog-actions">
        <Button className="workflow-button" type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button aria-label="Submit SIP connection" aria-busy={pending} className="workflow-button workflow-button-primary" disabled={pending} type="button" onClick={() => void onSubmit()}><Plug size={16} /><span>{pending ? "Connecting SIP" : "Connect SIP"}</span></Button>
      </div>
    </ConnectionDialogShell>
  );
}

function SipDidDialog({ model, onClose, onSubmit }: {
  model: TelephonyScreenModel;
  onClose: () => void;
  onSubmit: () => Promise<void>;
}) {
  const pending = model.isOperationPending("sip:register-number");
  return (
    <ConnectionDialogShell title="Manage SIP" description="Add a voice-capable DID to this SIP connection." onClose={onClose}>
      <div className="telephony-dialog-form">
        <label><span>DID number</span><Input aria-label="DID number" value={model.sipDraft.phoneNumber} onChange={(event) => model.setSipDraft((current) => ({ ...current, phoneNumber: event.target.value }))} /></label>
        <label><span>Friendly name</span><Input aria-label="Friendly name" value={model.sipDraft.friendlyName} onChange={(event) => model.setSipDraft((current) => ({ ...current, friendlyName: event.target.value }))} /></label>
      </div>
      <div className="telephony-dialog-actions">
        <Button className="workflow-button" type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button aria-busy={pending} className="workflow-button workflow-button-primary" disabled={pending} type="button" onClick={() => void onSubmit()}><PhoneIncoming size={16} /><span>{pending ? "Adding DID" : "Add DID"}</span></Button>
      </div>
    </ConnectionDialogShell>
  );
}

function TelephonyConnectionTable({ model }: { model: TelephonyScreenModel }) {
  const { contentState, deleteConnection, importNumbers, isOperationPending, loading, rotateCredentials, runConnectionHeartbeat, validateConnection } = model;
  const rotatePending = isOperationPending("credentials:rotate");

  return (
    <Card className="surface-card telephony-connections-panel telephony-motion-connections" id="telephony-connections">
      <div className="telephony-connections-header">
        <div>
          <h2>Connections</h2>
          <p>Your configured telephony provider connections.</p>
        </div>
        <Button aria-label="Rotate credentials" aria-busy={rotatePending} className="workflow-button telephony-icon-button telephony-action-button telephony-action-rotate" disabled={rotatePending} title="Rotate credentials" type="button" variant="outline" onClick={rotateCredentials}>
          <KeyRound size={16} />
        </Button>
      </div>

      {contentState.connections.length === 0 ? (
        <div className="telephony-empty-state">No provider connections yet. Connect Twilio or SIP above to get started.</div>
      ) : (
        <Table className="telephony-connections-table" aria-label="Telephony provider connections">
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead>Connection name</TableHead>
              <TableHead>Imported numbers</TableHead>
              <TableHead>Routed workflow</TableHead>
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contentState.connections.map((connection) => {
              const numbers = contentState.phoneNumbers.filter((number) => number.connectionId === connection.id);
              const routeNames = [...new Set(numbers.map((number) => number.liveRoute?.workflowLabel).filter((value): value is string => Boolean(value)))];
              const importPending = isOperationPending(`connection:${connection.id}:import`);
              const validatePending = isOperationPending(`connection:${connection.id}:validate`);
              const heartbeatPending = isOperationPending(`connection:${connection.id}:heartbeat`);
              const deletePending = isOperationPending(`connection:${connection.id}:delete`);
              return (
                <TableRow key={connection.id}>
                  <TableCell>
                    <div className="telephony-table-provider">
                      <span className={`telephony-led ${connection.status === "active" ? "is-configured" : ""}`} />
                      <span>{formatProviderName(connection.provider)}</span>
                    </div>
                  </TableCell>
                  <TableCell><strong>{connection.label}</strong><span>{connection.region}</span></TableCell>
                  <TableCell>{numbers.length}</TableCell>
                  <TableCell>{routeNames.length > 0 ? routeNames.join(", ") : "Not routed"}</TableCell>
                  <TableCell>
                    <div className="telephony-table-actions">
                      <Button aria-label="Run heartbeat" aria-busy={heartbeatPending} className="workflow-button telephony-icon-button telephony-action-button telephony-action-heartbeat" disabled={heartbeatPending} title={`Run heartbeat for ${connection.label}`} type="button" variant="outline" onClick={() => runConnectionHeartbeat(connection.id)}><Activity size={15} /></Button>
                      <Button aria-label="Validate provider" aria-busy={validatePending} className="workflow-button telephony-icon-button telephony-action-button telephony-action-validate" disabled={validatePending} title={`Validate ${connection.label}`} type="button" variant="outline" onClick={() => validateConnection(connection.id)}><BadgeCheck size={15} /></Button>
                      {connection.ownershipMode === "byo_provider_account" ? <Button aria-label="Import phone numbers" aria-busy={importPending} className="workflow-button telephony-icon-button telephony-action-button telephony-action-import" disabled={importPending} title={`Import numbers from ${connection.label}`} type="button" variant="outline" onClick={() => importNumbers(connection.id)}><PhoneIncoming size={15} /></Button> : null}
                      <Button aria-label={`Delete ${connection.label}`} aria-busy={deletePending} className="workflow-button workflow-button-danger telephony-icon-button telephony-action-button telephony-action-delete" disabled={deletePending} title="Delete connection" type="button" variant="destructive" onClick={() => deleteConnection(connection.id)}><Trash2 size={15} /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {loading ? <div className="panel-meta">Loading connections</div> : null}
    </Card>
  );
}

function TelephonyRoutingPanel({ model }: { model: TelephonyScreenModel }) {
  const {
    activeWorkspaceId,
    activateLiveRoute,
    activationGuidanceByNumberId,
    contentState,
    deletePhoneNumber,
    isOperationPending,
    pauseLiveRoute,
    publishedWorkflows,
    resolveRouteSelection,
    resumeLiveRoute,
    saveRoute,
    setRouteSelections,
    setWorkflowCatalogVersion,
    twilioDraft,
    workspaceNameById,
  } = model;

  return (
    <Card className="surface-card telephony-panel">
      <div className="telephony-section-head">
        <div>
          <div className="eyebrow-copy">Routing</div>
          <div className="subhead-copy telephony-section-title">Live numbers</div>
        </div>
        <Button className="workflow-button" type="button" variant="outline" onClick={() => setWorkflowCatalogVersion((current) => current + 1)}>
          <Bot size={15} />
          <span>Reload workflows</span>
        </Button>
      </div>

      {contentState.phoneNumbers.length === 0 ? (
        <div className="telephony-empty-state">Provision a platform number, import Twilio inventory, or attach a SIP DID to start live routing.</div>
      ) : (
        <Table className="telephony-number-table" aria-label="Telephony numbers">
          <TableHeader>
            <TableRow className="telephony-number-table-head">
              <TableHead>Number</TableHead>
              <TableHead>Workflow</TableHead>
              <TableHead>Workspace</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contentState.phoneNumbers.map((phoneNumber) => {
              const numberState = resolvePhoneNumberOperatorState(phoneNumber);
              const liveRoute = phoneNumber.liveRoute;
              const activationStatus = liveRoute?.activationStatus;
              const routePending = isOperationPending(`number:${phoneNumber.id}:route`);
              const activatePending = isOperationPending(`number:${phoneNumber.id}:activate`);
              const pausePending = isOperationPending(`number:${phoneNumber.id}:pause`);
              const resumePending = isOperationPending(`number:${phoneNumber.id}:resume`);
              const deletePending = isOperationPending(`number:${phoneNumber.id}:delete`);
              const activationGuidance = activationGuidanceByNumberId[phoneNumber.id];

              return (
                <TableRow key={phoneNumber.id} className="telephony-number-row">
                  <TableCell>
                    <div className="panel-title">{phoneNumber.phoneNumber}</div>
                    <div className="panel-meta">{phoneNumber.friendlyName} - {formatProvisionSource(phoneNumber.provisionSource)}</div>
                  </TableCell>
                  <TableCell>
                    <label className="workspace-inline-field">
                      <span className="sr-only">{`Workflow route for ${phoneNumber.phoneNumber}`}</span>
                      <Select
                        value={resolveRouteSelection(phoneNumber)}
                        onChange={(event) => setRouteSelections((current) => ({ ...current, [phoneNumber.id]: event.target.value }))}
                      >
                        <option value="">Select workflow</option>
                        {publishedWorkflows.map((workflow) => (
                          <option key={workflow.id} value={workflow.id}>{workflow.graph.name}</option>
                        ))}
                      </Select>
                    </label>
                  </TableCell>
                  <TableCell className="panel-meta">{workspaceNameById.get(phoneNumber.liveRoute?.workspaceId ?? activeWorkspaceId) ?? "Unassigned"}</TableCell>
                  <TableCell className="telephony-number-status">
                    <span className={`status-pill status-pill-${numberState.tone}`}>{numberState.label}</span>
                    <Button aria-busy={routePending} aria-label={`Save route for ${phoneNumber.phoneNumber}`} className="workflow-button" disabled={routePending} type="button" variant="outline" onClick={() => saveRoute(phoneNumber.id)}>
                      <Waves size={15} />
                      <span>{routePending ? "Saving route" : "Save route"}</span>
                    </Button>
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
                      <Button aria-busy={activatePending} aria-label={`Activate live route for ${phoneNumber.phoneNumber}`} className="workflow-button workflow-button-primary" disabled={activatePending} type="button" onClick={() => activateLiveRoute(phoneNumber.id)}>
                        <BadgeCheck size={15} />
                        <span>{activatePending ? "Activating live" : "Activate live"}</span>
                      </Button>
                    ) : null}
                    {activationStatus === "active" ? (
                      <Button aria-busy={pausePending} aria-label={`Pause live route for ${phoneNumber.phoneNumber}`} className="workflow-button" disabled={pausePending} type="button" variant="outline" onClick={() => pauseLiveRoute(phoneNumber.id)}>
                        <CircleSlash2 size={15} />
                        <span>{pausePending ? "Pausing" : "Pause"}</span>
                      </Button>
                    ) : null}
                    {activationStatus === "paused" ? (
                      <Button aria-busy={resumePending} aria-label={`Resume live route for ${phoneNumber.phoneNumber}`} className="workflow-button workflow-button-primary" disabled={resumePending} type="button" onClick={() => resumeLiveRoute(phoneNumber.id)}>
                        <BadgeCheck size={15} />
                        <span>{resumePending ? "Resuming" : "Resume"}</span>
                      </Button>
                    ) : null}
                    {phoneNumber.provisionSource === "provider-import" ? (
                      <Button aria-busy={deletePending} aria-label={`Delete imported number ${phoneNumber.phoneNumber}`} className="workflow-button workflow-button-danger" disabled={deletePending} type="button" variant="destructive" onClick={() => deletePhoneNumber(phoneNumber.id)}>
                        <Trash2 size={15} />
                        <span>{deletePending ? "Deleting" : "Delete number"}</span>
                      </Button>
                    ) : null}
                    {liveRoute !== undefined && activationStatus !== "active" ? (
                      <div className="telephony-activation-summary" aria-label={`Activation summary for ${phoneNumber.phoneNumber}`}>
                        <span>{liveRoute.workflowLabel}</span>
                        <span>{liveRoute.publishedVersionId}</span>
                        <span>{formatRuntimeProfileLabel(liveRoute.runtimeProfile)}</span>
                        <span>{formatRecordingSummary(phoneNumber.recordingPolicy ?? resolveSelectedNumberRecordingPolicy(contentState, phoneNumber.id) ?? buildRecordingPolicy(twilioDraft))}</span>
                        <span>Subscription and budget checked on activation</span>
                      </div>
                    ) : null}
                    {activationGuidance !== undefined ? (
                      <div className="telephony-activation-block" role="status" aria-label={`Activation blocker for ${phoneNumber.phoneNumber}`}>
                        <span>{activationGuidance.title}</span>
                        <span>{activationGuidance.message}</span>
                        <span>{activationGuidance.action}</span>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function TelephonyInboundTestPanel({ model }: { model: TelephonyScreenModel }) {
  const { callablePhoneNumberOptions, effectiveDispatchDraft, isOperationPending, lastDispatch, runInboundDispatch, runLoopbackTestCall, setDispatchDraft } = model;
  const inboundPending = isOperationPending("dispatch:inbound");
  const loopbackPending = isOperationPending("dispatch:loopback");

  return (
    <Card className="surface-card telephony-panel">
      <div className="telephony-section-head">
        <div>
          <div className="eyebrow-copy">Inbound test</div>
          <div className="subhead-copy telephony-section-title">Dispatch runner</div>
        </div>
      </div>

      <div className="telephony-form-grid telephony-form-grid-compact">
        <label className="workspace-settings-field">
          <span>Destination number</span>
          <Select value={effectiveDispatchDraft.toPhoneNumber} onChange={(event) => setDispatchDraft((current) => ({ ...current, toPhoneNumber: event.target.value }))}>
            <option value="">Select imported number</option>
            {callablePhoneNumberOptions.map((phoneNumber) => (
              <option key={phoneNumber.id} value={phoneNumber.value}>{phoneNumber.label}</option>
            ))}
          </Select>
        </label>
        <label className="workspace-settings-field">
          <span>Caller</span>
          <Input value={effectiveDispatchDraft.fromPhoneNumber} onChange={(event) => setDispatchDraft((current) => ({ ...current, fromPhoneNumber: event.target.value }))} />
        </label>
        <label className="workspace-settings-field">
          <span>Call SID</span>
          <Input value={effectiveDispatchDraft.callSid} onChange={(event) => setDispatchDraft((current) => ({ ...current, callSid: event.target.value }))} />
        </label>
      </div>

      <div className="telephony-row-actions">
        <Button aria-busy={inboundPending} className="workflow-button workflow-button-success" disabled={inboundPending} type="button" onClick={runInboundDispatch}>
          <TestTube2 size={15} />
          <span>{inboundPending ? "Running dispatch" : "Run inbound dispatch"}</span>
        </Button>
        <Button aria-busy={loopbackPending} className="workflow-button" disabled={loopbackPending} type="button" variant="outline" onClick={runLoopbackTestCall}>
          <PhoneCall size={15} />
          <span>{loopbackPending ? "Starting loopback" : "Run loopback test call"}</span>
        </Button>
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
    </Card>
  );
}

function TelephonyExecutionPanel({ model }: { model: TelephonyScreenModel }) {
  const { executionCommands, executionSessions } = model;

  return (
    <Card className="surface-card telephony-panel">
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
    </Card>
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
  const { callControlSessionOptions, contentState, effectiveControlDraft, executionSessions, isOperationPending, lastControlEvent, setControlDraft, submitCallControlEvent } = model;
  const recordPending = isOperationPending("call-control:record");

  return (
    <Card className="surface-card telephony-panel">
      <div className="telephony-section-head">
        <div>
          <div className="eyebrow-copy">Live controls</div>
          <div className="subhead-copy telephony-section-title">DTMF and failover</div>
        </div>
      </div>

      <div className="telephony-form-grid telephony-form-grid-compact">
        <label className="workspace-settings-field">
          <span>Call session</span>
          <Select
            value={effectiveControlDraft.callSessionId}
            onChange={(event) => {
              const selectedSession = callControlSessionOptions.find((session) => session.callSessionId === event.target.value);
              setControlDraft((current) => ({ ...current, callSessionId: event.target.value, dispatchId: selectedSession?.dispatchId ?? "" }));
            }}
          >
            <option value="">Select call session</option>
            {callControlSessionOptions.map((session) => (
              <option key={`${session.dispatchId}:${session.callSessionId}`} value={session.callSessionId}>{session.label}</option>
            ))}
          </Select>
        </label>
        <div className="telephony-control-switcher">
          {callControlModes.map((mode) => (
            <Button
              key={mode.value}
              className={effectiveControlDraft.eventType === mode.value ? "telephony-control-tab telephony-control-tab-active" : "telephony-control-tab"}
              type="button"
              variant="ghost"
              onClick={() => setControlDraft((current) => ({ ...current, eventType: mode.value }))}
            >
              <mode.icon size={14} />
              <span>{mode.label}</span>
            </Button>
          ))}
        </div>

        {effectiveControlDraft.eventType === "dtmf.received" ? (
          <label className="workspace-settings-field">
            <span>Digit</span>
            <Input value={effectiveControlDraft.digit} onChange={(event) => setControlDraft((current) => ({ ...current, digit: event.target.value }))} />
          </label>
        ) : null}

        {effectiveControlDraft.eventType === "transfer.requested" || effectiveControlDraft.eventType === "transfer.failed" ? (
          <label className="workspace-settings-field">
            <span>Transfer target</span>
            <Input value={effectiveControlDraft.transferTarget} onChange={(event) => setControlDraft((current) => ({ ...current, transferTarget: event.target.value }))} />
          </label>
        ) : null}

        {effectiveControlDraft.eventType === "voicemail.detected" || effectiveControlDraft.eventType === "transfer.failed" || effectiveControlDraft.eventType === "failover.triggered" ? (
          <label className="workspace-settings-field">
            <span>Fallback path</span>
            <Input value={effectiveControlDraft.fallbackTarget} onChange={(event) => setControlDraft((current) => ({ ...current, fallbackTarget: event.target.value }))} />
          </label>
        ) : null}
      </div>

      <div className="telephony-row-actions">
        <Button aria-busy={recordPending} className="workflow-button" disabled={recordPending} type="button" variant="outline" onClick={submitCallControlEvent}>
          <Waves size={15} />
          <span>{recordPending ? "Recording event" : "Record call event"}</span>
        </Button>
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
    </Card>
  );
}

function TelephonyProviderEventsPanel({ contentState }: { contentState: TelephonyStateResponse }) {
  const incomingCallLogs = buildIncomingCallLogEntries(contentState);

  return (
    <Card className="surface-card telephony-panel">
      <div className="telephony-section-head">
        <div>
          <div className="eyebrow-copy">Call logs</div>
          <div className="subhead-copy telephony-section-title">Incoming attempts</div>
        </div>
      </div>

      {incomingCallLogs.length === 0 ? (
        <div className="telephony-empty-state">No incoming call logs yet.</div>
      ) : (
        <div className="telephony-event-list">
          {incomingCallLogs.map((entry) => (
            <div key={entry.id} className="subtle-panel telephony-event-card">
              <div className="telephony-health-title">
                <PhoneIncoming size={15} />
                <span>{entry.status}</span>
              </div>
              <div className="panel-title">{entry.title}</div>
              <div className="panel-meta">{entry.detail}</div>
              <div className="telephony-policy-grid">
                <div className="telephony-policy-chip">
                  <span>Source</span>
                  <strong>{entry.source}</strong>
                </div>
                <div className="telephony-policy-chip">
                  <span>Call</span>
                  <strong>{entry.callSid}</strong>
                </div>
                {entry.workflowLabel !== undefined ? (
                  <div className="telephony-policy-chip">
                    <span>Workflow</span>
                    <strong>{entry.workflowLabel}</strong>
                  </div>
                ) : null}
              </div>
              <div className="panel-meta">{entry.at}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

type IncomingCallLogEntry = {
  id: string;
  at: string;
  callSid: string;
  detail: string;
  source: string;
  status: string;
  title: string;
  workflowLabel?: string | undefined;
};

function buildIncomingCallLogEntries(state: TelephonyStateResponse): IncomingCallLogEntry[] {
  const dispatchEntries = state.dispatches
    .filter((dispatch) => dispatch.direction === "inbound")
    .map((dispatch) => ({
      id: dispatch.id,
      at: dispatch.createdAt,
      callSid: dispatch.callSessionId ?? dispatch.id,
      detail: dispatch.reason,
      source: dispatch.source === "webhook" ? "Twilio webhook" : "Manual test",
      status: formatDispatchDisposition(dispatch.disposition),
      title: `${dispatch.fromPhoneNumber} -> ${dispatch.toPhoneNumber}`,
      workflowLabel: dispatch.workflowLabel,
    }));
  const dispatchCallIds = new Set(
    dispatchEntries.flatMap((entry) => [
      entry.callSid,
      entry.callSid.endsWith(":telephony") ? entry.callSid.slice(0, -":telephony".length) : entry.callSid,
    ]),
  );
  const webhookEntries = state.webhookEvents
    .filter((event) => !dispatchCallIds.has(event.callSid))
    .map((event) => ({
      id: event.id,
      at: event.receivedAt,
      callSid: event.callSid,
      detail: event.duplicate ? "Duplicate provider callback suppressed." : "Provider callback received.",
      source: "Twilio webhook",
      status: event.eventType,
      title: event.accountSid,
    }));

  return [...dispatchEntries, ...webhookEntries]
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, 8);
}

function formatDispatchDisposition(disposition: TelephonyDispatchRecord["disposition"]) {
  switch (disposition) {
    case "routed":
      return "Routed";
    case "fallback":
      return "Fallback";
    case "blocked":
      return "Blocked";
    case "queued":
      return "Queued";
  }
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
    <div className="telephony-metric-card">
      <div className="telephony-metric-label">
        <Icon size={14} />
        <span>{label}</span>
      </div>
      <div className="telephony-metric-value">{value}</div>
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

function clearNumberGuidance(
  current: Record<string, LiveRouteActivationGuidance | undefined>,
  numberId: string,
) {
  if (current[numberId] === undefined) {
    return current;
  }

  const next = { ...current };
  delete next[numberId];
  return next;
}

function resolveLiveRouteActivationGuidance(
  error: unknown,
  phoneNumber: ImportedTelephonyPhoneNumber | undefined,
): LiveRouteActivationGuidance {
  const payload = error instanceof ApiError ? error.payload : null;
  const blockCodes = readActivationBlockCodes(payload);

  if (blockCodes.includes("missing_recent_successful_phone_test")) {
    const summary = readRecordProperty(payload, "summary");
    const workflowName = readStringProperty(summary, "workflowName")
      ?? phoneNumber?.liveRoute?.workflowLabel
      ?? "This route";
    const number = readStringProperty(summary, "number") ?? phoneNumber?.phoneNumber ?? "this number";

    return {
      title: "Run a Phone test before activating live answering.",
      message: `${workflowName} needs a recent successful PSTN Phone test for ${number}.`,
      action: "Open Phone test, call the line from an allowed caller number, wait for a passed result, then activate again.",
    };
  }

  const blockMessages = readActivationBlockMessages(payload);
  if (blockMessages.length > 0) {
    return {
      title: "Live route needs attention before activation.",
      message: blockMessages.join(" "),
      action: "Resolve the listed activation blockers, then activate again.",
    };
  }

  return {
    title: "Live route could not be activated.",
    message: error instanceof Error ? error.message : "The activation request did not complete.",
    action: "Review the number route and try again.",
  };
}

function readActivationBlockCodes(payload: unknown) {
  return readActivationBlocks(payload)
    .map((block) => readStringProperty(block, "code"))
    .filter((code): code is string => code !== undefined);
}

function readActivationBlockMessages(payload: unknown) {
  return readActivationBlocks(payload)
    .map((block) => readStringProperty(block, "message"))
    .filter((message): message is string => message !== undefined);
}

function readActivationBlocks(payload: unknown) {
  const blocks = readRecordProperty(payload, "blocks");

  return Array.isArray(blocks)
    ? blocks.filter((block): block is Record<string, unknown> => isRecord(block))
    : [];
}

function readRecordProperty(value: unknown, property: string) {
  return isRecord(value) ? value[property] : undefined;
}

function readStringProperty(value: unknown, property: string) {
  const candidate = readRecordProperty(value, property);

  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
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
  publishedWorkflows: PublishedWorkflowVersion[],
  workspaceId: string,
) {
  let latestWorkflow: PublishedWorkflowVersion | undefined;

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

function formatProviderName(provider: string) {
  if (provider === "custom-sip") {
    return "SIP";
  }

  return provider.charAt(0).toUpperCase() + provider.slice(1);
}
