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

import { WebhookHttpToolsService } from "../integrations/webhook-http-tools.service";

export const liveSandboxTextModelProviderToken = "LIVE_SANDBOX_TEXT_MODEL_PROVIDER";
export const liveSandboxTtsProviderToken = "LIVE_SANDBOX_TTS_PROVIDER";
export const liveSandboxSttProviderToken = "LIVE_SANDBOX_STT_PROVIDER";
export const liveSandboxToolRegistryToken = "LIVE_SANDBOX_TOOL_REGISTRY";

export interface LiveSandboxSttProvider {
  readonly availability?: LiveSandboxProviderAvailability | undefined;
  createStreamingSession?: ((input: {
    sampleRateHz: number;
    onPartial?: ((event: LiveSandboxSttTranscriptEvent) => void) | undefined;
    onFinal: (event: LiveSandboxSttTranscriptEvent) => void;
    onError?: ((error: Error) => void) | undefined;
  }) => LiveSandboxSttStreamingSession) | undefined;
  transcribeTurn(input: {
    audioFramesBase64: string[];
    sampleRateHz: number;
    onPartial?: ((event: LiveSandboxSttTranscriptEvent) => void) | undefined;
  }): Promise<{
    transcript: string;
    confidence: number;
    language: string;
  }>;
}

export interface LiveSandboxSttTranscriptEvent {
  transcript: string;
  confidence: number;
  language?: string | undefined;
}

export interface LiveSandboxSttStreamingSession {
  appendAudioFrame(audioBase64: string): void;
  forceEndpoint?: (() => void) | undefined;
  close(): void;
}

export interface LiveSandboxProviderAvailability {
  configured: boolean;
  missingEnv: string[];
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
  readonly availability = {
    configured: false,
    missingEnv: ["OPENAI_API_KEY"],
  };

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
  readonly availability = {
    configured: false,
    missingEnv: ["CARTESIA_API_KEY"],
  };

  async synthesize(): Promise<SandwichTtsResult> {
    throw new Error("Live sandbox TTS is not configured.");
  }
}

@Injectable()
export class UnavailableLiveSandboxSttProvider implements LiveSandboxSttProvider {
  readonly availability = {
    configured: false,
    missingEnv: ["ASSEMBLYAI_API_KEY"],
  };

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
  constructor(private readonly webhookHttpToolsService?: WebhookHttpToolsService) {}

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

    const authToken = await this.resolveAuthToken(input);

    if (looksLikeSecretReference(authToken)) {
      throw new Error(`Live sandbox tool '${input.binding.toolId}' is missing a resolved credential.`);
    }

    const requestUrl = interpolateTemplate(request.url, input);
    const requestHeaders = new Headers();

    for (const header of request.headers) {
      requestHeaders.set(header.name, interpolateTemplate(header.value, input));
    }

    if (authToken.trim().length > 0 && !requestHeaders.has("authorization")) {
      requestHeaders.set("authorization", `Bearer ${interpolateTemplate(authToken, input)}`);
    }

    const body =
      request.bodyTemplate !== undefined
        ? interpolateTemplate(request.bodyTemplate, input)
        : undefined;

    const executionPolicy = await this.resolveExecutionPolicy(input);
    const response = await fetchWithRetry(
      requestUrl,
      {
        method: request.method,
        headers: requestHeaders,
        ...(body !== undefined ? { body } : {}),
      },
      executionPolicy,
      input.binding.toolId,
    );

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

  private async resolveAuthToken(input: {
    manifest: CompiledRuntimeManifest;
    binding: CompiledRuntimeToolBinding;
  }) {
    const authToken = input.binding.request?.authToken ?? "";

    if (!authToken.startsWith("secret://webhook-http-tools/")) {
      return authToken;
    }

    if (this.webhookHttpToolsService === undefined) {
      return authToken;
    }

    return this.webhookHttpToolsService.resolveWebhookAuthToken({
      organizationId: input.manifest.tenantId,
      toolId: input.binding.toolId,
      authTokenReference: authToken,
    });
  }

  private async resolveExecutionPolicy(input: {
    manifest: CompiledRuntimeManifest;
    binding: CompiledRuntimeToolBinding;
  }): Promise<WebhookHttpExecutionPolicy> {
    const defaultPolicy = {
      timeoutMs: 5_000,
      retryPolicy: {
        maxAttempts: 1,
        backoffMs: 0,
      },
    };

    if (this.webhookHttpToolsService === undefined) {
      return defaultPolicy;
    }

    return (
      (await this.webhookHttpToolsService.getExecutionPolicy({
        organizationId: input.manifest.tenantId,
        toolId: input.binding.toolId,
      })) ?? defaultPolicy
    );
  }
}

interface WebhookHttpExecutionPolicy {
  timeoutMs: number;
  retryPolicy: {
    maxAttempts: number;
    backoffMs: number;
  };
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

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  policy: WebhookHttpExecutionPolicy,
  toolId: string,
) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= policy.retryPolicy.maxAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, init, policy.timeoutMs, toolId);

      if (response.ok || response.status < 500 || attempt === policy.retryPolicy.maxAttempts) {
        return response;
      }
    } catch (error) {
      lastError = error;

      if (attempt === policy.retryPolicy.maxAttempts) {
        throw error;
      }
    }

    if (policy.retryPolicy.backoffMs > 0) {
      await sleep(policy.retryPolicy.backoffMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Webhook HTTP request failed.");
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  toolId: string,
) {
  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: abortController.signal,
    });
  } catch (error) {
    if (abortController.signal.aborted) {
      throw new Error(`Live sandbox tool '${toolId}' timed out after ${timeoutMs}ms.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(durationMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
