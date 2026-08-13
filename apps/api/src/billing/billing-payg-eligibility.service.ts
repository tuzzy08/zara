import { Injectable } from "@nestjs/common";

import type { BillingChargeReservationRepository } from "./billing-charge-reservation.repository";
import type { PostgresBillingLedgerRepository } from "./postgres-billing-ledger.repository";

@Injectable()
export class BillingPaygEligibilityService {
  constructor(
    private readonly ledger: Pick<
      PostgresBillingLedgerRepository,
      "listPaygCreditEntries"
    >,
    private readonly reservations: Pick<
      BillingChargeReservationRepository,
      "listReservations"
    >,
  ) {}

  async getEligibility(input: { organizationId: string; now: string }) {
    if (input.organizationId.trim() === "" || !Number.isFinite(Date.parse(input.now))) {
      throw new Error("PAYG eligibility identity and time must be valid.");
    }
    const [entries, reservations] = await Promise.all([
      this.ledger.listPaygCreditEntries(input.organizationId),
      this.reservations.listReservations(input.organizationId),
    ]);
    const nowMs = Date.parse(input.now);
    const balanceMinor = entries.reduce((total, entry) => {
      if (entry.entryType === "grant") {
        return entry.expiresAt === undefined || Date.parse(entry.expiresAt) > nowMs
          ? total + entry.amountMinor
          : total;
      }
      return entry.entryType === "debit" || entry.entryType === "reversal"
        ? total - entry.amountMinor
        : total;
    }, 0);
    const reservedMinor = reservations
      .filter(
        (reservation) =>
          reservation.status === "active" && Date.parse(reservation.expiresAt) > nowMs,
      )
      .reduce((total, reservation) => total + reservation.reservedAmountMinor, 0);
    const availableMinor = Math.max(0, balanceMinor - reservedMinor);
    return {
      eligible: availableMinor > 0,
      balanceMinor: Math.max(0, balanceMinor),
      reservedMinor,
      availableMinor,
    };
  }
}
