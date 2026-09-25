# OB Image Trash

## Behavior

- Papperskorg is below Att bearbeta and collapsed by default. Opening it loads
  deleted images for the current inspection/building, newest first.
- Images can be enlarged and restored for 30 days after deletion. Restoration
  returns an unlinked image to its surviving place, or unplaced if that place
  was removed. It does not recreate notes or rooms.
- Restore uses a new image identity. The old deletion tombstone remains to
  prevent delayed offline writes from resurrecting the old record.
- Existing archived deletions within the window are eligible, provided their
  original storage file still exists. This is not a replacement for backups.
- Locked, completed and paused inspections cannot restore images. Reads and
  writes require the inspection owner's active organization membership.
- Historical reports, snapshots and their files are never modified.

## Rollout

Run `docs/db/2026-09-25_01_ob_image_trash.sql` after the existing OB round and
building migrations, before publishing the application changes. It is additive
and repeatable. No production SQL or image restoration was run during development.
An absent migration returns an explicit unavailable message, not an empty trash.

The 30 days are an enforced RESTORATION WINDOW, not a storage retention job.
Expired archive rows and physical files remain retained in this version.
Automatic purging is deferred until reference checks can protect historical
reports and other retained copies. Deleting an entire inspection is outside
this feature and may remove its archive through existing cascades.

## Verification

- SQL regressions: `node --experimental-strip-types --test test/ob-buildings.test.ts`
- UI regressions: `node scripts/test-ob-mobile-round-ui.mjs --image-trash-only`
- Type check: `npx tsc --noEmit`

## Production Verification, 2026-09-25

- User confirmed the SQL was run and explicitly authorized publication.
- Read-only RPC preflight reached the production function and returned
  `OB_ROUND_FORBIDDEN` for synthetic identities, confirming deployment and guard.
- Source commit: `e9d6221`; isolated release on current main: `6bed6a9`.
  The backup-only recovery test fixture is not included in the production branch.
- All 61 scoped tests passed on the isolated release, along with the trash
  browser suite at four viewport sizes and `next build --webpack` (62 pages).
  The local build used placeholder Supabase settings, not production credentials.
- Fast-forward push to main triggered successful Vercel deployment
  `dpl_915jbv1SemprEgWhENhgb59P5SpZ`.
- The public login page identifies that deployment. Anonymous image-trash GET
  returns HTTP 401, `Cache-Control: no-store`, and `Inte inloggad.`
- No production inspection/image writes, restoration, deletion or emails were
  performed. Authenticated production UI restoration remains for user checking;
  synthetic tests are not an authenticated live test.
