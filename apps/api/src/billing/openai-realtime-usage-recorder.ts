import type { ProviderUsageRecordingRepository, ProviderUsageResult } from "./provider-usage-recording.repository";

interface RealtimeUsageScope {
  connectionId?: string | null;
  organizationId: string;
  sessionId: string;
  externalScopeId: string | null;
  model: string;
  transcriptionModel?: string;
}

interface ObservedRealtimeUsage {
  id: string;
  model: string;
  occurredAt: string;
  result?: Omit<ProviderUsageResult, "occurredAt">;
}

/** Only the authenticated provider transport may supply these messages. */
export class OpenAiRealtimeUsageRecorder {
  private pending = 0;
  private tail: Promise<void> = Promise.resolve();
  private providerSessionId: string | null = null;
  private failed = false;

  constructor(private readonly repository: ProviderUsageRecordingRepository,
    private readonly scope: RealtimeUsageScope,
    private readonly now = () => new Date().toISOString()) {}

  record(raw: string): Promise<void> {
    try {
      const event = this.parse(raw);
      if (event === undefined) return Promise.resolve();
      if (this.pending >= 128) throw new Error("Realtime usage queue is full.");
      this.pending += 1;
      const write = this.tail.then(() => this.persist(event));
      this.tail = write.then(() => { this.pending -= 1; }, () => { this.pending -= 1; this.failed = true; });
      return write;
    } catch (error) {
      this.failed = true;
      return Promise.reject(error);
    }
  }

  async drain() {
    await this.tail;
    if (this.failed) throw new Error("Realtime usage capture is incomplete.");
    return { providerSessionId: this.providerSessionId };
  }

  private async persist(event: ObservedRealtimeUsage) {
    const request = await this.repository.beginObserved({ ...this.scope, model: event.model,
      provider: "openai", occurredAt: event.occurredAt }, event.id);
    if (event.result !== undefined) {
      await this.repository.complete(this.scope.organizationId, request.id, { ...event.result, occurredAt: request.occurredAt });
    }
  }

  // Copy only small usage fields before queueing. Never retain audio or transcript payloads.
  private parse(raw: string): ObservedRealtimeUsage | undefined {
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    if (message?.type === "session.created") {
      const id = message.session?.id;
      if (typeof id !== "string" || !id.trim() || id.length > 512
        || (this.providerSessionId !== null && this.providerSessionId !== id)) {
        throw new Error("Invalid Realtime provider session identity.");
      }
      this.providerSessionId = id;
      return;
    }
    if (message?.type === "conversation.item.input_audio_transcription.completed"
      || message?.type === "conversation.item.input_audio_transcription.failed") {
      return this.parseTranscription(message);
    }
    if (message?.type !== "response.created" && message?.type !== "response.done") return;
    const response = message.response;
    if (typeof response?.id !== "string" || !response.id.trim() || response.id.length > 512) {
      throw new Error("Invalid Realtime usage identity.");
    }
    const event = { id: `realtime-response:${response.id}`, model: this.scope.model, occurredAt: this.now() };
    const usage = response.usage;
    const breakdown = Object.fromEntries(Object.entries({
      inputTextTokens: usage?.input_token_details?.text_tokens,
      inputAudioTokens: usage?.input_token_details?.audio_tokens,
      inputImageTokens: usage?.input_token_details?.image_tokens,
      cachedInputTokens: usage?.input_token_details?.cached_tokens,
      cachedInputTextTokens: usage?.input_token_details?.cached_tokens_details?.text_tokens,
      cachedInputAudioTokens: usage?.input_token_details?.cached_tokens_details?.audio_tokens,
      cachedInputImageTokens: usage?.input_token_details?.cached_tokens_details?.image_tokens,
      outputTextTokens: usage?.output_token_details?.text_tokens,
      outputAudioTokens: usage?.output_token_details?.audio_tokens,
    }).filter((entry): entry is [string, number] => entry[1] !== undefined));
    if (message.type === "response.done" && usage != null
      && ["completed", "cancelled", "failed", "incomplete"].includes(response.status)
      && Object.values(breakdown).every(value => Number.isSafeInteger(value) && value >= 0)
      && [usage.input_tokens, usage.output_tokens, usage.total_tokens]
        .every(value => Number.isSafeInteger(value) && value >= 0)
      && usage.input_tokens + usage.output_tokens === usage.total_tokens) {
      return { ...event, result: {
        providerRequestId: response.id,
        totals: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, requestCount: 1 },
        responseStatus: response.status,
        breakdown,
      } };
    }
    return event;
  }

  private parseTranscription(message: Record<string, unknown>): ObservedRealtimeUsage {
    if (typeof message.item_id !== "string" || !message.item_id.trim() || message.item_id.length > 512
      || !isCount(message.content_index)) throw new Error("Invalid Realtime transcription identity.");
    const model = this.scope.transcriptionModel;
    if (!model?.trim()) throw new Error("Realtime transcription model is missing.");
    const providerSessionId = this.providerSessionId;
    if (providerSessionId === null) throw new Error("Realtime provider session identity is missing.");
    const event = { id: `realtime-transcription:${JSON.stringify([providerSessionId, message.item_id, message.content_index])}`,
      model, occurredAt: this.now() };
    if (message.type === "conversation.item.input_audio_transcription.failed") return event;
    const usage = object(message.usage);
    if (usage.type === "duration" && typeof usage.seconds === "number" && Number.isFinite(usage.seconds)
      && usage.seconds >= 0) {
      return { ...event, result: { providerRequestId: event.id, sourceKind: "realtime_transcription",
        totals: { transcriptionRequestCount: 1 },
        transcription: { providerSessionId, itemId: message.item_id, contentIndex: message.content_index,
          usage: { type: "duration", seconds: usage.seconds } },
      } };
    }
    if (usage.type !== "tokens" || !isCount(usage.input_tokens) || !isCount(usage.output_tokens)
      || !isCount(usage.total_tokens) || usage.input_tokens + usage.output_tokens !== usage.total_tokens) return event;
    if (usage.input_token_details !== undefined && (usage.input_token_details === null
      || typeof usage.input_token_details !== "object" || Array.isArray(usage.input_token_details))) return event;
    const details = object(usage.input_token_details);
    if ([details.audio_tokens, details.text_tokens].some(value => value !== undefined && !isCount(value))) return event;
    if ((isCount(details.audio_tokens) ? details.audio_tokens : 0)
      + (isCount(details.text_tokens) ? details.text_tokens : 0) > usage.input_tokens) return event;
    return { ...event, result: { providerRequestId: event.id, sourceKind: "realtime_transcription",
      totals: { transcriptionRequestCount: 1 },
      transcription: { providerSessionId, itemId: message.item_id, contentIndex: message.content_index,
        usage: { type: "tokens", input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
          total_tokens: usage.total_tokens,
          ...(usage.input_token_details === undefined ? {} : { input_token_details: {
            ...(isCount(details.audio_tokens) ? { audio_tokens: details.audio_tokens } : {}),
            ...(isCount(details.text_tokens) ? { text_tokens: details.text_tokens } : {}),
          } }),
        },
      },
    } };
  }
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
