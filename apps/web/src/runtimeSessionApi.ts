import type { CompiledRuntimeManifest, PremiumRealtimeSession } from "@zara/core";

import { requestJson } from "./apiClient";

export async function createRealtimeRuntimeSession(input: {
  manifest: CompiledRuntimeManifest;
  activeAgentId: string;
  budgetAllowed: boolean;
  organizationId?: string | undefined;
  workspaceId?: string | undefined;
  actorUserId?: string | undefined;
}) {
  const response = await requestJson<{ session: PremiumRealtimeSession }>(
    "/runtime/realtime/sessions",
    {
      method: "POST",
      body: JSON.stringify({
        manifest: input.manifest,
        activeAgentId: input.activeAgentId,
        budgetAllowed: input.budgetAllowed,
        ...(input.organizationId !== undefined ? { organizationId: input.organizationId } : {}),
        ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
        ...(input.actorUserId !== undefined ? { actorUserId: input.actorUserId } : {}),
      }),
    },
  );

  return response.session;
}
