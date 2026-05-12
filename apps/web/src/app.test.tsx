/** @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./App";

describe("tenant dashboard shell", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("renders the shell and lets the user toggle dark mode from the profile menu", () => {
    render(
      <MemoryRouter initialEntries={["/workflows"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Tenant")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Agents" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Workflows" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sandbox" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Calls" })).toBeTruthy();
    expect(screen.getByText("Operations")).toBeTruthy();
    expect(screen.getByTestId("shell-scroll-region")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open profile menu" }));

    const themeToggle = screen.getByRole("menuitem", { name: "Dark mode" });

    expect(themeToggle).toBeTruthy();
    expect(document.documentElement.dataset.theme).toBe("light");

    fireEvent.click(themeToggle);

    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
