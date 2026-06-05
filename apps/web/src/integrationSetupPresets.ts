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

type KnowledgeSourceSetupModes = Extract<
  IntegrationSetupCapabilityIntent,
  { capability: "knowledge-source" }
>["modes"];

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

export interface IntegrationSetupCopyRequiredSelectionPreview {
  id: IntegrationSetupTemplateRequiredSelection;
  label: string;
}

export interface IntegrationSetupCopyCapabilityRow {
  title: string;
  detail: string;
  approvalLabel: string;
}

export interface IntegrationSetupCopyPreview {
  presetId: IntegrationSetupPresetId;
  title: string;
  recommendedConnectionScopeLabel: string;
  requiredSelections: IntegrationSetupCopyRequiredSelectionPreview[];
  capabilityRows: IntegrationSetupCopyCapabilityRow[];
  notClonedItems: string[];
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

const requiredSelectionLabels: Record<IntegrationSetupTemplateRequiredSelection, string> = {
  "target-workspace": "Choose target workspace",
  "provider-connection": "Select provider connection",
  "capability-grant": "Review capability grants",
  "knowledge-source-category": "Choose source categories",
  "risky-write-confirmation": "Confirm risky write tools",
};

const notClonedSetupItems = [
  "Credentials",
  "OAuth grants",
  "Connection IDs",
  "Grant IDs",
  "Source IDs",
  "Workspace-owned source access",
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

export function createIntegrationSetupCopyPreview(
  template: CopyableIntegrationSetupTemplate,
  providers: IntegrationProviderCatalogEntry[],
): IntegrationSetupCopyPreview {
  const providerLabels = new Map(providers.map((provider) => [provider.id, provider.label]));

  return {
    presetId: template.presetId,
    title: `Copy ${template.name} setup`,
    recommendedConnectionScopeLabel: getConnectionScopeDisplayLabel(template.recommendedConnectionScope),
    requiredSelections: template.requiredTargetSelections.map((selection) => ({
      id: selection,
      label: requiredSelectionLabels[selection],
    })),
    capabilityRows: template.capabilityIntents.map((intent) => createCopyCapabilityRow(intent, providerLabels)),
    notClonedItems: [...notClonedSetupItems],
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

function createCopyCapabilityRow(
  intent: IntegrationSetupCapabilityIntent,
  providerLabels: Map<IntegrationProviderId, string>,
): IntegrationSetupCopyCapabilityRow {
  const providerLabel = providerLabels.get(intent.providerId) ?? intent.providerId;

  switch (intent.capability) {
    case "agent-tool":
      return {
        title: `${providerLabel} - ${intent.toolName}`,
        detail: "Agent tool",
        approvalLabel: getApprovalDisplayLabel(intent.approvalRequired),
      };
    case "knowledge-source":
      return {
        title: `${providerLabel} knowledge source`,
        detail: formatKnowledgeSourceModes(intent.modes),
        approvalLabel: getApprovalDisplayLabel(intent.approvalRequired),
      };
    case "post-call-sync":
      return {
        title: `${providerLabel} call summary sync`,
        detail: "Post-call sync",
        approvalLabel: getApprovalDisplayLabel(intent.approvalRequired),
      };
  }
}

function getConnectionScopeDisplayLabel(scope: CopyableIntegrationSetupTemplate["recommendedConnectionScope"]) {
  return scope === "workspace" ? "Use only in this workspace" : "Use across organization";
}

function getApprovalDisplayLabel(approvalRequired: boolean) {
  return approvalRequired ? "Approval required" : "No approval required";
}

function formatKnowledgeSourceModes(modes: KnowledgeSourceSetupModes) {
  const labels = modes.map((mode) => (mode === "snapshot-import" ? "snapshot import" : "recurring sync"));

  if (labels.length === 0) {
    return "Knowledge source";
  }

  const firstLabel = labels[0];
  const remainingLabels = labels.slice(1);

  if (firstLabel === undefined) {
    return "Knowledge source";
  }

  return [capitalizeFirst(firstLabel), ...remainingLabels].join(" and ");
}

function capitalizeFirst(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
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
