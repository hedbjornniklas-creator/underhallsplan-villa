import type { PublicProductId } from './publicNavigation'

export type Publication<T> =
  | { enabled: false; content: T | null }
  | { enabled: true; content: T }

export type PublicPricing = {
  heading: string
  introduction: string
  plans: {
    name: string
    price: string
    billing: string
    features: string[]
  }[]
  taxNote: string
}

export type PublicContact = {
  heading: string
  introduction: string
  companyName: string
  email?: string
  phone?: string
  address?: string
}

// Public content only. Mail recipients and other server settings never belong here.
// Fill in content and enable the relevant section when it is ready to publish.
export const PUBLIC_COMMERCIAL_CONTENT: {
  pricing: Record<PublicProductId, Publication<PublicPricing>>
  contact: Publication<PublicContact>
} = {
  pricing: {
    besiktapp: { enabled: false, content: null },
    renoapp: { enabled: false, content: null },
  },
  contact: { enabled: false, content: null },
}

export function publishedPricing(section: Publication<PublicPricing>): PublicPricing | null {
  const value = section.content
  if (!section.enabled || !value || !value.heading.trim() || !value.introduction.trim() || !value.taxNote.trim()) return null
  if (!value.plans.length || value.plans.some(plan => !plan.name.trim() || !plan.price.trim() || !plan.billing.trim() || !plan.features.length || plan.features.some(feature => !feature.trim()))) return null
  return value
}

export function publishedContact(section: Publication<PublicContact>): PublicContact | null {
  const value = section.content
  if (!section.enabled || !value || !value.heading.trim() || !value.introduction.trim() || !value.companyName.trim()) return null
  if (!value.email?.trim() && !value.phone?.trim()) return null
  return value
}
