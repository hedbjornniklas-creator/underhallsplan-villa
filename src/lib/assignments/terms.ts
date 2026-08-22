import 'server-only'

import { createHash } from 'node:crypto'
import { loadStandardText } from '@/content/standardtexts/loadStandardText'
import type { StandardTextId } from '@/content/standardtexts/registry'

export type AssignmentTermsRole =
  | 'seller'
  | 'buyer'
  | 'apartment'
  | 'technical'
  | 'construction'
  | 'construction_business'
  | 'construction_consumer'

export const ASSIGNMENT_TERMS_VERSION = '2026-02-21.v1'
export const EB_ASSIGNMENT_TERMS_VERSION = '2026-08-22.eb.v1'
export const EB_BUSINESS_ASSIGNMENT_TERMS_VERSION = '2026-08-22.eb-business.v1'
export const EB_CONSUMER_ASSIGNMENT_TERMS_VERSION = '2026-08-22.eb-consumer.v1'

export type AssignmentTermsDocument = {
  version: string
  role: AssignmentTermsRole
  templateId: StandardTextId
  text: string
  documentHash: string
}

function sha256Hex(input: string) {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

function toAsciiLower(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export function parseAssignmentTermsRole(value: string | null | undefined): AssignmentTermsRole | null {
  const lowered = toAsciiLower(value ?? '')
  if (!lowered) return null
  if (lowered.includes('buy') || lowered.includes('kop')) return 'buyer'
  if (lowered.includes('apt') || lowered.includes('apartment') || lowered.includes('lagenhet')) {
    return 'apartment'
  }
  if (
    lowered === 'tu' ||
    lowered.includes('technical') ||
    lowered.includes('teknisk') ||
    lowered.includes('utred')
  ) {
    return 'technical'
  }
  if (
    lowered === 'eb' ||
    lowered.includes('construction') ||
    lowered.includes('entreprenad') ||
    lowered.includes('besiktningsuppdrag')
  ) {
    if (lowered.includes('konsument') || lowered.includes('privat')) {
      return 'construction_consumer'
    }
    if (lowered.includes('foretag') || lowered.includes('business') || lowered.includes('professionell')) {
      return 'construction_business'
    }
    return 'construction'
  }
  if (lowered.includes('sell') || lowered.includes('salj')) return 'seller'
  return null
}

export function resolveAssignmentTermsRole(input: {
  assignmentType: string | null | undefined
  ordererRole: string | null | undefined
  assignmentDetails?: Record<string, unknown> | null
}): AssignmentTermsRole | null {
  if (input.assignmentType === 'TU') return 'technical'
  if (input.assignmentType === 'EB') {
    const customerType = input.assignmentDetails?.customerType
    if (customerType === 'consumer') return 'construction_consumer'
    if (customerType === 'business') return 'construction_business'

    const parsed = parseAssignmentTermsRole(input.ordererRole)
    return parsed === 'construction_business' || parsed === 'construction_consumer'
      ? parsed
      : 'construction'
  }
  return parseAssignmentTermsRole(input.ordererRole)
}

export function normalizeAssignmentTermsRole(
  value: string | null | undefined
): AssignmentTermsRole | null {
  return parseAssignmentTermsRole(value)
}

export function getAssignmentTermsTemplateId(role: AssignmentTermsRole): StandardTextId {
  if (role === 'buyer') return 'STD_ASSIGNMENT_TEMPLATE_BUYER_2026'
  if (role === 'apartment') return 'STD_ASSIGNMENT_TEMPLATE_APARTMENT_2026'
  if (role === 'technical') return 'STD_ASSIGNMENT_TEMPLATE_TU_2026'
  if (role === 'construction_business') return 'STD_ASSIGNMENT_TEMPLATE_EB_BUSINESS_2026'
  if (role === 'construction_consumer') return 'STD_ASSIGNMENT_TEMPLATE_EB_CONSUMER_2026'
  if (role === 'construction') return 'STD_ASSIGNMENT_TEMPLATE_EB_2026'
  return 'STD_ASSIGNMENT_TEMPLATE_SELLER_2026'
}

export function getAssignmentTermsDocument(role: AssignmentTermsRole): AssignmentTermsDocument {
  const templateId = getAssignmentTermsTemplateId(role)
  const text = loadStandardText(templateId)

  return {
    version:
      role === 'construction_business'
        ? EB_BUSINESS_ASSIGNMENT_TERMS_VERSION
        : role === 'construction_consumer'
          ? EB_CONSUMER_ASSIGNMENT_TERMS_VERSION
          : role === 'construction'
            ? EB_ASSIGNMENT_TERMS_VERSION
            : ASSIGNMENT_TERMS_VERSION,
    role,
    templateId,
    text,
    documentHash: sha256Hex(text),
  }
}

export function getAllAssignmentTermsDocuments() {
  return {
    seller: getAssignmentTermsDocument('seller'),
    buyer: getAssignmentTermsDocument('buyer'),
    apartment: getAssignmentTermsDocument('apartment'),
    technical: getAssignmentTermsDocument('technical'),
    construction: getAssignmentTermsDocument('construction'),
    constructionBusiness: getAssignmentTermsDocument('construction_business'),
    constructionConsumer: getAssignmentTermsDocument('construction_consumer'),
  } as const
}
