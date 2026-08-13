/** @vitest-environment jsdom */

import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TenantBillingScreen } from "./TenantBillingScreen";

describe("TenantBillingScreen", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows an honest no-plan state for a new tenant", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      billing: {
        organizationId: "tenant-new",
        provider: "polar",
        currency: "usd",
        customerExternalId: "tenant-new",
        plan: null,
        subscription: {
          provider: "polar",
          status: "none",
          cancelAtPeriodEnd: false,
        },
        usage: [],
        entitlements: [],
        invoices: [],
        payg: {
          packAmountMinor: 500,
          paidCreditMinor: 0,
          consumedCreditMinor: 0,
          balanceMinor: 0,
          reservedCreditMinor: 0,
          remainingCreditMinor: 0,
          sessionDebits: [],
        },
        updatedAt: "2026-08-09T15:00:00.000Z",
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch);

    render(createElement(TenantBillingScreen, {
      organizationId: "tenant-new",
      activeWorkspaceId: "workspace-default",
      showToast: vi.fn(),
    }));

    await waitFor(() => expect(screen.getByText("No billing plan")).toBeTruthy());
    expect(screen.getByText("Choose a plan or add $5.00 PAYG credit to start.")).toBeTruthy();
    expect(screen.getByText("No metered usage in this billing period.")).toBeTruthy();
    expect(screen.getByText("No invoices or credit-pack orders.")).toBeTruthy();
  });

  it("shows production PAYG credit and session debit facts without a subscription", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      billing: {
        organizationId: "tenant-payg", provider: "polar", currency: "usd",
        customerExternalId: "tenant-payg", plan: null,
        subscription: { provider: "polar", status: "none", cancelAtPeriodEnd: false },
        usage: [
          { id: "standard:posted", label: "Standard runtime", used: 120, unit: "second", costUsd: 0.24, costMinor: 24, disposition: "posted" },
          { id: "standard:shadow_estimate", label: "Standard runtime", used: 50, unit: "second", costUsd: 0.1, costMinor: 10, disposition: "shadow_estimate" },
          { id: "premium", label: "Premium runtime", used: 30, unit: "second", costUsd: null, costMinor: null, disposition: "incomplete" },
          { id: "phone", label: "Platform telephony", used: 60, unit: "connected_second", costUsd: 0.7, costMinor: 70, disposition: "posted" },
        ],
        entitlements: [],
        invoices: [
          { id: "refund", providerOrderId: "order-r", invoiceNumber: "INV-R", amountUsd: 5, amountMinor: 500, currency: "usd", status: "refunded", createdAt: "2026-08-10T00:00:00Z" },
          { id: "unknown", providerOrderId: "order-u", invoiceNumber: "INV-U", amountUsd: 7, amountMinor: 700, currency: "usd", status: "unknown", createdAt: "2026-08-09T00:00:00Z" },
        ],
        payg: {
          packAmountMinor: 500,
          paidCreditMinor: 500,
          consumedCreditMinor: 120,
          balanceMinor: 380,
          reservedCreditMinor: 80,
          remainingCreditMinor: 300,
          sessionDebits: [{
            id: "debit-a", sessionId: "session-a", amountMinor: 120,
            createdAt: "2026-08-11T09:03:00.000Z",
          }],
        },
        updatedAt: "2026-08-11T10:00:00.000Z",
      },
    }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch);

    render(createElement(TenantBillingScreen, {
      organizationId: "tenant-payg",
      activeWorkspaceId: "workspace-default",
      showToast: vi.fn(),
    }));

    await waitFor(() => expect(screen.getAllByText("PAYG credit").length).toBeGreaterThan(0));
    expect(screen.getByText("$5.00 paid")).toBeTruthy();
    expect(screen.getAllByText("$0.80 reserved").length).toBeGreaterThan(0);
    expect(screen.getByText("$3.00 available")).toBeTruthy();
    expect(screen.getByText("session-a")).toBeTruthy();
    expect(screen.getByText("-$1.20")).toBeTruthy();
    expect(screen.getByText("Posted spend")).toBeTruthy();
    expect(screen.getByText("$0.94")).toBeTruthy();
    expect(screen.getByText("$0.24 posted")).toBeTruthy();
    expect(screen.getByText("$0.10 shadow estimate")).toBeTruthy();
    expect(screen.getAllByText("Standard runtime")).toHaveLength(2);
    expect(screen.getByText("Price unavailable")).toBeTruthy();
    expect(screen.getByText("Refunded")).toBeTruthy();
    expect(screen.getByText("Unknown")).toBeTruthy();
  });
});
