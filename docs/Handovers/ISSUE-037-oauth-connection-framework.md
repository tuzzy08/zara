# ISSUE-037: OAuth connection framework

External: [GitHub #37](https://github.com/tuzzy08/zara/issues/37)

Issue link: https://github.com/tuzzy08/zara/issues/37

## Goal

Deliver OAuth connection framework for the Integrations area in the Integrations milestone.

## Acceptance Criteria

- Platform OAuth apps support connect and callback
- State parameter prevents CSRF
- Tenant-scoped connection is created

## Work Completed

- Added an `IntegrationsModule` to the NestJS API and registered it in the root app module.
- Added `POST /organizations/:orgId/integrations/:provider/connect` for tenant-admin OAuth connect starts.
- Added `GET /integrations/oauth/:provider/callback` for platform OAuth callback completion.
- Minted opaque OAuth `state` values without tenant IDs embedded in the URL.
- Stored pending OAuth connect attempts by state and created tenant-scoped masked integration connection records on callback.
- Blocked non-admin/non-owner connect attempts.
- Rejected expired callback state before connection creation.
- Kept raw OAuth access and refresh token material out of public API responses.
- Added durable file-backed integration state with restart-safe pending connects, connections, and encrypted credential envelopes.
- Added `IntegrationSecretVault` with AES-256-GCM envelopes and key version metadata.
- Added an OAuth provider-client boundary so callbacks exchange authorization codes through a provider client instead of deriving token material directly from the code.
- Added `GET /organizations/:orgId/integrations/connections` for tenant-scoped masked connection listing.
- Added integration credential hardening env knobs to `.env.example`.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts`
  - Failed because `./integrations.module` did not exist.
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts`
  - First OAuth connect/callback tracer bullet passed.
- RED: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts`
  - Failed because non-admin connect attempts still returned `201`.
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts`
  - Tenant admin/owner gate passed.
- RED: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts`
  - Failed because expired OAuth state still completed successfully.
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts`
  - Expired state rejection passed.
- Verification: `npm.cmd run typecheck`
- Verification: `npm.cmd run lint`
- Verification: `npm.cmd run build --workspace @zara/api`
- RED: `npm.cmd run test:run -- apps/api/src/integrations/integrations.persistence.test.ts`
  - Failed because the integration state repository/vault/provider-client boundary did not exist.
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/integrations.persistence.test.ts`
  - Durable encrypted integration credential storage passed.
- Verification: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts`
- Verification: `npm.cmd run test:run -- apps/api/src/integrations/integrations.persistence.test.ts`
- Verification: `npm.cmd run test:run -- apps/api/src/app.module.test.ts`
- Verification: `npm.cmd run typecheck`
- Verification: `npm.cmd run lint`
- Verification: `npm.cmd run build --workspace @zara/api`

## Pending Work

- Add connector health/revocation and tool grant enforcement in ISSUE-044 and ISSUE-045 before exposing connector tools broadly.
- Add frontend integration connection UI in a later tenant app slice.
- Implement connector-specific production OAuth clients under the vendor connector issues using the `IntegrationOAuthProviderClient` boundary added here.

## Risks And Edge Cases

- Callback replay
- User lacks admin role

## Decisions

- Priority: P0
- Labels: integrations, security, tdd-required
- Handover docs are mandatory for every pass on this issue.
- OAuth connect is restricted to `owner` and `admin` actor roles for now because platform-owned OAuth apps grant tenant-scoped tool authority.
- Callback `state` is opaque, one-time use, and expiry checked before creating the integration connection.
- Public connection responses expose only masked credential references, never raw access or refresh tokens.
- Integration OAuth state and connection records persist through a file-backed repository by default, with the same encrypted-envelope approach used for telephony credentials.
- The default local provider client is intentionally deterministic for local/test operation; real provider HTTP clients should implement the same `IntegrationOAuthProviderClient` contract in connector-specific issues.

## Next Recommended Step

Move to ISSUE-045 tool permission grants so workflow tool execution requires explicit grants before vendor connectors are exposed, then implement connector-specific provider clients and health/revocation in ISSUE-039 through ISSUE-044.
