import { createRoot } from 'react-dom/client'
import Editor from '../../src/components/renoapp/RenovationRulesEditor'
import type { RenovationRulesVersion } from '../../src/lib/renoapp/renovationRules'

type State = { rules: RenovationRulesVersion | null; savedRules: RenovationRulesVersion | null }
const read = (): State => JSON.parse(sessionStorage.getItem('rules-editor') ?? '{"rules":null,"savedRules":null}')
window.fetch = async (_url, options) => {
  const state = read()
  if (options?.method !== 'POST') return Response.json(state)
  const body = JSON.parse(String(options.body))
  const requests = JSON.parse(sessionStorage.getItem('rules-editor-requests') ?? '[]')
  sessionStorage.setItem('rules-editor-requests', JSON.stringify([...requests, body]))
  if (sessionStorage.getItem('rules-editor-failure') === 'conflict') {
    state.rules = { ...state.savedRules!, id: 'changed-version', version: 99, format: 'text', body: 'Another board member changed these rules.' }
    state.savedRules = state.rules
    sessionStorage.setItem('rules-editor', JSON.stringify(state))
    sessionStorage.removeItem('rules-editor-failure')
    return Response.json({ code: 'RULES_VERSION_CHANGED' }, { status: 409 })
  }
  if (sessionStorage.getItem('rules-editor-failure')) return Response.json({ error: 'Test: kunde inte spara.' }, { status: 500 })
  if (body.action === 'prepare_upload') return Response.json({ upload: { bucket: 'test', path: 'test.pdf', token: 'test' } })
  if (body.expectedVersion !== (state.rules?.id ?? null)) return Response.json({ code: 'RULES_VERSION_CHANGED' }, { status: 409 })
  if (body.format === 'none') state.rules = null
  else {
    state.rules = { id: crypto.randomUUID(), brfId: 'test', version: (state.savedRules?.version ?? 0) + 1,
      format: body.format, body: body.format === 'text' ? body.body.trim() : null,
      fileName: body.reuseVersionId ? state.savedRules?.fileName ?? null : body.fileName ?? null, publishedAt: '2026-09-07' }
    state.savedRules = state.rules
  }
  sessionStorage.setItem('rules-editor', JSON.stringify(state))
  return Response.json(state)
}
createRoot(document.getElementById('root')!).render(<main className="mx-auto max-w-4xl px-5 py-8"><Editor brfId="test" /></main>)
