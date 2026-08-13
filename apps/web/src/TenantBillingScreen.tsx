import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { Badge, Button, Card } from "@zara/ui";

import {
  fetchTenantBillingState,
  openPolarCustomerPortal,
  startPaygCheckout,
  startPolarCheckout,
  type TenantBillingState,
} from "./tenantBillingApi";
import { formatMoneyMinor, formatStatus, formatUsageCost } from "./tenantPageFormatting";
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

  const postedUsageMinor = useMemo(
    () => billing?.usage.reduce(
      (sum, usage) => usage.disposition === "posted"
        ? sum + (usage.costMinor ?? (usage.costUsd === null ? 0 : Math.round(usage.costUsd * 100)))
        : sum,
      0,
    ) ?? 0,
    [billing],
  );

  const openPortal = async () => {
    const portal = await openPolarCustomerPortal(organizationId);
    showToast(`Polar portal ready: ${new URL(portal.customerPortalUrl).hostname}`);
  };

  const startCheckout = async () => {
    const checkout = await startPolarCheckout(organizationId, billing?.plan?.slug ?? "starter");
    showToast(`Polar checkout ready: ${new URL(checkout.checkoutUrl).hostname}`);
  };

  const addPaygCredit = async () => {
    const checkout = await startPaygCheckout(organizationId);
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
              {
                label: "Plan",
                value: billing.plan?.name ?? "No plan",
                detail: billing.plan === null ? "Not subscribed" : formatStatus(billing.plan.status),
              },
              { label: "Posted spend", value: formatMoneyMinor(postedUsageMinor, billing.currency), detail: "Current cycle" },
              {
                label: billing.plan === null ? "PAYG credit" : "Budget",
                value: billing.plan === null
                  ? formatMoneyMinor(billing.payg.remainingCreditMinor, billing.currency)
                  : billing.budgetPolicy === null || billing.budgetPolicy === undefined
                    ? "No policy"
                    : formatMoneyMinor(postedUsageMinor, billing.currency),
                detail: billing.plan === null
                  ? `${formatMoneyMinor(billing.payg.reservedCreditMinor, billing.currency)} reserved`
                  : billing.budgetPolicy === null || billing.budgetPolicy === undefined
                    ? "No billing limit"
                    : `${formatMoneyMinor(billing.budgetPolicy.monthlyBudgetMinor ?? Math.round(billing.budgetPolicy.monthlyBudgetUsd * 100), billing.currency)} limit`,
              },
            ]}
          />

          <section className="tenant-page-grid">
            <Card className="surface-card overflow-hidden">
              <TenantSectionHeader eyebrow="Subscription" title="Polar customer state" />
              <div className="tenant-list">
                {billing.plan === null ? (
                  <article className="tenant-row">
                    <div>
                      <div className="panel-title">No billing plan</div>
                      <div className="panel-meta">
                        {billing.payg.packAmountMinor === null
                          ? "Choose a plan. PAYG checkout is not configured."
                          : `Choose a plan or add ${formatMoneyMinor(billing.payg.packAmountMinor, billing.currency)} PAYG credit to start.`}
                      </div>
                    </div>
                    <Badge className="table-status">Not subscribed</Badge>
                  </article>
                ) : (
                  <article className="tenant-row">
                    <div>
                      <div className="panel-title">{billing.plan.name}</div>
                      <div className="panel-meta">
                        {billing.plan.monthlyBaseMinor === null || billing.plan.monthlyBaseMinor === undefined
                          ? "Catalog price unavailable"
                          : `${formatMoneyMinor(billing.plan.monthlyBaseMinor, billing.currency)} base`}
                        {billing.plan.includedStandardRuntimeSeconds === null || billing.plan.includedStandardRuntimeSeconds === undefined
                          ? ""
                          : ` - ${(billing.plan.includedStandardRuntimeSeconds / 60).toLocaleString()} standard minutes included`}
                        {billing.plan.includedPremiumRuntimeSeconds === null || billing.plan.includedPremiumRuntimeSeconds === undefined
                          ? ""
                          : ` - ${(billing.plan.includedPremiumRuntimeSeconds / 60).toLocaleString()} premium minutes included`}
                      </div>
                    </div>
                    <Badge className="table-status">{formatStatus(billing.plan.status)}</Badge>
                  </article>
                )}
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
                    <Badge className="table-status">{formatStatus(entitlement.status)}</Badge>
                  </article>
                ))}
                <div className="tenant-action-bar">
                  <Button className="workflow-button workflow-button-primary" type="button" onClick={() => void startCheckout()}>
                    <ExternalLink size={14} />
                    Checkout
                  </Button>
                  {billing.payg.packAmountMinor === null ? null : (
                    <Button className="workflow-button" type="button" onClick={() => void addPaygCredit()}>
                      <ExternalLink size={14} />
                      Add {formatMoneyMinor(billing.payg.packAmountMinor, billing.currency)} credit
                    </Button>
                  )}
                  <Button className="workflow-button" type="button" aria-label="Open Polar customer portal" onClick={() => void openPortal()}>
                    <ExternalLink size={14} />
                    Portal
                  </Button>
                </div>
              </div>
            </Card>

            <Card className="surface-card overflow-hidden">
              <TenantSectionHeader eyebrow="PAYG" title="PAYG credit" />
              <div className="tenant-list">
                <article className="tenant-row">
                  <div><div className="panel-title">Paid credit</div><div className="panel-meta">Credit from paid $5 packs</div></div>
                  <strong>{formatMoneyMinor(billing.payg.paidCreditMinor, billing.currency)} paid</strong>
                </article>
                <article className="tenant-row">
                  <div><div className="panel-title">Active reservations</div><div className="panel-meta">Held for live sessions</div></div>
                  <strong>{formatMoneyMinor(billing.payg.reservedCreditMinor, billing.currency)} reserved</strong>
                </article>
                <article className="tenant-row">
                  <div><div className="panel-title">Available credit</div><div className="panel-meta">Ready for a new session</div></div>
                  <strong>{formatMoneyMinor(billing.payg.remainingCreditMinor, billing.currency)} available</strong>
                </article>
                {billing.payg.sessionDebits.map((debit) => (
                  <article className="tenant-row" key={debit.id}>
                    <div><div className="panel-title">{debit.sessionId}</div><div className="panel-meta">{new Date(debit.createdAt).toLocaleString()}</div></div>
                    <strong>-{formatMoneyMinor(debit.amountMinor, billing.currency)}</strong>
                  </article>
                ))}
                {billing.payg.sessionDebits.length === 0 ? (
                  <div className="panel-meta">No PAYG session debits.</div>
                ) : null}
              </div>
            </Card>

            <Card className="surface-card overflow-hidden">
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
                    <strong>{formatUsageCost(usage, billing.currency)}</strong>
                  </article>
                ))}
                {billing.usage.length === 0 ? <div className="panel-meta">No metered usage in this billing period.</div> : null}
                {billing.plan?.budgetWarning ? (
                  <TenantStatusBanner tone="danger">Budget usage has crossed the warning threshold.</TenantStatusBanner>
                ) : null}
              </div>
            </Card>

            <Card className="surface-card overflow-hidden">
              <TenantSectionHeader eyebrow="Orders" title="Invoices" />
              <div className="tenant-list">
                {billing.invoices.map((invoice) => (
                  <article key={invoice.id} className="tenant-row">
                    <div>
                      <div className="panel-title">{invoice.invoiceNumber}</div>
                      <div className="panel-meta">{invoice.providerOrderId} - {new Date(invoice.createdAt).toLocaleDateString()}</div>
                    </div>
                    <div>
                      <strong>{formatMoneyMinor(invoice.amountMinor ?? Math.round(invoice.amountUsd * 100), invoice.currency)}</strong>
                      <div className="panel-meta">{formatStatus(invoice.status)}</div>
                    </div>
                  </article>
                ))}
                {billing.invoices.length === 0 ? (
                  <div className="panel-meta">
                    {billing.payg.paidCreditMinor > 0 ? "No subscription invoices." : "No invoices or credit-pack orders."}
                  </div>
                ) : null}
              </div>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
