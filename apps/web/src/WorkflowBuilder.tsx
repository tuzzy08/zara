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
  createAgentRoleNode,
  createWorkflowGraph,
  deleteWorkflowNode,
  serializeWorkflowGraph,
  validateWorkflowGraph,
  type AgentRoleKind,
  type AgentRoleNodeConfig,
  type ModelTier,
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
  toolId?: string;
  config?: Record<string, unknown>;
}

type BuilderNode = Node<BuilderNodeData, "builderNode">;
type BuilderEdge = Edge;

const nodeTypes = {
  builderNode: BuilderNodeCard,
};

const initialNodes: BuilderNode[] = [
  {
    id: "entry",
    type: "builderNode",
    position: { x: 0, y: 170 },
    data: {
      kind: "entry",
      label: "Entry call",
      badge: "Inbound",
      subtitle: "Support line",
      config: { channel: "phone" },
    },
  },
  {
    id: "agent-front-desk",
    type: "builderNode",
    position: { x: 260, y: 90 },
    data: {
      kind: "agent",
      label: "Front desk triage",
      badge: "Cheap tier",
      subtitle: "English + French",
      role: {
        kind: "receptionist",
        name: "Front desk triage",
        instructions: "Greet callers, classify intent, answer routine reception questions, and route billing disputes to the billing specialist.",
        defaultModelTier: "cheap",
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en", "fr"],
          allowMidCallSwitching: true,
        },
        reusableSpecialist: true,
      },
    },
  },
  {
    id: "agent-billing",
    type: "builderNode",
    position: { x: 600, y: 72 },
    data: {
      kind: "agent",
      label: "Billing specialist",
      badge: "Standard tier",
      subtitle: "Escalation lane",
      role: {
        kind: "billing",
        name: "Billing specialist",
        instructions: "Review invoice questions, explain charges, collect missing account context, and escalate refund approval requests.",
        defaultModelTier: "standard",
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en"],
          allowMidCallSwitching: false,
        },
        reusableSpecialist: true,
      },
    },
  },
  {
    id: "tool-zendesk",
    type: "builderNode",
    position: { x: 600, y: 292 },
    data: {
      kind: "tool",
      label: "Zendesk lookup",
      badge: "Auth needed",
      subtitle: "Ticket search",
      toolId: "zendesk.search",
      config: { requiresAuthorization: true },
    },
  },
  {
    id: "human-escalation",
    type: "builderNode",
    position: { x: 940, y: 182 },
    data: {
      kind: "human-escalation",
      label: "Human escalation",
      badge: "Support queue",
      subtitle: "41s median response",
      config: { queueId: "support-ops", fallback: "callback" },
    },
  },
];

const initialEdges: BuilderEdge[] = [
  {
    id: "edge-entry-front-desk",
    source: "entry",
    target: "agent-front-desk",
  },
  {
    id: "edge-front-desk-billing",
    source: "agent-front-desk",
    target: "agent-billing",
    label: "billing",
  },
  {
    id: "edge-billing-zendesk",
    source: "agent-billing",
    target: "tool-zendesk",
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
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? nodes[0];
  const publishDisabled = !validation.ok;

  const onConnect = useCallback(
    (connection: Connection) => {
      if (connection.source === null || connection.target === null) {
        return;
      }

      setEdges((currentEdges) =>
        addEdge(
          {
            ...connection,
            id: `edge-${connection.source}-${connection.target}`,
          },
          currentEdges,
        ),
      );
    },
    [setEdges],
  );

  const addAgent = useCallback(() => {
    const agentNumber = nodes.filter((node) => node.data.kind === "agent").length + 1;
    const id = `agent-specialist-${agentNumber}`;
    const newNode = createBuilderAgentNode({
      id,
      label: `Specialist ${agentNumber}`,
      position: { x: 260 + agentNumber * 60, y: 380 },
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
    });

    setNodes((currentNodes) => [...currentNodes, newNode]);
    setSelectedNodeId(id);
  }, [nodes, setNodes]);

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

      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          if (node.id !== selectedNode.id || node.data.role === undefined) {
            return node;
          }

          const nextRole = {
            ...node.data.role,
            ...patch,
            languagePolicy: {
              ...node.data.role.languagePolicy,
              ...(patch.languagePolicy ?? {}),
            },
          };

          return {
            ...node,
            data: {
              ...node.data,
              label: nextRole.name || node.data.label,
              badge: formatModelTier(nextRole.defaultModelTier),
              subtitle: nextRole.languagePolicy.supportedLanguages.join(" + ") || "No language set",
              role: nextRole,
            },
          };
        }),
      );
    },
    [selectedNode, setNodes],
  );

  return (
    <div className="workflow-page">
      <section className="workflow-toolbar surface-card">
        <div>
          <div className="eyebrow-copy">MVP builder</div>
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
            <div className="workflow-panel-title">Nodes</div>
          </div>
          <div className="workflow-library-list">
            <LibraryItem icon={RadioTower} title="Entry call" detail="Start every call path" />
            <LibraryItem icon={Bot} title="Agent role" detail="Specialized voice behavior" />
            <LibraryItem icon={KeyRound} title="Tool" detail="Credentialed action" />
            <LibraryItem icon={Handshake} title="Human handoff" detail="Queue and fallback" />
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
          ) : (
            <NodeSummary node={selectedNode} />
          )}

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

          <div className="workflow-serialization">
            <div className="eyebrow-copy">Manifest input</div>
            <code>{serializedGraph.length} bytes serialized</code>
          </div>
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

function LibraryItem({
  icon: Icon,
  title,
  detail,
}: {
  icon: typeof Bot;
  title: string;
  detail: string;
}) {
  return (
    <button className="workflow-library-item" type="button">
      <Icon size={15} />
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
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
