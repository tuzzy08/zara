import { describe, expect, it } from "vitest";

import { DEFAULT_WORKSPACE_ID } from "@zara/core";

import { createInitialWorkspaceState, resolveActiveWorkspaceId } from "./workspaceState";

describe("workspace state", () => {
  it("starts fresh tenants in the single default workspace", () => {
    const state = createInitialWorkspaceState();

    expect(state.workspaces.map((workspace) => workspace.id)).toEqual([DEFAULT_WORKSPACE_ID]);
    expect(state.workspaces[0]?.name).toBe("Default workspace");
  });

  it("falls back to the canonical default workspace instead of legacy seed IDs", () => {
    expect(resolveActiveWorkspaceId([])).toBe(DEFAULT_WORKSPACE_ID);
  });
});
