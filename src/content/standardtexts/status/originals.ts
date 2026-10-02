import confirmation from './confirmation-2026.1.json'
import report from './report-2026.2.json'

// Paragraphs are extracted from the pinned SBR DOCX originals. Do not repair,
// modernise or otherwise normalise their wording. Template-only instructions
// and variable placeholders remain in the reference JSON, not in customer copy.
export const STB_CONFIRMATION_SOURCE = confirmation
export const STB_REPORT_SOURCE = report

function exactParagraph(source: typeof confirmation, prefix: string) {
  const paragraph = source.paragraphs.find(text => text.startsWith(prefix))
  if (paragraph === undefined) throw new Error('STB_SOURCE_BLOCK_MISSING')
  return paragraph
}

function appendix(source: typeof confirmation) {
  const start = source.paragraphs.indexOf('Statusbesiktning enligt SBR-modellen')
  if (start < 0) throw new Error('STB_SOURCE_APPENDIX_MISSING')
  return source.paragraphs.slice(start).join('\n\n')
}

export const STB_CONFIRMATION_TERMS = appendix(confirmation)
export const STB_REPORT_TERMS = appendix(report)

export const STB_CONFIRMATION_TEXTS = {
  title: 'UPPDRAGSBEKRÄFTELSE',
  subtitle: 'STATUSBESIKTNING',
  introduction: exactParagraph(confirmation, 'Härmed bekräftas uppdraget'),
  payment: exactParagraph(confirmation, 'Betalningsvillkor'),
  feeTemplate: exactParagraph(confirmation, 'Fast arvode'),
  cancellationTemplate: exactParagraph(confirmation, 'Avbokningar som'),
  access: exactParagraph(confirmation, 'Det förutsätts'),
  personalDataConsent: exactParagraph(confirmation, 'I enlighet med GDPR'),
  acceptance: exactParagraph(confirmation, 'Villkoren i denna'),
} as const

export const STB_REPORT_TEXTS = {
  assignmentNotice: [
    exactParagraph(report, 'Uppdraget utförs enligt'),
    exactParagraph(report, 'En uppdragsbekräftelse med'),
    exactParagraph(report, 'Innan besiktningen påbörjades'),
    exactParagraph(report, 'Besiktningsmannen ansvarar inte för fel'),
    exactParagraph(report, 'Uppdraget är avslutat i och med'),
  ].join('\n\n'),
  ownerInformation: exactParagraph(report, 'Under denna rubrik'),
  visualConditions: [
    exactParagraph(report, 'Besiktning har skett av'),
    exactParagraph(report, 'För ytor, utrymmen'),
    exactParagraph(report, 'Notering ”'),
  ].join('\n\n'),
  oralInformation: [
    exactParagraph(report, 'Avsikten har varit'),
    exactParagraph(report, 'Skulle någon muntlig'),
    exactParagraph(report, 'Om sådant meddelande'),
  ].join('\n\n'),
} as const
