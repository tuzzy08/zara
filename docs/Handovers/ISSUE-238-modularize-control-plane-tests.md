# ISSUE-238: Modularize oversized API, memory, and integration suites

External: [Linear ZAR-242](https://linear.app/zara-voice/issue/ZAR-242/modularize-oversized-api-memory-and-integration-suites)

Status: Pending

## Work completed

- Ticket published with ISSUE-233 as its blocker.

## Tests run

- None; planning pass only.

## Pending work

- Split control-plane suites by public capability and qualify preserved behavior.

## Risks

- Mechanical file splitting can accidentally alter fixture isolation or omit security and tenant-isolation cases.

## Decisions

- Preserve backend behavior and aggregate assertions; optimize organization rather than test count.

## Next recommended step

- Begin after ISSUE-233 captures authoritative control-plane baseline evidence.
