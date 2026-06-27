import { useEffect, useMemo, useState } from "react";
import { Bot, Plus, Wrench } from "lucide-react";
import { Button, Card, Empty, Input, Select, Textarea } from "@zara/ui";
import type { IntegrationProviderCatalogEntry } from "@zara/core";

import { TenantPageIntro } from "./TenantPageIntro";
import { TenantSectionHeader } from "./TenantSectionHeader";
import { TenantSummaryGrid } from "./TenantSummaryGrid";
import { type TenantPageProps } from "./tenantPageTypes";
import { fetchIntegrationCatalog, fetchIntegrationConnections, type IntegrationConnection } from "./tenantIntegrationsApi";
import {
  createReusableAgent,
  fetchReusableAgents,
  type ReusableAgent,
  type ReusableAgentToolbeltAssignment,
  type ReusableAgentRuntimeProfile,
  updateReusableAgentToolbelt,
} from "./reusableAgents";
import {
  createWorkflowToolCatalog,
  getIntegrationOptionsForConnector,
  getToolCatalogItem,
  type ToolCatalogItem,
} from "./workflowBuilderToolCatalog";

const agentClassOptions = [
  { value: "receptionist", label: "Receptionist" },
  { value: "support-specialist", label: "Support specialist" },
  { value: "sales-specialist", label: "Sales specialist" },
  { value: "scheduler", label: "Scheduler" },
  { value: "billing-specialist", label: "Billing specialist" },
] as const;

const runtimeProfileOptions: Array<{ value: ReusableAgentRuntimeProfile; label: string }> = [
  { value: "cost-optimized", label: "Cost optimized" },
  { value: "premium-realtime", label: "Premium realtime" },
];

export function TenantAgentsScreen({ organizationId, activeWorkspaceId, showToast }: TenantPageProps) {
  const [agents, setAgents] = useState<ReusableAgent[]>([]);
  const [draft, setDraft] = useState(() => createEmptyAgentDraft());
  const [integrationConnections, setIntegrationConnections] = useState<IntegrationConnection[]>([]);
  const [toolCatalogItems, setToolCatalogItems] = useState<ToolCatalogItem[]>([]);
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [toolbeltDrafts, setToolbeltDrafts] = useState<Record<string, ToolbeltDraft>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [savingToolbeltAgentId, setSavingToolbeltAgentId] = useState<string | null>(null);
  const createDisabled = submitting || draft.name.trim().length === 0 || draft.instructions.trim().length === 0;
  const sortedAgents = useMemo(() => [...agents].sort((a, b) => a.name.localeCompare(b.name)), [agents]);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    const integrationsPromise = Promise.all([
      fetchIntegrationConnections(organizationId, activeWorkspaceId),
      fetchIntegrationCatalog(organizationId),
    ]).catch(() => [[], []] as [IntegrationConnection[], IntegrationProviderCatalogEntry[]]);

    void Promise.all([
      fetchReusableAgents({
        organizationId,
        workspaceId: activeWorkspaceId,
      }),
      integrationsPromise,
    ])
      .then(([nextAgents, [nextConnections, nextCatalogProviders]]) => {
        if (!cancelled) {
          setAgents(nextAgents);
          setIntegrationConnections(nextConnections.filter((connection) => connection.status === "connected"));
          setToolCatalogItems(createWorkflowToolCatalog(
            nextCatalogProviders.filter((provider) => provider.capabilities.includes("agent-tool")),
          ));
          setExpandedAgentId(null);
          setToolbeltDrafts({});
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setAgents([]);
          showToast(error instanceof Error ? error.message : "Reusable agents could not be loaded.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, organizationId, showToast]);

  const updateDraft = (patch: Partial<AgentDraft>) => {
    setDraft((current) => ({
      ...current,
      ...patch,
    }));
  };

  const createAgent = () => {
    if (createDisabled) {
      showToast("Add an agent name and instructions before saving.");
      return;
    }

    setSubmitting(true);
    void createReusableAgent({
      organizationId,
      workspaceId: activeWorkspaceId,
      name: draft.name,
      agentClass: draft.agentClass,
      instructions: draft.instructions,
      defaultLanguage: draft.defaultLanguage,
      runtimeProfile: draft.runtimeProfile,
    })
      .then((agent) => {
        setAgents((current) => [
          agent,
          ...current.filter((candidate) => candidate.id !== agent.id),
        ]);
        setDraft(createEmptyAgentDraft());
        showToast(`${agent.name} saved to reusable agents.`);
      })
      .catch((error) => {
        showToast(error instanceof Error ? error.message : "Reusable agent could not be saved.");
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  const toggleToolbeltPanel = (agent: ReusableAgent) => {
    setExpandedAgentId((current) => {
      const nextAgentId = current === agent.id ? null : agent.id;

      if (nextAgentId !== null) {
        setToolbeltDrafts((currentDrafts) => ({
          ...currentDrafts,
          [agent.id]: currentDrafts[agent.id] ?? createToolbeltDraft(agent, toolCatalogItems, integrationConnections),
        }));
      }

      return nextAgentId;
    });
  };

  const updateToolbeltDraft = (agentId: string, patch: Partial<ToolbeltDraft>) => {
    setToolbeltDrafts((current) => ({
      ...current,
      [agentId]: {
        ...(current[agentId] ?? createEmptyToolbeltDraft()),
        ...patch,
      },
    }));
  };

  const saveToolbelt = (agent: ReusableAgent) => {
    const toolbeltDraft = toolbeltDrafts[agent.id] ?? createToolbeltDraft(agent, toolCatalogItems, integrationConnections);
    const selectedTool = getToolCatalogItem(toolCatalogItems, toolbeltDraft.toolId);

    if (selectedTool === undefined) {
      showToast("Select a catalog tool before saving.");
      return;
    }

    if (selectedTool.requiresAuthorization && toolbeltDraft.integrationConnectionId.length === 0) {
      showToast("Select a connected provider account before saving.");
      return;
    }

    setSavingToolbeltAgentId(agent.id);
    void updateReusableAgentToolbelt({
      organizationId,
      workspaceId: activeWorkspaceId,
      agentId: agent.id,
      assignments: [
        ...agent.toolbeltAssignments.filter((assignment) => assignment.toolId !== selectedTool.toolId),
        createToolbeltAssignment(selectedTool, toolbeltDraft.integrationConnectionId),
      ],
    })
      .then((updatedAgent) => {
        setAgents((current) => current.map((candidate) => candidate.id === updatedAgent.id ? updatedAgent : candidate));
        setToolbeltDrafts((current) => ({
          ...current,
          [updatedAgent.id]: createToolbeltDraft(updatedAgent, toolCatalogItems, integrationConnections),
        }));
        showToast(`${updatedAgent.name} toolbelt saved.`);
      })
      .catch((error) => {
        showToast(error instanceof Error ? error.message : "Toolbelt could not be saved.");
      })
      .finally(() => {
        setSavingToolbeltAgentId(null);
      });
  };

  return (
    <div className="tenant-feature-page">
      <TenantPageIntro
        icon={Bot}
        eyebrow="Agents"
        title="Agent library"
        body="Create concrete, reusable agents with stable names, instructions, runtime posture, and toolbelt readiness before assigning them to workflows."
      />

      <TenantSummaryGrid
        items={[
          { label: "Reusable agents", value: String(agents.length), detail: "Concrete profiles" },
          { label: "Toolbelts", value: String(agents.reduce((count, agent) => count + agent.toolbeltAssignments.length, 0)), detail: "Assigned tools" },
          { label: "Workspace", value: activeWorkspaceId, detail: "Active scope" },
        ]}
      />

      <section className="tenant-agents-layout">
        <Card className="surface-card overflow-hidden">
          <TenantSectionHeader eyebrow="Create" title="Reusable concrete agent" />
          <div className="tenant-agent-form">
            <label className="form-field">
              <span>Agent name</span>
              <Input
                aria-label="Agent name"
                value={draft.name}
                onChange={(event) => updateDraft({ name: event.target.value })}
                placeholder="Support concierge"
              />
            </label>
            <label className="form-field">
              <span>Agent class</span>
              <Select
                aria-label="Agent class"
                value={draft.agentClass}
                onChange={(event) => updateDraft({ agentClass: event.target.value })}
              >
                {agentClassOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </label>
            <label className="form-field">
              <span>Default language</span>
              <Select
                aria-label="Default language"
                value={draft.defaultLanguage}
                onChange={(event) => updateDraft({ defaultLanguage: event.target.value })}
              >
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
              </Select>
            </label>
            <label className="form-field">
              <span>Runtime profile</span>
              <Select
                aria-label="Runtime profile"
                value={draft.runtimeProfile}
                onChange={(event) => updateDraft({ runtimeProfile: event.target.value as ReusableAgentRuntimeProfile })}
              >
                {runtimeProfileOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </label>
            <label className="form-field tenant-agent-instructions">
              <span>Instructions</span>
              <Textarea
                aria-label="Instructions"
                value={draft.instructions}
                onChange={(event) => updateDraft({ instructions: event.target.value })}
                placeholder="Describe the agent's job, boundaries, and escalation behavior."
              />
            </label>
          </div>
          <div className="tenant-row-actions tenant-form-actions">
            <Button
              className="workflow-button workflow-button-primary"
              type="button"
              disabled={createDisabled}
              onClick={createAgent}
            >
              <Plus size={14} />
              <span>Create reusable agent</span>
            </Button>
          </div>
        </Card>

        <Card className="surface-card overflow-hidden">
          <TenantSectionHeader eyebrow="Library" title="Reusable agents" />
          {loading ? (
            <Empty
              className="tenant-agent-empty"
              icon={<Bot size={20} />}
              title="Loading reusable agents"
              description="Fetching reusable agents for this workspace."
            />
          ) : sortedAgents.length === 0 ? (
            <Empty
              className="tenant-agent-empty"
              icon={<Bot size={20} />}
              title="No reusable agents yet"
              description="Create the first concrete agent for this workspace."
            />
          ) : (
            <div className="tenant-list">
              {sortedAgents.map((agent) => (
                <article
                  key={agent.id}
                  aria-label={`${agent.name} reusable agent`}
                  className="tenant-row tenant-agent-row"
                >
                  <div className="tenant-row-main">
                    <span className="tenant-agent-avatar"><Bot size={16} /></span>
                    <div>
                      <div className="tenant-agent-title-line">
                        <span className="panel-title">{agent.name}</span>
                        <span className="tenant-summary-badge">{agent.agentClass}</span>
                      </div>
                      <div className="panel-meta">{formatRuntimeProfile(agent.runtimeProfile)} / {agent.defaultLanguage.toUpperCase()}</div>
                      <p className="tenant-agent-instruction-preview">{agent.instructions}</p>
                    </div>
                  </div>
                  <div className="tenant-agent-side">
                    <div className="tenant-agent-toolbelt">
                      <Wrench size={14} />
                      <span>Toolbelt ready: {formatToolCount(agent.toolbeltAssignments.length)}</span>
                    </div>
                    <Button
                      className="workflow-button workflow-button-secondary"
                      type="button"
                      onClick={() => toggleToolbeltPanel(agent)}
                    >
                      <Wrench size={14} />
                      <span>Configure tools</span>
                    </Button>
                  </div>
                  {agent.toolbeltAssignments.length > 0 ? (
                    <div className="tenant-agent-tool-chips">
                      {agent.toolbeltAssignments.map((assignment) => (
                        <span key={assignment.id} className="tenant-summary-badge">{assignment.label}</span>
                      ))}
                    </div>
                  ) : null}
                  {expandedAgentId === agent.id ? (
                    <ToolbeltEditor
                      agent={agent}
                      connections={integrationConnections}
                      draft={toolbeltDrafts[agent.id] ?? createToolbeltDraft(agent, toolCatalogItems, integrationConnections)}
                      saving={savingToolbeltAgentId === agent.id}
                      toolCatalogItems={toolCatalogItems}
                      onChange={(patch) => updateToolbeltDraft(agent.id, patch)}
                      onSave={() => saveToolbelt(agent)}
                    />
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}

interface ToolbeltDraft {
  toolId: string;
  integrationConnectionId: string;
}

interface AgentDraft {
  name: string;
  agentClass: string;
  instructions: string;
  defaultLanguage: string;
  runtimeProfile: ReusableAgentRuntimeProfile;
}

function createEmptyAgentDraft(): AgentDraft {
  return {
    name: "",
    agentClass: "receptionist",
    instructions: "",
    defaultLanguage: "en",
    runtimeProfile: "cost-optimized",
  };
}

function formatRuntimeProfile(profile: ReusableAgentRuntimeProfile) {
  return runtimeProfileOptions.find((option) => option.value === profile)?.label ?? profile;
}

function ToolbeltEditor({
  agent,
  connections,
  draft,
  saving,
  toolCatalogItems,
  onChange,
  onSave,
}: {
  agent: ReusableAgent;
  connections: IntegrationConnection[];
  draft: ToolbeltDraft;
  saving: boolean;
  toolCatalogItems: ToolCatalogItem[];
  onChange: (patch: Partial<ToolbeltDraft>) => void;
  onSave: () => void;
}) {
  const selectedTool = getToolCatalogItem(toolCatalogItems, draft.toolId);
  const connectionOptions = selectedTool === undefined
    ? []
    : getIntegrationOptionsForConnector(selectedTool.connector, { connections })
      .filter((connection) => connection.status === "connected");

  return (
    <div className="tenant-agent-toolbelt-editor">
      <label className="form-field">
        <span>Tool</span>
        <Select
          aria-label={`Tool for ${agent.name}`}
          value={draft.toolId}
          onChange={(event) => {
            const nextTool = getToolCatalogItem(toolCatalogItems, event.target.value);
            const nextConnections = nextTool === undefined
              ? []
              : getIntegrationOptionsForConnector(nextTool.connector, { connections })
                .filter((connection) => connection.status === "connected");

            onChange({
              toolId: event.target.value,
              integrationConnectionId: nextConnections[0]?.value ?? "",
            });
          }}
        >
          <option value="" disabled>Select a tool</option>
          {toolCatalogItems.map((tool) => (
            <option key={tool.toolId} value={tool.toolId}>{tool.toolName}</option>
          ))}
        </Select>
      </label>
      <label className="form-field">
        <span>Connection</span>
        <Select
          aria-label={`Connection for ${agent.name}`}
          value={draft.integrationConnectionId}
          disabled={selectedTool === undefined || !selectedTool.requiresAuthorization || connectionOptions.length === 0}
          onChange={(event) => onChange({ integrationConnectionId: event.target.value })}
        >
          {connectionOptions.length === 0 ? (
            <option value="">No connected account</option>
          ) : (
            connectionOptions.map((connection) => (
              <option key={connection.value} value={connection.value}>{connection.label}</option>
            ))
          )}
        </Select>
      </label>
      <div className="tenant-agent-toolbelt-summary">
        {selectedTool === undefined
          ? "No catalog tool selected"
          : `${formatRisk(selectedTool.risk)} risk / ${selectedTool.requiresHumanApproval ? "Approval required" : "No approval required"}`}
      </div>
      <Button
        className="workflow-button workflow-button-primary"
        type="button"
        disabled={saving || selectedTool === undefined || (selectedTool.requiresAuthorization && draft.integrationConnectionId.length === 0)}
        onClick={onSave}
      >
        <Wrench size={14} />
        <span>Save toolbelt for {agent.name}</span>
      </Button>
    </div>
  );
}

function createToolbeltDraft(
  agent: ReusableAgent,
  catalog: ToolCatalogItem[],
  connections: IntegrationConnection[],
): ToolbeltDraft {
  const firstAssignment = agent.toolbeltAssignments[0];
  const selectedTool = firstAssignment === undefined
    ? catalog[0]
    : getToolCatalogItem(catalog, firstAssignment.toolId) ?? catalog[0];
  const connectionOptions = selectedTool === undefined
    ? []
    : getIntegrationOptionsForConnector(selectedTool.connector, { connections }).filter(
      (connection) => connection.status === "connected",
    );

  return {
    toolId: firstAssignment?.toolId ?? selectedTool?.toolId ?? "",
    integrationConnectionId: firstAssignment?.integrationConnectionId ?? connectionOptions[0]?.value ?? "",
  };
}

function createEmptyToolbeltDraft(): ToolbeltDraft {
  return {
    toolId: "",
    integrationConnectionId: "",
  };
}

function createToolbeltAssignment(
  tool: ToolCatalogItem,
  integrationConnectionId: string,
): ReusableAgentToolbeltAssignment {
  return {
    id: `assignment-${tool.toolId.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "")}`,
    toolId: tool.toolId,
    connector: tool.connector,
    toolName: tool.toolName,
    ...(tool.requiresAuthorization ? { integrationConnectionId } : {}),
    connectionStatus: tool.requiresAuthorization ? "missing" : "connected",
    label: tool.toolName,
    description: `${tool.toolName}.`,
    whenToUse: `Use when the caller asks about ${tool.toolName}.`,
    risk: tool.risk,
    requiresAuthorization: tool.requiresAuthorization,
    requiresHumanApproval: tool.requiresHumanApproval,
  };
}

function formatToolCount(count: number) {
  return `${count} ${count === 1 ? "tool" : "tools"}`;
}

function formatRisk(risk: ReusableAgentToolbeltAssignment["risk"]) {
  return risk.charAt(0).toUpperCase() + risk.slice(1);
}
