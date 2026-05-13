/** @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
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
    document.documentElement.removeAttribute("data-theme");
  });

  it("renders the workflow builder and lets the user toggle dark mode from the profile menu", () => {
    render(
      <MemoryRouter initialEntries={["/workflows"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Tenant")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Agents" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Workflows" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Sandbox" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Calls" })).toBeTruthy();
    expect(screen.getByText("Workflow builder")).toBeTruthy();
    expect(screen.getAllByText("Front desk triage").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Validation").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Add tool" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add handoff" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add escalation" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add condition" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add exit" })).toBeTruthy();
    expect(screen.queryByText("Workflow nodes")).toBeNull();
    expect(screen.getByTestId("shell-scroll-region")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open profile menu" }));

    const themeToggle = screen.getByRole("menuitem", { name: "Dark mode" });

    expect(themeToggle).toBeTruthy();
    expect(document.documentElement.dataset.theme).toBe("light");

    fireEvent.click(themeToggle);

    expect(document.documentElement.dataset.theme).toBe("dark");
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
    expect(screen.getByText("Simulated tools")).toBeTruthy();
    expect(screen.getByText("Live cost")).toBeTruthy();
    expect(screen.getByText("Runtime decision")).toBeTruthy();
  });
});
