import { useEffect, useMemo, useState } from "react";
import { Bot, Plus, Wrench } from "lucide-react";
import { Button, Card, Empty, Input, Select, Textarea } from "@zara/ui";

import { TenantPageIntro } from "./TenantPageIntro";
import { TenantSectionHeader } from "./TenantSectionHeader";
import { TenantSummaryGrid } from "./TenantSummaryGrid";
import { type TenantPageProps } from "./tenantPageTypes";
import {
  createReusableAgent,
  loadReusableAgentsForWorkspace,
  saveReusableAgent,
  type ReusableAgent,
  type ReusableAgentRuntimeProfile,
} from "./reusableAgents";

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
  const [agents, setAgents] = useState<ReusableAgent[]>(() =>
    loadReusableAgentsForWorkspace({
      organizationId,
      workspaceId: activeWorkspaceId,
    }),
  );
  const [draft, setDraft] = useState(() => createEmptyAgentDraft());
  const createDisabled = draft.name.trim().length === 0 || draft.instructions.trim().length === 0;
  const sortedAgents = useMemo(() => [...agents].sort((a, b) => a.name.localeCompare(b.name)), [agents]);

  useEffect(() => {
    setAgents(loadReusableAgentsForWorkspace({
      organizationId,
      workspaceId: activeWorkspaceId,
    }));
  }, [activeWorkspaceId, organizationId]);

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

    const agent = createReusableAgent({
      organizationId,
      workspaceId: activeWorkspaceId,
      name: draft.name,
      agentClass: draft.agentClass,
      instructions: draft.instructions,
      defaultLanguage: draft.defaultLanguage,
      runtimeProfile: draft.runtimeProfile,
    });

    saveReusableAgent(agent);
    setAgents(loadReusableAgentsForWorkspace({
      organizationId,
      workspaceId: activeWorkspaceId,
    }));
    setDraft(createEmptyAgentDraft());
    showToast(`${agent.name} saved to reusable agents.`);
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
          { label: "Toolbelts", value: String(agents.reduce((count, agent) => count + agent.toolbeltAssignmentIds.length, 0)), detail: "Assigned tools" },
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
          {sortedAgents.length === 0 ? (
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
                  <div className="tenant-agent-toolbelt">
                    <Wrench size={14} />
                    <span>Toolbelt ready: {agent.toolbeltAssignmentIds.length} tools</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Card>
      </section>
    </div>
  );
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
