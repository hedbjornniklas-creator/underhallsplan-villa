// Real components, synthetic HTTP backend. No live database, email or acceptance.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { ABS18_TERMS, withStandardContractTerms } from '../src/lib/action-cases/standardContractTerms.ts'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import puppeteer from 'puppeteer-core'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import {
  workspace,
  actionCase,
  itemizedWorkspace,
  published,
  id
} from '../test/fixtures/customer-offer-data.ts'
import {
  customerOfferTotal,
  offerPublishIssues,
  normalizeCustomerOffer,
  mapCustomerOffer
} from '../src/lib/action-cases/customerOffers.ts'
import { normalizeCustomerOfferCosting } from '../src/lib/action-cases/customerOfferCosting.ts'
import { normalizeCustomerChoiceCosting, synchronizeChoicePrices } from '../src/lib/action-cases/customerChoiceCosting.ts'
import { synchronizeChoiceOffers } from '../src/lib/action-cases/choiceOffer.ts'
import { renderChoiceOfferPdf } from '../src/lib/action-cases/choiceOfferPdf.ts'
import { categoryOptions, legacyChoiceCategories, normalizeChoiceCategories, normalizeChoiceFileRefs, normalizePlannedItems } from '../src/lib/action-cases/customerPlanning.ts'
import { projectFixture } from '../test/fixtures/project-workspace-data.ts'
import { normalizeScheduleRows } from '../src/lib/action-cases/projectSchedule.ts'
import { normalizeLumpSum } from '../src/lib/action-cases/lumpSum.ts'
import { copyRegistryCustomer } from '../src/lib/action-cases/customerRegistry.ts'
import { emptyBillingCustomer } from '../src/lib/action-cases/projectBilling.ts'
import { editContractProperty, emptyContractDetails } from '../src/lib/action-cases/customerContract.ts'
import { editSiteFacility } from '../src/lib/action-cases/contractSiteFacilities.ts'
import { normalizePropertyDetails, propertyIdentityKey } from '../src/lib/properties/identity.ts'
import { signingDraft } from '../test/fixtures/contract-signing.ts'
import { renderContractSigningPdf } from '../src/lib/action-cases/contractSigningPdf.ts'
import { publicContractParties } from '../src/lib/action-cases/customerContractParties.ts'
import { emptyQuestion, questionMutation } from '../src/lib/action-cases/projectQuestions.ts'
import { normalizeCostLine } from '../src/lib/action-cases/costing.ts'
import { calculateActionCaseCostTotals } from '../src/lib/action-cases/domain.ts'
import { costCompletionPayload } from '../src/lib/action-cases/costCompletion.ts'
import { defaultCustomerVisibility, projectCustomerPortal, visibilityMutation } from '../src/lib/action-cases/customerSharing.ts'

const require = createRequire(import.meta.url),
  { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve(process.argv.includes('--contract-work') ? 'tmp/contract-work-ui' : process.argv.includes('--choice-offers') ? 'tmp/choice-offers-ui' : process.argv.includes('--purchase-list') ? 'tmp/purchase-list-ui' : process.argv.includes('--project-overview') ? 'tmp/project-overview-ui' : 'tmp/customer-offer-ui')
await mkdir(output, { recursive: true })
await writeFile(resolve(output, '.gitignore'), '*\n')
await new Promise((done, reject) =>
  webpack(
    {
      mode: 'development',
      devtool: false,
      entry: resolve('test/fixtures/customer-offer-view.tsx'),
      plugins: [
        new webpack.DefinePlugin({
          'process.env': JSON.stringify({ NODE_ENV: 'development' })
        })
      ],
      output: { path: output, filename: 'view.js' },
      resolve: {
        extensions: ['.tsx', '.ts', '.js'],
        alias: { '@/lib/supabaseClient': resolve(process.argv.includes('--choice-files') ? 'test/helpers/choice-pdf-upload-stub.ts' : 'test/helpers/project-supabase-stub.ts'), '@': resolve('src') }
      },
      module: {
        rules: [
          {
            test: /\.tsx?$/,
            exclude: /node_modules/,
            use: resolve('test/helpers/transpile-loader.mjs')
          },
          { test: /\.css$/, type: 'asset/source' }
        ]
      }
    },
    (error, stats) =>
      error || stats.hasErrors()
        ? reject(error ?? Error(stats.toString('errors-only')))
        : done()
  )
)
const { css: base } = await postcss([tailwind(process.argv.includes('--contract-work') ? { base: resolve('src') } : {})]).process(
  process.argv.includes('--project-overview') || process.argv.includes('--contract-work') ? (await readFile('src/app/globals.css', 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components/tasks";\n@source "../components/ui";\n@source "../../test/fixtures/customer-offer-view.tsx";') : await readFile('src/app/globals.css', 'utf8'),
  { from: resolve('src/app/globals.css') }
)
const theme = (await readFile('src/components/tasks/uppdrag-theme.css', 'utf8')) + (await readFile('src/components/tasks/project-questions.css', 'utf8')) + (await readFile('src/components/tasks/action-case-costs.css', 'utf8')) + (await readFile('src/components/tasks/action-case-purchase-list.css', 'utf8')) + (await readFile('src/components/tasks/customer-choice-costs.css', 'utf8')) + (await readFile('src/components/tasks/customer-sharing.css', 'utf8')) + (await readFile('src/components/tasks/project-overview.css', 'utf8')),
  js = await readFile(resolve(output, 'view.js')),
  img = await readFile('public/landing/besiktning-editorial-v2.png')
let state = process.argv.includes('--itemized') ? itemizedWorkspace() : structuredClone(workspace),
  challenge = null,
  failSave = process.argv.includes('--fail-standard-terms')
if (process.argv.includes('--legacy-controls')) {
  state.draft.contractDetails = emptyContractDetails()
  state.draft.contractDetails.fields.controls = { status: 'specified', text: 'TEST: Tidigare gemensamma rolluppgifter.' }
  state.draft.contractDetails.controlParticipants = { controlOfficer: '', customerInspector: '', previousDetails: state.draft.contractDetails.fields.controls }
}
state.planning = { available: true, revision: 0, items: [], sharedItems: [], costingAvailable: true, rowCostingAvailable: true, costing: {}, categoriesAvailable: true, categoriesStored: false, categories: [] }
if (process.argv.includes('--choice-offers')) state.planning.offerAvailable = true
function separateChoices() {
  const choices = state.draft.items.filter((i) => i.kind === 'option')
  state.planning.items.push(...choices.map((i) => ({ id: i.id, title: i.title, scope: i.scope,
    status: 'planned', budgetOre: i.amountOre, decisionBy: '', optionGroup: i.optionGroup ?? '' })))
  for (const i of choices) if (state.costing?.[i.id]) {
    state.planning.costing[i.id] = state.costing[i.id]
    delete state.costing[i.id]
  }
  state.draft.items = state.draft.items.filter((i) => i.kind !== 'option')
}
if (!process.argv.includes('--legacy-draft')) separateChoices()
state.planning.categories = legacyChoiceCategories(state.planning.items)
if (process.argv.includes('--payment-plan')) {
  const total = state.draft.baseAmountOre
  state.draft.paymentTerms = 'FIKTIV TESTPLAN. Betalningsvillkor enligt den granskade avtalshandlingen.'
  state.draft.paymentPlan = { version: 1, installments: [
    { id: id(80), title: 'Grund färdig', condition: 'Efter färdigställd grund enligt avtalad omfattning.', plannedDate: '2027-04-30', amountOre: Math.floor(total / 4) },
    { id: id(81), title: 'Stomme och tak', condition: 'Efter färdig stomme och tätt tak enligt avtalad omfattning.', plannedDate: '', amountOre: Math.floor(total / 2) },
    { id: id(82), title: 'Återstående avtalat arbete', condition: 'Efter färdigställt återstående arbete enligt avtalet.', plannedDate: '', amountOre: total - Math.floor(total / 4) - Math.floor(total / 2) }
  ] }
}
if (process.argv.includes('--serve') && !process.argv.includes('--legacy-draft')) {
  state.offers = [published(state.draft)]
  state.planning.sharedItems = structuredClone(state.planning.items)
}
if (process.argv.includes('--choice-categories')) {
  state.planning.items = [['VELFAC Classic Alu', 100000], ['Ekstrands med skjutparti', 125000], ['Ekstrands med parfönsterdörrar', 115000], ['Nordiska Fönster', 95000], ['Invändig målning', 50000]].map(([title, price], index) => ({
    id: id(850 + index), title, scope: `FIKTIVT TESTUNDERLAG: ${title}. Leverans och montage enligt gemensam specifikation. Inga verkliga priser eller beställningar.`, status: 'planned', budgetOre: price * 100, decisionBy: '', optionGroup: index < 4 ? 'Fönster' : 'Målning'
  }))
  state.planning.categories = legacyChoiceCategories(state.planning.items)
  state.planning.categories[0].specification = 'FIKTIVA TESTKRAV: Fönster för tillbyggnaden. Mått, kulör och öppningsfunktioner kontrolleras före beställning.'
  state.planning.sharedItems = []; state.planning.costing = {}; delete state.planning.sharedChoices
}
if (process.argv.includes('--choice-costs')) {
  const option = state.planning.items[0]
  state.planning.costing[option.id] = { purchaseOre: 10010871, markupBasisPoints: 1000, fixedMarkupOre: null,
    additions: [{ id: id(980), title: 'Montage, drevning, tätning och normal justering', amountOre: 2000000 }] }
  option.budgetOre = 16264948
}
let choiceRecords = [], choiceRevision = 0
if (process.argv.includes('--choice-files')) Object.assign(state.planning, { filesAvailable: true, optionFiles: [], sharedFileRefs: [] })
function publishChoiceCategories() {
  const old = state.planning.sharedChoices
  const categories = structuredClone(state.planning.categories), items = structuredClone(state.planning.items)
  state.planning.sharedItems = items
  const oldRefs = state.planning.sharedFileRefs ?? []
  const refs = structuredClone(state.planning.optionFiles ?? [])
  state.planning.sharedFileRefs = refs
  state.planning.sharedChoices = { revision: ++choiceRevision, categories, items,
    files: refs.map((ref) => { const source = projects.cases[0].attachments.find((f) => f.id === ref.fileId); const prior = old?.files?.find((f) => f.optionId === ref.optionId && f.fileName === source.fileName); return prior ?? { id: randomUUID(), optionId: ref.optionId, fileName: source.fileName, fileSizeBytes: source.fileSizeBytes } }),
    versions: Object.fromEntries(categories.map((category) => {
      const prior = old?.categories.find((c) => c.id === category.id)
      const unchanged = JSON.stringify(prior) === JSON.stringify(category) && JSON.stringify(categoryOptions(category, old?.items ?? [])) === JSON.stringify(categoryOptions(category, items)) && JSON.stringify(oldRefs.filter((f) => category.optionIds.includes(f.optionId))) === JSON.stringify(refs.filter((f) => category.optionIds.includes(f.optionId)))
      return [category.id, unchanged ? old.versions[category.id] : randomUUID()]
    })), choices: structuredClone(choiceRecords.filter((record) => categories.some((c) => c.id === record.categoryId))) }
}
const writes = []
const projects = projectFixture(actionCase)
if (process.argv.includes('--cost-table')) {
  const item = projects.cases[0].items[0]
  item.title = 'Invändigt (fiktivt test)'
  item.scope = 'FIKTIVT TESTUNDERLAG: Innerväggar och puts. Inga verkliga projektuppgifter.'
  Object.assign(item, { ownLaborReady: true, materialPriceReady: true, wasteSolutionReady: true })
  item.costLines = [
    { id: id(970), ...normalizeCostLine({ category: 'own_labor', description: 'Paketpris invändigt', quantity: 1, unit: 'paket', unitCost: 139464.32, markupPercent: 25, verified: true, notes: 'Fiktivt paketpris. Testa att underlaget bevaras.' }), pricingMethod: 'direct', selectedQuoteId: null, coveredByQuoteId: null, workPartId: null, quotes: [] },
    { id: id(971), ...normalizeCostLine({ category: 'other', description: 'Invändig puts, inklusive underlagsputs i badrum och bastu', quantity: 1, unit: 'paket', unitCost: 64000, markupPercent: 17.16, quantityBasis: 'estimated', verified: false, notes: 'Fiktivt underlag: arbete och material.' }), pricingMethod: 'direct', selectedQuoteId: null, coveredByQuoteId: null, workPartId: null, quotes: [] }
  ]
  const total = calculateActionCaseCostTotals(item.costLines)
  Object.assign(item, { estimatedCost: total.internalCost, customerPrice: total.customerPrice })
}
if (process.argv.includes('--contract-pricing')) {
  state.costing = {}
  const moments = [['Mark, grund och dränering',333899],['Stomme och fasad',352645],['Tak',412395],['Invändigt',217913],['VVS och värme',181594],['Ventilation',31633],['Etablering och produktion',500263]]
  state.draft.pricingMode = 'itemized'
  state.draft.baseAmountOre = moments.reduce((sum,[,amount]) => sum + amount * 100,0)
  state.draft.items = moments.map(([title,amount],index) => ({ id:id(610+index),title,scope:`FIKTIV TESTTEXT: ${title}.`,kind:'included',amountOre:amount*100,sourceItemId:id(710+index) }))
  projects.cases[0].items = moments.map(([title,amount],index) => ({ ...structuredClone(projects.cases[0].items[0]),id:id(710+index),title,scope:`FIKTIV PROJEKTTEXT: ${title}.`,status:'ready_for_quote',
    lumpSum:{ internalCost:null,customerPrice:amount/1.25,vatRate:25,verified:true },customerPrice:amount/1.25 }))
  projects.cases[0].items.push({ ...structuredClone(projects.cases[0].items[0]),id:id(720),title:'Ej kontrollerat moment',lumpSum:null,customerPrice:null })
}
if (process.argv.includes('--simple-scope-import')) {
  state.draft.items = [
    { id: id(10), title: projects.cases[0].items[0].title, scope: 'Egen avtalstext grund', kind: 'included', amountOre: 30000000 },
    { id: id(14), title: 'Fönster och ytterdörrar', scope: 'Egen avtalstext fönster', kind: 'included', amountOre: 70000000 },
    ...state.draft.items.filter((item) => item.kind === 'excluded')
  ]
  state.draft.pricingMode = 'itemized'
  state.draft.baseAmountOre = 100000000
  state.offers = []
}
if (process.argv.includes('--legacy-attachments')) {
  state.draft.contractDetails = emptyContractDetails()
  state.draft.contractDetails.assignment = { documents: [
    { fileId: id(4), type: 'Beskrivning', name: 'Tidigare granskad handling', date: '2026-05-11' }
  ], additionalScope: '', exclusions: '', documentNotes: 'Fiktivt test av tidigare valda bilagor.' }
  state.draft.attachmentIds = [id(4), id(3)]
}
if (process.argv.includes('--legacy-customer-work')) {
  state.draft.contractDetails ??= emptyContractDetails()
  state.draft.contractDetails.fields.customerWork = { status: 'specified', text: 'FIKTIVT TEST: Beställaren ordnar elarbetet med egen entreprenör.' }
  state.draft.terms = 'FIKTIVT TEST: Befintliga egna avtalsvillkor ska behållas.'
}
if (process.argv.includes('--empty-work-environment')) {
  state.draft.contractDetails ??= emptyContractDetails()
  state.draft.contractDetails.fields.workEnvironment = { status: 'unreviewed', text: '' }
}
if (process.argv.includes('--legacy-advice')) {
  state.draft.contractDetails ??= emptyContractDetails()
  state.draft.contractDetails.advice = { status: 'given',
    work: 'FIKTIVT TEST: Arbete utan kontrollerat underlag.',
    reason: 'FIKTIVT TEST: Risk for skador pa konstruktionen.',
    communicatedAt: '2026-10-01', customerResponse: 'FIKTIVT TEST: Bestallaren avstar fran arbetet.' }
}
const propertyRegistryTest = process.argv.includes('--property-registry')
const customerRegistryTest = process.argv.includes('--customer-registry') || process.argv.includes('--project-billing') || propertyRegistryTest
const properties = [
  { id: id(110), name: 'Lokevägen 6', municipality: 'Danderyd', cadastralDesignation: 'BYLGIA 24', street: 'Lokevägen 6', postalCode: '182 75', city: 'Djursholm' },
  { id: id(111), name: 'Annan kommun', municipality: 'Täby', cadastralDesignation: 'BYLGIA 24', street: 'Testgatan 2', postalCode: '', city: 'Täby' }
]
let propertyRequestId = ''
if (propertyRegistryTest) {
  state.propertyLink = { available: true, property: null }
  state.draft.contractDetails = emptyContractDetails()
  state.draft.contractDetails.fields.property = { status: 'specified', text: 'BYLGIA 24, Lokevägen 6, Djursholm, Danderyds kommun. Tillbyggnad med cirka 39,06 m² byggnadsarea.' }
}
const registry = { organization: { id: id(90), name: 'Fiktiv testorganisation', canManage: true }, customers: [
  { id: id(91), orgId: id(90), customerNumber: '1001', customerType: 'private', name: 'Anna Test', email: 'anna@example.test', phone: '0700000000', address: 'Testgatan 1', postalCode: '12345', city: 'Teststad', identityNumber: null, isActive: true, version: 1 },
  { id: id(92), orgId: id(90), customerNumber: '1002', customerType: 'business', name: 'Fiktivt företag', email: 'ekonomi@example.test', fortnoxCustomerNumber: '2002', isActive: true, version: 1 },
  { id: id(93), orgId: id(90), customerNumber: '1003', customerType: 'private', name: 'Inaktiv kund', isActive: false, version: 1 }
] }
registry.customers = registry.customers.map((customer) => ({ ...emptyBillingCustomer(), ...customer }))
let billing = { available: true, revision: 0, customerId: null, registry }, billingRequest = null
let customerRequestId = ''
if (customerRegistryTest) {
  state.offers = []
  state.customerLink = { organizationId: id(90), available: true, customerId: null, customerNumber: null }
  state.recipient = structuredClone(actionCase.participants.find((p) => p.role === 'customer'))
}
function syncTestRecipient(binding = false) {
  if (!customerRegistryTest || !state.draft.contractParties) return
  const parties = state.draft.contractParties
  if (binding || state.recipient.name !== parties.customers[0].name || state.recipient.email !== parties.email) {
    projects.cases[0].attachments = projects.cases[0].attachments.map((a) => ({ ...a,
      grantedParticipantIds: a.grantedParticipantIds.filter((id) => id !== state.recipient.id) }))
    state.planning.sharedItems = []
    state.planning.revision++
    schedule.sharedRows = []
    schedule.revision++
  }
  state.recipient = { ...state.recipient, name: parties.customers[0].name, email: parties.email, phone: parties.mobile || parties.phone }
  projects.cases[0].customerName = state.recipient.name
  projects.cases[0].customerEmail = state.recipient.email
  projects.cases[0].customerPhone = state.recipient.phone
  projects.cases[0].participants = projects.cases[0].participants.map((p) => p.role === 'customer' ? state.recipient : p)
}
let schedule = { available: true, revision: 0, rows: [], sharedRows: [] }, slowSave = false
const independentContract = process.argv.includes('--independent-contract')
if (process.argv.includes('--contract-changes')) {
  projects.cases[0].attachments.push({ ...structuredClone(projects.cases[0].attachments.find((f) => f.contentType === 'application/pdf')),
    id: id(750), fileName: 'FIKTIV_ATA_prislista_2026.pdf', contentType: 'application/pdf', attachmentType: 'document', isQuoteDocument: false, grantedParticipantIds: [] })
}
const estimateState = { draft: structuredClone(state.draft), revision: state.revision, costing: structuredClone(state.costing ?? {}) }
if (independentContract) { state.offers = []; state.offerDraft = estimateState }
if (process.argv.includes('--site-facilities')) {
  state.draft.contractDetails ??= emptyContractDetails()
  for (const [key,providedBy,details] of [
    ['electricity','customer','TEST: Byggcentral vid garaget. Förbrukning bekostas av entreprenören enligt överenskommelse.'],
    ['changing','contractor','TEST: Omklädning och klädförvaring i personalbod. Duschlösning anges i överenskommelsen.'],
    ['meals','contractor','TEST: Matplats i personalbod med möjlighet att förvara och värma mat.']
  ]) state.draft.contractDetails.siteFacilities = editSiteFacility(state.draft.contractDetails.siteFacilities,key,{providedBy,paidBy:'contractor',details})
}
const signingPdfs = new Map()
const customerSigningPdfs = new Map(), signedCopies = new Map()
if (process.argv.includes('--contract-signing')) {
  state.draft = signingDraft()
  if (process.argv.includes('--incomplete-contract-signing')) {
    state.draft.contractParties.customers.forEach((c) => c.name = '')
    state.draft.contractParties.contractor.companyName = ''; state.draft.contractParties.contractor.organizationNumber = ''
    state.draft.contractDetails.controlParticipants = { controlOfficer: '', customerInspector: '' }
    state.draft.contractDetails.advice.reason = ''
    state.draft.contractDetails.changesPricing.markups.materials = null
    state.draft.contractPricing.rows[0].amountOre = null
    state.draft.paymentPlan.installments[0].condition = ''
    state.draft.paymentPlan.installments[0].amountOre = null
    state.draft = normalizeCustomerOffer(state.draft)
  }
  state.costing = {}; state.offers = []; state.signingAvailable = true; state.signingVersions = []
  state.deliveryAvailable = true
  if (process.argv.includes('--contract-delivery')) state.draft.signingMethod = 'external'
}
const contractSnapshot = () => {
  const p = state.draft.contractParties
  return structuredClone({ ...state.draft, projectTitle: projects.cases[0].title, propertyAddress: projects.cases[0].propertyAddress,
    customerName: p?.customers[0]?.name ?? '', customerEmail: p?.email ?? '', issuerName: p?.contractor.companyName ?? '', replyEmail: p?.contractor.email ?? '' })
}
const choiceUploads = new Map()
const questionData = { questions: [], userId: id(90), managerId: id(90), canManageParticipants: true, customersAvailable: true, assignees: [{ id: id(90), kind: 'profile', name: 'Anna Testledare' }, { id: id(91), kind: 'contact', name: 'VVS Test', email: 'vvs@example.invalid' }, { id: id(92), kind: 'customer', name: 'Nina Testbeställare', email: 'customer@example.invalid' }, { id: id(93), kind: 'customer', name: 'Thomas Testbeställare', email: 'customer@example.invalid' }, { id: id(94), kind: 'contact', name: 'Nina Testbeställare', email: 'customer@example.invalid' }] }
const fakeMember = person => ({ id: randomUUID(), kind: person.kind, personId: person.id, name: person.name, email: person.email || null, shared: false })
const dialogues = new Map()
const getDialogue = q => {
  if (!dialogues.has(q.id)) dialogues.set(q.id, { questionId: q.id, version: 0, managerId: questionData.managerId, canManage: true, viewerId: q.participants[0].id, sharedAt: null, snapshot: null, participants: q.participants, messages: [], deliveries: [] })
  return { ...dialogues.get(q.id), status: q.body.status }
}
const fakeManager = () => ({ managerId: questionData.managerId, managerName: 'Anna Testledare', canEdit: true, people: [{ id: id(90), name: 'Anna Testledare' }] })
if (process.argv.includes('--question-dates')) {
  const body = { ...emptyQuestion(), title: 'Fiktiv fråga från byggmöte', description: 'Kan golvvärmen vara på under sommaren?', assignee: questionData.assignees[2] }
  const createdAt = '2026-10-17T08:00:00Z', updatedAt = '2026-10-19T10:00:00Z'
  questionData.questions.push({ id: id(950), number: 1, revision: 2, body, createdAt, updatedAt, participants: [fakeMember(questionData.assignees[0]), fakeMember(questionData.assignees[2])], tasks: [], events: [
    { id: id(951), operation: 'create', revision: 1, actorName: 'Anna Testledare', createdAt, body, text: '', reportedBy: '', files: [], taskId: null },
    { id: id(952), operation: 'update', revision: 2, actorName: 'Anna Testledare', createdAt: updatedAt, body, text: '', reportedBy: '', files: [], taskId: null }
  ] })
}
const questionRequests = new Map()
let overviewReadFailure = false
if (process.argv.includes('--project-overview')) {
  const date = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
  projects.cases[0].title = 'TEST: Projektöversikt – Nästa steg'
  projects.cases[0].attachments = []
  projects.cases[0].items.forEach(item => { item.lumpSum = { internalCost: null, customerPrice: 832000, vatRate: 25, verified: false }; item.customerPrice = 832000 })
  state.draft.baseAmountOre = 200000000; state.draft.pricingMode = 'total'; delete state.draft.contractPricing
  state.draft.paymentPlan = { version: 1, installments: [{ id: id(80), title: 'Efter färdig grund', condition: '', plannedDate: '', amountOre: 99000000 }, { id: id(81), title: 'Efter tätt tak', condition: '', plannedDate: '', amountOre: 99000000 }] }
  state.offers = [published(state.draft)]
  state.planning.items = [{ id: id(850), title: 'Fönster A', scope: 'Fiktivt underlag', status: 'planned', budgetOre: 10000000, decisionBy: '', optionGroup: 'Fönster' }, { id: id(851), title: 'Fönster B', scope: 'Fiktivt underlag', status: 'planned', budgetOre: 12000000, decisionBy: '', optionGroup: 'Fönster' }]
  state.planning.categories = [{ id: id(850), title: 'Fönster', specification: 'TEST', optionIds: [id(850), id(851)], decisionBy: date(3) }]
  state.planning.sharedItems = []; delete state.planning.sharedChoices
  const body = { ...emptyQuestion(), title: 'Fastställ placering av VVB', description: 'TEST: Kan varmvattenberedaren placeras över badrummet?', assignee: questionData.assignees[1] }
  questionData.questions.push({ id: id(950), number: 1, revision: 1, body, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), participants: [fakeMember(questionData.assignees[0])], events: [], tasks: [{ id: id(960), status: 'assigned', active: true, dueAt: `${date(-1)}T10:00:00Z`, assigneeName: 'VVS Test', events: [], files: [] }] })
  schedule.rows = [['Projektering', -1, 8, 'in_progress'], ['Mark och grund', 12, 23, 'planned'], ['Stomme', 19, 30, 'planned'], ['Tak', 26, 37, 'planned'], ['Ventilation', null, null, 'planned']].map(([title, from, to, status], index) => ({ id: id(970 + index), title, phase: '', startDate: from === null ? '' : date(from), endDate: to === null ? '' : date(to), status, sourceItemId: null }))
}
if (process.argv.includes('--purchase-list')) {
  projects.cases[0].title = 'TEST: Materialbeställning'
  projects.cases[0].propertyAddress = 'Testgatan 12, Teststad'
  const item = projects.cases[0].items[0]
  item.title = 'Mark och grund (fiktivt test)'
  item.scope = 'Fiktivt test av materiallista. Ingen riktig beställning.'
  item.lumpSum = null
  item.costLines = [
    { description: 'Isolerskiva EPS S100, 100 mm', quantity: 24, unit: 'm²', unitCost: 89 },
    { description: 'Kantlist, återbruk', quantity: 8, unit: 'st', unitCost: 0 },
    { description: 'Dräneringsrör 110 mm', quantity: null, unit: 'm', unitCost: null },
    { description: 'Montering (ska inte skrivas ut)', category: 'own_labor', quantity: 10, unit: 'tim', unitCost: 500 },
  ].map((line, index) => ({ id: id(990 + index), ...normalizeCostLine({ category: 'material', markupPercent: 25, ...line }), coveredByQuoteId: null }))
}
const overviewContractBaseline = JSON.stringify({ draft: state.draft, offers: state.offers, signingVersions: state.signingVersions })
if (process.argv.includes('--work-sums')) {
  for (const line of projects.cases[0].items[0].costLines) line.vatRate = 25
  projects.cases[0].items[1].costLines = [
    { id: id(980), ...normalizeCostLine({ category: 'material', description: 'Fiktivt material', quantity: 2, unit: 'st', unitCost: 1000, markupPercent: 20 }), vatRate: 25 },
    { id: id(981), ...normalizeCostLine({ category: 'own_labor', description: 'Fiktivt montage', quantity: null, unit: 'tim', unitCost: 500 }), vatRate: 25 },
  ]
}
const contractWorkTest = process.argv.includes('--contract-work')
const contractWorkRequests=[]
if (contractWorkTest) {
  projects.cases[0].title='TEST: Kopplade avtalsmoment'
  state.draft.signingMethod='external'; state.offers=[]
  const item=projects.cases[0].items[0]
  item.lumpSum=null; item.scopeNotesAvailable=true; item.scopeConditionsAvailable=true
  state.draft.items=[{id:id(610),sourceItemId:item.id,title:item.title,scope:item.scope,scopeConditions:'',scopeExclusions:'',scopeAdvice:'',kind:'included',amountOre:null}]
  state.draft.contractPricing={version:1,mode:'fixed',basis:'rows',split:'combined',display:'priced',totalOre:null,labourOre:null,materialOre:null,rows:[{id:id(611),sourceItemId:item.id,title:item.title,kind:'fixed',amountOre:100000,labourOre:null,materialOre:null}],running:{hourlyOre:null,managementOre:null,markupPercent:null,approximateOre:null}}
  state.draft.baseAmountOre=100000
}
function updateContractWorkView(){
  if(!contractWorkTest)return
  const frozen=state.signingVersions?.find(v=>!v.releasedAt), body=frozen?.snapshot??state.draft
  for(const item of projects.cases[0].items){
    const part=body.items.find(row=>row.sourceItemId===item.id),price=body.contractPricing?.rows.find(row=>row.sourceItemId===item.id)
    if(!part)continue
    for(const key of ['title','scope','scopeConditions','scopeExclusions','scopeAdvice']) item[key]=part[key]??''
    item.contractWork={revision:state.revision,locked:Boolean(frozen),version:frozen?.version??null,documentId:frozen?.id??null,price:{editable:true,split:'combined',amountOre:price?.amountOre??null,labourOre:null,materialOre:null},differences:[]}
  }
}
updateContractWorkView()
let customerSharing = { revision: 0, tabs: defaultCustomerVisibility(), updatedAt: null, updatedBy: null }
const sharingRequests = new Map()
const sharingWorkspace = () => ({ ...customerSharing, canEdit: questionData.managerId === questionData.userId, managerId: questionData.managerId,
  recipients: projects.cases[0].participants.filter(p => p.role === 'customer').map(({id,name,email}) => ({id,name,email})) })
const externalContracts = () => state.signingVersions?.filter(v => v.delivery?.sharedAt && !v.delivery.withdrawnAt).map(v => ({
  document: mapCustomerOffer({id:v.id,version:v.version,status:'published',snapshot:v.snapshot,files:v.files,published_at:v.delivery.sharedAt}),
  createdAt:v.createdAt,releasedAt:v.releasedAt,sharedAt:v.delivery.sharedAt,signedCopyRegisteredAt:v.delivery.signedCopy?.registeredAt??null }))
function customerPortal(participantId) {
  const project = projects.cases[0], participant = project.participants.find(p => p.role === 'customer' && p.id === participantId)
  if (!participant) return null
  return projectCustomerPortal({ accessState: 'open', participant,
    actionCase: { id: project.id, title: project.title, propertyAddress: project.propertyAddress, description: null, status: project.status, items: [],
      attachments: project.attachments.filter(f => f.grantedParticipantIds.includes(participant.id)), schedule: schedule.sharedRows },
    customerOffers: { enabled: true, offers: state.offers, externalContracts: externalContracts(), plannedItems: state.planning.sharedItems, plannedChoices: state.planning.sharedChoices }
  }, customerSharing)
}
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  const requestInfo={path,method:req.method}; if(contractWorkTest)contractWorkRequests.push(requestInfo)
  if (['/__test__/viewport/390','/__test__/viewport/344'].includes(path)) {
    const width = path.split('/').at(-1)
    res.setHeader('Content-Type','text/html; charset=utf-8')
    const query = new URL(req.url, 'http://localhost').searchParams
    const target = query.has('customer') ? '/kund' : `/uppdrag/${id(1)}?view=${['choices','questions','work','sharing','customer','overview'].includes(query.get('view')) ? query.get('view') : 'contract'}`
    res.end(`<!doctype html><html lang="sv"><head><title>Gizmo mobiltest ${width}</title><style>body{margin:0}iframe{display:block;border:0;width:${width}px;height:844px}</style></head><body><iframe title="Fiktivt mobilprojekt" src="${target}"></iframe></body></html>`)
    return
  }
  const json = (body, status = 200) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  }
  if(contractWorkTest && path==='/__test__/requests'){json(contractWorkRequests);return}
  if (process.argv.includes('--choice-files') && path.startsWith('/__test__/choice-pdf-upload/') && req.method === 'PUT') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    choiceUploads.set(decodeURIComponent(path.split('/').at(-1)), Buffer.concat(chunks)); json({ ok: true }); return
  }
  if (path === '/project-fixture') { json(projects); return }
  if (path.endsWith('/sharing') && req.method === 'GET') { json(sharingWorkspace()); return }
  if ((path.endsWith('/sharing/preview') || path === '/__test__/customer-portal') && req.method === 'GET') {
    const recipient = path.endsWith('/sharing/preview') ? new URL(req.url, 'http://localhost').searchParams.get('participantId') : sharingWorkspace().recipients[0]?.id
    const portal = customerPortal(recipient); json(portal || { error: 'Beställaren saknas.' }, portal ? 200 : 404); return
  }
  if (path.endsWith('/manager') && req.method === 'GET') { json(fakeManager()); return }
  const dialogueId = path.match(/\/questions\/([^/]+)\/dialogue$/)?.[1]
  if (dialogueId && req.method === 'GET') { const q = questionData.questions.find(q => q.id === dialogueId); json(q ? getDialogue(q) : { error: 'Saknas' }, q ? 200 : 404); return }
  if (path.endsWith('/questions') && req.method === 'GET') {
    if (overviewReadFailure) { overviewReadFailure = false; json({ error: 'Fiktivt läsfel' }, 503); return }
    json(questionData); return
  }
  if (path === '/__test__/overview-control' && req.method === 'POST' && process.argv.includes('--project-overview')) { overviewReadFailure = true; json({ ok: true }); return }
  if (path === '/__test__/overview-integrity' && req.method === 'GET' && process.argv.includes('--project-overview')) { json({ contractUnchanged: JSON.stringify({ draft: state.draft, offers: state.offers, signingVersions: state.signingVersions }) === overviewContractBaseline, writes }); return }
  if (path === '/__test__/question-task-response' && req.method === 'POST') {
    const task = questionData.questions.flatMap(q => q.tasks)[0]
    if (!task) { json({ error: 'Skapa en fiktiv uppgift först.' }, 409); return }
    task.status = 'ready_for_review'; task.events.push({ id: randomUUID(), actorName: 'VVS Test', type: 'comment', text: 'FIKTIVT TESTSVAR: Driftläget behöver kontrolleras mot tillverkarens underlag.', createdAt: new Date().toISOString() })
    json({ ok: true }); return
  }
  if (customerRegistryTest && path === '/api/settings/customers') { json({ workspace: registry }); return }
  if (propertyRegistryTest && path.endsWith('/properties') && req.method === 'GET') { json({ properties }); return }
  if (path === '/__test__/writes') { json(writes); return }
  if (path.endsWith('/customer-choices') && req.method === 'GET') { json(state.planning.sharedChoices ?? { error: 'Valen visas inte längre för beställaren.' }, state.planning.sharedChoices ? 200 : 404); return }
  if (path.includes('/customer-choices/files/') && req.method === 'GET') {
    const fileId = path.split('/').at(-1), file = state.planning.sharedChoices?.files?.find((f) => f.id === fileId)
    if (!file) { json({ error: 'PDF:en visas inte längre.' }, 404); return }
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Disposition', `${req.url.includes('download=1') ? 'attachment' : 'inline'}; filename="TEST-underlag.pdf"`)
    res.end(await readFile(ABS18_TERMS.assetPath)); return
  }
  if (path.endsWith('/contract-signing/pdf') && req.method === 'GET') {
    const revision=Number(new URL(req.url,'http://localhost').searchParams.get('revision'))
    if (revision!==state.revision) { json({error:'Utkastet har ändrats.'},409); return }
    const active=state.signingVersions.find((v)=>!v.releasedAt)
    const pdf=active?signingPdfs.get(active.id):await renderContractSigningPdf({id:id(1),version:0,draftRevision:revision,createdAt:new Date().toISOString(),snapshot:contractSnapshot(),files:[]})
    res.setHeader('Content-Type','application/pdf'); res.setHeader('Content-Disposition','attachment; filename="TEST-avtalsutkast.pdf"')
    res.end(pdf); return
  }
  const signingDownload = path.match(/\/contract-signing\/([^/]+)\/(pdf|customer-pdf)$/)
  if (signingDownload && req.method === 'GET') {
    const version=state.signingVersions.find((v)=>v.id===signingDownload[1])
    const isPublic=path.includes('/public/')
    const pdf = isPublic && (!version?.delivery?.sharedAt || version.delivery.withdrawnAt) ? null : (isPublic || signingDownload[2] === 'customer-pdf' ? customerSigningPdfs : signingPdfs).get(signingDownload[1])
    if (!pdf) { json({error:'Version saknas'},404); return }
    res.setHeader('Content-Type','application/pdf'); res.setHeader('Content-Disposition','attachment; filename="TEST-avtal.pdf"')
    res.end(pdf); return
  }
  const signedRoute=path.match(/\/contract-signing\/([^/]+)\/signed$/)
  if (signedRoute && req.method==='GET') {
    const bytes=signedCopies.get(signedRoute[1]);if(!bytes){json({error:'Kopia saknas'},404);return}
    res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','attachment; filename="TEST-underskrivet.pdf"');res.end(bytes);return
  }
  if(signedRoute && req.method==='POST') {
    const chunks=[];for await(const chunk of req)chunks.push(chunk)
    const form=await new Request('http://localhost'+req.url,{method:'POST',headers:req.headers,body:Buffer.concat(chunks)}).formData()
    const version=state.signingVersions.find((v)=>v.id===signedRoute[1]&&!v.releasedAt),file=form.get('file')
    if(!version || form.get('confirmed')!=='true' || Number(form.get('revision'))!==state.revision || !(file instanceof File)){json({error:'Kontrollera version och PDF'},409);return}
    signedCopies.set(version.id,Buffer.from(await file.arrayBuffer()))
    version.delivery??={sharedAt:null,withdrawnAt:null,participantId:null,signedCopy:null}
    version.delivery.signedCopy={fileName:file.name,fileSizeBytes:file.size,registeredAt:new Date().toISOString()}
    writes.push('upload_signed');json(state);return
  }
  if (path === '/__test__/fail-save' && req.method === 'POST') { failSave = true; json({ ok: true }); return }
  if (path === '/__test__/slow-save' && req.method === 'POST') { slowSave = true; json({ ok: true }); return }
  if (path === '/__test__/stale-choice' && req.method === 'POST' && process.argv.includes('--choice-categories')) { state.planning.items[0].budgetOre += 100; publishChoiceCategories(); json({ ok: true }); return }
  if (path === '/__test__/accept-contract' && req.method === 'POST') {
    state.offers = [{ ...published(state.draft), status: 'accepted', acceptedAt: new Date().toISOString(), acceptedBy: 'Anna Test', acceptedTotalOre: state.draft.baseAmountOre }]
    json({ ok: true }); return
  }
  if (path.endsWith('/billing') && req.method === 'GET') { json(billing); return }
  if (path.endsWith('/schedule') && req.method === 'GET') { json(schedule); return }
  if (path === '/api/action-cases' && req.method === 'GET') { updateContractWorkView(); json({ workspace: projects }); return }
  if (req.method === 'POST') {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    if(contractWorkTest){requestInfo.operation=body.operation??body.action;requestInfo.revision=body.revision}
    if (slowSave && (['save', 'autosave'].includes(body.operation) || (path.endsWith('/questions') && ['create','update'].includes(body.operation)) || ['save_item_scope','set_cost_line_complete','create_cost_line','update_cost_line'].includes(body.action) || path.endsWith('/billing') || path.endsWith('/name') || path.endsWith('/sharing'))) { slowSave = false; await new Promise((resolve) => setTimeout(resolve, 5000)) }
    if (path.endsWith('/sharing')) {
      const before = JSON.stringify({ state, projects })
      if (failSave) { failSave = false; json({ error: 'Tillfälligt sparfel. Dina val är kvar.' }, 503); return }
      const request = visibilityMutation(body), prior = sharingRequests.get(request.requestId)
      if (questionData.managerId !== questionData.userId) { json({ error: 'Bara projektansvarig kan ändra delning.' }, 403); return }
      if (prior && prior.request !== JSON.stringify(request)) { json({ error: 'Gammalt försök.' }, 409); return }
      if (!prior && request.revision !== customerSharing.revision) { json({ error: 'Delningen har ändrats i en annan flik.' }, 409); return }
      if (!prior) {
        customerSharing = { ...customerSharing, revision: customerSharing.revision + 1, tabs: { ...customerSharing.tabs, [request.section]: request.visible }, updatedAt: new Date().toISOString(), updatedBy: questionData.userId }
        sharingRequests.set(request.requestId, { request: JSON.stringify(request), revision: customerSharing.revision })
      }
      assert.equal(JSON.stringify({ state, projects }), before)
      json({ requestId: request.requestId, acknowledgedRevision: sharingRequests.get(request.requestId).revision, workspace: sharingWorkspace() }); return
    }
    writes.push(path.endsWith('/name') ? 'rename_project' : path.endsWith('/customer-choices') ? 'record_choice' : body.operation ?? body.action ?? `billing_${body.mode}`)
    if (path.endsWith('/manager')) {
      if (failSave) { failSave = false; json({ error: 'Tillfälligt sparfel.' }, 503); return }
      questionData.managerId = body.managerId; questionData.canManageParticipants = body.managerId === questionData.userId
      json(fakeManager()); return
    }
    if (dialogueId) {
      if (failSave) { failSave = false; json({ error: 'Tillfälligt sparfel. Dina uppgifter är kvar.' }, 503); return }
      const q = questionData.questions.find(q => q.id === dialogueId), d = q && getDialogue(q)
      if (!d) { json({ error: 'Saknas' }, 404); return }
      if (d.messages.some(m => m.id === body.requestId)) { json({ messageId: body.requestId, questionId: q.id }); return }
      if (body.operation !== 'reply' && body.version !== d.version) { json({ error: 'Ändrat i annan flik.' }, 409); return }
      if (body.operation === 'participants') {
        q.participants = body.participants.map(ref => q.participants.find(p => p.kind === ref.kind && p.personId === ref.id) || fakeMember(questionData.assignees.find(p => p.kind === ref.kind && p.id === ref.id)))
        d.participants = q.participants
      } else {
        if (body.operation === 'share') { d.snapshot = { title: q.body.title, description: q.body.description }; d.sharedAt = new Date().toISOString(); d.participants.forEach(p => p.shared = true) }
        d.messages.push({ id: body.requestId, participantId: d.viewerId, actorName: 'Anna Testledare', actorMethod: 'internal_login', operation: body.operation, text: body.text, snapshot: body.operation === 'share' ? d.snapshot : null, createdAt: new Date().toISOString(), files: [] })
      }
      d.version++; dialogues.set(q.id, d)
      json({ messageId: body.requestId, questionId: q.id }); return
    }
    if (path.endsWith('/questions')) {
      if (failSave) { failSave = false; json({ error: 'Tillfälligt sparfel. Din text är kvar.' }, 503); return }
      let request
      try { request = questionMutation(body) } catch { json({ error: 'Kontrollera frågan och datum inför utskick.' }, 400); return }
      const before = JSON.stringify(state)
      const prior = questionRequests.get(request.requestId)
      if (prior) { json(prior === JSON.stringify(request) ? { questionId: request.questionId } : { error: 'Gammalt försök.' }, prior === JSON.stringify(request) ? 200 : 409); return }
      let q = questionData.questions.find(q => q.id === request.questionId)
      if ((!q && request.operation !== 'create') || (q && q.revision !== request.revision)) { json({ error: 'Frågan har ändrats. Hämta sparad version.' }, 409); return }
      if (!q) { q = { id: request.questionId, number: questionData.questions.length + 1, revision: 0, updatedAt: '', body: emptyQuestion(), participants: [fakeMember(questionData.assignees[0])], events: [], tasks: [] }; questionData.questions.push(q) }
      if (q.body.status === 'closed' && request.operation !== 'reopen') { json({ error: 'Frågan är avslutad.' }, 409); return }
      if (request.body) {
        const assignee = request.body.assignee ? questionData.assignees.find(a => a.kind === request.body.assignee.kind && a.id === request.body.assignee.id) : null
        q.body = { ...request.body, assignee }
      }
      let taskId = null
      if (request.operation === 'send') {
        if (!q.body.assignee || q.tasks.some(t => !['approved','cancelled'].includes(t.status))) { json({ error: 'Välj ansvarig och avsluta tidigare aktiv uppgift.' }, 409); return }
        taskId = randomUUID(); q.tasks.push({ id: taskId, status: 'assigned', dueAt: request.dueAt, assigneeName: q.body.assignee.name, events: [], files: [] }); q.body.status = 'investigating'
      }
      if (request.operation === 'close') q.body.status = 'closed'
      if (request.operation === 'reopen') q.body.status = 'open'
      q.revision++; q.updatedAt = new Date().toISOString()
      if (request.operation === 'create') q.createdAt = q.updatedAt
      q.events.push({ id: request.requestId, operation: request.operation, actorName: 'Anna Testledare', createdAt: q.updatedAt, text: request.text, reportedBy: request.reportedBy, body: structuredClone(q.body), files: request.fileIds.flatMap(fid => projects.cases[0].attachments.filter(f => f.id === fid).map(f => ({ id: f.id, name: f.fileName }))), revision: q.revision, taskId })
      questionRequests.set(request.requestId, JSON.stringify(request))
      assert.equal(JSON.stringify(state), before, 'Question changes must never modify offer, agreement, choice or payment data')
      json({ questionId: q.id }); return
    }
    if (path.endsWith('/name')) {
      if (failSave) { failSave = false; json({ error: 'Tillfälligt sparfel. Din text är kvar.' }, 503); return }
      const project = projects.cases.find((c) => path === `/api/action-cases/${c.id}/name`)
      if (!project) { json({ error: 'Projektet saknas.' }, 404); return }
      const title = typeof body.title === 'string' ? body.title.trim() : ''
      if (!title || title.length > 250) { json({ error: 'Kontrollera namnet.' }, 400); return }
      if (project.title !== title && project.title !== body.expectedTitle) { json({ error: 'Projektnamnet har ändrats. Ladda om sidan.' }, 409); return }
      const evidence = JSON.stringify(state)
      project.title = title; project.updatedAt = new Date().toISOString()
      assert.equal(JSON.stringify(state), evidence, 'Name changes cannot modify offers, contracts, planning, pricing or locked PDFs')
      json({ project: { id: project.id, title, updatedAt: project.updatedAt } }); return
    }
    if (path.endsWith('/customer-choices')) {
      const shared = state.planning.sharedChoices
      if (!shared) { json({ error: 'Valen visas inte längre för beställaren.' }, 404); return }
      if (failSave) { failSave = false; json({ error: 'Tillfälligt sparfel. Valet är inte sparat.' }, 503); return }
      const category = shared.categories.find((c) => c.id === body.categoryId)
      if (!category || shared.versions[category.id] !== body.categoryVersion) { json({ error: 'Alternativen har ändrats. Uppdatera vyn.' }, 409); return }
      if (body.optionId !== null && !category.optionIds.includes(body.optionId)) { json({ error: 'Alternativet tillhör inte kategorin.' }, 400); return }
      const previous = choiceRecords.find((c) => c.categoryId === category.id)
      if ((previous?.revision ?? 0) !== body.revision) { json({ error: 'Valet har ändrats. Uppdatera vyn.' }, 409); return }
      const record = { categoryId: category.id, categoryVersion: body.categoryVersion, optionId: body.optionId, revision: (previous?.revision ?? 0) + 1, selectedAt: new Date().toISOString() }
      choiceRecords = [...choiceRecords.filter((c) => c.categoryId !== category.id), record]
      shared.choices = structuredClone(choiceRecords.filter((record) => shared.categories.some((c) => c.id === record.categoryId)))
      json(shared); return
    }
    if (path.endsWith('/contract-signing')) {
      const active = state.signingVersions.find((v) => !v.releasedAt)
      if (body.revision !== state.revision || body.confirmed !== true) { json({error:'Utkastet har ändrats.'},409); return }
      if (body.operation === 'freeze') {
        if (active) { json({error:'Avtalet är redan låst.'},409); return }
        const version={id:id(900 + state.signingVersions.length),version:state.signingVersions.length + 1,revision:state.revision,createdAt:new Date().toISOString(),releasedAt:null,
          snapshot:contractSnapshot(),files:[]}
        const pdf = await renderContractSigningPdf(version)
        version.fileSizeBytes=pdf.length; version.pdfSha256='TEST'
        if(contractWorkTest)version.signedCopyTask={id:id(998),status:'assigned'}
        signingPdfs.set(version.id,pdf); state.signingVersions.unshift(version)
      } else if (body.operation==='new_draft' && active?.id===body.id && !active.delivery?.signedCopy && (!contractWorkTest || body.unsignedConfirmed===true)) { active.releasedAt=new Date().toISOString(); state.revision++ }
      else if(body.operation==='share' && active?.id===body.id) {
        active.delivery??={sharedAt:null,withdrawnAt:null,participantId:null,signedCopy:null}
        active.delivery.sharedAt??=new Date().toISOString();active.delivery.withdrawnAt=null;active.delivery.participantId=body.participantId
        if(!customerSigningPdfs.has(active.id))customerSigningPdfs.set(active.id,await renderContractSigningPdf({...active,snapshot:{...active.snapshot,contractParties:publicContractParties(active.snapshot.contractParties)}}))
        json({...state,customerUrl:`http://127.0.0.1:${server.address().port}/atgardsarende/TEST-LANK`});return
      } else if(body.operation==='withdraw_share' && active?.id===body.id) { active.delivery.withdrawnAt=new Date().toISOString() }
      else { json({error:'Ogiltig åtgärd'},400); return }
      json(state); return
    }
    if (path.endsWith('/billing')) {
      if (failSave) { failSave = false; json({ error: 'Tillfälligt anslutningsfel. Dina ändringar är kvar.' }, 503); return }
      if (billingRequest?.id === body.requestId && billingRequest.key === JSON.stringify(body)) { json(billing); return }
      if (body.revision !== billing.revision) { json({ error: 'Fakturakopplingen har ändrats. Dina ändringar är kvar.' }, 409); return }
      let customer = registry.customers.find((row) => row.id === body.customerId)
      if (body.mode !== 'create' && (!customer || customer.version !== body.customerVersion)) { json({ error: 'Kundversionen har ändrats.' }, 409); return }
      if (body.mode === 'create') {
        customer = { ...body.customer, id: id(94 + registry.customers.length), customerNumber: String(1001 + registry.customers.length), isActive: true, version: 1, fortnoxCustomerNumber: null }
        registry.customers.push(customer)
      } else if (body.mode === 'update') Object.assign(customer, body.customer, { version: customer.version + 1 })
      billing = { ...billing, customerId: customer.id, revision: billing.revision + 1 }
      billingRequest = { id: body.requestId, key: JSON.stringify(body) }
      json(billing); return
    }
    if (path === '/api/action-cases') {
      if (failSave) { failSave = false; json({ error: 'Tillfälligt anslutningsfel. Försök igen.' }, 503); return }
      const payload = body.payload ?? {}
      if(contractWorkTest && projects.cases[0].items.find(item=>item.id===payload.itemId)?.contractWork?.locked){json({error:'Momentet ingår i ett låst avtal.'},409);return}
      let itemId, caseId
      if(contractWorkTest && body.action==='update_contract_work_price'){
        if(payload.revision!==state.revision){json({error:'Avtalet har ändrats.'},409);return}
        state.draft.contractPricing.rows.find(row=>row.sourceItemId===payload.itemId).amountOre=payload.price.amountOre
        state.draft.baseAmountOre=payload.price.amountOre;state.revision++;updateContractWorkView()
      } else if (process.argv.includes('--choice-files') && body.action === 'create_signed_upload') {
        json({ upload: { bucket: 'local-test-only', filePath: randomUUID(), token: 'local-test-only', contentType: 'application/pdf' } }); return
      } else if (process.argv.includes('--choice-files') && body.action === 'complete_upload') {
        const uploaded = choiceUploads.get(payload.filePath)
        if (!uploaded || uploaded.length !== payload.fileSize || payload.participantIds.length) { json({ error: 'Invalid test upload' }, 400); return }
        projects.cases[0].attachments.push({ id: randomUUID(), actionCaseItemId: null, type: 'document', title: payload.fileName, fileName: payload.fileName, contentType: 'application/pdf', fileSizeBytes: uploaded.length, grantedParticipantIds: [], createdAt: new Date().toISOString() })
      } else if (process.argv.includes('--choice-files') && body.action === 'abort_upload') {
        choiceUploads.delete(payload.filePath)
      } else if (process.argv.includes('--cost-table') && ['set_cost_line_complete','create_cost_line','update_cost_line','delete_cost_line'].includes(body.action)) {
        const evidence = JSON.stringify(state)
        const c = projects.cases.find(c => c.id === payload.caseId)
        const item = c?.items.find(i => i.id === payload.itemId)
        if (!item) { json({ error: 'Åtgärden saknas.' },404); return }
        const line = item.costLines.find(line => line.id === payload.costLineId)
        if (body.action === 'set_cost_line_complete') {
          const validated = costCompletionPayload(payload)
          if (validated.expectedUpdatedAt !== item.updatedAt) { json({error:'Åtgärden har ändrats. Öppna den igen.'},409); return }
          if (!line || line.pricingMethod === 'quotes' || line.selectedQuoteId || line.coveredByQuoteId || (validated.complete && (line.quantity === null || line.unitCost === null))) { json({error:'Kontrollera kalkylradens underlag.'},400); return }
          line.verified = validated.complete
        } else if (body.action === 'delete_cost_line') item.costLines = item.costLines.filter(row => row.id !== payload.costLineId)
        else {
          const normalized = normalizeCostLine(payload)
          if (body.action === 'update_cost_line') {
            if (!line) { json({error:'Raden saknas.'},404); return }
            Object.assign(line, normalized)
          } else item.costLines.push({ id: payload.costLineId ?? randomUUID(), ...normalized, pricingMethod: payload.pricingMethod ?? 'direct', selectedQuoteId: null, coveredByQuoteId: null, workPartId: null, quotes: [] })
        }
        const total = calculateActionCaseCostTotals(item.costLines)
        Object.assign(item,{estimatedCost:total.internalCost,customerPrice:total.customerPrice,updatedAt:new Date().toISOString(),status:item.costLines.length && item.costLines.every(line => line.verified) ? 'ready_for_quote':'pricing_needed'})
        assert.equal(JSON.stringify(state),evidence,'Cost edits cannot mutate contracts or customer choices')
      } else if (body.action === 'update_item' || body.action === 'save_item_scope') {
        const item = projects.cases.flatMap((c) => c.items).find((i) => i.id === payload.itemId)
        if (!item) { json({ error: 'Åtgärden saknas.' }, 404); return }
        if (payload.expectedUpdatedAt !== item.updatedAt) { json({ error: 'Åtgärden har ändrats i en annan session.' }, 409); return }
        if (payload.title !== undefined) item.title = payload.title
        if (payload.scope !== undefined) item.scope = payload.scope
        if (payload.scopeConditions !== undefined) item.scopeConditions = payload.scopeConditions
        if (payload.scopeExclusions !== undefined) item.scopeExclusions = payload.scopeExclusions
        if (payload.scopeAdvice !== undefined) item.scopeAdvice = payload.scopeAdvice
        if (payload.scopeAttachmentIds !== undefined) item.scopeAttachmentIds = payload.scopeAttachmentIds
        if (payload.lumpSum !== undefined) {
          item.lumpSum = normalizeLumpSum(payload.lumpSum)
          item.estimatedCost = item.lumpSum?.internalCost ?? null
          item.customerPrice = item.lumpSum?.customerPrice ?? null
          item.status = !item.scope?.trim() ? 'scope_needed' : item.lumpSum?.verified ? 'ready_for_quote' : 'pricing_needed'
        }
        item.updatedAt = new Date().toISOString()
        if(contractWorkTest){
          const row=state.draft.items.find(row=>row.sourceItemId===item.id)
          if(row){for(const key of ['title','scope','scopeConditions','scopeExclusions','scopeAdvice'])row[key]=item[key]??'';state.draft.contractPricing.rows.find(price=>price.sourceItemId===item.id).title=item.title;state.revision++;updateContractWorkView()}
        }
        if (body.action === 'save_item_scope') {
          if (item.lumpSum) item.lumpSum.verified = false
          const { costLines, costSuggestion, workParts, ...saved } = item
          json({ item: saved, caseStatus: 'pricing' }); return
        }
      } else if (body.action === 'delete_item') {
        const c = projects.cases.find((c) => c.id === payload.caseId)
        if (!c || !c.items.some((i) => i.id === payload.itemId)) { json({ error: 'Åtgärden saknas.' }, 404); return }
        if (state.draft.items.some((i) => i.id === payload.itemId) || state.offers.some((o) => o.snapshot.items.some((i) => i.id === payload.itemId))) {
          json({ error: 'Åtgärden finns i ett kundavtal eller offertutkast. Ta bort arbetsdelen ur oskickade utkast först. Skickade avtal bevaras.' }, 409); return
        }
        c.items = c.items.filter((i) => i.id !== payload.itemId)
      } else if (body.action === 'add_item') {
        const c = projects.cases.find((c) => c.id === payload.caseId)
        itemId = id(500 + writes.length)
        c.items.push({ ...structuredClone(projects.cases[0].items[0]), id: itemId, title: payload.title, scope: '', scopeConditions: '', scopeExclusions: '', scopeAdvice: '', costLines: [] })
      } else if (body.action === 'create_case') {
        caseId = id(600 + writes.length)
        projects.cases.unshift({ ...structuredClone(projects.cases[0]), id: caseId, ...payload, attachments: [], participants: [],
          items: payload.items.filter((title) => title.trim()).map((title, n) => ({ ...structuredClone(projects.cases[0].items[0]), id: id(700 + writes.length * 10 + n), title, scope: '', costLines: [] })) })
      } else { json({ error: 'Denna åtgärd är inte aktiverad i den fiktiva demonstrationen.' }, 400); return }
      json({ workspace: projects, itemId, caseId }); return
    }
    if (path.endsWith('/schedule')) {
      if (failSave) { failSave = false; json({ error: 'Tillfälligt anslutningsfel. Försök igen.' }, 503); return }
      if (body.revision !== schedule.revision) { json({ error: 'Tidsplanen har ändrats i en annan session.' }, 409); return }
      try {
        if (body.operation === 'save') schedule.rows = normalizeScheduleRows(body.rows)
        else if (body.operation === 'share' && body.confirmed) schedule.sharedRows = normalizeScheduleRows(schedule.rows, true)
        else if (body.operation === 'unshare') schedule.sharedRows = []
        else throw new Error('Ogiltig åtgärd')
        schedule.revision++; json(schedule)
      } catch (e) { json({ error: e.message }, 400) }
      return
    }
    if (path.includes('/public/')) {
      if (body.operation === 'challenge') {
        challenge = { selection: body.selection, signerName: body.signerName }
        json({ challengeId: id(30) })
        return
      }
      if (body.operation === 'accept') {
        if (body.code !== '123456') {
          json(
            {
              error: 'Koden stämmer inte. Kontrollera mejlet och försök igen.'
            },
            400
          )
          return
        }
        const offer = state.offers[0]
        offer.status = 'accepted'
        offer.acceptedBy = challenge.signerName
        offer.acceptedOptionIds = challenge.selection
        offer.acceptedTotalOre = customerOfferTotal(
          offer.snapshot,
          challenge.selection
        )
        offer.acceptedAt = '2026-09-29T12:34:00Z'
        json({ accepted: true, offer })
        return
      }
    } else if (path.endsWith('/customer-planning')) {
      if (body.revision !== state.planning.revision) { json({ error: 'Planeringen har ändrats. Uppdatera vyn.' }, 409); return }
      try {
        if (body.operation === 'save') {
          if (failSave) { failSave = false; json({ error: 'Tillfälligt anslutningsfel. Försök igen.' }, 503); return }
          state.planning.items = normalizePlannedItems(body.items)
          state.planning.costing = normalizeCustomerChoiceCosting(body.costing, state.planning.items)
          state.planning.items = synchronizeChoiceOffers(synchronizeChoicePrices(state.planning.items, state.planning.costing), state.planning.costing)
          state.planning.categories = normalizeChoiceCategories(body.categories ?? legacyChoiceCategories(state.planning.items), state.planning.items)
          state.planning.categoriesStored = true
          if (state.planning.filesAvailable) state.planning.optionFiles = normalizeChoiceFileRefs(body.optionFiles ?? [], state.planning.items)
        }
        else if (body.operation === 'share') {
          if (!body.confirmed || JSON.stringify(body.items) !== JSON.stringify(state.planning.items)) throw new Error('Bekräfta den sparade planeringen.')
          state.planning.sharedItems = normalizePlannedItems(body.items, true)
          if (body.categories) { state.planning.categories = normalizeChoiceCategories(body.categories, state.planning.items, true); publishChoiceCategories() }
        } else if (body.operation === 'unshare') { state.planning.sharedItems = []; state.planning.sharedFileRefs = []; delete state.planning.sharedChoices; choiceRevision++ }
        else throw new Error('Okänd åtgärd')
        state.planning.revision++
        json(state.planning)
      } catch (error) { json({ error: error.message }, 400) }
      return
    } else if (path.endsWith('/customer-offers')) {
      if (independentContract && body.draftTarget === 'offer') {
        if (!['save', 'autosave'].includes(body.operation)) { json({ error: 'Invalid operation' }, 400); return }
        if (body.revision !== estimateState.revision) { json({ error: 'Offerten har ändrats.' }, 409); return }
        try {
          estimateState.draft = normalizeCustomerOffer(body.draft)
          estimateState.costing = normalizeCustomerOfferCosting(body.costing, estimateState.draft.items)
          estimateState.revision++
          json({ ...state, ...estimateState, offerDraft: undefined })
        } catch (error) { json({ error: error.message }, 400) }
        return
      }
      if (body.operation === 'prepare_standard_terms') {
        if (process.argv.includes('--slow-standard-terms')) await new Promise((resolve) => setTimeout(resolve, 2500))
        if (failSave) { failSave = false; json({ error: 'Standardvillkoren kunde inte förberedas. Försök igen.' }, 503); return }
        state.standardTermsFile = { id: id(140), fileName: ABS18_TERMS.fileName, contentType: 'application/pdf', fileSizeBytes: ABS18_TERMS.size }
        json({ file: state.standardTermsFile }); return
      } else if (body.operation === 'save' || body.operation === 'autosave') {
        if (state.signingVersions?.some((v) => !v.releasedAt)) { json({error:'Versionen är låst för signering.'},409); return }
        if (failSave) {
          failSave = false
          json({ error: 'Tillfälligt anslutningsfel. Försök igen.' }, 503)
          return
        }
        if (body.revision !== state.revision) {
          json({ error: 'Offerten har ändrats. Uppdatera vyn.' }, 409)
          return
        }
        let normalized
        try { normalized = normalizeCustomerOffer(body.draft) }
        catch { json({ error: 'Utkastet innehåller en ogiltig uppgift. Dina ändringar är kvar.' }, 400); return }
        state.draft = normalized
        if (state.standardTermsFile) state.draft = normalizeCustomerOffer(withStandardContractTerms(state.draft, state.standardTermsFile))
        if (propertyRegistryTest && state.draft.contractDetails?.property && !state.draft.contractDetails.property.sourcePropertyId) state.propertyLink.property = null
        state.costing = normalizeCustomerOfferCosting(body.costing, state.draft.items)
        state.revision++
        if (body.operation === 'save') syncTestRecipient()
      } else if (propertyRegistryTest && body.operation === 'bind_property') {
        if (body.binding.requestId === propertyRequestId) { json(state); return }
        if (failSave) { failSave = false; json({ error: 'Tillfälligt anslutningsfel. Dina ändringar är kvar.' }, 503); return }
        if (body.revision !== state.revision) { json({ error: 'Utkastet har ändrats.' }, 409); return }
        const input = normalizePropertyDetails(body.binding.property)
        let property = properties.find((row) => row.id === body.binding.propertyId)
        if (body.binding.mode === 'create') {
          if (properties.some((row) => propertyIdentityKey(row) === propertyIdentityKey(input))) { json({ error: 'Fastigheten finns redan i HusHub. Välj den från fastighetslistan.' }, 409); return }
          property = { ...input, id: id(110 + properties.length), name: input.cadastralDesignation }
          properties.push(property)
        }
        if (!property) { json({ error: 'Fastigheten saknas.' }, 404); return }
        state.draft = normalizeCustomerOffer(body.draft)
        state.draft.contractDetails = editContractProperty(state.draft.contractDetails, property)
        state.draft.contractDetails.property = { ...normalizePropertyDetails(property), sourcePropertyId: property.id }
        state.propertyLink.property = property
        state.revision++
        propertyRequestId = body.binding.requestId
        projects.cases[0].propertyId = property.id
        projects.cases[0].propertyAddress = property.street
      } else if (customerRegistryTest && body.operation === 'bind_customer') {
        if (body.requestId === customerRequestId) { json(state); return }
        if (failSave) { failSave = false; json({ error: 'Tillfälligt anslutningsfel. Försök igen.' }, 503); return }
        if (body.revision !== state.revision) { json({ error: 'Utkastet har ändrats.' }, 409); return }
        const draft = normalizeCustomerOffer(body.draft)
        const costing = normalizeCustomerOfferCosting(body.costing, draft.items)
        let customer = registry.customers.find((row) => row.id === body.binding.customerId && row.isActive && row.customerType === 'private')
        if (body.binding.mode === 'create') {
          const parties = draft.contractParties
          customer = { id: id(100 + registry.customers.length), orgId: id(90), customerNumber: String(1001 + registry.customers.length), customerType: 'private',
            name: parties.customers[0].name, identityNumber: parties.customers[0].personalNumber, email: parties.email, phone: parties.mobile || parties.phone,
            address: parties.street, postalCode: parties.postalCode, city: parties.city, isActive: true, version: 1 }
          registry.customers.push(customer)
        } else if (!customer || customer.version !== body.binding.customerVersion) { json({ error: 'Kunden har ändrats. Uppdatera kundlistan.' }, 409); return }
        draft.contractParties = copyRegistryCustomer(draft.contractParties, customer)
        state.draft = draft
        state.costing = costing
        state.revision++
        state.customerLink.customerId = customer.id
        state.customerLink.customerNumber = customer.customerNumber
        customerRequestId = body.requestId
        syncTestRecipient(true)
      } else if (body.operation === 'separate_choices') {
        if (state.offers.some((o) => o.status === 'published' || o.status === 'accepted')) { json({ error: 'Återkalla den öppna versionen först.' }, 409); return }
        if (body.revision !== state.revision || body.planningRevision !== state.planning.revision) { json({ error: 'Uppgifterna har ändrats.' }, 409); return }
        separateChoices()
        state.revision++
        state.planning.revision++
      } else if (body.operation === 'publish') {
        if (state.draft.items.some((i) => i.kind === 'option')) { json({ error: 'Flytta valen först.' }, 409); return }
        if (offerPublishIssues(state.draft).length) { json({ error: 'Komplettera utkastet före utskick.' }, 400); return }
        state.offers = [published(state.draft)]
      }
      else if (body.operation === 'withdraw')
        state.offers[0].status = 'withdrawn'
      else if (body.operation !== 'send') {
        json({ error: 'Unexpected operation' }, 400)
        return
      }
      json(state)
      return
    }
    json({ error: 'Unexpected write' }, 400)
    return
  }
  if (path === '/fixture' || path.endsWith('/customer-offers')) {
    const externalContracts=state.signingVersions?.filter((v)=>v.delivery?.sharedAt&&!v.delivery.withdrawnAt).map((v)=>({
      document:mapCustomerOffer({id:v.id,version:v.version,status:'published',snapshot:v.snapshot,files:v.files,published_at:v.delivery.sharedAt}),
      createdAt:v.createdAt,releasedAt:v.releasedAt,sharedAt:v.delivery.sharedAt,signedCopyRegisteredAt:v.delivery.signedCopy?.registeredAt??null}))
    json(independentContract && new URL(req.url, 'http://localhost').searchParams.get('draftTarget') === 'offer'
      ? { ...state, ...estimateState, offerDraft: undefined } : {...state,externalContracts})
    return
  }
  if (process.argv.includes('--choice-offers') && /\/customer-planning\/[^/]+\/pdf$/.test(path)) {
    const option = state.planning.items.find(item => path.endsWith(`/${item.id}/pdf`))
    if (!option || Number(new URL(req.url, 'http://localhost').searchParams.get('revision')) !== state.planning.revision) { json({ error: 'Underlaget har ändrats.' }, 409); return }
    const category = state.planning.categories.find(c => c.optionIds.includes(option.id))
    const bytes = await renderChoiceOfferPdf({ item: option, category: category?.title ?? '', specification: category?.specification ?? '', propertyAddress: 'Testgatan 1', issuer: 'Exempelbygg AB', reference: `TEST-v${state.planning.revision}`, date: '2026-10-22', files: [] })
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="Fiktivt-tillval.pdf"' }); res.end(bytes); return
  }
  if (path.endsWith('/customer-planning')) { json(state.planning); return }
  if (path === '/abs18-2018-06.pdf' || path.endsWith(`/attachments/${id(140)}`) || (process.argv.includes('--choice-files') && path.endsWith(`/attachments/${id(4)}`))) {
    res.setHeader('Content-Type', 'application/pdf')
    res.end(await readFile(ABS18_TERMS.assetPath)); return
  }
  if (path.startsWith('/api/')) {
    res.setHeader('Content-Type', 'image/png')
    res.end(img)
    return
  }
  if (path === '/view.js') {
    res.setHeader('Content-Type', 'application/javascript')
    res.end(js)
    return
  }
  if (
    [
      '/uppdrag/brand/logo.svg',
      '/uppdrag/brand/symbol.svg',
      '/uppdrag/brand/manrope.ttf'
    ].includes(path)
  ) {
    res.setHeader(
      'Content-Type',
      path.endsWith('ttf') ? 'font/ttf' : 'image/svg+xml'
    )
    res.end(await readFile(resolve('public', path.slice(1))))
    return
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(
    `<!doctype html><html lang="sv"><head><title>Gizmo kundvy - testprojekt</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${base}${theme}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`
  )
})
await new Promise((done) =>
  server.listen(Number(process.env.PREVIEW_PORT) || 0, '127.0.0.1', done)
)
const origin = `http://127.0.0.1:${server.address().port}`
if (process.argv.includes('--serve'))
  console.log(
    `Synthetic customer preview: ${origin}/kund ; editor: ${origin}/intern ; projects: ${origin}/uppdrag ; test email code: 123456`
  )
else {
  const browser = await puppeteer.launch({
    executablePath:
      process.env.CHROME_PATH ??
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true
  })
  try {
    const page = await browser.newPage(),
      errors = [],
      external = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      if (
        new URL(req.url()).origin === origin ||
        req.url().startsWith('data:image/')
      )
        req.continue()
      else {
        external.push(req.url())
        req.abort()
      }
    })
    const click = async (text) =>
      page.locator(`::-p-xpath(//button[normalize-space(.)="${text}"])`).click()
    const fill = async (text, value) =>
      page
        .locator(
          `::-p-xpath(//label[contains(.,"${text}")]//input[not(@type="checkbox")] | //label[contains(.,"${text}")]//textarea)`
        )
        .fill(value)
    async function layout(label) {
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1
        ),
        false,
        `${label}: overflow`
      )
      assert.deepEqual(errors, [], label)
    }
    await page.setViewport({ width: 1440, height: 980 })
    await page.goto(origin + '/intern', { waitUntil: 'networkidle0' })
    await page.waitForSelector('h1')
    await layout('editor')
    assert.ok(
      !(await page.evaluate(() =>
        document.body.textContent.includes('Privat UE-offert')
      ))
    )
    // Private worksheet is saved separately; using a calculated price is explicit.
    await click('Val och tillval')
    await page.locator('section[aria-label="Val och tillval"] .gizmo-editor-row-toggle').click()
    await page.locator('::-p-xpath(//summary[contains(.,"Intern priskalkyl")])').click()
    await fill('Inköpspris exkl. moms (kr) *', '10000')
    await fill('Påslag på inköpspriset (%, valfritt)', '10')
    await fill('Fast påslag exkl. moms (kr, valfritt)', '1000')
    await click('Lägg till tillägg')
    await fill('Tillägg 1 *', 'Montage')
    assert.equal(await page.$('::-p-xpath(//button[normalize-space(.)="Använd kundpris"])'), null)
    await fill('Belopp tillägg 1 (kr) *', '2000')
    await page.keyboard.press('Tab')
    assert.equal(await page.$eval('[aria-label="Prisunderlag inkl. moms (kr, valfritt)"]', (el) => el.value), '185000')
    for (const width of [1440, 390]) {
      await page.setViewport({ width, height: 980 })
      await page.$eval('fieldset details', (el) => el.scrollIntoView({ block: 'start' }))
      await layout(`${width} private calculation`)
      await page.screenshot({ path: resolve(output, `${width}-cost-calculator.png`), fullPage: false })
    }
    await page.setViewport({ width: 1440, height: 980 })
    await click('Använd kundpris')
    assert.equal(await page.$eval('[aria-label="Prisunderlag inkl. moms (kr, valfritt)"]', (el) => el.value), '17500')
    failSave = true
    await click('Spara planering')
    await page.waitForFunction(() => document.body.textContent.includes('Tillfälligt anslutningsfel'))
    assert.equal(state.planning.costing[id(11)], undefined)
    await click('Spara planering')
    await page.waitForFunction(() => document.querySelector('main [role="status"]')?.textContent === 'Sparat')
    assert.equal(state.planning.costing[id(11)].purchaseOre, 1000000)
    await page.reload({ waitUntil: 'networkidle0' })
    await click('Val och tillval')
    await page.locator('section[aria-label="Val och tillval"] .gizmo-editor-row-toggle').click()
    await page.locator('::-p-xpath(//summary[contains(.,"Intern priskalkyl")])').click()
    assert.equal(await page.$eval('[aria-label="Inköpspris exkl. moms (kr) *"]', (el) => el.value), '10000')
    assert.equal(await page.$eval('[aria-label="Prisunderlag inkl. moms (kr, valfritt)"]', (el) => el.value), '17500')
    // Existing manual prices remain editable even when a private worksheet exists.
    await fill('Prisunderlag inkl. moms (kr, valfritt)', '185000')
    await page.keyboard.press('Tab')
    await click('Spara planering')
    await page.waitForFunction(() => document.querySelector('main [role="status"]')?.textContent === 'Sparat')
    await click('Grundavtal')
    await page.locator('::-p-xpath(//button[starts-with(normalize-space(.),"Priset")])').click()
    // Decimal input, save failure preserves draft, then retry.
    const price = await page.$('[aria-label="Grundpris inkl. moms (kr) *"]')
    await price.click({ clickCount: 3 })
    await price.type('1250000,50')
    await page.keyboard.press('Tab')
    assert.equal(await price.evaluate((el) => el.value), '1250000,50')
    failSave = true
    await click('Spara utkast')
    await page.waitForFunction(() =>
      document.body.textContent.includes('Tillfälligt anslutningsfel')
    )
    assert.equal(await price.evaluate((el) => el.value), '1250000,50')
    await click('Spara utkast')
    await page.waitForFunction(() =>
      document.body.textContent.includes('Offertutkastet sparades')
    )
    assert.equal(state.draft.baseAmountOre, 125000050)
    await page.screenshot({
      path: resolve(output, 'desktop-editor.png'),
      fullPage: true
    })
    const previewWrites = writes.length
    await page.locator('::-p-xpath(//button[contains(.,"Offertuppgifter")])').click()
    await fill('Rubrik *', 'Tillbyggnad - osparad komplettering')
    await page
      .locator(
        '::-p-xpath(//aside//button[normalize-space(.)="Granska offertutkast"])'
      )
      .click()
    await page.waitForSelector('article[aria-label="Kundoffert"]')
    assert.equal(
      await page.$eval('h1', (el) => {
        const r = el.getBoundingClientRect()
        return (
          r.top >= 0 &&
          r.bottom <= innerHeight &&
          document.activeElement === el
        )
      }),
      true,
      'Preview from the bottom opens at the heading with keyboard focus'
    )
    await layout('draft preview')
    await page.screenshot({
      path: resolve(output, 'desktop-offer.png'),
      fullPage: true
    })
    await click('Tillbaka till redigering')
    await page.waitForSelector('fieldset')
    assert.equal(
      await page.$eval(
        'h1',
        (el) => document.activeElement === el && el.getBoundingClientRect().top >= 0
      ),
      true,
      'Return from the document restores focus at the editor heading'
    )
    assert.equal(
      await page.$eval('fieldset input', (el) => el.value),
      'Tillbyggnad - osparad komplettering',
      'Preview navigation preserves unsaved text'
    )
    await page.locator('::-p-xpath(//button[starts-with(normalize-space(.),"Priset")])').click()
    assert.equal(
      await page.$eval('[aria-label="Grundpris inkl. moms (kr) *"]', (el) => el.value),
      '1250000,50'
    )
    assert.equal(writes.length, previewWrites, 'Preview does not save or publish')
    await click('Spara utkast')
    await page.waitForFunction(
      () => document.querySelector('main [role="status"]')?.textContent === 'Sparat'
    )
    await page
      .locator(
        '::-p-xpath(//label[contains(. ,"Jag har granskat kundofferten")]//input)'
      )
      .click()
    await click('Skicka offert')
    await page.waitForFunction(() =>
      document.body.textContent.includes('Offerten har skickats')
    )
    assert.equal(writes.filter((op) => op === 'publish').length, 1)
    const customerPreviewWrites = writes.length
    await click('Visa som beställare')
    assert.match(await page.evaluate(() => document.body.textContent), /Förhandsgranskning som beställare/)
    assert.equal(writes.length, customerPreviewWrites, 'Viewing as customer does not save or send')
    await page.waitForFunction(() =>
      document.body.textContent.includes('Grundavtalets pris')
    )
    await layout('customer preview')
    assert.equal(
      await page.evaluate(() =>
        document.body.textContent.includes('Skicka kod till min e-post')
      ),
      false
    )
    for (const width of [1440, 1024, 390, 344]) {
      await page.setViewport({ width, height: 900 })
      await page.goto(origin + '/kund', { waitUntil: 'networkidle0' })
      assert.doesNotMatch(await page.evaluate(() => document.body.textContent), /Förhandsgranskning som beställare/)
      await layout(`${width} overview`)
      const primary = await page.$('button.text-white')
      assert.equal(
        await primary.evaluate((el) => getComputedStyle(el).backgroundColor),
        'rgb(37, 42, 45)',
        'Visible primary action background'
      )
      assert.equal(
        await primary.evaluate((el) => getComputedStyle(el).color),
        'rgb(255, 255, 255)',
        'Visible primary action label'
      )
      for (const word of ['marginal', 'inköpspriser', 'ue-hemlig', 'Intern priskalkyl', 'Påslag på inköpspriset'])
        assert.equal(
          await page.evaluate(
            (t) => document.body.textContent.includes(t),
            word
          ),
          false
        )
      await page.screenshot({
        path: resolve(output, `${width}-overview.png`),
        fullPage: true
      })
        await layout(`${width} offer`)
      await page.screenshot({
        path: resolve(output, `${width}-offer.png`),
        fullPage: true
      })
      await page
        .locator('::-p-xpath(//button[contains(.,"Bilder och filer")])')
        .click()
      await page.waitForFunction(() =>
        [...document.querySelectorAll('main img')].every(
          (img) => img.complete && img.naturalWidth > 0
        )
      )
      await layout(`${width} files`)
      await page.screenshot({
        path: resolve(output, `${width}-files.png`),
        fullPage: true
      })
      await page.goto(origin + '/intern', { waitUntil: 'networkidle0' })
      await layout(`${width} editor`)
      await page.screenshot({
        path: resolve(output, `${width}-editor.png`),
        fullPage: true
      })
    }
    await page.setViewport({ width: 1440, height: 980 })
    await page.goto(origin + '/kund', { waitUntil: 'networkidle0' })
    assert.equal(await page.$('input[type="radio"]'), null, 'No choices during main agreement signing')
    await fill('Ditt fullständiga namn', 'Anna Exempel')
    await page
      .locator('::-p-xpath(//label[contains(.,"Jag är beställaren")]//input)')
      .click()
    await click('Skicka kod till min e-post')
    await page.waitForFunction(() =>
      document.body.textContent.includes('sexsiffriga koden')
    )
    await fill('E-postkod', '000000')
    await click('Bekräfta godkännandet')
    await page.waitForFunction(() =>
      document.body.textContent.includes('Koden stämmer inte')
    )
    await fill('E-postkod', '123456')
    await click('Bekräfta godkännandet')
    await page.waitForFunction(() =>
      document.body.textContent.includes('Godkänt av Anna Exempel')
    )
    assert.equal(state.offers[0].acceptedTotalOre, 125000050)
    assert.match(
      await page.evaluate(() => document.body.textContent),
      /2026-09-29 14:34/
    )
    await page.screenshot({
      path: resolve(output, 'accepted.png'),
      fullPage: true
    })
    await page.reload({ waitUntil: 'networkidle0' })
    assert.match(
      await page.evaluate(() => document.body.textContent),
      /Godkänt avtal/
    )
    await page.goto(origin + '/intern', { waitUntil: 'networkidle0' })
    assert.equal(await page.$eval('fieldset', (el) => el.disabled), true)
    await page.goto(origin + '/intern?empty', { waitUntil: 'networkidle0' })
    await click('Granska grundavtal')
    await layout('empty preview')
    state.offers = [published(state.draft)]
    await page.goto(origin + '/intern?no-email', { waitUntil: 'networkidle0' })
    await page.locator('aside summary').click()
    assert.match(
      await page.$eval('aside', (el) => el.textContent),
      /Ange beställarens e-postadress i uppdraget\./
    )
    await page
      .locator(
        '::-p-xpath(//label[contains(.,"Jag har granskat kundofferten")]//input)'
      )
      .click()
    assert.equal(
      await page.$eval('aside button.bg-slate-950', (el) => el.disabled),
      true,
      'Missing recipient still blocks publication after confirmation'
    )
    await page.goto(origin + '/kund?expired', { waitUntil: 'networkidle0' })
    assert.equal(
      await page.evaluate(() =>
        document.body.textContent.includes('Skicka kod till min e-post')
      ),
      false
    )
    await page.keyboard.press('Tab')
    await layout('expired/keyboard')
    assert.deepEqual(errors, [])
    assert.deepEqual(external, [])
    console.log(
      'PASS real component click flow: edit, decimal prices, failed save/retry, preview scroll/focus, unsaved text preserved, missing recipient, send base only, code error/retry, server receipt, reload/locked, empty/expired, files; four viewport widths; no external traffic'
    )
  } finally {
    await browser.close()
    await new Promise((done) => server.close(done))
  }
}
