import type { PublicProductId } from './publicNavigation'
import { RENOAPP_CASE_PRICE, RENOAPP_CASE_INCLUDED } from './renoapp/pricing'

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
    renoapp: {
      enabled: true,
      content: {
        heading: 'Ingen abonnemangsavgift.',
        introduction: 'Det kostar inget att ansluta föreningen eller att ta emot en ansökan. Ni betalar när styrelsen väljer att starta handläggningen, inte när den boende skickar in sin ansökan.',
        plans: [{
          name: 'Handläggning av renoveringsärende',
          price: RENOAPP_CASE_PRICE,
          billing: 'per ärende, exklusive moms',
          features: ['Underlag, kommunikation och beslut samlade i samma ärende.', RENOAPP_CASE_INCLUDED, 'Ingen löpande avgift mellan ärendena.'],
        }],
        taxNote: 'Priset är exklusive moms. Att starta handläggningen är inte samma sak som att godkänna renoveringen. Personlig rådgivning och sakkunnig granskning ingår inte och beställs separat.',
      },
    },
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
