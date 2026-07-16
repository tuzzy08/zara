import { describe, expect, it } from "vitest";

import type { RealtimeToolDeclaration } from "@zara/core";
import { OpenAiRealtimeAdapter } from "./openai-realtime.adapter";

describe("OpenAiRealtimeAdapter", () => {
  const tool = {
    name: "zara_zendesk_search_tickets_1234abcd",
    toolAssignmentId: "assignment-1",
    toolId: "zendesk.search_tickets",
    label: "Search tickets",
    description: "Search tickets\nRisk: low.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
  } satisfies RealtimeToolDeclaration;

  it("declares Zara tools in the OpenAI Realtime session update", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime",
      systemPrompt: "Configured prompt",
      voice: "coral",
      language: "en",
      tools: [tool],
    });

    expect(adapter.createSessionUpdateMessage()).toEqual({
      type: "session.update",
      session: {
        type: "realtime",
        model: "gpt-realtime",
        instructions: [
          "Configured prompt",
          "",
          "# Language",
          "- The conversation will be only in English.",
          "- Do not respond in any other language even if the caller uses another language.",
          "- If the caller speaks another language, politely explain that support is limited to English.",
        ].join("\n"),
        output_modalities: ["audio"],
        audio: {
          input: {
            format: {
              type: "audio/pcm",
              rate: 24000,
            },
            transcription: {
              model: "gpt-realtime-whisper",
              language: "en",
            },
            turn_detection: {
              type: "semantic_vad",
              create_response: true,
              interrupt_response: true,
            },
          },
          output: {
            format: {
              type: "audio/pcm",
              rate: 24000,
            },
            voice: "coral",
          },
        },
        tool_choice: "auto",
        tools: [
          {
            type: "function",
            name: "zara_zendesk_search_tickets_1234abcd",
            description: "Search tickets\nRisk: low.",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string" },
              },
              required: ["query"],
            },
          },
        ],
      },
    });

    const session = adapter.createSessionUpdateMessage().session as Record<string, unknown>;
    expect(session).not.toHaveProperty("input_audio_format");
    expect(session).not.toHaveProperty("output_audio_format");
    expect(session).not.toHaveProperty("input_audio_transcription");
    expect(session).not.toHaveProperty("turn_detection");
    expect(session).not.toHaveProperty("voice");
  });

  it("projects realtime tool schemas into OpenAI-safe function parameters", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime",
      systemPrompt: "Configured prompt",
      tools: [
        {
          ...tool,
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: [],
            anyOf: [
              { required: ["ticketId"] },
              { required: ["query"] },
            ],
            properties: {
              ticketId: { type: "string" },
              query: { type: "string" },
            },
          },
        },
      ],
    });

    const tools = adapter.createSessionUpdateMessage().session.tools;

    expect(tools?.[0]).toMatchObject({
      parameters: {
        type: "object",
        additionalProperties: false,
        required: [],
        properties: {
          ticketId: { type: "string" },
          query: { type: "string" },
        },
      },
    });
    expect(tools?.[0]?.parameters).not.toHaveProperty("anyOf");
    expect(tools?.[0]?.parameters).not.toHaveProperty("oneOf");
    expect(tools?.[0]?.parameters).not.toHaveProperty("allOf");
  });

  it("can disable provider-created responses when manual orchestration is requested", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime",
      systemPrompt: "Configured prompt",
      autoCreateResponse: false,
    });

    expect(adapter.createSessionUpdateMessage()).toMatchObject({
      session: {
        audio: {
          input: {
            turn_detection: {
              create_response: false,
              interrupt_response: false,
            },
          },
        },
      },
    });
  });

  it("configures native PCMU input and server VAD for PSTN sessions", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime",
      systemPrompt: "Configured prompt",
      inputAudioFormat: "pcmu",
      outputAudioFormat: "pcmu",
      turnDetectionMode: "server_vad",
    });

    expect(adapter.createSessionUpdateMessage()).toMatchObject({
      session: {
        audio: {
          input: {
            format: {
              type: "audio/pcmu",
            },
            turn_detection: {
              type: "server_vad",
              create_response: true,
              interrupt_response: true,
            },
          },
          output: {
            format: {
              type: "audio/pcmu",
            },
          },
        },
      },
    });
    expect(adapter.createSessionUpdateMessage().session.audio.input.format).not.toHaveProperty("rate");
  });

  it("projects the resolved semantic turn policy and normalizes lifecycle events", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime-2.1",
      systemPrompt: "Configured prompt",
      inputAudioFormat: "pcmu",
      outputAudioFormat: "pcmu",
      turnDetection: {
        type: "semantic_vad",
        eagerness: "low",
        createResponse: true,
        interruptResponse: true,
      },
    });

    expect(adapter.createSessionUpdateMessage()).toMatchObject({
      session: {
        audio: {
          input: {
            turn_detection: {
              type: "semantic_vad",
              eagerness: "low",
              create_response: true,
              interrupt_response: true,
            },
          },
        },
      },
    });
    expect(adapter.parseServerMessage(JSON.stringify({
      type: "input_audio_buffer.speech_started",
      item_id: "caller-item-1",
    }))).toContainEqual({
      type: "caller_activity",
      state: "started",
      itemId: "caller-item-1",
    });
    expect(adapter.parseServerMessage(JSON.stringify({
      type: "response.created",
      response: { id: "response-1", status: "in_progress" },
    }))).toContainEqual({
      type: "assistant_response",
      state: "started",
      responseId: "response-1",
    });
    expect(adapter.parseServerMessage(JSON.stringify({
      type: "response.output_audio.delta",
      response_id: "response-1",
      item_id: "assistant-item-1",
      content_index: 2,
      delta: "AQID",
    }))).toContainEqual({
      type: "audio",
      audioBase64: "AQID",
      responseId: "response-1",
      itemId: "assistant-item-1",
      contentIndex: 2,
    });
  });

  it("builds the provider truncate message for exactly the acknowledged assistant audio", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime-2.1",
      systemPrompt: "Configured prompt",
    });

    expect(adapter.createConversationItemTruncateMessage({
      itemId: "assistant-item-1",
      contentIndex: 0,
      audioEndMs: 80,
    })).toEqual({
      type: "conversation.item.truncate",
      item_id: "assistant-item-1",
      content_index: 0,
      audio_end_ms: 80,
    });
  });

  it("treats incremental function-call argument events as diagnostics and builds identified continuation messages", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime",
      systemPrompt: "Configured prompt",
      tools: [tool],
    });

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "response.function_call_arguments.done",
      call_id: "openai-call-1",
      name: "zara_zendesk_search_tickets_1234abcd",
      arguments: "{\"query\":\"account activation\"}",
    }))).toEqual([
      {
        type: "provider_event",
        eventType: "response.function_call_arguments.done",
        evidence: {
          callId: "openai-call-1",
          name: "zara_zendesk_search_tickets_1234abcd",
        },
      },
    ]);

    expect(adapter.createFunctionCallOutputMessage({
      providerCallId: "openai-call-1",
      output: {
        status: "completed",
        safeOutput: { count: 1 },
      },
    })).toEqual({
      event_id: "zara_function_call_output_openai-call-1",
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: "openai-call-1",
        output: JSON.stringify({
          status: "completed",
          safeOutput: { count: 1 },
        }),
      },
    });
    expect(adapter.createResponseCreateMessage({
      providerCallId: "openai-call-1",
    })).toEqual({
      event_id: "zara_response_create_openai-call-1",
      type: "response.create",
    });
    expect(adapter.createResponseCreateMessage({
      providerCallId: "openai-call-1",
      instructions: "Tell the caller they are being routed to Billing.",
    })).toEqual({
      event_id: "zara_response_create_openai-call-1",
      type: "response.create",
      response: {
        instructions: "Tell the caller they are being routed to Billing.",
      },
    });
    expect(adapter.createResponseCreateMessage({
      instructions: "Speak the source handoff announcement.",
      metadata: {
        zara_handoff_transfer_id: "session-1:turn:1:agent-front:agent-billing",
      },
    })).toEqual({
      type: "response.create",
      response: {
        instructions: "Speak the source handoff announcement.",
        metadata: {
          zara_handoff_transfer_id: "session-1:turn:1:agent-front:agent-billing",
        },
      },
    });
  });

  it("rejects response metadata outside OpenAI key value and entry limits", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime",
      systemPrompt: "Route callers safely.",
    });

    expect(() => adapter.createResponseCreateMessage({
      metadata: {
        ["k".repeat(65)]: "value",
      },
    })).toThrowError("OpenAI response metadata keys must be between 1 and 64 characters.");
    expect(() => adapter.createResponseCreateMessage({
      metadata: {
        handoff: "v".repeat(513),
      },
    })).toThrowError("OpenAI response metadata values must be at most 512 characters.");
    expect(() => adapter.createResponseCreateMessage({
      metadata: Object.fromEntries(
        Array.from({ length: 17 }, (_, index) => [`key_${index}`, `value_${index}`]),
      ),
    })).toThrowError("OpenAI response metadata supports at most 16 entries.");
  });

  it("parses OpenAI session update acknowledgements with safe effective-session evidence", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime-2",
      systemPrompt: "Configured prompt",
    });

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "session.updated",
      session: {
        type: "realtime",
        model: "gpt-realtime-2",
        instructions: "Router instructions with Billing and Support branches.",
        output_modalities: ["audio"],
        tool_choice: "auto",
        tools: [
          {
            type: "function",
            name: "zara_handoff_to_agent",
            description: "Hand off caller to a configured specialist.",
            parameters: {
              type: "object",
              properties: {
                targetAgentId: {
                  type: "string",
                  enum: ["agent-billing"],
                },
              },
              required: ["targetAgentId"],
            },
          },
        ],
        audio: {
          input: {
            format: {
              type: "audio/pcm",
              rate: 24000,
            },
            transcription: {
              model: "gpt-realtime-whisper",
              language: "en",
            },
            turn_detection: {
              type: "semantic_vad",
              create_response: true,
            },
          },
          output: {
            format: {
              type: "audio/pcm",
              rate: 24000,
            },
            voice: "marin",
          },
        },
      },
    }))).toEqual([
      {
        type: "session_ready",
      },
      {
        type: "provider_event",
        eventType: "session.updated",
        evidence: {
          sessionInstructions: "Router instructions with Billing and Support branches.",
          sessionToolChoice: "auto",
          sessionToolCount: 1,
          sessionToolNames: "zara_handoff_to_agent",
          sessionToolsJson: JSON.stringify([
            {
              type: "function",
              name: "zara_handoff_to_agent",
              description: "Hand off caller to a configured specialist.",
              parameters: {
                type: "object",
                properties: {
                  targetAgentId: {
                    type: "string",
                    enum: ["agent-billing"],
                  },
                },
                required: ["targetAgentId"],
              },
            },
          ]),
          sessionTools: [
            {
              type: "function",
              name: "zara_handoff_to_agent",
              description: "Hand off caller to a configured specialist.",
              parameters: {
                type: "object",
                properties: {
                  targetAgentId: {
                    type: "string",
                    enum: ["agent-billing"],
                  },
                },
                required: ["targetAgentId"],
              },
            },
          ],
          sessionType: "realtime",
          model: "gpt-realtime-2",
          outputModalities: ["audio"],
          inputAudioFormatType: "audio/pcm",
          inputAudioRate: 24000,
          inputTranscriptionConfigured: true,
          inputTranscriptionModel: "gpt-realtime-whisper",
          inputTranscriptionLanguage: "en",
          inputTurnDetectionType: "semantic_vad",
          inputTurnDetectionCreateResponse: true,
          audioOutputConfigured: true,
          outputAudioFormatType: "audio/pcm",
          outputAudioRate: 24000,
          outputAudioVoice: "marin",
        },
      },
    ]);
  });

  it("parses root-level OpenAI turn-detection acknowledgement evidence", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime-2",
      systemPrompt: "Configured prompt",
    });

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "session.updated",
      session: {
        type: "realtime",
        model: "gpt-realtime-2",
        turn_detection: {
          type: "semantic_vad",
          create_response: false,
          interrupt_response: false,
        },
      },
    }))).toEqual([
      {
        type: "session_ready",
      },
      {
        type: "provider_event",
        eventType: "session.updated",
        evidence: {
          sessionType: "realtime",
          model: "gpt-realtime-2",
          inputTranscriptionConfigured: false,
          inputTurnDetectionType: "semantic_vad",
          inputTurnDetectionCreateResponse: false,
          inputTurnDetectionInterruptResponse: false,
          audioOutputConfigured: false,
        },
      },
    ]);
  });

  it("parses safe OpenAI realtime lifecycle evidence without audio payloads", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime-2",
      systemPrompt: "Configured prompt",
    });

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "input_audio_buffer.speech_stopped",
      audio_start_ms: 120,
      audio_end_ms: 820,
      item_id: "item-user-1",
    }))).toEqual([
      {
        type: "caller_activity",
        state: "stopped",
        itemId: "item-user-1",
      },
      {
        type: "provider_event",
        eventType: "input_audio_buffer.speech_stopped",
        evidence: {
          audioStartMs: 120,
          audioEndMs: 820,
          itemId: "item-user-1",
        },
      },
    ]);

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "input_audio_buffer.committed",
      previous_item_id: "item-prev",
      item_id: "item-user-2",
    }))).toEqual([
      {
        type: "caller_turn",
        state: "committed",
        itemId: "item-user-2",
      },
      {
        type: "input_audio_committed",
        itemId: "item-user-2",
      },
      {
        type: "provider_event",
        eventType: "input_audio_buffer.committed",
        evidence: {
          itemId: "item-user-2",
          previousItemId: "item-prev",
        },
      },
    ]);

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "input_audio_buffer.speech_started",
      audio_start_ms: 1200,
      item_id: "item-user-3",
    }))).toEqual([
      {
        type: "caller_activity",
        state: "started",
        itemId: "item-user-3",
      },
      {
        type: "provider_event",
        eventType: "input_audio_buffer.speech_started",
        evidence: {
          audioStartMs: 1200,
          itemId: "item-user-3",
        },
      },
    ]);

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "conversation.item.input_audio_transcription.failed",
      item_id: "item-user-2",
      error: {
        type: "server_error",
        code: "transcription_failed",
        message: "Transcription failed.",
      },
    }))).toEqual([
      {
        type: "provider_event",
        eventType: "conversation.item.input_audio_transcription.failed",
        evidence: {
          itemId: "item-user-2",
          error: {
            type: "server_error",
            code: "transcription_failed",
            message: "Transcription failed.",
          },
        },
      },
    ]);

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "response.created",
      response: {
        id: "resp-1",
        status: "in_progress",
      },
    }))).toEqual([
      {
        type: "assistant_response",
        state: "started",
        responseId: "resp-1",
      },
      {
        type: "provider_event",
        eventType: "response.created",
        evidence: {
          responseId: "resp-1",
          status: "in_progress",
        },
      },
    ]);

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "response.cancelled",
      response: {
        id: "resp-cancelled",
        status: "cancelled",
      },
    }))).toEqual([
      {
        type: "assistant_response",
        state: "cancelled",
        responseId: "resp-cancelled",
      },
      {
        type: "provider_event",
        eventType: "response.cancelled",
        evidence: {
          responseId: "resp-cancelled",
          status: "cancelled",
        },
      },
    ]);

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "error",
      error: {
        type: "invalid_request_error",
        code: "invalid_value",
        message: "Invalid value: unsupported field.",
        param: "session.audio.output.speed",
        event_id: "setup-session-update",
      },
    }))).toEqual([
      {
        type: "provider_failure",
        code: "invalid_value",
        providerErrorType: "invalid_request_error",
        param: "session.audio.output.speed",
        eventId: "setup-session-update",
      },
      {
        type: "provider_event",
        eventType: "error",
        evidence: {
          error: {
            type: "invalid_request_error",
            code: "invalid_value",
            message: "Invalid value: unsupported field.",
            param: "session.audio.output.speed",
            eventId: "setup-session-update",
          },
        },
      },
    ]);

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "response.done",
      response: {
        id: "resp-1",
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_audio",
                transcript: "Raw transcript is not copied into provider evidence.",
              },
            ],
          },
        ],
      },
    }))).toEqual([
      {
        type: "output_transcript",
        text: "Raw transcript is not copied into provider evidence.",
        done: true,
      },
      {
        type: "provider_event",
        eventType: "response.done",
        evidence: {
          responseId: "resp-1",
          status: "completed",
          outputItemTypes: ["message"],
          outputContentTypes: ["output_audio"],
          audioOutputContentPresent: true,
          outputTextLength: 52,
        },
      },
      {
        type: "assistant_response",
        state: "completed",
        responseId: "resp-1",
      },
    ]);

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "response.done",
      response: {
        id: "resp-cancelled",
        status: "cancelled",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_audio",
                transcript: "This cancelled response must not complete a Zara turn.",
              },
            ],
          },
        ],
      },
    }))).toEqual([
      {
        type: "assistant_response",
        state: "cancelled",
        responseId: "resp-cancelled",
      },
      {
        type: "provider_event",
        eventType: "response.done",
        evidence: {
          responseId: "resp-cancelled",
          status: "cancelled",
          outputItemTypes: ["message"],
          outputContentTypes: ["output_audio"],
          audioOutputContentPresent: true,
        },
      },
    ]);
  });

  it("emits a privacy-safe provider failure while preserving diagnostic evidence", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime-2",
      systemPrompt: "Configured prompt",
    });

    const events = adapter.parseServerMessage(JSON.stringify({
      type: "error",
      response_id: "resp-failed",
      item_id: "item-failed",
      call_id: "call-failed",
      error: {
        type: "invalid_request_error",
        code: "invalid_value",
        message: "Provider-controlled detail must stay out of lifecycle events.",
        param: "session.audio.output.speed",
        event_id: "setup-session-update",
      },
    }));

    expect(events).toEqual([
      {
        type: "provider_failure",
        code: "invalid_value",
        providerErrorType: "invalid_request_error",
        param: "session.audio.output.speed",
        eventId: "setup-session-update",
        responseId: "resp-failed",
        itemId: "item-failed",
        callId: "call-failed",
      },
      {
        type: "provider_event",
        eventType: "error",
        evidence: {
          itemId: "item-failed",
          responseId: "resp-failed",
          callId: "call-failed",
          error: {
            type: "invalid_request_error",
            code: "invalid_value",
            message: "Provider-controlled detail must stay out of lifecycle events.",
            param: "session.audio.output.speed",
            eventId: "setup-session-update",
          },
        },
      },
    ]);
    expect(events[0]).not.toHaveProperty("message");
  });

  it("keeps failed and incomplete responses distinct with safe status detail", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime-2",
      systemPrompt: "Configured prompt",
    });

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "response.done",
      response: {
        id: "resp-failed",
        status: "failed",
        status_details: {
          type: "failed",
          error: {
            code: "server_error",
            type: "server_error",
            message: "Provider-controlled failure detail.",
          },
        },
      },
    }))).toEqual([
      {
        type: "assistant_response",
        state: "failed",
        responseId: "resp-failed",
        failureCode: "server_error",
        failureType: "server_error",
      },
      {
        type: "provider_event",
        eventType: "response.done",
        evidence: {
          responseId: "resp-failed",
          status: "failed",
        },
      },
    ]);

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "response.done",
      response: {
        id: "resp-incomplete",
        status: "incomplete",
        status_details: {
          type: "incomplete",
          reason: "max_output_tokens",
        },
      },
    }))).toEqual([
      {
        type: "assistant_response",
        state: "incomplete",
        responseId: "resp-incomplete",
        failureType: "incomplete",
        failureReason: "max_output_tokens",
      },
      {
        type: "provider_event",
        eventType: "response.done",
        evidence: {
          responseId: "resp-incomplete",
          status: "incomplete",
        },
      },
    ]);
  });

  it("treats response output item function-call events as diagnostic evidence only", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime-2",
      systemPrompt: "Configured prompt",
      tools: [tool],
    });

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "response.output_item.done",
      response_id: "resp-1",
      output_index: 0,
      item: {
        type: "function_call",
        id: "fc-1",
        call_id: "openai-call-3",
        name: "zara_zendesk_search_tickets_1234abcd",
        arguments: "{\"query\":\"shipping\"}",
      },
    }))).toEqual([
      {
        type: "provider_event",
        eventType: "response.output_item.done",
        evidence: {
          responseId: "resp-1",
          outputIndex: 0,
          itemId: "fc-1",
          itemType: "function_call",
          callId: "openai-call-3",
          name: "zara_zendesk_search_tickets_1234abcd",
        },
      },
    ]);
  });

  it("parses input transcript deltas and response.done audio transcripts", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime-2",
      systemPrompt: "Configured prompt",
    });

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "item-user-1",
      content_index: 0,
      delta: "Hello",
    }))).toEqual([
      {
        type: "input_transcript",
        text: "Hello",
        done: false,
        itemId: "item-user-1",
      },
      {
        type: "provider_event",
        eventType: "conversation.item.input_audio_transcription.delta",
        evidence: {
          itemId: "item-user-1",
          contentIndex: 0,
          textLength: 5,
        },
      },
    ]);

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "response.done",
      response: {
        id: "resp-1",
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_audio",
                transcript: "Hello, how can I help?",
              },
            ],
          },
        ],
      },
    }))).toEqual([
      {
        type: "output_transcript",
        text: "Hello, how can I help?",
        done: true,
      },
      {
        type: "provider_event",
        eventType: "response.done",
        evidence: {
          responseId: "resp-1",
          status: "completed",
          outputItemTypes: ["message"],
          outputContentTypes: ["output_audio"],
          audioOutputContentPresent: true,
          outputTextLength: 22,
        },
      },
      {
        type: "assistant_response",
        state: "completed",
        responseId: "resp-1",
      },
    ]);
  });

  it("preserves response identity for audio deltas and audio completion", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime-2",
      systemPrompt: "Configured prompt",
    });

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "response.output_audio.delta",
      response_id: "resp-audio-1",
      item_id: "item-audio-1",
      delta: "cGNtdQ==",
    }))).toEqual([
      {
        type: "audio",
        audioBase64: "cGNtdQ==",
        responseId: "resp-audio-1",
        itemId: "item-audio-1",
      },
    ]);

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "response.output_audio.done",
      response_id: "resp-audio-1",
      item_id: "item-audio-1",
    }))).toEqual([
      {
        type: "assistant_response",
        state: "audio_completed",
        responseId: "resp-audio-1",
        itemId: "item-audio-1",
      },
      {
        type: "provider_event",
        eventType: "response.output_audio.done",
        evidence: {
          responseId: "resp-audio-1",
          itemId: "item-audio-1",
        },
      },
    ]);
  });

  it("parses docs-style response.done function call output items", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime-2",
      systemPrompt: "Configured prompt",
      tools: [tool],
    });

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "response.done",
      response: {
        output: [
          {
            type: "function_call",
            call_id: "openai-call-2",
            name: "zara_zendesk_search_tickets_1234abcd",
            arguments: "{\"query\":\"billing\"}",
          },
        ],
      },
    }))).toEqual([
      {
        type: "tool_call",
        providerCallId: "openai-call-2",
        name: "zara_zendesk_search_tickets_1234abcd",
        argumentsJson: "{\"query\":\"billing\"}",
      },
      {
        type: "assistant_response",
        state: "completed",
      },
    ]);
  });
});
