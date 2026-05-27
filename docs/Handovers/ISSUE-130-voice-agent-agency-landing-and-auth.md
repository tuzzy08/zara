# ISSUE-130: Voice agent agency landing and dedicated auth page

## Status

Implemented.

## Goal

Implement the public Zara Voice Automation landing page as a voice-agent agency site and move tenant access onto dedicated auth routes.

## Work Completed

- Added signed-out `/` routing to render a public marketing landing page instead of the tenant auth card.
- Added a voice-agent agency landing with SEO-oriented copy, service sections, glass workflow-builder proof, process, results, pricing, final CTA, and footer.
- Added client-side title and description metadata for the landing page.
- Kept `/login` and `/signup` as dedicated tenant auth routes and redirect authenticated auth-route visits back to the tenant app.
- Restyled auth screens with the landing gradient/glass treatment while keeping the compact tenant form.
- Updated `DESIGN.md`, `docs/Roadmap.md`, and `docs/Issue-Backlog.md` to record the new marketing/auth direction.
- Revised the landing page toward a 1:1 implementation of the approved mockup, including centered hero composition, floating call/transcript/routing cards, dotted call lines, use-case chips, use-case cards, service cards, richer workflow-builder mockup, four-step process, dark results band, pricing packages, testimonials, FAQ, final CTA, and detailed footer.
- Saved verification screenshots to `artifacts/zara-landing-1to1-desktop.png` and `artifacts/zara-landing-1to1-mobile.png`.

## Tests Run

- RED: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "voice-agent agency landing|dedicated auth page" --pool=threads`
  - Failed as expected because signed-out `/` still rendered the auth card.
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "voice-agent agency landing|dedicated auth page" --pool=threads`
  - Passed: 2 targeted tests.
- `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=threads`
  - Passed: 28 tests.
- `npm.cmd run typecheck --workspace @zara/web`
  - Passed.
- `npm.cmd run build --workspace @zara/web`
  - Passed with the existing Vite large chunk warning.
- Browser smoke on `http://127.0.0.1:4173/`
  - Confirmed landing title, SEO title, desktop render, and mobile render with no horizontal overflow.
- Browser smoke on `http://127.0.0.1:4173/login`
  - Confirmed dedicated auth page renders the sign-in card.
- RED: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "voice-agent agency landing" --pool=forks --fileParallelism=false`
  - Failed as expected after adding mockup-specific assertions for the centered hero and missing downstream sections.
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "voice-agent agency landing" --pool=forks --fileParallelism=false`
  - Passed after implementing the mockup sections.
- Full regression: `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=forks --fileParallelism=false`
  - Passed: 28 tests.
- `npm.cmd run typecheck --workspace @zara/web`
  - Passed.
- `npx.cmd eslint apps/web/src/App.tsx apps/web/src/app.test.tsx`
  - Passed.
- `npm.cmd run build --workspace @zara/web`
  - Passed with the existing Vite large chunk warning.
- Browser smoke on `http://127.0.0.1:4173/`
  - Confirmed updated desktop hero matches the mockup structure and mobile has no horizontal overflow.

## Pending Work

- No required acceptance work remains for ISSUE-130.
- Future marketing work can add real customer logos, case studies, and server-rendered metadata if the public site moves beyond a Vite SPA.

## Risks And Edge Cases

- Landing metadata is client-side only in the current Vite app shell; crawler behavior depends on JavaScript execution until server rendering or prerendering is introduced.
- The landing page uses CSS-rendered product visuals instead of image assets so the design remains responsive and inspectable. It is structurally matched to the mockup, but exact font metrics may differ from the generated image renderer.
- Protected tenant routes still render the sign-in form for signed-out users.

## Decisions

- Treat `/` as the public acquisition surface when signed out and the tenant dashboard when signed in.
- Use `/login` and `/signup` for dedicated auth instead of showing auth on the public landing.
- Avoid generated bitmap assets for this pass because the glass workflow builder and call cards could be implemented more sharply as responsive UI.

## Next Recommended Step

Add real proof assets and server-rendered SEO metadata when the marketing site needs production acquisition traffic.
