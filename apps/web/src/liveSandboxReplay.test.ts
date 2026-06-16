import { describe, expect, it } from "vitest";

import type { LiveSandboxStreamEvent } from "./liveSandboxSessionApi";
import { buildTranscriptFromLiveSandboxEvents } from "./liveSandboxReplay";

function event(
  sequence: number,
  type: LiveSandboxStreamEvent["type"],
  payload: Record<string, unknown>,
): LiveSandboxStreamEvent {
  return {
    sessionId: "sandbox-session-1",
    sequence,
    type,
    at: "2026-06-15T20:55:11.000Z",
    payload,
  };
}

describe("liveSandboxReplay", () => {
  it("keeps tool failures out of replayed conversation transcripts", () => {
    const transcript = buildTranscriptFromLiveSandboxEvents([
      event(1, "turn.transcribed", { transcript: "Please check my ticket." }),
      event(2, "tool.failed", {
        toolName: "Search tickets",
        summary: "Missing required tool input: query.",
      }),
      event(3, "turn.completed", { responseText: "Could you share the email on the ticket?" }),
    ]);

    expect(transcript).toEqual([
      expect.objectContaining({
        speaker: "caller",
        text: "Please check my ticket.",
      }),
      expect.objectContaining({
        speaker: "agent",
        text: "Could you share the email on the ticket?",
      }),
    ]);
  });
});
