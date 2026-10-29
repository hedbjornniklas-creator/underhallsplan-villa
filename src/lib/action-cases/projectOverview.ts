import type { ActionCaseItemView, ActionCaseView } from './contracts'
// @ts-expect-error Node strip-types tests require the explicit extension.
import { customerOfferBaseAmount, type CustomerOfferWorkspace } from './customerOffers.ts'
// @ts-expect-error Node strip-types tests require the explicit extension.
import { activeSigningVersion } from './contractSigning.ts'
// @ts-expect-error Node strip-types tests require the explicit extension.
import { legacyChoiceCategories } from './customerPlanning.ts'
import type { QuestionWorkspace } from './projectQuestions'
import type { ProjectSchedule } from './projectSchedule'
import type { ProjectView } from './projectNavigation'

export type OverviewPoint = {
  id: string; title: string; owner: string; source: string; view: ProjectView
  questionId?: string; due: string | null; mine: boolean
}
export type OverviewActivity = { id: string; title: string; actor: string; at: string; view: ProjectView; questionId?: string }
export const overviewToday = (now = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
const day = (date: string) => Date.parse(`${date}T12:00:00Z`)
export const overviewDate = (date: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', ...options }).format(new Date(date.length === 10 ? `${date}T12:00:00Z` : date))
const pointDay = (date: string) => date.length === 10 ? date : overviewToday(new Date(date))
export const overviewPointStatus = (point: OverviewPoint, today: string, now?: number) => !point.due ? 'undated'
  : (now !== undefined && point.due.length > 10 ? Date.parse(point.due) < now : pointDay(point.due) < today) ? 'late' : 'soon'

// This is a display-only gross total. A Klar flag is not a missing price.
export function overviewItemAmount(item: ActionCaseItemView): number | null {
  const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
  const amount = (value: number) => Number.isSafeInteger(value) && value >= 0 ? value : null
  if (item.lumpSum) return valid(item.lumpSum.customerPrice) && valid(item.lumpSum.vatRate) ? amount(Math.round(item.lumpSum.customerPrice * (1 + item.lumpSum.vatRate / 100) * 100)) : null
  const lines = item.costLines.filter(line => !line.coveredByQuoteId)
  if (!lines.length || lines.some(line => !valid(line.quantity) || !valid(line.unitCost) || !valid(line.markupPercent) || !valid(line.vatRate))) return null
  return amount(Math.round(lines.reduce((sum, line) => sum + line.quantity! * line.unitCost! * (1 + line.markupPercent / 100) * (1 + line.vatRate / 100), 0) * 100))
}

export function overviewContract(offer: CustomerOfferWorkspace | null) {
  const accepted = offer?.offers.find(row => row.status === 'accepted')
  const published = offer?.offers.find(row => row.status === 'published')
  const paper = activeSigningVersion(offer?.signingVersions)
  const version = accepted ?? published ?? paper
  const draft = version?.snapshot ?? offer?.draft ?? null
  const label = !offer ? 'Kunde inte hämtas' : accepted ? 'Godkänt' : published ? published.sentAt ? 'Skickat' : 'Publicerat'
    : paper?.delivery?.signedCopy ? 'Underskrivet' : paper ? 'Låst' : 'Utkast'
  const shared = Boolean(accepted || published || (paper?.delivery?.sharedAt && !paper.delivery.withdrawnAt))
  const source = !offer ? 'Underlag saknas' : version ? `Avtalsversion ${version.version}` : 'Sparat avtalsutkast'
  const base = draft ? customerOfferBaseAmount(draft) : null
  // A frozen version's payment plan is compared with that same version, never a newer draft.
  const plan = draft?.paymentPlan
  const planAmount = plan?.installments.length && plan.installments.every(row => row.amountOre !== null)
    ? plan.installments.reduce((sum, row) => sum + row.amountOre!, 0) : null
  return { draft, label, shared, source, base, planAmount, difference: base !== null && planAmount !== null ? base - planAmount : null,
    version: version?.version ?? null, at: accepted?.acceptedAt ?? published?.publishedAt ?? paper?.createdAt ?? null }
}

export function projectOverview(project: ActionCaseView, offer: CustomerOfferWorkspace | null, questions: QuestionWorkspace | null, schedule: ProjectSchedule | null, today: string) {
  const contract = overviewContract(offer)
  const manager = questions?.assignees.find(person => person.kind === 'profile' && person.id === questions.managerId)?.name || 'Projektansvarig'
  const managedByMe = Boolean(questions?.userId && questions.userId === questions.managerId)
  const points: OverviewPoint[] = []
  const paper = activeSigningVersion(offer?.signingVersions)
  if (paper?.signedCopyTask && !paper.delivery?.signedCopy) {
    const task = paper.signedCopyTask
    const owner = questions?.assignees.find(person => person.kind === 'profile' && person.id === task.assigneeProfileId)?.name || 'Uppgiftens ansvariga'
    points.push({ id: `contract-upload:${paper.id}`, title: 'Ladda upp signerat avtal', owner, source: `Avtal · version ${paper.version}`, view: 'contract', due: task.dueAt || null,
      mine: Boolean(questions?.userId && questions.userId === task.assigneeProfileId) })
  }
  // The input is already membership-filtered by the existing question endpoint.
  for (const q of questions?.questions ?? []) {
    if (q.body.status === 'closed') continue
    const task = q.tasks.find(task => task.active ?? !['approved', 'cancelled'].includes(task.status))
    points.push({ id: `question:${q.id}`, title: q.body.title, owner: q.body.assignee?.name || 'Ej tilldelad', source: 'Fråga', view: 'questions', questionId: q.id,
      due: task?.dueAt || null, mine: q.body.assignee?.kind === 'profile' && q.body.assignee.id === questions?.userId })
  }
  const planning = offer?.planning
  const categories = planning?.available ? planning.categories ?? legacyChoiceCategories(planning.items) : []
  const pendingChoices = categories.filter(category => {
    const shared = planning?.sharedChoices
    const choice = shared?.choices.find(choice => choice.categoryId === category.id && choice.categoryVersion === shared.versions[category.id])
    const old = shared?.categories.find(row => row.id === category.id)
    return category.optionIds.length > 0 && !(choice?.optionId && category.optionIds.includes(choice.optionId) && old && old.title === category.title && old.specification === category.specification && old.decisionBy === category.decisionBy && JSON.stringify(old.optionIds) === JSON.stringify(category.optionIds))
  })
  for (const category of pendingChoices) points.push({ id: `choice:${category.id}`, title: category.title, owner: 'Beställaren', source: 'Val och tillval', view: 'choices', due: category.decisionBy || null, mine: false })
  if (contract.difference !== null && contract.difference !== 0) points.push({ id: 'payment-difference', title: 'Stäm av betalningsplanen', owner: manager, source: 'Betalningsplan', view: 'payments', due: null, mine: managedByMe })
  const rows = schedule?.available ? schedule.rows : []
  for (const row of rows) if (row.status !== 'completed' && (!row.startDate || !row.endDate)) points.push({ id: `schedule:${row.id}`, title: row.title || 'Namnlöst moment', owner: manager, source: 'Tidsplan · datum saknas', view: 'schedule', due: null, mine: managedByMe })
  points.sort((a, b) => (a.due ? pointDay(a.due) : '9999-12-31').localeCompare(b.due ? pointDay(b.due) : '9999-12-31') || a.title.localeCompare(b.title, 'sv'))
  const items = project.items.filter(item => !['cancelled', 'declined'].includes(item.status))
  const amounts = items.map(overviewItemAmount)
  const calculation = amounts.length && amounts.every(amount => amount !== null) ? amounts.reduce<number>((sum, amount) => sum + amount!, 0) : null
  const nextStart = rows.filter(row => row.status === 'planned' && row.startDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null
  const nextDecision = pendingChoices.filter(category => category.decisionBy).sort((a, b) => a.decisionBy.localeCompare(b.decisionBy))[0] ?? null
  const activities: OverviewActivity[] = []
  const operationLabels: Record<string, string> = { create: 'Fråga registrerad', update: 'Fråga uppdaterad', answer: 'Svar registrerat', note: 'Intern anteckning', close: 'Fråga avslutad', reopen: 'Fråga återöppnad', send: 'Fråga skickad' }
  for (const q of questions?.questions ?? []) {
    // Do not copy message bodies, files or hidden question counts into the overview.
    const event = q.events.reduce<(typeof q.events)[number] | null>((latest, event) => !latest || event.createdAt > latest.createdAt ? event : latest, null)
    const exactEvent = event?.createdAt === q.updatedAt ? event : null
    activities.push({ id: `activity:${q.id}`, title: `${operationLabels[exactEvent?.operation || ''] || 'Fråga uppdaterad'}: ${q.body.title}`, actor: exactEvent?.actorName || '', at: q.updatedAt, view: 'questions', questionId: q.id })
  }
  for (const file of project.attachments) activities.push({ id: `file:${file.id}`, title: file.title || file.fileName, actor: 'Fil tillagd', at: file.createdAt, view: 'files' })
  if (contract.at) activities.push({ id: 'contract-version', title: `Avtal: ${contract.label.toLocaleLowerCase('sv')}`, actor: contract.source, at: contract.at, view: 'contract' })
  activities.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  return { contract, points, calculation, missingPrices: amounts.filter(amount => amount === null).length, nextStart, nextDecision, activities: activities.slice(0, 3) }
}

export function overviewTimeline(schedule: ProjectSchedule | null, today: string) {
  const start = day(today), weekday = new Date(start).getUTCDay()
  const monday = start - ((weekday + 6) % 7) * 86_400_000
  const end = monday + 42 * 86_400_000
  const rows = (schedule?.available ? schedule.rows : []).filter(row => row.startDate && row.endDate && day(row.startDate) < end && day(row.endDate) >= monday)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title, 'sv'))
  return { monday, weeks: Array.from({ length: 6 }, (_, i) => new Date(monday + i * 7 * 86_400_000).toISOString().slice(0, 10)),
    todayPercent: (start - monday) / (42 * 86_400_000) * 100,
    rows: rows.slice(0, 5).map(row => ({ ...row, left: Math.max(0, (day(row.startDate) - monday) / (42 * 86_400_000) * 100),
      width: (Math.min(end, day(row.endDate) + 86_400_000) - Math.max(monday, day(row.startDate))) / (42 * 86_400_000) * 100 })), total: rows.length }
}
