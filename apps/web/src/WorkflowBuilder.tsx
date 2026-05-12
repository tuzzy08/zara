import { useCallback, useMemo, useState } from "react";

import {
  addEdge,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
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
  GitBranchPlus,
  Handshake,
  Headphones,
  KeyRound,
  Plus,
  RadioTower,
  Trash2,
} from "lucide-react";

import {
  buildDraftWorkflowManifest,
  createAgentRoleNode,
  createHandoffNode,
  createHumanEscalationNode,
  createToolNode,
  createWorkflowGraph,
  deleteWorkflowNode,
  serializeWorkflowGraph,
  validateWorkflowGraph,
  type AgentRoleKind,
  type AgentRoleNodeConfig,
  type DraftWorkflowManifest,
  type EscalationFallbackMode,
  type HandoffNodeConfig,
  type HumanEscalationNodeConfig,
  type ModelTier,
  type ToolNodeConfig,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNodeKind,
} from "@zara/core";

interface BuilderNodeData extends Record<string, unknown> {
  kind: WorkflowNodeKind;
  label: string;
  badge: string;
  subtitle: string;
  role?: AgentRoleNodeConfig;
  toolId?: string | undefined;
  tool?: ToolNodeConfig;
  handoff?: HandoffNodeConfig;
  escalation?: HumanEscalationNodeConfig;
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
  },
  {
    toolId: "zendesk.comment",
    toolName: "Ticket note",
    connector: "zendesk",
    risk: "medium",
    requiresAuthorization: true,
    requiresHumanApproval: true,
  },
  {
    toolId: "hubspot.lookup_contact",
    toolName: "Contact lookup",
    connector: "hubspot",
    risk: "low",
    requiresAuthorization: true,
    requiresHumanApproval: false,
  },
  {
    toolId: "webhook.post",
    toolName: "Webhook action",
    connector: "webhook",
    risk: "high",
    requiresAuthorization: false,
    requiresHumanApproval: true,
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

const initialNodes: BuilderNode[] = [
  {
    id: "entry",
    type: "builderNode",
    position: { x: 0, y: 210 },
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
    position: { x: 250, y: 104 },
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
    position: { x: 550, y: 34 },
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
    },
  }),
  createBuilderHandoffNode({
    id: "handoff-billing",
    label: "Billing handoff",
    position: { x: 540, y: 206 },
    handoff: {
      targetRoleId: "agent-billing",
      targetRoleName: "Billing specialist",
      handoffReason: "Route invoice disputes and refund conversations to the billing lane.",
    },
  }),
  createBuilderAgentNode({
    id: "agent-billing",
    label: "Billing specialist",
    position: { x: 850, y: 196 },
    role: {
      kind: "billing",
      name: "Billing specialist",
      instructions:
        "Resolve invoice disputes, explain charges, update billing notes, and send high-risk refunds to human review.",
      defaultModelTier: "standard",
      languagePolicy: {
        defaultLanguage: "en",
        supportedLanguages: ["en"],
        allowMidCallSwitching: false,
      },
      reusableSpecialist: true,
    },
  }),
  createBuilderEscalationNode({
    id: "human-escalation",
    label: "Human escalation",
    position: { x: 558, y: 382 },
    escalation: {
      queueId: "support-ops",
      queueName: "Support operations",
      fallbackMode: "callback",
      fallbackMessage: "Offer a callback if no operator is immediately available.",
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
    id: "edge-front-desk-handoff",
    source: "agent-front-desk",
    target: "handoff-billing",
    label: "billing",
  },
  {
    id: "edge-handoff-billing",
    source: "handoff-billing",
    target: "agent-billing",
  },
  {
    id: "edge-front-desk-escalation",
    source: "agent-front-desk",
    target: "human-escalation",
    label: "human",
  },
];

export function WorkflowBuilderScreen() {
  const [nodes, setNodes, onNodesChange] = useNodesState<BuilderNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<BuilderEdge>(initialEdges);
  const [selectedNodeId, setSelectedNodeId] = useState("agent-front-desk");

  const workflowGraph = useMemo(() => toWorkflowGraph(nodes, edges), [nodes, edges]);
  const validation = useMemo(() => validateWorkflowGraph(workflowGraph), [workflowGraph]);
  const serializedGraph = useMemo(() => serializeWorkflowGraph(workflowGraph), [workflowGraph]);
  const draftManifest = useMemo(() => buildDraftWorkflowManifest(workflowGraph), [workflowGraph]);
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? nodes[0];
  const publishDisabled = !validation.ok;
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

  const appendNodeFromSelection = useCallback(
    (nextNode: BuilderNode, label?: string) => {
      const sourceId =
        selectedNodeId !== undefined && nodes.some((node) => node.id === selectedNodeId)
          ? selectedNodeId
          : "entry";

      setNodes((currentNodes) => [...currentNodes, nextNode]);
      setEdges((currentEdges) => {
        if (sourceId === nextNode.id || currentEdges.some((edge) => edge.source === sourceId && edge.target === nextNode.id)) {
          return currentEdges;
        }

        return [
          ...currentEdges,
          {
            id: buildEdgeId(sourceId, nextNode.id, currentEdges),
            source: sourceId,
            target: nextNode.id,
            ...(label !== undefined ? { label } : {}),
          },
        ];
      });
      setSelectedNodeId(nextNode.id);
    },
    [nodes, selectedNodeId, setEdges, setNodes],
  );

  const addAgent = useCallback(() => {
    const agentNumber = nodes.filter((node) => node.data.kind === "agent").length + 1;
    const id = `agent-specialist-${agentNumber}`;

    appendNodeFromSelection(
      createBuilderAgentNode({
        id,
        label: `Specialist ${agentNumber}`,
        position: { x: 260 + agentNumber * 72, y: 520 },
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
  }, [appendNodeFromSelection, nodes]);

  const addTool = useCallback(() => {
    const toolNumber = nodes.filter((node) => node.data.kind === "tool").length + 1;
    const catalogItem = toolCatalog[(toolNumber - 1) % toolCatalog.length] ?? defaultToolCatalogItem;
    const toolConnection =
      catalogItem.requiresAuthorization
        ? { connectionStatus: "missing" as const }
        : {
            connectionStatus: "connected" as const,
            integrationConnectionId: "internal-runtime",
            integrationLabel: "Internal runtime",
          };

    appendNodeFromSelection(
      createBuilderToolNode({
        id: `tool-node-${toolNumber}`,
        label: catalogItem.toolName,
        position: { x: 560, y: 120 + toolNumber * 86 },
        toolId: catalogItem.toolId,
        tool: {
          connector: catalogItem.connector,
          toolName: catalogItem.toolName,
          risk: catalogItem.risk,
          requiresAuthorization: catalogItem.requiresAuthorization,
          requiresHumanApproval: catalogItem.requiresHumanApproval,
          ...toolConnection,
        },
      }),
      "tool",
    );
  }, [appendNodeFromSelection, nodes]);

  const addHandoff = useCallback(() => {
    const handoffNumber = nodes.filter((node) => node.data.kind === "handoff").length + 1;
    const target = specialistOptions.find((option) => option.id !== selectedNodeId) ?? specialistOptions[0];

    appendNodeFromSelection(
      createBuilderHandoffNode({
        id: `handoff-node-${handoffNumber}`,
        label: target !== undefined ? `${target.name} handoff` : `Handoff ${handoffNumber}`,
        position: { x: 570, y: 220 + handoffNumber * 92 },
        handoff: {
          targetRoleId: target?.id ?? "",
          targetRoleName: target?.name ?? "",
          handoffReason: target !== undefined ? `Route the call to ${target.name} when specialist handling is required.` : "",
        },
      }),
      "handoff",
    );
  }, [appendNodeFromSelection, selectedNodeId, specialistOptions, nodes]);

  const addEscalation = useCallback(() => {
    const escalationNumber = nodes.filter((node) => node.data.kind === "human-escalation").length + 1;
    const queue = queueOptions[(escalationNumber - 1) % queueOptions.length] ?? defaultQueueOption;

    appendNodeFromSelection(
      createBuilderEscalationNode({
        id: `human-escalation-${escalationNumber}`,
        label: "Human escalation",
        position: { x: 560, y: 360 + escalationNumber * 92 },
        escalation: {
          queueId: queue.queueId,
          queueName: queue.queueName,
          fallbackMode: queue.fallbackMode,
          fallbackMessage: "Offer a callback if no operator accepts within the queue target.",
        },
      }),
      "human",
    );
  }, [appendNodeFromSelection, nodes]);

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
      const { toolId: patchedToolId, clearConnection = false, ...toolPatch } = patch;
      const nextToolId = patchedToolId ?? selectedNode.data.toolId ?? defaultToolCatalogItem.toolId;
      const nextTool = {
        ...currentTool,
        ...toolPatch,
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
    (patch: Partial<HandoffNodeConfig>) => {
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

  return (
    <div className="workflow-page">
      <section className="workflow-toolbar surface-card">
        <div>
          <div className="eyebrow-copy">Publishable draft</div>
          <h1 className="workflow-title">Workflow builder</h1>
        </div>
        <div className="workflow-toolbar-meta">
          <span className="workflow-name">Inbound support triage</span>
          <span className={validation.ok ? "workflow-valid-pill" : "workflow-warning-pill"}>
            {validation.ok ? "Validation clear" : `${validation.errors.length} issue${validation.errors.length === 1 ? "" : "s"}`}
          </span>
        </div>
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
          <button className="workflow-button" type="button" onClick={addEscalation}>
            <Headphones size={15} />
            <span>Add escalation</span>
          </button>
          <button className="workflow-button" type="button" onClick={deleteSelected} disabled={selectedNode?.data.kind === "entry"}>
            <Trash2 size={15} />
            <span>Delete selected</span>
          </button>
          <button className="workflow-button workflow-button-primary" type="button" disabled={publishDisabled}>
            Publish
          </button>
        </div>
      </section>

      <section className="workflow-builder-grid">
        <aside className="workflow-library surface-card" aria-label="Node library">
          <div className="workflow-panel-heading">
            <div className="eyebrow-copy">Library</div>
            <div className="workflow-panel-title">Workflow nodes</div>
          </div>
          <div className="workflow-library-list">
            <LibraryItem icon={RadioTower} title="Entry call" detail="One entry node anchors each published draft." meta="1 active" disabled />
            <LibraryItem
              icon={Bot}
              title="Agent role"
              detail="Reusable voice specialist with routing and language policy."
              meta={`${specialistOptions.length} active`}
              onClick={addAgent}
            />
            <LibraryItem
              icon={KeyRound}
              title="Tool node"
              detail="Bound integration action with risk and approval posture."
              meta={`${draftManifest.tools.length} bound`}
              onClick={addTool}
            />
            <LibraryItem
              icon={Handshake}
              title="Handoff node"
              detail="Explicit specialist route with intent-driven reason."
              meta={`${draftManifest.handoffs.length} active`}
              onClick={addHandoff}
            />
            <LibraryItem
              icon={Headphones}
              title="Human escalation"
              detail="Queue binding with fallback behavior when operators are unavailable."
              meta={draftManifest.escalation?.queueName ?? "Not configured"}
              onClick={addEscalation}
            />
          </div>
        </aside>

        <div className="workflow-canvas-shell surface-card">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            fitView
            minZoom={0.4}
            maxZoom={1.2}
            defaultEdgeOptions={{
              type: "smoothstep",
              animated: false,
            }}
          >
            <Background gap={22} size={1} />
            <MiniMap pannable zoomable nodeStrokeWidth={3} />
            <Controls position="bottom-left" />
          </ReactFlow>
        </div>

        <aside className="workflow-inspector surface-card" aria-label="Selected node inspector">
          <div className="workflow-panel-heading">
            <div className="eyebrow-copy">Inspector</div>
            <div className="workflow-panel-title">{selectedNode?.data.label ?? "No node selected"}</div>
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
          {selectedNode?.data.kind === "human-escalation" && selectedNode.data.escalation !== undefined ? (
            <EscalationInspector escalation={selectedNode.data.escalation} onChange={updateSelectedEscalation} />
          ) : null}
          {selectedNode === undefined ||
          (selectedNode.data.kind !== "agent" &&
            selectedNode.data.kind !== "tool" &&
            selectedNode.data.kind !== "handoff" &&
            selectedNode.data.kind !== "human-escalation") ? (
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

          <ManifestPreview draftManifest={draftManifest} serializedGraph={serializedGraph} />
        </aside>
      </section>
    </div>
  );
}

function BuilderNodeCard({ data, selected }: NodeProps<BuilderNode>) {
  const Icon = getNodeIcon(data.kind);

  return (
    <div className={["builder-node-card", selected ? "builder-node-card-selected" : ""].filter(Boolean).join(" ")}>
      <Handle type="target" position={Position.Left} />
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
      <Handle type="source" position={Position.Right} />
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
              getIntegrationOptions(nextTool.connector)[0] ?? {
                value: "internal-runtime",
                label: "Internal runtime",
                status: "connected" as const,
              };

            onChange({
              toolId: nextTool.toolId,
              connector: nextTool.connector,
              toolName: nextTool.toolName,
              risk: nextTool.risk,
              requiresAuthorization: nextTool.requiresAuthorization,
              requiresHumanApproval: nextTool.requiresHumanApproval,
              integrationConnectionId: defaultConnection.value,
              integrationLabel: defaultConnection.label,
              connectionStatus: defaultConnection.status,
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
          value={
            tool.connectionStatus === "missing"
              ? "__missing__"
              : tool.integrationConnectionId ?? tool.connectionStatus
          }
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
  handoff: HandoffNodeConfig;
  specialists: Array<{ id: string; name: string }>;
  onChange: (patch: Partial<HandoffNodeConfig>) => void;
}) {
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
      {node.data.kind === "entry" ? (
        <div className="workflow-summary-row">
          <span>Starts</span>
          <strong>Phone channel</strong>
        </div>
      ) : null}
    </div>
  );
}

function ManifestPreview({
  draftManifest,
  serializedGraph,
}: {
  draftManifest: DraftWorkflowManifest;
  serializedGraph: string;
}) {
  return (
    <div className="workflow-serialization">
      <div className="eyebrow-copy">Manifest input</div>
      <div className="workflow-preview-grid">
        <PreviewMetric label="Entry role" value={draftManifest.entryRoleId ?? "Unset"} />
        <PreviewMetric label="Tools" value={String(draftManifest.tools.length)} />
        <PreviewMetric label="Handoffs" value={String(draftManifest.handoffs.length)} />
        <PreviewMetric label="Escalation" value={draftManifest.escalation?.queueName ?? "Off"} />
      </div>
      <div className="workflow-preview-list">
        {draftManifest.tools.map((tool) => (
          <div key={tool.nodeId} className="workflow-preview-row">
            <span>{tool.label}</span>
            <strong>{formatConnectorLabel(tool.connector)}</strong>
          </div>
        ))}
        {draftManifest.handoffs.map((handoff) => (
          <div key={handoff.nodeId} className="workflow-preview-row">
            <span>{handoff.label}</span>
            <strong>{handoff.targetRoleName || "Unassigned"}</strong>
          </div>
        ))}
        {draftManifest.escalation !== null ? (
          <div className="workflow-preview-row">
            <span>Human fallback</span>
            <strong>{draftManifest.escalation.fallbackMode}</strong>
          </div>
        ) : null}
      </div>
      <code>{serializedGraph.length} bytes serialized</code>
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

function LibraryItem({
  icon: Icon,
  title,
  detail,
  meta,
  onClick,
  disabled = false,
}: {
  icon: typeof Bot;
  title: string;
  detail: string;
  meta: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button className="workflow-library-item" type="button" onClick={onClick} disabled={disabled}>
      <Icon size={15} />
      <span className="workflow-library-copy">
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <span className="workflow-library-meta">{meta}</span>
    </button>
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
      subtitle: `${formatConnectorLabel(tool.connector)} - ${formatRiskLabel(tool.risk)}`,
      tool,
      ...(workflowNode.toolId !== undefined ? { toolId: workflowNode.toolId } : {}),
    },
  };
}

function createBuilderHandoffNode(input: {
  id: string;
  label: string;
  position: { x: number; y: number };
  handoff: HandoffNodeConfig;
}): BuilderNode {
  const workflowNode = createHandoffNode(input);
  const handoff = workflowNode.config["handoff"] as HandoffNodeConfig;

  return {
    id: workflowNode.id,
    type: "builderNode",
    position: workflowNode.position,
    data: {
      kind: "handoff",
      label: workflowNode.label,
      badge: handoff.targetRoleName || "Unassigned",
      subtitle: handoff.handoffReason || "No handoff reason configured",
      handoff,
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

function toWorkflowGraph(nodes: BuilderNode[], edges: BuilderEdge[]): WorkflowGraph {
  return createWorkflowGraph({
    id: "workflow-inbound-support-triage",
    name: "Inbound support triage",
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

  if (node.data.kind === "human-escalation" && node.data.escalation !== undefined) {
    return createHumanEscalationNode({
      id: node.id,
      label: node.data.label,
      position: node.position,
      escalation: node.data.escalation,
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

function getNodeIcon(kind: WorkflowNodeKind) {
  switch (kind) {
    case "entry":
      return RadioTower;
    case "agent":
      return Bot;
    case "tool":
      return KeyRound;
    case "handoff":
      return Handshake;
    case "human-escalation":
      return Headphones;
    default:
      return GitBranchPlus;
  }
}

function getNodeKindLabel(kind: WorkflowNodeKind) {
  switch (kind) {
    case "human-escalation":
      return "Human escalation";
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

function formatRiskLabel(risk: ToolNodeConfig["risk"]) {
  switch (risk) {
    case "low":
      return "Low risk";
    case "medium":
      return "Medium risk";
    default:
      return "High risk";
  }
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
      return [{ value: "webhook-orders", label: "Orders webhook", status: "connected" }];
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

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
