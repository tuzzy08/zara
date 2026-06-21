import type { CompiledRuntimeManifest } from "@zara/core";

export function resolvePremiumRealtimeRoutePolicySourceNodeId(
  manifest: CompiledRuntimeManifest,
  activeAgentId: string,
) {
  const activeAgentNode = manifest.graph?.nodes.find(
    (node) => node.kind === "agent" && node.id === activeAgentId,
  );
  const activeIds = new Set([
    activeAgentId,
    ...(activeAgentNode !== undefined ? [activeAgentNode.id] : []),
  ]);
  const routePolicy = (manifest.routePolicies ?? []).find((policy) => activeIds.has(policy.sourceAgentId));

  if (routePolicy === undefined) {
    return undefined;
  }

  return manifest.graph?.nodes.some((node) => node.id === routePolicy.sourceAgentId)
    ? routePolicy.sourceAgentId
    : activeAgentNode?.id ?? routePolicy.sourceAgentId;
}
