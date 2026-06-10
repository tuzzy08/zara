# ISSUE-008: React dashboard shell

External: [GitHub #8](https://github.com/tuzzy08/zara/issues/8)

Issue link: https://github.com/tuzzy08/zara/issues/8

## Goal

Deliver React dashboard shell for the Frontend area in the MVP Builder milestone.

## Acceptance Criteria

- Authenticated shell renders tenant navigation
- Critical route smoke test exists
- UI tests stay minimal

## Status

- Status: done
- Completion: 100%

## Work Completed

- Turned `apps/web` into a real Vite React application with `index.html`, `vite.config.ts`, `main.tsx`, and production shell styles.
- Built the tenant dashboard shell in `apps/web/src/App.tsx` with authenticated-state navigation, top command/search surface, operations summary, live queue, workflow table, and agent roster.
- Added a focused route smoke test in `apps/web/src/app.test.tsx` that verifies the tenant shell and route content without expanding UI test scope.
- Wired the web workspace for JSX and Vite build scripts in `apps/web/package.json` and `apps/web/tsconfig.json`.

## Completed This Pass

- Generated a concept image from `DESIGN.md` and used it as the implementation reference for the shell layout and tone.
- Replaced the placeholder workspace entrypoint with a real app surface rather than shipping any starter content or scaffold copy.
- Verified the shell in-browser on desktop and mobile after the code-side TDD pass.
- Hardened the shell breakpoint behavior with explicit CSS media queries after a desktop browser reproduced the app in a narrow mobile-style layout.
- Rebuilt the shell layout as a two-row app grid: fixed topbar, fixed desktop sidebar, and a dedicated scrolling main region.
- Added a profile menu dark mode toggle and persisted the theme preference in local storage.
- Moved major dashboard grids to container-query breakpoints so they respond to available main content width instead of raw viewport width.
- Added a desktop-shell viewport guard for desktop browsers that report a compressed CSS viewport while the outer browser window is wide.
- Replaced the dashboard home page's sidebar-link directory with API-backed operational metrics for published workflows, routed numbers, tool grants, memory approvals, connector health, billing usage, call dispatch state, workspace members, and recent workspace activity.
- Removed the stale dashboard dummy content and status-pill style metrics from the tenant landing page.

## Tests Run

- RED: `npm.cmd run test:run -- apps/web/src/app.test.tsx`
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx`
- Verification: `npm.cmd run typecheck`
- Verification: `npm.cmd run lint`
- Verification: `npm.cmd run build --workspace @zara/web`
- Verification: browser check on `http://127.0.0.1:4173/workflows` for desktop and mobile shell render
- Verification: browser re-check at `1440px` width confirmed the desktop sidebar and full-width main surface after the breakpoint fix
- Verification: `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=threads`
- Verification: browser re-check at `1534x813` confirmed zero document overflow, main scroll range, fixed header, and fixed sidebar
- Verification: browser re-check at `390x844` confirmed mobile hides the sidebar and keeps main scrolling without horizontal overflow
- Verification: profile menu dark mode toggle changed `document.documentElement.dataset.theme` to `dark`
- Verification: simulated compressed desktop viewport confirmed the shell expands to the outer desktop width and forces desktop navigation
- Verification: concept image review at `C:\Users\Lenovo\.codex\generated_images\019e11af-9b2e-7822-bc0d-fcca0673d9fc\ig_08db2f5200788687016a01e260dc4881918e931c90fc22cdb0.png`
- RED: `npm.cmd run test:run -- --pool=forks --fileParallelism=false --testTimeout=30000 apps/web/src/app.test.tsx -t "renders the dashboard with real workspace metrics"`
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false --testTimeout=30000 apps/web/src/app.test.tsx -t "renders the dashboard with real workspace metrics"`
- Verification: `npm.cmd run typecheck`
- Verification: `npx.cmd eslint apps/web/src/App.tsx apps/web/src/app.test.tsx`
- Verification: `npm.cmd run build --workspace @zara/web`
- Verification: `npm.cmd run test:run -- --pool=forks --fileParallelism=false --testTimeout=30000 apps/web/src/app.test.tsx`
- Verification: browser check on `http://127.0.0.1:4173/` with mocked auth and tenant APIs confirmed the dashboard shows real metric cards, removes `Workspace sections`, and reports no browser warnings or page errors.
- Note: an app-test run started in parallel with build timed out; the same app test file was rerun serially and passed.

## Remaining Work

- None for issue completion. Real auth state, tenant selection flows, and frontend auth client wiring are tracked in later issues such as issue `#83`, issue `#85`, and issue `#86`.

## Risks And Edge Cases

- No tenant selected
- Small viewport navigation

## Decisions

- Priority: P1
- Labels: frontend, tdd-required
- Handover docs are mandatory for every pass on this issue.
- The dashboard shell is intentionally operational and table-driven from the first screen; no marketing hero, placeholder cards, or starter copy were added.
- UI testing stays minimal here: one smoke test for the authenticated tenant shell, with deeper auth and workflow coverage deferred to later issues.
- The current shell uses a tight custom Tailwind surface and Lucide icons; shared shadcn wrappers can be introduced later without changing the shell's information architecture.
- The shell uses CSS grid for the fixed application frame and container queries for dashboard content grids. This avoids viewport-only breakpoints that can fail on browser zoom or scaled displays.
- Desktop-shell override is intentionally limited to fine-pointer desktop environments where `window.outerWidth` is much wider than the reported CSS viewport.
- The dashboard home page is a metrics surface, not a navigation duplicate. It reads from existing tenant API clients and local published-workflow registry state instead of hardcoded operational numbers.

## Next Recommended Step

Issue complete. Read `AGENTS.md`, `docs/PRD.md`, `docs/Architecture.md`, `docs/Roadmap.md`, and the next active handover before starting the next issue.
