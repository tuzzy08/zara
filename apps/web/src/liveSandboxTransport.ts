import type { LiveSandboxStreamEvent } from "./liveSandboxSessionApi";

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
  sendTextTurn(input: { transcript: string; callPhase?: string | undefined }): void;
  appendAudioChunk(audioBase64: string): void;
  commitAudioTurn(input: { sampleRateHz: number; callPhase?: string | undefined }): void;
  close(): void;
}

export function createLiveSandboxTransport(input: {
  transportUrl: string;
  transportToken: string;
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
      const url = appendTransportToken(input.transportUrl, input.transportToken);
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
    sendTextTurn(turn) {
      if (socket?.readyState !== browserWebSocketOpenState) {
        return;
      }

      socket.send(
        JSON.stringify({
          type: "input.text",
          transcript: turn.transcript,
          ...(turn.callPhase !== undefined ? { callPhase: turn.callPhase } : {}),
        }),
      );
    },
    appendAudioChunk(audioBase64) {
      if (socket?.readyState !== browserWebSocketOpenState) {
        return;
      }

      socket.send(
        JSON.stringify({
          type: "input.audio.append",
          audioBase64,
        }),
      );
    },
    commitAudioTurn(turn) {
      if (socket?.readyState !== browserWebSocketOpenState) {
        return;
      }

      socket.send(
        JSON.stringify({
          type: "input.audio.commit",
          sampleRateHz: turn.sampleRateHz,
          ...(turn.callPhase !== undefined ? { callPhase: turn.callPhase } : {}),
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
        socket.close(1000, "sandbox_closed");
      }
      socket = null;
      messageListener = null;
      closeListener = null;
      errorListener = null;
    },
  };
}

function appendTransportToken(transportUrl: string, transportToken: string) {
  const url = new URL(transportUrl);
  url.searchParams.set("token", transportToken);
  return url.toString();
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
