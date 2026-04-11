'use client'

import { useMemo, useState, type FormEvent, type ReactNode } from 'react'

export type RenoAppCaseStatusAction = 'need_info' | 'approved' | 'conditional' | 'rejected'

export type RenoAppCaseDetail = {
  id: string
  caseNumber: string
  title: string
  description: string | null
  status: string
  riskLevel: string | null
  submittedAt: string
  updatedAt: string
  blockedAt: string | null
  blockedReason: string | null
  brf: {
    id: string
    name: string | null
    slug: string | null
  }
  actionType: {
    id: string | null
    key: string | null
    label: string | null
  }
  applicant: {
    id: string | null
    name: string | null
    email: string | null
    phone: string | null
  }
  unit: {
    id: string | null
    unitNumberInternal: string | null
    unitNumberSkatteverket: string | null
    status: string | null
  }
  checks: {
    affectsStructure: boolean
    affectsPlumbing: boolean
    affectsVentilation: boolean
    affectsElectrical: boolean
    affectsWetRoom: boolean
    affectsSurfaceOnly: boolean
  } | null
  currentContacts: Array<{
    id: string
    name: string | null
    email: string | null
    verificationStatus: string
    relationshipType: string
  }>
  documents: Array<{
    id: string
    documentTypeId: string | null
    documentTypeLabel: string | null
    fileName: string | null
    status: string
    uploadedAt: string
    note: string | null
  }>
  underlag: Array<{
    id: string
    category: 'document' | 'participant'
    label: string
    checked: boolean
    documentId: string | null
    summary: string[]
    details: {
      companyName: string | null
      contactName: string | null
      orgNumber: string | null
      email: string | null
      phone: string | null
      certificationReference: string | null
      hasVerifiedAuthorization: boolean
      acceptsResponsibility: boolean
    } | null
  }>
  requirements: Array<{
    id: string
    documentTypeId: string
    documentKey: string
    documentLabel: string
    documentDescription: string | null
    isRequired: boolean
    note: string | null
    sortOrder: number
  }>
  decisions: Array<{
    id: string
    decision: string
    conditions: string | null
    reason: string | null
    decidedAt: string
  }>
  accessLinks: Array<{
    id: string
    email: string
    scope: string
    expiresAt: string
    revokedAt: string | null
    lastUsedAt: string | null
  }>
  reviewFlags: Array<{
    id: string
    code: string
    label: string
    description: string | null
    severity: 'info' | 'warning' | 'high'
    category: string
    sourceType: 'answer_rule' | 'missing_document' | 'participant'
    sourceLabel: string | null
  }>
  messages: Array<{
    id: string
    type: 'request_for_info' | 'applicant_reply' | 'document_uploaded' | 'decision' | 'status_change'
    authorRole: 'board' | 'applicant' | 'system'
    authorName: string | null
    message: string | null
    createdAt: string
  }>
}

type UnderlagItem = RenoAppCaseDetail['underlag'][number]
type ReviewFlag = RenoAppCaseDetail['reviewFlags'][number]
type Message = RenoAppCaseDetail['messages'][number]

const STATUS_ACTIONS: RenoAppCaseStatusAction[] = ['need_info', 'approved', 'conditional', 'rejected']

const CONDITION_SNIPPETS = [
  'Arbetet ska utföras av behörig elektriker.',
  'Arbetet ska utföras av auktoriserad VVS-entreprenör.',
  'Bygganmälan ska vara godkänd innan byggstart.',
  'Intyg ska lämnas efter färdigställande.',
  'Arbetet ska följa föreningens regler för buller och arbetstider.',
]

const REJECTION_SNIPPETS = [
  'Underlaget är otillräckligt.',
  'Åtgärden är inte tillräckligt beskriven.',
  'Erforderliga handlingar saknas.',
  'Åtgärden kan inte bedömas på befintligt underlag.',
]

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ')
}

function repairText(value: string) {
  return value
    .replaceAll('Ã„', 'Ä')
    .replaceAll('Ã…', 'Å')
    .replaceAll('Ã–', 'Ö')
    .replaceAll('Ã¤', 'ä')
    .replaceAll('Ã¥', 'å')
    .replaceAll('Ã¶', 'ö')
    .replaceAll('Ã©', 'é')
}

function displayText(value: string | null | undefined, fallback = '-') {
  const text = String(value ?? '').trim()
  return text ? repairText(text) : fallback
}

function formatDate(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return displayText(value)
  return date.toLocaleDateString('sv-SE')
}

function formatDateTime(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return displayText(value)
  return date.toLocaleString('sv-SE')
}

function getCaseSubtitle(item: RenoAppCaseDetail) {
  return displayText(item.actionType.label ?? item.title, 'Renovering')
}

function formatStatusLabel(status: string) {
  if (status === 'draft') return 'Utkast'
  if (status === 'submitted') return 'Under granskning'
  if (status === 'ready_for_review') return 'Klar för granskning'
  if (status === 'need_info') return 'Begär komplettering'
  if (status === 'review') return 'Under granskning'
  if (status === 'approved') return 'Godkänd'
  if (status === 'conditional') return 'Godkänd med villkor'
  if (status === 'approved_with_conditions') return 'Godkänd med villkor'
  if (status === 'rejected') return 'Avslag'
  return displayText(status)
}

function getStatusBadgeClass(status: string) {
  if (status === 'draft') return 'border-stone-200 bg-stone-100 text-stone-700'
  if (status === 'submitted') return 'border-slate-200 bg-slate-100 text-slate-700'
  if (status === 'need_info') return 'border-amber-200 bg-amber-100 text-amber-900'
  if (status === 'ready_for_review' || status === 'review') return 'border-sky-200 bg-sky-100 text-sky-800'
  if (status === 'approved') return 'border-emerald-200 bg-emerald-100 text-emerald-800'
  if (status === 'conditional' || status === 'approved_with_conditions') {
    return 'border-lime-200 bg-lime-100 text-lime-900'
  }
  if (status === 'rejected') return 'border-rose-200 bg-rose-100 text-rose-800'
  return 'border-stone-200 bg-stone-100 text-stone-700'
}

function getBoardStatusOptionLabel(status: RenoAppCaseStatusAction) {
  if (status === 'need_info') return 'Begär komplettering'
  if (status === 'approved') return 'Godkänn'
  if (status === 'conditional') return 'Godkänn med villkor'
  return 'Avslag'
}

function getBoardActionSubmitLabel(status: RenoAppCaseStatusAction) {
  if (status === 'need_info') return 'Skicka begäran om komplettering'
  if (status === 'approved') return 'Bekräfta godkännande'
  if (status === 'conditional') return 'Bekräfta beslut med villkor'
  return 'Bekräfta avslag'
}

function getMessageTitle(type: Message['type']) {
  if (type === 'request_for_info') return 'Begäran om komplettering skickad'
  if (type === 'applicant_reply') return 'Lägenhetsinnehavaren skickade komplettering'
  if (type === 'document_uploaded') return 'Dokument uppladdat'
  if (type === 'decision') return 'Beslut registrerat'
  return 'Status uppdaterad'
}

function getMessageAuthorLabel(role: Message['authorRole']) {
  if (role === 'board') return 'Styrelse'
  if (role === 'applicant') return 'Lägenhetsinnehavare'
  return 'System'
}

function getDocumentStatusLabel(row: UnderlagItem) {
  return row.checked ? 'Inkommet' : 'Saknas'
}

function getParticipantStatusLabel(row: UnderlagItem) {
  return row.checked ? 'Uppgifter inlämnade' : 'Ej angiven'
}

function getSummaryChecked(line: string) {
  const normalized = repairText(line).trim().toLowerCase()
  return normalized.endsWith('finns') || normalized.startsWith('verifierad')
}

function appendSnippet(current: string, snippet: string) {
  if (current.includes(snippet)) return current
  return current.trim() ? `${current.trim()}\n- ${snippet}` : `- ${snippet}`
}

function buildCaseSummaryChips(item: RenoAppCaseDetail) {
  const chips: string[] = []
  const actionLabel = getCaseSubtitle(item)
  if (actionLabel && actionLabel !== '-') chips.push(actionLabel)
  if (item.checks?.affectsStructure) chips.push('Kan påverka konstruktion')
  if (item.checks?.affectsPlumbing) chips.push('Kan påverka VVS')
  if (item.checks?.affectsVentilation) chips.push('Kan påverka ventilation')
  if (item.checks?.affectsElectrical) chips.push('Kan påverka el')
  if (item.checks?.affectsWetRoom) chips.push('Berör våtrum')
  if (item.checks?.affectsSurfaceOnly) chips.push('Markerad som ytskiktsarbete')
  return Array.from(new Set(chips))
}

function buildConsiderations(item: RenoAppCaseDetail, missingItems: UnderlagItem[]) {
  const considerations: string[] = []
  if (item.checks?.affectsStructure) considerations.push('Åtgärden kan påverka bärande konstruktion eller stomme.')
  if (item.checks?.affectsPlumbing) considerations.push('Åtgärden kan påverka VVS-installationer.')
  if (item.checks?.affectsVentilation) considerations.push('Åtgärden kan påverka ventilation eller luftflöden.')
  if (item.checks?.affectsElectrical) considerations.push('Åtgärden kan påverka elinstallationer.')
  if (item.checks?.affectsWetRoom) considerations.push('Våtrumsrenovering omfattar normalt tätskikt och vatteninstallationer.')
  if (missingItems.length > 0) considerations.push('Saknat underlag innebär att vissa delar inte kan bedömas fullt ut.')
  return considerations.length > 0 ? considerations : ['Inga särskilda kontrollpunkter är registrerade från ansökans strukturerade svar.']
}

function getMissingReviewFlags(item: RenoAppCaseDetail) {
  return item.reviewFlags.filter((flag) => flag.severity !== 'info' || flag.sourceType === 'missing_document')
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <article
      className={cx(
        'rounded-[28px] border border-stone-200/80 bg-white/90 shadow-[0_24px_70px_-44px_rgba(41,37,36,0.42)]',
        className
      )}
    >
      {children}
    </article>
  )
}

function SectionTitle({ title, eyebrow, description }: { title: string; eyebrow?: string; description?: string }) {
  return (
    <div className="grid gap-1">
      {eyebrow ? <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">{eyebrow}</p> : null}
      <h2 className="text-2xl font-semibold tracking-tight text-stone-950">{title}</h2>
      {description ? <p className="text-sm leading-6 text-stone-600">{description}</p> : null}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cx('inline-flex rounded-full border px-4 py-1.5 text-sm font-semibold', getStatusBadgeClass(status))}>
      {formatStatusLabel(status)}
    </span>
  )
}

function KeyValueCard({ label, value, secondary }: { label: string; value: string; secondary?: string }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50/70 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-500">{label}</p>
      <p className="mt-2 text-base font-semibold text-stone-950">{value}</p>
      {secondary ? <p className="mt-1 text-sm leading-5 text-stone-600">{secondary}</p> : null}
    </div>
  )
}

function CaseHeaderSummary({ item }: { item: RenoAppCaseDetail }) {
  const summaryChips = buildCaseSummaryChips(item)

  return (
    <Card className="p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">Ärendesammanfattning</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-stone-950 sm:text-3xl">Ärende {item.caseNumber}</h1>
          <p className="mt-1 text-sm text-stone-600">{getCaseSubtitle(item)}</p>
        </div>
        <StatusBadge status={item.status} />
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KeyValueCard label="Ansökningsdatum" value={formatDate(item.submittedAt)} secondary={formatDateTime(item.submittedAt)} />
        <KeyValueCard label="Senast uppdaterad" value={formatDate(item.updatedAt)} secondary={formatDateTime(item.updatedAt)} />
        <KeyValueCard
          label="Sökande"
          value={displayText(item.applicant.name, 'Okänd kontakt')}
          secondary={[item.applicant.email, item.applicant.phone].filter(Boolean).map((value) => displayText(value)).join(' · ') || '-'}
        />
        <KeyValueCard
          label="Lägenhet"
          value={`Internt nr: ${displayText(item.unit.unitNumberInternal)}`}
          secondary={`Skatteverket: ${displayText(item.unit.unitNumberSkatteverket)}`}
        />
      </div>

      <div className="mt-6 grid gap-3 rounded-3xl border border-stone-200 bg-white p-5">
        <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">Sammanfattning av ansökan</h3>
        {summaryChips.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {summaryChips.map((chip) => (
              <span key={chip} className="rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-sm font-medium text-sky-900">
                {chip}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-stone-600">Strukturerad sammanfattning saknas.</p>
        )}
      </div>

      <div className="mt-4 rounded-3xl border border-stone-200 bg-stone-50/80 p-5">
        <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">Lägenhetsinnehavarens beskrivning</h3>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-stone-700">
          {displayText(item.description, 'Ingen beskrivning registrerad.')}
        </p>
        {item.blockedAt ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            <p className="font-semibold">Ärendet är spärrat</p>
            <p>Tidpunkt: {formatDateTime(item.blockedAt)}</p>
            <p>Orsak: {displayText(item.blockedReason, 'Ingen orsak angiven.')}</p>
          </div>
        ) : null}
      </div>
    </Card>
  )
}

function CaseMaterialStatusCard({ missingItems, reviewFlags }: { missingItems: UnderlagItem[]; reviewFlags: ReviewFlag[] }) {
  const missingLabels = Array.from(
    new Set([
      ...missingItems.map((item) => displayText(item.label)),
      ...reviewFlags.filter((flag) => flag.sourceType === 'missing_document').map((flag) => displayText(flag.label)),
    ])
  )
  const hasMissing = missingLabels.length > 0

  return (
    <Card className="p-6">
      <SectionTitle title="Underlagsstatus" />
      <div className={cx('mt-5 rounded-2xl border p-4', hasMissing ? 'border-amber-200 bg-amber-50 text-amber-950' : 'border-emerald-200 bg-emerald-50 text-emerald-950')}>
        <div className="flex items-start gap-3">
          <span className="mt-1 h-3 w-3 shrink-0 rounded-full bg-current" aria-hidden="true" />
          <div>
            <h3 className="font-semibold">
              {hasMissing ? 'Underlag saknas eller är ej angivet' : 'Inga registrerade underlag är markerade som saknade'}
            </h3>
            <p className="mt-2 text-sm leading-6">
              {hasMissing
                ? 'Följande delar behöver kontrolleras innan ärendet kan bedömas fullt ut.'
                : 'Styrelsen ansvarar själv för beslutet utifrån inkommet underlag.'}
            </p>
            {hasMissing ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                {missingLabels.slice(0, 6).map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </div>
    </Card>
  )
}

function ConsiderationsCard({ items }: { items: string[] }) {
  return (
    <Card className="p-6">
      <SectionTitle title="Att beakta inför beslut" />
      <ul className="mt-5 grid gap-3">
        {items.map((item) => (
          <li key={item} className="flex gap-3 text-sm leading-6 text-stone-700">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-stone-400" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function DocumentsPanel({
  item,
  documentRows,
  selectedDocumentIds,
  downloading,
  onToggleDocument,
  onDownloadAll,
  onDownloadSelected,
}: {
  item: RenoAppCaseDetail
  documentRows: UnderlagItem[]
  selectedDocumentIds: Record<string, boolean>
  downloading: boolean
  onToggleDocument: (documentId: string) => void
  onDownloadAll: () => void
  onDownloadSelected: () => void
}) {
  const requiredLabels = new Set(item.requirements.filter((requirement) => requirement.isRequired).map((requirement) => displayText(requirement.documentLabel)))
  const requiredRows = documentRows.filter((row) => requiredLabels.has(displayText(row.label)))
  const supportingRows = documentRows.filter((row) => !requiredLabels.has(displayText(row.label)))
  const documentById = new Map(item.documents.map((document) => [document.id, document]))
  const selectedCount = Object.values(selectedDocumentIds).filter(Boolean).length

  const renderRows = (rows: UnderlagItem[], emptyText: string) => {
    if (rows.length === 0) {
      return <p className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-600">{emptyText}</p>
    }

    return (
      <div className="overflow-hidden rounded-3xl border border-stone-200">
        {rows.map((row) => {
          const document = row.documentId ? documentById.get(row.documentId) : null
          return (
            <div key={row.id} className="grid gap-3 border-b border-stone-200 bg-white px-4 py-3 last:border-b-0 md:grid-cols-[auto_minmax(0,1fr)_160px_90px] md:items-center">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={row.documentId ? selectedDocumentIds[row.documentId] === true : false}
                  disabled={!row.documentId}
                  onChange={() => {
                    if (row.documentId) onToggleDocument(row.documentId)
                  }}
                  className="h-4 w-4 rounded border-stone-300 text-stone-700 accent-stone-700 disabled:opacity-40"
                  aria-label={`Markera ${displayText(row.label)}`}
                />
                <span
                  className={cx(
                    'inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold',
                    row.checked ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                  )}
                >
                  {row.checked ? 'OK' : '!'}
                </span>
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-stone-950">{displayText(row.label)}</p>
                {document?.fileName ? <p className="mt-1 truncate text-sm text-stone-500">{displayText(document.fileName)}</p> : null}
              </div>
              <p className="text-sm text-stone-700">{getDocumentStatusLabel(row)}</p>
              {row.documentId ? (
                <a
                  href={`/api/renoapp/app/cases/${item.id}/documents/${row.documentId}`}
                  className="text-sm font-semibold text-stone-900 underline-offset-4 hover:underline"
                >
                  Visa
                </a>
              ) : (
                <span className="text-sm text-stone-400">-</span>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <Card className="p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionTitle
          title="Underlag"
          description="Dokumentstatusen visar vad som har registrerats i ärendet. Statusen är inte en teknisk bedömning."
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onDownloadSelected}
            disabled={selectedCount === 0 || downloading}
            className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Ladda ner markerade
          </button>
          <button
            type="button"
            onClick={onDownloadAll}
            disabled={documentRows.every((row) => !row.documentId) || downloading}
            className="rounded-full border border-stone-900 bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {downloading ? 'Laddar ner...' : 'Ladda ner alla filer'}
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-6">
        <section className="grid gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">Obligatoriskt underlag</h3>
          {renderRows(requiredRows, 'Inga obligatoriska dokumentkrav är registrerade för ärendet.')}
        </section>
        <section className="grid gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">Kompletterande underlag</h3>
          {renderRows(supportingRows, 'Inga kompletterande underlag är registrerade.')}
        </section>
      </div>
    </Card>
  )
}

function ConsultantsPanel({
  rows,
  expandedParticipantIds,
  onToggle,
}: {
  rows: UnderlagItem[]
  expandedParticipantIds: Record<string, boolean>
  onToggle: (participantId: string) => void
}) {
  return (
    <Card className="p-6 sm:p-8">
      <SectionTitle
        title="Uppgifter om entreprenörer och konsulter"
        description="Följande roller kan vara relevanta beroende på åtgärdens omfattning."
      />
      {rows.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-600">
          Inga entreprenörer eller konsulter efterfrågas i ärendet.
        </p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-3xl border border-stone-200">
          {rows.map((row) => {
            const expanded = expandedParticipantIds[row.id] === true
            return (
              <div key={row.id} className="border-b border-stone-200 bg-white px-4 py-3 last:border-b-0">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_170px_80px] md:items-center">
                  <div className="min-w-0">
                    <p className="font-semibold text-stone-950">{displayText(row.label)}</p>
                    <p className="mt-1 text-sm text-stone-500">{row.details?.companyName ? displayText(row.details.companyName) : 'Företag ej angivet'}</p>
                  </div>
                  <p className="text-sm text-stone-700">{getParticipantStatusLabel(row)}</p>
                  <button
                    type="button"
                    onClick={() => onToggle(row.id)}
                    className="text-left text-sm font-semibold text-stone-900 underline-offset-4 hover:underline md:text-right"
                  >
                    {expanded ? 'Dölj' : 'Visa'}
                  </button>
                </div>

                {expanded ? (
                  <div className="mt-4 grid gap-4 rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <p><span className="font-semibold text-stone-950">Företag:</span> {displayText(row.details?.companyName)}</p>
                      <p><span className="font-semibold text-stone-950">Kontaktperson:</span> {displayText(row.details?.contactName)}</p>
                      <p><span className="font-semibold text-stone-950">Organisationsnummer:</span> {displayText(row.details?.orgNumber)}</p>
                      <p><span className="font-semibold text-stone-950">E-post:</span> {displayText(row.details?.email)}</p>
                      <p><span className="font-semibold text-stone-950">Telefon:</span> {displayText(row.details?.phone)}</p>
                      <p><span className="font-semibold text-stone-950">Certifiering:</span> {displayText(row.details?.certificationReference)}</p>
                    </div>
                    {row.summary.length > 0 ? (
                      <ul className="grid gap-2 border-t border-stone-200 pt-4">
                        {row.summary.map((line) => (
                          <li key={line} className="flex items-start gap-2">
                            <span
                              className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', getSummaryChecked(line) ? 'bg-emerald-500' : 'bg-amber-500')}
                              aria-hidden="true"
                            />
                            <span>{displayText(line)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

function BoardDecisionPanel({
  isDraftCase,
  selectedStatus,
  reason,
  conditions,
  decisionConfirmed,
  submitting,
  actionError,
  actionSuccess,
  missingSnippets,
  onStatusChange,
  onReasonChange,
  onConditionsChange,
  onDecisionConfirmedChange,
  onSubmit,
}: {
  isDraftCase: boolean
  selectedStatus: RenoAppCaseStatusAction
  reason: string
  conditions: string
  decisionConfirmed: boolean
  submitting: boolean
  actionError: string | null
  actionSuccess: string | null
  missingSnippets: string[]
  onStatusChange: (status: RenoAppCaseStatusAction) => void
  onReasonChange: (value: string) => void
  onConditionsChange: (value: string) => void
  onDecisionConfirmedChange: (value: boolean) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const showDecisionConfirmation = selectedStatus !== 'need_info'

  return (
    <Card className="p-6 sm:p-8">
      <SectionTitle
        title="Dokumentera styrelsens beslut"
        description="Beslutet fattas av styrelsen utifrån inkommet underlag. RenoApp tillhandahåller endast struktur och information."
      />

      {isDraftCase ? (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-900">
          Ärendet är fortfarande ett utkast. Styrelsen kan inte agera förrän lägenhetsinnehavaren har skickat in ansökan.
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 grid gap-5">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {STATUS_ACTIONS.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => onStatusChange(status)}
                className={cx(
                  'rounded-full border px-4 py-2 text-sm font-semibold transition',
                  selectedStatus === status
                    ? 'border-stone-900 bg-stone-900 text-white'
                    : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-100'
                )}
              >
                {getBoardStatusOptionLabel(status)}
              </button>
            ))}
          </div>

          {selectedStatus === 'need_info' ? (
            <label className="grid gap-2 text-sm text-stone-700">
              <span className="font-semibold text-stone-950">Vad behöver kompletteras?</span>
              {missingSnippets.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {missingSnippets.map((snippet) => (
                    <button
                      key={snippet}
                      type="button"
                      onClick={() => onReasonChange(appendSnippet(reason, snippet))}
                      className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-sm text-amber-900 hover:bg-amber-100"
                    >
                      {snippet}
                    </button>
                  ))}
                </div>
              ) : null}
              <textarea
                value={reason}
                onChange={(event) => onReasonChange(event.target.value)}
                rows={5}
                className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                placeholder="Meddelande till lägenhetsinnehavaren"
              />
            </label>
          ) : null}

          {selectedStatus === 'approved' ? (
            <label className="grid gap-2 text-sm text-stone-700">
              <span className="font-semibold text-stone-950">Intern beslutsnotering</span>
              <textarea
                value={reason}
                onChange={(event) => onReasonChange(event.target.value)}
                rows={4}
                className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                placeholder="Valfri intern notering."
              />
            </label>
          ) : null}

          {selectedStatus === 'conditional' ? (
            <label className="grid gap-2 text-sm text-stone-700">
              <span className="font-semibold text-stone-950">Villkor</span>
              <div className="flex flex-wrap gap-2">
                {CONDITION_SNIPPETS.map((snippet) => (
                  <button
                    key={snippet}
                    type="button"
                    onClick={() => onConditionsChange(appendSnippet(conditions, snippet))}
                    className="rounded-full border border-lime-200 bg-lime-50 px-3 py-1 text-sm text-lime-900 hover:bg-lime-100"
                  >
                    {snippet}
                  </button>
                ))}
              </div>
              <textarea
                value={conditions}
                onChange={(event) => onConditionsChange(event.target.value)}
                rows={5}
                className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                placeholder="Villkor som ska ingå i beslutet."
              />
            </label>
          ) : null}

          {selectedStatus === 'rejected' ? (
            <label className="grid gap-2 text-sm text-stone-700">
              <span className="font-semibold text-stone-950">Motivering</span>
              <div className="flex flex-wrap gap-2">
                {REJECTION_SNIPPETS.map((snippet) => (
                  <button
                    key={snippet}
                    type="button"
                    onClick={() => onReasonChange(appendSnippet(reason, snippet))}
                    className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-sm text-rose-900 hover:bg-rose-100"
                  >
                    {snippet}
                  </button>
                ))}
              </div>
              <textarea
                value={reason}
                onChange={(event) => onReasonChange(event.target.value)}
                rows={5}
                className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                placeholder="Motivering till avslag."
              />
            </label>
          ) : null}

          {showDecisionConfirmation ? (
            <label className="flex items-start gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm leading-6 text-stone-700">
              <input
                type="checkbox"
                checked={decisionConfirmed}
                onChange={(event) => onDecisionConfirmedChange(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-stone-300 accent-stone-900"
              />
              <span>Jag bekräftar att beslut fattas av styrelsen baserat på inkommet underlag.</span>
            </label>
          ) : null}

          {actionError ? <p className="text-sm text-rose-700">{actionError}</p> : null}
          {actionSuccess ? <p className="text-sm text-emerald-700">{actionSuccess}</p> : null}

          <button
            type="submit"
            disabled={submitting}
            className="justify-self-start rounded-full border border-stone-900 bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Sparar...' : getBoardActionSubmitLabel(selectedStatus)}
          </button>
        </form>
      )}
    </Card>
  )
}

function CaseHistoryTimeline({ messages, expanded, onToggle }: { messages: Message[]; expanded: boolean; onToggle: () => void }) {
  const visibleMessages = expanded ? messages : messages.slice(0, 4)

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-4">
        <SectionTitle title="Ärendehistorik" />
        {messages.length > 4 ? (
          <button type="button" onClick={onToggle} className="text-sm font-semibold text-stone-700 underline-offset-4 hover:underline">
            {expanded ? 'Visa mindre' : 'Visa full historik'}
          </button>
        ) : null}
      </div>

      {messages.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-600">
          Ingen historik har registrerats ännu.
        </p>
      ) : (
        <ol className="mt-5 grid gap-3">
          {visibleMessages.map((message) => (
            <li key={message.id} className="relative rounded-2xl border border-stone-200 bg-stone-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-semibold text-stone-950">{getMessageTitle(message.type)}</p>
                <p className="text-xs text-stone-500">{formatDateTime(message.createdAt)}</p>
              </div>
              <p className="mt-1 text-xs uppercase tracking-[0.14em] text-stone-500">
                {getMessageAuthorLabel(message.authorRole)}
                {message.authorName ? `: ${displayText(message.authorName)}` : ''}
              </p>
              {message.message ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-stone-700">{displayText(message.message)}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

function InfoDisclaimerCard() {
  return (
    <Card className="p-6">
      <SectionTitle title="Information" />
      <p className="mt-5 text-sm leading-6 text-stone-600">
        RenoApp tillhandahåller strukturerad information, underlag och dokumentation för ärendehantering. Systemet lämnar inte teknisk eller juridisk rådgivning. Bedömning och beslut fattas alltid av styrelsen eller av särskilt anlitad fackman.
      </p>
    </Card>
  )
}

function ReviewFlagsCard({ flags }: { flags: ReviewFlag[] }) {
  if (flags.length === 0) return null

  return (
    <Card className="p-6">
      <SectionTitle title="Registrerade kontrollpunkter" />
      <div className="mt-5 grid gap-3">
        {flags.map((flag) => (
          <div
            key={flag.id}
            className={cx(
              'rounded-2xl border p-4 text-sm leading-6',
              flag.severity === 'high'
                ? 'border-rose-200 bg-rose-50 text-rose-900'
                : flag.severity === 'warning'
                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : 'border-sky-200 bg-sky-50 text-sky-900'
            )}
          >
            <p className="font-semibold">{displayText(flag.label)}</p>
            {flag.description ? <p className="mt-1">{displayText(flag.description)}</p> : null}
            {flag.sourceLabel ? <p className="mt-2 text-xs uppercase tracking-[0.14em] opacity-70">{displayText(flag.sourceLabel)}</p> : null}
          </div>
        ))}
      </div>
    </Card>
  )
}

export default function RenoAppCaseDecisionView({
  item,
  selectedStatus,
  reason,
  conditions,
  decisionConfirmed,
  submitting,
  actionError,
  actionSuccess,
  onStatusChange,
  onReasonChange,
  onConditionsChange,
  onDecisionConfirmedChange,
  onSubmit,
}: {
  item: RenoAppCaseDetail
  selectedStatus: RenoAppCaseStatusAction
  reason: string
  conditions: string
  decisionConfirmed: boolean
  submitting: boolean
  actionError: string | null
  actionSuccess: string | null
  onStatusChange: (status: RenoAppCaseStatusAction) => void
  onReasonChange: (value: string) => void
  onConditionsChange: (value: string) => void
  onDecisionConfirmedChange: (value: boolean) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [downloadingFiles, setDownloadingFiles] = useState(false)
  const [expandedParticipantIds, setExpandedParticipantIds] = useState<Record<string, boolean>>({})
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Record<string, boolean>>({})

  const documentUnderlag = useMemo(() => item.underlag.filter((row) => row.category === 'document'), [item])
  const participantUnderlag = useMemo(() => item.underlag.filter((row) => row.category === 'participant'), [item])
  const missingUnderlag = useMemo(() => item.underlag.filter((row) => !row.checked), [item])
  const missingReviewFlags = useMemo(() => getMissingReviewFlags(item), [item])
  const considerations = useMemo(() => buildConsiderations(item, missingUnderlag), [item, missingUnderlag])
  const missingSnippets = useMemo(
    () => Array.from(new Set(missingUnderlag.map((row) => `${displayText(row.label)} saknas`))).slice(0, 8),
    [missingUnderlag]
  )
  const downloadAllUrls = useMemo(
    () =>
      Array.from(
        new Set(
          item.underlag
            .map((row) => row.documentId)
            .filter((documentId): documentId is string => Boolean(documentId))
            .map((documentId) => `/api/renoapp/app/cases/${item.id}/documents/${documentId}`)
        )
      ),
    [item]
  )
  const selectedDownloadUrls = useMemo(
    () =>
      Object.keys(selectedDocumentIds)
        .filter((documentId) => selectedDocumentIds[documentId])
        .map((documentId) => `/api/renoapp/app/cases/${item.id}/documents/${documentId}`),
    [item.id, selectedDocumentIds]
  )

  const startDownloads = (urls: string[]) => {
    if (urls.length === 0) return
    setDownloadingFiles(true)

    try {
      for (const [index, url] of urls.entries()) {
        window.setTimeout(() => {
          const frame = document.createElement('iframe')
          frame.style.display = 'none'
          frame.src = url
          document.body.appendChild(frame)
          window.setTimeout(() => {
            frame.remove()
          }, 15000)
        }, index * 400)
      }
    } finally {
      window.setTimeout(() => {
        setDownloadingFiles(false)
      }, urls.length * 400 + 500)
    }
  }

  const toggleParticipantDetails = (participantId: string) => {
    setExpandedParticipantIds((current) => ({
      ...current,
      [participantId]: !current[participantId],
    }))
  }

  const toggleSelectedDocument = (documentId: string) => {
    setSelectedDocumentIds((current) => ({
      ...current,
      [documentId]: !current[documentId],
    }))
  }

  return (
    <div className="grid gap-6">
      <section className="grid items-start gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="grid gap-6">
          <CaseHeaderSummary item={item} />
          <DocumentsPanel
            item={item}
            documentRows={documentUnderlag}
            selectedDocumentIds={selectedDocumentIds}
            downloading={downloadingFiles}
            onToggleDocument={toggleSelectedDocument}
            onDownloadAll={() => startDownloads(downloadAllUrls)}
            onDownloadSelected={() => startDownloads(selectedDownloadUrls)}
          />
          <ConsultantsPanel rows={participantUnderlag} expandedParticipantIds={expandedParticipantIds} onToggle={toggleParticipantDetails} />
          <BoardDecisionPanel
            isDraftCase={item.status === 'draft'}
            selectedStatus={selectedStatus}
            reason={reason}
            conditions={conditions}
            decisionConfirmed={decisionConfirmed}
            submitting={submitting}
            actionError={actionError}
            actionSuccess={actionSuccess}
            missingSnippets={missingSnippets}
            onStatusChange={onStatusChange}
            onReasonChange={onReasonChange}
            onConditionsChange={onConditionsChange}
            onDecisionConfirmedChange={onDecisionConfirmedChange}
            onSubmit={onSubmit}
          />
        </div>

        <aside className="grid gap-6 xl:sticky xl:top-6">
          <CaseMaterialStatusCard missingItems={missingUnderlag} reviewFlags={missingReviewFlags} />
          <ConsiderationsCard items={considerations} />
          <CaseHistoryTimeline messages={item.messages} expanded={historyExpanded} onToggle={() => setHistoryExpanded((current) => !current)} />
          <ReviewFlagsCard flags={missingReviewFlags.filter((flag) => flag.sourceType !== 'missing_document')} />
          <InfoDisclaimerCard />
        </aside>
      </section>
    </div>
  )
}
