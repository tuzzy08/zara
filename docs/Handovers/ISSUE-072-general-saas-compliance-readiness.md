# ISSUE-072: General SaaS compliance readiness

External: [GitHub #72](https://github.com/tuzzy08/zara/issues/72)

Issue link: https://github.com/tuzzy08/zara/issues/72

## Goal

Deliver General SaaS compliance readiness for the Compliance area in the Production milestone.

## Acceptance Criteria

- Readiness checklist covers encryption, audit, retention, consent, and access control
- No HIPAA/PCI claims are made
- Known gaps are documented

## Work Completed

- RED: added API coverage proving `/organizations/:organizationId/compliance/readiness` must return a general SaaS readiness posture with encryption, audit, retention, consent, and access-control checklist items.
- GREEN: implemented the compliance readiness response in `ComplianceService` and exposed it from `ComplianceController`.
- Documented the readiness contract in `docs/API.md` and `docs/Security-Compliance.md`.
- Marked ISSUE-072 implemented in `docs/Issue-Backlog.md` and updated roadmap sequencing.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/compliance/compliance.controller.test.ts` failed with `404` for the missing readiness route.
- GREEN: `npm.cmd run test:run -- apps/api/src/compliance/compliance.controller.test.ts`

## Pending Work

- None for this issue.

## Risks And Edge Cases

- Enterprise asks for regulated data
- Data residency request

## Decisions

- The readiness API explicitly reports `posture: "general_saas"` and does not claim HIPAA or PCI readiness.
- Regulated-data and data-residency requests are documented as known gaps requiring enterprise review before onboarding.

## Next Recommended Step

Proceed to later production issues for deployment, observability, backups, and provider fallback.
