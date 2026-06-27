export type ReusableAgentRuntimeProfile = "cost-optimized" | "premium-realtime";

export interface ReusableAgent {
  id: string;
  organizationId: string;
  workspaceId: string;
  name: string;
  agentClass: string;
  instructions: string;
  defaultLanguage: string;
  runtimeProfile: ReusableAgentRuntimeProfile;
  toolbeltAssignmentIds: string[];
  createdAt: string;
}

const reusableAgentsKey = "zara.web.reusable-agents.v1";

export function loadReusableAgentsForWorkspace(input: {
  organizationId: string;
  workspaceId: string;
}): ReusableAgent[] {
  return loadReusableAgents()
    .filter((agent) =>
      agent.organizationId === input.organizationId &&
      agent.workspaceId === input.workspaceId
    )
    .sort(compareReusableAgents);
}

export function saveReusableAgent(agent: ReusableAgent): ReusableAgent[] {
  const nextAgents = [
    agent,
    ...loadReusableAgents().filter((candidate) => candidate.id !== agent.id),
  ].sort(compareReusableAgents);
  const storage = getStorage();

  if (storage !== null) {
    storage.setItem(reusableAgentsKey, JSON.stringify(nextAgents));
  }

  return nextAgents;
}

export function createReusableAgent(input: {
  organizationId: string;
  workspaceId: string;
  name: string;
  agentClass: string;
  instructions: string;
  defaultLanguage: string;
  runtimeProfile: ReusableAgentRuntimeProfile;
  now?: string | undefined;
}): ReusableAgent {
  const name = input.name.trim();

  return {
    id: `agent-${slugifyAgentName(name)}`,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    name,
    agentClass: input.agentClass.trim(),
    instructions: input.instructions.trim(),
    defaultLanguage: input.defaultLanguage.trim(),
    runtimeProfile: input.runtimeProfile,
    toolbeltAssignmentIds: [],
    createdAt: input.now ?? new Date().toISOString(),
  };
}

function loadReusableAgents(): ReusableAgent[] {
  const storage = getStorage();

  if (storage === null) {
    return [];
  }

  try {
    const parsed = JSON.parse(storage.getItem(reusableAgentsKey) ?? "[]");

    if (!Array.isArray(parsed)) {
      return [];
    }

    const agents = parsed.filter(isReusableAgent);
    storage.setItem(reusableAgentsKey, JSON.stringify(agents));

    return agents;
  } catch {
    return [];
  }
}

function isReusableAgent(value: unknown): value is ReusableAgent {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ReusableAgent>;

  return (
    isNonEmptyString(candidate.id) &&
    isNonEmptyString(candidate.organizationId) &&
    isNonEmptyString(candidate.workspaceId) &&
    isNonEmptyString(candidate.name) &&
    isNonEmptyString(candidate.agentClass) &&
    isNonEmptyString(candidate.instructions) &&
    isNonEmptyString(candidate.defaultLanguage) &&
    isReusableAgentRuntimeProfile(candidate.runtimeProfile) &&
    Array.isArray(candidate.toolbeltAssignmentIds) &&
    candidate.toolbeltAssignmentIds.every((assignmentId) => typeof assignmentId === "string") &&
    isNonEmptyString(candidate.createdAt)
  );
}

function isReusableAgentRuntimeProfile(value: unknown): value is ReusableAgentRuntimeProfile {
  return value === "cost-optimized" || value === "premium-realtime";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function compareReusableAgents(a: ReusableAgent, b: ReusableAgent) {
  return a.name.localeCompare(b.name) || a.createdAt.localeCompare(b.createdAt);
}

function slugifyAgentName(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length > 0 ? slug : "untitled";
}

function getStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}
