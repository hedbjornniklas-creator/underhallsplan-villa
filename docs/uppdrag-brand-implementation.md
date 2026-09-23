# Uppdrag Brand Implementation

The v1 HusHub Uppdrag profile is applied to the existing application, not a
replacement workflow. Source assets: `output/pdf/uppdrag-brand/`.

## Scope

- `/uppdrag`: current tasks, action cases, statistics, creation and detail sheets.
- `/mina-uppdrag`: overview, statistics, login, recovery, activation and task pages.
- `/signe/[token]`: existing recipient links and first-login dialog.
- `/atgardsarende/[token]`: shared action-case files and work descriptions.
- `/offertunderlag/[token]`: supplier request and file previews.
- Expired links and recipient access-denied states use the same profile.

`/atgarder/[token]` belongs to EB and is intentionally excluded. Shared HusHub
navigation, global toasts, other modules, mail templates, APIs and database
behavior are unchanged.

## Theme Ownership

- `src/components/tasks/uppdrag-theme.css` owns the scoped palette, typography,
  focus indicators and controls. All selectors must start with `.uppdrag-scope`.
- Route layouts wrap content with `UppdragScope`. Do not add Uppdrag rules to
  global CSS or change shared components to theme a single module.
- Portals to `document.body` must explicitly include `uppdrag-scope` on their
  overlay. Do not use `uppdrag-page` on portals; it adds the page background.
- `UppdragBrand` and `public/uppdrag/brand/` own the logo and local Manrope font.
- Graphite is the main action color, pale yellow indicates selection, and
  petrol is used for links/focus. Success, warning and error remain distinct.
- Gizmo remains the assistant name, not the product identity.

## Verification

Run `node scripts/test-uppdrag-brand-ui.mjs` for real-component browser checks
at 344, 390, 1024 and 1440 pixels. It uses synthetic data and mocks authentication
and server-page reads. It checks all eight page types, side panels, image
navigation, local assets, errors, expired links and theme isolation. No live
customer changes or deliveries are performed.

Run `node scripts/test-action-case-costing-ui.mjs` for existing costing and
supplier-request regression tests. These do not validate live backend services.

For a local synthetic preview: set `PREVIEW_PORT` to an unused port and run
`node scripts/test-uppdrag-brand-ui.mjs --serve`. Artifacts are written to
`tmp/uppdrag-brand-ui/` and are ignored locally.

No migration is required for this visual update. Deploy through the normal
release workflow after reviewing only the Uppdrag-specific changes; parallel
RenoApp and OB work must not be included accidentally.
