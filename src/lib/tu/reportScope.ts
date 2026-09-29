export type TuReportScopeObservation = {
  id: string
  location?: string | null
  noteText?: string | null
  transcriptText?: string | null
}

export type TuReportScopeAddress = {
  address: string
  observationIds: string[]
}

export type TuReportScopeAddressReview = {
  status: 'not_applicable' | 'aligned' | 'confirmed' | 'review_required'
  canonicalAddress: string | null
  currentScopeText: string | null
  observedAddresses: TuReportScopeAddress[]
  additionalObservedAddresses: TuReportScopeAddress[]
  instruction: string
}

function cleanText(value: string | null | undefined) {
  return value?.trim().replace(/\s+/gu, ' ') || ''
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function normalizeNumber(value: string) {
  return value.replace(/\s+/gu, '').toUpperCase()
}

function addressParts(address: string) {
  const firstLine = cleanText(address).split(',')[0]?.trim() ?? ''
  const match = firstLine.match(
    /^(.+?\p{L})\s+(\d+[a-z]?(?:\s*(?:-|–|—|och|,)\s*\d+[a-z]?)*)/iu
  )
  if (!match) return null
  return {
    street: cleanText(match[1]),
    numbers: numberTokens(match[2]),
  }
}

function numberTokens(value: string) {
  return [...new Set(
    value
      .split(/\s*(?:-|–|—|och|,)\s*/iu)
      .map(normalizeNumber)
      .filter(Boolean)
  )]
}

function numbersForStreet(text: string, street: string) {
  const expression = new RegExp(
    `${escapeRegExp(street)}\\s+(\\d+[a-z]?(?:\\s*(?:-|–|—|och|,)\\s*\\d+[a-z]?)*)`,
    'giu'
  )
  const numbers: string[] = []
  for (const match of text.matchAll(expression)) {
    numbers.push(...numberTokens(match[1] ?? ''))
  }
  return [...new Set(numbers)]
}

export function buildTuReportScopeAddressReview(input: {
  canonicalAddress: string | null | undefined
  currentScopeText: string | null | undefined
  observations: TuReportScopeObservation[]
}): TuReportScopeAddressReview {
  const canonicalAddress = cleanText(input.canonicalAddress) || null
  const currentScopeText = cleanText(input.currentScopeText) || null
  const canonical = canonicalAddress ? addressParts(canonicalAddress) : null
  if (!canonical || canonical.numbers.length === 0) {
    return {
      status: 'not_applicable',
      canonicalAddress,
      currentScopeText,
      observedAddresses: [],
      additionalObservedAddresses: [],
      instruction: 'Ingen säker adressjämförelse kunde göras. Följ uttryckliga uppgifter om uppdragets omfattning och dagens kontroll.',
    }
  }

  const observationIdsByNumber = new Map<string, Set<string>>()
  for (const observation of input.observations) {
    const sourceText = [observation.location, observation.noteText, observation.transcriptText]
      .map(cleanText)
      .filter(Boolean)
      .join('\n')
    for (const number of numbersForStreet(sourceText, canonical.street)) {
      const ids = observationIdsByNumber.get(number) ?? new Set<string>()
      if (observation.id) ids.add(observation.id)
      observationIdsByNumber.set(number, ids)
    }
  }

  const observedAddresses = [...observationIdsByNumber.entries()]
    .map(([number, observationIds]) => ({
      address: `${canonical.street} ${number}`,
      observationIds: [...observationIds],
    }))
    .sort((left, right) => left.address.localeCompare(right.address, 'sv'))
  const canonicalNumbers = new Set(canonical.numbers)
  const additionalObservedAddresses = observedAddresses.filter((item) => {
    const number = normalizeNumber(item.address.slice(canonical.street.length))
    return !canonicalNumbers.has(number)
  })

  if (additionalObservedAddresses.length === 0) {
    return {
      status: 'aligned',
      canonicalAddress,
      currentScopeText,
      observedAddresses,
      additionalObservedAddresses,
      instruction: 'Dagens adresserade observationer överensstämmer med objektadressen.',
    }
  }

  const scopeNumbers = currentScopeText
    ? new Set(numbersForStreet(currentScopeText, canonical.street))
    : new Set<string>()
  const allAdditionalConfirmed = additionalObservedAddresses.every((item) => {
    const number = normalizeNumber(item.address.slice(canonical.street.length))
    return scopeNumbers.has(number)
  })
  const addresses = additionalObservedAddresses.map((item) => item.address).join(', ')

  return {
    status: allAdditionalConfirmed ? 'confirmed' : 'review_required',
    canonicalAddress,
    currentScopeText,
    observedAddresses,
    additionalObservedAddresses,
    instruction: allAdditionalConfirmed
      ? `Den befintliga omfattningstexten anger även ${addresses}. Bevara detta som bekräftad omfattning och sortera inte bort observationerna på grund av den snävare objektadressen.`
      : `Dagens fältunderlag innehåller observationer vid ${addresses} utöver objektadressen ${canonicalAddress}. Sortera inte bort dem enbart på grund av objektadressen. Om observationerna visar att kontroll utfördes där ska platsen behandlas som del av kontrollens faktiska omfattning och avvikelsen i objektuppgifterna anges som en intern granskningsvarning, inte som ett påstående att platsen ligger utanför uppdraget.`,
  }
}
