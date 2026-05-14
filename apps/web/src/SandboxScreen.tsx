import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import {
  Clock3,
  Mic,
  Play,
  Power,
  RadioTower,
  ReceiptText,
  RefreshCw,
  SendHorizontal,
  Sparkles,
  SquareTerminal,
  WalletCards,
  Wrench,
} from "lucide-react";

import {
  compileRuntimeManifest,
  createAgentRoleNode,
  createConditionNode,
  createCostOptimizedSandwichRuntimeAdapter,
  createEndNode,
  createHandoffNode,
  createSandboxCallSession,
  createToolNode,
  createWorkflowGraph,
  publishWorkflowVersion,
  type ModelRoutingDecision,
  type RuntimeCallPhase,
  type RuntimeCostEstimate,
  type SandboxCallMode,
  type SandboxCallStatus,
  type SandboxSessionMetrics,
  type SandboxTranscriptEntry,
  type StreamedCallEvent,
  type Workspace,
} from "@zara/core";
import { useLocation } from "react-router-dom";

import {
  getSandboxWorkflowVersionOptionId,
  getSelectedSandboxWorkflowVersionId,
  loadPublishedWorkflowVersionsForWorkspace,
  selectSandboxWorkflowVersion,
} from "./workflowSandboxRegistry";
import { tenantId } from "./workspaceState";

type IntentOption = "support" | "billing";
type MicrophoneState = "idle" | "requesting" | "granted" | "denied" | "unsupported";

const pricing = {
  telephonyPerMinuteUsd: {
    "browser-webrtc": 0,
  },
  sttPerMinuteUsd: 0.007,
  modelPer1kInputTokensUsd: {
    cheap: 0.0004,
    standard: 0.003,
    sota: 0.012,
  },
  modelPer1kOutputTokensUsd: {
    cheap: 0.0008,
    standard: 0.006,
    sota: 0.024,
  },
  ttsPer1kCharactersUsd: 0.015,
  storagePerMbUsd: 0.00005,
} as const;

const toolPayloads = {
  "tool-customer-profile": {
    phone: "+2348000000000",
    tenantId,
  },
} as const;

export function SandboxScreen({
  activeWorkspaceId,
  workspaces,
}: {
  activeWorkspaceId: string;
  workspaces: Workspace[];
}) {
  const location = useLocation();
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0];
  const defaultPublishedWorkflow = useMemo(() => createDefaultSandboxPublishedWorkflow(activeWorkspaceId), [activeWorkspaceId]);
  const [publishedWorkflows, setPublishedWorkflows] = useState<ReturnType<typeof loadPublishedWorkflowVersionsForWorkspace>>(() =>
    mergePublishedWorkflows(defaultPublishedWorkflow, loadPublishedWorkflowVersionsForWorkspace({ tenantId, workspaceId: activeWorkspaceId })),
  );
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(() => {
    const queryWorkflowId = new URLSearchParams(location.search).get("workflow");

    return queryWorkflowId ?? getSelectedSandboxWorkflowVersionId() ?? getSandboxWorkflowVersionOptionId(defaultPublishedWorkflow);
  });
  const [sessionSeed, setSessionSeed] = useState(0);
  const [callStatus, setCallStatus] = useState<SandboxCallStatus>("idle");
  const [callMode, setCallMode] = useState<SandboxCallMode>("typed");
  const [microphoneState, setMicrophoneState] = useState<MicrophoneState>("idle");
  const [intent, setIntent] = useState<IntentOption>("billing");
  const [phase, setPhase] = useState<RuntimeCallPhase>("discovery");
  const [draftUtterance, setDraftUtterance] = useState("I need help with a billing charge on my account.");
  const [transcript, setTranscript] = useState<SandboxTranscriptEntry[]>([]);
  const [events, setEvents] = useState<StreamedCallEvent[]>([]);
  const [metrics, setMetrics] = useState<SandboxSessionMetrics>({
    turnCount: 0,
    toolCallCount: 0,
    estimatedCostUsd: 0,
    eventCount: 0,
    durationMs: 0,
  });
  const [lastDecision, setLastDecision] = useState<ModelRoutingDecision | null>(null);
  const [lastEstimate, setLastEstimate] = useState<RuntimeCostEstimate | null>(null);
  const [note, setNote] = useState("Ready for a browser sandbox run.");
  const [isSendingTurn, setIsSendingTurn] = useState(false);
  const [toolBusyNodeId, setToolBusyNodeId] = useState<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const selectedPublishedWorkflow = useMemo(
    () =>
      publishedWorkflows.find((workflow) => getSandboxWorkflowVersionOptionId(workflow) === selectedWorkflowId)
      ?? defaultPublishedWorkflow,
    [defaultPublishedWorkflow, publishedWorkflows, selectedWorkflowId],
  );
  const manifest = useMemo(() => compileSandboxRuntimeManifest(selectedPublishedWorkflow), [selectedPublishedWorkflow]);
  const session = useMemo(
    () =>
      createSandboxCallSession({
        callSessionId: `sandbox-call-${sessionSeed + 1}`,
        manifest,
        pricing,
        runtime: createSandboxRuntimeAdapter(),
        toolRegistry: {
          "hubspot.profile.lookup": async ({ payload }) => ({
            summary: `Fetched account profile for ${String(payload.phone ?? "unknown caller")}`,
            output: {
              customerState: "active",
              openBalance: "$84.20",
            },
          }),
          "zendesk.search": async ({ payload }) => ({
            summary: `Fetched matching tickets for ${String(payload.phone ?? "the sandbox caller")}`,
            output: {
              ticketCount: 2,
              priority: "normal",
            },
          }),
        },
      }),
    [manifest, sessionSeed],
  );

  useEffect(() => {
    unsubscribeRef.current?.();

    const syncSessionState = () => {
      setTranscript(session.getTranscript());
      setMetrics(session.getMetrics());
      setEvents(session.replayEvents());
    };

    syncSessionState();

    unsubscribeRef.current = session.subscribeToEvents(() => {
      syncSessionState();
    }, {
      afterSequence: 0,
    });

    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, [session]);

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

  const availableTools = manifest.toolBindings;
  const budgetRemainingUsd = Math.max(0, manifest.budget.monthlyCapUsd - manifest.budget.currentSpendUsd - metrics.estimatedCostUsd);
  const lastEvent = events.at(-1);
  const selectedWorkflowOptionId = getSandboxWorkflowVersionOptionId(selectedPublishedWorkflow);

  const refreshPublishedWorkflows = () => {
    setPublishedWorkflows(
      mergePublishedWorkflows(defaultPublishedWorkflow, loadPublishedWorkflowVersionsForWorkspace({ tenantId, workspaceId: activeWorkspaceId })),
    );
  };

  const selectPublishedWorkflow = (workflowVersionId: string) => {
    setSelectedWorkflowId(workflowVersionId);
    selectSandboxWorkflowVersion(workflowVersionId);
    resetSandbox();
  };

  const startTypedSandbox = () => {
    const result = session.start({
      microphonePermission: "granted",
      mode: "typed",
    });

    setCallStatus(result.status);
    setCallMode(result.mode);
    setMicrophoneState("idle");
    setNote("Typed sandbox is active.");
  };

  const startMicrophoneSandbox = async () => {
    setMicrophoneState("requesting");
    const permission = await requestMicrophonePermission();
    const result = session.start({
      microphonePermission: permission === "granted" ? "granted" : "denied",
      mode: "microphone",
    });

    setCallStatus(result.status);
    setCallMode(result.mode);
    setMicrophoneState(permission);
    setNote(
      permission === "granted"
        ? "Microphone access granted. You can drive the runtime with live-turn simulation."
        : "Microphone access was denied. Typed sandbox mode remains available.",
    );
  };

  const sendTurn = async () => {
    if (callStatus !== "active" || draftUtterance.trim().length === 0) {
      return;
    }

    setIsSendingTurn(true);

    try {
      const result = await session.sendCallerTurn({
        activeRoleId: manifest.entryRoleId,
        audioFrames: [`frame:${draftUtterance.trim()}`],
        context: {
          intent,
          callPhase: phase,
          requestedToolId: intent === "billing" ? "hubspot.profile.lookup" : undefined,
        },
        durationMs: 22000,
      });

      setLastDecision(result.routingDecision);
      setLastEstimate(result.costEstimate);
      setDraftUtterance(intent === "billing" ? "Please help me understand the invoice change." : "I need help with a support question.");
      setNote("Turn completed and runtime metrics updated.");
    } finally {
      setIsSendingTurn(false);
    }
  };

  const runTool = async (nodeId: string) => {
    if (callStatus !== "active") {
      return;
    }

    setToolBusyNodeId(nodeId);

    try {
      const result = await session.invokeTool({
        nodeId,
        payload: toolPayloads[nodeId as keyof typeof toolPayloads] ?? {
          tenantId,
        },
      });

      setNote(result.summary);
    } finally {
      setToolBusyNodeId(null);
    }
  };

  const endCall = () => {
    const result = session.end({
      disposition: "sandbox_complete",
    });

    setCallStatus(result.status);
    setNote("Sandbox call ended.");
  };

  const resetSandbox = () => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    setSessionSeed((current) => current + 1);
    setCallStatus("idle");
    setCallMode("typed");
    setMicrophoneState("idle");
    setTranscript([]);
    setEvents([]);
    setMetrics({
      turnCount: 0,
      toolCallCount: 0,
      estimatedCostUsd: 0,
      eventCount: 0,
      durationMs: 0,
    });
    setLastDecision(null);
    setLastEstimate(null);
    setNote("Sandbox reset and ready for another run.");
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
          <StatusPill tone={callStatus === "active" ? "blue" : callStatus === "blocked" ? "red" : "neutral"}>
            {formatCallStatus(callStatus)}
          </StatusPill>
          <StatusPill tone="neutral">Published v{manifest.version}</StatusPill>
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
          <StatusPill tone="pink">{formatRuntimeMode(callMode)}</StatusPill>
          <StatusPill tone="neutral">{formatMicrophoneState(microphoneState)}</StatusPill>
        </div>
        <div className="sandbox-toolbar-actions">
          <button className="workflow-button workflow-button-primary" type="button" onClick={startMicrophoneSandbox} disabled={callStatus === "active"}>
            <Mic size={15} />
            <span>Start sandbox call</span>
          </button>
          <button className="workflow-button" type="button" onClick={startTypedSandbox} disabled={callStatus === "active"}>
            <SquareTerminal size={15} />
            <span>Use typed sandbox</span>
          </button>
          <button className="workflow-button" type="button" onClick={endCall} disabled={callStatus !== "active"}>
            <Power size={15} />
            <span>End call</span>
          </button>
          <button className="workflow-button" type="button" onClick={resetSandbox}>
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
              <InlineMetric icon={Clock3} label="Latency" value={metrics.lastFirstByteLatencyMs ? `${metrics.lastFirstByteLatencyMs}ms` : "--"} />
              <InlineMetric icon={Sparkles} label="Turns" value={String(metrics.turnCount)} />
            </div>
          </div>

          <div className="sandbox-controls subtle-panel">
            {manifest.runtimeProfile === "premium-realtime" ? (
              <div className="workflow-muted-panel">
                <div className="workflow-validation-code">Server session required</div>
                <div>Request the realtime transport contract from the Nest API before premium audio begins.</div>
              </div>
            ) : null}
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
              <div className="panel-meta">{note}</div>
              <button className="workflow-button workflow-button-primary" type="button" onClick={sendTurn} disabled={callStatus !== "active" || isSendingTurn}>
                <SendHorizontal size={15} />
                <span>{isSendingTurn ? "Running turn" : "Send caller turn"}</span>
              </button>
            </div>
          </div>

          <div className="sandbox-live-columns">
            <div className="sandbox-pane">
              <div className="sandbox-pane-header">
                <div className="workflow-panel-title">Transcript</div>
                <div className="panel-meta">{transcript.length} entries</div>
              </div>
              <div className="sandbox-transcript-list" aria-live="polite">
                {transcript.length === 0 ? <EmptyPanelCopy text="Start a sandbox call to record transcript turns." /> : null}
                {transcript.map((entry) => (
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
                <div className="panel-meta">{events.length} events</div>
              </div>
              <div className="sandbox-event-list">
                {events.length === 0 ? <EmptyPanelCopy text="Runtime and tool events will appear here as the sandbox runs." /> : null}
                {events.map((event) => (
                  <div key={event.id} className="sandbox-event-row">
                    <div>
                      <div className="panel-title">{event.type}</div>
                      <div className="panel-meta">#{event.sequence} - {formatTime(event.at)}</div>
                    </div>
                    <StatusPill tone={event.type.includes("failed") ? "red" : event.type.includes("tool") ? "pink" : "neutral"}>
                      {event.type.includes("failed") ? "Attention" : "Live"}
                    </StatusPill>
                  </div>
                ))}
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
              <StatusPill tone={lastDecision?.tier === "sota" ? "red" : lastDecision?.tier === "standard" ? "blue" : "neutral"}>
                {lastDecision?.tier ?? manifest.roles[0]?.defaultModelTier ?? "cheap"}
              </StatusPill>
            </div>
            <div className="sandbox-side-stack">
              <MetricPair label="Source" value={lastDecision?.source ?? "role_default"} />
              <MetricPair label="Rule" value={lastDecision?.matchedRuleId ?? "default"} />
              <div className="body-copy">{lastDecision?.reason ?? "No turn has run yet. The sandbox will log model-tier decisions here."}</div>
            </div>
          </section>

          <section className="surface-card sandbox-side-card">
            <div className="sandbox-side-header">
              <div>
                <div className="eyebrow-copy">Live cost</div>
                <div className="workflow-panel-title">Budget and usage</div>
              </div>
              <div className="metric-value">${metrics.estimatedCostUsd.toFixed(3)}</div>
            </div>
            <div className="sandbox-side-stack">
              <MetricPair label="Budget remaining" value={`$${budgetRemainingUsd.toFixed(2)}`} />
              <MetricPair label="Projected per minute" value={`$${manifest.budget.projectedCostPerMinuteUsd.toFixed(2)}`} />
              <div className="sandbox-cost-breakdown">
                {(lastEstimate?.components ?? []).map((component) => (
                  <div key={component.kind} className="sandbox-cost-row">
                    <span>{formatCostKind(component.kind)}</span>
                    <span>{component.missingPrice ? "Pending" : `$${component.totalUsd.toFixed(3)}`}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="surface-card sandbox-side-card">
            <div className="sandbox-side-header">
              <div>
                <div className="eyebrow-copy">Simulated tools</div>
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
                  <button className="workflow-button" type="button" disabled={callStatus !== "active" || toolBusyNodeId === tool.nodeId} onClick={() => runTool(tool.nodeId)}>
                    <Play size={14} />
                    <span>{toolBusyNodeId === tool.nodeId ? "Running" : "Trigger"}</span>
                  </button>
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
              <ReceiptText size={16} />
            </div>
            <div className="sandbox-stat-grid">
              <MetricCard label="Turn count" value={String(metrics.turnCount)} detail="conversation turns" />
              <MetricCard label="Tool calls" value={String(metrics.toolCallCount)} detail="simulated actions" />
              <MetricCard label="Events" value={String(metrics.eventCount)} detail="streamed updates" />
              <MetricCard label="Duration" value={`${Math.round(metrics.durationMs / 1000)}s`} detail="session elapsed" />
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

function compileSandboxRuntimeManifest(publishedVersion: ReturnType<typeof createDefaultSandboxPublishedWorkflow>) {
  return compileRuntimeManifest({
    publishedVersion,
    modelRouting: [
      {
        id: "route-greeting-cheap",
        priority: 10,
        when: {
          callPhase: "greeting",
          language: "en",
          maxRisk: "low",
        },
        useTier: "cheap",
        reason: "Greeting turns can stay on the cheapest tier.",
      },
      {
        id: "route-billing-standard",
        priority: 20,
        when: {
          intent: "billing",
          callPhase: "discovery",
          minConfidence: 0.7,
        },
        useTier: "standard",
        reason: "Billing discovery needs a stronger reasoning tier.",
      },
      {
        id: "route-escalation-sota",
        priority: 40,
        when: {
          callPhase: "escalation",
          minRisk: "high",
          maxConfidence: 0.45,
        },
        useTier: "sota",
        reason: "Escalations with low confidence and high risk go premium.",
      },
    ],
    telemetry: {
      captureAudio: false,
      captureTranscript: true,
      redactSensitiveData: true,
      sinks: ["live-monitor", "opentelemetry"],
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

function createSandboxRuntimeAdapter() {
  return createCostOptimizedSandwichRuntimeAdapter({
    stt: {
      async transcribe({ audioFrames }) {
        return {
          transcript: audioFrames.join(" ").replaceAll("frame:", "").trim(),
          confidence: 0.84,
          language: "en",
        };
      },
    },
    model: {
      async *streamText({ transcript, context, tier }) {
        if (context.intent === "billing") {
          yield "I reviewed the billing lane ";
          yield tier === "standard"
            ? "and I can walk through the charge with you."
            : "and I can explain the issue clearly.";
          return;
        }

        yield `I can help with that ${transcript.length > 0 ? "support request" : "request"}.`;
      },
    },
    tts: {
      async synthesize({ text }) {
        return {
          firstByteLatencyMs: 180,
          audio: (async function* audioGenerator() {
            yield `audio:${text}`;
          })(),
        };
      },
    },
  });
}

async function requestMicrophonePermission(): Promise<MicrophoneState> {
  if (typeof navigator === "undefined" || navigator.mediaDevices?.getUserMedia === undefined) {
    return "unsupported";
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) {
      track.stop();
    }

    return "granted";
  } catch {
    return "denied";
  }
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

function formatCallStatus(status: SandboxCallStatus) {
  switch (status) {
    case "active":
      return "Call live";
    case "blocked":
      return "Blocked";
    case "ended":
      return "Completed";
    default:
      return "Idle";
  }
}

function formatRuntimeMode(mode: SandboxCallMode) {
  return mode === "microphone" ? "Mic mode" : "Typed mode";
}

function formatMicrophoneState(state: MicrophoneState) {
  switch (state) {
    case "granted":
      return "Mic granted";
    case "denied":
      return "Mic denied";
    case "requesting":
      return "Mic request";
    case "unsupported":
      return "Typed fallback";
    default:
      return "Mic optional";
  }
}

function formatSpeaker(speaker: SandboxTranscriptEntry["speaker"]) {
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

function formatCostKind(kind: RuntimeCostEstimate["components"][number]["kind"]) {
  switch (kind) {
    case "model_input":
      return "Model input";
    case "model_output":
      return "Model output";
    case "tts":
      return "TTS";
    case "stt":
      return "STT";
    default:
      return kind.charAt(0).toUpperCase() + kind.slice(1);
  }
}
