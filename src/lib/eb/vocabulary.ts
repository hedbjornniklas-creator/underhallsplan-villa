export type EbAgreementVocabulary = {
  agreementLine: string
  clientLabel: string
  clientShortLabel: string
  contractorLabel: string
  contractorShortLabel: string
  contractorPluralLabel: string
  contractorOrgLabel: string
}

export type EbAgreementCategory = 'consumer' | 'commercial' | 'offer' | 'unspecified'

function normalizeAgreement(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('sv-SE')
    .replace(/\s+/g, '')
}

export function classifyEbAgreement(
  standardAgreement: string | null | undefined
): EbAgreementCategory {
  const normalized = normalizeAgreement(standardAgreement)
  if (
    normalized.includes('hf17') ||
    normalized.includes('hantverkar') ||
    normalized.includes('konsumententreprenad') ||
    normalized.includes('abs18') ||
    normalized.includes('bas18')
  ) {
    return 'consumer'
  }
  if (
    normalized.includes('ab04') ||
    normalized.includes('abt06') ||
    normalized.includes('abk09')
  ) {
    return 'commercial'
  }
  if (normalized.includes('offert')) return 'offer'
  return 'unspecified'
}

export function resolveEbAgreementVocabulary(standardAgreement: string | null | undefined): EbAgreementVocabulary {
  const normalized = normalizeAgreement(standardAgreement)

  if (normalized.includes('hf17') || normalized.includes('hantverkar')) {
    return {
      agreementLine: 'Enligt Hantverkarformuläret HF 17 för konsumenttjänster',
      clientLabel: 'Beställare /(Konsument)',
      clientShortLabel: 'Beställare',
      contractorLabel: 'Hantverkare /(Näringsidkare)',
      contractorShortLabel: 'Hantverkare',
      contractorPluralLabel: 'Hantverkare',
      contractorOrgLabel: 'Hantverkare org.nr',
    }
  }

  if (normalized.includes('konsumententreprenad')) {
    return {
      agreementLine: 'Konsumententreprenad',
      clientLabel: 'Beställare /(Konsument)',
      clientShortLabel: 'Beställare',
      contractorLabel: 'Hantverkare /(Näringsidkare)',
      contractorShortLabel: 'Hantverkare',
      contractorPluralLabel: 'Hantverkare',
      contractorOrgLabel: 'Hantverkare org.nr',
    }
  }

  if (normalized.includes('offert')) {
    return {
      agreementLine: 'Offert',
      clientLabel: 'Beställare',
      clientShortLabel: 'Beställare',
      contractorLabel: 'Entreprenör',
      contractorShortLabel: 'Entreprenör',
      contractorPluralLabel: 'Entreprenörer',
      contractorOrgLabel: 'Entreprenör org.nr',
    }
  }

  if (normalized.includes('abs18') || normalized.includes('bas18')) {
    return {
      agreementLine: 'Enligt ABS 18',
      clientLabel: 'Beställare',
      clientShortLabel: 'Beställare',
      contractorLabel: 'Entreprenör',
      contractorShortLabel: 'Entreprenör',
      contractorPluralLabel: 'Entreprenörer',
      contractorOrgLabel: 'Entreprenör org.nr',
    }
  }

  const agreement = String(standardAgreement ?? '').trim()

  return {
    agreementLine: agreement ? `Enligt ${agreement}` : 'Ej angivet',
    clientLabel: 'Beställare',
    clientShortLabel: 'Beställare',
    contractorLabel: 'Entreprenör',
    contractorShortLabel: 'Entreprenör',
    contractorPluralLabel: 'Entreprenörer',
    contractorOrgLabel: 'Entreprenör org.nr',
  }
}
