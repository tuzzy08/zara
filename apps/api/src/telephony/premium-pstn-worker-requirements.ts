import {
  resolveRuntimeAgents,
  type CompiledRuntimeManifest,
  type RealtimeProviderId,
} from "@zara/core";

export function resolvePremiumPstnRequiredProviders(input: {
  manifest: Pick<
    CompiledRuntimeManifest,
    "agentToolAssignments" | "entryAgentId" | "graph" | "routePolicies"
  >;
  defaultProvider: RealtimeProviderId;
}): RealtimeProviderId[] {
  const agentsById = new Map(
    resolveRuntimeAgents(input.manifest)
      .map((agent) => [agent.agentId, agent]),
  );
  const policiesBySource = new Map(
    input.manifest.routePolicies
      .map((policy) => [policy.sourceAgentId, policy]),
  );
  const pendingAgentIds = [input.manifest.entryAgentId];
  const visitedAgentIds = new Set<string>();
  const providers = new Set<RealtimeProviderId>();

  while (pendingAgentIds.length > 0) {
    const agentId = pendingAgentIds.shift();
    if (agentId === undefined || visitedAgentIds.has(agentId)) {
      continue;
    }
    visitedAgentIds.add(agentId);

    const agent = agentsById.get(agentId);
    if (agent === undefined) {
      continue;
    }
    providers.add(agent.realtimeProvider ?? input.defaultProvider);

    const policy = policiesBySource.get(agentId);
    if (policy === undefined) {
      continue;
    }
    for (const target of [
      ...policy.branches.map((branch) => branch.target),
      policy.fallback.target,
    ]) {
      if (target.type === "agent") {
        pendingAgentIds.push(target.agentId);
      }
    }
  }

  if (providers.size === 0) {
    providers.add(input.defaultProvider);
  }

  return [...providers];
}
