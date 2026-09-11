export type TuAnalysisFinalizationState = {
  status?: string | null
  analysisStaleAt?: string | null
}

export function isTuAnalysisStaleForFinalization(state: TuAnalysisFinalizationState | null | undefined) {
  return Boolean(state?.analysisStaleAt)
}

export function isTuStaleAnalysisAcknowledgementCurrent(input: {
  state: TuAnalysisFinalizationState | null | undefined
  acknowledgedAnalysisStaleAt: string | null | undefined
}) {
  return Boolean(
    input.state?.analysisStaleAt
    && input.acknowledgedAnalysisStaleAt === input.state.analysisStaleAt
  )
}

export function getTuAnalysisFinalizationBlocker(input: {
  state: TuAnalysisFinalizationState | null | undefined
  staleAnalysisAcknowledged: boolean
}) {
  if (isTuAnalysisStaleForFinalization(input.state)) {
    return input.staleAnalysisAcknowledged
      ? null
      : 'Underlaget har ändrats efter den senaste AI-analysen. Granska att utlåtandet tar hänsyn till ändringen eller uppdatera analysen.'
  }

  if (input.state?.status !== 'analysis_approved') {
    return 'Den samlade bedömningen måste vara aktuell och godkänd innan utlåtandet kan fastställas.'
  }

  return null
}
