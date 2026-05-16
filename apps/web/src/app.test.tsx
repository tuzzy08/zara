/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveWorkspace,
  createDefaultWorkspaceSeedState,
  createWorkspace,
  createWorkspaceAuditEntry,
  renameWorkspace,
  restoreWorkspace,
  revokeWorkspaceMembership,
  setWorkspaceMembershipRole,
  slugifyWorkspaceName,
  validateWorkspaceCreate,
  type TenantRole,
  type WorkspaceSeedState,
} from "@zara/core";

import { App } from "./App";

describe("tenant dashboard shell", () => {
  let apiMock: ReturnType<typeof installApiMock>;
  let liveSandboxMock: ReturnType<typeof installLiveSandboxMock>;

  beforeEach(() => {
    globalThis.ResizeObserver = class ResizeObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    };
    liveSandboxMock = installLiveSandboxMock();
    vi.stubGlobal("WebSocket", liveSandboxMock.WebSocket);
    apiMock = installApiMock(liveSandboxMock);
  });

  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute("data-theme");
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("renders the tenant shell and lets the user toggle dark mode from the profile menu", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Tenant")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Agents" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Workflows" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Sandbox" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Calls" })).toBeTruthy();
    expect(screen.getByTestId("shell-scroll-region")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Switch workspace" }).textContent).toContain("Operations");

    fireEvent.click(screen.getByRole("button", { name: "Open profile menu" }));

    const themeToggle = screen.getByRole("menuitem", { name: "Dark mode" });

    expect(themeToggle).toBeTruthy();
    expect(document.documentElement.dataset.theme).toBe("light");

    fireEvent.click(themeToggle);

    expect(document.documentElement.dataset.theme).toBe("dark");
  }, 15_000);

  it("creates and switches workspaces from the tenant shell", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

    fireEvent.change(screen.getByLabelText("Workspace name"), {
      target: { value: "Retention desk" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(screen.getByRole("button", { name: "Switch workspace" }).textContent).toContain("Retention desk");

    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Support" }));

    expect(screen.getByRole("button", { name: "Switch workspace" }).textContent).toContain("Support");
  });

  it("opens an inline sandbox drawer for the current draft workflow", async () => {
    render(
      <MemoryRouter initialEntries={["/workflows"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getAllByText("Front desk triage").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Validation").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Add tool" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add handoff" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add escalation" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add condition" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add exit" })).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Run in sandbox" }).disabled).toBe(false);
    expect(screen.queryByText("Workflow nodes")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Run in sandbox" }));

    expect(screen.getByRole("complementary", { name: "Workflow sandbox" })).toBeTruthy();
    expect(screen.getByText("Draft test run")).toBeTruthy();
    expect(screen.getByText("Inbound support triage")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start draft sandbox" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use typed run" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close workflow sandbox" })).toBeTruthy();
    expect(screen.queryByText("Runtime session")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Use typed run" }));
    await screen.findByText("Typed sandbox is live.");
    fireEvent.change(screen.getByLabelText("Caller turn"), {
      target: { value: "Can you check a billing charge before I publish this workflow?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send caller turn" }));

    await waitFor(() =>
      expect(apiMock.fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/organizations/tenant-west-africa/sandbox/live-sessions"),
        expect.objectContaining({
          method: "POST",
        }),
      ),
    );
    expect(await screen.findByText("Billing support is ready to help with that request.")).toBeTruthy();
    expect(screen.getAllByText("Can you check a billing charge before I publish this workflow?").length).toBeGreaterThan(0);
    expect(await screen.findByText("Customer profile lookup completed in 42ms.")).toBeTruthy();
    expect(screen.getByText("Cartesia Sonic 3 first byte in 180ms")).toBeTruthy();
    expect(screen.getByText(/Estimated turn cost \$0\.0019/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close workflow sandbox" }));
    expect(screen.queryByRole("complementary", { name: "Workflow sandbox" })).toBeNull();
  }, 15_000);

  it("applies the balanced runtime profile to the draft sandbox before publish", () => {
    render(
      <MemoryRouter initialEntries={["/workflows"]}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Workflow runtime profile"), {
      target: { value: "balanced" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run in sandbox" }));

    expect(screen.getAllByText("Balanced profile").length).toBeGreaterThan(0);
    expect(screen.getByText("Neural HD voice")).toBeTruthy();
  });

  it("runs a routed telephony sandbox path from the workflow page after a platform number is assigned", async () => {
    render(
      <MemoryRouter initialEntries={["/workflows"]}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    fireEvent.change(screen.getByLabelText("Workflow title"), {
      target: { value: "Support billing lane" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish workflow" }));

    fireEvent.click(screen.getByRole("link", { name: "Calls" }));
    expect(await screen.findByText("Telephony operations")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Connect edge" }));
    expect(await screen.findByText("Zara Edge West")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Provision number" }));
    expect((await screen.findAllByText("+14155550110")).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Workflow route for +14155550110"), {
      target: { value: "workflow-inbound-support-triage-v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save route for +14155550110" }));
    expect((await screen.findAllByText("Support billing lane")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("link", { name: "Workflows" }));
    fireEvent.click(screen.getByRole("button", { name: "Run in sandbox" }));

    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Routed number" }).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Routed number" }));

    expect(screen.getByRole("combobox", { name: "Routed phone number" })).toBeTruthy();
    expect(screen.getByText("Zara Edge West")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Use typed route" }));

    await waitFor(() =>
      expect(apiMock.fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/organizations/tenant-west-africa/telephony/dispatch/inbound"),
        expect.objectContaining({
          method: "POST",
        }),
      ),
    );

    expect(await screen.findByText(/Routed \+14155550110 to Support billing lane/)).toBeTruthy();
    expect(screen.getByText("Platform / Twilio")).toBeTruthy();
    expect(screen.getByText("platform.edge.accept-call")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Caller turn"), {
      target: { value: "Please connect me to billing on the live number." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send caller turn" }));

    expect(screen.getAllByText("Please connect me to billing on the live number.").length).toBeGreaterThan(0);
    expect(await screen.findByText("Billing support is ready to help with that request.")).toBeTruthy();
  }, 15_000);

  it("loads sandbox workflows only from the active workspace", async () => {
    render(
      <MemoryRouter initialEntries={["/workflows"]}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Support" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    fireEvent.change(screen.getByLabelText("Workflow title"), {
      target: { value: "Support billing lane" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish workflow" }));

    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sales" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    fireEvent.change(screen.getByLabelText("Workflow title"), {
      target: { value: "Sales qualification lane" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish workflow" }));

    fireEvent.click(screen.getByRole("link", { name: "Sandbox" }));

    const workflowSelect = await screen.findByLabelText<HTMLSelectElement>("Published workflow");

    expect(workflowSelect.textContent).toContain("Sales qualification lane");
    expect(workflowSelect.textContent).not.toContain("Support billing lane");
  }, 15_000);

  it("renders the sandbox runtime surface with call controls, tools, and live cost telemetry", () => {
    render(
      <MemoryRouter initialEntries={["/sandbox"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole("link", { name: "Sandbox" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Start sandbox call" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use typed sandbox" })).toBeTruthy();
    expect(screen.getByLabelText("Published workflow")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh workflows" })).toBeTruthy();
    expect(screen.getByText("Available tools")).toBeTruthy();
    expect(screen.getByText("Live cost")).toBeTruthy();
    expect(screen.getByText("Runtime decision")).toBeTruthy();
  });

  it("surfaces premium runtime policy on published workflows in sandbox", async () => {
    render(
      <MemoryRouter initialEntries={["/workflows"]}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Workflow runtime profile"), {
      target: { value: "premium-realtime" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    fireEvent.change(screen.getByLabelText("Workflow title"), {
      target: { value: "Premium concierge lane" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish workflow" }));
    fireEvent.click(screen.getByRole("link", { name: "Sandbox" }));
    fireEvent.change(screen.getByLabelText("Published workflow"), {
      target: { value: "workflow-inbound-support-triage:v1" },
    });

    expect(screen.getAllByText("Premium realtime").length).toBeGreaterThan(0);
    expect(screen.queryByText("Server session required")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Use typed sandbox" }));

    await waitFor(() =>
      expect(apiMock.fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/organizations/tenant-west-africa/sandbox/live-sessions"),
        expect.objectContaining({
          method: "POST",
        }),
      ),
    );
  }, 15_000);

  it("lets operators connect a BYO Twilio account, import numbers, route a workflow, and run an inbound dispatch test", async () => {
    render(
      <MemoryRouter initialEntries={["/workflows"]}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    fireEvent.change(screen.getByLabelText("Workflow title"), {
      target: { value: "Support billing lane" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish workflow" }));

    fireEvent.click(screen.getByRole("link", { name: "Calls" }));

    expect(await screen.findByText("Telephony operations")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Twilio account SID"), {
      target: { value: "AC1234567890abcdef1234567890abcd" },
    });
    fireEvent.change(screen.getByLabelText("Twilio auth token"), {
      target: { value: "twilio-auth-token-1234567890" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect Twilio" }));

    expect(await screen.findByText("Tenant Twilio account")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Validate provider" }));
    expect((await screen.findAllByText("Healthy")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Import phone numbers" }));
    expect((await screen.findAllByText("+14155557890")).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Workflow route for +14155557890"), {
      target: { value: "workflow-inbound-support-triage-v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save route for +14155557890" }));
    expect((await screen.findAllByText("Support billing lane")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Run inbound dispatch" }));
    expect(await screen.findByText(/Routed \+14155557890 to Support billing lane/)).toBeTruthy();
  }, 15_000);

  it("surfaces telephony heartbeats, credential rotation, and loopback execution sessions", async () => {
    render(
      <MemoryRouter initialEntries={["/workflows"]}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    fireEvent.change(screen.getByLabelText("Workflow title"), {
      target: { value: "Support billing lane" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish workflow" }));

    fireEvent.click(screen.getByRole("link", { name: "Calls" }));

    fireEvent.change(screen.getByLabelText("Twilio account SID"), {
      target: { value: "AC1234567890abcdef1234567890abcd" },
    });
    fireEvent.change(screen.getByLabelText("Twilio auth token"), {
      target: { value: "twilio-auth-token-1234567890" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect Twilio" }));
    expect(await screen.findByText("Tenant Twilio account")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Import phone numbers" }));
    expect((await screen.findAllByText("+14155557890")).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Workflow route for +14155557890"), {
      target: { value: "workflow-inbound-support-triage-v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save route for +14155557890" }));

    fireEvent.click(screen.getByRole("button", { name: "Run heartbeat" }));
    expect((await screen.findAllByText(/Twilio heartbeat is healthy/i)).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Run loopback test call" }));
    await waitFor(() =>
      expect(apiMock.fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/telephony/connections/telephony-tenant-west-africa-1/test-call"),
        expect.objectContaining({
          method: "POST",
        }),
      ),
    );
    expect(screen.getAllByText("Ringing").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Rotate credentials" }));
    expect(await screen.findByText(/Rotated 1 provider credential envelope/i)).toBeTruthy();
  }, 15_000);

  it("lets workspace admins manage workspace settings, members, and audit history", async () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText("Workspace directory")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Workspace name"), {
      target: { value: "Operations command" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save workspace name" }));

    expect(screen.getByRole("button", { name: "Switch workspace" }).textContent).toContain("Operations command");

    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Grant workspace role" }).disabled).toBe(false);
    });

    fireEvent.change(screen.getByLabelText("Available teammate"), {
      target: { value: "user-finance" },
    });
    fireEvent.change(screen.getByLabelText("Grant role"), {
      target: { value: "viewer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Grant workspace role" }));

    await waitFor(() =>
      expect(apiMock.fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/organizations/tenant-west-africa/workspaces/workspace-operations/memberships/user-finance"),
        expect.objectContaining({
          method: "PUT",
        }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Archive workspace" }));
    await waitFor(() => {
      expect(screen.getAllByText("Archived").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole("button", { name: "Restore workspace" }));
    await waitFor(() => {
      expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/Restored workspace/)).toBeTruthy();
    expect(apiMock.fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/organizations/tenant-west-africa/workspaces/workspace-operations"),
      expect.objectContaining({
        method: "PATCH",
      }),
    );
  }, 15_000);
});

function installApiMock(liveSandboxMock: ReturnType<typeof installLiveSandboxMock>) {
  let state = createDefaultWorkspaceSeedState({
    tenantId: "tenant-west-africa",
  });
  let telephonyState = createInitialTelephonyState();

  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const requestUrl = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      "http://127.0.0.1:3000",
    );
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body === undefined ? {} : JSON.parse(String(init.body));
    const pathname = requestUrl.pathname;

    if (pathname === "/organizations/tenant-west-africa/workspaces/state" && method === "GET") {
      return jsonResponse(200, toWorkspaceStateBody(state));
    }

    if (pathname === "/organizations/tenant-west-africa/sandbox/live-sessions" && method === "POST") {
      const session = liveSandboxMock.createSession({
        organizationId: "tenant-west-africa",
        workspaceId: String(body.workspaceId ?? "workspace-operations"),
        source: String(body.source ?? "published"),
        inputMode: String(body.inputMode ?? "typed"),
        entryRoleId: String(body.entryRoleId ?? "agent-front-desk"),
        manifestId: String(body.manifest?.manifestId ?? "manifest-test"),
        publishedVersionId: String(body.manifest?.publishedVersionId ?? "workflow-test-v1"),
        runtimeProfile: String(body.manifest?.runtimeProfile ?? "cost-optimized"),
      });

      return jsonResponse(201, {
        session,
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/sandbox/live-sessions/")
      && pathname.endsWith("/end")
      && method === "POST"
    ) {
      const sessionId = pathname.split("/")[5]!;
      const session = liveSandboxMock.endSession(sessionId);

      return jsonResponse(200, {
        session,
      });
    }

    if (pathname === "/organizations/tenant-west-africa/workspaces" && method === "POST") {
      const validation = validateWorkspaceCreate({
        tenantId: "tenant-west-africa",
        name: String(body.name ?? ""),
        existingWorkspaces: state.workspaces,
      });

      if (!validation.ok) {
        return jsonResponse(409, { message: validation.message });
      }

      const slug = slugifyWorkspaceName(String(body.name));
      const workspace = createWorkspace({
        id: `workspace-${slug}`,
        tenantId: "tenant-west-africa",
        name: String(body.name),
        slug,
        createdBy: String(body.actorUserId ?? "user-ops-lead"),
      });

      state = {
        ...state,
        workspaces: [...state.workspaces, workspace],
        auditEntries: [
          createWorkspaceAuditEntry({
            id: `audit-${workspace.id}-${state.auditEntries.length + 1}`,
            workspaceId: workspace.id,
            tenantId: "tenant-west-africa",
            actorUserId: String(body.actorUserId ?? "user-ops-lead"),
            action: "workspace.accessed",
            summary: `Created workspace ${workspace.name}.`,
            at: "2026-05-14T12:00:00.000Z",
          }),
          ...state.auditEntries,
        ],
      };

      return jsonResponse(201, { state: toWorkspaceStateBody(state) });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/workspaces/") &&
      !pathname.includes("/memberships/") &&
      pathname.endsWith("/accessed") &&
      method === "POST"
    ) {
      const workspaceId = pathname.split("/")[4]!;
      const workspace = state.workspaces.find((candidate) => candidate.id === workspaceId);

      state = {
        ...state,
        auditEntries: [
          createWorkspaceAuditEntry({
            id: `audit-${workspaceId}-${state.auditEntries.length + 1}`,
            workspaceId,
            tenantId: "tenant-west-africa",
            actorUserId: String(body.actorUserId ?? "user-ops-lead"),
            action: "workspace.accessed",
            summary: `Switched active workspace to ${workspace?.name ?? workspaceId}.`,
            at: "2026-05-14T12:01:00.000Z",
          }),
          ...state.auditEntries,
        ],
      };

      return jsonResponse(200, { state: toWorkspaceStateBody(state) });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/workspaces/") &&
      !pathname.includes("/memberships/") &&
      method === "PATCH"
    ) {
      const workspaceId = pathname.split("/")[4]!;

      try {
        switch (body.action) {
          case "rename":
            state = {
              ...state,
              workspaces: renameWorkspace({
                workspaces: state.workspaces,
                workspaceId,
                tenantId: "tenant-west-africa",
                nextName: String(body.nextName ?? ""),
              }),
            };
            break;
          case "archive":
            state = {
              ...state,
              workspaces: archiveWorkspace({
                workspaces: state.workspaces,
                workspaceId,
                tenantId: "tenant-west-africa",
                activeSessionCount: Number(body.activeSessionCount ?? 0),
              }),
            };
            break;
          case "restore":
            state = {
              ...state,
              workspaces: restoreWorkspace({
                workspaces: state.workspaces,
                workspaceId,
                tenantId: "tenant-west-africa",
              }),
            };
            break;
        }
      } catch (error) {
        return jsonResponse(409, {
          message: error instanceof Error ? error.message : "Workspace mutation failed.",
        });
      }

      const renamedWorkspace = state.workspaces.find((workspace) => workspace.id === workspaceId);
      const actionSummary =
        body.action === "rename"
          ? `Renamed workspace to ${renamedWorkspace?.name ?? workspaceId}.`
          : body.action === "archive"
            ? `Archived workspace ${renamedWorkspace?.name ?? workspaceId}.`
            : `Restored workspace ${renamedWorkspace?.name ?? workspaceId}.`;

      state = {
        ...state,
        auditEntries: [
          createWorkspaceAuditEntry({
            id: `audit-${workspaceId}-${state.auditEntries.length + 1}`,
            workspaceId,
            tenantId: "tenant-west-africa",
            actorUserId: String(body.actorUserId ?? "user-ops-lead"),
            action:
              body.action === "rename"
                ? "workspace.renamed"
                : body.action === "archive"
                  ? "workspace.archived"
                  : "workspace.restored",
            summary: actionSummary,
            at: "2026-05-14T12:02:00.000Z",
          }),
          ...state.auditEntries,
        ],
      };

      return jsonResponse(200, { state: toWorkspaceStateBody(state) });
    }

    if (pathname.includes("/memberships/") && method === "PUT") {
      const [, , , , workspaceId, , userId] = pathname.split("/");

      state = {
        ...state,
        memberships: setWorkspaceMembershipRole({
          memberships: state.memberships,
          workspaceId: workspaceId!,
          tenantId: "tenant-west-africa",
          userId: userId!,
          role: body.role as TenantRole,
        }),
      };

      const userName = state.directoryUsers.find((user) => user.id === userId)?.name ?? userId;
      state = {
        ...state,
        auditEntries: [
          createWorkspaceAuditEntry({
            id: `audit-${workspaceId}-${state.auditEntries.length + 1}`,
            workspaceId: workspaceId!,
            tenantId: "tenant-west-africa",
            actorUserId: String(body.actorUserId ?? "user-ops-lead"),
            action: "membership.role_changed",
            summary: `Changed ${userName} to ${String(body.role)}.`,
            at: "2026-05-14T12:03:00.000Z",
          }),
          ...state.auditEntries,
        ],
      };

      return jsonResponse(200, { state: toWorkspaceStateBody(state) });
    }

    if (pathname.includes("/memberships/") && pathname.endsWith("/revoke") && method === "POST") {
      const [, , , , workspaceId, , userId] = pathname.split("/");

      try {
        state = {
          ...state,
          memberships: revokeWorkspaceMembership({
            memberships: state.memberships,
            workspaceId: workspaceId!,
            tenantId: "tenant-west-africa",
            userId: userId!,
          }),
        };
      } catch (error) {
        return jsonResponse(409, {
          message: error instanceof Error ? error.message : "Workspace mutation failed.",
        });
      }

      const userName = state.directoryUsers.find((user) => user.id === userId)?.name ?? userId;
      state = {
        ...state,
        auditEntries: [
          createWorkspaceAuditEntry({
            id: `audit-${workspaceId}-${state.auditEntries.length + 1}`,
            workspaceId: workspaceId!,
            tenantId: "tenant-west-africa",
            actorUserId: String(body.actorUserId ?? "user-ops-lead"),
            action: "membership.revoked",
            summary: `Revoked access for ${userName}.`,
            at: "2026-05-14T12:04:00.000Z",
          }),
          ...state.auditEntries,
        ],
      };

      return jsonResponse(200, { state: toWorkspaceStateBody(state) });
    }

    if (pathname === "/runtime/realtime/sessions" && method === "POST") {
      return jsonResponse(201, {
        session: {
          sessionId: "runtime-premium-1",
          manifestId: body.manifest?.manifestId ?? "manifest-premium",
          publishedVersionId: body.manifest?.publishedVersionId ?? "workflow-premium-v1",
          activeRoleId: body.activeRoleId ?? "agent-front-desk",
          runtime: "openai-realtime",
          policy: "premium-realtime",
          model: "gpt-realtime",
          voice: "expressive",
          transportUrl: "/runtime/realtime/sessions/manifest-premium",
          expiresAt: "2026-05-14T12:30:00.000Z",
          observedEventTypes: [
            "tool.started",
            "tool.completed",
            "tool.failed",
            "agent.handoff.requested",
            "agent.handoff.completed",
          ],
        },
      });
    }

    if (pathname === "/organizations/tenant-west-africa/telephony/state" && method === "GET") {
      return jsonResponse(200, telephonyState);
    }

    if (pathname === "/organizations/tenant-west-africa/telephony/connections" && method === "POST") {
      const connectionId = `telephony-tenant-west-africa-${telephonyState.connections.length + 1}`;
      const authToken = String(body.authToken ?? body.secret ?? "");
      const ownershipMode = String(body.ownershipMode ?? "byo_provider_account");
      const provider = String(body.provider ?? "twilio");
      const connection = {
        id: connectionId,
        tenantId: "tenant-west-africa",
        label: String(body.label ?? "Tenant telephony connection"),
        ownershipMode,
        provider,
        region: String(body.region ?? "us-east-1"),
        status: "active",
        healthStatus: "unknown",
        recordingPolicy: body.recordingPolicy ?? {
          enabled: true,
          consentMode: "single-party",
          consentMessage: "This call may be recorded for quality assurance.",
        },
        blockRoutingOnHealthFailure: Boolean(body.blockRoutingOnHealthFailure ?? true),
        credentialReference: {
          id: `${connectionId}:cred`,
          provider,
          keyVersion: 1,
          preview: `****${authToken.slice(-4)}`,
        },
        externalReference: String(body.accountSid ?? ""),
        ...(body.sip
          ? {
              sip: {
                domain: String(body.sip.domain ?? ""),
                codecs: Array.isArray(body.sip.codecs) ? body.sip.codecs : [],
              },
            }
          : {}),
        webhookBaseUrl:
          ownershipMode === "byo_provider_account" ? "http://127.0.0.1/telephony/webhooks/twilio" : undefined,
        webhookStatus: ownershipMode === "byo_provider_account" ? "configured" : "missing",
        createdBy: String(body.actorUserId ?? "user-ops-lead"),
      };

      telephonyState = {
        ...telephonyState,
        connections: [...telephonyState.connections, connection],
      };

      return jsonResponse(201, {
        state: telephonyState,
        connection,
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/telephony/connections/") &&
      pathname.endsWith("/register-number") &&
      method === "POST"
    ) {
      const connectionId = pathname.split("/")[5]!;
      const connection = telephonyState.connections.find((candidate) => candidate.id === connectionId);
      const normalizedPhoneNumber = String(body.phoneNumber ?? "").trim();
      const phoneNumber = {
        id: `phone-number-${normalizedPhoneNumber.replace(/\D+/g, "")}`,
        tenantId: "tenant-west-africa",
        connectionId,
        provider: String(connection?.provider ?? "twilio"),
        provisionSource:
          connection?.ownershipMode === "byo_sip_trunk" ? "manual-did" : "platform-pool",
        externalNumberId: String(body.externalNumberId ?? `${connectionId}:${normalizedPhoneNumber}`),
        phoneNumber: normalizedPhoneNumber,
        friendlyName: String(body.friendlyName ?? "Live number"),
        voiceCapable: true,
        callerIdEligible: true,
        status: "imported",
        webhookStatus: "configured",
      };

      telephonyState = {
        ...telephonyState,
        phoneNumbers: [...telephonyState.phoneNumbers, phoneNumber],
      };

      return jsonResponse(201, {
        state: telephonyState,
        phoneNumber,
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/telephony/connections/") &&
      pathname.endsWith("/heartbeat") &&
      method === "POST"
    ) {
      const connectionId = pathname.split("/")[5]!;
      const routedNumberCount = telephonyState.phoneNumbers.filter(
        (phoneNumber) => phoneNumber.connectionId === connectionId && phoneNumber.status === "routed",
      ).length;
      const heartbeat = {
        id: `${connectionId}:heartbeat:${telephonyState.healthChecks.length + 1}`,
        tenantId: "tenant-west-africa",
        connectionId,
        provider: "twilio",
        ownershipMode: "byo_provider_account",
        status: "healthy",
        blocking: false,
        scheduled: Boolean(body.scheduled ?? false),
        latencyMs: 112,
        routedNumberCount,
        at: "2026-05-14T12:09:00.000Z",
        message: `Twilio heartbeat is healthy with ${routedNumberCount} routed number${routedNumberCount === 1 ? "" : "s"}.`,
        diagnostics: [
          "Twilio REST credential probe completed successfully.",
          `${routedNumberCount} routed number${routedNumberCount === 1 ? "" : "s"} available for provider dispatch.`,
        ],
      };
      const healthCheck = {
        id: `${connectionId}:health:${telephonyState.healthChecks.length + 1}`,
        connectionId,
        status: "healthy",
        blocking: false,
        checkedAt: heartbeat.at,
        message: heartbeat.message,
        scheduled: heartbeat.scheduled,
        latencyMs: heartbeat.latencyMs,
        diagnostics: heartbeat.diagnostics,
      };

      telephonyState = {
        ...telephonyState,
        connections: telephonyState.connections.map((connection) =>
          connection.id === connectionId
            ? { ...connection, healthStatus: "healthy", status: "active" }
            : connection,
        ),
        healthChecks: [healthCheck, ...telephonyState.healthChecks],
        providerHeartbeats: [heartbeat, ...telephonyState.providerHeartbeats],
      };

      return jsonResponse(201, {
        state: telephonyState,
        heartbeat,
        healthCheck,
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/telephony/connections/") &&
      pathname.endsWith("/validate") &&
      method === "POST"
    ) {
      const connectionId = pathname.split("/")[5]!;
      const connection = telephonyState.connections.find((candidate) => candidate.id === connectionId);
      const hasAttachedNumber = telephonyState.phoneNumbers.some((phoneNumber) => phoneNumber.connectionId === connectionId);
      const healthCheck = {
        id: `${connectionId}:health:${telephonyState.healthChecks.length + 1}`,
        connectionId,
        status: hasAttachedNumber || connection?.ownershipMode !== "byo_sip_trunk" ? "healthy" : "warning",
        blocking: false,
        checkedAt: "2026-05-14T12:10:00.000Z",
        message:
          hasAttachedNumber || connection?.ownershipMode !== "byo_sip_trunk"
            ? "Provider credential check passed."
            : "Attach at least one SIP DID before validating route health.",
      };

      telephonyState = {
        ...telephonyState,
        connections: telephonyState.connections.map((connection) =>
          connection.id === connectionId
            ? { ...connection, healthStatus: healthCheck.status, status: "active" }
            : connection,
        ),
        healthChecks: [healthCheck, ...telephonyState.healthChecks],
      };

      return jsonResponse(200, {
        state: telephonyState,
        healthCheck,
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/telephony/connections/") &&
      pathname.endsWith("/import-twilio-numbers") &&
      method === "POST"
    ) {
      const connectionId = pathname.split("/")[5]!;
      const importedNumbers = [
        {
          id: "phone-number-pn-support-7890",
          tenantId: "tenant-west-africa",
          connectionId,
          provider: "twilio",
          provisionSource: "provider-import",
          externalNumberId: "PN78901001",
          phoneNumber: "+14155557890",
          friendlyName: "Support line",
          voiceCapable: true,
          callerIdEligible: true,
          status: "imported",
          webhookStatus: "pending",
        },
        {
          id: "phone-number-pn-reception-7890",
          tenantId: "tenant-west-africa",
          connectionId,
          provider: "twilio",
          provisionSource: "provider-import",
          externalNumberId: "PN78902002",
          phoneNumber: "+14156667890",
          friendlyName: "Reception line",
          voiceCapable: true,
          callerIdEligible: true,
          status: "imported",
          webhookStatus: "pending",
        },
      ].filter(
        (candidate) => !telephonyState.phoneNumbers.some((phoneNumber) => phoneNumber.id === candidate.id),
      );

      telephonyState = {
        ...telephonyState,
        phoneNumbers: [...telephonyState.phoneNumbers, ...importedNumbers],
      };

      return jsonResponse(201, {
        state: telephonyState,
        importedNumbers,
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/telephony/connections/") &&
      pathname.endsWith("/test-call") &&
      method === "POST"
    ) {
      const connectionId = pathname.split("/")[5]!;
      const phoneNumber = telephonyState.phoneNumbers.find((candidate) => candidate.id === body.phoneNumberId);
      const dispatch = {
        id: `${String(body.callSid ?? "CA-test")}:manual`,
        tenantId: "tenant-west-africa",
        direction: "inbound",
        disposition: "routed",
        reason: `Routed ${String(phoneNumber?.phoneNumber ?? "")} to ${String(phoneNumber?.workflowLabel ?? "")}.`,
        callSessionId: `${String(body.callSid ?? "CA-test")}:telephony`,
        phoneNumberId: phoneNumber?.id,
        connectionId,
        publishedVersionId: phoneNumber?.publishedVersionId,
        workspaceId: phoneNumber?.workspaceId,
        workflowLabel: phoneNumber?.workflowLabel,
        recording: phoneNumber?.recordingPolicy ?? {
          enabled: true,
          consentMode: "single-party",
          consentMessage: "This call may be recorded for quality assurance.",
        },
        toPhoneNumber: String(phoneNumber?.phoneNumber ?? ""),
        fromPhoneNumber: String(body.fromPhoneNumber ?? ""),
        createdAt: "2026-05-14T12:10:00.000Z",
        source: "manual",
      };
      const session = {
        id: `${dispatch.callSessionId}:execution`,
        tenantId: "tenant-west-africa",
        dispatchId: dispatch.id,
        callSessionId: dispatch.callSessionId,
        connectionId,
        provider: "twilio",
        ownershipMode: "byo_provider_account",
        direction: "inbound",
        status: "ringing",
        toPhoneNumber: dispatch.toPhoneNumber,
        fromPhoneNumber: dispatch.fromPhoneNumber,
        workflowLabel: dispatch.workflowLabel,
        workspaceId: dispatch.workspaceId,
        testCall: true,
        diagnostics: [
          "Twilio programmable voice accepted the ingress session.",
          "Credential-backed provider bridge is ready for test audio.",
        ],
        createdAt: "2026-05-14T12:10:00.000Z",
        updatedAt: "2026-05-14T12:10:00.000Z",
      };

      telephonyState = {
        ...telephonyState,
        dispatches: [dispatch, ...telephonyState.dispatches],
        executionSessions: [session, ...telephonyState.executionSessions],
      };

      return jsonResponse(201, {
        state: telephonyState,
        dispatch,
        session,
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/telephony/numbers/") &&
      pathname.endsWith("/routing") &&
      method === "PATCH"
    ) {
      const numberId = pathname.split("/")[5]!;

      telephonyState = {
        ...telephonyState,
        phoneNumbers: telephonyState.phoneNumbers.map((phoneNumber) =>
          phoneNumber.id === numberId
            ? {
                ...phoneNumber,
                status: "routed",
                webhookStatus: "configured",
                publishedVersionId: String(body.publishedVersionId ?? ""),
                workflowLabel: String(body.workflowLabel ?? ""),
                workspaceId: String(body.workspaceId ?? "workspace-operations"),
                recordingPolicy: body.recordingPolicy,
              }
            : phoneNumber,
        ),
      };

      return jsonResponse(200, {
        state: telephonyState,
      });
    }

    if (pathname === "/organizations/tenant-west-africa/telephony/dispatch/inbound" && method === "POST") {
      const phoneNumber = telephonyState.phoneNumbers.find((candidate) => candidate.phoneNumber === body.toPhoneNumber);
      const connection = telephonyState.connections.find(
        (candidate) => candidate.id === phoneNumber?.connectionId,
      );
      const dispatch = {
        id: `${String(body.callSid ?? "CA-test")}:manual`,
        tenantId: "tenant-west-africa",
        direction: "inbound",
        disposition: phoneNumber?.publishedVersionId ? "routed" : "fallback",
        reason: phoneNumber?.publishedVersionId
          ? `Routed ${String(body.toPhoneNumber)} to ${String(phoneNumber.workflowLabel)}.`
          : "No published workflow route is assigned to this number.",
        callSessionId: `${String(body.callSid ?? "CA-test")}:telephony`,
        phoneNumberId: phoneNumber?.id,
        connectionId: phoneNumber?.connectionId,
        publishedVersionId: phoneNumber?.publishedVersionId,
        workspaceId: phoneNumber?.workspaceId,
        recording: phoneNumber?.recordingPolicy ?? {
          enabled: true,
          consentMode: "single-party",
          consentMessage: "This call may be recorded for quality assurance.",
        },
        toPhoneNumber: String(body.toPhoneNumber ?? ""),
        fromPhoneNumber: String(body.fromPhoneNumber ?? ""),
        createdAt: "2026-05-14T12:11:00.000Z",
        source: "manual",
      };
      const bridgeKind =
        connection?.ownershipMode === "platform_managed"
          ? "platform-edge"
          : connection?.ownershipMode === "byo_sip_trunk"
            ? "sip-trunk"
            : "twilio-programmable-voice";
      const bridgeAction =
        bridgeKind === "platform-edge"
          ? "platform.edge.accept-call"
          : bridgeKind === "sip-trunk"
            ? "sip.invite.accept"
            : "twilio.calls.answer";

      telephonyState = {
        ...telephonyState,
        dispatches: [dispatch, ...telephonyState.dispatches],
        executionSessions:
          dispatch.disposition === "routed"
            ? [
                {
                  id: `${dispatch.callSessionId}:execution`,
                  tenantId: "tenant-west-africa",
                  dispatchId: dispatch.id,
                  callSessionId: dispatch.callSessionId,
                  connectionId: dispatch.connectionId,
                  provider: String(connection?.provider ?? "twilio"),
                  ownershipMode: String(connection?.ownershipMode ?? "byo_provider_account"),
                  direction: "inbound",
                  status: "ringing",
                  toPhoneNumber: dispatch.toPhoneNumber,
                  fromPhoneNumber: dispatch.fromPhoneNumber,
                  workflowLabel: phoneNumber?.workflowLabel,
                  workspaceId: phoneNumber?.workspaceId,
                  testCall: false,
                  bridgeKind,
                  bridgeTarget: String(connection?.label ?? "Provider bridge"),
                  mediaPath: "provider-native",
                  diagnostics: ["Provider bridge accepted the ingress session."],
                  createdAt: dispatch.createdAt,
                  updatedAt: dispatch.createdAt,
                },
                ...telephonyState.executionSessions,
              ]
            : telephonyState.executionSessions,
        executionCommands:
          dispatch.disposition === "routed"
            ? [
                {
                  id: `${dispatch.callSessionId}:command`,
                  tenantId: "tenant-west-africa",
                  sessionId: `${dispatch.callSessionId}:execution`,
                  dispatchId: dispatch.id,
                  callSessionId: dispatch.callSessionId,
                  provider: String(connection?.provider ?? "twilio"),
                  action: bridgeAction,
                  status: "applied",
                  target: String(connection?.label ?? "Provider bridge"),
                  payload: {
                    toPhoneNumber: dispatch.toPhoneNumber,
                    fromPhoneNumber: dispatch.fromPhoneNumber,
                  },
                  requestedAt: dispatch.createdAt,
                  appliedAt: dispatch.createdAt,
                },
                ...telephonyState.executionCommands,
              ]
            : telephonyState.executionCommands,
      };

      return jsonResponse(201, {
        state: telephonyState,
        dispatch,
      });
    }

    if (pathname === "/organizations/tenant-west-africa/telephony/dispatch/outbound" && method === "POST") {
      const phoneNumber = telephonyState.phoneNumbers.find((candidate) => candidate.phoneNumber === body.fromPhoneNumber);
      const dispatch = {
        id: `${String(body.callSid ?? "CA-outbound")}:manual`,
        tenantId: "tenant-west-africa",
        direction: "outbound",
        disposition: body.consentGranted ? "queued" : "blocked",
        reason: body.consentGranted
          ? `Queued outbound call from ${String(body.fromPhoneNumber)} to ${String(body.toPhoneNumber)}.`
          : "Outbound calling requires customer consent before the session can start.",
        callSessionId: `${String(body.callSid ?? "CA-outbound")}:telephony`,
        phoneNumberId: phoneNumber?.id,
        connectionId: phoneNumber?.connectionId,
        publishedVersionId: String(body.publishedVersionId ?? ""),
        workspaceId: String(body.workspaceId ?? "workspace-operations"),
        workflowLabel: String(body.workflowLabel ?? ""),
        recording: phoneNumber?.recordingPolicy ?? {
          enabled: true,
          consentMode: "single-party",
          consentMessage: "This call may be recorded for quality assurance.",
        },
        policyChecks: {
          consent: {
            status: body.consentGranted ? "passed" : "blocked",
            detail: body.consentGranted ? "Customer consent confirmed." : "Outbound calling requires customer consent before the session can start.",
          },
          budget: {
            status: "passed",
            detail: "Budget check passed.",
          },
          callingWindow: {
            status: "passed",
            detail: "Calling window check passed.",
          },
          callerId: {
            status: phoneNumber ? "passed" : "blocked",
            detail: phoneNumber ? "Caller ID is routed." : "Caller ID must match a routed Zara or tenant-owned number before outbound dispatch.",
          },
        },
        toPhoneNumber: String(body.toPhoneNumber ?? ""),
        fromPhoneNumber: String(body.fromPhoneNumber ?? ""),
        createdAt: "2026-05-14T12:12:00.000Z",
        source: "manual",
      };

      telephonyState = {
        ...telephonyState,
        dispatches: [dispatch, ...telephonyState.dispatches],
        executionSessions:
          dispatch.disposition === "queued"
            ? [
                {
                  id: `${dispatch.callSessionId}:execution`,
                  tenantId: "tenant-west-africa",
                  dispatchId: dispatch.id,
                  callSessionId: dispatch.callSessionId,
                  connectionId: dispatch.connectionId,
                  provider: "twilio",
                  ownershipMode: "platform_managed",
                  direction: "outbound",
                  status: "ringing",
                  toPhoneNumber: dispatch.toPhoneNumber,
                  fromPhoneNumber: dispatch.fromPhoneNumber,
                  workflowLabel: dispatch.workflowLabel,
                  workspaceId: dispatch.workspaceId,
                  testCall: false,
                  diagnostics: ["Zara platform edge reserved egress capacity in eu-west-1."],
                  createdAt: dispatch.createdAt,
                  updatedAt: dispatch.createdAt,
                },
                ...telephonyState.executionSessions,
              ]
            : telephonyState.executionSessions,
      };

      return jsonResponse(201, {
        state: telephonyState,
        dispatch,
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/telephony/calls/") &&
      pathname.endsWith("/events") &&
      method === "POST"
    ) {
      const callSessionId = decodeURIComponent(pathname.split("/")[5]!);
      const event = {
        id: `${callSessionId}:${String(body.eventType ?? "dtmf.received")}:mock`,
        tenantId: "tenant-west-africa",
        dispatchId: String(body.dispatchId ?? "dispatch-mock"),
        callSessionId,
        eventType: String(body.eventType ?? "dtmf.received"),
        at: "2026-05-14T12:13:00.000Z",
        summary: `Recorded ${String(body.eventType ?? "dtmf.received")} event.`,
        ...(body.fallbackTarget ? { fallbackTarget: String(body.fallbackTarget) } : {}),
        payload: Object.fromEntries(
          Object.entries({
            digit: body.digit,
            transferTarget: body.transferTarget,
            fallbackTarget: body.fallbackTarget,
          }).filter(([, value]) => typeof value === "string" && value.length > 0),
        ),
      };

      telephonyState = {
        ...telephonyState,
        callControlEvents: [event, ...telephonyState.callControlEvents],
        executionSessions: telephonyState.executionSessions.map((session) =>
          session.callSessionId === callSessionId
            ? {
                ...session,
                status:
                  body.eventType === "transfer.failed" || body.eventType === "failover.triggered"
                    ? "failover-active"
                    : body.eventType === "transfer.requested"
                      ? "transfer-pending"
                      : body.eventType === "voicemail.detected"
                        ? "voicemail"
                        : "active",
                outageMode:
                  body.eventType === "transfer.failed" || body.eventType === "failover.triggered"
                    ? "provider-fallback"
                    : session.outageMode,
                fallbackTarget: body.fallbackTarget ?? session.fallbackTarget,
                updatedAt: "2026-05-14T12:13:00.000Z",
              }
            : session,
        ),
      };

      return jsonResponse(201, {
        state: telephonyState,
        event,
      });
    }

    if (
      pathname === "/organizations/tenant-west-africa/telephony/credentials/rotate" &&
      method === "POST"
    ) {
      const rotatedConnectionCount = telephonyState.connections.filter(
        (connection) => connection.ownershipMode !== "platform_managed",
      ).length;

      telephonyState = {
        ...telephonyState,
        connections: telephonyState.connections.map((connection) =>
          (connection as { credentialReference?: { keyVersion: number } }).credentialReference
            ? {
                ...connection,
                credentialReference: {
                  ...(connection as { credentialReference: { keyVersion: number } }).credentialReference,
                  keyVersion:
                    (connection as { credentialReference: { keyVersion: number } }).credentialReference.keyVersion + 1,
                },
              }
            : connection,
        ),
      };

      return jsonResponse(201, {
        state: telephonyState,
        rotatedConnectionCount,
      });
    }

    return jsonResponse(404, { message: "Not found" });
  });

  vi.stubGlobal("fetch", fetchMock);

  return {
    fetchMock,
    getState: () => state,
  };
}

function installLiveSandboxMock() {
  type SessionRecord = {
    sessionId: string;
    organizationId: string;
    workspaceId: string;
    source: string;
    inputMode: string;
    entryRoleId: string;
    manifestId: string;
    publishedVersionId: string;
    runtimeProfile: string;
    transportToken: string;
    transportUrl: string;
    status: "ready" | "active" | "ended";
    createdAt: string;
    expiresAt: string;
  };

  const sessions = new Map<string, SessionRecord>();

  class MockWebSocket {
    static readonly OPEN = 1;
    static readonly CLOSED = 3;

    readyState = 0;
    readonly url: string;
    private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    private readonly session: SessionRecord;
    private audioChunks: string[] = [];

    constructor(url: string | URL) {
      this.url = String(url);
      const parsed = new URL(this.url, "ws://127.0.0.1:4010");
      const sessionId = parsed.pathname.split("/")[5] ?? "";
      const token = parsed.searchParams.get("token") ?? "";
      const session = sessions.get(sessionId);

      if (session === undefined || session.transportToken !== token) {
        throw new Error(`Live sandbox session '${sessionId}' is not available in the test transport.`);
      }

      this.session = session;
      queueMicrotask(() => {
        this.readyState = MockWebSocket.OPEN;
        this.session.status = "active";
        this.emit("open");
      });
    }

    addEventListener(event: string, listener: (...args: unknown[]) => void) {
      const current = this.listeners.get(event) ?? new Set<(...args: unknown[]) => void>();
      current.add(listener);
      this.listeners.set(event, current);
    }

    removeEventListener(event: string, listener: (...args: unknown[]) => void) {
      this.listeners.get(event)?.delete(listener);
    }

    send(payload: string) {
      const message = JSON.parse(payload) as Record<string, unknown>;

      if (message.type === "input.text") {
        this.emitTurn({
          transcript: String(message.transcript ?? ""),
        });
        return;
      }

      if (message.type === "input.audio.append") {
        this.audioChunks.push(String(message.audioBase64 ?? ""));
        this.emitMessage({
          sessionId: this.session.sessionId,
          sequence: Date.now(),
          type: "input.audio.buffered",
          at: "2026-05-15T09:00:00.000Z",
          payload: {
            chunkCount: this.audioChunks.length,
          },
        });
        return;
      }

      if (message.type === "input.audio.commit") {
        this.emitMessage({
          sessionId: this.session.sessionId,
          sequence: Date.now(),
          type: "stt.partial",
          at: "2026-05-15T09:00:01.000Z",
          payload: {
            transcript: "I need help with billing",
            confidence: 0.93,
            language: "en",
          },
        });
        this.emitTurn({
          transcript: "I need help with billing",
        });
      }
    }

    close() {
      this.readyState = MockWebSocket.CLOSED;
      this.session.status = "ended";
      queueMicrotask(() => {
        this.emit("close", {
          code: 1000,
          reason: "closed",
        });
      });
    }

    private emitTurn(input: { transcript: string }) {
      this.emitMessage({
        sessionId: this.session.sessionId,
        sequence: Date.now(),
        type: "turn.transcribed",
        at: "2026-05-15T09:00:02.000Z",
        payload: {
          transcript: input.transcript,
          source: this.session.inputMode === "voice" ? "voice" : "typed",
          language: "en",
          confidence: 0.92,
          callPhase: "discovery",
        },
      });
      this.emitMessage({
        sessionId: this.session.sessionId,
        sequence: Date.now() + 1,
        type: "routing.model_selected",
        at: "2026-05-15T09:00:02.050Z",
        payload: {
          tier: this.session.runtimeProfile === "balanced" ? "standard" : "cheap",
          source: "rule",
          matchedRuleId: "route-billing-standard",
          reason: "Billing discovery needs a stronger reasoning tier.",
        },
      });
      this.emitMessage({
        sessionId: this.session.sessionId,
        sequence: Date.now() + 2,
        type: "tool.completed",
        at: "2026-05-15T09:00:02.080Z",
        payload: {
          nodeId: "tool-customer-profile",
          toolId: "hubspot.profile.lookup",
          toolName: "Customer profile lookup",
          summary: "Customer profile lookup completed in 42ms.",
          durationMs: 42,
        },
      });
      this.emitMessage({
        sessionId: this.session.sessionId,
        sequence: Date.now() + 3,
        type: "turn.audio.first_byte",
        at: "2026-05-15T09:00:02.100Z",
        payload: {
          latencyMs: 180,
        },
      });
      this.emitMessage({
        sessionId: this.session.sessionId,
        sequence: Date.now() + 4,
        type: "provider.telemetry",
        at: "2026-05-15T09:00:02.110Z",
        payload: {
          stage: "tts",
          provider: "cartesia-sonic-3",
          latencyMs: 180,
        },
      });
      this.emitMessage({
        sessionId: this.session.sessionId,
        sequence: Date.now() + 5,
        type: "turn.audio.chunk",
        at: "2026-05-15T09:00:02.120Z",
        payload: {
          audioBase64: "QmlsbGluZyBhdWRpbyBjaHVuaw==",
          chunkIndex: 0,
        },
      });
      this.emitMessage({
        sessionId: this.session.sessionId,
        sequence: Date.now() + 6,
        type: "turn.completed",
        at: "2026-05-15T09:00:02.150Z",
        payload: {
          transcript: input.transcript,
          responseText: "Billing support is ready to help with that request.",
          audioChunkCount: 1,
          degraded: false,
        },
      });
      this.emitMessage({
        sessionId: this.session.sessionId,
        sequence: Date.now() + 7,
        type: "turn.cost.delta",
        at: "2026-05-15T09:00:02.180Z",
        payload: {
          currency: "USD",
          totalUsd: 0.001894,
          modelTier: this.session.runtimeProfile === "balanced" ? "standard" : "cheap",
        },
      });
    }

    private emitMessage(message: Record<string, unknown>) {
      queueMicrotask(() => {
        this.emit("message", {
          data: JSON.stringify(message),
        });
      });
    }

    private emit(event: string, ...args: unknown[]) {
      const listeners = this.listeners.get(event);

      if (listeners === undefined) {
        return;
      }

      for (const listener of listeners) {
        listener(...args);
      }
    }
  }

  return {
    WebSocket: MockWebSocket,
    createSession(input: {
      organizationId: string;
      workspaceId: string;
      source: string;
      inputMode: string;
      entryRoleId: string;
      manifestId: string;
      publishedVersionId: string;
      runtimeProfile: string;
    }) {
      const sessionId = `sandbox-live-${sessions.size + 1}`;
      const transportToken = `transport-token-${sessions.size + 1}`;
      const session: SessionRecord = {
        sessionId,
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        source: input.source,
        inputMode: input.inputMode,
        entryRoleId: input.entryRoleId,
        manifestId: input.manifestId,
        publishedVersionId: input.publishedVersionId,
        runtimeProfile: input.runtimeProfile,
        transportToken,
        transportUrl: `ws://127.0.0.1:4010/organizations/${input.organizationId}/sandbox/live-sessions/${sessionId}/stream`,
        status: "ready",
        createdAt: "2026-05-15T09:00:00.000Z",
        expiresAt: "2026-05-15T09:10:00.000Z",
      };

      sessions.set(sessionId, session);

      return {
        sessionId,
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        actorUserId: "user-ops-lead",
        source: input.source,
        inputMode: input.inputMode,
        entryRoleId: input.entryRoleId,
        manifestId: input.manifestId,
        publishedVersionId: input.publishedVersionId,
        runtimeProfile: input.runtimeProfile,
        transportUrl: session.transportUrl,
        transportToken,
        providerStack: {
          stt: "assemblyai-streaming",
          tts: "cartesia-sonic-3",
        },
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        status: session.status,
      };
    },
    endSession(sessionId: string) {
      const session = sessions.get(sessionId);

      if (session === undefined) {
        throw new Error(`Live sandbox session '${sessionId}' was not found.`);
      }

      session.status = "ended";

      return {
        sessionId: session.sessionId,
        organizationId: session.organizationId,
        workspaceId: session.workspaceId,
        actorUserId: "user-ops-lead",
        source: session.source,
        inputMode: session.inputMode,
        entryRoleId: session.entryRoleId,
        manifestId: session.manifestId,
        publishedVersionId: session.publishedVersionId,
        runtimeProfile: session.runtimeProfile,
        transportUrl: session.transportUrl,
        providerStack: {
          stt: "assemblyai-streaming",
          tts: "cartesia-sonic-3",
        },
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        status: session.status,
        endedAt: "2026-05-15T09:03:00.000Z",
      };
    },
  };
}

function createInitialTelephonyState() {
  return {
    organizationId: "tenant-west-africa",
    connections: [] as Array<Record<string, unknown>>,
    phoneNumbers: [] as Array<Record<string, unknown>>,
    healthChecks: [] as Array<Record<string, unknown>>,
    providerHeartbeats: [] as Array<Record<string, unknown>>,
    dispatches: [] as Array<Record<string, unknown>>,
    executionSessions: [] as Array<Record<string, unknown>>,
    executionCommands: [] as Array<Record<string, unknown>>,
    webhookEvents: [] as Array<Record<string, unknown>>,
    callControlEvents: [] as Array<Record<string, unknown>>,
  };
}

function toWorkspaceStateBody(state: WorkspaceSeedState) {
  return {
    organizationId: state.tenantId,
    directoryUsers: state.directoryUsers,
    workspaces: state.workspaces,
    memberships: state.memberships,
    auditEntries: state.auditEntries,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}
