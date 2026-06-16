# Context Map

This map routes agents to the smallest useful documentation set. Read `AGENTS.md` and `docs/AGENT-START.md` first, then follow the rows that match the task.

## Global Baseline

Read these for implementation or issue work:

- `docs/PRD.md`
- `docs/Architecture.md`
- `docs/Frontend-Architecture.md`
- `docs/Roadmap.md`
- `docs/Issue-Backlog.md`
- the active issue handover in `docs/Handovers/`

For docs-only cleanup that does not change product behavior, read enough of the baseline to preserve rules and avoid updating backlog or roadmap unless explicitly requested.

## Task Routing

| Task area | Required docs |
| --- | --- |
| API, controllers, service contracts | `docs/API.md`, `docs/Data-Model.md`, `docs/Testing-Strategy.md` |
| Auth, organizations, workspaces, tenant context | `docs/API.md`, `docs/Data-Model.md`, `docs/Security-Compliance.md`, `docs/Frontend-Architecture.md` |
| Frontend tenant app or platform UI | `DESIGN.md`, `docs/Frontend-Architecture.md`, and the relevant domain doc below |
| Workflow builder, manifests, publishing, validation | `docs/Runtime-Manifests.md`, `docs/Feature-Flows.md`, `docs/API.md` |
| Runtime sessions, model routing, sandbox execution | `docs/Runtime-Manifests.md`, `docs/Runtime-Orchestration-Edge-Cases-And-Policies.md`, `docs/Turn-Runtime-Packet-v1.md`, `docs/Intent-Routing-Standard.md`, `docs/Agent-Tool-And-Transfer-Standard.md`, `docs/Observability-And-Evals-Standard.md` |
| PSTN, Twilio, calls, live phone tests, telephony UI | `docs/Telephony.md`, `docs/PSTN-Live-Call-Runtime-Standard.md`, `docs/API.md`, `docs/Security-Compliance.md` |
| STT, TTS, voice runtime, turn detection, barge-in, interruptions, voice selection, voice cloning | Runtime docs above plus the provider routing section below |
| Premium realtime, provider-native voice, realtime tools | Runtime docs above, `docs/openAI-voice-pipeline.md`, `docs/gemini-live.md`, and the provider routing section below |
| Integrations, connectors, OAuth, provider catalog, knowledge imports | `docs/Integrations.md`, `docs/API.md`, `docs/Security-Compliance.md`, relevant ADRs in `docs/ADRs/` |
| Memory, knowledge base, retrieval, retention | `docs/Memory.md`, `docs/Data-Model.md`, `docs/Security-Compliance.md`, `docs/Integrations.md` when imports are involved |
| Platform admin | `docs/Platform-Admin.md`, `docs/Security-Compliance.md`, `docs/API.md`, `DESIGN.md` for UI |
| Security, compliance, tenant isolation, secrets, abuse controls | `docs/Security-Compliance.md`, `docs/Testing-Strategy.md`, `docs/API.md`, plus the touched domain doc |
| Billing, usage metering, subscriptions, plan limits | `docs/Billing.md`, `docs/API.md`, `docs/Data-Model.md`, `docs/Security-Compliance.md` |
| Observability, evals, provider benchmarks | `docs/Observability-And-Evals-Standard.md`, `docs/Testing-Strategy.md`, plus runtime or provider docs as applicable |
| Deployment, staging, production readiness, rollback | `docs/Staging-Deployment.md`, `docs/Production-Deployment.md`, `docs/Production-Readiness-Checklist.md`, `docs/Backup-Disaster-Recovery.md` |
| Tests, CI, quality gates | `docs/TDD.md`, `docs/Testing-Strategy.md`, and the touched domain doc |

## Provider Routing

Always consult local provider docs before changing provider-owned behavior or payloads. Do not infer VAD, turn detection, lifecycle, audio format, or voice API behavior from memory.

### AssemblyAI STT

Use for streaming STT, Universal-3 Pro, transcript messages, latency, turn detection, and STT diagnostics:

- `docs/assemblyAI/streaming-api.md`
- `docs/assemblyAI/streaming-api-3-pro.md`
- `docs/assemblyAI/universal-3-pro.md`
- `docs/assemblyAI/Message-Sequence.md`
- `docs/assemblyAI/Optimizing-Latency.md`
- `docs/assemblyAI/Best-Practices.md`
- `docs/assemblyAI/Commoon-Errors.md`
- `docs/Assembly-AI-Implementation.md`

### Cartesia TTS And Voice

Use for streaming TTS, output formats, telephony audio, voice selection, and voice cloning:

- `docs/cartesia/TTS-WS.md`
- `docs/cartesia/Output-format.md`
- `docs/cartesia/Clone-Voice-Api.md`

### Premium Realtime Providers

Use before changing OpenAI Realtime or Gemini Live setup, WebSocket lifecycle, provider-owned turn detection, interruption behavior, audio formats, realtime voice config, or provider-native tool calling:

- `docs/openAI-voice-pipeline.md`
- `docs/gemini-live.md`

## Handover Routing

- Active issue handovers live at `docs/Handovers/ISSUE-###-short-title.md`.
- Each issue has exactly one handover.
- Read the matching handover before resuming issue work.
- Update completed work, tests run, pending work, risks, decisions, and next step before ending an issue pass.
