/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { decorateLiveWorkflowCanvas } from "./workflowLiveCanvas";
import { loadPublishedWorkflowVersions, savePublishedWorkflowVersion } from "./workflowSandboxRegistry";

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

  it("shows concise node tools without legacy route, handoff, or visual tool-node creation", () => {
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
    expect(screen.queryByRole("button", { name: "Tool" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Intent route" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Handoff" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add condition" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add agent" })).toBeNull();
  });

  it("does not expose the stale tool catalog loading path when adding workflow nodes", () => {
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

    expect(screen.queryByRole("button", { name: "Tool" })).toBeNull();
    expect(screen.queryByText("Tool catalog is still loading.")).toBeNull();
  });

  it("keeps only agent details expanded and marks collapsed panels with missing required details", () => {
    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-default"
        organizationId="tenant-west-africa"
        organizationName="Eastern Bypass Con"
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

    expect(screen.queryByText("Personal details")).toBeNull();

    const reusableAgentSection = getInspectorSection("Reusable agent");
    const agentDetailsSection = getInspectorSection("Agent details");
    const toolbeltSection = getInspectorSection("Toolbelt");
    const voiceSection = getInspectorSection("Voice");
    const languageSection = getInspectorSection("Language");

    expect(reusableAgentSection.open).toBe(false);
    expect(agentDetailsSection.open).toBe(true);
    expect(toolbeltSection.open).toBe(false);
    expect(voiceSection.open).toBe(false);
    expect(languageSection.open).toBe(false);
    expect(within(getInspectorSectionSummary(agentDetailsSection)).getByText("Required info missing")).toBeTruthy();
    expect(within(getInspectorSectionSummary(toolbeltSection)).queryByText("Required info missing")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Router Agent" }));

    const routingSection = getInspectorSection("Routing");

    expect(routingSection.open).toBe(false);
    expect(within(getInspectorSectionSummary(routingSection)).getByText("Required info missing")).toBeTruthy();
  });

  it("applies reusable agents to selected workflow agent nodes", async () => {
    const reusableAgents = [
      {
        id: "agent-support-concierge",
        organizationId: "tenant-west-africa",
        workspaceId: "workspace-default",
        name: "Support concierge",
        businessName: "Eastern Bypass Con",
        agentClass: "support",
        instructions: "Answer support calls and escalate billing risks.",
        defaultLanguage: "en",
        runtimeProfile: "premium-realtime",
        toolbeltAssignments: [
          {
            id: "assignment-zendesk-search",
            toolId: "zendesk.tickets.search",
            connector: "zendesk",
            toolName: "Search tickets",
            integrationConnectionId: "zendesk-prod",
            integrationLabel: "Zendesk support",
            connectionStatus: "connected",
            label: "Search tickets",
            description: "Search recent Zendesk tickets.",
            whenToUse: "Use when the caller asks about an existing ticket.",
            risk: "low",
            requiresAuthorization: true,
            requiresHumanApproval: false,
          },
        ],
        createdAt: "2026-06-27T12:00:00.000Z",
        updatedAt: "2026-06-27T12:00:00.000Z",
        createdBy: "user-ops-lead",
        updatedBy: "user-ops-lead",
      },
      {
        id: "agent-other-workspace",
        organizationId: "tenant-west-africa",
        workspaceId: "workspace-other",
        name: "Other workspace agent",
        agentClass: "billing",
        instructions: "Should not be available in this builder.",
        defaultLanguage: "en",
        runtimeProfile: "cost-optimized",
        toolbeltAssignments: [],
        createdAt: "2026-06-27T12:01:00.000Z",
        updatedAt: "2026-06-27T12:01:00.000Z",
        createdBy: "user-ops-lead",
        updatedBy: "user-ops-lead",
      },
    ];
    vi.stubGlobal("fetch", createWorkflowBuilderFetchMock({ reusableAgents }));

    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-default"
        organizationId="tenant-west-africa"
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
    expect(await screen.findByText("Support concierge")).toBeTruthy();
    fireEvent.change(screen.getByLabelText<HTMLSelectElement>("Reusable agent"), {
      target: { value: "agent-support-concierge" },
    });

    expect(screen.getByLabelText<HTMLInputElement>("Agent name").value).toBe("Support concierge");
    expect(screen.getByLabelText<HTMLInputElement>("Business name").value).toBe("Eastern Bypass Con");
    expect(screen.getByLabelText<HTMLTextAreaElement>("Instructions").value).toBe(
      "Answer support calls and escalate billing risks.",
    );
    expect(screen.queryByText("Other workspace agent")).toBeNull();

    const agentNode = reactFlowMock.lastProps?.nodes?.find((node) => node.id.startsWith("agent-specialist-"));
    const role = (
      agentNode?.data as
        | {
            label?: string;
            role?: {
              kind?: string;
              name?: string;
              businessName?: string;
              defaultModelTier?: string;
              languagePolicy?: {
                defaultLanguage?: string;
              };
              toolbeltAssignments?: Array<{
                id: string;
                toolId: string;
                integrationConnectionId?: string;
              }>;
            };
          }
        | undefined
    )?.role;

    expect((agentNode?.data as { label?: string } | undefined)?.label).toBe("Support concierge");
    expect(role).toEqual(
      expect.objectContaining({
        kind: "support",
        name: "Support concierge",
        businessName: "Eastern Bypass Con",
        defaultModelTier: "sota",
      }),
    );
    expect(role).not.toHaveProperty("runtimeProfileOverride");
    expect(role?.languagePolicy?.defaultLanguage).toBe("en");
    expect(role?.toolbeltAssignments).toEqual([
      expect.objectContaining({
        id: "assignment-zendesk-search",
        toolId: "zendesk.tickets.search",
        integrationConnectionId: "zendesk-prod",
      }),
    ]);
  });

  it("loads specialist classes into builder-created agent inspectors without exposing model config", async () => {
    vi.stubGlobal("fetch", createWorkflowBuilderFetchMock({
      agentClasses: [
        { agentClass: "custom", label: "Custom" },
        { agentClass: "billing", label: "Billing" },
        { agentClass: "retention", label: "Retention" },
      ],
      reusableAgents: [],
    }));

    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-default"
        organizationId="tenant-west-africa"
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

    expect(await screen.findByLabelText("Reusable agent")).toBeTruthy();
    expect(screen.getByLabelText<HTMLSelectElement>("Reusable agent").disabled).toBe(true);

    const classSelect = screen.getByLabelText<HTMLSelectElement>("Agent class");
    expect(classSelect.value).toBe("custom");
    await waitFor(() => expect(within(classSelect).getByRole("option", { name: "Retention" })).toBeTruthy());
    fireEvent.change(classSelect, { target: { value: "retention" } });

    expect(screen.queryByText("Model config")).toBeNull();
    expect(screen.queryByLabelText("Model tier")).toBeNull();
    expect(screen.queryByLabelText("Model provider")).toBeNull();
    expect(screen.queryByLabelText("Model")).toBeNull();
    expect(screen.queryByLabelText("Realtime provider")).toBeNull();
    expect(screen.queryByLabelText("Realtime model")).toBeNull();
    expect(screen.getByLabelText("Workflow runtime profile")).toBeTruthy();
    expect(screen.queryByLabelText("Runtime profile")).toBeNull();

    const agentNode = reactFlowMock.lastProps?.nodes?.find((node) => node.id.startsWith("agent-specialist-"));
    const role = (
      agentNode?.data as
        | {
            role?: {
              kind?: string;
            };
          }
        | undefined
    )?.role;

    expect(role?.kind).toBe("retention");
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

    expect(screen.getByText("Loaded Inbound support triage.")).toBeTruthy();
    expect(screen.getByTestId("mock-node-agent-front-desk")).toBeTruthy();

    fireEvent.change(workflowSelect, { target: { value: "__draft__" } });

    expect(screen.getByText("Started a blank workflow.")).toBeTruthy();
    expect(screen.getByText("Untitled workflow")).toBeTruthy();
    expect(screen.queryByTestId("mock-node-agent-front-desk")).toBeNull();
  });

  it("deletes the selected saved workflow from the builder toolbar", () => {
    const confirmDelete = vi.spyOn(window, "confirm").mockReturnValue(true);

    try {
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

      loadSavedWorkflow("Inbound support triage");
      fireEvent.click(screen.getByRole("button", { name: "Delete selected workflow" }));

      const workflowSelect = screen.getByLabelText<HTMLSelectElement>("Saved workflow");

      expect(confirmDelete).toHaveBeenCalledWith("Delete Inbound support triage?");
      expect(loadPublishedWorkflowVersions().map((version) => version.graph.name)).toEqual([]);
      expect(workflowSelect.value).toBe("__draft__");
      expect(within(workflowSelect).queryByRole("option", { name: "Inbound support triage" })).toBeNull();
      expect(screen.getByText("Deleted Inbound support triage.")).toBeTruthy();
      expect(screen.getByText("Untitled workflow")).toBeTruthy();
      expect(screen.queryByTestId("mock-node-agent-front-desk")).toBeNull();
    } finally {
      confirmDelete.mockRestore();
    }
  });

  it("preserves an in-progress draft canvas when the builder remounts", async () => {
    const props = {
      activeWorkspaceId: "workspace-default",
      workspaces: [
        {
          id: "workspace-default",
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

    expect(screen.getByLabelText<HTMLSelectElement>("Saved workflow").value).toBe("__draft__");
    expect(screen.queryByTestId("mock-node-agent-front-desk")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByLabelText<HTMLInputElement>("Agent name"), { target: { value: "Front desk" } });

    await waitFor(() => {
      expect(window.sessionStorage.length).toBeGreaterThan(0);
    });

    firstRender.unmount();
    reactFlowMock.lastProps = undefined;

    render(<WorkflowBuilderScreen {...props} />);

    const restoredFlowProps = reactFlowMock.lastProps as
      | {
          nodes?: Array<{
            id: string;
            data: unknown;
          }>;
        }
      | undefined;
    const restoredAgentNode = restoredFlowProps?.nodes?.find((node) => node.id.startsWith("agent-specialist-"));
    const restoredRole = (
      restoredAgentNode?.data as
        | {
            role?: {
              name?: string;
            };
          }
        | undefined
    )?.role;

    expect(restoredRole?.name).toBe("Front desk");
    expect(screen.getAllByText("Front desk").length).toBeGreaterThan(0);
  });

  it("lets builder-created agent nodes multi-assign tools from a selected integration", async () => {
    vi.stubGlobal("fetch", createWorkflowBuilderFetchMock({
      integrationConnections: [
        {
          id: "connection-zendesk-support",
          provider: "zendesk",
          status: "connected",
          scopes: ["tickets:read", "tickets:write"],
          availability: { scope: "workspace", workspaceId: "workspace-default" },
          credentialReference: { kind: "api-token", preview: "...1234" },
          accountLabel: "bodwich.zendesk.com",
          connectedAt: "2026-06-05T09:00:00.000Z",
          health: { status: "healthy" },
        },
        {
          id: "connection-hubspot-sales",
          provider: "hubspot",
          status: "connected",
          scopes: ["crm.objects.contacts.read"],
          availability: { scope: "workspace", workspaceId: "workspace-default" },
          credentialReference: { kind: "oauth-token", preview: "...9876" },
          accountLabel: "sales.hubspot.com",
          connectedAt: "2026-06-05T09:00:00.000Z",
          health: { status: "healthy" },
        },
      ],
      integrationCatalogProviders: [
        {
          id: "zendesk",
          label: "Zendesk",
          capabilities: ["agent-tool"],
          tools: [
            {
              id: "zendesk.tickets.search",
              name: "Search tickets",
              riskPosture: "low",
            },
            {
              id: "zendesk.tickets.create",
              name: "Create ticket",
              riskPosture: "medium",
            },
          ],
        },
        {
          id: "hubspot",
          label: "HubSpot",
          capabilities: ["agent-tool"],
          tools: [
            {
              id: "hubspot.contacts.lookup",
              name: "Lookup contacts",
              riskPosture: "low",
            },
          ],
        },
      ],
    }));

    render(
      <WorkflowBuilderScreen
        activeWorkspaceId="workspace-default"
        organizationId="tenant-west-africa"
        organizationName="Eastern Bypass Con"
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
    expect(screen.getByLabelText<HTMLInputElement>("Business name").value).toBe("Eastern Bypass Con");
    expect(await screen.findByText("Toolbelt")).toBeTruthy();
    expect(screen.getByText("No tools assigned")).toBeTruthy();

    const integrationSelect = screen.getByLabelText<HTMLSelectElement>("Integration");
    const toolsDropdown = screen.getByRole("button", { name: /Tools/i });
    expect(Boolean(integrationSelect.compareDocumentPosition(toolsDropdown) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    const integrationOptionLabels = Array.from(integrationSelect.options).map((option) => option.textContent);
    expect(integrationOptionLabels).toContain("Zendesk");
    expect(integrationOptionLabels).toContain("HubSpot");
    expect(screen.queryByText("bodwich.zendesk.com")).toBeNull();
    expect(screen.queryByLabelText("Connection")).toBeNull();

    fireEvent.change(integrationSelect, {
      target: { value: "connection-zendesk-support" },
    });
    fireEvent.click(toolsDropdown);
    expect(screen.getByLabelText("Search tickets")).toBeTruthy();
    expect(screen.getByLabelText("Create ticket")).toBeTruthy();
    expect(screen.queryByLabelText("Lookup contacts")).toBeNull();
    fireEvent.click(screen.getByLabelText("Search tickets"));
    fireEvent.click(screen.getByLabelText("Create ticket"));
    fireEvent.click(screen.getByRole("button", { name: "Add selected tools" }));

    expect(screen.getAllByText("Search tickets").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Create ticket").length).toBeGreaterThan(0);
    const agentNode = reactFlowMock.lastProps?.nodes?.find((node) => node.id.startsWith("agent-specialist-"));
    const role = (
      agentNode?.data as
        | {
            role?: {
              businessName?: string;
              toolbeltAssignments?: Array<{
                toolId: string;
                integrationConnectionId?: string;
                integrationLabel?: string;
              }>;
            };
          }
        | undefined
    )?.role;

    expect(role?.businessName).toBe("Eastern Bypass Con");
    expect(role?.toolbeltAssignments).toEqual([
      expect.objectContaining({
        toolId: "zendesk.tickets.search",
        integrationConnectionId: "connection-zendesk-support",
        integrationLabel: "Zendesk",
      }),
      expect.objectContaining({
        toolId: "zendesk.tickets.create",
        integrationConnectionId: "connection-zendesk-support",
        integrationLabel: "Zendesk",
      }),
    ]);
    expect(screen.queryByRole("button", { name: "Tool" })).toBeNull();
    expect(screen.queryByText("Tool catalog is still loading.")).toBeNull();
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
    expect(screen.queryByLabelText("Handoff target")).toBeNull();

    loadSavedWorkflow("Inbound support triage");
    fireEvent.click(screen.getByRole("button", { name: "Router Agent" }));

    expect(screen.queryByRole("combobox", { name: "Agent behavior" })).toBeNull();

    const targetSelect = screen.getByLabelText<HTMLSelectElement>("Handoff target");
    expect(Array.from(targetSelect.options).map((option) => option.textContent)).toContain("Billing specialist");
    expect(targetSelect.value).toBe("agent-billing");
    expect(Array.from(targetSelect.options).some((option) => option.textContent === "Sales")).toBe(false);
    expect(screen.queryByLabelText("Caller need")).toBeNull();
    expect(screen.queryByLabelText("Branch description")).toBeNull();
    expect(screen.queryByLabelText("Branch examples")).toBeNull();
    expect(screen.getByLabelText<HTMLSelectElement>("Fallback action").value).toBe("clarify_source_agent");

    const routerNode = reactFlowMock.lastProps?.nodes?.find((node) => node.id.startsWith("agent-router-"));
    const routerRole = (routerNode?.data as { role?: { routePolicy?: { branches?: Array<{ label: string }> } } } | undefined)?.role;
    expect(routerRole?.routePolicy?.branches?.[0]?.label).toBe("Billing");
    expect(within(screen.getByTestId(`mock-node-${routerNode?.id ?? ""}`)).getByText("Routes")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Intent route" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Handoff" })).toBeNull();
  });

  it("uses distinct visual affordances for agent and router-agent presets", () => {
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

    expect(screen.getByRole("button", { name: "Agent" }).getAttribute("data-node-preset")).toBe("agent");
    expect(screen.getByRole("button", { name: "Router Agent" }).getAttribute("data-node-preset")).toBe("router-agent");

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    const agentNode = reactFlowMock.lastProps?.nodes?.find((node) => node.id.startsWith("agent-specialist-"));
    expect(within(screen.getByTestId(`mock-node-${agentNode?.id ?? ""}`)).getByLabelText("Regular agent node")).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Selected node inspector" }).getAttribute("data-agent-mode")).toBe("regular");

    fireEvent.click(screen.getByRole("button", { name: "Router Agent" }));
    const routerNode = reactFlowMock.lastProps?.nodes?.find((node) => node.id.startsWith("agent-router-"));
    expect(within(screen.getByTestId(`mock-node-${routerNode?.id ?? ""}`)).getByLabelText("Router agent node")).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Selected node inspector" }).getAttribute("data-agent-mode")).toBe("router");
  });

  it("adds a Router Agent preset as a normal agent with routing enabled", () => {
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

    loadSavedWorkflow("Inbound support triage");
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
    expect(screen.getByLabelText("Handoff target")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Tool" })).toBeNull();
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

    loadSavedWorkflow("Inbound support triage");
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
    expect(screen.getByLabelText("Handoff target")).toBeTruthy();
    expect(within(screen.getByTestId(`mock-node-${routerNode?.id ?? ""}`)).getByText("Routes")).toBeTruthy();
  });

  it("preserves existing handoff branches without tenant branch-copy controls", () => {
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
          text: "I'll connect you with {targetAgentName}.",
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

    loadSavedWorkflow("Inbound support triage");
    expect(screen.queryByRole("combobox", { name: "Agent behavior" })).toBeNull();
    expect(screen.getByLabelText("Handoff target")).toBeTruthy();
    expect(screen.queryByLabelText("Caller need")).toBeNull();

    const frontDeskNode = reactFlowMock.lastProps?.nodes?.find((node) => node.id === "agent-front-desk");
    const frontDeskRole = (frontDeskNode?.data as { role?: { routePolicy?: { branches?: Array<{ label: string }> } } } | undefined)?.role;

    expect(frontDeskRole?.routePolicy?.branches).toEqual([
      expect.objectContaining({ label: "Billing specialist" }),
      expect.objectContaining({ label: "Manager review" }),
    ]);
  });

  it("keeps node validation scoped to the selected node and clears router branch validation when a target appears", async () => {
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
    const inspector = screen.getByRole("complementary", { name: "Selected node inspector" });

    expect(within(inspector).getByText("Add at least one configured route branch or remove this router node.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    const agentNode = reactFlowMock.lastProps?.nodes?.find((node) => node.id.startsWith("agent-specialist-"));
    const agentInspector = screen.getByRole("complementary", { name: "Selected node inspector" });

    expect(within(agentInspector).queryByText("Add at least one configured route branch or remove this router node.")).toBeNull();
    fireEvent.change(screen.getByLabelText<HTMLInputElement>("Agent name"), { target: { value: "James" } });

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
    expect(
      within(screen.getByRole("complementary", { name: "Selected node inspector" })).queryByText(
        "Add at least one configured route branch or remove this router node.",
      ),
    ).toBeNull();
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

    expect(screen.queryByLabelText("Handoff target")).toBeNull();
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

    const targetSelect = screen.getByLabelText<HTMLSelectElement>("Handoff target");
    expect(screen.getByLabelText("Handoff target")).toBeTruthy();
    expect(Array.from(targetSelect.options).map((option) => option.textContent)).toContain("Billing reviewer");
    expect(Array.from(targetSelect.options).map((option) => option.textContent)).not.toContain("New agent");
    const fallbackSelect = screen.getByLabelText<HTMLSelectElement>("Fallback action");
    expect(Array.from(fallbackSelect.options).map((option) => option.textContent)).toContain("Keep with current agent");
    expect(Array.from(fallbackSelect.options).map((option) => option.textContent)).not.toContain("Keep with ");
  });

  it("keeps placeholder canvas labels out of missing-agent validation", () => {
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
    fireEvent.change(screen.getByLabelText<HTMLInputElement>("Agent name"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText<HTMLInputElement>("Business name"), { target: { value: "Tuzzy Labs" } });
    fireEvent.change(screen.getByLabelText<HTMLTextAreaElement>("Instructions"), {
      target: { value: "Greet callers and identify the next best step." },
    });

    expect(screen.getByText("Give this agent a clear working name.")).toBeTruthy();
    expect(screen.queryByText("Give New agent a clear working name.")).toBeNull();
  });

  it("creates exit nodes with route-neutral closing copy", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Exit" }));

    expect(screen.getByLabelText<HTMLTextAreaElement>("Closing message").value).toBe(
      "Close the workflow and end the call after this path completes.",
    );
    expect(screen.queryByDisplayValue("Close the workflow and end the call after this branch completes.")).toBeNull();
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

    expect(screen.getByText("Name this workflow")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Publish" }).disabled).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Run in sandbox" }).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Run in sandbox" }));
    expect(screen.queryByRole("complementary", { name: "Workflow sandbox" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Publish workflow" })).toBeTruthy();
    expect(screen.getAllByText("Publish this workflow before running it in sandbox.").length).toBeGreaterThan(0);

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

    fireEvent.click(screen.getByRole("button", { name: "Run in sandbox" }));
    expect(screen.getByRole("complementary", { name: "Workflow sandbox" })).toBeTruthy();
    expect(screen.getByText("Published sandbox ready.")).toBeTruthy();
  });

  it("opens sandbox after publishing a new workflow while saved workflows exist", async () => {
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

    expect(screen.getByLabelText<HTMLSelectElement>("Saved workflow").value).toBe("__draft__");
    expect(screen.queryByTestId("mock-node-agent-front-desk")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByLabelText<HTMLInputElement>("Agent name"), { target: { value: "Front desk" } });
    fireEvent.change(screen.getByLabelText<HTMLInputElement>("Business name"), { target: { value: "Tuzzy Labs" } });
    fireEvent.change(screen.getByLabelText<HTMLTextAreaElement>("Instructions"), {
      target: { value: "Greet callers and route the request to the right next step." },
    });

    fireEvent.click(screen.getByRole("button", { name: "Run in sandbox" }));
    const dialog = await screen.findByRole("dialog", { name: "Publish workflow" });
    fireEvent.change(within(dialog).getByLabelText<HTMLInputElement>("Workflow name"), {
      target: { value: "Front desk lane" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish workflow" }));

    await waitFor(() => expect(screen.getByText("Published Front desk lane.")).toBeTruthy());
    expect(screen.queryByRole("dialog", { name: "Publish workflow" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Run in sandbox" }));

    expect(screen.getByRole("complementary", { name: "Workflow sandbox" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Publish workflow" })).toBeNull();
  });

  it("opens sandbox after overwriting a server-normalized published workflow", async () => {
    window.localStorage.clear();
    const initialVersion = seedDemoPublishedWorkflow();
    const normalizedPublishMock = vi.fn((requestUrl: URL, init?: RequestInit) => {
      const response = createWorkflowPublishResponse(requestUrl, init);
      const body = JSON.parse(String(init?.body ?? "{}")) as WorkflowPublishRequestBody;
      const publishedVersion = publishWorkflowVersion({
        workflowId: body.graph.id,
        tenantId: "tenant-west-africa",
        workspaceId: body.workspaceId,
        environment: body.environment,
        createdBy: body.actorUserId,
        graph: {
          ...body.graph,
          nodes: body.graph.nodes.map((node) =>
            node.kind === "agent"
              ? {
                  ...node,
                  config: {
                    ...node.config,
                    role: {
                      ...(node.config["role"] as Record<string, unknown>),
                      modelProvider: "openai",
                      realtimeProvider: "openai-realtime",
                    },
                  },
                }
              : node,
          ),
        },
        existingVersions: [initialVersion],
        runtime: body.runtime,
        runtimeProfile: body.runtimeProfile,
        telephonyProvider: body.telephonyProvider,
        memory: body.memory,
        budget: body.budget,
      });

      void response;
      return jsonResponse(201, {
        publishedVersion,
        grantValidation: { ok: true, errors: [] },
      });
    });
    vi.stubGlobal("fetch", createWorkflowBuilderFetchMock({ publishResponse: normalizedPublishMock }));

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

    loadSavedWorkflow("Inbound support triage");
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    const dialog = await screen.findByRole("dialog", { name: "Publish workflow" });
    expect(within(dialog).getByText("Overwrite saved workflow")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Overwrite workflow" }));

    await waitFor(() => expect(screen.getByText("Overwrote Inbound support triage.")).toBeTruthy());
    expect(screen.queryByRole("dialog", { name: "Publish workflow" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Run in sandbox" }));

    expect(screen.getByRole("complementary", { name: "Workflow sandbox" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Publish workflow" })).toBeNull();
  });

  it("shows the actual entry agent in the published sandbox header", () => {
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

    loadSavedWorkflow("Entry agent order");
    fireEvent.click(screen.getByRole("button", { name: "Run in sandbox" }));

    const drawer = screen.getByRole("complementary", { name: "Workflow sandbox" });
    expect(within(drawer).getByText("Front desk triage - sandwich-pipeline")).toBeTruthy();
    expect(within(drawer).queryByText("Billing specialist - sandwich-pipeline")).toBeNull();
    expect(within(drawer).getAllByText("Published test (browser)").length).toBeGreaterThan(0);
    expect(within(drawer).queryByText("Draft test (browser)")).toBeNull();
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

function loadSavedWorkflow(name: string) {
  const workflowSelect = screen.getByLabelText<HTMLSelectElement>("Saved workflow");
  const savedWorkflowOption = within(workflowSelect).getByRole<HTMLOptionElement>("option", { name });

  fireEvent.change(workflowSelect, { target: { value: savedWorkflowOption.value } });
}

function getInspectorSection(title: string) {
  const sectionTitle = screen.getAllByText(title).find((element) => element.closest("summary") !== null);
  const section = sectionTitle?.closest("details");

  expect(section).toBeTruthy();

  return section as HTMLDetailsElement;
}

function getInspectorSectionSummary(section: HTMLDetailsElement) {
  const summary = section.querySelector("summary");

  expect(summary).toBeTruthy();

  return summary as HTMLElement;
}

function createWorkflowBuilderFetchMock(input?: {
  agentClasses?: unknown[] | undefined;
  integrationCatalogProviders?: unknown[] | undefined;
  integrationConnections?: unknown[] | undefined;
  publishResponse?: Response | ((requestUrl: URL, init?: RequestInit) => Response) | undefined;
  reusableAgents?: unknown[] | undefined;
}) {
  return vi.fn(async (requestInput: string | URL | Request, init?: RequestInit) => {
    const requestUrl = new URL(
      typeof requestInput === "string" ? requestInput : requestInput instanceof URL ? requestInput.href : requestInput.url,
      "http://127.0.0.1:4010",
    );

    if (requestUrl.pathname === "/organizations/tenant-west-africa/integrations/connections") {
      return jsonResponse(200, {
        connections: input?.integrationConnections ?? [],
      });
    }

    if (requestUrl.pathname === "/organizations/tenant-west-africa/integrations/catalog") {
      return jsonResponse(200, {
        catalog: {
          providers: input?.integrationCatalogProviders ?? getIntegrationProviderCatalog(),
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
        agentClasses: input?.agentClasses ?? [
          { agentClass: "custom", label: "Custom" },
          { agentClass: "billing", label: "Billing" },
          { agentClass: "support", label: "Support" },
        ],
      });
    }

    if (requestUrl.pathname === "/organizations/tenant-west-africa/agents") {
      return jsonResponse(200, {
        agents: input?.reusableAgents?.filter((agent) =>
          typeof agent === "object"
          && agent !== null
          && "workspaceId" in agent
          && agent.workspaceId === requestUrl.searchParams.get("workspaceId"),
        ) ?? [],
      });
    }

    if (requestUrl.pathname.startsWith("/organizations/tenant-west-africa/workflows/")) {
      return typeof input?.publishResponse === "function"
        ? input.publishResponse(requestUrl, init)
        : input?.publishResponse ?? createWorkflowPublishResponse(requestUrl, init);
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
