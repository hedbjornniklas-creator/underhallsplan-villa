'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  TU_ANALYSIS_UPDATED_EVENT,
  type TuAnalysisResponse,
  type TuAnalysisValidation,
  type TuAnalysisWorkflow,
} from '@/lib/tu/analysis'
import {
  TU_REPORT_DRAFT_UPDATED_EVENT,
  type TuWholeReportDraftResponse,
  type TuWholeReportDraftState,
} from '@/lib/tu/reportDraft'
import {
  TU_CONTROL_PLAN_UPDATED_EVENT,
  type TuControlPlanResponse,
  type TuControlPlanState,
} from '@/lib/tu/controlPlan'
import type { TuWorkflowProfile } from '@/lib/tu/workflowProfiles'
import {
  deriveTuWorkflowSteps,
  type TuDeliveryWorkflowState,
} from '@/lib/tu/workflow'

type DeliveryResponse = {
  reportLockedAt?: string | null
  hasActiveLink?: boolean
  pdfStatus?: string | null
  history?: Array<{ status?: string | null }>
  revisionNumber?: number | null
  revisionStatus?: 'finalized' | 'published' | null
}

type Options = {
  inspectionId: string
  organizationId: string
  enabled: boolean
  workflowProfile: TuWorkflowProfile
  refreshToken: number
  queue: { total: number; failed: number }
  reportFilledSectionCount: number
  reportSectionCount: number
}

async function jsonOrError<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(payload.error || fallback)
  return payload
}

export function useTuWorkflowState({
  inspectionId,
  organizationId,
  enabled,
  workflowProfile,
  refreshToken,
  queue,
  reportFilledSectionCount,
  reportSectionCount,
}: Options) {
  const [validation, setValidation] = useState<TuAnalysisValidation | null>(null)
  const [preparation, setPreparation] = useState<TuControlPlanState | null>(null)
  const [workflow, setWorkflow] = useState<TuAnalysisWorkflow | null>(null)
  const [reportDraft, setReportDraft] = useState<TuWholeReportDraftState | null>(null)
  const [delivery, setDelivery] = useState<TuDeliveryWorkflowState | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (silent = false) => {
    if (!enabled) return
    if (!silent) setLoading(true)
    try {
      const preparationRequest = workflowProfile === 'post_damage_review'
        ? fetch(`/api/tu/investigations/${inspectionId}/preparation?orgId=${encodeURIComponent(organizationId)}`, { cache: 'no-store' })
        : Promise.resolve(null)
      const [analysisResponse, reportResponse, deliveryResponse, preparationResponse] = await Promise.all([
        fetch(`/api/tu/investigations/${inspectionId}/analysis?orgId=${encodeURIComponent(organizationId)}`, { cache: 'no-store' }),
        fetch(`/api/tu/investigations/${inspectionId}/report-draft?orgId=${encodeURIComponent(organizationId)}`, { cache: 'no-store' }),
        fetch(`/api/tu/investigations/${inspectionId}/report-delivery?orgId=${encodeURIComponent(organizationId)}`, { cache: 'no-store' }),
        preparationRequest,
      ])
      const [analysisPayload, reportPayload, deliveryPayload, preparationPayload] = await Promise.all([
        jsonOrError<TuAnalysisResponse>(analysisResponse, 'Kunde inte hämta arbetsflödets analysstatus.'),
        jsonOrError<TuWholeReportDraftResponse>(reportResponse, 'Kunde inte hämta utlåtandeförslaget.'),
        jsonOrError<DeliveryResponse>(deliveryResponse, 'Kunde inte hämta leveransstatus.'),
        preparationResponse
          ? jsonOrError<TuControlPlanResponse>(preparationResponse, 'Kunde inte hämta kontrollplanen.')
          : Promise.resolve({} as TuControlPlanResponse),
      ])
      setPreparation(preparationPayload.preparation ?? null)
      setValidation(analysisPayload.validation ?? null)
      setWorkflow(analysisPayload.workflow ?? null)
      setReportDraft(reportPayload.draft ?? null)
      setDelivery({
        reportLockedAt: deliveryPayload.reportLockedAt ?? null,
        hasActiveLink: Boolean(deliveryPayload.hasActiveLink),
        pdfStatus: deliveryPayload.pdfStatus ?? null,
        sentCount: deliveryPayload.history?.filter((item) => item.status === 'sent').length ?? 0,
        revisionNumber: deliveryPayload.revisionNumber ?? null,
        revisionStatus: deliveryPayload.revisionStatus ?? null,
      })
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Kunde inte hämta arbetsflödets status.')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [enabled, inspectionId, organizationId, workflowProfile])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshToken])

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    const handleUpdate = () => void refresh(true)
    window.addEventListener(TU_ANALYSIS_UPDATED_EVENT, handleUpdate)
    window.addEventListener(TU_REPORT_DRAFT_UPDATED_EVENT, handleUpdate)
    window.addEventListener(TU_CONTROL_PLAN_UPDATED_EVENT, handleUpdate)
    return () => {
      window.removeEventListener(TU_ANALYSIS_UPDATED_EVENT, handleUpdate)
      window.removeEventListener(TU_REPORT_DRAFT_UPDATED_EVENT, handleUpdate)
      window.removeEventListener(TU_CONTROL_PLAN_UPDATED_EVENT, handleUpdate)
    }
  }, [enabled, refresh])

  const processing =
    workflow?.run?.status === 'queued'
    || workflow?.run?.status === 'processing'
    || reportDraft?.run?.status === 'queued'
    || reportDraft?.run?.status === 'processing'
    || preparation?.run?.status === 'queued'
    || preparation?.run?.status === 'processing'

  useEffect(() => {
    if (!enabled || !processing) return
    const timer = window.setInterval(() => void refresh(true), 4000)
    return () => window.clearInterval(timer)
  }, [enabled, processing, refresh])

  const steps = useMemo(() => deriveTuWorkflowSteps({
    workflowProfile,
    preparation,
    validation,
    workflow,
    reportDraft,
    delivery,
    queue,
    reportFilledSectionCount,
    reportSectionCount,
  }), [delivery, preparation, queue, reportDraft, reportFilledSectionCount, reportSectionCount, validation, workflow, workflowProfile])

  return { preparation, validation, workflow, reportDraft, delivery, steps, loading, error, refresh }
}
