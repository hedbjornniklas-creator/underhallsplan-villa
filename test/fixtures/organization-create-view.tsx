import React from 'react'
import { createRoot } from 'react-dom/client'
import OrganizationCreateForm from '@/components/organizations/OrganizationCreateForm'
import SettingsNav from '@/components/settings/SettingsNav'

// Synthetic, local-only fixture. Never contacts Supabase or creates an account.
const calls: unknown[] = []
const params = new URLSearchParams(location.search)
// The native browser dialog is stubbed only in this synthetic fixture. Unit tests
// cover accepting/cancelling it; display its real text for visual QA here.
window.confirm = message => {
  document.getElementById('preview-confirmation')!.textContent = message
  return true
}
window.fetch = async (url, options) => {
  if (String(url) !== '/api/organizations') throw new Error('Unexpected preview request')
  const body = JSON.parse(String(options?.body))
  calls.push(body)
  document.getElementById('preview-calls')!.textContent = JSON.stringify(calls)
  if (params.has('retry') && calls.length === 1) throw new Error('Synthetic lost response')
  const result = params.has('duplicate')
    ? { code: 'ORG_NUMBER_EXISTS', error: 'Organisationsnumret används redan. Be en administratör för organisationen att bjuda in dig. Ingen organisation har skapats.' }
    : { saved: true, organizationId: '00000000-0000-4000-8000-000000000001' }
  return new Response(JSON.stringify(result), { status: params.has('duplicate') ? 409 : 200, headers: { 'Content-Type': 'application/json' } })
}
const mobile = params.has('mobile')
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div style={{ maxWidth: mobile ? 390 : 1152, margin: '0 auto' }} className="space-y-5">
      <p className="rounded-xl bg-slate-900 px-4 py-3 text-sm text-white">Lokal förhandsvisning · syntetiska testdata · inget sparas i HusHub</p>
      <SettingsNav />
      <OrganizationCreateForm />
      <details><summary>Testbegäranden och bekräftelse</summary><pre id="preview-confirmation" className="whitespace-pre-wrap text-xs" /><pre id="preview-calls" className="overflow-auto text-xs" /></details>
    </div>
  </React.StrictMode>,
)
