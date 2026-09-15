# Guarded Android test - 2026-09-14

Status: remote HTTPS entry and browser smoke checks pass. The user confirmed
camera, multiple-image selection, hardware Back and text/image persistence after
airplane mode on Android. **No production deployment or migration occurred.**

## Running setup

- Only the approved Supabase test project `lodbgdbmfdtdzfaezblx` is used.
- A new synthetic, non-admin inspector owns a separate Android test property and
  inspection with two buildings. It can read only its own property. Original
  click-test data is not reused or reseeded.
- The previously verified optimized build runs on a new loopback-only port with
  a sanitized staging environment. Its 731 source files were compared against
  the current workspace before starting. No development server is exposed.
- A separate loopback gateway requires a random access code and issues an
  expiring Secure/HttpOnly/SameSite session cookie. The real staging Auth cookies
  belong to the new test inspector, not an administrator.
- The gateway forwards only this inspection's page/API routes, required static
  files and staging image URLs. Other inspections, local test auto-login,
  integrations, administrator pages, report delivery and page server-action
  POSTs are blocked. Mutations require the exact trusted Origin.
- A temporary Cloudflare Quick Tunnel exposes only that gateway. The computer
  and test processes must remain running. The test window expires after eight
  hours; the public URL is not a permanent staging deployment.

Cloudflare documents the temporary hostname, testing-only purpose and limits in
its [Quick Tunnel guide](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).
The Windows `cloudflared` 2026.9.1 executable was downloaded from the official
Cloudflare GitHub release and checked against its published SHA-256:
`2837888cc0f5d58f15b6dc478376de90b4d3ba5241c7947455d1e0a0df429712`.
No Cloudflare account, production DNS or existing Vercel environment was changed.

## Evidence

Private, ignored files are under `.cache/ob-staging-app/`:

- `android-fixture.json`: dedicated IDs/account credentials. Never publish it.
- `android-session.json`: current URL, access code, expiration and process IDs.
- `android-session-1789396328326/entry-verification.json`: four passing live
  check groups, including observed network origins and created synthetic IDs.
- `android-entry-390.png` and `android-note-390.png` in that session directory:
  reviewed 390px mobile screenshots. No iframe or horizontal overflow.

The live test uses a fresh headless Chrome, not the user's browser profile. It
checks anonymous rejection, real Auth login, both buildings, blocked unrelated
routes, note persistence, the actual image-selection button with two files,
exactly two linked image records, visible image rendering and browser Back to
the room. All observed browser traffic stays on the test entry and pinned staging
backend. Test notes and harmless mock-logo images remain for inspection.

Five local tests (three gateway and two existing staging-guard tests) and
targeted ESLint pass. The browser check caught `Referrer-Policy: no-referrer`
causing a null Origin on form POST. The gateway now uses `same-origin`, retaining
the strict Origin check. The initial upload probe targeted a room-level hidden
input instead of the note's selection command; the corrected probe clicks the
real button, selects two files and verifies both note links.

## Physical Android checklist

### Evening UI update

The 2026-09-14 update sets an explicit dark foreground on the white building
overview, hides the registry selector when no unused registered building can be
selected, and orders conditions/round consecutively for each building.

- Six focused rendering/navigation tests and the isolated optimized build pass.
- Browser checks pass at 360px, 390px and 1280px in both light and dark system
  themes: building-name contrast exceeds 7:1 and there is no horizontal overflow.
- The current three-building fixture was reused without reseeding. Navigation
  checks block all writes, including two existing exterior-row initializers, so
  this UI verification does not change the user's test data.
- Private evidence: `building-layout-1789410058386/result.json` and screenshots
  under `.cache/ob-staging-app/`.
- A separately named `android-session-ui-20260914.json` points to the updated
  guarded entry. Four remote checks pass: contrast, conditional selector,
  per-building menu order, and unchanged route guards with no inspection writes.
  Its session directory contains `ui-link-verification.json` and screenshots.
- The original `android-session.json` and its running tunnel are left alone.
  Finish pending text/image saves on that origin before switching to the new
  entry. Saved staging data is shared; browser-local pending work is not.

The user subsequently answered "Ja, allt fungerade" to the explicit camera,
multiple-image selection, phone Back and airplane-mode save checklist. Record
those four checks as user-accepted on 2026-09-14. This answer does not separately
confirm room swipes, every move/unlink action or closing/reopening Chrome with
pending uploads. The contrast/menu checks above remain browser evidence.

### Device checks

Open the current URL in Chrome and enter the separately supplied access code.
Start with Plan 0 and Hall in the main building.

1. Create a free note, type text and take a harmless test photo with the camera.
2. Use the image-selection button to choose several test images. Wait for saved
   state and verify each image appears once on the intended note/building.
3. Try Back, room swipes, changing buildings, moving a room/note and unlinking an
   image. Confirm that location labels and attached images follow the action.
4. With the page already open, enable airplane mode and add test text/an image.
   Reconnect and check that the local work is recovered and saved exactly once.
5. Test leaving/reopening Chrome with pending work, then reconnect. Verify the
   recovery behavior rather than assuming full offline page loading is supported.

Do not close/restart the test session or switch URLs while uploads/text are
pending. Browser-local drafts and image queues belong to that exact origin; a
new Quick Tunnel URL cannot read the old origin's local storage.

**Use only harmless test pictures, not customer documents or private photos.**
The staging `inspection-images` bucket remains public, just as in the existing
implementation. The gateway access code does not make those Storage URLs private.
Camera/gallery behavior, Android hardware Back and real offline/reopen behavior
cannot be accepted solely from desktop mobile emulation.

## Operation

`prepare-ob-android-test.mjs` refuses to overwrite an existing fixture. Do not
rerun it to clear user edits. `serve-ob-android-test.mjs` starts the guarded entry;
check for an existing live session and saved uploads before any restart. Do not
point a tunnel at port 57100 or at the optimized app directly: only the gateway
port may be exposed. Keep code/account/keys files private and outside Git.

The server accepts an optional private manifest basename, for example
`node scripts/serve-ob-android-test.mjs android-session-ui-20260914.json`.
It refuses to overwrite a manifest marked active and unexpired. A separate
manifest allows a verified update to run alongside the old origin without
interrupting that origin's pending work or overwriting its process metadata.

To stop manually on Windows, verify the recorded gateway PID still runs
`scripts/serve-ob-android-test.mjs`, then stop that process tree only. This removes
the tunnel and isolated app, not the original local test server or database data.
The gateway also expires automatically after its recorded test window.

No email delivery, customer PDF link acceptance, production backup/restore or
production rollout approval is implied by this test entry.
