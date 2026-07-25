import { createHash } from "node:crypto";

import {
  assertPstnCallAdmissionActivationInput,
  assertPstnCallAdmissionInput,
  assertPstnCallAdmissionLeaseInput,
  assertPstnCallAdmissionReleaseInput,
  type PstnAdmissionLimitingDimension,
  type PstnAdmissionReasonCode,
  type PstnCallAdmission,
  type PstnCallAdmissionActivationInput,
  type PstnCallAdmissionActivateResult,
  type PstnCallAdmissionHealth,
  type PstnCallAdmissionInput,
  type PstnCallAdmissionLeaseInput,
  type PstnCallAdmissionReleaseInput,
  type PstnCallAdmissionReleaseResult,
  type PstnCallAdmissionRenewResult,
  type PstnCallAdmissionReserveResult,
} from "./pstn-call-admission";
import { PstnAdmissionIndeterminateError } from "./pstn-admission-redis-client";

export interface PstnAdmissionRedisCommands {
  eval(
    script: string,
    keys: readonly string[],
    args: readonly string[],
  ): Promise<unknown>;
}

export interface RedisPstnCallAdmissionOptions {
  keyPrefix?: string;
}

const denialDimensions: Readonly<
  Record<PstnAdmissionReasonCode, PstnAdmissionLimitingDimension | undefined>
> = {
  global_concurrency_limit: "global_concurrency",
  provider_concurrency_limit: "provider_concurrency",
  tenant_concurrency_limit: "tenant_concurrency",
  runtime_concurrency_limit: "runtime_concurrency",
  worker_concurrency_limit: "worker_concurrency",
  global_cps_limit: "global_cps",
  provider_account_cps_limit: "provider_account_cps",
  backend_unavailable: "backend",
  indeterminate_result: undefined,
};

const reserveScript = `
local clock = redis.call("TIME")
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local member = ARGV[1]
local fingerprint = ARGV[2]

for index = 2, 6 do
  redis.call("ZREMRANGEBYSCORE", KEYS[index], "-inf", now)
end
local expiredHoldMembers = redis.call("ZRANGEBYSCORE", KEYS[10], "-inf", now)
for _, expiredMember in ipairs(expiredHoldMembers) do
  redis.call("ZREM", KEYS[9], expiredMember)
  redis.call("HDEL", KEYS[11], expiredMember)
end
redis.call("ZREMRANGEBYSCORE", KEYS[10], "-inf", now)

if redis.call("EXISTS", KEYS[1]) == 1 then
  local expiresAt = tonumber(redis.call("HGET", KEYS[1], "expiresAt"))
  if expiresAt ~= nil and expiresAt > now then
    if redis.call("HGET", KEYS[1], "fingerprint") == fingerprint then
      return {
        "admitted",
        "existing",
        tostring(expiresAt),
        redis.call("HGET", KEYS[1], "limitingDimension"),
        redis.call("HGET", KEYS[1], "remainingCapacity")
      }
    end
    return {"denied", "indeterminate_result"}
  end
  redis.call("DEL", KEYS[1])
  for index = 2, 6 do
    redis.call("ZREM", KEYS[index], member)
  end
end

if redis.call("ZCOUNT", KEYS[9], "-inf", now) > 0 then
  return {"denied", "indeterminate_result"}
end

local concurrencyReasons = {
  "global_concurrency_limit",
  "provider_concurrency_limit",
  "tenant_concurrency_limit",
  "runtime_concurrency_limit",
  "worker_concurrency_limit"
}
local concurrencyDimensions = {
  "global_concurrency",
  "provider_concurrency",
  "tenant_concurrency",
  "runtime_concurrency",
  "worker_concurrency"
}
local limitingDimension = concurrencyDimensions[1]
local lowestRemaining = math.huge
for index = 2, 6 do
  local remaining = tonumber(ARGV[index + 1]) - redis.call("ZCARD", KEYS[index])
  if remaining < lowestRemaining then
    lowestRemaining = remaining
    limitingDimension = concurrencyDimensions[index - 1]
  end
  if remaining <= 0 then
    return {"denied", concurrencyReasons[index - 1], "0"}
  end
end

local function readBucket(key, capacity, refillPerSecond)
  local tokens = tonumber(redis.call("HGET", key, "tokens"))
  local updatedAt = tonumber(redis.call("HGET", key, "updatedAt"))
  if tokens == nil or updatedAt == nil then
    return capacity
  end
  local elapsedSeconds = math.max(0, now - updatedAt) / 1000
  return math.min(capacity, tokens + elapsedSeconds * refillPerSecond)
end

local globalCapacity = tonumber(ARGV[8])
local globalRefill = tonumber(ARGV[9])
local accountCapacity = tonumber(ARGV[10])
local accountRefill = tonumber(ARGV[11])
local globalTokens = readBucket(KEYS[7], globalCapacity, globalRefill)
local accountTokens = readBucket(KEYS[8], accountCapacity, accountRefill)

if globalTokens < 1 then
  return {"denied", "global_cps_limit"}
end
if accountTokens < 1 then
  return {"denied", "provider_account_cps_limit"}
end

redis.call("HSET", KEYS[7], "tokens", globalTokens - 1, "updatedAt", now)
redis.call("HSET", KEYS[8], "tokens", accountTokens - 1, "updatedAt", now)
local globalBucketTtl = math.max(tonumber(ARGV[12]), math.ceil(globalCapacity / globalRefill * 2000))
local accountBucketTtl = math.max(tonumber(ARGV[12]), math.ceil(accountCapacity / accountRefill * 2000))
redis.call("PEXPIRE", KEYS[7], globalBucketTtl)
redis.call("PEXPIRE", KEYS[8], accountBucketTtl)

local expiresAt = now + tonumber(ARGV[12])
redis.call(
  "HSET",
  KEYS[1],
  "fingerprint", fingerprint,
  "state", "claim",
  "expiresAt", expiresAt,
  "limitingDimension", limitingDimension,
  "remainingCapacity", lowestRemaining - 1,
  "globalKey", KEYS[2],
  "providerKey", KEYS[3],
  "tenantKey", KEYS[4],
  "runtimeKey", KEYS[5],
  "workerKey", KEYS[6]
)
redis.call("PEXPIREAT", KEYS[1], expiresAt)
for index = 2, 6 do
  redis.call("ZADD", KEYS[index], expiresAt, member)
  redis.call("PEXPIREAT", KEYS[index], expiresAt, "NX")
  redis.call("PEXPIREAT", KEYS[index], expiresAt, "GT")
end
return {
  "admitted",
  "created",
  tostring(expiresAt),
  limitingDimension,
  tostring(lowestRemaining - 1)
}
`;

const activateScript = `
local clock = redis.call("TIME")
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local member = ARGV[1]
local fullInput = #KEYS == 9
local destinationWorkerKey = fullInput and KEYS[6] or KEYS[2]
local holdStartsKey = fullInput and KEYS[7] or KEYS[3]
local holdExpiresKey = fullInput and KEYS[8] or KEYS[4]
local holdOwnersKey = fullInput and KEYS[9] or KEYS[5]
local dimensionKeys = nil

local function clearRecoveryHold()
  redis.call("ZREM", holdStartsKey, member)
  redis.call("ZREM", holdExpiresKey, member)
  redis.call("HDEL", holdOwnersKey, member)
end

local function writeRecoveryHold(blockAt, ownerKey, ownershipEpoch)
  local holdExpiresAt = blockAt + tonumber(ARGV[2])
  redis.call("ZADD", holdStartsKey, blockAt, member)
  redis.call("ZADD", holdExpiresKey, holdExpiresAt, member)
  redis.call("HSET", holdOwnersKey, member, ownerKey .. "|" .. tostring(ownershipEpoch))
  redis.call("PEXPIREAT", holdStartsKey, holdExpiresAt, "NX")
  redis.call("PEXPIREAT", holdStartsKey, holdExpiresAt, "GT")
  redis.call("PEXPIREAT", holdExpiresKey, holdExpiresAt, "NX")
  redis.call("PEXPIREAT", holdExpiresKey, holdExpiresAt, "GT")
  redis.call("PEXPIREAT", holdOwnersKey, holdExpiresAt, "NX")
  redis.call("PEXPIREAT", holdOwnersKey, holdExpiresAt, "GT")
end

local function readRecoveryOwner()
  local holdExpiresAt = tonumber(redis.call("ZSCORE", holdExpiresKey, member))
  if holdExpiresAt ~= nil and holdExpiresAt <= now then
    clearRecoveryHold()
    return false
  end
  local encoded = redis.call("HGET", holdOwnersKey, member)
  if encoded == false then
    return false, false
  end
  local ownerKey, ownershipEpoch = string.match(encoded, "^(.*)|(%d+)$")
  if ownerKey == nil or ownershipEpoch == nil then
    return false, false
  end
  return ownerKey, tonumber(ownershipEpoch)
end

if redis.call("EXISTS", KEYS[1]) == 1 then
  dimensionKeys = {
    redis.call("HGET", KEYS[1], "globalKey"),
    redis.call("HGET", KEYS[1], "providerKey"),
    redis.call("HGET", KEYS[1], "tenantKey"),
    redis.call("HGET", KEYS[1], "runtimeKey"),
    redis.call("HGET", KEYS[1], "workerKey")
  }
  for index = 1, 5 do
    if dimensionKeys[index] == false then
      if fullInput then
        local previousEpoch = tonumber(redis.call("HGET", KEYS[1], "ownershipEpoch")) or 0
        writeRecoveryHold(now, destinationWorkerKey, previousEpoch)
      end
      return {"not_found"}
    end
    redis.call("ZREMRANGEBYSCORE", dimensionKeys[index], "-inf", now)
  end
  local currentExpiresAt = tonumber(redis.call("HGET", KEYS[1], "expiresAt"))
  if currentExpiresAt == nil or currentExpiresAt <= now then
    redis.call("DEL", KEYS[1])
    for index = 1, 5 do
      redis.call("ZREM", dimensionKeys[index], member)
    end
    dimensionKeys = nil
  end
end

if dimensionKeys == nil then
  if not fullInput then
    return {"not_found"}
  end
  local recoveryOwner, recoveryEpoch = readRecoveryOwner()
  if recoveryOwner == false then
    return {"not_found"}
  end
  if recoveryOwner ~= destinationWorkerKey then
    return {"not_owner"}
  end
  local concurrencyReasons = {
    "global_concurrency_limit",
    "provider_concurrency_limit",
    "tenant_concurrency_limit",
    "runtime_concurrency_limit",
    "worker_concurrency_limit"
  }
  local concurrencyDimensions = {
    "global_concurrency",
    "provider_concurrency",
    "tenant_concurrency",
    "runtime_concurrency",
    "worker_concurrency"
  }
  local limitingDimension = concurrencyDimensions[1]
  local lowestRemaining = math.huge
  for index = 2, 6 do
    redis.call("ZREMRANGEBYSCORE", KEYS[index], "-inf", now)
    local remaining = tonumber(ARGV[index + 1]) - redis.call("ZCARD", KEYS[index])
    if remaining < lowestRemaining then
      lowestRemaining = remaining
      limitingDimension = concurrencyDimensions[index - 1]
    end
    if remaining <= 0 then
      writeRecoveryHold(now, destinationWorkerKey, recoveryEpoch)
      return {"denied", concurrencyReasons[index - 1]}
    end
  end
  dimensionKeys = {KEYS[2], KEYS[3], KEYS[4], KEYS[5], KEYS[6]}
  local expiresAt = now + tonumber(ARGV[2])
  local ownershipEpoch = recoveryEpoch + 1
  redis.call(
    "HSET",
    KEYS[1],
    "fingerprint", ARGV[8],
    "state", "active",
    "expiresAt", expiresAt,
    "limitingDimension", limitingDimension,
    "remainingCapacity", lowestRemaining - 1,
    "ownershipEpoch", ownershipEpoch,
    "globalKey", KEYS[2],
    "providerKey", KEYS[3],
    "tenantKey", KEYS[4],
    "runtimeKey", KEYS[5],
    "workerKey", KEYS[6]
  )
  redis.call("PEXPIREAT", KEYS[1], expiresAt)
  for index = 1, 5 do
    redis.call("ZADD", dimensionKeys[index], expiresAt, member)
    redis.call("PEXPIREAT", dimensionKeys[index], expiresAt, "NX")
    redis.call("PEXPIREAT", dimensionKeys[index], expiresAt, "GT")
  end
  writeRecoveryHold(expiresAt, destinationWorkerKey, ownershipEpoch)
  return {"activated", tostring(expiresAt), tostring(ownershipEpoch)}
end

local state = redis.call("HGET", KEYS[1], "state")
local ownershipEpoch = tonumber(redis.call("HGET", KEYS[1], "ownershipEpoch"))
if state == "active" and destinationWorkerKey ~= dimensionKeys[5] then
  return {"not_owner"}
end

if state ~= "active" and destinationWorkerKey ~= dimensionKeys[5] then
  redis.call("ZREMRANGEBYSCORE", destinationWorkerKey, "-inf", now)
  local workerLimit = fullInput and tonumber(ARGV[7]) or tonumber(ARGV[3])
  if redis.call("ZCARD", destinationWorkerKey) >= workerLimit then
    return {"denied", "worker_concurrency_limit"}
  end
  redis.call("ZREM", dimensionKeys[5], member)
  dimensionKeys[5] = destinationWorkerKey
  redis.call("HSET", KEYS[1], "workerKey", destinationWorkerKey)
end

local expiresAt = tonumber(redis.call("HGET", KEYS[1], "expiresAt"))
if state == "active" then
  if ownershipEpoch == nil then
    return {"not_owner"}
  end
  redis.call("ZADD", dimensionKeys[5], expiresAt, member)
  redis.call("PEXPIREAT", dimensionKeys[5], expiresAt, "NX")
  redis.call("PEXPIREAT", dimensionKeys[5], expiresAt, "GT")
  writeRecoveryHold(expiresAt, destinationWorkerKey, ownershipEpoch)
  return {"existing", tostring(expiresAt), tostring(ownershipEpoch)}
end
expiresAt = now + tonumber(ARGV[2])
ownershipEpoch = 1
redis.call(
  "HSET",
  KEYS[1],
  "state", "active",
  "expiresAt", expiresAt,
  "ownershipEpoch", ownershipEpoch
)
redis.call("PEXPIREAT", KEYS[1], expiresAt)
for index = 1, 5 do
  redis.call("ZADD", dimensionKeys[index], expiresAt, member)
  redis.call("PEXPIREAT", dimensionKeys[index], expiresAt, "NX")
  redis.call("PEXPIREAT", dimensionKeys[index], expiresAt, "GT")
end
writeRecoveryHold(expiresAt, destinationWorkerKey, ownershipEpoch)
return {"activated", tostring(expiresAt), tostring(ownershipEpoch)}
`;

const renewScript = `
local clock = redis.call("TIME")
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local member = ARGV[1]
if redis.call("EXISTS", KEYS[1]) == 0 then
  if #ARGV == 1 then
    redis.call("ZREM", KEYS[2], member)
    redis.call("ZREM", KEYS[3], member)
    redis.call("HDEL", KEYS[4], member)
  end
  return {"not_found"}
end
local dimensionKeys = {
  redis.call("HGET", KEYS[1], "globalKey"),
  redis.call("HGET", KEYS[1], "providerKey"),
  redis.call("HGET", KEYS[1], "tenantKey"),
  redis.call("HGET", KEYS[1], "runtimeKey"),
  redis.call("HGET", KEYS[1], "workerKey")
}
for index = 1, 5 do
  if dimensionKeys[index] == false then
    return {"not_found"}
  end
  redis.call("ZREMRANGEBYSCORE", dimensionKeys[index], "-inf", now)
end
local expiresAt = tonumber(redis.call("HGET", KEYS[1], "expiresAt"))
if expiresAt == nil or expiresAt <= now then
  redis.call("DEL", KEYS[1])
  for index = 1, 5 do
    redis.call("ZREM", dimensionKeys[index], member)
  end
  if #ARGV == 1 then
    redis.call("ZREM", KEYS[2], member)
    redis.call("ZREM", KEYS[3], member)
    redis.call("HDEL", KEYS[4], member)
  end
  return {"not_found"}
end
if redis.call("HGET", KEYS[1], "state") ~= "active" then
  return {"not_found"}
end
if dimensionKeys[5] ~= KEYS[2] then
  return {"not_owner"}
end
local ownershipEpoch = tonumber(redis.call("HGET", KEYS[1], "ownershipEpoch"))
if ownershipEpoch == nil or ownershipEpoch ~= tonumber(ARGV[3]) then
  return {"not_owner"}
end
expiresAt = now + tonumber(ARGV[2])
redis.call("HSET", KEYS[1], "expiresAt", expiresAt)
redis.call("PEXPIREAT", KEYS[1], expiresAt)
for index = 1, 5 do
  redis.call("ZADD", dimensionKeys[index], expiresAt, member)
  redis.call("PEXPIREAT", dimensionKeys[index], expiresAt, "NX")
  redis.call("PEXPIREAT", dimensionKeys[index], expiresAt, "GT")
end
local holdExpiresAt = expiresAt + tonumber(ARGV[2])
redis.call("ZADD", KEYS[3], expiresAt, member)
redis.call("ZADD", KEYS[4], holdExpiresAt, member)
redis.call("HSET", KEYS[5], member, KEYS[2] .. "|" .. tostring(ownershipEpoch))
for index = 3, 5 do
  redis.call("PEXPIREAT", KEYS[index], holdExpiresAt, "NX")
  redis.call("PEXPIREAT", KEYS[index], holdExpiresAt, "GT")
end
return {"renewed", tostring(expiresAt), tostring(ownershipEpoch)}
`;

const releaseScript = `
local clock = redis.call("TIME")
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local member = ARGV[1]
if redis.call("EXISTS", KEYS[1]) == 0 then
  if #ARGV == 1 then
    redis.call("ZREM", KEYS[2], member)
    redis.call("ZREM", KEYS[3], member)
    redis.call("HDEL", KEYS[4], member)
  end
  return {"not_found"}
end
local dimensionKeys = {
  redis.call("HGET", KEYS[1], "globalKey"),
  redis.call("HGET", KEYS[1], "providerKey"),
  redis.call("HGET", KEYS[1], "tenantKey"),
  redis.call("HGET", KEYS[1], "runtimeKey"),
  redis.call("HGET", KEYS[1], "workerKey")
}
for index = 1, 5 do
  if dimensionKeys[index] == false then
    return {"not_found"}
  end
  redis.call("ZREMRANGEBYSCORE", dimensionKeys[index], "-inf", now)
end
local expiresAt = tonumber(redis.call("HGET", KEYS[1], "expiresAt"))
if expiresAt == nil or expiresAt <= now then
  redis.call("DEL", KEYS[1])
  for index = 1, 5 do
    redis.call("ZREM", dimensionKeys[index], member)
  end
  if #ARGV == 1 then
    redis.call("ZREM", KEYS[2], member)
    redis.call("ZREM", KEYS[3], member)
    redis.call("HDEL", KEYS[4], member)
  end
  return {"not_found"}
end
if #ARGV == 3 then
  local ownershipEpoch = tonumber(redis.call("HGET", KEYS[1], "ownershipEpoch"))
  if redis.call("HGET", KEYS[1], "state") ~= "active"
    or dimensionKeys[5] ~= ARGV[2]
    or ownershipEpoch == nil
    or ownershipEpoch ~= tonumber(ARGV[3])
  then
    return {"not_owner"}
  end
end
redis.call("ZREM", KEYS[2], member)
redis.call("ZREM", KEYS[3], member)
redis.call("HDEL", KEYS[4], member)
redis.call("DEL", KEYS[1])
for index = 1, 5 do
  redis.call("ZREM", dimensionKeys[index], member)
end
return {"released"}
`;

const healthScript = `return "PONG"`;

export class RedisPstnCallAdmission implements PstnCallAdmission {
  private readonly keyPrefix: string;

  constructor(
    private readonly redis: PstnAdmissionRedisCommands,
    options: RedisPstnCallAdmissionOptions = {},
  ) {
    this.keyPrefix = normalizeKeyPrefix(options.keyPrefix);
  }

  async reserve(
    input: PstnCallAdmissionInput,
  ): Promise<PstnCallAdmissionReserveResult> {
    if (!isValidInput(input)) {
      return {
        outcome: "denied",
        reasonCode: "indeterminate_result",
      };
    }

    try {
      const response = await this.redis.eval(
        reserveScript,
        this.reserveKeys(input),
        [
          hashOpaque(input.reservationId),
          createScopeFingerprint(input),
          String(input.limits.global),
          String(input.limits.provider),
          String(input.limits.tenant),
          String(input.limits.runtime),
          String(input.limits.worker),
          String(input.cps.global.capacity),
          String(input.cps.global.refillPerSecond),
          String(input.cps.providerAccount.capacity),
          String(input.cps.providerAccount.refillPerSecond),
          String(input.claimTtlMs),
        ],
      );
      return parseReserveResponse(response);
    } catch (error) {
      if (error instanceof PstnAdmissionIndeterminateError) {
        return {
          outcome: "denied",
          reasonCode: "indeterminate_result",
        };
      }
      return {
        outcome: "denied",
        reasonCode: "backend_unavailable",
        limitingDimension: "backend",
      };
    }
  }

  async activate(
    input: PstnCallAdmissionActivationInput,
  ): Promise<PstnCallAdmissionActivateResult> {
    if (!isValidActivationInput(input)) {
      return { outcome: "not_found" };
    }

    try {
      const response = await this.redis.eval(
        activateScript,
        "limits" in input
          ? [
              this.reservationKey(input.reservationId),
              this.globalConcurrencyKey(),
              this.providerConcurrencyKey(input),
              this.tenantConcurrencyKey(input),
              this.runtimeConcurrencyKey(input),
              this.workerConcurrencyKey(input),
              this.recoveryHoldStartsKey(),
              this.recoveryHoldExpiresKey(),
              this.recoveryHoldOwnersKey(),
            ]
          : [
              this.reservationKey(input.reservationId),
              this.workerConcurrencyKey(input.workerId),
              this.recoveryHoldStartsKey(),
              this.recoveryHoldExpiresKey(),
              this.recoveryHoldOwnersKey(),
            ],
        "limits" in input
          ? [
              hashOpaque(input.reservationId),
              String(input.activeTtlMs),
              String(input.limits.global),
              String(input.limits.provider),
              String(input.limits.tenant),
              String(input.limits.runtime),
              String(input.limits.worker),
              createScopeFingerprint(input),
            ]
          : [
              hashOpaque(input.reservationId),
              String(input.activeTtlMs),
              String(input.workerLimit),
            ],
      );
      return parseActivateResponse(response);
    } catch {
      return { outcome: "backend_unavailable" };
    }
  }

  async renew(
    input: PstnCallAdmissionLeaseInput,
  ): Promise<PstnCallAdmissionRenewResult> {
    if (!isValidLeaseInput(input)) {
      return { outcome: "not_found" };
    }

    try {
      const response = await this.redis.eval(
        renewScript,
        [
          this.reservationKey(input.reservationId),
          this.workerConcurrencyKey(input.workerId),
          this.recoveryHoldStartsKey(),
          this.recoveryHoldExpiresKey(),
          this.recoveryHoldOwnersKey(),
        ],
        [
          hashOpaque(input.reservationId),
          String(input.activeTtlMs),
          String(input.ownershipEpoch),
        ],
      );
      return parseRenewResponse(response);
    } catch {
      return { outcome: "backend_unavailable" };
    }
  }

  async release(
    input: PstnCallAdmissionReleaseInput,
  ): Promise<PstnCallAdmissionReleaseResult> {
    if (!isValidReleaseInput(input)) {
      return { outcome: "not_found" };
    }

    try {
      const response = await this.redis.eval(
        releaseScript,
        [
          this.reservationKey(input.reservationId),
          this.recoveryHoldStartsKey(),
          this.recoveryHoldExpiresKey(),
          this.recoveryHoldOwnersKey(),
        ],
        "ownershipEpoch" in input
          ? [
              hashOpaque(input.reservationId),
              this.workerConcurrencyKey(input.workerId),
              String(input.ownershipEpoch),
            ]
          : [hashOpaque(input.reservationId)],
      );
      return parseReleaseResponse(response);
    } catch {
      return { outcome: "backend_unavailable" };
    }
  }

  async getHealth(): Promise<PstnCallAdmissionHealth> {
    try {
      const response = await this.redis.eval(healthScript, [], []);
      if (response === "PONG") {
        return {
          status: "healthy",
          backend: "redis",
        };
      }
      return {
        status: "unavailable",
        backend: "redis",
        reasonCode: "indeterminate_result",
      };
    } catch {
      return {
        status: "unavailable",
        backend: "redis",
        reasonCode: "backend_unavailable",
      };
    }
  }

  private reserveKeys(input: PstnCallAdmissionInput) {
    return [
      this.reservationKey(input),
      this.globalConcurrencyKey(),
      this.providerConcurrencyKey(input),
      this.tenantConcurrencyKey(input),
      this.runtimeConcurrencyKey(input),
      this.workerConcurrencyKey(input),
      this.globalCpsKey(),
      this.providerAccountCpsKey(input),
      this.recoveryHoldStartsKey(),
      this.recoveryHoldExpiresKey(),
      this.recoveryHoldOwnersKey(),
    ];
  }

  private reservationKey(input: PstnCallAdmissionInput | string) {
    const reservationId =
      typeof input === "string" ? input : input.reservationId;
    return `${this.keyRoot()}:reservation:${hashOpaque(reservationId)}`;
  }

  private globalConcurrencyKey() {
    return `${this.keyRoot()}:concurrency:global`;
  }

  private providerConcurrencyKey(input: PstnCallAdmissionInput) {
    return `${this.keyRoot()}:concurrency:provider:${hashOpaque(input.provider)}`;
  }

  private tenantConcurrencyKey(input: PstnCallAdmissionInput) {
    return `${this.keyRoot()}:concurrency:tenant:${hashOpaque(input.tenantId)}`;
  }

  private runtimeConcurrencyKey(input: PstnCallAdmissionInput) {
    return `${this.keyRoot()}:concurrency:runtime:${hashOpaque(input.runtime)}`;
  }

  private workerConcurrencyKey(input: PstnCallAdmissionInput | string) {
    const workerId = typeof input === "string" ? input : input.workerId;
    return `${this.keyRoot()}:concurrency:worker:${hashOpaque(workerId)}`;
  }

  private globalCpsKey() {
    return `${this.keyRoot()}:cps:global`;
  }

  private providerAccountCpsKey(input: PstnCallAdmissionInput) {
    return `${this.keyRoot()}:cps:account:${hashOpaque(
      JSON.stringify([input.provider, input.providerAccountId]),
    )}`;
  }

  private recoveryHoldStartsKey() {
    return `${this.keyRoot()}:recovery-hold:starts`;
  }

  private recoveryHoldExpiresKey() {
    return `${this.keyRoot()}:recovery-hold:expires`;
  }

  private recoveryHoldOwnersKey() {
    return `${this.keyRoot()}:recovery-hold:owners`;
  }

  private keyRoot() {
    return `${this.keyPrefix}:{pstn-admission}`;
  }
}

function parseReserveResponse(
  response: unknown,
): PstnCallAdmissionReserveResult {
  const values = readStringArray(response);
  if (
    values?.[0] === "admitted" &&
    (values[1] === "created" || values[1] === "existing")
  ) {
    const leaseExpiresAt = parseLeaseExpiry(values[2]);
    const limitingDimension = parseConcurrencyDimension(values[3]);
    const remainingCapacity = parseRemainingCapacity(values[4]);
    if (
      leaseExpiresAt !== undefined &&
      limitingDimension !== undefined &&
      remainingCapacity !== undefined
    ) {
      return {
        outcome: "admitted",
        disposition: values[1],
        leaseExpiresAt,
        limitingDimension,
        remainingCapacity,
      };
    }
  }
  if (values?.[0] === "denied" && isReasonCode(values[1])) {
    const limitingDimension = denialDimensions[values[1]];
    const remainingCapacity = parseRemainingCapacity(values[2]);
    return limitingDimension === undefined
      ? {
          outcome: "denied",
          reasonCode: values[1],
        }
      : {
          outcome: "denied",
          reasonCode: values[1],
          limitingDimension,
          ...(limitingDimension.endsWith("_concurrency") &&
          remainingCapacity !== undefined
            ? { remainingCapacity }
            : {}),
        };
  }
  return {
    outcome: "denied",
    reasonCode: "indeterminate_result",
  };
}

function parseActivateResponse(
  response: unknown,
): PstnCallAdmissionActivateResult {
  const values = readStringArray(response);
  if (values?.[0] === "not_found") {
    return { outcome: "not_found" };
  }
  if (values?.[0] === "not_owner") {
    return { outcome: "not_owner" };
  }
  if (
    values?.[0] === "denied" &&
    isConcurrencyReasonCode(values[1])
  ) {
    return {
      outcome: "denied",
      reasonCode: values[1],
    };
  }
  if (values?.[0] === "activated" || values?.[0] === "existing") {
    const leaseExpiresAt = parseLeaseExpiry(values[1]);
    const ownershipEpoch = parseOwnershipEpoch(values[2]);
    if (leaseExpiresAt !== undefined && ownershipEpoch !== undefined) {
      return {
        outcome: values[0],
        leaseExpiresAt,
        ownershipEpoch,
      };
    }
  }
  return { outcome: "not_found" };
}

function parseRenewResponse(
  response: unknown,
): PstnCallAdmissionRenewResult {
  const values = readStringArray(response);
  if (values?.[0] === "not_owner") {
    return { outcome: "not_owner" };
  }
  if (values?.[0] === "renewed") {
    const leaseExpiresAt = parseLeaseExpiry(values[1]);
    const ownershipEpoch = parseOwnershipEpoch(values[2]);
    if (leaseExpiresAt !== undefined && ownershipEpoch !== undefined) {
      return {
        outcome: "renewed",
        leaseExpiresAt,
        ownershipEpoch,
      };
    }
  }
  return { outcome: "not_found" };
}

function parseReleaseResponse(
  response: unknown,
): PstnCallAdmissionReleaseResult {
  const values = readStringArray(response);
  return {
    outcome:
      values?.[0] === "released"
        ? "released"
        : values?.[0] === "not_owner"
          ? "not_owner"
          : "not_found",
  };
}

function readStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function parseLeaseExpiry(value: string | undefined) {
  if (value === undefined || !/^\d{1,16}$/.test(value)) {
    return undefined;
  }
  const timestampMs = Number(value);
  if (!Number.isSafeInteger(timestampMs) || timestampMs <= 0) {
    return undefined;
  }
  try {
    return new Date(timestampMs).toISOString();
  } catch {
    return undefined;
  }
}

function isReasonCode(value: string | undefined): value is PstnAdmissionReasonCode {
  return value !== undefined && Object.hasOwn(denialDimensions, value);
}

function isConcurrencyReasonCode(
  value: string | undefined,
): value is Exclude<
  PstnAdmissionReasonCode,
  | "global_cps_limit"
  | "provider_account_cps_limit"
  | "backend_unavailable"
  | "indeterminate_result"
> {
  return isReasonCode(value) && value.endsWith("_concurrency_limit");
}

function parseConcurrencyDimension(
  value: string | undefined,
): Exclude<
  PstnAdmissionLimitingDimension,
  "global_cps" | "provider_account_cps" | "backend"
> | undefined {
  return value !== undefined &&
    value.endsWith("_concurrency") &&
    Object.values(denialDimensions).includes(
      value as PstnAdmissionLimitingDimension,
    )
    ? (value as Exclude<
        PstnAdmissionLimitingDimension,
        "global_cps" | "provider_account_cps" | "backend"
      >)
    : undefined;
}

function parseRemainingCapacity(value: string | undefined) {
  if (value === undefined || !/^\d{1,7}$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parseOwnershipEpoch(value: string | undefined) {
  if (value === undefined || !/^\d{1,16}$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function createScopeFingerprint(input: PstnCallAdmissionInput) {
  return hashOpaque(
    JSON.stringify([
      input.callSessionId,
      input.tenantId,
      input.providerAccountId,
      input.provider,
      input.runtime,
    ]),
  );
}

function hashOpaque(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeKeyPrefix(value: string | undefined) {
  const normalized = value?.trim();
  return normalized !== undefined &&
    /^[A-Za-z0-9:_-]{1,64}$/.test(normalized)
    ? normalized
    : "zara";
}

function isValidInput(input: PstnCallAdmissionInput) {
  try {
    assertPstnCallAdmissionInput(input);
    return true;
  } catch {
    return false;
  }
}

function isValidActivationInput(input: PstnCallAdmissionActivationInput) {
  try {
    assertPstnCallAdmissionActivationInput(input);
    return true;
  } catch {
    return false;
  }
}

function isValidLeaseInput(input: PstnCallAdmissionLeaseInput) {
  try {
    assertPstnCallAdmissionLeaseInput(input);
    return true;
  } catch {
    return false;
  }
}

function isValidReleaseInput(input: PstnCallAdmissionReleaseInput) {
  try {
    assertPstnCallAdmissionReleaseInput(input);
    return true;
  } catch {
    return false;
  }
}
