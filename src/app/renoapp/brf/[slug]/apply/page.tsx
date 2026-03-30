'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'

type Requirement = {
  id: string
  documentTypeId: string
  documentKey: string
  documentLabel: string
  documentDescription: string | null
  isRequired: boolean
  phase?: 'before_required' | 'before_conditional' | 'after_completion'
  note: string | null
  sortOrder: number
}

type ActionCategory = {
  id: string
  slug: string
  label: string
  description: string | null
  sortOrder: number
}

type ActionType = {
  id: string
  category?: ActionCategory
  key: string
  label: string
  description: string | null
  riskLevel?: 'low' | 'medium' | 'high'
  contractorRequirement?:
    | 'none'
    | 'qualified_contractor'
    | 'authorized_electrician'
    | 'safe_water'
    | 'bkr_or_gvk'
    | 'structural_engineer'
  sortOrder: number
  requirements: Requirement[]
}

type PublicConfigResponse = {
  brf: {
    id: string
    name: string
    slug: string
    applyIntroText: string | null
  }
  actionTypes: ActionType[]
}

type DraftResponse = {
  state: 'open' | 'expired' | 'revoked'
  access: {
    email: string
    expiresAt: string
    lastUsedAt: string | null
  }
  brf: {
    id: string
    name: string
    slug: string
  }
  form: {
    applicantName: string
    applicantEmail: string
    applicantPhone: string
    unitNumberInternal: string
    unitNumberSkatteverket: string
    description: string
    contractorName: string
    contractorOrgNumber: string
    contractorEmail: string
    contractorPhone: string
    contractorHasRequiredCertification: boolean
    actionTypeKeys: string[]
    checks?: {
      affectsStructure: boolean
      affectsPlumbing: boolean
      affectsVentilation: boolean
      affectsElectrical: boolean
      affectsWetRoom: boolean
      affectsSurfaceOnly: boolean
    }
  }
  case: {
    id: string
    caseNumber: string
    status: string
    submittedAt: string
    updatedAt: string
  }
}

type SubmitResult = {
  caseId: string
  caseNumber: string
  accessUrl: string
  resumeUrl: string
  status: 'draft' | 'submitted'
  emailSent: boolean
  emailError: string | null
}

type FormState = {
  applicantName: string
  applicantEmail: string
  applicantPhone: string
  unitNumberInternal: string
  unitNumberSkatteverket: string
  actionTypeKeys: string[]
  description: string
  contractorName: string
  contractorOrgNumber: string
  contractorEmail: string
  contractorPhone: string
  contractorHasRequiredCertification: boolean
}

const INITIAL_FORM: FormState = {
  applicantName: '',
  applicantEmail: '',
  applicantPhone: '',
  unitNumberInternal: '',
  unitNumberSkatteverket: '',
  actionTypeKeys: [],
  description: '',
  contractorName: '',
  contractorOrgNumber: '',
  contractorEmail: '',
  contractorPhone: '',
  contractorHasRequiredCertification: false,
}

const STEP_ITEMS = [
  { id: 1, label: 'Vad vill du renovera?' },
  { id: 2, label: 'Dokument och underlag' },
  { id: 3, label: 'Projekt och entreprenör' },
  { id: 4, label: 'Lägenhet och kontakt' },
  { id: 5, label: 'Granska och skicka' },
]

function formatDateTime(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function mergeRequirements(actions: ActionType[]) {
  const merged = new Map<string, Requirement>()

  for (const action of actions) {
    for (const requirement of action.requirements) {
      const current = merged.get(requirement.documentTypeId)
      if (!current) {
        merged.set(requirement.documentTypeId, requirement)
        continue
      }

      merged.set(requirement.documentTypeId, {
        ...current,
        isRequired: current.isRequired || requirement.isRequired,
        phase:
          current.phase === 'before_required' || requirement.phase === 'before_required'
            ? 'before_required'
            : current.phase === 'before_conditional' || requirement.phase === 'before_conditional'
              ? 'before_conditional'
              : current.phase ?? requirement.phase,
        note: current.note || requirement.note,
        sortOrder: Math.min(current.sortOrder, requirement.sortOrder),
      })
    }
  }

  return Array.from(merged.values()).sort((left, right) => left.sortOrder - right.sortOrder)
}

function groupActionsByCategory(actions: ActionType[]) {
  const grouped = new Map<string, { category: ActionCategory; actions: ActionType[] }>()

  for (const action of actions) {
    const category = action.category ?? {
      id: 'ovrigt',
      slug: 'ovrigt',
      label: 'Övrigt',
      description: null,
      sortOrder: 999,
    }

    if (!grouped.has(category.id)) {
      grouped.set(category.id, { category, actions: [] })
    }

    grouped.get(category.id)?.actions.push(action)
  }

  return Array.from(grouped.values()).sort((left, right) => left.category.sortOrder - right.category.sortOrder)
}

function groupRequirementsByPhase(requirements: Requirement[]) {
  return {
    beforeRequired: requirements.filter((item) => item.phase === 'before_required'),
    beforeConditional: requirements.filter((item) => item.phase === 'before_conditional'),
    afterCompletion: requirements.filter((item) => item.phase === 'after_completion'),
    uncategorized: requirements.filter((item) => !item.phase),
  }
}

function getContractorRequirementText(requirement?: ActionType['contractorRequirement']) {
  if (requirement === 'authorized_electrician') return 'Kräver behörig elektriker.'
  if (requirement === 'safe_water') return 'Kräver Säker Vatten-auktoriserad VVS-entreprenör.'
  if (requirement === 'bkr_or_gvk') return 'Kräver behörig våtrumsentreprenör enligt BKR eller GVK.'
  if (requirement === 'structural_engineer') return 'Kräver konstruktör eller särskilt sakkunnig.'
  if (requirement === 'qualified_contractor') return 'Kräver kvalificerad entreprenör.'
  return null
}


function renderRequirementList(items: Requirement[]) {
  return (
    <ul className="space-y-2">
      {items.map((requirement) => (
        <li key={requirement.documentTypeId} className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <p className="font-medium text-stone-900">
            {requirement.documentLabel} {requirement.isRequired ? '(obligatorisk)' : '(bra att ha)'}
          </p>
          {requirement.documentDescription ? <p className="mt-1">{requirement.documentDescription}</p> : null}
          {requirement.note ? <p className="mt-1 text-stone-500">{requirement.note}</p> : null}
        </li>
      ))}
    </ul>
  )
}

const compactDescriptionStyle = {
  display: '-webkit-box',
  WebkitLineClamp: 1,
  WebkitBoxOrient: 'vertical' as const,
  overflow: 'hidden',
}

export default function RenoAppApplyPage() {
  const router = useRouter()
  const params = useParams<{ slug: string }>()
  const searchParams = useSearchParams()
  const slug = typeof params?.slug === 'string' ? params.slug : 'okand-brf'
  const initialDraftToken = searchParams.get('draft') ?? ''

  const [config, setConfig] = useState<PublicConfigResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [step, setStep] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null)
  const [activeDraftToken, setActiveDraftToken] = useState(initialDraftToken)
  const [draftInfo, setDraftInfo] = useState<DraftResponse | null>(null)
  const [savingDraft, setSavingDraft] = useState(false)

  useEffect(() => {
    let active = true

    const loadConfig = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/renoapp/brf/${slug}/public`, { cache: 'no-store' })
        const payload = (await response.json().catch(() => ({}))) as PublicConfigResponse & { error?: string }

        if (!response.ok) {
          throw new Error(payload.error ?? 'Kunde inte läsa BRF-konfiguration.')
        }

        if (!active) return
        setConfig(payload)
      } catch (fetchError) {
        if (!active) return
        setError(fetchError instanceof Error ? fetchError.message : 'Kunde inte läsa BRF-konfiguration.')
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadConfig()

    return () => {
      active = false
    }
  }, [slug])

  useEffect(() => {
    let active = true

    const loadDraft = async () => {
      if (!activeDraftToken) {
        setDraftInfo(null)
        return
      }

      try {
        const response = await fetch(`/api/renoapp/public/applications/draft/${activeDraftToken}`, {
          cache: 'no-store',
        })
        const payload = (await response.json().catch(() => ({}))) as DraftResponse & { error?: string }

        if (!response.ok) {
          throw new Error(payload.error ?? 'Kunde inte läsa utkastet.')
        }

        if (!active) return

        setDraftInfo(payload)
        setForm({
          applicantName: payload.form.applicantName,
          applicantEmail: payload.form.applicantEmail,
          applicantPhone: payload.form.applicantPhone,
          unitNumberInternal: payload.form.unitNumberInternal,
          unitNumberSkatteverket: payload.form.unitNumberSkatteverket,
          actionTypeKeys: payload.form.actionTypeKeys,
          description: payload.form.description,
          contractorName: payload.form.contractorName,
          contractorOrgNumber: payload.form.contractorOrgNumber,
          contractorEmail: payload.form.contractorEmail,
          contractorPhone: payload.form.contractorPhone,
          contractorHasRequiredCertification: payload.form.contractorHasRequiredCertification,
        })
      } catch (fetchError) {
        if (!active) return
        setError(fetchError instanceof Error ? fetchError.message : 'Kunde inte läsa utkastet.')
      }
    }

    void loadDraft()

    return () => {
      active = false
    }
  }, [activeDraftToken])

  const selectedActions = useMemo(
    () => config?.actionTypes.filter((action) => form.actionTypeKeys.includes(action.key)) ?? [],
    [config, form.actionTypeKeys]
  )

  const mergedRequirements = useMemo(() => mergeRequirements(selectedActions), [selectedActions])
  const actionGroups = useMemo(() => groupActionsByCategory(config?.actionTypes ?? []), [config?.actionTypes])
  const requirementGroups = useMemo(() => groupRequirementsByPhase(mergedRequirements), [mergedRequirements])
  const contractorRequirementTexts = useMemo(
    () =>
      Array.from(
        new Set(selectedActions.map((action) => getContractorRequirementText(action.contractorRequirement)).filter(Boolean))
      ) as string[],
    [selectedActions]
  )
  const stepSummaries = useMemo<Record<number, string>>(
    () => ({
      1:
        selectedActions.length > 0
          ? selectedActions
              .map((action) => action.label)
              .slice(0, 3)
              .join(', ')
          : 'Inga renoveringar valda ännu.',
      2:
        mergedRequirements.length > 0
          ? `${requirementGroups.beforeRequired.length} obligatoriska dokument, ${
              mergedRequirements.length - requirementGroups.beforeRequired.length
            } övriga underlag.`
          : 'Välj först vad du vill renovera.',
      3:
        form.contractorName || form.description
          ? `${form.contractorName ? `Entreprenör: ${form.contractorName}. ` : ''}${
              form.contractorHasRequiredCertification ? 'Behörighet bekräftad.' : 'Behörighet inte bekräftad ännu.'
            }`
          : 'Projektbeskrivning och entreprenör saknas ännu.',
      4:
        form.applicantName || form.applicantEmail
          ? `${form.applicantName || 'Ingen sökande angiven'}${form.applicantEmail ? `, ${form.applicantEmail}` : ''}`
          : 'Kontaktuppgifter saknas ännu.',
      5:
        submitResult?.caseNumber
          ? `Ärendenummer ${submitResult.caseNumber}.`
          : `${selectedActions.length} valda renoveringar och ${mergedRequirements.length} dokumentkrav sammanställda.`,
    }),
    [
      form.applicantEmail,
      form.applicantName,
      form.contractorHasRequiredCertification,
      form.contractorName,
      form.description,
      mergedRequirements.length,
      requirementGroups.beforeRequired.length,
      selectedActions,
      submitResult?.caseNumber,
    ]
  )

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const toggleActionType = (key: string) => {
    setForm((current) => ({
      ...current,
      actionTypeKeys: current.actionTypeKeys.includes(key)
        ? current.actionTypeKeys.filter((value) => value !== key)
        : [...current.actionTypeKeys, key],
    }))
  }

  const submitApplication = async (mode: 'draft' | 'submit') => {
    if (mode === 'draft') {
      setSavingDraft(true)
    } else {
      setSubmitting(true)
    }

    setError(null)
    setSubmitResult(null)

    try {
      const response = await fetch('/api/renoapp/public/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brfSlug: slug,
          draftToken: activeDraftToken || null,
          mode,
          applicantName: form.applicantName,
          applicantEmail: form.applicantEmail,
          applicantPhone: form.applicantPhone,
          unitNumberInternal: form.unitNumberInternal,
          unitNumberSkatteverket: form.unitNumberSkatteverket,
          description: form.description,
          contractorName: form.contractorName,
          contractorOrgNumber: form.contractorOrgNumber,
          contractorEmail: form.contractorEmail,
          contractorPhone: form.contractorPhone,
          contractorHasRequiredCertification: form.contractorHasRequiredCertification,
          actionTypeKeys: form.actionTypeKeys,
        }),
      })

      const payload = (await response.json().catch(() => ({}))) as SubmitResult & { error?: string }
      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte spara ansökan.')
      }

      setSubmitResult(payload)

      const nextDraftToken =
        payload.resumeUrl.match(/[?&]draft=([^&]+)/)?.[1] ?? activeDraftToken

      if (nextDraftToken) {
        setActiveDraftToken(nextDraftToken)
        router.replace(`/renoapp/brf/${slug}/apply?draft=${nextDraftToken}`)
      }

      if (mode === 'submit') {
        setStep(5)
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Kunde inte spara ansökan.')
    } finally {
      setSavingDraft(false)
      setSubmitting(false)
    }
  }

  const renderStepContent = (stepId: number) => {
    if (stepId === 1) {
      return (
        <div className="space-y-6">
          {actionGroups.map((group) => (
            <div key={group.category.id}>
              <div className="mb-3">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">{group.category.label}</p>
                {group.category.description ? (
                  <p className="mt-1 text-sm text-stone-700">{group.category.description}</p>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {group.actions.map((action) => {
                  const selected = form.actionTypeKeys.includes(action.key)

                  return (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => toggleActionType(action.key)}
                      className={`min-h-[74px] rounded-[22px] border px-4 py-3 text-left transition ${
                        selected
                          ? 'border-emerald-600 bg-emerald-50 shadow-[0_10px_30px_-20px_rgba(5,150,105,0.7)]'
                          : 'border-stone-200 bg-white hover:border-stone-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="truncate text-base font-semibold text-stone-900">{action.label}</p>
                          {action.description ? (
                            <p className="mt-1 text-sm leading-6 text-stone-700" style={compactDescriptionStyle}>
                              {action.description}
                            </p>
                          ) : null}
                        </div>
                        <span
                          className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                            selected
                              ? 'border-emerald-700 bg-emerald-700 text-white'
                              : 'border-stone-300 bg-white text-stone-500'
                          }`}
                        >
                          {selected ? 'x' : '+'}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )
    }

    if (stepId === 2) {
      return (
        <div className="grid gap-4">
          <div className="rounded-3xl border border-stone-200 bg-white p-5">
            <p className="text-sm leading-7 text-stone-700">
              Här ser du vad som normalt behöver bifogas utifrån de renoveringstyper du valt. Om något saknas nu kan
              du ändå spara utkastet och komplettera senare.
            </p>
          </div>
          {mergedRequirements.length === 0 ? (
            <div className="rounded-3xl border border-stone-200 bg-white p-5 text-sm text-stone-700">
              Välj först minst en renoveringstyp i steg 1.
            </div>
          ) : (
            mergedRequirements.map((requirement) => (
              <div key={requirement.documentTypeId} className="rounded-3xl border border-stone-200 bg-white p-5">
                <p className="font-semibold text-stone-900">
                  {requirement.documentLabel} {requirement.isRequired ? '(obligatorisk)' : '(bra att ha)'}
                </p>
                {requirement.documentDescription ? (
                  <p className="mt-2 text-sm leading-7 text-stone-700">{requirement.documentDescription}</p>
                ) : null}
                {requirement.note ? <p className="mt-2 text-sm text-stone-500">{requirement.note}</p> : null}
              </div>
            ))
          )}
        </div>
      )
    }

    if (stepId === 3) {
      return (
        <div className="grid gap-4">
          <div className="rounded-3xl border border-stone-200 bg-white p-5">
            <label className="block text-sm font-semibold text-stone-900" htmlFor="description">
              Beskriv projektet
            </label>
            <textarea
              id="description"
              value={form.description}
              onChange={(event) => updateField('description', event.target.value)}
              rows={7}
              className="mt-3 min-h-44 w-full rounded-3xl border border-stone-300 bg-white px-5 py-4 text-sm text-stone-900"
              placeholder="Beskriv kort vad du vill göra, hur omfattande arbetet är och om du redan har ritningar eller annan dokumentation klar."
            />
          </div>

          <div className="rounded-3xl border border-stone-200 bg-white p-5">
            <p className="text-sm font-semibold text-stone-900">Entreprenör</p>
            <p className="mt-2 text-sm leading-7 text-stone-700">
              Vi fokuserar på vem som ska utföra arbetet och om rätt behörighet finns, i stället för att fråga efter
              tekniska detaljval i detta steg.
            </p>
            {contractorRequirementTexts.length > 0 ? (
              <ul className="mt-3 space-y-2 text-sm text-stone-700">
                {contractorRequirementTexts.map((item) => (
                  <li key={item} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                    {item}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <input
                value={form.contractorName}
                onChange={(event) => updateField('contractorName', event.target.value)}
                className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 md:col-span-2"
                placeholder="Företag eller entreprenör"
              />
              <input
                value={form.contractorOrgNumber}
                onChange={(event) => updateField('contractorOrgNumber', event.target.value)}
                className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                placeholder="Organisationsnummer"
              />
              <input
                value={form.contractorPhone}
                onChange={(event) => updateField('contractorPhone', event.target.value)}
                className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                placeholder="Telefon"
              />
              <input
                value={form.contractorEmail}
                onChange={(event) => updateField('contractorEmail', event.target.value)}
                className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 md:col-span-2"
                placeholder="E-post"
                type="email"
              />
            </div>
            <label className="mt-4 flex items-start gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
              <input
                checked={form.contractorHasRequiredCertification}
                onChange={(event) => updateField('contractorHasRequiredCertification', event.target.checked)}
                type="checkbox"
                className="mt-1"
              />
              <span>Jag bekräftar att entreprenören har den behörighet eller certifiering som arbetet kräver.</span>
            </label>
          </div>
        </div>
      )
    }

    if (stepId === 4) {
      return (
        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <input
              value={form.applicantName}
              onChange={(event) => updateField('applicantName', event.target.value)}
              className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
              placeholder="Namn"
            />
            <input
              value={form.applicantEmail}
              onChange={(event) => updateField('applicantEmail', event.target.value)}
              className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
              placeholder="E-post"
              type="email"
            />
            <input
              value={form.applicantPhone}
              onChange={(event) => updateField('applicantPhone', event.target.value)}
              className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 md:col-span-2"
              placeholder="Telefon"
            />
            <input
              value={form.unitNumberInternal}
              onChange={(event) => updateField('unitNumberInternal', event.target.value)}
              className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
              placeholder="Internt lägenhetsnummer"
            />
            <input
              value={form.unitNumberSkatteverket}
              onChange={(event) => updateField('unitNumberSkatteverket', event.target.value)}
              className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
              placeholder="Skatteverkets lägenhetsnummer"
            />
          </div>

          <div className="rounded-3xl border border-stone-200 bg-white p-5 text-sm leading-7 text-stone-700">
            <p className="font-semibold text-stone-900">Spara och fortsätt senare</p>
            <p className="mt-2">
              När du sparar skapas ett utkast och du får en säker länk som du kan öppna senare för att fortsätta.
            </p>
          </div>
        </div>
      )
    }

    return (
      <div className="grid gap-4">
        <div className="rounded-3xl border border-stone-200 bg-white p-5">
          <p className="text-sm font-semibold text-stone-900">Sammanfattning</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
              <p className="font-medium text-stone-900">Sökande</p>
              <p className="mt-1">{form.applicantName || '-'}</p>
              <p>{form.applicantEmail || '-'}</p>
              <p>{form.applicantPhone || '-'}</p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
              <p className="font-medium text-stone-900">Lägenhet</p>
              <p className="mt-1">Internt nr: {form.unitNumberInternal || '-'}</p>
              <p>Skatteverket: {form.unitNumberSkatteverket || '-'}</p>
            </div>
          </div>
        </div>

        {submitResult ? (
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-950">
            <p className="font-semibold">{submitResult.status === 'draft' ? 'Utkast sparat' : 'Ansökan registrerad'}</p>
            <p className="mt-2">Ärendenummer: {submitResult.caseNumber}</p>
            <p className="mt-2 break-all">
              {submitResult.status === 'draft' ? 'Fortsätt senare via:' : 'Öppna ärendet via:'}{' '}
              {submitResult.status === 'draft' ? submitResult.resumeUrl : submitResult.accessUrl}
            </p>
            {submitResult.emailError ? <p className="mt-2 text-amber-900">{submitResult.emailError}</p> : null}
          </div>
        ) : null}
      </div>
    )
  }

  if (loading) {
    return <main className="mx-auto min-h-screen max-w-6xl px-6 py-14 md:px-10">Laddar ansökningsguide...</main>
  }

  if (error && !config) {
    return (
      <main className="mx-auto min-h-screen max-w-6xl px-6 py-14 md:px-10">
        <div className="rounded-[32px] border border-rose-200 bg-rose-50 p-8 text-rose-900">
          {error}
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <section className="rounded-[32px] border border-stone-200/80 bg-[linear-gradient(160deg,rgba(244,240,233,0.92),rgba(255,255,255,0.98))] p-6 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)] md:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Ansökningsguide</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-stone-900">{config?.brf.name ?? slug}</h1>
            <p className="mt-4 max-w-4xl text-base leading-8 text-stone-700">
              {config?.brf.applyIntroText ??
                'Guiden hjälper dig att välja rätt renoveringstyper, förstå vilka dokument som behövs och skicka in ett komplett underlag till din BRF.'}
            </p>
          </div>
          <div className="text-right text-xs text-stone-500">
            <p>BRF-kod</p>
            <p className="mt-1 font-semibold uppercase tracking-[0.18em] text-stone-700">{config?.brf.slug}</p>
          </div>
        </div>

        {draftInfo ? (
          <div className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p className="font-semibold">Du arbetar i ett sparat utkast.</p>
            <p className="mt-2">
              Ärendenummer {draftInfo.case.caseNumber} uppdaterades senast {formatDateTime(draftInfo.case.updatedAt)}.
            </p>
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-3xl border border-stone-200 bg-white/85 p-5">
            <p className="text-sm font-semibold text-stone-900">Valda renoveringar</p>
            {selectedActions.length === 0 ? (
              <p className="mt-3 text-sm text-stone-700">Inga renoveringstyper valda ännu.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm text-stone-700">
                {selectedActions.map((action) => (
                  <li key={action.id} className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
                    <p className="font-medium text-stone-900">{action.label}</p>
                    {action.description ? <p className="mt-1">{action.description}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-3xl border border-stone-200 bg-white/85 p-5">
            <p className="text-sm font-semibold text-stone-900">Dokument som behövs</p>
            {mergedRequirements.length === 0 ? (
              <p className="mt-3 text-sm text-stone-700">Välj renoveringstyper för att se dokumentkrav.</p>
            ) : (
              <div className="mt-3 space-y-4 text-sm text-stone-700">
                {requirementGroups.beforeRequired.length > 0 ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Krävs före ansökan</p>
                    {renderRequirementList(requirementGroups.beforeRequired)}
                  </div>
                ) : null}
                {requirementGroups.beforeConditional.length > 0 ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Kan behövas beroende på arbete</p>
                    {renderRequirementList(requirementGroups.beforeConditional)}
                  </div>
                ) : null}
                {requirementGroups.afterCompletion.length > 0 ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Lämnas efter färdigställande</p>
                    {renderRequirementList(requirementGroups.afterCompletion)}
                  </div>
                ) : null}
                {requirementGroups.uncategorized.length > 0 ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Övrigt underlag</p>
                    {renderRequirementList(requirementGroups.uncategorized)}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 rounded-3xl border border-stone-200 bg-white/80 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Ansökan steg för steg</p>
              <h2 className="mt-2 text-2xl font-semibold text-stone-900">Fyll ett steg i taget</h2>
              <p className="mt-2 text-sm text-stone-600">
                Varje steg öppnas direkt under sin egen rad. Du kan alltid öppna ett tidigare steg igen och ändra något.
              </p>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {STEP_ITEMS.map((item) => {
              const isOpen = step === item.id

              return (
                <section
                  key={item.id}
                  className={`overflow-hidden rounded-[28px] border transition ${
                    isOpen
                      ? 'border-stone-300 bg-white shadow-[0_18px_50px_-35px_rgba(41,37,36,0.45)]'
                      : 'border-stone-200 bg-stone-50/80'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setStep(item.id)}
                    className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                          isOpen
                            ? 'border-stone-900 bg-stone-900 text-white'
                            : 'border-stone-300 bg-white text-stone-700'
                        }`}
                      >
                        {item.id}
                      </span>
                      <div className="min-w-0">
                        <p className="text-base font-semibold text-stone-900">{item.label}</p>
                        {!isOpen ? <p className="mt-1 text-sm text-stone-600">{stepSummaries[item.id]}</p> : null}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                      {isOpen ? 'Öppet' : 'Öppna'}
                    </span>
                  </button>

                  {isOpen ? <div className="border-t border-stone-200 px-5 py-5">{renderStepContent(item.id)}</div> : null}
                </section>
              )
            })}
          </div>

          {error ? (
            <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {error}
            </div>
          ) : null}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {step !== 5 ? (
              <button
                type="button"
                onClick={() => setStep((current) => (current == null ? 1 : Math.min(5, current + 1)))}
                className="rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-700"
              >
                Nästa steg
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void submitApplication('submit')}
                disabled={submitting}
                className="rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? 'Skickar...' : 'Skicka ansökan'}
              </button>
            )}
            <button
              type="button"
              onClick={() => void submitApplication('draft')}
              disabled={savingDraft}
              className="rounded-full border border-stone-300 px-5 py-3 text-sm font-semibold text-stone-800 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingDraft ? 'Sparar...' : 'Spara och fortsätt senare'}
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}

