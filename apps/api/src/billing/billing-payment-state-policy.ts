export type BillingSubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "revoked"
  | "unknown";

export interface BillingSubscriptionProjection {
  providerSubscriptionId: string;
  status: BillingSubscriptionStatus;
  accessAllowed: boolean;
  updatedAt: string;
  graceEndsAt?: string | undefined;
}

export function projectPolarSubscription(input: {
  providerSubscriptionId: string;
  providerStatus: string;
  updatedAt: string;
  now: string;
  graceEndsAt?: string | undefined;
}): BillingSubscriptionProjection {
  const status = subscriptionStatus(input.providerStatus);
  const accessAllowed =
    status === "active"
    || status === "trialing"
    || (
      status === "past_due"
      && input.graceEndsAt !== undefined
      && Date.parse(input.now) < Date.parse(input.graceEndsAt)
    );
  return {
    providerSubscriptionId: input.providerSubscriptionId,
    status,
    accessAllowed,
    updatedAt: input.updatedAt,
    ...(input.graceEndsAt === undefined ? {} : { graceEndsAt: input.graceEndsAt }),
  };
}

export function selectActiveSubscription(
  subscriptions: BillingSubscriptionProjection[],
) {
  return subscriptions
    .filter((subscription) => subscription.accessAllowed)
    .sort((left, right) => {
      const rankDifference = statusRank(right.status) - statusRank(left.status);
      if (rankDifference !== 0) return rankDifference;
      const timeDifference = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      if (timeDifference !== 0) return timeDifference;
      return left.providerSubscriptionId.localeCompare(right.providerSubscriptionId);
    })[0];
}

function subscriptionStatus(providerStatus: string): BillingSubscriptionStatus {
  switch (providerStatus) {
    case "trialing":
    case "active":
    case "past_due":
    case "canceled":
    case "revoked":
      return providerStatus;
    default:
      return "unknown";
  }
}

function statusRank(status: BillingSubscriptionStatus) {
  if (status === "active") return 3;
  if (status === "trialing") return 2;
  if (status === "past_due") return 1;
  return 0;
}
