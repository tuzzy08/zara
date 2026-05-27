# ISSUE-133: Turn runtime packet v1

Status: Pending
Date: 2026-05-26

## Work Completed

- Created the implementation issue in `docs/Issue-Backlog.md`.
- Added the target packet standard in `docs/Turn-Runtime-Packet-v1.md`.
- Linked the runtime orchestration standard from architecture, manifest, feature-flow, roadmap, and testing docs.

## Tests Run

- Not run. This pass created documentation and backlog records only.

## Pending Work

- Add failing core packet tests for creation, reducer updates, model-facing projection, size bounds, and redaction behavior.
- Implement shared packet types and packet update helpers in the core/runtime boundary.
- Wire live sandbox routing to create packet-backed events while preserving public session APIs.
- Update relevant architecture docs after implementation details settle.

## Risks

- Existing live-session event consumers rely on current event shapes, so packet-backed events must remain backward-compatible or be versioned.
- Packet projection could accidentally leak full tool output or sensitive transcript without explicit redaction tests.
- Provider callback ordering can make sequence handling subtle.

## Decisions

- Packet scope is one caller turn, not the entire call.
- Events are telemetry derived from packet facts; the packet is the decision state.
- Agents receive a safe projection rather than raw packet state.

## Next Recommended Step

- Start with RED tests in shared runtime/core for packet creation and projection, then wire the live sandbox router behind those tests.
