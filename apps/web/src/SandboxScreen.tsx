import { type ReactNode, useEffect, useMemo, useReducer } from "react";

import {
  Clock3,
  Headphones,
  Mic,
  PhoneCall,
  Power,
  RadioTower,
  RefreshCw,
  SendHorizontal,
  SquareTerminal,
  WalletCards,
  Wrench,
} from "lucide-react";

import {
  createAgentRoleNode,
  createConditionNode,
  createEndNode,
  createHandoffNode,
  createToolNode,
  createWorkflowGraph,
  publishWorkflowVersion,
  type ImportedTelephonyPhoneNumber,
  type PublishedWorkflowVersion,
  type RuntimeCallPhase,
  type TelephonyConnection,
  type TelephonyPhoneTestChecklist,
  type TelephonyTestWaitingSession,
  type Workspace,
} from "@zara/core";
import { useLocation } from "react-router-dom";
import { Button, Card, Input, Select, Textarea } from "@zara/ui";

import { summarizeLiveSandboxEvent } from "./liveSandboxEventFormatting";
import {
  buildTranscriptFromLiveSandboxEvents,
  redactSensitiveMonitorText,
} from "./liveSandboxReplay";
import { compilePublishedSandboxRuntimeManifest } from "./sandboxRuntimeManifest";
import { useLiveSandboxSession } from "./useLiveSandboxSession";
import {
  getLiveSandboxSessionEvents,
  acceptLiveSandboxEscalation,
  declineLiveSandboxEscalation,
  listLiveSandboxEscalations,
  type LiveSandboxEscalation,
  listLiveSandboxSessions,
  type LiveSandboxSessionSummary,
  type LiveSandboxStreamEvent,
} from "./liveSandboxSessionApi";
import {
  getSandboxWorkflowVersionOptionId,
  getSelectedSandboxWorkflowVersionId,
  loadPublishedWorkflowVersionsForWorkspace,
  selectSandboxWorkflowVersion,
} from "./workflowSandboxRegistry";
import {
  completePstnTestRouteViaApi,
  createPstnTestRouteViaApi,
  fetchTelephonyState,
  type TelephonyDispatchRecord,
  type TelephonyStateResponse,
} from "./telephonyApi";
import { tenantId } from "./workspaceState";

type IntentOption = "support" | "billing";
type SandboxMode = "published-browser" | "phone-test";
type PhoneTestRuntimeProfile = "cost-optimized" | "balanced" | "premium-realtime";

interface SandboxPhoneTestRoute {
  phoneNumber: ImportedTelephonyPhoneNumber;
  liveRoute: NonNullable<ImportedTelephonyPhoneNumber["liveRoute"]>;
  connection: TelephonyConnection;
}

interface SandboxScreenProps {
  activeWorkspaceId: string;
  workspaces: Workspace[];
  showToast: (message: string) => void;
}

interface SandboxTelephonyResourceState {
  error: string | null;
  key: string;
  loading: boolean;
  state: TelephonyStateResponse | null;
}

interface SandboxScreenState {
  workflowCatalogVersion: number;
  selectedWorkflowId: string;
  intent: IntentOption;
  phase: RuntimeCallPhase;
  draftUtterance: string;
  sandboxMode: SandboxMode;
  telephonyResource: SandboxTelephonyResourceState;
  selectedPhoneNumberId: string;
  allowedCallerNumber: string;
  phoneTestExpiryMinutes: string;
  phoneTestStarting: boolean;
  phoneTestNotice: string | null;
  monitorSessions: LiveSandboxSessionSummary[];
  monitorLoading: boolean;
  monitorError: string | null;
  inspectedMonitorSessionId: string | null;
  inspectedMonitorEvents: LiveSandboxStreamEvent[];
  inspectedMonitorLoading: boolean;
  escalations: LiveSandboxEscalation[];
  escalationsLoading: boolean;
  escalationsError: string | null;
}

type SandboxStateSetter<T> = T | ((current: T) => T);

type SandboxScreenAction =
  | { type: "set"; field: keyof SandboxScreenState; value: unknown }
  | { type: "update"; field: keyof SandboxScreenState; update: (current: unknown) => unknown };

function sandboxScreenReducer(state: SandboxScreenState, action: SandboxScreenAction): SandboxScreenState {
  if (action.type === "update") {
    return {
      ...state,
      [action.field]: action.update(state[action.field]),
    } as SandboxScreenState;
  }

  return {
    ...state,
    [action.field]: action.value,
  } as SandboxScreenState;
}

function createInitialSandboxScreenState({
  defaultPublishedWorkflow,
  locationSearch,
  telephonyRequestKey,
}: {
  defaultPublishedWorkflow: PublishedWorkflowVersion;
  locationSearch: string;
  telephonyRequestKey: string;
}): SandboxScreenState {
  const queryParameters = new URLSearchParams(locationSearch);

  return {
    workflowCatalogVersion: 0,
    selectedWorkflowId:
      queryParameters.get("workflow")
      ?? getSelectedSandboxWorkflowVersionId()
      ?? getSandboxWorkflowVersionOptionId(defaultPublishedWorkflow),
    intent: "billing",
    phase: "discovery",
    draftUtterance: "I need help with a billing charge on my account.",
    sandboxMode: queryParameters.get("mode") === "phone-test" ? "phone-test" : "published-browser",
    telephonyResource: {
      error: null,
      key: telephonyRequestKey,
      loading: telephonyRequestKey.length > 0,
      state: null,
    },
    selectedPhoneNumberId: queryParameters.get("number") ?? "",
    allowedCallerNumber: "+233201110001",
    phoneTestExpiryMinutes: "15",
    phoneTestStarting: false,
    phoneTestNotice: null,
    monitorSessions: [],
    monitorLoading: false,
    monitorError: null,
    inspectedMonitorSessionId: null,
    inspectedMonitorEvents: [],
    inspectedMonitorLoading: false,
    escalations: [],
    escalationsLoading: false,
    escalationsError: null,
  };
}

export function SandboxScreen(props: SandboxScreenProps) {
  const model = useSandboxScreenModel(props);

  return <SandboxScreenView model={model} />;
}

function useSandboxScreenModel({
  activeWorkspaceId,
  workspaces,
  showToast,
}: SandboxScreenProps) {
  const location = useLocation();
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0];
  const defaultPublishedWorkflow = useMemo(
    () => createDefaultSandboxPublishedWorkflow(activeWorkspaceId),
    [activeWorkspaceId],
  );
  const initialSandboxMode: SandboxMode =
    new URLSearchParams(location.search).get("mode") === "phone-test" ? "phone-test" : "published-browser";
  const initialTelephonyRequestKey = initialSandboxMode === "phone-test" ? activeWorkspaceId : "";
  const [state, dispatch] = useReducer(
    sandboxScreenReducer,
    {
      defaultPublishedWorkflow,
      locationSearch: location.search,
      telephonyRequestKey: initialTelephonyRequestKey,
    },
    createInitialSandboxScreenState,
  );
  const {
    workflowCatalogVersion,
    selectedWorkflowId,
    intent,
    phase,
    draftUtterance,
    sandboxMode,
    telephonyResource,
    selectedPhoneNumberId,
    allowedCallerNumber,
    phoneTestExpiryMinutes,
    phoneTestStarting,
    phoneTestNotice,
    monitorSessions,
    monitorLoading,
    monitorError,
    inspectedMonitorSessionId,
    inspectedMonitorEvents,
    inspectedMonitorLoading,
    escalations,
    escalationsLoading,
    escalationsError,
  } = state;
  const setSandboxField = <Field extends keyof SandboxScreenState>(
    field: Field,
    value: SandboxStateSetter<SandboxScreenState[Field]>,
  ) => {
    if (typeof value === "function") {
      dispatch({
        type: "update",
        field,
        update: (current) =>
          (value as (currentValue: SandboxScreenState[Field]) => SandboxScreenState[Field])(
            current as SandboxScreenState[Field],
          ),
      });
      return;
    }

    dispatch({ type: "set", field, value });
  };
  const setWorkflowCatalogVersion = (value: SandboxStateSetter<number>) => setSandboxField("workflowCatalogVersion", value);
  const setSelectedWorkflowId = (value: string) => setSandboxField("selectedWorkflowId", value);
  const setIntent = (value: IntentOption) => setSandboxField("intent", value);
  const setPhase = (value: RuntimeCallPhase) => setSandboxField("phase", value);
  const setDraftUtterance = (value: string) => setSandboxField("draftUtterance", value);
  const setSandboxMode = (value: SandboxMode) => setSandboxField("sandboxMode", value);
  const telephonyRequestKey = sandboxMode === "phone-test" ? activeWorkspaceId : "";
  const setTelephonyResource = (value: SandboxStateSetter<SandboxTelephonyResourceState>) => setSandboxField("telephonyResource", value);
  const setSelectedPhoneNumberId = (value: string) => setSandboxField("selectedPhoneNumberId", value);
  const setAllowedCallerNumber = (value: string) => setSandboxField("allowedCallerNumber", value);
  const setPhoneTestExpiryMinutes = (value: string) => setSandboxField("phoneTestExpiryMinutes", value);
  const setPhoneTestStarting = (value: boolean) => setSandboxField("phoneTestStarting", value);
  const setPhoneTestNotice = (value: string | null) => setSandboxField("phoneTestNotice", value);
  const setMonitorSessions = (value: LiveSandboxSessionSummary[]) => setSandboxField("monitorSessions", value);
  const setMonitorLoading = (value: boolean) => setSandboxField("monitorLoading", value);
  const setMonitorError = (value: string | null) => setSandboxField("monitorError", value);
  const setInspectedMonitorSessionId = (value: string | null) => setSandboxField("inspectedMonitorSessionId", value);
  const setInspectedMonitorEvents = (value: LiveSandboxStreamEvent[]) => setSandboxField("inspectedMonitorEvents", value);
  const setInspectedMonitorLoading = (value: boolean) => setSandboxField("inspectedMonitorLoading", value);
  const setEscalations = (value: SandboxStateSetter<LiveSandboxEscalation[]>) => setSandboxField("escalations", value);
  const setEscalationsLoading = (value: boolean) => setSandboxField("escalationsLoading", value);
  const setEscalationsError = (value: string | null) => setSandboxField("escalationsError", value);

  if (telephonyResource.key !== telephonyRequestKey) {
    setTelephonyResource({
      error: null,
      key: telephonyRequestKey,
      loading: telephonyRequestKey.length > 0,
      state: null,
    });
  }

  const telephonyState = telephonyResource.key === telephonyRequestKey ? telephonyResource.state : null;
  const telephonyLoading = telephonyResource.key === telephonyRequestKey && telephonyResource.loading;
  const telephonyError = telephonyResource.key === telephonyRequestKey ? telephonyResource.error : null;
  const publishedWorkflows = useMemo(
    () => {
      void workflowCatalogVersion;
      return mergePublishedWorkflows(
        defaultPublishedWorkflow,
        loadPublishedWorkflowVersionsForWorkspace({ tenantId, workspaceId: activeWorkspaceId }),
      );
    },
    [activeWorkspaceId, defaultPublishedWorkflow, workflowCatalogVersion],
  );
  const effectiveSelectedWorkflowId = publishedWorkflows.some(
    (workflow) => getSandboxWorkflowVersionOptionId(workflow) === selectedWorkflowId,
  )
    ? selectedWorkflowId
    : getSandboxWorkflowVersionOptionId(defaultPublishedWorkflow);
  const selectedPublishedWorkflow = useMemo(
    () =>
      publishedWorkflows.find((workflow) => getSandboxWorkflowVersionOptionId(workflow) === effectiveSelectedWorkflowId)
      ?? defaultPublishedWorkflow,
    [defaultPublishedWorkflow, effectiveSelectedWorkflowId, publishedWorkflows],
  );
  const manifest = useMemo(
    () => compilePublishedSandboxRuntimeManifest(selectedPublishedWorkflow),
    [selectedPublishedWorkflow],
  );
  const liveSession = useLiveSandboxSession({
    organizationId: tenantId,
    actorUserId: "user-ops-lead",
    resumeContext: {
      workspaceId: activeWorkspaceId,
      source: "published",
      manifestId: manifest.manifestId,
      publishedVersionId: manifest.publishedVersionId,
      entryRoleId: manifest.entryRoleId,
    },
  });
  const availableTools = manifest.toolBindings;
  const budgetRemainingUsd = Math.max(0, manifest.budget.monthlyCapUsd - manifest.budget.currentSpendUsd);
  const lastEvent = liveSession.events.at(-1);
  const selectedWorkflowOptionId = getSandboxWorkflowVersionOptionId(selectedPublishedWorkflow);
  const inspectedMonitorSession = useMemo(
    () => monitorSessions.find((sessionSummary) => sessionSummary.sessionId === inspectedMonitorSessionId) ?? null,
    [inspectedMonitorSessionId, monitorSessions],
  );
  const inspectedMonitorTranscript = useMemo(
    () =>
      buildTranscriptFromLiveSandboxEvents(inspectedMonitorEvents).map((entry) => ({
        ...entry,
        text: redactSensitiveMonitorText(entry.text),
      })),
    [inspectedMonitorEvents],
  );
  const phoneTestRoutes = useMemo(
    () =>
      buildSandboxPhoneTestRoutes({
        state: telephonyState,
        workspaceId: activeWorkspaceId,
      }),
    [activeWorkspaceId, telephonyState],
  );
  const effectiveSelectedPhoneNumberId =
    phoneTestRoutes.some((route) => route.phoneNumber.id === selectedPhoneNumberId)
      ? selectedPhoneNumberId
      : phoneTestRoutes[0]?.phoneNumber.id ?? "";
  const selectedPhoneTestRoute =
    phoneTestRoutes.find((route) => route.phoneNumber.id === effectiveSelectedPhoneNumberId) ?? null;
  const selectedPhoneNumber =
    selectedPhoneTestRoute === null
      ? null
      : telephonyState?.phoneNumbers.find((phoneNumber) => phoneNumber.id === selectedPhoneTestRoute.phoneNumber.id) ?? selectedPhoneTestRoute.phoneNumber;
  const selectedPhoneTestDispatch = findPhoneTestDispatch(telephonyState, selectedPhoneNumber);
  const liveSessionErrorMessage = liveSession.errorNotice?.message ?? null;

  useEffect(() => {
    liveSession.setTurnContext({
      callPhase: phase,
      intent,
    });
  }, [intent, liveSession.setTurnContext, phase]);

  useEffect(() => {
    if (telephonyRequestKey.length === 0) {
      return;
    }

    let cancelled = false;

    void fetchTelephonyState(tenantId)
      .then((nextState) => {
        if (!cancelled) {
          setTelephonyResource((current) =>
            current.key === telephonyRequestKey
              ? {
                  error: null,
                  key: telephonyRequestKey,
                  loading: false,
                  state: nextState,
                }
              : current,
          );
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setTelephonyResource((current) =>
            current.key === telephonyRequestKey
              ? {
                  ...current,
                  error: error instanceof Error ? error.message : "Telephony state could not be loaded.",
                  loading: false,
                }
              : current,
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [telephonyRequestKey]);

  const refreshPublishedWorkflows = () => {
    setWorkflowCatalogVersion((current) => current + 1);
  };

  const selectPublishedWorkflow = (workflowVersionId: string) => {
    setSelectedWorkflowId(workflowVersionId);
    selectSandboxWorkflowVersion(workflowVersionId);
    void liveSession.resetSession();
  };

  const startTypedSandbox = async () => {
    await liveSession.startSession({
      workspaceId: activeWorkspaceId,
      source: "published",
      inputMode: "typed",
      entryRoleId: manifest.entryRoleId,
      manifest,
      callPhase: phase,
      intent,
    });
  };

  const startMicrophoneSandbox = async () => {
    await liveSession.startSession({
      workspaceId: activeWorkspaceId,
      source: "published",
      inputMode: "voice",
      entryRoleId: manifest.entryRoleId,
      manifest,
      callPhase: phase,
      intent,
    });
  };

  const sendTurn = () => {
    if (draftUtterance.trim().length === 0) {
      return;
    }

    liveSession.sendTextTurn({
      transcript: draftUtterance.trim(),
      callPhase: phase,
      intent,
    });
    setDraftUtterance(
      intent === "billing"
        ? "Please help me understand the invoice change."
        : "I need help with a support question.",
    );
  };

  const startPhoneTest = async () => {
    if (selectedPhoneTestRoute === null) {
      showToast("Route a published workflow to a number before starting a Phone test.");
      return;
    }

    const runtimeProfile = toPhoneTestRuntimeProfile(selectedPhoneTestRoute.liveRoute.runtimeProfile);
    if (runtimeProfile === null) {
      showToast("This route runtime profile is not supported for Phone test.");
      return;
    }

    const allowedCallerNumbers = parseAllowedCallerNumbers(allowedCallerNumber);
    if (allowedCallerNumbers.length === 0) {
      showToast("Add at least one allowed caller number for the Phone test.");
      return;
    }

    setPhoneTestStarting(true);
    setPhoneTestNotice(null);

    try {
      const response = await createPstnTestRouteViaApi({
        organizationId: tenantId,
        numberId: selectedPhoneTestRoute.phoneNumber.id,
        publishedVersionId: selectedPhoneTestRoute.liveRoute.publishedVersionId,
        workflowLabel: selectedPhoneTestRoute.liveRoute.workflowLabel,
        workspaceId: selectedPhoneTestRoute.liveRoute.workspaceId,
        runtimeProfile,
        allowedCallerNumbers,
        expiresAt: new Date(Date.now() + Number(phoneTestExpiryMinutes) * 60_000).toISOString(),
      });

      setTelephonyResource({
        error: null,
        key: telephonyRequestKey,
        loading: false,
        state: response.state,
      });
      setSelectedPhoneNumberId(response.phoneNumber.id);
      setPhoneTestNotice("Waiting for allowed caller");
      showToast("Phone test waiting session started.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Phone test could not be started.";
      setPhoneTestNotice(message);
      showToast(message);
    } finally {
      setPhoneTestStarting(false);
    }
  };

  const endPhoneTest = async () => {
    const waitingSession = selectedPhoneNumber?.testRoute?.waitingSession;

    if (selectedPhoneNumber === null || waitingSession === undefined) {
      return;
    }

    setPhoneTestStarting(true);
    setPhoneTestNotice("Ending Phone test");

    try {
      const response = await completePstnTestRouteViaApi({
        organizationId: tenantId,
        numberId: selectedPhoneNumber.id,
        sessionId: waitingSession.id,
        status: "manually_ended",
        reason: "Operator ended the Phone test from sandbox.",
      });

      setTelephonyResource({
        error: null,
        key: telephonyRequestKey,
        loading: false,
        state: response.state,
      });
      setSelectedPhoneNumberId(response.phoneNumber.id);
      setPhoneTestNotice("Manually ended");
      showToast("Phone test ended.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Phone test could not be ended.";
      setPhoneTestNotice(message);
      showToast(message);
    } finally {
      setPhoneTestStarting(false);
    }
  };

  const refreshLiveMonitor = async () => {
    setMonitorLoading(true);
    setMonitorError(null);

    try {
      const nextSessions = await listLiveSandboxSessions({
        organizationId: tenantId,
        workspaceId: activeWorkspaceId,
        includeEnded: true,
      });
      setMonitorSessions(nextSessions);
    } catch (error) {
      setMonitorError(error instanceof Error ? error.message : "The live monitor could not be refreshed.");
    } finally {
      setMonitorLoading(false);
    }
  };

  const inspectMonitorSession = async (sessionId: string) => {
    setInspectedMonitorSessionId(sessionId);
    setInspectedMonitorLoading(true);

    try {
      const replayedEvents = await getLiveSandboxSessionEvents({
        organizationId: tenantId,
        sessionId,
      });
      setInspectedMonitorEvents(replayedEvents);
    } catch (error) {
      setMonitorError(error instanceof Error ? error.message : "The sandbox replay timeline could not be loaded.");
    } finally {
      setInspectedMonitorLoading(false);
    }
  };

  const refreshEscalationQueue = async () => {
    setEscalationsLoading(true);
    setEscalationsError(null);

    try {
      const nextEscalations = await listLiveSandboxEscalations({
        organizationId: tenantId,
        workspaceId: activeWorkspaceId,
        now: new Date().toISOString(),
      });
      setEscalations(nextEscalations);
    } catch (error) {
      setEscalationsError(error instanceof Error ? error.message : "The escalation queue could not be refreshed.");
    } finally {
      setEscalationsLoading(false);
    }
  };

  const acceptEscalation = async (escalationId: string) => {
    const escalation = await acceptLiveSandboxEscalation({
      organizationId: tenantId,
      escalationId,
      actorUserId: "user-ops-lead",
    });
    setEscalations((currentEscalations) => replaceEscalation(currentEscalations, escalation));
  };

  const declineEscalation = async (escalationId: string) => {
    const escalation = await declineLiveSandboxEscalation({
      organizationId: tenantId,
      escalationId,
      actorUserId: "user-ops-lead",
      reason: "Operator declined from the sandbox monitor.",
    });
    setEscalations((currentEscalations) => replaceEscalation(currentEscalations, escalation));
  };

  return {
    activeWorkspace,
    allowedCallerNumber,
    availableTools,
    budgetRemainingUsd,
    declineEscalation,
    draftUtterance,
    endPhoneTest,
    escalations,
    escalationsError,
    escalationsLoading,
    inspectMonitorSession,
    inspectedMonitorEvents,
    inspectedMonitorLoading,
    inspectedMonitorSession,
    inspectedMonitorTranscript,
    intent,
    lastEvent,
    liveSession,
    liveSessionErrorMessage,
    manifest,
    monitorError,
    monitorLoading,
    monitorSessions,
    phase,
    phoneTestExpiryMinutes,
    phoneTestNotice,
    phoneTestRoutes,
    phoneTestStarting,
    publishedWorkflows,
    refreshEscalationQueue,
    refreshLiveMonitor,
    refreshPublishedWorkflows,
    sandboxMode,
    selectPublishedWorkflow,
    selectedPhoneNumber,
    selectedPhoneTestDispatch,
    selectedPhoneTestRoute,
    selectedPublishedWorkflow,
    selectedWorkflowOptionId,
    sendTurn,
    setAllowedCallerNumber,
    setDraftUtterance,
    setIntent,
    setPhase,
    setPhoneTestExpiryMinutes,
    setSandboxMode,
    setSelectedPhoneNumberId,
    startMicrophoneSandbox,
    startPhoneTest,
    startTypedSandbox,
    telephonyError,
    telephonyLoading,
    acceptEscalation,
  };
}

type SandboxScreenModel = ReturnType<typeof useSandboxScreenModel>;

function SandboxScreenView({ model }: { model: SandboxScreenModel }) {
  return (
    <div className="sandbox-page">
      {model.liveSessionErrorMessage !== null ? (
        <output className="workflow-toast" aria-live="assertive">
          {model.liveSessionErrorMessage}
        </output>
      ) : null}
      <SandboxToolbar model={model} />
      <div className="sandbox-grid">
        {model.sandboxMode === "phone-test" ? <SandboxPhoneTestPanel model={model} /> : <SandboxBrowserSurface model={model} />}
        <SandboxSideColumn model={model} />
      </div>
    </div>
  );
}

function SandboxToolbar({ model }: { model: SandboxScreenModel }) {
  const {
    activeWorkspace,
    endPhoneTest,
    liveSession,
    manifest,
    phoneTestStarting,
    publishedWorkflows,
    refreshLiveMonitor,
    refreshPublishedWorkflows,
    sandboxMode,
    selectPublishedWorkflow,
    selectedPhoneNumber,
    selectedPhoneTestRoute,
    selectedWorkflowOptionId,
    setSandboxMode,
    startMicrophoneSandbox,
    startPhoneTest,
    startTypedSandbox,
  } = model;

  return (
    <Card className="sandbox-toolbar surface-card">
      <div>
        <div className="eyebrow-copy">Sandbox</div>
        <h1 className="workflow-title">Runtime session</h1>
        <div className="panel-meta">{activeWorkspace?.name ?? "Workspace"} workspace</div>
      </div>
      <div className="sandbox-workflow-select">
        <label className="sandbox-field">
          <span className="sandbox-field-label">Published workflow</span>
          <Select value={selectedWorkflowOptionId} onChange={(event) => selectPublishedWorkflow(event.target.value)}>
            {publishedWorkflows.map((workflow) => (
              <option key={workflow.id} value={getSandboxWorkflowVersionOptionId(workflow)}>
                {workflow.graph.name}
              </option>
            ))}
          </Select>
        </label>
        <Button className="workflow-button" type="button" variant="outline" onClick={refreshPublishedWorkflows}>
          <RefreshCw size={15} />
          <span>Refresh workflows</span>
        </Button>
        <Button className="workflow-button" type="button" variant="outline" onClick={() => void refreshLiveMonitor()}>
          <RefreshCw size={15} />
          <span>Refresh live monitor</span>
        </Button>
      </div>
      <div className="sandbox-toolbar-pills">
        <StatusPill
          tone={
            liveSession.status === "active"
              ? "blue"
              : liveSession.status === "error"
                ? "red"
                : "neutral"
          }
        >
          {formatCallStatus(liveSession.status)}
        </StatusPill>
        <StatusPill
          tone={
            manifest.runtimeProfile === "premium-realtime"
              ? "red"
              : manifest.runtimeProfile === "balanced"
                ? "blue"
                : "neutral"
          }
        >
          {formatRuntimeProfile(manifest.runtimeProfile)}
        </StatusPill>
        <StatusPill tone="pink">{formatRuntimeMode(liveSession.inputMode)}</StatusPill>
        <StatusPill tone="neutral">{formatMicrophoneState(liveSession.microphoneState)}</StatusPill>
      </div>
      <div className="sandbox-mode-switch" role="tablist" aria-label="Sandbox mode">
        <Button
          className={["workflow-sandbox-source-button", sandboxMode === "published-browser" ? "workflow-sandbox-source-button-active" : ""].filter(Boolean).join(" ")}
          type="button"
          variant="ghost"
          aria-pressed={sandboxMode === "published-browser"}
          onClick={() => setSandboxMode("published-browser")}
        >
          Published test (browser)
        </Button>
        <Button
          className={["workflow-sandbox-source-button", sandboxMode === "phone-test" ? "workflow-sandbox-source-button-active" : ""].filter(Boolean).join(" ")}
          type="button"
          variant="ghost"
          aria-pressed={sandboxMode === "phone-test"}
          onClick={() => setSandboxMode("phone-test")}
        >
          Phone test (Twilio/PSTN)
        </Button>
      </div>
      {sandboxMode === "published-browser" ? (
        <div className="sandbox-toolbar-actions">
          <Button
            className="workflow-button workflow-button-primary"
            type="button"
            onClick={startMicrophoneSandbox}
            disabled={liveSession.status === "active" || liveSession.status === "connecting"}
          >
            <Mic size={15} />
            <span>{liveSession.status === "connecting" ? "Starting live session" : "Start sandbox call"}</span>
          </Button>
          <Button
            className="workflow-button"
            type="button"
            variant="outline"
            onClick={startTypedSandbox}
            disabled={liveSession.status === "active" || liveSession.status === "connecting"}
          >
            <SquareTerminal size={15} />
            <span>Use typed sandbox</span>
          </Button>
          <Button
            className={liveSession.status === "active" ? "workflow-button workflow-button-danger" : "workflow-button"}
            type="button"
            variant={liveSession.status === "active" ? "destructive" : "outline"}
            onClick={() => void liveSession.endSession()}
            disabled={liveSession.status !== "active"}
          >
            <Power size={15} />
            <span>End call</span>
          </Button>
          <Button className="workflow-button" type="button" variant="outline" onClick={() => void liveSession.resetSession()}>
            <RadioTower size={15} />
            <span>Reset sandbox</span>
          </Button>
        </div>
      ) : (
        <div className="sandbox-toolbar-actions">
          <Button
            className="workflow-button workflow-button-primary"
            type="button"
            disabled={phoneTestStarting || selectedPhoneTestRoute === null}
            onClick={() => void startPhoneTest()}
          >
            <PhoneCall size={15} />
            <span>{phoneTestStarting ? "Starting Phone test" : "Start Phone test"}</span>
          </Button>
          <Button
            className={isPhoneTestInProgress(selectedPhoneNumber) ? "workflow-button workflow-button-danger" : "workflow-button"}
            type="button"
            variant={isPhoneTestInProgress(selectedPhoneNumber) ? "destructive" : "outline"}
            disabled={phoneTestStarting || !isPhoneTestInProgress(selectedPhoneNumber)}
            onClick={() => void endPhoneTest()}
          >
            <Power size={15} />
            <span>End Phone test</span>
          </Button>
          <Button className="workflow-button" type="button" variant="outline" onClick={() => setSandboxMode("published-browser")}>
            <RadioTower size={15} />
            <span>Published browser test</span>
          </Button>
        </div>
      )}
    </Card>
  );
}

function SandboxPhoneTestPanel({ model }: { model: SandboxScreenModel }) {
  return (
    <PhoneTestSurface
      allowedCallerNumber={model.allowedCallerNumber}
      dispatch={model.selectedPhoneTestDispatch}
      expiryMinutes={model.phoneTestExpiryMinutes}
      loading={model.telephonyLoading}
      notice={model.phoneTestNotice}
      phoneNumber={model.selectedPhoneNumber}
      routes={model.phoneTestRoutes}
      selectedRoute={model.selectedPhoneTestRoute}
      telephonyError={model.telephonyError}
      onAllowedCallerNumberChange={model.setAllowedCallerNumber}
      onExpiryMinutesChange={model.setPhoneTestExpiryMinutes}
      onRouteChange={model.setSelectedPhoneNumberId}
      onStartPhoneTest={() => void model.startPhoneTest()}
    />
  );
}

function SandboxBrowserSurface({ model }: { model: SandboxScreenModel }) {
  const {
    draftUtterance,
    intent,
    liveSession,
    phase,
    sendTurn,
    setDraftUtterance,
    setIntent,
    setPhase,
  } = model;

  return (
    <Card className="surface-card sandbox-live-surface">
      <div className="section-header">
        <div>
          <div className="eyebrow-copy">Call surface</div>
          <div className="subhead-copy mt-1">Transcript and event stream</div>
        </div>
        <div className="sandbox-inline-metrics">
          <InlineMetric
            icon={Clock3}
            label="Latency"
            value={
              liveSession.metrics.lastCallLatencyMs !== undefined
                ? `${liveSession.metrics.lastCallLatencyMs ?? liveSession.metrics.lastFirstByteLatencyMs}ms`
                : "--"
            }
          />
          <InlineMetric icon={Mic} label="Turns" value={String(liveSession.metrics.turnCount)} />
        </div>
      </div>

      <div className="sandbox-controls subtle-panel">
        <div className="workflow-muted-panel">
          <div className="workflow-validation-code">Live transport</div>
          <div>AssemblyAI streaming STT, model routing on the Nest control plane, and Cartesia Sonic 3.5 voice playback.</div>
          <div className="panel-meta">{liveSession.note}</div>
        </div>

        <div className="sandbox-control-row">
          <label className="sandbox-field">
            <span className="sandbox-field-label">Intent</span>
            <Select value={intent} onChange={(event) => setIntent(event.target.value as IntentOption)}>
              <option value="support">Support</option>
              <option value="billing">Billing</option>
            </Select>
          </label>
          <label className="sandbox-field">
            <span className="sandbox-field-label">Phase</span>
            <Select value={phase} onChange={(event) => setPhase(event.target.value as RuntimeCallPhase)}>
              <option value="greeting">Greeting</option>
              <option value="discovery">Discovery</option>
              <option value="tool-use">Tool use</option>
              <option value="resolution">Resolution</option>
              <option value="escalation">Escalation</option>
            </Select>
          </label>
        </div>

        {liveSession.inputMode === "voice" ? (
          <div className="sandbox-voice-capture-row">
            <div className="panel-meta">Voice mode streams the microphone continuously and runs the workflow when caller speech reaches a natural endpoint.</div>
            {liveSession.voiceTurnCapturing ? <VoiceCaptureMeter /> : null}
            <Button className="workflow-button workflow-button-primary" type="button" disabled>
              <Mic size={15} />
              <span>{liveSession.voiceTurnCapturing ? "Listening" : "Voice idle"}</span>
            </Button>
          </div>
        ) : (
          <>
            <label className="sandbox-composer">
              <span className="sandbox-field-label">Caller turn</span>
              <Textarea
                rows={4}
                value={draftUtterance}
                onChange={(event) => setDraftUtterance(event.target.value)}
                placeholder="Describe what the caller says in the sandbox."
              />
            </label>

            <div className="sandbox-composer-actions">
              <div className="panel-meta">{liveSession.note}</div>
              <Button
                className="workflow-button workflow-button-primary"
                type="button"
                onClick={sendTurn}
                disabled={liveSession.status !== "active" || draftUtterance.trim().length === 0}
              >
                <SendHorizontal size={15} />
                <span>Send caller turn</span>
              </Button>
            </div>
          </>
        )}
        {liveSession.agentPlaybackActive ? <AgentPlaybackMeter /> : null}
      </div>

      <div className="sandbox-live-columns">
        <div className="sandbox-pane">
          <div className="sandbox-pane-header">
            <div className="workflow-panel-title">Transcript</div>
            <div className="panel-meta">{liveSession.transcript.length} entries</div>
          </div>
          <div className="sandbox-transcript-list" aria-live="polite">
            {liveSession.transcript.length === 0 ? (
              <EmptyPanelCopy text="Start a live sandbox call to record transcript turns." />
            ) : null}
            {liveSession.transcript.map((entry) => (
              <article key={entry.id} className={`sandbox-transcript-item sandbox-transcript-item-${entry.speaker}`}>
                <div className="sandbox-transcript-meta">
                  <span>{formatSpeaker(entry.speaker)}</span>
                  <span>{formatTime(entry.at)}</span>
                </div>
                <p>{entry.text}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="sandbox-pane">
          <div className="sandbox-pane-header">
            <div className="workflow-panel-title">Event stream</div>
            <div className="panel-meta">{liveSession.events.length} events</div>
          </div>
          <div className="sandbox-event-list">
            {liveSession.events.length === 0 ? (
              <EmptyPanelCopy text="Runtime and tool events will appear here as the live sandbox runs." />
            ) : null}
            {liveSession.events.map((event) => {
              const summary = summarizeLiveSandboxEvent(event);

              return (
                <div key={`${event.sessionId}:${event.sequence}`} className="sandbox-event-row">
                  <div>
                    <div className="panel-title">{summary.title}</div>
                    {summary.detail !== undefined ? <div className="panel-meta">{summary.detail}</div> : null}
                    <div className="panel-meta">#{event.sequence} - {formatTime(event.at)}</div>
                  </div>
                  <StatusPill tone={summary.tone}>{summary.label}</StatusPill>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}

function SandboxSideColumn({ model }: { model: SandboxScreenModel }) {
  const {
    acceptEscalation,
    availableTools,
    budgetRemainingUsd,
    declineEscalation,
    escalations,
    escalationsError,
    escalationsLoading,
    inspectMonitorSession,
    inspectedMonitorEvents,
    inspectedMonitorLoading,
    inspectedMonitorSession,
    inspectedMonitorTranscript,
    lastEvent,
    liveSession,
    manifest,
    monitorError,
    monitorLoading,
    monitorSessions,
    refreshEscalationQueue,
    selectedPublishedWorkflow,
  } = model;

  return (
    <aside className="sandbox-side-column">
      <Card className="surface-card sandbox-side-card">
        <div className="sandbox-side-header">
          <div>
            <div className="eyebrow-copy">Escalations</div>
            <div className="workflow-panel-title">Escalation queue</div>
          </div>
          <StatusPill tone={escalations.some((escalation) => escalation.status === "pending") ? "red" : "neutral"}>
            {`${escalations.filter((escalation) => escalation.status === "pending").length} pending`}
          </StatusPill>
        </div>
        <div className="sandbox-side-stack">
          <Button className="workflow-button" type="button" variant="outline" onClick={() => void refreshEscalationQueue()}>
            <Headphones size={15} />
            <span>Refresh escalation queue</span>
          </Button>
          {escalationsError !== null ? <div className="panel-meta">{escalationsError}</div> : null}
          {escalationsLoading ? <div className="panel-meta">Refreshing escalation queue{"\u2026"}</div> : null}
          {!escalationsLoading && escalations.length === 0 ? (
            <EmptyPanelCopy text="Escalations from live sandbox calls will appear here with SLA timing and operator actions." />
          ) : null}
          {escalations.map((escalation) => (
            <div key={escalation.escalationId} className="subtle-panel sandbox-monitor-item">
              <div className="sandbox-monitor-row">
                <div>
                  <div className="panel-title">{escalation.queueName ?? escalation.queueId ?? "Human queue"}</div>
                  <div className="panel-meta">{escalation.reason}</div>
                </div>
                <StatusPill tone={getEscalationStatusTone(escalation.status)}>
                  {formatEscalationStatus(escalation)}
                </StatusPill>
              </div>
              <div className="sandbox-monitor-row">
                <div className="panel-meta">{`Due ${formatTime(escalation.slaDeadlineAt)}`}</div>
                {escalation.status === "pending" ? (
                  <div className="sandbox-composer-actions">
                    <Button className="workflow-button workflow-button-primary" type="button" onClick={() => void acceptEscalation(escalation.escalationId)}>
                      <span>{`Accept escalation ${escalation.escalationId}`}</span>
                    </Button>
                    <Button className="workflow-button" type="button" variant="outline" onClick={() => void declineEscalation(escalation.escalationId)}>
                      <span>{`Decline escalation ${escalation.escalationId}`}</span>
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="surface-card sandbox-side-card">
        <div className="sandbox-side-header">
          <div>
            <div className="eyebrow-copy">Monitor</div>
            <div className="workflow-panel-title">Active sandbox calls</div>
          </div>
          <StatusPill tone={monitorSessions.some((sessionSummary) => sessionSummary.status === "active") ? "blue" : "neutral"}>
            {`${monitorSessions.filter((sessionSummary) => sessionSummary.status === "active").length} live`}
          </StatusPill>
        </div>
        <div className="sandbox-monitor-list">
          {monitorError !== null ? <div className="panel-meta">{monitorError}</div> : null}
          {monitorLoading ? <div className="panel-meta">Refreshing live sandbox monitor{"\u2026"}</div> : null}
          {!monitorLoading && monitorSessions.length === 0 ? (
            <EmptyPanelCopy text="Refresh the live monitor to inspect active and completed sandbox sessions." />
          ) : null}
          {monitorSessions.map((sessionSummary) => (
            <div key={sessionSummary.sessionId} className="subtle-panel sandbox-monitor-item">
              <div className="sandbox-monitor-row">
                <div>
                  <div className="panel-title">{sessionSummary.activeRoleName}</div>
                  <div className="panel-meta">{formatSandboxRuntimeTier(sessionSummary.runtimeTier)}</div>
                </div>
                <StatusPill tone={sessionSummary.status === "active" ? "blue" : "neutral"}>
                  {formatSandboxMonitorStatus(sessionSummary.status)}
                </StatusPill>
              </div>
              <div className="sandbox-monitor-row">
                <div className="panel-meta">
                  {sessionSummary.eventCount} events - {sessionSummary.turnCount} turns
                </div>
                <Button className="workflow-button" type="button" variant="outline" onClick={() => void inspectMonitorSession(sessionSummary.sessionId)}>
                  <span>{`Inspect ${sessionSummary.sessionId}`}</span>
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="surface-card sandbox-side-card">
        <div className="sandbox-side-header">
          <div>
            <div className="eyebrow-copy">Replay</div>
            <div className="workflow-panel-title">Redacted timeline</div>
          </div>
          <StatusPill tone={inspectedMonitorSession?.status === "active" ? "blue" : "neutral"}>
            {inspectedMonitorSession === null ? "Idle" : formatSandboxMonitorStatus(inspectedMonitorSession.status)}
          </StatusPill>
        </div>
        <div className="sandbox-side-stack">
          {inspectedMonitorLoading ? <div className="panel-meta">Loading sandbox replay timeline{"\u2026"}</div> : null}
          {!inspectedMonitorLoading && inspectedMonitorTranscript.length === 0 ? (
            <EmptyPanelCopy text="Inspect a live sandbox session to replay the transcript and tool timeline." />
          ) : null}
          {inspectedMonitorTranscript.length > 0 ? (
            <div className="sandbox-monitor-list">
              {inspectedMonitorTranscript.map((entry) => (
                <article key={entry.id} className={`sandbox-transcript-item sandbox-transcript-item-${entry.speaker}`}>
                  <div className="sandbox-transcript-meta">
                    <span>{formatSpeaker(entry.speaker)}</span>
                    <span>{formatTime(entry.at)}</span>
                  </div>
                  <p>{entry.text}</p>
                </article>
              ))}
            </div>
          ) : null}
          {inspectedMonitorEvents.length > 0 ? (
            <div className="sandbox-event-list">
              {inspectedMonitorEvents.map((event) => {
                const summary = summarizeLiveSandboxEvent(event);

                return (
                  <div key={`${event.sessionId}:${event.sequence}`} className="sandbox-event-row">
                    <div>
                      <div className="panel-title">{summary.title}</div>
                      {summary.detail !== undefined ? <div className="panel-meta">{summary.detail}</div> : null}
                    </div>
                    <StatusPill tone={summary.tone}>{summary.label}</StatusPill>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </Card>

      <Card className="surface-card sandbox-side-card">
        <div className="sandbox-side-header">
          <div>
            <div className="eyebrow-copy">Runtime decision</div>
            <div className="workflow-panel-title">Current routing</div>
          </div>
          <StatusPill tone={liveSession.lastRoutingDecision?.tier === "standard" ? "blue" : liveSession.lastRoutingDecision?.tier === "sota" ? "red" : "neutral"}>
            {liveSession.lastRoutingDecision?.tier ?? manifest.roles[0]?.defaultModelTier ?? "cheap"}
          </StatusPill>
        </div>
        <div className="sandbox-side-stack">
          <MetricPair label="Source" value={liveSession.lastRoutingDecision?.source ?? "waiting"} />
          <MetricPair label="Rule" value={liveSession.lastRoutingDecision?.matchedRuleId ?? "default"} />
          <div className="body-copy">{liveSession.lastRoutingDecision?.reason ?? "Start a live turn to inspect the selected routing path."}</div>
        </div>
      </Card>

      <Card className="surface-card sandbox-side-card">
        <div className="sandbox-side-header">
          <div>
            <div className="eyebrow-copy">Live cost</div>
            <div className="workflow-panel-title">Budget posture</div>
          </div>
          <div className="metric-value">${budgetRemainingUsd.toFixed(0)}</div>
        </div>
        <div className="sandbox-side-stack">
          <MetricPair label="Budget remaining" value={`$${budgetRemainingUsd.toFixed(2)}`} />
          <MetricPair label="Projected per minute" value={`$${manifest.budget.projectedCostPerMinuteUsd.toFixed(2)}`} />
          <MetricPair label="Runtime profile" value={formatRuntimeProfile(manifest.runtimeProfile)} />
          <div className="body-copy">The control plane is running the live browser sandbox on the current published budget policy for this workflow.</div>
        </div>
      </Card>

      <Card className="surface-card sandbox-side-card">
        <div className="sandbox-side-header">
          <div>
            <div className="eyebrow-copy">Available tools</div>
            <div className="workflow-panel-title">Tool execution</div>
          </div>
          <Wrench size={16} />
        </div>
        <div className="sandbox-tool-list">
          {availableTools.map((tool) => (
            <div key={tool.nodeId} className="subtle-panel sandbox-tool-item">
              <div>
                <div className="panel-title">{tool.label}</div>
                <div className="panel-meta">{tool.toolName}</div>
              </div>
              <StatusPill tone={tool.requiresHumanApproval ? "pink" : "neutral"}>
                {tool.requiresHumanApproval ? "Approval" : "Ready"}
              </StatusPill>
            </div>
          ))}
        </div>
      </Card>

      <Card className="surface-card sandbox-side-card">
        <div className="sandbox-side-header">
          <div>
            <div className="eyebrow-copy">Session metrics</div>
            <div className="workflow-panel-title">Operational view</div>
          </div>
          <SquareTerminal size={16} />
        </div>
        <div className="sandbox-stat-grid">
          <MetricCard label="Turn count" value={String(liveSession.metrics.turnCount)} detail="conversation turns" />
          <MetricCard label="Events" value={String(liveSession.metrics.eventCount)} detail="transport updates" />
          <MetricCard label="Input mode" value={liveSession.inputMode === "voice" ? "Voice" : "Typed"} detail="active caller channel" />
          <MetricCard
            label="Latency"
            value={liveSession.metrics.lastCallLatencyMs !== undefined ? `${liveSession.metrics.lastCallLatencyMs}ms` : "--"}
            detail="caller turn to first audio"
          />
        </div>
      </Card>

      <Card className="surface-card sandbox-side-card">
        <div className="sandbox-side-header">
          <div>
            <div className="eyebrow-copy">Manifest</div>
            <div className="workflow-panel-title">Published runtime</div>
          </div>
          <WalletCards size={16} />
        </div>
        <div className="sandbox-manifest-list">
          <MetricPair label="Manifest" value={manifest.manifestId.split(":runtime:")[0] ?? manifest.manifestId} />
          <MetricPair label="Workflow" value={selectedPublishedWorkflow.graph.name} />
          <MetricPair label="Runtime" value={formatRuntime(manifest.runtime)} />
          <MetricPair label="Entry role" value={manifest.roles.find((role) => role.id === manifest.entryRoleId)?.name ?? "Unknown"} />
          <MetricPair label="Providers" value={`${manifest.runtimeProfile === "premium-realtime" ? "OpenAI routing" : "Cost-first routing"} / ${liveSession.session?.providerStack.stt ?? "AssemblyAI"} / ${liveSession.session?.providerStack.tts ?? "Cartesia"}`} />
          <MetricPair label="Last event" value={lastEvent?.type ?? "Waiting"} />
        </div>
      </Card>
    </aside>
  );
}
function PhoneTestSurface({
  allowedCallerNumber,
  dispatch,
  expiryMinutes,
  loading,
  notice,
  phoneNumber,
  routes,
  selectedRoute,
  telephonyError,
  onAllowedCallerNumberChange,
  onExpiryMinutesChange,
  onRouteChange,
  onStartPhoneTest,
}: {
  allowedCallerNumber: string;
  dispatch: TelephonyDispatchRecord | null;
  expiryMinutes: string;
  loading: boolean;
  notice: string | null;
  phoneNumber: ImportedTelephonyPhoneNumber | null;
  routes: SandboxPhoneTestRoute[];
  selectedRoute: SandboxPhoneTestRoute | null;
  telephonyError: string | null;
  onAllowedCallerNumberChange: (value: string) => void;
  onExpiryMinutesChange: (value: string) => void;
  onRouteChange: (value: string) => void;
  onStartPhoneTest: () => void;
}) {
  const waitingSession = phoneNumber?.testRoute?.waitingSession ?? null;
  const latestResult = phoneNumber?.phoneTestResults?.[0] ?? null;
  const checklist = waitingSession?.checklist ?? latestResult?.checklist ?? createEmptyPhoneTestChecklist();
  const completedCheckpoints = countCompletedPhoneTestCheckpoints(checklist);
  const runtimePathLabel =
    selectedRoute === null
      ? "Twilio/PSTN protected route"
      : formatPhoneTestRuntimePath(selectedRoute.liveRoute.runtimeProfile);
  const statusLabel =
    notice
    ?? (latestResult === null
      ? waitingSession === null
        ? "Ready to start"
        : formatPhoneTestWaitingStatus(waitingSession.status)
      : formatPhoneTestResultStatus(latestResult.status));

  return (
    <Card className="surface-card sandbox-live-surface phone-test-surface">
      <div className="section-header">
        <div>
          <div className="eyebrow-copy">Phone test</div>
          <div className="subhead-copy mt-1">{runtimePathLabel}</div>
        </div>
        <StatusPill tone={isPhoneTestInProgress(phoneNumber) ? "blue" : latestResult?.status === "failed" ? "red" : "neutral"}>
          {statusLabel}
        </StatusPill>
      </div>

      <div className="sandbox-controls subtle-panel">
        <div className="sandbox-control-row">
          <label className="sandbox-field">
            <span className="sandbox-field-label">Routed phone number</span>
            <Select
              value={selectedRoute?.phoneNumber.id ?? ""}
              disabled={routes.length === 0}
              onChange={(event) => onRouteChange(event.target.value)}
            >
              {routes.length === 0 ? <option value="">No routed numbers</option> : null}
              {routes.map((route) => (
                <option key={route.phoneNumber.id} value={route.phoneNumber.id}>
                  {route.phoneNumber.phoneNumber} - {route.liveRoute.workflowLabel}
                </option>
              ))}
            </Select>
          </label>
          <label className="sandbox-field">
            <span className="sandbox-field-label">Allowed caller number</span>
            <Input value={allowedCallerNumber} onChange={(event) => onAllowedCallerNumberChange(event.target.value)} />
          </label>
          <label className="sandbox-field">
            <span className="sandbox-field-label">Waiting window</span>
            <Select value={expiryMinutes} onChange={(event) => onExpiryMinutesChange(event.target.value)}>
              <option value="10">10 minutes</option>
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
            </Select>
          </label>
        </div>

        <div className="sandbox-composer-actions">
          <div className="panel-meta">
            {loading
              ? "Refreshing phone routes."
              : telephonyError !== null
                ? telephonyError
                : selectedRoute === null
                ? "Route a published workflow to a number before starting a Phone test."
                : `${selectedRoute.connection.label} will answer only the allowed caller while the waiting session is active. ${formatPhoneTestRuntimePath(selectedRoute.liveRoute.runtimeProfile)}.`}
          </div>
          <Button
            className="workflow-button workflow-button-primary"
            type="button"
            disabled={selectedRoute === null}
            onClick={onStartPhoneTest}
          >
            <PhoneCall size={15} />
            <span>Start waiting session</span>
          </Button>
        </div>
      </div>

      <div className="sandbox-live-columns">
        <div className="sandbox-pane">
          <div className="sandbox-pane-header">
            <div className="workflow-panel-title">Waiting session</div>
            <div className="panel-meta">{waitingSession === null ? "Not started" : waitingSession.id}</div>
          </div>
          <div className="workflow-sandbox-route-grid">
            <MetricPair label="State" value={statusLabel} />
            <MetricPair label="Allowed callers" value={formatAllowedCallers(waitingSession, allowedCallerNumber)} />
            <MetricPair label="Expires" value={waitingSession === null ? "Not set" : formatTime(waitingSession.expiresAt)} />
            <MetricPair label="Runtime path" value={formatPhoneTestRuntimePath(phoneNumber?.testRoute?.runtimeProfile ?? selectedRoute?.liveRoute.runtimeProfile ?? "cost-optimized")} />
            <MetricPair label="Active PSTN session" value={dispatch?.callSessionId ?? "Waiting"} />
            <MetricPair label="Latency" value="Pending first audio" />
            <MetricPair label="Call quality" value={latestResult?.status === "passed" ? "Passed" : "Pending media"} />
          </div>
        </div>

        <div className="sandbox-pane">
          <div className="sandbox-pane-header">
            <div className="workflow-panel-title">Checklist</div>
            <div className="panel-meta">{completedCheckpoints} of {phoneTestChecklistEntries.length} checkpoints</div>
          </div>
          <div className="sandbox-event-list">
            {phoneTestChecklistEntries.map((entry) => (
              <div key={entry.key} className="sandbox-event-row">
                <div>
                  <div className="panel-title">{entry.label}</div>
                  <div className="panel-meta">{entry.detail}</div>
                </div>
                <StatusPill tone={checklist[entry.key] ? "blue" : "neutral"}>
                  {checklist[entry.key] ? "Done" : "Pending"}
                </StatusPill>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="sandbox-live-columns">
        <div className="sandbox-pane">
          <div className="sandbox-pane-header">
            <div className="workflow-panel-title">Transcript and events</div>
            <div className="panel-meta">{dispatch === null ? "No active call" : dispatch.routeMode ?? "live_route"}</div>
          </div>
          <div className="sandbox-event-list">
            {dispatch === null ? <EmptyPanelCopy text="PSTN transcript and route events appear after the allowed caller connects." /> : null}
            {dispatch !== null ? (
              <div className="sandbox-event-row">
                <div>
                  <div className="panel-title">{dispatch.reason}</div>
                  <div className="panel-meta">{dispatch.callSessionId ?? "Call session pending"}</div>
                </div>
                <StatusPill tone={dispatch.disposition === "routed" ? "blue" : "neutral"}>{dispatch.disposition}</StatusPill>
              </div>
            ) : null}
          </div>
        </div>

        <div className="sandbox-pane">
          <div className="sandbox-pane-header">
            <div className="workflow-panel-title">Final result</div>
            <div className="panel-meta">{latestResult === null ? "Awaiting result" : latestResult.completedAt}</div>
          </div>
          {latestResult === null ? (
            <EmptyPanelCopy text="A stored pass or fail result appears here when the phone test ends." />
          ) : (
            <div className="workflow-sandbox-route-grid">
              <MetricPair label="Result" value={formatPhoneTestResultStatus(latestResult.status)} />
              <MetricPair label="Reason" value={latestResult.reason} />
              <MetricPair label="Runtime" value={formatRuntimeProfile(latestResult.runtimeProfile)} />
              <MetricPair label="Version" value={latestResult.publishedVersionId} />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function createDefaultSandboxPublishedWorkflow(workspaceId: string) {
  const entryNode = {
    id: "entry",
    kind: "entry",
    label: "Inbound call",
    position: { x: 0, y: 0 },
    config: {},
  } as const;

  const frontDeskAgent = createAgentRoleNode({
    id: "agent-front-desk",
    label: "Front desk triage",
    position: { x: 140, y: 60 },
    role: {
      kind: "receptionist",
      name: "Front desk triage",
      businessName: "Tuzzy Labs",
      instructions: "Greet callers, gather context, and resolve or route safely.",
      defaultModelTier: "cheap",
      languagePolicy: {
        defaultLanguage: "en",
        supportedLanguages: ["en", "fr"],
        allowMidCallSwitching: true,
      },
      reusableSpecialist: true,
    },
  });

  const billingAgent = createAgentRoleNode({
    id: "agent-billing",
    label: "Billing specialist",
    position: { x: 760, y: 180 },
    role: {
      kind: "billing",
      name: "Billing specialist",
      businessName: "Tuzzy Labs",
      instructions: "Handle payment issues, refunds, and subscription disputes.",
      defaultModelTier: "standard",
      languagePolicy: {
        defaultLanguage: "en",
        supportedLanguages: ["en"],
        allowMidCallSwitching: false,
      },
      reusableSpecialist: true,
    },
  });

  const billingHandoff = createHandoffNode({
    id: "handoff-billing",
    label: "Billing handoff",
    position: { x: 620, y: 180 },
    handoff: {
      targetRoleId: "agent-billing",
      targetRoleName: "Billing specialist",
      handoffReason: "Move invoice and refund conversations to the billing specialist lane.",
    },
  });

  const resolvedExit = createEndNode({
    id: "end-resolved",
    label: "Resolved exit",
    position: { x: 760, y: 360 },
    end: {
      outcome: "resolved",
      closingMessage: "Thank the caller and close the conversation.",
    },
  });

  const conditionNode = createConditionNode({
    id: "condition-intent",
    label: "Intent route",
    position: { x: 460, y: 220 },
    condition: {
      branches: [
        {
          id: "branch-billing",
          label: "Billing",
          expression: 'intent == "billing"',
          targetNodeId: "handoff-billing",
        },
      ],
      fallbackLabel: "Resolved",
      fallbackTargetNodeId: "end-resolved",
    },
  });

  const apiTool = createToolNode({
    id: "tool-customer-profile",
    label: "Customer profile API",
    position: { x: 420, y: 40 },
    toolId: "hubspot.profile.lookup",
    tool: {
      connector: "webhook",
      toolName: "Customer profile lookup",
      integrationConnectionId: "hubspot-prod",
      integrationLabel: "HubSpot - Production",
      connectionStatus: "connected",
      risk: "high",
      requiresAuthorization: true,
      requiresHumanApproval: false,
      request: {
        method: "POST",
        url: "https://api.example.test/customers/lookup",
        authToken: "secret://hubspot/token",
        headers: [
          { name: "content-type", value: "application/json" },
          { name: "x-tenant-id", value: "{{tenant.id}}" },
        ],
        bodyTemplate: "{\"phone\":\"{{caller.phone}}\"}",
      },
    },
  });

  const graph = createWorkflowGraph({
    id: "workflow-sandbox-session",
    name: "Sandbox session",
    nodes: [entryNode, frontDeskAgent, apiTool, conditionNode, billingHandoff, billingAgent, resolvedExit],
    edges: [
      {
        id: "edge-entry-front-desk",
        sourceNodeId: "entry",
        targetNodeId: "agent-front-desk",
      },
      {
        id: "edge-front-desk-tool",
        sourceNodeId: "agent-front-desk",
        targetNodeId: "tool-customer-profile",
      },
      {
        id: "edge-front-desk-condition",
        sourceNodeId: "agent-front-desk",
        targetNodeId: "condition-intent",
      },
      {
        id: "edge-condition-billing",
        sourceNodeId: "condition-intent",
        targetNodeId: "handoff-billing",
        condition: "Billing",
      },
      {
        id: "edge-condition-resolved",
        sourceNodeId: "condition-intent",
        targetNodeId: "end-resolved",
        condition: "Resolved",
      },
      {
        id: "edge-handoff-billing",
        sourceNodeId: "handoff-billing",
        targetNodeId: "agent-billing",
      },
    ],
  });

  return publishWorkflowVersion({
    workflowId: graph.id,
    tenantId,
    workspaceId,
    environment: "sandbox",
    createdBy: "ops-lead",
    graph,
    existingVersions: [],
    runtime: "sandwich-pipeline",
    runtimeProfile: "cost-optimized",
    telephonyProvider: "browser-webrtc",
    memory: {
      mode: "scoped",
      retrievalScopes: ["session", "caller"],
      approvalRequired: true,
    },
    budget: {
      monthlyCapUsd: 80,
      currentSpendUsd: 18,
      projectedCostPerMinuteUsd: 0.22,
      blockOnLimit: true,
    },
  });
}

function mergePublishedWorkflows(
  defaultWorkflow: ReturnType<typeof createDefaultSandboxPublishedWorkflow>,
  storedWorkflows: ReturnType<typeof loadPublishedWorkflowVersionsForWorkspace>,
) {
  const versionsByOptionId = new Map<string, ReturnType<typeof createDefaultSandboxPublishedWorkflow>>();

  versionsByOptionId.set(getSandboxWorkflowVersionOptionId(defaultWorkflow), defaultWorkflow);

  for (const workflow of storedWorkflows) {
    versionsByOptionId.set(getSandboxWorkflowVersionOptionId(workflow), workflow);
  }

  return sortSandboxWorkflowVersions(Array.from(versionsByOptionId.values()));
}

function sortSandboxWorkflowVersions(workflows: PublishedWorkflowVersion[]) {
  const sortedWorkflows: PublishedWorkflowVersion[] = [];

  for (const workflow of workflows) {
    insertByComparison(sortedWorkflows, workflow, compareSandboxWorkflowVersions);
  }

  return sortedWorkflows;
}

function compareSandboxWorkflowVersions(left: PublishedWorkflowVersion, right: PublishedWorkflowVersion) {
  const nameOrder = left.graph.name.localeCompare(right.graph.name);

  return nameOrder !== 0 ? nameOrder : right.version - left.version;
}

function InlineMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock3;
  label: string;
  value: string;
}) {
  return (
    <div className="sandbox-inline-metric">
      <Icon size={14} />
      <div>
        <div className="panel-meta">{label}</div>
        <div className="panel-title">{value}</div>
      </div>
    </div>
  );
}

function MetricPair({ label, value }: { label: string; value: string }) {
  return (
    <div className="sandbox-cost-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-detail">{detail}</div>
    </div>
  );
}

function StatusPill({ tone, children }: { tone: "neutral" | "blue" | "pink" | "red"; children: ReactNode }) {
  return <span className={`status-pill status-pill-${tone}`}>{children}</span>;
}

function EmptyPanelCopy({ text }: { text: string }) {
  return <div className="sandbox-empty-copy">{text}</div>;
}

function VoiceCaptureMeter() {
  return (
    <output className="sandbox-voice-meter" aria-label="Voice capture active">
      <span className="sandbox-voice-dot" />
      <span className="sandbox-voice-bars" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </span>
      <span>Listening for caller speech</span>
    </output>
  );
}

function AgentPlaybackMeter() {
  return (
    <output className="sandbox-playback-meter" aria-label="Agent playback active">
      <span className="sandbox-playback-ring">
        <Headphones size={14} />
      </span>
      <span className="sandbox-playback-bars" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </span>
      <span>Playing agent response</span>
    </output>
  );
}

function formatCallStatus(status: string) {
  switch (status) {
    case "active":
      return "Call live";
    case "connecting":
      return "Connecting";
    case "error":
      return "Attention";
    case "ended":
      return "Completed";
    default:
      return "Idle";
  }
}

function formatRuntimeMode(mode: string) {
  return mode === "voice" ? "Voice mode" : "Typed mode";
}

const phoneTestChecklistEntries: Array<{
  key: keyof TelephonyPhoneTestChecklist;
  label: string;
  detail: string;
}> = [
  { key: "verifiedWebhook", label: "Verified webhook", detail: "Twilio request passed signature checks." },
  { key: "allowedCallerMatched", label: "Allowed caller matched", detail: "The inbound caller matched the allow list." },
  { key: "mediaWebSocketConnected", label: "Media socket connected", detail: "The provider media stream reached Zara." },
  { key: "inboundFrameReceived", label: "Inbound frame received", detail: "PSTN audio entered the runtime." },
  { key: "transcriptCreated", label: "Transcript created", detail: "Telephony STT produced turn text." },
  { key: "agentResponseGenerated", label: "Agent response generated", detail: "The published workflow generated a reply." },
  { key: "outboundAudioSent", label: "Outbound audio sent", detail: "PSTN-ready audio was sent back to the bridge." },
  { key: "cleanEnd", label: "Clean end", detail: "The test call ended without unsafe closure." },
  { key: "noFatalError", label: "No fatal error", detail: "No fatal provider or runtime error was recorded." },
];

function buildSandboxPhoneTestRoutes(input: {
  state: TelephonyStateResponse | null;
  workspaceId: string;
}): SandboxPhoneTestRoute[] {
  if (input.state === null) {
    return [];
  }

  const connectionsById = new Map(
    input.state.connections.map((connection) => [connection.id, connection] as const),
  );

  return input.state.phoneNumbers
    .flatMap((phoneNumber) => {
      const liveRoute = phoneNumber.liveRoute;
      const connection = connectionsById.get(phoneNumber.connectionId);

      if (
        liveRoute === undefined ||
        liveRoute.workspaceId !== input.workspaceId ||
        connection === undefined
      ) {
        return [];
      }

      return [{ phoneNumber, liveRoute, connection }];
    })
    .reduce<SandboxPhoneTestRoute[]>((sortedRoutes, route) => {
      insertByComparison(
        sortedRoutes,
        route,
        (left, right) => left.phoneNumber.friendlyName.localeCompare(right.phoneNumber.friendlyName),
      );

      return sortedRoutes;
    }, []);
}

function insertByComparison<T>(items: T[], item: T, compare: (left: T, right: T) => number) {
  const insertionIndex = items.findIndex((candidate) => compare(item, candidate) < 0);

  if (insertionIndex === -1) {
    items.push(item);
    return;
  }

  items.splice(insertionIndex, 0, item);
}

function findPhoneTestDispatch(
  state: TelephonyStateResponse | null,
  phoneNumber: ImportedTelephonyPhoneNumber | null,
): TelephonyDispatchRecord | null {
  const sessionId = phoneNumber?.testRoute?.waitingSession.id;

  if (state === null || sessionId === undefined) {
    return null;
  }

  return state.dispatches.find((dispatch) => dispatch.testRouteSessionId === sessionId) ?? null;
}

function toPhoneTestRuntimeProfile(runtimeProfile: string): PhoneTestRuntimeProfile | null {
  return runtimeProfile === "balanced" || runtimeProfile === "cost-optimized" || runtimeProfile === "premium-realtime"
    ? runtimeProfile
    : null;
}

function parseAllowedCallerNumbers(value: string) {
  return value
    .split(/[\s,]+/)
    .map((phoneNumber) => phoneNumber.trim())
    .filter((phoneNumber) => phoneNumber.length > 0);
}

function createEmptyPhoneTestChecklist(): TelephonyPhoneTestChecklist {
  return {
    verifiedWebhook: false,
    allowedCallerMatched: false,
    mediaWebSocketConnected: false,
    inboundFrameReceived: false,
    transcriptCreated: false,
    agentResponseGenerated: false,
    outboundAudioSent: false,
    cleanEnd: false,
    noFatalError: false,
  };
}

function countCompletedPhoneTestCheckpoints(checklist: TelephonyPhoneTestChecklist) {
  return phoneTestChecklistEntries.filter((entry) => checklist[entry.key]).length;
}

function isPhoneTestInProgress(phoneNumber: ImportedTelephonyPhoneNumber | null) {
  const status = phoneNumber?.testRoute?.waitingSession.status;

  return status === "waiting" || status === "active";
}

function formatAllowedCallers(
  waitingSession: TelephonyTestWaitingSession | null,
  draftAllowedCallerNumber: string,
) {
  const callers = waitingSession?.allowedCallerNumbers ?? parseAllowedCallerNumbers(draftAllowedCallerNumber);

  return callers.length === 0 ? "None" : callers.join(", ");
}

function formatPhoneTestWaitingStatus(status: TelephonyTestWaitingSession["status"]) {
  switch (status) {
    case "waiting":
      return "Waiting for allowed caller";
    case "active":
      return "Active PSTN call";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "expired":
      return "Expired";
    case "manually_ended":
      return "Manually ended";
  }
}

function formatPhoneTestResultStatus(status: NonNullable<ImportedTelephonyPhoneNumber["phoneTestResults"]>[number]["status"]) {
  switch (status) {
    case "passed":
      return "Passed";
    case "failed":
      return "Failed";
    case "expired":
      return "Expired";
    case "unauthorized_caller":
      return "Unauthorized caller";
    case "manually_ended":
      return "Manually ended";
  }
}

function formatMicrophoneState(state: string) {
  switch (state) {
    case "granted":
      return "Mic granted";
    case "denied":
      return "Mic denied";
    case "requesting":
      return "Mic request";
    case "unsupported":
      return "Mic unavailable";
    default:
      return "Mic optional";
  }
}

function formatSpeaker(speaker: "caller" | "agent" | "system") {
  switch (speaker) {
    case "caller":
      return "Caller";
    case "agent":
      return "Agent";
    default:
      return "System";
  }
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}

function formatRuntime(runtime: string) {
  if (runtime === "sandwich-pipeline") {
    return "Cost optimized";
  }

  return runtime;
}

function formatRuntimeProfile(profile: string) {
  switch (profile) {
    case "balanced":
      return "Balanced profile";
    case "premium-realtime":
      return "Premium realtime";
    default:
      return "Cost optimized";
  }
}

function formatPhoneTestRuntimePath(profile: string) {
  return profile === "premium-realtime"
    ? "Premium realtime PSTN (native provider)"
    : "Phone test sandwich mode";
}

function formatSandboxRuntimeTier(tier: string) {
  switch (tier) {
    case "standard":
      return "Standard tier";
    case "sota":
      return "SOTA tier";
    case "rules":
      return "Rules tier";
    default:
      return "Cheap tier";
  }
}

function formatSandboxMonitorStatus(status: string) {
  switch (status) {
    case "active":
      return "Active";
    case "ended":
      return "Ended";
    case "expired":
      return "Expired";
    default:
      return "Ready";
  }
}

function replaceEscalation(
  escalations: LiveSandboxEscalation[],
  nextEscalation: LiveSandboxEscalation,
) {
  return escalations.map((escalation) =>
    escalation.escalationId === nextEscalation.escalationId ? nextEscalation : escalation,
  );
}

function formatEscalationStatus(escalation: LiveSandboxEscalation) {
  switch (escalation.status) {
    case "accepted":
      return `Accepted by ${escalation.acceptedByUserId ?? "operator"}`;
    case "declined":
      return `Declined by ${escalation.declinedByUserId ?? "operator"}`;
    case "fallback_triggered":
      return "Fallback triggered";
    default:
      return "Pending";
  }
}

function getEscalationStatusTone(status: LiveSandboxEscalation["status"]) {
  switch (status) {
    case "pending":
      return "red";
    case "accepted":
      return "blue";
    case "fallback_triggered":
      return "pink";
    default:
      return "neutral";
  }
}
