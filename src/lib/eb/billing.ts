export type EbInspectionBilling = {
  status: 'not_invoiced' | 'invoiced' | 'unavailable'
  invoicedAt: string | null
  invoiceNumber: string | null
  updatedAt: string | null
  updatedByName: string | null
  revision: number
}

export type EbInspectionBillingPatch = {
  isInvoiced: boolean
  invoiceNumber: string | null
  expectedRevision: number
}

export function emptyEbInspectionBilling(): EbInspectionBilling {
  return { status: 'not_invoiced', invoicedAt: null, invoiceNumber: null,
    updatedAt: null, updatedByName: null, revision: 0 }
}

export function unavailableEbInspectionBilling(): EbInspectionBilling {
  return { ...emptyEbInspectionBilling(), status: 'unavailable' }
}

export function parseEbInspectionBillingPatch(value: unknown): EbInspectionBillingPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('EB_BILLING_INPUT_INVALID')
  const input = value as Record<string, unknown>
  if (typeof input.isInvoiced !== 'boolean' || !Number.isSafeInteger(input.expectedRevision) ||
    Number(input.expectedRevision) < 0 || Number(input.expectedRevision) > 2147483647 ||
    (input.invoiceNumber !== null && typeof input.invoiceNumber !== 'string')) {
    throw new Error('EB_BILLING_INPUT_INVALID')
  }
  const invoiceNumber = typeof input.invoiceNumber === 'string' ? input.invoiceNumber.trim() || null : null
  if (invoiceNumber && (invoiceNumber.length > 100 || /[\u0000-\u001f\u007f]/.test(invoiceNumber))) {
    throw new Error('EB_BILLING_INPUT_INVALID')
  }
  return { isInvoiced: input.isInvoiced, invoiceNumber, expectedRevision: Number(input.expectedRevision) }
}

/** Only validates a successful, private API/RPC result; unknown is never "not invoiced". */
export function parseEbInspectionBilling(value: unknown): EbInspectionBilling | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (!['not_invoiced', 'invoiced'].includes(String(row.status)) ||
    !Number.isSafeInteger(row.revision) || Number(row.revision) < 0 ||
    Number(row.revision) > 2147483647) return null
  for (const key of ['invoiceNumber', 'updatedByName']) {
    if (row[key] !== null && typeof row[key] !== 'string') return null
  }
  for (const key of ['invoicedAt', 'updatedAt']) {
    if (row[key] !== null && (typeof row[key] !== 'string' || !Number.isFinite(Date.parse(String(row[key]))))) return null
  }
  if ((row.status === 'invoiced') !== Boolean(row.invoicedAt)) return null
  if (row.invoiceNumber && (String(row.invoiceNumber).length > 100 || /[\u0000-\u001f\u007f]/.test(String(row.invoiceNumber)))) return null
  return {
    status: row.status as 'not_invoiced' | 'invoiced', invoicedAt: row.invoicedAt as string | null,
    invoiceNumber: row.invoiceNumber as string | null, updatedAt: row.updatedAt as string | null,
    updatedByName: row.updatedByName as string | null, revision: Number(row.revision),
  }
}
