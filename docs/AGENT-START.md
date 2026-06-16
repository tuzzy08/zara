# Agent Start

Use this page as the first stop before working in Zara. It keeps startup small, then sends you to the exact context your task needs.

## Start Sequence

1. Confirm the repository rules in `AGENTS.md` if you have not already read them in this pass.
2. Read `docs/CONTEXT-MAP.md` to choose the smallest relevant documentation set.
3. Read the global baseline docs listed in the context map when doing implementation or issue work.
4. Read only the domain docs that match the task area.
5. For issue work, read the matching active handover in `docs/Handovers/` and keep it updated.
6. For production code, follow RED/GREEN/REFACTOR: write a failing test, make it pass, then refactor while green.

## Before Editing

- Confirm whether the work is issue work, docs-only work, or exploratory review.
- Check the working tree and do not revert edits made by others.
- If the task touches UI, read `DESIGN.md` before changing UI text, layout, or components.
- If the task touches STT, TTS, voice runtime, turn detection, barge-in, interruptions, voice selection, or voice cloning, read the provider docs routed in `docs/CONTEXT-MAP.md` before designing or coding.
- If a new local issue is needed, create or link the external tracker issue first; do not add repo-local issues silently.

## Completion Check

- Run the focused validation that matches the change.
- Update the issue handover and status records when the work is an issue pass.
- For docs-only routing changes, do not update backlog or roadmap unless the user explicitly asks.
