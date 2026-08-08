import { describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import WebSocket from "ws";
import { premiumRealtimeProviderTransportToken } from "./premium-realtime-provider-transport";
import { RuntimeSessionsWebSocketBridge } from "./runtime-sessions.websocket-bridge";
import { RuntimeSessionsService } from "./runtime-sessions.service";
import { createRuntimeSessionsService, FakePremiumRealtimeProviderTransport, getListeningPort, nextOpen, nextMessage, nextClose, waitFor, withTimeout, encodePcm16, decodePcm16SampleCount } from "./runtime-sessions.websocket.test-support";

describe("RuntimeSessionsWebSocketBridge media-projection", () => {
  it("resamples premium OpenAI browser microphone audio to provider PCM before forwarding", async () => {
      const providerTransport = new FakePremiumRealtimeProviderTransport();
      const runtimeSessionsService = createRuntimeSessionsService();

      const moduleRef = await Test.createTestingModule({
        providers: [
          RuntimeSessionsWebSocketBridge,
          {
            provide: RuntimeSessionsService,
            useValue: runtimeSessionsService,
          },
          {
            provide: premiumRealtimeProviderTransportToken,
            useValue: providerTransport,
          },
        ],
      }).compile();

      const app: INestApplication = moduleRef.createNestApplication();
      await app.listen(0);

      const port = getListeningPort(app);
      const socket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream?token=token-1");
      const readyPromise = nextMessage(socket);

      await withTimeout(nextOpen(socket), "websocket open");
      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "session.updated",
      }));
      await withTimeout(readyPromise, "session.ready");

      socket.send(JSON.stringify({
        type: "audio.append",
        audioBase64: encodePcm16([0, 0.5, -0.5, 0]),
        sampleRateHz: 16_000,
      }));

      await waitFor(() =>
        providerTransport.connections[0]?.connection.sent.some((message) => message.type === "input_audio_buffer.append") ?? false,
      );

      const appendMessage = providerTransport.connections[0]?.connection.sent.find(
        (message) => message.type === "input_audio_buffer.append",
      );
      expect(appendMessage).toMatchObject({
        type: "input_audio_buffer.append",
      });
      const forwardedAudio = String(appendMessage?.audio ?? "");
      expect(decodePcm16SampleCount(forwardedAudio)).toBe(6);

      socket.close();
      await withTimeout(nextClose(socket), "websocket close");
      await app.close();
    }, 20_000);

  it("does not project premium voice agent output until the provider confirms a caller voice turn", async () => {
      const providerTransport = new FakePremiumRealtimeProviderTransport();
      const runtimeSessionsService = createRuntimeSessionsService();

      const moduleRef = await Test.createTestingModule({
        providers: [
          RuntimeSessionsWebSocketBridge,
          {
            provide: RuntimeSessionsService,
            useValue: runtimeSessionsService,
          },
          {
            provide: premiumRealtimeProviderTransportToken,
            useValue: providerTransport,
          },
        ],
      }).compile();

      const app: INestApplication = moduleRef.createNestApplication();
      await app.listen(0);

      const port = getListeningPort(app);
      const socket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream?token=token-1");
      const messages: Array<Record<string, unknown>> = [];
      socket.on("message", (message) => {
        messages.push(JSON.parse(message.toString()) as Record<string, unknown>);
      });

      await withTimeout(nextOpen(socket), "websocket open");
      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "session.updated",
      }));
      await waitFor(() => messages.some((message) => message.type === "session.ready"));

      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "conversation.item.input_audio_transcription.delta",
        transcript: "Hello, I need",
        delta: "Hello, I need",
      }));
      await waitFor(() => messages.some((message) => message.type === "stt.partial"));
      expect(messages.find((message) => message.type === "stt.partial")).toMatchObject({
        payload: {
          transcript: "Hello, I need",
          source: "voice",
        },
      });

      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "response.output_audio.delta",
        delta: "UHJlbWF0dXJlIGF1ZGlv",
      }));
      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "response.output_audio_transcript.done",
        transcript: "Hey there! Great to hear from you!",
      }));
      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(messages.map((message) => message.type)).not.toContain("turn.audio.chunk");
      expect(messages.map((message) => message.type)).not.toContain("turn.completed");

      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "input_audio_buffer.committed",
        item_id: "item-user-1",
      }));

      await waitFor(() => messages.some((message) => message.type === "turn.completed"));
      expect(messages.map((message) => message.type)).toContain("turn.audio.chunk");
      expect(messages.map((message) => message.type)).not.toContain("turn.transcribed");
      expect(messages.find((message) => message.type === "turn.completed")).toMatchObject({
        payload: {
          transcript: "",
          transcriptUnavailable: true,
          responseText: "Hey there! Great to hear from you!",
        },
      });

      socket.close();
      await withTimeout(nextClose(socket), "websocket close");
      await app.close();
    }, 20_000);

  it("projects an OpenAI response after committed voice input even when input transcription is absent", async () => {
      const providerTransport = new FakePremiumRealtimeProviderTransport();
      const runtimeSessionsService = createRuntimeSessionsService();

      const moduleRef = await Test.createTestingModule({
        providers: [
          RuntimeSessionsWebSocketBridge,
          {
            provide: RuntimeSessionsService,
            useValue: runtimeSessionsService,
          },
          {
            provide: premiumRealtimeProviderTransportToken,
            useValue: providerTransport,
          },
        ],
      }).compile();

      const app: INestApplication = moduleRef.createNestApplication();
      await app.listen(0);

      const port = getListeningPort(app);
      const socket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream?token=token-1");
      const messages: Array<Record<string, unknown>> = [];
      socket.on("message", (message) => {
        messages.push(JSON.parse(message.toString()) as Record<string, unknown>);
      });

      await withTimeout(nextOpen(socket), "websocket open");
      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "session.updated",
      }));
      await waitFor(() => messages.some((message) => message.type === "session.ready"));

      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "input_audio_buffer.speech_stopped",
        item_id: "item-user-1",
        audio_end_ms: 4672,
      }));
      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "input_audio_buffer.committed",
        item_id: "item-user-1",
      }));
      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "response.created",
        response: {
          id: "resp-1",
          status: "in_progress",
        },
      }));
      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "response.done",
        response: {
          id: "resp-1",
          status: "completed",
          output: [
            {
              type: "message",
              id: "item-agent-1",
              content: [
                {
                  type: "output_text",
                  text: "Hello! Thanks for calling Zara AI. How can I help?",
                },
              ],
            },
          ],
        },
      }));

      await waitFor(() => messages.some((message) => message.type === "turn.completed"));
      expect(messages.map((message) => message.type)).not.toContain("turn.transcribed");
      expect(messages.find((message) => message.type === "turn.completed")).toMatchObject({
        payload: {
          transcript: "",
          transcriptUnavailable: true,
          responseText: "Hello! Thanks for calling Zara AI. How can I help?",
          provider: "openai-realtime",
          model: "gpt-realtime-2",
        },
      });
      expect(messages.find((message) =>
        message.type === "provider.diagnostic"
        && (message.payload as { eventType?: string } | undefined)?.eventType === "response.done",
      )).toMatchObject({
        payload: {
          eventType: "response.done",
          outputContentTypes: ["output_text"],
          audioOutputContentPresent: false,
          outputTextLength: 50,
        },
      });

      socket.close();
      await withTimeout(nextClose(socket), "websocket close");
      await app.close();
    }, 20_000);

  it("does not delay a completed OpenAI response when the next caller capture starts before response.done", async () => {
      const providerTransport = new FakePremiumRealtimeProviderTransport();
      const runtimeSessionsService = createRuntimeSessionsService();

      const moduleRef = await Test.createTestingModule({
        providers: [
          RuntimeSessionsWebSocketBridge,
          {
            provide: RuntimeSessionsService,
            useValue: runtimeSessionsService,
          },
          {
            provide: premiumRealtimeProviderTransportToken,
            useValue: providerTransport,
          },
        ],
      }).compile();

      const app: INestApplication = moduleRef.createNestApplication();
      await app.listen(0);

      const port = getListeningPort(app);
      const socket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream?token=token-1");
      const messages: Array<Record<string, unknown>> = [];
      socket.on("message", (message) => {
        messages.push(JSON.parse(message.toString()) as Record<string, unknown>);
      });

      await withTimeout(nextOpen(socket), "websocket open");
      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "session.updated",
      }));
      await waitFor(() => messages.some((message) => message.type === "session.ready"));

      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "input_audio_buffer.committed",
        item_id: "item-user-1",
      }));
      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "response.created",
        response: {
          id: "resp-1",
          status: "in_progress",
        },
      }));

      socket.send(JSON.stringify({
        type: "audio.append",
        audioBase64: encodePcm16([0, 0.2, -0.2, 0]),
        sampleRateHz: 16_000,
      }));
      await waitFor(() =>
        providerTransport.connections[0]?.connection.sent.some((message) => message.type === "input_audio_buffer.append") ?? false,
      );

      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "response.done",
        response: {
          id: "resp-1",
          status: "completed",
          output: [
            {
              type: "message",
              id: "item-agent-1",
              content: [
                {
                  type: "output_text",
                  text: "Hello! Thanks for calling Zara AI. How can I help?",
                },
              ],
            },
          ],
        },
      }));

      await waitFor(() => messages.some((message) => message.type === "turn.completed"));

      expect(messages.find((message) => message.type === "turn.completed")).toMatchObject({
        payload: {
          transcript: "",
          transcriptUnavailable: true,
          responseText: "Hello! Thanks for calling Zara AI. How can I help?",
        },
      });

      socket.close();
      await withTimeout(nextClose(socket), "websocket close");
      await app.close();
    }, 20_000);

  it("lets provider-owned turn detection handle premium voice commits", async () => {
      const providerTransport = new FakePremiumRealtimeProviderTransport();
      const runtimeSessionsService = createRuntimeSessionsService();

      const moduleRef = await Test.createTestingModule({
        providers: [
          RuntimeSessionsWebSocketBridge,
          {
            provide: RuntimeSessionsService,
            useValue: runtimeSessionsService,
          },
          {
            provide: premiumRealtimeProviderTransportToken,
            useValue: providerTransport,
          },
        ],
      }).compile();

      const app: INestApplication = moduleRef.createNestApplication();
      await app.listen(0);

      const port = getListeningPort(app);
      const socket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream?token=token-1");

      await withTimeout(nextOpen(socket), "websocket open");
      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "session.updated",
      }));
      await withTimeout(nextMessage(socket), "session.ready");

      socket.send(JSON.stringify({
        type: "audio.commit",
      }));
      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(providerTransport.connections[0]?.connection.sent).toEqual([]);

      socket.close();
      await withTimeout(nextClose(socket), "websocket close");
      await app.close();
    }, 20_000);

  it("sends Gemini Live voice frames through realtimeInput audio", async () => {
      const providerTransport = new FakePremiumRealtimeProviderTransport();
      const runtimeSessionsService = createRuntimeSessionsService({
        runtime: "gemini-live",
        model: "gemini-3.1-flash-live-preview",
      });

      const moduleRef = await Test.createTestingModule({
        providers: [
          RuntimeSessionsWebSocketBridge,
          {
            provide: RuntimeSessionsService,
            useValue: runtimeSessionsService,
          },
          {
            provide: premiumRealtimeProviderTransportToken,
            useValue: providerTransport,
          },
        ],
      }).compile();

      const app: INestApplication = moduleRef.createNestApplication();
      await app.listen(0);

      const port = getListeningPort(app);
      const socket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream?token=token-1");

      await withTimeout(nextOpen(socket), "websocket open");
      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        setupComplete: {},
      }));
      await withTimeout(nextMessage(socket), "session.ready");

      const audioBase64 = Buffer.from("Hello from Gemini.", "utf8").toString("base64");
      socket.send(JSON.stringify({
        type: "audio.append",
        audioBase64,
        sampleRateHz: 16_000,
      }));

      await waitFor(() =>
        providerTransport.connections[0]?.connection.sent.some((message) => "realtimeInput" in message) ?? false,
      );
      expect(providerTransport.connections[0]?.connection.sent).toContainEqual({
        realtimeInput: {
          audio: {
            data: audioBase64,
            mimeType: "audio/pcm;rate=16000",
          },
        },
      });
      expect(providerTransport.connections[0]?.connection.sent).not.toContainEqual(expect.objectContaining({
        clientContent: expect.anything(),
      }));

      socket.close();
      await withTimeout(nextClose(socket), "websocket close");
      await app.close();
    }, 20_000);

  it("projects Gemini Live responses from provider input transcripts and turnComplete", async () => {
      const providerTransport = new FakePremiumRealtimeProviderTransport();
      const runtimeSessionsService = createRuntimeSessionsService({
        runtime: "gemini-live",
        model: "gemini-3.1-flash-live-preview",
      });

      const moduleRef = await Test.createTestingModule({
        providers: [
          RuntimeSessionsWebSocketBridge,
          {
            provide: RuntimeSessionsService,
            useValue: runtimeSessionsService,
          },
          {
            provide: premiumRealtimeProviderTransportToken,
            useValue: providerTransport,
          },
        ],
      }).compile();

      const app: INestApplication = moduleRef.createNestApplication();
      await app.listen(0);

      const port = getListeningPort(app);
      const socket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream?token=token-1");
      const messages: Array<Record<string, unknown>> = [];
      socket.on("message", (message) => {
        messages.push(JSON.parse(message.toString()) as Record<string, unknown>);
      });

      await withTimeout(nextOpen(socket), "websocket open");
      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        setupComplete: {},
      }));
      await waitFor(() => messages.some((message) => message.type === "session.ready"));

      socket.send(JSON.stringify({
        type: "audio.append",
        audioBase64: encodePcm16([0, 0.25]),
        sampleRateHz: 16_000,
      }));

      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        serverContent: {
          inputTranscription: {
            text: "Hello Gemini.",
          },
        },
      }));
      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        serverContent: {
          modelTurn: {
            parts: [
              {
                inlineData: {
                  data: "R2VtaW5pIGF1ZGlv",
                  mimeType: "audio/pcm;rate=24000",
                },
              },
            ],
          },
          outputTranscription: {
            text: "Hello, this is Gemini Live.",
          },
          turnComplete: true,
        },
      }));

      await waitFor(() => messages.some((message) => message.type === "turn.completed"));
      expect(messages.map((message) => message.type)).toContain("turn.transcribed");
      expect(messages.map((message) => message.type)).toContain("turn.audio.chunk");
      expect(messages.find((message) => message.type === "turn.completed")).toMatchObject({
        payload: {
          transcript: "Hello Gemini.",
          transcriptUnavailable: false,
          responseText: "Hello, this is Gemini Live.",
          provider: "gemini-live",
          model: "gemini-3.1-flash-live-preview",
        },
      });

      socket.close();
      await withTimeout(nextClose(socket), "websocket close");
      await app.close();
    }, 20_000);

  it("drops a cancelled OpenAI response caller turn before projecting the next response", async () => {
      const providerTransport = new FakePremiumRealtimeProviderTransport();
      const runtimeSessionsService = createRuntimeSessionsService();

      const moduleRef = await Test.createTestingModule({
        providers: [
          RuntimeSessionsWebSocketBridge,
          {
            provide: RuntimeSessionsService,
            useValue: runtimeSessionsService,
          },
          {
            provide: premiumRealtimeProviderTransportToken,
            useValue: providerTransport,
          },
        ],
      }).compile();

      const app: INestApplication = moduleRef.createNestApplication();
      await app.listen(0);

      const port = getListeningPort(app);
      const socket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream?token=token-1");
      const messages: Array<Record<string, unknown>> = [];
      socket.on("message", (message) => {
        messages.push(JSON.parse(message.toString()) as Record<string, unknown>);
      });

      await withTimeout(nextOpen(socket), "websocket open");
      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "session.updated",
      }));
      await waitFor(() => messages.some((message) => message.type === "session.ready"));

      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "input_audio_buffer.committed",
        item_id: "item-user-1",
      }));
      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "response.created",
        response: {
          id: "resp-1",
          status: "in_progress",
        },
      }));
      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "input_audio_buffer.speech_started",
        item_id: "item-user-2",
        audio_start_ms: 6200,
      }));
      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "response.cancelled",
        response: {
          id: "resp-1",
          status: "cancelled",
        },
      }));
      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "input_audio_buffer.committed",
        item_id: "item-user-2",
      }));
      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "response.created",
        response: {
          id: "resp-2",
          status: "in_progress",
        },
      }));
      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "response.done",
        response: {
          id: "resp-2",
          status: "completed",
          output: [
            {
              type: "message",
              id: "item-agent-2",
              content: [
                {
                  type: "output_text",
                  text: "I heard your follow-up.",
                },
              ],
            },
          ],
        },
      }));

      await waitFor(() => messages.some((message) => message.type === "turn.completed"));
      expect(messages.find((message) => message.type === "turn.completed")).toMatchObject({
        payload: {
          transcript: "",
          transcriptUnavailable: true,
          responseText: "I heard your follow-up.",
        },
      });
      expect(messages.filter((message) => message.type === "turn.completed")).toHaveLength(1);
      expect(messages.some((message) =>
        message.type === "provider.diagnostic"
        && (message.payload as { eventType?: string } | undefined)?.eventType === "response.cancelled",
      )).toBe(true);

      socket.close();
      await withTimeout(nextClose(socket), "websocket close");
      await app.close();
    }, 20_000);

  it("projects redacted provider evidence instead of generic provider message spam", async () => {
      const providerTransport = new FakePremiumRealtimeProviderTransport();
      const runtimeSessionsService = createRuntimeSessionsService();

      const moduleRef = await Test.createTestingModule({
        providers: [
          RuntimeSessionsWebSocketBridge,
          {
            provide: RuntimeSessionsService,
            useValue: runtimeSessionsService,
          },
          {
            provide: premiumRealtimeProviderTransportToken,
            useValue: providerTransport,
          },
        ],
      }).compile();

      const app: INestApplication = moduleRef.createNestApplication();
      await app.listen(0);

      const port = getListeningPort(app);
      const socket = new WebSocket("ws://127.0.0.1:" + port + "/runtime/realtime/sessions/session-1/stream?token=token-1");
      const messages: Array<Record<string, unknown>> = [];
      socket.on("message", (message) => {
        messages.push(JSON.parse(message.toString()) as Record<string, unknown>);
      });

      await withTimeout(nextOpen(socket), "websocket open");
      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "session.updated",
      }));
      await waitFor(() => messages.some((message) => message.type === "session.ready"));

      providerTransport.connections[0]?.connection.emitMessage(JSON.stringify({
        type: "input_audio_buffer.committed",
        item_id: "item-user-1",
        previous_item_id: "item-prev",
      }));

      await waitFor(() => messages.some((message) =>
        message.type === "provider.diagnostic"
        && (message.payload as { eventType?: string } | undefined)?.eventType === "input_audio_buffer.committed",
      ));

      expect(messages.find((message) =>
        message.type === "provider.diagnostic"
        && (message.payload as { eventType?: string } | undefined)?.eventType === "input_audio_buffer.committed",
      )).toMatchObject({
        type: "provider.diagnostic",
        payload: {
          provider: "openai-realtime",
          model: "gpt-realtime-2",
          eventType: "input_audio_buffer.committed",
          itemId: "item-user-1",
          previousItemId: "item-prev",
        },
      });
      expect(messages.map((message) => message.type)).not.toContain("provider.message");

      socket.close();
      await withTimeout(nextClose(socket), "websocket close");
      await app.close();
    }, 20_000);
});
