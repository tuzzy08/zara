import type { CompiledRuntimeManifest, PremiumRealtimeSession } from "@zara/core";

import { requestJson } from "./apiClient";

export async function createRealtimeRuntimeSession(input: {
  manifest: CompiledRuntimeManifest;
  activeRoleId: string;
  budgetAllowed: boolean;
}) {
  const response = await requestJson<{ session: PremiumRealtimeSession }>(
    "/runtime/realtime/sessions",
    {
      method: "POST",
      body: JSON.stringify({
        manifest: input.manifest,
        activeRoleId: input.activeRoleId,
        budgetAllowed: input.budgetAllowed,
      }),
    },
  );

  return response.session;
}
