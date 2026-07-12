# ISSUE-187: Gemini Live PSTN on the shared media contract

Status: Pending
Date: 2026-07-12
External: [Linear ZAR-217](https://linear.app/zara-voice/issue/ZAR-217/issue-187-gemini-live-pstn-on-the-shared-media-contract)

## Work Completed
- Ticket and dependency relations created.
## Tests Run
- None.
## Pending Work
- Implement all ZAR-217 acceptance criteria after shared actor, playback, and handoff work.
## Risks
- Gemini media must not be sent before `setupComplete`.
## Decisions
- Gemini-specific behavior remains behind the provider adapter/media contract.
## Next Recommended Step
- Start only after ISSUE-186.
