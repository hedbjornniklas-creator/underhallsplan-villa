import { NextResponse } from 'next/server'
import { billingErrors } from './billingFlow'
import { customerOfferError } from './customerOffersHttp'

export function billingFlowError(error: unknown) {
  const code = error instanceof Error ? error.message : ''
  const extras: Record<string, string> = { BILLING_SCHEMA_REQUIRED: 'Det nya faktureringsflödet är inte aktiverat i databasen ännu.', BILLING_STALE: 'En nyare version finns. Hämta aktuella uppgifter innan du försöker igen.', BILLING_FAILED: 'Faktureringen kunde inte hanteras. Försök igen.', BILLING_IMMUTABLE: 'Den historiska versionen kan inte ändras.', BILLING_USE_FLOW: 'Använd det nya faktureringsflödet. Tidigare underlag är skrivskyddade.' }
  const message = billingErrors[code] || extras[code]
  if (!message) return customerOfferError(error)
  const status = code === 'BILLING_SCHEMA_REQUIRED' ? 503 : code === 'BILLING_FORBIDDEN' ? 403 : code === 'BILLING_NOT_FOUND' ? 404 : code === 'BILLING_FAILED' ? 500 : code === 'BILLING_INVALID' ? 400 : 409
  return NextResponse.json({ code, error: message }, { status, headers: { 'Cache-Control': 'no-store' } })
}
