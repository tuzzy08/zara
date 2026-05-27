import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

import {
  addEdge,
  Background,
  ConnectionMode,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  reconnectEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  GitBranch,
  Handshake,
  Headphones,
  KeyRound,
  MoreHorizontal,
  PhoneCall,
  PhoneOff,
  Power,
  Plus,
  Play,
  RotateCcw,
  Trash2,
  Wrench,
  X,
} from "lucide-react";

import {
  buildRuntimeManifestPreview,
  applySpecialistRoleTemplate,
  createAgentRoleNode,
  createConditionNode,
  createEndNode,
  createHandoffNode,
  createHumanEscalationNode,
  createSpecialistRoleTemplate,
  createToolNode,
  createWorkflowGraph,
  deleteWorkflowNode,
  publishWorkflowVersion,
  updateSpecialistRoleTemplate,
  validateWorkflowGraph,
  type AgentRoleKind,
  type AgentRoleNodeConfig,
  type ConditionNodeConfig,
  type EndNodeConfig,
  type EscalationFallbackMode,
  type ImportedTelephonyPhoneNumber,
  type HumanEscalationNodeConfig,
  type ModelTier,
  type PublishedWorkflowVersion,
  type RealtimeProviderId,
  type RuntimeProfileId,
  type RuntimeManifestPreview,
  type SpecialistRoleTemplate,
  type TelephonyConnection,
  type TelephonyExecutionCommand,
  type TelephonyExecutionSession,
  type TelephonyProvider,
  type TextModelProviderId,
  type ToolNodeConfig,
  type ToolRequestConfig,
  type ToolRequestHeader,
  type VoiceRuntimeKind,
  type Workspace,
  type WorkflowEdgeKind,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNodeKind,
  type WorkflowRelationshipHandleRole,
} from "@zara/core";

import { compileDraftSandboxRuntimeManifest, compilePublishedSandboxRuntimeManifest } from "./sandboxRuntimeManifest";
import { getNextBuilderNodeNumber } from "./workflowBuilderIds";
import { getBuilderNodeAccent } from "./workflowBuilderTheme";
import {
  applyBuilderEdgeHandleRoles,
  builderFlowSourceHandleId,
  builderFlowTargetHandleId,
  canCreateBuilderRelationshipFromKind,
  getBuilderConnectionDecision,
  getBuilderPolicyDecision,
  resolveWorkflowBuilderWorkbench,
  toWorkflowRelationshipSourceHandleRole,
  toWorkflowRelationshipTargetHandleRole,
  type WorkflowBuilderRouteTargetOption,
} from "./workflowBuilderWorkbench";
import { summarizeLiveSandboxEvent } from "./liveSandboxEventFormatting";
import type { LiveSandboxStreamEvent } from "./liveSandboxSessionApi";
import { useLiveSandboxSession } from "./useLiveSandboxSession";
import {
  loadPublishedWorkflowVersionsForWorkspace,
  savePublishedWorkflowVersion,
} from "./workflowSandboxRegistry";
import {
  dispatchInboundTelephonyTestViaApi,
  fetchTelephonyState,
  type TelephonyDispatchRecord,
  type TelephonyStateResponse,
} from "./telephonyApi";
import { tenantId } from "./workspaceState";

interface BuilderNodeData extends Record<string, unknown> {
  kind: WorkflowNodeKind;
  label: string;
  badge: string;
  subtitle: string;
  liveState?: "idle" | "active" | "visited" | "current";
  role?: AgentRoleNodeConfig;
  toolId?: string | undefined;
  tool?: ToolNodeConfig;
  handoff?: {
    targetRoleId: string;
    targetRoleName: string;
    handoffReason: string;
  };
  escalation?: HumanEscalationNodeConfig;
  condition?: ConditionNodeConfig;
  end?: EndNodeConfig;
  config?: Record<string, unknown>;
}

type BuilderNode = Node<BuilderNodeData, "builderNode">;

interface BuilderEdgeData extends Record<string, unknown> {
  kind?: WorkflowEdgeKind;
}

type BuilderEdge = Edge<BuilderEdgeData>;

interface ToolCatalogItem {
  toolId: string;
  toolName: string;
  connector: ToolNodeConfig["connector"];
  risk: ToolNodeConfig["risk"];
  requiresAuthorization: boolean;
  requiresHumanApproval: boolean;
  request: ToolRequestConfig;
}

interface IntegrationOption {
  value: string;
  label: string;
  status: ToolNodeConfig["connectionStatus"];
}

interface QueueOption {
  queueId: string;
  queueName: string;
  fallbackMode: EscalationFallbackMode;
}

interface DeletedCanvasSnapshot {
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  selectedNodeId: string;
}

interface BuilderValidationIssue {
  key: string;
  title: string;
  detail: string;
}

interface SandboxTranscriptEntry {
  id?: string;
  speaker: "caller" | "agent" | "system";
  text: string;
  at?: string;
}

interface WorkflowSandboxTelephonyRoute {
  id: string;
  phoneNumberId: string;
  phoneNumber: string;
  friendlyName: string;
  workflowLabel: string;
  publishedVersionId: string;
  connectionId: string;
  connectionLabel: string;
  ownershipMode: string;
  provider: string;
  recordingSummary: string;
}

interface WorkflowSandboxRouteResolution {
  route: WorkflowSandboxTelephonyRoute;
  dispatch: TelephonyDispatchRecord;
  session: TelephonyExecutionSession | null;
  command: TelephonyExecutionCommand | null;
}

type ToolInspectorPatch = Partial<ToolNodeConfig> & {
  toolId?: string;
  clearConnection?: boolean;
  request?: ToolRequestConfig;
};

const nodeTypes = {
  builderNode: BuilderNodeCard,
};

const toolCatalog: ToolCatalogItem[] = [
  {
    toolId: "zendesk.search",
    toolName: "Ticket lookup",
    connector: "zendesk",
    risk: "medium",
    requiresAuthorization: true,
    requiresHumanApproval: false,
    request: {
      method: "GET",
      url: "https://api.zendesk.com/api/v2/search.json",
      authToken: "{{secrets.zendesk_api_token}}",
      headers: [
        { name: "Accept", value: "application/json" },
        { name: "X-Zara-Tenant", value: "{{tenant.id}}" },
      ],
    },
  },
  {
    toolId: "zendesk.comment",
    toolName: "Ticket note",
    connector: "zendesk",
    risk: "medium",
    requiresAuthorization: true,
    requiresHumanApproval: true,
    request: {
      method: "POST",
      url: "https://api.zendesk.com/api/v2/tickets/{{ticket.id}}/comments.json",
      authToken: "{{secrets.zendesk_api_token}}",
      headers: [
        { name: "Content-Type", value: "application/json" },
        { name: "X-Zara-Tenant", value: "{{tenant.id}}" },
      ],
      bodyTemplate: '{"body":"{{tool.note}}","public":false}',
    },
  },
  {
    toolId: "hubspot.lookup_contact",
    toolName: "Contact lookup",
    connector: "hubspot",
    risk: "low",
    requiresAuthorization: true,
    requiresHumanApproval: false,
    request: {
      method: "GET",
      url: "https://api.hubapi.com/crm/v3/objects/contacts/{{caller.email}}",
      authToken: "{{secrets.hubspot_private_app_token}}",
      headers: [
        { name: "Accept", value: "application/json" },
        { name: "X-Zara-Tenant", value: "{{tenant.id}}" },
      ],
    },
  },
  {
    toolId: "webhook.post",
    toolName: "Webhook action",
    connector: "webhook",
    risk: "high",
    requiresAuthorization: false,
    requiresHumanApproval: true,
    request: {
      method: "POST",
      url: "https://hooks.zara.ai/actions",
      authToken: "{{secrets.workflow_webhook_token}}",
      headers: [
        { name: "Content-Type", value: "application/json" },
        { name: "X-Zara-Tenant", value: "{{tenant.id}}" },
      ],
      bodyTemplate: '{"callId":"{{call.id}}","intent":"{{call.intent}}"}',
    },
  },
];

const queueOptions: QueueOption[] = [
  {
    queueId: "support-ops",
    queueName: "Support operations",
    fallbackMode: "callback",
  },
  {
    queueId: "billing-ops",
    queueName: "Billing managers",
    fallbackMode: "ticket",
  },
  {
    queueId: "after-hours",
    queueName: "After hours callback",
    fallbackMode: "voicemail",
  },
];

const defaultToolCatalogItem = toolCatalog[0]!;
const defaultQueueOption = queueOptions[0]!;
const workflowId = "workflow-inbound-support-triage";
const environment = "production";
const createdBy = "ops-lead";
const draftSandboxTelephonyProvider: TelephonyProvider = "browser-webrtc";
const temporaryWorkflowBudgetPolicy: RuntimeManifestPreview["budget"] = {
  monthlyCapUsd: 80,
  currentSpendUsd: 0,
  projectedCostPerMinuteUsd: 0.18,
  blockOnLimit: true,
};

function normalizeWorkflowName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function comparePublishedWorkflowVersions(a: PublishedWorkflowVersion, b: PublishedWorkflowVersion) {
  const workflowOrder = a.manifestPreview.workflowId.localeCompare(b.manifestPreview.workflowId);

  if (workflowOrder !== 0) {
    return workflowOrder;
  }

  return a.version - b.version;
}

const specialistTemplatesStorageKey = "zara.web.specialist-templates.v1";
const runtimeProfileOptions: Array<{ value: RuntimeProfileId; label: string }> = [
  { value: "cost-optimized", label: "Cost optimized" },
  { value: "balanced", label: "Balanced" },
  { value: "premium-realtime", label: "Premium realtime" },
];
const textModelProviderOptions: Array<{ value: TextModelProviderId; label: string; badge: string }> = [
  { value: "openai", label: "OpenAI", badge: "OpenAI" },
  { value: "google-gemini", label: "Google Gemini", badge: "Gemini" },
];
const textModelPresets: Record<TextModelProviderId, string[]> = {
  openai: ["gpt-4.1-mini", "gpt-4.1"],
  "google-gemini": ["gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-3.1-pro-preview"],
};
const realtimeProviderOptions: Array<{ value: RealtimeProviderId; label: string }> = [
  { value: "openai-realtime", label: "OpenAI Realtime" },
  { value: "gemini-live", label: "Google Gemini Live" },
];
const realtimeModelPresets: Record<RealtimeProviderId, string[]> = {
  "openai-realtime": ["gpt-realtime"],
  "gemini-live": ["gemini-3.1-flash-live-preview"],
};
const languageOptions = [
  { value: "en", label: "English" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
  { value: "de", label: "German" },
  { value: "pt", label: "Portuguese" },
  { value: "ar", label: "Arabic" },
] as const;
const conditionIntentOptions = [
  {
    value: "billing",
    label: "Billing",
    description: "Caller needs help with billing, invoices, payments, refunds, charges, or balances.",
    examples: ["Why was I charged twice?", "I need a copy of my invoice."],
  },
  {
    value: "support",
    label: "Support",
    description: "Caller needs account, product, or service support from a specialist.",
    examples: ["I cannot sign in.", "The app is not loading."],
  },
  {
    value: "sales",
    label: "Sales",
    description: "Caller wants sales help with pricing, plan information, a demo, or buying.",
    examples: ["Can I talk to sales?", "I want pricing for my team."],
  },
  {
    value: "vip",
    label: "VIP",
    description: "Caller is a high-value or priority customer who should receive elevated handling.",
    examples: ["I am on the enterprise plan.", "Please route me to priority support."],
  },
  {
    value: "technical-support",
    label: "Technical support",
    description: "Caller has a technical issue that requires troubleshooting or product expertise.",
    examples: ["The integration is failing.", "I need help with an API error."],
  },
  {
    value: "property-inquiry",
    label: "Property inquiry",
    description: "Caller is asking about a listing, showing, availability, or property details.",
    examples: ["Is the apartment still available?", "Can I schedule a viewing?"],
  },
] as const;
const defaultIntentRouteClassifier = {
  mode: "standard" as const,
  modelAlias: "intent-classifier-fast" as const,
  confidenceThreshold: 0.65,
};
const defaultIntentRouteInputWindow = {
  latestCallerTurn: true,
  recentTranscriptTurns: 6,
  includeConversationSummary: true,
  includePreviousAgentContext: true,
  includeRecentToolResults: true,
};
const defaultSpecialistTemplateCreatedAt = "2026-05-20T00:00:00.000Z";

const initialNodes: BuilderNode[] = [createEntryBuilderNode()];
const initialEdges: BuilderEdge[] = [];

function createEntryBuilderNode(): BuilderNode {
  return {
    id: "entry",
    type: "builderNode",
    position: { x: 0, y: 220 },
    data: {
      kind: "entry",
      label: "Inbound call",
      badge: "Support line",
      subtitle: "Production tenant",
      config: { channel: "phone" },
    },
  };
}

interface WorkflowBuilderInitialState {
  currentWorkflowId: string;
  edges: BuilderEdge[];
  nodes: BuilderNode[];
  publishedVersions: PublishedWorkflowVersion[];
  selectedNodeId: string;
  selectedWorkflowVersionId: string;
  workflowRuntimeProfile: RuntimeProfileId;
  workflowTitle: string;
}

function createBlankWorkflowBuilderState(publishedVersions: PublishedWorkflowVersion[] = []): WorkflowBuilderInitialState {
  return {
    currentWorkflowId: workflowId,
    edges: initialEdges,
    nodes: initialNodes,
    publishedVersions,
    selectedNodeId: "entry",
    selectedWorkflowVersionId: "__draft__",
    workflowRuntimeProfile: "cost-optimized",
    workflowTitle: "",
  };
}

function createWorkflowBuilderInitialState(activeWorkspaceId: string): WorkflowBuilderInitialState {
  const publishedVersions = loadPublishedWorkflowVersionsForWorkspace({ tenantId, workspaceId: activeWorkspaceId });
  const mostRecentPublishedVersion = getMostRecentPublishedWorkflowVersion(publishedVersions);

  if (mostRecentPublishedVersion === undefined) {
    return createBlankWorkflowBuilderState(publishedVersions);
  }

  return createWorkflowBuilderStateFromPublishedVersion(mostRecentPublishedVersion, publishedVersions);
}

function createWorkflowBuilderStateFromPublishedVersion(
  version: PublishedWorkflowVersion,
  publishedVersions: PublishedWorkflowVersion[],
): WorkflowBuilderInitialState {
  const canvas = toBuilderCanvas(version.graph);

  return {
    currentWorkflowId: version.manifestPreview.workflowId,
    edges: canvas.edges,
    nodes: canvas.nodes,
    publishedVersions,
    selectedNodeId: canvas.selectedNodeId,
    selectedWorkflowVersionId: version.id,
    workflowRuntimeProfile: version.manifestPreview.runtimeProfile,
    workflowTitle: version.graph.name,
  };
}

function getMostRecentPublishedWorkflowVersion(versions: PublishedWorkflowVersion[]): PublishedWorkflowVersion | undefined {
  return [...versions].sort((left, right) => {
    const createdAtOrder = right.createdAt.localeCompare(left.createdAt);

    if (createdAtOrder !== 0) {
      return createdAtOrder;
    }

    const versionOrder = right.version - left.version;

    if (versionOrder !== 0) {
      return versionOrder;
    }

    return right.id.localeCompare(left.id);
  })[0];
}

function getBuilderValidationIssues(
  errors: RuntimeManifestPreview["validation"]["errors"],
  entryRoleId: string | undefined,
  nodes: BuilderNode[],
): BuilderValidationIssue[] {
  const nodeLabelById = new Map(nodes.map((node) => [node.id, node.data.label]));
  const unreachableNodeLabels = errors
    .filter((error) => error.code === "workflow.unreachable_node")
    .map((error) => (error.nodeId !== undefined ? nodeLabelById.get(error.nodeId) ?? error.nodeId : null))
    .filter((label): label is string => label !== null);
  const issues: BuilderValidationIssue[] = [];

  if (unreachableNodeLabels.length > 0) {
    issues.push({
      key: "workflow.unreachable_node-group",
      title: "Reconnect or remove disconnected nodes",
      detail:
        unreachableNodeLabels.length === 1
          ? `${unreachableNodeLabels[0]} is no longer reachable from the entry path.`
          : `${unreachableNodeLabels.join(", ")} are no longer reachable from the entry path.`,
    });
  }

  issues.push(
    ...errors
      .filter((error) => error.code !== "workflow.unreachable_node")
      .map<BuilderValidationIssue>((error) => ({
        key: `${error.code}-${error.nodeId ?? error.edgeId ?? error.message}`,
        title: formatValidationTitle(error.code),
        detail:
          formatValidationDetail(error.code, error.suggestion, error.nodeId, error.edgeId, nodeLabelById) ??
          "Review this step before publishing or opening the sandbox.",
      })),
  );

  if (entryRoleId === undefined && errors.every((error) => error.code !== "workflow.missing_entry")) {
    issues.unshift({
      key: "workflow.entry-agent-missing",
      title: "Connect the entry point to an agent",
      detail: "Calls need a first agent after the entry node before this workflow can run or publish.",
    });
  }

  return issues;
}

type LiveCanvasStatus = "idle" | "connecting" | "active" | "error" | "ended";

interface LiveCanvasNode {
  id: string;
  className?: string | undefined;
  data: Record<string, unknown>;
}

interface LiveCanvasEdge {
  id: string;
  source: string;
  target: string;
  animated?: boolean | undefined;
  className?: string | undefined;
}

export function decorateLiveWorkflowCanvas<TNode extends LiveCanvasNode, TEdge extends LiveCanvasEdge>(input: {
  nodes: TNode[];
  edges: TEdge[];
  liveEvents: LiveSandboxStreamEvent[];
  liveStatus: LiveCanvasStatus;
}): {
  nodes: TNode[];
  edges: TEdge[];
} {
  if (input.liveStatus !== "active") {
    return {
      nodes: input.nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          liveState: "idle",
        },
      })),
      edges: input.edges.map((edge) => ({
        ...edge,
        animated: false,
      })),
    };
  }

  const visitedNodeIds = new Set(
    input.liveEvents
      .map((event) => readLiveEventNodeId(event))
      .filter((nodeId): nodeId is string => nodeId !== undefined),
  );
  const currentNodeId = [...input.liveEvents]
    .reverse()
    .map((event) => readLiveEventNodeId(event))
    .find((nodeId): nodeId is string => nodeId !== undefined);

  return {
    nodes: input.nodes.map((node) => {
      const liveState =
        node.id === currentNodeId
          ? "current"
          : visitedNodeIds.has(node.id)
            ? "visited"
            : "active";

      return {
        ...node,
        className: joinClassNames(
          node.className,
          "builder-node-live",
          liveState === "current" ? "builder-node-live-current" : undefined,
          liveState === "visited" ? "builder-node-live-visited" : undefined,
        ),
        data: {
          ...node.data,
          liveState,
        },
      };
    }),
    edges: input.edges.map((edge) => ({
      ...edge,
      animated: true,
      className: joinClassNames(
        edge.className,
        "workflow-live-edge",
        edge.target === currentNodeId ? "workflow-live-edge-current" : undefined,
      ),
    })),
  };
}

function readLiveEventNodeId(event: LiveSandboxStreamEvent): string | undefined {
  return typeof event.payload.nodeId === "string" ? event.payload.nodeId : undefined;
}

function joinClassNames(...classNames: Array<string | undefined>) {
  return classNames.filter((className): className is string => className !== undefined && className.length > 0).join(" ");
}

export function WorkflowBuilderScreen({
  activeWorkspaceId,
  workspaces,
}: {
  activeWorkspaceId: string;
  workspaces: Workspace[];
}) {
  const [initialBuilderState] = useState(() => createWorkflowBuilderInitialState(activeWorkspaceId));
  const [nodes, setNodes, onNodesChange] = useNodesState<BuilderNode>(initialBuilderState.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<BuilderEdge>(initialBuilderState.edges);
  const [specialistTemplates, setSpecialistTemplates] = useState<SpecialistRoleTemplate[]>(() =>
    loadSpecialistRoleTemplatesForWorkspace(activeWorkspaceId),
  );
  const [currentWorkflowId, setCurrentWorkflowId] = useState(initialBuilderState.currentWorkflowId);
  const [selectedWorkflowVersionId, setSelectedWorkflowVersionId] = useState(initialBuilderState.selectedWorkflowVersionId);
  const [selectedNodeId, setSelectedNodeId] = useState(initialBuilderState.selectedNodeId);
  const [workflowTitle, setWorkflowTitle] = useState(initialBuilderState.workflowTitle);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(activeWorkspaceId);
  const [workflowRuntimeProfile, setWorkflowRuntimeProfile] = useState<RuntimeProfileId>(
    initialBuilderState.workflowRuntimeProfile,
  );
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const [sandboxOpen, setSandboxOpen] = useState(false);
  const [sandboxSource, setSandboxSource] = useState<"draft" | "route">("draft");
  const [sandboxStarting, setSandboxStarting] = useState(false);
  const [sandboxCallerTurn, setSandboxCallerTurn] = useState("I need help with a billing charge on my account.");
  const [sandboxCallerPhone, setSandboxCallerPhone] = useState("+233201110001");
  const [sandboxTelephonyState, setSandboxTelephonyState] = useState<TelephonyStateResponse | null>(null);
  const [sandboxTelephonyLoading, setSandboxTelephonyLoading] = useState(false);
  const [sandboxTelephonyError, setSandboxTelephonyError] = useState<string | null>(null);
  const [selectedSandboxRouteId, setSelectedSandboxRouteId] = useState("");
  const [sandboxRouteResolution, setSandboxRouteResolution] = useState<WorkflowSandboxRouteResolution | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [deletedCanvasSnapshot, setDeletedCanvasSnapshot] = useState<DeletedCanvasSnapshot | null>(null);
  const [publishedVersions, setPublishedVersions] = useState<PublishedWorkflowVersion[]>(
    initialBuilderState.publishedVersions,
  );
  const liveSandbox = useLiveSandboxSession({
    organizationId: tenantId,
    actorUserId: "user-ops-lead",
  });

  const workflowGraph = useMemo(
    () => toWorkflowGraph(currentWorkflowId, nodes, edges, workflowTitle),
    [currentWorkflowId, edges, nodes, workflowTitle],
  );
  const liveCanvas = useMemo(
    () =>
      decorateLiveWorkflowCanvas({
        nodes,
        edges,
        liveEvents: liveSandbox.events,
        liveStatus: liveSandbox.status,
      }),
    [edges, liveSandbox.events, liveSandbox.status, nodes],
  );
  const workflowRuntime = useMemo(
    () => deriveRuntimeFromProfile(workflowRuntimeProfile),
    [workflowRuntimeProfile],
  );
  const validation = useMemo(() => validateWorkflowGraph(workflowGraph), [workflowGraph]);
  const runtimePreview = useMemo(
    () =>
      buildRuntimeManifestPreview({
        tenantId,
        environment,
        workflowId: currentWorkflowId,
        graph: workflowGraph,
        runtime: workflowRuntime,
        runtimeProfile: workflowRuntimeProfile,
        telephonyProvider: draftSandboxTelephonyProvider,
        memory: {
          mode: "scoped",
          retrievalScopes: ["session", "caller", "account"],
          approvalRequired: true,
        },
        budget: temporaryWorkflowBudgetPolicy,
      }),
    [currentWorkflowId, workflowGraph, workflowRuntime, workflowRuntimeProfile],
  );
  const canCompileDraftSandboxManifest = validation.ok && runtimePreview.entryRoleId !== undefined;
  const draftSandboxManifest = useMemo(
    () =>
      canCompileDraftSandboxManifest
        ? compileDraftSandboxRuntimeManifest({
            workflowId: currentWorkflowId,
            tenantId,
            workspaceId: activeWorkspaceId,
            environment,
            createdBy,
            graph: workflowGraph,
            runtime: workflowRuntime,
            runtimeProfile: workflowRuntimeProfile,
            memory: runtimePreview.memory,
            budget: runtimePreview.budget,
          })
        : null,
    [
      activeWorkspaceId,
      canCompileDraftSandboxManifest,
      currentWorkflowId,
      runtimePreview.budget,
      runtimePreview.memory,
      workflowGraph,
      workflowRuntime,
      workflowRuntimeProfile,
    ],
  );
  const entryAgentName = useMemo(
    () => nodes.find((node) => node.data.kind === "agent" && node.data.role !== undefined)?.data.role?.name ?? "Draft agent",
    [nodes],
  );
  const workbench = useMemo(
    () =>
      resolveWorkflowBuilderWorkbench({
        nodes,
        edges,
        selectedNodeId,
      }),
    [edges, nodes, selectedNodeId],
  );
  const selectedNode = workbench.selectedNode;
  const graphValidationIssues = useMemo(
    () => getBuilderValidationIssues(validation.errors, runtimePreview.entryRoleId, nodes),
    [nodes, runtimePreview.entryRoleId, validation.errors],
  );
  const workflowTitleValid = workflowTitle.trim().length > 0;
  const publishNameConflicts = useMemo(
    () =>
      workflowTitleValid
        ? publishedVersions.filter(
            (version) =>
              version.workspaceId === selectedWorkspaceId &&
              normalizeWorkflowName(version.graph.name) === normalizeWorkflowName(workflowTitle),
          )
        : [],
    [publishedVersions, selectedWorkspaceId, workflowTitle, workflowTitleValid],
  );
  const publishNameConflict = publishNameConflicts[0] ?? null;
  const validationIssues = useMemo<BuilderValidationIssue[]>(
    () =>
      workflowTitleValid
        ? graphValidationIssues
        : [
            {
              key: "workflow.name-required",
              title: "Name this workflow",
              detail: "Workflow publishing needs a saved name before the runtime manifest can be created.",
            },
            ...graphValidationIssues,
          ],
    [graphValidationIssues, workflowTitleValid],
  );
  const publishDisabled = validationIssues.length > 0;
  const sandboxTelephonyRoutes = useMemo(
    () =>
      buildWorkflowSandboxTelephonyRoutes({
        state: sandboxTelephonyState,
        workspaceId: activeWorkspaceId,
        versions: publishedVersions,
      }),
    [activeWorkspaceId, publishedVersions, sandboxTelephonyState],
  );
  const selectedSandboxRoute = sandboxTelephonyRoutes.find((route) => route.id === selectedSandboxRouteId) ?? null;
  const selectedSandboxPublishedVersion = useMemo(
    () =>
      selectedSandboxRoute === null
        ? null
        : publishedVersions.find((version) => version.id === selectedSandboxRoute.publishedVersionId) ?? null,
    [publishedVersions, selectedSandboxRoute],
  );
  const specialistOptions = useMemo(
    () =>
      nodes
        .filter((node) => node.data.kind === "agent" && node.data.role !== undefined)
        .map((node) => ({
          id: node.id,
          name: node.data.role?.name ?? node.data.label,
        })),
    [nodes],
  );
  const routeTargetOptions = workbench.routeTargetOptions;
  const fallbackTargetOptions = useMemo(
    () =>
      getConditionFallbackTargetOptions({
        edges,
        nodes,
        selectedNode,
        targets: routeTargetOptions,
      }),
    [edges, nodes, routeTargetOptions, selectedNode],
  );
  const nodeIds = useMemo(() => nodes.map((node) => node.id), [nodes]);
  const selectedSourceKind = selectedNode?.data.kind ?? "entry";
  const selectedNodeAllowsAgent = workbench.actions.addAgent;
  const selectedNodeAllowsTool = workbench.actions.addTool;
  const selectedNodeAllowsHandoff = workbench.actions.addHandoff;
  const selectedNodeAllowsIntentRoute = workbench.actions.addIntentRoute;
  const selectedNodeAllowsEscalation = workbench.actions.addEscalation;
  const selectedNodeAllowsExit = workbench.actions.addExit;
  const selectedNodeAllowsDelete = workbench.actions.deleteSelected;
  const relationshipRepairAvailable = useMemo(
    () => canRepairBuilderRelationships(nodes, edges, validation.errors),
    [edges, nodes, validation.errors],
  );

  useEffect(() => {
    const nextInitialState = createWorkflowBuilderInitialState(activeWorkspaceId);

    setSelectedWorkspaceId(activeWorkspaceId);
    setSpecialistTemplates(loadSpecialistRoleTemplatesForWorkspace(activeWorkspaceId));
    setPublishedVersions(nextInitialState.publishedVersions);
    setCurrentWorkflowId(nextInitialState.currentWorkflowId);
    setSelectedWorkflowVersionId(nextInitialState.selectedWorkflowVersionId);
    setSelectedNodeId(nextInitialState.selectedNodeId);
    setWorkflowTitle(nextInitialState.workflowTitle);
    setWorkflowRuntimeProfile(nextInitialState.workflowRuntimeProfile);
    setNodes(nextInitialState.nodes);
    setEdges(nextInitialState.edges);
    setDeletedCanvasSnapshot(null);
    setSandboxOpen(false);
    setSandboxSource("draft");
    setSandboxRouteResolution(null);
  }, [activeWorkspaceId, setEdges, setNodes]);

  useEffect(() => {
    if (!sandboxOpen || publishedVersions.length === 0) {
      return undefined;
    }

    let cancelled = false;
    setSandboxTelephonyLoading(true);
    setSandboxTelephonyError(null);

    void fetchTelephonyState(tenantId)
      .then((nextState) => {
        if (!cancelled) {
          setSandboxTelephonyState(nextState);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSandboxTelephonyError(
            error instanceof Error ? error.message : "Telephony routes could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSandboxTelephonyLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, publishedVersions.length, sandboxOpen]);

  useEffect(() => {
    if (sandboxTelephonyRoutes.length === 0) {
      setSelectedSandboxRouteId("");
      if (sandboxSource === "route") {
        setSandboxSource("draft");
      }
      return;
    }

    setSelectedSandboxRouteId((currentRouteId) =>
      sandboxTelephonyRoutes.some((route) => route.id === currentRouteId)
        ? currentRouteId
        : sandboxTelephonyRoutes[0]!.id,
    );
  }, [sandboxSource, sandboxTelephonyRoutes]);

  useEffect(() => {
    if (toastMessage === null) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setToastMessage(null), 2600);

    return () => window.clearTimeout(timeoutId);
  }, [toastMessage]);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
  }, []);

  useEffect(() => {
    if (liveSandbox.errorNotice === null) {
      return;
    }

    showToast(liveSandbox.errorNotice.message);
  }, [liveSandbox.errorNotice, showToast]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (connection.source === null || connection.target === null) {
        return;
      }

      setDeletedCanvasSnapshot(null);
      setEdges((currentEdges) => {
        const decision = getBuilderConnectionDecision(nodes, currentEdges, connection);

        if (decision.kind === null) {
          showToast(decision.message);
          return currentEdges;
        }

        return addEdge(
          buildBuilderEdge({
            connection,
            id: buildEdgeId(connection.source!, connection.target!, currentEdges),
            kind: decision.kind,
            sourceHandleRole: decision.sourceHandleRole,
            targetHandleRole: decision.targetHandleRole,
            sourceNode: nodes.find((node) => node.id === connection.source),
          }),
          currentEdges,
        );
      });
    },
    [nodes, setEdges, showToast],
  );

  const onReconnect = useCallback(
    (previousEdge: BuilderEdge, connection: Connection) => {
      if (connection.source === null || connection.target === null) {
        return;
      }

      setDeletedCanvasSnapshot(null);
      setEdges((currentEdges) => {
        const comparableEdges = currentEdges.filter((edge) => edge.id !== previousEdge.id);
        const decision = getBuilderConnectionDecision(nodes, comparableEdges, connection);

        if (decision.kind === null) {
          showToast(decision.message);
          return currentEdges;
        }

        const updatedEdges = reconnectEdge(previousEdge, connection, currentEdges, { shouldReplaceId: false });

        return updatedEdges.map((edge) =>
          edge.id === previousEdge.id
            ? applyBuilderEdgeKind({
                edge: applyBuilderEdgeHandleRoles(edge, decision.sourceHandleRole, decision.targetHandleRole),
                kind: decision.kind,
                sourceNode: nodes.find((node) => node.id === connection.source),
                preserveLabel: previousEdge.data?.kind !== "return",
              })
            : edge,
        );
      });
      setNodes((currentNodes) => syncNodesForReconnectedEdge(currentNodes, previousEdge, connection.source, connection.target));
    },
    [nodes, setEdges, setNodes, showToast],
  );

  const appendLinkedNode = useCallback(
    (nextNode: BuilderNode, label?: string, afterLink?: (edges: BuilderEdge[]) => BuilderEdge[]) => {
      const sourceId =
        selectedNodeId !== undefined && nodes.some((node) => node.id === selectedNodeId)
          ? selectedNodeId
          : "entry";
      const nextNodes = [...nodes, nextNode];

      setDeletedCanvasSnapshot(null);
      setNodes((currentNodes) => [...currentNodes, nextNode]);
      setEdges((currentEdges) => {
        let nextEdges = currentEdges;

        if (
          sourceId !== nextNode.id &&
          !currentEdges.some((edge) => edge.source === sourceId && edge.target === nextNode.id)
        ) {
          const decision = getBuilderPolicyDecision({
            nodes: nextNodes,
            edges: currentEdges,
            sourceId,
            targetId: nextNode.id,
            requestedEdgeKind: "flow",
          });

          if (decision.kind === null) {
            showToast(decision.message);
          } else {
            nextEdges = [
              ...currentEdges,
              applyBuilderEdgeHandleRoles(
                {
                  id: buildEdgeId(sourceId, nextNode.id, currentEdges),
                  source: sourceId,
                  target: nextNode.id,
                  ...(label !== undefined ? { label } : {}),
                },
                decision.sourceHandleRole,
                decision.targetHandleRole,
              ),
            ];
          }
        }

        return afterLink !== undefined ? afterLink(nextEdges) : nextEdges;
      });
      setSelectedNodeId(nextNode.id);
      setInspectorOpen(true);
    },
    [nodes, selectedNodeId, setEdges, setNodes, showToast],
  );

  const addAgent = useCallback(() => {
    if (!canCreateBuilderRelationshipFromKind(selectedSourceKind, "agent")) {
      showToast("Select a node that can hand off to another agent.");
      return;
    }

    const agentNumber = getNextBuilderNodeNumber(nodeIds, "agent-specialist-");
    const id = `agent-specialist-${agentNumber}`;

    appendLinkedNode(
      createBuilderAgentNode({
        id,
        label: "New agent",
        position: { x: 300 + agentNumber * 96, y: 520 },
        role: {
          kind: "custom",
          name: "",
          businessName: "",
          instructions: "",
          defaultModelTier: "cheap",
          languagePolicy: {
            defaultLanguage: "en",
            supportedLanguages: ["en"],
            allowMidCallSwitching: false,
          },
          reusableSpecialist: false,
        },
      }),
    );
  }, [appendLinkedNode, nodeIds, selectedSourceKind, showToast]);

  const addTool = useCallback(() => {
    if (
      selectedNode === undefined ||
      !canCreateBuilderRelationshipFromKind(selectedNode.data.kind, "tool")
    ) {
      showToast("Select an agent before adding a tool.");
      return;
    }

    const toolNumber = getNextBuilderNodeNumber(nodeIds, "tool-node-");
    const catalogItem = toolCatalog[(toolNumber - 1) % toolCatalog.length] ?? defaultToolCatalogItem;
    const toolNode = createBuilderToolNode({
      id: `tool-node-${toolNumber}`,
      label: catalogItem.toolName,
      position: {
        x: selectedNode.position.x,
        y: Math.max(40, selectedNode.position.y - 160 - (toolNumber - 1) * 34),
      },
      toolId: catalogItem.toolId,
      tool: createToolConfigFromCatalogItem(catalogItem),
    });

    setDeletedCanvasSnapshot(null);
    setNodes((currentNodes) => [...currentNodes, toolNode]);
    setEdges((currentEdges) => {
      let nextEdges = currentEdges;
      const callDecision = getBuilderPolicyDecision({
        nodes: [...nodes, toolNode],
        edges: currentEdges,
        sourceId: selectedNode.id,
        targetId: toolNode.id,
        requestedEdgeKind: "flow",
        strictHandleRoles: false,
      });

      if (callDecision.kind === null) {
        showToast(callDecision.message);
        return currentEdges;
      }

      const callEdgeExists = nextEdges.some(
        (edge) =>
          edge.source === selectedNode.id &&
          edge.target === toolNode.id &&
          edge.data?.kind !== "return",
      );
      const resultEdgeExists = nextEdges.some(
        (edge) =>
          edge.source === toolNode.id &&
          edge.target === selectedNode.id &&
          edge.data?.kind === "return",
      );

      if (!callEdgeExists) {
        nextEdges = [
          ...nextEdges,
          applyBuilderEdgeHandleRoles(
            {
              id: buildEdgeId(selectedNode.id, toolNode.id, nextEdges),
              source: selectedNode.id,
              target: toolNode.id,
              label: "tool",
            },
            callDecision.sourceHandleRole,
            callDecision.targetHandleRole,
          ),
        ];
      }

      const companionEdge = callDecision.autoCreateCompanionEdges[0];

      if (!resultEdgeExists && companionEdge !== undefined) {
        const companionSourceNode = companionEdge.source === "target" ? toolNode : selectedNode;
        const companionTargetNode = companionEdge.target === "target" ? toolNode : selectedNode;

        nextEdges = [
          ...nextEdges,
          applyBuilderEdgeKind({
            edge: applyBuilderEdgeHandleRoles(
              {
                id: buildEdgeId(companionSourceNode.id, companionTargetNode.id, nextEdges),
                source: companionSourceNode.id,
                target: companionTargetNode.id,
                ...(companionEdge.condition !== undefined ? { label: companionEdge.condition } : {}),
              },
              companionEdge.sourceHandleRole,
              companionEdge.targetHandleRole,
            ),
            kind: companionEdge.edgeKind,
            sourceNode: companionSourceNode,
            preserveLabel: false,
          }),
        ];
      }

      return nextEdges;
    });
    setSelectedNodeId(toolNode.id);
    setInspectorOpen(true);
  }, [nodeIds, nodes, selectedNode, setEdges, setNodes, showToast]);

  const addHandoff = useCallback(() => {
    if (!canCreateBuilderRelationshipFromKind(selectedSourceKind, "handoff")) {
      showToast("Select an agent or intent route before adding a handoff.");
      return;
    }

    const handoffNumber = getNextBuilderNodeNumber(nodeIds, "handoff-node-");
    const target = specialistOptions.find((option) => option.id !== selectedNodeId) ?? specialistOptions[0];

    appendLinkedNode(
      createBuilderHandoffNode({
        id: `handoff-node-${handoffNumber}`,
        label: target !== undefined ? `${target.name} handoff` : `Handoff ${handoffNumber}`,
        position: { x: 920, y: 180 + handoffNumber * 86 },
        handoff: {
          targetRoleId: target?.id ?? "",
          targetRoleName: target?.name ?? "",
          handoffReason:
            target !== undefined
              ? `Route the call to ${target.name} when specialist handling is required.`
              : "",
        },
      }),
      "handoff",
    );
  }, [appendLinkedNode, nodeIds, selectedNodeId, selectedSourceKind, showToast, specialistOptions]);

  const addCondition = useCallback(() => {
    if (
      selectedNode === undefined ||
      !canCreateBuilderRelationshipFromKind(selectedNode.data.kind, "condition")
    ) {
      showToast("Select an agent before adding an intent route.");
      return;
    }

    const conditionNumber = getNextBuilderNodeNumber(nodeIds, "condition-node-");
    const fallbackTarget = nodes.find((node) => node.data.kind === "end");
    const branchTarget =
      nodes.find((node) => node.data.kind === "handoff") ??
      nodes.find((node) => node.data.kind === "agent" && node.id !== selectedNodeId);

    const conditionNode = createBuilderConditionNode({
      id: `condition-node-${conditionNumber}`,
      label: `Intent route ${conditionNumber}`,
      position: { x: 640, y: 260 + conditionNumber * 76 },
      condition: {
        classifier: { ...defaultIntentRouteClassifier },
        inputWindow: { ...defaultIntentRouteInputWindow },
        branches: [
          buildIntentRouteBranch({
            id: `branch-${conditionNumber}-1`,
            intent: "billing",
            targetNodeId: branchTarget?.id ?? "",
          }),
        ],
        fallbackLabel: "Fallback",
        fallbackTargetNodeId: fallbackTarget?.id ?? "",
      },
    });

    appendLinkedNode(conditionNode, undefined, (currentEdges) =>
      syncConditionNodeEdges(currentEdges, [...nodes, conditionNode], conditionNode.id, conditionNode.data.condition!),
    );
  }, [appendLinkedNode, nodeIds, nodes, selectedNode, selectedNodeId, showToast]);

  const addEscalation = useCallback(() => {
    if (!canCreateBuilderRelationshipFromKind(selectedSourceKind, "human-escalation")) {
      showToast("Select an agent or intent route before adding escalation.");
      return;
    }

    const escalationNumber = getNextBuilderNodeNumber(nodeIds, "human-escalation-");
    const queue = queueOptions[(escalationNumber - 1) % queueOptions.length] ?? defaultQueueOption;

    appendLinkedNode(
      createBuilderEscalationNode({
        id: `human-escalation-${escalationNumber}`,
        label: "Human escalation",
        position: { x: 1180, y: 420 + escalationNumber * 88 },
        escalation: {
          queueId: queue.queueId,
          queueName: queue.queueName,
          fallbackMode: queue.fallbackMode,
          fallbackMessage: "Offer a callback if no operator accepts inside the live queue window.",
        },
      }),
      "human",
    );
  }, [appendLinkedNode, nodeIds, selectedSourceKind, showToast]);

  const addExit = useCallback(() => {
    if (!canCreateBuilderRelationshipFromKind(selectedSourceKind, "end")) {
      showToast("Select an agent or intent route before adding an exit.");
      return;
    }

    const exitNumber = getNextBuilderNodeNumber(nodeIds, "end-node-");

    appendLinkedNode(
      createBuilderEndNode({
        id: `end-node-${exitNumber}`,
        label: `Exit ${exitNumber}`,
        position: { x: 940, y: 440 + exitNumber * 84 },
        end: {
          outcome: "resolved",
          closingMessage: "Close the workflow and end the call after this branch completes.",
        },
      }),
      "exit",
    );
  }, [appendLinkedNode, nodeIds, selectedSourceKind, showToast]);

  const deleteSelected = useCallback(() => {
    if (selectedNode === undefined || selectedNode.data.kind === "entry") {
      return;
    }

    setDeletedCanvasSnapshot({
      nodes,
      edges,
      selectedNodeId,
    });
    const graphAfterDelete = deleteWorkflowNode(workflowGraph, selectedNode.id);
    const remainingNodeIds = new Set(graphAfterDelete.nodes.map((node) => node.id));

    setNodes((currentNodes) => currentNodes.filter((node) => remainingNodeIds.has(node.id)));
    setEdges((currentEdges) =>
      currentEdges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id),
    );
    setSelectedNodeId("entry");
    showToast(`${selectedNode.data.label} deleted. Undo is available.`);
  }, [edges, nodes, selectedNode, selectedNodeId, setEdges, setNodes, showToast, workflowGraph]);

  const undoDelete = useCallback(() => {
    if (deletedCanvasSnapshot === null) {
      return;
    }

    setNodes(deletedCanvasSnapshot.nodes);
    setEdges(deletedCanvasSnapshot.edges);
    setSelectedNodeId(deletedCanvasSnapshot.selectedNodeId);
    setInspectorOpen(true);
    setDeletedCanvasSnapshot(null);
    showToast("Deleted node restored.");
  }, [deletedCanvasSnapshot, setEdges, setNodes, showToast]);

  const clearCanvas = useCallback(() => {
    setNodes([createEntryBuilderNode()]);
    setEdges([]);
    setSelectedNodeId("entry");
    setDeletedCanvasSnapshot(null);
    setSandboxOpen(false);
    setSandboxSource("draft");
    setSandboxStarting(false);
    setSandboxRouteResolution(null);
    setMoreActionsOpen(false);
    void liveSandbox.resetSession();
    showToast("Canvas reset to the entry point.");
  }, [liveSandbox, setEdges, setNodes, showToast]);

  const repairRelationships = useCallback(() => {
    const repairResult = repairBuilderRelationships(nodes, edges);

    if (repairResult.repairCount === 0) {
      showToast("No relationship repairs are available.");
      return;
    }

    setDeletedCanvasSnapshot(null);
    setNodes(repairResult.nodes);
    setEdges(repairResult.edges);
    setSelectedNodeId((currentNodeId) =>
      repairResult.nodes.some((node) => node.id === currentNodeId) ? currentNodeId : "entry",
    );
    setInspectorOpen(true);
    showToast(
      repairResult.repairCount === 1
        ? "One relationship repair applied."
        : `${repairResult.repairCount} relationship repairs applied.`,
    );
  }, [edges, nodes, setEdges, setNodes, showToast]);

  const loadPublishedWorkflow = useCallback((versionId: string) => {
    setSelectedWorkflowVersionId(versionId);

    if (versionId === "__draft__") {
      const blankState = createBlankWorkflowBuilderState(publishedVersions);

      setCurrentWorkflowId(blankState.currentWorkflowId);
      setWorkflowTitle(blankState.workflowTitle);
      setWorkflowRuntimeProfile(blankState.workflowRuntimeProfile);
      setNodes([createEntryBuilderNode()]);
      setEdges([]);
      setSelectedNodeId(blankState.selectedNodeId);
      setDeletedCanvasSnapshot(null);
      setInspectorOpen(true);
      setSandboxOpen(false);
      setSandboxSource("draft");
      setSandboxRouteResolution(null);
      setMoreActionsOpen(false);
      showToast("Started a blank workflow.");
      return;
    }

    const version = publishedVersions.find((candidate) => candidate.id === versionId);

    if (version === undefined) {
      showToast("That workflow is no longer available in this workspace.");
      setSelectedWorkflowVersionId("__draft__");
      return;
    }

    const nextCanvas = toBuilderCanvas(version.graph);

    setCurrentWorkflowId(version.manifestPreview.workflowId);
    setWorkflowTitle(version.graph.name);
    setWorkflowRuntimeProfile(version.manifestPreview.runtimeProfile);
    setNodes(nextCanvas.nodes);
    setEdges(nextCanvas.edges);
    setSelectedNodeId(nextCanvas.selectedNodeId);
    setDeletedCanvasSnapshot(null);
    setInspectorOpen(true);
    setSandboxOpen(false);
    setSandboxSource("draft");
    setSandboxRouteResolution(null);
    setMoreActionsOpen(false);
    showToast(`Loaded ${version.graph.name}.`);
  }, [publishedVersions, setEdges, setNodes, showToast]);

  const openPublishDialog = useCallback(() => {
    setSelectedWorkspaceId(activeWorkspaceId);
    setPublishDialogOpen(true);
  }, [activeWorkspaceId]);

  const publishDraft = useCallback(() => {
    if (publishDisabled) {
      return;
    }

    const title = workflowTitle.trim();

    if (title.length === 0) {
      showToast("Name the workflow before publishing.");
      return;
    }

    const overwriteWorkflowIds = Array.from(
      new Set(publishNameConflicts.map((version) => version.manifestPreview.workflowId)),
    );
    const publishWorkflowId = publishNameConflict?.manifestPreview.workflowId ?? currentWorkflowId;
    const existingVersionsForPublish =
      publishNameConflict === null
        ? publishedVersions
        : publishedVersions.filter((version) => version.manifestPreview.workflowId === publishWorkflowId);
    const graph = toWorkflowGraph(publishWorkflowId, nodes, edges, title);
    const publishedVersion = publishWorkflowVersion({
      workflowId: publishWorkflowId,
      tenantId,
      workspaceId: selectedWorkspaceId,
      environment,
      createdBy,
      graph,
      existingVersions: existingVersionsForPublish,
      runtime: workflowRuntime,
      runtimeProfile: workflowRuntimeProfile,
      telephonyProvider: draftSandboxTelephonyProvider,
      memory: runtimePreview.memory,
      budget: runtimePreview.budget,
    });
    const nextPublishedVersions = [
      ...publishedVersions.filter(
        (version) =>
          version.id !== publishedVersion.id &&
          !overwriteWorkflowIds.includes(version.manifestPreview.workflowId),
      ),
      publishedVersion,
    ].sort(comparePublishedWorkflowVersions);

    setCurrentWorkflowId(publishWorkflowId);
    setWorkflowTitle(title);
    setSelectedWorkflowVersionId(publishedVersion.id);
    setPublishedVersions(nextPublishedVersions);
    savePublishedWorkflowVersion(publishedVersion, { replaceWorkflowIds: overwriteWorkflowIds });
    setPublishDialogOpen(false);
    showToast(publishNameConflict === null ? `Published ${graph.name}.` : `Overwrote ${graph.name}.`);
  }, [currentWorkflowId, edges, nodes, publishDisabled, publishNameConflict, publishNameConflicts, publishedVersions, runtimePreview.budget, runtimePreview.memory, selectedWorkspaceId, showToast, workflowRuntime, workflowRuntimeProfile, workflowTitle]);

  const openDraftSandbox = useCallback(() => {
    if (validationIssues.length > 0) {
      showToast("Fix the validation items in the inspector before opening the sandbox.");
      return;
    }

    setSandboxOpen(true);
    setSandboxSource("draft");
    setSandboxRouteResolution(null);
    setMoreActionsOpen(false);
    showToast("Draft sandbox ready.");
  }, [showToast, validationIssues.length]);

  const startDraftSandbox = useCallback((mode: "typed" | "voice") => {
    if (draftSandboxManifest === null) {
      showToast("Validate the draft before starting the live sandbox.");
      return;
    }

    setSandboxSource("draft");
    setSandboxStarting(true);
    setSandboxRouteResolution(null);

    void liveSandbox
      .startSession({
        workspaceId: activeWorkspaceId,
        source: "draft",
        inputMode: mode,
        entryRoleId: draftSandboxManifest.entryRoleId,
        manifest: draftSandboxManifest,
      })
      .then((started) => {
        if (started) {
          showToast(mode === "voice" ? "Draft voice sandbox started." : "Typed draft run started.");
        }
      })
      .finally(() => {
        setSandboxStarting(false);
      });
  }, [activeWorkspaceId, draftSandboxManifest, liveSandbox, showToast]);

  const startRoutedSandbox = useCallback(async (mode: "typed" | "voice") => {
    if (selectedSandboxRoute === null || selectedSandboxPublishedVersion === null) {
      showToast("Assign a published phone number on Calls before running the routed path.");
      return;
    }

    setSandboxSource("route");
    setSandboxStarting(true);

    try {
      const routedManifest = compilePublishedSandboxRuntimeManifest(selectedSandboxPublishedVersion);
      const callSid = `CA-workflow-route-${Date.now()}`;
      const response = await dispatchInboundTelephonyTestViaApi({
        organizationId: tenantId,
        toPhoneNumber: selectedSandboxRoute.phoneNumber,
        fromPhoneNumber: sandboxCallerPhone,
        callSid,
      });
      const session =
        response.state.executionSessions?.find((candidate) => candidate.dispatchId === response.dispatch.id) ?? null;
      const command =
        response.state.executionCommands?.find((candidate) => candidate.dispatchId === response.dispatch.id) ?? null;

      setSandboxTelephonyState(response.state);
      setSandboxRouteResolution({
        route: selectedSandboxRoute,
        dispatch: response.dispatch,
        session,
        command,
      });
      if (response.dispatch.disposition !== "blocked") {
        const started = await liveSandbox.startSession({
          workspaceId: activeWorkspaceId,
          source: "published",
          inputMode: mode,
          entryRoleId: routedManifest.entryRoleId,
          manifest: routedManifest,
        });
        if (!started) {
          return;
        }
      }
      showToast(mode === "voice" ? "Routed voice sandbox started." : "Typed routed sandbox started.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The routed sandbox could not be started.");
    } finally {
      setSandboxStarting(false);
    }
  }, [activeWorkspaceId, liveSandbox, sandboxCallerPhone, selectedSandboxPublishedVersion, selectedSandboxRoute, showToast]);

  const sendSandboxTurn = useCallback(() => {
    const callerText = sandboxCallerTurn.trim();

    if (callerText.length === 0 || liveSandbox.status !== "active") {
      return;
    }

    liveSandbox.sendTextTurn({
      transcript: callerText,
      callPhase: "discovery",
    });
    showToast(sandboxSource === "route" ? "Caller turn sent through the routed number." : "Caller turn sent through the draft.");
  }, [liveSandbox, sandboxCallerTurn, sandboxSource, showToast]);

  const updateSelectedRole = useCallback(
    (patch: Partial<AgentRoleNodeConfig>) => {
      if (selectedNode?.data.kind !== "agent" || selectedNode.data.role === undefined) {
        return;
      }

      const currentRole = selectedNode.data.role;
      const nextRole = {
        ...currentRole,
        ...patch,
        languagePolicy: {
          ...currentRole.languagePolicy,
          ...(patch.languagePolicy ?? {}),
        },
      };

      setDeletedCanvasSnapshot(null);
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === selectedNode.id
            ? createBuilderAgentNode({
                id: node.id,
                label: nextRole.name || node.data.label,
                position: node.position,
                role: nextRole,
              })
            : node,
        ),
      );
    },
    [selectedNode, setNodes],
  );

  const applyTemplateToSelectedRole = useCallback(
    (templateId: string) => {
      if (selectedNode?.data.kind !== "agent" || templateId.length === 0) {
        return;
      }

      const template = specialistTemplates.find((candidate) => candidate.id === templateId);

      if (template === undefined) {
        return;
      }

      const nextRole = applySpecialistRoleTemplate(template);

      setDeletedCanvasSnapshot(null);
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === selectedNode.id
            ? createBuilderAgentNode({
                id: node.id,
                label: nextRole.name || node.data.label,
                position: node.position,
                role: nextRole,
              })
            : node,
        ),
      );
      showToast(`${template.name} template applied.`);
    },
    [selectedNode, setNodes, showToast, specialistTemplates],
  );

  const saveSelectedSpecialistTemplate = useCallback(() => {
    if (selectedNode?.data.kind !== "agent" || selectedNode.data.role === undefined) {
      return;
    }

    const now = new Date().toISOString();
    const existingTemplate = specialistTemplates.find(
      (template) =>
        template.id === selectedNode.data.role?.specialistTemplateId ||
        template.name.trim().toLocaleLowerCase() === selectedNode.data.role?.name.trim().toLocaleLowerCase(),
    );
    const template =
      existingTemplate === undefined
        ? createSpecialistRoleTemplate({
            id: `specialist-template-${selectedNode.id}`,
            workspaceId: activeWorkspaceId,
            role: selectedNode.data.role,
            createdAt: now,
            existingTemplates: specialistTemplates,
          })
        : updateSpecialistRoleTemplate(existingTemplate, {
            role: selectedNode.data.role,
            updatedAt: now,
          });
    const nextRole = applySpecialistRoleTemplate(template);

    setSpecialistTemplates((currentTemplates) => {
      const nextTemplates = currentTemplates.some((candidate) => candidate.id === template.id)
        ? currentTemplates.map((candidate) => (candidate.id === template.id ? template : candidate))
        : [...currentTemplates, template];

      saveSpecialistRoleTemplatesForWorkspace(activeWorkspaceId, nextTemplates);

      return nextTemplates;
    });
    setDeletedCanvasSnapshot(null);
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === selectedNode.id
          ? createBuilderAgentNode({
              id: node.id,
              label: nextRole.name || node.data.label,
              position: node.position,
              role: nextRole,
            })
          : node,
      ),
    );
    showToast(`${template.name} saved as a reusable specialist.`);
  }, [activeWorkspaceId, selectedNode, setNodes, showToast, specialistTemplates]);

  const updateSelectedTool = useCallback(
    (patch: ToolInspectorPatch) => {
      if (selectedNode?.data.kind !== "tool" || selectedNode.data.tool === undefined) {
        return;
      }

      const currentTool = selectedNode.data.tool;
      const { toolId: patchedToolId, clearConnection = false, request, ...toolPatch } = patch;
      const nextToolId = patchedToolId ?? selectedNode.data.toolId ?? defaultToolCatalogItem.toolId;
      const nextTool: ToolNodeConfig = {
        ...currentTool,
        ...toolPatch,
        request: request ?? currentTool.request,
      };

      if (clearConnection) {
        delete nextTool.integrationConnectionId;
        delete nextTool.integrationLabel;
        nextTool.connectionStatus = "missing";
      }

      setDeletedCanvasSnapshot(null);
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === selectedNode.id
            ? createBuilderToolNode({
                id: node.id,
                label: nextTool.toolName || node.data.label,
                position: node.position,
                toolId: nextToolId,
                tool: nextTool,
              })
            : node,
        ),
      );
    },
    [selectedNode, setNodes],
  );

  const updateSelectedHandoff = useCallback(
    (patch: Partial<BuilderNodeData["handoff"]>) => {
      if (selectedNode?.data.kind !== "handoff" || selectedNode.data.handoff === undefined) {
        return;
      }

      const nextHandoff = {
        ...selectedNode.data.handoff,
        ...patch,
      };

      setDeletedCanvasSnapshot(null);
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === selectedNode.id
            ? createBuilderHandoffNode({
                id: node.id,
                label: nextHandoff.targetRoleName ? `${nextHandoff.targetRoleName} handoff` : node.data.label,
                position: node.position,
                handoff: nextHandoff,
              })
            : node,
        ),
      );
    },
    [selectedNode, setNodes],
  );

  const applyTemplateToSelectedHandoff = useCallback(
    (templateId: string) => {
      if (selectedNode?.data.kind !== "handoff" || templateId.length === 0) {
        return;
      }

      const template = specialistTemplates.find((candidate) => candidate.id === templateId);
      const targetNode = nodes.find(
        (node) =>
          node.data.kind === "agent" &&
          (node.data.role?.specialistTemplateId === templateId || node.data.role?.name === template?.name),
      );

      if (template === undefined || targetNode === undefined) {
        return;
      }

      updateSelectedHandoff({
        targetRoleId: targetNode.id,
        targetRoleName: targetNode.data.role?.name ?? template.name,
      });
      showToast(`${template.name} selected for handoff.`);
    },
    [nodes, selectedNode, showToast, specialistTemplates, updateSelectedHandoff],
  );

  const updateSelectedCondition = useCallback(
    (nextCondition: ConditionNodeConfig) => {
      if (selectedNode?.data.kind !== "condition") {
        return;
      }

      setDeletedCanvasSnapshot(null);
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === selectedNode.id
            ? createBuilderConditionNode({
                id: node.id,
                label: node.data.label,
                position: node.position,
                condition: nextCondition,
              })
            : node,
        ),
      );
      setEdges((currentEdges) => syncConditionNodeEdges(currentEdges, nodes, selectedNode.id, nextCondition));
    },
    [nodes, selectedNode, setEdges, setNodes],
  );

  const addConditionBranch = useCallback(() => {
    if (selectedNode?.data.kind !== "condition" || selectedNode.data.condition === undefined) {
      return;
    }

    const nextBranchNumber = selectedNode.data.condition.branches.length + 1;
    const nextTarget = routeTargetOptions[0];
    const nextIntent =
      conditionIntentOptions.find(
        (option) =>
          !selectedNode.data.condition?.branches.some(
            (branch) => getIntentValueFromExpression(branch.expression) === option.value,
          ),
      ) ?? conditionIntentOptions[0]!;

    updateSelectedCondition({
      ...selectedNode.data.condition,
      branches: [
        ...selectedNode.data.condition.branches,
        buildIntentRouteBranch({
          id: `branch-${selectedNode.id}-${nextBranchNumber}`,
          intent: nextIntent.value,
          targetNodeId: nextTarget?.id ?? "",
        }),
      ],
    });
  }, [routeTargetOptions, selectedNode, updateSelectedCondition]);

  const deleteConditionBranch = useCallback(
    (branchId: string) => {
      if (selectedNode?.data.kind !== "condition" || selectedNode.data.condition === undefined) {
        return;
      }

      updateSelectedCondition({
        ...selectedNode.data.condition,
        branches: selectedNode.data.condition.branches.filter((branch) => branch.id !== branchId),
      });
    },
    [selectedNode, updateSelectedCondition],
  );

  const updateSelectedEscalation = useCallback(
    (patch: Partial<HumanEscalationNodeConfig>) => {
      if (selectedNode?.data.kind !== "human-escalation" || selectedNode.data.escalation === undefined) {
        return;
      }

      const nextEscalation = {
        ...selectedNode.data.escalation,
        ...patch,
      };

      setDeletedCanvasSnapshot(null);
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === selectedNode.id
            ? createBuilderEscalationNode({
                id: node.id,
                label: node.data.label,
                position: node.position,
                escalation: nextEscalation,
              })
            : node,
        ),
      );
    },
    [selectedNode, setNodes],
  );

  const updateSelectedEnd = useCallback(
    (patch: Partial<EndNodeConfig>) => {
      if (selectedNode?.data.kind !== "end" || selectedNode.data.end === undefined) {
        return;
      }

      const nextEnd = {
        ...selectedNode.data.end,
        ...patch,
      };

      setDeletedCanvasSnapshot(null);
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === selectedNode.id
            ? createBuilderEndNode({
                id: node.id,
                label: node.data.label,
                position: node.position,
                end: nextEnd,
              })
            : node,
        ),
      );
    },
    [selectedNode, setNodes],
  );

  const closeSandbox = useCallback(() => {
    setSandboxOpen(false);
    setSandboxSource("draft");
    setSandboxStarting(false);
    setSandboxRouteResolution(null);
    setMoreActionsOpen(false);
    showToast("Draft sandbox closed.");
  }, [showToast]);

  const builderGridClassName = [
    "workflow-builder-grid",
    inspectorOpen ? "workflow-builder-grid-inspector-open" : "",
    sandboxOpen ? "workflow-builder-grid-sandbox-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="workflow-page">
      <section className={["workflow-toolbar", sandboxOpen ? "workflow-toolbar-collapsed" : ""].filter(Boolean).join(" ")}>
        <div className="workflow-actions">
          <label className="workflow-toolbar-select workflow-picker">
            <span className="sr-only">Workflow</span>
            <select
              aria-label="Workflow"
              value={selectedWorkflowVersionId}
              onChange={(event) => loadPublishedWorkflow(event.target.value)}
            >
              <option value="__draft__">{workflowTitle.trim().length > 0 ? workflowTitle : "Untitled workflow"}</option>
            {publishedVersions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.graph.name}
              </option>
            ))}
          </select>
        </label>
          <label className="workflow-toolbar-select">
            <span className="sr-only">Workflow runtime profile</span>
            <select
              aria-label="Workflow runtime profile"
              value={workflowRuntimeProfile}
              onChange={(event) => setWorkflowRuntimeProfile(event.target.value as RuntimeProfileId)}
            >
              {runtimeProfileOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="workflow-button"
            type="button"
            disabled={!selectedNodeAllowsAgent}
            title={selectedNodeAllowsAgent ? undefined : "Select a node that can hand off to another agent"}
            onClick={addAgent}
          >
            <Plus size={15} />
            <span>Agent</span>
          </button>
          <button
            className="workflow-button"
            type="button"
            disabled={!selectedNodeAllowsTool}
            title={selectedNodeAllowsTool ? undefined : "Select an agent to add a tool"}
            onClick={addTool}
          >
            <KeyRound size={15} />
            <span>Tool</span>
          </button>
          <button
            className="workflow-button"
            type="button"
            disabled={!selectedNodeAllowsHandoff}
            title={selectedNodeAllowsHandoff ? undefined : "Select an agent or intent route to add a handoff"}
            onClick={addHandoff}
          >
            <Handshake size={15} />
            <span>Handoff</span>
          </button>
          {sandboxOpen ? (
            <div className="workflow-more-actions">
              <button
                className="workflow-button"
                type="button"
                aria-label="More workflow actions"
                aria-expanded={moreActionsOpen}
                aria-haspopup="menu"
                onClick={() => setMoreActionsOpen((current) => !current)}
              >
                <MoreHorizontal size={15} />
                <span>More</span>
              </button>
              {moreActionsOpen ? (
                <div className="workflow-more-menu" role="menu">
                  <button role="menuitem" type="button" onClick={() => {
                    addCondition();
                    setMoreActionsOpen(false);
                  }} disabled={!selectedNodeAllowsIntentRoute}>
                    <GitBranch size={14} />
                    <span>Intent route</span>
                  </button>
                  <button role="menuitem" type="button" onClick={() => {
                    addEscalation();
                    setMoreActionsOpen(false);
                  }} disabled={!selectedNodeAllowsEscalation}>
                    <Headphones size={14} />
                    <span>Escalation</span>
                  </button>
                  <button role="menuitem" type="button" onClick={() => {
                    addExit();
                    setMoreActionsOpen(false);
                  }} disabled={!selectedNodeAllowsExit}>
                    <PhoneOff size={14} />
                    <span>Exit</span>
                  </button>
                  <button role="menuitem" type="button" onClick={() => {
                    clearCanvas();
                    setMoreActionsOpen(false);
                  }}>
                    <Trash2 size={14} />
                    <span>Clear canvas</span>
                  </button>
                  <button role="menuitem" type="button" disabled={!selectedNodeAllowsDelete} onClick={() => {
                    deleteSelected();
                    setMoreActionsOpen(false);
                  }}>
                    <Trash2 size={14} />
                    <span>Delete selected</span>
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <>
            <button
              className="workflow-button"
              type="button"
              disabled={!selectedNodeAllowsIntentRoute}
              title={selectedNodeAllowsIntentRoute ? undefined : "Select an agent to add an intent route"}
              onClick={addCondition}
            >
              <GitBranch size={15} />
              <span>Intent route</span>
            </button>
              <button
                className="workflow-button"
                type="button"
                disabled={!selectedNodeAllowsEscalation}
                title={selectedNodeAllowsEscalation ? undefined : "Select an agent or intent route to add escalation"}
                onClick={addEscalation}
              >
                <Headphones size={15} />
                <span>Escalation</span>
              </button>
              <button
                className="workflow-button"
                type="button"
                disabled={!selectedNodeAllowsExit}
                title={selectedNodeAllowsExit ? undefined : "Select an agent or intent route to add an exit"}
                onClick={addExit}
              >
                <PhoneOff size={15} />
                <span>Exit</span>
              </button>
              <button className="workflow-button" type="button" onClick={clearCanvas}>
                <Trash2 size={15} />
                <span>Clear canvas</span>
              </button>
              <button className="workflow-button" type="button" onClick={deleteSelected} disabled={!selectedNodeAllowsDelete}>
                <Trash2 size={15} />
                <span>Delete selected</span>
              </button>
            </>
          )}
          {deletedCanvasSnapshot !== null ? (
            <button className="workflow-button" type="button" onClick={undoDelete}>
              <RotateCcw size={15} />
              <span>Undo delete</span>
            </button>
          ) : null}
          <button className="workflow-button workflow-button-primary" type="button" disabled={publishDisabled} onClick={openPublishDialog}>
            Publish
          </button>
          <button className="workflow-button workflow-button-success" type="button" disabled={publishDisabled} onClick={openDraftSandbox}>
            <Play size={15} />
            <span>Run in sandbox</span>
          </button>
          <div
            className={[
              "workflow-validation-chip",
              validationIssues.length === 0 ? "workflow-validation-chip-ok" : "workflow-validation-chip-error",
            ].join(" ")}
            role="status"
            aria-label="Workflow validation status"
          >
            {validationIssues.length === 0 ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            <span>{validationIssues.length === 0 ? "Ready" : `${validationIssues.length} issues`}</span>
          </div>
        </div>
      </section>

      <section className={builderGridClassName}>
        <div className="workflow-canvas-shell surface-card">
          <ReactFlow
            nodes={liveCanvas.nodes}
            edges={liveCanvas.edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onReconnect={onReconnect}
            connectionMode={ConnectionMode.Loose}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id);
              setInspectorOpen(true);
            }}
            fitView
            minZoom={0.42}
            maxZoom={1.3}
            defaultEdgeOptions={{
              type: "smoothstep",
              animated: false,
            }}
          >
            <Background gap={22} size={1} />
            <MiniMap
              pannable
              zoomable
              nodeStrokeWidth={2}
              nodeColor={(node) => getBuilderNodeAccent(getMiniMapNodeKind(node)).minimap}
              nodeStrokeColor={(node) => getBuilderNodeAccent(getMiniMapNodeKind(node)).accent}
              style={{ width: 118, height: 76 }}
            />
            <Controls position="bottom-left" />
          </ReactFlow>
        </div>

        {inspectorOpen ? (
        <aside className="workflow-inspector surface-card" aria-label="Selected node inspector">
          <div className="workflow-panel-heading">
            <div>
              <div className="eyebrow-copy">Inspector</div>
              <div className="workflow-panel-title">{selectedNode?.data.label ?? "No node selected"}</div>
            </div>
            <button className="workflow-icon-button" type="button" aria-label="Close inspector" onClick={() => setInspectorOpen(false)}>
              <X size={16} />
            </button>
          </div>

          {selectedNode?.data.kind === "agent" && selectedNode.data.role !== undefined ? (
            <AgentRoleInspector
              role={selectedNode.data.role}
              templates={specialistTemplates}
              workflowRuntimeProfile={workflowRuntimeProfile}
              onApplyTemplate={applyTemplateToSelectedRole}
              onChange={updateSelectedRole}
              onSaveTemplate={saveSelectedSpecialistTemplate}
            />
          ) : null}
          {selectedNode?.data.kind === "tool" && selectedNode.data.tool !== undefined ? (
            <ToolInspector
              tool={selectedNode.data.tool}
              toolId={selectedNode.data.toolId ?? defaultToolCatalogItem.toolId}
              onChange={updateSelectedTool}
            />
          ) : null}
          {selectedNode?.data.kind === "handoff" && selectedNode.data.handoff !== undefined ? (
            <HandoffInspector
              handoff={selectedNode.data.handoff}
              specialists={specialistOptions}
              templates={specialistTemplates}
              onApplyTemplate={applyTemplateToSelectedHandoff}
              onChange={updateSelectedHandoff}
            />
          ) : null}
          {selectedNode?.data.kind === "condition" && selectedNode.data.condition !== undefined ? (
            <ConditionInspector
              condition={selectedNode.data.condition}
              fallbackTargets={fallbackTargetOptions}
              targets={routeTargetOptions}
              onChange={updateSelectedCondition}
              onAddBranch={addConditionBranch}
              onDeleteBranch={deleteConditionBranch}
            />
          ) : null}
          {selectedNode?.data.kind === "human-escalation" && selectedNode.data.escalation !== undefined ? (
            <EscalationInspector escalation={selectedNode.data.escalation} onChange={updateSelectedEscalation} />
          ) : null}
          {selectedNode?.data.kind === "end" && selectedNode.data.end !== undefined ? (
            <EndInspector end={selectedNode.data.end} onChange={updateSelectedEnd} />
          ) : null}
          {selectedNode === undefined ||
          (selectedNode.data.kind !== "agent" &&
            selectedNode.data.kind !== "tool" &&
            selectedNode.data.kind !== "handoff" &&
            selectedNode.data.kind !== "condition" &&
            selectedNode.data.kind !== "human-escalation" &&
            selectedNode.data.kind !== "end") ? (
            <NodeSummary node={selectedNode} />
          ) : null}

          <div className="workflow-validation-panel">
            <div className="workflow-validation-head">
              <div>
                <div className="eyebrow-copy">Validation</div>
              <div className="workflow-panel-title">{validationIssues.length === 0 ? "Ready" : "Needs attention"}</div>
            </div>
              {validationIssues.length === 0 ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
            </div>
            <div className="workflow-validation-list">
              {validationIssues.length > 0 ? (
                <>
                  {validationIssues.slice(0, 4).map((issue) => (
                    <div key={issue.key} className="workflow-validation-item">
                      <div className="workflow-validation-code">{issue.title}</div>
                      <div>{issue.detail}</div>
                    </div>
                  ))}
                  {relationshipRepairAvailable ? (
                    <button
                      className="workflow-button workflow-validation-repair"
                      type="button"
                      onClick={repairRelationships}
                    >
                      <Wrench size={14} />
                      <span>Repair relationships</span>
                    </button>
                  ) : null}
                </>
              ) : (
                <div className="workflow-validation-item workflow-validation-item-ok">
                  This draft is ready to publish or run in sandbox.
                </div>
              )}
            </div>
          </div>

        </aside>
        ) : null}

        {sandboxOpen ? (
          <WorkflowSandboxDrawer
            callerTurn={sandboxCallerTurn}
            callerPhone={sandboxCallerPhone}
            mode={liveSandbox.inputMode}
            routeOptions={sandboxTelephonyRoutes}
            routeResolution={sandboxRouteResolution}
            sandboxSource={sandboxSource}
            selectedRouteId={selectedSandboxRouteId}
            starting={sandboxStarting}
            telephonyError={sandboxTelephonyError}
            telephonyLoading={sandboxTelephonyLoading}
            liveNote={liveSandbox.note}
            liveEvents={liveSandbox.events}
            lastRoutingDecision={liveSandbox.lastRoutingDecision}
            microphoneState={liveSandbox.microphoneState}
            agentPlaybackActive={liveSandbox.agentPlaybackActive}
            voiceTurnCapturing={liveSandbox.voiceTurnCapturing}
            runtimePreview={runtimePreview}
            status={liveSandbox.status === "active" ? "active" : "idle"}
            transcript={liveSandbox.transcript}
            entryAgentName={entryAgentName}
            workflowTitle={workflowTitle}
            onCallerTurnChange={setSandboxCallerTurn}
            onCallerPhoneChange={setSandboxCallerPhone}
            onClose={closeSandbox}
            onEndSession={() => void liveSandbox.endSession()}
            onResetSession={() => void liveSandbox.resetSession()}
            onRouteChange={setSelectedSandboxRouteId}
            onSendTurn={sendSandboxTurn}
            onSourceChange={setSandboxSource}
            onStartDraft={startDraftSandbox}
            onStartRoute={startRoutedSandbox}
          />
        ) : null}
      </section>

      {publishDialogOpen ? (
        <div className="workflow-dialog-backdrop" role="presentation">
          <section className="workflow-dialog surface-card" role="dialog" aria-modal="true" aria-label="Publish workflow">
            <div className="workflow-dialog-header">
              <div>
                <div className="eyebrow-copy">Publish</div>
                <div className="workflow-panel-title">Workflow release</div>
              </div>
              <button className="workflow-icon-button" type="button" aria-label="Close publish dialog" onClick={() => setPublishDialogOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="workflow-form">
              <div className="workflow-form-field">
                <label htmlFor="publish-workflow-name">Workflow name</label>
                <input
                  id="publish-workflow-name"
                  aria-invalid={workflowTitleValid ? undefined : true}
                  value={workflowTitle}
                  onChange={(event) => setWorkflowTitle(event.target.value)}
                />
              </div>
              {publishNameConflict !== null ? (
                <div className="workflow-muted-panel" role="alert">
                  <div className="workflow-validation-code">Overwrite saved workflow</div>
                  <div>{`A workflow named "${workflowTitle.trim()}" already exists. Overwrite it?`}</div>
                </div>
              ) : null}
              <label>
                <span>Workspace</span>
                <select value={selectedWorkspaceId} onChange={(event) => setSelectedWorkspaceId(event.target.value)}>
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="workflow-dialog-footer">
              <button className="workflow-button" type="button" onClick={() => setPublishDialogOpen(false)}>
                Cancel
              </button>
              <button className="workflow-button workflow-button-primary" type="button" disabled={publishDisabled} onClick={publishDraft}>
                {publishNameConflict === null ? "Publish workflow" : "Overwrite workflow"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {toastMessage !== null ? (
        <div className="workflow-toast" role="status" aria-live="polite">
          {toastMessage}
        </div>
      ) : null}
    </div>
  );
}

function WorkflowSandboxDrawer({
  callerTurn,
  callerPhone,
  agentPlaybackActive,
  entryAgentName,
  liveEvents,
  liveNote,
  lastRoutingDecision,
  microphoneState,
  mode,
  routeOptions,
  routeResolution,
  sandboxSource,
  selectedRouteId,
  starting,
  telephonyError,
  telephonyLoading,
  runtimePreview,
  status,
  transcript,
  voiceTurnCapturing,
  workflowTitle,
  onCallerTurnChange,
  onCallerPhoneChange,
  onClose,
  onEndSession,
  onResetSession,
  onRouteChange,
  onSendTurn,
  onSourceChange,
  onStartDraft,
  onStartRoute,
}: {
  callerTurn: string;
  callerPhone: string;
  agentPlaybackActive: boolean;
  entryAgentName: string;
  liveEvents: LiveSandboxStreamEvent[];
  liveNote: string;
  lastRoutingDecision: {
    tier: string;
    provider?: string | undefined;
    modelId?: string | undefined;
    source: string;
    matchedRuleId?: string | undefined;
    reason: string;
  } | null;
  microphoneState: "idle" | "requesting" | "granted" | "denied" | "unsupported";
  mode: "typed" | "voice";
  routeOptions: WorkflowSandboxTelephonyRoute[];
  routeResolution: WorkflowSandboxRouteResolution | null;
  sandboxSource: "draft" | "route";
  selectedRouteId: string;
  starting: boolean;
  telephonyError: string | null;
  telephonyLoading: boolean;
  runtimePreview: RuntimeManifestPreview;
  status: "idle" | "active";
  transcript: SandboxTranscriptEntry[];
  voiceTurnCapturing: boolean;
  workflowTitle: string;
  onCallerTurnChange: (value: string) => void;
  onCallerPhoneChange: (value: string) => void;
  onClose: () => void;
  onEndSession: () => void;
  onResetSession: () => void;
  onRouteChange: (value: string) => void;
  onSendTurn: () => void;
  onSourceChange: (value: "draft" | "route") => void;
  onStartDraft: (mode: "typed" | "voice") => void;
  onStartRoute: (mode: "typed" | "voice") => Promise<void>;
}) {
  const firstTool = runtimePreview.tools[0];
  const firstRoute = runtimePreview.conditions[0]?.branches[0];
  const runtimeProfileLabel = formatRuntimeProfileLabel(runtimePreview.runtimeProfile);
  const voiceProfileLabel = formatVoiceProfileLabel(runtimePreview.runtimeProfile);
  const selectedRoute = routeOptions.find((route) => route.id === selectedRouteId) ?? null;
  const startPrimaryLabel = sandboxSource === "route" ? "Start routed sandbox" : "Start draft sandbox";
  const startSecondaryLabel = sandboxSource === "route" ? "Use typed route" : "Use typed run";
  const transcriptContextLabel =
    sandboxSource === "route" && selectedRoute !== null ? selectedRoute.phoneNumber : "draft";
  const recentLiveEvents = liveEvents.slice(-6);
  const runtimeDecisionCopy =
    sandboxSource === "route"
      ? routeResolution !== null
        ? `Inbound dispatch resolved ${routeResolution.dispatch.disposition} for ${routeResolution.route.phoneNumber}. ${routeResolution.command?.action ?? formatTelephonyBridgeKindLabel(routeResolution.session?.bridgeKind)} is ready on ${routeResolution.route.connectionLabel}.`
        : selectedRoute !== null
          ? `Start a routed sandbox run to verify ${selectedRoute.phoneNumber} before live traffic reaches ${selectedRoute.workflowLabel}.`
          : "Assign a published route on Calls to simulate the exact phone path from this workflow page."
      : lastRoutingDecision !== null
        ? `${lastRoutingDecision.reason} (${formatWorkflowSandboxModelDecision(lastRoutingDecision)} via ${lastRoutingDecision.source}).`
        : firstRoute !== undefined
          ? `First branch evaluates ${firstRoute.label} before routing to ${firstRoute.targetNodeId}.`
          : "The draft starts at the entry role and follows the current graph validation path.";
  const toolCheckCopy =
    sandboxSource === "route" && selectedRoute !== null
      ? `${selectedRoute.connectionLabel} is routed to ${selectedRoute.workflowLabel} with ${selectedRoute.recordingSummary.toLowerCase()}.`
      : firstTool !== undefined
        ? `${firstTool.toolName} is ${firstTool.integrationConnectionId === undefined ? "missing credentials" : "connected"} and marked ${firstTool.risk} risk.`
        : "No tool nodes are required for this draft path.";

  return (
    <aside className="workflow-sandbox-drawer surface-card" aria-label="Workflow sandbox">
      <div className="workflow-sandbox-header">
        <div>
          <div className="eyebrow-copy">Sandbox</div>
          <div className="workflow-panel-title">Draft test run</div>
        </div>
        <button className="workflow-icon-button" type="button" aria-label="Close workflow sandbox" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div className="workflow-sandbox-summary">
        <div className="workflow-sandbox-title">{workflowTitle}</div>
        <div className="panel-meta">{entryAgentName} - {runtimePreview.runtime}</div>
      </div>

      <div className="workflow-sandbox-source-switch" role="tablist" aria-label="Sandbox path">
        <button
          className={["workflow-sandbox-source-button", sandboxSource === "draft" ? "workflow-sandbox-source-button-active" : ""].filter(Boolean).join(" ")}
          type="button"
          aria-pressed={sandboxSource === "draft"}
          onClick={() => onSourceChange("draft")}
        >
          Draft graph
        </button>
        <button
          className={["workflow-sandbox-source-button", sandboxSource === "route" ? "workflow-sandbox-source-button-active" : ""].filter(Boolean).join(" ")}
          type="button"
          aria-pressed={sandboxSource === "route"}
          disabled={routeOptions.length === 0}
          onClick={() => onSourceChange("route")}
        >
          Routed number
        </button>
      </div>

      <div className="workflow-sandbox-profile-grid">
        <div className="sandbox-inline-metric">
          <span>Runtime profile</span>
          <strong>{runtimeProfileLabel}</strong>
        </div>
        <div className="sandbox-inline-metric">
          <span>Voice</span>
          <strong>{voiceProfileLabel}</strong>
        </div>
      </div>

      {sandboxSource === "route" ? (
        <>
          <label className="workflow-toolbar-select workflow-sandbox-select">
            <span className="sandbox-field-label">Routed phone number</span>
            <select
              aria-label="Routed phone number"
              disabled={routeOptions.length === 0}
              value={selectedRouteId}
              onChange={(event) => onRouteChange(event.target.value)}
            >
              {routeOptions.map((route) => (
                <option key={route.id} value={route.id}>
                  {route.phoneNumber} - {route.workflowLabel}
                </option>
              ))}
            </select>
          </label>

          {telephonyLoading ? (
            <div className="workflow-muted-panel">
              <div className="workflow-validation-code">Loading routes</div>
              <div>Refreshing telephony inventory for this workflow.</div>
            </div>
          ) : null}

          {telephonyError !== null ? (
            <div className="workflow-muted-panel">
              <div className="workflow-validation-code">Route load failed</div>
              <div>{telephonyError}</div>
            </div>
          ) : null}

          {selectedRoute !== null ? (
            <div className="workflow-sandbox-route-grid">
              <div className="sandbox-inline-metric">
                <span>Connection</span>
                <strong>{selectedRoute.connectionLabel}</strong>
              </div>
              <div className="sandbox-inline-metric">
                <span>Provider rail</span>
                <strong>{formatTelephonyRouteRailLabel(selectedRoute)}</strong>
              </div>
              <div className="sandbox-inline-metric">
                <span>Recording</span>
                <strong>{selectedRoute.recordingSummary}</strong>
              </div>
              <div className="sandbox-inline-metric">
                <span>Workflow version</span>
                <strong>{selectedRoute.publishedVersionId}</strong>
              </div>
            </div>
          ) : (
            <div className="workflow-muted-panel">
              <div className="workflow-validation-code">No routed numbers yet</div>
              <div>Publish this workflow and assign a live number on Calls to simulate the exact telephony path here.</div>
            </div>
          )}
        </>
      ) : null}

      <div className="workflow-muted-panel">
        <div className="workflow-validation-code">Live transport</div>
        <div>AssemblyAI streaming STT, control-plane routing, and Cartesia Sonic 3 playback are active for this drawer run.</div>
        <div className="panel-meta">{liveNote}</div>
      </div>

      <div className="workflow-sandbox-actions">
        <button
          className="workflow-button workflow-button-primary"
          type="button"
          disabled={status === "active" || starting || (sandboxSource === "route" && selectedRoute === null)}
          onClick={() => {
            if (sandboxSource === "route") {
              void onStartRoute("voice");
              return;
            }

            onStartDraft("voice");
          }}
        >
          <PhoneCall size={15} />
          <span>{starting ? "Starting route" : startPrimaryLabel}</span>
        </button>
        <button
          className="workflow-button"
          type="button"
          disabled={status === "active" || starting || (sandboxSource === "route" && selectedRoute === null)}
          onClick={() => {
            if (sandboxSource === "route") {
              void onStartRoute("typed");
              return;
            }

            onStartDraft("typed");
          }}
        >
          <Play size={15} />
          <span>{startSecondaryLabel}</span>
        </button>
        <button
          className={status === "active" ? "workflow-button workflow-sandbox-end-call workflow-button-danger" : "workflow-button workflow-sandbox-end-call"}
          type="button"
          disabled={status !== "active"}
          onClick={onEndSession}
        >
          <Power size={15} />
          <span>End call</span>
        </button>
        <button className="workflow-button workflow-sandbox-reset" type="button" onClick={onResetSession}>
          <RotateCcw size={15} />
          <span>Reset sandbox</span>
        </button>
      </div>

      <div className="workflow-sandbox-status-grid">
        <div className="sandbox-inline-metric">
          <span>Status</span>
          <strong>{status === "active" ? "Active" : "Idle"}</strong>
        </div>
        <div className="sandbox-inline-metric">
          <span>Mode</span>
          <strong>{mode === "voice" ? "Voice" : "Typed"}</strong>
        </div>
        <div className="sandbox-inline-metric">
          <span>Microphone</span>
          <strong>{formatWorkflowSandboxMicrophoneState(microphoneState)}</strong>
        </div>
      </div>

      {sandboxSource === "route" ? (
        <label className="sandbox-composer workflow-sandbox-composer">
          <span className="sandbox-field-label">Caller phone</span>
          <input value={callerPhone} onChange={(event) => onCallerPhoneChange(event.target.value)} />
        </label>
      ) : null}

      {mode === "voice" ? (
        <div className="sandbox-voice-capture-row">
          <div className="panel-meta">Voice mode listens continuously and runs the workflow at natural speech endpoints.</div>
          {voiceTurnCapturing ? <VoiceCaptureMeter /> : null}
          <button className="workflow-button workflow-button-primary" type="button" disabled>
            {voiceTurnCapturing ? "Listening" : "Voice idle"}
          </button>
        </div>
      ) : (
        <>
          <label className="sandbox-composer workflow-sandbox-composer">
            <span className="sandbox-field-label">Caller turn</span>
            <textarea value={callerTurn} onChange={(event) => onCallerTurnChange(event.target.value)} />
          </label>

          <button className="workflow-button workflow-button-primary" type="button" disabled={status !== "active" || callerTurn.trim().length === 0} onClick={onSendTurn}>
            Send caller turn
          </button>
        </>
      )}
      {agentPlaybackActive ? <AgentPlaybackMeter /> : null}

      <div className="workflow-sandbox-section">
        <div className="sandbox-pane-header">
          <span>Transcript</span>
          <span>{transcript.length} entries</span>
        </div>
      <div className="workflow-sandbox-transcript" aria-live="polite">
          {transcript.length === 0 ? (
            <div className="sandbox-empty-copy">
              {sandboxSource === "route"
                ? "Start a routed sandbox run to inspect the published number path before live traffic."
                : "Start a draft run to inspect the current graph before publishing."}
            </div>
          ) : null}
          {transcript.map((entry, index) => (
            <article key={entry.id ?? `${entry.speaker}-${index}`} className={`sandbox-transcript-item sandbox-transcript-item-${entry.speaker}`}>
              <div className="sandbox-transcript-meta">
                <span>{entry.speaker === "caller" ? "Caller" : entry.speaker === "agent" ? "Agent" : "System"}</span>
                <span>{entry.at !== undefined ? formatWorkflowSandboxTime(entry.at) : transcriptContextLabel}</span>
              </div>
              <p>{entry.text}</p>
            </article>
          ))}
        </div>
      </div>

      <div className="workflow-sandbox-section">
        <div className="sandbox-pane-header">
          <span>Runtime decision</span>
          <span>{sandboxSource === "route" ? "Telephony route" : runtimePreview.runtime}</span>
        </div>
        <div className="body-copy">{runtimeDecisionCopy}</div>
        {sandboxSource === "draft" && lastRoutingDecision !== null ? (
          <div className="panel-meta mt-3">
            Rule {lastRoutingDecision.matchedRuleId ?? "default"} selected {formatWorkflowSandboxModelDecision(lastRoutingDecision)}.
          </div>
        ) : null}
      </div>

      <div className="workflow-sandbox-section">
        <div className="sandbox-pane-header">
          <span>Tool check</span>
          <span>{sandboxSource === "route" ? "Route posture" : `${runtimePreview.tools.length} tools`}</span>
        </div>
        <div className="body-copy">{toolCheckCopy}</div>
      </div>

      {sandboxSource === "route" && routeResolution !== null ? (
        <div className="workflow-sandbox-section">
          <div className="sandbox-pane-header">
            <span>Route resolution</span>
            <span>{routeResolution.dispatch.disposition}</span>
          </div>
          <div className="workflow-sandbox-route-grid">
            <div className="sandbox-inline-metric">
              <span>Dispatch result</span>
              <strong>{routeResolution.dispatch.reason}</strong>
            </div>
            <div className="sandbox-inline-metric">
              <span>Bridge action</span>
              <strong>{routeResolution.command?.action ?? formatTelephonyBridgeKindLabel(routeResolution.session?.bridgeKind)}</strong>
            </div>
            <div className="sandbox-inline-metric">
              <span>Connection</span>
              <strong>{routeResolution.route.connectionLabel}</strong>
            </div>
            <div className="sandbox-inline-metric">
              <span>Call session</span>
              <strong>{routeResolution.dispatch.callSessionId ?? "Pending"}</strong>
            </div>
          </div>
        </div>
      ) : null}

      {sandboxSource === "route" && routeOptions.length === 0 && !telephonyLoading ? (
        <div className="workflow-sandbox-section">
          <div className="sandbox-pane-header">
            <span>Route checklist</span>
            <span>Calls</span>
          </div>
          <div className="body-copy">
            Publish this workflow, go to Calls, provision or import a number, save the route, then return here to simulate the exact phone path before live traffic.
          </div>
        </div>
      ) : null}
      {sandboxSource === "route" && routeOptions.length > 0 && routeResolution === null ? (
        <div className="workflow-sandbox-section">
          <div className="sandbox-pane-header">
            <span>Route checklist</span>
            <span>Ready</span>
          </div>
          <div className="body-copy">
            This workflow already has a routed number. Start the routed sandbox to verify dispatch, bridge action, and published workflow binding from the same page.
          </div>
        </div>
      ) : null}
      <div className="workflow-sandbox-section">
        <div className="sandbox-pane-header">
          <span>Live events</span>
          <span>{liveEvents.length}</span>
        </div>
        <div className="sandbox-event-list">
          {liveEvents.length === 0 ? (
            <div className="sandbox-empty-copy">Runtime events will stream here as soon as the live session starts.</div>
          ) : null}
          {recentLiveEvents.map((event) => {
            const summary = summarizeLiveSandboxEvent(event);

            return (
              <div key={`${event.sessionId}:${event.sequence}`} className="sandbox-event-row">
                <div>
                  <div className="panel-title">{summary.title}</div>
                  {summary.detail !== undefined ? <div className="panel-meta">{summary.detail}</div> : null}
                  <div className="panel-meta">#{event.sequence} - {formatWorkflowSandboxTime(event.at)}</div>
                </div>
                <span className={`status-pill status-pill-${summary.tone}`}>{summary.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

function VoiceCaptureMeter() {
  return (
    <div className="sandbox-voice-meter" role="status" aria-label="Voice capture active">
      <span className="sandbox-voice-dot" />
      <span className="sandbox-voice-bars" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </span>
      <span>Listening for caller speech</span>
    </div>
  );
}

function AgentPlaybackMeter() {
  return (
    <div className="sandbox-playback-meter" role="status" aria-label="Agent playback active">
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
    </div>
  );
}

function BuilderNodeCard({ data, selected }: NodeProps<BuilderNode>) {
  const Icon = getNodeIcon(data.kind);
  const accent = getBuilderNodeAccent(data.kind);
  const accentStyle = {
    "--builder-node-accent": accent.accent,
    "--builder-node-accent-soft": accent.tint,
  } as CSSProperties;
  const isAgentNode = data.kind === "agent";
  const isToolNode = data.kind === "tool";
  const liveState = data.liveState ?? "idle";
  const sideHandleStyle = { backgroundColor: accent.accent };
  const topCallHandleStyle = { backgroundColor: accent.accent, left: "44%" };
  const topResultHandleStyle = { backgroundColor: accent.accent, left: "56%" };
  const bottomCallHandleStyle = { backgroundColor: accent.accent, left: "44%" };
  const bottomResultHandleStyle = { backgroundColor: accent.accent, left: "56%" };

  return (
    <div
      className={[
        "builder-node-card",
        selected ? "builder-node-card-selected" : "",
        liveState !== "idle" ? "builder-node-card-live" : "",
        liveState === "current" ? "builder-node-card-live-current" : "",
        liveState === "visited" ? "builder-node-card-live-visited" : "",
      ].filter(Boolean).join(" ")}
      style={accentStyle}
    >
      {isAgentNode ? (
        <>
          <Handle
            id={builderFlowTargetHandleId}
            type="target"
            position={Position.Left}
            className="builder-node-handle-flow"
            style={sideHandleStyle}
          />
          <Handle
            id="agent-tool-call-source-top"
            type="source"
            position={Position.Top}
            className="builder-node-handle-tool-call"
            style={topCallHandleStyle}
          />
          <Handle
            id="agent-tool-result-target-top"
            type="target"
            position={Position.Top}
            className="builder-node-handle-tool-result"
            style={topResultHandleStyle}
          />
        </>
      ) : null}
      {data.kind !== "entry" && !isAgentNode && !isToolNode ? (
        <Handle
          id={builderFlowTargetHandleId}
          type="target"
          position={Position.Left}
          className="builder-node-handle-flow"
          style={sideHandleStyle}
        />
      ) : null}
      <div className="builder-node-main">
        <div className="builder-node-icon">
          <Icon size={15} />
        </div>
        <div>
          <div className="builder-node-title">{data.label}</div>
          <div className="builder-node-subtitle">{data.subtitle}</div>
        </div>
      </div>
      <div className="builder-node-footer">
        <span>{getNodeKindLabel(data.kind)}</span>
        <span>{data.badge}</span>
      </div>
      {!isToolNode ? (
        <Handle
          id={builderFlowSourceHandleId}
          type="source"
          position={Position.Right}
          className="builder-node-handle-flow"
          style={sideHandleStyle}
        />
      ) : null}
      {isToolNode ? (
        <>
          <Handle
            id="tool-call-target-bottom"
            type="target"
            position={Position.Bottom}
            className="builder-node-handle-tool-call"
            style={bottomCallHandleStyle}
          />
          <Handle
            id="tool-result-source-bottom"
            type="source"
            position={Position.Bottom}
            className="builder-node-handle-tool-result"
            style={bottomResultHandleStyle}
          />
        </>
      ) : null}
    </div>
  );
}

function AgentRoleInspector({
  role,
  templates,
  workflowRuntimeProfile,
  onApplyTemplate,
  onChange,
  onSaveTemplate,
}: {
  role: AgentRoleNodeConfig;
  templates: SpecialistRoleTemplate[];
  workflowRuntimeProfile: RuntimeProfileId;
  onApplyTemplate: (templateId: string) => void;
  onChange: (patch: Partial<AgentRoleNodeConfig>) => void;
  onSaveTemplate: () => void;
}) {
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const languagePrompts = role.languagePolicy.languagePrompts ?? {};
  const selectedRuntimeProfile = role.runtimeProfileOverride ?? workflowRuntimeProfile;
  const usesPremiumRealtime = selectedRuntimeProfile === "premium-realtime";
  const selectedModelProvider = role.modelProvider ?? "openai";
  const selectedModelId = textModelPresets[selectedModelProvider].includes(role.modelId ?? "")
    ? role.modelId ?? ""
    : "";
  const selectedRealtimeProvider = role.realtimeProvider ?? "openai-realtime";
  const selectedRealtimeModelId = realtimeModelPresets[selectedRealtimeProvider].includes(role.realtimeModelId ?? "")
    ? role.realtimeModelId ?? ""
    : "";
  const agentNameMissing = role.name.trim().length === 0;
  const businessNameMissing = role.businessName.trim().length === 0;
  const instructionsMissing = role.instructions.trim().length === 0;
  const selectedLanguageLabels = languageOptions
    .filter((language) => role.languagePolicy.supportedLanguages.includes(language.value))
    .map((language) => language.label);
  const languageSummary = selectedLanguageLabels.length > 0 ? selectedLanguageLabels.join(", ") : "Select languages";
  const updateSupportedLanguage = (language: string, selected: boolean) => {
    const supportedLanguages = role.languagePolicy.supportedLanguages;
    const nextSupportedLanguages = selected
      ? Array.from(new Set([...supportedLanguages, language]))
      : supportedLanguages.filter((supportedLanguage) => supportedLanguage !== language);

    if (nextSupportedLanguages.length === 0) {
      return;
    }

    onChange({
      languagePolicy: {
        ...role.languagePolicy,
        defaultLanguage: nextSupportedLanguages.includes(role.languagePolicy.defaultLanguage)
          ? role.languagePolicy.defaultLanguage
          : nextSupportedLanguages[0]!,
        supportedLanguages: nextSupportedLanguages,
      },
    });
  };
  const updateRuntimeProfileOverride = (value: string) => {
    const runtimeProfileOverride =
      value === "__inherit__" ? undefined : (value as RuntimeProfileId);
    const nextRuntimeProfile = runtimeProfileOverride ?? workflowRuntimeProfile;

    onChange({
      runtimeProfileOverride,
      ...(nextRuntimeProfile === "premium-realtime"
        ? {}
        : {
            realtimeProvider: undefined,
            realtimeModelId: undefined,
          }),
    });
  };

  return (
    <div className="workflow-form">
      <label>
        <span>Specialist template</span>
        <select value={role.specialistTemplateId ?? ""} onChange={(event) => onApplyTemplate(event.target.value)}>
          <option value="">Select reusable specialist</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name} v{template.version}
            </option>
          ))}
        </select>
      </label>
      <button className="workflow-button" type="button" onClick={onSaveTemplate}>
        Save specialist template
      </button>
      <label>
        <span>Agent name</span>
        <input
          aria-invalid={agentNameMissing ? true : undefined}
          placeholder="Required"
          value={role.name}
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </label>
      <label>
        <span>Business name</span>
        <input
          aria-invalid={businessNameMissing ? true : undefined}
          placeholder="Required"
          value={role.businessName}
          onChange={(event) => onChange({ businessName: event.target.value })}
        />
      </label>
      <label>
        <span>Instructions</span>
        <textarea
          aria-invalid={instructionsMissing ? true : undefined}
          value={role.instructions}
          rows={6}
          onChange={(event) => onChange({ instructions: event.target.value })}
        />
      </label>
      <label>
        <span>Role type</span>
        <select value={role.kind} onChange={(event) => onChange({ kind: event.target.value as AgentRoleKind })}>
          <option value="receptionist">Receptionist</option>
          <option value="support">Support</option>
          <option value="billing">Billing</option>
          <option value="onboarding">Onboarding</option>
          <option value="sales">Sales</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      {!usesPremiumRealtime ? (
        <>
          <label>
            <span>Model tier</span>
            <select value={role.defaultModelTier} onChange={(event) => onChange({ defaultModelTier: event.target.value as ModelTier })}>
              <option value="cheap">Cheap</option>
              <option value="standard">Standard</option>
              <option value="sota">SOTA</option>
            </select>
          </label>
          <label>
            <span>Model provider</span>
            <select
              value={selectedModelProvider}
              onChange={(event) =>
                onChange({
                  modelProvider: event.target.value as TextModelProviderId,
                  modelId: undefined,
                })
              }
            >
              {textModelProviderOptions.map((provider) => (
                <option key={provider.value} value={provider.value}>
                  {provider.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Model</span>
            <select
              value={selectedModelId}
              onChange={(event) => {
                const nextModelId = event.target.value;

                onChange({
                  modelId: nextModelId.length > 0 ? nextModelId : undefined,
                });
              }}
            >
              <option value="">Auto by tier</option>
              {textModelPresets[selectedModelProvider].map((modelId) => (
                <option key={modelId} value={modelId}>
                  {modelId}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}
      <label>
        <span>Runtime profile override</span>
        <select
          value={role.runtimeProfileOverride ?? "__inherit__"}
          onChange={(event) => updateRuntimeProfileOverride(event.target.value)}
        >
          <option value="__inherit__">Inherit workflow</option>
          <option value="cost-optimized">Cost optimized</option>
          <option value="balanced">Balanced</option>
          <option value="premium-realtime">Premium realtime</option>
        </select>
      </label>
      {usesPremiumRealtime ? (
        <>
          <label>
            <span>Realtime provider</span>
            <select
              value={selectedRealtimeProvider}
              onChange={(event) =>
                onChange({
                  realtimeProvider: event.target.value as RealtimeProviderId,
                  realtimeModelId: undefined,
                })
              }
            >
              {realtimeProviderOptions.map((provider) => (
                <option key={provider.value} value={provider.value}>
                  {provider.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Realtime model</span>
            <select
              value={selectedRealtimeModelId}
              onChange={(event) => {
                const nextModelId = event.target.value;

                onChange({
                  realtimeModelId: nextModelId.length > 0 ? nextModelId : undefined,
                });
              }}
            >
              <option value="">Provider default</option>
              {realtimeModelPresets[selectedRealtimeProvider].map((modelId) => (
                <option key={modelId} value={modelId}>
                  {modelId}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}
      <label>
        <span>Default language</span>
        <select
          value={role.languagePolicy.defaultLanguage}
          onChange={(event) =>
            onChange({
              languagePolicy: {
                ...role.languagePolicy,
                defaultLanguage: event.target.value,
              },
            })
          }
        >
          {languageOptions.map((language) => (
            <option key={language.value} value={language.value}>
              {language.label}
            </option>
          ))}
        </select>
      </label>
      <div className="workflow-form-field workflow-language-dropdown">
        <button
          className="workflow-language-trigger"
          type="button"
          aria-expanded={languageMenuOpen}
          aria-haspopup="listbox"
          onClick={() => setLanguageMenuOpen((isOpen) => !isOpen)}
        >
          <span>Supported languages</span>
          <strong>{languageSummary}</strong>
        </button>
        {languageMenuOpen ? (
          <div className="workflow-language-menu" role="listbox" aria-label="Supported languages">
            {languageOptions.map((language) => (
              <label className="workflow-checkbox" key={language.value}>
                <input
                  checked={role.languagePolicy.supportedLanguages.includes(language.value)}
                  type="checkbox"
                  onChange={(event) => updateSupportedLanguage(language.value, event.target.checked)}
                />
                <span>{language.label}</span>
              </label>
            ))}
          </div>
        ) : null}
      </div>
      <label className="workflow-checkbox">
        <input
          checked={role.languagePolicy.allowMidCallSwitching}
          type="checkbox"
          onChange={(event) =>
            onChange({
              languagePolicy: {
                ...role.languagePolicy,
                allowMidCallSwitching: event.target.checked,
              },
            })
          }
        />
        <span>Allow language switching</span>
      </label>
      <label>
        <span>English prompt</span>
        <textarea
          value={languagePrompts.en ?? ""}
          rows={3}
          onChange={(event) =>
            onChange({
              languagePolicy: {
                ...role.languagePolicy,
                languagePrompts: {
                  ...languagePrompts,
                  en: event.target.value,
                },
              },
            })
          }
        />
      </label>
      <label className="workflow-checkbox">
        <input
          checked={role.reusableSpecialist}
          type="checkbox"
          onChange={(event) => onChange({ reusableSpecialist: event.target.checked })}
        />
        <span>Reusable specialist</span>
      </label>
    </div>
  );
}

function ToolInspector({
  tool,
  toolId,
  onChange,
}: {
  tool: ToolNodeConfig;
  toolId: string;
  onChange: (patch: ToolInspectorPatch) => void;
}) {
  const connections = getIntegrationOptions(tool.connector);
  const request = tool.request ?? cloneToolRequest(defaultToolCatalogItem.request);

  return (
    <div className="workflow-form">
      <label>
        <span>Tool action</span>
        <select
          value={toolId}
          onChange={(event) => {
            const nextTool = toolCatalog.find((item) => item.toolId === event.target.value) ?? defaultToolCatalogItem;

            onChange({
              toolId: nextTool.toolId,
              ...createToolConfigFromCatalogItem(nextTool),
            });
          }}
        >
          {toolCatalog.map((item) => (
            <option key={item.toolId} value={item.toolId}>
              {item.toolName}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Connector</span>
        <input value={formatConnectorLabel(tool.connector)} readOnly />
      </label>
      <label>
        <span>Connection</span>
        <select
          value={tool.connectionStatus === "missing" ? "__missing__" : tool.integrationConnectionId ?? tool.connectionStatus}
          onChange={(event) => {
            const selectedValue = event.target.value;
            const connection = connections.find((option) => option.value === selectedValue);

            if (selectedValue === "__missing__" || connection === undefined) {
              onChange({ clearConnection: true });
              return;
            }

            onChange({
              integrationConnectionId: connection.value,
              integrationLabel: connection.label,
              connectionStatus: connection.status,
            });
          }}
        >
          <option value="__missing__">Not connected</option>
          {connections.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>HTTP method</span>
        <select
          value={request.method}
          onChange={(event) =>
            onChange({
              request: {
                ...request,
                method: event.target.value as ToolRequestConfig["method"],
              },
            })
          }
        >
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
          <option value="DELETE">DELETE</option>
        </select>
      </label>
      <label>
        <span>Request URL</span>
        <input
          value={request.url}
          onChange={(event) =>
            onChange({
              request: {
                ...request,
                url: event.target.value,
              },
            })
          }
        />
      </label>
      <label>
        <span>Auth token</span>
        <input
          value={request.authToken}
          onChange={(event) =>
            onChange({
              request: {
                ...request,
                authToken: event.target.value,
              },
            })
          }
        />
      </label>
      <label>
        <span>Headers</span>
        <textarea
          rows={4}
          value={serializeRequestHeaders(request.headers)}
          onChange={(event) =>
            onChange({
              request: {
                ...request,
                headers: parseRequestHeaders(event.target.value),
              },
            })
          }
        />
      </label>
      <label>
        <span>Body template</span>
        <textarea
          rows={4}
          value={request.bodyTemplate ?? ""}
          onChange={(event) =>
            onChange({
              request: {
                ...request,
                bodyTemplate: event.target.value,
              },
            })
          }
        />
      </label>
      <label>
        <span>Risk posture</span>
        <select value={tool.risk} onChange={(event) => onChange({ risk: event.target.value as ToolNodeConfig["risk"] })}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>
      <label className="workflow-checkbox">
        <input
          checked={tool.requiresAuthorization}
          type="checkbox"
          onChange={(event) => onChange({ requiresAuthorization: event.target.checked })}
        />
        <span>Requires account authorization</span>
      </label>
      <label className="workflow-checkbox">
        <input
          checked={tool.requiresHumanApproval}
          type="checkbox"
          onChange={(event) => onChange({ requiresHumanApproval: event.target.checked })}
        />
        <span>Human approval required</span>
      </label>
    </div>
  );
}

function HandoffInspector({
  handoff,
  specialists,
  templates,
  onApplyTemplate,
  onChange,
}: {
  handoff: BuilderNodeData["handoff"];
  specialists: Array<{ id: string; name: string }>;
  templates: SpecialistRoleTemplate[];
  onApplyTemplate: (templateId: string) => void;
  onChange: (patch: Partial<BuilderNodeData["handoff"]>) => void;
}) {
  if (handoff === undefined) {
    return null;
  }

  return (
    <div className="workflow-form">
      <label>
        <span>Template shortcut</span>
        <select value="" onChange={(event) => onApplyTemplate(event.target.value)}>
          <option value="">Select reusable specialist</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name} v{template.version}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Target specialist</span>
        <select
          value={handoff.targetRoleId}
          onChange={(event) => {
            const specialist = specialists.find((option) => option.id === event.target.value);
            onChange({
              targetRoleId: specialist?.id ?? "",
              targetRoleName: specialist?.name ?? "",
            });
          }}
        >
          <option value="">Select specialist</option>
          {specialists.map((specialist) => (
            <option key={specialist.id} value={specialist.id}>
              {specialist.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Reason</span>
        <textarea value={handoff.handoffReason} rows={4} onChange={(event) => onChange({ handoffReason: event.target.value })} />
      </label>
    </div>
  );
}

function ConditionInspector({
  condition,
  fallbackTargets,
  targets,
  onChange,
  onAddBranch,
  onDeleteBranch,
}: {
  condition: ConditionNodeConfig;
  fallbackTargets: WorkflowBuilderRouteTargetOption[];
  targets: WorkflowBuilderRouteTargetOption[];
  onChange: (condition: ConditionNodeConfig) => void;
  onAddBranch: () => void;
  onDeleteBranch: (branchId: string) => void;
}) {
  return (
    <div className="workflow-form">
      <div className="workflow-muted-panel">
        <div className="workflow-summary-row">
          <span>Classifier</span>
          <strong>Gemini Flash Lite</strong>
        </div>
        <div className="workflow-form" style={{ marginTop: 10 }}>
          <label>
            <span>Confidence threshold</span>
            <input
              max="1"
              min="0"
              step="0.05"
              type="number"
              value={condition.classifier?.confidenceThreshold ?? defaultIntentRouteClassifier.confidenceThreshold}
              onChange={(event) =>
                onChange({
                  ...condition,
                  classifier: {
                    ...(condition.classifier ?? defaultIntentRouteClassifier),
                    confidenceThreshold: clampIntentConfidenceThreshold(Number(event.target.value)),
                  },
                })
              }
            />
          </label>
          <label>
            <span>Recent transcript turns</span>
            <input
              max="12"
              min="0"
              step="1"
              type="number"
              value={condition.inputWindow?.recentTranscriptTurns ?? defaultIntentRouteInputWindow.recentTranscriptTurns}
              onChange={(event) =>
                onChange({
                  ...condition,
                  inputWindow: {
                    ...(condition.inputWindow ?? defaultIntentRouteInputWindow),
                    recentTranscriptTurns: Math.max(0, Math.trunc(Number(event.target.value) || 0)),
                  },
                })
              }
            />
          </label>
        </div>
      </div>
      {condition.branches.map((branch, index) => (
        <div key={branch.id} className="workflow-muted-panel">
          <div className="workflow-summary-row">
            <span>Branch {index + 1}</span>
            <strong>{branch.label || "Untitled"}</strong>
          </div>
          <div className="workflow-form" style={{ marginTop: 10 }}>
            <label>
              <span>Label</span>
              <input
                value={branch.label}
                onChange={(event) =>
                  onChange({
                    ...condition,
                    branches: condition.branches.map((currentBranch) =>
                      currentBranch.id === branch.id
                        ? {
                            ...currentBranch,
                            label: event.target.value,
                          }
                        : currentBranch,
                    ),
                  })
                }
              />
            </label>
            <label>
              <span>Intent</span>
              <select
                value={getIntentValueFromBranch(branch)}
                onChange={(event) =>
                  onChange({
                    ...condition,
                    branches: condition.branches.map((currentBranch) =>
                      currentBranch.id === branch.id
                        ? updateIntentRouteBranchIntent(currentBranch, event.target.value)
                        : currentBranch,
                    ),
                  })
                }
              >
                {conditionIntentOptions.map((intent) => (
                  <option key={intent.value} value={intent.value}>
                    {intent.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Branch description</span>
              <textarea
                value={branch.description ?? getConditionIntentDescription(getIntentValueFromBranch(branch))}
                onChange={(event) =>
                  onChange({
                    ...condition,
                    branches: condition.branches.map((currentBranch) =>
                      currentBranch.id === branch.id
                        ? {
                            ...currentBranch,
                            description: event.target.value,
                          }
                        : currentBranch,
                    ),
                  })
                }
              />
            </label>
            <label>
              <span>Examples</span>
              <textarea
                value={(branch.examples ?? getConditionIntentExamples(getIntentValueFromBranch(branch))).join("\n")}
                onChange={(event) =>
                  onChange({
                    ...condition,
                    branches: condition.branches.map((currentBranch) =>
                      currentBranch.id === branch.id
                        ? {
                            ...currentBranch,
                            examples: event.target.value
                              .split("\n")
                              .map((example) => example.trim())
                              .filter((example) => example.length > 0),
                          }
                        : currentBranch,
                    ),
                  })
                }
              />
            </label>
            <label>
              <span>Target</span>
              <select
                value={branch.targetNodeId}
                onChange={(event) =>
                  onChange({
                    ...condition,
                    branches: condition.branches.map((currentBranch) =>
                      currentBranch.id === branch.id
                        ? {
                            ...currentBranch,
                            targetNodeId: event.target.value,
                          }
                        : currentBranch,
                    ),
                  })
                }
              >
                <option value="">Select target</option>
                {targets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="workflow-button" type="button" onClick={() => onDeleteBranch(branch.id)}>
              <Trash2 size={14} />
              <span>Delete branch</span>
            </button>
          </div>
        </div>
      ))}
      <button className="workflow-button" type="button" onClick={onAddBranch}>
        <Plus size={14} />
        <span>Add branch</span>
      </button>
      <label>
        <span>Fallback label</span>
        <input value={condition.fallbackLabel} onChange={(event) => onChange({ ...condition, fallbackLabel: event.target.value })} />
      </label>
      <label>
        <span>Fallback target</span>
        <select
          value={condition.fallbackTargetNodeId}
          onChange={(event) => onChange({ ...condition, fallbackTargetNodeId: event.target.value })}
        >
          <option value="">Select target</option>
          {fallbackTargets.map((target) => (
            <option key={target.id} value={target.id}>
              {target.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function EscalationInspector({
  escalation,
  onChange,
}: {
  escalation: HumanEscalationNodeConfig;
  onChange: (patch: Partial<HumanEscalationNodeConfig>) => void;
}) {
  return (
    <div className="workflow-form">
      <label>
        <span>Queue</span>
        <select
          value={escalation.queueId}
          onChange={(event) => {
            const queue = queueOptions.find((option) => option.queueId === event.target.value);
            onChange({
              queueId: queue?.queueId ?? "",
              queueName: queue?.queueName ?? "",
              fallbackMode: queue?.fallbackMode ?? escalation.fallbackMode,
            });
          }}
        >
          <option value="">Select queue</option>
          {queueOptions.map((queue) => (
            <option key={queue.queueId} value={queue.queueId}>
              {queue.queueName}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Fallback mode</span>
        <select value={escalation.fallbackMode} onChange={(event) => onChange({ fallbackMode: event.target.value as EscalationFallbackMode })}>
          <option value="callback">Callback</option>
          <option value="voicemail">Voicemail</option>
          <option value="ticket">Ticket</option>
        </select>
      </label>
      <label>
        <span>Fallback message</span>
        <textarea value={escalation.fallbackMessage} rows={4} onChange={(event) => onChange({ fallbackMessage: event.target.value })} />
      </label>
    </div>
  );
}

function EndInspector({
  end,
  onChange,
}: {
  end: EndNodeConfig;
  onChange: (patch: Partial<EndNodeConfig>) => void;
}) {
  return (
    <div className="workflow-form">
      <label>
        <span>Outcome</span>
        <select value={end.outcome} onChange={(event) => onChange({ outcome: event.target.value as EndNodeConfig["outcome"] })}>
          <option value="resolved">Resolved</option>
          <option value="voicemail">Voicemail</option>
          <option value="handoff-complete">Handoff complete</option>
          <option value="failed">Failed</option>
        </select>
      </label>
      <label>
        <span>Closing message</span>
        <textarea value={end.closingMessage} rows={4} onChange={(event) => onChange({ closingMessage: event.target.value })} />
      </label>
    </div>
  );
}

function NodeSummary({ node }: { node: BuilderNode | undefined }) {
  if (node === undefined) {
    return <div className="workflow-muted-panel">Select a node to inspect its runtime contract.</div>;
  }

  return (
    <div className="workflow-muted-panel">
      <div className="workflow-summary-row">
        <span>Type</span>
        <strong>{getNodeKindLabel(node.data.kind)}</strong>
      </div>
      <div className="workflow-summary-row">
        <span>Position</span>
        <strong>
          {Math.round(node.position.x)}, {Math.round(node.position.y)}
        </strong>
      </div>
    </div>
  );
}

function createBuilderAgentNode(input: {
  id: string;
  label: string;
  position: { x: number; y: number };
  role: AgentRoleNodeConfig;
}): BuilderNode {
  const workflowNode = createAgentRoleNode(input);
  const role = workflowNode.config["role"] as AgentRoleNodeConfig;

  return {
    id: workflowNode.id,
    type: "builderNode",
    position: workflowNode.position,
      data: {
        kind: "agent",
        label: workflowNode.label,
      badge: formatAgentModelBadge(role),
      subtitle: role.languagePolicy.supportedLanguages.join(" + ") || "No language set",
      role,
    },
  };
}

function loadAllSpecialistRoleTemplates(): SpecialistRoleTemplate[] {
  try {
    const raw = window.localStorage.getItem(specialistTemplatesStorageKey);

    if (raw === null) {
      return [];
    }

    const parsed = JSON.parse(raw);

    return Array.isArray(parsed) ? (parsed as SpecialistRoleTemplate[]) : [];
  } catch {
    return [];
  }
}

function loadSpecialistRoleTemplatesForWorkspace(workspaceId: string): SpecialistRoleTemplate[] {
  const storedTemplates = loadAllSpecialistRoleTemplates().filter((template) => template.workspaceId === workspaceId);
  const defaultTemplates = createDefaultSpecialistRoleTemplatesForWorkspace(workspaceId);
  const storedIds = new Set(storedTemplates.map((template) => template.id));
  const storedNames = new Set(storedTemplates.map((template) => template.name.trim().toLocaleLowerCase()));

  return [
    ...storedTemplates,
    ...defaultTemplates.filter(
      (template) => !storedIds.has(template.id) && !storedNames.has(template.name.trim().toLocaleLowerCase()),
    ),
  ];
}

function createDefaultSpecialistRoleTemplatesForWorkspace(workspaceId: string): SpecialistRoleTemplate[] {
  const roles: Array<{ id: string; role: AgentRoleNodeConfig }> = [
    {
      id: "specialist-template-agent-front-desk",
      role: {
        kind: "receptionist",
        name: "Front desk triage",
        businessName: "Tuzzy Labs",
        instructions:
          "Greet callers, identify intent, collect account context, resolve routine reception requests, and route specialist work cleanly.",
        defaultModelTier: "cheap",
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en", "fr"],
          allowMidCallSwitching: true,
        },
        reusableSpecialist: true,
      },
    },
    {
      id: "specialist-template-agent-billing",
      role: {
        kind: "billing",
        name: "Billing specialist",
        businessName: "Tuzzy Labs",
        instructions:
          "Resolve invoice disputes, explain charges, update billing notes, and escalate manager approvals when high-risk changes are requested.",
        defaultModelTier: "standard",
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en"],
          allowMidCallSwitching: false,
        },
        reusableSpecialist: true,
      },
    },
  ];

  return roles.reduce<SpecialistRoleTemplate[]>(
    (templates, templateRole) => [
      ...templates,
      createSpecialistRoleTemplate({
        id: templateRole.id,
        workspaceId,
        role: templateRole.role,
        createdAt: defaultSpecialistTemplateCreatedAt,
        existingTemplates: templates,
      }),
    ],
    [],
  );
}

function saveSpecialistRoleTemplatesForWorkspace(
  workspaceId: string,
  templates: SpecialistRoleTemplate[],
) {
  const templatesById = new Map(
    loadAllSpecialistRoleTemplates()
      .filter((template) => template.workspaceId !== workspaceId)
      .map((template) => [template.id, template] as const),
  );

  for (const template of templates) {
    templatesById.set(template.id, template);
  }

  window.localStorage.setItem(specialistTemplatesStorageKey, JSON.stringify([...templatesById.values()]));
}

function createBuilderToolNode(input: {
  id: string;
  label: string;
  position: { x: number; y: number };
  toolId: string;
  tool: ToolNodeConfig;
}): BuilderNode {
  const workflowNode = createToolNode(input);
  const tool = workflowNode.config["tool"] as ToolNodeConfig;

  return {
    id: workflowNode.id,
    type: "builderNode",
    position: workflowNode.position,
    data: {
      kind: "tool",
      label: workflowNode.label,
      badge: formatToolBadge(tool),
      subtitle: `${formatConnectorLabel(tool.connector)} - ${tool.request?.method ?? "HTTP"}`,
      tool,
      ...(workflowNode.toolId !== undefined ? { toolId: workflowNode.toolId } : {}),
    },
  };
}

function createToolConfigFromCatalogItem(catalogItem: ToolCatalogItem): ToolNodeConfig & { request: ToolRequestConfig } {
  const defaultConnection = getDefaultIntegrationOption(catalogItem.connector);

  return {
    connector: catalogItem.connector,
    toolName: catalogItem.toolName,
    ...(defaultConnection !== undefined && defaultConnection.status !== "missing"
      ? {
          integrationConnectionId: defaultConnection.value,
          integrationLabel: defaultConnection.label,
        }
      : {}),
    connectionStatus: defaultConnection?.status ?? (catalogItem.requiresAuthorization ? "missing" : "connected"),
    risk: catalogItem.risk,
    requiresAuthorization: catalogItem.requiresAuthorization,
    requiresHumanApproval: catalogItem.requiresHumanApproval,
    request: cloneToolRequest(catalogItem.request),
  };
}

function createBuilderHandoffNode(input: {
  id: string;
  label: string;
  position: { x: number; y: number };
  handoff: BuilderNodeData["handoff"];
}): BuilderNode {
  const workflowNode = createHandoffNode({
    id: input.id,
    label: input.label,
    position: input.position,
    handoff: input.handoff!,
  });
  const handoff = workflowNode.config["handoff"] as BuilderNodeData["handoff"];

  return {
    id: workflowNode.id,
    type: "builderNode",
    position: workflowNode.position,
    data: {
      kind: "handoff",
      label: workflowNode.label,
      badge: handoff?.targetRoleName || "Unassigned",
      subtitle: handoff?.handoffReason || "No handoff reason configured",
      ...(handoff === undefined ? {} : { handoff }),
    },
  };
}

function createBuilderConditionNode(input: {
  id: string;
  label: string;
  position: { x: number; y: number };
  condition: ConditionNodeConfig;
}): BuilderNode {
  const workflowNode = createConditionNode({
    ...input,
    condition: normalizeIntentRouteCondition(input.condition),
  });
  const condition = workflowNode.config["condition"] as ConditionNodeConfig;

  return {
    id: workflowNode.id,
    type: "builderNode",
    position: workflowNode.position,
    data: {
      kind: "condition",
      label: workflowNode.label,
      badge: `${condition.branches.length} branch${condition.branches.length === 1 ? "" : "es"}`,
      subtitle: condition.fallbackLabel ? `${condition.fallbackLabel} fallback` : "Fallback required",
      condition,
    },
  };
}

function createBuilderEscalationNode(input: {
  id: string;
  label: string;
  position: { x: number; y: number };
  escalation: HumanEscalationNodeConfig;
}): BuilderNode {
  const workflowNode = createHumanEscalationNode(input);
  const escalation = workflowNode.config["escalation"] as HumanEscalationNodeConfig;

  return {
    id: workflowNode.id,
    type: "builderNode",
    position: workflowNode.position,
    data: {
      kind: "human-escalation",
      label: workflowNode.label,
      badge: escalation.queueName || "Queue required",
      subtitle: `${capitalize(escalation.fallbackMode)} fallback`,
      escalation,
    },
  };
}

function createBuilderEndNode(input: {
  id: string;
  label: string;
  position: { x: number; y: number };
  end: EndNodeConfig;
}): BuilderNode {
  const workflowNode = createEndNode(input);
  const end = workflowNode.config["end"] as EndNodeConfig;

  return {
    id: workflowNode.id,
    type: "builderNode",
    position: workflowNode.position,
    data: {
      kind: "end",
      label: workflowNode.label,
      badge: capitalize(end.outcome),
      subtitle: "Terminates this route",
      end,
    },
  };
}

function toBuilderCanvas(graph: WorkflowGraph): {
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  selectedNodeId: string;
} {
  const builderNodes = graph.nodes.length > 0
    ? graph.nodes.map(toBuilderNode)
    : [createEntryBuilderNode()];
  const nodesById = new Map(builderNodes.map((node) => [node.id, node] as const));
  const builderEdges = graph.edges.map((edge) => toBuilderEdge(edge, nodesById.get(edge.sourceNodeId)));
  const selectedNodeId =
    builderNodes.find((node) => node.data.kind === "condition")?.id
    ?? builderNodes.find((node) => node.data.kind !== "entry")?.id
    ?? builderNodes[0]?.id
    ?? "entry";

  return {
    nodes: builderNodes,
    edges: builderEdges,
    selectedNodeId,
  };
}

function toBuilderNode(node: WorkflowNode): BuilderNode {
  if (node.kind === "entry") {
    return {
      id: node.id,
      type: "builderNode",
      position: node.position,
      data: {
        kind: "entry",
        label: node.label,
        badge: "Entry",
        subtitle: "Incoming caller",
        config: node.config,
      },
    };
  }

  if (node.kind === "agent") {
    const role = node.config["role"] as AgentRoleNodeConfig | undefined;

    return role === undefined
      ? createGenericBuilderNode(node)
      : createBuilderAgentNode({
          id: node.id,
          label: node.label,
          position: node.position,
          role,
        });
  }

  if (node.kind === "tool") {
    const tool = node.config["tool"] as ToolNodeConfig | undefined;

    return tool === undefined || node.toolId === undefined
      ? createGenericBuilderNode(node)
      : createBuilderToolNode({
          id: node.id,
          label: node.label,
          position: node.position,
          toolId: node.toolId,
          tool,
        });
  }

  if (node.kind === "handoff") {
    const handoff = node.config["handoff"] as BuilderNodeData["handoff"] | undefined;

    return handoff === undefined
      ? createGenericBuilderNode(node)
      : createBuilderHandoffNode({
          id: node.id,
          label: node.label,
          position: node.position,
          handoff,
        });
  }

  if (node.kind === "condition") {
    const condition = node.config["condition"] as ConditionNodeConfig | undefined;

    return condition === undefined
      ? createGenericBuilderNode(node)
      : createBuilderConditionNode({
          id: node.id,
          label: node.label,
          position: node.position,
          condition,
        });
  }

  if (node.kind === "human-escalation") {
    const escalation = node.config["escalation"] as HumanEscalationNodeConfig | undefined;

    return escalation === undefined
      ? createGenericBuilderNode(node)
      : createBuilderEscalationNode({
          id: node.id,
          label: node.label,
          position: node.position,
          escalation,
        });
  }

  if (node.kind === "end") {
    const end = node.config["end"] as EndNodeConfig | undefined;

    return end === undefined
      ? createGenericBuilderNode(node)
      : createBuilderEndNode({
          id: node.id,
          label: node.label,
          position: node.position,
          end,
        });
  }

  return createGenericBuilderNode(node);
}

function createGenericBuilderNode(node: WorkflowNode): BuilderNode {
  return {
    id: node.id,
    type: "builderNode",
    position: node.position,
    data: {
      kind: node.kind,
      label: node.label,
      badge: getNodeKindLabel(node.kind),
      subtitle: "Loaded workflow node",
      config: node.config,
      ...(node.toolId !== undefined ? { toolId: node.toolId } : {}),
    },
  };
}

function toBuilderEdge(edge: WorkflowGraph["edges"][number], sourceNode: BuilderNode | undefined): BuilderEdge {
  return applyBuilderEdgeKind({
    edge: applyBuilderEdgeHandleRoles(
      {
        id: edge.id,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        ...(edge.condition !== undefined ? { label: edge.condition } : {}),
        ...(edge.kind === "return" ? { data: { kind: edge.kind } } : {}),
      },
      edge.sourceHandleRole ?? "flow-source",
      edge.targetHandleRole ?? "flow-target",
    ),
    kind: edge.kind ?? "flow",
    sourceNode,
    preserveLabel: true,
  });
}

function toWorkflowGraph(workflowGraphId: string, nodes: BuilderNode[], edges: BuilderEdge[], name: string): WorkflowGraph {
  return createWorkflowGraph({
    id: workflowGraphId,
    name,
    nodes: nodes.map(toWorkflowNode),
    edges: edges.map((edge) => {
      const workflowEdge = {
        id: edge.id,
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
        ...(edge.data?.kind === "return" ? { kind: edge.data.kind } : {}),
        sourceHandleRole: toWorkflowRelationshipSourceHandleRole(edge.sourceHandle),
        targetHandleRole: toWorkflowRelationshipTargetHandleRole(edge.targetHandle),
      };

      if (typeof edge.label !== "string") {
        return workflowEdge;
      }

      return {
        ...workflowEdge,
        condition: edge.label,
      };
    }),
  });
}

function getConditionFallbackTargetOptions(input: {
  edges: BuilderEdge[];
  nodes: BuilderNode[];
  selectedNode: BuilderNode | undefined;
  targets: WorkflowBuilderRouteTargetOption[];
}): WorkflowBuilderRouteTargetOption[] {
  if (input.selectedNode?.data.kind !== "condition") {
    return input.targets;
  }

  const callerEdge = input.edges.find(
    (edge) => edge.target === input.selectedNode?.id && (edge.data?.kind ?? "flow") === "flow",
  );
  const callerNode =
    callerEdge === undefined
      ? undefined
      : input.nodes.find((node) => node.id === callerEdge.source && node.data.kind === "agent");

  if (callerNode === undefined || input.targets.some((target) => target.id === callerNode.id)) {
    return input.targets;
  }

  return [
    {
      id: callerNode.id,
      label: callerNode.data.label,
      kind: callerNode.data.kind,
    },
    ...input.targets,
  ];
}

function toWorkflowNode(node: BuilderNode): WorkflowNode {
  if (node.data.kind === "agent" && node.data.role !== undefined) {
    return createAgentRoleNode({
      id: node.id,
      label: node.data.label,
      position: node.position,
      role: node.data.role,
    });
  }

  if (node.data.kind === "tool" && node.data.tool !== undefined && node.data.toolId !== undefined) {
    return createToolNode({
      id: node.id,
      label: node.data.label,
      position: node.position,
      toolId: node.data.toolId,
      tool: node.data.tool,
    });
  }

  if (node.data.kind === "handoff" && node.data.handoff !== undefined) {
    return createHandoffNode({
      id: node.id,
      label: node.data.label,
      position: node.position,
      handoff: node.data.handoff,
    });
  }

  if (node.data.kind === "condition" && node.data.condition !== undefined) {
    return createConditionNode({
      id: node.id,
      label: node.data.label,
      position: node.position,
      condition: node.data.condition,
    });
  }

  if (node.data.kind === "human-escalation" && node.data.escalation !== undefined) {
    return createHumanEscalationNode({
      id: node.id,
      label: node.data.label,
      position: node.position,
      escalation: node.data.escalation,
    });
  }

  if (node.data.kind === "end" && node.data.end !== undefined) {
    return createEndNode({
      id: node.id,
      label: node.data.label,
      position: node.position,
      end: node.data.end,
    });
  }

  const workflowNode: WorkflowNode = {
    id: node.id,
    kind: node.data.kind,
    label: node.data.label,
    position: node.position,
    config: node.data.config ?? {},
  };

  if (node.data.toolId !== undefined) {
    workflowNode.toolId = node.data.toolId;
  }

  return workflowNode;
}

function syncConditionNodeEdges(
  edges: BuilderEdge[],
  nodes: BuilderNode[],
  nodeId: string,
  condition: ConditionNodeConfig,
): BuilderEdge[] {
  const preservedEdges = edges.filter((edge) => edge.source !== nodeId);
  const branchEdges = condition.branches
    .filter((branch) => branch.targetNodeId.trim().length > 0)
    .map((branch) =>
      buildConditionPolicyEdge({
        nodes,
        edges: preservedEdges,
        sourceId: nodeId,
        targetId: branch.targetNodeId,
        id: `edge-${nodeId}-${branch.targetNodeId}-${branch.id}`,
        label: branch.label,
      }),
    )
    .filter((edge): edge is BuilderEdge => edge !== null);
  const fallbackEdge =
    condition.fallbackTargetNodeId.trim().length > 0
      ? [
          buildConditionPolicyEdge({
            nodes,
            edges: preservedEdges,
            sourceId: nodeId,
            targetId: condition.fallbackTargetNodeId,
            id: `edge-${nodeId}-${condition.fallbackTargetNodeId}-fallback`,
            label: condition.fallbackLabel,
          }),
        ].filter((edge): edge is BuilderEdge => edge !== null)
      : [];

  return [...preservedEdges, ...branchEdges, ...fallbackEdge];
}

function buildConditionPolicyEdge(input: {
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  sourceId: string;
  targetId: string;
  id: string;
  label: string;
}): BuilderEdge | null {
  const decision = getBuilderPolicyDecision({
    nodes: input.nodes,
    edges: input.edges,
    sourceId: input.sourceId,
    targetId: input.targetId,
    requestedEdgeKind: "flow",
  });

  if (decision.kind === null) {
    return null;
  }

  return applyBuilderEdgeHandleRoles(
    {
      id: input.id,
      source: input.sourceId,
      target: input.targetId,
      label: input.label,
    },
    decision.sourceHandleRole,
    decision.targetHandleRole,
  );
}

interface BuilderRelationshipRepairResult {
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  repairCount: number;
}

function canRepairBuilderRelationships(
  nodes: BuilderNode[],
  edges: BuilderEdge[],
  errors: RuntimeManifestPreview["validation"]["errors"],
): boolean {
  if (errors.some((error) => isRepairableRelationshipCode(error.code))) {
    return true;
  }

  return repairBuilderRelationships(nodes, edges).repairCount > 0;
}

function repairBuilderRelationships(nodes: BuilderNode[], edges: BuilderEdge[]): BuilderRelationshipRepairResult {
  let repairCount = 0;
  let repairedEdges = repairBuilderEdges(nodes, edges, () => {
    repairCount += 1;
  });
  const repairedNodes = repairBuilderNodeReferences(nodes, repairedEdges, () => {
    repairCount += 1;
  });

  for (const node of repairedNodes) {
    if (node.data.kind !== "condition" || node.data.condition === undefined) {
      continue;
    }

    const before = serializeBuilderEdges(repairedEdges);
    repairedEdges = syncConditionNodeEdges(repairedEdges, repairedNodes, node.id, node.data.condition);

    if (serializeBuilderEdges(repairedEdges) !== before) {
      repairCount += 1;
    }
  }

  repairedEdges = ensureHandoffTargetEdges(repairedNodes, repairedEdges, () => {
    repairCount += 1;
  });

  return {
    nodes: repairedNodes,
    edges: repairedEdges,
    repairCount,
  };
}

function repairBuilderEdges(
  nodes: BuilderNode[],
  edges: BuilderEdge[],
  onRepair: () => void,
): BuilderEdge[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const repairedEdges: BuilderEdge[] = [];

  for (const edge of edges) {
    const sourceNode = nodesById.get(edge.source);
    const targetNode = nodesById.get(edge.target);

    if (sourceNode === undefined || targetNode === undefined) {
      onRepair();
      continue;
    }

    const decision = getBuilderPolicyDecision({
      nodes,
      edges,
      sourceId: edge.source,
      targetId: edge.target,
      requestedEdgeKind: edge.data?.kind === "return" ? "return" : "flow",
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      strictHandleRoles: false,
    });

    if (decision.kind === null) {
      onRepair();
      continue;
    }

    const repairedEdge = applyBuilderEdgeKind({
      edge: applyBuilderEdgeHandleRoles(edge, decision.sourceHandleRole, decision.targetHandleRole),
      kind: decision.kind,
      sourceNode,
      preserveLabel: true,
    });

    if (serializeBuilderEdges([repairedEdge]) !== serializeBuilderEdges([edge])) {
      onRepair();
    }

    repairedEdges.push(repairedEdge);
  }

  return ensurePolicyCompanionEdges(nodes, repairedEdges, onRepair);
}

function ensurePolicyCompanionEdges(
  nodes: BuilderNode[],
  edges: BuilderEdge[],
  onRepair: () => void,
): BuilderEdge[] {
  let repairedEdges = edges;
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));

  for (const edge of edges) {
    const sourceNode = nodesById.get(edge.source);
    const targetNode = nodesById.get(edge.target);

    if (sourceNode === undefined || targetNode === undefined || edge.data?.kind === "return") {
      continue;
    }

    const decision = getBuilderPolicyDecision({
      nodes,
      edges: repairedEdges,
      sourceId: edge.source,
      targetId: edge.target,
      requestedEdgeKind: "flow",
      strictHandleRoles: false,
    });

    if (decision.kind === null) {
      continue;
    }

    for (const companionEdge of decision.autoCreateCompanionEdges) {
      const companionSourceNode = companionEdge.source === "source" ? sourceNode : targetNode;
      const companionTargetNode = companionEdge.target === "source" ? sourceNode : targetNode;
      const companionExists = repairedEdges.some(
        (candidate) =>
          candidate.source === companionSourceNode.id &&
          candidate.target === companionTargetNode.id &&
          (candidate.data?.kind ?? "flow") === companionEdge.edgeKind,
      );

      if (companionExists) {
        continue;
      }

      repairedEdges = [
        ...repairedEdges,
        applyBuilderEdgeKind({
          edge: applyBuilderEdgeHandleRoles(
            {
              id: buildEdgeId(companionSourceNode.id, companionTargetNode.id, repairedEdges),
              source: companionSourceNode.id,
              target: companionTargetNode.id,
              ...(companionEdge.condition !== undefined ? { label: companionEdge.condition } : {}),
            },
            companionEdge.sourceHandleRole,
            companionEdge.targetHandleRole,
          ),
          kind: companionEdge.edgeKind,
          sourceNode: companionSourceNode,
          preserveLabel: false,
        }),
      ];
      onRepair();
    }
  }

  return repairedEdges;
}

function repairBuilderNodeReferences(
  nodes: BuilderNode[],
  edges: BuilderEdge[],
  onRepair: () => void,
): BuilderNode[] {
  return nodes.map((node) => {
    if (node.data.kind === "condition" && node.data.condition !== undefined) {
      const nextCondition = repairConditionTargets(nodes, edges, node);

      if (JSON.stringify(nextCondition) !== JSON.stringify(node.data.condition)) {
        onRepair();
        return createBuilderConditionNode({
          id: node.id,
          label: node.data.label,
          position: node.position,
          condition: nextCondition,
        });
      }
    }

    if (node.data.kind === "handoff" && node.data.handoff !== undefined) {
      const targetNode = nodes.find((candidate) => candidate.id === node.data.handoff?.targetRoleId);
      const fallbackAgent = nodes.find((candidate) => candidate.data.kind === "agent");

      if (targetNode?.data.kind !== "agent" && fallbackAgent !== undefined) {
        onRepair();
        return createBuilderHandoffNode({
          id: node.id,
          label: `${fallbackAgent.data.label} handoff`,
          position: node.position,
          handoff: {
            ...node.data.handoff,
            targetRoleId: fallbackAgent.id,
            targetRoleName: fallbackAgent.data.role?.name ?? fallbackAgent.data.label,
          },
        });
      }
    }

    return node;
  });
}

function repairConditionTargets(
  nodes: BuilderNode[],
  edges: BuilderEdge[],
  conditionNode: BuilderNode,
): ConditionNodeConfig {
  const condition = conditionNode.data.condition;

  if (conditionNode.data.kind !== "condition" || condition === undefined) {
    return {
      branches: [],
      fallbackLabel: "Fallback",
      fallbackTargetNodeId: "",
    };
  }

  const branchRouteTargets = getPolicyRouteTargetOptions(nodes, edges, conditionNode.id, { includeCaller: false });
  const fallbackRouteTargets = getPolicyRouteTargetOptions(nodes, edges, conditionNode.id, { includeCaller: true });
  const branchFallbackTarget = branchRouteTargets.find((target) => target.kind !== "end") ?? branchRouteTargets[0];
  const fallbackTarget = fallbackRouteTargets.find((target) => target.kind === "end") ?? fallbackRouteTargets[0];

  return {
    ...condition,
    branches: condition.branches.map((branch) => {
      if (isPolicyRouteTargetValid(nodes, edges, conditionNode.id, branch.targetNodeId, { includeCaller: false })) {
        return branch;
      }

      return {
        ...branch,
        targetNodeId: branchFallbackTarget?.id ?? "",
      };
    }),
    fallbackTargetNodeId: isPolicyRouteTargetValid(
      nodes,
      edges,
      conditionNode.id,
      condition.fallbackTargetNodeId,
      { includeCaller: true },
    )
      ? condition.fallbackTargetNodeId
      : fallbackTarget?.id ?? "",
    fallbackLabel: condition.fallbackLabel.trim().length > 0 ? condition.fallbackLabel : "Fallback",
  };
}

function ensureHandoffTargetEdges(
  nodes: BuilderNode[],
  edges: BuilderEdge[],
  onRepair: () => void,
): BuilderEdge[] {
  let repairedEdges = edges;

  for (const node of nodes) {
    if (node.data.kind !== "handoff" || node.data.handoff === undefined) {
      continue;
    }

    const targetId = node.data.handoff.targetRoleId;

    if (targetId.trim().length === 0 || repairedEdges.some((edge) => edge.source === node.id && edge.target === targetId)) {
      continue;
    }

    const decision = getBuilderPolicyDecision({
      nodes,
      edges: repairedEdges,
      sourceId: node.id,
      targetId,
      requestedEdgeKind: "flow",
      strictHandleRoles: false,
    });

    if (decision.kind === null) {
      continue;
    }

    repairedEdges = [
      ...repairedEdges,
      applyBuilderEdgeHandleRoles(
        {
          id: buildEdgeId(node.id, targetId, repairedEdges),
          source: node.id,
          target: targetId,
          label: "handoff",
        },
        decision.sourceHandleRole,
        decision.targetHandleRole,
      ),
    ];
    onRepair();
  }

  return repairedEdges;
}

function getPolicyRouteTargetOptions(
  nodes: BuilderNode[],
  edges: BuilderEdge[],
  conditionNodeId: string,
  options: { includeCaller: boolean } = { includeCaller: true },
): Array<{ id: string; label: string; kind: WorkflowNodeKind }> {
  const callerNodeIds = new Set(
    edges
      .filter((edge) => edge.target === conditionNodeId && (edge.data?.kind ?? "flow") === "flow")
      .map((edge) => edge.source),
  );

  return nodes
    .filter(
      (node) =>
        node.id !== conditionNodeId &&
        (options.includeCaller || !callerNodeIds.has(node.id)) &&
        getBuilderPolicyDecision({
          nodes,
          edges,
          sourceId: conditionNodeId,
          targetId: node.id,
          requestedEdgeKind: "flow",
        }).kind !== null,
    )
    .map((node) => ({
      id: node.id,
      label: node.data.label,
      kind: node.data.kind,
    }));
}

function isPolicyRouteTargetValid(
  nodes: BuilderNode[],
  edges: BuilderEdge[],
  conditionNodeId: string,
  targetNodeId: string,
  options: { includeCaller: boolean } = { includeCaller: true },
): boolean {
  if (targetNodeId.trim().length === 0) {
    return false;
  }

  if (!options.includeCaller) {
    const isCaller = edges.some(
      (edge) =>
        edge.target === conditionNodeId &&
        edge.source === targetNodeId &&
        (edge.data?.kind ?? "flow") === "flow",
    );

    if (isCaller) {
      return false;
    }
  }

  return getBuilderPolicyDecision({
    nodes,
    edges,
    sourceId: conditionNodeId,
    targetId: targetNodeId,
    requestedEdgeKind: "flow",
  }).kind !== null;
}

function isRepairableRelationshipCode(code: string): boolean {
  return (
    code.startsWith("relationship.") ||
    code === "workflow.edge_missing_source" ||
    code === "workflow.edge_missing_target" ||
    code === "workflow.unreachable_node" ||
    code === "condition.invalid_target" ||
    code === "condition.invalid_fallback" ||
    code === "handoff.invalid_target"
  );
}

function serializeBuilderEdges(edges: BuilderEdge[]): string {
  return JSON.stringify(
    edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.data?.kind,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      label: edge.label,
      className: edge.className,
    })),
  );
}

function syncNodesForReconnectedEdge(
  nodes: BuilderNode[],
  previousEdge: BuilderEdge,
  nextSourceId: string,
  nextTargetId: string,
): BuilderNode[] {
  const nextTargetNode = nodes.find((node) => node.id === nextTargetId);

  return nodes.map((node) => {
    if (node.id === previousEdge.source) {
      return detachOrRetargetNodeEdge(node, previousEdge, nextSourceId, nextTargetId, nextTargetNode);
    }

    if (node.id === nextSourceId && nextSourceId !== previousEdge.source) {
      return attachNodeEdge(node, previousEdge, nextTargetId, nextTargetNode);
    }

    return node;
  });
}

function detachOrRetargetNodeEdge(
  node: BuilderNode,
  edge: BuilderEdge,
  nextSourceId: string,
  nextTargetId: string,
  nextTargetNode: BuilderNode | undefined,
): BuilderNode {
  if (node.data.kind === "condition" && node.data.condition !== undefined) {
    const label = typeof edge.label === "string" ? edge.label : "";
    const nextCondition = updateConditionNodeTargets(node.data.condition, label, nextSourceId === node.id ? nextTargetId : "");

    return createBuilderConditionNode({
      id: node.id,
      label: node.data.label,
      position: node.position,
      condition: nextCondition,
    });
  }

  if (node.data.kind === "handoff" && node.data.handoff !== undefined) {
    return createBuilderHandoffNode({
      id: node.id,
      label: resolveHandoffNodeLabel(nextTargetNode, nextSourceId === node.id),
      position: node.position,
      handoff: {
        ...node.data.handoff,
        targetRoleId: nextSourceId === node.id ? nextTargetId : "",
        targetRoleName: nextSourceId === node.id ? resolveHandoffTargetName(nextTargetNode) : "",
      },
    });
  }

  return node;
}

function attachNodeEdge(
  node: BuilderNode,
  edge: BuilderEdge,
  nextTargetId: string,
  nextTargetNode: BuilderNode | undefined,
): BuilderNode {
  if (node.data.kind === "condition" && node.data.condition !== undefined && typeof edge.label === "string") {
    const nextCondition = updateConditionNodeTargets(node.data.condition, edge.label, nextTargetId);

    return createBuilderConditionNode({
      id: node.id,
      label: node.data.label,
      position: node.position,
      condition: nextCondition,
    });
  }

  if (node.data.kind === "handoff" && node.data.handoff !== undefined) {
    return createBuilderHandoffNode({
      id: node.id,
      label: resolveHandoffNodeLabel(nextTargetNode, true),
      position: node.position,
      handoff: {
        ...node.data.handoff,
        targetRoleId: nextTargetId,
        targetRoleName: resolveHandoffTargetName(nextTargetNode),
      },
    });
  }

  return node;
}

function updateConditionNodeTargets(
  condition: ConditionNodeConfig,
  edgeLabel: string,
  nextTargetId: string,
): ConditionNodeConfig {
  return {
    ...condition,
    branches: condition.branches.map((branch) =>
      branch.label === edgeLabel
        ? {
            ...branch,
            targetNodeId: nextTargetId,
          }
        : branch,
    ),
    ...(condition.fallbackLabel === edgeLabel
      ? {
          fallbackTargetNodeId: nextTargetId,
        }
      : {}),
  };
}

function resolveHandoffTargetName(node: BuilderNode | undefined): string {
  if (node?.data.kind === "agent" && node.data.role !== undefined) {
    return node.data.role.name;
  }

  return node?.data.label ?? "";
}

function resolveHandoffNodeLabel(node: BuilderNode | undefined, hasTarget: boolean): string {
  const targetName = resolveHandoffTargetName(node);

  if (hasTarget && targetName.length > 0) {
    return `${targetName} handoff`;
  }

  return "Handoff";
}

function getMiniMapNodeKind(node: Node<Record<string, unknown>>): WorkflowNodeKind {
  const kind = node.data?.kind;

  switch (kind) {
    case "entry":
    case "agent":
    case "tool":
    case "handoff":
    case "condition":
    case "human-escalation":
    case "end":
      return kind;
    default:
      return "agent";
  }
}

function getNodeIcon(kind: WorkflowNodeKind) {
  switch (kind) {
    case "entry":
      return PhoneCall;
    case "agent":
      return Bot;
    case "tool":
      return KeyRound;
    case "handoff":
      return Handshake;
    case "condition":
      return GitBranch;
    case "human-escalation":
      return Headphones;
    case "end":
      return PhoneOff;
    default:
      return Plus;
  }
}

function getNodeKindLabel(kind: WorkflowNodeKind) {
  switch (kind) {
    case "human-escalation":
      return "Human escalation";
    case "end":
      return "Exit";
    default:
      return kind.charAt(0).toUpperCase() + kind.slice(1);
  }
}

function formatModelTier(tier: ModelTier) {
  switch (tier) {
    case "cheap":
      return "Cheap tier";
    case "standard":
      return "Standard tier";
    case "sota":
      return "SOTA tier";
    default:
      return "Rules tier";
  }
}

function formatAgentModelBadge(role: AgentRoleNodeConfig) {
  const provider = textModelProviderOptions.find((option) => option.value === role.modelProvider);

  return provider?.value === "google-gemini" ? provider.badge : formatModelTier(role.defaultModelTier);
}

function formatValidationTitle(code: string) {
  switch (code) {
    case "workflow.missing_entry":
      return "Add an entry point";
    case "workflow.unreachable_node":
      return "Reconnect or remove this node";
    case "workflow.unsafe_cycle":
      return "Close the looping path";
    case "workflow.edge_missing_source":
    case "workflow.edge_missing_target":
      return "Reconnect a broken edge";
    case "agent.missing_name":
      return "Name this agent";
    case "agent.missing_business_name":
      return "Add the business name";
    case "agent.missing_instructions":
      return "Add agent instructions";
    case "agent.missing_model_tier":
      return "Choose a model tier";
    case "agent.missing_default_language":
    case "agent.missing_supported_language":
    case "agent.duplicate_language":
    case "agent.default_language_not_supported":
    case "agent.missing_language_prompt":
      return "Finish the language setup";
    case "tool.missing_binding":
      return "Choose a tool action";
    case "tool.missing_authorization":
    case "tool.revoked_connection":
      return "Reconnect this tool";
    case "tool.missing_request_method":
    case "tool.missing_request_url":
    case "tool.missing_request_auth_token":
    case "tool.missing_request_headers":
      return "Finish the API request setup";
    case "handoff.missing_target":
    case "handoff.invalid_target":
      return "Choose a handoff target";
    case "condition.missing_branch":
      return "Add a branch";
    case "condition.invalid_expression":
      return "Rewrite the branch rule";
    case "condition.invalid_target":
    case "condition.invalid_fallback":
      return "Reconnect the route target";
    case "condition.missing_fallback":
      return "Add a fallback route";
    case "escalation.missing_queue":
      return "Choose an escalation queue";
    case "escalation.missing_fallback_message":
      return "Add the escalation fallback message";
    default:
      return "Finish this workflow step";
  }
}

function formatValidationDetail(
  code: string,
  suggestion: string | undefined,
  nodeId: string | undefined,
  edgeId: string | undefined,
  nodeLabelById: Map<string, string>,
) {
  const nodeLabel = nodeId !== undefined ? nodeLabelById.get(nodeId) ?? nodeId : undefined;

  switch (code) {
    case "workflow.missing_entry":
      return "Add an inbound entry node so calls have a clear starting point.";
    case "workflow.unsafe_cycle":
      return "Add an exit or conditional break so callers cannot get trapped in a loop.";
    case "workflow.edge_missing_source":
    case "workflow.edge_missing_target":
      return edgeId !== undefined
        ? `Reconnect or remove ${edgeId} so every path has a valid source and destination.`
        : "Reconnect or remove the broken edge before publishing.";
    case "agent.missing_name":
      return nodeLabel !== undefined ? `Give ${nodeLabel} a clear working name.` : "Give this agent a clear working name.";
    case "agent.missing_business_name":
      return "Add the company, agency, or business name this agent represents on calls.";
    case "agent.missing_instructions":
      return nodeLabel !== undefined
        ? `Add instructions so ${nodeLabel} knows how to handle the caller.`
        : "Add instructions so this agent knows how to handle the caller.";
    case "agent.missing_model_tier":
      return "Pick the model tier this agent should use at runtime.";
    case "agent.missing_default_language":
    case "agent.missing_supported_language":
      return "Set the default language and at least one supported language.";
    case "agent.duplicate_language":
      return "Remove duplicate supported languages before publishing.";
    case "agent.default_language_not_supported":
      return "Keep the default fallback language in the supported-language list.";
    case "agent.missing_language_prompt":
      return "Fill in or remove the empty language-specific prompt.";
    case "tool.missing_binding":
      return "Choose the exact tool action this node should run.";
    case "tool.missing_authorization":
    case "tool.revoked_connection":
      return nodeLabel !== undefined
        ? `Reconnect ${nodeLabel} before this workflow can call it.`
        : "Reconnect this tool before the workflow can call it.";
    case "tool.missing_request_method":
    case "tool.missing_request_url":
    case "tool.missing_request_auth_token":
    case "tool.missing_request_headers":
      return nodeLabel !== undefined
        ? `Finish the API request setup for ${nodeLabel}.`
        : "Finish the API request setup for this tool node.";
    case "handoff.missing_target":
    case "handoff.invalid_target":
      return "Choose a valid specialist target for this handoff.";
    case "condition.missing_branch":
      return "Add at least one branch so this route can make a decision.";
    case "condition.invalid_expression":
      return 'Use a rule like intent == "billing" or language == "fr".';
    case "condition.invalid_target":
      return "Reconnect each branch to a valid next step.";
    case "condition.missing_fallback":
    case "condition.invalid_fallback":
      return "Choose where the fallback path should go if no branch matches.";
    case "escalation.missing_queue":
      return "Choose the human queue this escalation should reach.";
    case "escalation.missing_fallback_message":
      return "Add the caller message used when no human picks up the escalation.";
    default:
      return suggestion;
  }
}

function formatToolBadge(tool: ToolNodeConfig) {
  if (tool.connectionStatus === "connected") {
    return tool.requiresHumanApproval ? "Approval gate" : "Connected";
  }

  if (tool.connectionStatus === "revoked") {
    return "Reconnect";
  }

  return "Needs auth";
}

function formatConnectorLabel(connector: ToolNodeConfig["connector"]) {
  switch (connector) {
    case "google-workspace":
      return "Google Workspace";
    default:
      return connector
        .split("-")
        .map((segment) => capitalize(segment))
        .join(" ");
  }
}

function deriveRuntimeFromProfile(profile: RuntimeProfileId): VoiceRuntimeKind {
  return profile === "premium-realtime" ? "openai-realtime" : "sandwich-pipeline";
}

function buildWorkflowSandboxTelephonyRoutes(input: {
  state: TelephonyStateResponse | null;
  workspaceId: string;
  versions: PublishedWorkflowVersion[];
}): WorkflowSandboxTelephonyRoute[] {
  if (input.state === null || input.versions.length === 0) {
    return [];
  }

  const publishedVersionIds = new Set(input.versions.map((version) => version.id));
  const connectionsById = new Map(
    input.state.connections.map((connection) => [connection.id, connection] as const),
  );

  return input.state.phoneNumbers
    .filter(
      (phoneNumber) =>
        phoneNumber.status === "routed"
        && phoneNumber.workspaceId === input.workspaceId
        && phoneNumber.publishedVersionId !== undefined
        && publishedVersionIds.has(phoneNumber.publishedVersionId),
    )
    .map((phoneNumber) => toWorkflowSandboxTelephonyRoute(phoneNumber, connectionsById.get(phoneNumber.connectionId)))
    .filter((route): route is WorkflowSandboxTelephonyRoute => route !== null)
    .sort((left, right) => left.friendlyName.localeCompare(right.friendlyName));
}

function toWorkflowSandboxTelephonyRoute(
  phoneNumber: ImportedTelephonyPhoneNumber,
  connection: TelephonyConnection | undefined,
): WorkflowSandboxTelephonyRoute | null {
  if (
    phoneNumber.publishedVersionId === undefined
    || phoneNumber.workflowLabel === undefined
    || connection === undefined
  ) {
    return null;
  }

  return {
    id: `${phoneNumber.id}:${phoneNumber.publishedVersionId}`,
    phoneNumberId: phoneNumber.id,
    phoneNumber: phoneNumber.phoneNumber,
    friendlyName: phoneNumber.friendlyName,
    workflowLabel: phoneNumber.workflowLabel,
    publishedVersionId: phoneNumber.publishedVersionId,
    connectionId: connection.id,
    connectionLabel: connection.label,
    ownershipMode: connection.ownershipMode,
    provider: connection.provider,
    recordingSummary: formatRecordingSummary(phoneNumber.recordingPolicy ?? connection.recordingPolicy),
  };
}

function formatRuntimeProfileLabel(profile: RuntimeProfileId) {
  switch (profile) {
    case "balanced":
      return "Balanced profile";
    case "premium-realtime":
      return "Premium realtime";
    default:
      return "Cost optimized";
  }
}

function formatVoiceProfileLabel(profile: RuntimeProfileId) {
  switch (profile) {
    case "balanced":
      return "Neural HD voice";
    case "premium-realtime":
      return "Expressive voice";
    default:
      return "Economy voice";
  }
}

function formatWorkflowSandboxMicrophoneState(state: "idle" | "requesting" | "granted" | "denied" | "unsupported") {
  switch (state) {
    case "granted":
      return "Granted";
    case "denied":
      return "Denied";
    case "requesting":
      return "Requesting";
    case "unsupported":
      return "Unavailable";
    default:
      return "Optional";
  }
}

function formatWorkflowSandboxTime(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}

function formatWorkflowSandboxModelDecision(decision: {
  tier: string;
  provider?: string | undefined;
  modelId?: string | undefined;
}) {
  const provider = decision.provider === "google-gemini"
    ? "Gemini"
    : decision.provider === "openai"
      ? "OpenAI"
      : undefined;

  if (provider !== undefined && decision.modelId !== undefined) {
    return `${provider} ${decision.modelId}`;
  }

  if (provider !== undefined) {
    return `${provider} ${decision.tier}`;
  }

  return decision.tier;
}

function formatRecordingSummary(policy: {
  enabled: boolean;
  consentMode: string;
}) {
  if (!policy.enabled || policy.consentMode === "disabled") {
    return "Recording off";
  }

  if (policy.consentMode === "two-party") {
    return "Two-party consent";
  }

  return "Single-party consent";
}

function formatTelephonyRouteRailLabel(
  route: Pick<WorkflowSandboxTelephonyRoute, "ownershipMode" | "provider">,
) {
  return `${formatOwnershipModeLabel(route.ownershipMode)} / ${formatProviderLabel(route.provider)}`;
}

function formatTelephonyBridgeKindLabel(
  bridgeKind: TelephonyExecutionSession["bridgeKind"] | undefined,
) {
  switch (bridgeKind) {
    case "platform-edge":
      return "platform.edge.accept-call";
    case "twilio-programmable-voice":
      return "twilio.calls.answer";
    case "sip-trunk":
      return "sip.invite.accept";
    default:
      return "provider bridge";
  }
}

function formatOwnershipModeLabel(ownershipMode: string) {
  switch (ownershipMode) {
    case "platform_managed":
      return "Platform";
    case "byo_provider_account":
      return "BYO";
    case "byo_sip_trunk":
      return "SIP";
    default:
      return ownershipMode;
  }
}

function formatProviderLabel(provider: string) {
  switch (provider) {
    case "twilio":
      return "Twilio";
    case "signalwire":
      return "SignalWire";
    case "telnyx":
      return "Telnyx";
    case "custom-sip":
      return "Custom SIP";
    default:
      return provider;
  }
}

function getIntegrationOptions(connector: ToolNodeConfig["connector"]): IntegrationOption[] {
  switch (connector) {
    case "zendesk":
      return [
        { value: "zendesk-wa-prod", label: "Zendesk - West Africa support", status: "connected" },
        { value: "zendesk-eu-revoked", label: "Zendesk - Revoked archive", status: "revoked" },
      ];
    case "hubspot":
      return [{ value: "hubspot-main", label: "HubSpot - Revenue ops", status: "connected" }];
    case "notion":
      return [{ value: "notion-kb", label: "Notion - Knowledge base", status: "connected" }];
    case "webhook":
      return [{ value: "webhook-orders", label: "Webhook - Orders", status: "connected" }];
    case "google-workspace":
      return [{ value: "workspace-sales", label: "Google Workspace - Sales", status: "connected" }];
    default:
      return [{ value: "internal-runtime", label: "Internal runtime", status: "connected" }];
  }
}

function getDefaultIntegrationOption(connector: ToolNodeConfig["connector"]): IntegrationOption | undefined {
  const options = getIntegrationOptions(connector);

  return options.find((option) => option.status === "connected") ?? options[0];
}

function normalizeIntentRouteCondition(condition: ConditionNodeConfig): ConditionNodeConfig {
  return {
    ...condition,
    classifier: condition.classifier ?? { ...defaultIntentRouteClassifier },
    inputWindow: condition.inputWindow ?? { ...defaultIntentRouteInputWindow },
    branches: condition.branches.map((branch) => {
      const intent = getIntentValueFromBranch(branch);
      return {
        ...branch,
        intentKey: branch.intentKey ?? intent,
        description: branch.description ?? getConditionIntentDescription(intent),
        examples: branch.examples ?? getConditionIntentExamples(intent),
      };
    }),
  };
}

function buildIntentRouteBranch(input: {
  id: string;
  intent: string;
  targetNodeId: string;
}): ConditionNodeConfig["branches"][number] {
  return {
    id: input.id,
    label: getConditionIntentLabel(input.intent),
    intentKey: input.intent,
    description: getConditionIntentDescription(input.intent),
    examples: getConditionIntentExamples(input.intent),
    expression: buildIntentExpression(input.intent),
    targetNodeId: input.targetNodeId,
  };
}

function updateIntentRouteBranchIntent(
  branch: ConditionNodeConfig["branches"][number],
  intent: string,
): ConditionNodeConfig["branches"][number] {
  const currentIntent = getIntentValueFromBranch(branch);
  const shouldReplaceDescription =
    branch.description === undefined ||
    branch.description.trim().length === 0 ||
    branch.description === getConditionIntentDescription(currentIntent);
  const shouldReplaceExamples =
    branch.examples === undefined ||
    branch.examples.join("\n") === getConditionIntentExamples(currentIntent).join("\n");

  return {
    ...branch,
    label:
      branch.label.trim().length === 0 ||
      branch.label === getConditionIntentLabel(currentIntent)
        ? getConditionIntentLabel(intent)
        : branch.label,
    intentKey: intent,
    ...(shouldReplaceDescription ? { description: getConditionIntentDescription(intent) } : {}),
    ...(shouldReplaceExamples ? { examples: getConditionIntentExamples(intent) } : {}),
    expression: buildIntentExpression(intent),
  };
}

function buildIntentExpression(intent: string): string {
  return `intent == "${intent}"`;
}

function getIntentValueFromExpression(expression: string): string {
  const match = /^\s*intent\s*==\s*"([^"]+)"\s*$/.exec(expression);
  const intent = match?.[1];

  return conditionIntentOptions.some((option) => option.value === intent) ? intent! : conditionIntentOptions[0]!.value;
}

function getIntentValueFromBranch(branch: ConditionNodeConfig["branches"][number]): string {
  const intent = branch.intentKey ?? getIntentValueFromExpression(branch.expression);
  return conditionIntentOptions.some((option) => option.value === intent) ? intent : conditionIntentOptions[0]!.value;
}

function getConditionIntentLabel(intent: string): string {
  return conditionIntentOptions.find((option) => option.value === intent)?.label ?? conditionIntentOptions[0]!.label;
}

function getConditionIntentDescription(intent: string): string {
  return conditionIntentOptions.find((option) => option.value === intent)?.description ?? conditionIntentOptions[0]!.description;
}

function getConditionIntentExamples(intent: string): string[] {
  return [...(conditionIntentOptions.find((option) => option.value === intent)?.examples ?? conditionIntentOptions[0]!.examples)];
}

function getIntentLabelFromExpression(expression: string): string {
  return getConditionIntentLabel(getIntentValueFromExpression(expression));
}

function clampIntentConfidenceThreshold(value: number): number {
  if (!Number.isFinite(value)) {
    return defaultIntentRouteClassifier.confidenceThreshold;
  }

  return Math.min(1, Math.max(0, value));
}

function buildBuilderEdge(input: {
  connection: Connection;
  id: string;
  kind: WorkflowEdgeKind;
  sourceHandleRole: WorkflowRelationshipHandleRole;
  targetHandleRole: WorkflowRelationshipHandleRole;
  sourceNode: BuilderNode | undefined;
}): BuilderEdge {
  return applyBuilderEdgeKind({
    edge: applyBuilderEdgeHandleRoles(
      {
        id: input.id,
        source: input.connection.source ?? "",
        target: input.connection.target ?? "",
      },
      input.sourceHandleRole,
      input.targetHandleRole,
    ),
    kind: input.kind,
    sourceNode: input.sourceNode,
    preserveLabel: false,
  });
}

function applyBuilderEdgeKind(input: {
  edge: BuilderEdge;
  kind: WorkflowEdgeKind;
  sourceNode: BuilderNode | undefined;
  preserveLabel: boolean;
}): BuilderEdge {
  const returnLabel = input.kind === "return" ? getDefaultReturnEdgeLabel(input.sourceNode) : undefined;
  const preservedLabel = input.preserveLabel ? input.edge.label : undefined;
  const label = returnLabel ?? preservedLabel;
  const nextEdge: BuilderEdge = {
    ...input.edge,
    ...(label !== undefined ? { label } : {}),
  };

  if (input.kind !== "return") {
    return nextEdge;
  }

  return {
    ...nextEdge,
    data: { ...(input.edge.data ?? {}), kind: "return" },
    className: "workflow-return-edge",
  };
}

function getDefaultReturnEdgeLabel(sourceNode: BuilderNode | undefined): string {
  return sourceNode?.data.kind === "tool" ? "success" : "response";
}

function buildEdgeId(source: string, target: string, edges: BuilderEdge[]) {
  const baseId = `edge-${source}-${target}`;

  if (!edges.some((edge) => edge.id === baseId)) {
    return baseId;
  }

  let suffix = 2;

  while (edges.some((edge) => edge.id === `${baseId}-${suffix}`)) {
    suffix += 1;
  }

  return `${baseId}-${suffix}`;
}

function serializeRequestHeaders(headers: ToolRequestHeader[]) {
  return headers.map((header) => `${header.name}: ${header.value}`).join("\n");
}

function parseRequestHeaders(value: string): ToolRequestHeader[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const separatorIndex = line.indexOf(":");

      if (separatorIndex < 0) {
        return {
          name: line,
          value: "",
        };
      }

      return {
        name: line.slice(0, separatorIndex).trim(),
        value: line.slice(separatorIndex + 1).trim(),
      };
    });
}

function cloneToolRequest(request: ToolRequestConfig): ToolRequestConfig {
  return {
    method: request.method,
    url: request.url,
    authToken: request.authToken,
    headers: request.headers.map((header) => ({ ...header })),
    ...(request.bodyTemplate !== undefined ? { bodyTemplate: request.bodyTemplate } : {}),
  };
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
