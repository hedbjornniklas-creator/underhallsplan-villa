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
      : 'Underlaget har ändrats. Granska utlåtandet mot det aktuella underlaget och bekräfta granskningen innan du fastställer.'
  }
  // AI completion is not a delivery prerequisite; report checks run separately.
  return null
}
