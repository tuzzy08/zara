# ISSUE-097: Platform admin deployment and domain config

External: [GitHub #97](https://github.com/tuzzy08/zara/issues/97)

Issue link: https://github.com/tuzzy08/zara/issues/97

## Goal

Deliver Platform admin deployment and domain config for the DevOps area in the Production milestone.

## Acceptance Criteria

- `apps/platform-admin` has separate deploy config and environment variables
- Trusted origins include local, staging, and production admin domains
- Security headers and CSP can differ from tenant app

## Work Completed

- Added `apps/platform-admin/.env.example` with admin API, auth, and origin variables.
- Added `apps/platform-admin/vercel.json` with admin build command, output directory, CSP, frame, referrer, and content-type headers.
- Verified API trusted origins include local, staging, and production platform-admin domains.
- Added deployment config test coverage.

## Tests Run

- RED: `npm.cmd run test:run -- apps/platform-admin/src/deployment-config.test.ts`
  - Failed because platform-admin env and deploy config files were missing.
- GREEN: `npm.cmd run test:run -- apps/platform-admin/src/deployment-config.test.ts`
- Verification: `npm.cmd run test:run -- apps/platform-admin/src/index.test.tsx apps/platform-admin/src/deployment-config.test.ts apps/api/src/platform-admin/platform-admin.controller.test.ts`

## Pending Work

- None for ISSUE-097 acceptance.

## Risks And Edge Cases

- Wrong domain points to tenant app
- Missing staging origin

## Decisions

- Priority: P1
- Labels: platform-admin, devops, security, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Platform-admin keeps its own deploy config so the admin origin can carry stricter framing and CSP policy than the tenant app.

## Next Recommended Step

Run full verification, then mark the platform-admin slice complete if the completion audit passes.
