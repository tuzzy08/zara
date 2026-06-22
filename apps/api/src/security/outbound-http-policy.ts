import { BadRequestException } from "@nestjs/common";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const blockedAddressList = new BlockList();
blockedAddressList.addSubnet("0.0.0.0", 8, "ipv4");
blockedAddressList.addSubnet("10.0.0.0", 8, "ipv4");
blockedAddressList.addSubnet("100.64.0.0", 10, "ipv4");
blockedAddressList.addSubnet("127.0.0.0", 8, "ipv4");
blockedAddressList.addSubnet("169.254.0.0", 16, "ipv4");
blockedAddressList.addSubnet("172.16.0.0", 12, "ipv4");
blockedAddressList.addSubnet("192.168.0.0", 16, "ipv4");
blockedAddressList.addSubnet("198.18.0.0", 15, "ipv4");
blockedAddressList.addSubnet("224.0.0.0", 4, "ipv4");
blockedAddressList.addSubnet("240.0.0.0", 4, "ipv4");
blockedAddressList.addAddress("100.100.100.200", "ipv4");
blockedAddressList.addAddress("::", "ipv6");
blockedAddressList.addAddress("::1", "ipv6");
blockedAddressList.addSubnet("fc00::", 7, "ipv6");
blockedAddressList.addSubnet("fe80::", 10, "ipv6");
blockedAddressList.addSubnet("ff00::", 8, "ipv6");

const blockedHostnames = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
]);

const lookupCache = new Map<string, Promise<string[]>>();

export async function assertAllowedOutboundHttpUrl(input: string | URL): Promise<void> {
  let url: URL;
  try {
    url = input instanceof URL ? input : new URL(input);
  } catch {
    throw new BadRequestException("Outbound HTTP destination must be a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BadRequestException("Outbound HTTP destination must use HTTP or HTTPS.");
  }

  const hostname = normalizeHostname(url.hostname);
  if (hostname.length === 0 || blockedHostnames.has(hostname)) {
    throwBlockedDestination();
  }

  assertAllowedAddress(hostname);

  for (const address of await resolveHostname(hostname)) {
    assertAllowedAddress(address);
  }
}

function normalizeHostname(hostname: string) {
  return hostname
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/\.$/, "");
}

function assertAllowedAddress(hostOrAddress: string) {
  const address = normalizeHostname(hostOrAddress);
  const ipVersion = isIP(address);
  if (ipVersion === 0) {
    return;
  }

  if (ipVersion === 4 && blockedAddressList.check(address, "ipv4")) {
    throwBlockedDestination();
  }

  if (ipVersion === 6) {
    const mappedIpv4Address = readMappedIpv4Address(address);
    if (mappedIpv4Address !== undefined) {
      assertAllowedAddress(mappedIpv4Address);
      return;
    }

    if (blockedAddressList.check(address, "ipv6")) {
      throwBlockedDestination();
    }
  }
}

function readMappedIpv4Address(address: string) {
  const mappedPrefix = "::ffff:";
  return address.startsWith(mappedPrefix) ? address.slice(mappedPrefix.length) : undefined;
}

async function resolveHostname(hostname: string) {
  if (isIP(hostname) !== 0) {
    return [];
  }

  const cached = lookupCache.get(hostname);
  if (cached !== undefined) {
    return cached;
  }

  const lookupPromise = lookup(hostname, { all: true, verbatim: true })
    .then((addresses) => addresses.map((address) => address.address))
    .catch(() => []);
  lookupCache.set(hostname, lookupPromise);

  return lookupPromise;
}

function throwBlockedDestination(): never {
  throw new BadRequestException("Outbound HTTP destination is not allowed.");
}
