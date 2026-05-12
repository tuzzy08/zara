import { describe, expect, it } from "vitest";

import { getNextBuilderNodeNumber } from "./workflowBuilderIds";

describe("getNextBuilderNodeNumber", () => {
  it("returns the next highest suffix instead of reusing a deleted node number", () => {
    expect(
      getNextBuilderNodeNumber(
        [
          "agent-front-desk",
          "agent-billing",
          "agent-specialist-3",
          "agent-specialist-5",
        ],
        "agent-specialist-",
      ),
    ).toBe(6);
  });

  it("ignores non-matching ids and malformed suffixes", () => {
    expect(
      getNextBuilderNodeNumber(
        ["tool-node-1", "tool-node-alpha", "handoff-node-2", "tool-node-4"],
        "tool-node-",
      ),
    ).toBe(5);
  });
});
