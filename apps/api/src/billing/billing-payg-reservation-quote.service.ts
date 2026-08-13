import type { PostgresBillingLedgerRepository } from "./postgres-billing-ledger.repository";
import {
  calculatePaygCallCharge,
  normalizePaygCallChargeContext,
  type PaygPlatformRouteIdentity,
} from "./billing-payg-call-charge-policy";

type LedgerRepository = Pick<
  PostgresBillingLedgerRepository,
  "getEffectivePriceCatalog"
>;

export interface PaygCallReservationQuoteInput {
  effectiveAt: string;
  maximumCallSeconds: number;
  runtimePath: "pstn-sandwich" | "pstn-premium-realtime";
  ownershipMode: "platform-managed" | "byo";
  provider: string;
  direction: "inbound" | "outbound";
  routeIdentity?: PaygPlatformRouteIdentity | undefined;
}

export class BillingPaygReservationQuoteService {
  constructor(private readonly ledger: LedgerRepository) {}

  async quoteCall(input: PaygCallReservationQuoteInput) {
    const maximumCallSeconds = requirePositiveInteger(
      input.maximumCallSeconds,
      "maximumCallSeconds",
    );
    requireTimestamp(input.effectiveAt, "effectiveAt");

    const catalog = await this.ledger.getEffectivePriceCatalog(input.effectiveAt);
    if (catalog === null) {
      throw new Error("An effective billing price catalog is required.");
    }

    const charge = calculatePaygCallCharge({
      catalogDocument: catalog.document,
      runtimePath: input.runtimePath,
      runtimeSeconds: maximumCallSeconds,
      ownershipMode: input.ownershipMode,
      provider: input.provider,
      direction: input.direction,
      ...(input.routeIdentity === undefined ? {} : { routeIdentity: input.routeIdentity }),
      ...(input.ownershipMode === "platform-managed"
        ? { providerConnectedSeconds: maximumCallSeconds }
        : {}),
    });
    const chargeContext = normalizePaygCallChargeContext(input);

    return {
      catalogId: catalog.id,
      currency: catalog.currency,
      maximumCallSeconds,
      chargeContext,
      components: {
        runtimeMinor: charge.runtimeMinor,
        telephonyMinor: charge.telephonyMinor,
      },
      maximumExpectedChargeMinor: charge.totalMinor,
    };
  }
}

function requireNonNegativeInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${field} must be a non-negative safe integer.`);
  }
  return Number(value);
}

function requirePositiveInteger(value: unknown, field: string) {
  const integer = requireNonNegativeInteger(value, field);
  if (integer === 0) {
    throw new Error(`${field} must be greater than zero.`);
  }
  return integer;
}

function requireTimestamp(value: string, field: string) {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be a valid timestamp.`);
  }
}
