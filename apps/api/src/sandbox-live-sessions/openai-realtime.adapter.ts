import { projectRealtimeProviderToolInputSchema, type RealtimeProviderToolDeclaration } from "@zara/core";

export interface OpenAiRealtimeAdapterConfig {
  model: string;
  systemPrompt: string;
  voice?: string | undefined;
  language?: string | undefined;
  speed?: number | undefined;
  tools?: RealtimeProviderToolDeclaration[] | undefined;
  autoCreateResponse?: boolean | undefined;
  outputAudioFormat?: "pcm" | "pcmu" | undefined;
}

export type OpenAiRealtimeEvent =
  | {
      type: "session_ready";
    }
  | {
      type: "tool_call";
      providerCallId: string;
      name: string;
      argumentsJson: string;
    }
  | {
      type: "audio";
      audioBase64: string;
    }
  | {
      type: "input_audio_committed";
      itemId?: string | undefined;
    }
  | {
      type: "input_transcript" | "output_transcript";
      text: string;
      done: boolean;
      itemId?: string | undefined;
    }
  | {
      type: "provider_event";
      eventType: string;
      evidence: Record<string, unknown>;
    };

interface OpenAiServerMessage {
  type?: string | undefined;
  item_id?: string | undefined;
  previous_item_id?: string | undefined;
  call_id?: string | undefined;
  name?: string | undefined;
  arguments?: string | undefined;
  delta?: string | undefined;
  transcript?: string | undefined;
  content_index?: number | undefined;
  audio_start_ms?: number | undefined;
  audio_end_ms?: number | undefined;
  response_id?: string | undefined;
  output_index?: number | undefined;
  item?: {
    type?: string | undefined;
    id?: string | undefined;
    call_id?: string | undefined;
    name?: string | undefined;
    arguments?: string | undefined;
    content?: OpenAiResponseContentPart[] | undefined;
  } | undefined;
  error?: {
    type?: string | undefined;
    code?: string | undefined;
    message?: string | undefined;
    param?: string | undefined;
    event_id?: string | undefined;
  } | undefined;
  response?: {
    id?: string | undefined;
    status?: string | undefined;
    output?: Array<{
      type?: string | undefined;
      id?: string | undefined;
      call_id?: string | undefined;
      name?: string | undefined;
      arguments?: string | undefined;
      content?: OpenAiResponseContentPart[] | undefined;
    }> | undefined;
  } | undefined;
  session?: OpenAiSessionState | undefined;
}

interface OpenAiResponseContentPart {
  type?: string | undefined;
  text?: string | undefined;
  transcript?: string | undefined;
}

interface OpenAiSessionState {
  type?: string | undefined;
  model?: string | undefined;
  instructions?: string | undefined;
  output_modalities?: string[] | undefined;
  modalities?: string[] | undefined;
  tool_choice?: unknown;
  tools?: Array<Record<string, unknown>> | undefined;
  turn_detection?: {
    type?: string | undefined;
    create_response?: boolean | undefined;
    interrupt_response?: boolean | undefined;
  } | null | undefined;
  audio?: {
    input?: {
      format?: OpenAiAudioFormat | undefined;
      transcription?: {
        model?: string | undefined;
        language?: string | undefined;
        delay?: string | undefined;
      } | null | undefined;
      turn_detection?: {
        type?: string | undefined;
        create_response?: boolean | undefined;
        interrupt_response?: boolean | undefined;
      } | null | undefined;
    } | undefined;
    output?: {
      format?: OpenAiAudioFormat | undefined;
      voice?: string | undefined;
      speed?: number | undefined;
    } | undefined;
  } | undefined;
}

interface OpenAiAudioFormat {
  type?: string | undefined;
  rate?: number | undefined;
}

export class OpenAiRealtimeAdapter {
  constructor(private readonly config: OpenAiRealtimeAdapterConfig) {
    if (config.model.trim().length === 0) {
      throw new Error("OpenAI Realtime model is required for realtime voice sessions.");
    }
  }

  createSessionUpdateMessage() {
    return {
      type: "session.update",
      session: {
        type: "realtime",
        model: this.config.model,
        instructions: appendLanguageInstructions(this.config.systemPrompt, this.config.language),
        output_modalities: ["audio"],
        audio: {
          input: {
            format: {
              type: "audio/pcm",
              rate: 24000,
            },
            transcription: {
              model: "gpt-realtime-whisper",
              ...(this.config.language !== undefined ? { language: this.config.language } : {}),
            },
            turn_detection: {
              type: "semantic_vad",
              create_response: this.config.autoCreateResponse ?? true,
              interrupt_response: this.config.autoCreateResponse ?? true,
            },
          },
          output: {
            format: {
              type: this.config.outputAudioFormat === "pcmu" ? "audio/pcmu" : "audio/pcm",
              ...(this.config.outputAudioFormat === "pcmu" ? {} : { rate: 24000 }),
            },
            ...(this.config.voice !== undefined ? { voice: this.config.voice } : {}),
            ...(this.config.speed !== undefined ? { speed: this.config.speed } : {}),
          },
        },
        tool_choice: "auto",
        tools: (this.config.tools ?? []).map((tool) => ({
          type: "function",
          name: tool.name,
          description: tool.description,
          parameters: projectRealtimeProviderToolInputSchema(tool.inputSchema),
        })),
      },
    };
  }

  parseServerMessage(raw: string): OpenAiRealtimeEvent[] {
    const payload = JSON.parse(raw) as OpenAiServerMessage;
    if (payload.type === "session.updated") {
      return [
        {
          type: "session_ready",
        },
        providerEvidence(payload.type, buildSessionUpdatedEvidence(payload)),
      ];
    }

    if (payload.type === "input_audio_buffer.committed") {
      return [
        {
          type: "input_audio_committed",
          ...(payload.item_id !== undefined ? { itemId: payload.item_id } : {}),
        },
        providerEvidence(payload.type, buildProviderEvidence(payload)),
      ];
    }

    if (
      payload.type === "input_audio_buffer.speech_started"
      || payload.type === "input_audio_buffer.speech_stopped"
      || payload.type === "conversation.item.input_audio_transcription.failed"
      || payload.type === "response.cancelled"
      || payload.type === "response.created"
      || payload.type === "conversation.item.truncated"
      || payload.type === "error"
    ) {
      return [providerEvidence(payload.type, buildProviderEvidence(payload))];
    }

    if (payload.type === "response.output_audio.delta" || payload.type === "response.audio.delta") {
      return typeof payload.delta === "string"
        ? [
            {
              type: "audio",
              audioBase64: payload.delta,
            },
          ]
        : [];
    }

    if (
      payload.type === "response.output_audio_transcript.delta"
      || payload.type === "response.audio_transcript.delta"
    ) {
      return typeof payload.delta === "string"
        ? [
            {
              type: "output_transcript",
              text: payload.delta,
              done: false,
            },
          ]
        : [];
    }

    if (
      payload.type === "response.output_audio_transcript.done"
      || payload.type === "response.audio_transcript.done"
    ) {
      return typeof payload.transcript === "string"
        ? [
            {
              type: "output_transcript",
              text: payload.transcript,
              done: true,
            },
          ]
        : [];
    }

    if (
      payload.type === "conversation.item.input_audio_transcription.delta"
      || payload.type === "conversation.item.input_audio_transcription.completed"
    ) {
      const text = payload.type.endsWith(".delta") ? payload.delta : payload.transcript;
      return typeof text === "string"
        ? [
            {
              type: "input_transcript",
              text,
              done: payload.type.endsWith(".completed"),
              ...(payload.item_id !== undefined ? { itemId: payload.item_id } : {}),
            },
            providerEvidence(payload.type, buildProviderEvidence(payload, { text })),
          ]
        : [];
    }

    if (payload.type === "response.output_item.done") {
      return [providerEvidence(payload.type, buildProviderEvidence(payload))];
    }

    if (payload.type === "response.function_call_arguments.done") {
      return [providerEvidence(payload.type, buildProviderEvidence(payload))];
    }

    if (payload.type !== "response.done") {
      return [];
    }

    if (payload.response?.status !== undefined && payload.response.status !== "completed") {
      return [providerEvidence(payload.type, buildProviderEvidence(payload))];
    }

    const toolCallEvents = (payload.response?.output ?? []).flatMap((item) => {
      if (item.type !== "function_call" || item.call_id === undefined || item.name === undefined) {
        return [];
      }

      return {
        type: "tool_call",
        providerCallId: item.call_id,
        name: item.name,
        argumentsJson: item.arguments ?? "{}",
      } satisfies OpenAiRealtimeEvent;
    });

    if (toolCallEvents.length > 0) {
      return toolCallEvents;
    }

    const outputTranscript = extractResponseOutputTranscript(payload);
    if (outputTranscript !== undefined) {
      return [
        {
          type: "output_transcript",
          text: outputTranscript,
          done: true,
        },
        providerEvidence(payload.type, buildProviderEvidence(payload, { outputText: outputTranscript })),
      ];
    }

    return [providerEvidence(payload.type, buildProviderEvidence(payload))];
  }

  createFunctionCallOutputMessage(input: {
    providerCallId: string;
    output: Record<string, unknown>;
  }) {
    return {
      event_id: createClientEventId("function_call_output", input.providerCallId),
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: input.providerCallId,
        output: JSON.stringify(input.output),
      },
    };
  }

  createResponseCreateMessage(input?: {
    providerCallId?: string | undefined;
    instructions?: string | undefined;
  }) {
    const instructions = input?.instructions?.trim();

    return {
      ...(input?.providerCallId !== undefined
        ? { event_id: createClientEventId("response_create", input.providerCallId) }
        : {}),
      type: "response.create",
      ...(instructions !== undefined && instructions.length > 0
        ? {
            response: {
              instructions,
            },
          }
        : {}),
    };
  }
}

function providerEvidence(eventType: string, evidence: Record<string, unknown>): OpenAiRealtimeEvent {
  return {
    type: "provider_event",
    eventType,
    evidence,
  };
}

function buildProviderEvidence(
  payload: OpenAiServerMessage,
  options: {
    text?: string | undefined;
    outputText?: string | undefined;
  } = {},
): Record<string, unknown> {
  const evidence: Record<string, unknown> = {};

  if (payload.item_id !== undefined) {
    evidence.itemId = payload.item_id;
  }

  if (payload.previous_item_id !== undefined) {
    evidence.previousItemId = payload.previous_item_id;
  }

  if (payload.audio_start_ms !== undefined) {
    evidence.audioStartMs = payload.audio_start_ms;
  }

  if (payload.audio_end_ms !== undefined) {
    evidence.audioEndMs = payload.audio_end_ms;
  }

  if (payload.response_id !== undefined) {
    evidence.responseId = payload.response_id;
  }

  if (payload.output_index !== undefined) {
    evidence.outputIndex = payload.output_index;
  }

  if (payload.content_index !== undefined) {
    evidence.contentIndex = payload.content_index;
  }

  if (payload.response?.id !== undefined) {
    evidence.responseId = payload.response.id;
  }

  if (payload.response?.status !== undefined) {
    evidence.status = payload.response.status;
  }

  if (payload.item?.id !== undefined) {
    evidence.itemId = payload.item.id;
  }

  if (payload.call_id !== undefined) {
    evidence.callId = payload.call_id;
  }

  if (payload.name !== undefined) {
    evidence.name = payload.name;
  }

  if (payload.item?.type !== undefined) {
    evidence.itemType = payload.item.type;
  }

  if (payload.item?.call_id !== undefined) {
    evidence.callId = payload.item.call_id;
  }

  if (payload.item?.name !== undefined) {
    evidence.name = payload.item.name;
  }

  if (payload.error?.type !== undefined || payload.error?.code !== undefined) {
    evidence.error = {
      ...(payload.error.type !== undefined ? { type: payload.error.type } : {}),
      ...(payload.error.code !== undefined ? { code: payload.error.code } : {}),
      ...(payload.error.message !== undefined ? { message: redactProviderErrorMessage(payload.error.message) } : {}),
      ...(payload.error.param !== undefined ? { param: payload.error.param } : {}),
      ...(payload.error.event_id !== undefined ? { eventId: payload.error.event_id } : {}),
    };
  }

  if (options.text !== undefined) {
    evidence.textLength = options.text.length;
  }

  if (options.outputText !== undefined) {
    evidence.outputTextLength = options.outputText.length;
  }

  if (payload.type === "response.done") {
    const outputItemTypes = collectResponseOutputItemTypes(payload);
    if (outputItemTypes.length > 0) {
      evidence.outputItemTypes = outputItemTypes;
    }

    const outputContentTypes = collectResponseOutputContentTypes(payload);
    if (outputContentTypes.length > 0) {
      evidence.outputContentTypes = outputContentTypes;
      evidence.audioOutputContentPresent = outputContentTypes.includes("output_audio");
    }
  }

  return evidence;
}

function buildSessionUpdatedEvidence(payload: OpenAiServerMessage): Record<string, unknown> {
  const session = payload.session;
  const input = session?.audio?.input;
  const output = session?.audio?.output;
  const transcription = input?.transcription ?? undefined;
  const turnDetection = input?.turn_detection ?? session?.turn_detection ?? undefined;
  const evidence: Record<string, unknown> = {};

  if (session?.instructions !== undefined) {
    evidence.sessionInstructions = session.instructions;
  }

  if (session?.tool_choice !== undefined) {
    evidence.sessionToolChoice = typeof session.tool_choice === "string"
      ? session.tool_choice
      : stringifyDiagnosticJson(session.tool_choice) ?? String(session.tool_choice);
  }

  const sessionTools = buildSessionToolsEvidence(session?.tools);
  if (sessionTools !== undefined) {
    evidence.sessionToolCount = sessionTools.length;
    const toolNames = sessionTools
      .map((tool) => typeof tool.name === "string" ? tool.name : undefined)
      .filter((name): name is string => name !== undefined && name.length > 0);
    if (toolNames.length > 0) {
      evidence.sessionToolNames = toolNames.join(", ");
    }

    const toolsJson = stringifyDiagnosticJson(sessionTools);
    if (toolsJson !== undefined) {
      evidence.sessionToolsJson = toolsJson;
    }

    evidence.sessionTools = sessionTools;
  }

  if (session?.type !== undefined) {
    evidence.sessionType = session.type;
  }

  if (session?.model !== undefined) {
    evidence.model = session.model;
  }

  const outputModalities = session?.output_modalities ?? session?.modalities;
  if (outputModalities !== undefined) {
    evidence.outputModalities = outputModalities;
  }

  if (input?.format?.type !== undefined) {
    evidence.inputAudioFormatType = input.format.type;
  }

  if (input?.format?.rate !== undefined) {
    evidence.inputAudioRate = input.format.rate;
  }

  evidence.inputTranscriptionConfigured = transcription !== undefined && transcription !== null;

  if (transcription?.model !== undefined) {
    evidence.inputTranscriptionModel = transcription.model;
  }

  if (transcription?.language !== undefined) {
    evidence.inputTranscriptionLanguage = transcription.language;
  }

  if (transcription?.delay !== undefined) {
    evidence.inputTranscriptionDelay = transcription.delay;
  }

  if (turnDetection?.type !== undefined) {
    evidence.inputTurnDetectionType = turnDetection.type;
  }

  if (turnDetection?.create_response !== undefined) {
    evidence.inputTurnDetectionCreateResponse = turnDetection.create_response;
  }

  if (turnDetection?.interrupt_response !== undefined) {
    evidence.inputTurnDetectionInterruptResponse = turnDetection.interrupt_response;
  }

  evidence.audioOutputConfigured = output !== undefined;

  if (output?.format?.type !== undefined) {
    evidence.outputAudioFormatType = output.format.type;
  }

  if (output?.format?.rate !== undefined) {
    evidence.outputAudioRate = output.format.rate;
  }

  if (output?.voice !== undefined) {
    evidence.outputAudioVoice = output.voice;
  }

  if (output?.speed !== undefined) {
    evidence.outputAudioSpeed = output.speed;
  }

  return evidence;
}

function buildSessionToolsEvidence(tools: OpenAiSessionState["tools"]) {
  if (!Array.isArray(tools)) {
    return undefined;
  }

  return tools.map((tool) => {
    const evidence: Record<string, unknown> = {};
    copySessionToolField(evidence, tool, "type");
    copySessionToolField(evidence, tool, "name");
    copySessionToolField(evidence, tool, "description");

    if (tool.parameters !== undefined) {
      evidence.parameters = tool.parameters;
    }

    if (tool.input_schema !== undefined) {
      evidence.inputSchema = tool.input_schema;
    }

    return evidence;
  });
}

function copySessionToolField(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: "type" | "name" | "description",
) {
  const value = source[key];
  if (typeof value === "string" && value.length > 0) {
    target[key] = value;
  }
}

function stringifyDiagnosticJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function extractResponseOutputTranscript(payload: OpenAiServerMessage) {
  const candidates = [
    ...(payload.item?.content ?? []),
    ...(payload.response?.output ?? []).flatMap((item) => item.content ?? []),
  ];
  const parts = candidates
    .map((part) => part.transcript ?? part.text)
    .filter((text): text is string => typeof text === "string" && text.trim().length > 0);

  return parts.length === 0 ? undefined : parts.join(" ");
}

function collectResponseOutputItemTypes(payload: OpenAiServerMessage) {
  return uniqueStrings([
    payload.item?.type,
    ...(payload.response?.output ?? []).map((item) => item.type),
  ]);
}

function collectResponseOutputContentTypes(payload: OpenAiServerMessage) {
  return uniqueStrings([
    ...(payload.item?.content ?? []).map((part) => part.type),
    ...(payload.response?.output ?? []).flatMap((item) => item.content ?? []).map((part) => part.type),
  ]);
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function redactProviderErrorMessage(message: string) {
  return message.length <= 240 ? message : `${message.slice(0, 237)}...`;
}

function createClientEventId(kind: "function_call_output" | "response_create", providerCallId: string) {
  return `zara_${kind}_${providerCallId.replace(/[^a-zA-Z0-9._:-]/g, "_")}`;
}

function appendLanguageInstructions(systemPrompt: string, language: string | undefined) {
  if (language === undefined || language.trim().length === 0) {
    return systemPrompt;
  }

  const normalizedLanguage = language.trim().toLowerCase();
  if (normalizedLanguage === "en" || normalizedLanguage.startsWith("en-")) {
    return [
      systemPrompt,
      "",
      "# Language",
      "- The conversation will be only in English.",
      "- Do not respond in any other language even if the caller uses another language.",
      "- If the caller speaks another language, politely explain that support is limited to English.",
    ].join("\n");
  }

  return [
    systemPrompt,
    "",
    "# Language",
    `- The conversation will be only in ${language}.`,
    `- Do not respond in any language other than ${language}.`,
  ].join("\n");
}
