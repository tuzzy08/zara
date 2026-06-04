import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, ShieldCheck } from "lucide-react";

import {
  fetchTenantBillingState,
  openPolarCustomerPortal,
  startPolarCheckout,
  type TenantBillingState,
} from "./tenantBillingApi";
import { formatStatus, formatUsd } from "./tenantPageFormatting";
import { TenantSectionHeader } from "./TenantSectionHeader";
import { TenantStatusBanner } from "./TenantStatusBanner";
import { TenantSummaryGrid } from "./TenantSummaryGrid";
import { type TenantPageProps } from "./tenantPageTypes";

export function TenantBillingScreen({ organizationId, showToast }: TenantPageProps) {
  const [billing, setBilling] = useState<TenantBillingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadBilling = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      setBilling(await fetchTenantBillingState(organizationId));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Billing state could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void loadBilling();
  }, [loadBilling]);

  const totalUsageUsd = useMemo(
    () => billing?.usage.reduce((sum, usage) => sum + usage.costUsd, 0) ?? 0,
    [billing],
  );

  const openPortal = async () => {
    const portal = await openPolarCustomerPortal(organizationId);
    showToast(`Polar portal ready: ${new URL(portal.customerPortalUrl).hostname}`);
  };

  const startCheckout = async () => {
    const checkout = await startPolarCheckout(organizationId, billing?.plan.slug ?? "growth");
    showToast(`Polar checkout ready: ${new URL(checkout.checkoutUrl).hostname}`);
  };

  return (
    <div className="tenant-feature-page">

      {errorMessage === null ? null : <TenantStatusBanner tone="danger">{errorMessage}</TenantStatusBanner>}
      {loading ? <TenantStatusBanner tone="neutral">Loading billing.</TenantStatusBanner> : null}

      {billing === null ? null : (
        <>
          <TenantSummaryGrid
            items={[
              { label: "Plan", value: billing.plan.name, detail: formatStatus(billing.plan.status) },
              { label: "Usage spend", value: formatUsd(totalUsageUsd), detail: "Current cycle" },
              { label: "Budget", value: formatUsd(billing.plan.budgetUsedUsd), detail: `${formatUsd(billing.plan.budgetLimitUsd)} limit` },
            ]}
          />

          <section className="tenant-page-grid">
            <div className="surface-card overflow-hidden">
              <TenantSectionHeader eyebrow="Subscription" title="Polar customer state" />
              <div className="tenant-list">
                <article className="tenant-row">
                  <div>
                    <div className="panel-title">{billing.plan.name}</div>
                    <div className="panel-meta">
                      {formatUsd(billing.plan.monthlyBaseUsd)} base - {billing.plan.includedMinutes.toLocaleString()} included minutes
                    </div>
                  </div>
                  <span className="table-status">{formatStatus(billing.plan.status)}</span>
                </article>
                <article className="tenant-row">
                  <div>
                    <div className="panel-title">Customer external id</div>
                    <div className="panel-meta">{billing.customerExternalId}</div>
                  </div>
                  <ShieldCheck size={16} />
                </article>
                {billing.entitlements.map((entitlement) => (
                  <article key={entitlement.id} className="tenant-row">
                    <div>
                      <div className="panel-title">{entitlement.label}</div>
                      <div className="panel-meta">{entitlement.id}</div>
                    </div>
                    <span className="table-status">{formatStatus(entitlement.status)}</span>
                  </article>
                ))}
                <div className="tenant-action-bar">
                  <button className="workflow-button workflow-button-primary" type="button" onClick={() => void startCheckout()}>
                    <ExternalLink size={14} />
                    Checkout
                  </button>
                  <button className="workflow-button" type="button" aria-label="Open Polar customer portal" onClick={() => void openPortal()}>
                    <ExternalLink size={14} />
                    Portal
                  </button>
                </div>
              </div>
            </div>

            <div className="surface-card overflow-hidden">
              <TenantSectionHeader eyebrow="Usage" title="Meters and budget" />
              <div className="tenant-list">
                {billing.usage.map((usage) => (
                  <article key={usage.id} className="tenant-row">
                    <div>
                      <div className="panel-title">{usage.label}</div>
                      <div className="panel-meta">
                        {usage.used.toLocaleString()} {usage.unit}{usage.limit === undefined ? "" : ` of ${usage.limit.toLocaleString()}`}
                      </div>
                    </div>
                    <strong>{formatUsd(usage.costUsd)}</strong>
                  </article>
                ))}
                {billing.plan.budgetWarning ? (
                  <TenantStatusBanner tone="danger">Budget usage has crossed the warning threshold.</TenantStatusBanner>
                ) : null}
              </div>
            </div>

            <div className="surface-card overflow-hidden">
              <TenantSectionHeader eyebrow="Orders" title="Invoices" />
              <div className="tenant-list">
                {billing.invoices.map((invoice) => (
                  <article key={invoice.id} className="tenant-row">
                    <div>
                      <div className="panel-title">{invoice.invoiceNumber}</div>
                      <div className="panel-meta">{invoice.providerOrderId} - {new Date(invoice.createdAt).toLocaleDateString()}</div>
                    </div>
                    <strong>{formatUsd(invoice.amountUsd)}</strong>
                  </article>
                ))}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
