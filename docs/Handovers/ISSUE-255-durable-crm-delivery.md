# ISSUE-255: Durable call summaries and CRM delivery

Status: Pending
External: [GitHub #136](https://github.com/tuzzy08/zara/issues/136)
Dependencies: [ISSUE-253](ISSUE-253-durable-integrations.md), [ISSUE-254](ISSUE-254-zendesk-oauth.md)

## Scope and completed investigation

Complete the first Stage 2 customer journey with a published browser receptionist call, a durable summary and one useful Zendesk ticket. The current summary, retry and status routes require process-local session maps. They record delivery intent without a worker. Existing ISSUE-060 remains complete for its earlier intent-only scope.

## Design decisions

- Persist bounded, redacted evidence from actual call events with tenant, workspace, call and published-version identity. Do not make all live runtime state durable.
- Save summary and delivery intent in one transaction. Deduplicate the business action across summary revisions.
- Keep the provider payload fixed once delivery starts. Store a stable key and first dispatch time.
- Use bounded database claims, leases and retries. Recheck current connection and tool authority before provider requests.
- Read and retry by durable call identity and current workspace membership, without a live session map.
- Zendesk ticket-create idempotency keys expire after two hours. An uncertain result outside the safe window requires review. Do not claim unlimited duplicate protection from the header. See [Zendesk Ticketing API](https://developer.zendesk.com/api-reference/ticketing/introduction/).

## Tests

No implementation or tests yet. Use real API/Postgres and HTTP/WebSocket protocol fixtures. Start with existing feature behavior tests. Then prove the missing full journey from signup and publication through browser audio, provider tool work, summary, explicit 429, restart, eventual delivery, repeated summary requests and one remote ticket. Verify usage identity, cross-tenant denial and revoked workspace access. Include a lost-response case and inspect actual fixture ticket state.

## Pending work and risks

- Complete the shared storage and OAuth dependencies.
- Read the routed runtime and provider lifecycle docs before changing speech endpoint configuration or runtime event handling.
- A browser journey is not PSTN evidence. Phone-call qualification needs an additional bounded evidence hook and the existing Twilio protocol caller.
- Keep live qualification separate from local protocol proof. Preserve billing release gates. Do not deploy.

## Next step

Add the failing durable summary/delivery journey after the OAuth slice is verified.
