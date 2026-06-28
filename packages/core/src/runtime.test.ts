import { describe, expect, it } from "vitest";

import {
  compileRuntimeManifest,
  createAgentRoleNode,
  createConditionNode,
  createCostOptimizedSandwichRuntimeAdapter,
  createEndNode,
  createPremiumRealtimeSession,
  createWorkflowGraph,
  publishWorkflowVersion,
  RuntimeManifestCompileError,
  RuntimeProviderFailure,
  resolveRuntimeProfilePolicy,
  runtimeManifestPreviewSchemaVersion,
  selectModelRoutingDecision,
  type CompiledRuntimeManifest,
  type ModelRoutingRule,
  type SandwichSttProvider,
  type SandwichTextModelProvider,
  type SandwichTtsProvider,
} from "./index";

const entryNode = {
  id: "entry",
  kind: "entry",
  label: "Inbound call",
  position: { x: 0, y: 0 },
  config: {},
} as const;

const frontDeskAgent = createAgentRoleNode({
  id: "agent-front-desk",
  label: "Front desk triage",
  position: { x: 140, y: 60 },
  role: {
    kind: "receptionist",
    name: "Front desk triage",
    businessName: "Tuzzy Labs",
    instructions: "Triage the request, gather context, and route the caller safely.",
    defaultModelTier: "cheap",
    languagePolicy: {
      defaultLanguage: "en",
      supportedLanguages: ["en", "fr"],
      allowMidCallSwitching: true,
    },
    toolbeltAssignments: [
      {
        id: "customer-profile-lookup",
        toolId: "hubspot.profile.lookup",
        label: "Customer profile API",
        description: "Customer profile lookup",
        whenToUse: "Use when the caller needs account-specific support context.",
        connector: "hubspot",
        toolName: "Customer profile lookup",
        integrationConnectionId: "hubspot-prod",
        integrationLabel: "HubSpot - Production",
        connectionStatus: "connected",
        risk: "high",
        requiresAuthorization: true,
        requiresHumanApproval: false,
      },
    ],
  },
});

describe("premium realtime sessions", () => {
  it("does not create provider sessions without a concrete graph agent", () => {
    const manifest = withoutGraphAgent(compileManifest(), "agent-front-desk");

    expect(() =>
      createPremiumRealtimeSession({
        manifest,
        activeAgentId: "agent-front-desk",
        budgetAllowed: true,
      }),
    ).toThrowError("Agent 'agent-front-desk' is not present");
  });

  it("uses concrete active agent realtime provider config", () => {
    const publishedVersion = withAgentRoleConfig(createPublishedWorkflowVersion(), "agent-front-desk", {
      runtimeProfileOverride: "premium-realtime",
      realtimeProvider: "gemini-live",
      realtimeModelId: "gemini-agent-live",
    });
    const manifest = compileManifest({ publishedVersion });

    const session = createPremiumRealtimeSession({
      manifest,
      activeAgentId: "agent-front-desk",
      budgetAllowed: true,
      now: () => "2026-06-14T08:00:00.000Z",
    });

    expect(session.runtime).toBe("gemini-live");
    expect(session.model).toBe("gemini-agent-live");
  });

  it("exposes only active-role Zara tool declarations through the server session contract", () => {
    const publishedVersion = createPublishedWorkflowVersion();
    const premiumPublishedVersion = publishWorkflowVersion({
      workflowId: publishedVersion.manifestPreview.workflowId,
      tenantId: publishedVersion.tenantId,
      environment: publishedVersion.manifestPreview.environment,
      createdBy: "user-1",
      graph: publishedVersion.graph,
      existingVersions: [],
      runtime: "openai-realtime",
      runtimeProfile: "premium-realtime",
      telephonyProvider: "browser-webrtc",
      memory: publishedVersion.manifestPreview.memory,
      budget: publishedVersion.manifestPreview.budget,
    });
    const manifest = compileManifest({
      publishedVersion: premiumPublishedVersion,
    });

    const session = createPremiumRealtimeSession({
      manifest,
      activeAgentId: "agent-front-desk",
      budgetAllowed: true,
      now: () => "2026-06-14T08:00:00.000Z",
    });

    expect(session.toolDeclarations).toHaveLength(1);
    expect(session.toolDeclarations[0]).toMatchObject({
      toolAssignmentId: "agent-front-desk:customer-profile-lookup",
      toolId: "hubspot.profile.lookup",
      label: "Customer profile API",
    });
    expect(JSON.stringify(session.toolDeclarations)).not.toContain("hubspot-prod");
    expect(session.observedEventTypes).toContain("tool.requested");
    expect(session.observedEventTypes).toContain("tool.approval_required");
  });
});

const billingAgent = createAgentRoleNode({
  id: "agent-billing",
  label: "Billing specialist",
  position: { x: 760, y: 180 },
  role: {
    kind: "billing",
    name: "Billing specialist",
    businessName: "Tuzzy Labs",
    instructions: "Handle payment issues, refunds, and subscription disputes.",
    defaultModelTier: "standard",
    languagePolicy: {
      defaultLanguage: "en",
      supportedLanguages: ["en", "fr"],
      allowMidCallSwitching: true,
    },
  },
});

const resolvedExit = createEndNode({
  id: "end-resolved",
  label: "Resolved exit",
  position: { x: 760, y: 360 },
  end: {
    outcome: "resolved",
    closingMessage: "Thank the caller and close the conversation.",
  },
});

const billingExit = createEndNode({
  id: "end-billing",
  label: "Billing resolved",
  position: { x: 980, y: 180 },
  end: {
    outcome: "resolved",
    closingMessage: "Confirm the billing fix before ending the call.",
  },
});

const conditionNode = createConditionNode({
  id: "condition-intent",
  label: "Intent route",
  position: { x: 460, y: 220 },
  condition: {
    branches: [
      {
        id: "branch-billing",
        label: "Billing",
        intentKey: "billing",
        description: "Invoice, payment, refund, and subscription balance questions.",
        examples: ["Why was I charged twice?", "I need a copy of my invoice."],
        expression: 'intent == "billing"',
        targetNodeId: "agent-billing",
      },
    ],
    classifier: {
      mode: "standard",
      modelAlias: "intent-classifier-fast",
      confidenceThreshold: 0.72,
    },
    inputWindow: {
      latestCallerTurn: true,
      recentTranscriptTurns: 4,
      includeConversationSummary: true,
      includePreviousAgentContext: true,
      includeRecentToolResults: false,
    },
    fallbackLabel: "Resolved",
    fallbackTargetNodeId: "end-resolved",
  },
});

const routingRules: ModelRoutingRule[] = [
  {
    id: "route-greeting-cheap",
    priority: 10,
    when: {
      callPhase: "greeting",
      language: "en",
      maxRisk: "low",
    },
    useTier: "cheap",
    reason: "Greeting turns can stay on the cheapest tier.",
  },
  {
    id: "route-billing-standard",
    priority: 20,
    when: {
      intent: "billing",
      callPhase: "discovery",
      minConfidence: 0.7,
    },
    useTier: "standard",
    reason: "Billing discovery needs a stronger reasoning tier.",
  },
  {
    id: "route-escalation-sota",
    priority: 40,
    when: {
      callPhase: "escalation",
      minRisk: "high",
      maxConfidence: 0.45,
    },
    useTier: "sota",
    reason: "Escalations with low confidence and high risk go premium.",
  },
];

function createPublishedWorkflowVersion() {
  const graph = createWorkflowGraph({
    id: "workflow-sandbox-runtime",
    name: "Sandbox runtime",
    nodes: [
      entryNode,
      frontDeskAgent,
      conditionNode,
      billingAgent,
      resolvedExit,
      billingExit,
    ],
    edges: [
      {
        id: "edge-entry-front-desk",
        sourceNodeId: "entry",
        targetNodeId: "agent-front-desk",
      },
      {
        id: "edge-front-desk-condition",
        sourceNodeId: "agent-front-desk",
        targetNodeId: "condition-intent",
      },
      {
        id: "edge-condition-billing",
        sourceNodeId: "condition-intent",
        targetNodeId: "agent-billing",
        condition: "Billing",
      },
      {
        id: "edge-condition-resolved",
        sourceNodeId: "condition-intent",
        targetNodeId: "end-resolved",
        condition: "Resolved",
      },
      {
        id: "edge-billing-exit",
        sourceNodeId: "agent-billing",
        targetNodeId: "end-billing",
      },
    ],
  });

  return publishWorkflowVersion({
    workflowId: graph.id,
    tenantId: "tenant-west-africa",
    environment: "sandbox",
    createdBy: "user-1",
    graph,
    existingVersions: [],
    runtime: "sandwich-pipeline",
    telephonyProvider: "browser-webrtc",
    memory: {
      mode: "scoped",
      retrievalScopes: ["session", "caller"],
      approvalRequired: true,
    },
    budget: {
      monthlyCapUsd: 1200,
      currentSpendUsd: 214,
      projectedCostPerMinuteUsd: 0.18,
      blockOnLimit: true,
    },
  });
}

function withAgentRoleConfig(
  publishedVersion: ReturnType<typeof createPublishedWorkflowVersion>,
  agentId: string,
  overrides: Record<string, unknown>,
): ReturnType<typeof createPublishedWorkflowVersion> {
  return {
    ...publishedVersion,
    graph: {
      ...publishedVersion.graph,
      nodes: publishedVersion.graph.nodes.map((node) =>
        node.id === agentId
          ? {
              ...node,
              config: {
                ...node.config,
                role: {
                  ...(node.config["role"] as Record<string, unknown>),
                  ...overrides,
                },
              },
            }
          : node,
      ),
    },
  };
}

function compileManifest(overrides: Partial<Parameters<typeof compileRuntimeManifest>[0]> = {}) {
  return compileRuntimeManifest({
    publishedVersion: createPublishedWorkflowVersion(),
    modelRouting: routingRules,
    telemetry: {
      captureAudio: false,
      captureTranscript: true,
      redactSensitiveData: true,
      sinks: ["live-monitor", "opentelemetry"],
    },
    availableIntegrationConnectionIds: ["hubspot-prod"],
    ...overrides,
  });
}

function withoutGraphAgent(
  manifest: CompiledRuntimeManifest,
  agentId: string,
): CompiledRuntimeManifest {
  return {
    ...manifest,
    graph: {
      ...manifest.graph,
      nodes: manifest.graph.nodes.filter((node) => node.id !== agentId),
    },
  };
}

async function* streamChunks(...chunks: string[]) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe("runtime manifest compiler", () => {
  it("compiles a deterministic manifest from a published workflow version", () => {
    const manifest = compileManifest();
    const secondManifest = compileManifest();

    expect(manifest).toEqual(secondManifest);
    expect(manifest).toEqual(
      expect.objectContaining({
        manifestId: expect.stringContaining("workflow-sandbox-runtime-v1"),
        publishedVersionId: "workflow-sandbox-runtime-v1",
        runtime: "sandwich-pipeline",
        telephonyProvider: "browser-webrtc",
        entryNodeId: "entry",
        entryAgentId: "agent-front-desk",
        serializedGraph: createPublishedWorkflowVersion().serializedGraph,
      }),
    );
    expect(manifest).not.toHaveProperty("entryRoleId");
    expect(manifest).not.toHaveProperty("roles");
    expect(manifest.toolBindings).toEqual([
      expect.objectContaining({
        nodeId: "agent-front-desk:customer-profile-lookup",
        toolId: "hubspot.profile.lookup",
        integrationConnectionId: "hubspot-prod",
      }),
    ]);
    expect(manifest.agentToolAssignments).toEqual([
      {
        id: "agent-front-desk:customer-profile-lookup",
        agentId: "agent-front-desk",
        toolId: "hubspot.profile.lookup",
        label: "Customer profile API",
        description: "Customer profile lookup",
        whenToUse: "Use when the caller needs account-specific support context.",
        inputSchema: {},
        requiredInputs: [],
        risk: "high",
        requiresHumanApproval: false,
        credentialRef: "hubspot-prod",
      },
    ]);
    expect(manifest.agentToolAssignments[0]).not.toHaveProperty("roleId");
    expect(manifest).not.toHaveProperty("handoffs");
    expect(manifest.conditions).toEqual([
      expect.objectContaining({
        nodeId: "condition-intent",
        classifier: {
          mode: "standard",
          modelAlias: "intent-classifier-fast",
          confidenceThreshold: 0.72,
        },
        inputWindow: {
          latestCallerTurn: true,
          recentTranscriptTurns: 4,
          includeConversationSummary: true,
          includePreviousAgentContext: true,
          includeRecentToolResults: false,
        },
        branches: [
          {
            id: "branch-billing",
            label: "Billing",
            intentKey: "billing",
            description: "Invoice, payment, refund, and subscription balance questions.",
            examples: ["Why was I charged twice?", "I need a copy of my invoice."],
            expression: 'intent == "billing"',
            targetNodeId: "agent-billing",
          },
        ],
        fallbackTargetNodeId: "end-resolved",
      }),
    ]);
  });

  it("compiles agent-owned toolbelt assignments without visual tool nodes", () => {
    const toolbeltAgent = createAgentRoleNode({
      id: "agent-support",
      label: "Support concierge",
      position: { x: 180, y: 80 },
      role: {
        kind: "support",
        name: "Support concierge",
        businessName: "Tuzzy Labs",
        instructions: "Resolve support requests.",
        defaultModelTier: "standard",
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en"],
          allowMidCallSwitching: false,
        },
        toolbeltAssignments: [
          {
            id: "assignment-zendesk-search",
            toolId: "zendesk.tickets.search",
            label: "Search tickets",
            description: "Search recent Zendesk tickets.",
            whenToUse: "Use when the caller asks about an existing ticket.",
            connector: "zendesk",
            toolName: "Search tickets",
            integrationConnectionId: "zendesk-prod",
            integrationLabel: "Zendesk support",
            connectionStatus: "connected",
            risk: "low",
            requiresAuthorization: true,
            requiresHumanApproval: false,
          },
        ],
      },
    });
    const graph = createWorkflowGraph({
      id: "workflow-agent-toolbelt",
      name: "Agent toolbelt",
      nodes: [
        entryNode,
        toolbeltAgent,
        resolvedExit,
      ],
      edges: [
        {
          id: "edge-entry-agent",
          sourceNodeId: "entry",
          targetNodeId: "agent-support",
        },
        {
          id: "edge-agent-exit",
          sourceNodeId: "agent-support",
          targetNodeId: "end-resolved",
        },
      ],
    });
    const publishedVersion = publishWorkflowVersion({
      workflowId: "workflow-agent-toolbelt",
      tenantId: "tenant-west-africa",
      environment: "production",
      createdBy: "user-ops-lead",
      graph,
      existingVersions: [],
      runtime: "sandwich-pipeline",
      runtimeProfile: "cost-optimized",
      telephonyProvider: "browser-webrtc",
      memory: createPublishedWorkflowVersion().manifestPreview.memory,
      budget: createPublishedWorkflowVersion().manifestPreview.budget,
    });

    const manifest = compileManifest({
      publishedVersion,
      availableIntegrationConnectionIds: ["zendesk-prod"],
    });

    expect(manifest.toolBindings).toEqual([
      expect.objectContaining({
        nodeId: "agent-support:assignment-zendesk-search",
        toolId: "zendesk.tickets.search",
        integrationConnectionId: "zendesk-prod",
      }),
    ]);
    expect(manifest.agentToolAssignments).toEqual([
      expect.objectContaining({
        id: "agent-support:assignment-zendesk-search",
        agentId: "agent-support",
        toolId: "zendesk.tickets.search",
        label: "Search tickets",
        description: "Search recent Zendesk tickets.",
        whenToUse: "Use when the caller asks about an existing ticket.",
        credentialRef: "zendesk-prod",
      }),
    ]);
  });

  it("fails fast when a published manifest preview is not stamped with the current schema", () => {
    const publishedVersion = createPublishedWorkflowVersion();
    const legacyManifestPreview = { ...publishedVersion.manifestPreview } as Partial<
      typeof publishedVersion.manifestPreview
    >;
    delete legacyManifestPreview.schemaVersion;

    expect(() =>
      compileRuntimeManifest({
        publishedVersion: {
          ...publishedVersion,
          manifestPreview: legacyManifestPreview as typeof publishedVersion.manifestPreview,
        },
        modelRouting: routingRules,
        telemetry: {
          captureAudio: false,
          captureTranscript: true,
          redactSensitiveData: true,
          sinks: ["live-monitor"],
        },
        availableIntegrationConnectionIds: ["hubspot-prod"],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RuntimeManifestCompileError>>({
        code: "runtime.unsupported_manifest_schema",
      }),
    );
    expect(publishedVersion.manifestPreview.schemaVersion).toBe(runtimeManifestPreviewSchemaVersion);
  });

  it("fails fast when a current-schema manifest preview carries legacy handoff metadata", () => {
    const publishedVersion = createPublishedWorkflowVersion();

    expect(() =>
      compileRuntimeManifest({
        publishedVersion: {
          ...publishedVersion,
          manifestPreview: {
            ...publishedVersion.manifestPreview,
            handoffs: [],
          } as typeof publishedVersion.manifestPreview,
        },
        modelRouting: routingRules,
        telemetry: {
          captureAudio: false,
          captureTranscript: true,
          redactSensitiveData: true,
          sinks: ["live-monitor"],
        },
        availableIntegrationConnectionIds: ["hubspot-prod"],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RuntimeManifestCompileError>>({
        code: "runtime.unsupported_manifest_schema",
      }),
    );
  });

  it("preserves agent route policies in compiled manifests without requiring handoff nodes", () => {
    const routePolicyAgent = createAgentRoleNode({
      id: "agent-route-policy",
      label: "Route policy triage",
      position: { x: 140, y: 60 },
      role: {
        kind: "receptionist",
        name: "Route policy triage",
        businessName: "Tuzzy Labs",
        instructions: "Gather enough context, then route callers to the right specialist.",
        defaultModelTier: "cheap",
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en"],
          allowMidCallSwitching: false,
        },
        routePolicy: {
          type: "route_by_intent",
          trigger: "on_caller_turn_end",
          activation: "until_routed",
          classifier: {
            mode: "standard",
            modelAlias: "intent-classifier-fast",
            confidenceThreshold: 0.75,
          },
          inputWindow: {
            latestCallerTurn: true,
            recentTranscriptTurns: 4,
            includeConversationSummary: true,
            includePreviousAgentContext: true,
            includeRecentToolResults: false,
          },
          readiness: {
            mode: "auto_with_clarification",
            maxClarificationTurns: 2,
          },
          announcement: {
            mode: "template",
            text: "I'll connect you with {targetAgentName}.",
          },
          branches: [
            {
              id: "branch-billing",
              label: "Billing",
              intentKey: "billing",
              target: {
                type: "agent",
                agentId: "agent-billing",
              },
              transferInstructions: "Continue with billing context; do not repeat triage questions.",
            },
          ],
          fallback: {
            label: "Clarify",
            target: {
              type: "clarify_source_agent",
            },
          },
        },
      },
    });
    const graph = createWorkflowGraph({
      id: "workflow-runtime-route-policy",
      name: "Runtime route policy",
      nodes: [entryNode, routePolicyAgent, billingAgent],
      edges: [
        {
          id: "edge-entry-route-policy",
          sourceNodeId: "entry",
          targetNodeId: "agent-route-policy",
        },
      ],
    });
    const publishedVersion = publishWorkflowVersion({
      workflowId: graph.id,
      tenantId: "tenant-west-africa",
      workspaceId: "workspace-default",
      environment: "sandbox",
      createdBy: "user-1",
      graph,
      existingVersions: [],
      runtime: "sandwich-pipeline",
      telephonyProvider: "browser-webrtc",
      memory: {
        mode: "session-only",
        retrievalScopes: ["session"],
        approvalRequired: false,
      },
      budget: {
        monthlyCapUsd: 1200,
        currentSpendUsd: 214,
        projectedCostPerMinuteUsd: 0.18,
        blockOnLimit: true,
      },
    });

    const manifest = compileManifest({
      publishedVersion,
    });
    const secondManifest = compileManifest({
      publishedVersion,
    });

    expect(manifest.routePolicies).toEqual([
      expect.objectContaining({
        sourceAgentId: "agent-route-policy",
        trigger: "on_caller_turn_end",
        activation: "until_routed",
        branches: [
          expect.objectContaining({
            target: {
              type: "agent",
              agentId: "agent-billing",
            },
          }),
        ],
      }),
    ]);
    expect(manifest).toEqual(secondManifest);
    expect(manifest).not.toHaveProperty("handoffs");
    expect(manifest.conditions).toEqual([]);
  });

  it("fails fast when a published tool reference no longer exists", () => {
    const publishedVersion = createPublishedWorkflowVersion();
    const brokenPublishedVersion = {
      ...publishedVersion,
      tools: [],
    };

    expect(() =>
      compileRuntimeManifest({
        publishedVersion: brokenPublishedVersion,
        modelRouting: routingRules,
        telemetry: {
          captureAudio: false,
          captureTranscript: true,
          redactSensitiveData: true,
          sinks: ["live-monitor"],
        },
        availableIntegrationConnectionIds: ["hubspot-prod"],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RuntimeManifestCompileError>>({
        code: "runtime.missing_tool_definition",
      }),
    );
  });

  it("fails fast when tenant config is missing a required integration connection", () => {
    expect(() =>
      compileManifest({
        availableIntegrationConnectionIds: [],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RuntimeManifestCompileError>>({
        code: "runtime.missing_integration_connection",
      }),
    );
  });
});

describe("model routing policy engine", () => {
  it("does not route or resolve runtime profiles from stale role snapshots without a concrete graph agent", () => {
    const manifest = withoutGraphAgent(compileManifest(), "agent-front-desk");

    expect(() =>
      selectModelRoutingDecision({
        manifest,
        activeAgentId: "agent-front-desk",
        context: {
          callPhase: "resolution",
          confidence: 0.91,
        },
      }),
    ).toThrowError("Agent 'agent-front-desk' is not present");
    expect(() =>
      resolveRuntimeProfilePolicy({
        manifest,
        activeAgentId: "agent-front-desk",
      }),
    ).toThrowError("Agent 'agent-front-desk' is not present");
  });

  it("selects the highest-priority escalation rule and logs the decision", () => {
    const manifest = compileManifest();

    const decision = selectModelRoutingDecision({
      manifest,
      activeAgentId: "agent-front-desk",
      context: {
        intent: "billing",
        callPhase: "escalation",
        confidence: 0.32,
        requestedToolId: "hubspot.profile.lookup",
        language: "en",
      },
    });

    expect(decision).toEqual(
      expect.objectContaining({
        tier: "sota",
        matchedRuleId: "route-escalation-sota",
        source: "rule",
      }),
    );
    expect(decision.log).toEqual(
      expect.objectContaining({
        matchedRuleId: "route-escalation-sota",
        reason: "Escalations with low confidence and high risk go premium.",
        context: expect.objectContaining({
          activeAgentId: "agent-front-desk",
        }),
      }),
    );
    expect(decision.log.context).not.toHaveProperty("activeRoleId");
  });

  it("falls back to the active agent default tier when no rule matches", () => {
    const manifest = compileManifest({
      modelRouting: [
        {
          id: "route-french-only",
          priority: 5,
          when: {
            language: "fr",
            callPhase: "greeting",
          },
          useTier: "standard",
          reason: "French greetings use the stronger tier.",
        },
      ],
    });

    const decision = selectModelRoutingDecision({
      manifest,
      activeAgentId: "agent-front-desk",
      context: {
        intent: "support",
        callPhase: "resolution",
        confidence: 0.91,
        language: "en",
      },
    });

    expect(decision).toEqual(
      expect.objectContaining({
        tier: "cheap",
        source: "agent_default",
      }),
    );
    expect(decision.matchedRuleId).toBeUndefined();
    expect(decision.log.reason).toContain("Front desk triage");
  });
});

describe("cost optimized sandwich runtime adapter", () => {
  it("projects concrete active agent identity to the text model when role id differs from graph node id", async () => {
    const staleConcreteAgentInput = {
      id: "agent-jane-front-desk",
      roleId: "role-front-desk",
      label: "New Agent",
      position: { x: 140, y: 60 },
      role: {
        kind: "receptionist",
        name: "Jane",
        businessName: "Tuzzy Labs",
        instructions: "Greet callers and decide whether a handoff is needed.",
        defaultModelTier: "cheap",
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en"],
          allowMidCallSwitching: false,
        },
      },
    } as Parameters<typeof createAgentRoleNode>[0] & { roleId: string };
    const concreteAgent = createAgentRoleNode(staleConcreteAgentInput);
    const graph = createWorkflowGraph({
      id: "workflow-concrete-agent-runtime",
      name: "Concrete agent runtime",
      nodes: [entryNode, concreteAgent],
      edges: [
        {
          id: "edge-entry-front-desk",
          sourceNodeId: "entry",
          targetNodeId: "agent-jane-front-desk",
        },
      ],
    });
    const manifest = compileManifest({
      publishedVersion: publishWorkflowVersion({
        workflowId: graph.id,
        tenantId: "tenant-west-africa",
        environment: "sandbox",
        createdBy: "user-1",
        graph,
        existingVersions: [],
        runtime: "sandwich-pipeline",
        telephonyProvider: "browser-webrtc",
        memory: {
          mode: "scoped",
          retrievalScopes: ["session"],
          approvalRequired: true,
        },
        budget: {
          monthlyCapUsd: 1200,
          currentSpendUsd: 214,
          projectedCostPerMinuteUsd: 0.18,
          blockOnLimit: true,
        },
      }),
    });
    const modelInputs: Array<Parameters<SandwichTextModelProvider["streamText"]>[0] & {
      activeAgent?: {
        agentId: string;
        name: string;
      } | undefined;
    }> = [];
    const sttInputs: Array<Parameters<SandwichSttProvider["transcribe"]>[0]> = [];
    const ttsInputs: Array<Parameters<SandwichTtsProvider["synthesize"]>[0]> = [];
    const runtime = createCostOptimizedSandwichRuntimeAdapter({
      stt: {
        async transcribe(input) {
          sttInputs.push(input);
          return {
            transcript: "Hello",
            confidence: 0.99,
            language: "en",
          };
        },
      },
      model: {
        streamText(input) {
          modelInputs.push(input);
          return streamChunks("Hello, this is Jane.");
        },
      },
      tts: {
        async synthesize(input) {
          ttsInputs.push(input);
          return {
            firstByteLatencyMs: 120,
            audio: streamChunks(`audio:${input.text}`),
          };
        },
      },
      now: () => "2026-05-12T12:00:00.000Z",
    });

    await runtime.runTurn({
      callSessionId: "call-concrete-agent",
      manifest,
      activeAgentId: "agent-jane-front-desk",
      audioFrames: ["frame-1"],
      context: {
        callPhase: "discovery",
      },
    });

    expect(sttInputs[0]).not.toHaveProperty("activeRole");
    expect(sttInputs[0]?.activeAgent).toMatchObject({
      agentId: "agent-jane-front-desk",
      name: "Jane",
    });
    expect(sttInputs[0]?.activeAgent).not.toHaveProperty("roleId");
    expect(ttsInputs[0]).not.toHaveProperty("activeRole");
    expect(ttsInputs[0]?.activeAgent).toMatchObject({
      agentId: "agent-jane-front-desk",
      name: "Jane",
    });
    expect(ttsInputs[0]?.activeAgent).not.toHaveProperty("roleId");
    expect(modelInputs[0]).not.toHaveProperty("activeRole");
    expect(modelInputs[0]?.activeAgent).toMatchObject({
      agentId: "agent-jane-front-desk",
      name: "Jane",
    });
    expect(modelInputs[0]?.activeAgent).not.toHaveProperty("roleId");
    expect(modelInputs[0]?.activeAgent?.name).not.toBe("New Agent");
  });

  it("streams STT, model, and TTS stages while emitting ordered call events", async () => {
    const manifest = compileManifest();
    const runtime = createCostOptimizedSandwichRuntimeAdapter({
      stt: {
        async transcribe() {
          return {
            transcript: "I need help with a billing charge",
            confidence: 0.84,
            language: "en",
          };
        },
      },
      model: {
        streamText() {
          return streamChunks("Let me pull up that charge", " and review it with you.");
        },
      },
      tts: {
        async synthesize() {
          return {
            firstByteLatencyMs: 210,
            audio: streamChunks("pcm-1", "pcm-2"),
          };
        },
      },
      now: () => "2026-05-12T12:00:00.000Z",
    });

    const result = await runtime.runTurn({
      callSessionId: "call-1",
      manifest,
      activeAgentId: "agent-front-desk",
      audioFrames: ["frame-1", "frame-2"],
      context: {
        intent: "billing",
        callPhase: "discovery",
      },
    });

    expect(result.transcript).toBe("I need help with a billing charge");
    expect(result.responseText).toBe("Let me pull up that charge and review it with you.");
    expect(result.audioChunks).toEqual(["pcm-1", "pcm-2"]);
    expect(result.routingDecision.tier).toBe("standard");
    expect(result.events.map((event) => event.type)).toEqual([
      "turn.started",
      "turn.transcribed",
      "routing.model_selected",
      "turn.response.started",
      "turn.audio.first_byte",
      "turn.completed",
    ]);
    expect(result.events[0]?.payload).toMatchObject({
      activeAgentId: "agent-front-desk",
    });
    expect(result.events[0]?.payload).not.toHaveProperty("activeRoleId");
  });

  it("identifies the selected text model provider and explicit model id in routing events", async () => {
    const publishedVersion = createPublishedWorkflowVersion();
    const manifest = compileManifest({
      publishedVersion: withAgentRoleConfig(publishedVersion, "agent-front-desk", {
        modelProvider: "google-gemini",
        modelId: "gemini-3.5-flash",
      }),
    });
    const runtime = createCostOptimizedSandwichRuntimeAdapter({
      stt: {
        async transcribe() {
          return {
            transcript: "Can you check my plan?",
            confidence: 0.91,
            language: "en",
          };
        },
      },
      model: {
        streamText() {
          return streamChunks("I can check that for you.");
        },
      },
      tts: {
        async synthesize() {
          return {
            firstByteLatencyMs: 180,
            audio: streamChunks("pcm-1"),
          };
        },
      },
      now: () => "2026-05-12T12:00:00.000Z",
    });

    const result = await runtime.runTurn({
      callSessionId: "call-gemini",
      manifest,
      activeAgentId: "agent-front-desk",
      audioFrames: ["frame-1"],
      context: {
        callPhase: "discovery",
      },
    });

    expect(result.events.find((event) => event.type === "routing.model_selected")?.payload)
      .toMatchObject({
        provider: "google-gemini",
        modelId: "gemini-3.5-flash",
      });
  });

  it("uses concrete active agent provider and voice config before stale role snapshot config", async () => {
    const concreteAgent = createAgentRoleNode({
      id: "agent-front-desk",
      label: "Stale canvas label",
      position: { x: 140, y: 60 },
      role: {
        kind: "receptionist",
        name: "Jane",
        businessName: "Tuzzy Labs",
        instructions: "Use the concrete agent config.",
        defaultModelTier: "standard",
        modelProvider: "google-gemini",
        modelId: "gemini-agent-config",
        voiceConfig: {
          provider: "cartesia",
          voiceId: "voice-concrete-agent",
          label: "Concrete agent voice",
          sourceType: "catalog",
          speed: 1.08,
          volume: 0.9,
        },
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en"],
          allowMidCallSwitching: true,
        },
      },
    });
    const graph = createWorkflowGraph({
      id: "workflow-concrete-agent-config",
      name: "Concrete agent config",
      nodes: [entryNode, concreteAgent],
      edges: [
        {
          id: "edge-entry-front-desk",
          sourceNodeId: "entry",
          targetNodeId: "agent-front-desk",
        },
      ],
    });
    const publishedVersion = publishWorkflowVersion({
      workflowId: graph.id,
      tenantId: "tenant-west-africa",
      environment: "sandbox",
      createdBy: "user-1",
      graph,
      existingVersions: [],
      runtime: "sandwich-pipeline",
      telephonyProvider: "browser-webrtc",
      memory: {
        mode: "scoped",
        retrievalScopes: ["session"],
        approvalRequired: true,
      },
      budget: {
        monthlyCapUsd: 1200,
        currentSpendUsd: 214,
        projectedCostPerMinuteUsd: 0.18,
        blockOnLimit: true,
      },
    });
    const manifest = compileManifest({ publishedVersion });
    const observedVoiceConfigs: unknown[] = [];
    const runtime = createCostOptimizedSandwichRuntimeAdapter({
      stt: {
        async transcribe() {
          return {
            transcript: "Can you check my plan?",
            confidence: 0.91,
            language: "en",
          };
        },
      },
      model: {
        streamText() {
          return streamChunks("I can check that for you.");
        },
      },
      tts: {
        async synthesize(input) {
          observedVoiceConfigs.push(input.voiceConfig);
          return {
            firstByteLatencyMs: 180,
            audio: streamChunks("pcm-1"),
          };
        },
      },
      now: () => "2026-05-12T12:00:00.000Z",
    });

    const result = await runtime.runTurn({
      callSessionId: "call-agent-config",
      manifest,
      activeAgentId: "agent-front-desk",
      audioFrames: ["frame-1"],
      context: {
        callPhase: "discovery",
      },
    });

    expect(result.events.find((event) => event.type === "routing.model_selected")?.payload)
      .toMatchObject({
        provider: "google-gemini",
        modelId: "gemini-agent-config",
      });
    expect(observedVoiceConfigs).toEqual([
      {
        provider: "cartesia",
        voiceId: "voice-concrete-agent",
        label: "Concrete agent voice",
        sourceType: "catalog",
        speed: 1.08,
        volume: 0.9,
      },
    ]);
  });

  it("streams model chunks into streaming-capable TTS before the full response is complete", async () => {
    const manifest = compileManifest();
    const events: string[] = [];
    const receivedTextChunks: string[] = [];
    let legacySynthesizeUsed = false;
    let streamingTtsStarted = false;

    const waitForStreamingTts = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return streamingTtsStarted;
    };

    const streamingTts = {
      async synthesize({ text }: { text: string }) {
        legacySynthesizeUsed = true;
        events.push("tts:legacy");
        return {
          firstByteLatencyMs: 180,
          audio: streamChunks(`audio:${text}`),
        };
      },
      async synthesizeStreaming({ textStream }: { textStream: AsyncIterable<string> }) {
        streamingTtsStarted = true;
        events.push("tts:streaming-started");

        for await (const chunk of textStream) {
          receivedTextChunks.push(chunk);
          events.push(`tts:chunk:${chunk}`);
        }

        return {
          firstByteLatencyMs: 180,
          audio: streamChunks("pcm-1"),
        };
      },
    };

    const runtime = createCostOptimizedSandwichRuntimeAdapter({
      stt: {
        async transcribe() {
          return {
            transcript: "Can you check my appointment?",
            confidence: 0.92,
            language: "en",
          };
        },
      },
      model: {
        async *streamText() {
          events.push("model:first");
          yield "I can check ";

          events.push((await waitForStreamingTts()) ? "model:tts-started" : "model:tts-not-started");
          events.push("model:second");
          yield "that appointment now.";
        },
      },
      tts: streamingTts,
      now: () => "2026-05-12T12:00:00.000Z",
    });

    const result = await runtime.runTurn({
      callSessionId: "call-streaming-tts",
      manifest,
      activeAgentId: "agent-front-desk",
      audioFrames: ["frame-1"],
      context: {
        callPhase: "discovery",
      },
    });

    expect(legacySynthesizeUsed).toBe(false);
    expect(receivedTextChunks).toEqual(["I can check ", "that appointment now."]);
    expect(events).toContain("model:tts-started");
    expect(events.indexOf("tts:streaming-started")).toBeLessThan(events.indexOf("model:second"));
    expect(result.responseText).toBe("I can check that appointment now.");
    expect(result.audioChunks).toEqual(["pcm-1"]);
    expect(result.events.map((event) => event.type)).toEqual([
      "turn.started",
      "turn.transcribed",
      "routing.model_selected",
      "turn.response.started",
      "turn.audio.first_byte",
      "turn.completed",
    ]);
  });

  it("surfaces TTS audio chunks before the full turn completes", async () => {
    const manifest = compileManifest();
    const observedAudioChunks: Array<{ chunk: string; index: number }> = [];
    let releaseSecondChunk = () => {};
    const secondChunkGate = new Promise<void>((resolve) => {
      releaseSecondChunk = resolve;
    });

    const runtime = createCostOptimizedSandwichRuntimeAdapter({
      stt: {
        async transcribe() {
          return {
            transcript: "Can you check my appointment?",
            confidence: 0.92,
            language: "en",
          };
        },
      },
      model: {
        streamText() {
          return streamChunks("I can check that appointment now.");
        },
      },
      tts: {
        async synthesize({ text }) {
          return {
            firstByteLatencyMs: 180,
            audio: (async function* () {
              yield `pcm-1:${text}`;
              await secondChunkGate;
              yield "pcm-2";
            })(),
          };
        },
      },
      now: () => "2026-05-12T12:00:00.000Z",
    });

    let turnSettled = false;
    let turnPromise: Promise<unknown>;
    const firstChunkSeen = new Promise<"seen">((resolve) => {
      turnPromise = runtime.runTurn({
        callSessionId: "call-streaming-audio",
        manifest,
        activeAgentId: "agent-front-desk",
        audioFrames: ["frame-1"],
        context: {
          callPhase: "discovery",
        },
        onAudioChunk: (chunk, index) => {
          observedAudioChunks.push({ chunk, index });
          if (index === 0) {
            resolve("seen");
          }
        },
      });

      void turnPromise.then(() => {
        turnSettled = true;
      });
    });

    const firstChunkSignal = await Promise.race([
      firstChunkSeen,
      new Promise<"missing">((resolve) => setTimeout(() => resolve("missing"), 25)),
    ]);
    expect(firstChunkSignal).toBe("seen");
    expect(turnSettled).toBe(false);

    releaseSecondChunk();
    await turnPromise!;

    expect(observedAudioChunks).toEqual([
      { chunk: "pcm-1:I can check that appointment now.", index: 0 },
      { chunk: "pcm-2", index: 1 },
    ]);
  });

  it("compiles multiple agent-owned toolbelt assignments without visual tool nodes", () => {
    const publishedVersion = createPublishedWorkflowVersion();
    const multiToolGraph = createWorkflowGraph({
      ...publishedVersion.graph,
      nodes: publishedVersion.graph.nodes.map((node) =>
        node.id === "agent-front-desk"
          ? {
              ...node,
              config: {
                ...node.config,
                role: {
                  ...(node.config["role"] as Record<string, unknown>),
                  toolbeltAssignments: [
                    ...(((node.config["role"] as { toolbeltAssignments?: unknown[] })["toolbeltAssignments"]) ?? []),
                  {
                    id: "create-profile-note",
                    toolId: "hubspot.notes.create",
                    label: "Create note",
                    description: "Create CRM note",
                    whenToUse: "Use when the caller gives a profile note worth saving.",
                    connector: "hubspot",
                    toolName: "Create note",
                    integrationConnectionId: "hubspot-prod",
                    integrationLabel: "HubSpot - Production",
                    connectionStatus: "connected",
                    risk: "medium",
                    requiresAuthorization: true,
                    requiresHumanApproval: true,
                  },
                  ],
                },
              },
            }
          : node,
      ),
    });
    const manifest = compileRuntimeManifest({
      publishedVersion: {
        ...publishedVersion,
        graph: multiToolGraph,
        tools: [
          ...publishedVersion.tools,
          {
            id: "hubspot.notes.create",
            name: "Create note",
            description: "Create CRM note",
            connector: "hubspot",
            requiresHumanApproval: true,
            risk: "medium",
          },
        ],
      },
      modelRouting: routingRules,
      telemetry: {
        captureAudio: false,
        captureTranscript: true,
        redactSensitiveData: true,
        sinks: ["live-monitor", "opentelemetry"],
      },
      availableIntegrationConnectionIds: ["hubspot-prod"],
    });

    expect(manifest.toolBindings.map((binding) => binding.toolId)).toEqual([
      "hubspot.notes.create",
      "hubspot.profile.lookup",
    ]);
    expect(manifest.agentToolAssignments.map((assignment) => ({
      id: assignment.id,
      toolId: assignment.toolId,
      requiresHumanApproval: assignment.requiresHumanApproval,
    }))).toEqual([
      {
        id: "agent-front-desk:create-profile-note",
        toolId: "hubspot.notes.create",
        requiresHumanApproval: true,
      },
      {
        id: "agent-front-desk:customer-profile-lookup",
        toolId: "hubspot.profile.lookup",
        requiresHumanApproval: false,
      },
    ]);
  });

  it("passes the concrete active agent voice configuration to TTS synthesis", async () => {
    const publishedVersion = createPublishedWorkflowVersion();
    const manifest = compileManifest({
      publishedVersion: withAgentRoleConfig(publishedVersion, "agent-front-desk", {
        voiceConfig: {
          provider: "cartesia" as const,
          voiceId: "voice-front-desk-approved",
          label: "Front desk voice",
          sourceType: "catalog" as const,
          speed: 1.12,
          volume: 0.95,
          emotion: "curiosity:low",
        },
      }),
    });
    const observedVoiceConfigs: unknown[] = [];
    const runtime = createCostOptimizedSandwichRuntimeAdapter({
      stt: {
        async transcribe() {
          return {
            transcript: "Can you check my appointment?",
            confidence: 0.92,
            language: "en",
          };
        },
      },
      model: {
        streamText() {
          return streamChunks("I can check that appointment now.");
        },
      },
      tts: {
        async synthesize(input) {
          observedVoiceConfigs.push(input.voiceConfig);
          return {
            firstByteLatencyMs: 120,
            audio: streamChunks(`audio:${input.text}`),
          };
        },
      },
      now: () => "2026-05-12T12:00:00.000Z",
    });

    await runtime.runTurn({
      callSessionId: "call-custom-voice",
      manifest,
      activeAgentId: "agent-front-desk",
      audioFrames: ["frame-1"],
      context: {
        callPhase: "discovery",
      },
    });

    expect(observedVoiceConfigs).toEqual([
      {
        provider: "cartesia",
        voiceId: "voice-front-desk-approved",
        label: "Front desk voice",
        sourceType: "catalog",
        speed: 1.12,
        volume: 0.95,
        emotion: "curiosity:low",
      },
    ]);
  });

  it("degrades predictably when STT times out", async () => {
    const manifest = compileManifest();
    const runtime = createCostOptimizedSandwichRuntimeAdapter({
      stt: {
        async transcribe() {
          throw new RuntimeProviderFailure("stt", "timeout", "STT provider timed out.");
        },
      },
      model: {
        streamText() {
          return streamChunks("unused");
        },
      },
      tts: {
        async synthesize({ text }) {
          return {
            firstByteLatencyMs: 120,
            audio: streamChunks(`audio:${text}`),
          };
        },
      },
      now: () => "2026-05-12T12:00:00.000Z",
    });

    const result = await runtime.runTurn({
      callSessionId: "call-2",
      manifest,
      activeAgentId: "agent-front-desk",
      audioFrames: ["frame-1"],
      context: {
        callPhase: "greeting",
      },
    });

    expect(result.degraded).toBe(true);
    expect(result.failureStage).toBe("stt");
    expect(result.responseText).toContain("didn't catch that");
    expect(result.events.map((event) => event.type)).toEqual([
      "turn.started",
      "call.failed",
      "routing.model_selected",
      "turn.response.started",
      "turn.audio.first_byte",
      "turn.completed",
    ]);
  });

  it("keeps a partial answer when the model stream is interrupted", async () => {
    const manifest = compileManifest();
    const runtime = createCostOptimizedSandwichRuntimeAdapter({
      stt: {
        async transcribe() {
          return {
            transcript: "I need to update my payment method",
            confidence: 0.78,
            language: "en",
          };
        },
      },
      model: {
        async *streamText() {
          yield "I can help update ";
          throw new RuntimeProviderFailure("model", "interrupted", "Model stream disconnected.");
        },
      },
      tts: {
        async synthesize({ text }) {
          return {
            firstByteLatencyMs: 190,
            audio: streamChunks(`audio:${text}`),
          };
        },
      },
      now: () => "2026-05-12T12:00:00.000Z",
    });

    const result = await runtime.runTurn({
      callSessionId: "call-3",
      manifest,
      activeAgentId: "agent-front-desk",
      audioFrames: ["frame-1"],
      context: {
        intent: "billing",
        callPhase: "discovery",
      },
    });

    expect(result.degraded).toBe(true);
    expect(result.failureStage).toBe("model");
    expect(result.responseText).toBe("I can help update");
    expect(result.events.map((event) => event.type)).toEqual([
      "turn.started",
      "turn.transcribed",
      "routing.model_selected",
      "turn.response.started",
      "quality.flagged",
      "turn.audio.first_byte",
      "turn.completed",
    ]);
  });

  it("flags TTS first-byte delay without dropping the turn", async () => {
    const manifest = compileManifest();
    const runtime = createCostOptimizedSandwichRuntimeAdapter({
      stt: {
        async transcribe() {
          return {
            transcript: "Please confirm the order status",
            confidence: 0.91,
            language: "en",
          };
        },
      },
      model: {
        streamText() {
          return streamChunks("I have the order details here.");
        },
      },
      tts: {
        async synthesize() {
          return {
            firstByteLatencyMs: 1600,
            audio: streamChunks("pcm-1"),
          };
        },
      },
      firstByteDelayThresholdMs: 800,
      now: () => "2026-05-12T12:00:00.000Z",
    });

    const result = await runtime.runTurn({
      callSessionId: "call-4",
      manifest,
      activeAgentId: "agent-front-desk",
      audioFrames: ["frame-1"],
      context: {
        callPhase: "resolution",
      },
    });

    expect(result.degraded).toBe(false);
    expect(result.events.map((event) => event.type)).toEqual([
      "turn.started",
      "turn.transcribed",
      "routing.model_selected",
      "turn.response.started",
      "quality.flagged",
      "turn.audio.first_byte",
      "turn.completed",
    ]);
    expect(result.events[4]?.payload).toEqual(
      expect.objectContaining({
        stage: "tts",
        latencyMs: 1600,
      }),
    );
  });
});

function assertManifest(manifest: CompiledRuntimeManifest) {
  expect(manifest.entryAgentId).toBeTruthy();
}

describe("runtime manifest test helpers", () => {
  it("keeps the helper type anchored to the public compiled manifest", () => {
    assertManifest(compileManifest());
  });
});
