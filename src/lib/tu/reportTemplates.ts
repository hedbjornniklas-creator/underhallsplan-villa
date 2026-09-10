import type { TuReportAuthoringMode } from '@/lib/tu/authoring'
import type { TuWorkflowProfile } from '@/lib/tu/workflowProfiles'

export const TU_POST_DAMAGE_REVIEW_TEMPLATE_KEY = 'post_damage_remediation_review'
export const TU_POST_DAMAGE_REPORT_TITLE = 'Teknisk uppföljningskontroll efter skadeåtgärd'
export const TU_POST_DAMAGE_REPORT_DISCLAIMER =
  'Uppdraget utgör en teknisk uppföljningskontroll och inte en entreprenadbesiktning eller ett godkännande av entreprenaden i avtalsrättslig mening.'
export const TU_POST_DAMAGE_ASSIGNMENT_NATURE_FIELD_KEY = 'reportPolicy.assignmentNature'

const LEGACY_POST_DAMAGE_TITLES = new Set(['Teknisk kontroll efter skadeåtgärd'])

const TU_POST_DAMAGE_SECTION_POLICY: Record<string, { title: string; aiInstruction: string }> = {
  assignment_scope: {
    title: 'Uppdrag och avgränsning',
    aiInstruction: 'Beskriv kort uppdragets fråga, kontrollens omfattning och de avgränsningar som faktiskt påverkar slutsatsen. Tidigare handlingar är kontrollunderlag som visar vad kontrollen skulle inriktas mot; de är inte bevis för dagens förhållanden eller för att en åtgärd har utförts. Identifiera handlingarna kort och samlat utan att återberätta deras skadehistorik. Ange att uppdraget utgör en teknisk uppföljningskontroll och inte en entreprenadbesiktning eller ett godkännande av entreprenaden i avtalsrättslig mening.',
  },
  observed_execution: {
    title: 'Kontrollens resultat',
    aiInstruction: 'Redovisa kontrollens relevanta aktuella observationer, bilder och kvalificerade mätningar grupperade efter område eller förhållande. Skriv observationstyrt och inte som en återgivning av den interna kontrollinriktningen eller interna statusfält. Beskriv endast vad som faktiskt kunde iakttas eller verifieras vid den aktuella kontrollen. När ett resultat behöver klassificeras, använd i sak verifierad i kontrollerbar del, avvikelse noterad, kan inte verifieras, inte åtkomlig eller inte kontrollerad. Använd inte godkänd eller underkänd.',
  },
  technical_assessment: {
    title: 'Samlad teknisk bedömning',
    aiInstruction: 'Besvara uppdragets huvudfråga utifrån den aktuella kontrollens observationer, bilder och kvalificerade mätningar. Tidigare handlingar får endast förklara kontrollens inriktning och får inte användas som bevis för aktuellt skick eller utförd åtgärd. Skilj tydligt mellan verifierat, bedömt och sådant som inte kunde verifieras. Skriv inte att en åtgärd saknas eller inte är utförd när underlaget endast visar att den inte kunde verifieras.',
  },
  recommended_actions: {
    title: 'Rekommenderad fortsatt hantering',
    aiInstruction: 'Ange endast proportionerliga fortsatta kontroller, kompletteringar eller åtgärder som följer av den aktuella kontrollens resultat och samlade bedömning. Skilj ett kvarstående kontrollbehov från en konstaterad avvikelse. Fördela inte juridiskt ansvar och beskriv inte en åtgärd som beställd om det inte framgår av ett uttryckligt avtalat underlag.',
  },
}

export const TU_POST_DAMAGE_SOURCE_POLICY = {
  reportNature: 'observation_driven_technical_follow_up',
  primaryCurrentEvidence: ['observations', 'inspection_images', 'measurements'],
  contextOnlySources: ['prior_reports', 'control_plan', 'historic_damage_descriptions'],
  rules: [
    'Aktuellt skick och aktuell teknisk bedömning ska grundas på besiktningsmannens observationer, egna bilder och kvalificerade mätningar från den aktuella kontrollen.',
    'Tidigare handlingar används endast för att förstå uppdragets bakgrund och inriktning om de inte uttryckligen innehåller separat aktuell utförandedokumentation.',
    'En tidigare rekommendation eller skadebeskrivning visar inte i sig att en åtgärd beställdes, utfördes eller fortfarande är aktuell.',
    'Kontrollinriktningen är ett internt orienteringsstöd och får inte styra rapportens disposition eller återges som en checklista.',
  ],
} as const

export function isTuPostDamageReport(templateKey: string | null | undefined) {
  return templateKey === TU_POST_DAMAGE_REVIEW_TEMPLATE_KEY
}

export function resolveTuReportDocumentTitle(input: {
  templateKey: string | null | undefined
  storedTitle: string | null | undefined
}) {
  const storedTitle = input.storedTitle?.trim() ?? ''
  if (!isTuPostDamageReport(input.templateKey)) return storedTitle || 'Teknisk utredning'
  if (!storedTitle || LEGACY_POST_DAMAGE_TITLES.has(storedTitle)) {
    return TU_POST_DAMAGE_REPORT_TITLE
  }
  return storedTitle
}

export function resolveTuReportProjectType(input: {
  templateKey: string | null | undefined
  storedProjectType: string | null | undefined
}) {
  const storedProjectType = input.storedProjectType?.trim() ?? ''
  if (!isTuPostDamageReport(input.templateKey)) {
    return storedProjectType || 'Fördjupad teknisk utredning'
  }
  if (!storedProjectType || LEGACY_POST_DAMAGE_TITLES.has(storedProjectType)) {
    return TU_POST_DAMAGE_REPORT_TITLE
  }
  return storedProjectType
}

export function resolveTuReportSectionPolicy(
  templateKey: string | null | undefined,
  sectionKey: string
) {
  if (!isTuPostDamageReport(templateKey)) return null
  return TU_POST_DAMAGE_SECTION_POLICY[sectionKey] ?? null
}

export function ensureTuPostDamageDisclaimer<T extends {
  sectionId: string
  paragraphs: Array<{
    text: string
    sourceAnalysisItemIds: string[]
    sourceObservationIds: string[]
    sourceFieldKeys: string[]
    warnings: string[]
  }>
}>(input: {
  templateKey: string | null | undefined
  assignmentSectionId: string | null
  sections: T[]
}) {
  if (!isTuPostDamageReport(input.templateKey) || !input.assignmentSectionId) return input.sections

  return input.sections.map((section) => {
    if (section.sectionId !== input.assignmentSectionId) return section
    const hasDisclaimer = section.paragraphs.some((paragraph) => (
      /inte\s+en\s+entreprenadbesiktning/i.test(paragraph.text)
      && /avtalsrättslig/i.test(paragraph.text)
    ))
    if (hasDisclaimer) return section

    return {
      ...section,
      paragraphs: [
        ...section.paragraphs,
        {
          text: TU_POST_DAMAGE_REPORT_DISCLAIMER,
          sourceAnalysisItemIds: [],
          sourceObservationIds: [],
          sourceFieldKeys: [TU_POST_DAMAGE_ASSIGNMENT_NATURE_FIELD_KEY],
          warnings: [],
        },
      ],
    }
  })
}

export type TuReportTemplateSectionOption = {
  id?: string
  templateSectionKey: string
  sectionTypeKey: string
  sectionTypeTitle?: string | null
  titleOverride?: string | null
  defaultContent?: string | null
  aiInstruction?: string | null
  sortOrder: number
  isRequired: boolean
  includeInToc: boolean
  allowDelete: boolean
}

export type TuReportTemplateOption = {
  id?: string
  key: string
  title: string
  description?: string | null
  documentTitle: string
  projectType: string
  authoringMode: TuReportAuthoringMode
  workflowProfile: TuWorkflowProfile
  version: number
  sortOrder: number
  isActive: boolean
  isSystem: boolean
  sections?: TuReportTemplateSectionOption[]
}

export const TU_STANDARD_REPORT_TEMPLATES: TuReportTemplateOption[] = [
  {
    key: 'deep_technical_investigation',
    title: 'Fördjupad teknisk utredning',
    description: 'Standardmall för tekniska utredningar med full struktur.',
    documentTitle: 'Teknisk utredning',
    projectType: 'Fördjupad teknisk utredning',
    authoringMode: 'standard',
    workflowProfile: 'field_report',
    version: 1,
    sortOrder: 100,
    isActive: true,
    isSystem: true,
    sections: [
      {
        templateSectionKey: 'background_scope',
        sectionTypeKey: 'background_scope',
        aiInstruction: 'Beskriv bakgrund och anledning till utredningen utan att dra tekniska slutsatser.',
        sortOrder: 100,
        isRequired: false,
        includeInToc: true,
        allowDelete: true,
      },
      {
        templateSectionKey: 'assignment_scope',
        sectionTypeKey: 'assignment_scope',
        aiInstruction: 'Beskriv uppdragets omfattning, avgränsningar och kontrollerade delar.',
        sortOrder: 200,
        isRequired: false,
        includeInToc: true,
        allowDelete: true,
      },
      {
        templateSectionKey: 'construction_description',
        sectionTypeKey: 'construction_description',
        aiInstruction: 'Beskriv berörd konstruktion och tekniska förutsättningar sakligt.',
        sortOrder: 300,
        isRequired: false,
        includeInToc: true,
        allowDelete: true,
      },
      {
        templateSectionKey: 'basis_conditions',
        sectionTypeKey: 'basis_conditions',
        aiInstruction: 'Redovisa handlingar, uppgifter och besiktningsförutsättningar.',
        sortOrder: 400,
        isRequired: false,
        includeInToc: true,
        allowDelete: true,
      },
      {
        templateSectionKey: 'observed_execution',
        sectionTypeKey: 'observed_execution',
        aiInstruction: 'Redovisa iakttagelser från platsbesök utan att blanda in åtgärdsförslag.',
        sortOrder: 500,
        isRequired: false,
        includeInToc: true,
        allowDelete: true,
      },
      {
        templateSectionKey: 'technical_assessment',
        sectionTypeKey: 'technical_assessment',
        aiInstruction: 'Gör en teknisk bedömning baserad på iakttagelser och underlag.',
        sortOrder: 600,
        isRequired: false,
        includeInToc: true,
        allowDelete: true,
      },
      {
        templateSectionKey: 'time_assessment',
        sectionTypeKey: 'time_assessment',
        aiInstruction: 'Bedöm tidsmässiga samband och sannolik skadeutveckling där det är möjligt.',
        sortOrder: 700,
        isRequired: false,
        includeInToc: true,
        allowDelete: true,
      },
      {
        templateSectionKey: 'continued_risk',
        sectionTypeKey: 'continued_risk',
        aiInstruction: 'Bedöm fortsatt risk om förhållandet lämnas utan åtgärd.',
        sortOrder: 800,
        isRequired: false,
        includeInToc: true,
        allowDelete: true,
      },
      {
        templateSectionKey: 'recommended_actions',
        sectionTypeKey: 'recommended_actions',
        aiInstruction: 'Föreslå fortsatt teknisk hantering utan juridiska slutsatser.',
        sortOrder: 900,
        isRequired: false,
        includeInToc: true,
        allowDelete: true,
      },
      {
        templateSectionKey: 'closing_comments',
        sectionTypeKey: 'closing_comments',
        aiInstruction: 'Avsluta med ramar, reservationer och vad utlåtandet baseras på.',
        sortOrder: 1000,
        isRequired: false,
        includeInToc: true,
        allowDelete: true,
      },
    ],
  },
  {
    key: 'technical_status_statement',
    title: 'Tekniskt statusutlåtande',
    description: 'Mall för tekniskt statusutlåtande med sammanhållen statusbedömning.',
    documentTitle: 'Tekniskt statusutlåtande',
    projectType: 'Fastighetsbesiktning',
    authoringMode: 'standard',
    workflowProfile: 'field_report',
    version: 1,
    sortOrder: 200,
    isActive: true,
    isSystem: true,
    sections: [
      {
        templateSectionKey: 'assignment_scope',
        sectionTypeKey: 'assignment_scope',
        titleOverride: 'Uppdragets omfattning',
        aiInstruction: 'Beskriv vad statusutlåtandet omfattar och vilka delar som kontrollerats.',
        sortOrder: 100,
        isRequired: false,
        includeInToc: true,
        allowDelete: true,
      },
      {
        templateSectionKey: 'basis_conditions',
        sectionTypeKey: 'basis_conditions',
        titleOverride: 'Underlag och besiktningsförutsättningar',
        aiInstruction: 'Redovisa underlag och förutsättningar för statusbedömningen.',
        sortOrder: 200,
        isRequired: false,
        includeInToc: true,
        allowDelete: true,
      },
      {
        templateSectionKey: 'observed_execution',
        sectionTypeKey: 'observed_execution',
        titleOverride: 'Iakttagelser vid platsbesök',
        aiInstruction: 'Redovisa iakttagelser och relevanta statusnoteringar.',
        sortOrder: 300,
        isRequired: false,
        includeInToc: true,
        allowDelete: true,
      },
      {
        templateSectionKey: 'technical_assessment',
        sectionTypeKey: 'technical_assessment',
        titleOverride: 'Sammanfattande bedömning',
        aiInstruction: 'Sammanfatta teknisk status, brister och betydelse för fortsatt förvaltning.',
        sortOrder: 400,
        isRequired: false,
        includeInToc: true,
        allowDelete: true,
      },
      {
        templateSectionKey: 'recommended_actions',
        sectionTypeKey: 'recommended_actions',
        titleOverride: 'Rekommenderade kompletterande kontroller',
        aiInstruction: 'Föreslå fortsatta kontroller eller tekniska utredningar där status inte kan verifieras.',
        sortOrder: 500,
        isRequired: false,
        includeInToc: true,
        allowDelete: true,
      },
      {
        templateSectionKey: 'closing_comments',
        sectionTypeKey: 'closing_comments',
        titleOverride: 'Avslutande kommentarer',
        aiInstruction: 'Avsluta med ramar, reservationer och användningsområde för statusutlåtandet.',
        sortOrder: 600,
        isRequired: false,
        includeInToc: true,
        allowDelete: true,
      },
    ],
  },
  {
    key: 'short_technical_statement',
    title: 'Kort tekniskt utlåtande',
    description: 'Kortare mall för avgränsade tekniska bedömningar.',
    documentTitle: 'Kort tekniskt utlåtande',
    projectType: 'Kort tekniskt utlåtande',
    authoringMode: 'standard',
    workflowProfile: 'field_report',
    version: 1,
    sortOrder: 300,
    isActive: true,
    isSystem: true,
    sections: [
      {
        templateSectionKey: 'assignment_scope',
        sectionTypeKey: 'assignment_scope',
        titleOverride: 'Uppdragets omfattning',
        aiInstruction: 'Beskriv kort vad utlåtandet omfattar och vad som inte ingår.',
        sortOrder: 100,
        isRequired: false,
        includeInToc: true,
        allowDelete: true,
      },
      {
        templateSectionKey: 'observed_execution',
        sectionTypeKey: 'observed_execution',
        titleOverride: 'Iakttagelser',
        aiInstruction: 'Redovisa de iakttagelser som är relevanta för frågeställningen.',
        sortOrder: 200,
        isRequired: false,
        includeInToc: true,
        allowDelete: true,
      },
      {
        templateSectionKey: 'technical_assessment',
        sectionTypeKey: 'technical_assessment',
        titleOverride: 'Teknisk bedömning',
        aiInstruction: 'Gör en kort teknisk bedömning med tydlig koppling till iakttagelserna.',
        sortOrder: 300,
        isRequired: false,
        includeInToc: true,
        allowDelete: true,
      },
      {
        templateSectionKey: 'recommended_actions',
        sectionTypeKey: 'recommended_actions',
        titleOverride: 'Rekommenderad fortsatt hantering',
        aiInstruction: 'Föreslå nästa steg i kort och praktisk form.',
        sortOrder: 400,
        isRequired: false,
        includeInToc: true,
        allowDelete: true,
      },
    ],
  },
  {
    key: 'moisture_damage_investigation',
    title: 'Fuktskadeutredning',
    description: 'Fuktskadeutredning med fokuserat besiktningsunderlag, redaktionellt relevansurval och granskat AI-förslag.',
    documentTitle: 'Fuktskadeutredning',
    projectType: 'Fuktskadeutredning',
    authoringMode: 'ai_assisted',
    workflowProfile: 'field_report',
    version: 2,
    sortOrder: 150,
    isActive: true,
    isSystem: true,
    sections: [
      {
        templateSectionKey: 'scope_questions_boundaries',
        sectionTypeKey: 'assignment_scope',
        titleOverride: 'Uppdrag och avgränsning',
        aiInstruction:
          'Beskriv kort den tekniska frågan, vad som kontrollerades och relevanta avgränsningar i besiktningsmannens egen röst.',
        sortOrder: 100,
        isRequired: true,
        includeInToc: true,
        allowDelete: false,
      },
      {
        templateSectionKey: 'investigation_observations',
        sectionTypeKey: 'observed_execution',
        titleOverride: 'Genomförande och iakttagelser',
        aiInstruction:
          'Redovisa genomförandet och de iakttagelser eller kvalificerade mätresultat som behövs för att besvara huvudfrågan. Undvik bakgrundsfakta utan betydelse för bedömningen.',
        sortOrder: 200,
        isRequired: true,
        includeInToc: true,
        allowDelete: false,
      },
      {
        templateSectionKey: 'assessment_conclusion',
        sectionTypeKey: 'technical_assessment',
        titleOverride: 'Teknisk bedömning och slutsats',
        aiInstruction:
          'Besvara uppdragets huvudfråga genom att väga samman relevanta iakttagelser. Skilj verifierat från bedömt och ange endast begränsningar som påverkar slutsatsen.',
        sortOrder: 300,
        isRequired: true,
        includeInToc: true,
        allowDelete: false,
      },
      {
        templateSectionKey: 'recommended_follow_up',
        sectionTypeKey: 'recommended_actions',
        titleOverride: 'Rekommenderad fortsatt hantering',
        aiInstruction:
          'Ange endast fortsatta kontroller eller åtgärder som följer proportionerligt av den tekniska bedömningen. Utse inte juridiskt ansvarig part.',
        sortOrder: 400,
        isRequired: true,
        includeInToc: true,
        allowDelete: false,
      },
    ],
  },
  {
    key: 'post_damage_remediation_review',
    title: TU_POST_DAMAGE_REPORT_TITLE,
    description:
      'AI-stödd uppföljningskontroll efter rivning, sanering, uttorkning eller annan skadeåtgärd. Tidigare handlingar sammanfattas som intern inriktning och rapporten byggs av aktuella observationer.',
    documentTitle: TU_POST_DAMAGE_REPORT_TITLE,
    projectType: TU_POST_DAMAGE_REPORT_TITLE,
    authoringMode: 'ai_assisted',
    workflowProfile: 'post_damage_review',
    version: 2,
    sortOrder: 175,
    isActive: true,
    isSystem: true,
    sections: [
      {
        templateSectionKey: 'scope_basis_boundaries',
        sectionTypeKey: 'assignment_scope',
        titleOverride: TU_POST_DAMAGE_SECTION_POLICY.assignment_scope.title,
        aiInstruction: TU_POST_DAMAGE_SECTION_POLICY.assignment_scope.aiInstruction,
        sortOrder: 100,
        isRequired: true,
        includeInToc: true,
        allowDelete: false,
      },
      {
        templateSectionKey: 'review_execution_observations',
        sectionTypeKey: 'observed_execution',
        titleOverride: TU_POST_DAMAGE_SECTION_POLICY.observed_execution.title,
        aiInstruction: TU_POST_DAMAGE_SECTION_POLICY.observed_execution.aiInstruction,
        sortOrder: 200,
        isRequired: true,
        includeInToc: true,
        allowDelete: false,
      },
      {
        templateSectionKey: 'review_assessment_conclusion',
        sectionTypeKey: 'technical_assessment',
        titleOverride: TU_POST_DAMAGE_SECTION_POLICY.technical_assessment.title,
        aiInstruction: TU_POST_DAMAGE_SECTION_POLICY.technical_assessment.aiInstruction,
        sortOrder: 300,
        isRequired: true,
        includeInToc: true,
        allowDelete: false,
      },
      {
        templateSectionKey: 'review_recommended_follow_up',
        sectionTypeKey: 'recommended_actions',
        titleOverride: TU_POST_DAMAGE_SECTION_POLICY.recommended_actions.title,
        aiInstruction: TU_POST_DAMAGE_SECTION_POLICY.recommended_actions.aiInstruction,
        sortOrder: 400,
        isRequired: true,
        includeInToc: true,
        allowDelete: false,
      },
    ],
  },
]
