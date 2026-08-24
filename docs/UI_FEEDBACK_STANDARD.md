# HusHub UI feedback standard

All modules use the global `AppToastProvider` from `src/app/layout.tsx` and the
`useToast()` hook from `src/components/ui/AppToastProvider.tsx`.

## Use a toast for

- a completed user action, such as saved, sent, uploaded or deleted;
- a recoverable action error where the user can retry;
- a warning or informational result that does not require a page decision.

Use `success`, `error`, `warning` or `info`. Preserve the Swedish, user-facing
message returned by the API. A multi-step operation should show one final toast,
not one toast per internal step.

## Do not use a toast for

- field validation: show the message next to the affected field;
- a page or workspace that cannot load: show a persistent page-level state;
- access denied or missing database setup: show a persistent page-level state;
- destructive decisions: use a confirmation dialog before the action;
- content the user must copy or act on later, such as a personal link: keep it
  visible on the page.

## Behaviour

- Desktop: upper-right corner.
- Mobile: full safe width at the top, respecting the device safe area.
- Success and information are announced politely; errors and warnings are
  announced immediately.
- Toasts close automatically according to their tone and always have a manual
  close button.
- Identical messages are deduplicated and no more than five are shown.

The legacy EB `EbToastProvider` and `useEbToast()` are compatibility adapters to
the same global queue. New code must use `useToast()` directly.
