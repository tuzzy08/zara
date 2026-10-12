# ISSUE-151: Atomic tenant onboarding signup

Status: Implemented (locally verified; remote CI pending; not deployed)
Date: 2026-05-31
External: [Linear ZAR-97](https://linear.app/zara-voice/issue/ZAR-97/issue-151-atomic-tenant-onboarding-signup)

## Work Completed

- Push checkpoint: signup commit `9fd2da6b4cb691d6d24a6847b33ff6e8fa95901c` is published in [PR #128](https://github.com/tuzzy08/zara/pull/128). Security and preview pass; CI, Migration Check and Browser E2E are running. Monitor `zara-signup-ci` checks every five minutes and permits only in-scope repairs. Linear ZAR-97 is updated. No merge or production deployment occurred. This supersedes the pre-push notes below.

- 2026-10-12 release pass: user approved committing and pushing only signup changes, then monitoring CI and fixing in-scope failures. PR #127 remains open, so the signup PR will target its `codex/test-cleanup-playwright` branch to keep the signup diff separate. No merge or deployment is authorized. Unrelated working-tree changes remain excluded.

- 2026-10-12: resumed signup improvements on `codex/signup-validation-performance`, based on the separate green test-cleanup PR #127. User requires password confirmation, email validation, verification before sign-in (including existing unverified accounts), and initial signup-load improvements. No production deployment is authorized in this pass.
- Public test boundary: the existing Playwright signup journey through real browser, API, database and captured email. Extend that approved boundary with mismatched passwords, invalid email, blocked unverified sign-in, invalid/valid verification links, and resumed onboarding. Leave tenant-isolation assertions unchanged.
- Initial production read-only probe: `/signup` returns HTTP 200, 678-byte HTML, 0.980s first byte from this workstation. This is one sample, not a performance conclusion. Current App statically imports all tenant screens and workflow builder.
- Password-confirmation RED run started with the real isolated E2E stack. No production code changed yet. Email-verification flow must preserve resumable onboarding and must not create organization authority from an unverified signup response.
- Password-confirmation RED confirmed in `artifacts/e2e/zara-e2e-30844-1791836042090/`: missing accessible Confirm password input. The small UI implementation is added; TypeScript passes and GREEN is running.
- Public Chromium baseline: first contentful paint 5,304 ms, first byte 933 ms, decoded script 859,782 bytes, script download 2,846 ms. Local production-image baseline: decoded script 859,778 bytes. A 500,000-byte signup script budget is the measurable target; timing samples are not production service-level claims.
- Verification design under implementation: Better Auth must withhold sessions for unverified credentials. Signup returns a verification-required state instead of trusting a sessionless or synthetic signup user. User opens the email link, then completes the same resumable signup action with credentials and organization name. Verification never grants tenant authority by itself. Existing unverified sign-in can request another native link; no client field can assert verification.
- Password confirmation GREEN: both existing browser journeys passed (9.8s and 7.6s) in `zara-e2e-29648-1791836521835`; the new load test failed at 860,198 decoded script bytes. Route-level deferred loading then passed the 500,000-byte budget at 270,466 bytes in `zara-e2e-32664-1791836768494` (three tests passed, 35.9s, cleanup 0). Mobile 390x844 screenshot inspected: fields and buttons fit, no horizontal overflow or page errors. This is a 68.6% script reduction, not a deployed timing claim.
- Verification RED: initial direct request lacked Origin and hit the wrong 403 boundary. Corrected the test to send Origin and require `EMAIL_NOT_VERIFIED`. `signup-verification-red` then failed with HTTP 200 instead of 403. The earlier three-test pass is not verification-policy evidence. Policy and resumable client/server changes are now drafted; GREEN and auth regression checks remain.
- Environment: Browser skill/plugin was not available; used the approved repository Playwright harness. Two concurrent Vitest workers failed to start under low memory; no tests ran in that attempt. Checks now run serially; other projects and their containers remain untouched.

- Created the external Linear issue and reconciled it with the local backlog.
- Captured atomic tenant onboarding as dependent on the server-owned auth context.
- Added `POST /api/auth/onboarding/signup` as a NestJS-owned tenant onboarding action.
- The onboarding action validates tenant names, creates or resumes the Better Auth user, creates the tenant organization, sets the active organization, initializes workspace state, grants the owner access to `workspace-default`, and returns the tenant context needed by the app.
- Added recoverable partial-failure behavior so a failure after user creation can be retried with the same payload.
- Added duplicate tenant-name protection that blocks known duplicate slugs before creating another user and maps Better Auth slug collisions to the same actionable duplicate-name response.
- Updated `packages/auth-client` tenant signup to call the server-owned onboarding endpoint instead of the client-side Better Auth organization sequence.
- Added tenant UI smoke coverage for recoverable retry and duplicate-name signup errors.
- Follow-up fix on 2026-06-16: updated onboarding default workspace ownership to use canonical `workspace-default` / `Default workspace` instead of the retired seeded support workspace.
- Updated API, frontend architecture, architecture, roadmap, backlog, and workspace contract notes.

## Tests Run

- Final GREEN: `artifacts/e2e/signup-final-verification/report/index.html`, three browser tests passed in 101.6s with no skips. Fresh disposable database, real API and email capture, production-mode cookies and rate limiting. App images are the unchanged images from `zara-e2e-23340-1791839280188`; only the test header lookup changed to the installed provider's `X-Retry-After`. `run.md` records commands, image IDs and test hash. Teardown removed all seven test containers, both networks and disposable volumes; shell exit 0.
- Final load evidence: 272,435 decoded script bytes versus 860,198 before deferred imports (68.3% reduction); 390x844 viewport fits, no page errors. Mobile screenshot inspected. Local FCP 816ms is a single sample, not a production timing guarantee.
- Final `npm run typecheck --workspace @zara/web` passed after the closed-tab recovery change. API production build also passed. All 83 focused regressions, focused lint, syntax, boundary and diff checks passed. Earlier failed runs below are RED or test-harness correction evidence, not unresolved failures.

- 2026-10-12: staff, workspace and workflow controller regressions passed 21 tests in three files with verified account setup. Total focused regression checks so far: 83 passed (54 API, 29 frontend/auth-client).

- 2026-10-12: frontend/auth-client regression run passed 29 tests in three files (`apps/web/src/app.test.tsx`, auth-client index and MFA). The existing landing test now waits for the deferred page; the existing sign-in request assertion includes its verification callback URL.
- Closed-tab recovery RED: `artifacts/e2e/signup-recovery-red` failed because the reloaded signup form had no Continue after verification action. Callback now selects `/signup?resume=true`, with credentials still checked on the server and no password storage. Recovery then passed in `zara-e2e-23968-1791838647803`.
- That E2E run passed the isolation and mobile-load tests but hit native sign-in throttling on the fourth rapid attempt. Test now checks wrong-password HTTP 401 and obeys a bounded server `Retry-After` before one final retry. Production rate limiting is unchanged.
- Focused ESLint passed (zero errors; the runner script is ignored by ESLint). `node --check scripts/run-e2e.mjs` passed. Browser artifacts now hash the added load test as an explicit input.

- 2026-10-12: full `npm run typecheck` passed after exporting the new onboarding response type.
- 2026-10-12: seven focused API/auth files passed, 33 tests, using `vitest.api.config.ts --maxWorkers=1 --pool=threads`. Covers onboarding, native auth, auth context, account security, invitations, MFA and runtime security configuration.
- Invitation RED reproduced HTTP 401 after a new recipient verified their email. GREEN now requires an actual signup session token or a successful native sign-in before trusting the user payload. Sessionless/synthetic signup responses cannot grant invitation authority.
- Verification E2E run `zara-e2e-5248-1791837532593`: two tests passed; one failed only because the invalid-token assertion expected lowercase instead of the provider's `INVALID_TOKEN`. Corrected the assertion. Full GREEN still pending with closed-tab recovery included.

- `npm.cmd exec -- vitest run apps/api/src/auth/auth-onboarding.controller.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- `npm.cmd exec -- vitest run packages/auth-client/src/index.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- `npm.cmd exec -- vitest run apps/web/src/app.test.tsx --pool=threads --maxWorkers=1 --reporter=dot`
- `npm.cmd exec -- vitest run apps/api/src/auth/better-auth.controller.test.ts apps/api/src/auth/auth-context.controller.test.ts apps/api/src/auth/auth-onboarding.controller.test.ts packages/auth-client/src/index.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- `npm.cmd run typecheck`
- `npm.cmd run test:run -- apps/api/src/auth/auth-onboarding.controller.test.ts apps/api/src/auth/auth-context.controller.test.ts`
- `npm.cmd run typecheck --workspace @zara/api`

## Pending Work

- No implementation acceptance work remains in this signup slice.
- Commit/push and remote CI are approved and in progress. Deployment needs separate approval. Before deployment, verify the production auth email webhook and sender. After deployment, check real inbox delivery and live load timing. Local email capture does not prove inbox delivery.

## Risks

- Existing unverified accounts will be blocked from new password sign-in. The user explicitly approved this policy on 2026-10-12. Existing sessions are not revoked by this change.
- Invitation acceptance now verifies session issuance or signs in after verification; its regression test passes.
- Local verification work is not deployed. No production account or secret was changed.

## Decisions

- Treat this as a product onboarding action, not a raw client-side Better Auth sequence.
- Use retryable server responses for partial user-created/org-not-created failures rather than leaving the user on a dead-end signup screen.
- Use `workspace-default` as the default owner workspace for the current onboarding baseline.

## Next Recommended Step

- Commit and push only signup-related changes, then check remote CI and fix in-scope failures. Leave unrelated billing, deployment and semantic-design edits untouched. Do not merge or deploy without approval.
