# ISSUE-067: Secrets encryption and key rotation metadata

Issue link: https://github.com/tuzzy08/zara/issues/67

## Goal

Deliver Secrets encryption and key rotation metadata for the Security area in the Production milestone.

## Acceptance Criteria

- Secret blobs include key version
- Rotation plan is documented
- Decrypt failures are safe

## Work Completed

- Encrypted provider secrets at rest with envelope metadata carrying the active key version.
- Added restart-safe credential hydration so undecryptable envelopes degrade connections safely instead of crashing telephony state load.
- Implemented credential rotation that reseals stored provider envelopes to the active key version.
- Added support for legacy key lookup during restart and rotation recovery.
- Added environment parsing for `TELEPHONY_CREDENTIAL_LEGACY_KEYS`.

## Tests Run

- RED/GREEN: `npm.cmd run test:run -- apps/api/src/telephony/telephony.persistence.test.ts`
- RED/GREEN: `npm.cmd run test:run -- apps/api/src/telephony/telephony-env.test.ts`
- Verification: `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts`
- Verification: `npm.cmd run typecheck`
- Verification: `npm.cmd run lint`
- Verification: `npm.cmd run build`

## Pending Work

- Integrate external KMS or secrets-manager rotation policy once the control plane leaves local-development key derivation.
- Add migration orchestration for future repository changes beyond the current local snapshot adapter.

## Risks And Edge Cases

- Old key unavailable on restart
- Partial rotation across mixed deployments
- Operator rotates the key version before supplying the legacy mapping

## Decisions

- Priority: P0
- Labels: security, devops, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Safe failure beats hard failure: telephony connections degrade and expose an actionable health message when envelopes cannot be decrypted.
- Rotation reuses the persisted telephony state contract instead of inventing a parallel secret-migration format.

## Next Recommended Step

Keep the current envelope format stable and move the key source from app config to managed secrets infrastructure when production deployment work begins.
