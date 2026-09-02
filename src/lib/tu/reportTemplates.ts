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
]
