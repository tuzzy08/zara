# ISSUE-188: Premium PSTN overload observability and release gates

Status: In Progress
Date: 2026-07-12
External: [Linear ZAR-218](https://linear.app/zara-voice/issue/ZAR-218/issue-188-premium-pstn-overload-observability-and-release-gates)

## Work Completed
- Ticket and dependency relations created.
- Audited the existing PSTN recorder, premium actor, playback controller, eval suite, and runbooks after ISSUE-187.
- Confirmed existing premium failure logs do not yet expose bounded queue depths, readiness/playback/handoff latency, or provider-specific release scenarios.
## Tests Run
- None.
## Pending Work
- Add the redacted premium diagnostic contract, measurements, provider-specific eval gates, and failure-class runbook coverage.
## Risks
- Diagnostics must remain redacted and must not add latency to the media path.
## Decisions
- OpenAI/Gemini premium evals and cost-optimized PSTN regression gates remain distinct.
## Next Recommended Step
- Add RED tests for diagnostic projection and bounded metric fields before wiring actor/playback measurements.
