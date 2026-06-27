import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Cable,
  CreditCard,
  DatabaseZap,
  GitBranchPlus,
  MemoryStick,
  PhoneCall,
  ShieldCheck,
} from "lucide-react";
import { Alert, Card } from "@zara/ui";

import { ApiError } from "./apiClient";
import { fetchIntegrationConnections, fetchToolGrants, type IntegrationConnection, type ToolGrant } from "./tenantIntegrationsApi";
import { fetchTenantBillingState, type TenantBillingState } from "./tenantBillingApi";
import { fetchTenantMemoryExport, type TenantMemoryExport } from "./tenantMemoryApi";
import { fetchTelephonyState, type TelephonyStateResponse } from "./telephonyApi";
import { DashboardMetricCard } from "./DashboardMetricCard";
import { DashboardSignal } from "./DashboardSignal";
import { loadPublishedWorkflowVersionsForWorkspace } from "./workflowSandboxRegistry";

const dashboardUsdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export function DashboardScreen({
  organizationId,
  activeWorkspaceId,
}: {
  organizationId: string;
  activeWorkspaceId: string;
}) {
  const dashboardRequestKey = `${organizationId}:${activeWorkspaceId}`;
  const [dashboardResource, setDashboardResource] = useState(() => ({
    errorMessage: null as string | null,
    key: dashboardRequestKey,
    loading: true,
    summary: createEmptyDashboardSummary(),
  }));
  if (dashboardResource.key !== dashboardRequestKey) {
    setDashboardResource({
      errorMessage: null,
      key: dashboardRequestKey,
      loading: true,
      summary: createEmptyDashboardSummary(),
    });
  }

  const summary = dashboardResource.key === dashboardRequestKey
    ? dashboardResource.summary
    : createEmptyDashboardSummary();
  const loading = dashboardResource.key !== dashboardRequestKey || dashboardResource.loading;
  const errorMessage = dashboardResource.key === dashboardRequestKey ? dashboardResource.errorMessage : null;
  const publishedWorkflows = useMemo(
    () =>
      loadPublishedWorkflowVersionsForWorkspace({
        tenantId: organizationId,
        workspaceId: activeWorkspaceId,
      }),
    [activeWorkspaceId, organizationId],
  );
  const activeConnections = summary.telephony?.connections.filter((connection) => connection.status === "active").length ?? 0;
  const routedNumbers = summary.telephony?.phoneNumbers.filter((phoneNumber) => phoneNumber.status === "routed").length ?? 0;
  const queuedCalls = summary.telephony?.dispatches.filter((dispatch) => dispatch.disposition === "queued").length ?? 0;
  const activeToolGrants = summary.toolGrants.filter(
    (grant) => grant.status === "active" && (grant.capability ?? "agent-tool") === "agent-tool",
  ).length;
  const healthyConnections = summary.integrations.filter((connection) => connection.health.status === "healthy").length;
  const activeMemories = summary.memory?.memories.filter((memory) => memory.status === "active" && memory.approvalState === "approved").length ?? 0;
  const pendingMemoryDrafts = summary.memory?.drafts.filter((draft) => draft.status === "draft").length ?? 0;
  const activeKnowledge = summary.memory?.knowledge.filter((record) => record.status === "active").length ?? 0;
  const latestPublishedWorkflow = publishedWorkflows.at(-1);
  const budgetLimit = summary.billing?.plan.budgetLimitUsd ?? 0;
  const budgetUsed = summary.billing?.plan.budgetUsedUsd ?? 0;
  const budgetPercent = budgetLimit > 0 ? Math.round((budgetUsed / budgetLimit) * 100) : 0;
  const primaryUsage = summary.billing?.usage.slice(0, 3) ?? [];
  const latestDispatch = summary.telephony?.dispatches[0];

  useEffect(() => {
    let cancelled = false;

    void Promise.allSettled([
      fetchTelephonyState(organizationId),
      fetchIntegrationConnections(organizationId),
      fetchToolGrants(organizationId, activeWorkspaceId),
      fetchTenantMemoryExport(organizationId),
      fetchTenantBillingState(organizationId),
    ]).then((results) => {
      if (cancelled) {
        return;
      }

      const [telephonyResult, integrationsResult, toolGrantsResult, memoryResult, billingResult] = results;

      setDashboardResource((current) => current.key === dashboardRequestKey
        ? {
            errorMessage: getDashboardResourceErrorMessage(results),
            key: dashboardRequestKey,
            loading: false,
            summary: {
              telephony: getSettledValue(telephonyResult),
              integrations: getSettledValue(integrationsResult) ?? [],
              toolGrants: getSettledValue(toolGrantsResult) ?? [],
              memory: getSettledValue(memoryResult),
              billing: getSettledValue(billingResult),
            },
          }
        : current);
    });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, dashboardRequestKey, organizationId]);

  return (
    <div className="dashboard-page">

      {loading ? <Alert className="tenant-status-banner tenant-status-banner-neutral">Loading dashboard metrics.</Alert> : null}
      {errorMessage === null ? null : <Alert className="tenant-status-banner tenant-status-banner-danger" role="alert">{errorMessage}</Alert>}

      <section className="dashboard-metric-grid" aria-label="Workspace metrics">
        <DashboardMetricCard
          icon={GitBranchPlus}
          label="Published workflows"
          value={String(publishedWorkflows.length)}
          detail={latestPublishedWorkflow === undefined ? "No published versions in this workspace" : `Latest version v${latestPublishedWorkflow.version}`}
        />
        <DashboardMetricCard
          icon={PhoneCall}
          label="Routed numbers"
          value={String(routedNumbers)}
          detail={`${activeConnections} active telephony connection${activeConnections === 1 ? "" : "s"}`}
        />
        <DashboardMetricCard
          icon={Cable}
          label="Active tool grants"
          value={String(activeToolGrants)}
          detail={`${healthyConnections} of ${summary.integrations.length} provider connections healthy`}
        />
        <DashboardMetricCard
          icon={CreditCard}
          label="Budget used"
          value={summary.billing === undefined ? "--" : formatDashboardUsd(budgetUsed)}
          detail={summary.billing === undefined ? "Billing state unavailable" : `${budgetPercent}% of ${formatDashboardUsd(budgetLimit)} workspace budget`}
        />
        <DashboardMetricCard
          icon={MemoryStick}
          label="Memory approvals"
          value={`${pendingMemoryDrafts} pending`}
          detail={`${activeMemories} approved memories, ${activeKnowledge} active knowledge records`}
        />
      </section>

      <section className="dashboard-grid">
        <Card className="surface-card dashboard-panel" role="article">
          <div className="section-header">
            <div>
              <div className="eyebrow-copy">Calls</div>
              <div className="panel-title">Call operations</div>
            </div>
            <Activity size={16} />
          </div>
          <div className="dashboard-panel-body">
            <DashboardSignal label="Queued outbound calls" value={String(queuedCalls)} />
            <DashboardSignal
              label="Latest dispatch"
              value={latestDispatch === undefined ? "No dispatches yet" : formatDashboardStatus(latestDispatch.disposition)}
              detail={latestDispatch?.workflowLabel ?? latestDispatch?.reason}
            />
            <DashboardSignal label="Routed numbers" value={String(routedNumbers)} detail={`${activeConnections} active provider connections`} />
          </div>
        </Card>

        {/* <article className="surface-card dashboard-panel">
          <div className="section-header">
            <div>
              <div className="eyebrow-copy">Readiness</div>
              <div className="panel-title">Workflow readiness</div>
            </div>
            <BadgeCheck size={16} />
          </div>
          <div className="dashboard-panel-body">
            <DashboardSignal
              label="Published version"
              value={latestPublishedWorkflow === undefined ? "No version" : `v${latestPublishedWorkflow.version}`}
              detail={latestPublishedWorkflow?.graph.name ?? "Publish a workflow before routing production calls"}
            />
            <DashboardSignal label="Workspace members" value={String(workspaceMembers.length)} />
            <DashboardSignal label="Last workspace change" value={lastAuditEntry?.summary ?? "No workspace audit entries"} />
          </div>
        </article> */}

        <Card className="surface-card dashboard-panel" role="article">
          <div className="section-header">
            <div>
              <div className="eyebrow-copy">Tools</div>
              <div className="panel-title">Connector health</div>
            </div>
            <ShieldCheck size={16} />
          </div>
          <div className="dashboard-panel-body">
            <DashboardSignal label="Provider health" value={`${healthyConnections} of ${summary.integrations.length} healthy`} />
            <DashboardSignal label="Active grants" value={String(activeToolGrants)} detail="Workflow tool permissions" />
            <DashboardSignal label="Webhook tools" value={String(summary.toolGrants.filter((grant) => grant.integrationConnectionId.includes("webhook")).length)} />
          </div>
        </Card>

        <Card className="surface-card dashboard-panel" role="article">
          <div className="section-header">
            <div>
              <div className="eyebrow-copy">Usage</div>
              <div className="panel-title">Billing usage</div>
            </div>
            <DatabaseZap size={16} />
          </div>
          <div className="dashboard-panel-body">
            <DashboardSignal
              label="Plan"
              value={summary.billing?.plan.name ?? "Unavailable"}
              detail={summary.billing === undefined ? undefined : formatDashboardStatus(summary.billing.plan.status)}
            />
            {primaryUsage.map((usage) => (
              <DashboardSignal
                key={usage.id}
                label={usage.label}
                value={`${usage.used.toLocaleString()} ${usage.unit}`}
                detail={`${formatDashboardUsd(usage.costUsd)} metered cost`}
              />
            ))}
          </div>
        </Card>
      </section>
    </div>
  );
}

interface DashboardSummaryState {
  telephony?: TelephonyStateResponse | undefined;
  integrations: IntegrationConnection[];
  toolGrants: ToolGrant[];
  memory?: TenantMemoryExport | undefined;
  billing?: TenantBillingState | undefined;
}

function createEmptyDashboardSummary(): DashboardSummaryState {
  return {
    integrations: [],
    toolGrants: [],
  };
}

function getSettledValue<T>(result: PromiseSettledResult<T>): T | undefined {
  return result.status === "fulfilled" ? result.value : undefined;
}

export function getDashboardResourceErrorMessage(results: PromiseSettledResult<unknown>[]) {
  if (!results.some((result) => result.status === "rejected")) {
    return null;
  }

  if (results.some((result) => result.status === "rejected" && isAuthFailure(result.reason))) {
    return "Your session has expired. Sign in again to load dashboard metrics.";
  }

  return "Some dashboard metrics could not be loaded.";
}

function isAuthFailure(reason: unknown) {
  if (reason instanceof ApiError) {
    return reason.status === 401 || reason.status === 403;
  }

  return reason instanceof Error && /auth|session|sign in/i.test(reason.message);
}

function formatDashboardUsd(value: number) {
  return dashboardUsdFormatter.format(value);
}

function formatDashboardStatus(value: string) {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
