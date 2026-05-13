# Frontend Architecture

## Applications

Zara uses two separate Vite React applications.

- `apps/web`: tenant-facing product app for dashboard, builder, sandbox, telephony, integrations, memory, monitoring, and billing.
- `apps/platform-admin`: internal Zara staff app for platform operations, tenant oversight, provider health, billing operations, audit, abuse review, and impersonation.

The apps are separate because they have different audiences, risk profiles, navigation, deployment origins, and security policies.

## Stack Choice

The default frontend stack for both apps is:

- React + Vite
- Tailwind CSS v4
- shadcn/ui for component primitives
- Lucide for icons
- React Flow in `apps/web` for the workflow builder canvas

This stack is a foundation, not a visual prescription. Components must be customized to match `DESIGN.md` and should not ship with stock shadcn copy or default presentation styling.

## Tenant Workflow Builder

The tenant workflow builder lives in `apps/web` at `/workflows` and uses `@xyflow/react` 12.10.2. The current builder surface implements ISSUE-009 through ISSUE-017 and now supports a publishable workflow draft:

- React Flow canvas with add, move, connect, and delete interactions.
- Agent role nodes with instructions, role type, language policy, default model tier, and reusable-specialist setting.
- Tool nodes with connector binding, credential state, risk posture, approval posture, and API request metadata for webhook-style actions.
- Handoff nodes that target a valid specialist role and carry a handoff reason.
- Condition nodes with branch expressions, route targets, and required fallback behavior.
- Exit nodes that terminate the workflow cleanly.
- Human escalation nodes with queue binding, fallback mode, and fallback message.
- Shared `@zara/core` workflow graph helpers for deterministic serialization and validation.
- Draft manifest preview for runtime, telephony, memory, budget, tool bindings, handoffs, condition routes, exit nodes, and escalation policy.
- Immutable version publishing with active-call pinning.
- Existing edges can be reconnected in the canvas so tenants can rearrange flow without deleting and recreating links.
- Builder nodes use kind-specific accent borders and matching icon colors, and the same accents are reflected in the minimap.

Node creation stays in the top toolbar. On desktop, the builder uses an approximately 75:25 canvas-to-inspector split so the visualizer stays primary and the inspector remains secondary.

The builder UI should remain operational and dense. Avoid landing-page sections, scaffold copy, repeated hero cards, and decorative content inside the builder surface.

## Suggested Origins

- Local tenant app: `http://localhost:5173`
- Local platform admin app: `http://localhost:5174`
- Production tenant app: `https://app.zara.ai`
- Production platform admin app: `https://admin.zara.ai`
- API: `https://api.zara.ai`

Staging should mirror this shape with staging subdomains.

## Shared Packages

- `packages/ui`: reusable UI primitives and design tokens.
- `packages/api-client`: typed API client and request helpers.
- `packages/auth-client`: Better Auth React client setup shared where safe.
- `packages/core`: shared domain types.

Shared code must not weaken app separation. Platform-admin-only components and dangerous operations stay inside `apps/platform-admin`.

`packages/ui` should wrap and customize shared shadcn/ui primitives where that helps consistency, while keeping app-specific compositions inside each app.

## Auth

Both apps use the same NestJS-hosted Better Auth backend and cookie/session authority. Better Auth trusted origins must include both app origins for local, staging, and production.

Frontend guards are only UX. NestJS guards enforce all authorization.

Tenant app auth rules:

- authenticated session required
- active organization required
- tenant role required for tenant resources

Platform admin app auth rules:

- authenticated session required
- platform role required
- tenant organization membership is not sufficient

## Testing

Keep UI tests light. Smoke-test login gates, tenant app shell, builder load, platform admin shell, and impersonation banner. Put deeper coverage in API, guard, domain, and integration tests.
