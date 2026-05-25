/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionMode } from "@xyflow/react";

import { WorkflowBuilderScreen } from "./WorkflowBuilder";

const reactFlowMock = vi.hoisted(() => ({
  lastProps: undefined as undefined | {
    connectionMode?: unknown;
    edges?: Array<Record<string, unknown>>;
    onConnect?: (connection: {
      source: string | null;
      target: string | null;
      sourceHandle?: string | null;
      targetHandle?: string | null;
    }) => void;
  },
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

describe("WorkflowBuilderScreen", () => {
  afterEach(() => {
    cleanup();
    reactFlowMock.lastProps = undefined;
    window.localStorage.clear();
    vi.clearAllMocks();
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
    expect(within(screen.getByTestId("mock-node-agent-front-desk")).getByTestId("handle-target-left")).toBeTruthy();
    expect(within(screen.getByTestId("mock-node-agent-front-desk")).getByTestId("handle-source-right")).toBeTruthy();

    const toolNode = within(screen.getByTestId("mock-node-tool-zendesk"));

    expect(toolNode.getByTestId("handle-tool-call-target-bottom")).toBeTruthy();
    expect(toolNode.getByTestId("handle-tool-result-source-bottom")).toBeTruthy();
    expect(toolNode.queryByTestId("handle-target-left")).toBeNull();
    expect(toolNode.queryByTestId("handle-source-right")).toBeNull();
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

  it("only lets agents add tools and creates the call and result edges together", () => {
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
    expect(screen.queryByText("Reconnect this tool")).toBeNull();
    expect(screen.queryByText("Needs auth")).toBeNull();
  });

  it("only lets agents add intent routes and filters route targets to post-intent steps", () => {
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

    expect(screen.getByLabelText<HTMLInputElement>("Role name").value).toBe("Billing specialist");

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

    fireEvent.change(screen.getByLabelText<HTMLSelectElement>("Intent"), { target: { value: "sales" } });

    expect(screen.getByLabelText<HTMLSelectElement>("Intent").value).toBe("sales");
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
    fireEvent.click(screen.getByRole("button", { name: "Intent route" }));

    expect(screen.getByLabelText<HTMLSelectElement>("Fallback target").value).toBe("");
    expect(screen.getByText("Choose where the fallback path should go if no branch matches.")).toBeTruthy();
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
    const supportedLanguages = screen.getByLabelText<HTMLSelectElement>("Supported languages");

    expect(supportedLanguages.tagName).toBe("SELECT");
    expect(Array.from(supportedLanguages.selectedOptions, (option) => option.value)).toEqual(["en", "fr"]);
    within(supportedLanguages).getByRole<HTMLOptionElement>("option", { name: "Spanish" }).selected = true;
    fireEvent.change(supportedLanguages);
    fireEvent.change(screen.getByLabelText<HTMLTextAreaElement>("English prompt"), {
      target: { value: "Keep English concise." },
    });

    expect(Array.from(screen.getByLabelText<HTMLSelectElement>("Supported languages").selectedOptions, (option) => option.value)).toEqual([
      "en",
      "fr",
      "es",
    ]);
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
