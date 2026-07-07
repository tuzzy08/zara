export function assertProductionAuthCookieOriginCompatibility(
  env: Record<string, string | undefined> = process.env,
) {
  if (env.NODE_ENV !== "production" && env.ZARA_ENV !== "production") {
    return;
  }

  const authUrl = tryParseHttpUrl(env.BETTER_AUTH_URL);

  if (authUrl === null) {
    return;
  }

  if (authUrl.protocol !== "https:") {
    throw new Error("Production BETTER_AUTH_URL must use https so Better Auth session cookies can be secure.");
  }

  for (const origin of readTrustedOriginUrls(env.ZARA_TRUSTED_ORIGINS)) {
    if (!sameSiteHostname(authUrl.hostname, origin.hostname)) {
      throw new Error(
        `Production auth cookie origin mismatch: BETTER_AUTH_URL (${authUrl.origin}) and ZARA_TRUSTED_ORIGINS entry (${origin.origin}) are not same-site. Better Auth session cookies are SameSite=Lax by default, so browser auth calls from ${origin.origin} will not restore a tenant session from ${authUrl.origin}. Configure API_PUBLIC_URL, BETTER_AUTH_URL, VITE_AUTH_BASE_URL, and VITE_API_BASE_URL to a same-site API origin such as https://api.${siteDomain(origin.hostname)}.`,
      );
    }
  }
}

function readTrustedOriginUrls(value: string | undefined): URL[] {
  if (value === undefined || value.trim().length === 0) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .flatMap((entry) => {
      const url = tryParseHttpUrl(entry);
      return url === null ? [] : [url];
    });
}

function tryParseHttpUrl(value: string | undefined): URL | null {
  if (value === undefined || value.trim().length === 0) {
    return null;
  }

  try {
    const url = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

function sameSiteHostname(left: string, right: string) {
  return siteDomain(left) === siteDomain(right);
}

function siteDomain(hostname: string) {
  const normalized = hostname.toLowerCase();

  if (normalized === "localhost" || normalized.includes(":") || ipv4AddressPattern.test(normalized)) {
    return normalized;
  }

  const labels = normalized.split(".").filter((label) => label.length > 0);

  if (labels.length <= 2) {
    return normalized;
  }

  return labels.slice(-2).join(".");
}

const ipv4AddressPattern = /^\d{1,3}(?:\.\d{1,3}){3}$/;
