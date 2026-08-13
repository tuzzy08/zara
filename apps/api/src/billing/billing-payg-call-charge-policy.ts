export interface PaygCallChargeContext {
  runtimePath: "pstn-sandwich" | "pstn-premium-realtime";
  ownershipMode: "platform-managed" | "byo";
  provider: string;
  direction: "inbound" | "outbound";
  routeIdentity?: PaygPlatformRouteIdentity | undefined;
}

export interface PaygCallChargeInput extends PaygCallChargeContext {
  catalogDocument: Record<string, unknown>;
  runtimeSeconds: number;
  providerConnectedSeconds?: number | undefined;
}

export interface PaygPlatformRouteIdentity {
  rateId: string;
  provider: string;
  direction: "inbound" | "outbound";
  sourceCountry: string;
  destinationZone: string;
  providerSku: string;
  currency: "usd";
  effectiveAt: string;
}

export function calculatePaygCallCharge(input: PaygCallChargeInput) {
  const context = normalizePaygCallChargeContext(input);
  const runtimeSeconds = requireNonNegativeInteger(
    input.runtimeSeconds,
    "runtimeSeconds",
  );
  const payg = requireRecord(input.catalogDocument.payg, "catalog.payg");
  const runtimeRateField = context.runtimePath === "pstn-sandwich"
    ? "standardRuntimePerMinuteMinor"
    : "premiumRuntimePerMinuteMinor";
  const runtimeRate = requireNonNegativeInteger(
    payg[runtimeRateField],
    `catalog.payg.${runtimeRateField}`,
  );
  const runtimeMinor = Math.ceil(runtimeSeconds * runtimeRate / 60);

  let telephonyMinor = 0;
  if (context.ownershipMode === "platform-managed") {
    const connectedSeconds = requireNonNegativeInteger(
      input.providerConnectedSeconds,
      "providerConnectedSeconds",
    );
    const validatedRoute = validatePaygPlatformRoute({
      catalogDocument: input.catalogDocument,
      provider: context.provider,
      direction: context.direction,
      routeIdentity: context.routeIdentity,
    });
    telephonyMinor = Math.ceil(connectedSeconds / 60) * validatedRoute.customerRateMinorPerMinute;
  }

  const totalMinor = runtimeMinor + telephonyMinor;
  if (!Number.isSafeInteger(totalMinor)) {
    throw new Error("The PAYG call charge exceeds the safe integer range.");
  }
  return { runtimeMinor, telephonyMinor, totalMinor };
}

export function validatePaygPlatformRoute(input: {
  catalogDocument: Record<string, unknown>;
  provider: string;
  direction: "inbound" | "outbound";
  routeIdentity: PaygPlatformRouteIdentity | undefined;
}) {
    const identity = requireRouteIdentity(input.routeIdentity);
    const routeRateId = identity.rateId;
    const routes = requireRecord(
      input.catalogDocument.telephonyRoutes,
      "catalog.telephonyRoutes",
    );
    const route = requireRecord(
      routes[routeRateId],
      `catalog.telephonyRoutes.${routeRateId}`,
    );
    if (
      identity.provider !== input.provider
      || identity.direction !== input.direction
      || route.provider !== identity.provider
      || route.direction !== identity.direction
      || route.sourceCountry !== identity.sourceCountry
      || route.destinationZone !== identity.destinationZone
      || route.providerSku !== identity.providerSku
      || route.currency !== identity.currency
    ) {
      throw new Error(`Billing route ${routeRateId} does not match the call route.`);
    }
    const effectiveAt = requireTimestamp(identity.effectiveAt, "routeIdentity.effectiveAt");
    const effectiveFrom = requireTimestamp(
      route.effectiveFrom,
      `catalog.telephonyRoutes.${routeRateId}.effectiveFrom`,
    );
    const effectiveTo = route.effectiveTo === undefined
      ? undefined
      : requireTimestamp(
          route.effectiveTo,
          `catalog.telephonyRoutes.${routeRateId}.effectiveTo`,
        );
    if (effectiveAt < effectiveFrom || (effectiveTo !== undefined && effectiveAt >= effectiveTo)) {
      throw new Error(`Billing route ${routeRateId} is not effective for this call.`);
    }
    if (route.rounding !== "next_full_minute") {
      throw new Error(`Billing route ${routeRateId} has unsupported rounding.`);
    }
    const telephonyRate = requireNonNegativeInteger(
      route.customerRateMinorPerMinute,
      `catalog.telephonyRoutes.${routeRateId}.customerRateMinorPerMinute`,
    );
    return { identity, customerRateMinorPerMinute: telephonyRate };
}

export function normalizePaygCallChargeContext(value: unknown): PaygCallChargeContext {
  const context = requireRecord(value, "chargeContext");
  const runtimePath = requireText(context.runtimePath, "chargeContext.runtimePath");
  const ownershipMode = requireText(context.ownershipMode, "chargeContext.ownershipMode");
  const direction = requireText(context.direction, "chargeContext.direction");
  if (runtimePath !== "pstn-sandwich" && runtimePath !== "pstn-premium-realtime") {
    throw new Error("chargeContext.runtimePath is unsupported.");
  }
  if (ownershipMode !== "platform-managed" && ownershipMode !== "byo") {
    throw new Error("chargeContext.ownershipMode is unsupported.");
  }
  if (direction !== "inbound" && direction !== "outbound") {
    throw new Error("chargeContext.direction is unsupported.");
  }
  return {
    runtimePath,
    ownershipMode,
    provider: requireText(context.provider, "chargeContext.provider"),
    direction,
    ...(ownershipMode === "platform-managed"
      ? { routeIdentity: requireRouteIdentity(context.routeIdentity) }
      : {}),
  };
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} is required.`);
  }
  return value as Record<string, unknown>;
}

function requireNonNegativeInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${field} must be a non-negative safe integer.`);
  }
  return Number(value);
}

function requireText(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

function requireTimestamp(value: unknown, field: string) {
  const text = requireText(value, field);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${field} must be a valid timestamp.`);
  }
  return timestamp;
}

function requireRouteIdentity(value: unknown): PaygPlatformRouteIdentity {
  const identity = requireRecord(value, "routeIdentity");
  const direction = requireText(identity.direction, "routeIdentity.direction");
  const currency = requireText(identity.currency, "routeIdentity.currency");
  if (direction !== "inbound" && direction !== "outbound") {
    throw new Error("routeIdentity.direction is unsupported.");
  }
  if (currency !== "usd") {
    throw new Error("routeIdentity.currency is unsupported.");
  }
  return {
    rateId: requireText(identity.rateId, "routeIdentity.rateId"),
    provider: requireText(identity.provider, "routeIdentity.provider"),
    direction,
    sourceCountry: requireText(identity.sourceCountry, "routeIdentity.sourceCountry"),
    destinationZone: requireText(
      identity.destinationZone,
      "routeIdentity.destinationZone",
    ),
    providerSku: requireText(identity.providerSku, "routeIdentity.providerSku"),
    currency,
    effectiveAt: requireText(identity.effectiveAt, "routeIdentity.effectiveAt"),
  };
}
