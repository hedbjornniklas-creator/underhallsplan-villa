export type TuWorkflowProfile = 'field_report' | 'post_damage_review'

export const TU_POST_DAMAGE_REVIEW_TEMPLATE_KEY = 'post_damage_remediation_review'

export function isTuWorkflowProfile(value: unknown): value is TuWorkflowProfile {
  return value === 'field_report' || value === 'post_damage_review'
}

export function resolveTuWorkflowProfile(
  value: unknown,
  templateKey?: string | null
): TuWorkflowProfile {
  if (isTuWorkflowProfile(value)) return value
  return templateKey === TU_POST_DAMAGE_REVIEW_TEMPLATE_KEY
    ? 'post_damage_review'
    : 'field_report'
}

export function tuWorkflowProfileLabel(value: TuWorkflowProfile) {
  return value === 'post_damage_review'
    ? 'Kontroll efter skadeåtgärd'
    : 'Fält- och rapportflöde'
}
