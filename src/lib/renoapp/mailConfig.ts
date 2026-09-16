const DEFAULT_RENOAPP_MAIL_FROM = 'RenoApp <meddelanden@renoapp.se>'

export function getRenoAppMailFromAddress() {
  // Never fall back to the shared HusHub sender: it belongs to other modules.
  return process.env.RENOAPP_MAIL_FROM?.trim() || DEFAULT_RENOAPP_MAIL_FROM
}
