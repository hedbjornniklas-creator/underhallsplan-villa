export const EB_PHOTO_APPENDIX_LABEL = 'Bilaga 1 – Fotobilaga'

const LEGACY_TESTING_DOCUMENTATION_REPLACEMENTS: Array<[string, string]> = [
  [
    'Följande dokument över avtalade kvalitetsåtgärder redovisades för granskning i samband med slutbesiktningen:',
    'Följande dokumentation redovisades för granskning i samband med besiktningen:',
  ],
  [
    'Besiktningsmannen har vid besiktningen bedömt att av entreprenören upprättad dokumentation, som visar att arbetena i fråga är kontraktsenligt utförda, har utgjort tillräckligt underlag för bedömning av entreprenaden för aktuell del i fråga.',
    'Den redovisade dokumentationen har ingått i underlaget för besiktningsmannens bedömning i den omfattning som framgår nedan.',
  ],
  [
    'Där avtalad dokumentation enligt ovan saknas eller är felaktig är dessa noterade som fel i arbetena under rubrik ”Fel och förhållanden”.',
    'Dokumentation som inte har redovisats eller som har bedömts bristfällig anges under rubriken ”Fel och förhållanden”.',
  ],
]

export function normalizeEbTestingDocumentationText(value: string) {
  return LEGACY_TESTING_DOCUMENTATION_REPLACEMENTS.reduce(
    (text, [legacyText, replacement]) => text.replace(legacyText, replacement),
    value
  )
}

export function isEbTestingDocumentationConclusion(value: string) {
  const normalized = value.trim()
  return (
    normalized.startsWith('Där avtalad dokumentation') ||
    normalized.startsWith('Dokumentation som inte har redovisats')
  )
}

export function withEbPhotoAppendixListing(value: string, hasPhotoAppendix: boolean) {
  if (!hasPhotoAppendix) return value

  const blocks = value
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(
      (block) =>
        block &&
        block !== 'Inga bilagor har angetts i bilageförteckningen.' &&
        block !== EB_PHOTO_APPENDIX_LABEL
    )

  return [EB_PHOTO_APPENDIX_LABEL, ...blocks].join('\n\n')
}
