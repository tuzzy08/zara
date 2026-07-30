# ISSUE-236: Contract operational and platform-admin UI coverage

External: [Linear ZAR-240](https://linear.app/zara-voice/issue/ZAR-240/contract-operational-and-platform-admin-ui-coverage)

Status: Pending

## Work completed

- Ticket published with ISSUE-233 as its blocker.

## Tests run

- None; planning pass only.

## Pending work

- Contract tenant-agent, telephony, and platform-admin DOM coverage while preserving critical journeys and pure payload logic.

## Risks

- Staff authorization and protected phone-test behavior require authoritative backend coverage before UI assertions are removed.

## Decisions

- Keep staff access and operational critical-flow smoke coverage only.

## Next recommended step

- Begin after ISSUE-233 establishes the baseline and UI-smoke lane.
