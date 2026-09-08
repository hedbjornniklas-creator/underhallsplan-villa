# RenoApp flow editor

## Deployment

1. Run the complete `docs/db/2026-09-08_03_renoapp_flow_editor.sql` in Supabase.
   This adds one restricted view and one service-role-only transactional function.
   It does not migrate case data or change any existing flow automatically.
2. Run the complete `docs/db/2026-09-08_08_renoapp_flow_reuse.sql`. It adds a shared
   transactional function for move/copy/unlink and preserves the existing move RPC.
   No definitions, links or case data are changed by the migration. Old independent
   copies are not merged or removed automatically.
3. Deploy the application. If the required RPC is missing, the operation displays
   an error and never falls back to creating definitions or separate writes.
4. Test with a disposable renovation type: move a requirement from the root to an
   answer, then from Yes to No; cancel a preview; copy and remove a card. Reload and
   verify both the diagram and the applicant questions/requirements.

## Interaction

- Selecting a renovation type opens all its branches expanded, including after
  returning to a previously collapsed flow. Manual collapse choices remain during
  editing, saving and refresh. Reset view returns to the fully expanded default.
- The read-only overview includes every edit field, explicit Yes/No values for
  participant requirements, and named connections rather than counts alone.
  Inactive answers and connections remain visible with their status. Question
  details use the current editor draft, just like the other node types.
- Cards are 224px wide and use their measured content height (about 83px for a
  one-line answer, up to 117px for three title lines). The d3-flextree layout keeps
  sibling answers in their own branch, with 40px between columns and 16-24px between
  cards. Expanding a branch recalculates bounds without changing connections.
- Compact placement uses browser storage version `v2`, so old absolute positions
  do not retain the previous oversized gaps. Old `v1` data is left untouched.
- Drag the grip onto empty space to reposition a card and its complete descendant
  branch. Lines follow it. Stored positions of collapsed descendants move too;
  newly expanded cards inherit their positioned ancestor. Positions
  are stored locally per renovation type in this browser, independently of configuration.
  The reset icon resets placement, not business rules. Zoom and fit controls are available.
- Drop onto a compatible card to change its parent connection. The preview names
  the old and new parent. Only the explicit confirmation changes configuration.
- The move and copy icons start a destination-selection mode on the canvas, without
  a dropdown or blocking dialog. Eligible recipient cards have a green outline and
  a full-card target button; the source is blue and invalid recipients are faded.
  Branches can still be expanded and the canvas panned/zoomed while choosing.
  Select a recipient by click, touch or keyboard, then confirm. Escape or Cancel
  leaves configuration unchanged. After saving, the view fits the updated diagram.
- Questions, documents and participants can move between action roots and answers.
  Flags can also move to documents and participants. The selected renovation type
  defines which destinations are visible in the diagram.
- Copy adds one connection to the existing question/document/participant/flag.
  Its full branch follows by reference, including the same question, answer and
  downstream object IDs. There is no new definition, key or "(kopia)" label.
  Existing connections remain intact. Changing the shared definition or its
  descendants affects all uses; the confirmation states this explicitly.
- Removal deletes only the selected connection row, never a definition, answer or
  descendant. Both canvas and editor-panel removal use the same guarded RPC.
  If the parent is shared, removing its outgoing connection affects all occurrences
  of that parent, not just one drawing. The confirmation warns about this scope.
- Root and answer cards have no independently removable parent connection. They
  can be positioned and edited, but no longer expose copy/delete icons. Reuse or
  move the whole question. Global deletion and independent object cloning are not
  offered in the flow editor toolbar; reusable definitions have separate catalog pages.
- Copy uses the same destination types as move. Existing direct connections and
  recursive descendants cannot be chosen. Server validation is authoritative.

## Background saving

The editor uses the shared `useAutosaveQueue`, as in RenoApp case decisions and
TU editing. Its flow-specific adapter serializes confirmed commands instead of
merging away intermediate operations. The queue belongs to the page, so switching
renovation types does not discard a pending save or switch the user back afterward.

Saving a draft leaves the editor responsive. Pending drafts can be reopened before
the server answers; older responses never replace currently edited input. Ordinary
edits merge the returned item into the local configuration instead of re-fetching
all nine configuration endpoints. Question/answer details use an admin-only PATCH
which updates only the selected row, without rewriting options, triggers or keys.
Unchanged root-link settings are not sent except when an earlier link save is pending.

Confirmed move/copy/unlink closes its confirmation and runs in the same queue.
Topology controls wait for the refreshed configuration, but panning, zooming,
expansion and draft editing remain available. Preview fingerprints are still
checked; a stale preview is never silently retried. Structural additions refresh
configuration before the next queued command. Older refresh responses cannot
overwrite a newer edit. This change requires an application deployment, not new SQL.

The page and editor show pending saves and named errors. Failed draft snapshots can
be reopened; writes are never retried automatically. An acknowledged new definition
is reused when recovering a partially failed addition. Browser close/reload and
ordinary navigation links warn while saves or unacknowledged errors remain. The
queue is in memory, not an offline outbox: do not force-close the tab before saving
finishes. Existing multi-step create/add operations are not made transactional.

## Safety and limitations

The database validates source identity, parent identity, active targets, duplicate
connections and recursive question cycles. BRF-specific overrides are not moveable
through this editor. Custom per-link settings which answer triggers cannot represent
(optional requirements, custom phase, notes) block move/copy rather than disappearing.

Preview is read-only. Apply locks the configuration tables for a short transaction,
compares their fingerprint and the operation/source/target with the confirmed preview.
Move inserts the destination and removes the source; copy only inserts; unlink only
removes the selected source connection. All operations are atomic. A conflict,
timeout or error rolls back the operation.
The UI does not blindly retry uncertain writes; it reloads configuration.

Shared question/answer/document/participant connections are global configuration.
Confirmation warns that every flow using these parents is affected. The editor does
not write case records or send completion emails. This is not per-case versioning:
existing application behavior for resolving updated configuration remains unchanged.

The transaction and optimistic guard apply to move, copy and unlink. Other existing
editor/AI actions have their existing persistence behavior, not a newly added transaction.
No production migration or live administrative mutation is run by the automated tests.

## Verification

- `npm run test:renoapp-flow-editor`: isolated PGlite migration, guards, rollback,
  permission grants, shared occurrences, request validation, route authorization
  and compact layout checks with variable-height cards and wide branches; narrow
  question/answer update scope, validation and authorization.
- `node scripts/test-renoapp-flow-editor-ui.mjs`: real flow-builder rendering with mock
  endpoints; actual pointer dragging, line movement, local persistence, copy/removal,
  click-to-move/copy, destination highlighting, cancel/Escape, missing migration,
  failed copy and stale apply; desktop/tablet/mobile screenshots including a dense
  kitchen fixture. Reusing a complete question branch, unlinking and reloading must
  leave the original definitions, answers and descendants unchanged.
  Delayed writes under React StrictMode exercise FIFO saves, pending draft reopening,
  error recovery, stale reads, flow switching and Save + New without losing input.
- `node scripts/test-renoapp-classification-ui.mjs`: existing board-summary and admin
  editor regression coverage; overview/edit field parity for all node types,
  inactive items, unsaved question text and long content on desktop/mobile.
