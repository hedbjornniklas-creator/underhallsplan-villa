// Read-only release checks. Receipts contain hashes and counts, never project bodies or credentials.
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const mode = process.argv[2], output = process.argv[3]
if (!['before', 'after'].includes(mode) || !output) throw Error('Usage: before|after RECEIPT_DIRECTORY')
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const caseId = '6bad434d-d5be-40c9-a663-eefcf57a199c'
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
async function checked(request) { const r = await request; if (r.error) throw Error(r.error.code || 'READ_FAILED'); return r.data }
const protectedState = {}
for (const table of ['action_cases', 'action_case_items', 'action_case_cost_lines', 'action_case_customer_contract_drafts', 'action_case_contract_signing_documents', 'action_case_diary_entries']) {
  let request = db.from(table).select('*').eq(table === 'action_cases' ? 'id' : 'action_case_id', caseId)
  const data = await checked(request)
  if (data.length >= 1000) throw Error('PAGINATION_REQUIRED')
  protectedState[table] = { rows: data.length, sha256: hash(data.sort((a, b) => JSON.stringify(canonical(a)).localeCompare(JSON.stringify(canonical(b))))) }
}
const questions = await checked(db.from('action_case_questions').select('id,body,revision').eq('action_case_id', caseId).eq('number', 12))
if (questions.length !== 1) throw Error('QUESTION_NOT_UNIQUE')
const q = questions[0]
protectedState.question = { revision: q.revision, sha256: hash(q.body) }
const deliveries = await checked(db.from('action_case_question_deliveries').select('id,status').in('message_id', (await checked(db.from('action_case_question_messages').select('id').eq('question_id', q.id))).map(m => m.id)))
const receipt = { at: new Date().toISOString(), protectedState, questionDeliveries: deliveries.length }
if (mode === 'after') {
  const before = JSON.parse(await readFile(resolve(output, 'before.json'), 'utf8'))
  if (JSON.stringify(before.protectedState) !== JSON.stringify(receipt.protectedState)) throw Error('PROTECTED_STATE_CHANGED')
  if (receipt.questionDeliveries !== before.questionDeliveries) throw Error('UNEXPECTED_DELIVERY')
  const contacts = await checked(db.from('organization_contacts').select('id,recipient_identity_id').eq('email', 'nail@styr.nu').eq('is_active', true))
  let visible = false
  for (const c of contacts) {
    if (!c.recipient_identity_id) continue
    const identity = await checked(db.from('task_recipient_identities').select('auth_user_id').eq('id', c.recipient_identity_id).maybeSingle())
    if (!identity?.auth_user_id) continue
    const rows = await checked(db.rpc('resolve_recipient_question_scope', { p_auth_user_id: identity.auth_user_id, p_question_id: q.id }))
    if (rows.some(row => row.question_id === q.id && row.contact_id === c.id)) visible = true
  }
  receipt.nailQuestionVisible = visible
  if (!visible) throw Error('NAIL_QUESTION_SCOPE_MISSING')
}
await mkdir(output, { recursive: true })
await writeFile(resolve(output, `${mode}.json`), JSON.stringify(receipt, null, 2))
console.log(JSON.stringify({ mode, protectedTables: Object.keys(protectedState).length, questionDeliveries: receipt.questionDeliveries, nailQuestionVisible: receipt.nailQuestionVisible, unchanged: mode === 'after' ? true : undefined }))
