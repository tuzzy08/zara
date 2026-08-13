import type { BillingChargeReservationRepository } from "./billing-charge-reservation.repository";
import type { PostgresBillingLedgerRepository } from "./postgres-billing-ledger.repository";
import {
  calculatePaygCallCharge,
  type PaygPlatformRouteIdentity,
} from "./billing-payg-call-charge-policy";

type LedgerRepository = Pick<PostgresBillingLedgerRepository, "getPriceCatalog">;
type ReservationRepository = Pick<
  BillingChargeReservationRepository,
  "finalizePaygCredit" | "getReservation" | "releasePaygCredit"
>;

export interface TrustedPaygTerminalCallFact {
  organizationId: string;
  reservationId: string;
  callSessionId: string;
  runtimePath: "pstn-sandwich" | "pstn-premium-realtime";
  outcome: "completed" | "transferred" | "failed";
  runtimeSeconds: number;
  ownershipMode: "platform-managed" | "byo";
  provider: string;
  direction: "inbound" | "outbound";
  routeIdentity?: PaygPlatformRouteIdentity | undefined;
  providerConnectedSeconds?: number | undefined;
  occurredAt: string;
}

export class TrustedPaygTerminalFinalizationService {
  constructor(
    private readonly ledger: LedgerRepository,
    private readonly reservations: ReservationRepository,
  ) {}

  async resolveCallBillingMode(input: {
    organizationId: string;
    callSessionId: string;
  }) {
    const organizationId = requireText(input.organizationId, "organizationId");
    const callSessionId = requireText(input.callSessionId, "callSessionId");
    const reservation = await this.reservations.getReservation(
      organizationId,
      `payg-call-reservation:${callSessionId}`,
    );
    if (reservation === null) return "subscription" as const;
    if (reservation.reservationKey !== `payg-call:${callSessionId}`) {
      throw new Error("The PAYG reservation does not match the call session.");
    }
    return "payg" as const;
  }

  async getPinnedCallChargeContext(input: {
    organizationId: string;
    callSessionId: string;
  }) {
    const reservation = await this.reservations.getReservation(
      requireText(input.organizationId, "organizationId"),
      `payg-call-reservation:${requireText(input.callSessionId, "callSessionId")}`,
    );
    if (reservation === null) return null;
    if (reservation.reservationKey !== `payg-call:${input.callSessionId}`) {
      throw new Error("The PAYG reservation does not match the call session.");
    }
    if (reservation.chargeContext === undefined) {
      throw new Error("The PAYG reservation has no charge context pin.");
    }
    return {
      ...reservation.chargeContext,
      catalogId: requireText(reservation.catalogId, "reservation.catalogId"),
      ...(reservation.terminalOutcome === undefined
        ? {}
        : { terminalOutcome: reservation.terminalOutcome }),
    };
  }

  async finalizeTerminalCall(fact: TrustedPaygTerminalCallFact) {
    const organizationId = requireText(fact.organizationId, "organizationId");
    const reservationId = requireText(fact.reservationId, "reservationId");
    const callSessionId = requireText(fact.callSessionId, "callSessionId");
    const occurredAt = requireTimestamp(fact.occurredAt, "occurredAt");
    requireOwnershipMode(fact.ownershipMode);
    const outcome = requireOutcome(fact.outcome);

    const reservation = await this.reservations.getReservation(
      organizationId,
      reservationId,
    );
    if (reservation === null) {
      throw new Error(`Billing reservation ${reservationId} was not found.`);
    }
    if (reservation.reservationKey !== `payg-call:${callSessionId}`) {
      throw new Error(`Billing reservation ${reservationId} does not match the call session.`);
    }
    const catalogId = requireText(reservation.catalogId, "reservation.catalogId");
    if (reservation.chargeContext === undefined) {
      throw new Error(`Billing reservation ${reservationId} has no charge context pin.`);
    }
    const catalog = await this.ledger.getPriceCatalog(catalogId);
    if (catalog === null) {
      throw new Error(`Billing price catalog ${catalogId} was not found.`);
    }
    const charge = calculatePaygCallCharge({
      catalogDocument: catalog.document,
      ...reservation.chargeContext,
      runtimeSeconds: fact.runtimeSeconds,
      ...(fact.providerConnectedSeconds === undefined
        ? {}
        : { providerConnectedSeconds: fact.providerConnectedSeconds }),
    });
    const actualChargeMinor = charge.totalMinor;
    if (actualChargeMinor === 0) {
      if (outcome !== "failed") {
        throw new Error("A zero PAYG charge requires a failed call outcome.");
      }
      const release = await this.reservations.releasePaygCredit({
        organizationId,
        reservationId,
        now: occurredAt,
        terminalOutcome: outcome,
      });
      return {
        catalogId: catalog.id,
        currency: catalog.currency,
        components: {
          runtimeMinor: charge.runtimeMinor,
          telephonyMinor: charge.telephonyMinor,
        },
        actualChargeMinor,
        outcome: release.outcome,
        duplicate: release.duplicate,
        releasedMinor: release.releasedMinor,
        availableMinor: release.availableMinor,
      };
    }
    const finalization = await this.reservations.finalizePaygCredit({
      organizationId,
      reservationId,
      sessionId: callSessionId,
      actualAmountMinor: actualChargeMinor,
      terminalOutcome: outcome,
      now: occurredAt,
    });

    return {
      catalogId: catalog.id,
      currency: catalog.currency,
      components: {
        runtimeMinor: charge.runtimeMinor,
        telephonyMinor: charge.telephonyMinor,
      },
      actualChargeMinor,
      duplicate: finalization.duplicate,
      releasedMinor: finalization.releasedMinor,
      availableMinor: finalization.availableMinor,
    };
  }
}

function requireText(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

function requireTimestamp(value: unknown, field: string) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be a valid timestamp.`);
  }
  return value;
}

function requireOwnershipMode(value: unknown) {
  if (value !== "platform-managed" && value !== "byo") {
    throw new Error("ownershipMode must be platform-managed or byo.");
  }
  return value;
}

function requireOutcome(value: unknown) {
  if (value !== "completed" && value !== "transferred" && value !== "failed") {
    throw new Error("outcome must be completed, transferred, or failed.");
  }
  return value;
}
