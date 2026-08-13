/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { MarketingLandingPageMockup } from "./MarketingLandingPageMockup";

describe("marketing landing control surface", () => {
  afterEach(cleanup);

  it("shows approved pricing and links to it from the primary navigation", () => {
    render(
      <MemoryRouter>
        <MarketingLandingPageMockup />
      </MemoryRouter>,
    );

    expect(
      within(screen.getByRole("navigation", { name: "Primary" }))
        .getByRole("link", { name: "Pricing" })
        .getAttribute("href"),
    ).toBe("#pricing");
    const pricing = document.getElementById("pricing");
    expect(pricing).not.toBeNull();
    expect(within(pricing!).getAllByRole("article")).toHaveLength(4);
    const actions = within(pricing!).getAllByRole("link");
    expect(actions).toHaveLength(4);
    expect(actions.every((action) => action.getAttribute("href") === "/signup")).toBe(true);
  });
});
