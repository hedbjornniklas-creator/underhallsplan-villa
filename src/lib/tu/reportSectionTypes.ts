export type TuReportSectionTypeOption = {
  id?: string
  key: string
  title: string
  description?: string | null
  sortOrder?: number
  isActive?: boolean
  isSystem?: boolean
}

export const TU_STANDARD_REPORT_SECTION_TYPES: TuReportSectionTypeOption[] = [
  {
    key: 'background_scope',
    title: 'Bakgrund',
    description: 'Bakgrund och anledning till utredningen.',
    sortOrder: 100,
    isActive: true,
    isSystem: true,
  },
  {
    key: 'assignment_scope',
    title: 'Uppdragets omfattning',
    description: 'Vad uppdraget omfattar och avgränsar.',
    sortOrder: 200,
    isActive: true,
    isSystem: true,
  },
  {
    key: 'construction_description',
    title: 'Beskrivning av konstruktionen',
    description: 'Beskrivning av berörd konstruktion.',
    sortOrder: 300,
    isActive: true,
    isSystem: true,
  },
  {
    key: 'basis_conditions',
    title: 'Underlag och besiktningsförutsättningar',
    description: 'Underlag, handlingar och förutsättningar.',
    sortOrder: 400,
    isActive: true,
    isSystem: true,
  },
  {
    key: 'observed_execution',
    title: 'Iakttagelser vid platsbesök',
    description: 'Observationer från platsbesöket.',
    sortOrder: 500,
    isActive: true,
    isSystem: true,
  },
  {
    key: 'technical_assessment',
    title: 'Teknisk bedömning',
    description: 'Teknisk analys och bedömning.',
    sortOrder: 600,
    isActive: true,
    isSystem: true,
  },
  {
    key: 'time_assessment',
    title: 'Tidsmässig bedömning',
    description: 'Tidsmässig bedömning av förhållanden eller skada.',
    sortOrder: 700,
    isActive: true,
    isSystem: true,
  },
  {
    key: 'continued_risk',
    title: 'Bedömning av fortsatt risk',
    description: 'Bedömning av fortsatt risk eller skadeutveckling.',
    sortOrder: 800,
    isActive: true,
    isSystem: true,
  },
  {
    key: 'recommended_actions',
    title: 'Rekommenderad fortsatt hantering',
    description: 'Rekommenderad fortsatt hantering eller åtgärdsinriktning.',
    sortOrder: 900,
    isActive: true,
    isSystem: true,
  },
  {
    key: 'closing_comments',
    title: 'Avslutande kommentarer',
    description: 'Avslutande kommentarer och juridiskt skydd.',
    sortOrder: 1000,
    isActive: true,
    isSystem: true,
  },
]
