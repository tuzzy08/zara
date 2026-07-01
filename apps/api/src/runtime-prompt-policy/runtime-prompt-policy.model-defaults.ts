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
        const hasExplicitTextProvider = typeof roleConfig["modelProvider"] === "string";

        return {
          ...node,
          config: {
            ...node.config,
            role: {
              ...roleConfig,
              ...(hasExplicitTextProvider ? {} : { defaultModelTier: defaults.text.modelTier }),
              modelProvider: roleConfig["modelProvider"] ?? defaults.text.provider,
              ...(resolveString(roleConfig["modelId"]) !== undefined
                ? { modelId: resolveString(roleConfig["modelId"]) }
                : defaults.text.modelId !== undefined
                  ? { modelId: defaults.text.modelId }
                  : {}),
              realtimeProvider: roleConfig["realtimeProvider"] ?? defaults.realtime.provider,
              ...(resolveString(roleConfig["realtimeModelId"]) !== undefined
                ? { realtimeModelId: resolveString(roleConfig["realtimeModelId"]) }
                : defaults.realtime.modelId !== undefined
                  ? { realtimeModelId: defaults.realtime.modelId }
                  : {}),
            },
          },
        };
      }),
    },
  };
}

function resolveString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
