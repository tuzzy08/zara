import type { AgentRoleKind, CompiledRuntimeManifest } from "@zara/core";

import type { RuntimePromptPolicy } from "./runtime-prompt-policy.models";

export function applyRuntimePromptPolicyModelDefaultsToManifest(
  manifest: CompiledRuntimeManifest,
  promptPolicy: RuntimePromptPolicy,
): CompiledRuntimeManifest {
  return {
    ...manifest,
    graph: {
      ...manifest.graph,
      nodes: manifest.graph.nodes.map((node) => {
        if (node.kind !== "agent") {
          return node;
        }

        const role = node.config["role"];

        if (role === null || typeof role !== "object") {
          return node;
        }

        const roleConfig = role as Record<string, unknown> & { kind?: AgentRoleKind | undefined };
        const template =
          (roleConfig.kind === undefined ? undefined : promptPolicy.agentClassTemplates[roleConfig.kind])
          ?? promptPolicy.agentClassTemplates.custom;

        if (template === undefined) {
          return node;
        }

        const defaults = template.modelDefaults;
        const tenantOwnedRoleConfig = omitPlatformModelFields(roleConfig);

        return {
          ...node,
          config: {
            ...node.config,
            role: {
              ...tenantOwnedRoleConfig,
              defaultModelTier: defaults.text.modelTier,
              modelProvider: defaults.text.provider,
              ...(defaults.text.modelId !== undefined ? { modelId: defaults.text.modelId } : {}),
              realtimeProvider: defaults.realtime.provider,
              ...(defaults.realtime.modelId !== undefined ? { realtimeModelId: defaults.realtime.modelId } : {}),
            },
          },
        };
      }),
    },
  };
}

function omitPlatformModelFields(roleConfig: Record<string, unknown>) {
  const result = { ...roleConfig };
  delete result["defaultModelTier"];
  delete result["modelProvider"];
  delete result["modelId"];
  delete result["realtimeProvider"];
  delete result["realtimeModelId"];
  return result;
}
