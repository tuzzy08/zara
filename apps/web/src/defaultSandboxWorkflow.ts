import {
  createAgentRoleNode,
  createEndNode,
  createToolNode,
  createWorkflowGraph,
  publishWorkflowVersion,
} from "@zara/core";

import { tenantId } from "./workspaceState";

export function createDefaultSandboxPublishedWorkflow(workspaceId: string, organizationId = tenantId) {
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
      instructions: "Greet callers, gather context, and resolve or route safely.",
      defaultModelTier: "cheap",
      languagePolicy: {
        defaultLanguage: "en",
        supportedLanguages: ["en", "fr"],
        allowMidCallSwitching: true,
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
          includeRecentToolResults: true,
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
            transferInstructions: "Move invoice and refund conversations to the billing specialist lane.",
          },
        ],
        fallback: {
          label: "Resolved",
          target: {
            type: "exit",
            exitNodeId: "end-resolved",
          },
        },
      },
    },
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
        supportedLanguages: ["en"],
        allowMidCallSwitching: false,
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

  const apiTool = createToolNode({
    id: "tool-customer-profile",
    label: "Customer profile API",
    position: { x: 420, y: 40 },
    toolId: "hubspot.profile.lookup",
    tool: {
      connector: "webhook",
      toolName: "Customer profile lookup",
      integrationConnectionId: "hubspot-prod",
      integrationLabel: "HubSpot - Production",
      connectionStatus: "connected",
      risk: "high",
      requiresAuthorization: true,
      requiresHumanApproval: false,
      request: {
        method: "POST",
        url: "https://api.example.test/customers/lookup",
        authToken: "secret://hubspot/token",
        headers: [
          { name: "content-type", value: "application/json" },
          { name: "x-tenant-id", value: "{{tenant.id}}" },
        ],
        bodyTemplate: "{\"phone\":\"{{caller.phone}}\"}",
      },
    },
  });

  const graph = createWorkflowGraph({
    id: "workflow-sandbox-session",
    name: "Sandbox session",
    nodes: [entryNode, frontDeskAgent, apiTool, billingAgent, resolvedExit],
    edges: [
      {
        id: "edge-entry-front-desk",
        sourceNodeId: "entry",
        targetNodeId: "agent-front-desk",
      },
      {
        id: "edge-front-desk-tool",
        sourceNodeId: "agent-front-desk",
        targetNodeId: "tool-customer-profile",
      },
    ],
  });

  return publishWorkflowVersion({
    workflowId: graph.id,
    tenantId: organizationId,
    workspaceId,
    environment: "sandbox",
    createdBy: "ops-lead",
    graph,
    existingVersions: [],
    runtime: "sandwich-pipeline",
    runtimeProfile: "cost-optimized",
    telephonyProvider: "browser-webrtc",
    memory: {
      mode: "scoped",
      retrievalScopes: ["session", "caller"],
      approvalRequired: true,
    },
    budget: {
      monthlyCapUsd: 80,
      currentSpendUsd: 18,
      projectedCostPerMinuteUsd: 0.22,
      blockOnLimit: true,
    },
  });
}
