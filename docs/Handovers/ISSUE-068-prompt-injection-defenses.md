# ISSUE-068: Prompt injection defenses

Issue link: https://github.com/tuzzy08/zara/issues/68

## Goal

Deliver Prompt injection defenses for the Security area in the Production milestone.

## Acceptance Criteria

- Tool outputs and knowledge are treated as untrusted
- System instructions are separated from retrieved content
- Tests cover malicious content

## Work Completed

- Added runtime untrusted-context support to the shared sandwich runtime model.
- OpenAI chat prompt assembly now keeps system instructions in the system message and places tool output, memory, tenant knowledge, CRM notes, and website content in a separate user message wrapped as untrusted data.
- System prompts now explicitly instruct the model never to treat untrusted retrieved content as instructions.
- Live sandbox turns pass recent session memory and completed tool summaries into the runtime as untrusted context instead of blending them into role instructions.
- Added malicious content coverage for tool output and imported knowledge attempting to override system/consent policy.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/openai-chat-text.provider.test.ts` failed because the system prompt did not include untrusted-content defenses and malicious content was not separated.
- GREEN/REFACTOR:
  - `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/openai-chat-text.provider.test.ts`
  - `npm.cmd run typecheck`

## Pending Work

- None for ISSUE-068.

## Risks And Edge Cases

- CRM note injection
- Website ingestion attack

## Decisions

- Priority: P1
- Labels: security, runtime, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Untrusted context is represented as structured runtime data, not appended to role instructions.
- The live sandbox currently feeds recent session memory and completed tool summaries into this lane; durable tenant knowledge/CRM retrieval can use the same `RuntimeUntrustedContextItem` contract when connected to live model turns.

## Next Recommended Step

ISSUE-068 is complete. Future retrieval integrations should pass all external content through `untrustedContext`.
