'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, ChevronDown } from 'lucide-react'
import { useAutosaveQueue } from '@/hooks/useAutosaveQueue'
import { completionMessage, selectCompletionItems } from '@/lib/renoapp/completion'
import { clarificationItems, isOpenClarification, type Clarification } from '@/lib/renoapp/clarifications'
import RenoAppCaseDecisionView, {
  type RenoAppCaseDetail,
  type RenoAppCaseStatusAction,
} from './RenoAppCaseDecisionView'

type RequirementDecisionUpdate = {
  targetKey: string
  targetType: 'document' | 'participant'
  targetId: string
  decision: 'requested' | 'not_requested'
}

function mergeRequirementDecisionUpdates(
  previous: RequirementDecisionUpdate[],
  next: RequirementDecisionUpdate[]
) {
  const updates = new Map(previous.map((update) => [update.targetKey, update]))
  for (const update of next) {
    updates.set(update.targetKey, update)
  }
  return Array.from(updates.values())
}

function getFlowStepClass(active: boolean, tone: 'blue' | 'amber' | 'violet' | 'emerald' | 'rose' | 'stone') {
  if (active) {
    if (tone === 'blue') return 'border-sky-300 bg-sky-50 text-sky-950'
    if (tone === 'amber') return 'border-amber-300 bg-amber-50 text-amber-950'
    if (tone === 'violet') return 'border-violet-300 bg-violet-50 text-violet-950'
    if (tone === 'emerald') return 'border-emerald-300 bg-emerald-50 text-emerald-950'
    if (tone === 'rose') return 'border-rose-300 bg-rose-50 text-rose-950'
  }

  return 'border-[var(--reno-line)] bg-white text-[var(--reno-ink)]'
}

function CaseFlowVisualization({ status }: { status: string }) {
  const normalizedStatus = status === 'submitted' ? 'new_application' : status
  const activeMainStep =
    normalizedStatus === 'new_application'
      ? 1
      : normalizedStatus === 'need_info'
        ? 2
        : normalizedStatus === 'review'
          ? 3
          : 4

  const outcomeTone =
    normalizedStatus === 'approved' || normalizedStatus === 'conditional'
      ? 'emerald'
      : normalizedStatus === 'rejected'
        ? 'rose'
        : normalizedStatus === 'need_info'
          ? 'amber'
          : 'stone'

  return (
    <details className="reno-case-flow">
      <summary><ChevronDown size={18} aria-hidden="true" />Ärendets gång</summary>
      <div className="grid gap-3 pb-2 pt-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className={getFlowStepClass(activeMainStep === 1, 'blue') + ' rounded-lg border px-4 py-3'}>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--reno-muted)]">1</p>
          <p className="mt-1 text-sm font-semibold">Ansökan inkommen</p>
          <p className="mt-1 text-xs leading-5 text-[var(--reno-muted)]">Ansökan är registrerad.</p>
        </div>

        <div className={getFlowStepClass(activeMainStep === 2, 'amber') + ' rounded-lg border px-4 py-3'}>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--reno-muted)]">2</p>
          <p className="mt-1 text-sm font-semibold">Styrelsen granskar</p>
          <p className="mt-1 text-xs leading-5 text-[var(--reno-muted)]">Begär in de uppgifter som behövs.</p>
        </div>

        <div className={getFlowStepClass(activeMainStep === 3, 'violet') + ' rounded-lg border px-4 py-3'}>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--reno-muted)]">3</p>
          <p className="mt-1 text-sm font-semibold">Sökanden kompletterar</p>
          <p className="mt-1 text-xs leading-5 text-[var(--reno-muted)]">Begärda uppgifter lämnas in.</p>
        </div>

        <div className="grid min-w-0 gap-2">
          <div className={getFlowStepClass(outcomeTone === 'amber', 'amber') + ' rounded-lg border px-4 py-2'}>
            <p className="text-sm font-semibold">Begär mer uppgifter</p>
            <p className="text-xs leading-5 text-[var(--reno-muted)]">Styrelsen kan begära komplettering igen.</p>
          </div>
          <div className={getFlowStepClass(outcomeTone === 'rose', 'rose') + ' rounded-lg border px-4 py-2'}>
            <p className="text-sm font-semibold">Avslag</p>
            <p className="text-xs leading-5 text-[var(--reno-muted)]">Ansökan avslås med motivering.</p>
          </div>
          <div className={getFlowStepClass(outcomeTone === 'emerald', 'emerald') + ' rounded-lg border px-4 py-2'}>
            <p className="text-sm font-semibold">Godkännande</p>
            <p className="text-xs leading-5 text-[var(--reno-muted)]">Ansökan godkänns eller godkänns med villkor.</p>
          </div>
        </div>
      </div>
    </details>
  )
}

export default function RenoAppCaseDetailPage() {
  const params = useParams<{ id: string }>()
  const caseId = typeof params?.id === 'string' ? params.id : ''
  const [item, setItem] = useState<RenoAppCaseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [selectedStatus, setSelectedStatus] = useState<RenoAppCaseStatusAction>('need_info')
  const [reason, setReason] = useState('')
  const [conditions, setConditions] = useState('')
  const [decisionConfirmed, setDecisionConfirmed] = useState(false)
  const lastRequirementSaveRef = useRef<Promise<RenoAppCaseDetail | null> | null>(null)
  const completionAttemptRef = useRef<{ fingerprint: string; id: string } | null>(null)
  const busyClarifications = useRef(new Set<string>())
  const [clarificationBusy, setClarificationBusy] = useState(false)
  const handleClarificationBusy = useCallback((id: string, busy: boolean) => {
    if (busy) busyClarifications.current.add(id)
    else busyClarifications.current.delete(id)
    setClarificationBusy(busyClarifications.current.size > 0)
  }, [])
  const handleClarificationSaved = useCallback((row: Clarification) => {
    setItem(current => current ? { ...current, clarifications: (current.clarifications ?? []).map(old => old.question_id === row.question_id ? row : old) } : current)
  }, [])

  const saveRequirementDecisionBatch = useCallback(
    async (updates: RequirementDecisionUpdate[]) => {
      let savedItem: RenoAppCaseDetail | null = null

      for (const update of updates) {
        const response = await fetch(`/api/renoapp/app/cases/${caseId}/requirement-decisions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            targetType: update.targetType,
            targetId: update.targetId,
            decision: update.decision,
          }),
        })
        const payload = (await response.json().catch(() => ({}))) as { item?: RenoAppCaseDetail; error?: string }

        if (!response.ok) {
          throw new Error(payload.error ?? 'Kunde inte spara kompletteringsval.')
        }

        savedItem = payload.item ?? savedItem
      }

      if (!savedItem) {
        throw new Error('Kunde inte spara kompletteringsval.')
      }

      return savedItem
    },
    [caseId]
  )

  const requirementDecisionAutosave = useAutosaveQueue<RequirementDecisionUpdate[], RenoAppCaseDetail>({
    save: saveRequirementDecisionBatch,
    mergePayload: mergeRequirementDecisionUpdates,
    onSaved: (savedItem) => {
      setItem(current => ({ ...savedItem, clarifications: current?.clarifications ?? savedItem.clarifications }))
      setActionSuccess('Valen sparades.')
    },
    onError: (saveError) => {
      setActionError(saveError instanceof Error ? saveError.message : 'Kunde inte spara kompletteringsval.')
    },
  })

  useEffect(() => {
    let active = true

    const loadCase = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/renoapp/app/cases/${caseId}`, { cache: 'no-store' })
        const payload = (await response.json().catch(() => ({}))) as { item?: RenoAppCaseDetail; error?: string }

        if (!response.ok) {
          throw new Error(payload.error ?? 'Kunde inte läsa RenoApp-ärendet.')
        }

        if (active) {
          setItem(payload.item ?? null)
        }
      } catch (fetchError) {
        if (active) {
          setError(fetchError instanceof Error ? fetchError.message : 'Kunde inte läsa RenoApp-ärendet.')
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    if (caseId) {
      void loadCase()
    } else {
      setLoading(false)
      setError('Ogiltigt RenoApp-ärende.')
    }

    return () => {
      active = false
    }
  }, [caseId, reloadKey])

  const handleStatusSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const requestMessage = completionMessage([...selectCompletionItems(item?.underlag ?? []), ...clarificationItems(item?.clarifications ?? [])], reason)
    if (busyClarifications.current.size) {
      setActionError('Klarläggandevalen måste sparas innan beslutet skickas.')
      return
    }

    if (!caseId) {
      setActionError('Ogiltigt RenoApp-ärende.')
      return
    }

    if (selectedStatus === 'need_info' && !requestMessage.trim()) {
      setActionError('Skriv vad lägenhetsinnehavaren behöver komplettera.')
      return
    }

    if (['approved', 'conditional', 'rejected'].includes(selectedStatus) && !reason.trim()) {
      setActionError('Skriv en motivering till beslutet.')
      return
    }

    if (selectedStatus === 'conditional' && !conditions.trim()) {
      setActionError('Skriv vilka villkor som ska gälla.')
      return
    }

    if (selectedStatus !== 'need_info' && !decisionConfirmed) {
      setActionError('Bekräfta att beslutet fattas av styrelsen.')
      return
    }

    setSubmitting(true)
    setActionError(null)
    setActionSuccess(null)

    try {
      await lastRequirementSaveRef.current
      if (requirementDecisionAutosave.status === 'error') throw new Error('Underlagsvalen kunde inte sparas. Ladda om och kontrollera dem.')
      const selectedRequirementIds = item?.underlag.filter(row => row.requirementDecision === 'requested').map(row => row.id) ?? []
      const selectedClarifications = (item?.clarifications ?? []).filter(row => row.requested && isOpenClarification(row)).map(row => ({ questionId: row.question_id, revision: row.revision }))
      const fingerprint = JSON.stringify([selectedStatus, reason, selectedRequirementIds, selectedClarifications, item?.completion?.id])
      if (completionAttemptRef.current?.fingerprint !== fingerprint) completionAttemptRef.current = { fingerprint, id: crypto.randomUUID() }
      const response = await fetch(`/api/renoapp/app/cases/${caseId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: selectedStatus,
          reason,
          completionRequestId: completionAttemptRef.current.id,
          selectedRequirementIds,
          selectedClarifications,
          previousCompletionId: item?.completion?.id ?? null,
          conditions: selectedStatus === 'conditional' ? conditions : null,
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as { item?: RenoAppCaseDetail; error?: string }

      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte uppdatera RenoApp-ärendet.')
      }

      setItem(payload.item ?? null)
      setActionSuccess(payload.item?.completion?.delivery_status === 'failed'
        ? 'Begäran sparades, men mejlet kunde inte skickas.' : 'Ärendet uppdaterades.')
      completionAttemptRef.current = null
      setReason('')
      setConditions('')
      setDecisionConfirmed(false)
      setReloadKey((current) => current + 1)
    } catch (submitError) {
      setActionError(submitError instanceof Error ? submitError.message : 'Kunde inte uppdatera RenoApp-ärendet.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRequirementDecisionChange = (
    row: RenoAppCaseDetail['underlag'][number],
    decision: 'requested' | 'not_requested'
  ) => {
    if (!caseId) {
      setActionError('Ogiltigt RenoApp-ärende.')
      return
    }

    const targetId = row.id.includes(':') ? row.id.split(':').slice(1).join(':') : row.id
    setActionError(null)
    setActionSuccess(null)
    setItem((current) =>
      current
        ? {
            ...current,
            underlag: current.underlag.map((underlagRow) =>
              underlagRow.id === row.id
                ? {
                    ...underlagRow,
                    requirementDecision: decision,
                  }
                : underlagRow
            ),
          }
        : current
    )

    const save = requirementDecisionAutosave.enqueue([
      {
        targetKey: row.id,
        targetType: row.category,
        targetId,
        decision,
      },
    ])
    lastRequirementSaveRef.current = save
    void save.catch(() => undefined)
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-[var(--reno-line)] bg-white p-6 text-sm text-[var(--reno-muted)] shadow-none">
        Laddar RenoApp-ärende...
      </div>
    )
  }

  if (error || !item) {
    return (
      <div className="grid gap-6">
        <Link href="/renoapp/app/cases" className="text-sm font-semibold text-[var(--reno-muted)] underline-offset-4 hover:underline">
          Tillbaka till ärenden
        </Link>
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-rose-900">
          {error ?? 'Kunde inte läsa RenoApp-ärendet.'}
        </div>
      </div>
    )
  }

  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex items-center">
        <Link href="/renoapp/app/cases" className="reno-link inline-flex min-h-11 items-center gap-2 text-sm font-semibold hover:underline">
          <ArrowLeft size={16} aria-hidden="true" />
          Tillbaka till ärenden
        </Link>
      </div>
      <CaseFlowVisualization status={item.status} />

      <RenoAppCaseDecisionView
        clarificationBusy={clarificationBusy}
        onClarificationSaved={handleClarificationSaved}
        onClarificationBusyChange={handleClarificationBusy}
        item={item}
        selectedStatus={selectedStatus}
        reason={reason}
        conditions={conditions}
        decisionConfirmed={decisionConfirmed}
        submitting={submitting}
        actionError={actionError}
        actionSuccess={actionSuccess}
        onStatusChange={(status) => {
          setSelectedStatus(status)
          setActionError(null)
          setActionSuccess(null)
        }}
        onReasonChange={setReason}
        onConditionsChange={setConditions}
        onDecisionConfirmedChange={setDecisionConfirmed}
        onRequirementDecisionChange={handleRequirementDecisionChange}
        onRetryDelivery={async () => {
          if (!item?.completion) return
          setSubmitting(true)
          setActionError(null)
          try {
            const response = await fetch(`/api/renoapp/app/cases/${caseId}`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'need_info', retryCompletion: true, completionRequestId: item.completion.id }),
            })
            const payload = await response.json()
            if (!response.ok) throw new Error(payload.error)
            setItem(payload.item)
          } catch (error) { setActionError(error instanceof Error ? error.message : 'Mejlet kunde inte skickas.') }
          finally { setSubmitting(false) }
        }}
        onSubmit={handleStatusSubmit}
      />
    </div>
  )
}
