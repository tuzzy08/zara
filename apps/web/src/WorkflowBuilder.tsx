import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

import {
  addEdge,
  Background,
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
  Trash2,
  X,
} from "lucide-react";

import {
  buildRuntimeManifestPreview,
  createAgentRoleNode,
  createConditionNode,
  createEndNode,
  createHandoffNode,
  createHumanEscalationNode,
  createToolNode,
  createWorkflowGraph,
  deleteWorkflowNode,
  pinPublishedWorkflowVersion,
  publishWorkflowVersion,
  serializeWorkflowGraph,
  validateWorkflowGraph,
  type AgentRoleKind,
  type AgentRoleNodeConfig,
  type ConditionNodeConfig,
  type EndNodeConfig,
  type EscalationFallbackMode,
  type HumanEscalationNodeConfig,
  type ModelTier,
  type PublishedWorkflowVersion,
  type RuntimeManifestPreview,
  type TelephonyProvider,
  type ToolNodeConfig,
  type ToolRequestConfig,
  type ToolRequestHeader,
  type VoiceRuntimeKind,
  type Workspace,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNodeKind,
} from "@zara/core";

import { getNextBuilderNodeNumber } from "./workflowBuilderIds";
import { getBuilderNodeAccent } from "./workflowBuilderTheme";
import {
  loadPublishedWorkflowVersionsForWorkspace,
  savePublishedWorkflowVersion,
} from "./workflowSandboxRegistry";
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
type BuilderEdge = Edge;

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
const previewRuntime: VoiceRuntimeKind = "sandwich-pipeline";
const previewTelephony: TelephonyProvider = "twilio";

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

export function WorkflowBuilderScreen({
  activeWorkspaceId,
  workspaces,
}: {
  activeWorkspaceId: string;
  workspaces: Workspace[];
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<BuilderNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<BuilderEdge>(initialEdges);
  const [selectedNodeId, setSelectedNodeId] = useState("condition-route");
  const [workflowTitle, setWorkflowTitle] = useState("Inbound support triage");
  const [publishTitle, setPublishTitle] = useState(workflowTitle);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(activeWorkspaceId);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const [sandboxOpen, setSandboxOpen] = useState(false);
  const [sandboxStatus, setSandboxStatus] = useState<"idle" | "active">("idle");
  const [sandboxMode, setSandboxMode] = useState<"typed" | "voice">("typed");
  const [sandboxCallerTurn, setSandboxCallerTurn] = useState("I need help with a billing charge on my account.");
  const [sandboxTranscript, setSandboxTranscript] = useState<Array<{ speaker: "caller" | "agent"; text: string }>>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [publishedVersions, setPublishedVersions] = useState<PublishedWorkflowVersion[]>(() =>
    loadPublishedWorkflowVersionsForWorkspace({ tenantId, workspaceId: activeWorkspaceId }).filter(
      (version) => version.manifestPreview.workflowId === workflowId,
    ),
  );

  const workflowGraph = useMemo(() => toWorkflowGraph(nodes, edges, workflowTitle), [edges, nodes, workflowTitle]);
  const validation = useMemo(() => validateWorkflowGraph(workflowGraph), [workflowGraph]);
  const serializedGraph = useMemo(() => serializeWorkflowGraph(workflowGraph), [workflowGraph]);
  const runtimePreview = useMemo(
    () =>
      buildRuntimeManifestPreview({
        tenantId,
        environment,
        workflowId,
        graph: workflowGraph,
        runtime: previewRuntime,
        telephonyProvider: previewTelephony,
        memory: {
          mode: "scoped",
          retrievalScopes: ["session", "caller", "account"],
          approvalRequired: true,
        },
        budget: {
          monthlyCapUsd: 1200,
          currentSpendUsd: 482,
          projectedCostPerMinuteUsd: 0.24,
          blockOnLimit: true,
        },
      }),
    [workflowGraph],
  );
  const entryAgentName = useMemo(
    () => nodes.find((node) => node.data.kind === "agent" && node.data.role !== undefined)?.data.role?.name ?? "Draft agent",
    [nodes],
  );
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? nodes[0];
  const publishDisabled = !validation.ok;
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
    () =>
      nodes
        .filter((node) => node.id !== selectedNodeId && node.data.kind !== "entry")
        .map((node) => ({
          id: node.id,
          label: node.data.label,
          kind: node.data.kind,
        })),
    [nodes, selectedNodeId],
  );
  const nodeIds = useMemo(() => nodes.map((node) => node.id), [nodes]);

  useEffect(() => {
    setSelectedWorkspaceId(activeWorkspaceId);
    setPublishedVersions(
      loadPublishedWorkflowVersionsForWorkspace({ tenantId, workspaceId: activeWorkspaceId }).filter(
        (version) => version.manifestPreview.workflowId === workflowId,
      ),
    );
  }, [activeWorkspaceId]);

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

  const onConnect = useCallback(
    (connection: Connection) => {
      if (connection.source === null || connection.target === null) {
        return;
      }

      setEdges((currentEdges) =>
        addEdge(
          {
            ...connection,
            id: buildEdgeId(connection.source, connection.target, currentEdges),
          },
          currentEdges,
        ),
      );
    },
    [setEdges],
  );

  const onReconnect = useCallback(
    (previousEdge: BuilderEdge, connection: Connection) => {
      if (connection.source === null || connection.target === null) {
        return;
      }

      setEdges((currentEdges) => reconnectEdge(previousEdge, connection, currentEdges, { shouldReplaceId: false }));
      setNodes((currentNodes) => syncNodesForReconnectedEdge(currentNodes, previousEdge, connection.source, connection.target));
    },
    [setEdges, setNodes],
  );

  const appendLinkedNode = useCallback(
    (nextNode: BuilderNode, label?: string, afterLink?: (edges: BuilderEdge[]) => BuilderEdge[]) => {
      const sourceId =
        selectedNodeId !== undefined && nodes.some((node) => node.id === selectedNodeId)
          ? selectedNodeId
          : "entry";

      setNodes((currentNodes) => [...currentNodes, nextNode]);
      setEdges((currentEdges) => {
        let nextEdges = currentEdges;

        if (
          sourceId !== nextNode.id &&
          !currentEdges.some((edge) => edge.source === sourceId && edge.target === nextNode.id)
        ) {
          nextEdges = [
            ...currentEdges,
            {
              id: buildEdgeId(sourceId, nextNode.id, currentEdges),
              source: sourceId,
              target: nextNode.id,
              ...(label !== undefined ? { label } : {}),
            },
          ];
        }

        return afterLink !== undefined ? afterLink(nextEdges) : nextEdges;
      });
      setSelectedNodeId(nextNode.id);
      setInspectorOpen(true);
    },
    [nodes, selectedNodeId, setEdges, setNodes],
  );

  const addAgent = useCallback(() => {
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
  }, [appendLinkedNode, nodeIds]);

  const addTool = useCallback(() => {
    const toolNumber = getNextBuilderNodeNumber(nodeIds, "tool-node-");
    const catalogItem = toolCatalog[(toolNumber - 1) % toolCatalog.length] ?? defaultToolCatalogItem;

    appendLinkedNode(
      createBuilderToolNode({
        id: `tool-node-${toolNumber}`,
        label: catalogItem.toolName,
        position: { x: 620, y: 80 + toolNumber * 92 },
        toolId: catalogItem.toolId,
        tool: {
          connector: catalogItem.connector,
          toolName: catalogItem.toolName,
          connectionStatus: catalogItem.requiresAuthorization ? "missing" : "connected",
          risk: catalogItem.risk,
          requiresAuthorization: catalogItem.requiresAuthorization,
          requiresHumanApproval: catalogItem.requiresHumanApproval,
          request: cloneToolRequest(catalogItem.request),
        },
      }),
      "tool",
    );
  }, [appendLinkedNode, nodeIds]);

  const addHandoff = useCallback(() => {
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
  }, [appendLinkedNode, nodeIds, selectedNodeId, specialistOptions]);

  const addCondition = useCallback(() => {
    const conditionNumber = getNextBuilderNodeNumber(nodeIds, "condition-node-");
    const fallbackTarget =
      nodes.find((node) => node.data.kind === "end") ??
      nodes.find((node) => node.data.kind !== "entry" && node.id !== selectedNodeId);
    const branchTarget =
      nodes.find((node) => node.data.kind === "handoff") ??
      nodes.find((node) => node.data.kind === "agent" && node.id !== selectedNodeId);

    const conditionNode = createBuilderConditionNode({
      id: `condition-node-${conditionNumber}`,
      label: `Condition ${conditionNumber}`,
      position: { x: 640, y: 260 + conditionNumber * 76 },
      condition: {
        branches: [
          {
            id: `branch-${conditionNumber}-1`,
            label: "High priority",
            expression: 'intent == "vip"',
            targetNodeId: branchTarget?.id ?? "",
          },
        ],
        fallbackLabel: "Fallback",
        fallbackTargetNodeId: fallbackTarget?.id ?? "",
      },
    });

    appendLinkedNode(conditionNode, undefined, (currentEdges) =>
      syncConditionNodeEdges(currentEdges, conditionNode.id, conditionNode.data.condition!),
    );
  }, [appendLinkedNode, nodeIds, selectedNodeId]);

  const addEscalation = useCallback(() => {
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
  }, [appendLinkedNode, nodeIds]);

  const addExit = useCallback(() => {
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
  }, [appendLinkedNode, nodeIds]);

  const deleteSelected = useCallback(() => {
    if (selectedNode === undefined || selectedNode.data.kind === "entry") {
      return;
    }

    const graphAfterDelete = deleteWorkflowNode(workflowGraph, selectedNode.id);
    const remainingNodeIds = new Set(graphAfterDelete.nodes.map((node) => node.id));

    setNodes((currentNodes) => currentNodes.filter((node) => remainingNodeIds.has(node.id)));
    setEdges((currentEdges) =>
      currentEdges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id),
    );
    setSelectedNodeId("entry");
  }, [selectedNode, setEdges, setNodes, workflowGraph]);

  const openPublishDialog = useCallback(() => {
    setPublishTitle(workflowTitle);
    setSelectedWorkspaceId(activeWorkspaceId);
    setPublishDialogOpen(true);
  }, [activeWorkspaceId, workflowTitle]);

  const publishDraft = useCallback(() => {
    if (!validation.ok) {
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
      runtime: previewRuntime,
      telephonyProvider: previewTelephony,
      memory: runtimePreview.memory,
      budget: runtimePreview.budget,
    });

    setWorkflowTitle(graph.name);
    setPublishedVersions((currentVersions) => [...currentVersions, publishedVersion]);
    savePublishedWorkflowVersion(publishedVersion);
    setPublishDialogOpen(false);
    showToast(`Published ${graph.name} v${publishedVersion.version}`);
  }, [edges, nodes, publishTitle, publishedVersions, runtimePreview.budget, runtimePreview.memory, selectedWorkspaceId, showToast, validation.ok, workflowTitle]);

  const openDraftSandbox = useCallback(() => {
    if (!validation.ok) {
      showToast(`${validation.errors.length} issue${validation.errors.length === 1 ? "" : "s"} must be resolved before sandbox.`);
      return;
    }

    setSandboxOpen(true);
    setMoreActionsOpen(false);
    showToast("Draft sandbox ready.");
  }, [showToast, validation.errors.length, validation.ok]);

  const startDraftSandbox = useCallback((mode: "typed" | "voice") => {
    setSandboxMode(mode);
    setSandboxStatus("active");
    showToast(mode === "voice" ? "Draft voice sandbox started." : "Typed draft run started.");
  }, [showToast]);

  const sendDraftSandboxTurn = useCallback(() => {
    const callerText = sandboxCallerTurn.trim();

    if (callerText.length === 0 || sandboxStatus !== "active") {
      return;
    }

    const routeLabel = runtimePreview.conditions[0]?.branches[0]?.label ?? runtimePreview.handoffs[0]?.targetRoleName ?? "entry path";

    setSandboxTranscript((current) => [
      ...current,
      { speaker: "caller", text: callerText },
      {
        speaker: "agent",
        text: `Draft route reached ${routeLabel}. ${entryAgentName} would answer with the current unpublished graph.`,
      },
    ]);
    showToast("Caller turn replayed through the draft.");
  }, [entryAgentName, runtimePreview.conditions, runtimePreview.handoffs, sandboxCallerTurn, sandboxStatus, showToast]);

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

  const updateSelectedCondition = useCallback(
    (nextCondition: ConditionNodeConfig) => {
      if (selectedNode?.data.kind !== "condition") {
        return;
      }

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
      setEdges((currentEdges) => syncConditionNodeEdges(currentEdges, selectedNode.id, nextCondition));
    },
    [selectedNode, setEdges, setNodes],
  );

  const addConditionBranch = useCallback(() => {
    if (selectedNode?.data.kind !== "condition" || selectedNode.data.condition === undefined) {
      return;
    }

    const nextBranchNumber = selectedNode.data.condition.branches.length + 1;
    const nextTarget = routeTargetOptions[0];

    updateSelectedCondition({
      ...selectedNode.data.condition,
      branches: [
        ...selectedNode.data.condition.branches,
        {
          id: `branch-${selectedNode.id}-${nextBranchNumber}`,
          label: `Branch ${nextBranchNumber}`,
          expression: 'intent == "sales"',
          targetNodeId: nextTarget?.id ?? "",
        },
      ],
    });
  }, [routeTargetOptions, selectedNode, updateSelectedCondition]);

  const updateSelectedEscalation = useCallback(
    (patch: Partial<HumanEscalationNodeConfig>) => {
      if (selectedNode?.data.kind !== "human-escalation" || selectedNode.data.escalation === undefined) {
        return;
      }

      const nextEscalation = {
        ...selectedNode.data.escalation,
        ...patch,
      };

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
          <button className="workflow-button" type="button" onClick={addAgent}>
            <Plus size={15} />
            <span>Add agent</span>
          </button>
          <button className="workflow-button" type="button" onClick={addTool}>
            <KeyRound size={15} />
            <span>Add tool</span>
          </button>
          <button className="workflow-button" type="button" onClick={addHandoff}>
            <Handshake size={15} />
            <span>Add handoff</span>
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
                  <button role="menuitem" type="button" onClick={addCondition}>
                    <GitBranch size={14} />
                    <span>Add condition</span>
                  </button>
                  <button role="menuitem" type="button" onClick={addEscalation}>
                    <Headphones size={14} />
                    <span>Add escalation</span>
                  </button>
                  <button role="menuitem" type="button" onClick={addExit}>
                    <PhoneOff size={14} />
                    <span>Add exit</span>
                  </button>
                  <button role="menuitem" type="button" disabled={selectedNode?.data.kind === "entry"} onClick={deleteSelected}>
                    <Trash2 size={14} />
                    <span>Delete selected</span>
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <button className="workflow-button" type="button" onClick={addCondition}>
                <GitBranch size={15} />
                <span>Add condition</span>
              </button>
              <button className="workflow-button" type="button" onClick={addEscalation}>
                <Headphones size={15} />
                <span>Add escalation</span>
              </button>
              <button className="workflow-button" type="button" onClick={addExit}>
                <PhoneOff size={15} />
                <span>Add exit</span>
              </button>
              <button className="workflow-button" type="button" onClick={deleteSelected} disabled={selectedNode?.data.kind === "entry"}>
                <Trash2 size={15} />
                <span>Delete selected</span>
              </button>
            </>
          )}
          <button className="workflow-button workflow-button-primary" type="button" disabled={publishDisabled} onClick={openPublishDialog}>
            Publish
          </button>
          <button className="workflow-button" type="button" disabled={publishDisabled} onClick={openDraftSandbox}>
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
            <AgentRoleInspector role={selectedNode.data.role} onChange={updateSelectedRole} />
          ) : null}
          {selectedNode?.data.kind === "tool" && selectedNode.data.tool !== undefined ? (
            <ToolInspector
              tool={selectedNode.data.tool}
              toolId={selectedNode.data.toolId ?? defaultToolCatalogItem.toolId}
              onChange={updateSelectedTool}
            />
          ) : null}
          {selectedNode?.data.kind === "handoff" && selectedNode.data.handoff !== undefined ? (
            <HandoffInspector handoff={selectedNode.data.handoff} specialists={specialistOptions} onChange={updateSelectedHandoff} />
          ) : null}
          {selectedNode?.data.kind === "condition" && selectedNode.data.condition !== undefined ? (
            <ConditionInspector
              condition={selectedNode.data.condition}
              targets={routeTargetOptions}
              onChange={updateSelectedCondition}
              onAddBranch={addConditionBranch}
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
              {validation.errors.length > 0 ? (
                validation.errors.slice(0, 4).map((error) => (
                  <div key={`${error.code}-${error.nodeId ?? error.edgeId ?? error.message}`} className="workflow-validation-item">
                    <div className="workflow-validation-code">{error.code}</div>
                    <div>{error.suggestion}</div>
                  </div>
                ))
              ) : (
                <div className="workflow-validation-item workflow-validation-item-ok">
                  Publish checks are clear for this draft.
                </div>
              )}
            </div>
          </div>

          <ManifestPreview runtimePreview={runtimePreview} serializedGraph={serializedGraph} />
          <PublishedVersionHistory versions={publishedVersions} activeCallPin={activeCallPin} />
        </aside>
        ) : null}

        {sandboxOpen ? (
          <WorkflowSandboxDrawer
            callerTurn={sandboxCallerTurn}
            mode={sandboxMode}
            runtimePreview={runtimePreview}
            status={sandboxStatus}
            transcript={sandboxTranscript}
            entryAgentName={entryAgentName}
            workflowTitle={workflowTitle}
            onCallerTurnChange={setSandboxCallerTurn}
            onClose={closeSandbox}
            onSendTurn={sendDraftSandboxTurn}
            onStart={startDraftSandbox}
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
  entryAgentName,
  mode,
  runtimePreview,
  status,
  transcript,
  workflowTitle,
  onCallerTurnChange,
  onClose,
  onSendTurn,
  onStart,
}: {
  callerTurn: string;
  entryAgentName: string;
  mode: "typed" | "voice";
  runtimePreview: RuntimeManifestPreview;
  status: "idle" | "active";
  transcript: Array<{ speaker: "caller" | "agent"; text: string }>;
  workflowTitle: string;
  onCallerTurnChange: (value: string) => void;
  onClose: () => void;
  onSendTurn: () => void;
  onStart: (mode: "typed" | "voice") => void;
}) {
  const firstTool = runtimePreview.tools[0];
  const firstRoute = runtimePreview.conditions[0]?.branches[0];

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

      <div className="workflow-sandbox-actions">
        <button className="workflow-button workflow-button-primary" type="button" disabled={status === "active"} onClick={() => onStart("voice")}>
          <PhoneCall size={15} />
          <span>Start draft sandbox</span>
        </button>
        <button className="workflow-button" type="button" disabled={status === "active"} onClick={() => onStart("typed")}>
          <Play size={15} />
          <span>Use typed run</span>
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
      </div>

      <label className="sandbox-composer workflow-sandbox-composer">
        <span className="sandbox-field-label">Caller turn</span>
        <textarea value={callerTurn} onChange={(event) => onCallerTurnChange(event.target.value)} />
      </label>

      <button className="workflow-button workflow-button-primary" type="button" disabled={status !== "active" || callerTurn.trim().length === 0} onClick={onSendTurn}>
        Send caller turn
      </button>

      <div className="workflow-sandbox-section">
        <div className="sandbox-pane-header">
          <span>Transcript</span>
          <span>{transcript.length} entries</span>
        </div>
        <div className="workflow-sandbox-transcript" aria-live="polite">
          {transcript.length === 0 ? <div className="sandbox-empty-copy">Start a draft run to inspect the current graph before publishing.</div> : null}
          {transcript.map((entry, index) => (
            <article key={`${entry.speaker}-${index}`} className={`sandbox-transcript-item sandbox-transcript-item-${entry.speaker}`}>
              <div className="sandbox-transcript-meta">
                <span>{entry.speaker === "caller" ? "Caller" : "Agent"}</span>
                <span>draft</span>
              </div>
              <p>{entry.text}</p>
            </article>
          ))}
        </div>
      </div>

      <div className="workflow-sandbox-section">
        <div className="sandbox-pane-header">
          <span>Runtime decision</span>
          <span>{runtimePreview.runtime}</span>
        </div>
        <div className="body-copy">
          {firstRoute !== undefined
            ? `First branch evaluates ${firstRoute.label} before routing to ${firstRoute.targetNodeId}.`
            : "The draft starts at the entry role and follows the current graph validation path."}
        </div>
      </div>

      <div className="workflow-sandbox-section">
        <div className="sandbox-pane-header">
          <span>Tool check</span>
          <span>{runtimePreview.tools.length} tools</span>
        </div>
        <div className="body-copy">
          {firstTool !== undefined
            ? `${firstTool.toolName} is ${firstTool.integrationConnectionId === undefined ? "missing credentials" : "connected"} and marked ${firstTool.risk} risk.`
            : "No tool nodes are required for this draft path."}
        </div>
      </div>
    </aside>
  );
}

function BuilderNodeCard({ data, selected }: NodeProps<BuilderNode>) {
  const Icon = getNodeIcon(data.kind);
  const accent = getBuilderNodeAccent(data.kind);
  const accentStyle = {
    "--builder-node-accent": accent.accent,
    "--builder-node-accent-soft": accent.tint,
  } as CSSProperties;

  return (
    <div className={["builder-node-card", selected ? "builder-node-card-selected" : ""].filter(Boolean).join(" ")} style={accentStyle}>
      <Handle type="target" position={Position.Left} style={{ backgroundColor: accent.accent }} />
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
      <Handle type="source" position={Position.Right} style={{ backgroundColor: accent.accent }} />
    </div>
  );
}

function AgentRoleInspector({
  role,
  onChange,
}: {
  role: AgentRoleNodeConfig;
  onChange: (patch: Partial<AgentRoleNodeConfig>) => void;
}) {
  return (
    <div className="workflow-form">
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
          <option value="en">English</option>
          <option value="fr">French</option>
          <option value="es">Spanish</option>
        </select>
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
            const defaultConnection =
              getIntegrationOptions(nextTool.connector).find((option) => option.status === "connected") ??
              getIntegrationOptions(nextTool.connector)[0];

            onChange({
              toolId: nextTool.toolId,
              connector: nextTool.connector,
              toolName: nextTool.toolName,
              risk: nextTool.risk,
              requiresAuthorization: nextTool.requiresAuthorization,
              requiresHumanApproval: nextTool.requiresHumanApproval,
              request: cloneToolRequest(nextTool.request),
              ...(defaultConnection !== undefined
                ? {
                    integrationConnectionId:
                      defaultConnection.status === "missing" ? undefined : defaultConnection.value,
                    integrationLabel:
                      defaultConnection.status === "missing" ? undefined : defaultConnection.label,
                    connectionStatus: defaultConnection.status,
                  }
                : {}),
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
  onChange,
}: {
  handoff: BuilderNodeData["handoff"];
  specialists: Array<{ id: string; name: string }>;
  onChange: (patch: Partial<BuilderNodeData["handoff"]>) => void;
}) {
  if (handoff === undefined) {
    return null;
  }

  return (
    <div className="workflow-form">
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
}: {
  condition: ConditionNodeConfig;
  targets: Array<{ id: string; label: string; kind: WorkflowNodeKind }>;
  onChange: (condition: ConditionNodeConfig) => void;
  onAddBranch: () => void;
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
              <span>Expression</span>
              <input
                value={branch.expression}
                onChange={(event) =>
                  onChange({
                    ...condition,
                    branches: condition.branches.map((currentBranch) =>
                      currentBranch.id === branch.id
                        ? {
                            ...currentBranch,
                            expression: event.target.value,
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

function ManifestPreview({
  runtimePreview,
  serializedGraph,
}: {
  runtimePreview: RuntimeManifestPreview;
  serializedGraph: string;
}) {
  return (
    <div className="workflow-serialization">
      <div className="eyebrow-copy">Manifest preview</div>
      <div className="workflow-preview-grid">
        <PreviewMetric label="Runtime" value={formatRuntimeLabel(runtimePreview.runtime)} />
        <PreviewMetric label="Telephony" value={formatTelephonyLabel(runtimePreview.telephonyProvider)} />
        <PreviewMetric label="Memory" value={runtimePreview.memory.retrievalScopes.join(", ")} />
        <PreviewMetric label="Budget" value={`$${runtimePreview.budget.monthlyCapUsd}`} />
      </div>
      <div className="workflow-preview-list">
        {runtimePreview.tools.map((tool) => (
          <div key={tool.nodeId} className="workflow-preview-row">
            <span>{tool.label}</span>
            <strong>
              {formatConnectorLabel(tool.connector)}
              {tool.request !== undefined ? ` - ${tool.request.method}` : ""}
            </strong>
          </div>
        ))}
        {runtimePreview.conditions.map((condition) => (
          <div key={condition.nodeId} className="workflow-preview-row">
            <span>{condition.label}</span>
            <strong>{condition.branches.length} branch{condition.branches.length === 1 ? "" : "es"} + fallback</strong>
          </div>
        ))}
        {runtimePreview.exitNodes.map((exitNode) => (
          <div key={exitNode.nodeId} className="workflow-preview-row">
            <span>{exitNode.label}</span>
            <strong>{exitNode.outcome}</strong>
          </div>
        ))}
        {runtimePreview.escalation !== null ? (
          <div className="workflow-preview-row">
            <span>Escalation</span>
            <strong>{runtimePreview.escalation.queueName}</strong>
          </div>
        ) : null}
      </div>
      <code>{serializedGraph.length} bytes serialized</code>
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

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="workflow-preview-metric">
      <span>{label}</span>
      <strong>{value}</strong>
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
  nodeId: string,
  condition: ConditionNodeConfig,
): BuilderEdge[] {
  const preservedEdges = edges.filter((edge) => edge.source !== nodeId);
  const branchEdges = condition.branches
    .filter((branch) => branch.targetNodeId.trim().length > 0)
    .map((branch) => ({
      id: `edge-${nodeId}-${branch.targetNodeId}-${branch.id}`,
      source: nodeId,
      target: branch.targetNodeId,
      label: branch.label,
    }));
  const fallbackEdge =
    condition.fallbackTargetNodeId.trim().length > 0
      ? [
          {
            id: `edge-${nodeId}-${condition.fallbackTargetNodeId}-fallback`,
            source: nodeId,
            target: condition.fallbackTargetNodeId,
            label: condition.fallbackLabel,
          },
        ]
      : [];

  return [...preservedEdges, ...branchEdges, ...fallbackEdge];
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

function formatRuntimeLabel(runtime: VoiceRuntimeKind) {
  switch (runtime) {
    case "sandwich-pipeline":
      return "Cost optimized";
    case "openai-realtime":
      return "Premium realtime";
    default:
      return "Balanced";
  }
}

function formatTelephonyLabel(provider: TelephonyProvider) {
  switch (provider) {
    case "custom-sip":
      return "BYO SIP";
    case "browser-webrtc":
      return "Browser sandbox";
    default:
      return capitalize(provider);
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
