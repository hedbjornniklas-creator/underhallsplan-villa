import 'server-only'

import { createHash } from 'node:crypto'
import { STB_CONFIRMATION_SOURCE, STB_CONFIRMATION_TERMS, STB_CONFIRMATION_TEXTS } from '@/content/standardtexts/status/originals'
import type { AssignmentTermsDocument } from './terms'

export const STATUS_ASSIGNMENT_TERMS_VERSION = '2026-10-02.stb.2026.1.v1'
const SOURCE_FILE_SHA256 = '67b72e4f3264476ceeff1d722b958dfb6e21d9cde4c9bbd1b1b4e69a52e0f4be'
const SOURCE_PARAGRAPHS_SHA256 = '22c03d7aaf48c09d012b8d08247c3d69472189e381abd5795a98bb66af3922c7'
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

export function getStatusAssignmentTermsDocument(values?: { priceAmount: number; cancellationFee: number; scopeDescription: string }): AssignmentTermsDocument {
  if (STB_CONFIRMATION_SOURCE.sourceFileSha256 !== SOURCE_FILE_SHA256 ||
    sha256(JSON.stringify(STB_CONFIRMATION_SOURCE.paragraphs)) !== SOURCE_PARAGRAPHS_SHA256 ||
    sha256(STB_CONFIRMATION_TERMS) !== '445377bc76792b4475925e46d2d6c1fc21f35aa8bb73be4e8c53d8a5e9d21c0d' ||
    Object.values(STB_CONFIRMATION_TEXTS).some(text => !STB_CONFIRMATION_SOURCE.paragraphs.includes(text))) {
    throw new Error('STATUS_SOURCE_HASH_MISMATCH')
  }
  if (values && (!Number.isFinite(values.priceAmount) || values.priceAmount < 0 ||
    !Number.isFinite(values.cancellationFee) || values.cancellationFee < 0)) {
    throw new Error('STATUS_CANCELLATION_FEE_REQUIRED')
  }
  if (values && !values.scopeDescription.trim()) throw new Error('STATUS_SCOPE_REQUIRED')
  const scopeTemplate = STB_CONFIRMATION_SOURCE.paragraphs.find(text => text.startsWith('Besiktningen omfattar:'))
  if (!scopeTemplate || !scopeTemplate.includes('Objekt')) throw new Error('STATUS_SOURCE_SCOPE_FIELD_MISSING')
  const amount = (value: number) => value.toLocaleString('sv-SE', { maximumFractionDigits: 2 })
  const confirmationTexts = {
    introduction: STB_CONFIRMATION_TEXTS.introduction,
    fee: values ? STB_CONFIRMATION_TEXTS.feeTemplate.replace('xxxx', amount(values.priceAmount)) : STB_CONFIRMATION_TEXTS.feeTemplate,
    payment: STB_CONFIRMATION_TEXTS.payment,
    scope: scopeTemplate.slice(0, scopeTemplate.indexOf('Objekt')) + (values?.scopeDescription ?? 'Objekt'),
    cancellation: values ? STB_CONFIRMATION_TEXTS.cancellationTemplate.replace('XXXX', amount(values.cancellationFee)) : STB_CONFIRMATION_TEXTS.cancellationTemplate,
    access: STB_CONFIRMATION_TEXTS.access,
    personalDataConsent: STB_CONFIRMATION_TEXTS.personalDataConsent,
    acceptance: STB_CONFIRMATION_TEXTS.acceptance,
  }
  // Only the SBR template's explicit numeric fields are replaced. In particular
  // preserve its original punctuation, spacing, spelling and Unicode characters.
  const text = [...Object.values(confirmationTexts), STB_CONFIRMATION_TERMS].join('\n\n')
  return {
    role: 'status', templateId: 'STD_ASSIGNMENT_TEMPLATE_STATUS_2026',
    version: STATUS_ASSIGNMENT_TERMS_VERSION, text, documentHash: sha256(text),
    sourceId: 'OB_STATUS_2026_1', sourceFileHash: SOURCE_FILE_SHA256,
    verbatim: true, confirmationTexts,
  }
}
