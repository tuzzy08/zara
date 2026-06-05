import type {
  IntegrationProviderCatalogEntry,
  IntegrationProviderId,
  IntegrationProviderRiskPosture,
} from "@zara/core";

export type IntegrationSetupPresetId = "support" | "sales" | "ecommerce";

export type IntegrationSetupCapabilityIntent =
  | {
      capability: "agent-tool";
      providerId: IntegrationProviderId;
      toolId: string;
      toolName: string;
      riskPosture: IntegrationProviderRiskPosture;
      approvalRequired: boolean;
    }
  | {
      capability: "knowledge-source";
      providerId: IntegrationProviderId;
      modes: ("snapshot-import" | "recurring-sync")[];
      approvalRequired: boolean;
    }
  | {
      capability: "post-call-sync";
      providerId: IntegrationProviderId;
      target: "call-summary";
      riskPosture: IntegrationProviderRiskPosture;
      approvalRequired: boolean;
    };

export interface IntegrationSetupPresetPreview {
  id: IntegrationSetupPresetId;
  name: string;
  summary: string;
  recommendedConnectionScope: "workspace" | "organization";
  capabilityIntents: IntegrationSetupCapabilityIntent[];
}

export type IntegrationSetupTemplateRequiredSelection =
  | "target-workspace"
  | "provider-connection"
  | "capability-grant"
  | "knowledge-source-category"
  | "risky-write-confirmation";

export interface CopyableIntegrationSetupTemplate {
  presetId: IntegrationSetupPresetId;
  name: string;
  recommendedConnectionScope: "workspace" | "organization";
  requiredTargetSelections: IntegrationSetupTemplateRequiredSelection[];
  capabilityIntents: IntegrationSetupCapabilityIntent[];
}

interface PresetDefinition {
  id: IntegrationSetupPresetId;
  name: string;
  summary: string;
  agentToolIds: string[];
  knowledgeSourceProviderIds: IntegrationProviderId[];
  postCallSyncProviderIds: IntegrationProviderId[];
}

const presetDefinitions: PresetDefinition[] = [
  {
    id: "support",
    name: "Support agent",
    summary: "Resolve customer issues from tickets, approved help content, and CRM follow-up notes.",
    agentToolIds: ["zendesk.tickets.search", "zendesk.tickets.create", "zendesk.tickets.update"],
    knowledgeSourceProviderIds: ["zendesk", "notion"],
    postCallSyncProviderIds: ["hubspot"],
  },
  {
    id: "sales",
    name: "Sales agent",
    summary: "Qualify leads, find CRM context, schedule meetings, and queue approved sales follow-up.",
    agentToolIds: [
      "hubspot.contacts.lookup",
      "hubspot.notes.create",
      "hubspot.pipeline.update",
      "google.calendar.events.create",
    ],
    knowledgeSourceProviderIds: ["notion"],
    postCallSyncProviderIds: ["hubspot"],
  },
  {
    id: "ecommerce",
    name: "Ecommerce support",
    summary: "Handle order-support conversations with ticket lookup, storefront knowledge, and ticket summaries.",
    agentToolIds: ["zendesk.tickets.search", "zendesk.tickets.create"],
    knowledgeSourceProviderIds: ["notion"],
    postCallSyncProviderIds: ["hubspot"],
  },
];

export function createIntegrationSetupPresetPreviews(
  providers: IntegrationProviderCatalogEntry[],
): IntegrationSetupPresetPreview[] {
  return presetDefinitions.map((definition) => ({
    id: definition.id,
    name: definition.name,
    summary: definition.summary,
    recommendedConnectionScope: "workspace",
    capabilityIntents: createCapabilityIntents(definition, providers),
  }));
}

export function createCopyableIntegrationSetupTemplate(
  preview: IntegrationSetupPresetPreview,
): CopyableIntegrationSetupTemplate {
  return {
    presetId: preview.id,
    name: preview.name,
    recommendedConnectionScope: preview.recommendedConnectionScope,
    requiredTargetSelections: [
      "target-workspace",
      "provider-connection",
      "capability-grant",
      "knowledge-source-category",
      "risky-write-confirmation",
    ],
    capabilityIntents: preview.capabilityIntents.map(cloneCapabilityIntent),
  };
}

function createCapabilityIntents(
  definition: PresetDefinition,
  providers: IntegrationProviderCatalogEntry[],
): IntegrationSetupCapabilityIntent[] {
  const agentToolIntents = definition.agentToolIds.flatMap((toolId) => createAgentToolIntent(toolId, providers));
  const knowledgeSourceIntents = definition.knowledgeSourceProviderIds.flatMap((providerId) =>
    createKnowledgeSourceIntent(providerId, providers),
  );
  const postCallSyncIntents = definition.postCallSyncProviderIds.flatMap((providerId) =>
    createPostCallSyncIntent(providerId, providers),
  );

  return [...agentToolIntents, ...knowledgeSourceIntents, ...postCallSyncIntents];
}

function createAgentToolIntent(
  toolId: string,
  providers: IntegrationProviderCatalogEntry[],
): IntegrationSetupCapabilityIntent[] {
  for (const provider of providers) {
    const tool = provider.tools.find((candidate) => candidate.id === toolId);

    if (tool !== undefined) {
      return [
        {
          capability: "agent-tool",
          providerId: provider.id,
          toolId: tool.id,
          toolName: tool.name,
          riskPosture: tool.riskPosture,
          approvalRequired: tool.riskPosture !== "low",
        },
      ];
    }
  }

  return [];
}

function createKnowledgeSourceIntent(
  providerId: IntegrationProviderId,
  providers: IntegrationProviderCatalogEntry[],
): IntegrationSetupCapabilityIntent[] {
  const provider = providers.find((candidate) => candidate.id === providerId);

  if (provider === undefined || !provider.knowledgeSource.supported) {
    return [];
  }

  return [
    {
      capability: "knowledge-source",
      providerId,
      modes: [...provider.knowledgeSource.modes],
      approvalRequired: true,
    },
  ];
}

function cloneCapabilityIntent(intent: IntegrationSetupCapabilityIntent): IntegrationSetupCapabilityIntent {
  switch (intent.capability) {
    case "agent-tool":
      return { ...intent };
    case "knowledge-source":
      return { ...intent, modes: [...intent.modes] };
    case "post-call-sync":
      return { ...intent };
  }
}

function createPostCallSyncIntent(
  providerId: IntegrationProviderId,
  providers: IntegrationProviderCatalogEntry[],
): IntegrationSetupCapabilityIntent[] {
  const provider = providers.find((candidate) => candidate.id === providerId);

  if (provider === undefined || !provider.capabilities.includes("post-call-sync")) {
    return [];
  }

  return [
    {
      capability: "post-call-sync",
      providerId,
      target: "call-summary",
      riskPosture: "medium",
      approvalRequired: true,
    },
  ];
}
