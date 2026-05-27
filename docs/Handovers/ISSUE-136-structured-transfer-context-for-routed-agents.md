# ISSUE-136: Structured transfer context for routed agents

Status: Pending
Date: 2026-05-26
External: [Linear ZAR-69](https://linear.app/zara-voice/issue/ZAR-69/issue-136-structured-transfer-context-for-routed-agents)

## Work Completed

- Created the implementation issue in `docs/Issue-Backlog.md`.
- Added transfer context standards in `docs/Agent-Tool-And-Transfer-Standard.md`.
- Linked transfer standardization from architecture, manifest, feature-flow, roadmap, and testing docs.

## Tests Run

- Not run. This pass created documentation and backlog records only.

## Pending Work

- Add failing transfer-context tests for handoff routes, direct agent-to-agent routes, and intent-to-handoff routes.
- Include source, target, reason, caller need summary, matched intent, and recent safe tool results in the model-facing target-agent prompt.
- Emit transfer events from packet facts with source/target IDs, turn ID, and sequence.
- Update monitoring/replay surfaces to show structured transfer context safely.

## Risks

- Direct agent-to-agent routes do not currently have a user-authored handoff reason.
- Transfer loops can be introduced by otherwise valid graph relationships.
- Transfer context is advisory and must not override target-agent policy.

## Decisions

- Routed-to agents must always be aware of why they received the caller.
- Handoff nodes provide explicit transfer reasons.
- Direct agent-to-agent routes receive generated route context if no handoff node exists.

## Next Recommended Step

- Start with RED prompt and router tests proving a target agent receives structured transfer context before responding.
