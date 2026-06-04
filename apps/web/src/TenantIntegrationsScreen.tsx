import { useCallback, useEffect, useState } from "react";
import { Cable, KeyRound, RefreshCw } from "lucide-react";

import {
  checkIntegrationHealth,
  fetchConnectorTools,
  fetchIntegrationConnections,
  fetchToolGrants,
  fetchWebhookTools,
  revokeIntegrationConnection,
  startIntegrationConnect,
  type ConnectorTool,
  type IntegrationConnection,
  type IntegrationProvider,
  type ToolGrant,
  type WebhookTool,
} from "./tenantIntegrationsApi";
import { formatStatus } from "./tenantPageFormatting";
import { TenantPageIntro } from "./TenantPageIntro";
import { TenantSectionHeader } from "./TenantSectionHeader";
import { TenantStatusBanner } from "./TenantStatusBanner";
import { TenantSummaryGrid } from "./TenantSummaryGrid";
import { type TenantPageProps } from "./tenantPageTypes";

const providerLabels: Record<IntegrationProvider, string> = {
  zendesk: "Zendesk Support",
  hubspot: "HubSpot CRM",
  "google-workspace": "Google Workspace",
  notion: "Notion",
  "webhook-http": "Webhook HTTP",
};

const oauthProviders = ["zendesk", "hubspot", "google-workspace", "notion"] as const;

export function TenantIntegrationsScreen({ organizationId, activeWorkspaceId, showToast }: TenantPageProps) {
  const [integrationsResource, setIntegrationsResource] = useState<{
    connections: IntegrationConnection[];
    connectorTools: ConnectorTool[];
    errorMessage: string | null;
    loading: boolean;
    toolGrants: ToolGrant[];
    webhookTools: WebhookTool[];
  }>(() => ({
    connections: [],
    connectorTools: [],
    errorMessage: null,
    loading: true,
    toolGrants: [],
    webhookTools: [],
  }));
  const { connections, connectorTools, errorMessage, loading, toolGrants, webhookTools } = integrationsResource;

  const loadIntegrations = useCallback(async () => {
    setIntegrationsResource((current) => ({
      ...current,
      errorMessage: null,
      loading: true,
    }));

    try {
      const [nextConnections, nextWebhookTools, nextToolGrants, ...toolsByProvider] = await Promise.all([
        fetchIntegrationConnections(organizationId),
        fetchWebhookTools(organizationId, activeWorkspaceId),
        fetchToolGrants(organizationId, activeWorkspaceId),
        ...oauthProviders.map((provider) => fetchConnectorTools(organizationId, provider)),
      ]);

      setIntegrationsResource({
        connections: nextConnections,
        connectorTools: toolsByProvider.flat(),
        errorMessage: null,
        loading: false,
        toolGrants: nextToolGrants,
        webhookTools: nextWebhookTools,
      });
    } catch (error) {
      setIntegrationsResource((current) => ({
        ...current,
        errorMessage: error instanceof Error ? error.message : "Integrations could not be loaded.",
        loading: false,
      }));
    }
  }, [activeWorkspaceId, organizationId]);

  useEffect(() => {
    void loadIntegrations();
  }, [loadIntegrations]);

  const availableToolCount = connectorTools.length + webhookTools.length;
  const activeGrantCount = toolGrants.filter((grant) => grant.status === "active").length;

  const refreshConnection = async (connectionId: string) => {
    const connection = await checkIntegrationHealth(organizationId, connectionId);
    setIntegrationsResource((current) => ({
      ...current,
      connections: current.connections.map((candidate) => candidate.id === connectionId ? connection : candidate),
    }));
    showToast("Integration health refreshed.");
  };

  const revokeConnection = async (connectionId: string) => {
    const connection = await revokeIntegrationConnection(organizationId, connectionId);
    setIntegrationsResource((current) => ({
      ...current,
      connections: current.connections.map((candidate) => candidate.id === connectionId ? connection : candidate),
    }));
    showToast("Integration revoked.");
  };

  const connectProvider = async (provider: IntegrationProvider, reconnectConnectionId?: string) => {
    const connect = await startIntegrationConnect(organizationId, provider, reconnectConnectionId);
    showToast(`Secure OAuth handoff ready: ${new URL(connect.authorizationUrl).hostname}`);
  };

  return (
    <div className="tenant-feature-page">
      <TenantPageIntro
        icon={Cable}
        eyebrow="Integrations"
        title="Integration command center"
        body="Connect CRM, productivity, and webhook tools with visible health, grants, and revocation posture while provider tokens stay inside Zara."
      />

      <TenantSummaryGrid
        items={[
          { label: "Connections", value: String(connections.length), detail: "OAuth accounts" },
          { label: "Available tools", value: String(availableToolCount), detail: "Connector and webhook tools" },
          { label: "Active grants", value: String(activeGrantCount), detail: "Workflow permissions" },
        ]}
      />

      {errorMessage === null ? null : <TenantStatusBanner tone="danger">{errorMessage}</TenantStatusBanner>}
      {loading ? <TenantStatusBanner tone="neutral">Loading integrations.</TenantStatusBanner> : null}

      <section className="tenant-page-grid">
        <div className="surface-card overflow-hidden">
          <TenantSectionHeader eyebrow="Connections" title="Provider health" />
          <div className="tenant-list">
            {connections.map((connection) => (
              <article key={connection.id} className="tenant-row">
                <div className="tenant-row-main">
                  <div className="tenant-row-icon"><KeyRound size={16} /></div>
                  <div>
                    <div className="panel-title">{providerLabels[connection.provider]}</div>
                    <div className="panel-meta">
                      {connection.scopes.join(", ")} - credential {connection.credentialReference.preview}
                    </div>
                  </div>
                </div>
                <div className="tenant-row-actions">
                  <span className={`table-status tenant-status-${connection.health.status}`}>
                    {formatStatus(connection.health.status)}
                  </span>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={`Check health for ${providerLabels[connection.provider]}`}
                    onClick={() => void refreshConnection(connection.id)}
                  >
                    <RefreshCw size={15} />
                  </button>
                  {connection.status === "revoked" ? (
                    <button className="workflow-button" type="button" onClick={() => void connectProvider(connection.provider, connection.id)}>
                      Reconnect
                    </button>
                  ) : (
                    <button className="workflow-button workflow-button-danger" type="button" onClick={() => void revokeConnection(connection.id)}>
                      Revoke
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="surface-card overflow-hidden">
          <TenantSectionHeader eyebrow="Catalog" title="Tools and grants" />
          <div className="tenant-list">
            {connectorTools.slice(0, 5).map((tool) => (
              <article key={tool.toolId} className="tenant-row">
                <div>
                  <div className="panel-title">{tool.toolId}</div>
                  <div className="panel-meta">{tool.description}</div>
                </div>
                <span className="table-status">{providerLabels[tool.provider]}</span>
              </article>
            ))}
            {webhookTools.map((tool) => (
              <article key={tool.id} className="tenant-row">
                <div>
                  <div className="panel-title">{tool.toolName}</div>
                  <div className="panel-meta">{tool.request.method} {tool.request.url}</div>
                </div>
                <span className="table-status">Webhook HTTP</span>
              </article>
            ))}
            {toolGrants.map((grant) => (
              <article key={grant.id} className="tenant-row">
                <div>
                  <div className="panel-title">{grant.toolId}</div>
                  <div className="panel-meta">{grant.workflowId}</div>
                </div>
                <span className="table-status">{grant.approvalRequired ? "Approval required" : grant.risk}</span>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
