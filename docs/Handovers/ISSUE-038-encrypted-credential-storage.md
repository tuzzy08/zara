# ISSUE-038: Encrypted credential storage

Issue link: https://github.com/tuzzy08/zara/issues/38

## Goal

Deliver Encrypted credential storage for the Security area in the Integrations milestone.

## Acceptance Criteria

- Tokens and provider secrets are encrypted at rest
- Key version metadata is stored
- No raw secrets are returned from APIs

## Work Completed

- Added `TelephonySecretVault` with AES-256-GCM envelopes for provider secret material.
- Stored key version metadata on encrypted telephony credential envelopes.
- Kept telephony APIs on masked credential references only and continued to avoid returning raw provider secrets.
- Wired encrypted-at-rest secret persistence into the telephony durability layer so Twilio auth tokens survive restart without being stored in plaintext.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/telephony/telephony.persistence.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/telephony/telephony.persistence.test.ts`
- Verification: `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts`
- Verification: `npm.cmd run typecheck`
- Verification: `npm.cmd run lint`
- Verification: `npm.cmd run build`

## Pending Work

- Generalize the encrypted credential path for integrations and future non-telephony providers.
- Add explicit key rotation and re-encryption workflows in ISSUE-067.
- Move durable encrypted secret storage into the broader system-of-record persistence model when Postgres-backed repositories are introduced.

## Risks And Edge Cases

- Key rotation
- Decrypt failure

## Decisions

- Priority: P0
- Labels: security, integrations, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Used a dedicated telephony secret vault in the API layer so browser/shared packages do not need Node crypto.
- Stored key version metadata now, while leaving full rotation orchestration to ISSUE-067.

## Next Recommended Step

Use the same encrypted credential contract for upcoming integration connectors, then add rotation and migration support in ISSUE-067.
