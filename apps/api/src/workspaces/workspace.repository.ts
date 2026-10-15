import { createDefaultWorkspaceSeedState, normalizeDefaultWorkspaceSeedState } from "@zara/core";
import type { WorkspaceStateResponse } from "./workspaces.service";

export const WORKSPACE_REPOSITORY = Symbol("WORKSPACE_REPOSITORY");

export interface WorkspaceStoredState extends WorkspaceStateResponse {
  membershipHistoryUserIds: string[];
}

export interface WorkspaceRepository {
  read(organizationId: string): Promise<WorkspaceStoredState>;
  mutate<T>(organizationId: string, operation: (state: WorkspaceStoredState) => T): Promise<T>;
}

export class InMemoryWorkspaceRepository implements WorkspaceRepository {
  private readonly states = new Map<string, WorkspaceStoredState>();

  async read(organizationId: string) {
    return structuredClone(this.getState(organizationId));
  }

  async mutate<T>(organizationId: string, operation: (state: WorkspaceStoredState) => T) {
    const state = structuredClone(this.getState(organizationId));
    const result = operation(state);
    state.membershipHistoryUserIds = [...new Set([
      ...state.membershipHistoryUserIds, ...state.memberships.map(member => member.userId),
    ])];
    this.states.set(organizationId, state);
    return result;
  }

  private getState(organizationId: string): WorkspaceStoredState {
    let state = this.states.get(organizationId);
    if (state === undefined) {
      const seed = normalizeDefaultWorkspaceSeedState(createDefaultWorkspaceSeedState({ tenantId: organizationId }));
      state = { organizationId, directoryUsers: seed.directoryUsers, workspaces: seed.workspaces,
        memberships: seed.memberships, auditEntries: seed.auditEntries,
        membershipHistoryUserIds: seed.memberships.map(member => member.userId) };
      this.states.set(organizationId, state);
    }
    return state;
  }
}
