# ISSUE-239: Modularize oversized runtime and telephony suites

External: [Linear ZAR-243](https://linear.app/zara-voice/issue/ZAR-243/modularize-oversized-runtime-and-telephony-suites)

Status: Pending

## Work completed

- Ticket published with ISSUE-233 as its blocker.

## Tests run

- None; planning pass only.

## Pending work

- Split runtime and telephony suites by public contract and qualify preserved ordinary/eval behavior.

## Risks

- Ordering, media, interruption, replay, terminal-state, security, and redaction cases must remain explicit.

## Decisions

- Runtime and PSTN eval lanes remain separate and high-value coverage is not removed for count reduction.

## Next recommended step

- Begin after ISSUE-233 captures authoritative runtime and telephony baseline evidence.
