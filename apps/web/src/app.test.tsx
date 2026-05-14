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

  beforeEach(() => {
    globalThis.ResizeObserver = class ResizeObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    };
    apiMock = installApiMock();
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

  it("opens an inline sandbox drawer for the current draft workflow", () => {
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
    fireEvent.change(screen.getByLabelText("Caller turn"), {
      target: { value: "Can you check a billing charge before I publish this workflow?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send caller turn" }));

    expect(screen.getAllByText("Can you check a billing charge before I publish this workflow?").length).toBeGreaterThan(1);
    expect(screen.getByText(/Draft route reached/)).toBeTruthy();

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
    expect(screen.getByText("Simulated tools")).toBeTruthy();
    expect(screen.getByText("Live cost")).toBeTruthy();
    expect(screen.getByText("Runtime decision")).toBeTruthy();
  });

  it("surfaces premium runtime policy on published workflows in sandbox", () => {
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

    expect(screen.getByText("Premium realtime")).toBeTruthy();
    expect(screen.getByText("Server session required")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Start sandbox call" }));

    expect(apiMock.fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/runtime/realtime/sessions"),
      expect.objectContaining({
        method: "POST",
      }),
    );
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

function installApiMock() {
  let state = createDefaultWorkspaceSeedState({
    tenantId: "tenant-west-africa",
  });

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

    return jsonResponse(404, { message: "Not found" });
  });

  vi.stubGlobal("fetch", fetchMock);

  return {
    fetchMock,
    getState: () => state,
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
