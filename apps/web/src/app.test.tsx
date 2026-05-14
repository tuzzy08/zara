/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

describe("tenant dashboard shell", () => {
  beforeEach(() => {
    globalThis.ResizeObserver = class ResizeObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    };
  });

  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute("data-theme");
    window.localStorage.clear();
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
  });

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
  });

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

  it("loads sandbox workflows only from the active workspace", () => {
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

    expect(screen.getByLabelText<HTMLSelectElement>("Published workflow").textContent).toContain("Sales qualification lane");
    expect(screen.getByLabelText<HTMLSelectElement>("Published workflow").textContent).not.toContain("Support billing lane");
  });

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
  });

  it("lets workspace admins manage workspace settings, members, and audit history", () => {
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

    fireEvent.change(screen.getByLabelText("Available teammate"), {
      target: { value: "user-finance" },
    });
    fireEvent.change(screen.getByLabelText("Grant role"), {
      target: { value: "viewer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Grant workspace role" }));

    expect(screen.getByText("Finance lead")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Role for Finance lead"), {
      target: { value: "operator" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Archive workspace" }));
    expect(screen.getAllByText("Archived").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Restore workspace" }));
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getByText(/Restored workspace/)).toBeTruthy();
  });
});
