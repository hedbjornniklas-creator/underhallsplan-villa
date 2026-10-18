import type { TuCopySource } from '../../src/lib/tu/copy'

export const tuCopyDemo: TuCopySource = {
  inspectionId: '22222222-2222-4222-8222-222222222222',
  title: 'Tidigare utredning', reportTemplateKey: 'moisture_damage_investigation',
  objectType: 'villa', customerType: 'consumer',
  customerName: 'Anna Exempel', customerEmail: 'anna@example.com', customerPhone: '0701234567',
  customerAddress: 'Kundgatan 1', customerPostalCode: '12345', customerCity: 'Teststad',
  customerIdentityNumber: '', customerRole: 'Fastighetsägare',
  invoiceEmail: 'faktura@example.com', invoiceName: 'Anna Exempel', invoiceAddress: 'Kundgatan 1, Teststad',
  propertyAddress: 'Testvägen 12', propertyPostalCode: '12345', propertyCity: 'Teststad',
  propertyMunicipality: 'Testkommun', propertyOwnerName: 'Anna Exempel', cadastralId: 'Test 1:2',
  brfName: '', apartmentNumber: '', apartmentHolderName: '',
  scopeDescription: 'Utred fukt i källaren.', priceAmount: '5900',
  customerBinding: { mode: 'existing', customerId: '33333333-3333-4333-8333-333333333333', customerVersion: 1 },
}
