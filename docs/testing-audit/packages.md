# Package test audit — 2026-10-12

## Scope and result

Reviewed the inventory of 22 test files under `packages/`. Removed 5 declared tests and one empty suite file. No production code changed. No test was removed only because it uses a unit seam.

No checked-in browser E2E runner or E2E suite was found through the repository file inventory or package scripts. API/controller tests and synthetic provider tests are not full browser-to-provider E2E tests. They cannot establish that all package edge cases have replacement coverage.

## Removed tests

| File / test | Evidence and retained coverage |
| --- | --- |
| `packages/core/src/index.test.ts`: `defines the tenant roles shared by the product apps` | Copies the `tenantRoles` array from `index.ts` into an expected literal. It executes no permission check. This is a constant change detector, not a role authorization test. |
| Same file: `defines the platform roles shared by the admin surfaces` | Copies `platformRoles` literally. It does not test staff access, privilege separation, or permission denial. |
| Same file: `defines the frontend application ids used by the monorepo` | Copies the two `frontendApps` literals. It does not start, build, or navigate an application. |
| `packages/core/src/runtime.test.ts`: `keeps the helper type anchored to the public compiled manifest` | Calls a local test helper that checks only whether `entryAgentId` is truthy. The retained `compiles a deterministic manifest from a published workflow version` checks the same fixture's exact entry agent plus its complete compiler behavior. Type compatibility is checked by TypeScript, not this runtime truthiness assertion. |
| `packages/auth-client/src/index.test.ts`: `does not mount Better Auth session or organization readers during normal tenant rendering` | Exact duplicate setup and assertions of retained `does not mount Better Auth organization readers during normal session rendering`. The retained test has the same session, organization, member, result, and three no-call assertions. |

## Retained inventory and distinct failure coverage

Paths below are relative to `packages/`.

| File | Reason retained |
| --- | --- |
| `auth-client/src/index.test.ts` | Browser-client cookie transport, tenant selection, missing memberships, onboarding errors, restored state, invitations, safe session IDs, and sign-out. Controller tests do not execute this client. |
| `auth-client/src/mfa.test.ts` | Challenge must not become a staff session; invalid code and successful code have different outcomes; server tokens must not be returned. The Postgres MFA suite tests server assurance, not these client transitions. |
| `core/src/agent-action.test.ts` | Structured action parsing rejects unknown and malformed actions and extra handoff fields. |
| `core/src/agent-runtime-context.test.ts` | Concrete graph authority, stale role rejection, safe tool context projection. |
| `core/src/env.test.ts` | Invalid configuration, defaults, secret-safe errors/logging, and production webhook secret requirement. |
| `core/src/intent-routing.test.ts` | Unknown branch, missing confidence, low confidence, explicit fallback, source-agent clarification, transfer context. |
| `core/src/live-call-session.test.ts` | Ordered lifecycle, pinned manifests, packets, rehydration, scope mismatches, terminal transition rejection. |
| `core/src/provider-registry.test.ts` | Catalog safety, unsupported provider lookup, restricted tools and OAuth scopes. Some metadata overlaps the catalog controller test, but the retained suite also covers provider-specific forbidden tools and reconnect scopes. No complete replacement was established. |
| `core/src/pstn-premium-realtime-runtime.test.ts` | Call-start gates, audio/packet flow, native interruption, blocked fallback, provider tool callbacks. |
| `core/src/pstn-sandwich-runtime.test.ts` | Noisy/duplicate media, codec fallback, timeout closeout, no-frame handling, interruption. |
| `core/src/realtime-tool-bridge.test.ts` | Active-agent tool rights, schema transformation, unknown function rejection, handoff eligibility. |
| `core/src/runtime-profiles.test.ts` | Profile cost/routing difference and premium policy/budget gates. |
| `core/src/runtime.test.ts` | Manifest compilation, stale metadata rejection, required resources, high-risk routing, provider selection, streaming, and partial failure. |
| `core/src/sandbox.test.ts` | Idempotent/replayed events, cost attribution, missing prices, budgets, microphone denial. |
| `core/src/telephony-active-call-policy.test.ts` | Insufficient/missing durable credit and explicit versus missing provider failure action. |
| `core/src/telephony.test.ts` | Signature validation, scope-safe number import, protected phone test, activation, budgets, consent, failover, and mid-call policy. |
| `core/src/test-layer-config.test.ts` | Executes the inventory program and loads actual Vitest configurations; detects omitted or duplicate test selection. This is not only a source-text check. |
| `core/src/turn-runtime-packet.test.ts` | Safe projection, monotonic sequence, tool output handling, context limits, retained latest result, warning diagnostics. |
| `core/src/workflow.test.ts` | Graph edit/publish behavior, invalid graph rejection, immutable versions, policies, voices, conditions, and authorization. |
| `core/src/workspace-workflow.test.ts` | Workspace filtering and identity propagation into published/compiled versions. |
| `core/src/workspace.test.ts` | Tenant-specific duplicate slugs, membership separation, final-owner and active-call safeguards. |

## Verification artifact

Command:

```powershell
npx vitest run --config vitest.unit.config.ts packages --reporter=json --outputFile=artifacts/testing-audit/packages-vitest.json
```

Result: **208 passed, 0 failed**. The JSON artifact records each executed test and outcome. It is a package verification artifact, not E2E evidence. Vitest reports a non-fatal future-config warning for `__dirname`.

## Limits

No live provider, production, or browser E2E run was made. The retained inventory is conservative: a test remains when no equivalent higher-level failure scenario was proved. This audit does not claim that every retained assertion is the best possible test design.
