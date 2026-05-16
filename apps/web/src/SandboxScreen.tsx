import { type ReactNode, useEffect, useMemo, useState } from "react";

import {
  Clock3,
  Mic,
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
  type RuntimeCallPhase,
  type Workspace,
} from "@zara/core";
import { useLocation } from "react-router-dom";

import { summarizeLiveSandboxEvent } from "./liveSandboxEventFormatting";
import { compilePublishedSandboxRuntimeManifest } from "./sandboxRuntimeManifest";
import { useLiveSandboxSession } from "./useLiveSandboxSession";
import {
  getSandboxWorkflowVersionOptionId,
  getSelectedSandboxWorkflowVersionId,
  loadPublishedWorkflowVersionsForWorkspace,
  selectSandboxWorkflowVersion,
} from "./workflowSandboxRegistry";
import { tenantId } from "./workspaceState";

type IntentOption = "support" | "billing";

export function SandboxScreen({
  activeWorkspaceId,
  workspaces,
}: {
  activeWorkspaceId: string;
  workspaces: Workspace[];
}) {
  const location = useLocation();
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0];
  const defaultPublishedWorkflow = useMemo(
    () => createDefaultSandboxPublishedWorkflow(activeWorkspaceId),
    [activeWorkspaceId],
  );
  const [publishedWorkflows, setPublishedWorkflows] = useState<ReturnType<typeof loadPublishedWorkflowVersionsForWorkspace>>(() =>
    mergePublishedWorkflows(
      defaultPublishedWorkflow,
      loadPublishedWorkflowVersionsForWorkspace({ tenantId, workspaceId: activeWorkspaceId }),
    ),
  );
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(() => {
    const queryWorkflowId = new URLSearchParams(location.search).get("workflow");

    return (
      queryWorkflowId
      ?? getSelectedSandboxWorkflowVersionId()
      ?? getSandboxWorkflowVersionOptionId(defaultPublishedWorkflow)
    );
  });
  const [intent, setIntent] = useState<IntentOption>("billing");
  const [phase, setPhase] = useState<RuntimeCallPhase>("discovery");
  const [draftUtterance, setDraftUtterance] = useState("I need help with a billing charge on my account.");
  const liveSession = useLiveSandboxSession({
    organizationId: tenantId,
    actorUserId: "user-ops-lead",
  });

  const selectedPublishedWorkflow = useMemo(
    () =>
      publishedWorkflows.find((workflow) => getSandboxWorkflowVersionOptionId(workflow) === selectedWorkflowId)
      ?? defaultPublishedWorkflow,
    [defaultPublishedWorkflow, publishedWorkflows, selectedWorkflowId],
  );
  const manifest = useMemo(
    () => compilePublishedSandboxRuntimeManifest(selectedPublishedWorkflow),
    [selectedPublishedWorkflow],
  );
  const availableTools = manifest.toolBindings;
  const budgetRemainingUsd = Math.max(0, manifest.budget.monthlyCapUsd - manifest.budget.currentSpendUsd);
  const lastEvent = liveSession.events.at(-1);
  const selectedWorkflowOptionId = getSandboxWorkflowVersionOptionId(selectedPublishedWorkflow);

  useEffect(() => {
    const nextPublishedWorkflows = mergePublishedWorkflows(
      defaultPublishedWorkflow,
      loadPublishedWorkflowVersionsForWorkspace({ tenantId, workspaceId: activeWorkspaceId }),
    );
    const selectedExists = nextPublishedWorkflows.some(
      (workflow) => getSandboxWorkflowVersionOptionId(workflow) === selectedWorkflowId,
    );

    setPublishedWorkflows(nextPublishedWorkflows);

    if (!selectedExists) {
      setSelectedWorkflowId(getSandboxWorkflowVersionOptionId(defaultPublishedWorkflow));
    }
  }, [activeWorkspaceId, defaultPublishedWorkflow, selectedWorkflowId]);

  useEffect(() => {
    void liveSession.resetSession();
  }, [liveSession.resetSession, manifest.manifestId]);

  const refreshPublishedWorkflows = () => {
    setPublishedWorkflows(
      mergePublishedWorkflows(
        defaultPublishedWorkflow,
        loadPublishedWorkflowVersionsForWorkspace({ tenantId, workspaceId: activeWorkspaceId }),
      ),
    );
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
    });
  };

  const startMicrophoneSandbox = async () => {
    await liveSession.startSession({
      workspaceId: activeWorkspaceId,
      source: "published",
      inputMode: "voice",
      entryRoleId: manifest.entryRoleId,
      manifest,
    });
  };

  const sendTurn = () => {
    if (draftUtterance.trim().length === 0) {
      return;
    }

    liveSession.sendTextTurn({
      transcript: draftUtterance.trim(),
      callPhase: phase,
    });
    setDraftUtterance(
      intent === "billing"
        ? "Please help me understand the invoice change."
        : "I need help with a support question.",
    );
  };

  const toggleVoiceTurn = () => {
    if (liveSession.voiceTurnCapturing) {
      liveSession.stopVoiceTurnCapture(phase);
      return;
    }

    liveSession.startVoiceTurnCapture();
  };

  return (
    <div className="sandbox-page">
      <section className="sandbox-toolbar surface-card">
        <div>
          <div className="eyebrow-copy">Sandbox</div>
          <h1 className="workflow-title">Runtime session</h1>
          <div className="panel-meta">{activeWorkspace?.name ?? "Workspace"} workspace</div>
        </div>
        <div className="sandbox-workflow-select">
          <label className="sandbox-field">
            <span className="sandbox-field-label">Published workflow</span>
            <select value={selectedWorkflowOptionId} onChange={(event) => selectPublishedWorkflow(event.target.value)}>
              {publishedWorkflows.map((workflow) => (
                <option key={workflow.id} value={getSandboxWorkflowVersionOptionId(workflow)}>
                  {workflow.graph.name} v{workflow.version}
                </option>
              ))}
            </select>
          </label>
          <button className="workflow-button" type="button" onClick={refreshPublishedWorkflows}>
            <RefreshCw size={15} />
            <span>Refresh workflows</span>
          </button>
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
        <div className="sandbox-toolbar-actions">
          <button
            className="workflow-button workflow-button-primary"
            type="button"
            onClick={startMicrophoneSandbox}
            disabled={liveSession.status === "active" || liveSession.status === "connecting"}
          >
            <Mic size={15} />
            <span>{liveSession.status === "connecting" ? "Starting live session" : "Start sandbox call"}</span>
          </button>
          <button
            className="workflow-button"
            type="button"
            onClick={startTypedSandbox}
            disabled={liveSession.status === "active" || liveSession.status === "connecting"}
          >
            <SquareTerminal size={15} />
            <span>Use typed sandbox</span>
          </button>
          <button className="workflow-button" type="button" onClick={() => void liveSession.endSession()} disabled={liveSession.status !== "active"}>
            <Power size={15} />
            <span>End call</span>
          </button>
          <button className="workflow-button" type="button" onClick={() => void liveSession.resetSession()}>
            <RadioTower size={15} />
            <span>Reset sandbox</span>
          </button>
        </div>
      </section>

      <div className="sandbox-grid">
        <section className="surface-card sandbox-live-surface">
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
                  liveSession.metrics.lastFirstByteLatencyMs !== undefined
                    ? `${liveSession.metrics.lastFirstByteLatencyMs}ms`
                    : "--"
                }
              />
              <InlineMetric icon={Mic} label="Turns" value={String(liveSession.metrics.turnCount)} />
            </div>
          </div>

          <div className="sandbox-controls subtle-panel">
            <div className="workflow-muted-panel">
              <div className="workflow-validation-code">Live transport</div>
              <div>AssemblyAI streaming STT, model routing on the Nest control plane, and Cartesia Sonic 3 voice playback.</div>
              <div className="panel-meta">{liveSession.note}</div>
            </div>

            <div className="sandbox-control-row">
              <label className="sandbox-field">
                <span className="sandbox-field-label">Intent</span>
                <select value={intent} onChange={(event) => setIntent(event.target.value as IntentOption)}>
                  <option value="support">Support</option>
                  <option value="billing">Billing</option>
                </select>
              </label>
              <label className="sandbox-field">
                <span className="sandbox-field-label">Phase</span>
                <select value={phase} onChange={(event) => setPhase(event.target.value as RuntimeCallPhase)}>
                  <option value="greeting">Greeting</option>
                  <option value="discovery">Discovery</option>
                  <option value="tool-use">Tool use</option>
                  <option value="resolution">Resolution</option>
                  <option value="escalation">Escalation</option>
                </select>
              </label>
            </div>

            {liveSession.inputMode === "voice" ? (
              <div className="sandbox-composer-actions">
                <div className="panel-meta">Voice mode captures a caller turn from the microphone, then sends it through the live workflow runtime.</div>
                <button className="workflow-button workflow-button-primary" type="button" onClick={toggleVoiceTurn} disabled={liveSession.status !== "active"}>
                  <Mic size={15} />
                  <span>{liveSession.voiceTurnCapturing ? "Send voice turn" : "Capture voice turn"}</span>
                </button>
              </div>
            ) : (
              <>
                <label className="sandbox-composer">
                  <span className="sandbox-field-label">Caller turn</span>
                  <textarea
                    rows={4}
                    value={draftUtterance}
                    onChange={(event) => setDraftUtterance(event.target.value)}
                    placeholder="Describe what the caller says in the sandbox."
                  />
                </label>

                <div className="sandbox-composer-actions">
                  <div className="panel-meta">{liveSession.note}</div>
                  <button
                    className="workflow-button workflow-button-primary"
                    type="button"
                    onClick={sendTurn}
                    disabled={liveSession.status !== "active" || draftUtterance.trim().length === 0}
                  >
                    <SendHorizontal size={15} />
                    <span>Send caller turn</span>
                  </button>
                </div>
              </>
            )}
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
        </section>

        <aside className="sandbox-side-column">
          <section className="surface-card sandbox-side-card">
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
          </section>

          <section className="surface-card sandbox-side-card">
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
          </section>

          <section className="surface-card sandbox-side-card">
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
          </section>

          <section className="surface-card sandbox-side-card">
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
              <MetricCard label="Latency" value={liveSession.metrics.lastFirstByteLatencyMs !== undefined ? `${liveSession.metrics.lastFirstByteLatencyMs}ms` : "--"} detail="voice first byte" />
            </div>
          </section>

          <section className="surface-card sandbox-side-card">
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
          </section>
        </aside>
      </div>
    </div>
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

  return [...versionsByOptionId.values()].sort((a, b) => {
    const nameOrder = a.graph.name.localeCompare(b.graph.name);

    if (nameOrder !== 0) {
      return nameOrder;
    }

    return b.version - a.version;
  });
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
