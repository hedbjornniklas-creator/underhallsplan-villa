import type { OrganizationProfileCardValues, OrganizationProfileWorkspace } from './profileCardTypes'

const PERSONAL_FIELDS = ['displayName', 'title', 'phone', 'email', 'avatarPath', 'signaturePath'] as const

export function personalProfileValues(card: OrganizationProfileCardValues) {
  return {
    displayName: card.displayName, title: card.title, phone: card.phone,
    email: card.email, avatarPath: card.avatarPath, signaturePath: card.signaturePath,
  }
}

export function serializeProfileCard(card: OrganizationProfileCardValues) {
  return JSON.stringify(personalProfileValues(card))
}

export function profileValidationErrors(card: OrganizationProfileCardValues) {
  const errors: Partial<Record<'displayName' | 'title' | 'phone' | 'email', string>> = {}
  if (!card.displayName.trim()) errors.displayName = 'Ange ditt namn för att spara profilen.'
  else if (card.displayName.trim().length > 200) errors.displayName = 'Namnet får vara högst 200 tecken.'
  if ((card.title?.trim().length ?? 0) > 160) errors.title = 'Titeln får vara högst 160 tecken.'
  if ((card.phone?.trim().length ?? 0) > 80) errors.phone = 'Telefonnumret får vara högst 80 tecken.'
  const email = card.email?.trim()
  if (email && (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))) {
    errors.email = 'Ange en giltig arbetsmejl för att spara profilen.'
  }
  return errors
}

// Refresh shared company data, but never replace personal edits typed during a request.
export function mergeSavedProfileCard(
  current: OrganizationProfileCardValues,
  submitted: OrganizationProfileCardValues,
  saved: OrganizationProfileCardValues,
) {
  const merged = { ...saved }
  for (const field of PERSONAL_FIELDS) {
    if (current[field] !== submitted[field]) Object.assign(merged, { [field]: current[field] })
  }
  return merged
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function checkedProfileWorkspace(value: unknown, previous: OrganizationProfileWorkspace): OrganizationProfileWorkspace {
  if (!record(value) || !record(value.organization) || !record(value.card) || !record(value.legacyMediaAvailable)
    || value.organization.id !== previous.organization.id || value.profileId !== previous.profileId
    || (value.organization.name !== null && typeof value.organization.name !== 'string')
    || typeof value.organization.isDefault !== 'boolean'
    || !['admin', 'inspector'].includes(String(value.role))
    || value.version !== (previous.version ?? 0) + 1
    || value.source !== 'organization_card' || value.migrationRequired !== false
    || typeof value.configured !== 'boolean'
    || typeof value.card.displayName !== 'string' || typeof value.card.companyName !== 'string') {
    throw new Error('Sparandet kunde inte bekräftas för rätt profil. Dina ändringar finns kvar här.')
  }
  for (const field of ['title', 'phone', 'email', 'companyOrgNo', 'companyAddress', 'companyPostalCode', 'companyCity', 'avatarPath', 'logoPath', 'signaturePath', 'reportFooterText']) {
    if (value.card[field] !== null && typeof value.card[field] !== 'string') {
      throw new Error('Sparandet kunde inte bekräftas. Dina ändringar finns kvar här.')
    }
  }
  for (const field of ['avatarPath', 'logoPath', 'signaturePath']) {
    if (typeof value.legacyMediaAvailable[field] !== 'boolean') throw new Error('Profilens svar kunde inte läsas.')
  }
  return value as OrganizationProfileWorkspace
}

export function savedPersonalValuesMatch(saved: OrganizationProfileCardValues, submitted: OrganizationProfileCardValues) {
  return PERSONAL_FIELDS.every(field => {
    const normalize = (value: string | null) => {
      const trimmed = value?.trim() || null
      return field === 'email' ? trimmed?.toLowerCase() ?? null : trimmed
    }
    return normalize(saved[field]) === normalize(submitted[field])
  })
}
