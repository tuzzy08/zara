/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { MarketingLandingPageMockup } from "./MarketingLandingPageMockup";

afterEach(() => cleanup());

describe("MarketingLandingPageMockup", () => {
  it("presents the approved monochrome voice-operations story", () => {
    render(
      <MemoryRouter>
        <MarketingLandingPageMockup />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Build the system behind every call" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Analog voice-routing switchboard" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Build call logic at scale" })).toBeTruthy();
    expect(screen.getByLabelText("Zara workflow builder preview")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Every signal, in view" })).toBeTruthy();
    const understand = screen.getByRole("button", { name: "Understand" });
    expect(screen.getByRole("button", { name: "Listen" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(understand);
    expect(understand.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/Combine the active agent, workflow policy/i)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Common questions" })).toBeTruthy();
  });
});
