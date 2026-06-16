# ISSUE-174: Add tenant voice library, voice tuning, and Cartesia voice cloning

Status: Implemented
External: [Linear ZAR-144](https://linear.app/zara-voice/issue/ZAR-144/issue-174-add-tenant-voice-library-voice-tuning-and-cartesia-voice)

## Goal

Let tenants configure agent voices safely without exposing raw provider plumbing.

## Work Completed

- Created the Linear issue and local backlog entry.
- Started implementation pass on 2026-06-11.
- Moved Linear ZAR-144, local backlog, and this handover to In Progress.
- Added shared `AgentVoiceConfig` contracts for Cartesia voices with voice ID, label, source type, clone status, speed, volume, and emotion.
- Preserved approved voice config through workflow cloning, publish snapshots, and runtime manifest compilation.
- Added publish-blocking validation for cloned voices that are not approved, including disabled/deleted clone statuses.
- Threaded active-role voice config into browser and PSTN sandwich TTS synthesis inputs while keeping runtime profile voice defaults as fallback.
- Updated Cartesia TTS request shaping so selected voice and `generation_config` are sent to Sonic 3.5.
- Added a server-owned voice-library API module with safe Cartesia catalog metadata, voice preview request creation, owner/admin-only clone request and approval flows, source audio reference requirement, consent confirmation, and compliance audit logging.
- Added compact builder/sandbox display of the selected voice label when a role has voice config.
- Added server-side runtime voice ID resolution so published role config can store safe library voice IDs while Cartesia receives provider voice IDs only inside NestJS.
- Added cloned-voice disable/delete backend lifecycle actions with audit logging and runtime-use blocking.
- Added a tenant-facing agent-inspector voice picker that loads safe voice-library metadata, disables pending/disabled/deleted voices, supports speed/volume/emotion tuning, calls the preview endpoint, and applies approved Cartesia voices to `role.voiceConfig`.
- Added file-backed source-audio upload storage for clone requests with owner/admin authorization, audio content validation, size limits, `voice-upload://` references, and audit logging.
- Wired voice preview to server-side Cartesia preview synthesis when `CARTESIA_API_KEY` is configured, returning browser-playable WAV audio metadata while preserving a safe unavailable fallback.
- Added tenant-builder clone controls for owner/admin users to upload source audio, confirm consent, request clones, approve server-created Cartesia clones, disable clones, and delete clones.
- Plumbed the active tenant role into the workflow builder so clone administration uses owner/admin credentials and builders can still preview/apply approved voices.
- Closed the implementation agent after review and corrected the hardcoded frontend role boundary before completion.
- Refined the agent inspector into collapsible Personal details, Voice, and Model config sections to reduce inspector length.
- Replaced the previous two placeholder catalog voices with the five supplied Cartesia voice IDs exposed as safe labels only: Male 1, Male 2, Female 1, Female 2, and Female 3.
- Changed voice selection and tuning controls to update the selected agent immediately; removed the Apply voice button.
- Changed the preview action to a green Play button and aligned emotion values to Cartesia's documented `generation_config.emotion` enum.
- Aligned Cartesia WebSocket auth with the TTS WebSocket docs by using the `X-API-Key` header and `cartesia_version` query parameter, with Sonic 3.5 as the default model.
- Replaced manual provider voice ID approval with server-owned Cartesia `/voices/clone` multipart cloning during approval; the returned Cartesia voice ID is stored server-side only.
- Follow-up on 2026-06-11: updated Cartesia runtime fallback voice IDs so built-in `economy`, `neural-hd`, and `expressive` profiles use the approved supplied Cartesia voices instead of the older hardcoded provider ID.
- Follow-up on 2026-06-15: updated the tenant workflow builder voice inspector so roles resolving to `premium-realtime` show provider-native OpenAI Realtime or Gemini Live voice options instead of Cartesia voice library, preview, and clone controls. Provider-native selections persist through the separate `realtimeVoiceConfig` role field rather than the Cartesia-only `voiceConfig` field.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/workflow.test.ts packages/core/src/runtime.test.ts apps/api/src/sandbox-live-sessions/cartesia-streaming.adapter.test.ts apps/api/src/sandbox-live-sessions/cartesia-tts.provider.test.ts apps/api/src/voice-library/voice-library.service.test.ts --pool=threads`
- `npm.cmd run typecheck --workspace @zara/core`
- `npm.cmd run build --workspace @zara/core`
- `npm.cmd run typecheck --workspace @zara/api`
- `npm.cmd run typecheck --workspace @zara/web`
- `npm.cmd run test:run -- packages/core/src/workflow.test.ts packages/core/src/runtime.test.ts packages/core/src/pstn-sandwich-runtime.test.ts apps/api/src/sandbox-live-sessions/cartesia-streaming.adapter.test.ts apps/api/src/sandbox-live-sessions/cartesia-tts.provider.test.ts apps/api/src/voice-library/voice-library.service.test.ts apps/api/src/app.module.test.ts --pool=threads`
- `npm.cmd run lint`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/cartesia-tts.provider.test.ts apps/api/src/voice-library/voice-library.service.test.ts --pool=threads`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "lets builders preview and apply approved Cartesia voices from the agent inspector" --pool=forks`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "lets admins request and manage cloned voices from the agent inspector" --pool=forks`
- `npm.cmd run test:run -- apps/api/src/voice-library/voice-library.service.test.ts --pool=threads`
- `npm.cmd run test:run -- apps/api/src/voice-library/voice-library.service.test.ts apps/api/src/sandbox-live-sessions/cartesia-tts.provider.test.ts --pool=threads`
- `npm.cmd run test:run -- packages/core/src/workflow.test.ts packages/core/src/runtime.test.ts packages/core/src/pstn-sandwich-runtime.test.ts apps/api/src/sandbox-live-sessions/cartesia-streaming.adapter.test.ts apps/api/src/sandbox-live-sessions/cartesia-tts.provider.test.ts apps/api/src/voice-library/voice-library.service.test.ts apps/api/src/app.module.test.ts --pool=threads`
- `npm.cmd run typecheck --workspace @zara/core`
- `npm.cmd run typecheck --workspace @zara/api`
- `npm.cmd run typecheck --workspace @zara/web`
- `npm.cmd run lint`
- `npm.cmd run test:run -- apps/api/src/voice-library/voice-library.service.test.ts --pool=threads`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/cartesia-streaming.adapter.test.ts --pool=threads`
- `npm.cmd run test:run -- apps/api/src/voice-library/voice-library.service.test.ts apps/api/src/sandbox-live-sessions/cartesia-streaming.adapter.test.ts apps/api/src/sandbox-live-sessions/cartesia-tts.provider.test.ts --pool=threads`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "lets builders preview and select approved Cartesia voices from the agent inspector|lets admins request and manage cloned voices from the agent inspector" --pool=forks`
- `npm.cmd run test:run -- apps/api/src/app.module.test.ts --pool=threads`
- Follow-up on 2026-06-11: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/cartesia-tts.provider.test.ts apps/api/src/sandbox-live-sessions/sandbox-text-model-router.provider.test.ts`
- Follow-up on 2026-06-11: `npm.cmd run typecheck --workspace @zara/api`
- Follow-up on 2026-06-11: `npm.cmd run lint`
- Follow-up on 2026-06-15: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "shows provider-native voices instead of Cartesia controls for premium realtime agents" --pool=forks`
- Follow-up on 2026-06-15: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "lets builders preview and select approved Cartesia voices from the agent inspector" --pool=forks`
- Follow-up on 2026-06-15: `npm.cmd run typecheck --workspace @zara/web`
- Follow-up on 2026-06-15: `npm.cmd run test:run -- packages/core/src/workflow.test.ts apps/api/src/runtime-sessions/premium-realtime-provider-transport.test.ts apps/api/src/sandbox-live-sessions/gemini-live-realtime.adapter.test.ts`

## Pending Work

- None for ISSUE-174 acceptance criteria.
- Linear ZAR-144 still needs status sync if the Linear issue-update tool is available; a completion comment has been posted from this pass.

## Risks And Edge Cases

- Voice cloning has consent and impersonation risk and must be owner/admin-only.
- Disabled or deleted cloned voices must block publish and sandbox use.
- Runtime profile voice defaults must remain available when no custom voice is selected.
- Built-in voice-profile fallbacks must be kept in sync with approved provider voice IDs; otherwise a workflow with no custom voice can fail during TTS.
- Provider-native realtime voices must not be stored in `voiceConfig` while that contract remains Cartesia-specific, or sandwich TTS could receive an incompatible voice payload after a runtime-profile change.

## Decisions

- Store provider voice IDs server-side; frontend receives safe metadata only.
- Start with Cartesia voices only; do not build a generic voice marketplace yet.
- OpenAI Realtime and Gemini Live voice controls are provider-native surfaces for premium realtime roles and should stay separate from the Cartesia library/clone controls used by sandwich TTS.

## Next Recommended Step

Move to the next implementation issue after Linear status reconciliation.
