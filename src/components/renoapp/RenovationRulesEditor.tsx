'use client'

import { useEffect, useRef, useState } from 'react'
import { EyeOff, Save, Upload } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { RULES_MAX_FILE_BYTES, RULES_MAX_TEXT_LENGTH, type RenovationRulesVersion } from '@/lib/renoapp/renovationRules'
import { RenovationRulesDocument } from './RenovationRulesView'

type ResponseBody = {
  rules: RenovationRulesVersion | null
  error?: string
  code?: string
  upload?: { bucket: string; path: string; token: string }
}

export default function RenovationRulesEditor({ brfId }: { brfId: string }) {
  const [rules, setRules] = useState<RenovationRulesVersion | null>(null)
  const [format, setFormat] = useState<'text' | 'pdf'>('text')
  const [body, setBody] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    void fetch(`/api/renoapp/app/brf/rules?brfId=${encodeURIComponent(brfId)}`, { cache: 'no-store' })
      .then(async response => {
        const payload: ResponseBody = await response.json()
        if (!response.ok) throw new Error(payload.error ?? 'Kunde inte läsa renoveringsreglerna.')
        if (!active) return
        setRules(payload.rules)
        setFormat(payload.rules?.format ?? 'text')
        setBody(payload.rules?.body ?? '')
        setLoading(false)
      }).catch(reason => { if (active) setError(reason.message) })
    return () => { active = false }
  }, [brfId, reloadKey])

  const post = async (data: Record<string, unknown>) => {
    const response = await fetch('/api/renoapp/app/brf/rules', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brfId, ...data }),
    })
    const payload: ResponseBody = await response.json()
    if (!response.ok) {
      if (payload.code === 'RULES_VERSION_CHANGED') {
        const latest = await fetch(`/api/renoapp/app/brf/rules?brfId=${encodeURIComponent(brfId)}`, { cache: 'no-store' })
        if (latest.ok) setRules((await latest.json()).rules)
        throw new Error('En annan användare har ändrat reglerna. Kontrollera den publicerade versionen nedan innan du sparar igen. Din redigering finns kvar.')
      }
      throw new Error(payload.error ?? 'Kunde inte spara renoveringsreglerna.')
    }
    return payload
  }

  const save = async (withdraw = false) => {
    if (busy || loading) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      let uploadPath: string | undefined
      if (!withdraw && format === 'pdf') {
        if (!file || !file.name.toLowerCase().endsWith('.pdf') || file.size <= 0 || file.size > RULES_MAX_FILE_BYTES) {
          throw new Error('Välj en PDF-fil, högst 15 MB.')
        }
        const { upload } = await post({ action: 'prepare_upload' })
        if (!upload) throw new Error('Kunde inte förbereda uppladdningen.')
        const result = await supabase.storage.from(upload.bucket).uploadToSignedUrl(upload.path, upload.token, file, { contentType: 'application/pdf' })
        if (result.error) throw new Error('PDF-filen kunde inte laddas upp. Försök igen.')
        uploadPath = upload.path
      }
      const payload = await post({ action: 'publish', expectedVersion: rules?.id ?? null,
        format: withdraw ? 'none' : format, body, uploadPath, fileName: file?.name })
      setRules(payload.rules)
      setBody(payload.rules?.body ?? '')
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      setMessage(withdraw ? 'Reglerna är avpublicerade. Tidigare godkännanden finns kvar i respektive ansökan.' : 'Reglerna är publicerade och behöver godkännas när nya ansökningar skickas in.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Kunde inte spara reglerna.') }
    finally { setBusy(false) }
  }

  return (
    <section className="mt-8 min-w-0 border-t border-stone-200 pt-6">
      <h3 className="text-xl font-semibold text-stone-900">Föreningens renoveringsregler</h3>
      <p className="mt-2 text-sm text-stone-600">{loading ? 'Laddar regler...' : rules ? `Publicerad version ${rules.version}, ${new Date(rules.publishedAt).toLocaleDateString('sv-SE')}.` : 'Inga renoveringsregler är publicerade.'}</p>
      <fieldset disabled={loading || busy} className="mt-5 min-w-0 space-y-4 disabled:opacity-60">
        <legend className="sr-only">Reglernas format</legend>
        <div className="flex flex-wrap gap-5 text-sm font-medium text-stone-800">
          {(['text', 'pdf'] as const).map(option => <label key={option} className="flex cursor-pointer items-center gap-2">
            <input type="radio" name={`rules-format-${brfId}`} checked={format === option} onChange={() => setFormat(option)} className="h-4 w-4 accent-emerald-700" />
            {option === 'text' ? 'Skriv eller klistra in text' : 'Ladda upp PDF'}
          </label>)}
        </div>
        {format === 'text' ? <label className="block text-sm font-medium text-stone-800">Renoveringsregler
          <textarea aria-label="Renoveringsregler" rows={9} maxLength={RULES_MAX_TEXT_LENGTH} value={body} onChange={event => setBody(event.target.value)} className="mt-2 block w-full rounded-lg border border-stone-300 bg-white p-3 text-sm font-normal leading-6" />
        </label> : <label className="block text-sm font-medium text-stone-800">PDF-fil (högst 15 MB)
          <input ref={inputRef} type="file" accept="application/pdf,.pdf" onChange={event => setFile(event.target.files?.[0] ?? null)} className="mt-2 block w-full min-w-0 text-sm file:mr-3 file:rounded-md file:border file:border-stone-300 file:bg-white file:px-3 file:py-2" />
        </label>}
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={format === 'text' ? !body.trim() || (rules?.format === 'text' && body.trim() === rules.body) : !file} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {format === 'pdf' ? <Upload size={17} /> : <Save size={17} />}{busy ? 'Sparar...' : 'Spara och publicera'}
          </button>
          {rules ? <button type="button" onClick={() => void save(true)} className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-semibold text-stone-800"><EyeOff size={17} />Avpublicera</button> : null}
        </div>
      </fieldset>
      {error ? <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p> : null}
      {loading && error ? <button type="button" onClick={() => { setError(null); setReloadKey(value => value + 1) }} className="mt-3 text-sm font-semibold text-sky-800 underline">Försök hämta reglerna igen</button> : null}
      {message ? <p role="status" className="mt-3 text-sm text-emerald-800">{message}</p> : null}
      {rules ? <div className="mt-5"><RenovationRulesDocument rules={rules} /></div> : null}
    </section>
  )
}
