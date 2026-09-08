import { PUBLIC_BESIKTAPP_CONTACT_EMAIL, PUBLIC_COMPANY_INFO } from '@/lib/publicCompanyInfo'
import { normalizeEbFollowUpEmail, type EbFollowUpSeller } from '@/lib/eb/followUp'

/** This is a HusHub service, not a product sold by the inspecting organisation. */
export function getEbFollowUpPlatformSeller(): EbFollowUpSeller | null {
  const company = PUBLIC_COMPANY_INFO
  const name = company.name.trim()
  const orgNumber = company.organizationNumber.trim()
  const street = company.address.street.trim()
  const postalCode = company.address.postalCode.trim()
  const city = company.address.city.trim()
  // Reuse the explicitly approved public BesiktApp contact, not a tenant profile
  // or a mail-provider credential. Admin's invoice recipient remains separate.
  const email = normalizeEbFollowUpEmail(PUBLIC_BESIKTAPP_CONTACT_EMAIL)
  if (!name || !orgNumber || !street || !postalCode || !city || !email) return null
  return { name, orgNumber, address: `${street}, ${postalCode} ${city}`, email, phone: null }
}
