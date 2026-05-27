# ISSUE-135: Discretionary agent toolbelt and structured tool results

Status: Pending
Date: 2026-05-26
External: [Linear ZAR-68](https://linear.app/zara-voice/issue/ZAR-68/issue-135-discretionary-agent-toolbelt-and-structured-tool-results)

## Work Completed

- Created the implementation issue in `docs/Issue-Backlog.md`.
- Added tool-capability and structured result standards in `docs/Agent-Tool-And-Transfer-Standard.md`.
- Linked the target tool model from architecture, manifest, feature-flow, roadmap, and testing docs.

## Tests Run

- Not run. This pass created documentation and backlog records only.

## Pending Work

- Add failing manifest/compiler tests proving tools compile as agent capabilities instead of mandatory frontier steps.
- Add failing prompt/provider tests for agent `respond` versus `call_tool` action output.
- Implement runtime validation for assigned tool IDs, input schemas, grants, approvals, credentials, idempotency, and per-turn call limits.
- Preserve structured tool results on the turn packet and pass only redacted safe output to the model.

## Risks

- Existing builder tests and user expectations may assume visual tool nodes are graph steps.
- Tool-loop handling must avoid hanging live calls.
- Full tool output can be sensitive and must not flow directly into model prompts or event replay.

## Decisions

- Tools are agent capabilities used at the agent's discretion.
- Assigned tools may be unused for an entire call.
- Tool results return to the same agent as structured context.

## Next Recommended Step

- Start with RED compiler and live-session tests showing assigned-but-unused tools do not execute automatically.
