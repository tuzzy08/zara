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
- Rebuilt the signed-out public landing page against the generated imagegen tech-agency mockup, including the browser-like page frame, two-column hero with glass call-routing cards, industry trust row, service cards, use-case columns, dark workflow proof band, five-step process, five outcome cards, gradient CTA band, and dark footer.
- Integrated the delegated glass UI refinement and final review fixes: widened the hero visual lane, corrected the lower glass-card cluster spacing, strengthened the glass card depth, and restored the luminous workflow proof wave while preserving the 864px mockup page height.
- Integrated the stricter hybrid glass-system pass: strengthened the hero studio-depth layer, made the glass panels more transparent/refractive, promoted and retuned the SVG routing graph, and pulled connector endpoints back to card edges after review so they no longer cut through content.
- Replaced the visually approximate CSS-built hero glass and workflow proof visuals with raster image assets: a regenerated imagegen hero background for the studio/glass UI and a cropped workflow proof band from the approved imagegen mockup.
- Corrected the raster hero for full-width viewports by adding a cropped hero asset with controlled background sizing, added a dedicated Pricing section and Sign in nav action, fixed the Pricing menu anchor, and increased vertical breathing room between workflow proof, process, results, pricing, and CTA sections.
- Reframed the hero raster asset to use the full generated glass image with height-based scaling so all five glass cards remain visible at wide and narrower desktop viewports.
- Updated tenant sign-out to navigate back to `/` with history replacement so the URL reflects the logged-out public landing instead of the last tenant route.

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
- `npm.cmd run typecheck --workspace @zara/web`
  - Passed during the imagegen mockup implementation pass.
- `npm.cmd run build --workspace @zara/web`
  - Passed during the imagegen mockup implementation pass with the existing Vite large chunk warning.
- Browser visual checks on `http://127.0.0.1:4173/`
  - Captured `artifacts/zara-mockup-implementation-864-v3.png` while comparing the implementation against the generated 864x1821 mockup.
- UI test note:
  - Landing-page test edits were removed after the user clarified that tests were unnecessary for this visual mockup implementation.
- Delegated visual-fidelity correction pass:
  - Captured `artifacts/zara-current-landing-review-864-v3.png` for the final 864px review.
  - Verified the rendered page height at 864px as 1825px against the 1821px imagegen mockup.
- `npm.cmd run typecheck --workspace @zara/web`
  - Passed after the delegated visual-fidelity correction pass.
- `npm.cmd run build --workspace @zara/web`
  - Passed after the delegated visual-fidelity correction pass with the existing Vite large chunk warning.
- Browser visual review on `http://127.0.0.1:4173/`
  - Captured `artifacts/zara-glass-review-864-v3.png` after the glass UI refinement pass.
  - Verified the rendered page height at 864px as 1822px against the 1821px imagegen mockup.
  - No landing-page tests were added or run, per the user's explicit instruction.
- `npm.cmd run typecheck --workspace @zara/web`
  - Passed after the glass UI refinement pass.
- `npm.cmd run build --workspace @zara/web`
  - Passed after the glass UI refinement pass with the existing Vite large chunk warning.
- Browser visual review on `http://127.0.0.1:4173/`
  - Captured `artifacts/zara-glass-final-review-864-v3.png` after the stricter hybrid glass-system pass.
  - Verified the rendered page height at 864px as 1822px against the 1821px imagegen mockup.
- `npm.cmd run typecheck --workspace @zara/web`
  - Passed after final connector geometry corrections.
- `npm.cmd run build --workspace @zara/web`
  - Passed after final connector geometry corrections with the existing Vite large chunk warning.
- Browser visual review on `http://127.0.0.1:4173/`
  - Captured `artifacts/zara-raster-hero-workflow-864.png` after switching the hero glass UI and workflow proof section to raster-backed mockup assets.
  - Verified the rendered page width stays at 864px with no horizontal overflow and the page height remains 1822px at the 864px review viewport.
- `npm.cmd run typecheck --workspace @zara/web`
  - Passed after the raster-backed hero/workflow pass.
- `npm.cmd run build --workspace @zara/web`
  - Passed after the raster-backed hero/workflow pass with the existing Vite large chunk warning.
- Browser visual review on `http://127.0.0.1:4173/`
  - Captured `artifacts/zara-wide-final-spacing-pricing.png` at 1920px and `artifacts/zara-1024-hero-pricing-spacing.png` at 1024px after the fullscreen hero crop, spacing, sign-in, pricing, and menu-anchor fixes.
  - Verified nav anchors for Services, Use cases, Process, Results, Pricing, and About all point to existing section targets.
  - Verified no horizontal overflow at 1920px or 1024px.
- `npm.cmd run typecheck --workspace @zara/web`
  - Passed after the fullscreen hero crop, spacing, sign-in, pricing, and menu-anchor fixes.
- `npm.cmd run build --workspace @zara/web`
  - Passed after the fullscreen hero crop, spacing, sign-in, pricing, and menu-anchor fixes with the existing Vite large chunk warning.
- Browser visual review on `http://127.0.0.1:4173/`
  - Captured `artifacts/zara-hero-fullcards-wide.png` and `artifacts/zara-hero-fullcards-1024.png` after reframing the hero image to keep the full glass-card cluster visible.
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "gates tenant routes behind login and supports sign out" --pool=threads --fileParallelism=false`
  - Passed after updating the existing sign-out route test to expect `/` and the public landing after logout.
- `npm.cmd run typecheck --workspace @zara/web`
  - Passed after the full-card hero framing and logout URL fix.
- `npm.cmd run build --workspace @zara/web`
  - Passed after the full-card hero framing and logout URL fix with the existing Vite large chunk warning.

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
