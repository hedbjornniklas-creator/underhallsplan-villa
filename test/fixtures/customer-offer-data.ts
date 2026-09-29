import type { ActionCaseView } from '../../src/lib/action-cases/contracts'
import type {
  CustomerOfferWorkspace,
  CustomerOfferSnapshot,
  CustomerOffer
} from '../../src/lib/action-cases/customerOffers'

export const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
export const token = 'A'.repeat(43)
export const customer = {
  id: id(2),
  role: 'customer' as const,
  name: 'Anna Exempel',
  email: 'anna@example.test',
  phone: null,
  companyName: null
}
export const actionCase: ActionCaseView = {
  id: id(1),
  title: 'Tillbyggnad vid Exempelvägen 12',
  propertyAddress: 'Exempelvägen 12, Exempelstad',
  customerName: customer.name,
  customerEmail: customer.email,
  customerPhone: null,
  sourceKind: 'manual',
  sourceReference: null,
  description: 'Internt: marginal 18 procent, UE-jämförelse och inköpspriser.',
  status: 'pricing',
  siteVisitAt: null,
  createdAt: '2026-09-29T09:00:00Z',
  updatedAt: '2026-09-29T09:00:00Z',
  participants: [customer],
  items: [],
  attachments: [
    {
      id: id(3),
      actionCaseItemId: null,
      type: 'image',
      title: 'Huset före tillbyggnaden',
      fileName: 'hus.jpg',
      contentType: 'image/jpeg',
      fileSizeBytes: 500000,
      grantedParticipantIds: [customer.id],
      createdAt: '2026-09-29T09:00:00Z'
    },
    {
      id: id(4),
      actionCaseItemId: null,
      type: 'document',
      title: 'Exempelhandling',
      fileName: 'Avtalshandling.pdf',
      contentType: 'application/pdf',
      fileSizeBytes: 1000,
      grantedParticipantIds: [],
      createdAt: '2026-09-29T09:00:00Z'
    },
    {
      id: id(5),
      actionCaseItemId: null,
      type: 'document',
      title: 'Privat UE-offert',
      fileName: 'ue-hemlig.pdf',
      contentType: 'application/pdf',
      fileSizeBytes: 1000,
      grantedParticipantIds: [],
      isQuoteDocument: true,
      createdAt: '2026-09-29T09:00:00Z'
    }
  ]
}
export const workspace: CustomerOfferWorkspace = {
  revision: 1,
  offers: [],
  draft: {
    title: 'Tillbyggnad till tätt hus',
    introduction:
      'Tillbyggnad på 28 m² med anslutning till befintligt hus. Åtagandet nedan avser tätt hus. Invändiga kompletteringar kan beställas som tillval.',
    baseAmountOre: 125000000,
    validUntil: '2099-10-31',
    contractForm: 'abs18',
    terms:
      'FIKTIV TESTOFFERT. Se bifogad exempelhandling. Denna förhandsgranskning är inte ett erbjudande om byggarbete.',
    paymentTerms:
      'Betalning enligt separat överenskommen betalplan i avtalshandlingen.',
    schedule:
      'Preliminär byggstart vecka 15. Sluttid och förutsättningar enligt avtalshandlingen.',
    attachmentIds: [id(4)],
    termsAttachmentId: id(4),
    items: [
      {
        id: id(10),
        title: 'Byggnation till tätt hus',
        scope:
          'Grund, stomme, tak, fönster och ytterdörr enligt ritning. Leverans av material och arbete ingår.',
        kind: 'included',
        amountOre: null
      },
      {
        id: id(11),
        title: 'Invändig färdigställning',
        scope:
          'Innerväggar, målning och golv i den nya delen. Kan väljas till eller utföras av beställarens egen hantverkare.',
        kind: 'option',
        amountOre: 18500000
      },
      {
        id: id(12),
        title: 'Köksinredning',
        scope: 'Köksinredning och vitvaror ingår inte i vårt åtagande.',
        kind: 'excluded',
        amountOre: null
      }
    ]
  }
}
export function snapshot(draft = workspace.draft): CustomerOfferSnapshot {
  return {
    ...draft,
    projectTitle: actionCase.title,
    propertyAddress: actionCase.propertyAddress,
    customerName: customer.name,
    customerEmail: customer.email,
    issuerName: 'Exempelbygg AB',
    replyEmail: 'byggare@example.test'
  }
}
export function itemizedWorkspace(): CustomerOfferWorkspace {
  const result = structuredClone(workspace)
  result.draft.pricingMode = 'itemized'
  result.draft.baseAmountOre = 100000000
  result.draft.items = [
    { id: id(10), title: 'Mark och grund', scope: 'Grundläggning enligt granskad ritning.', kind: 'included', amountOre: 30000000 },
    { id: id(14), title: 'Stomme och tak', scope: 'Stomme och tak. Fönster och ytterdörrar ingår inte.', kind: 'included', amountOre: 70000000 },
    { id: id(11), title: 'Altan', scope: 'Separat tillval.', kind: 'option', amountOre: 8500000 },
    { id: id(15), title: 'Fönster från Exempelfönster A', scope: 'Leverans och montage enligt separat specifikation.', kind: 'option', amountOre: 14000000, optionGroup: 'Fönsterleverantör' },
    { id: id(16), title: 'Fönster från Exempelfönster B', scope: 'Leverans och montage enligt separat specifikation.', kind: 'option', amountOre: 17500000, optionGroup: 'Fönsterleverantör' },
    { id: id(12), title: 'El och målning', scope: 'Ingår inte. Separat beställning och pris krävs för senare arbeten.', kind: 'excluded', amountOre: null }
  ]
  result.draft.title = 'FIKTIV TESTOFFERT - delpriser och leverantörsval'
  result.draft.introduction = 'Fiktiva testpriser. Detta är inte offerten för Lokevägen 6.'
  return result
}
export function published(draft = workspace.draft): CustomerOffer {
  return {
    id: id(20),
    version: 1,
    status: 'published',
    snapshot: snapshot(draft),
    files: [
      {
        id: id(4),
        fileName: 'Avtalshandling.pdf',
        contentType: 'application/pdf',
        fileSizeBytes: 1000
      }
    ],
    publishedAt: '2026-09-29T09:00:00Z',
    sentAt: '2026-09-29T09:00:01Z',
    acceptedAt: null,
    acceptedBy: null,
    acceptedOptionIds: [],
    acceptedTotalOre: null
  }
}
