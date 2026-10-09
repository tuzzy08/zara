# ISSUE-130: Voice agent agency landing and dedicated auth page

External: [Linear ZAR-139](https://linear.app/zara-voice/issue/ZAR-139/issue-130-voice-agent-agency-landing-and-dedicated-auth-page)

## Status

Implemented and deployed. The 2026-10-09 Zhara landing-page changes run in Dokploy at commit `2e4414ba4c362fd4f941ed237d204e7ba22d4c26` (PR #125). Earlier local-only notes below are historical.

## Goal

Implement the public Zara Voice Automation landing page as a voice-agent agency site and move tenant access onto dedicated auth routes.

## Work Completed

- Removed the abandoned 3D Glass Workbench redesign and restored the previously implemented voice-agent agency landing page.
- Removed the missing-scene import, workflow-scene data, React Three Fiber/Three.js dependencies, and orphaned `workbench-*` styles so the landing no longer carries a partial redesign path.

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

- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "voice-agent agency landing" --pool=forks --fileParallelism=false`
  - Passed after restoring the previous landing implementation.
- `npm.cmd run typecheck --workspace @zara/web`
  - Passed after removing the 3D redesign.
- `npm.cmd run build --workspace @zara/web`
  - Passed after removing the 3D redesign, with the existing large-chunk warning.

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
- The landing page uses responsive CSS/inline-SVG product visuals plus an optimized generated WebP hero poster. The poster is deliberately isolated so an approved video can replace it without changing the page structure.
- Protected tenant routes still render the sign-in form for signed-out users.

## Decisions

- Treat `/` as the public acquisition surface when signed out and the tenant dashboard when signed in.
- Use `/login` and `/signup` for dedicated auth instead of showing auth on the public landing.
- Keep product-interface evidence responsive and inspectable; the later monochrome redesign supersedes the original no-bitmap decision only for its approved hero poster.

## Next Recommended Step

Add real proof assets and server-rendered SEO metadata when the marketing site needs production acquisition traffic.

## Monochrome Editorial Redesign Pass (2026-07-22)

### Work Completed

- Rebuilt the signed-out `/` landing as a full monochrome editorial experience with a fixed signal-system header, cinematic switchboard hero, capabilities, measurement model, common call patterns, workflow-builder proof, illustrative telemetry, operating approach, interactive feature controls, integrations, proof, FAQ, and closing CTA.
- Added the approved text-free switchboard still as responsive 960px and 1672px WebP posters under `apps/web/public/marketing/`, isolated as a replaceable hero media layer.
- Added responsive desktop, tablet, and mobile layouts plus `prefers-reduced-motion` behavior in an isolated landing stylesheet.
- Updated public-route assertions and added focused component coverage for the redesigned content and primary navigation actions.
- Updated `DESIGN.md`, the roadmap marketing note, and ISSUE-130 acceptance wording to make the monochrome signal system the current public-marketing direction.
- Closed the dual-review findings by removing dead/misdirected controls, replacing unsupported proof claims with a measurement model and clearly illustrative telemetry, fixing gauge text layering, preserving mobile Sign in/Product navigation, simplifying feature controls to accessible pressed buttons, and reconciling stale handover decisions.

### Tests Run

- `npm.cmd run typecheck --workspace @zara/web` — passed.
- `npm.cmd run build --workspace @zara/web` — passed with the existing Vite large-chunk warning.
- `npx.cmd eslint apps/web/src/MarketingLandingPageMockup.tsx apps/web/src/MarketingLandingPageMockup.test.tsx` — passed.
- `npm.cmd run test:run -- apps/web/src/MarketingLandingPageMockup.test.tsx --pool=threads` — blocked before test import because the Vitest worker timed out after 60 seconds; no test result was produced. The same environment-level worker-start failure occurred during the RED attempt.
- Headless Chrome/CDP review on `http://127.0.0.1:4176/` — inspected every major section in individual small-step captures at 1440×1200 and 390×844. Verified the complete desktop/mobile sequence from hero through footer, corrected the signal-film mark and operating-principle card during the pass, and confirmed `scrollWidth === clientWidth` at every mobile section anchor.

### Pending Work

- No required redesign implementation remains. Replace the hero still with an approved video when a stronger motion asset is available.

### Risks And Edge Cases

- The responsive WebP hero posters are approximately 34 KB and 88 KB; an approved production video should retain an optimized poster and add responsive encodes.
- The focused test exists but could not execute in this environment because Vitest workers did not start; rerun it when the local worker issue is resolved.

### Decisions

- Keep the static hero rather than shipping the rejected video.
- Keep the landing visual system isolated from tenant-app CSS and make hero media replacement a single-source change.
- Preserve ISSUE-130 as Implemented because all required acceptance work remains complete.

### Next Recommended Step

Review the static hero in the deployed environment, then replace only the hero media source when an approved motion version is ready.

## Landing Scroll-Container Correction (2026-07-22)

### Work Completed

- Corrected the redesigned landing root to provide its own `100dvh` vertical scroll container inside Zara's globally fixed application shell.
- Added a focused CSS contract regression assertion so the landing cannot silently revert to a non-scrollable `overflow: clip` root.
- Confirmed that all 15 landing sections were already present; the global `body { overflow: hidden; }` rule had made only the hero reachable.

### Tests Run

- `vite build` for `apps/web` — passed with the existing large-chunk warning.
- Focused Vitest attempt for `MarketingLandingPageMockup.test.tsx` — blocked before test discovery because both thread and fork workers timed out while starting in the local Windows environment.
- In-app browser audit on `http://127.0.0.1:4175/` — passed. Verified a 720px-high landing scroll container with 13,793px of content and audited the full page in 600px increments through manifesto, capabilities, outcomes, signal system, patterns, product, telemetry, approach, features, integrations, proof, principles, FAQ, final CTA, and footer.

### Pending Work

- No required acceptance work remains for ISSUE-130.

### Risks And Decisions

- Keep global body scrolling locked for authenticated application shells; the public marketing route owns its scrolling locally.
- The focused regression test is present but should be rerun once the local Vitest worker-start issue is resolved.

### Next Recommended Step

Review the complete landing page in the normal development session; hero-video replacement remains an independent future media change.

## Armory Fidelity And Motion Pass (2026-07-22)

### Work Completed

- Audited the Armory reference and Zara landing end to end in fixed 400px Computer Use increments, then rebuilt the public landing around the resulting layout, icon, density, and motion findings.
- Replaced stock Lucide marketing iconography with a bespoke sixteen-glyph thin-stroke Zara signal family.
- Added a DOM-built hero routing console layered over the approved switchboard poster, with independently animated switches, dials, route paths, meters, ports, lamps, and readouts.
- Replaced repeated viewport-like panels with a continuous twelve-column editorial grid and more varied section rhythm.
- Rebuilt workflow proof as an eleven-node branching operating canvas with status chrome, minimap, animated paths, policy, memory, tools, handoff, and replay evidence.
- Rebuilt telemetry as six coordinated instruments and expanded feature, integration, proof, principle, FAQ, closing, and footer compositions.
- Preserved the route-owned vertical scroll container and comprehensive `prefers-reduced-motion` fallback.

### Tests Run

- RED: focused landing test failed because the live routing surface, custom glyph family, dense workflow nodes, and expanded telemetry instruments did not exist.
- GREEN: focused `MarketingLandingPageMockup.test.tsx` smoke/interaction test — passed.
- `tsc -p apps/web/tsconfig.json --pretty false` — passed.
- `vite build` for `apps/web` — passed with the existing large-chunk warning.
- `eslint` for `MarketingLandingPageMockup.tsx` and its focused test — passed.
- Repository-wide and `apps/web/src` Vitest regression runs were both attempted with one worker and each exceeded the five-minute command limit without returning a result; neither produced a pass or failure result.
- Computer Use review on the existing local Zara tab — completed 33 sequential 400px inspections at 670×466 and a second 33-step pass at 1536×816; both reached the footer without observed blocking overlap or clipping at the inspected viewport.
- Two-axis staged-diff review found and corrected invalid CSS bar-height expressions, mobile workflow canvas/node width divergence, test-hook styling coupling, brittle UI source/inventory assertions, and untyped marketing data tuples.

### Pending Work

- A matched narrow-mobile Armory/Zara comparison remains pending. The full-width Zara pass is complete, but Computer Use stopped when its Chrome URL-policy verifier could not confidently validate navigation from the local page to Armory for the paired 1536×816 reference pass. Broader regression suites should also be rerun in an environment where the Windows Vitest worker can complete within the available command window.

### Risks And Decisions

- The approved poster remains as atmospheric depth, but all important hero motion is now independently animatable DOM/CSS rather than baked into the image.
- The public marketing route owns its custom icon language; tenant and admin product surfaces may continue using Lucide for operational UI.
- The page intentionally adapts Armory's compositional discipline without copying its assets, claims, or product copy.

### Next Recommended Step

Complete the paired Armory comparison at full desktop and narrow-mobile widths when Computer Use can validate both URLs, then replace only the atmospheric poster when an approved video is available.

## Precision Glyph Replacement (2026-07-29)

### Work Completed

- Replaced the rejected freehand-looking marketing glyphs with a sixteen-symbol precision family built on one 48-unit optical grid.
- Standardized the family around rounded terminals and joins, a 1.5-unit primary stroke, and a quieter 1-unit secondary construction layer.
- Redrew routing, agent, handoff, memory, phone, waveform, policy, tool, observability, network, calendar, commerce, cloud, signal, code, and completion symbols from scratch.
- Removed the skewed pseudo-3D glyph presentation and rotating case-card treatment in favor of upright geometry, controlled optical lift, and restrained depth.

### Tests Run

- RED: focused landing test failed under the fork pool because the rendered glyph SVG did not yet expose the required rounded linecap and linejoin contract.
- GREEN: `npm.cmd run test:run -- apps/web/src/MarketingLandingPageMockup.test.tsx --pool=forks --fileParallelism=false` — passed, 1 test.
- Thread-pool attempt remained blocked by the existing Vitest worker-start timeout before import.
- `npm.cmd run typecheck --workspace @zara/web` — passed.
- `npm.cmd exec eslint apps/web/src/MarketingLandingPageMockup.tsx apps/web/src/MarketingLandingPageMockup.test.tsx` — passed.
- `npm.cmd run build --workspace @zara/web` — passed with the existing large-chunk warning.
- Browser review at `http://127.0.0.1:4175/` — checked the large capability and call-pattern symbols plus small telemetry usage; the family remained crisp and legible across those scales.

### Pending Work

- No required glyph replacement work remains.

### Risks And Decisions

- Keep the marketing family bespoke rather than substituting stock Lucide icons.
- Use secondary construction marks sparingly so 22–27px workflow and telemetry instances remain legible.

### Next Recommended Step

Review the revised glyph family in the normal landing preview and identify any individual metaphor that should change; geometry and presentation should continue to follow the shared precision system.

## Hero Route Diagram Correction (2026-08-09)

### Work Completed

- Rebuilt the hero route diagram so its paths, nodes, labels, and ports share one responsive SVG coordinate system.
- Attached every path endpoint to the exact center of a visible node port.
- Added left and right ports to the bidirectional route, agent, and tool nodes.
- Increased node size, label size, node stroke width, port size, and route stroke width.
- Added a restrained semantic palette: cyan call input, amber routing, violet agent, coral tool, and green human transfer.
- Changed the blinking live status light from white to green.

### Tests Run

- RED: focused landing test failed because the route map had no accessible SVG contract, no bidirectional port groups, and no live-status class.
- GREEN: `npm.cmd run test:run -- apps/web/src/MarketingLandingPageMockup.test.tsx --pool=threads --fileParallelism=false` passed, 1 test.
- `npm.cmd run typecheck --workspace @zara/web` passed.
- `npm.cmd exec eslint apps/web/src/MarketingLandingPageMockup.tsx apps/web/src/MarketingLandingPageMockup.test.tsx` passed.
- `npm.cmd run build --workspace @zara/web` passed with the existing large-chunk warning.
- Browser review at 1440 x 900, 917 x 685, and 390 x 844 confirmed connected endpoints, visible labels, distinct node colors, and the green live light.

### Pending Work

- No required route diagram correction remains.

### Risks And Decisions

- Keep all route geometry inside one SVG. Do not return to separate percentage-positioned HTML nodes over an unrelated SVG path layer.
- Keep color limited to the diagram and live state so the larger monochrome marketing direction remains intact.

### Next Recommended Step

Review the updated hero in the normal landing preview. Change only individual color values or node labels if the product language changes.

## Measurement Grid Alignment (2026-08-09)

### Work Completed

- Made the measurement introduction span the full twelve-column grid.
- Centered the section label, heading, and supporting text.
- Moved the P50 / P95 card into the same grid row as Live and $/Call on desktop.
- Preserved the existing single-column metric stack on small screens.

### Tests Run

- RED: the focused landing test failed because the measurement introduction did not have the full-row layout contract.
- GREEN: `npm.cmd run test:run -- apps/web/src/MarketingLandingPageMockup.test.tsx --pool=threads --fileParallelism=false` passed, 2 tests.
- `npm.cmd run typecheck --workspace @zara/web` passed.
- `npm.cmd exec eslint apps/web/src/MarketingLandingPageMockup.tsx apps/web/src/MarketingLandingPageMockup.test.tsx` passed.
- `npm.cmd run build --workspace @zara/web` passed with the existing large-chunk warning.
- Browser review at 1920 x 900 confirmed one aligned desktop metric row and centered section text. The small-screen stack remains intact.

### Pending Work

- No required measurement alignment work remains.

### Risks And Decisions

- Keep the measurement introduction as a full-row grid item. A partial-width introduction lets the first metric fill the remaining columns and creates the rejected staggered layout.

### Next Recommended Step

Review the measurement section in the normal landing preview and adjust only its vertical spacing if a denser section is preferred.

## Workflow Preview Geometry Correction (2026-08-09)

### Work Completed

- Rebuilt the workflow preview as one responsive SVG with shared node, port, and edge coordinates.
- Replaced percentage-positioned HTML nodes over a separate SVG path layer.
- Added exact left and right ports to the nine intermediate workflow nodes.
- Added exact source and target ports to Incoming call and Resolved.
- Connected all twelve visible paths to port centers.
- Preserved the horizontally inspectable small-screen canvas so node labels remain readable.

### Tests Run

- RED: the focused landing test failed because the workflow preview had no connected SVG contract or explicit workflow ports.
- GREEN: `npm.cmd run test:run -- apps/web/src/MarketingLandingPageMockup.test.tsx --pool=threads --fileParallelism=false` passed, 3 tests.
- `npm.cmd run typecheck --workspace @zara/web` passed.
- `npm.cmd exec eslint apps/web/src/MarketingLandingPageMockup.tsx apps/web/src/MarketingLandingPageMockup.test.tsx` passed.
- `npm.cmd run build --workspace @zara/web` passed with the existing large-chunk warning.
- Browser review at 1790 x 787 confirmed that all desktop paths terminate at visible ports. The 390 x 844 review confirmed the readable horizontal canvas behavior.

### Pending Work

- No required workflow preview alignment work remains.

### Risks And Decisions

- Keep workflow preview geometry in one SVG. Separate percentage-positioned nodes and paths will drift at responsive sizes.
- Keep the small-screen canvas scrollable. Scaling the complete graph into the mobile viewport makes its labels too small.

### Next Recommended Step

Review the corrected workflow graph in the normal landing preview. Change path routing only when the illustrated workflow model changes.

## Approved Pricing Section (2026-08-13)

### Work Completed

- Added a primary and footer Pricing anchor.
- Added an editorial rate sheet for Starter, Growth, Scale, and the $5 prepaid PAYG offer using the approved production billing values.
- Added generic workspace-creation actions, a highlighted Growth plan, trial limits, overage terms, the approved Nigeria outbound telephony price, the PAYG zero-balance stop, and concise tax and reset notes.
- Preserved the monochrome signal grid on desktop and changed the rate sheet to one readable column on mobile.

### Tests Run

- RED: the focused landing test failed because the Pricing link and section did not exist.
- GREEN: the focused fork-pool landing suite passed, 4 tests.
- Web type-check passed.
- Focused landing ESLint passed.
- Web production build passed with the existing large JavaScript chunk warning.
- Browser review passed at 1440 × 1000 and 390 × 844. The pricing section had no horizontal overflow at either size.

### Pending Work

- No required pricing-section work remains.

### Risks And Decisions

- Keep pricing values synchronized with `docs/Production-Billing-Standard.md` and the active catalog.
- Do not add discounts or package claims without commercial approval.

### Next Recommended Step

Use deployed catalog data when the public site gains a server-rendered marketing data path. Until then, update this rate sheet with every approved catalog change.


## Armory Comparison And Refinement (2026-10-08)

### Reference And Scope

- Compared the live Zara page at https://zharaai.com/ with the user-confirmed https://armory.framer.ai/ and its `/pricing` page in the Codex in-app browser.
- Kept approved Zara subscription prices, runtime quantities, overage rates, prepaid credit, trial terms, product claims, and dedicated auth routes.

### Work Completed

- Rebuilt pricing as a semantic comparison table with shared row labels, aligned plan summaries and actions, and a continuous dark Growth column on a light surface.
- Added named plan actions to `/signup`, retained the PAYG row, and made billing notes readable.
- Added a named, keyboard-scrollable mobile comparison region with fixed row labels and a scroll hint.
- Replaced the outline glyphs with an original, consistent pixel family. Each glyph uses one SVG path to limit DOM size.
- Matched the reference's lower-left hero headline and upper-right capability list. Moved the existing animated routing console into the operating-approach section.
- Reduced visible grid lines from twelve to four, aligned desktop section introductions, relaxed heading tracking and line height, enlarged body copy, and standardized striped labels and icon-tile buttons.
- Replaced stacked use-case rows with three desktop columns, corrected the uneven telemetry/proof grids, and removed decorative arrows that looked like links from non-interactive use-case panels.
- Preserved shared SVG coordinates for workflow nodes, ports, and paths, and kept the mobile workflow canvas horizontally inspectable.
- Updated DESIGN.md to record the current reference and layout rules.

### Comparison Record

| Area | Reference | Former Zara page | Resolution |
| --- | --- | --- | --- |
| Pricing | Light four-column comparison, dark Growth column | Three independent dark cards, repeated labels, undersized section heading | Shared semantic table and consistent heading scale |
| Hero | Full background, headline below left, capabilities above right | Dim background and a large foreground console | Brighter approved poster and matching composition; console moved to approach |
| Icons and actions | Pixel-style marks, contrasting icon tiles | Thin outline glyphs and small text arrows | One pixel family and common action treatment |
| Grid and type | Four visible columns and regular sans headings | Twelve lines and compressed headings | Four visible columns, aligned introductions, readable body text |
| Repeated panels | Balanced rows with varied composition | Orphan proof card and uneven telemetry rows | Complete desktop rows and mobile stacks |

### Tests And Browser Checks

- RED: the existing signed-out acquisition smoke test failed because `Compare subscription plans` did not exist.
- GREEN: the new table, named plan actions, and Growth-to-signup assertions passed in the subsequent focused run. No decorative CSS or source-text tests were added.
- The broader four-test app run passed the new acquisition check and two tenant-context checks, but its unchanged sign-out check failed while waiting for `/`. An isolated sign-out recheck also exceeded its time limit. This is a remaining test limitation; no authentication production code was changed.
- Web typecheck and scoped ESLint passed. UI-smoke boundary passed: 9 approved files, 25 declared tests.
- Web production build passed with the existing large-chunk warning.
- Browser review at 1280×720, 1440×1000, and 390×844: meaningful content, no framework overlay, no page-level horizontal overflow, no relevant console warnings/errors, desktop pricing alignment, mobile fixed labels and keyboard horizontal scroll, hero/capability composition, workflow ports, feature selection, FAQ expansion, and Growth-to-signup navigation.
- Screenshots are saved outside the repository in this chat's visualization directory.

### Pending Work

- No required landing refinement remains.
- Deploy the reviewed change through the normal release process when requested.
- Investigate the broader sign-out test failure separately before treating the whole app suite as green.

### Risks And Decisions

- This is a local implementation, not a production deployment.
- Reference fidelity uses Zara's own artwork, prices, wording, and capabilities. Armory's company logos, customer claims, service prices, and annual billing toggle were not copied.
- The marketing page still owns its scroll container because the tenant application locks body scrolling.
- Mobile pricing intentionally scrolls horizontally to preserve cross-plan row alignment; row labels stay visible.

### Next Recommended Step

Review the local page, then include the change in the normal release after the separate auth test limitation is resolved.

## Zhara Services And Layout Follow-up (2026-10-09)

### Work Completed

- Changed all visible landing-page brand text, accessible labels, page title, and initial HTML title to Zhara. Internal package names and existing image filenames remain stable.
- Added voice agents, non-voice agents, go-to-market tasks, and company workflow automation to the hero, capabilities, practical examples, FAQ, and closing copy. The voice-specific product preview remains a voice example.
- Replaced Scale's displayed $499 monthly price and signup action with one Contact sales link to the user-supplied sales@zharaai.com address. Other plan values and backend billing rules are unchanged.
- Removed the marked trial and billing-note paragraphs, repeated Operational signal labels, and Our approach section. Removed the console component and its now-unused styles.
- Fixed the closing button's excess space by restricting the section icon style to its direct child. The button now measures 44px tall.
- Enlarged integration icons from 38px to 72px, removed negative label spacing, and increased label size. Adjusted the footer wordmark for the longer name.
- Updated DESIGN.md, the backlog, roadmap, and Linear ZAR-139.

### Tests Run

- RED: the updated acquisition smoke test failed because the Contact sales link was missing. A browser assertion also failed for the same missing action. The initial forks run could not start a worker; retrying with threads produced the expected assertion failure.
- GREEN: the focused acquisition test passed with the sales mailto target, Zhara home label, Starter/Growth signup links, and Growth-to-signup navigation.
- REFACTOR: the same focused test passed after removing the unused approach component and CSS. One passed, three unrelated tests skipped.
- Passed web TypeScript check, scoped ESLint, test-boundary check (9 files / 25 tests), and production build. The existing large-chunk build warning remains.
- Browser review used the in-app browser at the normal desktop size, 1440x1000, and 390x844. Verified visible content, no error overlay, no relevant console warnings/errors, no page-level horizontal overflow, sales destination, keyboard access to Scale, 44px closing button, 72px integration icons, removed text, and the Act control state change.
- Screenshots are stored outside the repository in this chat's visualization directory.

### Pending Work, Risks, And Decisions

- No required implementation work remains for this landing-page pass. Changes are local only.
- The Our approach instruction was interpreted as removal of the whole section, as stated to the user. A later correction can restore that section.
- The brand change is scoped to the public landing page; package identifiers and tenant/auth UI are outside this page pass.
- Mailto destination was checked without sending an email. Delivery and the visitor's mail application are not tested.
- The prior unrelated sign-out smoke failure remains recorded; this pass does not claim the full app suite is green.

### Next Recommended Step

Review the local page and include the change in the normal release process when requested.

## Commit Preparation (2026-10-09)

- Prepared the completed landing-page changes for the user-requested commit. Included only ISSUE-130 entries from the shared backlog and roadmap.
- Retained the completed test and browser evidence above; no production code changed in this pass.
- The local server returned HTTP 200 during preview recovery. A fresh in-app browser tab displayed the page with no console errors. No server or page-code change was needed.
- Status remains Implemented. Deployment and the separate sign-out test limitation remain pending as recorded above.

## PR 125 CI Repair (2026-10-09)

### Work Completed

- Replaced the stale four-card and four-signup-link assertions with accessible plan actions in the approved comparison table. Starter, Growth, and prepaid credit still lead to signup; Scale leads to the approved sales address and has no signup action.
- Changed only the existing smoke test and this handover. No production UI, pricing, auth, or billing code changed. Status remains Implemented; production deployment is pending PR checks.

### Tests Run

- RED evidence: CI run 37902020376 on PR 125 head 89a21aa failed at the old four-article assertion (expected four, received one). The remaining 2,251 tests passed; 54 were skipped. Migration Check and GitGuardian passed.
- GREEN: `npx vitest run apps/web/src/MarketingLandingPageMockup.test.tsx --pool=threads --maxWorkers=1` passed, one test.
- Related regression: `npx vitest run apps/web/src/MarketingLandingPageMockup.test.tsx apps/web/src/app.test.tsx --pool=threads --maxWorkers=1` passed, five tests. This includes the previously recorded sign-out test; that earlier local limitation did not recur.
- Scoped ESLint, `npm run test:boundaries` (9 files / 25 tests), and `git diff --check` passed.
- An earlier local test process exited before producing a result. No result from that attempt is treated as a pass.

### Pending Work, Risks, And Next Step

- Push the test repair, require all PR checks to pass, merge to dev, and require the merge commit checks to pass before the authorized Dokploy release.
- Production remains at b000517. Billing charge delivery stays disabled. No checks were bypassed and no paid test was run.
- This test checks navigation and plan actions, not invoice calculations or email delivery. No instrumentation or production refactor was needed because the CI failure directly identified a stale presentation assertion.

## Verified Production Release (2026-10-09)

### Work Completed And Checks

- PR https://github.com/tuzzy08/zara/pull/125 merged into dev only after CI, Migration Check, GitGuardian, and preview checks passed on cdf7291. Merge commit `2e4414ba4c362fd4f941ed237d204e7ba22d4c26` then passed CI run 37912956418 and Migration Check 37912956447. No separate GitGuardian merge check was emitted; both commits have identical Git tree `a2449fb32fc40c7d0476d0448a761931c2d4d9f2`, so the checked content is unchanged.
- Published immutable tag `zara-dokploy-20261009-2e4414b`. Dokploy cloned that exact SHA and completed a build-only job before replacement. Restored and verified its normal native Compose command before deployment. Final deployment completed successfully in 26 seconds.
- Native Environment changes were limited to SOURCE_COMMIT, ZARA_RELEASE_ID, PSTN_WORKER_RELEASE_ID, and fresh PSTN_WORKER_ID `zara-dokploy-20261009-03`. Existing secrets were retained without display; clipboard was cleared. BILLING_CHARGE_DELIVERY_ENABLED remains false. Generated environment file permissions were restored to 600.
- Worker readiness showed zero active and starting calls before SIGTERM/drain. Old worker exited 0 at 09:56:50 UTC; replacement started at 09:57:24 UTC. No old/new worker overlap occurred. New worker is registered, ready, and has 20 free slots. API and worker release IDs match the exact deployed commit.
- Seven services are healthy; migration and storage initializer exited 0. Unchanged data services and platform-admin image were retained by Compose. All six normal-TLS HTTP checks returned 200: apex, www, admin, API readiness, auth readiness, and realtime readiness.
- Browser verified the new Zhara landing, named pricing table, approved Scale sales mailto, Growth-to-signup navigation, and sign-in screen. No landing console warnings or errors were observed. Evidence screenshot is stored outside the repository as `release-2e4414b-pricing.png` in this chat's visualization directory.
- Fresh pre-release logical database backup: `/home/ubuntu/zara-migration-20261009/pre-release-2e4414b.dump`, SHA256 `daf0e4c1aeab9641d0f6b0be8d20d833f6c9e465859dbbcb7ad16fd3daeba72b`. Archive listing passed. Existing migration backup sets, volumes, and the old stopped Coolify deployment were not changed.

### Pending Work And Risks

- No required work remains for this release. Stop the PR release monitor after recording completion.
- Owner sign-in with an existing account and genuine paid testing were not performed. Billing enable remains a separate owner action. The sales link was checked without sending email.
- No HA, recurring backup/PITR, or API shutdown-hook changes were added. The prior migration limitations remain recorded under ISSUE-249. This release did not bypass checks or change production billing rules.
