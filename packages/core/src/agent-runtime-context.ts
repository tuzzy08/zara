import type {
  AgentRoleKind,
  AgentVoiceConfig,
  ID,
  LanguagePolicy,
  ModelTier,
  RealtimeProviderId,
  RealtimeVoiceConfig,
  RuntimeProfileId,
  TextModelProviderId,
} from "./index";
import type {
  CompiledRuntimeAgentToolAssignment,
  CompiledRuntimeManifest,
} from "./runtime";
import type { AgentHandoffTarget, RuntimeAgentRef } from "./turn-runtime-packet";
import type { AgentRoleNodeConfig } from "./workflow";

export interface RuntimeAgentDefinition {
  agentId: ID;
  nodeId: ID;
  name: string;
  kind: AgentRoleKind;
  businessName: string;
  instructions: string;
  defaultModelTier: ModelTier;
  modelProvider?: TextModelProviderId | undefined;
  modelId?: string | undefined;
  realtimeProvider?: RealtimeProviderId | undefined;
  realtimeModelId?: string | undefined;
  runtimeProfileOverride?: RuntimeProfileId | undefined;
  realtimeVoiceConfig?: RealtimeVoiceConfig | undefined;
  voiceConfig?: AgentVoiceConfig | undefined;
  languagePolicy: LanguagePolicy;
  toolAssignments: CompiledRuntimeAgentToolAssignment[];
}

export type Agent = RuntimeAgentDefinition;

export interface AgentRuntimeContext {
  organizationId: ID;
  workspaceId: ID;
  callSessionId: ID;
  actorUserId: ID;
  manifest: {
    manifestId: ID;
    version: number;
    publishedVersionId: ID;
    workflowId: ID;
  };
  agent: RuntimeAgentDefinition;
}

export function resolveRuntimeAgents(
  manifest: Pick<CompiledRuntimeManifest, "agentToolAssignments" | "graph">,
): RuntimeAgentDefinition[] {
  return manifest.graph.nodes.flatMap((node) => {
    if (node.kind !== "agent") {
      return [];
    }

    const agentConfig = getAgentNodeRoleConfig(node);
    const roleName = agentConfig?.name.trim() ?? "";

    if (agentConfig === undefined || roleName.length === 0) {
      return [];
    }

    return [{
      agentId: node.id,
      nodeId: node.id,
      name: roleName,
      kind: agentConfig.kind,
      businessName: agentConfig.businessName,
      instructions: agentConfig.instructions,
      defaultModelTier: agentConfig.defaultModelTier,
      ...(agentConfig.modelProvider !== undefined ? { modelProvider: agentConfig.modelProvider } : {}),
      ...(agentConfig.modelId !== undefined ? { modelId: agentConfig.modelId } : {}),
      ...(agentConfig.realtimeProvider !== undefined ? { realtimeProvider: agentConfig.realtimeProvider } : {}),
      ...(agentConfig.realtimeModelId !== undefined ? { realtimeModelId: agentConfig.realtimeModelId } : {}),
      ...(agentConfig.runtimeProfileOverride !== undefined ? { runtimeProfileOverride: agentConfig.runtimeProfileOverride } : {}),
      ...(agentConfig.realtimeVoiceConfig !== undefined ? { realtimeVoiceConfig: { ...agentConfig.realtimeVoiceConfig } } : {}),
      ...(agentConfig.voiceConfig !== undefined ? { voiceConfig: { ...agentConfig.voiceConfig } } : {}),
      languagePolicy: {
        defaultLanguage: agentConfig.languagePolicy.defaultLanguage,
        supportedLanguages: [...agentConfig.languagePolicy.supportedLanguages],
        allowMidCallSwitching: agentConfig.languagePolicy.allowMidCallSwitching,
        ...(agentConfig.languagePolicy.languagePrompts !== undefined
          ? { languagePrompts: { ...agentConfig.languagePolicy.languagePrompts } }
          : {}),
      },
      toolAssignments: (manifest.agentToolAssignments ?? [])
        .filter((assignment) => assignment.agentId === node.id)
        .map(cloneAgentToolAssignment),
    }];
  });
}

function getAgentNodeRoleConfig(node: CompiledRuntimeManifest["graph"]["nodes"][number]): AgentRoleNodeConfig | undefined {
  const config = node.config;

  if (typeof config !== "object" || config === null) {
    return undefined;
  }

  const role = config["role"];

  if (typeof role !== "object" || role === null) {
    return undefined;
  }

  return role as AgentRoleNodeConfig;
}

export function createAgentRuntimeContext(input: {
  manifest: Pick<
    CompiledRuntimeManifest,
    "agentToolAssignments" | "graph" | "manifestId" | "publishedVersionId" | "tenantId" | "version" | "workflowId" | "workspaceId"
  >;
  activeAgentId: ID;
  callSessionId: ID;
  actorUserId: ID;
}): AgentRuntimeContext {
  const agent = resolveRuntimeAgent(input.manifest, input.activeAgentId);

  if (agent === undefined) {
    throw new Error(`Agent '${input.activeAgentId}' is not present in runtime manifest '${input.manifest.manifestId}'.`);
  }

  return {
    organizationId: input.manifest.tenantId,
    workspaceId: input.manifest.workspaceId ?? "workspace-default",
    callSessionId: input.callSessionId,
    actorUserId: input.actorUserId,
    manifest: {
      manifestId: input.manifest.manifestId,
      version: input.manifest.version,
      publishedVersionId: input.manifest.publishedVersionId,
      workflowId: input.manifest.workflowId,
    },
    agent,
  };
}

export function resolveRuntimeAgent(
  manifest: Pick<CompiledRuntimeManifest, "agentToolAssignments" | "graph">,
  agentId: ID,
): RuntimeAgentDefinition | undefined {
  const agents = resolveRuntimeAgents(manifest);

  return agents.find((candidate) => candidate.agentId === agentId);
}

export function agentToRuntimeAgentRef(agent: RuntimeAgentDefinition): RuntimeAgentRef {
  return {
    id: agent.agentId,
    name: agent.name,
    kind: agent.kind,
  };
}

export function agentSupportsLanguage(
  agent: Pick<RuntimeAgentDefinition, "languagePolicy">,
  language: string | undefined,
): boolean {
  const normalizedLanguage = normalizeLanguageCode(language);

  if (normalizedLanguage === undefined) {
    return true;
  }

  const supportedLanguages = [
    agent.languagePolicy.defaultLanguage,
    ...agent.languagePolicy.supportedLanguages,
  ].flatMap((supportedLanguage) => {
    const normalized = normalizeLanguageCode(supportedLanguage);
    return normalized === undefined ? [] : [normalized];
  });

  return supportedLanguages.length === 0 || supportedLanguages.includes(normalizedLanguage);
}

export function buildAgentHandoffTargets(
  manifest: Pick<CompiledRuntimeManifest, "agentToolAssignments" | "graph">,
  routePolicy: CompiledRuntimeManifest["routePolicies"][number],
): AgentHandoffTarget[] {
  const agentsById = new Map(resolveRuntimeAgents(manifest).map((agent) => [agent.agentId, agent]));

  return routePolicy.branches.flatMap((branch) => {
    if (branch.target.type !== "agent") {
      return [];
    }

    const targetAgent = agentsById.get(branch.target.agentId);

    if (targetAgent === undefined) {
      return [];
    }

    return [{
      targetAgentId: targetAgent.agentId,
      targetAgentName: targetAgent.name,
      targetAgentKind: targetAgent.kind,
    }];
  });
}

function cloneAgentToolAssignment(
  assignment: CompiledRuntimeAgentToolAssignment,
): CompiledRuntimeAgentToolAssignment {
  return {
    ...assignment,
    inputSchema: { ...assignment.inputSchema },
    requiredInputs: [...assignment.requiredInputs],
  };
}

function normalizeLanguageCode(language: string | undefined) {
  const normalized = language?.trim().toLowerCase();

  if (normalized === undefined || normalized.length === 0) {
    return undefined;
  }

  return normalized.split(/[-_]/)[0];
}
