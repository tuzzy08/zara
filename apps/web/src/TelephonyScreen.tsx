import { useEffect, useMemo, useState } from "react";

import {
  Activity,
  ArrowRightLeft,
  BadgeCheck,
  Bot,
  Cable,
  PhoneIncoming,
  PhoneCall,
  ShieldCheck,
  TestTube2,
  Waves,
} from "lucide-react";
import type { TelephonyRecordingConsentMode, TelephonyRecordingPolicy, Workspace } from "@zara/core";

import {
  assignTelephonyRouteViaApi,
  createTwilioConnectionViaApi,
  dispatchInboundTelephonyTestViaApi,
  fetchTelephonyState,
  importTwilioNumbersViaApi,
  validateTelephonyConnectionViaApi,
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

interface TwilioConnectionDraft {
  label: string;
  region: string;
  accountSid: string;
  authToken: string;
  consentMode: TelephonyRecordingConsentMode;
  consentMessage: string;
  blockRoutingOnHealthFailure: boolean;
}

interface DispatchDraft {
  toPhoneNumber: string;
  fromPhoneNumber: string;
  callSid: string;
}

function createInitialConnectionDraft(): TwilioConnectionDraft {
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

function createInitialDispatchDraft(): DispatchDraft {
  return {
    toPhoneNumber: "",
    fromPhoneNumber: "+233201110001",
    callSid: "CA-inbound-test-001",
  };
}

export function TelephonyScreen({
  activeWorkspaceId,
  workspaces,
  showToast,
}: TelephonyScreenProps) {
  const [state, setState] = useState<TelephonyStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [draft, setDraft] = useState<TwilioConnectionDraft>(() => createInitialConnectionDraft());
  const [dispatchDraft, setDispatchDraft] = useState<DispatchDraft>(() => createInitialDispatchDraft());
  const [routeSelections, setRouteSelections] = useState<Record<string, string>>({});
  const [lastDispatch, setLastDispatch] = useState<TelephonyDispatchRecord | null>(null);
  const [workflowCatalogVersion, setWorkflowCatalogVersion] = useState(0);

  const publishedWorkflows = useMemo(
    () => loadPublishedWorkflowVersionsForWorkspace({
      tenantId,
      workspaceId: activeWorkspaceId,
    }),
    [activeWorkspaceId, workflowCatalogVersion],
  );

  const workspaceNameById = useMemo(
    () =>
      new Map(
        workspaces.map((workspace) => [workspace.id, workspace.name] as const),
      ),
    [workspaces],
  );

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    void fetchTelephonyState(tenantId)
      .then((nextState) => {
        if (cancelled) {
          return;
        }

        setState(nextState);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        showToast(error instanceof Error ? error.message : "Telephony state could not be loaded.");
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
        const currentSelection = nextSelections[phoneNumber.id];
        if (typeof currentSelection === "string" && currentSelection.length > 0) {
          continue;
        }

        const workspaceWorkflow =
          getLatestPublishedWorkflow(
            publishedWorkflows,
            phoneNumber.workspaceId ?? activeWorkspaceId,
          ) ?? getLatestPublishedWorkflow(publishedWorkflows, activeWorkspaceId);

        nextSelections[phoneNumber.id] = phoneNumber.publishedVersionId ?? workspaceWorkflow?.id ?? "";
      }

      return nextSelections;
    });

    setDispatchDraft((current) =>
      current.toPhoneNumber.length > 0 || state.phoneNumbers.length === 0
        ? current
        : { ...current, toPhoneNumber: state.phoneNumbers[0]!.phoneNumber },
    );
  }, [activeWorkspaceId, publishedWorkflows, state]);

  const metrics = useMemo(() => {
    const connections = state?.connections ?? [];
    const phoneNumbers = state?.phoneNumbers ?? [];
    const dispatches = state?.dispatches ?? [];
    const routedDispatches = dispatches.filter((dispatch) => dispatch.disposition === "routed");

    return {
      activeConnections: connections.filter((connection) => connection.status === "active").length,
      routedNumbers: phoneNumbers.filter((phoneNumber) => phoneNumber.status === "routed").length,
      webhookReady: phoneNumbers.filter((phoneNumber) => phoneNumber.webhookStatus === "configured").length,
      inboundPassRate:
        dispatches.length === 0 ? "No tests yet" : `${routedDispatches.length}/${dispatches.length} routed`,
    };
  }, [state]);

  const activeConnection = state?.connections.find((connection) => connection.provider === "twilio") ?? null;
  const healthCheck = activeConnection === null
    ? null
    : state?.healthChecks.find((candidate) => candidate.connectionId === activeConnection.id) ?? null;

  const recordingPolicy = useMemo<TelephonyRecordingPolicy>(() => ({
    enabled: true,
    consentMode: draft.consentMode,
    consentMessage: draft.consentMessage,
  }), [draft.consentMessage, draft.consentMode]);

  const createConnection = async () => {
    if (draft.accountSid.trim().length === 0 || draft.authToken.trim().length === 0) {
      showToast("Twilio account SID and auth token are required.");
      return;
    }

    setConnecting(true);

    try {
      const response = await createTwilioConnectionViaApi({
        organizationId: tenantId,
        actorUserId,
        label: draft.label,
        region: draft.region,
        accountSid: draft.accountSid.trim(),
        authToken: draft.authToken.trim(),
        blockRoutingOnHealthFailure: draft.blockRoutingOnHealthFailure,
        recordingPolicy,
      });

      setState(response.state);
      showToast("Twilio connection added.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Twilio connection could not be created.");
    } finally {
      setConnecting(false);
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
      showToast("Provider health check passed.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Provider validation failed.");
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
        recordingPolicy,
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

  const contentState = state ?? {
    organizationId: tenantId,
    connections: [],
    phoneNumbers: [],
    healthChecks: [],
    dispatches: [],
    webhookEvents: [],
  };

  return (
    <div className="telephony-page">
      <section className="surface-card telephony-hero-band">
        <div className="telephony-hero-copy">
          <div className="eyebrow-copy">Telephony</div>
          <h1 className="telephony-page-title">Telephony operations</h1>
          <p className="body-copy telephony-page-copy">
            Connect provider accounts, import live numbers, pin published workflows, and dry-run inbound routing before voice traffic reaches production.
          </p>
        </div>

        <div className="telephony-summary-grid">
          <MetricTile icon={Cable} label="Active connections" value={String(metrics.activeConnections)} />
          <MetricTile icon={ArrowRightLeft} label="Routed numbers" value={String(metrics.routedNumbers)} />
          <MetricTile icon={ShieldCheck} label="Webhook ready" value={String(metrics.webhookReady)} />
          <MetricTile icon={TestTube2} label="Inbound tests" value={metrics.inboundPassRate} />
        </div>
      </section>

      <div className="telephony-grid">
        <div className="telephony-main">
          <section className="surface-card telephony-panel telephony-connect-card">
            <div className="telephony-section-head">
              <div>
                <div className="eyebrow-copy">BYO provider</div>
                <div className="subhead-copy telephony-section-title">Twilio connection</div>
              </div>
              <button className="workflow-button workflow-button-primary" type="button" onClick={createConnection} disabled={connecting}>
                <PhoneCall size={15} />
                <span>Connect Twilio account</span>
              </button>
            </div>

            <div className="telephony-form-grid">
              <label className="workspace-settings-field">
                <span>Connection label</span>
                <input
                  aria-label="Connection label"
                  value={draft.label}
                  onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
                />
              </label>
              <label className="workspace-settings-field">
                <span>Region</span>
                <select
                  aria-label="Twilio region"
                  value={draft.region}
                  onChange={(event) => setDraft((current) => ({ ...current, region: event.target.value }))}
                >
                  <option value="us-east-1">US East</option>
                  <option value="eu-west-1">EU West</option>
                </select>
              </label>
              <label className="workspace-settings-field">
                <span>Twilio account SID</span>
                <input
                  aria-label="Twilio account SID"
                  value={draft.accountSid}
                  onChange={(event) => setDraft((current) => ({ ...current, accountSid: event.target.value }))}
                />
              </label>
              <label className="workspace-settings-field">
                <span>Twilio auth token</span>
                <input
                  aria-label="Twilio auth token"
                  type="password"
                  value={draft.authToken}
                  onChange={(event) => setDraft((current) => ({ ...current, authToken: event.target.value }))}
                />
              </label>
              <label className="workspace-settings-field">
                <span>Recording consent</span>
                <select
                  aria-label="Recording consent"
                  value={draft.consentMode}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      consentMode: event.target.value as TelephonyRecordingConsentMode,
                    }))
                  }
                >
                  <option value="single-party">Single-party</option>
                  <option value="two-party">Two-party</option>
                  <option value="disabled">Disabled</option>
                </select>
              </label>
              <label className="workspace-settings-field telephony-form-span-2">
                <span>Consent message</span>
                <input
                  aria-label="Consent message"
                  value={draft.consentMessage}
                  onChange={(event) => setDraft((current) => ({ ...current, consentMessage: event.target.value }))}
                />
              </label>
            </div>
          </section>

          <section className="surface-card telephony-panel">
            <div className="telephony-section-head">
              <div>
                <div className="eyebrow-copy">Connections</div>
                <div className="subhead-copy telephony-section-title">Provider state</div>
              </div>
              {loading ? <div className="panel-meta">Loading</div> : null}
            </div>

            {contentState.connections.length === 0 ? (
              <div className="telephony-empty-state">
                Add a provider account to begin number import and routing.
              </div>
            ) : (
              <div className="telephony-connection-list">
                {contentState.connections.map((connection) => (
                  <article key={connection.id} className="telephony-connection-card">
                    <div className="telephony-connection-header">
                      <div>
                        <div className="panel-title">{connection.label}</div>
                        <div className="panel-meta">
                          {connection.provider} - {connection.region}
                        </div>
                      </div>
                      <div className="telephony-connection-pills">
                        <span className={connection.healthStatus === "healthy" ? "status-pill status-pill-blue" : "status-pill status-pill-neutral"}>
                          {formatConnectionHealth(connection.healthStatus)}
                        </span>
                        <span className="status-pill status-pill-neutral">{formatRecordingLabel(connection.recordingPolicy)}</span>
                      </div>
                    </div>

                    <div className="telephony-connection-detail-grid">
                      <ConnectionDetail label="Credential" value={connection.credentialReference?.preview ?? "Platform managed"} />
                      <ConnectionDetail label="Webhook" value={connection.webhookStatus} />
                      <ConnectionDetail label="Account" value={connection.externalReference ?? "Platform pool"} />
                      <ConnectionDetail label="Routing guard" value={connection.blockRoutingOnHealthFailure ? "Block on failure" : "Warn only"} />
                    </div>

                    <div className="telephony-row-actions">
                      <button className="workflow-button" type="button" onClick={() => validateConnection(connection.id)}>
                        <BadgeCheck size={15} />
                        <span>Validate provider</span>
                      </button>
                      <button className="workflow-button" type="button" onClick={() => importNumbers(connection.id)}>
                        <PhoneIncoming size={15} />
                        <span>Import phone numbers</span>
                      </button>
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
                <div className="subhead-copy telephony-section-title">Imported numbers</div>
              </div>
              <button className="workflow-button" type="button" onClick={() => setWorkflowCatalogVersion((current) => current + 1)}>
                <Bot size={15} />
                <span>Reload workflows</span>
              </button>
            </div>

            {contentState.phoneNumbers.length === 0 ? (
              <div className="telephony-empty-state">
                Import numbers from a healthy connection to start assigning live workflow routes.
              </div>
            ) : (
              <div className="telephony-number-table" role="table" aria-label="Imported telephony numbers">
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
                      <div className="panel-meta">{phoneNumber.friendlyName}</div>
                    </div>
                    <label className="workspace-inline-field">
                      <span className="sr-only">{`Workflow route for ${phoneNumber.phoneNumber}`}</span>
                      <select
                        aria-label={`Workflow route for ${phoneNumber.phoneNumber}`}
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
                      <button className="workflow-button" type="button" onClick={() => saveRoute(phoneNumber.id)}>
                        <Waves size={15} />
                        <span>{`Save route for ${phoneNumber.phoneNumber}`}</span>
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

            {activeConnection === null ? (
              <div className="telephony-empty-state">No provider connected yet.</div>
            ) : (
              <div className="telephony-side-stack">
                <div className="subtle-panel telephony-health-card">
                  <div className="telephony-health-title">
                    <Activity size={15} />
                    <span>{healthCheck?.status === "healthy" ? "Healthy" : formatConnectionHealth(activeConnection.healthStatus)}</span>
                  </div>
                  <p className="panel-meta">
                    {healthCheck?.message ?? "Run a provider validation pass to confirm auth, webhook reachability, and routing health."}
                  </p>
                </div>
                <div className="subtle-panel telephony-health-card">
                  <div className="telephony-health-title">
                    <ShieldCheck size={15} />
                    <span>Recording policy</span>
                  </div>
                  <p className="panel-meta">{formatRecordingSummary(activeConnection.recordingPolicy)}</p>
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
              <label className="workspace-settings-field telephony-form-span-2">
                <span>Destination number</span>
                <select
                  aria-label="Destination number"
                  value={dispatchDraft.toPhoneNumber}
                  onChange={(event) => setDispatchDraft((current) => ({ ...current, toPhoneNumber: event.target.value }))}
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
                  aria-label="Caller phone number"
                  value={dispatchDraft.fromPhoneNumber}
                  onChange={(event) => setDispatchDraft((current) => ({ ...current, fromPhoneNumber: event.target.value }))}
                />
              </label>
              <label className="workspace-settings-field">
                <span>Call SID</span>
                <input
                  aria-label="Call SID"
                  value={dispatchDraft.callSid}
                  onChange={(event) => setDispatchDraft((current) => ({ ...current, callSid: event.target.value }))}
                />
              </label>
            </div>

            <div className="telephony-row-actions">
              <button className="workflow-button workflow-button-success" type="button" onClick={runInboundDispatch}>
                <TestTube2 size={15} />
                <span>Run inbound dispatch</span>
              </button>
            </div>

            <div className="telephony-dispatch-result subtle-panel">
              <div className="telephony-health-title">
                <ArrowRightLeft size={15} />
                <span>{lastDispatch?.disposition === "routed" ? "Routed" : "Awaiting test"}</span>
              </div>
              <p className="panel-meta">{lastDispatch?.reason ?? "Pick an imported number to confirm the published route before you open the line."}</p>
            </div>
          </section>

          <section className="surface-card telephony-panel">
            <div className="telephony-section-head">
              <div>
                <div className="eyebrow-copy">Recent webhooks</div>
                <div className="subhead-copy telephony-section-title">Provider events</div>
              </div>
            </div>

            {contentState.webhookEvents.length === 0 ? (
              <div className="telephony-empty-state">Incoming provider events will appear here after live callbacks arrive.</div>
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

function formatConnectionHealth(status: string) {
  switch (status) {
    case "healthy":
      return "Healthy";
    case "warning":
      return "Warning";
    case "failed":
      return "Failed";
    default:
      return "Unchecked";
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

function getLatestPublishedWorkflow(
  publishedWorkflows: ReturnType<typeof loadPublishedWorkflowVersionsForWorkspace>,
  workspaceId: string,
) {
  return publishedWorkflows
    .filter((workflow) => (workflow.workspaceId ?? workspaceId) === workspaceId)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
}
