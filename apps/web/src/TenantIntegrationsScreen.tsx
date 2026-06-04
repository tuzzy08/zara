import { useCallback, useEffect, useState } from "react";
import { Cable, RefreshCw } from "lucide-react";

import {
  checkIntegrationHealth,
  configureZendeskIntegration,
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
import { getIntegrationProviderBranding } from "./integrationProviderBranding";
import { formatStatus } from "./tenantPageFormatting";
import { TenantPageIntro } from "./TenantPageIntro";
import { TenantSectionHeader } from "./TenantSectionHeader";
import { TenantStatusBanner } from "./TenantStatusBanner";
import { TenantSummaryGrid } from "./TenantSummaryGrid";
import { type TenantPageProps } from "./tenantPageTypes";

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
  const [zendeskDraft, setZendeskDraft] = useState({
    subdomain: "",
    email: "",
    apiToken: "",
  });

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

  const configureZendesk = async () => {
    const connection = await configureZendeskIntegration(organizationId, {
      subdomain: zendeskDraft.subdomain.trim(),
      email: zendeskDraft.email.trim(),
      apiToken: zendeskDraft.apiToken,
    });
    setIntegrationsResource((current) => ({
      ...current,
      connections: [
        ...current.connections.filter((candidate) => candidate.id !== connection.id),
        connection,
      ],
    }));
    setZendeskDraft((current) => ({
      ...current,
      apiToken: "",
    }));
    showToast("Zendesk credentials saved.");
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
          <TenantSectionHeader eyebrow="Zendesk" title="Secure ticket credentials" />
          <div className="tenant-form-grid">
            <label className="form-field">
              <span>Zendesk subdomain</span>
              <input
                type="text"
                value={zendeskDraft.subdomain}
                onChange={(event) => setZendeskDraft((current) => ({ ...current, subdomain: event.target.value }))}
                placeholder="acme-support"
              />
            </label>
            <label className="form-field">
              <span>Zendesk email</span>
              <input
                type="email"
                value={zendeskDraft.email}
                onChange={(event) => setZendeskDraft((current) => ({ ...current, email: event.target.value }))}
                placeholder="support@example.com"
              />
            </label>
            <label className="form-field">
              <span>Zendesk API token</span>
              <input
                type="password"
                value={zendeskDraft.apiToken}
                onChange={(event) => setZendeskDraft((current) => ({ ...current, apiToken: event.target.value }))}
              />
            </label>
          </div>
          <div className="tenant-row-actions tenant-form-actions">
            <button
              className="workflow-button"
              type="button"
              onClick={() => void configureZendesk()}
            >
              Save Zendesk credentials
            </button>
          </div>
        </div>

        <div className="surface-card overflow-hidden">
          <TenantSectionHeader eyebrow="Connections" title="Provider health" />
          <div className="tenant-list">
            {connections.map((connection) => {
              const branding = getIntegrationProviderBranding(connection.provider);

              return (
                <article key={connection.id} className="tenant-row">
                  <div className="tenant-row-main">
                    <ProviderLogo branding={branding} />
                    <div>
                      <div className="panel-title">{branding.label}</div>
                      <div className="panel-meta">
                        {connection.accountLabel !== undefined ? `${connection.accountLabel} - ` : ""}
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
                      aria-label={`Check health for ${branding.label}`}
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
              );
            })}
          </div>
        </div>

        <div className="surface-card overflow-hidden">
          <TenantSectionHeader eyebrow="Catalog" title="Tools and grants" />
          <div className="tenant-list">
            {connectorTools.slice(0, 5).map((tool) => {
              const branding = getIntegrationProviderBranding(tool.provider);

              return (
                <article key={tool.toolId} className="tenant-row">
                  <div>
                    <div className="panel-title">{tool.toolId}</div>
                    <div className="panel-meta">{tool.description}</div>
                  </div>
                  <span className="table-status table-status-with-logo">
                    <ProviderLogo branding={branding} compact />
                    <span>{branding.label}</span>
                  </span>
                </article>
              );
            })}
            {webhookTools.map((tool) => (
              <article key={tool.id} className="tenant-row">
                <div>
                  <div className="panel-title">{tool.toolName}</div>
                  <div className="panel-meta">{tool.request.method} {tool.request.url}</div>
                </div>
                <span className="table-status table-status-with-logo">
                  <ProviderLogo branding={getIntegrationProviderBranding("webhook-http")} compact />
                  <span>{getIntegrationProviderBranding("webhook-http").label}</span>
                </span>
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

function ProviderLogo({
  branding,
  compact = false,
}: {
  branding: ReturnType<typeof getIntegrationProviderBranding>;
  compact?: boolean | undefined;
}) {
  return (
    <span
      aria-label={branding.ariaLabel}
      className={compact ? `${branding.logoClassName} integration-provider-logo-compact` : branding.logoClassName}
      role="img"
    >
      {branding.logoText}
    </span>
  );
}
