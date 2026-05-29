import { describe, expect, it } from "vitest";

import { summarizeLiveSandboxEvent } from "./liveSandboxEventFormatting";
import type { LiveSandboxStreamEvent } from "./liveSandboxSessionApi";

describe("live sandbox event formatting", () => {
  it("names the selected provider and model for routing events", () => {
    const summary = summarizeLiveSandboxEvent({
      sessionId: "sandbox-live-1",
      sequence: 2,
      type: "routing.model_selected",
      at: "2026-05-25T10:00:00.000Z",
      payload: {
        tier: "standard",
        provider: "google-gemini",
        modelId: "gemini-3.1-pro-preview",
        reason: "No routing rule matched.",
      },
    } satisfies LiveSandboxStreamEvent);

    expect(summary).toMatchObject({
      label: "Routing",
      title: "Gemini gemini-3.1-pro-preview selected",
      detail: "Standard tier - No routing rule matched.",
      tone: "blue",
    });
  });

  it("surfaces model failure diagnostics instead of opaque event names", () => {
    const summary = summarizeLiveSandboxEvent({
      sessionId: "sandbox-live-1",
      sequence: 4,
      type: "quality.flagged",
      at: "2026-05-25T10:00:00.000Z",
      payload: {
        stage: "model",
        code: "failed",
        message: "Live sandbox text model is not configured.",
      },
    } satisfies LiveSandboxStreamEvent);

    expect(summary).toMatchObject({
      label: "Model",
      title: "Text model needs attention",
      detail: "Live sandbox text model is not configured.",
      tone: "red",
    });
  });
});
