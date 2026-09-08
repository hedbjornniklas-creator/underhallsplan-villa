# RenoApp flow editor

## Deployment

1. Run the complete `docs/db/2026-09-08_03_renoapp_flow_editor.sql` in Supabase.
   This adds one restricted view and one service-role-only transactional function.
   It does not migrate case data or change any existing flow automatically.
2. Deploy the application. Existing editor actions remain available. If the new RPC
   is missing, reconnection displays an error and never falls back to separate writes.
3. Test with a disposable renovation type: move a requirement from the root to an
   answer, then from Yes to No; cancel a preview; copy and remove a card. Reload and
   verify both the diagram and the applicant questions/requirements.

## Interaction

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
- Answer cards can be positioned, copied and deleted but cannot be reassigned to
  another question. This protects the meaning of stored applicant answers. Move the
  whole question instead. The action root cannot be reparented.
- Copy and removal reuse existing editor services. Removing a linked card removes
  its connection, not the reusable object. Removing an answer affects every use of
  its question. Deleting an action root is explicitly confirmed as a global deletion.
  Global deletion of other objects remains in the editor panel.
- Existing copy semantics are retained: a question copy includes its own answer
  options, but downstream targets remain shared. An action-root copy copies settings
  without links; the confirmation states this. This is not a deep subtree clone.
  A canvas copy is attached directly to the selected recipient, leaving the source
  untouched. Answers may be copied to questions; other linked cards use the same
  recipient types as moves. Descendants are excluded to prevent recursive copies.
  Copying retains existing create/link services and requires no additional SQL.

## Safety and limitations

The database validates source identity, parent identity, active targets, duplicate
connections and recursive question cycles. BRF-specific overrides are not moveable
through this editor. Custom per-link settings which answer triggers cannot represent
(optional requirements, custom phase, notes) block that move rather than disappearing.

Preview is read-only. Apply locks the configuration tables for a short transaction,
compares their current fingerprint with the confirmed preview, inserts the destination
and removes the source atomically. A conflict, timeout or error rolls back the move.
The UI does not blindly retry uncertain writes; it reloads configuration.

Shared question/answer/document/participant connections are global configuration.
Confirmation warns that every flow using these parents is affected. The move does
not write case records or send completion emails. This is not per-case versioning:
existing application behavior for resolving updated configuration remains unchanged.

The transaction and optimistic guard apply to the new move operation. Other existing
editor/AI actions have their existing persistence behavior, not a newly added transaction.
No production migration or live administrative mutation is run by the automated tests.

## Verification

- `npm run test:renoapp-flow-editor`: isolated PGlite migration, guards, rollback,
  permission grants, shared occurrences, request validation, route authorization
  and compact layout checks with variable-height cards and wide branches.
- `node scripts/test-renoapp-flow-editor-ui.mjs`: real flow-builder rendering with mock
  endpoints; actual pointer dragging, line movement, local persistence, copy/removal,
  click-to-move/copy, destination highlighting, cancel/Escape, missing migration,
  failed copy and stale apply; desktop/tablet/mobile screenshots including a dense
  kitchen fixture with long questions and nearby requirements.
- `node scripts/test-renoapp-classification-ui.mjs`: existing board-summary and admin
  editor regression coverage.
