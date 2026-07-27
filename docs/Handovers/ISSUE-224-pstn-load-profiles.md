# ISSUE-224: PSTN stepped, burst, failure, and soak load profiles

- Status: In Progress
- External: [Linear ZAR-227](https://linear.app/zara-voice/issue/ZAR-227/pstn-capacity-312-add-stepped-burst-failure-and-soak-load-profiles)
- Parent: [Linear ZAR-223](https://linear.app/zara-voice/issue/ZAR-223/pstn-capacity-qualification-admission-control-and-horizontally)

## Work Completed

- Confirmed ZAR-227 as the next capacity sequence after the deterministic protocol simulator.
- Moved the external issue to In Progress and mapped it to local ISSUE-224.
- Added deterministic `ci-smoke`, stepped, same/cross-tenant burst, failure-matrix, and two-hour soak profiles. The stepped curve is pinned to 1, 5, 10, 20, 40, 60, and 100 concurrent calls.
- Added scenario coverage for delayed provider readiness, Twilio marks, interruption/clear, tool continuation, same-provider and cross-provider handoff, long audio output, quota errors, provider closure, and nonfatal exporter failure.
- Added an external load runner with arrival pacing, active-call telemetry monitoring, an immediate exhaustion abort, telemetry completeness checks, scenario/traffic/identity checks, first-audio and success SLOs, and post-stage drain recovery checks for calls, reservations, sockets, playback queues, and process RSS.
- Closed a review gap in reservation recovery evidence: staff capacity telemetry now exposes bounded tracked-reservation and pending-release counts, and a stage cannot pass drain recovery while either count remains above its baseline.
- Added qualification proof for observed local concurrency, advancing telemetry, workload-correlated active calls/socket legs, and per-stage exporter-failure deltas; configured concurrency is no longer treated as measured concurrency.
- Required post-handoff specialist continuation for same-provider and cross-provider scenarios, explicit specialized workflow destinations, a 100-call target ceiling, pre-stage exhaustion rejection, and deadline rechecks after arrival pacing.
- Added a typed, atomic `zara.pstn-load-report.v1` writer with a bounded failure taxonomy and forbidden credential, token, caller, transcript, payload, and media fields.
- Added a staff capacity-posture client with bounded request timeouts and external tenant configuration that rejects inline credentials, production execution, insecure endpoints, unknown scenario destinations, cross-tenant underconfiguration, and unapproved release-scale runs.
- Extended the virtual Twilio caller with abort propagation and webhook, media-connect, first-audio, and total-call timing while preserving the deterministic protocol contract.
- Added root and simulator commands for CI smoke and explicitly approved release profiles, plus operator documentation, report interpretation, cost boundaries, and baseline retention rules.
- Re-audited staging readiness before push from candidate commit `0620ad2` and confirmed that no staging target, external tenant fixture, staff telemetry authorization, or load approval variables are configured in the workspace. The replacement candidate is now pushed in PR #120; the staging inputs remain outstanding.
- Identified the missed baseline sequence explicitly. Commit `fa08cb7` contains the completed load suite and is the direct parent of `a9f7022`, the first incremental-persistence commit; only `fa08cb7` can reconstruct the intended pre-persistence artifact from repository history.

## Tests Run

- RED: focused tests failed for missing load modules and contracts, active-call exhaustion monitoring, absent first-audio evidence, unbounded failure strings, unknown scenario destinations, and telemetry request cancellation.
- GREEN: `npm.cmd exec -- vitest run apps/pstn-protocol-simulator/src` - 13 files, 64 tests passed.
- GREEN: `npm.cmd --workspace @zara/pstn-protocol-simulator run typecheck`.
- GREEN: `npm.cmd --workspace @zara/pstn-protocol-simulator run build`.
- GREEN: `npm.cmd exec -- eslint apps/pstn-protocol-simulator/src`.
- GREEN: `npm.cmd run eval:pstn` - 25 PSTN media evals passed.
- GREEN: `git diff --check`.
- RED: the reservation-debt regression passed a stage even though tracked reservations and pending releases remained above baseline.
- GREEN: the focused capacity client, load runner, admission coordinator, observability, worker, and deployment suites passed with 80 tests after admission posture became a required telemetry field and drain gate.
- BLOCKED: `npm.cmd run load:pstn:ci` exited with the intentionally redacted `pstn_protocol_smoke_failed` result before traffic generation because the documented test/staging tenant and telemetry configuration is absent. This is not staging certification evidence.

## Pending Work

- Provision one isolated staging resource shape and external generator that can be reused without capacity-affecting configuration drift.
- Configure the external generator's tenant fixture file, staff-authorized capacity telemetry endpoint/session, simulator transport, release SHA, report store, and explicit release-load approval.
- Deploy historical commit `fa08cb7` to reconstruct the pre-persistence single-instance baseline, run the explicitly approved profiles, and retain the report plus resource manifest in the approved baseline store.
- Deploy the merged PR #120 release SHA to the same resource shape and run the same approved profiles as the post-refactor comparison.
- If `fa08cb7` cannot be deployed faithfully, record an explicit ZAR-227 acceptance waiver and release-owner rebaseline decision; do not label the post-refactor report as the required pre-persistence baseline.
- Reconcile the measured qualified target and any observed bottleneck with the capacity envelope before marking this issue Implemented.

## Risks

- Release-scale and real-provider runs can incur provider cost and must never run implicitly in ordinary CI.
- A valid baseline requires an isolated staging resource shape and staff-authorized capacity telemetry; a local synthetic report is not certification evidence.
- Staging must route the selected workflow scenarios to the external OpenAI protocol simulator before the deterministic profiles are meaningful.
- The original chronological pre-persistence baseline was not captured before `a9f7022`; historical reconstruction must preserve commit `fa08cb7` and the same resource shape, or the acceptance gap requires an explicit waiver.

## Decisions

- Reuse the protocol simulator through a separate load-runner layer so generator pressure remains outside API and realtime worker processes.
- Keep release-scale execution behind an explicit operator approval flag.
- Fail closed when telemetry is missing or incomplete, while calls are still active when posture reaches `exhausted`, or when required first-audio evidence is absent.
- Keep ISSUE-224 and Linear ZAR-227 In Progress until the approved staging baseline is captured; implementation tests alone do not satisfy the operational acceptance criterion.

## Next Recommended Step

Provision the isolated target and generator, capture the `fa08cb7` historical baseline, then run the merged PR #120 release SHA on the same shape for comparison. Otherwise obtain an explicit ZAR-227 baseline waiver before closure.
