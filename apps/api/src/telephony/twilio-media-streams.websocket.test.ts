import { afterEach, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { Logger, type INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import {
  computeTwilioWebhookSignature,
  type AvailableTwilioPhoneNumber,
  type PstnAudioFrame,
} from "@zara/core";
import WebSocket, { type RawData } from "ws";

import { ComplianceModule } from "../compliance/compliance.module";
import { configureCors } from "../config/cors";
import { installTestTenantAuth } from "../testing/tenant-auth-request";
import {
  FileTelephonyStateRepository,
  TELEPHONY_STATE_REPOSITORY,
} from "./telephony-state.repository";
import { TELEPHONY_INCREMENTAL_REPOSITORY } from "./telephony-incremental.repository";
import { InMemoryTelephonyIncrementalRepository } from "./telephony-incremental.repository.test-helper";
import {
  TWILIO_NUMBER_INVENTORY_PROVIDER,
  type TwilioNumberInventoryProvider,
} from "./twilio-number-inventory.provider";
import {
  TWILIO_NUMBER_ROUTING_PROVIDER,
  type TwilioNumberRoutingProvider,
} from "./twilio-number-routing.provider";
import { TwilioMediaStreamsWebSocketBridge } from "./twilio-media-streams.websocket-bridge";
import {
  PstnPremiumCallExecution,
  type PstnPremiumCallOutput,
} from "./pstn-premium-call-execution";
import { PstnCapacityObservability } from "../runtime-observability/pstn-capacity-observability";
import { PstnAdmissionCoordinator } from "./pstn-admission-coordinator";
import { InMemoryPstnCallAdmission } from "./in-memory-pstn-call-admission";
import {
  PSTN_CALL_ADMISSION,
  type PstnCallAdmission,
} from "./pstn-call-admission";
import { TelephonyService } from "./telephony.service";
import {
  PSTN_MEDIA_PROCESS_ROLE,
  PSTN_MEDIA_WORKER_READINESS,
  PSTN_MEDIA_WORKER_ID,
  PSTN_MEDIA_WORKER_RELEASE_ID,
  type PstnMediaProcessRole,
} from "./pstn-media-process-role";
import { PremiumPstnDispatchSnapshotResolver } from "./premium-pstn-dispatch-snapshot-resolver";
import { PstnRealtimeWorkerHostLifecycle } from "../realtime-worker/pstn-realtime-worker-host";
import { PSTN_PREMIUM_WORKER_AVAILABILITY } from "../realtime-worker/pstn-premium-worker-availability";
import { defaultPremiumRealtimeConversationPolicy } from "../premium-realtime-policy/premium-realtime-conversation-policy.models";

describe("Twilio Media Streams websocket bridge", () => {
  const sockets: WebSocket[] = [];

  afterEach(() => {
    while (sockets.length > 0) {
      sockets.pop()?.close();
    }
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("retains only recent completed session histories without evicting active session history", () => {
    const bridge = new TwilioMediaStreamsWebSocketBridge(
      {} as never,
      {} as never,
      {} as never,
      {
      onOwnershipLost: () => () => undefined,
      onOwnershipConfirmed: () => () => undefined,
      } as never,
      "api",
      undefined,
      undefined,
      undefined,
    );
    const internals = bridge as unknown as {
      attachments: Map<string, unknown>;
      registerActiveEventHistory(
        callSessionId: string,
        events: Array<{
          type: "connected";
          protocol: string;
          version: string;
          receivedAt: string;
        }>,
      ): void;
      retainCompletedEventHistory(callSessionId: string): void;
    };
    const event = {
      type: "connected" as const,
      protocol: "Call",
      version: "1.0.0",
      receivedAt: "2026-07-24T12:00:00.000Z",
    };

    internals.registerActiveEventHistory("reused-active-call", [event]);
    internals.retainCompletedEventHistory("reused-active-call");
    internals.registerActiveEventHistory("reused-active-call", [event]);
    internals.attachments.set("reused-active-call", {});
    for (let index = 0; index < 65; index += 1) {
      const callSessionId = `completed-call-${index}`;
      internals.registerActiveEventHistory(callSessionId, [event]);
      internals.retainCompletedEventHistory(callSessionId);
    }

    expect(bridge.getSessionEvents("completed-call-0")).toEqual([]);
    expect(bridge.getSessionEvents("completed-call-64")).toEqual([event]);
    expect(bridge.getSessionEvents("reused-active-call")).toEqual([event]);
  });

  it("rejects a renewed ownership confirmation when the durable fence is no longer owned", async () => {
    const bridge = new TwilioMediaStreamsWebSocketBridge(
      {} as never,
      {
        async fencePremiumCallOwnership() {
          return { outcome: "not_owner" as const };
        },
      } as never,
      undefined,
      {
        onOwnershipLost: () => () => undefined,
        onOwnershipConfirmed: () => () => undefined,
      } as never,
      "pstn-realtime-worker",
      "premium-worker-a",
      "release-a",
      undefined,
    );
    const internals = bridge as unknown as {
      handleAdmissionOwnershipConfirmed(input: {
        tenantId: string;
        callSessionId: string;
        runtime: "pstn-premium-realtime";
        workerId: string;
        ownershipEpoch: number;
        leaseExpiresAt: string;
        operation: "renew";
      }): Promise<void>;
    };

    await expect(internals.handleAdmissionOwnershipConfirmed({
      tenantId: "tenant-west-africa",
      callSessionId: "CA-durable-fence-rejected:telephony",
      runtime: "pstn-premium-realtime",
      workerId: "premium-worker-a",
      ownershipEpoch: 2,
      leaseExpiresAt: "2026-07-26T21:10:00.000Z",
      operation: "renew",
    })).rejects.toThrow("premium_call_durable_ownership_fence_rejected");
  });

  it("rejects premium media on the API process before consuming the stream token", async () => {
    const { app, phoneNumber, authToken } = await createRoutedTwilioApp({
      runtimeProfile: "premium-realtime",
      processRole: "api",
    });
    const telephonyService = app.get(TelephonyService);
    const authorize = vi.spyOn(
      telephonyService,
      "authorizeTwilioMediaStream",
    );
    const callSid = "CA-premium-api-role-rejected";
    const webhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: "EVT-premium-api-role-rejected",
      phoneNumber,
    });
    const streamUrl = extractTwilioStreamUrl(webhookResponse.text);
    const streamToken = extractTwilioStreamParameter(
      webhookResponse.text,
      "zaraStreamToken",
    );
    const socket = new WebSocket(
      `ws://127.0.0.1:${getListeningPort(app)}${streamUrl.pathname}`,
    );
    sockets.push(socket);
    await withTimeout(nextOpen(socket), "premium API-role websocket open");

    socket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid: "MZ-premium-api-role-rejected",
      token: streamToken,
      runtimePath: "pstn-premium-realtime",
    })));

    await expect(
      withTimeout(nextClose(socket), "premium API-role websocket close"),
    ).resolves.toEqual({
      code: 4403,
      reason: "runtime_not_served_by_process",
    });
    expect(authorize).not.toHaveBeenCalled();

    await app.close();
  }, 30_000);

  it("rejects a forged runtime path before consuming the signed premium token", async () => {
    const { app, moduleRef, phoneNumber, authToken } = await createRoutedTwilioApp({
      runtimeProfile: "premium-realtime",
      processRole: "api",
    });
    const telephonyService = app.get(TelephonyService);
    const authorize = vi.spyOn(
      telephonyService,
      "authorizeTwilioMediaStream",
    );
    const callSid = "CA-premium-forged-runtime";
    const webhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: "EVT-premium-forged-runtime",
      phoneNumber,
    });
    const streamUrl = extractTwilioStreamUrl(webhookResponse.text);
    const streamToken = extractTwilioStreamParameter(
      webhookResponse.text,
      "zaraStreamToken",
    );
    const socket = new WebSocket(
      `ws://127.0.0.1:${getListeningPort(app)}${streamUrl.pathname}`,
    );
    sockets.push(socket);
    await withTimeout(nextOpen(socket), "forged-runtime websocket open");

    socket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid: "MZ-premium-forged-runtime",
      token: streamToken,
      runtimePath: "pstn-sandwich",
    })));

    await expect(
      withTimeout(nextClose(socket), "forged-runtime websocket close"),
    ).resolves.toEqual({
      code: 4403,
      reason: "runtime_path_mismatch",
    });
    expect(authorize).not.toHaveBeenCalled();
    const repository = moduleRef.get(
      TELEPHONY_INCREMENTAL_REPOSITORY,
    ) as InMemoryTelephonyIncrementalRepository;
    expect(repository.callSetups.at(-1)?.mediaToken.consumedAt).toBeUndefined();

    await app.close();
  }, 30_000);

  it("rejects premium media on a non-ready worker before consuming the stream token", async () => {
    const { app, phoneNumber, authToken } = await createRoutedTwilioApp({
      runtimeProfile: "premium-realtime",
      workerAcceptingCalls: false,
    });
    const telephonyService = app.get(TelephonyService);
    const authorize = vi.spyOn(
      telephonyService,
      "authorizeTwilioMediaStream",
    );
    const callSid = "CA-premium-worker-not-ready";
    const webhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: "EVT-premium-worker-not-ready",
      phoneNumber,
    });
    const streamUrl = extractTwilioStreamUrl(webhookResponse.text);
    const streamToken = extractTwilioStreamParameter(
      webhookResponse.text,
      "zaraStreamToken",
    );
    const socket = new WebSocket(
      `ws://127.0.0.1:${getListeningPort(app)}${streamUrl.pathname}`,
    );
    sockets.push(socket);
    await withTimeout(nextOpen(socket), "non-ready worker websocket open");

    socket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid: "MZ-premium-worker-not-ready",
      token: streamToken,
      runtimePath: "pstn-premium-realtime",
    })));

    await expect(
      withTimeout(nextClose(socket), "non-ready worker websocket close"),
    ).resolves.toEqual({
      code: 1013,
      reason: "worker_not_accepting_calls",
    });
    expect(authorize).not.toHaveBeenCalled();
    await app.close();
  }, 30_000);

  it("rejects premium media on a worker other than the signed dispatch target before consuming the stream token", async () => {
    const { app, moduleRef, phoneNumber, authToken } =
      await createRoutedTwilioApp({
        runtimeProfile: "premium-realtime",
        workerId: "wrong-premium-worker",
      });
    const telephonyService = app.get(TelephonyService);
    const authorize = vi.spyOn(
      telephonyService,
      "authorizeTwilioMediaStream",
    );
    const callSid = "CA-premium-wrong-worker";
    const webhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: "EVT-premium-wrong-worker",
      phoneNumber,
    });
    const streamUrl = extractTwilioStreamUrl(webhookResponse.text);
    const streamToken = extractTwilioStreamParameter(
      webhookResponse.text,
      "zaraStreamToken",
    );
    const targetWorkerId = extractTwilioStreamParameter(
      webhookResponse.text,
      "zaraWorkerId",
    );
    const socket = new WebSocket(
      `ws://127.0.0.1:${getListeningPort(app)}${streamUrl.pathname}`,
    );
    sockets.push(socket);
    await withTimeout(nextOpen(socket), "wrong-worker websocket open");

    socket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid: "MZ-premium-wrong-worker",
      token: streamToken,
      runtimePath: "pstn-premium-realtime",
      workerId: targetWorkerId,
    })));

    await expect(
      withTimeout(nextClose(socket), "wrong-worker websocket close"),
    ).resolves.toEqual({
      code: 4403,
      reason: "target_worker_mismatch",
    });
    expect(authorize).not.toHaveBeenCalled();
    const repository = moduleRef.get(
      TELEPHONY_INCREMENTAL_REPOSITORY,
    ) as InMemoryTelephonyIncrementalRepository;
    expect(repository.callSetups.at(-1)?.mediaToken.consumedAt).toBeUndefined();

    await app.close();
  }, 30_000);

  it("rejects premium media from a different worker release before consuming the stream token", async () => {
    const { app, moduleRef, phoneNumber, authToken } =
      await createRoutedTwilioApp({
        runtimeProfile: "premium-realtime",
        workerReleaseId: "replacement-release",
      });
    const telephonyService = app.get(TelephonyService);
    const authorize = vi.spyOn(
      telephonyService,
      "authorizeTwilioMediaStream",
    );
    const callSid = "CA-premium-wrong-release";
    const webhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: "EVT-premium-wrong-release",
      phoneNumber,
    });
    const streamUrl = extractTwilioStreamUrl(webhookResponse.text);
    const streamToken = extractTwilioStreamParameter(
      webhookResponse.text,
      "zaraStreamToken",
    );
    const targetWorkerId = extractTwilioStreamParameter(
      webhookResponse.text,
      "zaraWorkerId",
    );
    const targetReleaseId = extractTwilioStreamParameter(
      webhookResponse.text,
      "zaraWorkerReleaseId",
    );
    const socket = new WebSocket(
      `ws://127.0.0.1:${getListeningPort(app)}${streamUrl.pathname}`,
    );
    sockets.push(socket);
    await withTimeout(nextOpen(socket), "wrong-release websocket open");

    socket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid: "MZ-premium-wrong-release",
      token: streamToken,
      runtimePath: "pstn-premium-realtime",
      workerId: targetWorkerId,
      workerReleaseId: targetReleaseId,
    })));

    await expect(
      withTimeout(nextClose(socket), "wrong-release websocket close"),
    ).resolves.toEqual({
      code: 4403,
      reason: "target_worker_release_mismatch",
    });
    expect(authorize).not.toHaveBeenCalled();
    const repository = moduleRef.get(
      TELEPHONY_INCREMENTAL_REPOSITORY,
    ) as InMemoryTelephonyIncrementalRepository;
    expect(repository.callSetups.at(-1)?.mediaToken.consumedAt).toBeUndefined();
    await app.close();
  }, 30_000);

  it("does not mutate lifecycle when the initial premium ownership fence rejects the worker", async () => {
    const start = vi.fn(async () => undefined);
    const { app, phoneNumber, authToken } = await createRoutedTwilioApp({
      runtimeProfile: "premium-realtime",
      premiumExecution: {
        start,
        async appendInboundFrame() {},
        acknowledgePlaybackMark() {},
        async stop() {},
      },
    });
    const telephonyService = app.get(TelephonyService);
    vi.spyOn(
      telephonyService,
      "fencePremiumCallOwnership",
    ).mockResolvedValue({ outcome: "not_owner" });
    const lifecycle = vi.spyOn(
      telephonyService,
      "recordPstnCallLifecycle",
    );
    const callSid = "CA-premium-fence-rejected";
    const webhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: "EVT-premium-fence-rejected",
      phoneNumber,
    });
    const streamUrl = extractTwilioStreamUrl(webhookResponse.text);
    const streamToken = extractTwilioStreamParameter(
      webhookResponse.text,
      "zaraStreamToken",
    );
    const socket = new WebSocket(
      `ws://127.0.0.1:${getListeningPort(app)}${streamUrl.pathname}`,
    );
    sockets.push(socket);
    await withTimeout(nextOpen(socket), "fence-rejected websocket open");
    const closed = nextClose(socket);
    socket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid: "MZ-premium-fence-rejected",
      token: streamToken,
      runtimePath: "pstn-premium-realtime",
    })));

    await expect(
      withTimeout(closed, "fence-rejected websocket close"),
    ).resolves.toEqual({
      code: 4409,
      reason: "premium_call_not_owned",
    });
    expect(start).not.toHaveBeenCalled();
    expect(lifecycle).not.toHaveBeenCalled();

    await app.close();
  }, 30_000);

  it("does not start premium execution when media-connected persistence is rejected", async () => {
    const start = vi.fn(async () => undefined);
    const { app, phoneNumber, authToken } = await createRoutedTwilioApp({
      runtimeProfile: "premium-realtime",
      premiumExecution: {
        start,
        async appendInboundFrame() {},
        acknowledgePlaybackMark() {},
        async stop() {},
      },
    });
    const telephonyService = app.get(TelephonyService);
    vi.spyOn(
      telephonyService,
      "recordPstnCallLifecycle",
    ).mockResolvedValueOnce({ outcome: "not_found" });
    const callSid = "CA-premium-media-connected-rejected";
    const webhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: "EVT-premium-media-connected-rejected",
      phoneNumber,
    });
    const streamUrl = extractTwilioStreamUrl(webhookResponse.text);
    const streamToken = extractTwilioStreamParameter(
      webhookResponse.text,
      "zaraStreamToken",
    );
    const socket = new WebSocket(
      `ws://127.0.0.1:${getListeningPort(app)}${streamUrl.pathname}`,
    );
    sockets.push(socket);
    await withTimeout(nextOpen(socket), "media-connected-rejected websocket open");
    const closed = nextClose(socket);
    socket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid: "MZ-premium-media-connected-rejected",
      token: streamToken,
      runtimePath: "pstn-premium-realtime",
    })));

    await expect(
      withTimeout(closed, "media-connected-rejected websocket close"),
    ).resolves.toEqual({
      code: 4409,
      reason: "premium_call_lifecycle_rejected",
    });
    expect(start).not.toHaveBeenCalled();
    await app.close();
  }, 30_000);

  it("starts premium execution when an active status callback precedes media connection", async () => {
    const start = vi.fn(async () => undefined);
    const { app, phoneNumber, authToken } = await createRoutedTwilioApp({
      runtimeProfile: "premium-realtime",
      premiumExecution: {
        start,
        async appendInboundFrame() {},
        acknowledgePlaybackMark() {},
        async stop() {},
      },
    });
    const telephonyService = app.get(TelephonyService);
    const callSid = "CA-premium-active-before-media";
    const webhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: "EVT-premium-active-before-media",
      phoneNumber,
    });
    await expect(telephonyService.recordPstnCallLifecycle({
      organizationId: "tenant-west-africa",
      callSessionId: `${callSid}:telephony`,
      stage: "active",
      at: "2026-07-25T20:00:00.000Z",
    })).resolves.toMatchObject({ outcome: "applied" });
    const streamUrl = extractTwilioStreamUrl(webhookResponse.text);
    const streamToken = extractTwilioStreamParameter(
      webhookResponse.text,
      "zaraStreamToken",
    );
    const socket = new WebSocket(
      `ws://127.0.0.1:${getListeningPort(app)}${streamUrl.pathname}`,
    );
    sockets.push(socket);
    await withTimeout(nextOpen(socket), "active-before-media websocket open");
    socket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid: "MZ-premium-active-before-media",
      token: streamToken,
      runtimePath: "pstn-premium-realtime",
    })));

    await withTimeout(
      waitFor(() => start.mock.calls.length === 1),
      "active-before-media premium execution start",
    );
    socket.terminate();
    await app.close();
  }, 30_000);

  it("does not consume a sandwich media token when a worker attempts to claim it", async () => {
    const { app, moduleRef, phoneNumber, authToken } = await createRoutedTwilioApp();
    await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid: "CA-sandwich-worker-claim",
      eventSid: "EVT-sandwich-worker-claim",
      phoneNumber,
    });
    const repository = moduleRef.get(
      TELEPHONY_INCREMENTAL_REPOSITORY,
    ) as InMemoryTelephonyIncrementalRepository;
    const setup = repository.callSetups.at(-1);
    if (setup === undefined) {
      throw new Error("Expected the webhook to persist a call setup.");
    }
    const claim = {
      tenantId: setup.mediaToken.tenantId,
      callSessionId: setup.mediaToken.callSessionId,
      dispatchId: setup.mediaToken.dispatchId,
      connectionId: setup.mediaToken.connectionId,
      tokenHash: setup.mediaToken.tokenHash,
    };

    await expect(
      repository.claimMediaToken({
        ...claim,
        workerId: "premium-worker-forged",
      }),
    ).resolves.toEqual({ outcome: "conflict" });
    expect(setup.mediaToken.consumedAt).toBeUndefined();
    await expect(repository.claimMediaToken(claim)).resolves.toMatchObject({
      outcome: "claimed",
    });

    await app.close();
  }, 30_000);

  it("bridges verified Twilio media streams and sends only Twilio media mark and clear messages outbound", async () => {
    const logs: string[] = [];
    const capacityEvents: string[] = [];
    vi.spyOn(Logger.prototype, "log").mockImplementation((message: unknown) => {
      logs.push(String(message));
    });
    const { app, moduleRef, phoneNumber, authToken } = await createRoutedTwilioApp({
      capacityObservability: {
        openSocket(input: { leg: string }) { capacityEvents.push(`socket:${input.leg}`); },
        updateSocketContext() { capacityEvents.push("socket:authorized"); },
        recordSocketHandshake(input: { outcome: string }) {
          capacityEvents.push(`handshake:${input.outcome}`);
        },
        recordSocketTraffic(input: { direction: string }) {
          capacityEvents.push(`traffic:${input.direction}`);
        },
        recordSocketBuffered() { capacityEvents.push("socket:buffered"); },
        closeSocket(input: { initiator: string }) { capacityEvents.push(`close:${input.initiator}`); },
        trackCall() {},
        endCall() {},
        recordQueue() {},
        recordQueueDrop() {},
        clearCallQueues() {},
        recordAdmission() {},
        recordAdmissionLease() {},
        recordAdmissionBackendHealth() {},
      } as never,
    });
    const callSid = "CA-websocket-1";
    const callSessionId = `${callSid}:telephony`;
    const streamSid = "MZ-websocket-1";
    const activateAdmission = vi.spyOn(
      moduleRef.get(PstnAdmissionCoordinator),
      "activate",
    );

    const webhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: "EVT-websocket-1",
      phoneNumber,
    });
    const streamUrl = extractTwilioStreamUrl(webhookResponse.text);
    const streamToken = extractTwilioStreamParameter(webhookResponse.text, "zaraStreamToken");
    expect(streamUrl.search).toBe("");

    const port = getListeningPort(app);
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}${streamUrl.pathname}`,
    );
    sockets.push(socket);
    await withTimeout(nextOpen(socket), "twilio websocket open");

    socket.send(JSON.stringify({
      event: "connected",
      protocol: "Call",
      version: "1.0.0",
    }));
    socket.send(JSON.stringify({
      event: "start",
      sequenceNumber: "1",
      streamSid,
      start: {
        accountSid: "AC1234567890abcdef1234567890abcd",
        callSid,
        streamSid,
        tracks: ["inbound"],
        mediaFormat: {
          encoding: "audio/x-mulaw",
          sampleRate: 8000,
          channels: 1,
        },
        customParameters: {
          zaraStreamToken: streamToken,
          zaraCallSessionId: "forged-value-is-ignored",
          zaraRuntimePath: "pstn-sandwich",
        },
      },
    }));
    socket.send(JSON.stringify({
      event: "media",
      sequenceNumber: "2",
      streamSid,
      media: {
        track: "inbound",
        chunk: "1",
        timestamp: "20",
        payload: "//////////8=",
      },
    }));
    socket.send(JSON.stringify({
      event: "dtmf",
      sequenceNumber: "3",
      streamSid,
      dtmf: {
        track: "inbound_track",
        digit: "7",
      },
    }));

    const bridge = moduleRef.get(TwilioMediaStreamsWebSocketBridge);
    await withTimeout(waitFor(() => bridge.getSessionEvents(callSessionId).some((event) => event.type === "media")), "media event");
    expect(activateAdmission).toHaveBeenCalledWith(
      "tenant-west-africa",
      callSessionId,
      {
        provider: "twilio",
        providerAccountId: "AC1234567890abcdef1234567890abcd",
        runtime: "pstn-sandwich",
      },
    );
    const incrementalRepository = moduleRef.get(
      TELEPHONY_INCREMENTAL_REPOSITORY,
    ) as InMemoryTelephonyIncrementalRepository;
    await withTimeout(
      waitFor(() => incrementalRepository.callLifecycleTransitions.length >= 2),
      "sandwich lifecycle activation",
    );
    expect(
      incrementalRepository.callLifecycleTransitions.map((transition) => transition.nextState.stage),
    ).toEqual(["media-connected", "active"]);
    await withTimeout(waitFor(async () => {
      const stateResponse = await request(app.getHttpServer()).get("/organizations/tenant-west-africa/telephony/state");
      return JSON.stringify(stateResponse.body).includes("dtmf.received");
    }), "dtmf event persisted");
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.stringContaining("[twilio-pstn] media_socket_open"),
        expect.stringContaining("[twilio-pstn] media_start_received"),
        expect.stringContaining("[twilio-pstn] media_start_authorized"),
        expect.stringContaining("[twilio-pstn] media_started"),
        expect.stringContaining("[twilio-pstn] media_first_frame"),
      ]),
    );
    const serializedLogs = logs.join("\n");
    expect(serializedLogs).not.toContain(streamToken);
    expect(serializedLogs).not.toContain("//////////8=");

    const events = bridge.getSessionEvents(callSessionId);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "started",
          callSid,
          streamSid,
          codec: {
            name: "g711_mulaw",
            sampleRateHz: 8000,
            channels: 1,
          },
        }),
        expect.objectContaining({
          type: "media",
          provider: expect.objectContaining({
            callSid,
            streamSid,
            sequenceNumber: "2",
            track: "inbound",
          }),
          frame: expect.objectContaining({
            callSessionId,
            mediaStreamId: streamSid,
            direction: "inbound",
            sequence: 2,
            timestampMs: 20,
          }),
        }),
      ]),
    );

    bridge.sendOutboundMedia({
      callSessionId,
      frame: {
        callSessionId,
        mediaStreamId: streamSid,
        direction: "outbound",
        codec: {
          name: "g711_mulaw",
          sampleRateHz: 8000,
          channels: 1,
        },
        sequence: 1,
        timestampMs: 40,
        payloadBase64: "AAAA////",
      },
    });
    expect(await withTimeout(nextMessage(socket), "outbound media")).toEqual({
      event: "media",
      streamSid,
      media: {
        payload: "AAAA////",
      },
    });

    bridge.sendMark({ callSessionId, name: "response-1" });
    expect(await withTimeout(nextMessage(socket), "outbound mark")).toEqual({
      event: "mark",
      streamSid,
      mark: {
        name: "response-1",
      },
    });

    bridge.clearBufferedAudio({ callSessionId });
    expect(await withTimeout(nextMessage(socket), "outbound clear")).toEqual({
      event: "clear",
      streamSid,
    });

    socket.send(JSON.stringify({
      event: "stop",
      sequenceNumber: "4",
      streamSid,
      stop: {
        accountSid: "AC1234567890abcdef1234567890abcd",
        callSid,
      },
    }));
    const close = await withTimeout(nextClose(socket), "twilio stop close");
    expect(close.code).toBe(1000);
    expect(close.reason).toBe("twilio_stop");
    expect(
      incrementalRepository.callLifecycleTransitions.map((transition) => transition.nextState.stage),
    ).toEqual(["media-connected", "active", "draining", "completed"]);
    expect(capacityEvents).toEqual(expect.arrayContaining([
      "socket:twilio",
      "socket:authorized",
      "handshake:accepted",
      "traffic:inbound",
      "traffic:outbound",
      "socket:buffered",
      "close:local",
    ]));

    const stateResponse = await request(app.getHttpServer()).get("/organizations/tenant-west-africa/telephony/state");
    expect(JSON.stringify(stateResponse.body)).not.toContain("//////////8=");
    expect(JSON.stringify(stateResponse.body)).not.toContain("forged-value-is-ignored");

    await app.close();
  }, 30_000);

  it("closes malformed media streams safely and prevents concurrent stream attachment", async () => {
    const recordDuplicateClaim = vi.fn();
    const { app, phoneNumber, authToken } = await createRoutedTwilioApp({
      capacityObservability: {
        openSocket() {},
        updateSocketContext() {},
        recordSocketHandshake() {},
        recordSocketTraffic() {},
        recordSocketBuffered() {},
        closeSocket() {},
        trackCall() {},
        endCall() {},
        recordQueue() {},
        recordQueueDrop() {},
        clearCallQueues() {},
        recordAdmission() {},
        recordAdmissionLease() {},
        recordAdmissionOwnershipLost() {},
        recordAdmissionBackendHealth() {},
        recordDuplicateClaim,
      },
    });
    const callSid = "CA-websocket-2";

    const webhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: "EVT-websocket-2",
      phoneNumber,
    });
    const streamUrl = extractTwilioStreamUrl(webhookResponse.text);
    const streamToken = extractTwilioStreamParameter(webhookResponse.text, "zaraStreamToken");
    expect(streamUrl.search).toBe("");

    const port = getListeningPort(app);
    const firstSocket = new WebSocket(
      `ws://127.0.0.1:${port}${streamUrl.pathname}`,
    );
    sockets.push(firstSocket);
    await withTimeout(nextOpen(firstSocket), "first twilio websocket open");

    const duplicateSocket = new WebSocket(
      `ws://127.0.0.1:${port}${streamUrl.pathname}`,
    );
    sockets.push(duplicateSocket);
    const duplicateClose = await withTimeout(nextClose(duplicateSocket), "duplicate close");
    expect(duplicateClose).toEqual({
      code: 4409,
      reason: "stream_already_connected",
    });
    expect(recordDuplicateClaim).toHaveBeenCalledWith({
      source: "media_socket",
    });

    firstSocket.send(JSON.stringify({
      event: "media",
      sequenceNumber: "1",
      streamSid: "MZ-missing-start",
      media: {
        track: "inbound",
        chunk: "1",
        timestamp: "20",
        payload: "//////////8=",
      },
    }));

    const malformedClose = await withTimeout(nextClose(firstSocket), "malformed media close");
    expect(malformedClose.code).toBe(4401);
    expect(malformedClose.reason).toBe("missing_stream_token");

    const bridge = app.get(TwilioMediaStreamsWebSocketBridge);
    const validSocket = new WebSocket(
      `ws://127.0.0.1:${port}${streamUrl.pathname}`,
    );
    sockets.push(validSocket);
    await withTimeout(nextOpen(validSocket), "valid twilio websocket open");
    validSocket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid: "MZ-websocket-2",
      token: streamToken,
    })));
    await withTimeout(waitFor(() => bridge.getSessionEvents(`${callSid}:telephony`).some((event) => event.type === "started")), "started event");
    validSocket.close();
    await withTimeout(nextClose(validSocket), "valid socket close");

    await app.close();
  }, 30_000);

  it("durably terminates an active sandwich call before application shutdown clears it", async () => {
    const { app, phoneNumber, authToken } = await createRoutedTwilioApp();
    const lifecycle = vi.spyOn(
      app.get(TelephonyService),
      "recordPstnCallLifecycle",
    );
    const callSid = "CA-sandwich-shutdown";
    const callSessionId = `${callSid}:telephony`;
    const webhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: "EVT-sandwich-shutdown",
      phoneNumber,
    });
    const streamUrl = extractTwilioStreamUrl(webhookResponse.text);
    const streamToken = extractTwilioStreamParameter(
      webhookResponse.text,
      "zaraStreamToken",
    );
    const socket = new WebSocket(
      `ws://127.0.0.1:${getListeningPort(app)}${streamUrl.pathname}`,
    );
    sockets.push(socket);
    await withTimeout(nextOpen(socket), "sandwich shutdown websocket open");
    socket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid: "MZ-sandwich-shutdown",
      token: streamToken,
    })));
    const bridge = app.get(TwilioMediaStreamsWebSocketBridge);
    await withTimeout(
      waitFor(() =>
        bridge
          .getSessionEvents(callSessionId)
          .some((event) => event.type === "started")),
      "sandwich shutdown start",
    );
    lifecycle.mockClear();

    await bridge.shutdown();

    expect(lifecycle).toHaveBeenCalledWith({
      organizationId: "tenant-west-africa",
      callSessionId,
      stage: "failed",
      reasonCode: "app_shutdown",
    });
    socket.terminate();
    await app.close();
  }, 30_000);

  it("durably terminates an active call with the worker drain deadline reason", async () => {
    const { app, phoneNumber, authToken } = await createRoutedTwilioApp();
    const lifecycle = vi.spyOn(
      app.get(TelephonyService),
      "recordPstnCallLifecycle",
    );
    const callSid = "CA-worker-drain-deadline";
    const callSessionId = `${callSid}:telephony`;
    const webhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: "EVT-worker-drain-deadline",
      phoneNumber,
    });
    const streamUrl = extractTwilioStreamUrl(webhookResponse.text);
    const streamToken = extractTwilioStreamParameter(
      webhookResponse.text,
      "zaraStreamToken",
    );
    const socket = new WebSocket(
      `ws://127.0.0.1:${getListeningPort(app)}${streamUrl.pathname}`,
    );
    sockets.push(socket);
    await withTimeout(nextOpen(socket), "worker drain websocket open");
    socket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid: "MZ-worker-drain-deadline",
      token: streamToken,
    })));
    const bridge = app.get(TwilioMediaStreamsWebSocketBridge);
    await withTimeout(
      waitFor(() =>
        bridge
          .getSessionEvents(callSessionId)
          .some((event) => event.type === "started")),
      "worker drain start",
    );
    lifecycle.mockClear();

    await bridge.shutdown({
      reasonCode: "worker_drain_deadline",
      forcedCallCount: 1,
    });

    expect(lifecycle).toHaveBeenCalledWith({
      organizationId: "tenant-west-africa",
      callSessionId,
      stage: "failed",
      reasonCode: "worker_drain_deadline",
    });
    socket.terminate();
    await app.close();
  }, 30_000);

  it("retries an active sandwich terminalization that first fails during shutdown", async () => {
    const endCall = vi.fn();
    const { app, phoneNumber, authToken } = await createRoutedTwilioApp({
      capacityObservability: {
        openSocket() {},
        updateSocketContext() {},
        recordSocketHandshake() {},
        recordSocketTraffic() {},
        recordSocketBuffered() {},
        closeSocket() {},
        trackCall() {},
        endCall,
        recordQueue() {},
        recordQueueDrop() {},
        clearCallQueues() {},
        recordAdmission() {},
        recordAdmissionLease() {},
        recordAdmissionBackendHealth() {},
      },
    });
    const callSid = "CA-sandwich-shutdown-terminal-retry";
    const callSessionId = `${callSid}:telephony`;
    const webhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: "EVT-sandwich-shutdown-terminal-retry",
      phoneNumber,
    });
    const streamUrl = extractTwilioStreamUrl(webhookResponse.text);
    const streamToken = extractTwilioStreamParameter(
      webhookResponse.text,
      "zaraStreamToken",
    );
    const socket = new WebSocket(
      `ws://127.0.0.1:${getListeningPort(app)}${streamUrl.pathname}`,
    );
    sockets.push(socket);
    await withTimeout(nextOpen(socket), "sandwich shutdown retry websocket open");
    socket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid: "MZ-sandwich-shutdown-terminal-retry",
      token: streamToken,
    })));
    const bridge = app.get(TwilioMediaStreamsWebSocketBridge);
    await withTimeout(
      waitFor(() =>
        bridge
          .getSessionEvents(callSessionId)
          .some((event) => event.type === "started")),
      "sandwich shutdown retry start",
    );
    const lifecycle = vi
      .spyOn(app.get(TelephonyService), "recordPstnCallLifecycle")
      .mockRejectedValueOnce(new Error("lifecycle database unavailable"));
    const closed = nextClose(socket);

    await expect(bridge.shutdown()).resolves.toBeUndefined();
    await withTimeout(closed, "sandwich shutdown retry close");

    expect(lifecycle).toHaveBeenCalledTimes(2);
    expect(lifecycle).toHaveBeenLastCalledWith({
      organizationId: "tenant-west-africa",
      callSessionId,
      stage: "failed",
      reasonCode: "app_shutdown",
    });
    expect(endCall).toHaveBeenCalledTimes(1);
    expect(endCall).toHaveBeenCalledWith({
      callId: callSessionId,
      outcome: "failed",
    });

    socket.terminate();
    await app.close();
    expect(lifecycle).toHaveBeenCalledTimes(2);
    expect(endCall).toHaveBeenCalledTimes(1);
  }, 30_000);

  it("waits for queued media authorization before terminalizing application shutdown", async () => {
    const { app, phoneNumber, authToken } = await createRoutedTwilioApp();
    const telephonyService = app.get(TelephonyService);
    const authorize = telephonyService.authorizeTwilioMediaStream.bind(
      telephonyService,
    );
    const authorizationGate = deferred<void>();
    const authorizeSpy = vi
      .spyOn(telephonyService, "authorizeTwilioMediaStream")
      .mockImplementation(async (input) => {
        await authorizationGate.promise;
        return authorize(input);
      });
    const lifecycle = vi.spyOn(
      telephonyService,
      "recordPstnCallLifecycle",
    );
    const callSid = "CA-sandwich-shutdown-queued-authorization";
    const callSessionId = `${callSid}:telephony`;
    const webhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: "EVT-sandwich-shutdown-queued-authorization",
      phoneNumber,
    });
    const streamUrl = extractTwilioStreamUrl(webhookResponse.text);
    const streamToken = extractTwilioStreamParameter(
      webhookResponse.text,
      "zaraStreamToken",
    );
    const socket = new WebSocket(
      `ws://127.0.0.1:${getListeningPort(app)}${streamUrl.pathname}`,
    );
    sockets.push(socket);
    await withTimeout(
      nextOpen(socket),
      "queued authorization websocket open",
    );
    socket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid: "MZ-sandwich-shutdown-queued-authorization",
      token: streamToken,
    })));
    await withTimeout(
      waitFor(() => authorizeSpy.mock.calls.length === 1),
      "queued authorization started",
    );

    const bridge = app.get(TwilioMediaStreamsWebSocketBridge);
    let shutdownFinished = false;
    const shutdown = bridge.shutdown().then(() => {
      shutdownFinished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(shutdownFinished).toBe(false);

    authorizationGate.resolve();
    await shutdown;
    expect(lifecycle).toHaveBeenCalledWith({
      organizationId: "tenant-west-africa",
      callSessionId,
      stage: "failed",
      reasonCode: "app_shutdown",
    });
    socket.terminate();
    await app.close();
  }, 30_000);

  it("surfaces durable lifecycle failures during application shutdown", async () => {
    const errors: string[] = [];
    vi.spyOn(Logger.prototype, "error").mockImplementation((message: unknown) => {
      errors.push(String(message));
    });
    const { app, phoneNumber, authToken } = await createRoutedTwilioApp();
    const callSid = "CA-sandwich-shutdown-failure";
    const callSessionId = `${callSid}:telephony`;
    const webhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: "EVT-sandwich-shutdown-failure",
      phoneNumber,
    });
    const streamUrl = extractTwilioStreamUrl(webhookResponse.text);
    const streamToken = extractTwilioStreamParameter(
      webhookResponse.text,
      "zaraStreamToken",
    );
    const socket = new WebSocket(
      `ws://127.0.0.1:${getListeningPort(app)}${streamUrl.pathname}`,
    );
    sockets.push(socket);
    await withTimeout(nextOpen(socket), "sandwich shutdown failure websocket open");
    socket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid: "MZ-sandwich-shutdown-failure",
      token: streamToken,
    })));
    const bridge = app.get(TwilioMediaStreamsWebSocketBridge);
    await withTimeout(
      waitFor(() =>
        bridge
          .getSessionEvents(callSessionId)
          .some((event) => event.type === "started")),
      "sandwich shutdown failure start",
    );
    const lifecycle = vi
      .spyOn(app.get(TelephonyService), "recordPstnCallLifecycle")
      .mockRejectedValue(new Error("lifecycle database unavailable"));
    const closed = nextClose(socket);

    await expect(bridge.shutdown()).rejects.toThrow(
      "Twilio media shutdown failed",
    );
    await withTimeout(closed, "sandwich shutdown failure close");
    expect(lifecycle).toHaveBeenCalledTimes(2);
    expect(
      errors.filter((message) =>
        message.includes("media_terminalization_failed"),
      ),
    ).toEqual([]);

    lifecycle.mockRestore();
    socket.terminate();
    await app.close();
  }, 30_000);

  it("automatically retries failed sandwich close terminalization and releases capacity once", async () => {
    const endCall = vi.fn();
    const { app, phoneNumber, authToken } = await createRoutedTwilioApp({
      capacityObservability: {
        openSocket() {},
        updateSocketContext() {},
        recordSocketHandshake() {},
        recordSocketTraffic() {},
        recordSocketBuffered() {},
        closeSocket() {},
        trackCall() {},
        endCall,
        recordQueue() {},
        recordQueueDrop() {},
        clearCallQueues() {},
        recordAdmission() {},
        recordAdmissionLease() {},
        recordAdmissionBackendHealth() {},
      },
    });
    const callSid = "CA-sandwich-close-terminal-retry";
    const callSessionId = `${callSid}:telephony`;
    const webhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: "EVT-sandwich-close-terminal-retry",
      phoneNumber,
    });
    const streamUrl = extractTwilioStreamUrl(webhookResponse.text);
    const streamToken = extractTwilioStreamParameter(
      webhookResponse.text,
      "zaraStreamToken",
    );
    const socket = new WebSocket(
      `ws://127.0.0.1:${getListeningPort(app)}${streamUrl.pathname}`,
    );
    sockets.push(socket);
    await withTimeout(nextOpen(socket), "sandwich terminal retry socket open");
    socket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid: "MZ-sandwich-close-terminal-retry",
      token: streamToken,
    })));
    const bridge = app.get(TwilioMediaStreamsWebSocketBridge);
    await withTimeout(
      waitFor(() =>
        bridge
          .getSessionEvents(callSessionId)
          .some((event) => event.type === "started")),
      "sandwich terminal retry start",
    );
    const lifecycle = vi
      .spyOn(app.get(TelephonyService), "recordPstnCallLifecycle")
      .mockRejectedValueOnce(new Error("lifecycle database unavailable"));

    const closed = nextClose(socket);
    socket.terminate();
    await withTimeout(closed, "sandwich terminal retry socket close");
    await withTimeout(
      waitFor(() => lifecycle.mock.calls.length === 1),
      "sandwich terminal retry first persistence attempt",
    );
    expect(endCall).not.toHaveBeenCalled();

    await withTimeout(
      waitFor(() => lifecycle.mock.calls.length === 2, 3_000),
      "sandwich terminal automatic retry",
      4_000,
    );
    expect(lifecycle).toHaveBeenCalledTimes(2);
    expect(lifecycle).toHaveBeenLastCalledWith({
      organizationId: "tenant-west-africa",
      callSessionId,
      stage: "failed",
      reasonCode: "twilio_media_socket_closed_1006",
    });
    expect(endCall).toHaveBeenCalledTimes(1);
    expect(endCall).toHaveBeenCalledWith({
      callId: callSessionId,
      outcome: "failed",
    });

    await expect(bridge.shutdown()).resolves.toBeUndefined();
    await app.close();
    expect(lifecycle).toHaveBeenCalledTimes(2);
    expect(endCall).toHaveBeenCalledTimes(1);
  }, 30_000);

  it("keeps a repeatedly failing sandwich terminalization owned for shutdown retry", async () => {
    const endCall = vi.fn();
    const { app, phoneNumber, authToken } = await createRoutedTwilioApp({
      capacityObservability: {
        openSocket() {},
        updateSocketContext() {},
        recordSocketHandshake() {},
        recordSocketTraffic() {},
        recordSocketBuffered() {},
        closeSocket() {},
        trackCall() {},
        endCall,
        recordQueue() {},
        recordQueueDrop() {},
        clearCallQueues() {},
        recordAdmission() {},
        recordAdmissionLease() {},
        recordAdmissionBackendHealth() {},
      },
    });
    const callSid = "CA-sandwich-close-terminal-exhausted";
    const callSessionId = `${callSid}:telephony`;
    const webhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: "EVT-sandwich-close-terminal-exhausted",
      phoneNumber,
    });
    const streamUrl = extractTwilioStreamUrl(webhookResponse.text);
    const streamToken = extractTwilioStreamParameter(
      webhookResponse.text,
      "zaraStreamToken",
    );
    const socket = new WebSocket(
      `ws://127.0.0.1:${getListeningPort(app)}${streamUrl.pathname}`,
    );
    sockets.push(socket);
    await withTimeout(nextOpen(socket), "sandwich exhausted retry socket open");
    socket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid: "MZ-sandwich-close-terminal-exhausted",
      token: streamToken,
    })));
    const bridge = app.get(TwilioMediaStreamsWebSocketBridge);
    await withTimeout(
      waitFor(() =>
        bridge
          .getSessionEvents(callSessionId)
          .some((event) => event.type === "started")),
      "sandwich exhausted retry start",
    );
    let persistenceAvailable = false;
    const lifecycle = vi
      .spyOn(app.get(TelephonyService), "recordPstnCallLifecycle")
      .mockImplementation(async () => {
        if (!persistenceAvailable) {
          throw new Error("lifecycle database unavailable");
        }
        return { outcome: "not_found" };
      });

    const closed = nextClose(socket);
    socket.terminate();
    await withTimeout(closed, "sandwich exhausted retry socket close");
    await withTimeout(
      waitFor(() => lifecycle.mock.calls.length === 2, 3_000),
      "sandwich terminal retries continue at bounded backoff",
      4_000,
    );
    expect(lifecycle).toHaveBeenCalledTimes(2);
    expect(endCall).not.toHaveBeenCalled();

    persistenceAvailable = true;
    await expect(bridge.shutdown()).resolves.toBeUndefined();
    expect(lifecycle).toHaveBeenCalledTimes(3);
    expect(endCall).toHaveBeenCalledTimes(1);

    await app.close();
    expect(lifecycle).toHaveBeenCalledTimes(3);
    expect(endCall).toHaveBeenCalledTimes(1);
  }, 30_000);

  it("durably terminates an active premium call before application shutdown clears it", async () => {
    let finishStop: (() => void) | undefined;
    const stop = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishStop = resolve;
        }),
    );
    const { app, phoneNumber, authToken } = await createRoutedTwilioApp({
      runtimeProfile: "premium-realtime",
      premiumExecution: {
        async start() {},
        async appendInboundFrame() {},
        acknowledgePlaybackMark() {},
        stop,
      },
    });
    const callSid = "CA-premium-shutdown";
    const callSessionId = `${callSid}:telephony`;
    const webhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: "EVT-premium-shutdown",
      phoneNumber,
    });
    const streamUrl = extractTwilioStreamUrl(webhookResponse.text);
    const streamToken = extractTwilioStreamParameter(
      webhookResponse.text,
      "zaraStreamToken",
    );
    const socket = new WebSocket(
      `ws://127.0.0.1:${getListeningPort(app)}${streamUrl.pathname}`,
    );
    sockets.push(socket);
    await withTimeout(nextOpen(socket), "premium shutdown websocket open");
    socket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid: "MZ-premium-shutdown",
      token: streamToken,
      runtimePath: "pstn-premium-realtime",
    })));
    const bridge = app.get(TwilioMediaStreamsWebSocketBridge);
    await withTimeout(
      waitFor(() =>
        bridge
          .getSessionEvents(callSessionId)
          .some((event) => event.type === "started")),
      "premium shutdown start",
    );

    let shutdownFinished = false;
    const shutdown = bridge.shutdown().then(() => {
      shutdownFinished = true;
    });
    await withTimeout(waitFor(() => stop.mock.calls.length === 1), "premium shutdown stop");

    expect(stop).toHaveBeenCalledWith({
      callSessionId,
      outcome: "failed",
      reasonCode: "app_shutdown",
    });
    expect(shutdownFinished).toBe(false);
    finishStop?.();
    await shutdown;
    expect(shutdownFinished).toBe(true);
    socket.terminate();
    await app.close();
  }, 30_000);

  it("retries a premium terminalization failure before admission shutdown completes", async () => {
    const stop = vi
      .fn()
      .mockRejectedValueOnce(new Error("premium terminal persistence failed"))
      .mockResolvedValue(undefined);
    const shutdownPremiumExecution = vi.fn(async () => {
      await stop({
        callSessionId: "CA-premium-close-terminal-failure:telephony",
        outcome: "failed",
        reasonCode: "app_shutdown",
      });
    });
    const { app, phoneNumber, authToken } = await createRoutedTwilioApp({
      runtimeProfile: "premium-realtime",
      premiumExecution: {
        async start() {},
        async appendInboundFrame() {},
        acknowledgePlaybackMark() {},
        stop,
        shutdown: shutdownPremiumExecution,
      },
    });
    const callSid = "CA-premium-close-terminal-failure";
    const webhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: "EVT-premium-close-terminal-failure",
      phoneNumber,
    });
    const streamUrl = extractTwilioStreamUrl(webhookResponse.text);
    const streamToken = extractTwilioStreamParameter(
      webhookResponse.text,
      "zaraStreamToken",
    );
    const socket = new WebSocket(
      `ws://127.0.0.1:${getListeningPort(app)}${streamUrl.pathname}`,
    );
    sockets.push(socket);
    await withTimeout(nextOpen(socket), "premium terminal failure socket open");
    socket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid: "MZ-premium-close-terminal-failure",
      token: streamToken,
      runtimePath: "pstn-premium-realtime",
    })));
    const coordinator = app.get(PstnAdmissionCoordinator);
    const shutdownAdmission = vi.spyOn(coordinator, "shutdown");
    const bridge = app.get(TwilioMediaStreamsWebSocketBridge);
    await withTimeout(
      waitFor(() =>
        bridge
          .getSessionEvents(`${callSid}:telephony`)
          .some((event) => event.type === "started")),
      "premium terminal failure start",
    );

    const closed = nextClose(socket);
    socket.terminate();
    await withTimeout(closed, "premium terminal failure socket close");
    await withTimeout(
      waitFor(() => stop.mock.calls.length === 1),
      "premium terminal failure stop",
    );

    const workerLifecycle = new PstnRealtimeWorkerHostLifecycle(
      { async connect() {} },
      {
        async start() {},
        async beginDrain() {
          return {
            completed: true as const,
            reason: "empty" as const,
            remainingCalls: 0,
          };
        },
        stop() {},
        getHealthPosture() {
          return { acceptingCalls: false };
        },
      },
      bridge,
      { shutdown: shutdownPremiumExecution },
      { shutdown: () => coordinator.shutdown() },
      { recordForcedDrain() {} },
    );
    await expect(
      workerLifecycle.beforeApplicationShutdown(),
    ).resolves.toBeUndefined();
    expect(stop).toHaveBeenCalledTimes(2);
    expect(shutdownPremiumExecution).toHaveBeenCalledOnce();
    expect(shutdownAdmission).toHaveBeenCalledOnce();
    await expect(app.close()).resolves.toBeUndefined();
  }, 30_000);

  it("logs a safe premium startup failure code before closing the Twilio media stream", async () => {
    const warnings: string[] = [];
    vi.spyOn(Logger.prototype, "warn").mockImplementation((message: unknown) => {
      warnings.push(String(message));
    });
    const { app, phoneNumber, authToken } = await createRoutedTwilioApp({
      runtimeProfile: "premium-realtime",
      premiumExecution: {
        async start() {
          throw new Error("The exact premium workflow manifest for this PSTN dispatch is unavailable or invalid.");
        },
        async appendInboundFrame() {},
        acknowledgePlaybackMark() {},
        async stop() {},
      } as never,
    });
    const callSid = "CA-premium-start-failure";
    const webhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: "EVT-premium-start-failure",
      phoneNumber,
    });
    const streamUrl = extractTwilioStreamUrl(webhookResponse.text);
    const streamToken = extractTwilioStreamParameter(webhookResponse.text, "zaraStreamToken");
    const socket = new WebSocket(`ws://127.0.0.1:${getListeningPort(app)}${streamUrl.pathname}`);
    sockets.push(socket);
    await withTimeout(nextOpen(socket), "premium startup failure websocket open");

    socket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid: "MZ-premium-start-failure",
      token: streamToken,
      runtimePath: "pstn-premium-realtime",
    })));

    await expect(withTimeout(nextClose(socket), "premium startup failure websocket close")).resolves.toEqual({
      code: 4400,
      reason: "premium_manifest_unavailable",
    });
    expect(warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("[twilio-pstn] media_handler_failed"),
      expect.stringContaining('"failureCode":"premium_manifest_unavailable"'),
    ]));

    await app.close();
  }, 30_000);

  it("forwards authorized premium media into call execution and returns its audio to Twilio", async () => {
    const starts: Array<{ callSessionId: string; output: PstnPremiumCallOutput }> = [];
    const frames: PstnAudioFrame[] = [];
    const playbackMarks: Array<{ callSessionId: string; name: string }> = [];
    const stops: Array<{
      callSessionId: string;
      outcome?: "completed" | "failed";
      reasonCode?: string;
    }> = [];
    const bridgeTerminalCalls: string[] = [];
    const premiumExecution = {
      async start(input: { callSessionId: string; output: PstnPremiumCallOutput }) {
        starts.push(input);
      },
      async appendInboundFrame(input: { frame: PstnAudioFrame }) {
        frames.push(input.frame);
      },
      acknowledgePlaybackMark(input: { callSessionId: string; name: string }) {
        playbackMarks.push(input);
      },
      async stop(input: {
        callSessionId: string;
        outcome?: "completed" | "failed";
        reasonCode?: string;
      }) {
        stops.push(input);
      },
    };
    const { app, phoneNumber, authToken } = await createRoutedTwilioApp({
      runtimeProfile: "premium-realtime",
      premiumExecution,
      capacityObservability: {
        openSocket() {},
        updateSocketContext() {},
        recordSocketHandshake() {},
        recordSocketTraffic() {},
        recordSocketBuffered() {},
        closeSocket() {},
        trackCall() {},
        endCall(input: { outcome: string }) { bridgeTerminalCalls.push(input.outcome); },
        recordQueue() {},
        recordQueueDrop() {},
        clearCallQueues() {},
        recordAdmission() {},
        recordAdmissionLease() {},
        recordAdmissionBackendHealth() {},
      },
    });
    const callSid = "CA-premium-execution";
    const callSessionId = `${callSid}:telephony`;
    const streamSid = "MZ-premium-execution";
    const webhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: "EVT-premium-execution",
      phoneNumber,
    });
    const streamUrl = extractTwilioStreamUrl(webhookResponse.text);
    const streamToken = extractTwilioStreamParameter(webhookResponse.text, "zaraStreamToken");
    const socket = new WebSocket(`ws://127.0.0.1:${getListeningPort(app)}${streamUrl.pathname}`);
    sockets.push(socket);
    await withTimeout(nextOpen(socket), "premium websocket open");
    socket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid,
      token: streamToken,
      runtimePath: "pstn-premium-realtime",
    })));
    await withTimeout(
      waitFor(() => starts.length === 1),
      "premium execution start",
    );

    socket.send(JSON.stringify({
      event: "media",
      sequenceNumber: "2",
      streamSid,
      media: {
        track: "inbound",
        chunk: "1",
        timestamp: "20",
        payload: "//////////8=",
      },
    }));
    await withTimeout(waitFor(() => frames.length === 1), "premium inbound frame");
    expect(frames[0]).toMatchObject({
      callSessionId,
      mediaStreamId: streamSid,
      direction: "inbound",
    });

    const outboundMessage = nextMessage(socket);
    starts[0]!.output.sendMedia({
      callSessionId,
      mediaStreamId: streamSid,
      direction: "outbound",
      codec: { name: "g711_mulaw", sampleRateHz: 8000, channels: 1 },
      sequence: 1,
      timestampMs: 20,
      payloadBase64: "AAAA////",
    });
    await expect(withTimeout(outboundMessage, "premium outbound media")).resolves.toEqual({
      event: "media",
      streamSid,
      media: { payload: "AAAA////" },
    });

    socket.send(JSON.stringify({
      event: "mark",
      sequenceNumber: "3",
      streamSid,
      mark: { name: "premium-playback:0:1" },
    }));
    await withTimeout(waitFor(() => playbackMarks.length === 1), "premium playback mark");
    expect(playbackMarks).toEqual([{
      callSessionId,
      name: "premium-playback:0:1",
    }]);

    socket.send(JSON.stringify({
      event: "stop",
      sequenceNumber: "4",
      streamSid,
      stop: { accountSid: "AC1234567890abcdef1234567890abcd", callSid },
    }));
    await withTimeout(nextClose(socket), "premium websocket close");
    await withTimeout(waitFor(() => stops.length > 0), "premium execution stop");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(stops).toEqual([{
      callSessionId,
      outcome: "completed",
      reasonCode: "twilio_stop",
    }]);
    expect(bridgeTerminalCalls).toEqual([]);
    await app.close();
  }, 30_000);

  it("stops premium execution and persists failure when admission ownership is lost", async () => {
    const stop = vi.fn(async () => undefined);
    const { app, phoneNumber, authToken } = await createRoutedTwilioApp({
      runtimeProfile: "premium-realtime",
      premiumExecution: {
        async start() {},
        async appendInboundFrame() {},
        acknowledgePlaybackMark() {},
        stop,
      },
    });
    const callSid = "CA-premium-ownership-lost";
    const callSessionId = `${callSid}:telephony`;
    const webhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: "EVT-premium-ownership-lost",
      phoneNumber,
    });
    const streamUrl = extractTwilioStreamUrl(webhookResponse.text);
    const streamToken = extractTwilioStreamParameter(
      webhookResponse.text,
      "zaraStreamToken",
    );
    const socket = new WebSocket(
      `ws://127.0.0.1:${getListeningPort(app)}${streamUrl.pathname}`,
    );
    sockets.push(socket);
    await withTimeout(nextOpen(socket), "ownership-lost websocket open");
    socket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid: "MZ-premium-ownership-lost",
      token: streamToken,
      runtimePath: "pstn-premium-realtime",
    })));
    const bridge = app.get(TwilioMediaStreamsWebSocketBridge);
    await withTimeout(
      waitFor(() =>
        bridge
          .getSessionEvents(callSessionId)
          .some((event) => event.type === "started")),
      "ownership-lost premium execution start",
    );
    const lifecycle = vi.spyOn(
      app.get(TelephonyService),
      "recordPstnCallLifecycle",
    );
    const closed = nextClose(socket);

    await (
      bridge as unknown as {
        handleAdmissionOwnershipLost(input: {
          tenantId: string;
          callSessionId: string;
          runtime: "pstn-premium-realtime";
          reason: "not_owner";
        }): Promise<void>;
      }
    ).handleAdmissionOwnershipLost({
      tenantId: "tenant-west-africa",
      callSessionId,
      runtime: "pstn-premium-realtime",
      reason: "not_owner",
    });

    await expect(
      withTimeout(closed, "ownership-lost websocket close"),
    ).resolves.toEqual({
      code: 4409,
      reason: "premium_call_ownership_lost",
    });
    expect(stop).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledWith({
      callSessionId,
      outcome: "failed",
      reasonCode: "pstn_admission_ownership_lost",
    });
    expect(lifecycle).not.toHaveBeenCalled();

    await app.close();
  }, 30_000);

  it("closes premium media fail-stop when ownership-loss cleanup fails", async () => {
    const stop = vi.fn(async () => {
      throw new Error("provider stop failed");
    });
    const { app, phoneNumber, authToken } = await createRoutedTwilioApp({
      runtimeProfile: "premium-realtime",
      premiumExecution: {
        async start() {},
        async appendInboundFrame() {},
        acknowledgePlaybackMark() {},
        stop,
      },
    });
    const callSid = "CA-premium-ownership-lost-cleanup-failure";
    const callSessionId = `${callSid}:telephony`;
    const webhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: "EVT-premium-ownership-lost-cleanup-failure",
      phoneNumber,
    });
    const streamUrl = extractTwilioStreamUrl(webhookResponse.text);
    const streamToken = extractTwilioStreamParameter(
      webhookResponse.text,
      "zaraStreamToken",
    );
    const socket = new WebSocket(
      `ws://127.0.0.1:${getListeningPort(app)}${streamUrl.pathname}`,
    );
    sockets.push(socket);
    await withTimeout(nextOpen(socket), "ownership-lost cleanup websocket open");
    socket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid: "MZ-premium-ownership-lost-cleanup-failure",
      token: streamToken,
      runtimePath: "pstn-premium-realtime",
    })));
    const bridge = app.get(TwilioMediaStreamsWebSocketBridge);
    await withTimeout(
      waitFor(() =>
        bridge
          .getSessionEvents(callSessionId)
          .some((event) => event.type === "started")),
      "ownership-lost cleanup premium execution start",
    );
    vi.spyOn(
      app.get(TelephonyService),
      "recordPstnCallLifecycle",
    ).mockRejectedValueOnce(new Error("lifecycle persistence failed"));
    const closed = nextClose(socket);

    await expect(
      (
        bridge as unknown as {
          handleAdmissionOwnershipLost(input: {
            tenantId: string;
            callSessionId: string;
            runtime: "pstn-premium-realtime";
            reason: "not_owner";
          }): Promise<void>;
        }
      ).handleAdmissionOwnershipLost({
        tenantId: "tenant-west-africa",
        callSessionId,
        runtime: "pstn-premium-realtime",
        reason: "not_owner",
      }),
    ).resolves.toBeUndefined();

    await expect(
      withTimeout(closed, "ownership-lost cleanup websocket close"),
    ).resolves.toEqual({
      code: 4409,
      reason: "premium_call_ownership_lost",
    });
    expect(stop).toHaveBeenCalledOnce();
    await app.close();
  }, 30_000);

  it.each([
    {
      title: "fails premium execution when an authorized Twilio media socket closes abnormally",
      suffix: "abnormal-close",
      closeCode: 1001,
      expectedReasonCode: "twilio_media_socket_closed_1001",
    },
    {
      title: "fails premium execution when code 1000 arrives without a validated Twilio stop",
      suffix: "clean-close-without-stop",
      closeCode: 1000,
      expectedReasonCode: "twilio_media_socket_closed_without_stop",
    },
  ])("$title", async ({ suffix, closeCode, expectedReasonCode }) => {
    const stops: Array<{
      callSessionId: string;
      outcome?: "completed" | "failed";
      reasonCode?: string;
    }> = [];
    const { app, phoneNumber, authToken } = await createRoutedTwilioApp({
      runtimeProfile: "premium-realtime",
      premiumExecution: {
        async start() {},
        async appendInboundFrame() {},
        acknowledgePlaybackMark() {},
        async stop(input) {
          stops.push({
            callSessionId: input.callSessionId,
            ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
            ...(input.reasonCode === undefined ? {} : { reasonCode: input.reasonCode }),
          });
        },
      },
    });
    const callSid = `CA-premium-${suffix}`;
    const callSessionId = `${callSid}:telephony`;
    const webhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: `EVT-premium-${suffix}`,
      phoneNumber,
    });
    const streamUrl = extractTwilioStreamUrl(webhookResponse.text);
    const streamToken = extractTwilioStreamParameter(webhookResponse.text, "zaraStreamToken");
    const socket = new WebSocket(`ws://127.0.0.1:${getListeningPort(app)}${streamUrl.pathname}`);
    sockets.push(socket);
    await withTimeout(nextOpen(socket), `premium ${suffix} websocket open`);
    socket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid: `MZ-premium-${suffix}`,
      token: streamToken,
      runtimePath: "pstn-premium-realtime",
    })));
    const bridge = app.get(TwilioMediaStreamsWebSocketBridge);
    await withTimeout(
      waitFor(() => bridge.getSessionEvents(callSessionId).some((event) => event.type === "started")),
      `premium ${suffix} start`,
    );

    socket.close(closeCode, "client_shutdown");
    await withTimeout(nextClose(socket), `premium ${suffix} websocket close`);
    await withTimeout(waitFor(() => stops.length === 1), `premium ${suffix} execution stop`);
    expect(stops).toEqual([{
      callSessionId,
      outcome: "failed",
      reasonCode: expectedReasonCode,
    }]);

    await app.close();
  }, 30_000);

  it("durably terminates a premium call when distributed activation fails before execution starts", async () => {
    const { app, phoneNumber, authToken } = await createRoutedTwilioApp({
      runtimeProfile: "premium-realtime",
    });
    vi.spyOn(
      app.get(PstnAdmissionCoordinator),
      "activate",
    ).mockResolvedValue({ outcome: "backend_unavailable" });
    const lifecycle = vi.spyOn(
      app.get(TelephonyService),
      "recordPstnCallLifecycle",
    );
    const callSid = "CA-premium-admission-activation";
    const callSessionId = `${callSid}:telephony`;
    const webhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: "EVT-premium-admission-activation",
      phoneNumber,
    });
    const streamUrl = extractTwilioStreamUrl(webhookResponse.text);
    const streamToken = extractTwilioStreamParameter(
      webhookResponse.text,
      "zaraStreamToken",
    );
    const socket = new WebSocket(
      `ws://127.0.0.1:${getListeningPort(app)}${streamUrl.pathname}`,
    );
    sockets.push(socket);
    await withTimeout(nextOpen(socket), "premium admission websocket open");
    const closePromise = nextClose(socket);
    socket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid: "MZ-premium-admission-activation",
      token: streamToken,
      runtimePath: "pstn-premium-realtime",
    })));

    await withTimeout(closePromise, "premium admission websocket close");
    expect(lifecycle).toHaveBeenCalledWith({
      organizationId: "tenant-west-africa",
      callSessionId,
      stage: "failed",
      reasonCode: "pstn_admission_activation_failed",
    });

    await app.close();
  }, 30_000);

  it("closes a premium media socket when startup processing exceeds the bounded ingress queue", async () => {
    const startGate = deferred<void>();
    const { app, phoneNumber, authToken } = await createRoutedTwilioApp({
      runtimeProfile: "premium-realtime",
      premiumExecution: {
        async start() { await startGate.promise; },
        async appendInboundFrame() {},
        acknowledgePlaybackMark() {},
        async stop() {},
      },
    });
    const callSid = "CA-premium-overflow";
    const streamSid = "MZ-premium-overflow";
    const webhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: "EVT-premium-overflow",
      phoneNumber,
    });
    const streamUrl = extractTwilioStreamUrl(webhookResponse.text);
    const streamToken = extractTwilioStreamParameter(webhookResponse.text, "zaraStreamToken");
    const socket = new WebSocket(`ws://127.0.0.1:${getListeningPort(app)}${streamUrl.pathname}`);
    sockets.push(socket);
    await withTimeout(nextOpen(socket), "premium overflow websocket open");
    const closed = nextClose(socket);
    socket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid,
      token: streamToken,
      runtimePath: "pstn-premium-realtime",
    })));
    socket.send(JSON.stringify({
      event: "media",
      sequenceNumber: "2",
      streamSid,
      media: {
        track: "inbound",
        chunk: "1",
        timestamp: "20",
        payload: Buffer.alloc(70 * 1_024, 0xff).toString("base64"),
      },
    }));

    await expect(withTimeout(closed, "premium ingress overflow close")).resolves.toEqual({
      code: 4408,
      reason: "twilio_media.ingress_overflow",
    });
    startGate.resolve();
    await app.close();
  }, 30_000);

  it("continues an owned premium media call on the worker after the API process stops", async () => {
    vi.stubEnv(
      "ZARA_STREAM_TOKEN_SECRET",
      "test-shared-worker-stream-token-secret",
    );
    const incrementalRepository =
      new InMemoryTelephonyIncrementalRepository();
    const admission = new InMemoryPstnCallAdmission();
    const workerStart = vi.fn(async () => undefined);
    const worker = await createRoutedTwilioApp({
      runtimeProfile: "premium-realtime",
      processRole: "pstn-realtime-worker",
      incrementalRepository,
      admission,
      premiumExecution: {
        start: workerStart,
        async appendInboundFrame() {},
        acknowledgePlaybackMark() {},
        async stop() {},
      },
    });
    const api = await createRoutedTwilioApp({
      runtimeProfile: "premium-realtime",
      processRole: "api",
      incrementalRepository,
      admission,
    });
    const callSid = "CA-premium-api-restart";
    const callSessionId = `${callSid}:telephony`;
    const webhookResponse = await answerViaVerifiedWebhook({
      app: api.app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken: api.authToken,
      callSid,
      eventSid: "EVT-premium-api-restart",
      phoneNumber: api.phoneNumber,
    });
    const streamUrl = extractTwilioStreamUrl(webhookResponse.text);
    const streamToken = extractTwilioStreamParameter(
      webhookResponse.text,
      "zaraStreamToken",
    );

    await api.app.close();

    const socket = new WebSocket(
      `ws://127.0.0.1:${getListeningPort(worker.app)}${streamUrl.pathname}`,
    );
    sockets.push(socket);
    await withTimeout(nextOpen(socket), "post-API-stop worker websocket open");
    socket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid: "MZ-premium-api-restart",
      token: streamToken,
      runtimePath: "pstn-premium-realtime",
    })));

    await withTimeout(
      waitFor(() => workerStart.mock.calls.length === 1),
      "post-API-stop premium worker execution start",
    );
    expect(workerStart).toHaveBeenCalledWith(
      expect.objectContaining({ callSessionId }),
    );

    socket.send(JSON.stringify({
      event: "stop",
      sequenceNumber: "2",
      streamSid: "MZ-premium-api-restart",
      stop: {
        accountSid: "AC1234567890abcdef1234567890abcd",
        callSid,
      },
    }));
    await withTimeout(nextClose(socket), "post-API-stop worker websocket close");
    await worker.app.close();
  }, 30_000);

  it("requires the server-minted Twilio stream token once before media attachment", async () => {
    const { app, phoneNumber, authToken } = await createRoutedTwilioApp();
    const callSid = "CA-websocket-token";

    const webhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid,
      eventSid: "EVT-websocket-token",
      phoneNumber,
    });
    const streamUrl = extractTwilioStreamUrl(webhookResponse.text);
    const streamToken = extractTwilioStreamParameter(webhookResponse.text, "zaraStreamToken");
    expect(streamUrl.search).toBe("");
    const otherWebhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid: "CA-websocket-token-other",
      eventSid: "EVT-websocket-token-other",
      phoneNumber,
    });
    const otherStreamUrl = extractTwilioStreamUrl(otherWebhookResponse.text);
    const otherStreamToken = extractTwilioStreamParameter(otherWebhookResponse.text, "zaraStreamToken");
    expect(otherStreamToken).toMatch(/\S/);

    const port = getListeningPort(app);
    const missingTokenSocket = new WebSocket(
      `ws://127.0.0.1:${port}${streamUrl.pathname}`,
    );
    sockets.push(missingTokenSocket);
    await withTimeout(nextOpen(missingTokenSocket), "missing token websocket open");
    missingTokenSocket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid: "MZ-websocket-missing-token",
    })));
    await expect(withTimeout(nextClose(missingTokenSocket), "missing stream token close")).resolves.toEqual({
      code: 4401,
      reason: "missing_stream_token",
    });

    const mismatchedAccountSocket = new WebSocket(
      `ws://127.0.0.1:${port}${otherStreamUrl.pathname}`,
    );
    sockets.push(mismatchedAccountSocket);
    await withTimeout(nextOpen(mismatchedAccountSocket), "mismatched account websocket open");
    mismatchedAccountSocket.send(JSON.stringify(createStartMessage({
      accountSid: "ACffffffffffffffffffffffffffffffff",
      callSid: "CA-websocket-token-other",
      streamSid: "MZ-websocket-mismatched-account",
      token: otherStreamToken,
    })));
    await expect(
      withTimeout(nextClose(mismatchedAccountSocket), "mismatched account close"),
    ).resolves.toEqual({
      code: 4401,
      reason: "provider_account_mismatch",
    });

    const missingAccountWebhookResponse = await answerViaVerifiedWebhook({
      app,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
      callSid: "CA-websocket-token-missing-account",
      eventSid: "EVT-websocket-token-missing-account",
      phoneNumber,
    });
    const missingAccountStreamUrl = extractTwilioStreamUrl(
      missingAccountWebhookResponse.text,
    );
    const missingAccountStreamToken = extractTwilioStreamParameter(
      missingAccountWebhookResponse.text,
      "zaraStreamToken",
    );
    const missingAccountSocket = new WebSocket(
      `ws://127.0.0.1:${port}${missingAccountStreamUrl.pathname}`,
    );
    sockets.push(missingAccountSocket);
    await withTimeout(
      nextOpen(missingAccountSocket),
      "missing account websocket open",
    );
    missingAccountSocket.send(JSON.stringify(createStartMessage({
      callSid: "CA-websocket-token-missing-account",
      omitAccountSid: true,
      streamSid: "MZ-websocket-missing-account",
      token: missingAccountStreamToken,
    })));
    await expect(
      withTimeout(nextClose(missingAccountSocket), "missing account close"),
    ).resolves.toEqual({
      code: 4401,
      reason: "provider_account_mismatch",
    });

    const mismatchedTokenSocket = new WebSocket(
      `ws://127.0.0.1:${port}${otherStreamUrl.pathname}`,
    );
    sockets.push(mismatchedTokenSocket);
    await withTimeout(nextOpen(mismatchedTokenSocket), "mismatched token websocket open");
    mismatchedTokenSocket.send(JSON.stringify(createStartMessage({
      callSid: "CA-websocket-token-other",
      streamSid: "MZ-websocket-mismatched-token",
      token: streamToken,
    })));
    await expect(withTimeout(nextClose(mismatchedTokenSocket), "mismatched stream token close")).resolves.toEqual({
      code: 4401,
      reason: "invalid_stream_token",
    });

    const socket = new WebSocket(
      `ws://127.0.0.1:${port}${streamUrl.pathname}`,
    );
    sockets.push(socket);
    await withTimeout(nextOpen(socket), "tokened twilio websocket open");
    socket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid: "MZ-websocket-token",
      token: streamToken,
    })));
    const bridge = app.get(TwilioMediaStreamsWebSocketBridge);
    await withTimeout(waitFor(() => bridge.getSessionEvents(`${callSid}:telephony`).some((event) => event.type === "started")), "tokened started event");
    socket.close();
    await withTimeout(nextClose(socket), "tokened twilio websocket close");

    const replaySocket = new WebSocket(
      `ws://127.0.0.1:${port}${streamUrl.pathname}`,
    );
    sockets.push(replaySocket);
    await withTimeout(nextOpen(replaySocket), "replayed token websocket open");
    replaySocket.send(JSON.stringify(createStartMessage({
      callSid,
      streamSid: "MZ-websocket-replayed-token",
      token: streamToken,
    })));
    await expect(withTimeout(nextClose(replaySocket), "replayed stream token close")).resolves.toEqual({
      code: 4401,
      reason: "invalid_stream_token",
    });

    await app.close();
  }, 30_000);
});

async function createRoutedTwilioApp(options?: {
  runtimeProfile?: "cost-optimized" | "premium-realtime";
  processRole?: PstnMediaProcessRole;
  workerId?: string;
  workerReleaseId?: string;
  workerAcceptingCalls?: boolean;
  incrementalRepository?: InMemoryTelephonyIncrementalRepository;
  admission?: PstnCallAdmission;
  premiumExecution?: Pick<
    PstnPremiumCallExecution,
    "start" | "appendInboundFrame" | "acknowledgePlaybackMark" | "stop"
  > & Partial<Pick<PstnPremiumCallExecution, "shutdown">>;
  capacityObservability?: Partial<Pick<
    PstnCapacityObservability,
    | "openSocket"
    | "updateSocketContext"
    | "recordSocketHandshake"
    | "recordSocketTraffic"
    | "recordSocketBuffered"
    | "closeSocket"
    | "trackCall"
    | "endCall"
    | "recordQueue"
    | "recordQueueDrop"
    | "clearCallQueues"
    | "recordAdmission"
    | "recordAdmissionLease"
    | "recordAdmissionOwnershipLost"
    | "recordAdmissionBackendHealth"
    | "recordDuplicateClaim"
  >>;
}) {
  const moduleRef = await Test.createTestingModule({
    imports: [ComplianceModule],
  })
    .overrideProvider(TELEPHONY_STATE_REPOSITORY)
    .useValue(
      new FileTelephonyStateRepository(
        join(tmpdir(), "zara-telephony-websocket-tests", randomUUID()),
      ),
    )
    .overrideProvider(TELEPHONY_INCREMENTAL_REPOSITORY)
    .useValue(
      options?.incrementalRepository
      ?? new InMemoryTelephonyIncrementalRepository(),
    )
    .overrideProvider(PSTN_CALL_ADMISSION)
    .useValue(options?.admission ?? new InMemoryPstnCallAdmission())
    .overrideProvider(PremiumPstnDispatchSnapshotResolver)
    .useValue({
      async resolve(snapshotInput: {
        organizationId: string;
        workspaceId: string;
        publishedVersionId: string;
      }) {
        return createPremiumSnapshotResolution(snapshotInput);
      },
    })
    .overrideProvider(TWILIO_NUMBER_INVENTORY_PROVIDER)
    .useValue(createGeneratedTwilioInventoryProvider())
    .overrideProvider(TWILIO_NUMBER_ROUTING_PROVIDER)
    .useValue(createNoopTwilioRoutingProvider())
    .overrideProvider(PstnPremiumCallExecution)
    .useValue({
      async start() {},
      async appendInboundFrame() {},
      acknowledgePlaybackMark() {},
      async stop() {},
      async shutdown() {},
      ...options?.premiumExecution,
    })
    .overrideProvider(PstnCapacityObservability)
    .useValue({
      openSocket() {},
      updateSocketContext() {},
      recordSocketHandshake() {},
      recordSocketTraffic() {},
      recordSocketBuffered() {},
      closeSocket() {},
      trackCall() {},
      endCall() {},
      recordQueue() {},
      recordQueueDrop() {},
      clearCallQueues() {},
      recordAdmission() {},
      recordAdmissionLease() {},
      recordAdmissionOwnershipLost() {},
      recordAdmissionBackendHealth() {},
      recordDuplicateClaim() {},
      ...options?.capacityObservability,
    })
    .overrideProvider(PSTN_MEDIA_PROCESS_ROLE)
    .useValue(
      options?.processRole
      ?? (options?.runtimeProfile === "premium-realtime"
        ? "pstn-realtime-worker"
        : "api"),
    )
    .overrideProvider(PSTN_MEDIA_WORKER_ID)
    .useValue(
      options?.processRole === "api"
        ? undefined
        : options?.runtimeProfile === "premium-realtime"
          ? options.workerId ?? "test-premium-worker"
          : undefined,
    )
    .overrideProvider(PSTN_MEDIA_WORKER_RELEASE_ID)
    .useValue(
      options?.processRole === "api"
        ? undefined
        : options?.runtimeProfile === "premium-realtime"
          ? options.workerReleaseId ?? "test-release"
          : undefined,
    )
    .overrideProvider(PSTN_MEDIA_WORKER_READINESS)
    .useValue({
      isAcceptingCalls: () => options?.workerAcceptingCalls ?? true,
    })
    .overrideProvider(PSTN_PREMIUM_WORKER_AVAILABILITY)
    .useValue({
      async select(provider: "openai-realtime" | "gemini-live") {
        return {
          status: "available" as const,
          provider,
          worker: {
            workerId: "test-premium-worker",
            releaseId: "test-release",
            mediaStreamBaseUrl:
              "wss://realtime.zara.test/telephony/twilio/media-streams",
            availableSlots: 20,
            activeCalls: 0,
            startingCalls: 0,
          },
        };
      },
    })
    .compile();

  const app: INestApplication = moduleRef.createNestApplication();
  configureCors(app);
  installTestTenantAuth(app);
  await app.listen(0);

  const authToken = "twilio-auth-token-1234567890";
  const connectResponse = await request(app.getHttpServer())
    .post("/organizations/tenant-west-africa/telephony/connections")
    .send({
      actorUserId: "user-ops-lead",
      label: "Tenant Twilio account",
      ownershipMode: "byo_provider_account",
      provider: "twilio",
      region: "us-east-1",
      blockRoutingOnHealthFailure: true,
      accountSid: "AC1234567890abcdef1234567890abcd",
      authToken,
    });
  const connectionId = connectResponse.body.state.connections[0].id as string;
  moduleRef
    .get<InMemoryTelephonyIncrementalRepository>(
      TELEPHONY_INCREMENTAL_REPOSITORY,
    )
    .loadConnections("tenant-west-africa", [connectionId]);

  const importResponse = await request(app.getHttpServer())
    .post(`/organizations/tenant-west-africa/telephony/connections/${connectionId}/import-twilio-numbers`)
    .send({
      actorUserId: "user-ops-lead",
    });
  if (importResponse.status !== 201) {
    throw new Error(`Twilio number import fixture failed: ${importResponse.status} ${JSON.stringify(importResponse.body)}`);
  }
  const importedNumber = importResponse.body.importedNumbers[0] as { id: string; phoneNumber: string };
  const phoneNumberId = importedNumber.id;
  const phoneNumber = importedNumber.phoneNumber;

  const routingResponse = await request(app.getHttpServer())
    .patch(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/routing`)
    .send({
      actorUserId: "user-ops-lead",
      publishedVersionId: "workflow-support-v1",
      workflowLabel: "Support triage",
      workspaceId: "workspace-customer-success",
      runtimeProfile: options?.runtimeProfile ?? "cost-optimized",
    });
  if (routingResponse.status !== 200) {
    throw new Error(`Live route fixture assignment failed: ${routingResponse.status} ${JSON.stringify(routingResponse.body)}`);
  }
  const activationResponse = await request(app.getHttpServer())
    .post(`/organizations/tenant-west-africa/telephony/numbers/${phoneNumberId}/live-route/activate`)
    .send({
      actorUserId: "user-ops-lead",
      now: "2026-05-14T12:12:00.000Z",
      override: {
        actorUserId: "user-ops-lead",
        approvedByUserId: "platform-admin-1",
        reason: "WebSocket bridge fixture activates the routed number after ZAR-93 gates.",
      },
    });
  if (activationResponse.status !== 201) {
    throw new Error(`Live route activation fixture failed: ${activationResponse.status} ${JSON.stringify(activationResponse.body)}`);
  }

  return {
    app,
    moduleRef,
    phoneNumber,
    authToken,
  };
}

function createGeneratedTwilioInventoryProvider(): TwilioNumberInventoryProvider {
  const numbers: AvailableTwilioPhoneNumber[] = [
    {
      sid: "PN78901001",
      phoneNumber: "+14155557890",
      friendlyName: "Support line",
      capabilities: {
        voice: true,
        sms: true,
      },
    },
  ];

  return {
    async listIncomingPhoneNumbers() {
      return numbers;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createNoopTwilioRoutingProvider(): TwilioNumberRoutingProvider {
  return {
    async configureIncomingPhoneNumberWebhook(input) {
      return {
        sid: input.phoneNumberSid,
        trunkSid: null,
        voiceApplicationSid: null,
        voiceMethod: "POST",
        voiceUrl: input.voiceUrl,
      };
    },
    async inspectIncomingPhoneNumber(input) {
      return {
        sid: input.phoneNumberSid,
        trunkSid: null,
        voiceApplicationSid: null,
        voiceMethod: "POST",
      };
    },
    async listRecentCallsForNumber() {
      return [];
    },
    async retrieveCall(input) {
      return {
        sid: input.callSid,
      };
    },
    async terminateCall(input) {
      return {
        sid: input.callSid,
        status: "completed",
      };
    },
    async listRecentMonitorAlerts() {
      return [];
    },
  };
}

async function answerViaVerifiedWebhook(input: {
  app: INestApplication;
  accountSid: string;
  authToken: string;
  callSid: string;
  eventSid: string;
  phoneNumber: string;
}) {
  const payload = {
    AccountSid: input.accountSid,
    CallSid: input.callSid,
    EventSid: input.eventSid,
    EventType: "incoming.call",
    To: input.phoneNumber,
    From: "+233201110001",
  };
  const signature = computeTwilioWebhookSignature({
    url: "http://127.0.0.1/telephony/webhooks/twilio",
    parameters: payload,
    authToken: input.authToken,
  });

  const response = await request(input.app.getHttpServer())
    .post("/telephony/webhooks/twilio")
    .set("x-twilio-signature", signature)
    .send(payload);
  expect(response.status).toBe(200);
  expect(response.text).toContain("<Connect>");
  return response;
}

function extractTwilioStreamUrl(twiml: string) {
  const match = twiml.match(/<Stream url="([^"]+)"/);
  if (match?.[1] === undefined) {
    throw new Error("Expected TwiML to contain a Stream URL.");
  }

  return new URL(match[1].replace(/&amp;/g, "&"));
}

function extractTwilioStreamParameter(twiml: string, name: string) {
  const match = twiml.match(new RegExp(`<Parameter name="${name}" value="([^"]+)" />`));
  if (match?.[1] === undefined) {
    throw new Error(`Expected TwiML to contain ${name} stream parameter.`);
  }

  return match[1]
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function createStartMessage(input: {
  accountSid?: string | undefined;
  callSid: string;
  omitAccountSid?: boolean | undefined;
  streamSid: string;
  token?: string | undefined;
  runtimePath?: "pstn-sandwich" | "pstn-premium-realtime" | undefined;
  workerId?: string | undefined;
  workerReleaseId?: string | undefined;
}) {
  return {
    event: "start",
    sequenceNumber: "1",
    streamSid: input.streamSid,
    start: {
      ...(input.omitAccountSid
        ? {}
        : {
            accountSid:
              input.accountSid ?? "AC1234567890abcdef1234567890abcd",
          }),
      callSid: input.callSid,
      streamSid: input.streamSid,
      tracks: ["inbound"],
      mediaFormat: {
        encoding: "audio/x-mulaw",
        sampleRate: 8000,
        channels: 1,
      },
      customParameters: input.token === undefined
        ? {}
          : {
            zaraStreamToken: input.token,
            zaraRuntimePath: input.runtimePath ?? "pstn-sandwich",
            ...((input.runtimePath ?? "pstn-sandwich")
              === "pstn-premium-realtime"
              ? {
                  zaraWorkerId:
                    input.workerId ?? "test-premium-worker",
                  zaraWorkerReleaseId:
                    input.workerReleaseId ?? "test-release",
                }
              : {}),
          },
    },
  };
}

function createPremiumSnapshotResolution(input: {
  organizationId: string;
  workspaceId: string;
  publishedVersionId: string;
}) {
  return {
    resolvedManifest: {
      schemaVersion: 1,
      tenantId: input.organizationId,
      workspaceId: input.workspaceId,
      workflowId: "workflow-test",
      publishedVersionId: input.publishedVersionId,
      publishedAt: "2026-07-25T09:00:00.000Z",
      runtimeProfile: "premium-realtime",
      entryNodeId: "agent-test",
      entryAgentId: "agent-test",
      graph: { nodes: [], edges: [] },
      routePolicies: [],
      agents: [],
      toolGrants: [],
      warnings: [],
    },
    resolvedConversationPolicy: structuredClone(
      defaultPremiumRealtimeConversationPolicy,
    ),
  };
}

function getListeningPort(app: INestApplication) {
  const address = app.getHttpServer().address() as { port: number } | string | null;
  if (address === null || typeof address === "string") {
    throw new Error("Expected telephony websocket test server to listen on a TCP port.");
  }

  return address.port;
}

function nextOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("close", (code, reason) => {
      reject(new Error(`Socket closed before open: ${code} ${reason.toString("utf8")}`));
    });
    socket.once("error", reject);
  });
}

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.once("message", (message: RawData) => {
      try {
        resolve(JSON.parse(message.toString("utf8")) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    socket.once("close", (code, reason) => {
      reject(new Error(`Socket closed before message: ${code} ${reason.toString("utf8")}`));
    });
    socket.once("error", reject);
  });
}

function nextClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    socket.once("close", (code, reason) => {
      resolve({
        code,
        reason: reason.toString("utf8"),
      });
    });
    socket.once("error", reject);
  });
}

function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2_000,
) {
  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const poll = async () => {
      try {
        if (await predicate()) {
          resolve();
          return;
        }
      } catch (error) {
        reject(error);
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error("Condition was not met before timeout."));
        return;
      }

      setTimeout(poll, 20);
    };

    void poll();
  });
}

function withTimeout<TValue>(promise: Promise<TValue>, label: string, timeoutMs = 3_000) {
  return Promise.race([
    promise,
    new Promise<TValue>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}
