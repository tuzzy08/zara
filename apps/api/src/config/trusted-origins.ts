const localDevOrigins = [
  "http://127.0.0.1:4173",
  "http://127.0.0.1:4174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://localhost:4173",
  "http://localhost:4174",
  "http://localhost:5173",
  "http://localhost:5174",
] as const;

const productionOrigins = [
  "https://zharaai.com",
  "https://app.zara.ai",
  "https://admin.zara.ai",
  "https://staging-app.zara.ai",
  "https://staging-admin.zara.ai",
] as const;

export function resolveTrustedOrigins(env: Record<string, string | undefined> = process.env): string[] {
  return uniqueOrigins([
    ...localDevOrigins,
    ...productionOrigins,
    ...readOriginList(env.ZARA_TRUSTED_ORIGINS, "ZARA_TRUSTED_ORIGINS"),
  ]);
}

function readOriginList(value: string | undefined, key: string): string[] {
  if (value === undefined || value.trim().length === 0) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => normalizeOrigin(entry, key));
}

function normalizeOrigin(entry: string, key: string): string {
  let url: URL;

  try {
    url = new URL(entry);
  } catch {
    throw new Error(`${key} entry '${entry}' must be a valid URL origin.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${key} entry '${entry}' must use http or https.`);
  }

  if ((url.pathname !== "" && url.pathname !== "/") || url.search !== "" || url.hash !== "") {
    throw new Error(`${key} entry '${entry}' must be an origin without a path, query, or fragment.`);
  }

  return url.origin;
}

function uniqueOrigins(origins: readonly string[]): string[] {
  return [...new Set(origins)];
}
