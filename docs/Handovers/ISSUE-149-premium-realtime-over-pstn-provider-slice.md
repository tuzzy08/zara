# ISSUE-149: Premium realtime over PSTN provider slice

Status: Todo
Date: 2026-05-28
External: [Linear ZAR-95](https://linear.app/zara-voice/issue/ZAR-95/issue-149-premium-realtime-over-pstn-provider-slice)

## Work Completed

- Created the reconciled local backlog entry and matching Linear issue.
- Captured premium realtime over PSTN as a clearly separate follow-up slice.
- Standardized that PSTN premium realtime stays blocked by default until this issue implements gates and provider capability checks.

## Tests Run

- Not run. This pass created planning docs and issue records only.

## Pending Work

- Add failing gate tests proving PSTN premium realtime cannot start before the feature is enabled and entitled.
- Implement at least one approved premium realtime provider path through Zara's telephony media bridge.
- Normalize provider-native interruption semantics into Zara runtime events.
- Update architecture, runtime manifest, telephony, observability, and sandbox docs after implementation.

## Risks

- Premium realtime behavior could accidentally alter cost-optimized PSTN sandwich behavior if the paths are not isolated.
- Provider-native interruption semantics differ across providers.

## Decisions

- Premium realtime over PSTN is not part of PSTN sandwich v1.
- No silent downgrade from premium realtime PSTN to sandwich without explicit policy.

## Next Recommended Step

- Start RED with PSTN premium realtime call-start gate tests.
