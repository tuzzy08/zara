import type { LiveSandboxStreamEvent } from "./liveSandboxSessionApi";
import { buildApiWebSocketUrl } from "./apiClient";

interface BrowserWebSocketLike {
  addEventListener(event: string, listener: (event: unknown) => void): void;
  removeEventListener(event: string, listener: (event: unknown) => void): void;
  send(message: string): void;
  close(code?: number, reason?: string): void;
  readyState: number;
}

const browserWebSocketOpenState = 1;

export interface LiveSandboxTransport {
  connect(): Promise<void>;
  appendAudioChunk(
    audioBase64: string,
    input?: { sampleRateHz?: number | undefined; callPhase?: string | undefined; intent?: string | undefined },
  ): void;
  commitAudioTurn(input: { sampleRateHz: number; callPhase?: string | undefined; intent?: string | undefined }): void;
  close(): void;
}

export function createLiveSandboxTransport(input: {
  transportUrl: string;
  transportToken?: string | undefined;
  workspaceId: string;
  source: string;
  webSocketFactory?: ((url: string) => BrowserWebSocketLike) | undefined;
  onEvent: (event: LiveSandboxStreamEvent) => void;
  onClose?: ((event: { code?: number | undefined; reason?: string | undefined }) => void) | undefined;
  onError?: ((error: Error) => void) | undefined;
}) : LiveSandboxTransport {
  let socket: BrowserWebSocketLike | null = null;
  let messageListener: ((event: unknown) => void) | null = null;
  let closeListener: ((event: unknown) => void) | null = null;
  let errorListener: ((event: unknown) => void) | null = null;
  const webSocketFactory = input.webSocketFactory ?? ((url) => new WebSocket(url));

  return {
    async connect() {
      const url = appendTransportScope({
        transportUrl: input.transportUrl,
        transportToken: input.transportToken,
        workspaceId: input.workspaceId,
        source: input.source,
      });
      socket = webSocketFactory(url);

      await new Promise<void>((resolve, reject) => {
        if (socket === null) {
          reject(new Error("Live sandbox transport could not be opened."));
          return;
        }

        const openListener = () => {
          socket?.removeEventListener("open", openListener);
          resolve();
        };
        messageListener = (event) => {
          const payload = getEventData(event);

          if (payload === null) {
            return;
          }

          try {
            input.onEvent(JSON.parse(payload) as LiveSandboxStreamEvent);
          } catch (error) {
            input.onError?.(error instanceof Error ? error : new Error("Live sandbox event parsing failed."));
          }
        };
        closeListener = (event) => {
          input.onClose?.({
            ...(getEventCode(event) !== undefined ? { code: getEventCode(event) } : {}),
            ...(getEventReason(event) !== undefined ? { reason: getEventReason(event) } : {}),
          });
        };
        errorListener = () => {
          reject(new Error("Live sandbox transport failed to connect."));
        };

        socket.addEventListener("open", openListener);
        socket.addEventListener("message", messageListener);
        socket.addEventListener("close", closeListener);
        socket.addEventListener("error", errorListener);
      });
    },
    appendAudioChunk(audioBase64, turn) {
      if (socket?.readyState !== browserWebSocketOpenState) {
        return;
      }

      if (isPremiumRealtimeTransport(input.transportUrl)) {
        socket.send(
          JSON.stringify({
            type: "audio.append",
            audioBase64,
            ...(turn?.sampleRateHz !== undefined ? { sampleRateHz: turn.sampleRateHz } : {}),
          }),
        );
        return;
      }

      socket.send(
        JSON.stringify({
          type: "input.audio.append",
          audioBase64,
          ...(turn?.sampleRateHz !== undefined ? { sampleRateHz: turn.sampleRateHz } : {}),
          ...(turn?.callPhase !== undefined ? { callPhase: turn.callPhase } : {}),
          ...(turn?.intent !== undefined ? { intent: turn.intent } : {}),
        }),
      );
    },
    commitAudioTurn(turn) {
      if (socket?.readyState !== browserWebSocketOpenState) {
        return;
      }

      if (isPremiumRealtimeTransport(input.transportUrl)) {
        socket.send(
          JSON.stringify({
            type: "audio.commit",
          }),
        );
        return;
      }

      socket.send(
        JSON.stringify({
          type: "input.audio.commit",
          sampleRateHz: turn.sampleRateHz,
          ...(turn.callPhase !== undefined ? { callPhase: turn.callPhase } : {}),
          ...(turn.intent !== undefined ? { intent: turn.intent } : {}),
        }),
      );
    },
    close() {
      if (socket !== null) {
        if (messageListener !== null) {
          socket.removeEventListener("message", messageListener);
        }
        if (closeListener !== null) {
          socket.removeEventListener("close", closeListener);
        }
        if (errorListener !== null) {
          socket.removeEventListener("error", errorListener);
        }
        if (socket.readyState === browserWebSocketOpenState && isPremiumRealtimeTransport(input.transportUrl)) {
          socket.send(JSON.stringify({ type: "session.close" }));
        }
        socket.close(1000, "sandbox_closed");
      }
      socket = null;
      messageListener = null;
      closeListener = null;
      errorListener = null;
    },
  };
}

function appendTransportScope(input: {
  transportUrl: string;
  transportToken?: string | undefined;
  workspaceId: string;
  source: string;
}) {
  const url = new URL(normalizeWebSocketUrl(input.transportUrl));
  if (input.transportToken !== undefined) {
    url.searchParams.set("token", input.transportToken);
  }
  url.searchParams.set("workspaceId", input.workspaceId);
  url.searchParams.set("source", input.source);
  return url.toString();
}

function normalizeWebSocketUrl(transportUrl: string) {
  if (transportUrl.startsWith("ws://") || transportUrl.startsWith("wss://")) {
    return transportUrl;
  }

  return buildApiWebSocketUrl(transportUrl);
}

function isPremiumRealtimeTransport(transportUrl: string) {
  return transportUrl.includes("/runtime/realtime/sessions/");
}

function getEventData(event: unknown) {
  if (typeof event === "object" && event !== null && "data" in event) {
    const data = (event as { data?: unknown }).data;
    return typeof data === "string" ? data : null;
  }

  return null;
}

function getEventCode(event: unknown) {
  if (typeof event === "object" && event !== null && "code" in event) {
    const code = (event as { code?: unknown }).code;
    return typeof code === "number" ? code : undefined;
  }

  return undefined;
}

function getEventReason(event: unknown) {
  if (typeof event === "object" && event !== null && "reason" in event) {
    const reason = (event as { reason?: unknown }).reason;
    return typeof reason === "string" ? reason : undefined;
  }

  return undefined;
}
