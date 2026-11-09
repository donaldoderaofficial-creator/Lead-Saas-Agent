# Dispatch Pro QR Code

Idea:                Add a scannable Dispatch Pro link to the public landing page.
Chosen option:       A compact QR link in the existing footer; it keeps scanning available without adding a new landing-page section.
Riskiest assumption: The generated PNG is served from both static publishing roots and encodes the live app URL.
Prototype plan:      Validate the PNG signature and its expected link and image references in both landing pages.
Files touched:       public/index.html, public/dispatch-pro-qr.png, netlify-static/index.html, netlify-static/dispatch-pro-qr.png, test/dispatch-pro-qr.test.js, docs/designs/dispatch-pro-qr.md
Config/env:          None.
Rollback:            Revert the footer link, test, brief, and static image additions.
Done when:           Both landing pages show a responsive, accessible QR image that opens https://lead-saas-agent.netlify.app; `npm test` passes.

## Assumptions

- The QR should open the live Dispatch Pro site on another device.
- Place a small image beside the existing footer text so the page's original structure and calls to action remain unchanged.
- Netlify currently publishes `public/`; mirror the image and markup in `netlify-static/` for the alternate static copy.
- No new QR generation dependency is needed; the PNG was already generated with the existing `qrcode` package.

## Options considered

| Option | Value | Effort (5=low) | Risk (5=low) | Reversibility | Fit with codebase |
|--------|-------|----------------|--------------|---------------|-------------------|
| Add a small QR link to the existing footer | 4 | 5 | 5 | 5 | 5 |
| Put a responsive share card before the final CTA | 4 | 3 | 5 | 5 | 5 |
| Add the QR to the hero | 3 | 3 | 5 | 5 | 4 |

The footer link is recommended: it preserves the original conversion flow and makes only a small, reversible visual change.

## Outcome

- Added a compact 76px QR link to the existing footer on both static landing-page copies.
- Copied the same QR image into both static publishing roots.
- Validation: `npm test` passed (91 tests); QR PNG signatures, encoded live-app URL, and mirrored static page references were verified.
