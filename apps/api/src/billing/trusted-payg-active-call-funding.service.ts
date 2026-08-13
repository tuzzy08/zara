import { calculatePaygCallCharge } from "./billing-payg-call-charge-policy";
import type { BillingChargeReservationRepository } from "./billing-charge-reservation.repository";
import type { PostgresBillingLedgerRepository } from "./postgres-billing-ledger.repository";
import type { TrustedSubscriptionCallLifecycleService } from "./trusted-subscription-call-lifecycle.service";

type LedgerRepository = Pick<PostgresBillingLedgerRepository, "getPriceCatalog">;
type ReservationRepository = Pick<BillingChargeReservationRepository, "getReservation">;
type SubscriptionReservationRepository = Pick<
  TrustedSubscriptionCallLifecycleService,
  "getReservationByKey"
>;

export interface TrustedPaygActiveCallFundingInput {
  organizationId: string;
  callSessionId: string;
  runtimeSeconds?: number | undefined;
  providerConnectedSeconds?: number | undefined;
  nextSafeSegmentSeconds?: number | undefined;
  now: string;
}

export class TrustedPaygActiveCallFundingService {
  constructor(
    private readonly ledger: LedgerRepository,
    private readonly reservations: ReservationRepository,
    private readonly subscriptionReservations: SubscriptionReservationRepository,
  ) {}

  async evaluateNextSafeSegment(input: TrustedPaygActiveCallFundingInput) {
    try {
      return await this.evaluateTrustedInput(input);
    } catch {
      return { billingAccessMode: "payg" as const, outcome: "unfunded" as const };
    }
  }

  private async evaluateTrustedInput(input: TrustedPaygActiveCallFundingInput) {
    const [reservation, subscriptionReservation] = await Promise.all([
      this.reservations.getReservation(
        input.organizationId,
        `payg-call-reservation:${input.callSessionId}`,
      ),
      this.subscriptionReservations.getReservationByKey(
        input.organizationId,
        input.callSessionId,
      ),
    ]);
    if (reservation === null) {
      return isActiveSubscriptionReservation(subscriptionReservation, input)
        ? { billingAccessMode: "subscription" as const }
        : { billingAccessMode: "payg" as const, outcome: "unfunded" as const };
    }
    if (
      subscriptionReservation !== null
      || reservation.reservationKey !== `payg-call:${input.callSessionId}`
      || reservation.status !== "active"
      || !Number.isFinite(Date.parse(input.now))
      || Date.parse(reservation.expiresAt) <= Date.parse(input.now)
      || reservation.catalogId === undefined
      || reservation.chargeContext === undefined
    ) {
      return { billingAccessMode: "payg" as const, outcome: "unfunded" as const };
    }
    const catalog = await this.ledger.getPriceCatalog(reservation.catalogId);
    if (catalog === null) {
      return { billingAccessMode: "payg" as const, outcome: "unfunded" as const };
    }
    if (
      input.runtimeSeconds === undefined
      || !Number.isFinite(input.runtimeSeconds)
      || input.runtimeSeconds < 0
      || input.nextSafeSegmentSeconds === undefined
      || !Number.isFinite(input.nextSafeSegmentSeconds)
      || input.nextSafeSegmentSeconds <= 0
    ) {
      return { billingAccessMode: "payg" as const, outcome: "unfunded" as const };
    }
    const projected = calculatePaygCallCharge({
      catalogDocument: catalog.document,
      ...reservation.chargeContext,
      runtimeSeconds: input.runtimeSeconds + input.nextSafeSegmentSeconds,
      ...(reservation.chargeContext.ownershipMode === "platform-managed"
        ? {
            providerConnectedSeconds: input.providerConnectedSeconds === undefined
              ? undefined
              : input.providerConnectedSeconds + input.nextSafeSegmentSeconds,
          }
        : {}),
    });
    if (projected.totalMinor > reservation.reservedAmountMinor) {
      return { billingAccessMode: "payg" as const, outcome: "unfunded" as const };
    }
    return {
      billingAccessMode: "payg" as const,
      outcome: "funded" as const,
      catalogId: catalog.id,
      projectedChargeMinor: projected.totalMinor,
      reservedAmountMinor: reservation.reservedAmountMinor,
    };
  }
}

function isActiveSubscriptionReservation(
  reservation: Awaited<ReturnType<SubscriptionReservationRepository["getReservationByKey"]>>,
  input: TrustedPaygActiveCallFundingInput,
) {
  return reservation !== null
    && reservation.organizationId === input.organizationId
    && reservation.reservationKey === input.callSessionId
    && reservation.status === "active"
    && Number.isFinite(Date.parse(input.now))
    && Date.parse(reservation.expiresAt) > Date.parse(input.now);
}
