import { createRoot } from 'react-dom/client'
import TuInvestigationEditorClient from '../../src/components/tu/TuInvestigationEditorClient'
import { AppToastProvider } from '../../src/components/ui/AppToastProvider'
import { resolveTuReportSectionTitle } from '../../src/lib/tu/reportTemplates'
import type { TuInvestigationDetails } from '../../src/lib/tu/server'

const org = '11111111-1111-4111-8111-111111111111'
const parameters = new URLSearchParams(location.search)
const initial = {
  inspectionId: 'test-report', orgId: org, title: 'Syntetisk rapport', projectType: 'Teknisk utredning',
  reportTemplateKey: parameters.get('template') || 'technical_status_statement',
  reportAuthoringMode: 'standard', reportWorkflowProfile: 'field_report',
  reportLockedAt: parameters.has('locked') ? '2026-11-17T12:00:00Z' : null,
  objectType: 'villa', inspection: {}, property: { address: 'Testgatan 1', city: 'Teststad' },
  assignment: null, inspector: null, scopeDescription: 'Syntetiskt test. Ingen riktig beställning.',
  reportDraft: { sections: [
    { id: 'assignment_parties', key: 'assignment_parties', title: 'Uppdragsgivare och besiktningsman', text: 'Uppdragsgivare\nNamn: Testperson' },
    { id: 'recommended_actions', key: 'recommended_actions', title: 'Rekommenderade kompletterande kontroller',
      text: 'Min egen text.\nEn rad till.\n\nEtt eget stycke.', isRequired: parameters.has('required'),
      templateSectionKey: 'recommended_actions',
      subsections: [{ id: 'sub-1', title: 'Min underrubrik', text: 'Egen underrubrikstext.' }] },
  ] },
} as unknown as TuInvestigationDetails
const saved = JSON.parse(sessionStorage.getItem('tu-editor-saved') || 'null') as TuInvestigationDetails | null
let record = parameters.has('resume') || location.pathname.endsWith('/print') ? saved || initial : initial
const state = { fail: false, delay: 0, writes: 0, active: 0, requests: [] as unknown[] }
Object.assign(window, { __tuEditorTest: state })
const images = [{ id: 'image-1', inspectionId: initial.inspectionId, orgId: org, sectionKey: 'appendix',
  publicUrl: '/test-image.svg', sortOrder: 0, caption: 'Testbild', reportCaption: 'Min bildtext.' }]
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin)
  if (!url.pathname.startsWith('/api/tu/investigations/test-report')) throw Error(`Unexpected test request: ${url.pathname}`)
  if (!init?.method || init.method === 'GET') {
    if (url.pathname.endsWith('/images')) return Response.json({ images })
    if (url.pathname.endsWith('/documents')) return Response.json({ documents: [] })
    throw Error(`Unexpected test read: ${url.pathname}`)
  }
  if (init.method !== 'PATCH') throw Error('Test may only save report edits')
  state.writes++
  state.active++
  const body = JSON.parse(String(init.body))
  state.requests.push({ path: url.pathname, body })
  await new Promise(resolve => setTimeout(resolve, state.delay))
  state.active--
  if (state.fail) return Response.json({ error: 'Kunde inte spara. Försök igen.' }, { status: 503 })
  if (url.pathname.endsWith('/images')) {
    Object.assign(images[0], body)
    sessionStorage.setItem('tu-editor-image', JSON.stringify(images[0]))
    return Response.json({ image: images[0] })
  }
  record = { ...record, ...body, updatedAt: new Date().toISOString() }
  sessionStorage.setItem('tu-editor-saved', JSON.stringify(record))
  return Response.json({ investigation: record })
}

function Preview() {
  return <main><h1>Förhandsgranskning av sparade testuppgifter</h1>
    {record.reportDraft.sections.map(section => <section key={section.id}>
      <h2>{resolveTuReportSectionTitle(record.reportTemplateKey, section)}</h2><pre>{section.text}</pre>
      {section.subsections?.map(sub => <div key={sub.id}><h3>{sub.title}</h3><pre>{sub.text}</pre></div>)}
    </section>)}
  </main>
}

createRoot(document.getElementById('root')!).render(<AppToastProvider>
  {location.pathname.endsWith('/print') ? <Preview /> : <TuInvestigationEditorClient
    initialInvestigation={record} initialWorkspaceView="report"
    sectionTypeOptions={[{ key: 'recommended_actions', title: 'Rekommenderad fortsatt hantering' }, { key: 'closing_comments', title: 'Avslutande kommentarer' }]}
  />}
</AppToastProvider>)
