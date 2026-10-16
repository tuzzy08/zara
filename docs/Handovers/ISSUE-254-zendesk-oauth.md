# ISSUE-254: Real Zendesk OAuth

Status: Pending
External: [GitHub #135](https://github.com/tuzzy08/zara/issues/135)
Dependency: [ISSUE-253](ISSUE-253-durable-integrations.md)

## Scope and completed investigation

Complete a Zara-owned Zendesk OAuth connection and real ticket execution for the first Stage 2 customer journey. The current OAuth URL, token exchange and OAuth ticket result are local simulations. The UI displays a toast instead of completing consent. The existing API-token path is not the customer-ready solution.

Current [Zendesk migration guidance](https://developer.zendesk.com/documentation/authentication/oauth-migration/) excludes API tokens for new accounts and retires all remaining tokens on 30 April 2027. [Refresh tokens](https://developer.zendesk.com/documentation/authentication/refresh-token/) are single-use and return a new token pair.

## Design decisions

- Use server-owned client configuration and exact callback URI, validated subdomain, narrow scopes, server time and PKCE.
- Persist callback and refresh claims before network requests. Only one API instance can own a claim.
- Retry persistence with an already received result. Never repeat a provider exchange inside a database conflict retry.
- Fence completion against deletion and credential generation. A lost exchange or refresh response requires new consent.
- Store actual granted scopes and expiry with encrypted credentials. Disable unsupported or unconfigured OAuth flows in production.
- Complete consent navigation and a safe callback result in the tenant UI. Real Zendesk ticket tools use Bearer credentials.
- Disable local execution and grants before provider revocation cleanup.

## Tests

No implementation or tests yet. Required RED/GREEN uses real API/Postgres and an HTTP provider protocol fixture. Cover consent, denial, replay, expired state, two-instance refresh, invalid refresh, deletion during refresh and restart. Do not intercept fetch or call mocked-service tests E2E.

## Pending work and risks

- Complete ISSUE-253 checks before this implementation.
- Read DESIGN.md before UI edits. Run existing behavior tests before adding coverage for identified gaps.
- A live qualification run needs a Zara-owned registered OAuth client, a securely configured server secret, a registered callback and an authorized test account. The user has been asked whether these exist. Do not send secrets through chat.
- Protocol fixtures cannot establish real account compatibility. No deployment or customer-data use is authorized.

## Next step

Build and run the real-service OAuth journey as RED after ISSUE-253 is verified.
