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

export interface RuntimeAgentDefinition {
  agentId: ID;
  nodeId: ID;
  roleId: ID;
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
  manifest: Pick<CompiledRuntimeManifest, "agentToolAssignments" | "graph" | "roles">,
): RuntimeAgentDefinition[] {
  return manifest.graph.nodes.flatMap((node) => {
    if (node.kind !== "agent") {
      return [];
    }

    const roleId = node.roleId ?? node.id;
    const role = manifest.roles.find((candidate) => candidate.id === roleId);
    const roleName = role?.name.trim() ?? "";

    if (role === undefined || roleName.length === 0) {
      return [];
    }

    return [{
      agentId: node.id,
      nodeId: node.id,
      roleId,
      name: roleName,
      kind: role.kind,
      businessName: role.businessName,
      instructions: role.instructions,
      defaultModelTier: role.defaultModelTier,
      ...(role.modelProvider !== undefined ? { modelProvider: role.modelProvider } : {}),
      ...(role.modelId !== undefined ? { modelId: role.modelId } : {}),
      ...(role.realtimeProvider !== undefined ? { realtimeProvider: role.realtimeProvider } : {}),
      ...(role.realtimeModelId !== undefined ? { realtimeModelId: role.realtimeModelId } : {}),
      ...(role.runtimeProfileOverride !== undefined ? { runtimeProfileOverride: role.runtimeProfileOverride } : {}),
      ...(role.realtimeVoiceConfig !== undefined ? { realtimeVoiceConfig: { ...role.realtimeVoiceConfig } } : {}),
      ...(role.voiceConfig !== undefined ? { voiceConfig: { ...role.voiceConfig } } : {}),
      languagePolicy: {
        defaultLanguage: role.languagePolicy.defaultLanguage,
        supportedLanguages: [...role.languagePolicy.supportedLanguages],
        allowMidCallSwitching: role.languagePolicy.allowMidCallSwitching,
        ...(role.languagePolicy.languagePrompts !== undefined
          ? { languagePrompts: { ...role.languagePolicy.languagePrompts } }
          : {}),
      },
      toolAssignments: (manifest.agentToolAssignments ?? [])
        .filter((assignment) => assignment.roleId === roleId)
        .map(cloneAgentToolAssignment),
    }];
  });
}

export function createAgentRuntimeContext(input: {
  manifest: Pick<
    CompiledRuntimeManifest,
    "agentToolAssignments" | "graph" | "manifestId" | "publishedVersionId" | "roles" | "tenantId" | "version" | "workflowId" | "workspaceId"
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
  manifest: Pick<CompiledRuntimeManifest, "agentToolAssignments" | "graph" | "roles">,
  agentId: ID,
): RuntimeAgentDefinition | undefined {
  const agents = resolveRuntimeAgents(manifest);

  return (
    agents.find((candidate) => candidate.agentId === agentId)
    ?? agents.find((candidate) => candidate.roleId === agentId)
  );
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
  manifest: Pick<CompiledRuntimeManifest, "agentToolAssignments" | "graph" | "roles">,
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
