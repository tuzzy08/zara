# Frontend test signal audit

Date: 2026-10-12. Scope: `apps/web` and `apps/platform-admin` ordinary test files.

## Coverage evidence

The repository has Vitest client tests and React component tests. The React tests use jsdom, mocked auth, HTTP, audio, or React Flow boundaries. They are not full browser-to-database E2E tests. No tracked Playwright/Cypress browser E2E configuration or suite was found. Manual browser evidence in handovers is not a repeatable replacement for these tests.

No production code, provider behavior, test configuration, or UI allowlist changed in this pass. The Ponytail skill kept the change limited to proven low-signal checks. In particular, a test was not removed merely because it runs in isolation.

## Deleted tests

| File | Test | Reason and evidence |
| --- | --- | --- |
| `apps/web/src/workflowBuilderTheme.test.ts` | `assigns a distinct accent to each builder node kind` | Reads five entries from a constant color table and counts distinct values. It tests decorative palette data, not node behavior, contrast, visibility, or rendering. The repository testing strategy already rejects decorative-value assertions. This is not claimed to have E2E replacement coverage. |
| `apps/web/src/workflowBuilderTheme.test.ts` | `keeps minimap colors aligned with node accents` | Compares two fields in the same constant table and checks that a tint string contains `rgba`. It cannot establish that the minimap uses the color or that the tint is valid or accessible. It is a static change detector, not behavioral evidence. This is not claimed to have E2E replacement coverage. |

The whole file was removed. Both tests are recoverable from Git.

## Retained inventory

Paths in the first table are relative to `apps/web/src`. Each row states the distinct failure that the suite can detect. There is no equivalent complete E2E suite to replace these checks.

| File | Reason to retain |
| --- | --- |
| `apiClient.test.ts` | Missing cookie credentials and wrong API-origin fallback. |
| `app.test.tsx` | Signed-out route gating, sign-in/sign-out, tenant selection, context recovery, invalid/valid MFA challenge. |
| `AppAgentsRoute.test.tsx` | Agent screen route and navigation wiring. The isolated screen test does not exercise the app router. |
| `DashboardScreen.test.ts` | Distinguishes expired authentication from partial service failure. |
| `defaultSandboxWorkflow.test.ts` | Prevents invented budget facts and invalid seeded route/tool structures. Builder tests use a different fixture. |
| `integrationProviderBranding.test.ts` | Accessible provider identity and logo-token mapping. Retained despite static fallback labels: these are user-facing identity contracts, not decorative classes. |
| `integrationSetupPresets.test.ts` | Catalog capability filtering, approval requirements, and removal of sensitive cross-workspace references from copy previews. |
| `liveSandboxAudio.test.ts` | PCM conversion, provider sample rate, interrupted playback, browser gesture priming, AudioWorklet and fallback capture. Hook tests mock this module. |
| `liveSandboxEventFormatting.test.ts` | Diagnostics under audio floods, failure pinning, error envelopes, real tool evidence, and secret/audio redaction. |
| `liveSandboxReplay.test.ts` | Rebuilt transcripts exclude tool failures while retaining caller and agent turns. The hook test covers live events, not this replay function. |
| `liveSandboxTransport.test.ts` | WebSocket scope, protocol messages, token handling, and relative API-origin resolution. Hook tests mock this module. |
| `MarketingLandingPageMockup.test.tsx` | Pricing navigation and signup/sales/PAYG action targets. Some plan checks overlap app smoke, but pricing and PAYG targets have separate coverage here. |
| `reusableAgents.test.ts` | Browser HTTP path, cookie, body, response, and toolbelt secret-exclusion contracts. Component tests mock these requests. |
| `runtimeManifestDisplay.test.ts` | Entry-agent premium override takes precedence over workflow runtime when presenting provider/model identity. |
| `sandboxRuntimeManifest.test.ts` | Published workflow identity survives the sandbox compiler boundary. This is narrow coverage, not proof of draft rejection. |
| `SandboxScreen.test.tsx` | Published selection/deep links and absence of invented non-billable prices. |
| `telephonyApi.test.ts` | Browser test-route/dispatch payloads and exclusion of client-supplied billing evidence. Screen tests mock this module. |
| `telephonyCallsPageModel.test.ts` | Cross-tenant filtering, callable-number filtering, and dispatch/session merge without duplicate controls. |
| `TelephonyScreen.test.tsx` | Active-organization number routing and correct phone-test deep link. |
| `TenantAgentsScreen.test.tsx` | Review-before-apply, stale instruction rejection, creation, and connected-tool assignment. |
| `tenantBillingApi.test.ts` | Delayed checkout events, bounded polling, no overlapping reads, no late cross-tenant response, failed reads, hosted checkout/portal navigation. |
| `TenantBillingScreen.test.ts` | No-plan state and real credit/reservation/debit facts without invented prices or subscription state. This `.ts` file renders React in jsdom; filename is not evidence of test layer. |
| `useLiveSandboxSession.test.tsx` | End/reset replay state, latency separation, failed turn state, interrupted playback, and provider-ready capture gate. |
| `workflowBuilderIds.test.ts` | Prevents deleted-node ID reuse and rejects malformed suffixes. |
| `workflowBuilderPublish.test.ts` | Selected-workspace overwrite versus new-workflow identity. |
| `workflowBuilderToolCatalog.test.ts` | Provider-specific tool permissions, minimal OAuth scopes, connection selection, missing bindings, and server-only metadata exclusion. |
| `workflowBuilderWorkbench.test.ts` | Entry/agent action restrictions and unknown handle normalization. |
| `WorkflowBuilder.test.tsx` | Saved/draft selection, router target repair, instruction review, and publish-before-run. |
| `workflowSandboxRegistry.test.ts` | Persisted selection removal, user workspace preservation, stale schema/action rejection, and valid router metadata retention. |
| `workspaceState.test.ts` | Empty/fresh workspace initialization and canonical fallback without legacy seed IDs. |

| Platform-admin file | Reason to retain |
| --- | --- |
| `apps/platform-admin/src/index.test.tsx` | Tenant/staff separation, fresh MFA, setup/challenge, owner-only billing, ambiguous-write retry identity, stale/denied/read failures, staff routes, and honest financial values. |
| `apps/platform-admin/src/platformAdminPayloads.test.ts` | Form number/boolean/list conversion, saved-policy hydration, custom class retention, and versioned policy save payloads. Server tests do not exercise these browser form builders. |

## Validation

- `npx vitest run --config vitest.unit.config.ts apps/web apps/platform-admin`: 21 files and 102 tests passed. Exit 1 because workers for `TenantBillingScreen.test.ts` and `workflowSandboxRegistry.test.ts` timed out during startup. No assertion failure was reported. This is not a complete pass.
- `npx vitest run --config vitest.ui-smoke.config.ts --maxWorkers=1`: 8 files and 21 tests passed. Exit 1 because the platform-admin `index.test.tsx` worker timed out during startup. No assertion failure was reported. This is not a complete pass.
- Serial retry: `npx vitest run apps/web/src/TenantBillingScreen.test.ts apps/web/src/workflowSandboxRegistry.test.ts apps/platform-admin/src/index.test.tsx --maxWorkers=1`: **3 files, 13 tests passed; exit 0**. This covers every file missed by the startup timeouts. Across the focused runs, all **32 retained files and 136 tests** passed. The initial process failures remain recorded; they were not bypassed.

No new tests or production code were added. Full browser E2E replacement coverage remains a gap; this audit does not claim otherwise.
