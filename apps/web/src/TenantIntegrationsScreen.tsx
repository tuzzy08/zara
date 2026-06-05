import { useCallback, useEffect, useState } from "react";
import { Cable, RefreshCw } from "lucide-react";
import type { IntegrationProviderCatalogEntry } from "@zara/core";

import {
  checkIntegrationHealth,
  configureZendeskIntegration,
  fetchIntegrationCatalog,
  fetchIntegrationConnections,
  fetchToolGrants,
  fetchWebhookTools,
  promoteIntegrationConnection,
  revokeIntegrationConnection,
  startIntegrationConnect,
  type IntegrationConnection,
  type IntegrationConnectionAvailability,
  type IntegrationConnectionScope,
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

export function TenantIntegrationsScreen({ organizationId, activeWorkspaceId, showToast }: TenantPageProps) {
  const [integrationsResource, setIntegrationsResource] = useState<{
    catalogProviders: IntegrationProviderCatalogEntry[];
    connections: IntegrationConnection[];
    errorMessage: string | null;
    loading: boolean;
    toolGrants: ToolGrant[];
    webhookTools: WebhookTool[];
  }>(() => ({
    catalogProviders: [],
    connections: [],
    errorMessage: null,
    loading: true,
    toolGrants: [],
    webhookTools: [],
  }));
  const { catalogProviders, connections, errorMessage, loading, toolGrants, webhookTools } = integrationsResource;
  const [zendeskDraft, setZendeskDraft] = useState({
    subdomain: "",
    email: "",
    apiToken: "",
  });
  const [connectionScope, setConnectionScope] = useState<IntegrationConnectionScope>("workspace");

  const loadIntegrations = useCallback(async () => {
    setIntegrationsResource((current) => ({
      ...current,
      errorMessage: null,
      loading: true,
    }));

    try {
      const [nextConnections, nextCatalogProviders, nextWebhookTools, nextToolGrants] = await Promise.all([
        fetchIntegrationConnections(organizationId, activeWorkspaceId),
        fetchIntegrationCatalog(organizationId),
        fetchWebhookTools(organizationId, activeWorkspaceId),
        fetchToolGrants(organizationId, activeWorkspaceId),
      ]);

      setIntegrationsResource({
        catalogProviders: nextCatalogProviders,
        connections: nextConnections,
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

  const catalogToolCount = catalogProviders.reduce((count, provider) => count + provider.tools.length, 0);
  const availableToolCount = catalogToolCount + webhookTools.length;
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

  const connectProvider = async (
    provider: IntegrationProvider,
    reconnectConnectionId?: string,
    availability?: IntegrationConnectionAvailability,
  ) => {
    const nextScope = availability?.scope ?? connectionScope;
    const workspaceId = availability?.scope === "workspace" ? availability.workspaceId : activeWorkspaceId;
    const connect = await startIntegrationConnect(organizationId, provider, {
      connectionScope: nextScope,
      ...(nextScope === "workspace" ? { workspaceId } : {}),
      ...(reconnectConnectionId !== undefined ? { reconnectConnectionId } : {}),
    });
    showToast(`Secure OAuth handoff ready: ${new URL(connect.authorizationUrl).hostname}`);
  };

  const configureZendesk = async () => {
    const connection = await configureZendeskIntegration(organizationId, {
      subdomain: zendeskDraft.subdomain.trim(),
      email: zendeskDraft.email.trim(),
      apiToken: zendeskDraft.apiToken,
      connectionScope,
      ...(connectionScope === "workspace" ? { workspaceId: activeWorkspaceId } : {}),
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

  const promoteConnection = async (connectionId: string) => {
    const connection = await promoteIntegrationConnection(organizationId, connectionId, {
      workspaceId: activeWorkspaceId,
      reason: "Make this connection available across organization workspaces.",
    });
    setIntegrationsResource((current) => ({
      ...current,
      connections: current.connections.map((candidate) => candidate.id === connectionId ? connection : candidate),
    }));
    showToast("Integration promoted.");
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
            <label className="form-field">
              <span>Connection scope</span>
              <select
                value={connectionScope}
                onChange={(event) => setConnectionScope(event.target.value as IntegrationConnectionScope)}
              >
                <option value="workspace">Use only in this workspace</option>
                <option value="organization">Use across organization</option>
              </select>
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
              const scopeLabel = getConnectionScopeLabel(connection.availability, activeWorkspaceId);
              const canPromote = connection.status === "connected"
                && connection.availability.scope === "workspace"
                && connection.availability.workspaceId === activeWorkspaceId;

              return (
                <article key={connection.id} className="tenant-row">
                  <div className="tenant-row-main">
                    <ProviderLogo branding={branding} />
                    <div>
                      <div className="panel-title">{branding.label}</div>
                      <div className="panel-meta">
                        <span>{scopeLabel}</span> -{" "}
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
                      <button className="workflow-button" type="button" onClick={() => void connectProvider(connection.provider, connection.id, connection.availability)}>
                        Reconnect
                      </button>
                    ) : (
                      <>
                        {canPromote ? (
                          <button
                            className="workflow-button"
                            type="button"
                            aria-label={`Promote ${branding.label} to organization scope`}
                            onClick={() => void promoteConnection(connection.id)}
                          >
                            Promote
                          </button>
                        ) : null}
                        <button className="workflow-button workflow-button-danger" type="button" onClick={() => void revokeConnection(connection.id)}>
                          Revoke
                        </button>
                      </>
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
            {catalogProviders.flatMap((provider) =>
              provider.tools.map((tool) => {
                const branding = getIntegrationProviderBranding(provider.id, {
                  label: provider.label,
                  logoToken: provider.logoToken,
                });

                return (
                  <article key={`${provider.id}:${tool.id}`} className="tenant-row">
                    <div>
                      <div className="panel-title">{tool.name}</div>
                      <div className="panel-meta">{tool.id} - {tool.capabilities.join(", ")}</div>
                    </div>
                    <span className="table-status table-status-with-logo">
                      <ProviderLogo branding={branding} compact />
                      <span>{branding.label}</span>
                    </span>
                  </article>
                );
              }),
            )}
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
                  <div className="panel-meta">
                    {grant.workflowId}
                    {grant.pausedReason === undefined ? "" : ` - ${formatStatus(grant.pausedReason)}`}
                  </div>
                </div>
                <span className="table-status">{getGrantStatusLabel(grant)}</span>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function getConnectionScopeLabel(
  availability: IntegrationConnectionAvailability,
  activeWorkspaceId: string,
) {
  if (availability.scope === "organization") {
    return "Organization-wide";
  }

  return availability.workspaceId === activeWorkspaceId ? "This workspace" : "Workspace-owned";
}

function getGrantStatusLabel(grant: ToolGrant) {
  if (grant.status === "paused") {
    return "Paused";
  }

  if (grant.status === "revoked") {
    return "Revoked";
  }

  return grant.approvalRequired ? "Approval required" : grant.risk;
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
