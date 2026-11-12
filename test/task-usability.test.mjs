import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import postcss from 'postcss'
import * as drafts from '../src/lib/tasks/recipientDraft.ts'
import * as dates from '../src/lib/tasks/dateTime.ts'
import * as estimates from '../src/lib/tasks/timeEstimate.ts'
const require = createRequire(import.meta.url)
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
function load(path, deps = {}, extra = '') {
  const loaded = { exports: {} }
  const code = ts.transpileModule(read(path) + extra, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  new Function('require', 'module', 'exports', code)(name => deps[name] ?? (['react', 'react/jsx-runtime', 'lucide-react'].includes(name) ? require(name) : {}), loaded, loaded.exports)
  return loaded.exports
}
const storage = () => { const data = new Map(); return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) } }

test('private draft keys accept only non-secret server scopes, never names or bearer URLs', () => {
  assert.equal(drafts.recipientDraftKey('a'.repeat(64)), `hushub:task-recipient-draft:v1:${'a'.repeat(64)}`)
  for (const scope of ['Anna Exempel', '/api/signe/secret-token', '', 'a'.repeat(63)]) assert.equal(drafts.recipientDraftKey(scope), null)
  assert.notEqual(drafts.recipientDraftKey('a'.repeat(64)), drafts.recipientDraftKey('b'.repeat(64)))
})
test('drafts restore both fields, stay isolated, and successful submission clears only its own field', () => {
  const s = storage(), a = drafts.recipientDraftKey('a'.repeat(64)), b = drafts.recipientDraftKey('b'.repeat(64))
  drafts.writeRecipientDraft(s, a, { comment: 'Oskickat svar', evidenceText: 'Oskickat underlag' }, 100)
  assert.deepEqual(drafts.readRecipientDraft(s, a, 101), { comment: 'Oskickat svar', evidenceText: 'Oskickat underlag' })
  assert.deepEqual(drafts.readRecipientDraft(s, b, 101), drafts.EMPTY_RECIPIENT_DRAFT)
  drafts.writeRecipientDraft(s, a, { comment: '', evidenceText: 'Oskickat underlag' }, 102)
  assert.equal(drafts.readRecipientDraft(s, a, 103).evidenceText, 'Oskickat underlag')
  drafts.writeRecipientDraft(s, a, drafts.EMPTY_RECIPIENT_DRAFT)
  assert.equal(s.getItem(a), null)
})
test('expired, corrupt, oversized and future drafts are discarded, not restored across sessions', () => {
  const s = storage(), key = 'key'
  for (const raw of ['{broken', 'null', JSON.stringify({ schema: 2 }), JSON.stringify({ schema: 1, updatedAt: 101, comment: '', evidenceText: '' }), JSON.stringify({ schema: 1, updatedAt: 1, comment: 'x'.repeat(100001), evidenceText: '' })]) {
    s.setItem(key, raw)
    assert.deepEqual(drafts.readRecipientDraft(s, key, 100), drafts.EMPTY_RECIPIENT_DRAFT)
    assert.equal(s.getItem(key), null)
  }
  drafts.writeRecipientDraft(s, key, { comment: 'old', evidenceText: '' }, 100)
  assert.equal(drafts.readRecipientDraft(s, key, 101 + drafts.RECIPIENT_DRAFT_TTL_MS).comment, '')
  assert.equal(s.getItem(key), null)
})
test('storage failures are surfaced to the hook, not treated as successful persistence', () => {
  const s = { getItem() { throw Error('blocked') }, setItem() { throw Error('full') }, removeItem() { throw Error('blocked') } }
  assert.throws(() => drafts.readRecipientDraft(s, 'key'), /blocked/)
  assert.throws(() => drafts.writeRecipientDraft(s, 'key', { comment: 'text', evidenceText: '' }), /full/)
  const hook = read('src/components/tasks/useTaskRecipientDraft.ts')
  assert.match(hook, /sessionStorage/); assert.doesNotMatch(hook, /fetch\(|localStorage/)
  assert.match(hook, /beforeunload/); assert.match(hook, /setStorageAvailable\(false\)/)
})
test('closed tasks never render an active deadline meter and never invent a completion date', () => {
  const Component = load('src/components/tasks/TaskTimeProgress.tsx', { '@/lib/tasks/dateTime': dates }).default
  for (const status of ['approved', 'cancelled']) {
    const html = renderToStaticMarkup(createElement(Component, { status, startedAt: '2026-01-01T10:00:00Z', dueAt: '2026-02-01T10:00:00Z' }))
    assert.doesNotMatch(html, /progressbar|försenad|Sluttiden är nu|Avslutat \d/)
    assert.match(html, status === 'approved' ? /Godkänd och klar/ : /avbrutet/)
  }
  assert.match(renderToStaticMarkup(createElement(Component, { status: 'approved', startedAt: '', dueAt: '', completedAt: '2026-11-06T10:00:00Z' })), /Avslutat 6 november/)
})
test('active and closed filters partition statuses without changing my-ball and review rules', () => {
  const { taskMatchesFilter } = load('src/components/tasks/TaskDashboardClient.tsx', { '@/lib/tasks/timeEstimate': estimates }, '\nexport { taskMatchesFilter };')
  for (const status of ['draft', 'assigned', 'in_progress', 'waiting', 'ready_for_review', 'returned', 'approved', 'cancelled']) {
    const task = { status, issuerId: 'issuer', assignee: { id: 'recipient', kind: 'profile' }, ballHolder: 'assignee', deadlineRequests: [], unreadMessageCount: 0 }
    assert.equal(taskMatchesFilter(task, 'active', 'issuer'), !['approved', 'cancelled'].includes(status))
    assert.equal(taskMatchesFilter(task, 'closed', 'issuer'), ['approved', 'cancelled'].includes(status))
    assert.equal(taskMatchesFilter(task, 'all', 'issuer'), true)
  }
  const source = read('src/components/tasks/TaskDashboardClient.tsx')
  assert.match(source, /selectTaskFilter\('active'\)/)
  assert.match(source, /aria-label="Sök uppgifter"/)
  assert.match(source, /Fler filter/)
  assert.match(source, /'all', 'active', 'closed', 'my_ball'/)
})
test('mail stays escaped, preserves personal URLs and Outlook fallback, and uses the Gizmo palette', () => {
  const email = load('src/lib/tasks/emailTemplates.ts')
  const html = email.buildTaskEmailHtml({ previewText: 'Test', eyebrow: 'Nytt uppdrag', heading: 'Fiktivt uppdrag', taskTitle: 'Fiktivt uppdrag', recipientName: '<script>', lead: 'Anna Exempel', contextLabel: 'Projekt A & B', dueLabel: '13 november', actionUrl: 'https://hushub.se/signe/test?x=1&y=2' })
  assert.match(html, /Projekt A &amp; B/); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/)
  assert.match(html, /v:roundrect/); assert.match(html, /fillcolor="#252A2D"/); assert.match(html, /#F2D76A/)
  assert.match(html, /signe\/test\?x=1&amp;y=2/)
  assert.doesNotMatch(html, /&#10003;|#b45309|letter-spacing:-|letter-spacing:\./)
  assert.doesNotMatch(html, />Uppdrag<\/td>/, 'The main title is not repeated in the details')
  const digest = email.buildTaskReminderDigestEmailHtml({ previewText: 'Test', recipientName: 'Anna', heading: 'Att följa upp', lead: 'Test', items: [{ title: 'A', dueLabel: 'idag', statusLabel: 'Tilldelad', actionUrl: '/first' }, { title: 'B', dueLabel: 'idag', statusLabel: 'Tilldelad', actionUrl: '/second' }], visibleItemLimit: 1, overviewUrl: '/all' })
  assert.match(digest, /Ytterligare 1 uppdrag/); assert.match(digest, /href="\/first"/); assert.doesNotMatch(digest, /href="\/second"/)
})
test('assignment gains context and reply guidance without changing reply-to, recipients or status actions', () => {
  const server = read('src/lib/tasks/external.ts'), portal = read('src/lib/tasks/recipientPortal.ts'), recipient = read('src/components/tasks/TaskRecipientClient.tsx')
  assert.match(server, /description,context_label,status/)
  assert.match(server, /contextLabel: task.context_label/)
  assert.match(server, /Vanliga mejlsvar sparas inte automatiskt/)
  assert.match(server, /replyTo: issuer\?\.email \?\? null/)
  for (const source of [server, portal]) assert.match(source, /draftScope: hashAssignmentToken\(`task-draft:/)
  assert.doesNotMatch(recipient, /'Starta'|overflow-x-auto/)
  assert.match(recipient, /Fler åtgärder/); assert.match(recipient, /runAction\('start', \{ taskId: task.id, version: task.version \}/)
  assert.match(recipient, /disabled=\{isBusy \|\| readyForReviewBlocked\}/)
})

function loadRecipient() {
  const empty=()=>null
  const attachments=load('src/components/tasks/TaskRecipientAttachments.tsx', {
    '@/lib/tasks/dateTime': dates,
    './ActionCaseImageViewer': { default: empty, ActionCaseAttachmentImage: ({ file, src }) => createElement('img', { alt: file.title, src }) },
  }).default
  return load('src/components/tasks/TaskRecipientClient.tsx',{
    '@/lib/tasks/dateTime':dates,
    '@/components/ui/AppToastProvider':{useToast:()=>({success(){},error(){},warning(){}})},
    './UppdragScope':{default:({children})=>createElement('div',null,children)},
    './UppdragBrand':{default:empty}, './TaskStatusBadge':{TaskStatusBadge:empty},
    './RecipientAccountAction':{default:empty}, './TaskAttachmentDropZone':{default:empty},
    './TaskConversationCard':{default:()=>createElement('textarea',{'aria-label':'Meddelande'})},
    './TaskHistoryDisclosure':{default:empty}, './TaskTimeProgress':{default:empty},
    './TaskRecipientAttachments':{default:attachments},
    './useTaskRecipientDraft':{default:()=>({comment:'',evidenceText:'',hasDraft:false,storageAvailable:true,setComment(){},setEvidenceText(){}})},
  }).default
}

test('receipt is confirmed once in Next step without a message, while later completion stays in the footer', () => {
  const component=loadRecipient()
  const workspace={accessState:'open',timeZone:'Europe/Stockholm',recipientName:'Fiktiv mottagare',canDelegate:false,children:[],task:{
    id:'test',title:'Fiktiv uppgift',description:'Test',issuerName:'Fiktiv avsändare',status:'assigned',version:1,
    dueAt:'2030-01-20T15:00:00Z',createdAt:'2030-01-01T08:00:00Z',dueTimeZone:'Europe/Stockholm',requirements:[],events:[],attachments:[],deadlineRequests:[],evidenceRequirements:[],
  }}
  const render=(status,requirements=[])=>renderToStaticMarkup(createElement(component,{initialWorkspace:{...workspace,task:{...workspace.task,status,requirements}},endpoint:'/fake'}))
  for(const status of ['assigned','returned','waiting']) {
    const html=render(status),next=html.match(/<section[^>]*aria-labelledby="recipient-next-step-heading"[^>]*>([\s\S]*?)<\/section>/)?.[1]
    assert.ok(next);assert.match(next,status==='waiting'?/Återuppta uppdraget<\/button>/:/Bekräfta mottaget<\/button>/)
    assert.equal((html.match(/Bekräfta mottaget<\/button>/g)||[]).length,status==='waiting'?0:1)
    assert.doesNotMatch(html,/<footer|Skriv ett meddelande/)
    assert.match(next,/Fler åtgärder/);assert.match(html,/aria-label="Meddelande"/)
    assert.match(next,/gizmo-recipient-actions/);assert.match(next,/gizmo-recipient-more/)
  }
  const blocked=render('assigned',[{id:'r',key:'written_quote',label:'Offert',status:'pending'}])
  assert.match(blocked,/disabled=""[^>]*title="Förberedande kontrollpunkter återstår\."/)
  const progress=render('in_progress');assert.match(progress,/<footer/);assert.match(progress,/Klar för kontroll/)
  assert.match(progress,/<footer[\s\S]*gizmo-recipient-actions/)
  assert.doesNotMatch(progress,/Bekräfta mottaget<\/button>/)
  for(const status of ['approved','cancelled','ready_for_review']) assert.doesNotMatch(render(status),/Bekräfta mottaget<\/button>|<footer/)
})

test('More menu highlights enabled choices on hover and keyboard focus without changing disabled choices', () => {
  const rules=new Map()
  postcss.parse(read('src/components/tasks/gizmo-recipient-layout.css')).walkRules(rule=>{
    const declarations=Object.fromEntries(rule.nodes.filter(node=>node.type==='decl').map(node=>[node.prop,node.value]))
    for(const selector of rule.selectors) rules.set(selector,{...rules.get(selector),...declarations})
  })
  for(const selector of ['.gizmo-recipient-actions>button:enabled:hover','.gizmo-recipient-actions>button:enabled:focus-visible','.gizmo-recipient-more:hover']) {
    assert.equal(rules.get(selector)?.background,'#E5EEEB')
    assert.equal(rules.get(selector)?.color,'#206961')
  }
  for(const selector of ['.gizmo-recipient-actions>button:enabled:focus-visible','.gizmo-recipient-more:focus-visible']) assert.equal(rules.get(selector)?.outline,'2px solid #206961')
  assert.equal(rules.get('.gizmo-recipient-actions>button:disabled')?.cursor,'not-allowed')
  assert.equal(rules.has('.gizmo-recipient-actions>button:hover'),false)
})

test('received files precede messages and own uploads are separate, irrespective of completion evidence', () => {
  const component=loadRecipient()
  const base={title:null,fileName:null,textContent:null,transcriptText:null,canEditTranscript:false,isCompletionEvidence:false,createdAt:'2030-01-01T08:00:00Z'}
  const attachments=[
    {...base,id:'sent-doc',type:'document',source:'sender',title:'Mottagen PDF'},
    {...base,id:'sent-photo',type:'photo',source:'sender',title:'Mottagen bild'},
    {...base,id:'own-doc',type:'document',source:'recipient',title:'Eget dokument utan färdigbevis'},
    {...base,id:'own-audio',type:'audio',source:'recipient',title:'Egen inspelning',transcriptText:'Min redovisning',canEditTranscript:true},
    {...base,id:'sent-audio',type:'audio',source:'sender',title:'Avsändarens inspelning',transcriptText:'Instruktion'},
  ]
  const workspace={accessState:'open',timeZone:'Europe/Stockholm',recipientName:'Test',canDelegate:false,children:[],task:{
    id:'test',title:'Uppgift',status:'assigned',version:1,issuerName:'Anna',dueAt:'2030-02-01T15:00:00Z',createdAt:base.createdAt,
    requirements:[],events:[],deadlineRequests:[],evidenceRequirements:[],attachments,
  }}
  const render=(overrides={})=>renderToStaticMarkup(createElement(component,{initialWorkspace:{...workspace,task:{...workspace.task,...overrides}},endpoint:'/private-test'}))
  const html=render(), received=html.match(/<details class="[^"]*gizmo-recipient-received"[^>]*>([\s\S]*?)<\/details>/)?.[0]
  const own=html.match(/<section[^>]*aria-labelledby="recipient-evidence-heading"[^>]*>([\s\S]*?)<\/section>/)?.[0]
  assert.match(received,/open=""/);assert.match(received,/Bilagor till uppdraget/)
  assert.match(received,/Mottagen PDF/);assert.match(received,/Mottagen bild/);assert.match(received,/Avsändarens inspelning/)
  assert.doesNotMatch(received,/Eget dokument|Egen inspelning|>Redigera/)
  assert.match(own,/Ditt underlag/);assert.match(own,/Eget dokument utan färdigbevis/)
  assert.match(own,/Egen inspelning/);assert.match(own,/> Redigera/)
  assert.doesNotMatch(own,/Mottagen PDF|Mottagen bild|Avsändarens inspelning/)
  assert.match(received,/src="\/private-test\/attachments\/sent-photo"/)
  assert.match(received,/href="\/private-test\/attachments\/sent-doc"/)
  assert.ok(html.indexOf('Bilagor till uppdraget')<html.indexOf('aria-label="Meddelande"'))
  assert.ok(html.indexOf('aria-label="Meddelande"')<html.indexOf('Ditt underlag'))
  assert.ok(html.indexOf('Ditt underlag')<html.indexOf('Tid och uppföljning'))
  for(const status of ['approved','cancelled','ready_for_review']) {
    const closed=render({status})
    assert.match(closed,/Mottagen PDF/);assert.match(closed,/Eget dokument utan färdigbevis/)
    assert.doesNotMatch(closed,/> Redigera|Spara textunderlag|> Välj fil/)
  }
  assert.doesNotMatch(render({attachments:[]}),/gizmo-recipient-received" open=/)
})

test('both personal-link and logged-in recipient sources use uploader identity without changing attachment access rules', () => {
  for(const [path,scope] of [['src/lib/tasks/external.ts','access'],['src/lib/tasks/recipientPortal.ts','scope']]) {
    const source=read(path)
    assert.ok(source.includes(`source: attachment.uploaded_by_contact_id === ${scope}.contact_id ? 'recipient'`))
    assert.ok(source.includes(`uploaded_by_contact_id.eq.\${${scope}.contact_id},and(is_completion_evidence.eq.false,uploaded_by_profile_id.eq.\${task.issuer_profile_id})`))
  }
  const photoList=read('src/components/tasks/TaskRecipientAttachments.tsx')
  assert.match(photoList,/ActionCaseImageViewer/);assert.match(photoList,/encodeURIComponent\(id\)/)
  assert.doesNotMatch(photoList,/api\/action-cases|createSignedUrl|storage\.from/)
})
