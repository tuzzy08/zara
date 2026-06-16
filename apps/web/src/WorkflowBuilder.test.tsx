/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionMode } from "@xyflow/react";
import {
  createAgentRoleNode,
  createConditionNode,
  createEndNode,
  createHandoffNode,
  createHumanEscalationNode,
  getIntegrationProviderCatalog,
  createToolNode,
  createWorkflowGraph,
  publishWorkflowVersion,
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
        activeWorkspaceId="workspace-support"
        organizationId="tenant-active-org"
        actorUserId="user-support-manager"
        workspaces={[
          {
            id: "workspace-support",
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

  it("places tool-call handles on agent tops and tool bottoms", () => {
    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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

    expect(screen.getByTestId("mock-react-flow")).toBeTruthy();
    expect(reactFlowMock.lastProps?.connectionMode).toBe(ConnectionMode.Loose);
    expect(within(screen.getByTestId("mock-node-agent-front-desk")).getByTestId("handle-agent-tool-call-source-top")).toBeTruthy();
    expect(within(screen.getByTestId("mock-node-agent-front-desk")).getByTestId("handle-agent-tool-result-target-top")).toBeTruthy();
    expect(within(screen.getByTestId("mock-node-agent-front-desk")).getByTestId("handle-flow-target-left")).toBeTruthy();
    expect(within(screen.getByTestId("mock-node-agent-front-desk")).getByTestId("handle-flow-source-right")).toBeTruthy();

    const toolNode = within(screen.getByTestId("mock-node-tool-zendesk"));

    expect(toolNode.getByTestId("handle-tool-call-target-bottom")).toBeTruthy();
    expect(toolNode.getByTestId("handle-tool-result-source-bottom")).toBeTruthy();
    expect(toolNode.queryByTestId("handle-flow-target-left")).toBeNull();
    expect(toolNode.queryByTestId("handle-flow-source-right")).toBeNull();
  });

  it("shows concise node tools and exposes intent routes in the toolbar", () => {
    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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
    expect(screen.getByRole("button", { name: "Handoff" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Intent route" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add condition" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add agent" })).toBeNull();
  });

  it("keeps validation status visible outside the inspector", () => {
    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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

    expect(screen.getByRole("status", { name: "Workflow validation status" }).textContent).toContain("Ready");
  });

  it("keeps published version history out of the inspector", () => {
    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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

  it("shows the current workflow name as a builder label without version suffixes", () => {
    seedPublishedWorkflow({
      workflowId: "workflow-claims-intake",
      workspaceId: "workspace-operations",
      name: "Claims intake",
      agentId: "agent-claims",
      agentName: "Claims specialist",
    });

    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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

    expect(screen.getByLabelText("Workflow").textContent).toContain("Claims intake");
    expect(screen.getByLabelText("Workflow").textContent).not.toContain("Claims intake v1");
    expect(screen.getByTestId("mock-node-agent-claims")).toBeTruthy();
    expect(within(screen.getByTestId("mock-node-agent-claims")).getByText("Claims specialist")).toBeTruthy();
  });

  it("lets users name the workflow while publishing without adding version suffixes", async () => {
    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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

    expect(screen.queryByLabelText("Workflow name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    const dialog = screen.getByRole("dialog", { name: "Publish workflow" });

    const nameInput = within(dialog).getByLabelText<HTMLInputElement>("Workflow name");

    expect(nameInput.value).toBe("Inbound support triage");
    expect(within(dialog).queryByLabelText("Workflow title")).toBeNull();
    expect(within(dialog).queryByLabelText("Release mode")).toBeNull();
    expect(within(dialog).queryByLabelText("Workflow to overwrite")).toBeNull();

    fireEvent.change(nameInput, {
      target: { value: "Support queue intake" },
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Publish workflow" }));

    await waitFor(() => {
      const storedVersions = JSON.parse(
        window.localStorage.getItem("zara.web.published-workflows.v1") ?? "[]",
      ) as PublishedWorkflowVersion[];

      expect(storedVersions.at(-1)?.graph.name).toBe("Support queue intake");
    });
    expect(screen.getByLabelText("Workflow").textContent).toContain("Support queue intake");
    expect(screen.queryByLabelText("Workflow name")).toBeNull();
    expect(screen.getByText("Published Support queue intake.")).toBeTruthy();
    expect(screen.queryByText("Published Support queue intake v1")).toBeNull();
  });

  it("does not save a local workflow when backend publish blocks invalid tool grants", async () => {
    const fetchMock = createWorkflowBuilderFetchMock({
      publishResponse: jsonResponse(400, {
        message: "Workflow publish blocked by invalid integration tool grants.",
        code: "workflow_publish_tool_grants_invalid",
        errors: [
          {
            code: "tool_permission_denied",
            nodeId: "tool-zendesk",
            toolId: "zendesk.tickets.search",
            integrationConnectionId: "zendesk-wa-prod",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const publishedWorkflowStorageBeforePublish = window.localStorage.getItem("zara.web.published-workflows.v1");

    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    const dialog = screen.getByRole("dialog", { name: "Publish workflow" });
    const nameInput = within(dialog).getByLabelText<HTMLInputElement>("Workflow name");

    fireEvent.change(nameInput, {
      target: { value: "Blocked support queue" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish workflow" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/organizations/tenant-west-africa/workflows/workflow-blocked-support-queue/publish"),
        expect.objectContaining({
          method: "POST",
        }),
      ),
    );
    expect(window.localStorage.getItem("zara.web.published-workflows.v1")).toBe(publishedWorkflowStorageBeforePublish);
    const blockedDialog = screen.getByRole("dialog", { name: "Publish workflow" });

    expect(blockedDialog).toBeTruthy();
    expect(within(blockedDialog).getByText("Workflow publish blocked by invalid integration tool grants.")).toBeTruthy();
  });

  it("asks before overwriting an existing workflow with the same name", async () => {
    const existingWorkflow = seedPublishedWorkflow({
      workflowId: "workflow-claims-intake",
      workspaceId: "workspace-operations",
      name: "Claims intake",
      agentId: "agent-claims",
      agentName: "Claims specialist",
    });

    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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

    expect(screen.getByLabelText("Workflow").textContent).toContain("Claims intake");

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    const dialog = screen.getByRole("dialog", { name: "Publish workflow" });

    expect(within(dialog).getByText('A workflow named "Claims intake" already exists. Overwrite it?')).toBeTruthy();
    expect(within(dialog).getByRole<HTMLButtonElement>("button", { name: "Overwrite workflow" }).disabled).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Run in sandbox" }).disabled).toBe(false);

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    const versionsAfterCancel = JSON.parse(
      window.localStorage.getItem("zara.web.published-workflows.v1") ?? "[]",
    ) as PublishedWorkflowVersion[];

    expect(versionsAfterCancel.filter((version) => version.manifestPreview.workflowId === "workflow-claims-intake")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    const overwriteDialog = screen.getByRole("dialog", { name: "Publish workflow" });

    fireEvent.click(within(overwriteDialog).getByRole("button", { name: "Overwrite workflow" }));

    await waitFor(() => {
      const storedVersions = JSON.parse(
        window.localStorage.getItem("zara.web.published-workflows.v1") ?? "[]",
      ) as PublishedWorkflowVersion[];
      const overwrittenClaimsWorkflow = storedVersions.find(
        (version) => version.manifestPreview.workflowId === "workflow-claims-intake",
      );

      expect(storedVersions.filter((version) => version.manifestPreview.workflowId === "workflow-claims-intake")).toHaveLength(1);
      expect(overwrittenClaimsWorkflow?.graph.name).toBe("Claims intake");
      expect(overwrittenClaimsWorkflow?.id).not.toBe(existingWorkflow.id);
      expect(overwrittenClaimsWorkflow?.manifestPreview.workflowId).toBe("workflow-claims-intake");
    });
    expect(screen.getByText("Overwrote Claims intake.")).toBeTruthy();
  });

  it("starts blank and requires a workflow name when no workflow has been published", () => {
    window.localStorage.clear();

    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Publish" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Run in sandbox" }).disabled).toBe(true);
  });

  it("lets builders name valid blank drafts from the publish dialog and run them before publishing", async () => {
    window.localStorage.clear();

    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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

  it("starts from the most recently published workflow when one exists", () => {
    window.localStorage.clear();
    seedPublishedWorkflow({
      workflowId: "workflow-z-older",
      workspaceId: "workspace-operations",
      name: "Older workflow",
      agentId: "agent-older",
      agentName: "Older specialist",
      createdAt: "2026-05-20T09:00:00.000Z",
    });
    const newestWorkflow = seedPublishedWorkflow({
      workflowId: "workflow-a-newer",
      workspaceId: "workspace-operations",
      name: "Newest workflow",
      agentId: "agent-newer",
      agentName: "Newest specialist",
      createdAt: "2026-05-21T09:00:00.000Z",
    });

    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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

    expect(screen.getByLabelText("Workflow").textContent).toContain("Newest workflow");
    expect(screen.getByTestId("mock-node-agent-newer")).toBeTruthy();
    expect(screen.queryByTestId("mock-node-agent-older")).toBeNull();
  });

  it("shows a dedicated reset action in the workflow sandbox drawer", () => {
    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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

    expect(within(drawer).getByRole("button", { name: "End call" })).toBeTruthy();
    expect(within(drawer).getByRole("button", { name: "Reset sandbox" })).toBeTruthy();
  });

  it("keeps end call active while the live sandbox is still listening or responding", () => {
    liveSandboxMock.state = {
      status: "connecting",
      inputMode: "voice",
      microphoneState: "granted",
      voiceTurnCapturing: true,
      agentPlaybackActive: true,
      note: "Microphone live. Speak naturally; turns are detected automatically.",
    };

    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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

    expect(within(drawer).getByRole<HTMLButtonElement>("button", { name: "Call" }).disabled).toBe(true);
    expect(within(drawer).getByRole<HTMLButtonElement>("button", { name: "Use typed run" }).disabled).toBe(true);
    expect(within(drawer).getByRole<HTMLButtonElement>("button", { name: "End call" }).disabled).toBe(false);
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

  it("lets agent nodes choose Google Gemini from approved model ids", () => {
    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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

    fireEvent.click(screen.getByRole("button", { name: "Select agent-front-desk" }));

    expect(screen.getByLabelText("Model tier")).toBeTruthy();
    expect(screen.queryByLabelText("Realtime provider")).toBeNull();
    expect(screen.queryByLabelText("Realtime model")).toBeNull();

    fireEvent.change(screen.getByLabelText("Model provider"), {
      target: { value: "google-gemini" },
    });
    fireEvent.change(screen.getByLabelText("Model"), {
      target: { value: "gemini-3.1-pro-preview" },
    });

    expect(screen.getByLabelText<HTMLSelectElement>("Model provider").value).toBe("google-gemini");
    expect(screen.queryByRole("textbox", { name: "Model" })).toBeNull();
    expect(screen.getByLabelText<HTMLSelectElement>("Model").tagName).toBe("SELECT");
    expect(screen.getByLabelText<HTMLSelectElement>("Model").value).toBe("gemini-3.1-pro-preview");
    expect(within(screen.getByTestId("mock-node-agent-front-desk")).getByText("Gemini")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Model tier"), {
      target: { value: "cheap" },
    });
    expect(screen.getByLabelText<HTMLSelectElement>("Model").value).toBe("gemini-3.1-flash-lite");

    fireEvent.change(screen.getByLabelText("Model tier"), {
      target: { value: "standard" },
    });
    expect(screen.getByLabelText<HTMLSelectElement>("Model").value).toBe("gemini-3.5-flash");

    fireEvent.change(screen.getByLabelText("Model tier"), {
      target: { value: "sota" },
    });
    expect(screen.getByLabelText<HTMLSelectElement>("Model").value).toBe("gemini-3.1-pro-preview");
  });

  it("lets premium realtime agents choose Google Gemini Live and its realtime model", () => {
    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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

    fireEvent.click(screen.getByRole("button", { name: "Select agent-front-desk" }));
    fireEvent.change(screen.getByLabelText("Runtime profile override"), {
      target: { value: "premium-realtime" },
    });

    expect(screen.queryByLabelText("Model tier")).toBeNull();
    expect(screen.queryByLabelText("Model provider")).toBeNull();
    expect(screen.queryByLabelText("Model")).toBeNull();

    fireEvent.change(screen.getByLabelText("Realtime provider"), {
      target: { value: "gemini-live" },
    });
    fireEvent.change(screen.getByLabelText("Realtime model"), {
      target: { value: "gemini-3.1-flash-live-preview" },
    });

    expect(screen.getByLabelText<HTMLSelectElement>("Realtime provider").value).toBe("gemini-live");
    expect(screen.getByLabelText<HTMLSelectElement>("Realtime model").value).toBe(
      "gemini-3.1-flash-live-preview",
    );
  });

  it("shows the selected Gemini Live runtime in the sandbox instead of stale OpenAI routing text", () => {
    liveSandboxMock.state = {
      lastRoutingDecision: {
        tier: "standard",
        provider: "openai",
        source: "profile_default",
        matchedRuleId: undefined,
        reason: "The premium-realtime profile raised the default tier for 'zara'.",
      },
    };

    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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

    fireEvent.change(screen.getByLabelText("Workflow runtime profile"), {
      target: { value: "premium-realtime" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Select agent-front-desk" }));
    fireEvent.change(screen.getByLabelText("Realtime provider"), {
      target: { value: "gemini-live" },
    });
    fireEvent.change(screen.getByLabelText("Realtime model"), {
      target: { value: "gemini-3.1-flash-live-preview" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Run in sandbox" }));

    const drawer = screen.getByRole("complementary", { name: "Workflow sandbox" });

    expect(within(drawer).getAllByText("Gemini Live").length).toBeGreaterThan(0);
    expect(within(drawer).getByText(/gemini-3\.1-flash-live-preview/)).toBeTruthy();
    expect(within(drawer).queryByText("openai-realtime")).toBeNull();
    expect(within(drawer).queryByText(/OpenAI standard/)).toBeNull();
    expect(within(drawer).queryByText(/Rule default selected/)).toBeNull();
  });

  it("only lets agents add tools and creates the call and result edges together", async () => {
    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Tool" }).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Select agent-front-desk" }));
    await waitForWorkflowToolCatalogLoad();

    const toolButton = screen.getByRole<HTMLButtonElement>("button", { name: "Tool" });
    const initialEdgeCount = reactFlowMock.lastProps?.edges?.length ?? 0;

    expect(toolButton.disabled).toBe(false);
    fireEvent.click(toolButton);

    const edges = reactFlowMock.lastProps?.edges ?? [];
    const callEdge = edges.find(
      (edge) =>
        edge.source === "agent-front-desk" &&
        edge.target === "tool-node-1" &&
        (edge.data as { kind?: string } | undefined)?.kind !== "return",
    );
    const resultEdge = edges.find(
      (edge) =>
        edge.source === "tool-node-1" &&
        edge.target === "agent-front-desk" &&
        (edge.data as { kind?: string } | undefined)?.kind === "return",
    );

    expect(edges).toHaveLength(initialEdgeCount + 2);
    expect(callEdge).toMatchObject({
      sourceHandle: "agent-tool-call-source-top",
      targetHandle: "tool-call-target-bottom",
      label: "tool",
    });
    expect(resultEdge).toMatchObject({
      sourceHandle: "tool-result-source-bottom",
      targetHandle: "agent-tool-result-target-top",
      label: "success",
      className: "workflow-return-edge",
    });
    expect(screen.getByText("Reconnect this tool")).toBeTruthy();
    expect(screen.getByText("Needs auth")).toBeTruthy();
  });

  it("loads tool inspector provider options from the catalog while preserving saved legacy tool nodes", async () => {
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
              workspaceId: "workspace-operations",
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
              workspaceId: "workspace-operations",
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
              workspaceId: "workspace-operations",
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
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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
    fireEvent.click(screen.getByRole("button", { name: "Select tool-zendesk" }));

    const providerSelect = screen.getByRole<HTMLSelectElement>("combobox", { name: "Provider" });

    expect(Array.from(providerSelect.options).map((option) => option.textContent)).toEqual(["Zendesk"]);
    expect(screen.getByRole("option", { name: "support.zendesk.com" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Tools/ }));
    expect(screen.getByLabelText<HTMLInputElement>("Search tickets").checked).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>("Create ticket").checked).toBe(false);
    expect(screen.queryByLabelText("Update ticket")).toBeNull();
    fireEvent.click(screen.getByLabelText("Create ticket"));
    expect(screen.getByRole("button", { name: /2 selected/ })).toBeTruthy();
    const toolNode = reactFlowMock.lastProps?.nodes?.find((node) => node.id === "tool-zendesk");
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

  it("only lets agents add intent routes and filters route targets to post-intent steps", async () => {
    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Intent route" }).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Clear canvas" }));

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Intent route" }).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Intent route" }).disabled).toBe(false);

    await waitForWorkflowToolCatalogLoad();
    fireEvent.click(screen.getByRole("button", { name: "Tool" }));

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Intent route" }).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Select agent-specialist-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Intent route" }));

    const edges = reactFlowMock.lastProps?.edges ?? [];

    expect(
      edges.some((edge) => edge.source === "tool-node-1" && edge.target === "condition-node-1"),
    ).toBe(false);
    expect(
      edges.some((edge) => edge.source === "agent-specialist-1" && edge.target === "condition-node-1"),
    ).toBe(true);
    expect(
      edges.find((edge) => edge.source === "agent-specialist-1" && edge.target === "condition-node-1"),
    ).toMatchObject({
      sourceHandle: "flow-source-right",
      targetHandle: "flow-target-left",
    });

    const targetOptions = Array.from(
      screen.getByLabelText<HTMLSelectElement>("Target").options,
      (option) => option.textContent,
    );

    expect(targetOptions).not.toContain("Specialist 1");
    expect(targetOptions).not.toContain("Ticket lookup");
  });

  it("rejects intent route connections from non-agent sources and tool handles", () => {
    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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

    const initialEdgeCount = reactFlowMock.lastProps?.edges?.length ?? 0;

    act(() => {
      reactFlowMock.lastProps?.onConnect?.({
        source: "entry",
        target: "condition-route",
      });
    });

    expect(reactFlowMock.lastProps?.edges?.length).toBe(initialEdgeCount);
    expect(screen.getByText("Intent routes can only be placed after an agent.")).toBeTruthy();

    act(() => {
      reactFlowMock.lastProps?.onConnect?.({
        source: "agent-front-desk",
        target: "condition-route",
        sourceHandle: "agent-tool-call-source-top",
      });
    });

    expect(reactFlowMock.lastProps?.edges?.length).toBe(initialEdgeCount);
    expect(screen.getByText("Intent routes use normal flow handles, not tool handles.")).toBeTruthy();

    act(() => {
      reactFlowMock.lastProps?.onConnect?.({
        source: "condition-route",
        target: "agent-front-desk",
        targetHandle: "agent-tool-result-target-top",
      });
    });

    expect(reactFlowMock.lastProps?.edges?.length).toBe(initialEdgeCount);
  });

  it("returns tool results only to the calling agent", () => {
    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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

    const initialEdgeCount = reactFlowMock.lastProps?.edges?.length ?? 0;

    act(() => {
      reactFlowMock.lastProps?.onConnect?.({
        source: "tool-zendesk",
        target: "agent-billing",
        sourceHandle: "tool-result-source-bottom",
        targetHandle: "agent-tool-result-target-top",
      });
    });

    expect(reactFlowMock.lastProps?.edges?.length).toBe(initialEdgeCount);
    expect(screen.getByText("Tool results can only return to the agent that called the tool.")).toBeTruthy();

    act(() => {
      reactFlowMock.lastProps?.onConnect?.({
        source: "tool-zendesk",
        target: "agent-front-desk",
        sourceHandle: "tool-result-source-bottom",
        targetHandle: "agent-tool-result-target-top",
      });
    });

    expect(reactFlowMock.lastProps?.edges?.length).toBe(initialEdgeCount + 1);
  });

  it("rejects tool call connections that do not use the canonical tool handles", () => {
    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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

    const initialEdgeCount = reactFlowMock.lastProps?.edges?.length ?? 0;

    act(() => {
      reactFlowMock.lastProps?.onConnect?.({
        source: "agent-front-desk",
        target: "tool-zendesk",
      });
    });

    expect(reactFlowMock.lastProps?.edges?.length).toBe(initialEdgeCount);
    expect(screen.getByText("Tool calls must use the agent tool-call handle and tool call handle.")).toBeTruthy();
  });

  it("exposes only policy-valid node actions for the selected source node", () => {
    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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

    fireEvent.click(screen.getByRole("button", { name: "Select tool-zendesk" }));

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Agent" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Tool" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Handoff" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Intent route" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Escalation" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Exit" }).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Select condition-route" }));

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Agent" }).disabled).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Tool" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Handoff" }).disabled).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Intent route" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Escalation" }).disabled).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Exit" }).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Select end-resolved" }));

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Agent" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Handoff" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Escalation" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Exit" }).disabled).toBe(true);
  });

  it("repairs stale relationship targets after a referenced node is deleted", () => {
    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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

    fireEvent.click(screen.getByRole("button", { name: "Select handoff-billing" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));

    expect(screen.getByText("Reconnect the route target")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Repair relationships" }));

    expect(screen.queryByText("Reconnect the route target")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Select condition-route" }));

    expect(screen.getByLabelText<HTMLSelectElement>("Target").value).toBe("agent-billing");
    expect(
      (reactFlowMock.lastProps?.edges ?? []).some(
        (edge) => edge.source === "condition-route" && edge.target === "agent-billing",
      ),
    ).toBe(true);
  });

  it("lets builders save and apply reusable specialist templates from agent and handoff inspectors", () => {
    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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

    fireEvent.click(screen.getByRole("button", { name: "Select agent-billing" }));
    fireEvent.click(screen.getByRole("button", { name: "Save specialist template" }));

    fireEvent.click(screen.getByRole("button", { name: "Select agent-front-desk" }));
    const templateSelect = screen.getByLabelText<HTMLSelectElement>("Specialist template");

    expect(templateSelect.textContent).toContain("Front desk triage v1");
    expect(templateSelect.textContent).toContain("Billing specialist v2");
    fireEvent.change(templateSelect, { target: { value: "specialist-template-agent-billing" } });

    expect(screen.getByLabelText<HTMLInputElement>("Agent name").value).toBe("Billing specialist");

    fireEvent.click(screen.getByRole("button", { name: "Select handoff-billing" }));
    const handoffTemplateSelect = screen.getByLabelText<HTMLSelectElement>("Template shortcut");

    expect(handoffTemplateSelect.textContent).toContain("Billing specialist v2");
    fireEvent.change(handoffTemplateSelect, { target: { value: "specialist-template-agent-billing" } });

    expect(screen.getByLabelText<HTMLSelectElement>("Target specialist").value).toBe("agent-front-desk");
  });

  it("reloads reusable specialist templates for the active workspace", () => {
    const props = {
      activeWorkspaceId: "workspace-operations",
      workspaces: [
        {
          id: "workspace-operations",
          tenantId: "tenant-west-africa",
          name: "Operations",
          slug: "operations",
          status: "active" as const,
          createdAt: "2026-05-20T00:00:00.000Z",
          createdBy: "user-ops-lead",
        },
      ],
    };
    const firstRender = render(<WorkflowBuilderScreen {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Select agent-billing" }));
    fireEvent.click(screen.getByRole("button", { name: "Save specialist template" }));
    firstRender.unmount();

    render(<WorkflowBuilderScreen {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Select agent-front-desk" }));

    expect(screen.getByLabelText<HTMLSelectElement>("Specialist template").textContent).toContain("Front desk triage v1");
    expect(screen.getByLabelText<HTMLSelectElement>("Specialist template").textContent).toContain("Billing specialist v2");
  });

  it("configures intent route branches without exposing raw expressions", () => {
    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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

    expect(screen.queryByLabelText("Expression")).toBeNull();
    expect(screen.queryByText("Expression")).toBeNull();
    expect(screen.getByLabelText<HTMLSelectElement>("Intent").value).toBe("billing");
    expect(screen.getByLabelText<HTMLInputElement>("Confidence threshold").value).toBe("0.65");
    expect(screen.getByLabelText<HTMLInputElement>("Recent transcript turns").value).toBe("6");
    expect(screen.getByLabelText<HTMLTextAreaElement>("Branch description").value).toContain("billing");
    expect(screen.getByLabelText<HTMLTextAreaElement>("Examples").value).toContain("charged twice");

    fireEvent.change(screen.getByLabelText<HTMLSelectElement>("Intent"), { target: { value: "sales" } });

    expect(screen.getByLabelText<HTMLSelectElement>("Intent").value).toBe("sales");
    expect(screen.getByLabelText<HTMLTextAreaElement>("Branch description").value).toContain("sales");
    expect(screen.getByRole("button", { name: "Delete branch" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete branch" }));

    expect(screen.queryByLabelText("Intent")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add branch" }));

    expect(screen.getByLabelText<HTMLSelectElement>("Intent").value).toBe("billing");
  });

  it("does not default an intent route fallback back to the calling agent", () => {
    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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
    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByLabelText<HTMLInputElement>("Agent name"), { target: { value: "Routing specialist" } });
    fireEvent.change(screen.getByLabelText<HTMLInputElement>("Business name"), { target: { value: "Tuzzy Labs" } });
    fireEvent.change(screen.getByLabelText<HTMLTextAreaElement>("Instructions"), {
      target: { value: "Route the caller to the correct next step." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Intent route" }));

    const fallbackTarget = screen.getByLabelText<HTMLSelectElement>("Fallback target");
    const fallbackOptions = Array.from(fallbackTarget.options, (option) => option.textContent);

    expect(fallbackTarget.value).toBe("");
    expect(fallbackOptions).toContain("Routing specialist");
    expect(screen.getByText("Choose where the fallback path should go if no branch matches.")).toBeTruthy();

    fireEvent.change(fallbackTarget, { target: { value: "agent-specialist-1" } });

    expect(screen.getByLabelText<HTMLSelectElement>("Fallback target").value).toBe("agent-specialist-1");
    expect(
      (reactFlowMock.lastProps?.edges ?? []).some(
        (edge) => edge.source === "condition-node-1" && edge.target === "agent-specialist-1",
      ),
    ).toBe(true);
  });

  it("lets builders select supported languages and edit language-specific prompt text", () => {
    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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

    fireEvent.click(screen.getByRole("button", { name: "Select agent-front-desk" }));
    const supportedLanguages = screen.getByRole("button", { name: /Supported languages/ });

    expect(supportedLanguages.tagName).toBe("BUTTON");
    expect(supportedLanguages.textContent).toContain("English, French");
    fireEvent.click(supportedLanguages);
    expect(screen.getByLabelText<HTMLInputElement>("English").checked).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>("French").checked).toBe(true);
    fireEvent.click(screen.getByLabelText("Spanish"));
    fireEvent.change(screen.getByLabelText<HTMLTextAreaElement>("English prompt"), {
      target: { value: "Keep English concise." },
    });

    expect(screen.getByRole("button", { name: /Supported languages/ }).textContent).toContain("English, French, Spanish");
    expect(screen.getByLabelText<HTMLTextAreaElement>("English prompt").value).toBe("Keep English concise.");
  });

  it("keeps the builder visible after clearing the canvas", () => {
    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-operations"
        workspaces={[
          {
            id: "workspace-operations",
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
          reusableSpecialist: true,
          specialistTemplateId: "specialist-template-agent-front-desk",
          specialistTemplateVersion: 1,
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
      createConditionNode({
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
      createHandoffNode({
        id: "handoff-billing",
        label: "Billing handoff",
        position: { x: 870, y: 132 },
        handoff: {
          targetRoleId: "agent-billing",
          targetRoleName: "Billing specialist",
          handoffReason: "Route invoice disputes and refund conversations to the billing lane.",
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
          reusableSpecialist: true,
          specialistTemplateId: "specialist-template-agent-billing",
          specialistTemplateVersion: 1,
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
        id: "edge-front-desk-condition",
        sourceNodeId: "agent-front-desk",
        targetNodeId: "condition-route",
      },
      {
        id: "edge-condition-route-handoff-billing-branch-billing",
        sourceNodeId: "condition-route",
        targetNodeId: "handoff-billing",
        condition: "Billing",
      },
      {
        id: "edge-condition-route-end-resolved-fallback",
        sourceNodeId: "condition-route",
        targetNodeId: "end-resolved",
        condition: "Resolved",
      },
      {
        id: "edge-handoff-billing-agent-billing",
        sourceNodeId: "handoff-billing",
        targetNodeId: "agent-billing",
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
    workspaceId: "workspace-operations",
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

function seedPublishedWorkflow(input: {
  workflowId: string;
  workspaceId: string;
  name: string;
  agentId: string;
  agentName: string;
  createdAt?: string;
}): PublishedWorkflowVersion {
  const graph = createWorkflowGraph({
    id: input.workflowId,
    name: input.name,
    nodes: [
      {
        id: "entry",
        kind: "entry",
        label: "Inbound call",
        position: { x: 0, y: 0 },
        config: { channel: "phone" },
      },
      createAgentRoleNode({
        id: input.agentId,
        label: input.agentName,
        position: { x: 240, y: 80 },
        role: {
          kind: "support",
          name: input.agentName,
          businessName: "Tuzzy Labs",
          instructions: "Resolve the caller request.",
          defaultModelTier: "standard",
          languagePolicy: {
            defaultLanguage: "en",
            supportedLanguages: ["en"],
            allowMidCallSwitching: false,
          },
          reusableSpecialist: true,
        },
      }),
    ],
    edges: [
      {
        id: "edge-entry-agent",
        sourceNodeId: "entry",
        targetNodeId: input.agentId,
      },
    ],
  });
  const version = publishWorkflowVersion({
    workflowId: input.workflowId,
    tenantId: "tenant-west-africa",
    workspaceId: input.workspaceId,
    environment: "production",
    createdBy: "user-ops-lead",
    createdAt: input.createdAt,
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
