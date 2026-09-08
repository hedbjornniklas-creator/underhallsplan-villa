export const BESIKT_INVITE_MODULES = {
  inspections: 'Överlåtelsebesiktning', construction_inspections: 'Entreprenadbesiktning', technical_investigations: 'Tekniska utredningar',
} as const
export type BesiktInviteModule = keyof typeof BESIKT_INVITE_MODULES
export const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
export const isInviteToken = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
export type BesiktInvitation = {
  id: string; email: string; full_name: string; organization_name: string; organization_id: string | null
  modules: BesiktInviteModule[]; status: 'pending' | 'accepted' | 'revoked'; expires_at: string
  notification_state: 'pending' | 'accepted' | 'failed'; revision: number; created_at: string
}
export type InvitationDraft = { request_id: string; email: string; full_name: string; organization_id: string | null; organization_name: string; modules: BesiktInviteModule[] }
export function validateInvitationDraft(input: unknown): InvitationDraft | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const value = input as Record<string, unknown>
  if (!isUuid(value.request_id)) return null
  if (typeof value.email !== 'string' || value.email.length > 254 || /[\u0000-\u001f\u007f]/.test(value.email) || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.email)) return null
  for (const field of ['full_name', 'organization_name']) {
    if (typeof value[field] !== 'string' || (value[field] as string).length > 160 || /[\u0000-\u001f\u007f]/.test(value[field] as string)) return null
  }
  if (!(value.full_name as string).trim()) return null
  if (value.organization_id !== null && !isUuid(value.organization_id)) return null
  if (!value.organization_id && !(value.organization_name as string).trim()) return null
  if (!Array.isArray(value.modules) || !value.modules.length || value.modules.length > 3 || !value.modules.every(key => typeof key === 'string' && Object.hasOwn(BESIKT_INVITE_MODULES, key))) return null
  return { request_id: value.request_id, email: value.email.toLowerCase(), full_name: (value.full_name as string).trim(), organization_id: value.organization_id as string | null,
    organization_name: (value.organization_name as string).trim(), modules: [...new Set(value.modules)] as BesiktInviteModule[] }
}
export function inviteMessage(code: string) {
  const messages: Record<string, string> = {
    INVITES_DISABLED: 'Inbjudningar är inte aktiverade ännu.', INVITE_INVALID: 'Länken är ogiltig, återkallad eller har gått ut. Be om en ny inbjudan.',
    INVITE_CONFLICT: 'Inbjudan har ändrats. Hämta listan igen.', INVITE_EMAIL_MISMATCH: 'Du är inloggad med en annan e-postadress. Byt konto för att fortsätta.',
    EXISTING_USER_LOGIN_REQUIRED: 'Det finns redan ett konto med den här adressen. Logga in med ditt befintliga lösenord.',
    LOGIN_REQUIRED: 'Logga in för att fortsätta.', INVITE_ORG_CONFLICT: 'Kontot har redan en företagskoppling som behöver kontrolleras. Kontakta oss innan du fortsätter.',
    INVITE_ACCESS_CONFLICT: 'Kontot har redan BesiktApp-behörighet. Vi behöver kontrollera den manuellt innan tillgången ändras.',
    INVITE_CATALOG_REQUIRED: 'Arbetsområdena är inte klara för aktivering. Kontakta oss.', INVITE_PASSWORD_REQUIRED: 'Välj ett lösenord med minst 12 tecken.',
    INVITE_STORAGE_REQUIRED: 'Databasen för inbjudningar behöver installeras.', INVITE_MAIL_CONFIG: 'Mejlavsändare och webbplatsadress behöver konfigureras innan inbjudningar kan skickas.',
    INVITE_ACCOUNT_CREATED: 'Kontot skapades, men tillgången kunde inte aktiveras. Logga in med ditt nya lösenord och försök igen. Kontakta oss om felet kvarstår.',
  }
  return messages[code] ?? 'Kunde inte hantera inbjudan. Försök igen eller kontakta oss.'
}
