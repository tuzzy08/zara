export type OpenAiRealtimeResponseMode =
  | "normal"
  | "tool"
  | "handoff"
  | "incomplete"
  | "protocol_error"
  | "rate_limit"
  | "output_pressure"
  | "provider_close";

export type OpenAiRealtimeTiming =
  | { mode: "immediate" }
  | { mode: "delayed"; delayMs: number }
  | { mode: "faster_than_realtime"; factor: number }
  | { mode: "stalled" };

export interface OpenAiRealtimeScenario {
  callFingerprint: string;
  responseMode: OpenAiRealtimeResponseMode;
  timing: OpenAiRealtimeTiming;
  responseSequence?: number | undefined;
  turnDetectionSilenceMs?: number | undefined;
  toolName?: string | undefined;
  handoffTargetAgentId?: string | undefined;
}

export type OpenAiRealtimeServerEvent = Record<string, unknown> & { type: string };

export async function createOpenAiRealtimeScenarioEvents(
  scenario: OpenAiRealtimeScenario,
): Promise<OpenAiRealtimeServerEvent[]> {
  const identity = `${scenario.callFingerprint}-${scenario.responseSequence ?? 1}`;
  const itemId = `item-${identity}`;
  const responseId = `response-${identity}`;
  const baseEvents: OpenAiRealtimeServerEvent[] = [
    { type: "input_audio_buffer.speech_started", item_id: itemId, audio_start_ms: 0 },
    { type: "input_audio_buffer.speech_stopped", item_id: itemId, audio_end_ms: 400 },
    { type: "input_audio_buffer.committed", item_id: itemId },
    {
      type: "conversation.item.input_audio_transcription.completed",
      item_id: itemId,
      transcript: `[simulated caller turn ${scenario.callFingerprint}]`,
    },
  ];

  if (scenario.responseMode === "provider_close") {
    return baseEvents;
  }
  if (scenario.responseMode === "protocol_error") {
    return [...baseEvents, { type: "simulator.invalid_event", fingerprint: scenario.callFingerprint }];
  }
  if (scenario.responseMode === "rate_limit") {
    return [...baseEvents, {
      type: "error",
      error: { type: "rate_limit_error", code: "rate_limit_exceeded" },
    }];
  }

  const responseCreated = {
    type: "response.created",
    response: { id: responseId, status: "in_progress" },
  } satisfies OpenAiRealtimeServerEvent;
  if (scenario.responseMode === "tool" || scenario.responseMode === "handoff") {
    const name = scenario.responseMode === "handoff"
      ? scenario.toolName ?? "zara_handoff_to_agent"
      : scenario.toolName ?? "zara_simulated_connector_tool";
    return [
      ...baseEvents,
      responseCreated,
      {
        type: "response.done",
        response: {
          id: responseId,
          status: "completed",
          output: [{
            type: "function_call",
            call_id: `call-${identity}`,
            name,
            arguments: scenario.responseMode === "handoff"
              ? JSON.stringify({
                  targetAgentId: scenario.handoffTargetAgentId ?? "agent-specialist",
                  reason: "simulated_intent",
                })
              : JSON.stringify({ query: "simulated" }),
          }],
        },
      },
    ];
  }
  if (scenario.responseMode === "incomplete") {
    return [
      ...baseEvents,
      responseCreated,
      {
        type: "response.done",
        response: {
          id: responseId,
          status: "incomplete",
          status_details: { type: "incomplete", reason: "max_output_tokens" },
        },
      },
    ];
  }

  const audioPayload = createProviderAudioFingerprint(scenario.callFingerprint);
  const audioDeltas = scenario.responseMode === "output_pressure"
    ? Array.from({ length: 512 }, () => ({
        type: "response.output_audio.delta",
        response_id: responseId,
        item_id: `assistant-${identity}`,
        delta: audioPayload,
      }))
    : Array.from({ length: 30 }, () => ({
        type: "response.output_audio.delta",
        response_id: responseId,
        item_id: `assistant-${identity}`,
        delta: audioPayload,
      }));

  return [
    ...baseEvents,
    responseCreated,
    ...audioDeltas,
    {
      type: "response.output_audio.done",
      response_id: responseId,
      item_id: `assistant-${identity}`,
    },
    {
      type: "response.output_audio_transcript.done",
      response_id: responseId,
      transcript: `[simulated assistant turn ${scenario.callFingerprint}]`,
    },
    {
      type: "response.done",
      response: { id: responseId, status: "completed", output: [] },
    },
  ];
}

export function createProviderAudioFingerprint(callFingerprint: string) {
  const payload = Buffer.alloc(160, 0xff);
  Buffer.from(callFingerprint, "utf8").copy(payload, 0, 0, 120);
  return payload.toString("base64");
}

export async function waitForOpenAiRealtimeEvent(
  timing: OpenAiRealtimeTiming,
  sleep: (delayMs: number) => Promise<void> = delay,
  signal?: AbortSignal,
) {
  if (signal?.aborted === true) return;
  if (timing.mode === "delayed") {
    await waitUntilDelayOrAbort(Math.max(0, timing.delayMs), sleep, signal);
  }
  if (timing.mode === "faster_than_realtime") {
    await waitUntilDelayOrAbort(Math.max(1, Math.round(20 / timing.factor)), sleep, signal);
  }
  if (timing.mode === "stalled") {
    if (signal === undefined) await new Promise<void>(() => undefined);
    else await waitUntilAborted(signal);
  }
}

function delay(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

async function waitUntilDelayOrAbort(
  delayMs: number,
  sleep: (delayMs: number) => Promise<void>,
  signal: AbortSignal | undefined,
) {
  if (signal === undefined) {
    await sleep(delayMs);
    return;
  }
  if (sleep === delay) {
    await abortableDelay(delayMs, signal);
    return;
  }
  await Promise.race([sleep(delayMs), waitUntilAborted(signal)]);
}

function waitUntilAborted(signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

function abortableDelay(delayMs: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, delayMs);
    const cancel = () => {
      clearTimeout(timeout);
      resolve();
    };
    signal.addEventListener("abort", cancel, { once: true });
  });
}
