# ISSUE-159: Provider contract tests and runtime side-effect safety

Status: Pending
External: [Linear ZAR-113](https://linear.app/zara-voice/issue/ZAR-113/issue-159-provider-contract-tests-and-runtime-side-effect-safety)

## Goal

Add provider contract tests, structured runtime failure outcomes, and write side-effect safety before expanding providers.

## Work Completed

- Created the Linear issue and local backlog entry.
- Recorded dependency on ISSUE-157.

## Tests Run

- Not run; issue creation and planning only.

## Pending Work

- Build mocked provider contract tests for built-in tools.
- Add structured failure classification for runtime and post-call sync.
- Add side-effect ledger and provider idempotency-key support where available.

## Risks And Edge Cases

- Post-send timeouts must become unknown, not automatically retried failures.
- Post-call sync must consult live-call side effects to avoid duplicates.
- Provider error payloads and traces must be redacted.

## Decisions

- Ordinary CI should use mocked contract tests; live provider smoke tests are optional and credential-gated.
- Built-in provider tools expose curated Zara business actions, not raw provider operations.

## Next Recommended Step

Start with a failing mocked contract test for one existing Zendesk tool and one write side-effect timeout case.

