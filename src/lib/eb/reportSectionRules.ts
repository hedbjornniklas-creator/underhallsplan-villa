export type EbReportSectionRuleContext = {
  sectionKey: string
  inspectionVariant: string | null | undefined
  projectTemplateKey: string | null | undefined
}

const DRAINAGE_ONLY_SECTION_KEYS = new Set(['drainage_checklist'])

const DRAINAGE_EXCLUDED_SECTION_KEYS = new Set([
  'testing_documentation',
  'contract_documents',
  'defects_appendices',
  'marker_legend',
  'deduction',
  'notes',
])

const PRELIMINARY_EXCLUDED_SECTION_KEYS = new Set([
  'approval_decision',
  'continued_final_inspection',
  'warranty_end',
  'reclamation_notice',
  'after_inspection',
])

const INTEGRATED_SECTION_KEYS = new Set([
  'inspection_type',
  'marker_legend',
  'deduction',
  'notes',
  'warranty_end',
  'after_inspection',
  'signature_certificate',
])

const FINAL_DECISION_VARIANTS = new Set(['SLB', 'KSB'])

export function isEbDrainageTemplate(projectTemplateKey: string | null | undefined) {
  return projectTemplateKey === 'drainage_foundation'
}

export function isEbPreliminaryInspection(inspectionVariant: string | null | undefined) {
  return inspectionVariant === 'FB'
}

export function isEbFinalDecisionInspection(inspectionVariant: string | null | undefined) {
  return inspectionVariant ? FINAL_DECISION_VARIANTS.has(inspectionVariant) : false
}

export function isEbReportSectionIntegrated(sectionKey: string) {
  return INTEGRATED_SECTION_KEYS.has(sectionKey)
}

export function isEbReportSectionApplicable({
  sectionKey,
  inspectionVariant,
  projectTemplateKey,
}: EbReportSectionRuleContext) {
  const drainage = isEbDrainageTemplate(projectTemplateKey)

  if (DRAINAGE_ONLY_SECTION_KEYS.has(sectionKey)) return drainage
  if (drainage && DRAINAGE_EXCLUDED_SECTION_KEYS.has(sectionKey)) return false
  if (isEbPreliminaryInspection(inspectionVariant) && PRELIMINARY_EXCLUDED_SECTION_KEYS.has(sectionKey)) {
    return false
  }
  if (
    (sectionKey === 'approval_decision' ||
      sectionKey === 'continued_final_inspection' ||
      sectionKey === 'warranty_end') &&
    !isEbFinalDecisionInspection(inspectionVariant)
  ) {
    return false
  }

  return true
}
