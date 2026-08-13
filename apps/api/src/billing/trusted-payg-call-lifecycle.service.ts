import { BillingChargeReservationRepository } from "./billing-charge-reservation.repository";
import type { PaygCallChargeContext } from "./billing-payg-call-charge-policy";

export class TrustedPaygCallLifecycleService {
  constructor(
    private readonly reservations: BillingChargeReservationRepository,
  ) {}

  async startPaygCall<T>(input: {
    organizationId: string;
    callSessionId: string;
    catalogId: string;
    chargeContext: PaygCallChargeContext;
    maximumExpectedChargeMinor: number;
    reservationExpiresAt: string;
    now: string;
    startProvider: () => Promise<T>;
  }) {
    const reservationId = `payg-call-reservation:${input.callSessionId}`;
    const reservation = await this.reservations.reservePaygCredit({
      id: reservationId,
      organizationId: input.organizationId,
      reservationKey: `payg-call:${input.callSessionId}`,
      catalogId: input.catalogId,
      chargeContext: input.chargeContext,
      amountMinor: input.maximumExpectedChargeMinor,
      currency: "usd",
      expiresAt: input.reservationExpiresAt,
      now: input.now,
    });
    if (reservation.outcome === "denied") {
      return {
        outcome: "blocked" as const,
        reason: reservation.reason,
        availableMinor: reservation.availableMinor,
      };
    }

    try {
      const providerResult = await input.startProvider();
      return {
        outcome: "started" as const,
        reservation: reservation.reservation,
        duplicateReservation: reservation.duplicate,
        providerResult,
      };
    } catch (error) {
      await this.reservations.releasePaygCredit({
        organizationId: input.organizationId,
        reservationId,
        now: input.now,
      });
      throw error;
    }
  }

  async releasePaygCall(input: {
    organizationId: string;
    callSessionId: string;
    now: string;
  }) {
    return this.reservations.releasePaygCredit({
      organizationId: input.organizationId,
      reservationId: `payg-call-reservation:${input.callSessionId}`,
      now: input.now,
    });
  }
}
