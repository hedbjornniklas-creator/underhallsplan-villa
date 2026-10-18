/** A document-owned copy. Never resolve a historical document from a live profile. */
export type ContractSenderProfileSnapshot = {
  version: 1
  organizationId: string
  profileId: string
  profileVersion: number
  legalNameVersion: number
  legalName: string
  organizationNumber: string
  name: string
  address: string | null
  postalCode: string | null
  city: string | null
  email: string | null
  phone: string | null
  website: string | null
  logoPath: string | null
  /** Server-decoded and resized PNG, frozen with the selection (no remote fetch). */
  logoDataUrl: string | null
  reportFooterText: string | null
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function invalid(): never { throw new Error('CUSTOMER_OFFER_INVALID') }
function text(value: unknown, limit: number, nullable = false, multiline = false): string | null {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || value.length > limit ||
    (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u).test(value)) invalid()
  const result = value.trim()
  if (!nullable && !result) invalid()
  return result || null
}

export function normalizeContractSenderProfile(value: unknown): ContractSenderProfileSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  const p = value as Record<string, unknown>
  if (p.version !== 1 || typeof p.organizationId !== 'string' || !uuid.test(p.organizationId) ||
    typeof p.profileId !== 'string' || !uuid.test(p.profileId) ||
    !Number.isSafeInteger(p.profileVersion) || Number(p.profileVersion) < 1 ||
    !Number.isSafeInteger(p.legalNameVersion) || Number(p.legalNameVersion) < 1) invalid()
  const organizationId = p.organizationId.toLowerCase()
  const logoPath = text(p.logoPath, 2048, true)
  if (logoPath && !new RegExp(`^organizations/${organizationId}/logo-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(png|jpg|webp)$`, 'i').test(logoPath)) invalid()
  const logoDataUrl = text(p.logoDataUrl, 200000, true)
  // PNG only: no SVG, credentials, URLs, scriptable markup or runtime image requests.
  if (logoDataUrl && (!logoPath || !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(logoDataUrl))) invalid()
  if (logoPath && !logoDataUrl) invalid()
  const website = text(p.website, 500, true)
  if (website) {
    let parsed: URL
    try { parsed = new URL(website) } catch { invalid() }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname.includes('.')) invalid()
  }
  // Explicit projection deliberately drops any unknown/internal fields.
  return { version: 1, organizationId, profileId: p.profileId.toLowerCase(),
    profileVersion: Number(p.profileVersion), legalNameVersion: Number(p.legalNameVersion),
    legalName: text(p.legalName, 240)!, organizationNumber: text(p.organizationNumber, 40)!, name: text(p.name, 240)!,
    address: text(p.address, 300, true), postalCode: text(p.postalCode, 40, true), city: text(p.city, 160, true),
    email: text(p.email, 320, true), phone: text(p.phone, 80, true), website, logoPath, logoDataUrl,
    reportFooterText: text(p.reportFooterText, 2000, true, true) }
}
