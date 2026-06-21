/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAgentRoleNode,
  createEndNode,
  createHumanEscalationNode,
  getIntegrationProviderCatalog,
  createToolNode,
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
import { decorateLiveWorkflowCanvas } from "./workflowLiveCanvas";
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
  sendTextTurn: vi.fn(),
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
      inputMode: "typed",
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
      sendTextTurn: liveSandboxMock.sendTextTurn,
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
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("prepares live sandbox sessions with the active organization and actor", () => {
    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-customer-success"
        organizationId="tenant-active-org"
        actorUserId="user-support-manager"
        workspaces={[
          {
            id: "workspace-customer-success",
            tenantId: "tenant-active-org",
            name: "Support",
            slug: "support",
            status: "active",
            createdAt: "2026-05-20T00:00:00.000Z",
            createdBy: "user-support-manager",
          },
        ]}
      />,
    );

    expect(liveSandboxMock.hookInputs.at(-1)).toEqual({
      organizationId: "tenant-active-org",
      actorUserId: "user-support-manager",
    });
  });

  it("shows concise node tools without legacy route or handoff tools", () => {
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

    expect(screen.getByRole("button", { name: "Agent" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tool" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Intent route" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Handoff" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add condition" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add agent" })).toBeNull();
  });

  it("keeps normal agents distinct from router agents without a behavior selector", () => {
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

    expect(screen.queryByRole("combobox", { name: "Agent behavior" })).toBeNull();
    expect(screen.queryByLabelText("Route target")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Router Agent" }));

    expect(screen.queryByRole("combobox", { name: "Agent behavior" })).toBeNull();

    const targetSelect = screen.getByLabelText<HTMLSelectElement>("Route target");
    expect(Array.from(targetSelect.options).map((option) => option.textContent)).toContain("Billing specialist");
    expect(targetSelect.value).toBe("agent-billing");
    expect(Array.from(targetSelect.options).some((option) => option.textContent === "Sales")).toBe(false);
    expect(screen.getByLabelText<HTMLInputElement>("Branch label").value).toBe("Billing");
    expect(screen.queryByLabelText("Branch description")).toBeNull();
    expect(screen.queryByLabelText("Branch examples")).toBeNull();
    expect(screen.getByLabelText<HTMLSelectElement>("Fallback route").value).toBe("clarify_source_agent");

    fireEvent.change(screen.getByLabelText<HTMLInputElement>("Branch label"), {
      target: { value: "Invoice help" },
    });

    const routerNode = reactFlowMock.lastProps?.nodes?.find((node) => node.id.startsWith("agent-router-"));
    const routerRole = (routerNode?.data as { role?: { routePolicy?: { branches?: Array<{ label: string }> } } } | undefined)?.role;
    expect(routerRole?.routePolicy?.branches?.[0]?.label).toBe("Invoice help");
    expect(within(screen.getByTestId(`mock-node-${routerNode?.id ?? ""}`)).getByText("Routes")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Intent route" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Handoff" })).toBeNull();
  });

  it("adds a Router Agent preset as a normal tool-capable agent with routing enabled", () => {
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
    const routerRole = (
      routerNode?.data as
        | {
            kind?: string;
            role?: {
              routePolicy?: AgentRoutePolicyConfig;
            };
          }
        | undefined
    )?.role;

    expect((routerNode?.data as { kind?: string } | undefined)?.kind).toBe("agent");
    expect(routerRole?.routePolicy?.branches[0]?.target).toEqual({
      type: "agent",
      agentId: "agent-billing",
    });
    expect(routerRole?.routePolicy?.branches[0]).toEqual(
      expect.objectContaining({
        id: "branch-billing",
        label: "Billing",
        intentKey: "billing",
      }),
    );
    expect(screen.queryByRole("combobox", { name: "Agent behavior" })).toBeNull();
    expect(screen.getByLabelText("Route target")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Tool" }).disabled).toBe(false);
  });

  it("keeps agent configuration free of tenant-local specialist metadata controls", () => {
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
    const routerRole = (
      routerNode?.data as
        | {
            role?: {
              routePolicy?: AgentRoutePolicyConfig;
            };
          }
        | undefined
    )?.role;

    expect(screen.queryByLabelText("Specialist template")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save specialist template" })).toBeNull();
    expect(screen.queryByLabelText("Role type")).toBeNull();
    expect(screen.queryByLabelText("Reusable specialist")).toBeNull();
    expect(routerRole?.routePolicy?.branches[0]).toEqual(
      expect.objectContaining({
        id: "branch-billing",
        label: "Billing",
        target: {
          type: "agent",
          agentId: "agent-billing",
        },
      }),
    );
    expect(routerRole?.routePolicy?.branches[0]).not.toHaveProperty("description");
    expect(routerRole?.routePolicy?.branches[0]).not.toHaveProperty("examples");
    expect(screen.getByLabelText("Route target")).toBeTruthy();
    expect(within(screen.getByTestId(`mock-node-${routerNode?.id ?? ""}`)).getByText("Routes")).toBeTruthy();
  });

  it("preserves existing route policy branches while editing route copy", () => {
    window.localStorage.clear();
    seedDemoPublishedWorkflow({
      frontDeskRoutePolicy: {
        type: "route_by_intent",
        trigger: "on_caller_turn_end",
        activation: "until_routed",
        classifier: {
          mode: "standard",
          modelAlias: "intent-classifier-fast",
          confidenceThreshold: 0.65,
        },
        inputWindow: {
          latestCallerTurn: true,
          recentTranscriptTurns: 6,
          includeConversationSummary: true,
          includePreviousAgentContext: true,
          includeRecentToolResults: true,
        },
        readiness: {
          mode: "auto_with_clarification",
          maxClarificationTurns: 2,
        },
        announcement: {
          mode: "template",
          text: "Got it, I'll be routing you to {targetAgentName} from {branchName}.",
        },
        branches: [
          {
            id: "branch-billing",
            label: "Billing specialist",
            intentKey: "billing",
            target: { type: "agent", agentId: "agent-billing" },
          },
          {
            id: "branch-manager-review",
            label: "Manager review",
            intentKey: "manager_review",
            target: { type: "human_escalation", queueId: "billing-ops" },
          },
        ],
        fallback: {
          label: "Clarify need",
          target: { type: "clarify_source_agent" },
        },
      },
    });

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

    expect(screen.queryByRole("combobox", { name: "Agent behavior" })).toBeNull();
    expect(screen.getByLabelText("Route target")).toBeTruthy();

    fireEvent.change(screen.getByLabelText<HTMLInputElement>("Branch label"), {
      target: { value: "Invoice help" },
    });

    const frontDeskNode = reactFlowMock.lastProps?.nodes?.find((node) => node.id === "agent-front-desk");
    const frontDeskRole = (frontDeskNode?.data as { role?: { routePolicy?: { branches?: Array<{ label: string }> } } } | undefined)?.role;

    expect(frontDeskRole?.routePolicy?.branches).toEqual([
      expect.objectContaining({ label: "Invoice help" }),
      expect.objectContaining({ label: "Manager review" }),
    ]);
  });

  it("keeps published version history out of the inspector", () => {
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

    expect(screen.queryByText("Published versions")).toBeNull();
    expect(screen.queryByText("Immutable snapshots")).toBeNull();
  });

  it("starts blank and requires a workflow name when no workflow has been published", () => {
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

    expect(screen.queryByTestId("mock-node-agent-front-desk")).toBeNull();
    expect(screen.getByLabelText("Workflow").textContent).toContain("Untitled workflow");
    expect(screen.queryByLabelText("Workflow name")).toBeNull();
    expect(screen.getByText("Name this workflow")).toBeTruthy();
    expect(screen.getByText("Connect the entry point to an agent")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Agent" }).disabled).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Router Agent" }).disabled).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Publish" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Run in sandbox" }).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Router Agent" }));

    const routerNode = reactFlowMock.lastProps?.nodes?.find((node) => node.id.startsWith("agent-router-"));
    const routerRole = (
      routerNode?.data as
        | {
            kind?: string;
            role?: {
              routePolicy?: AgentRoutePolicyConfig;
            };
          }
        | undefined
    )?.role;
    expect((routerNode?.data as { kind?: string } | undefined)?.kind).toBe("agent");
    expect(routerRole?.routePolicy?.type).toBe("route_by_intent");
    expect(routerRole?.routePolicy?.branches).toEqual([]);
    expect(screen.getByText("Add another agent before configuring routing.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    const unnamedAgentNode = reactFlowMock.lastProps?.nodes?.find((node) => node.id.startsWith("agent-specialist-"));
    fireEvent.click(screen.getByRole("button", { name: `Select ${routerNode?.id ?? ""}` }));

    expect(screen.queryByLabelText("Route target")).toBeNull();
    expect(screen.getByText("Add another agent before configuring routing.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: `Select ${unnamedAgentNode?.id ?? ""}` }));
    fireEvent.change(screen.getByLabelText<HTMLInputElement>("Agent name"), { target: { value: "Billing reviewer" } });
    expect(
      (reactFlowMock.lastProps?.nodes?.find((node) => node.id === unnamedAgentNode?.id)?.data as { label?: string } | undefined)
        ?.label,
    ).toBe("Billing reviewer");

    fireEvent.change(screen.getByLabelText<HTMLInputElement>("Agent name"), { target: { value: "" } });
    expect(
      (reactFlowMock.lastProps?.nodes?.find((node) => node.id === unnamedAgentNode?.id)?.data as { label?: string } | undefined)
        ?.label,
    ).toBe("");

    fireEvent.change(screen.getByLabelText<HTMLInputElement>("Agent name"), { target: { value: "Billing reviewer" } });
    fireEvent.click(screen.getByRole("button", { name: `Select ${routerNode?.id ?? ""}` }));

    const targetSelect = screen.getByLabelText<HTMLSelectElement>("Route target");
    expect(screen.getByLabelText("Route target")).toBeTruthy();
    expect(Array.from(targetSelect.options).map((option) => option.textContent)).toContain("Billing reviewer");
    expect(Array.from(targetSelect.options).map((option) => option.textContent)).not.toContain("New agent");
  });

  it("lets builders name valid blank drafts from the publish dialog and run them before publishing", async () => {
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

    expect(screen.getByText("Name this workflow")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Publish" }).disabled).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Run in sandbox" }).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Run in sandbox" }));
    expect(screen.getByRole("complementary", { name: "Workflow sandbox" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close workflow sandbox" }));

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

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
    expect(screen.getByText("Published Front desk lane.")).toBeTruthy();
  });

  it("shows the actual entry agent in the draft sandbox header", () => {
    window.localStorage.clear();
    seedWorkflowWithEntryAgentAfterAnotherAgent();

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

    fireEvent.click(screen.getByRole("button", { name: "Run in sandbox" }));

    const drawer = screen.getByRole("complementary", { name: "Workflow sandbox" });
    expect(within(drawer).getByText("Front desk triage - sandwich-pipeline")).toBeTruthy();
    expect(within(drawer).queryByText("Billing specialist - sandwich-pipeline")).toBeNull();
  });

  it("marks active sandbox traversal nodes and animates workflow edges", () => {
    const liveView = decorateLiveWorkflowCanvas({
      liveStatus: "active",
      liveEvents: [
        {
          sessionId: "sandbox-session-1",
          sequence: 1,
          type: "node.transition",
          at: "2026-05-25T09:00:01.000Z",
          payload: {
            nodeId: "agent-front-desk",
            label: "Front desk triage",
          },
        },
      ],
      nodes: [
        {
          id: "entry",
          data: { label: "Inbound call" },
        },
        {
          id: "agent-front-desk",
          data: { label: "Front desk triage" },
        },
      ] as Array<{ id: string; className?: string | undefined; data: { label: string; liveState?: string | undefined } }>,
      edges: [
        {
          id: "edge-entry-front-desk",
          source: "entry",
          target: "agent-front-desk",
        },
      ] as Array<{ id: string; source: string; target: string; animated?: boolean | undefined; className?: string | undefined }>,
    });

    expect(liveView.nodes.find((node) => node.id === "agent-front-desk")?.data.liveState).toBe("current");
    expect(liveView.nodes.find((node) => node.id === "agent-front-desk")?.className).toContain("builder-node-live-current");
    expect(liveView.edges[0]?.animated).toBe(true);
    expect(liveView.edges[0]?.className).toContain("workflow-live-edge");
  });

  it("loads tool inspector provider options from the catalog while preserving grant filtering", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const requestUrl = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        "http://127.0.0.1:4010",
      );

      if (requestUrl.pathname === "/organizations/tenant-west-africa/integrations/connections") {
        return jsonResponse(200, {
          connections: [
            {
              id: "integration-zendesk",
              provider: "zendesk",
              status: "connected",
              scopes: ["tickets:read", "tickets:write"],
              credentialReference: { kind: "oauth-token", preview: "...3456" },
              accountLabel: "support.zendesk.com",
              connectedAt: "2026-06-05T10:00:00.000Z",
              health: { status: "healthy" },
            },
          ],
        });
      }

      if (requestUrl.pathname === "/organizations/tenant-west-africa/integrations/tool-grants") {
        return jsonResponse(200, {
          grants: [
            {
              id: "grant-zendesk-search",
              workspaceId: "workspace-default",
              workflowId: "workflow-inbound-support-triage",
              capability: "agent-tool",
              toolId: "zendesk.tickets.search",
              integrationConnectionId: "integration-zendesk",
              risk: "low",
              requiredScopes: ["tickets:read"],
              approvalRequired: false,
              status: "active",
            },
            {
              id: "grant-zendesk-create-paused",
              workspaceId: "workspace-default",
              workflowId: "workflow-inbound-support-triage",
              capability: "agent-tool",
              toolId: "zendesk.tickets.create",
              integrationConnectionId: "integration-zendesk",
              risk: "medium",
              requiredScopes: ["tickets:write"],
              approvalRequired: true,
              status: "active",
            },
            {
              id: "grant-zendesk-update-paused",
              workspaceId: "workspace-default",
              workflowId: "workflow-inbound-support-triage",
              capability: "agent-tool",
              toolId: "zendesk.tickets.update",
              integrationConnectionId: "integration-zendesk",
              risk: "medium",
              requiredScopes: ["tickets:write"],
              approvalRequired: true,
              status: "paused",
            },
          ],
        });
      }

      if (requestUrl.pathname === "/organizations/tenant-west-africa/integrations/catalog") {
        return jsonResponse(200, {
          catalog: {
            providers: [
              {
                id: "zendesk",
                label: "Zendesk",
                category: "support",
                logoToken: "zendesk",
                capabilities: ["ticketing", "agent-tool"],
                setupSchema: { type: "oauth-or-api-token", fields: [] },
                knowledgeSource: { supported: true, modes: ["snapshot-import"] },
                tools: [
                  {
                    id: "zendesk.tickets.search",
                    name: "Search tickets",
                    riskPosture: "low",
                    capabilities: ["ticketing", "agent-tool"],
                    knowledgeSource: false,
                    docs: { references: [], verifiedAt: "2026-06-05" },
                  },
                  {
                    id: "zendesk.tickets.create",
                    name: "Create ticket",
                    riskPosture: "medium",
                    capabilities: ["ticketing", "agent-tool"],
                    knowledgeSource: false,
                    docs: { references: [], verifiedAt: "2026-06-05" },
                  },
                  {
                    id: "zendesk.tickets.update",
                    name: "Update ticket",
                    riskPosture: "medium",
                    capabilities: ["ticketing", "agent-tool"],
                    knowledgeSource: false,
                    docs: { references: [], verifiedAt: "2026-06-05" },
                  },
                ],
                docs: { references: [], verifiedAt: "2026-06-05" },
              },
            ],
          },
        });
      }

      return jsonResponse(404, { message: "Not found" });
    });
    vi.stubGlobal("fetch", fetchMock);

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

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/organizations/tenant-west-africa/integrations/catalog"),
        expect.anything(),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    await waitForWorkflowToolCatalogLoad();
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Tool" }).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Tool" }));

    const providerSelect = screen.getByRole<HTMLSelectElement>("combobox", { name: "Provider" });

    expect(Array.from(providerSelect.options).map((option) => option.textContent)).toEqual(["Zendesk"]);
    expect(screen.getByRole("option", { name: "support.zendesk.com" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Tools/ }));
    expect(screen.getByLabelText<HTMLInputElement>("Search tickets").checked).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>("Create ticket").checked).toBe(false);
    expect(screen.queryByLabelText("Update ticket")).toBeNull();
    fireEvent.click(screen.getByLabelText("Create ticket"));
    expect(screen.getByRole("button", { name: /2 selected/ })).toBeTruthy();
    const toolNode = [...(reactFlowMock.lastProps?.nodes ?? [])].reverse().find((node) => {
      const nodeData = node.data as { tool?: { connector?: string } };

      return nodeData.tool?.connector === "zendesk";
    });
    const toolConfig = (toolNode?.data as { tool?: { additionalTools?: Array<{ toolId: string }> } } | undefined)?.tool;
    expect(toolConfig?.additionalTools).toEqual([
      expect.objectContaining({
        toolId: "zendesk.tickets.create",
      }),
    ]);
    expect(screen.queryByLabelText("Requires account authorization")).toBeNull();
    expect(screen.queryByLabelText("Human approval required")).toBeNull();
    expect(screen.getByText("Account authorization")).toBeTruthy();
    expect(screen.getByText("Human approval")).toBeTruthy();
  });

  it("shows connected provider tools when no explicit tool grants have been created yet", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const requestUrl = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        "http://127.0.0.1:4010",
      );

      if (requestUrl.pathname === "/organizations/tenant-west-africa/integrations/connections") {
        return jsonResponse(200, {
          connections: [
            {
              id: "integration-zendesk",
              provider: "zendesk",
              status: "connected",
              availability: { scope: "workspace", workspaceId: "workspace-default" },
              scopes: ["tickets:read", "tickets:write"],
              credentialReference: { kind: "api-token", preview: "...3456" },
              accountLabel: "support.zendesk.com",
              connectedAt: "2026-06-05T10:00:00.000Z",
              health: { status: "healthy" },
            },
          ],
        });
      }

      if (requestUrl.pathname === "/organizations/tenant-west-africa/integrations/tool-grants") {
        return jsonResponse(200, { grants: [] });
      }

      if (requestUrl.pathname === "/organizations/tenant-west-africa/integrations/catalog") {
        return jsonResponse(200, {
          catalog: {
            providers: [
              {
                id: "zendesk",
                label: "Zendesk",
                category: "support",
                logoToken: "zendesk",
                capabilities: ["ticketing", "agent-tool"],
                setupSchema: { type: "oauth-or-api-token", fields: [] },
                knowledgeSource: { supported: true, modes: ["snapshot-import"] },
                tools: [
                  {
                    id: "zendesk.tickets.search",
                    name: "Search tickets",
                    riskPosture: "low",
                    capabilities: ["ticketing", "agent-tool"],
                    knowledgeSource: false,
                    docs: { references: [], verifiedAt: "2026-06-05" },
                  },
                  {
                    id: "zendesk.tickets.create",
                    name: "Create ticket",
                    riskPosture: "medium",
                    capabilities: ["ticketing", "agent-tool"],
                    knowledgeSource: false,
                    docs: { references: [], verifiedAt: "2026-06-05" },
                  },
                ],
                docs: { references: [], verifiedAt: "2026-06-05" },
              },
            ],
          },
        });
      }

      return jsonResponse(404, { message: "Not found" });
    });
    vi.stubGlobal("fetch", fetchMock);

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

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/organizations/tenant-west-africa/integrations/catalog"),
        expect.anything(),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    await waitForWorkflowToolCatalogLoad();
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Tool" }).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Tool" }));

    const providerSelect = screen.getByRole<HTMLSelectElement>("combobox", { name: "Provider" });

    expect(Array.from(providerSelect.options).map((option) => option.textContent)).toEqual(["Zendesk"]);
    expect(screen.queryByRole("option", { name: "No configured providers" })).toBeNull();
    expect(screen.getByRole("option", { name: "support.zendesk.com" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Tools/ }));
    expect(screen.getByLabelText<HTMLInputElement>("Search tickets").checked).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>("Create ticket").checked).toBe(false);
  });

  it("keeps the builder visible after clearing the canvas", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Clear canvas" }));

    expect(screen.getByTestId("mock-react-flow")).toBeTruthy();
    expect(screen.getByText("Connect the entry point to an agent")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Run in sandbox" }).disabled).toBe(true);
  });
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createWorkflowBuilderFetchMock(input?: {
  publishResponse?: Response | undefined;
}) {
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

    if (requestUrl.pathname.startsWith("/organizations/tenant-west-africa/workflows/")) {
      return input?.publishResponse ?? createWorkflowPublishResponse(requestUrl, init);
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

async function waitForWorkflowToolCatalogLoad() {
  await waitFor(() =>
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/organizations/tenant-west-africa/integrations/catalog"),
      expect.anything(),
    ),
  );
}

function seedDemoPublishedWorkflow(input: { frontDeskRoutePolicy?: AgentRoutePolicyConfig } = {}): PublishedWorkflowVersion {
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
          ...(input.frontDeskRoutePolicy !== undefined ? { routePolicy: input.frontDeskRoutePolicy } : {}),
        },
      }),
      createToolNode({
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
          request: {
            method: "POST",
            url: "https://api.example.test/zendesk/search",
            authToken: "secret://zendesk/token",
            headers: [{ name: "content-type", value: "application/json" }],
            bodyTemplate: '{"query":"{{caller.issue}}"}',
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
        id: "edge-front-desk-tool",
        sourceNodeId: "agent-front-desk",
        targetNodeId: "tool-zendesk",
        kind: "flow",
        sourceHandleRole: "tool-call-source",
        targetHandleRole: "tool-call-target",
        condition: "lookup",
      },
      {
        id: "edge-tool-front-desk-return",
        sourceNodeId: "tool-zendesk",
        targetNodeId: "agent-front-desk",
        kind: "return",
        sourceHandleRole: "tool-result-source",
        targetHandleRole: "tool-result-target",
        condition: "success",
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

function seedWorkflowWithEntryAgentAfterAnotherAgent(): PublishedWorkflowVersion {
  const graph = createWorkflowGraph({
    id: "workflow-entry-agent-order",
    name: "Entry agent order",
    nodes: [
      {
        id: "entry",
        kind: "entry",
        label: "Inbound call",
        position: { x: 0, y: 160 },
        config: { channel: "phone" },
      },
      createAgentRoleNode({
        id: "agent-billing",
        label: "Billing specialist",
        position: { x: 620, y: 120 },
        role: {
          kind: "billing",
          name: "Billing specialist",
          businessName: "Tuzzy Labs",
          instructions: "Resolve invoice questions after the front desk identifies a billing need.",
          defaultModelTier: "standard",
          languagePolicy: {
            defaultLanguage: "en",
            supportedLanguages: ["en"],
            allowMidCallSwitching: false,
          },
        },
      }),
      createAgentRoleNode({
        id: "agent-front-desk",
        label: "Front desk triage",
        position: { x: 260, y: 120 },
        role: {
          kind: "receptionist",
          name: "Front desk triage",
          businessName: "Tuzzy Labs",
          instructions: "Greet callers and identify whether billing should join next.",
          defaultModelTier: "cheap",
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
        position: { x: 940, y: 120 },
        end: {
          outcome: "resolved",
          closingMessage: "Thank the caller and end the call.",
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
        id: "edge-front-desk-billing",
        sourceNodeId: "agent-front-desk",
        targetNodeId: "agent-billing",
      },
      {
        id: "edge-billing-end",
        sourceNodeId: "agent-billing",
        targetNodeId: "end-resolved",
      },
    ],
  });
  const version = publishWorkflowVersion({
    workflowId: "workflow-entry-agent-order",
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
      retrievalScopes: ["session"],
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
