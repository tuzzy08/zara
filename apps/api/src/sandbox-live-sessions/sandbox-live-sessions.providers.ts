import { Injectable } from "@nestjs/common";
import type {
  CompiledRuntimeToolBinding,
  CompiledRuntimeManifest,
  ModelRoutingContext,
  SandwichTextModelProvider,
  SandwichTtsProvider,
  SandwichTtsResult,
  VoiceAgentRole,
} from "@zara/core";

export const liveSandboxTextModelProviderToken = "LIVE_SANDBOX_TEXT_MODEL_PROVIDER";
export const liveSandboxTtsProviderToken = "LIVE_SANDBOX_TTS_PROVIDER";
export const liveSandboxSttProviderToken = "LIVE_SANDBOX_STT_PROVIDER";
export const liveSandboxToolRegistryToken = "LIVE_SANDBOX_TOOL_REGISTRY";

export interface LiveSandboxSttProvider {
  transcribeTurn(input: {
    audioFramesBase64: string[];
    sampleRateHz: number;
    onPartial?: ((event: {
      transcript: string;
      confidence: number;
      language?: string | undefined;
    }) => void) | undefined;
  }): Promise<{
    transcript: string;
    confidence: number;
    language: string;
  }>;
}

export interface LiveSandboxToolExecutionResult {
  summary: string;
  output: Record<string, unknown>;
  durationMs?: number | undefined;
}

export interface LiveSandboxToolRegistry {
  execute(input: {
    callSessionId: string;
    manifest: CompiledRuntimeManifest;
    binding: CompiledRuntimeToolBinding;
    transcript: string;
    actorUserId: string;
    workspaceId: string;
  }): Promise<LiveSandboxToolExecutionResult>;
}

@Injectable()
export class UnavailableLiveSandboxTextModelProvider implements SandwichTextModelProvider {
  streamText(input: {
    manifest: CompiledRuntimeManifest;
    activeRole: VoiceAgentRole;
    transcript: string;
    tier: "rules" | "cheap" | "standard" | "sota";
    context: ModelRoutingContext;
  }) {
    void input;

    return {
      [Symbol.asyncIterator]() {
        return {
          next() {
            return Promise.reject(new Error("Live sandbox text model is not configured."));
          },
        } satisfies AsyncIterator<string>;
      },
    } satisfies AsyncIterable<string>;
  }
}

@Injectable()
export class UnavailableLiveSandboxTtsProvider implements SandwichTtsProvider {
  async synthesize(): Promise<SandwichTtsResult> {
    throw new Error("Live sandbox TTS is not configured.");
  }
}

@Injectable()
export class UnavailableLiveSandboxSttProvider implements LiveSandboxSttProvider {
  async transcribeTurn(): Promise<{
    transcript: string;
    confidence: number;
    language: string;
  }> {
    throw new Error("Live sandbox STT is not configured.");
  }
}

@Injectable()
export class DefaultLiveSandboxToolRegistry implements LiveSandboxToolRegistry {
  async execute(input: {
    callSessionId: string;
    manifest: CompiledRuntimeManifest;
    binding: CompiledRuntimeToolBinding;
    transcript: string;
    actorUserId: string;
    workspaceId: string;
  }): Promise<LiveSandboxToolExecutionResult> {
    const request = input.binding.request;

    if (request === undefined) {
      throw new Error(`Live sandbox tool '${input.binding.toolId}' is missing request metadata.`);
    }

    if (looksLikeSecretReference(request.authToken)) {
      throw new Error(`Live sandbox tool '${input.binding.toolId}' is missing a resolved credential.`);
    }

    const requestUrl = interpolateTemplate(request.url, input);
    const requestHeaders = new Headers();

    for (const header of request.headers) {
      requestHeaders.set(header.name, interpolateTemplate(header.value, input));
    }

    if (request.authToken.trim().length > 0 && !requestHeaders.has("authorization")) {
      requestHeaders.set("authorization", `Bearer ${interpolateTemplate(request.authToken, input)}`);
    }

    const body =
      request.bodyTemplate !== undefined
        ? interpolateTemplate(request.bodyTemplate, input)
        : undefined;

    const response = await fetch(requestUrl, {
      method: request.method,
      headers: requestHeaders,
      ...(body !== undefined ? { body } : {}),
    });

    const responseText = await response.text();
    const responseBody = parseResponseBody(responseText);

    if (!response.ok) {
      throw new Error(
        `Live sandbox tool '${input.binding.toolId}' returned HTTP ${response.status}.`,
      );
    }

    return {
      summary: `Executed ${input.binding.toolName} with HTTP ${response.status}.`,
      output: {
        status: response.status,
        ok: response.ok,
        body: responseBody,
      },
    };
  }
}

function looksLikeSecretReference(value: string) {
  const trimmed = value.trim();

  return trimmed.startsWith("secret://") || trimmed.includes("{{secrets.");
}

function interpolateTemplate(
  template: string,
  input: {
    callSessionId: string;
    manifest: CompiledRuntimeManifest;
    transcript: string;
    actorUserId: string;
    workspaceId: string;
  },
) {
  return template
    .replaceAll("{{tenant.id}}", input.manifest.tenantId)
    .replaceAll("{{workspace.id}}", input.workspaceId)
    .replaceAll("{{call.id}}", input.callSessionId)
    .replaceAll("{{turn.transcript}}", input.transcript)
    .replaceAll("{{actor.id}}", input.actorUserId);
}

function parseResponseBody(value: string): Record<string, unknown> | string {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return value;
  }
}
