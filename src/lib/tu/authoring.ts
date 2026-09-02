export const TU_REPORT_AUTHORING_MODES = ['standard', 'ai_assisted'] as const
const LEGACY_AI_TEMPLATE_KEY = 'moisture_damage_investigation'

export type TuReportAuthoringMode = (typeof TU_REPORT_AUTHORING_MODES)[number]

export function isTuReportAuthoringMode(value: unknown): value is TuReportAuthoringMode {
  return TU_REPORT_AUTHORING_MODES.includes(value as TuReportAuthoringMode)
}

export function resolveTuReportAuthoringMode(
  value: unknown,
  reportTemplateKey?: string | null
): TuReportAuthoringMode {
  if (isTuReportAuthoringMode(value)) return value

  // Keeps existing moisture investigations on their established workflow until
  // the authoring mode migration has populated their immutable snapshot field.
  return reportTemplateKey === LEGACY_AI_TEMPLATE_KEY ? 'ai_assisted' : 'standard'
}

export function usesTuAiAssistedWorkflow(value: unknown, reportTemplateKey?: string | null) {
  return resolveTuReportAuthoringMode(value, reportTemplateKey) === 'ai_assisted'
}

export function tuReportAuthoringModeLabel(value: TuReportAuthoringMode) {
  return value === 'ai_assisted' ? 'Fält- och AI-flöde' : 'Standardredigering'
}
