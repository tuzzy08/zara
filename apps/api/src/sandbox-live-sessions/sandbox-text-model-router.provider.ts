import type {
  SandwichTextModelProvider,
  TextModelProviderId,
} from "@zara/core";

interface ProviderAvailability {
  configured: boolean;
  missingEnv: string[];
}

type ProviderMap = Record<TextModelProviderId, SandwichTextModelProvider>;

export class SandboxTextModelRouterProvider implements SandwichTextModelProvider {
  readonly availability: ProviderAvailability;

  constructor(private readonly providers: ProviderMap) {
    this.availability = resolveRouterAvailability(providers);
  }

  async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
    const providerId = input.activeRole.modelProvider ?? "openai";
    const provider = this.providers[providerId];
    const availability = getProviderAvailability(provider);

    if (availability !== undefined && availability.configured === false) {
      throw new Error(
        `${formatProviderName(providerId)} text model is not configured. Missing: ${availability.missingEnv.join(", ")}.`,
      );
    }

    yield* provider.streamText(input);
  }
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
