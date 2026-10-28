# Clonk reference adaptation

Reference: https://www.clonk.ai/ — inspected October 25, 2026.

## Evidence and scope

- RUNTIME: inspected the intro, skipped it, viewed the illustrated hero, and
  scrolled its product tour in the browser. Inspected the live heading styles:
  Instrument Sans, desktop hero 64 px, section headings around 46–56 px.
- RUNTIME: the public page uses a compact floating navigation, sans/italic
  display pairing, illustrated landscape, prominent paired actions, product
  scenes, feature choices, a three-step workflow, and expandable questions.
- PARTIAL: a source search found the creator's public GitHub profile but no
  identified licensed source repository for this homepage. No Clonk source,
  bundles, artwork, logos, analytics, or commercial claims were copied.
- IMPLEMENTATION: a fresh React/CSS adaptation in Agent-Me's existing stack.
  This is a visual/content adaptation, not a byte-identical mirror.

The evidence screenshot is stored with the local integration backup.

## Replacement map

| Reference pattern | Agent-Me implementation |
| --- | --- |
| Illustrated first screen | Original experience-valley artwork and trace selling message |
| Product tour | Functional fictional trace selection example |
| Feature storytelling | Four selectable trace use cases with native UI illustrations |
| Setup steps | Review, submit, consider an offer |
| Questions | Trace ownership, permitted sharing, offers, export, and GEPA |
| Final scenic CTA | Review selected traces or open an existing export |

Existing routes, redaction and export behavior, receipt actions, buyer review,
and the local/public boundary are preserved. No new dependencies or backend
changes are required. The built-in image generation tool produced the original
artwork. See frontend/public/images/ASSETS.md for its prompt and file details.

## Capability boundaries

Local review/export and explicit submission/receipt review are implemented.
The private workspace has GEPA Optimize Anything with selected archive examples
and held-out comparison. Model-judge scores are estimates. Harness generation,
model training, payment, and rights transfer are not performed by this page.

## Run and verification

Use the existing Agent-Me localhost server at http://localhost:5181/.
Frontend checks: npm --prefix frontend test; npm --prefix frontend run build;
npm --prefix frontend run lint. No deployment or commit is part of this change.
