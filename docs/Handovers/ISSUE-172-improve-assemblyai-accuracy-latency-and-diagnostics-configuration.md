# ISSUE-172: Improve AssemblyAI accuracy, latency, and diagnostics configuration

Status: Implemented
External: [Linear ZAR-142](https://linear.app/zara-voice/issue/ZAR-142/issue-172-improve-assemblyai-accuracy-latency-and-diagnostics)

## Goal

Use the AssemblyAI capabilities already documented in `docs/assemblyAI` to improve accuracy, latency, and observability.

## Work Completed

- Created the Linear issue and local backlog entry.
- Started implementation pass on 2026-06-11.
- Moved Linear ZAR-142, local backlog, and this handover to In Progress.
- Added server-owned AssemblyAI U3 Pro connection config for language, keyterms, prompt/context, turn silence, and continuous partials.
- Added `UpdateConfiguration` message support and provider wiring.
- Generated safe STT keyterms from manifest workflow, role, business, tool, integration, and tool-assignment labels.
- Updated STT `agent_context` after each successful agent response.
- Added diagnostics for AssemblyAI `3007`, `3008`, auth, timeout, interruption, and unknown close paths.
- Added telemetry distinctions for partials, finals, forced endpoints, provider close, and termination.
- Extended runtime provider failure codes with `rate_limited` and `permission_denied` so diagnostics can remain specific.
- Moved Linear ZAR-142, local backlog, and this handover to Implemented.

## Tests Run

- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/assemblyai-streaming.adapter.test.ts apps/api/src/sandbox-live-sessions/assemblyai-stt.provider.test.ts --pool=threads`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts --testNamePattern "configures AssemblyAI" --pool=threads`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/assemblyai-streaming.adapter.test.ts apps/api/src/sandbox-live-sessions/assemblyai-stt.provider.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts --pool=threads`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/assemblyai-streaming.adapter.test.ts apps/api/src/sandbox-live-sessions/assemblyai-stt.provider.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts packages/core/src/runtime.test.ts --pool=threads`
- `npm.cmd run typecheck --workspace @zara/core`
- `npm.cmd run build --workspace @zara/core`
- `npm.cmd run typecheck --workspace @zara/api`
- `npm.cmd run lint`

## Pending Work

- None for ISSUE-172 acceptance criteria.

## Risks And Edge Cases

- Context and keyterm prompts can leak sensitive labels if generated from raw provider payloads.
- Provider timeout and expiry close codes must explain the operational fix without exposing provider credentials.
- Tenant UI must not expose protocol fields or API endpoints as configuration.
- Keyterm generation intentionally uses labels and identifiers only; raw provider payloads, secrets, and transcript text are not promoted into keyterms.

## Decisions

- Keep settings server-owned/internal for v1.
- Use current AssemblyAI U3 Pro as default STT.
- Balanced browser-agent defaults use `min_turn_silence=224`, `max_turn_silence=1536`, and `continuous_partials=true`.

## Next Recommended Step

Proceed to ISSUE-173: experimental Cartesia Ink 2 STT provider.
