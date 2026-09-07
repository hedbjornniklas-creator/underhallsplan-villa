export const CONSULTANT_REVIEW_PRICE_ORE = 150000
export const CONSULTANT_REVIEW_PRICE_LABEL = '1 500 kr exkl. moms'
export const CONSULTANT_REVIEW_MAX_MESSAGE = 4000

export type ConsultantReviewOrder = {
  id: string
  createdAt: string
  message: string | null
  requesterName: string
  priceOre: number
  deliveryStatus: 'pending' | 'sent' | 'failed'
}

export const CONSULTANT_REVIEW_ERRORS: Record<string, { status: number; message: string }> = {
  UNAUTHORIZED: { status: 401, message: 'Logga in för att beställa granskning.' },
  RENOAPP_MEMBERSHIP_REQUIRED: { status: 403, message: 'Du saknar tillgång till styrelseportalen.' },
  PROFILE_NOT_FOUND: { status: 403, message: 'Ingen användarprofil hittades.' },
  CASE_NOT_FOUND: { status: 404, message: 'Ärendet hittades inte.' },
  REVIEW_NOT_FOUND: { status: 404, message: 'Ingen beställning hittades.' },
  REVIEW_DRAFT: { status: 409, message: 'Ansökan måste vara inskickad innan granskning kan beställas.' },
  REVIEW_PRICE_REQUIRED: { status: 400, message: 'Bekräfta beställningen till priset 1 500 kr exkl. moms.' },
  REVIEW_MESSAGE_INVALID: { status: 400, message: 'Meddelandet får vara högst 4 000 tecken.' },
}
