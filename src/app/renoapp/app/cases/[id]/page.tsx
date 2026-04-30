'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import RenoAppCaseDecisionView, {
  type RenoAppCaseDetail,
  type RenoAppCaseStatusAction,
} from './RenoAppCaseDecisionView'

function getFlowStepClass(active: boolean, tone: 'blue' | 'amber' | 'violet' | 'emerald' | 'rose' | 'stone') {
  if (active) {
    if (tone === 'blue') return 'border-sky-300 bg-sky-50 text-sky-950'
    if (tone === 'amber') return 'border-amber-300 bg-amber-50 text-amber-950'
    if (tone === 'violet') return 'border-violet-300 bg-violet-50 text-violet-950'
    if (tone === 'emerald') return 'border-emerald-300 bg-emerald-50 text-emerald-950'
    if (tone === 'rose') return 'border-rose-300 bg-rose-50 text-rose-950'
  }

  return 'border-stone-200 bg-white text-stone-800'
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
    <section className="min-w-0 flex-1 rounded-[18px] border border-stone-200 bg-white px-4 py-4 shadow-[0_18px_55px_-48px_rgba(41,37,36,0.36)]">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className={getFlowStepClass(activeMainStep === 1, 'blue') + ' rounded-[14px] border px-4 py-3'}>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">1</p>
          <p className="mt-1 text-sm font-semibold">Ansökan inkommen</p>
          <p className="mt-1 text-xs leading-5 text-stone-600">Ansökan är registrerad.</p>
        </div>

        <div className="hidden text-stone-400 xl:block" aria-hidden="true">→</div>

        <div className={getFlowStepClass(activeMainStep === 2, 'amber') + ' rounded-[14px] border px-4 py-3'}>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">2</p>
          <p className="mt-1 text-sm font-semibold">Styrelsen granskar</p>
          <p className="mt-1 text-xs leading-5 text-stone-600">Begär in de uppgifter som behövs.</p>
        </div>

        <div className="hidden text-stone-400 xl:block" aria-hidden="true">→</div>

        <div className={getFlowStepClass(activeMainStep === 3, 'violet') + ' rounded-[14px] border px-4 py-3'}>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">3</p>
          <p className="mt-1 text-sm font-semibold">Sökanden kompletterar</p>
          <p className="mt-1 text-xs leading-5 text-stone-600">Begärda uppgifter lämnas in.</p>
        </div>

        <div className="hidden text-stone-400 xl:block" aria-hidden="true">→</div>

        <div className="grid min-w-[250px] gap-2">
          <div className={getFlowStepClass(outcomeTone === 'amber', 'amber') + ' rounded-[14px] border px-4 py-2'}>
            <p className="text-sm font-semibold">Begär mer uppgifter</p>
            <p className="text-xs leading-5 text-stone-600">Styrelsen kan begära komplettering igen.</p>
          </div>
          <div className={getFlowStepClass(outcomeTone === 'rose', 'rose') + ' rounded-[14px] border px-4 py-2'}>
            <p className="text-sm font-semibold">Avslag</p>
            <p className="text-xs leading-5 text-stone-600">Ansökan avslås med motivering.</p>
          </div>
          <div className={getFlowStepClass(outcomeTone === 'emerald', 'emerald') + ' rounded-[14px] border px-4 py-2'}>
            <p className="text-sm font-semibold">Godkännande</p>
            <p className="text-xs leading-5 text-stone-600">Ansökan godkänns eller godkänns med villkor.</p>
          </div>
        </div>
      </div>
    </section>
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
    const requestedCompletionLines =
      item?.underlag
        .filter((row) => row.requirementDecision === 'requested')
        .map((row) => `${row.category === 'document' ? 'Underlag' : 'Uppgifter'}: ${row.label}`) ?? []
    const completionMessage =
      selectedStatus === 'need_info'
        ? [
            requestedCompletionLines.length > 0
              ? `Följande ska kompletteras:\n${requestedCompletionLines.map((line) => `- ${line}`).join('\n')}`
              : null,
            reason.trim() || null,
          ]
            .filter((line): line is string => Boolean(line))
            .join('\n\n')
        : reason

    if (!caseId) {
      setActionError('Ogiltigt RenoApp-ärende.')
      return
    }

    if (selectedStatus === 'need_info' && !completionMessage.trim()) {
      setActionError('Skriv vad lägenhetsinnehavaren behöver komplettera.')
      return
    }

    if (selectedStatus === 'rejected' && !reason.trim()) {
      setActionError('Skriv en motivering till avslaget.')
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
      const response = await fetch(`/api/renoapp/app/cases/${caseId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: selectedStatus,
          reason: selectedStatus === 'conditional' ? null : completionMessage,
          conditions: selectedStatus === 'conditional' ? conditions : null,
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as { item?: RenoAppCaseDetail; error?: string }

      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte uppdatera RenoApp-ärendet.')
      }

      setItem(payload.item ?? null)
      setActionSuccess('Ärendet uppdaterades.')
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

  const handleRequirementDecisionChange = async (
    row: RenoAppCaseDetail['underlag'][number],
    decision: 'requested' | 'not_requested'
  ) => {
    if (!caseId) {
      setActionError('Ogiltigt RenoApp-ärende.')
      return
    }

    const targetId = row.id.includes(':') ? row.id.split(':').slice(1).join(':') : row.id
    const previousItem = item
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

    try {
      const response = await fetch(`/api/renoapp/app/cases/${caseId}/requirement-decisions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          targetType: row.category,
          targetId,
          decision,
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as { item?: RenoAppCaseDetail; error?: string }

      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte spara kompletteringsval.')
      }

      setItem(payload.item ?? null)
      setActionSuccess('Kompletteringsvalet sparades.')
    } catch (submitError) {
      setItem(previousItem)
      setActionError(submitError instanceof Error ? submitError.message : 'Kunde inte spara kompletteringsval.')
    }
  }

  if (loading) {
    return (
      <div className="rounded-[18px] border border-stone-200/80 bg-white p-6 text-sm text-stone-600 shadow-[0_18px_55px_-44px_rgba(41,37,36,0.34)]">
        Laddar RenoApp-ärende...
      </div>
    )
  }

  if (error || !item) {
    return (
      <div className="grid gap-6">
        <Link href="/renoapp/app/cases" className="text-sm font-semibold text-stone-700 underline-offset-4 hover:underline">
          Tillbaka till ärenden
        </Link>
        <div className="rounded-[18px] border border-rose-200 bg-rose-50 p-6 text-rose-900">
          {error ?? 'Kunde inte läsa RenoApp-ärendet.'}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto grid w-full max-w-[1440px] gap-6 px-4 py-8 sm:px-8">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <Link href="/renoapp/app/cases" className="text-sm font-semibold text-stone-700 underline-offset-4 hover:underline">
          Tillbaka till ärenden
        </Link>
        <CaseFlowVisualization status={item.status} />
      </div>

      <RenoAppCaseDecisionView
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
        onSubmit={handleStatusSubmit}
      />
    </div>
  )
}
