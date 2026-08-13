/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { MarketingLandingPageMockup } from "./MarketingLandingPageMockup";

describe("marketing landing control surface", () => {
  afterEach(cleanup);

  it("connects each bidirectional route node through ports on both ends", () => {
    render(
      <MemoryRouter>
        <MarketingLandingPageMockup />
      </MemoryRouter>,
    );

    const routeMap = screen.getByLabelText("Live voice route map");
    const bidirectionalNodes = routeMap.querySelectorAll(
      '[data-port-layout="bidirectional"]',
    );

    expect(bidirectionalNodes).toHaveLength(3);
    bidirectionalNodes.forEach((node) => {
      expect(node.querySelectorAll('[data-testid="route-port"]')).toHaveLength(2);
    });
    const controlSurface = screen.getByLabelText("Live voice routing control surface");
    expect(
      within(controlSurface).getByText("LIVE").classList.contains("signal-live-status"),
    ).toBe(true);
  });

  it("keeps the measurement heading above the aligned metric row", () => {
    render(
      <MemoryRouter>
        <MarketingLandingPageMockup />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: "Know what improved" }).parentElement
        ?.classList.contains("signal-metrics-intro"),
    ).toBe(true);
  });

  it("uses explicit ports for the workflow preview nodes and edges", () => {
    render(
      <MemoryRouter>
        <MarketingLandingPageMockup />
      </MemoryRouter>,
    );

    const workflowGraph = screen.getByLabelText("Connected workflow preview");
    const bidirectionalNodes = workflowGraph.querySelectorAll(
      '[data-port-layout="bidirectional"]',
    );

    expect(bidirectionalNodes).toHaveLength(9);
    bidirectionalNodes.forEach((node) => {
      expect(node.querySelectorAll('[data-testid="workflow-port"]')).toHaveLength(2);
    });
    expect(workflowGraph.querySelectorAll("[data-edge-from]")).toHaveLength(12);
  });
});
