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
- Tightened the mockup fidelity pass after visual critique: widened the public landing container to match the reference, rebuilt the hero dashed call paths as animated SVG Bezier routes from both side card stacks toward the center, reshaped the hero gradient bloom, aligned the use-case chips, replaced letter badges with animatable SVG icons, strengthened use-case card icon treatments, added top-pronounced fading service card borders, refreshed process icons, improved the workflow glass glow, and added luminous results wave artwork.
- Completed a follow-up proportion pass on the hero: increased header height and logo scale, softened the hero bloom, lifted and enlarged the display headline, tuned the CTA-to-chip spacing, increased first-viewport rhythm so services no longer intrudes into the hero/use-case viewport, and muted the results wave artwork so it reads as background proof art.
- Completed a UI-only mockup fidelity pass focused on the first viewport: compressed the hero/use-case rhythm, raised the use-case chip row, widened and softened the peach/lavender/cyan bloom, refined the dashed SVG call rays to converge through the headline, and tuned header/button/icon proportions without changing landing behavior.
- Integrated the delegated fidelity pass and made a final hero-copy lift so the headline, CTA row, chips, use-case heading, and use-case cards align with the target mockup bands at 1920px.
- Corrected the hero call-line regression: replaced the too-faint split ray fragments with stronger full-width crossing SVG paths that originate near the side-card stacks and visibly converge through the headline area.

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
- `npm.cmd run typecheck --workspace @zara/web`
  - Passed during the visual fidelity pass.
- `npx.cmd eslint apps/web/src/App.tsx`
  - Passed during the visual fidelity pass.
- `npm.cmd run build --workspace @zara/web`
  - Passed during the visual fidelity pass with the existing Vite large chunk warning.
- Browser screenshot checks on `http://127.0.0.1:4173/`
  - Captured public landing screenshots at 1440px, tall desktop, and 1920px widths in `artifacts/`, including `zara-landing-fix-pass-1920-wide-public.png`.
- Browser screenshot check on `http://127.0.0.1:4173/`
  - Captured `artifacts/zara-landing-final-rhythm-1920-public.png` after the spacing/proportion pass.
- UI test note:
  - No additional UI tests were added or run after the user explicitly requested not to spend time on tests for UI edits.
- `npm.cmd run typecheck --workspace @zara/web`
  - Passed during the UI-only fidelity pass.
- Browser visual check on `http://127.0.0.1:4173/`
  - Captured `artifacts/zara-landing-issue-130-ui-pass-final.png` at 1920px after clearing the browser's authenticated test session.
- `npm.cmd run typecheck --workspace @zara/web`, `npx.cmd eslint apps/web/src/App.tsx`, and `npm.cmd run build --workspace @zara/web`
  - Passed after integrating the delegated first-viewport fidelity pass.
- Browser visual check on `http://127.0.0.1:4173/`
  - Captured `artifacts/zara-landing-agent-integrated-1920.png` after the final hero-copy alignment tweak.
- `npm.cmd run typecheck --workspace @zara/web`, `npx.cmd eslint apps/web/src/App.tsx`, and `npm.cmd run build --workspace @zara/web`
  - Passed after the hero call-line correction.
- Browser visual check on `http://127.0.0.1:4173/`
  - Captured `artifacts/zara-landing-lines-fixed-1920.png` after increasing call-line visibility and reshaping the SVG paths.

## Pending Work

- No required acceptance work remains for ISSUE-130.
- Remaining work is visual-only if the mockup needs literal pixel parity: exact logo glyph geometry, exact generated-font metrics, and exact card micro-positioning can still be tuned against a pixel overlay.
- Future marketing work can add real customer logos, case studies, and server-rendered metadata if the public site moves beyond a Vite SPA.

## Risks And Edge Cases

- Landing metadata is client-side only in the current Vite app shell; crawler behavior depends on JavaScript execution until server rendering or prerendering is introduced.
- The landing page uses CSS-rendered product visuals and inline SVG assets so the design remains responsive, inspectable, and animatable. It is structurally matched to the mockup, but exact font metrics may differ from the generated image renderer.
- Protected tenant routes still render the sign-in form for signed-out users.

## Decisions

- Treat `/` as the public acquisition surface when signed out and the tenant dashboard when signed in.
- Use `/login` and `/signup` for dedicated auth instead of showing auth on the public landing.
- Avoid generated bitmap assets for this pass because the glass workflow builder and call cards could be implemented more sharply as responsive UI.

## Next Recommended Step

Add real proof assets and server-rendered SEO metadata when the marketing site needs production acquisition traffic.
