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
  decideWorkflowNodeRelationship,
  deleteWorkflowNode,
  pinPublishedWorkflowVersion,
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
  type RuntimeProfileId,
  type RuntimeManifestPreview,
  type SpecialistRoleTemplate,
  type TelephonyConnection,
  type TelephonyExecutionCommand,
  type TelephonyExecutionSession,
  type TelephonyProvider,
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
const specialistTemplatesStorageKey = "zara.web.specialist-templates.v1";
const runtimeProfileOptions: Array<{ value: RuntimeProfileId; label: string }> = [
  { value: "cost-optimized", label: "Cost optimized" },
  { value: "balanced", label: "Balanced" },
  { value: "premium-realtime", label: "Premium realtime" },
];
const languageOptions = [
  { value: "en", label: "English" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
  { value: "de", label: "German" },
  { value: "pt", label: "Portuguese" },
  { value: "ar", label: "Arabic" },
] as const;
const conditionIntentOptions = [
  { value: "billing", label: "Billing" },
  { value: "support", label: "Support" },
  { value: "sales", label: "Sales" },
  { value: "vip", label: "VIP" },
  { value: "technical-support", label: "Technical support" },
  { value: "property-inquiry", label: "Property inquiry" },
] as const;
const defaultSpecialistTemplateCreatedAt = "2026-05-20T00:00:00.000Z";

const initialNodes: BuilderNode[] = [
  {
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
  },
  createBuilderAgentNode({
    id: "agent-front-desk",
    label: "Front desk triage",
    position: { x: 250, y: 128 },
    role: {
      kind: "receptionist",
      name: "Front desk triage",
      instructions:
        "Greet callers, identify intent, collect account context, resolve routine reception requests, and route specialist work cleanly.",
      defaultModelTier: "cheap",
      languagePolicy: {
        defaultLanguage: "en",
        supportedLanguages: ["en", "fr"],
        allowMidCallSwitching: true,
      },
      reusableSpecialist: true,
      specialistTemplateId: "specialist-template-agent-front-desk",
      specialistTemplateVersion: 1,
    },
  }),
  createBuilderToolNode({
    id: "tool-zendesk",
    label: "Zendesk lookup",
    position: { x: 570, y: 52 },
    toolId: "zendesk.search",
    tool: {
      connector: "zendesk",
      toolName: "Ticket lookup",
      integrationConnectionId: "zendesk-wa-prod",
      integrationLabel: "Zendesk - West Africa support",
      connectionStatus: "connected",
      risk: "medium",
      requiresAuthorization: true,
      requiresHumanApproval: false,
      request: cloneToolRequest(defaultToolCatalogItem.request),
    },
  }),
  createBuilderConditionNode({
    id: "condition-route",
    label: "Intent route",
    position: { x: 560, y: 236 },
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
  }),
  createBuilderHandoffNode({
    id: "handoff-billing",
    label: "Billing handoff",
    position: { x: 870, y: 132 },
    handoff: {
      targetRoleId: "agent-billing",
      targetRoleName: "Billing specialist",
      handoffReason: "Route invoice disputes and refund conversations to the billing lane.",
    },
  }),
  createBuilderAgentNode({
    id: "agent-billing",
    label: "Billing specialist",
    position: { x: 1170, y: 120 },
    role: {
      kind: "billing",
      name: "Billing specialist",
      instructions:
        "Resolve invoice disputes, explain charges, update billing notes, and escalate manager approvals when high-risk changes are requested.",
      defaultModelTier: "standard",
      languagePolicy: {
        defaultLanguage: "en",
        supportedLanguages: ["en"],
        allowMidCallSwitching: false,
      },
      reusableSpecialist: true,
      specialistTemplateId: "specialist-template-agent-billing",
      specialistTemplateVersion: 1,
    },
  }),
  createBuilderEndNode({
    id: "end-resolved",
    label: "Resolved exit",
    position: { x: 880, y: 354 },
    end: {
      outcome: "resolved",
      closingMessage: "Thank the caller and end the call after the request is resolved.",
    },
  }),
  createBuilderEscalationNode({
    id: "human-escalation",
    label: "Human escalation",
    position: { x: 1180, y: 352 },
    escalation: {
      queueId: "billing-ops",
      queueName: "Billing managers",
      fallbackMode: "ticket",
      fallbackMessage: "Create a callback ticket if a manager does not join immediately.",
    },
  }),
];

const initialEdges: BuilderEdge[] = [
  {
    id: "edge-entry-front-desk",
    source: "entry",
    target: "agent-front-desk",
  },
  {
    id: "edge-front-desk-tool",
    source: "agent-front-desk",
    target: "tool-zendesk",
    sourceHandle: "agent-tool-call-source-top",
    targetHandle: "tool-call-target-bottom",
    label: "lookup",
  },
  {
    id: "edge-front-desk-condition",
    source: "agent-front-desk",
    target: "condition-route",
  },
  {
    id: "edge-condition-route-handoff-billing-branch-billing",
    source: "condition-route",
    target: "handoff-billing",
    label: "Billing",
  },
  {
    id: "edge-condition-route-end-resolved-fallback",
    source: "condition-route",
    target: "end-resolved",
    label: "Resolved",
  },
  {
    id: "edge-handoff-billing-agent-billing",
    source: "handoff-billing",
    target: "agent-billing",
  },
  {
    id: "edge-agent-billing-human-escalation",
    source: "agent-billing",
    target: "human-escalation",
    label: "manager review",
  },
];

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

export function WorkflowBuilderScreen({
  activeWorkspaceId,
  workspaces,
}: {
  activeWorkspaceId: string;
  workspaces: Workspace[];
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<BuilderNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<BuilderEdge>(initialEdges);
  const [specialistTemplates, setSpecialistTemplates] = useState<SpecialistRoleTemplate[]>(() =>
    loadSpecialistRoleTemplatesForWorkspace(activeWorkspaceId),
  );
  const [selectedNodeId, setSelectedNodeId] = useState("condition-route");
  const [workflowTitle, setWorkflowTitle] = useState("Inbound support triage");
  const [publishTitle, setPublishTitle] = useState(workflowTitle);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(activeWorkspaceId);
  const [workflowRuntimeProfile, setWorkflowRuntimeProfile] = useState<RuntimeProfileId>("cost-optimized");
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
  const [publishedVersions, setPublishedVersions] = useState<PublishedWorkflowVersion[]>(() =>
    loadPublishedWorkflowVersionsForWorkspace({ tenantId, workspaceId: activeWorkspaceId }).filter(
      (version) => version.manifestPreview.workflowId === workflowId,
    ),
  );
  const liveSandbox = useLiveSandboxSession({
    organizationId: tenantId,
    actorUserId: "user-ops-lead",
  });

  const workflowGraph = useMemo(() => toWorkflowGraph(nodes, edges, workflowTitle), [edges, nodes, workflowTitle]);
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
        workflowId,
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
    [workflowGraph, workflowRuntime, workflowRuntimeProfile],
  );
  const canCompileDraftSandboxManifest = validation.ok && runtimePreview.entryRoleId !== undefined;
  const draftSandboxManifest = useMemo(
    () =>
      canCompileDraftSandboxManifest
        ? compileDraftSandboxRuntimeManifest({
            workflowId,
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
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? nodes[0];
  const validationIssues = useMemo(
    () => getBuilderValidationIssues(validation.errors, runtimePreview.entryRoleId, nodes),
    [nodes, runtimePreview.entryRoleId, validation.errors],
  );
  const publishDisabled = validationIssues.length > 0;
  const latestPublishedVersion = publishedVersions[publishedVersions.length - 1];
  const activeCallPin = useMemo(
    () =>
      latestPublishedVersion === undefined
        ? null
        : pinPublishedWorkflowVersion({
            callSessionId: "call-live-14",
            publishedVersion: latestPublishedVersion,
            pinnedAt: latestPublishedVersion.createdAt,
          }),
    [latestPublishedVersion],
  );
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
  const routeTargetOptions = useMemo(
    () => {
      if (selectedNode?.data.kind !== "condition") {
        return [];
      }

      return nodes
        .filter(
          (node) =>
            node.id !== selectedNodeId &&
            getBuilderPolicyDecision({
              nodes,
              edges,
              sourceId: selectedNode.id,
              targetId: node.id,
              requestedEdgeKind: "flow",
            }).kind !== null,
        )
        .map((node) => ({
          id: node.id,
          label: node.data.label,
          kind: node.data.kind,
        }));
    },
    [edges, nodes, selectedNode, selectedNodeId],
  );
  const nodeIds = useMemo(() => nodes.map((node) => node.id), [nodes]);
  const selectedSourceKind = selectedNode?.data.kind ?? "entry";
  const selectedNodeAllowsAgent = canCreateBuilderRelationshipFromKind(selectedSourceKind, "agent");
  const selectedNodeAllowsTool =
    selectedNode !== undefined &&
    canCreateBuilderRelationshipFromKind(selectedNode.data.kind, "tool");
  const selectedNodeAllowsHandoff = canCreateBuilderRelationshipFromKind(selectedSourceKind, "handoff");
  const selectedNodeAllowsIntentRoute =
    selectedNode !== undefined &&
    canCreateBuilderRelationshipFromKind(selectedNode.data.kind, "condition");
  const selectedNodeAllowsEscalation = canCreateBuilderRelationshipFromKind(selectedSourceKind, "human-escalation");
  const selectedNodeAllowsExit = canCreateBuilderRelationshipFromKind(selectedSourceKind, "end");
  const relationshipRepairAvailable = useMemo(
    () => canRepairBuilderRelationships(nodes, edges, validation.errors),
    [edges, nodes, validation.errors],
  );

  useEffect(() => {
    setSelectedWorkspaceId(activeWorkspaceId);
    setSpecialistTemplates(loadSpecialistRoleTemplatesForWorkspace(activeWorkspaceId));
    setPublishedVersions(
      loadPublishedWorkflowVersionsForWorkspace({ tenantId, workspaceId: activeWorkspaceId }).filter(
        (version) => version.manifestPreview.workflowId === workflowId,
      ),
    );
  }, [activeWorkspaceId]);

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
                edge,
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
        label: `Specialist ${agentNumber}`,
        position: { x: 300 + agentNumber * 96, y: 520 },
        role: {
          kind: "custom",
          name: `Specialist ${agentNumber}`,
          instructions: "Handle a focused caller intent and hand off when the request leaves this role.",
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
        branches: [
          {
            id: `branch-${conditionNumber}-1`,
            label: "VIP",
            expression: buildIntentExpression("vip"),
            targetNodeId: branchTarget?.id ?? "",
          },
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

  const openPublishDialog = useCallback(() => {
    setPublishTitle(workflowTitle);
    setSelectedWorkspaceId(activeWorkspaceId);
    setPublishDialogOpen(true);
  }, [activeWorkspaceId, workflowTitle]);

  const publishDraft = useCallback(() => {
    if (publishDisabled) {
      return;
    }

    const title = publishTitle.trim();
    const graph = toWorkflowGraph(nodes, edges, title.length > 0 ? title : workflowTitle);
    const publishedVersion = publishWorkflowVersion({
      workflowId,
      tenantId,
      workspaceId: selectedWorkspaceId,
      environment,
      createdBy,
      graph,
      existingVersions: publishedVersions,
      runtime: workflowRuntime,
      runtimeProfile: workflowRuntimeProfile,
      telephonyProvider: draftSandboxTelephonyProvider,
      memory: runtimePreview.memory,
      budget: runtimePreview.budget,
    });

    setWorkflowTitle(graph.name);
    setPublishedVersions((currentVersions) => [...currentVersions, publishedVersion]);
    savePublishedWorkflowVersion(publishedVersion);
    setPublishDialogOpen(false);
    showToast(`Published ${graph.name} v${publishedVersion.version}`);
  }, [edges, nodes, publishDisabled, publishTitle, publishedVersions, runtimePreview.budget, runtimePreview.memory, selectedWorkspaceId, showToast, workflowRuntime, workflowRuntimeProfile, workflowTitle]);

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
        {
          id: `branch-${selectedNode.id}-${nextBranchNumber}`,
          label: nextIntent.label,
          expression: buildIntentExpression(nextIntent.value),
          targetNodeId: nextTarget?.id ?? "",
        },
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
    void liveSandbox.resetSession();
    showToast("Draft sandbox closed.");
  }, [liveSandbox, showToast]);

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
                  <button role="menuitem" type="button" disabled={selectedNode?.data.kind === "entry"} onClick={() => {
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
              <button className="workflow-button" type="button" onClick={deleteSelected} disabled={selectedNode?.data.kind === "entry"}>
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
        </div>
      </section>

      <section className={builderGridClassName}>
        <div className="workflow-canvas-shell surface-card">
          <ReactFlow
            nodes={nodes}
            edges={edges}
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
                <div className="workflow-panel-title">{validation.ok ? "Ready" : "Needs attention"}</div>
              </div>
              {validation.ok ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
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

          <PublishedVersionHistory versions={publishedVersions} activeCallPin={activeCallPin} />
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
              <label>
                <span>Workflow title</span>
                <input value={publishTitle} onChange={(event) => setPublishTitle(event.target.value)} />
              </label>
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
              <button className="workflow-button workflow-button-primary" type="button" disabled={publishTitle.trim().length === 0} onClick={publishDraft}>
                Publish workflow
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
  lastRoutingDecision: { tier: string; source: string; matchedRuleId?: string | undefined; reason: string } | null;
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
        ? `${lastRoutingDecision.reason} (${lastRoutingDecision.tier} via ${lastRoutingDecision.source}).`
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
            Rule {lastRoutingDecision.matchedRuleId ?? "default"} selected {lastRoutingDecision.tier}.
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
  const sideHandleStyle = { backgroundColor: accent.accent };
  const topCallHandleStyle = { backgroundColor: accent.accent, left: "44%" };
  const topResultHandleStyle = { backgroundColor: accent.accent, left: "56%" };
  const bottomCallHandleStyle = { backgroundColor: accent.accent, left: "44%" };
  const bottomResultHandleStyle = { backgroundColor: accent.accent, left: "56%" };

  return (
    <div className={["builder-node-card", selected ? "builder-node-card-selected" : ""].filter(Boolean).join(" ")} style={accentStyle}>
      {isAgentNode ? (
        <>
          <Handle
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
  onApplyTemplate,
  onChange,
  onSaveTemplate,
}: {
  role: AgentRoleNodeConfig;
  templates: SpecialistRoleTemplate[];
  onApplyTemplate: (templateId: string) => void;
  onChange: (patch: Partial<AgentRoleNodeConfig>) => void;
  onSaveTemplate: () => void;
}) {
  const languagePrompts = role.languagePolicy.languagePrompts ?? {};

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
        <span>Role name</span>
        <input value={role.name} onChange={(event) => onChange({ name: event.target.value })} />
      </label>
      <label>
        <span>Instructions</span>
        <textarea value={role.instructions} rows={6} onChange={(event) => onChange({ instructions: event.target.value })} />
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
      <label>
        <span>Model tier</span>
        <select value={role.defaultModelTier} onChange={(event) => onChange({ defaultModelTier: event.target.value as ModelTier })}>
          <option value="cheap">Cheap</option>
          <option value="standard">Standard</option>
          <option value="sota">SOTA</option>
        </select>
      </label>
      <label>
        <span>Runtime profile override</span>
        <select
          value={role.runtimeProfileOverride ?? "__inherit__"}
          onChange={(event) =>
            onChange({
              runtimeProfileOverride:
                event.target.value === "__inherit__" ? undefined : (event.target.value as RuntimeProfileId),
            })
          }
        >
          <option value="__inherit__">Inherit workflow</option>
          <option value="cost-optimized">Cost optimized</option>
          <option value="balanced">Balanced</option>
          <option value="premium-realtime">Premium realtime</option>
        </select>
      </label>
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
      <label>
        <span>Supported languages</span>
        <select
          multiple
          value={role.languagePolicy.supportedLanguages}
          onChange={(event) =>
            onChange({
              languagePolicy: {
                ...role.languagePolicy,
                supportedLanguages: Array.from(event.target.selectedOptions, (option) => option.value),
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
  targets,
  onChange,
  onAddBranch,
  onDeleteBranch,
}: {
  condition: ConditionNodeConfig;
  targets: Array<{ id: string; label: string; kind: WorkflowNodeKind }>;
  onChange: (condition: ConditionNodeConfig) => void;
  onAddBranch: () => void;
  onDeleteBranch: (branchId: string) => void;
}) {
  return (
    <div className="workflow-form">
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
                value={getIntentValueFromExpression(branch.expression)}
                onChange={(event) =>
                  onChange({
                    ...condition,
                    branches: condition.branches.map((currentBranch) =>
                      currentBranch.id === branch.id
                        ? {
                            ...currentBranch,
                            label:
                              currentBranch.label.trim().length === 0 ||
                              currentBranch.label === getIntentLabelFromExpression(currentBranch.expression)
                                ? getConditionIntentLabel(event.target.value)
                                : currentBranch.label,
                            expression: buildIntentExpression(event.target.value),
                          }
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
          {targets.map((target) => (
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

function PublishedVersionHistory({
  versions,
  activeCallPin,
}: {
  versions: PublishedWorkflowVersion[];
  activeCallPin: ReturnType<typeof pinPublishedWorkflowVersion> | null;
}) {
  if (versions.length === 0) {
    return (
      <div className="workflow-validation-panel">
        <div className="eyebrow-copy">Published versions</div>
        <div className="workflow-muted-panel">No versions published from this draft yet.</div>
      </div>
    );
  }

  return (
    <div className="workflow-validation-panel">
      <div className="workflow-panel-heading">
        <div className="eyebrow-copy">Published versions</div>
        <div className="workflow-panel-title">Immutable snapshots</div>
      </div>
      <div className="workflow-validation-list">
        {versions
          .slice()
          .reverse()
          .map((version) => (
            <div key={version.id} className="workflow-validation-item workflow-version-card">
              <div className="workflow-summary-row">
                <span>Version</span>
                <strong>v{version.version}</strong>
              </div>
              <div className="workflow-summary-row">
                <span>Manifest</span>
                <strong>{version.manifestPreview.manifestId}</strong>
              </div>
              <div className="workflow-summary-row">
                <span>Created</span>
                <strong>{version.createdAt.slice(11, 16)}</strong>
              </div>
            </div>
          ))}
        {activeCallPin !== null ? (
          <div className="workflow-validation-item workflow-validation-item-ok">
            Active call pin: {activeCallPin.callSessionId} stays on v{activeCallPin.version}.
          </div>
        ) : null}
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
      badge: formatModelTier(role.defaultModelTier),
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
  return initialNodes
    .filter((node) => node.data.kind === "agent" && node.data.role?.reusableSpecialist === true)
    .reduce<SpecialistRoleTemplate[]>((templates, node) => {
      if (node.data.role === undefined) {
        return templates;
      }

      return [
        ...templates,
        createSpecialistRoleTemplate({
          id: `specialist-template-${node.id}`,
          workspaceId,
          role: node.data.role,
          createdAt: defaultSpecialistTemplateCreatedAt,
          existingTemplates: templates,
        }),
      ];
    }, []);
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
  const workflowNode = createConditionNode(input);
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

function toWorkflowGraph(nodes: BuilderNode[], edges: BuilderEdge[], name: string): WorkflowGraph {
  return createWorkflowGraph({
    id: workflowId,
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

  const routeTargets = getPolicyRouteTargetOptions(nodes, edges, conditionNode.id);
  const branchFallbackTarget = routeTargets.find((target) => target.kind !== "end") ?? routeTargets[0];
  const fallbackTarget = routeTargets.find((target) => target.kind === "end") ?? routeTargets[0];

  return {
    ...condition,
    branches: condition.branches.map((branch) => {
      if (isPolicyRouteTargetValid(nodes, edges, conditionNode.id, branch.targetNodeId)) {
        return branch;
      }

      return {
        ...branch,
        targetNodeId: branchFallbackTarget?.id ?? "",
      };
    }),
    fallbackTargetNodeId: isPolicyRouteTargetValid(nodes, edges, conditionNode.id, condition.fallbackTargetNodeId)
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
): Array<{ id: string; label: string; kind: WorkflowNodeKind }> {
  return nodes
    .filter(
      (node) =>
        node.id !== conditionNodeId &&
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
): boolean {
  if (targetNodeId.trim().length === 0) {
    return false;
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

function buildIntentExpression(intent: string): string {
  return `intent == "${intent}"`;
}

function getIntentValueFromExpression(expression: string): string {
  const match = /^\s*intent\s*==\s*"([^"]+)"\s*$/.exec(expression);
  const intent = match?.[1];

  return conditionIntentOptions.some((option) => option.value === intent) ? intent! : conditionIntentOptions[0]!.value;
}

function getConditionIntentLabel(intent: string): string {
  return conditionIntentOptions.find((option) => option.value === intent)?.label ?? conditionIntentOptions[0]!.label;
}

function getIntentLabelFromExpression(expression: string): string {
  return getConditionIntentLabel(getIntentValueFromExpression(expression));
}

function buildBuilderEdge(input: {
  connection: Connection;
  id: string;
  kind: WorkflowEdgeKind;
  sourceNode: BuilderNode | undefined;
}): BuilderEdge {
  return applyBuilderEdgeKind({
    edge: {
      id: input.id,
      source: input.connection.source ?? "",
      target: input.connection.target ?? "",
      ...(input.connection.sourceHandle !== null ? { sourceHandle: input.connection.sourceHandle } : {}),
      ...(input.connection.targetHandle !== null ? { targetHandle: input.connection.targetHandle } : {}),
    },
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

type BuilderConnectionDecision =
  | {
      kind: WorkflowEdgeKind;
      sourceHandleRole: WorkflowRelationshipHandleRole;
      targetHandleRole: WorkflowRelationshipHandleRole;
      autoCreateCompanionEdges: Array<{
        relationshipId: string;
        source: "source" | "target";
        target: "source" | "target";
        edgeKind: WorkflowEdgeKind;
        sourceHandleRole: WorkflowRelationshipHandleRole;
        targetHandleRole: WorkflowRelationshipHandleRole;
        condition?: string | undefined;
      }>;
      message?: never;
    }
  | { kind: null; message: string };

function getBuilderConnectionDecision(
  nodes: BuilderNode[],
  edges: BuilderEdge[],
  connection: Pick<Connection, "source" | "target" | "sourceHandle" | "targetHandle">,
): BuilderConnectionDecision {
  return getBuilderPolicyDecision({
    nodes,
    edges,
    sourceId: connection.source,
    targetId: connection.target,
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
    strictHandleRoles: true,
  });
}

function getBuilderPolicyDecision(input: {
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  sourceId: string | null;
  targetId: string | null;
  sourceHandle?: string | null | undefined;
  targetHandle?: string | null | undefined;
  requestedEdgeKind?: WorkflowEdgeKind | undefined;
  strictHandleRoles?: boolean | undefined;
}): BuilderConnectionDecision {
  const sourceId = input.sourceId;
  const targetId = input.targetId;

  if (sourceId === null || targetId === null) {
    return {
      kind: null,
      message: "Reconnect or remove the broken edge before publishing.",
    };
  }

  const sourceNode = input.nodes.find((node) => node.id === sourceId);
  const targetNode = input.nodes.find((node) => node.id === targetId);

  if (sourceNode === undefined || targetNode === undefined) {
    return {
      kind: null,
      message: "Reconnect or remove the broken edge before publishing.",
    };
  }

  const decision = decideWorkflowNodeRelationship({
    sourceNodeId: sourceId,
    targetNodeId: targetId,
    sourceKind: sourceNode.data.kind,
    targetKind: targetNode.data.kind,
    requestedEdgeKind: input.requestedEdgeKind,
    sourceHandleRole: toWorkflowRelationshipSourceHandleRole(input.sourceHandle),
    targetHandleRole: toWorkflowRelationshipTargetHandleRole(input.targetHandle),
    strictHandleRoles: input.strictHandleRoles ?? true,
    existingEdges: input.edges.map(toWorkflowRelationshipEdge),
  });

  if (!decision.allowed) {
    return {
      kind: null,
      message: decision.message,
    };
  }

  return {
    kind: decision.edgeKind,
    sourceHandleRole: decision.sourceHandleRole,
    targetHandleRole: decision.targetHandleRole,
    autoCreateCompanionEdges: decision.autoCreateCompanionEdges,
  };
}

function canCreateBuilderRelationshipFromKind(sourceKind: WorkflowNodeKind, targetKind: WorkflowNodeKind): boolean {
  return decideWorkflowNodeRelationship({
    sourceNodeId: "source",
    targetNodeId: "target",
    sourceKind,
    targetKind,
    requestedEdgeKind: "flow",
    strictHandleRoles: false,
  }).allowed;
}

function toWorkflowRelationshipEdge(edge: BuilderEdge) {
  return {
    id: edge.id,
    sourceNodeId: edge.source,
    targetNodeId: edge.target,
    ...(edge.data?.kind === "return" ? { kind: edge.data.kind } : {}),
    sourceHandleRole: toWorkflowRelationshipSourceHandleRole(edge.sourceHandle),
    targetHandleRole: toWorkflowRelationshipTargetHandleRole(edge.targetHandle),
  };
}

function applyBuilderEdgeHandleRoles(
  edge: BuilderEdge,
  sourceHandleRole: WorkflowRelationshipHandleRole,
  targetHandleRole: WorkflowRelationshipHandleRole,
): BuilderEdge {
  const sourceHandle = toBuilderSourceHandle(sourceHandleRole);
  const targetHandle = toBuilderTargetHandle(targetHandleRole);

  return {
    ...edge,
    ...(sourceHandle !== undefined ? { sourceHandle } : {}),
    ...(targetHandle !== undefined ? { targetHandle } : {}),
  };
}

function toWorkflowRelationshipSourceHandleRole(
  handle: string | null | undefined,
): WorkflowRelationshipHandleRole {
  switch (handle) {
    case "agent-tool-call-source-top":
      return "tool-call-source";
    case "tool-result-source-bottom":
      return "tool-result-source";
    default:
      return "flow-source";
  }
}

function toWorkflowRelationshipTargetHandleRole(
  handle: string | null | undefined,
): WorkflowRelationshipHandleRole {
  switch (handle) {
    case "tool-call-target-bottom":
      return "tool-call-target";
    case "agent-tool-result-target-top":
      return "tool-result-target";
    default:
      return "flow-target";
  }
}

function toBuilderSourceHandle(role: WorkflowRelationshipHandleRole): string | undefined {
  switch (role) {
    case "tool-call-source":
      return "agent-tool-call-source-top";
    case "tool-result-source":
      return "tool-result-source-bottom";
    default:
      return undefined;
  }
}

function toBuilderTargetHandle(role: WorkflowRelationshipHandleRole): string | undefined {
  switch (role) {
    case "tool-call-target":
      return "tool-call-target-bottom";
    case "tool-result-target":
      return "agent-tool-result-target-top";
    default:
      return undefined;
  }
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
