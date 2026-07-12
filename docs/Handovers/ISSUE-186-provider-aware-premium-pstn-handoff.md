# ISSUE-186: Provider-aware premium PSTN handoff

Status: Pending
Date: 2026-07-12
External: [Linear ZAR-216](https://linear.app/zara-voice/issue/ZAR-216/issue-186-provider-aware-premium-pstn-handoff)

## Work Completed
- Ticket and dependency relations created.
## Tests Run
- None.
## Pending Work
- Implement all ZAR-216 acceptance criteria after ISSUE-184 and ISSUE-185.
## Risks
- Old provider callbacks must never mutate or speak into the replacement session.
## Decisions
- Immutable voice/model/provider changes always replace the provider session.
## Next Recommended Step
- Start after deterministic playback is complete.
