import type {
  SandwichTextModelProvider,
  TextModelProviderId,
} from "@zara/core";
import type { SandboxTextPromptPolicy } from "./sandbox-text-model-prompts";

interface ProviderAvailability {
  configured: boolean;
  missingEnv: string[];
}

type ProviderMap = Record<TextModelProviderId, SandwichTextModelProvider>;

interface SandboxTextModelRouterProviderOptions {
  getPromptPolicy?: (() => SandboxTextPromptPolicy | Promise<SandboxTextPromptPolicy>) | undefined;
}

export class SandboxTextModelRouterProvider implements SandwichTextModelProvider {
  readonly availability: ProviderAvailability;

  constructor(
    private readonly providers: ProviderMap,
    private readonly options: SandboxTextModelRouterProviderOptions = {},
  ) {
    this.availability = resolveRouterAvailability(providers);
  }

  getProviderAvailability(providerId: TextModelProviderId): ProviderAvailability {
    return getProviderAvailability(this.providers[providerId]) ?? {
      configured: true,
      missingEnv: [],
    };
  }

  async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
    const effectiveInput = await applyPromptPolicyModelDefaults(input, this.options.getPromptPolicy);
    const providerId = effectiveInput.activeAgent.modelProvider ?? "openai";
    const provider = this.providers[providerId];
    const availability = this.getProviderAvailability(providerId);

    if (availability.configured === false) {
      throw new Error(
        `${formatProviderName(providerId)} text model is not configured. Missing: ${availability.missingEnv.join(", ")}.`,
      );
    }

    yield* provider.streamText(effectiveInput);
  }
}

async function applyPromptPolicyModelDefaults(
  input: Parameters<SandwichTextModelProvider["streamText"]>[0],
  getPromptPolicy: SandboxTextModelRouterProviderOptions["getPromptPolicy"],
): Promise<Parameters<SandwichTextModelProvider["streamText"]>[0]> {
  const promptPolicy = await getPromptPolicy?.();
  const template = promptPolicy?.agentClassTemplates[input.activeAgent.kind]
    ?? promptPolicy?.agentClassTemplates.custom;
  const defaults = template?.modelDefaults;

  if (defaults === undefined || input.activeAgent.modelProvider !== undefined) {
    return input;
  }

  return {
    ...input,
    tier: defaults.text.modelTier,
    activeAgent: {
      ...input.activeAgent,
      defaultModelTier: defaults.text.modelTier,
      modelProvider: defaults.text.provider,
      ...(defaults.text.modelId !== undefined ? { modelId: defaults.text.modelId } : {}),
      realtimeProvider: input.activeAgent.realtimeProvider ?? defaults.realtime.provider,
      ...(input.activeAgent.realtimeModelId !== undefined
        ? { realtimeModelId: input.activeAgent.realtimeModelId }
        : defaults.realtime.modelId !== undefined
          ? { realtimeModelId: defaults.realtime.modelId }
          : {}),
    },
  };
}

function resolveRouterAvailability(providers: ProviderMap): ProviderAvailability {
  const availabilityEntries = Object.values(providers).map(getProviderAvailability);
  const atLeastOneConfigured = availabilityEntries.some((availability) =>
    availability === undefined || availability.configured,
  );

  return {
    configured: atLeastOneConfigured,
    missingEnv: atLeastOneConfigured
      ? []
      : [...new Set(availabilityEntries.flatMap((availability) => availability?.missingEnv ?? []))],
  };
}

function getProviderAvailability(provider: SandwichTextModelProvider): ProviderAvailability | undefined {
  return (provider as { availability?: ProviderAvailability | undefined }).availability;
}

function formatProviderName(providerId: TextModelProviderId) {
  switch (providerId) {
    case "google-gemini":
      return "Gemini";
    case "openai":
      return "OpenAI";
  }
}
