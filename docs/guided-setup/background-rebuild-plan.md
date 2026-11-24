# Zenith background recreation roundtable

November 20, 2026. Implemented in the canonical UI library and synced to the local Hub preview. This file retains the original plan and records verification below.

## Direction

Recreate the existing cloud artwork as authored geometry, then animate named cloud groups. Retain the chosen asymmetric silhouettes, stepped shading, custom ZENITH lettering and blue scanline sky. The bitmap is the visual reference, not a hidden image in the replacement.

The three review perspectives were scene fidelity, motion/accessibility and renderer/integration. They agreed on a deterministic static reconstruction before animation, fixed central lettering, coherent cloud groups and no external rendering library. Two favored native inline SVG; the scene review favored Canvas2D when interpreting HTML/CSS/JavaScript as excluding SVG.

**Recommended renderer:** HTML controls, CSS composition, inline SVG paths/rectangles and a small JavaScript lifecycle controller. Inline SVG is native vector markup embedded in the page; it uses no external image asset or drawing package. Canvas2D remains the alternative if the requirement excludes SVG. Avoid thousands of HTML tiles, per-pixel color tables, raster masks, image URLs and WebGL.

## Milestones

1. **Reference specification.** Measure the 1672 × 941 source image: exact palette, stepped cloud contours, glyph shapes/spacing, shade planes, block scales and scanline intervals. Keep estimated landmarks separate from measured coordinates.
2. **Static scene.** Author sky, rear cloud banks, front cloud faces, central white plaque, shade planes and six custom glyph paths. Preserve left/right asymmetry. Use a common source coordinate system and expose a deterministic still at time zero.
3. **Visual review.** Compare at the same aspect ratio and crop, using side-by-side and half-opacity overlays. Review the wordmark and cloud regions independently so the blue sky cannot conceal a poor match. Refine major bright/dark masses before small edge fragments. Do not animate a visibly inaccurate approximation.
4. **Ambient motion.** Move a few peripheral cloud groups within small bounds, carrying each group's shading with it. Keep the central plaque, wordmark, scanlines and HTML actions stationary. Start by exploring roughly one logical cloud-cell of drift over 18–28 seconds; tune these values visually. No rotating clouds, deforming letters, random particles or pointer parallax in the first pass.
5. **Interaction and lifecycle.** Freeze atmosphere while the setup modal is open or the guide is being used. Reduced motion shows the complete static scene. Pause when hidden/offscreen; resume active time without an intro replay or jump. Use CSS transforms or one timestamp-driven animation loop updating refs, never per-frame React state.
6. **Responsive integration and release checks.** Preserve the current relationship between scene and action anchors. Keep the wordmark visible on portrait screens, crop/reposition peripheral clouds, reserve space for the guide and allow scrolling on short/zoomed screens. Verify crisp stepped edges at representative display densities. Complete canonical UI checks and commit it before syncing the exact snapshot into Hub.

## Scene and code structure

- `ZenithCloudScene.tsx`: decorative static SVG, named groups, refs and lifecycle.
- `cloud-scene-geometry.ts`: measured palette, compact authored geometry, normalized anchors and deterministic motion functions.
- `HubSetup.css`: responsive composition, fallback blue, static texture and reduced-motion styling.
- `HermesSetupLanding`: semantic HTML actions and native setup dialog; scene geometry owns no installation or configuration behavior.
- Existing guide: retain the input pill/circle and state; do not add another composer.

The decorative scene must be nonfocusable, hidden from assistive technology and ignore pointer events. Product identity and actions remain ordinary semantic HTML.

## Acceptance checklist

- [ ] Custom letter contours, widths, spacing and placement match the reference.
- [ ] Major cloud lobes, asymmetric framing and stepped depth planes match.
- [ ] No generic rounded clouds, soft blur, seams, gaps or dominant random texture.
- [ ] Deterministic still matches at desktop, portrait, short landscape and 200% zoom.
- [ ] Controls stay legible and usable; scene layers never intercept input.
- [ ] Ambient motion keeps the center steady and does not shimmer or uncover seams.
- [ ] Reduced motion, tab hiding, modal opening and guide use pause correctly.
- [ ] Resume/unmount produce no jump, duplicate loop or retained listeners.
- [ ] Actual browser performance trace shows no decorative React rerenders or layout churn.
- [ ] Canonical UI build/source checks and Hub typecheck/setup checks pass.
- [ ] Provenance, asset-copy logic, exports, documentation and changelogs reflect the replacement.

The current PNG is used by the landing and legacy welcome-art surfaces. Replace their runtime dependency only after static review; retain the reference as design evidence. Update `scripts/copy-css.mjs` and source provenance when the asset requirement changes. Do not independently edit the Hub's vendored components.

## Implementation brief

Build the deterministic static Zenith scene first in the canonical UI repository using native inline SVG, CSS and JavaScript. Reconstruct meaningful cloud formations, shade planes and exact glyph geometry from the supplied reference; do not load, embed or transcribe the bitmap pixel-by-pixel. Show the static scene in the existing welcome composition with Continue and Configure on the background, preserving the single expanded modal and guide behavior. Provide reference-aligned screenshots for visual review before adding the bounded peripheral drift described above. No setup contract, backend, profile or credential changes belong in this task.

Technical references: [SVG viewBox](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/viewBox), [requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame), [prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion).

## Implementation and review

The delivered scene uses ten hand-authored cloud formations, coherent stepped
shade planes, sparse edge tufts, six fixed glyph paths and static scanline texture.
It is an authored vector reconstruction; pixel-identical agreement with the
reference and the earlier suggested silhouette-overlap target are not claimed.

A single timestamp-driven loop changes only cloud transforms that cross a
two-source-unit grid step. The logo, central plaque and actions remain fixed.
The renderer retains active elapsed time across pauses and exposes a deterministic
`timeMs` review pose. Reduced motion returns to the reference pose; hidden/offscreen
surfaces stop scheduling frames. The guide and native setup modal remain intact.

Verified in the local browser:
- A live SVG scene with no image nodes and no bitmap CSS background.
- Live, independent bounded cloud transforms.
- An unchanged cloud pose during a setup-modal pause and the same pose on resume.
- Motion paused while the guide input is focused, resuming after minimization.
- Desktop, 390 × 844 portrait and 1000 × 500 short-landscape layouts.
- The wordmark and actions remain visible without horizontal overflow.

Canonical build, source checks and three motion-contract tests passed. Hub
typecheck and all 56 setup regression tests passed. Source imports are explicit TypeScript paths and are rewritten
to JavaScript paths for the compiled library. The imported snapshot is pinned in
`profiles/source-provenance.json`.

Further visual review can refine cloud contours and shading against the retained
reference. Direct 200% browser zoom, additional physical DPRs, an OS-level reduced
motion toggle and a detailed browser performance trace were not exercised in this
verification; they remain qualification checks rather than claimed results.
