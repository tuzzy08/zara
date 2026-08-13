const tenantUsdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export function formatStatus(value: string) {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function formatUsd(value: number) {
  return tenantUsdFormatter.format(value);
}

export function formatMoneyMinor(valueMinor: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 2,
  }).format(valueMinor / 100);
}

export function formatUsageCost(
  usage: {
    costMinor?: number | null;
    costUsd: number | null;
    disposition?: "posted" | "shadow_estimate" | "incomplete" | "non_billable" | "blocked";
  },
  currency: string,
) {
  const amountMinor = usage.costMinor ?? (usage.costUsd === null ? null : Math.round(usage.costUsd * 100));

  if (usage.disposition === "blocked") {
    return "Blocked";
  }

  if (usage.disposition === "non_billable") {
    return "Non-billable";
  }

  if (amountMinor === null || usage.disposition === "incomplete") {
    return "Price unavailable";
  }

  const amount = formatMoneyMinor(amountMinor, currency);
  return usage.disposition === "shadow_estimate" ? `${amount} shadow estimate` : `${amount} posted`;
}
