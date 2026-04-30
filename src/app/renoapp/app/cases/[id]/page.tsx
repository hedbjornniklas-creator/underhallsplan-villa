'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import RenoAppCaseDecisionView, {
  type RenoAppCaseDetail,
  type RenoAppCaseStatusAction,
} from './RenoAppCaseDecisionView'

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
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/renoapp/app/cases" className="text-sm font-semibold text-stone-700 underline-offset-4 hover:underline">
          Tillbaka till ärenden
        </Link>
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
