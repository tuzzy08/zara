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

import { ConnectorToolsService } from "../integrations/connector-tools.service";
import type { IntegrationProvider } from "../integrations/integrations.models";
import { WebhookHttpToolsService } from "../integrations/webhook-http-tools.service";

export const liveSandboxTextModelProviderToken = "LIVE_SANDBOX_TEXT_MODEL_PROVIDER";
export const liveSandboxTtsProviderToken = "LIVE_SANDBOX_TTS_PROVIDER";
export const liveSandboxSttProviderToken = "LIVE_SANDBOX_STT_PROVIDER";
export const liveSandboxToolRegistryToken = "LIVE_SANDBOX_TOOL_REGISTRY";
export const liveSandboxIntentClassifierProviderToken = "LIVE_SANDBOX_INTENT_CLASSIFIER_PROVIDER";

export interface LiveSandboxSttProvider {
  readonly providerId?: "assemblyai-streaming" | "cartesia-ink-2" | undefined;
  readonly availability?: LiveSandboxProviderAvailability | undefined;
  createStreamingSession?: ((input: {
    sampleRateHz: number;
    config?: LiveSandboxSttStreamingConfiguration | undefined;
    onPartial?: ((event: LiveSandboxSttTranscriptEvent) => void) | undefined;
    onFinal: (event: LiveSandboxSttTranscriptEvent) => void;
    onError?: ((error: Error) => void) | undefined;
    onTelemetry?: ((event: LiveSandboxSttTelemetryEvent) => void) | undefined;
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

export interface LiveSandboxSttTelemetryEvent {
  event: "turn.start" | "turn.update" | "turn.eager_end" | "turn.resume" | "turn.end";
  transcript?: string | undefined;
  requestId?: string | undefined;
}

export interface LiveSandboxSttStreamingConfiguration {
  languageCode?: string | undefined;
  keytermsPrompt?: string[] | undefined;
  agentContext?: string | undefined;
  minTurnSilenceMs?: number | undefined;
  maxTurnSilenceMs?: number | undefined;
  continuousPartials?: boolean | undefined;
}

export interface LiveSandboxSttStreamingSession {
  appendAudioFrame(audioBase64: string): void;
  forceEndpoint(): void;
  terminate(): void;
  updateConfiguration(config: LiveSandboxSttStreamingConfiguration): void;
  close(): void;
}

export interface LiveSandboxProviderAvailability {
  configured: boolean;
  missingEnv: string[];
}

export interface LiveSandboxToolExecutionResult {
  status?: "completed" | "partial" | undefined;
  summary: string;
  output: Record<string, unknown>;
  safeOutput?: Record<string, unknown> | undefined;
  durationMs?: number | undefined;
}

export interface LiveSandboxToolRegistry {
  execute(input: {
    callSessionId: string;
    manifest: CompiledRuntimeManifest;
    binding: CompiledRuntimeToolBinding;
    toolCallId: string;
    toolAssignmentId: string;
    arguments: Record<string, unknown>;
    idempotencyKey: string;
    transcript: string;
    actorUserId: string;
    workspaceId: string;
  }): Promise<LiveSandboxToolExecutionResult>;
}

@Injectable()
export class UnavailableLiveSandboxTextModelProvider implements SandwichTextModelProvider {
  readonly availability: LiveSandboxProviderAvailability;

  private readonly providerName: string;

  constructor(input?: {
    providerName?: string | undefined;
    missingEnv?: string[] | undefined;
  }) {
    this.providerName = input?.providerName ?? "Live sandbox";
    this.availability = {
      configured: false,
      missingEnv: input?.missingEnv ?? ["OPENAI_API_KEY"],
    };
  }

  streamText(input: {
    manifest: CompiledRuntimeManifest;
    activeRole: VoiceAgentRole;
    transcript: string;
    tier: "rules" | "cheap" | "standard" | "sota";
    context: ModelRoutingContext;
  }) {
    void input;
    const providerName = this.providerName;

    return {
      [Symbol.asyncIterator]() {
        return {
          next() {
            return Promise.reject(new Error(`${providerName} text model is not configured.`));
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
  readonly providerId: "assemblyai-streaming" | "cartesia-ink-2";
  readonly availability = {
    configured: false,
    missingEnv: [] as string[],
  };

  constructor(providerId: "assemblyai-streaming" | "cartesia-ink-2" = "assemblyai-streaming") {
    this.providerId = providerId;
    this.availability.missingEnv = providerId === "cartesia-ink-2" ? ["CARTESIA_API_KEY"] : ["ASSEMBLYAI_API_KEY"];
  }

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
  constructor(
    private readonly webhookHttpToolsService?: WebhookHttpToolsService,
    private readonly connectorToolsService?: ConnectorToolsService,
  ) {}

  async execute(input: {
    callSessionId: string;
    manifest: CompiledRuntimeManifest;
    binding: CompiledRuntimeToolBinding;
    toolCallId: string;
    toolAssignmentId: string;
    arguments: Record<string, unknown>;
    idempotencyKey: string;
    transcript: string;
    actorUserId: string;
    workspaceId: string;
  }): Promise<LiveSandboxToolExecutionResult> {
    const request = input.binding.request;

    if (request === undefined) {
      return this.executeConnectorTool(input);
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
      throw createHttpToolExecutionError(input.binding.toolId, response.status, responseBody);
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

  private async executeConnectorTool(input: {
    callSessionId: string;
    manifest: CompiledRuntimeManifest;
    binding: CompiledRuntimeToolBinding;
    toolCallId: string;
    toolAssignmentId: string;
    arguments: Record<string, unknown>;
    idempotencyKey: string;
    transcript: string;
    actorUserId: string;
    workspaceId: string;
  }): Promise<LiveSandboxToolExecutionResult> {
    const provider = resolveConnectorProvider(input.binding.connector);

    if (
      provider === undefined
      || input.binding.integrationConnectionId === undefined
      || this.connectorToolsService === undefined
    ) {
      throw new Error(`Live sandbox tool '${input.binding.toolId}' is missing request metadata.`);
    }

    const output = await this.connectorToolsService.executeTool(
      input.manifest.tenantId,
      provider,
      input.binding.toolId,
      {
        connectionId: input.binding.integrationConnectionId,
        idempotencyKey: input.idempotencyKey,
        input: input.arguments,
      },
    );

    return {
      summary: `Executed ${input.binding.toolName}.`,
      output: normalizeConnectorToolOutput(output),
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

function resolveConnectorProvider(connector: string): Exclude<IntegrationProvider, "webhook-http"> | undefined {
  return connector === "webhook-http" || !isConnectorProvider(connector) ? undefined : connector;
}

function isConnectorProvider(connector: string): connector is Exclude<IntegrationProvider, "webhook-http"> {
  return [
    "zendesk",
    "hubspot",
    "google-workspace",
    "notion",
    "salesforce",
    "slack",
    "microsoft-365",
    "intercom",
    "shopify",
    "stripe",
    "confluence",
    "sharepoint",
    "freshdesk",
    "salesforce-knowledge",
  ].includes(connector);
}

function normalizeConnectorToolOutput(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : { value };
}

function createHttpToolExecutionError(
  toolId: string,
  statusCode: number,
  responseBody: Record<string, unknown> | string,
) {
  const responseExcerpt = summarizeProviderErrorBody(responseBody);
  const error = new Error(
    responseExcerpt.length > 0
      ? `Live sandbox tool '${toolId}' returned HTTP ${statusCode}: ${responseExcerpt}`
      : `Live sandbox tool '${toolId}' returned HTTP ${statusCode}.`,
  ) as Error & { statusCode: number };

  error.statusCode = statusCode;
  return error;
}

function summarizeProviderErrorBody(responseBody: Record<string, unknown> | string) {
  const rawSummary =
    typeof responseBody === "string"
      ? responseBody
      : JSON.stringify(redactProviderErrorRecord(responseBody, 0));

  return rawSummary
    .replace(/\b(password|token|api key)\s*[:=]\s*[^\s",}]+/gi, "$1=[redacted-secret]")
    .slice(0, 300);
}

function redactProviderErrorRecord(record: Record<string, unknown>, depth: number): Record<string, unknown> {
  if (depth > 2) {
    return { truncated: true };
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      isSensitiveProviderErrorKey(key) ? "[redacted-secret]" : redactProviderErrorValue(value, depth + 1),
    ]),
  );
}

function redactProviderErrorValue(value: unknown, depth: number): unknown {
  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => redactProviderErrorValue(item, depth + 1));
  }

  if (typeof value === "object" && value !== null) {
    return redactProviderErrorRecord(value as Record<string, unknown>, depth + 1);
  }

  return value;
}

function isSensitiveProviderErrorKey(key: string) {
  const normalized = key.toLowerCase();
  return ["authorization", "auth", "token", "secret", "password", "api_key", "apikey"].some((fragment) =>
    normalized.includes(fragment));
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
