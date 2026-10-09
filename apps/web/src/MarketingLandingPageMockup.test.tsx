/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { MarketingLandingPageMockup } from "./MarketingLandingPageMockup";

describe("marketing landing control surface", () => {
  afterEach(cleanup);

  it("links to pricing and offers the approved plan actions", () => {
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
    const comparison = within(pricing!).getByRole("table", { name: "Compare subscription plans" });
    for (const plan of ["Starter", "Growth"]) {
      const column = within(comparison).getByRole("columnheader", { name: new RegExp(plan) });
      expect(within(column).getByRole("link", { name: `Start with ${plan}` }).getAttribute("href")).toBe("/signup");
    }
    const scale = within(comparison).getByRole("columnheader", { name: /Scale/ });
    expect(within(scale).getByRole("link", { name: "Contact sales" }).getAttribute("href")).toBe("mailto:sales@zharaai.com");
    expect(within(scale).queryByRole("link", { name: "Start with Scale" })).toBeNull();
    expect(within(pricing!).getByRole("link", { name: "Start with prepaid credit" }).getAttribute("href")).toBe("/signup");
  });
});
