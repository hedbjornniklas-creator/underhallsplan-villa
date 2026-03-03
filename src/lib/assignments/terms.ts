import 'server-only'

import { createHash } from 'node:crypto'
import { loadStandardText } from '@/content/standardtexts/loadStandardText'
import type { StandardTextId } from '@/content/standardtexts/registry'

export type AssignmentTermsRole = 'seller' | 'buyer' | 'apartment'

export const ASSIGNMENT_TERMS_VERSION = '2026-02-21.v1'

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
  if (lowered.includes('sell') || lowered.includes('salj')) return 'seller'
  return null
}

export function normalizeAssignmentTermsRole(
  value: string | null | undefined
): AssignmentTermsRole | null {
  return parseAssignmentTermsRole(value)
}

export function getAssignmentTermsTemplateId(role: AssignmentTermsRole): StandardTextId {
  if (role === 'buyer') return 'STD_ASSIGNMENT_TEMPLATE_BUYER_2026'
  if (role === 'apartment') return 'STD_ASSIGNMENT_TEMPLATE_APARTMENT_2026'
  return 'STD_ASSIGNMENT_TEMPLATE_SELLER_2026'
}

export function getAssignmentTermsDocument(role: AssignmentTermsRole): AssignmentTermsDocument {
  const templateId = getAssignmentTermsTemplateId(role)
  const text = loadStandardText(templateId)

  return {
    version: ASSIGNMENT_TERMS_VERSION,
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
  } as const
}
