# ISSUE-236: Contract operational and platform-admin UI coverage

External: [Linear ZAR-240](https://linear.app/zara-voice/issue/ZAR-240/contract-operational-and-platform-admin-ui-coverage)

Status: Implemented

## Work completed

- Contracted the rendered operational suites from 22 tests and 1,194 lines to seven critical smoke tests and 723 lines.
- Reduced `TenantAgentsScreen.test.tsx` to reusable-agent creation and connected-tool assignment coverage.
- Reduced `TelephonyScreen.test.tsx` to organization-scoped published-workflow routing for an imported number.
- Reduced the platform-admin rendered suite to the authentication gate, MFA/session safety, staff shell/dashboard routes, and runtime observability/eval status.
- Moved six platform-admin payload construction and form-normalization tests into `platformAdminPayloads.test.ts` as pure unit coverage.
- Added two pure telephony API request-construction tests for protected PSTN test-route creation and inbound phone-test dispatch.
- Removed workspace-refresh duplication, provider-operation feedback, button/style/dialog, shared-primitive, and control-markup assertions.
- Confirmed backend controller suites remain authoritative for tenant membership, provider operations, protected phone routing, activation policy, staff authorization, secret redaction, and audited support mutations.

## Tests run

- Focused frontend baseline passed: 5 files and 29 tests in 14.78 seconds.
- Contracted frontend set passed: 5 files and 20 tests in 10.95 seconds.
- Split platform-admin rendered and pure suites passed: 2 files and 10 tests in 1.85 seconds.
- Authoritative backend coverage passed: 3 files and 41 tests in 22.12 seconds.
- Full UI-smoke lane passed: 9 files and 24 tests in 18.57 seconds.
- Web and platform-admin typechecks passed.
- Targeted ESLint passed.
- Test inventory passed after contraction.
- Post-review telephony, request-construction, and platform-admin suites passed: 3 files and 7 tests in 6.64 seconds.

## Pending work

- None for ISSUE-236.

## Risks

- The retained telephony smoke covers route construction and dispatch to the API client; provider behavior and protected phone-test policy intentionally remain backend-owned.
- Existing unrelated worktree changes must remain outside this issue's commit.

## Decisions

- Keep staff access and operational critical-flow smoke coverage only.
- Treat payload construction, form hydration, and normalization as pure unit behavior.
- Keep the rendered phone-test launch boundary and test its protected route and dispatch requests below the DOM.
- Do not assert provider lifecycle, persistence, authorization, policy, styling, layout, or control copy through DOM suites when stronger API seams exist.

## Next recommended step

- Continue with ISSUE-237 presentation/source-text test replacement.
