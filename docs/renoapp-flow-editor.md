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

- Drag the grip onto empty space to reposition a card and its complete descendant
  branch. Lines follow it. Stored positions of collapsed descendants move too;
  newly expanded cards inherit their positioned ancestor. Positions
  are stored locally per renovation type in this browser, independently of configuration.
  The reset icon resets placement, not business rules. Zoom and fit controls are available.
- Drop onto a compatible card to change its parent connection. The preview names
  the old and new parent. Only the explicit confirmation changes configuration.
  The arrow icon provides the same workflow using a select control, including on mobile.
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
  permission grants, shared occurrences, request validation and route authorization.
- `node scripts/test-renoapp-flow-editor-ui.mjs`: real flow-builder rendering with mock
  endpoints; actual pointer dragging, line movement, local persistence, copy/removal,
  reparent/cancel, missing migration and stale apply; desktop/tablet/mobile screenshots.
- `node scripts/test-renoapp-classification-ui.mjs`: existing board-summary and admin
  editor regression coverage.
