import type {
  AgentRoutePolicyConfig,
  CompiledRuntimeManifest,
  DraftWorkflowAgentRoutePolicy,
} from "@zara/core";

type RoleSnapshotWithRoutePolicy = CompiledRuntimeManifest["roles"][number] & {
  routePolicy?: AgentRoutePolicyConfig | undefined;
};

export function hasPremiumRealtimeRoutePolicy(
  manifest: CompiledRuntimeManifest,
  activeRoleId: string,
) {
  return resolvePremiumRealtimeRoutePolicySourceNodeId(manifest, activeRoleId) !== undefined;
}

export function withPremiumRealtimeRoleRoutePolicies(
  manifest: CompiledRuntimeManifest,
): CompiledRuntimeManifest {
  const rolePolicies = buildRoleAttachedRoutePolicies(manifest);
  if (rolePolicies.length === 0) {
    return manifest;
  }

  const existingSourceIds = new Set((manifest.routePolicies ?? []).map((policy) => policy.sourceAgentId));
  const missingRolePolicies = rolePolicies.filter((policy) => !existingSourceIds.has(policy.sourceAgentId));
  if (missingRolePolicies.length === 0) {
    return manifest;
  }

  return {
    ...manifest,
    routePolicies: [...(manifest.routePolicies ?? []), ...missingRolePolicies],
  };
}

export function resolvePremiumRealtimeRoutePolicySourceNodeId(
  manifest: CompiledRuntimeManifest,
  activeRoleId: string,
) {
  const normalizedManifest = withPremiumRealtimeRoleRoutePolicies(manifest);
  const activeAgentNode = normalizedManifest.graph?.nodes.find(
    (node) => node.kind === "agent" && (node.roleId ?? node.id) === activeRoleId,
  );
  const activeIds = new Set([
    activeRoleId,
    ...(activeAgentNode !== undefined ? [activeAgentNode.id] : []),
  ]);
  const routePolicy = (normalizedManifest.routePolicies ?? []).find((policy) => activeIds.has(policy.sourceAgentId));

  if (routePolicy === undefined) {
    return undefined;
  }

  return normalizedManifest.graph?.nodes.some((node) => node.id === routePolicy.sourceAgentId)
    ? routePolicy.sourceAgentId
    : activeAgentNode?.id ?? routePolicy.sourceAgentId;
}

function buildRoleAttachedRoutePolicies(manifest: CompiledRuntimeManifest): DraftWorkflowAgentRoutePolicy[] {
  return manifest.roles.flatMap((role) => {
    const roleSnapshot = role as RoleSnapshotWithRoutePolicy;
    if (roleSnapshot.routePolicy === undefined) {
      return [];
    }

    const agentNode = manifest.graph?.nodes.find(
      (node) => node.kind === "agent" && (node.roleId ?? node.id) === role.id,
    );

    return {
      sourceAgentId: agentNode?.id ?? role.id,
      sourceAgentName: role.name,
      ...roleSnapshot.routePolicy,
    };
  });
}
