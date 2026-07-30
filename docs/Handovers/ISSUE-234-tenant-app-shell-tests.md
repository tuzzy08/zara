# ISSUE-234: Contract the tenant application shell suite

External: [Linear ZAR-238](https://linear.app/zara-voice/issue/ZAR-238/contract-the-tenant-application-shell-suite)

Status: Pending

## Work completed

- Ticket published with ISSUE-233 as its blocker.

## Tests run

- None; planning pass only.

## Pending work

- Preserve approved shell journeys, confirm lower-seam coverage, and remove the monolithic mock backend and redundant DOM assertions.

## Risks

- Authentication and tenant-context behavior must not lose authoritative coverage.

## Decisions

- Retain only critical application-shell smoke flows and user-visible outcomes.

## Next recommended step

- Begin after ISSUE-233 establishes the baseline and UI-smoke lane.
