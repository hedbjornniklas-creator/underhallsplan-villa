'use client'

import PendingLink from '@/components/ui/PendingLink'
import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarClock,
  Check,
  ChevronDown,
  Eye,
  FilePlus2,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Send,
  Trash2,
  Undo2,
  UserRoundCheck,
  WalletCards
} from 'lucide-react'
import type {
  ActionCaseView,
  ActionCasePortal
} from '@/lib/action-cases/contracts'
import {
  customerOfferBaseAmount,
  customerPriceLabel,
  money,
  offerPublishIssues,
  type CustomerOffer,
  type CustomerOfferDraft,
  type CustomerOfferSnapshot,
  type CustomerOfferWorkspace
} from '@/lib/action-cases/customerOffers'
import { ABS18_TERMS, withAbs18ContractDefaults, withStandardContractTerms } from '@/lib/action-cases/standardContractTerms'
import { useToast } from '@/components/ui/AppToastProvider'
import CustomerOfferDocument from './CustomerOfferDocument'
import ActionCaseCustomerPortal from './ActionCaseCustomerPortal'
import PriceInput from './CustomerOfferPriceInput'
import CustomerOfferCostCalculator from './CustomerOfferCostCalculator'
import type { CustomerOfferCosting } from '@/lib/action-cases/customerOfferCosting'
import CustomerContractFields from './CustomerContractFields'
import CustomerContractPropertyEditor from './CustomerContractPropertyEditor'
import CustomerContractAssignmentEditor from './CustomerContractAssignmentEditor'
import { assignmentForEditing, assignmentPatch } from '@/lib/action-cases/contractAssignment'
import { contractDocumentDraftState, contractDocumentsAcknowledged, readContractDocumentDraft, writeContractDocumentDraft, type ContractDocumentDraft } from '@/lib/action-cases/contractDocumentDraft'
import CustomerPlanningEditor from './CustomerPlanningEditor'
import { contractAdviceForEditing, contractAdviceSummary, contractDetailsForEditing, contractFieldSummary, emptyContractDetails, type ContractFieldKey } from '@/lib/action-cases/customerContract'
import { PaymentPlanDocument, PaymentPlanEditor } from './CustomerPaymentPlan'
import ProjectEditorRow from './ProjectEditorRow'
import { retainNewerDraft } from '@/lib/action-cases/draftSave'
import type { ProjectScheduleRow } from '@/lib/action-cases/projectSchedule'
import CustomerOfferSourcePicker from './CustomerOfferSourcePicker'
import { ContractCustomerEditor, ContractContractorEditor } from './CustomerContractPartiesEditor'
import { emptyContractParties, type ContractContractor } from '@/lib/action-cases/customerContractParties'
import ProjectBillingEditor from './ProjectBillingEditor'
import { useCustomerOfferAutosave } from './useCustomerOfferAutosave'
import CustomerContractWorkParts from './CustomerContractWorkParts'
import type { CustomerOfferItem } from '@/lib/action-cases/customerOffers'
import { contractPricingForEditing } from '@/lib/action-cases/contractPricing'
import CustomerContractPricing from './CustomerContractPricing'

const field =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50'
const button =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50'
export type CustomerEditorView = 'edit' | 'contract' | 'document' | 'offerDocument' | 'customer' | 'planning' | 'payments'
function draftForEditing(workspace: CustomerOfferWorkspace): CustomerOfferDraft {
  const details = workspace.draft.contractDetails ?? emptyContractDetails()
  if (workspace.offers.some((offer) => offer.status === 'accepted')) return { ...workspace.draft, contractDetails: details }
  return withAbs18ContractDefaults({ ...workspace.draft, contractPricing: contractPricingForEditing(workspace.draft), pricingMode: 'total',
    contractDetails: contractAdviceForEditing(contractDetailsForEditing(details)) })
}
export default function CustomerOfferEditor({
  actionCase,
  initial,
  issuerName,
  replyEmail,
  embedded = false,
  active = true,
  view: controlledView,
  onViewChange,
  onWorkspaceChange,
  onCustomerChanged,
  onDirtyChange,
  sharedSchedule,
  sourcePending = false,
  contractorSource,
  draftTarget = 'contract',
  offerItems = []
}: {
  actionCase: ActionCaseView
  initial: CustomerOfferWorkspace
  issuerName: string
  replyEmail: string
  embedded?: boolean
  active?: boolean
  view?: CustomerEditorView
  onViewChange?: (view: CustomerEditorView) => void
  onWorkspaceChange?: (workspace: CustomerOfferWorkspace) => void
  onCustomerChanged?: () => void
  onDirtyChange?: (dirty: boolean) => void
  sharedSchedule?: ProjectScheduleRow[]
  sourcePending?: boolean
  contractorSource?: Partial<ContractContractor>
  draftTarget?: 'contract' | 'offer'
  offerItems?: CustomerOfferItem[]
}) {
  const initialCustomer = initial.recipient ?? actionCase.participants.find((p) => p.role === 'customer')
  const [workspace, setWorkspace] = useState(initial),
    [draft, setDraft] = useState<CustomerOfferDraft>(() => draftTarget === 'offer' ? initial.draft : ({ ...draftForEditing(initial),
      contractParties: initial.draft.contractParties ?? emptyContractParties(initialCustomer?.name ?? actionCase.customerName,
        initialCustomer?.email ?? '', initialCustomer?.phone ?? '', { companyName: issuerName, email: replyEmail, ...contractorSource })
    }))
  const [costing, setCosting] = useState<CustomerOfferCosting>(initial.costing ?? {})
  const [standardTermsFile, setStandardTermsFile] = useState(initial.standardTermsFile ?? null)
  const [termsState, setTermsState] = useState<'' | 'loading' | 'error'>('')
  const [termsRetry, setTermsRetry] = useState(0)
  const applyStandardTerms = useRef<(file: NonNullable<CustomerOfferWorkspace['standardTermsFile']>) => void>(() => {})
  const currentSnapshot = useRef({ draft, costing })
  currentSnapshot.current = { draft, costing }
  const acknowledgedDraft = useRef(initial.draft)
  const recoveryChecked = useRef(false)
  const initialUpgradeQueued = useRef(false)
  const applyDraftUpgrade = useRef<() => void>(() => {})
  const recoverDocuments = useRef<() => void>(() => {})
  const documentConflict = useRef<ContractDocumentDraft | null>(null)
  const [documentRecovery, setDocumentRecovery] = useState<ContractDocumentDraft | null>(null)
  const customer = workspace.recipient ?? actionCase.participants.find((p) => p.role === 'customer')
  const [internalView, setInternalView] = useState<CustomerEditorView>('edit')
  const view = controlledView ?? internalView
  const setView = (next: CustomerEditorView) => { setInternalView(next); onViewChange?.(next) }
  const [itemView, setItemView] = useState<'included' | 'excluded'>('included')
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>('customer')
  const [planningDirty, setPlanningDirty] = useState(false)
  const [billingDirty, setBillingDirty] = useState(false)
  const [paymentView, setPaymentView] = useState<'plan' | 'billing'>('plan')
  const planningDirtyRef = useRef(planningDirty)
  planningDirtyRef.current = planningDirty
  const [planning, setPlanning] = useState(initial.planning)
  const [planningReset, setPlanningReset] = useState(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const previousView = useRef(view)
  const [busy, setBusy] = useState(''),
    running = useRef(false),
    toast = useToast()
  const [confirmed, setConfirmed] = useState(false)
  const [confirmItemized, setConfirmItemized] = useState(false)
  const parties = draft.contractParties ?? emptyContractParties(customer?.name ?? actionCase.customerName, customer?.email ?? '', customer?.phone ?? '', { companyName: issuerName, email: replyEmail, ...contractorSource })
  const contractView = view === 'contract'
  const apiUrl = `/api/action-cases/${actionCase.id}/customer-offers${draftTarget === 'offer' ? '?draftTarget=offer' : ''}`
  const editableDraft = (result: CustomerOfferWorkspace) => draftTarget === 'offer' ? result.draft : draftForEditing(result)
  const dirty = JSON.stringify(draft) !== JSON.stringify(workspace.draft) ||
    JSON.stringify(costing) !== JSON.stringify(workspace.costing ?? {})
  const recipientChanged = Boolean(draft.contractParties && (
    parties.customers[0].name.trim() !== (customer?.name ?? '') ||
    parties.email.trim().toLowerCase() !== (customer?.email ?? '').trim().toLowerCase() ||
    (parties.mobile.trim() || parties.phone.trim()) !== (customer?.phone ?? '').trim()
  ))
  const autosave = useCustomerOfferAutosave({
    initialRevision: initial.revision,
    save: async (submitted, revision) => {
      const response = await fetch(apiUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(45000),
        body: JSON.stringify({ operation: 'autosave', draftTarget, draft: submitted.draft,
          ...(workspace.costingAvailable ? { costing: submitted.costing } : {}), revision }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Utkastet kunde inte sparas. Dina ändringar är kvar.')
      if (!contractDocumentsAcknowledged(submitted.draft, result.draft, result.standardTermsFile?.id ?? standardTermsFile?.id))
        throw new Error('Sparningen av handlingarna kunde inte bekräftas. Dina ändringar är kvar.')
      return result as CustomerOfferWorkspace
    },
    onSaved: (result, submitted) => {
      acknowledgedDraft.current = result.draft
      setWorkspace(result)
      if (result.standardTermsFile) {
        setStandardTermsFile(result.standardTermsFile)
        if (result.draft.termsAttachmentId === result.standardTermsFile.id) setTermsState('')
      }
      const current = currentSnapshot.current
      const next = { draft: retainNewerDraft(current.draft, submitted.draft, editableDraft(result)),
        costing: retainNewerDraft(current.costing, submitted.costing, result.costing ?? {}) }
      currentSnapshot.current = next
      persistDocuments(next.draft)
      setDraft(next.draft)
      setCosting(next.costing)
    },
    onError: (error) => toast.error(error, 'Utkastet kunde inte sparas. Dina ändringar är kvar.'),
  })
  useEffect(() => { onDirtyChange?.(dirty || planningDirty || billingDirty || Boolean(busy) || autosave.isSaving) }, [dirty, planningDirty, billingDirty, busy, autosave.isSaving, onDirtyChange])
  useEffect(() => { onWorkspaceChange?.({ ...workspace, planning }) }, [workspace, planning, onWorkspaceChange])
  const locked = workspace.offers.some((o) => o.status === 'accepted')
  const issues = [
    ...offerPublishIssues(draft),
    ...(documentRecovery ? ['Välj vilka handlingar som ska behållas från det lokala utkastet före utskick.'] : []),
    ...(sourcePending ? ['Projektarbete har ändringar som inte har sparats klart.'] : []),
    ...(!customer?.email?.trim()
      ? ['Ange beställarens e-postadress i uppdraget.']
      : []),
    ...(recipientChanged ? ['Bekräfta mottagaren under Beställare före utskick.'] : [])
  ]
  const files = [...actionCase.attachments.filter((f) => !f.isQuoteDocument),
    ...(standardTermsFile && !actionCase.attachments.some((f) => f.id === standardTermsFile.id)
      ? [{ ...standardTermsFile, type: 'document' as const, title: ABS18_TERMS.name }] : [])]
  const baseAmount = customerOfferBaseAmount(draft)
  const legacyChoices = draft.items.filter((i) => i.kind === 'option')
  const missingPriceCount = draft.items.filter(
    (i) => i.kind === 'included' && i.amountOre === null
  ).length
  function persistDocuments(current: CustomerOfferDraft) {
    if (!recoveryChecked.current || documentConflict.current) return
    try {
      writeContractDocumentDraft(window.sessionStorage, actionCase.id,
        assignmentForEditing(acknowledgedDraft.current, files).documents,
        assignmentForEditing(current, files).documents)
    } catch { /* Browser storage may be unavailable; keep the normal server save path. */ }
  }
  const update = (patch: Partial<CustomerOfferDraft>) => {
    const current = currentSnapshot.current
    let nextDraft = { ...current.draft, ...patch }
    if (draftTarget === 'contract' && !locked) {
      nextDraft = withAbs18ContractDefaults(nextDraft)
      if (nextDraft.contractPricing) nextDraft = { ...nextDraft, pricingMode: 'total', baseAmountOre: customerOfferBaseAmount(nextDraft) }
      const assignment = assignmentForEditing(nextDraft, files)
      nextDraft = { ...nextDraft, ...assignmentPatch(nextDraft, assignment, assignment) }
    }
    let nextCosting = current.costing
    if (patch.items) {
      const ids = new Set(patch.items.map((item) => item.id))
      nextCosting = Object.fromEntries(Object.entries(current.costing).filter(([id]) => ids.has(id)))
    }
    currentSnapshot.current = { draft: nextDraft, costing: nextCosting }
    persistDocuments(nextDraft)
    setDraft(nextDraft)
    setCosting(nextCosting)
    if (draftTarget === 'contract' && !locked && !running.current) autosave.change({ draft: nextDraft, costing: nextCosting })
    setConfirmed(false)
  }
  applyDraftUpgrade.current = () => update(currentSnapshot.current.draft)
  const updateCosting = (id: string, calculation: CustomerOfferCosting[string]) => {
    const current = currentSnapshot.current
    const nextCosting = { ...current.costing, [id]: calculation }
    currentSnapshot.current = { draft: current.draft, costing: nextCosting }
    setCosting(nextCosting)
    if (draftTarget === 'contract' && !locked && !running.current) autosave.change({ draft: current.draft, costing: nextCosting })
    setConfirmed(false)
  }
  const restoreDocuments = (backup: ContractDocumentDraft) => {
    if (locked || backup.documents.some((doc) => !files.some((file) => file.id === doc.fileId))) {
      toast.error('En handling saknas i projektet. Det lokala utkastet har inte ersatt de sparade uppgifterna.')
      return
    }
    documentConflict.current = null
    setDocumentRecovery(null)
    const current = currentSnapshot.current.draft
    const assignment = assignmentForEditing(current, files)
    setExpanded('scope-summary')
    update(assignmentPatch(current, { ...assignment, documents: backup.documents }, assignment))
    toast.info('Osparade handlingar har återställts och sparas på nytt.')
  }
  recoverDocuments.current = () => {
    let backup: ContractDocumentDraft | null = null
    try { backup = readContractDocumentDraft(window.sessionStorage, actionCase.id) } catch { return }
    if (!backup) return
    const state = contractDocumentDraftState(backup,
      assignmentForEditing(acknowledgedDraft.current, files).documents, files.map((file) => file.id))
    if (state === 'saved') persistDocuments(currentSnapshot.current.draft)
    else if (state === 'restore') restoreDocuments(backup)
    else {
      documentConflict.current = backup
      setDocumentRecovery(backup)
      toast.warning('Ett lokalt handlingsutkast finns. De sparade handlingarna har ändrats och har inte skrivits över.')
    }
  }
  useEffect(() => {
    if (!active || !contractView || locked || recoveryChecked.current) return
    recoveryChecked.current = true
    recoverDocuments.current()
  }, [active, contractView, locked])
  useEffect(() => {
    if (!active || !contractView || draftTarget !== 'contract' || locked || !recoveryChecked.current || documentConflict.current || documentRecovery || initialUpgradeQueued.current) return
    initialUpgradeQueued.current = true
    if (JSON.stringify(currentSnapshot.current.draft) !== JSON.stringify(acknowledgedDraft.current))
      applyDraftUpgrade.current()
  }, [active, contractView, draftTarget, locked, documentRecovery])
  applyStandardTerms.current = (file) => {
    try {
      const current = currentSnapshot.current.draft
      const next = withStandardContractTerms(current, file, files)
      if (JSON.stringify(next) !== JSON.stringify(current)) update(next)
    } catch (error) {
      setTermsState('error')
      toast.error(error, 'Standardvillkoren kunde inte läggas till. Kontrollera antalet bilagor.')
    }
  }
  useEffect(() => {
    if (!active || !contractView || locked || draft.contractForm !== 'abs18' || standardTermsFile) return
    let cancelled = false
    setTermsState('loading')
    fetch(`/api/action-cases/${actionCase.id}/customer-offers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(45000),
      body: JSON.stringify({ operation: 'prepare_standard_terms' }),
    }).then(async (response) => {
      const result = await response.json()
      if (!response.ok || !result.file) throw new Error(result.error || 'Standardvillkoren kunde inte förberedas.')
      if (!cancelled) { setStandardTermsFile(result.file); setTermsState('') }
    }).catch((error) => {
      if (!cancelled) { setTermsState('error'); toast.error(error, 'Standardvillkoren kunde inte förberedas.') }
    })
    return () => { cancelled = true }
  }, [active, contractView, locked, draft.contractForm, standardTermsFile, actionCase.id, termsRetry, toast])
  useEffect(() => {
    if (active && contractView && !locked && standardTermsFile) applyStandardTerms.current(standardTermsFile)
  }, [active, contractView, locked, draft.contractForm, standardTermsFile, termsRetry])
  useEffect(() => {
    if (embedded || !active || previousView.current === view) return
    previousView.current = view
    heading.current?.focus({ preventScroll: true })
    heading.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }, [view, active, embedded])
  useEffect(() => {
    if (!dirty && !planningDirty && !billingDirty) return
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [dirty, planningDirty, billingDirty])
  async function action(
    operation: string,
    extra: Record<string, unknown> = {}
  ) {
    if (running.current || autosave.isPending()) return false
    if (operation === 'save' && autosave.state?.status === 'error') return autosave.retry()
    if (operation === 'save' && draft.contractParties &&
      (draft.contractParties.customers[0].name.trim() !== customer?.name ||
        draft.contractParties.email.trim().toLowerCase() !== customer?.email?.trim().toLowerCase()) &&
      (sourcePending || planningDirty)) {
      toast.error('Spara pågående projektarbete och planering innan du ändrar beställarens kontaktuppgifter.')
      return false
    }
    running.current = true
    setBusy(operation)
    try {
      const response = await fetch(
        apiUrl,
        {
          method: operation === 'refresh' ? 'GET' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body:
            operation === 'refresh'
              ? undefined
              : JSON.stringify({
                  operation,
                  draftTarget,
                  draft,
                  ...(workspace.costingAvailable ? { costing } : {}),
                  revision: workspace.revision,
                  confirmed,
                  ...extra
                })
        }
      )
      const data = await response.json()
      if (!response.ok)
        throw new Error(data.error || 'Offerten kunde inte hanteras.')
      if (operation === 'save' && !contractDocumentsAcknowledged(draft, data.draft, data.standardTermsFile?.id ?? standardTermsFile?.id))
        throw new Error('Sparningen av handlingarna kunde inte bekräftas. Dina ändringar är kvar.')
      if (operation === 'bind_customer' || operation === 'bind_property' || data.recipient?.name !== workspace.recipient?.name ||
        data.recipient?.email !== workspace.recipient?.email || data.recipient?.phone !== workspace.recipient?.phone) onCustomerChanged?.()
      autosave.reset(data.revision)
      acknowledgedDraft.current = data.draft
      setWorkspace(data)
      if (data.standardTermsFile) setStandardTermsFile(data.standardTermsFile)
      const next = {
        draft: operation === 'save' ? retainNewerDraft(currentSnapshot.current.draft, draft, editableDraft(data)) : editableDraft(data),
        costing: operation === 'save' ? retainNewerDraft(currentSnapshot.current.costing, costing, data.costing ?? {}) : data.costing ?? {},
      }
      currentSnapshot.current = next
      setDraft(next.draft)
      setCosting(next.costing)
      persistDocuments(next.draft)
      // Edits made while the manual request was running still need a queued save.
      if (operation === 'save' && draftTarget === 'contract' && !locked &&
        (JSON.stringify(next.draft) !== JSON.stringify(editableDraft(data)) || JSON.stringify(next.costing) !== JSON.stringify(data.costing ?? {})))
        autosave.change(next)
      if (operation === 'separate_choices' || operation === 'bind_customer' ||
        ((operation === 'save' || operation === 'refresh') && !planningDirtyRef.current)) {
        setPlanning(data.planning)
        setPlanningReset((value) => value + 1)
      }
      if (operation === 'separate_choices') setView('planning')
      setConfirmed(false)
      toast.success(
        operation === 'publish' || operation === 'send'
          ? 'Avtalet har skickats.'
          : operation === 'withdraw'
            ? 'Avtalet återkallades.'
            : operation === 'refresh'
              ? 'Statusen uppdaterades.'
              : operation === 'separate_choices'
                ? 'Valen har flyttats. Grundpriset är oförändrat. Inget har delats eller beställts.'
                : operation === 'bind_customer'
                  ? 'Kunden är kopplad. Avtalsutkastet och mottagaren har sparats.'
                : operation === 'bind_property'
                  ? 'Fastigheten är kopplad i HusHub. Avtalsutkastet har sparats.'
                : 'Ändringarna sparades.'
      )
      return true
    } catch (error) {
      toast.error(error, 'Offerten kunde inte hanteras.')
      // A publication may have committed even when the mail response was lost.
      if (operation === 'publish' || operation === 'send') {
        try {
          const response = await fetch(
            `/api/action-cases/${actionCase.id}/customer-offers`
          )
          if (response.ok) {
            const data = await response.json()
            setWorkspace(data)
          }
        } catch {
          /* Keep local draft and retry the same version. */
        }
      }
      return false
    } finally {
      running.current = false
      setBusy('')
    }
  }
  function move(index: number, delta: number) {
    const items = [...draft.items]
    const peers = items.map((item, position) => ({ item, position })).filter(({ item }) => item.kind === items[index].kind)
    const other = peers[peers.findIndex(({ position }) => position === index) + delta]?.position
    if (other === undefined) return
    ;[items[index], items[other]] = [items[other], items[index]]
    update({ items })
  }
  const snapshot: CustomerOfferSnapshot = {
    ...draft,
    projectTitle: actionCase.title,
    propertyAddress: actionCase.propertyAddress,
    customerName: customer?.name ?? actionCase.customerName,
    customerEmail: customer?.email ?? '',
    issuerName,
    replyEmail
  }
  const draftOffer: CustomerOffer = {
    id: 'draft',
    version: 0,
    status: 'published',
    snapshot,
    files: files
      .filter((f) => draft.attachmentIds.includes(f.id))
      .map((f) => ({
        id: f.id,
        fileName: f.fileName,
        contentType: f.contentType,
        fileSizeBytes: f.fileSizeBytes
      })),
    publishedAt: '',
    sentAt: null,
    acceptedAt: null,
    acceptedBy: null,
    acceptedOptionIds: [],
    acceptedTotalOre: null
  }
  const previewOffer = workspace.offers.find((o) => o.status === 'accepted') ?? draftOffer
  const portal: ActionCasePortal = {
    accessState: 'open',
    participant: customer ?? {
      id: '',
      role: 'customer',
      name: actionCase.customerName,
      email: null,
      companyName: null,
      phone: null
    },
    customerOffers: { enabled: true, offers: workspace.offers, plannedItems: planning?.sharedItems },
    actionCase: {
      schedule: sharedSchedule,
      id: actionCase.id,
      title: workspace.offers[0]?.snapshot.projectTitle ?? actionCase.title,
      propertyAddress:
        workspace.offers[0]?.snapshot.propertyAddress ??
        actionCase.propertyAddress,
      description: null,
      status: actionCase.status,
      items: [],
      attachments: actionCase.attachments.filter(
        (f) => customer && f.grantedParticipantIds.includes(customer.id)
      )
    }
  }
  const Container = embedded ? 'div' : 'main'
  const Heading = embedded ? 'h2' : 'h1'
  const contractSection = (id: string, title: string, keys: ContractFieldKey[], advice = false) => {
    return <ProjectEditorRow title={title} summary={advice ? contractAdviceSummary(draft.contractDetails) : contractFieldSummary(draft.contractDetails, keys)}
      open={expanded === id} onToggle={() => setExpanded(expanded === id ? null : id)}>
      <CustomerContractFields value={draft.contractDetails} fieldKeys={keys} showAdvice={advice} inline
        contractForm={contractView ? draft.contractForm : undefined} disabled={locked || Boolean(busy)} onChange={(contractDetails) => update({ contractDetails })} />
    </ProjectEditorRow>
  }
  const priceSection = <ProjectEditorRow title="Priset" summary={draft.contractPricing ? customerPriceLabel(draft) : `${draft.pricingMode === 'itemized' ? 'Fast pris per arbetsdel' : 'Fast klumpsumma'} · ${money(baseAmount)}`}
    open={expanded === 'price'} onToggle={() => setExpanded(expanded === 'price' ? null : 'price')}>
    {draftTarget === 'contract' && draft.contractPricing ? <CustomerContractPricing value={draft.contractPricing} sources={actionCase.items}
      blocked={locked || Boolean(busy)} importBlocked={sourcePending} onChange={(contractPricing) => update({ contractPricing })} /> : <>
    <label className="block text-sm">Prissättning av grundåtagandet
      <select className={field} value={draft.pricingMode ?? 'total'} onChange={(e) => {
        const pricingMode = e.target.value as CustomerOfferDraft['pricingMode']
        if (pricingMode === 'itemized' && draft.baseAmountOre !== null) { setConfirmItemized(true); return }
        setConfirmItemized(false); update({ pricingMode, baseAmountOre: baseAmount })
      }}><option value="total">Fast klumpsumma</option><option value="itemized">Fast pris per arbetsdel</option></select>
    </label>
    {confirmItemized && <div role="alert" className="mt-3 border-l-4 border-amber-500 bg-amber-50 p-4 text-sm">
      <p>Klumpsumman {money(draft.baseAmountOre)} ersätts av summan av arbetsdelarnas priser. Beloppet fördelas inte automatiskt.</p>
      <div className="mt-3 flex flex-wrap gap-2"><button className={`${button} bg-white`} onClick={() => { update({ pricingMode: 'itemized' }); setConfirmItemized(false) }}><Check size={17} /> Byt till delpriser</button>
        <button className={button} onClick={() => setConfirmItemized(false)}><ArrowLeft size={17} /> Avbryt</button></div>
    </div>}
    {draft.pricingMode !== 'itemized' ? <PriceInput label="Grundpris inkl. moms (kr) *" value={draft.baseAmountOre} onChange={(baseAmountOre) => update({ baseAmountOre })} /> : draft.items.filter((i) => i.kind === 'included').map((item) => <div key={item.id} className="mt-4 border-t border-slate-200 pt-3">
      <PriceInput label={`${item.title || 'Arbetsdel'} - delpris inkl. moms (kr) *`} value={item.amountOre} onChange={(amountOre) => update({ items: draft.items.map((i) => i.id === item.id ? { ...i, amountOre } : i) })} />
      {workspace.costingAvailable && <CustomerOfferCostCalculator value={costing[item.id]} customerPrice={item.amountOre}
        onChange={(calculation) => updateCosting(item.id, calculation)}
        onApply={(amountOre) => { update({ items: draft.items.map((i) => i.id === item.id ? { ...i, amountOre } : i) }); toast.success('Kundpriset har uppdaterats i utkastet.') }} />}
    </div>)}
    </>}
  </ProjectEditorRow>
  return (
    <Container className={`gizmo-editor-scroll-scope ${embedded ? 'gizmo-offer-editor break-words' : 'mx-auto max-w-6xl break-words px-4 pb-16 sm:px-6'}`}>
      {(!embedded || ['edit', 'contract', 'document', 'offerDocument'].includes(view)) && <header className="border-b border-slate-200 py-6">
        {!embedded && <PendingLink autoPending pendingLabel="Öppnar projektlistan…" icon={<ArrowLeft size={17} />}
          href="/uppdrag"
          onClick={(e) => {
            if ((dirty || planningDirty || billingDirty) && !window.confirm('Lämna osparade ändringar?'))
              e.preventDefault()
          }}
          className="inline-flex items-center gap-2 text-sm text-violet-700"
        >
          Till uppdrag
        </PendingLink>}
        {!embedded && <p className="mt-6 text-sm text-slate-500">
          {actionCase.propertyAddress}
        </p>}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
          <Heading ref={heading} tabIndex={-1} className="scroll-mt-6">
            {({ edit: 'Offert', contract: 'Avtal', planning: 'Val och tillval', payments: 'Betalningsplan', document: 'Granska avtal', offerDocument: 'Granska offert', customer: 'Visa som beställare' })[view]}
          </Heading>
          <div className="flex h-8 w-60 max-w-full shrink-0 items-center gap-2 text-sm text-slate-500" role="status" data-testid="contract-save-status">
            {autosave.isSaving && <Loader2 size={16} className="shrink-0 animate-spin" />}
            <span className="min-w-0 flex-1 truncate">
            {busy
              ? 'Arbetar…'
              : autosave.state?.status === 'error'
                ? 'Kunde inte spara'
              : autosave.isSaving
                ? 'Sparar utkast…'
              : dirty || planningDirty || billingDirty
                ? 'Osparade ändringar'
              : documentRecovery
                ? 'Lokalt utkast finns'
                : workspace.revision
                  ? 'Sparat'
                  : 'Nytt utkast'}
            </span>
            {autosave.state?.status === 'error' && <button className="gizmo-button h-8 min-h-0 shrink-0 px-2" title="Försök spara utkastet igen" aria-label="Försök spara utkastet igen" disabled={Boolean(busy)} onClick={() => void autosave.retry()}><RefreshCw size={16} /></button>}
            {documentRecovery && !locked && <button className="gizmo-button h-8 min-h-0 shrink-0 px-2" title="Återställ lokalt handlingsutkast" aria-label="Återställ lokalt handlingsutkast" disabled={Boolean(busy) || autosave.isSaving} onClick={() => {
              if (window.confirm('Återställa de lokala handlingarna? Den nuvarande handlingsförteckningen ersätts. Övriga avtalsuppgifter behålls.')) restoreDocuments(documentRecovery)
            }}><Undo2 size={16} /></button>}
            {documentRecovery && !locked && <button className="gizmo-button h-8 min-h-0 shrink-0 px-2" title="Behåll de sparade handlingarna" aria-label="Behåll de sparade handlingarna" disabled={Boolean(busy) || autosave.isSaving} onClick={() => {
              if (!window.confirm('Behålla de sparade handlingarna? Det lokala handlingsutkastet tas bort.')) return
              documentConflict.current = null
              setDocumentRecovery(null)
              persistDocuments(currentSnapshot.current.draft)
            }}><Check size={16} /></button>}
          </div>
        </div>
      </header>}
      {!embedded && <nav
        className="flex gap-2 overflow-x-auto border-b border-slate-200 py-3"
        aria-label="Offert och avtal"
      >
        {[
          ['edit', 'Offert'],
          ['contract', 'Avtal'],
          ['planning', 'Val och tillval'],
          ['payments', 'Betalning och fakturering'],
          ['document', 'Granska avtal'],
          ['customer', 'Visa som beställare']
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setView(key as typeof view)}
            aria-pressed={view === key}
            className={`${button} shrink-0 ${view === key ? 'bg-violet-50' : 'bg-white'}`}
          >
            {key === 'edit' ? <FilePlus2 size={17} /> : key === 'planning' ? <CalendarClock size={17} /> : key === 'payments' ? <WalletCards size={17} /> : <Eye size={17} />}
            {label}
          </button>
        ))}
      </nav>}
      {legacyChoices.length > 0 && !locked && view !== 'customer' && <section className="my-5 border-l-4 border-amber-500 bg-amber-50 p-4">
        <h2 className="text-base font-semibold">{legacyChoices.length} val behöver skiljas från grundavtalet</h2>
        <p className="mt-2 text-sm">Priser, alternativgrupper och interna kalkyler flyttas till Val och tillval. Grundpriset ändras inte och inget delas med kunden.</p>
        <p className="mt-2 text-sm">Kontrollera sedan inledning och avgränsningar så att grundavtalets omfattning är korrekt.</p>
        <button className={`${button} mt-4 bg-white`} disabled={Boolean(busy) || autosave.isSaving || dirty || planningDirty || !workspace.revision}
          onClick={() => void action('separate_choices', { planningRevision: planning?.revision ?? 0 })}>
          {busy === 'separate_choices' ? <Loader2 size={17} className="animate-spin" /> : <CalendarClock size={17} />}
          Flytta till Val och tillval
        </button>
        {(dirty || planningDirty) && <p className="mt-2 text-sm">Spara ändringarna innan valen flyttas.</p>}
      </section>}
      <div hidden={view !== 'planning'}>
        <CustomerPlanningEditor key={planningReset} caseId={actionCase.id} initial={planning ?? { available: false, revision: 0, items: [], sharedItems: [] }} onDirty={setPlanningDirty} onSaved={setPlanning} />
      </div>
      <div hidden={view !== 'payments'} className="py-6">
        <h2 className="text-xl">Betalning och fakturering</h2>
        <div role="tablist" aria-label="Betalning och fakturering" className="gizmo-register-tabs gizmo-payment-tabs mt-4" onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const next = event.key === 'Home' ? 'plan' : event.key === 'End' ? 'billing' : paymentView === 'plan' ? 'billing' : 'plan'
          setPaymentView(next)
          event.currentTarget.querySelector<HTMLButtonElement>(`[data-payment-tab="${next}"]`)?.focus()
        }}>
          {([['plan', 'Betalningsplan', WalletCards], ['billing', 'Fakturakund', UserRoundCheck]] as const).map(([key, label, Icon]) => <button key={key} type="button" role="tab" id={`payment-${actionCase.id}-${key}`} aria-controls={`payment-panel-${actionCase.id}-${key}`} aria-selected={paymentView === key} tabIndex={paymentView === key ? 0 : -1} data-payment-tab={key} className="gizmo-register-tab" onClick={() => setPaymentView(key)}><Icon size={17} />{label}</button>)}
        </div>
        <div id={`payment-panel-${actionCase.id}-billing`} role="tabpanel" aria-labelledby={`payment-${actionCase.id}-billing`} hidden={paymentView !== 'billing'}>
          <ProjectBillingEditor caseId={actionCase.id} parties={parties} active={active && view === 'payments' && paymentView === 'billing'} onDirtyChange={setBillingDirty} />
        </div>
      </div>
      {view === 'planning' ? null : view === 'payments' ? <section id={`payment-panel-${actionCase.id}-plan`} role="tabpanel" aria-labelledby={`payment-${actionCase.id}-plan`} hidden={paymentView !== 'plan'}>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">{locked ? 'Avtalad betalningsplan · Låst med grundavtalet' : 'Internt utkast · Betalningsvillkor och plan ingår i den avtalsversion som skickas'}</p>
          {!locked && <div className="flex flex-wrap items-center gap-3">
            <span role="status" className="text-sm text-slate-600">{busy ? 'Sparar…' : dirty ? 'Osparade ändringar' : workspace.revision > 0 ? 'Sparat internt' : 'Inte sparat ännu'}</span>
            <button className={`${button} bg-slate-950 text-white`} disabled={Boolean(busy) || autosave.isSaving || (!dirty && workspace.revision > 0) || confirmItemized} onClick={() => void action('save')}>
              {busy === 'save' ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />} {busy === 'save' ? 'Sparar…' : 'Spara utkast'}
            </button>
          </div>}
        </div>
        {locked ? <>
          <PaymentPlanDocument plan={previewOffer.snapshot.paymentPlan} paymentTerms={previewOffer.snapshot.paymentTerms} />
          <p className="mt-4 text-sm text-slate-600">Version {previewOffer.version}. Ändringar av den avtalade planen kräver en separat överenskommelse och kan inte göras här.</p>
        </> : <>
          <fieldset disabled={Boolean(busy) && busy !== 'save'} className="min-w-0">
            <PaymentPlanEditor plan={draft.paymentPlan} baseAmount={baseAmount} paymentTerms={draft.paymentTerms}
              onChange={(paymentPlan) => update({ paymentPlan })} onTermsChange={(paymentTerms) => update({ paymentTerms })} />
          </fieldset>
          <div className="mt-6 flex flex-wrap gap-3 border-t border-slate-200 pt-5">
            <button className={`${button} bg-white`} onClick={() => setView('document')}><Eye size={17} /> Granska grundavtal</button>
            <button className={button} onClick={() => setView('contract')}><ArrowLeft size={17} /> Till avtal</button>
          </div>
        </>}
      </section> : view === 'customer' ? (
        <ActionCaseCustomerPortal
          key={JSON.stringify([workspace.offers, planning?.sharedItems])}
          portal={portal}
          preview
          previewCaseId={actionCase.id}
        />
      ) : view === 'document' || view === 'offerDocument' ? (
        <>
          {(locked || legacyChoices.length === 0) && <div className="mt-5 bg-white px-6">
            <CustomerOfferDocument
              offer={previewOffer}
              purpose={view === 'offerDocument' ? 'offer' : 'contract'}
              selected={[]}
              readOnly
              fileUrl={(id) =>
                locked ? `/api/action-cases/${actionCase.id}/customer-offers/${previewOffer.id}/files/${id}`
                  : `/api/action-cases/${actionCase.id}/attachments/${id}`
              }
            />
          </div>}
          <div className="py-5 print:hidden">
            <button
              className={`${button} bg-white`}
              onClick={() => setView(view === 'offerDocument' ? 'edit' : 'contract')}
            >
              <ArrowLeft size={17} /> Tillbaka till redigering
            </button>
          </div>
        </>
      ) : (
        <div className={contractView ? 'gizmo-contract-layout py-6' : 'grid gap-8 py-6 lg:grid-cols-[minmax(0,1fr)_280px]'}>
          <fieldset
            disabled={(Boolean(busy) && (contractView || busy !== 'save')) || locked}
            className="min-w-0 space-y-5"
          >
            <div hidden={contractView} className="space-y-5">
            <ProjectEditorRow title="Offertuppgifter" summary={`${parties.customers.map((row) => row.name).filter(Boolean).join(', ') || actionCase.customerName} · ${draft.validUntil ? `Giltig till ${draft.validUntil}` : 'Giltighetsdatum saknas'}`}
              open={expanded === 'offer-info'} onToggle={() => setExpanded(expanded === 'offer-info' ? null : 'offer-info')}>
            <section className="space-y-4">
              <h2 className="text-lg">
                Offert till {parties.customers.map((row) => row.name).filter(Boolean).join(', ') || actionCase.customerName}
              </h2>
              <p className="break-all text-sm text-slate-600">
                {customer?.email || 'Beställaren saknar e-postadress.'}
              </p>
              <label className="block text-sm font-medium">
                Rubrik *
                <input
                  className={field}
                  value={draft.title}
                  onChange={(e) => update({ title: e.target.value })}
                />
              </label>
              <label className="block text-sm font-medium">
                Inledning
                <textarea
                  className={field}
                  rows={3}
                  value={draft.introduction}
                  onChange={(e) => update({ introduction: e.target.value })}
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium">
                  Giltig till och med *
                  <input
                    className={field}
                    type="date"
                    value={draft.validUntil}
                    onChange={(e) => update({ validUntil: e.target.value })}
                  />
                </label>
              </div>
            </section>
            </ProjectEditorRow>
            </div>
            <div hidden={!contractView} className="space-y-5">
            <ProjectEditorRow title="Avtalsuppgifter" summary={draft.title || 'Rubrik saknas'} open={expanded === 'contract-info'} onToggle={() => setExpanded(expanded === 'contract-info' ? null : 'contract-info')}>
              <label className="block text-sm">Rubrik<input className={field} value={draft.title} onChange={(event) => update({ title: event.target.value })} /></label>
              <label className="mt-4 block text-sm">Inledning<textarea className={field} rows={3} value={draft.introduction} onChange={(event) => update({ introduction: event.target.value })} /></label>
              <label className="mt-4 block text-sm">Giltig till och med<input className={field} type="date" value={draft.validUntil} onChange={(event) => update({ validUntil: event.target.value })} /></label>
            </ProjectEditorRow>
            <ProjectEditorRow title="Beställare" summary={parties.customers.map((row) => row.name || 'Namn saknas').join(' · ')}
              open={expanded === 'customer'} onToggle={() => setExpanded(expanded === 'customer' ? null : 'customer')}>
              <ContractCustomerEditor value={parties} onChange={(contractParties) => update({ contractParties })} />
            </ProjectEditorRow>
            <ProjectEditorRow title="Entreprenör" summary={parties.contractor.companyName || 'Företagsuppgifter saknas'}
              open={expanded === 'contractor'} onToggle={() => setExpanded(expanded === 'contractor' ? null : 'contractor')}>
              <ContractContractorEditor value={parties.contractor} source={contractorSource}
                onChange={(contractor) => update({ contractParties: { ...parties, contractor } })} />
            </ProjectEditorRow>
            {contractSection('controls', 'Övriga medverkande', ['controls'])}
            <ProjectEditorRow title="Fastigheten" summary={draft.contractDetails?.property ? contractFieldSummary(draft.contractDetails, ['property']) : actionCase.propertyAddress || 'Adress saknas'} open={expanded === 'property'} onToggle={() => setExpanded(expanded === 'property' ? null : 'property')}>
              <CustomerContractPropertyEditor caseId={actionCase.id} value={draft.contractDetails} street={actionCase.propertyAddress}
                link={workspace.propertyLink} busy={Boolean(busy) || autosave.isPending()}
                onChange={(contractDetails) => update({ contractDetails })} onBind={(binding) => action('bind_property', { binding })} />
            </ProjectEditorRow>
            <ProjectEditorRow title="Uppdraget" summary={`${draft.items.filter((item) => item.kind === 'included').length} arbetsdelar · ${customerPriceLabel(draft)}`}
              open={expanded === 'scope-summary'} onToggle={() => setExpanded(expanded === 'scope-summary' ? null : 'scope-summary')}>
              <fieldset className="min-w-0" disabled={Boolean(documentRecovery)}>
              <CustomerContractAssignmentEditor draft={draft} files={files} caseId={actionCase.id} onChange={update}
                standardTermsId={standardTermsFile?.id} termsState={termsState} onRetryTerms={() => setTermsRetry((value) => value + 1)}>
              <CustomerContractWorkParts items={draft.items} projectItems={actionCase.items} offerItems={offerItems}
                itemized={!draft.contractPricing && draft.pricingMode === 'itemized'} blocked={locked || Boolean(busy)} importBlocked={sourcePending} onChange={(items) => update({ items })} />
              </CustomerContractAssignmentEditor>
              </fieldset>
            </ProjectEditorRow>
            </div>
            <section hidden={contractView}>
              <h2 className="text-lg">Uppdraget</h2>
              {!contractView && <CustomerOfferSourcePicker sources={actionCase.items} items={draft.items} itemized={draft.pricingMode === 'itemized'} blocked={sourcePending || locked || Boolean(busy)}
                onChange={(items) => { update({ items }); setItemView('included') }} />}
              <div role="tablist" aria-label="Omfattning" className="mt-4 flex flex-wrap gap-2 border-b border-slate-200 pb-3">
                {([['included', 'Grundåtagande'], ['excluded', 'Avgränsningar']] as const).map(([key, title]) => <button key={key} role="tab" aria-selected={itemView === key} className={`${button} ${itemView === key ? 'bg-violet-50' : 'bg-white'}`} onClick={() => setItemView(key)}>{title} ({draft.items.filter((i) => i.kind === key).length})</button>)}
              </div>
              {draft.items.filter((item) => item.kind === itemView).map((item, visibleIndex, visibleItems) => (
                <ProjectEditorRow
                  key={item.id}
                  title={`${visibleIndex + 1}. ${item.title || 'Ny arbetsdel'}`}
                  summary={item.scope.trim() ? 'Omfattning ifylld' : 'Omfattning saknas'}
                  amount={item.kind === 'excluded' ? 'Ingår inte' : draft.pricingMode === 'itemized' ? item.amountOre === null ? 'Pris saknas' : money(item.amountOre) : 'Ingår i grundpriset'}
                  open={expanded === item.id} onToggle={() => setExpanded(expanded === item.id ? null : item.id)}
                >
                  <div className="flex items-start gap-2">
                    <span className="pt-3 text-sm text-slate-500">
                      {visibleIndex + 1}.
                    </span>
                    <label className="min-w-0 flex-1 text-sm">
                      Arbetsrubrik *
                      <input
                        className={field}
                        value={item.title}
                        onChange={(e) =>
                          update({
                            items: draft.items.map((i) =>
                              i.id === item.id
                                ? { ...i, title: e.target.value }
                                : i
                            )
                          })
                        }
                      />
                    </label>
                    <div className="mt-6 flex gap-1">
                      {[-1, 1].map((delta) => (
                        <button
                          key={delta}
                          title={delta === -1 ? 'Flytta upp' : 'Flytta ned'}
                          aria-label={`${delta === -1 ? 'Flytta upp' : 'Flytta ned'} ${item.title}`}
                          disabled={
                            delta === -1
                              ? visibleIndex === 0
                              : visibleIndex === visibleItems.length - 1
                          }
                          className="inline-flex h-11 w-9 items-center justify-center border border-slate-200 disabled:opacity-30"
                          onClick={() => move(draft.items.findIndex((i) => i.id === item.id), delta)}
                        >
                          {delta === -1 ? (
                            <ArrowUp size={16} />
                          ) : (
                            <ArrowDown size={16} />
                          )}
                        </button>
                      ))}
                      <button
                        title="Ta bort arbete"
                        aria-label={`Ta bort ${item.title}`}
                        className="inline-flex h-11 w-9 items-center justify-center text-rose-700"
                        onClick={() => setRemoveId(item.id)}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </div>
                  {removeId === item.id && <div role="alert" className="mt-3 border-l-4 border-amber-500 bg-amber-50 p-3 text-sm"><p>Ta bort {item.title || 'arbetet'} ur offertutkastet?</p><div className="mt-3 flex flex-wrap gap-2"><button className={button} onClick={() => { update({ items: draft.items.filter((i) => i.id !== item.id) }); setRemoveId(null) }}><Trash2 size={16} /> Ta bort från utkast</button><button className={button} onClick={() => setRemoveId(null)}>Avbryt</button></div></div>}
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm">
                      Ingår som
                      <select
                        className={field}
                        value={item.kind}
                        onChange={(e) => {
                          setItemView(e.target.value as typeof itemView)
                          update({
                            items: draft.items.map((i) =>
                              i.id === item.id
                                ? {
                                    ...i,
                                    kind: e.target.value as typeof i.kind,
                                    amountOre: null,
                                    optionGroup: null
                                  }
                                : i
                            )
                          })
                        }}
                      >
                        <option value="included">Grundåtagande</option>
                        <option value="excluded">Relevant avgränsning</option>
                      </select>
                    </label>
                  </div>
                  <label className="mt-3 block text-sm">
                    Omfattning och avgränsningar *
                    <textarea
                      className={field}
                      rows={3}
                      value={item.scope}
                      onChange={(e) =>
                        update({
                          items: draft.items.map((i) =>
                            i.id === item.id
                              ? { ...i, scope: e.target.value }
                              : i
                          )
                        })
                      }
                    />
                  </label>
                  {([['scopeConditions', 'Förutsättningar'], ['scopeExclusions', 'Ingår inte'], ['scopeAdvice', 'Avrådan']] as const).map(([key, label]) => item[key] !== undefined && (
                    <label key={key} className="mt-3 block text-sm">
                      {label} (valfritt)
                      <textarea className={field} rows={3} maxLength={6000} value={item[key]} onChange={(e) => update({ items: draft.items.map((i) => i.id === item.id ? { ...i, [key]: e.target.value } : i) })} />
                    </label>
                  ))}
                </ProjectEditorRow>
              ))}
              <button
                className={`${button} mt-5`}
                onClick={() => {
                  const id = crypto.randomUUID()
                  setExpanded(id)
                  update({
                    items: [
                      ...draft.items,
                      {
                        id,
                        title: '',
                        scope: '',
                        kind: itemView,
                        amountOre: null
                      }
                    ]
                  })
                }}
              >
                <Plus size={17} /> {itemView === 'included' ? 'Lägg till arbete' : 'Lägg till avgränsning'}
              </button>
            </section>
            <div hidden={contractView}>{priceSection}</div>
            <div hidden={!contractView} className="space-y-5">
            {contractSection('work-environment', 'Arbetsmiljö', ['workEnvironment'])}
            {contractSection('advice', 'Avrådande', [], true)}
            {priceSection}
            {contractSection('changes', 'Ändringar och tilläggsarbeten', ['changes'])}
            <ProjectEditorRow title="Tid för betalning" summary={`${draft.paymentPlan?.installments.length ?? 0} delbetalningar · ${draft.paymentTerms.trim() ? 'Villkor ifyllda' : 'Villkor saknas'}`}
              open={expanded === 'payment'} onToggle={() => setExpanded(expanded === 'payment' ? null : 'payment')}>
              <p className="whitespace-pre-wrap text-sm">{draft.paymentTerms || 'Betalningsvillkor saknas.'}</p>
              <button className={`${button} mt-3`} onClick={() => setView('payments')}><WalletCards size={17} /> Öppna betalningsplan</button>
            </ProjectEditorRow>
            </div>
            <ProjectEditorRow title="Tid för arbetenas påbörjande och avslutande" summary={draft.schedule.trim() ? 'Tider ifyllda' : 'Tider saknas'}
              open={expanded === 'schedule'} onToggle={() => setExpanded(expanded === 'schedule' ? null : 'schedule')}>
              <label className="block text-sm">Tider och förutsättningar *<textarea className={field} rows={3} value={draft.schedule} onChange={(e) => update({ schedule: e.target.value })} /></label>
            </ProjectEditorRow>
            {contractSection('delay', 'Vite vid försening', ['delay'])}
            {contractSection('inspection', 'Besiktning', ['inspection'])}
            {contractSection('insurance', 'Försäkringar och säkerhet', ['insurance', 'completionProtection', 'security'])}
            <ProjectEditorRow title="Övrigt" summary={draft.terms.trim() ? 'Villkor ifyllda' : 'Villkor saknas'} open={expanded === 'terms'} onToggle={() => setExpanded(expanded === 'terms' ? null : 'terms')}>
              <label className="block text-sm">Villkor och hänvisning till avtalshandling *<textarea className={field} rows={5} value={draft.terms} onChange={(e) => update({ terms: e.target.value })} /></label>
              {contractView && draft.contractDetails?.otherAgreements !== undefined && <label className="mt-4 block text-sm">Övriga överenskommelser
                <textarea className={field} rows={3} maxLength={6200} value={draft.contractDetails.otherAgreements} onChange={(e) => update({ contractDetails: { ...draft.contractDetails!, otherAgreements: e.target.value } })} />
              </label>}
              {contractView && draft.contractDetails?.advice.format === 'contract-fields' && draft.contractDetails.advice.customerResponse && <label className="mt-4 block text-sm">Beställarens tidigare besked om avrådan
                <textarea aria-label="Beställarens tidigare besked om avrådan" className={field} rows={3} maxLength={6000} value={draft.contractDetails.advice.customerResponse}
                  onChange={(e) => update({ contractDetails: { ...draft.contractDetails!, advice: { ...draft.contractDetails!.advice, customerResponse: e.target.value } } })} />
              </label>}
            </ProjectEditorRow>
          </fieldset>
          <aside className="min-w-0">
            <details className={contractView ? 'gizmo-contract-status' : ''} open={contractView ? undefined : true}>
              <summary className={contractView ? 'gizmo-contract-status-heading' : 'hidden'}>Avtalsstatus <strong>{customerPriceLabel(draft)}</strong><span>{locked ? 'Godkänt och låst' : issues.length ? `${issues.length} saker kvar inför utskick` : 'Klart att granska'}</span><ChevronDown size={18} className="gizmo-contract-status-chevron shrink-0" aria-hidden="true" /></summary>
            <div className={contractView ? 'gizmo-contract-status-body' : 'lg:sticky lg:top-6'}>
              <h2 className="text-lg">{contractView ? 'Avtalsstatus' : 'Offertsammanställning'}</h2>
              <p className="mt-3 text-2xl font-semibold">
                {customerPriceLabel(draft)}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {draft.contractPricing?.mode === 'running' ? 'Prisgrunder enligt avtalet'
                  : draft.contractPricing?.mode === 'mixed' ? 'Fast del inklusive moms och löpande prisgrunder'
                  : draft.pricingMode === 'itemized'
                  ? 'Summa grundåtagande inklusive moms'
                  : 'Grundpris inklusive moms'}
              </p>
              {draft.pricingMode === 'itemized' && baseAmount === null && (
                <p className="mt-2 text-sm text-amber-700">
                  {missingPriceCount} {missingPriceCount === 1 ? 'arbetsdel saknar' : 'arbetsdelar saknar'} pris
                </p>
              )}
              {locked ? (
                <p className="mt-5 border-l-4 border-emerald-600 bg-emerald-50 p-3 text-sm">
                  Avtalet är godkänt. Denna version är låst.
                </p>
              ) : (
                <>
                  <button
                    disabled={
                      Boolean(busy) || autosave.isSaving || (!dirty && !recipientChanged && workspace.revision > 0 && autosave.state?.status !== 'error')
                      || confirmItemized
                    }
                    className={`${button} mt-5 w-full bg-white`}
                    onClick={() => void action('save')}
                  >
                    {busy === 'save' ? (
                      <Loader2 size={17} className="animate-spin" />
                    ) : (
                      <Save size={17} />
                    )}
                    {autosave.state?.status === 'error' ? 'Försök spara igen' : contractView && recipientChanged ? 'Bekräfta mottagare' : contractView ? 'Spara nu' : 'Spara utkast'}
                  </button>
                  {contractView && recipientChanged && <p className="mt-2 text-sm text-amber-800">Mottagaren är inte uppdaterad.</p>}
                  <button
                    className={`${button} mt-3 w-full bg-white`}
                    onClick={() => setView(contractView ? 'document' : 'offerDocument')}
                  >
                    <Eye size={17} />
                    {contractView ? 'Granska avtal' : 'Granska offert'}
                  </button>
                  {!contractView && <button className={`${button} mt-3 w-full bg-slate-950 text-white`} onClick={() => { setExpanded('customer'); setView('contract') }}>Gå vidare till avtal <ArrowRight size={17} /></button>}
                  {contractView && <>
                  {issues.length > 0 && (
                    <details className="mt-5 text-sm">
                      <summary className="cursor-pointer font-semibold text-amber-700">
                        {issues.length} {issues.length === 1 ? 'sak' : 'saker'} kvar inför utskick
                      </summary>
                      <ul className="mt-3 space-y-2 text-slate-600">
                        {issues.map((i) => (
                          <li key={i}>{i}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <label className="mt-5 flex items-start gap-2 text-sm leading-6">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                      className="mt-1 h-5 w-5 shrink-0"
                      disabled={Boolean(busy)}
                    />
                    <span>
                      Jag har granskat avtalet, mottagaren och
                      avtalshandlingarna. Omfattning, priser och villkor är
                      klara för utskick.
                    </span>
                  </label>
                  <button
                    disabled={
                      Boolean(busy) || autosave.isSaving || autosave.state?.status === 'error' ||
                      confirmItemized ||
                      dirty ||
                      !workspace.revision ||
                      issues.length > 0 ||
                      !confirmed ||
                      !customer?.email
                    }
                    onClick={() => void action('publish')}
                    className={`${button} mt-4 w-full bg-slate-950 text-white`}
                  >
                    {busy === 'publish' ? (
                      <Loader2 className="animate-spin" size={17} />
                    ) : (
                      <Send size={17} />
                    )}
                    Skicka avtal
                  </button>
                  <p className="mt-3 break-all text-sm text-slate-500">Mottagare: {customer?.email || 'Saknas'}</p>
                  </>}
                </>
              )}
              {contractView && <section className="mt-7 border-t border-slate-200 pt-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">Publicerade versioner</h3>
                  <button
                    className="inline-flex h-11 w-11 items-center justify-center"
                    aria-label="Uppdatera avtalsstatus"
                    title="Uppdatera avtalsstatus"
                    disabled={Boolean(busy) || autosave.isSaving}
                    onClick={() => {
                      if (
                        !dirty ||
                        window.confirm(
                          'Hämta den sparade versionen? Dina osparade ändringar ersätts.'
                        )
                      )
                        void action('refresh')
                    }}
                  >
                    <RefreshCw
                      size={17}
                      className={busy === 'refresh' ? 'animate-spin' : ''}
                    />
                  </button>
                </div>
                {workspace.offers.length === 0 && (
                  <p className="mt-2 text-sm text-slate-500">
                    Inget avtal publicerat.
                  </p>
                )}
                {workspace.offers.map((o) => (
                  <div key={o.id} className="border-b border-slate-200 py-4">
                    <strong className="text-sm">
                      Version {o.version} ·{' '}
                      {
                        {
                          published: 'Publicerad',
                          accepted: 'Godkänd',
                          withdrawn: 'Återkallad',
                          superseded: 'Ersatt'
                        }[o.status]
                      }
                    </strong>
                    <p className="mt-1 text-sm text-slate-500">
                      {o.sentAt ? 'Mejl skickat' : 'Utskick inte bekräftat'}
                    </p>
                    {o.status === 'published' && !o.sentAt && (
                      <button
                        className={`${button} mt-2 w-full`}
                        disabled={Boolean(busy) || autosave.isSaving || dirty || recipientChanged}
                        onClick={() => void action('send', { id: o.id })}
                      >
                        <Send size={16} />
                        Försök skicka igen
                      </button>
                    )}
                    {o.status === 'published' && (
                      <button
                        className="mt-2 text-sm text-rose-700"
                        disabled={Boolean(busy) || autosave.isSaving || dirty}
                        onClick={() => {
                          if (
                            window.confirm(
                              'Återkalla avtalet? Kunden kan inte längre godkänna det.'
                            )
                          )
                            void action('withdraw', { id: o.id })
                        }}
                      >
                        Återkalla avtal
                      </button>
                    )}
                    {o.status === 'accepted' && (
                      <p className="mt-2 flex gap-2 text-sm text-emerald-700">
                        <Check size={16} />
                        {o.snapshot.contractPricing ? customerPriceLabel(o.snapshot) : money(o.acceptedTotalOre)}
                      </p>
                    )}
                  </div>
                ))}
              </section>}
            </div>
            </details>
          </aside>
        </div>
      )}
    </Container>
  )
}
