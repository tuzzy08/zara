/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAgentRoleNode,
  createEndNode,
  createHumanEscalationNode,
  getIntegrationProviderCatalog,
  createWorkflowGraph,
  publishWorkflowVersion,
  type AgentRoutePolicyConfig,
  type RuntimeManifestPreview,
  type RuntimeProfileId,
  type TelephonyProvider,
  type TenantEnvironment,
  type PublishedWorkflowVersion,
  type VoiceRuntimeKind,
  type WorkflowGraph,
} from "@zara/core";

import { WorkflowBuilderScreen } from "./WorkflowBuilder";
import { savePublishedWorkflowVersion } from "./workflowSandboxRegistry";

const reactFlowMock = vi.hoisted(() => ({
  lastProps: undefined as undefined | {
    connectionMode?: unknown;
    nodes?: Array<{
      id: string;
      data: unknown;
    }>;
    edges?: Array<Record<string, unknown>>;
    onConnect?: (connection: {
      source: string | null;
      target: string | null;
      sourceHandle?: string | null;
      targetHandle?: string | null;
    }) => void;
  },
}));

const liveSandboxMock = vi.hoisted(() => ({
  hookInputs: [] as Array<{ organizationId: string; actorUserId: string }>,
  state: {} as Record<string, unknown>,
  startSession: vi.fn(async () => true),
  setTurnContext: vi.fn(),
  startVoiceTurnCapture: vi.fn(),
  stopVoiceTurnCapture: vi.fn(),
  endSession: vi.fn(async () => undefined),
  resetSession: vi.fn(async () => undefined),
}));

vi.mock("@xyflow/react", async () => {
  const React = await import("react");

  return {
    addEdge: (edge: unknown, edges: unknown[]) => [...edges, edge],
    Background: () => null,
    ConnectionMode: {
      Loose: "loose",
      Strict: "strict",
    },
    Controls: () => null,
    Handle: ({
      id,
      type,
      position,
    }: {
      id?: string;
      type: string;
      position: string;
    }) => <span data-testid={id === undefined ? `handle-${type}-${position}` : `handle-${id}`} />,
    MiniMap: () => null,
    Position: {
      Bottom: "bottom",
      Left: "left",
      Right: "right",
      Top: "top",
    },
    ReactFlow: (props: {
      children?: React.ReactNode;
      connectionMode?: unknown;
      onNodeClick?: (event: unknown, node: { id: string }) => void;
      nodes?: Array<{
        id: string;
        type?: string;
        data: unknown;
      }>;
      edges?: Array<Record<string, unknown>>;
      onConnect?: (connection: {
        source: string | null;
        target: string | null;
        sourceHandle?: string | null;
        targetHandle?: string | null;
      }) => void;
      nodeTypes?: Record<string, React.ComponentType<{ data: unknown; selected: boolean }>>;
    }) => {
      reactFlowMock.lastProps = props;

      return (
        <div data-testid="mock-react-flow">
          {props.nodes?.map((node) => {
            const NodeComponent = node.type === undefined ? undefined : props.nodeTypes?.[node.type];

            return NodeComponent === undefined ? null : (
              <div data-testid={`mock-node-${node.id}`} key={node.id}>
                <button type="button" onClick={() => props.onNodeClick?.({}, { id: node.id })}>
                  Select {node.id}
                </button>
                <NodeComponent data={node.data} selected={false} />
              </div>
            );
          })}
          {props.children}
        </div>
      );
    },
    reconnectEdge: (previousEdge: { id: string }, connection: { source: string; target: string }, edges: Array<Record<string, unknown>>) =>
      edges.map((edge) =>
        edge.id === previousEdge.id
          ? {
              ...edge,
              source: connection.source,
              target: connection.target,
            }
          : edge,
      ),
    useEdgesState: (initialEdges: unknown[]) => {
      const [edges, setEdges] = React.useState(initialEdges);

      return [edges, setEdges, vi.fn()] as const;
    },
    useNodesState: (initialNodes: unknown[]) => {
      const [nodes, setNodes] = React.useState(initialNodes);

      return [nodes, setNodes, vi.fn()] as const;
    },
  };
});

vi.mock("./useLiveSandboxSession", () => ({
  useLiveSandboxSession: (input: { organizationId: string; actorUserId: string }) => {
    liveSandboxMock.hookInputs.push(input);

    return {
      status: "idle",
      inputMode: "voice",
      session: null,
      events: [],
      transcript: [],
      note: "Ready for a live sandbox run.",
      microphoneState: "idle",
      voiceTurnCapturing: false,
      agentPlaybackActive: false,
      errorNotice: null,
      lastRoutingDecision: null,
      metrics: {
        turnCount: 0,
        eventCount: 0,
      },
      startSession: liveSandboxMock.startSession,
      setTurnContext: liveSandboxMock.setTurnContext,
      startVoiceTurnCapture: liveSandboxMock.startVoiceTurnCapture,
      stopVoiceTurnCapture: liveSandboxMock.stopVoiceTurnCapture,
      endSession: liveSandboxMock.endSession,
      resetSession: liveSandboxMock.resetSession,
      ...liveSandboxMock.state,
    };
  },
}));

describe("WorkflowBuilderScreen", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", createWorkflowBuilderFetchMock());
    seedDemoPublishedWorkflow();
  });

  afterEach(() => {
    cleanup();
    reactFlowMock.lastProps = undefined;
    liveSandboxMock.hookInputs = [];
    liveSandboxMock.state = {};
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("exposes saved workflow loading from the builder toolbar", () => {
    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-default"
        workspaces={[
          {
            id: "workspace-default",
            tenantId: "tenant-west-africa",
            name: "Operations",
            slug: "operations",
            status: "active",
            createdAt: "2026-05-20T00:00:00.000Z",
            createdBy: "user-ops-lead",
          },
        ]}
      />,
    );

    const workflowSelect = screen.getByLabelText<HTMLSelectElement>("Saved workflow");

    expect(workflowSelect.value).toBe("__draft__");
    expect(screen.queryByTestId("mock-node-agent-front-desk")).toBeNull();
    expect(within(workflowSelect).getByRole("option", { name: "New workflow" })).toBeTruthy();
    const savedWorkflowOption = within(workflowSelect).getByRole<HTMLOptionElement>("option", {
      name: "Inbound support triage",
    });

    fireEvent.change(workflowSelect, { target: { value: savedWorkflowOption.value } });

    expect(screen.getByTestId("mock-node-agent-front-desk")).toBeTruthy();

    fireEvent.change(workflowSelect, { target: { value: "__draft__" } });

    expect(workflowSelect.value).toBe("__draft__");
    expect(screen.queryByTestId("mock-node-agent-front-desk")).toBeNull();
  });

  it("connects configured nodes and clears router validation when a valid target appears", async () => {
    window.localStorage.clear();

    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-default"
        workspaces={[
          {
            id: "workspace-default",
            tenantId: "tenant-west-africa",
            name: "Operations",
            slug: "operations",
            status: "active",
            createdAt: "2026-05-20T00:00:00.000Z",
            createdBy: "user-ops-lead",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Router Agent" }));

    const routerNode = reactFlowMock.lastProps?.nodes?.find((node) => node.id.startsWith("agent-router-"));

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    const agentNode = reactFlowMock.lastProps?.nodes?.find((node) => node.id.startsWith("agent-specialist-"));
    const agentNameInput = screen.getByLabelText<HTMLInputElement>("Agent name");

    expect(agentNameInput.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(agentNameInput, { target: { value: "James" } });
    expect(agentNameInput.getAttribute("aria-invalid")).toBeNull();

    act(() => {
      reactFlowMock.lastProps?.onConnect?.({
        source: routerNode?.id ?? null,
        target: agentNode?.id ?? null,
      });
    });

    expect(reactFlowMock.lastProps?.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: routerNode?.id,
          target: agentNode?.id,
        }),
      ]),
    );

    fireEvent.click(screen.getByRole("button", { name: `Select ${routerNode?.id ?? ""}` }));

    await waitFor(() => {
      const updatedRouterNode = reactFlowMock.lastProps?.nodes?.find((node) => node.id === routerNode?.id);
      const updatedRouterRole = (
        updatedRouterNode?.data as
          | {
              role?: {
                routePolicy?: AgentRoutePolicyConfig;
              };
            }
          | undefined
      )?.role;

      expect(updatedRouterRole?.routePolicy?.branches[0]?.target).toEqual({
        type: "agent",
        agentId: agentNode?.id,
      });
    });
  });

  it("requires publishing before a workflow can run in sandbox", async () => {
    window.localStorage.clear();

    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-default"
        workspaces={[
          {
            id: "workspace-default",
            tenantId: "tenant-west-africa",
            name: "Operations",
            slug: "operations",
            status: "active",
            createdAt: "2026-05-20T00:00:00.000Z",
            createdBy: "user-ops-lead",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByLabelText<HTMLInputElement>("Agent name"), { target: { value: "Front desk" } });
    fireEvent.change(screen.getByLabelText<HTMLInputElement>("Business name"), { target: { value: "Tuzzy Labs" } });
    fireEvent.change(screen.getByLabelText<HTMLTextAreaElement>("Instructions"), {
      target: { value: "Greet callers and route the request to the right next step." },
    });

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Publish" }).disabled).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Run in sandbox" }).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Run in sandbox" }));
    expect(screen.queryByRole("complementary", { name: "Workflow sandbox" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Publish workflow" })).toBeTruthy();

    const dialog = screen.getByRole("dialog", { name: "Publish workflow" });
    const workflowNameInput = within(dialog).getByLabelText<HTMLInputElement>("Workflow name");

    expect(workflowNameInput.value).toBe("");
    expect(within(dialog).getByRole<HTMLButtonElement>("button", { name: "Publish workflow" }).disabled).toBe(true);

    fireEvent.change(workflowNameInput, { target: { value: "Front desk lane" } });
    expect(within(dialog).getByRole<HTMLButtonElement>("button", { name: "Publish workflow" }).disabled).toBe(false);

    fireEvent.click(within(dialog).getByRole("button", { name: "Publish workflow" }));

    await waitFor(() => {
      const storedVersions = JSON.parse(
        window.localStorage.getItem("zara.web.published-workflows.v1") ?? "[]",
      ) as PublishedWorkflowVersion[];

      expect(storedVersions).toHaveLength(1);
      expect(storedVersions[0]?.graph.name).toBe("Front desk lane");
    });

    fireEvent.click(screen.getByRole("button", { name: "Run in sandbox" }));
    const sandbox = screen.getByRole("complementary", { name: "Workflow sandbox" });

    fireEvent.click(within(sandbox).getByRole("button", { name: "Call" }));

    await waitFor(() => {
      expect(liveSandboxMock.startSession).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "published",
          inputMode: "voice",
          manifest: expect.objectContaining({
            publishedVersionId: expect.any(String),
          }),
        }),
      );
    });
  }, 15_000);
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createWorkflowBuilderFetchMock() {
  return vi.fn(async (requestInput: string | URL | Request, init?: RequestInit) => {
    const requestUrl = new URL(
      typeof requestInput === "string" ? requestInput : requestInput instanceof URL ? requestInput.href : requestInput.url,
      "http://127.0.0.1:4010",
    );

    if (requestUrl.pathname === "/organizations/tenant-west-africa/integrations/connections") {
      return jsonResponse(200, {
        connections: [],
      });
    }

    if (requestUrl.pathname === "/organizations/tenant-west-africa/integrations/catalog") {
      return jsonResponse(200, {
        catalog: {
          providers: getIntegrationProviderCatalog(),
        },
      });
    }

    if (requestUrl.pathname === "/organizations/tenant-west-africa/integrations/tool-grants") {
      return jsonResponse(200, {
        grants: [],
      });
    }

    if (requestUrl.pathname === "/organizations/tenant-west-africa/agents/classes") {
      return jsonResponse(200, {
        agentClasses: [
          { agentClass: "custom", label: "Custom" },
          { agentClass: "billing", label: "Billing" },
          { agentClass: "support", label: "Support" },
        ],
      });
    }

    if (requestUrl.pathname === "/organizations/tenant-west-africa/agents") {
      return jsonResponse(200, {
        agents: [],
      });
    }

    if (requestUrl.pathname.startsWith("/organizations/tenant-west-africa/workflows/")) {
      return createWorkflowPublishResponse(requestUrl, init);
    }

    return jsonResponse(404, { message: "Not found" });
  });
}

interface WorkflowPublishRequestBody {
  actorUserId: string;
  workspaceId: string;
  environment: TenantEnvironment;
  graph: WorkflowGraph;
  existingVersions?: PublishedWorkflowVersion[] | undefined;
  runtime: VoiceRuntimeKind;
  runtimeProfile: RuntimeProfileId;
  telephonyProvider: TelephonyProvider;
  memory: RuntimeManifestPreview["memory"];
  budget: RuntimeManifestPreview["budget"];
}

function createWorkflowPublishResponse(requestUrl: URL, init?: RequestInit) {
  const [, , organizationId, , workflowId] = requestUrl.pathname.split("/");
  const body = JSON.parse(String(init?.body ?? "{}")) as WorkflowPublishRequestBody;
  const publishedVersion = publishWorkflowVersion({
    workflowId: decodeURIComponent(workflowId ?? ""),
    tenantId: decodeURIComponent(organizationId ?? ""),
    workspaceId: body.workspaceId,
    environment: body.environment,
    createdBy: body.actorUserId,
    graph: body.graph,
    existingVersions: body.existingVersions ?? [],
    runtime: body.runtime,
    runtimeProfile: body.runtimeProfile,
    telephonyProvider: body.telephonyProvider,
    memory: body.memory,
    budget: body.budget,
  });

  return jsonResponse(201, {
    publishedVersion,
    grantValidation: {
      ok: true,
      errors: [],
    },
  });
}

function seedDemoPublishedWorkflow(): PublishedWorkflowVersion {
  const graph = createWorkflowGraph({
    id: "workflow-inbound-support-triage",
    name: "Inbound support triage",
    nodes: [
      {
        id: "entry",
        kind: "entry",
        label: "Inbound call",
        position: { x: 0, y: 220 },
        config: { channel: "phone" },
      },
      createAgentRoleNode({
        id: "agent-front-desk",
        label: "Front desk triage",
        position: { x: 250, y: 128 },
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
        },
      }),
      createAgentRoleNode({
        id: "agent-billing",
        label: "Billing specialist",
        position: { x: 1170, y: 120 },
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
        },
      }),
      createEndNode({
        id: "end-resolved",
        label: "Resolved exit",
        position: { x: 880, y: 354 },
        end: {
          outcome: "resolved",
          closingMessage: "Thank the caller and end the call after the request is resolved.",
        },
      }),
      createHumanEscalationNode({
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
    ],
    edges: [
      {
        id: "edge-entry-front-desk",
        sourceNodeId: "entry",
        targetNodeId: "agent-front-desk",
      },
      {
        id: "edge-front-desk-agent-billing",
        sourceNodeId: "agent-front-desk",
        targetNodeId: "agent-billing",
      },
      {
        id: "edge-agent-billing-end-resolved",
        sourceNodeId: "agent-billing",
        targetNodeId: "end-resolved",
        condition: "resolved",
      },
      {
        id: "edge-agent-billing-human-escalation",
        sourceNodeId: "agent-billing",
        targetNodeId: "human-escalation",
        condition: "manager review",
      },
    ],
  });
  const version = publishWorkflowVersion({
    workflowId: "workflow-inbound-support-triage",
    tenantId: "tenant-west-africa",
    workspaceId: "workspace-default",
    environment: "production",
    createdBy: "user-ops-lead",
    createdAt: "2026-05-20T00:00:00.000Z",
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
      currentSpendUsd: 0,
      projectedCostPerMinuteUsd: 0.18,
      blockOnLimit: true,
    },
  });

  savePublishedWorkflowVersion(version);
  return version;
}
