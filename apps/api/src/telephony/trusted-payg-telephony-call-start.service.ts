import { Injectable } from "@nestjs/common";

import {
  BillingPaygReservationQuoteService,
  type PaygCallReservationQuoteInput,
} from "../billing/billing-payg-reservation-quote.service";
import { TrustedPaygCallLifecycleService } from "../billing/trusted-payg-call-lifecycle.service";
import type { PaygPlatformRouteIdentity } from "../billing/billing-payg-call-charge-policy";

@Injectable()
export class TrustedPaygTelephonyCallStartService {
  constructor(
    private readonly quotes: BillingPaygReservationQuoteService,
    private readonly lifecycle: TrustedPaygCallLifecycleService,
  ) {}

  async startOutbound<T>(input: Omit<
    PaygCallReservationQuoteInput,
    "direction" | "routeIdentity"
  > & {
    organizationId: string;
    callSessionId: string;
    fromPhoneNumber: string;
    toPhoneNumber: string;
    reservationExpiresAt: string;
    startProvider: () => Promise<T>;
  }) {
    const routeIdentity = resolvePaygOutboundRouteIdentity({
      ownershipMode: input.ownershipMode,
      provider: input.provider,
      fromPhoneNumber: input.fromPhoneNumber,
      toPhoneNumber: input.toPhoneNumber,
      effectiveAt: input.effectiveAt,
    });
    return this.start({
      ...input,
      direction: "outbound",
      ...(routeIdentity === undefined ? {} : { routeIdentity }),
    });
  }

  async start<T>(input: PaygCallReservationQuoteInput & {
    organizationId: string;
    callSessionId: string;
    reservationExpiresAt: string;
    startProvider: () => Promise<T>;
  }) {
    if (
      input.ownershipMode === "platform-managed"
      && input.direction === "inbound"
    ) {
      return {
        outcome: "blocked" as const,
        reason: "unsupported_platform_managed_inbound_payg" as const,
      };
    }
    const quote = await this.quotes.quoteCall(input);
    return this.lifecycle.startPaygCall({
      organizationId: input.organizationId,
      callSessionId: input.callSessionId,
      maximumExpectedChargeMinor: quote.maximumExpectedChargeMinor,
      catalogId: quote.catalogId,
      chargeContext: quote.chargeContext,
      reservationExpiresAt: input.reservationExpiresAt,
      now: input.effectiveAt,
      startProvider: input.startProvider,
    });
  }

  async releaseStartedCall(input: {
    organizationId: string;
    callSessionId: string;
    now: string;
  }) {
    return this.lifecycle.releasePaygCall(input);
  }
}

export function resolvePaygOutboundRouteIdentity(input: {
  ownershipMode: "platform-managed" | "byo";
  provider: string;
  fromPhoneNumber: string;
  toPhoneNumber: string;
  effectiveAt: string;
}): PaygPlatformRouteIdentity | undefined {
  if (input.ownershipMode === "byo") return undefined;
  if (
    input.provider !== "twilio"
    || !/^\+234\d{7,12}$/.test(input.fromPhoneNumber)
    || !/^\+234\d{7,12}$/.test(input.toPhoneNumber)
  ) {
    throw new Error(
      "Platform-managed PAYG outbound requires an approved Twilio Nigeria route.",
    );
  }
  return {
    rateId: "twilio-ng-outbound",
    provider: "twilio",
    direction: "outbound",
    sourceCountry: "NG",
    destinationZone: "nigeria-local-mobile",
    providerSku: "twilio-voice-ng-local-mobile-media-streams",
    currency: "usd",
    effectiveAt: input.effectiveAt,
  };
}
