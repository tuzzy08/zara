# ISSUE-065: Call consent and recording notices

External: [GitHub #65](https://github.com/tuzzy08/zara/issues/65)

Issue link: https://github.com/tuzzy08/zara/issues/65

## Goal

Deliver Call consent and recording notices for the Compliance area in the Production milestone.

## Acceptance Criteria

- Consent policy can be configured
- Notices play before recording where required
- Consent state is recorded

## Work Completed

- Extended telephony dispatch records with `recordingConsent` state.
- Extended execution sessions with recorded consent state.
- Two-party recording policies now queue `telephony.recording.play-notice` before the provider bridge/origination command.
- Single-party recording policies record `not_required`; disabled recording policies record `recording_disabled`.
- Existing configurable recording policies on connections and number routes now drive notice behavior.
- Updated existing telephony tests to assert notice-before-bridge ordering.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/compliance/compliance.controller.test.ts` failed before the compliance/consent implementation existed.
- GREEN/REFACTOR:
  - `npm.cmd run test:run -- apps/api/src/compliance/compliance.controller.test.ts`
  - `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts`
  - `npm.cmd run test:run -- packages/core/src/telephony.test.ts`
  - `npm.cmd run typecheck`
  - `npm.cmd run test:run -- --maxWorkers=1 --no-file-parallelism`
  - `npm.cmd run lint`

## Pending Work

- None for ISSUE-065.

## Risks And Edge Cases

- Region unknown
- Caller opts out

## Decisions

- Priority: P0
- Labels: compliance, telephony, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Unknown or two-party consent regions are handled through two-party recording policy configuration, which queues the notice before bridge commands.
- Caller opt-out maps to disabled recording policy for the dispatch/session state.

## Next Recommended Step

ISSUE-065 is complete. Future regional consent automation can build on the recorded `recordingConsent` state.
