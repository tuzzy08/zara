import { describe, expect, it } from "vitest";

import {
  compileRuntimeManifest,
  createAgentRoleNode,
  createEndNode,
  createInMemoryLiveCallSessionCoordinator,
  createLiveCallSession,
  createToolNode,
  createWorkflowGraph,
  publishWorkflowVersion,
  rehydrateLiveCallSessionSnapshot,
  type CompiledRuntimeManifest,
  type ModelRoutingRule,
} from "./index";

const routingRules: ModelRoutingRule[] = [
  {
    id: "default-greeting",
    when: {
      callPhase: "greeting",
    },
    useTier: "cheap",
    reason: "Default greeting route.",
  },
];

function createPublishedManifest(input?: {
  tenantId?: string;
  workspaceId?: string;
  runtimeProfile?: "cost-optimized" | "balanced";
  includeTool?: boolean;
}): CompiledRuntimeManifest {
  const agent = createAgentRoleNode({
    id: "agent-frontdesk",
    label: "Front desk",
    position: { x: 120, y: 0 },
    role: {
      kind: "receptionist",
      name: "Front desk",
      businessName: "Zara Test",
      instructions: "Answer inbound calls and route safely.",
      defaultModelTier: "cheap",
      languagePolicy: {
        defaultLanguage: "en",
        supportedLanguages: ["en"],
        allowMidCallSwitching: true,
      },
    },
  });
  const end = createEndNode({
    id: "end",
    label: "End",
    position: { x: 360, y: 0 },
    end: {
      outcome: "resolved",
      closingMessage: "Thanks for calling.",
    },
  });
  const tool = createToolNode({
    id: "tool-profile",
    label: "Profile lookup",
    position: { x: 260, y: -120 },
    toolId: "internal.profile.lookup",
    tool: {
      connector: "internal",
      toolName: "Profile lookup",
      connectionStatus: "connected",
      risk: "low",
      requiresAuthorization: false,
      requiresHumanApproval: false,
    },
  });
  const graph = createWorkflowGraph({
    id: "workflow-live-call-core",
    name: "Live call core",
    nodes: [
      {
        id: "entry",
        kind: "entry",
        label: "Inbound",
        position: { x: 0, y: 0 },
        config: {},
      },
      agent,
      ...(input?.includeTool === true ? [tool] : []),
      end,
    ],
    edges: [
      {
        id: "entry-agent",
        sourceNodeId: "entry",
        targetNodeId: "agent-frontdesk",
      },
      {
        id: "agent-end",
        sourceNodeId: "agent-frontdesk",
        targetNodeId: "end",
      },
      ...(input?.includeTool === true
        ? [
            {
              id: "agent-tool",
              sourceNodeId: "agent-frontdesk",
              targetNodeId: "tool-profile",
            },
          ]
        : []),
    ],
  });
  const publishedVersion = publishWorkflowVersion({
    workflowId: graph.id,
    tenantId: input?.tenantId ?? "tenant-live",
    workspaceId: input?.workspaceId ?? "workspace-live",
    environment: "sandbox",
    createdBy: "user-1",
    graph,
    existingVersions: [],
    runtime: "sandwich-pipeline",
    runtimeProfile: input?.runtimeProfile ?? "cost-optimized",
    telephonyProvider: "browser-webrtc",
    memory: {
      mode: "session-only",
      retrievalScopes: [],
      approvalRequired: false,
    },
    budget: {
      monthlyCapUsd: 100,
      currentSpendUsd: 0,
      projectedCostPerMinuteUsd: 0.1,
      blockOnLimit: true,
    },
  });

  return compileRuntimeManifest({
    publishedVersion,
    modelRouting: routingRules,
    telemetry: {
      captureAudio: false,
      captureTranscript: true,
      redactSensitiveData: true,
      sinks: ["live-monitor"],
    },
  });
}

describe("provider-neutral live call session core", () => {
  it("starts a browser live call session from an immutable published manifest", () => {
    const manifest = createPublishedManifest();
    const session = createLiveCallSession({
      callSessionId: "call-browser-1",
      manifest,
      source: {
        mode: "browser",
      },
      now: () => "2026-05-28T10:30:00.000Z",
    });

    const snapshot = session.start();

    expect(snapshot).toMatchObject({
      callSessionId: "call-browser-1",
      tenantId: "tenant-live",
      workspaceId: "workspace-live",
      manifestId: manifest.manifestId,
      publishedVersionId: manifest.publishedVersionId,
      runtimeProfile: "cost-optimized",
      sourceMode: "browser",
      status: "connected",
    });
    expect(session.replayEvents().map((event) => [event.sequence, event.type, event.payload])).toEqual([
      [
        1,
        "call.started",
        expect.objectContaining({
          lifecycleStatus: "connected",
          sourceMode: "browser",
          manifestId: manifest.manifestId,
          publishedVersionId: manifest.publishedVersionId,
        }),
      ],
    ]);
  });

  it("starts a PSTN live call session in waiting state with provider-neutral route metadata", () => {
    const manifest = createPublishedManifest();
    const session = createLiveCallSession({
      callSessionId: "call-pstn-1",
      manifest,
      source: {
        mode: "pstn",
        phoneNumberId: "number-1",
        telephonyConnectionId: "connection-1",
        routeMode: "test_route",
      },
      now: () => "2026-05-28T10:31:00.000Z",
    });

    const snapshot = session.start();

    expect(snapshot).toMatchObject({
      callSessionId: "call-pstn-1",
      tenantId: "tenant-live",
      workspaceId: "workspace-live",
      manifestId: manifest.manifestId,
      publishedVersionId: manifest.publishedVersionId,
      sourceMode: "pstn",
      status: "waiting",
      phoneNumberId: "number-1",
      telephonyConnectionId: "connection-1",
      routeMode: "test_route",
    });
    expect(session.replayEvents()[0]?.payload).toEqual(
      expect.objectContaining({
        lifecycleStatus: "waiting",
        sourceMode: "pstn",
        phoneNumberId: "number-1",
        routeMode: "test_route",
      }),
    );
    expect(session.replayEvents()[0]?.payload).not.toHaveProperty("twilioCallSid");
    expect(session.replayEvents()[0]?.payload).not.toHaveProperty("twilioStreamSid");
  });

  it("records ordered lifecycle transitions with packet ids", () => {
    const session = createLiveCallSession({
      callSessionId: "call-lifecycle-1",
      manifest: createPublishedManifest(),
      source: {
        mode: "browser",
      },
      now: (() => {
        const times = [
          "2026-05-28T10:32:00.000Z",
          "2026-05-28T10:32:01.000Z",
          "2026-05-28T10:32:02.000Z",
          "2026-05-28T10:32:03.000Z",
        ];
        return () => times.shift() ?? "2026-05-28T10:32:04.000Z";
      })(),
    });

    session.start();
    session.transition({
      status: "listening",
      packetId: "turn-1",
      reason: "Caller audio is flowing.",
    });
    session.transition({
      status: "thinking",
      packetId: "turn-1",
      reason: "Transcript finalized for routing.",
    });
    const snapshot = session.transition({
      status: "speaking",
      packetId: "turn-1",
      reason: "Outbound response is streaming.",
    });

    expect(snapshot.status).toBe("speaking");
    expect(session.replayEvents().map((event) => [event.sequence, event.type, event.payload])).toEqual([
      [1, "call.started", expect.objectContaining({ lifecycleStatus: "connected" })],
      [
        2,
        "call.lifecycle",
        expect.objectContaining({
          lifecycleStatus: "listening",
          previousStatus: "connected",
          packetId: "turn-1",
        }),
      ],
      [
        3,
        "call.lifecycle",
        expect.objectContaining({
          lifecycleStatus: "thinking",
          previousStatus: "listening",
          packetId: "turn-1",
        }),
      ],
      [
        4,
        "call.lifecycle",
        expect.objectContaining({
          lifecycleStatus: "speaking",
          previousStatus: "thinking",
          packetId: "turn-1",
        }),
      ],
    ]);
  });

  it("creates turn runtime packets from the pinned manifest and active agent", () => {
    const manifest = createPublishedManifest();
    const session = createLiveCallSession({
      callSessionId: "call-packet-1",
      manifest,
      source: {
        mode: "pstn",
        phoneNumberId: "number-1",
        telephonyConnectionId: "connection-1",
        routeMode: "live_route",
      },
      now: (() => {
        const times = [
          "2026-05-28T10:33:00.000Z",
          "2026-05-28T10:33:01.000Z",
        ];
        return () => times.shift() ?? "2026-05-28T10:33:02.000Z";
      })(),
    });

    session.start();
    const packet = session.createTurnPacket({
      turnId: "turn-1",
      activeAgentId: "agent-frontdesk",
      latestCallerTurn: "I need help booking an appointment.",
      inputSource: "telephony",
      language: "en",
    });

    expect(packet).toMatchObject({
      ids: {
        tenantId: "tenant-live",
        workspaceId: "workspace-live",
        callSessionId: "call-packet-1",
        turnId: "turn-1",
        manifestId: manifest.manifestId,
        manifestVersion: manifest.version,
      },
      callerInput: {
        latestCallerTurn: "I need help booking an appointment.",
        source: "telephony",
        language: "en",
      },
      graph: {
        entryNodeId: "entry",
        currentNodeId: "agent-frontdesk",
        activeAgent: {
          id: "agent-frontdesk",
          name: "Front desk",
          kind: "receptionist",
        },
      },
      safety: {
        redactionApplied: true,
      },
    });
    expect(packet.availableTools).toEqual([]);
    expect(session.replayEvents().map((event) => [event.sequence, event.type, event.payload])).toEqual([
      [1, "call.started", expect.objectContaining({ lifecycleStatus: "waiting" })],
      [
        2,
        "turn.started",
        expect.objectContaining({
          packetId: "turn-1",
          activeAgentId: "agent-frontdesk",
          sourceMode: "pstn",
          inputSource: "telephony",
        }),
      ],
    ]);
  });

  it("creates turn packets from concrete graph agent config", () => {
    const manifest = createPublishedManifest();
    const session = createLiveCallSession({
      callSessionId: "call-concrete-agent-packet",
      manifest,
      source: {
        mode: "browser",
      },
      now: () => "2026-05-28T10:33:30.000Z",
    });

    session.start();
    const packet = session.createTurnPacket({
      turnId: "turn-concrete-agent",
      activeAgentId: "agent-frontdesk",
      latestCallerTurn: "Hello.",
      inputSource: "voice",
    });

    expect(packet.graph.activeAgent).toMatchObject({
      id: "agent-frontdesk",
      name: "Front desk",
      kind: "receptionist",
    });
  });

  it("seeds transfer context and policy warnings into created turn packets", () => {
    const manifest = createPublishedManifest();
    const session = createLiveCallSession({
      callSessionId: "call-transfer-policy",
      manifest,
      source: {
        mode: "browser",
      },
      now: () => "2026-05-28T10:34:30.000Z",
    });
    session.start();

    const packet = session.createTurnPacket({
      turnId: "turn-transfer-1",
      activeAgentId: "agent-frontdesk",
      latestCallerTurn: "I need billing help.",
      inputSource: "voice",
      transfer: {
        nodeId: "agent-frontdesk",
        context: {
          transferId: "transfer-1",
          sourceAgent: {
            id: "agent-triage",
            name: "Triage",
            kind: "triage",
          },
          targetAgent: {
            id: "agent-frontdesk",
            name: "Front desk",
            kind: "receptionist",
          },
          reason: "Intent route selected the front desk specialist.",
          callerNeedSummary: "Caller needs billing help.",
          recentToolResults: [],
        },
      },
      policyWarnings: [
        {
          code: "policy.language_mismatch_guarded",
          message: "Target agent language support was checked before selection.",
          recoverable: true,
        },
      ],
    });

    expect(packet.transfer).toEqual(
      expect.objectContaining({
        transferId: "transfer-1",
        reason: "Intent route selected the front desk specialist.",
      }),
    );
    expect(packet.diagnostics.warnings).toEqual([
      {
        code: "policy.language_mismatch_guarded",
        message: "Target agent language support was checked before selection.",
        recoverable: true,
      },
    ]);
    expect(packet.diagnostics.events.map((event) => event.type)).toEqual([
      "transfer.created",
      "runtime.warning",
    ]);
  });

  it("projects assigned tools into the packet as optional agent capabilities", () => {
    const manifest = createPublishedManifest({
      includeTool: true,
    });
    const session = createLiveCallSession({
      callSessionId: "call-toolbelt",
      manifest,
      source: {
        mode: "browser",
      },
    });
    session.start();

    const packet = session.createTurnPacket({
      turnId: "turn-toolbelt-1",
      activeAgentId: "agent-frontdesk",
      latestCallerTurn: "Can you look up my profile?",
      inputSource: "voice",
    });

    expect(packet.availableTools).toEqual([
      expect.objectContaining({
        id: "tool-profile",
        toolId: "internal.profile.lookup",
        label: "Profile lookup",
        risk: "low",
        requiresHumanApproval: false,
      }),
    ]);
    expect(packet.toolCalls).toEqual([]);
  });

  it("persists and rehydrates session metadata through the coordinator", () => {
    const coordinator = createInMemoryLiveCallSessionCoordinator();
    const manifest = createPublishedManifest();
    const session = createLiveCallSession({
      callSessionId: "call-rehydrate-1",
      manifest,
      source: {
        mode: "pstn",
        phoneNumberId: "number-rehydrate",
        telephonyConnectionId: "connection-rehydrate",
        routeMode: "test_route",
      },
      coordinator,
      now: () => "2026-05-28T10:34:00.000Z",
    });

    session.start();
    session.transition({
      status: "connected",
    });
    session.transition({
      status: "listening",
      packetId: "turn-1",
    });

    const snapshot = rehydrateLiveCallSessionSnapshot({
      callSessionId: "call-rehydrate-1",
      coordinator,
    });

    expect(snapshot).toMatchObject({
      callSessionId: "call-rehydrate-1",
      status: "listening",
      tenantId: "tenant-live",
      workspaceId: "workspace-live",
      manifestId: manifest.manifestId,
      publishedVersionId: manifest.publishedVersionId,
      phoneNumberId: "number-rehydrate",
      telephonyConnectionId: "connection-rehydrate",
      routeMode: "test_route",
    });
  });

  it("rejects tenant workspace number published-version and runtime-profile mismatches", () => {
    const manifest = createPublishedManifest({
      runtimeProfile: "balanced",
    });
    const source = {
      mode: "pstn" as const,
      phoneNumberId: "number-1",
      telephonyConnectionId: "connection-1",
      routeMode: "live_route" as const,
    };

    const mismatches = [
      { tenantId: "tenant-other" },
      { workspaceId: "workspace-other" },
      { phoneNumberId: "number-other" },
      { publishedVersionId: "workflow-other-v1" },
      { runtimeProfile: "cost-optimized" as const },
    ];

    for (const expectedScope of mismatches) {
      expect(() =>
        createLiveCallSession({
          callSessionId: `call-scope-${Object.keys(expectedScope)[0]}`,
          manifest,
          source,
          expectedScope: {
            tenantId: "tenant-live",
            workspaceId: "workspace-live",
            phoneNumberId: "number-1",
            publishedVersionId: manifest.publishedVersionId,
            runtimeProfile: "balanced",
            ...expectedScope,
          },
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "live_call_session.scope_mismatch",
        }),
      );
    }
  });

  it("rejects rehydrating a persisted session through the wrong scope", () => {
    const coordinator = createInMemoryLiveCallSessionCoordinator();
    const manifest = createPublishedManifest();
    const session = createLiveCallSession({
      callSessionId: "call-rehydrate-scope",
      manifest,
      source: {
        mode: "pstn",
        phoneNumberId: "number-scope",
        telephonyConnectionId: "connection-scope",
        routeMode: "test_route",
      },
      coordinator,
    });
    session.start();

    expect(() =>
      rehydrateLiveCallSessionSnapshot({
        callSessionId: "call-rehydrate-scope",
        coordinator,
        expectedScope: {
          tenantId: "tenant-live",
          workspaceId: "workspace-other",
          phoneNumberId: "number-scope",
          publishedVersionId: manifest.publishedVersionId,
          runtimeProfile: "cost-optimized",
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "live_call_session.scope_mismatch",
      }),
    );
  });

  it("prevents transitions after a session reaches a terminal state", () => {
    const session = createLiveCallSession({
      callSessionId: "call-terminal",
      manifest: createPublishedManifest(),
      source: {
        mode: "browser",
      },
    });

    session.start();
    session.transition({ status: "listening" });
    session.transition({ status: "thinking", packetId: "turn-1" });
    session.transition({ status: "speaking", packetId: "turn-1" });
    session.transition({ status: "ending" });
    const ended = session.transition({ status: "ended" });

    expect(ended.status).toBe("ended");
    expect(() => session.transition({ status: "listening" })).toThrowError(
      expect.objectContaining({
        code: "live_call_session.invalid_transition",
      }),
    );
    expect(session.replayEvents().map((event) => event.payload.lifecycleStatus)).toEqual([
      "connected",
      "listening",
      "thinking",
      "speaking",
      "ending",
      "ended",
    ]);
  });

  it("supports PSTN ringing and failed lifecycle states as ordered terminal events", () => {
    const session = createLiveCallSession({
      callSessionId: "call-failed",
      manifest: createPublishedManifest(),
      source: {
        mode: "pstn",
        phoneNumberId: "number-failed",
        telephonyConnectionId: "connection-failed",
        routeMode: "live_route",
      },
    });

    session.start();
    session.transition({ status: "ringing" });
    const failed = session.transition({
      status: "failed",
      reason: "Provider bridge closed before media connected.",
    });

    expect(failed.status).toBe("failed");
    expect(() => session.transition({ status: "connected" })).toThrowError(
      expect.objectContaining({
        code: "live_call_session.invalid_transition",
      }),
    );
    expect(session.replayEvents().map((event) => event.payload.lifecycleStatus)).toEqual([
      "waiting",
      "ringing",
      "failed",
    ]);
  });
});
