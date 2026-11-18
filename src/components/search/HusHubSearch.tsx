'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowUpRight, Building2, ClipboardCheck, FileText, LoaderCircle, LogIn, RefreshCw, Search, TriangleAlert, X } from 'lucide-react'
import { authLoginUrl } from '@/lib/auth/returnPath'
import { supabase } from '@/lib/supabaseClient'
import { GLOBAL_SEARCH_MAX_LENGTH, GLOBAL_SEARCH_MIN_LENGTH, type GlobalSearchKind, type GlobalSearchResponse, type GlobalSearchResult } from '@/lib/globalSearch/model'
import './HusHubSearch.css'

const KIND_LABELS: Record<GlobalSearchKind, string> = {
  property: 'Fastighet', inspection: 'Besiktning', report: 'Utlåtande', assignment: 'Uppdrag',
  project: 'Projekt', case: 'Ärende', customer: 'Kund', task: 'Uppgift',
}
const STATUS_LABELS: Record<string, string> = {
  draft: 'Utkast', confirmed: 'Bekräftad', tentative: 'Preliminär', completed: 'Slutförd', archived: 'Arkiverad',
  published: 'Publicerad', in_progress: 'Pågående', issued: 'Utfärdad', finalized: 'Slutförd', sent: 'Skickad',
  booked: 'Bokad', cancelled: 'Avbokad', approved: 'Godkänd',
  ongoing: 'Pågående', preparing: 'Förbereds', pending: 'Väntande', submitted: 'Inskickad',
  conditional: 'Godkänd med villkor', locked: 'Låst', active: 'Aktiv', open: 'Öppet', closed: 'Avslutat',
  accepted: 'Accepterat', ready: 'Klart', delivered: 'Levererad',
}

type SearchSnapshot = { key: string } & (
  | { phase: 'ready'; data: GlobalSearchResponse }
  | { phase: 'error' | 'unauthorized' | 'forbidden' }
)
type Navigation = { key: string; index: number; keyboard: boolean }

function isResult(value: unknown): value is GlobalSearchResult {
  if (!value || typeof value !== 'object') return false
  const result = value as Record<string, unknown>
  return ['id', 'moduleId', 'moduleLabel', 'title', 'subtitle', 'href'].every(key => typeof result[key] === 'string')
    && typeof result.kind === 'string' && Object.hasOwn(KIND_LABELS, result.kind)
    && typeof result.href === 'string' && result.href.startsWith('/') && !result.href.startsWith('//')
    && !/[\u0000-\u001f\\]/u.test(result.href)
    && (result.propertyDesignation == null || typeof result.propertyDesignation === 'string')
    && (result.status == null || typeof result.status === 'string')
}

function isSearchResponse(value: unknown, query: string): value is GlobalSearchResponse {
  if (!value || typeof value !== 'object') return false
  const body = value as Record<string, unknown>
  return body.query === query && typeof body.hasMore === 'boolean'
    && Array.isArray(body.results) && body.results.every(isResult)
    && Array.isArray(body.issues) && body.issues.every(issue => issue && typeof issue === 'object'
      && typeof issue.moduleId === 'string' && typeof issue.label === 'string' && typeof issue.message === 'string')
}

function ResultIcon({ kind }: { kind: GlobalSearchKind }) {
  const Icon = kind === 'property' ? Building2 : kind === 'inspection' ? ClipboardCheck : FileText
  return <Icon size={17} aria-hidden="true" />
}

/** A fresh scope also discards results when switching A → B → A. */
export default function HusHubSearch({ organizationId, className = '' }: { organizationId?: string; className?: string }) {
  return <SearchScope key={organizationId ?? 'default'} organizationId={organizationId} className={className} />
}

function SearchScope({ organizationId, className }: { organizationId?: string; className: string }) {
  const router = useRouter()
  const id = useId()
  const inputId = `${id}-input`
  const listId = `${id}-results`
  const hintId = `${id}-hint`
  const container = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  const [open, setOpen] = useState(false)
  const [revision, setRevision] = useState(0)
  const [snapshot, setSnapshot] = useState<SearchSnapshot | null>(null)
  const [navigation, setNavigation] = useState<Navigation | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)
  const [loginFailed, setLoginFailed] = useState(false)
  const query = value.trim().replace(/\s+/gu, ' ')
  const searchable = query.length >= GLOBAL_SEARCH_MIN_LENGTH
  const requestKey = JSON.stringify([organizationId ?? 'default', query, revision])
  const current = snapshot?.key === requestKey ? snapshot : null
  const loading = open && searchable && !current
  const data = current?.phase === 'ready' ? current.data : null
  const groups = useMemo(() => {
    const modules = new Map<string, { id: string; label: string; results: GlobalSearchResult[] }>()
    for (const result of data?.results ?? []) {
      let group = modules.get(result.moduleId)
      if (!group) {
        group = { id: result.moduleId, label: result.moduleLabel, results: [] }
        modules.set(result.moduleId, group)
      }
      group.results.push(result)
    }
    return [...modules.values()]
  }, [data])
  const results = useMemo(() => groups.flatMap(group => group.results), [groups])
  const activeIndex = navigation?.key === requestKey && navigation.index < results.length ? navigation.index : -1
  const resultId = (index: number) => `${id}-result-${index}`

  function openSearch() {
    if (!open) {
      // Reopening always checks the current session and permissions afresh.
      setRevision(previous => previous + 1)
      setOpen(true)
    }
  }

  useEffect(() => {
    if (!open || !searchable) return
    let disposed = false
    const controller = new AbortController()
    let timeout: ReturnType<typeof setTimeout> | undefined
    const debounce = setTimeout(() => {
      timeout = setTimeout(() => {
        if (disposed) return
        setSnapshot({ key: requestKey, phase: 'error' })
        controller.abort()
      }, 20_000)
      const params = new URLSearchParams({ q: query })
      if (organizationId) params.set('orgId', organizationId)
      void fetch(`/api/hushub/search?${params}`, {
        signal: controller.signal, cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' },
      }).then(async response => {
        const body: unknown = await response.json().catch(() => null)
        if (disposed || controller.signal.aborted) return
        if (response.status === 401) setSnapshot({ key: requestKey, phase: 'unauthorized' })
        else if (response.status === 403) setSnapshot({ key: requestKey, phase: 'forbidden' })
        else if (!response.ok || !isSearchResponse(body, query)) setSnapshot({ key: requestKey, phase: 'error' })
        else setSnapshot({ key: requestKey, phase: 'ready', data: body })
      }).catch(() => {
        if (!disposed && !controller.signal.aborted) setSnapshot({ key: requestKey, phase: 'error' })
      }).finally(() => clearTimeout(timeout))
    }, 250)
    return () => { disposed = true; clearTimeout(debounce); clearTimeout(timeout); controller.abort() }
  }, [open, organizationId, query, requestKey, searchable])

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      if (container.current?.contains(document.activeElement)) input.current?.focus()
    }
    const close = () => setOpen(false)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('blur', close)
    }
  }, [open])

  useEffect(() => {
    if (!open || !navigation?.keyboard || activeIndex < 0) return
    document.getElementById(`${id}-result-${activeIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, id, navigation?.keyboard, open])

  useEffect(() => {
    let identity: string | undefined
    const { data: listener } = supabase.auth.onAuthStateChange((_event: string, session: { user: { id: string } } | null) => {
      const next = session?.user.id
      if (!next || (identity && identity !== next)) {
        setSnapshot(null)
        setRevision(previous => previous + 1)
        setOpen(false)
      }
      identity = next
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  function keyboard(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      openSearch()
      if (!results.length) return
      const next = event.key === 'ArrowDown'
        ? (activeIndex + 1) % results.length
        : activeIndex <= 0 ? results.length - 1 : activeIndex - 1
      setNavigation({ key: requestKey, index: next, keyboard: true })
    } else if (event.key === 'Enter' && open && activeIndex >= 0) {
      event.preventDefault()
      setOpen(false)
      router.push(results[activeIndex].href)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
    }
  }

  async function signInAgain() {
    setLoggingIn(true)
    setLoginFailed(false)
    try {
      const destination = authLoginUrl(`${window.location.pathname}${window.location.search}${window.location.hash}`)
      const { error } = await supabase.auth.signOut({ scope: 'local' })
      if (error) throw error
      window.location.assign(destination)
    } catch {
      setLoginFailed(true)
      setLoggingIn(false)
    }
  }

  const issueLabels = [...new Set(data?.issues.map(issue => issue.label.trim()).filter(Boolean) ?? [])]
  const partialMessage = data?.issues.length ? `Resultatet är inte komplett. ${issueLabels.length
    ? `Kunde inte söka färdigt i: ${issueLabels.join(', ')}.`
    : 'Alla moduler kunde inte sökas igenom.'}` : ''
  const announcement = !open ? '' : loading ? 'Söker i HusHub…'
    : data ? `${results.length} ${results.length === 1 ? 'träff' : 'träffar'}${data.hasMore ? ', fler träffar finns' : ''}.${partialMessage ? ` ${partialMessage}` : ''}`
      : current?.phase === 'unauthorized' ? 'Din inloggning behöver förnyas.'
        : current?.phase === 'forbidden' ? 'Du saknar behörighet att söka i den valda organisationen.'
          : current?.phase === 'error' ? 'Sökningen kunde inte hämtas.' : ''
  let offset = 0

  return <div className={`hh-search${open ? ' hh-search-open' : ''} ${className}`} ref={container} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }}>
    <form className="hh-search-field" role="search" aria-label="Sök i hela HusHub" onSubmit={event => { event.preventDefault(); openSearch() }}>
      <Search size={17} aria-hidden="true" />
      <label htmlFor={inputId} className="hh-search-sr-only">Sök i hela HusHub</label>
      <input ref={input} id={inputId} type="search" role="combobox" autoComplete="off" spellCheck={false}
        placeholder="Sök i hela HusHub…" maxLength={GLOBAL_SEARCH_MAX_LENGTH} value={value}
        aria-expanded={open} aria-autocomplete="list" aria-haspopup="listbox" aria-controls={open ? listId : undefined}
        aria-describedby={open ? hintId : undefined} aria-activedescendant={open && activeIndex >= 0 ? resultId(activeIndex) : undefined}
        onFocus={openSearch} onClick={openSearch} onKeyDown={keyboard} onChange={event => {
          const next = event.target.value
          if (next.trim().replace(/\s+/gu, ' ') !== query) { setSnapshot(null); setNavigation(null) }
          setValue(next)
          openSearch()
        }} />
      {value && <button type="button" className="hh-search-clear" aria-label="Rensa sökning" onClick={() => { setValue(''); setSnapshot(null); setNavigation(null); input.current?.focus(); openSearch() }}><X size={15} aria-hidden="true" /></button>}
    </form>
    <span className="hh-search-sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
    {open && <div className="hh-search-panel">
      <div className="hh-search-panel-heading"><strong>{searchable ? 'Sökresultat' : 'Hitta i HusHub'}</strong>{data && <span>{results.length} {results.length === 1 ? 'träff' : 'träffar'}{data.hasMore ? '+' : ''}</span>}</div>
      <p className="hh-search-hint" id={hintId}>{searchable ? 'Resultat från dina moduler.' : 'Sök på fastighetsbeteckning, adress eller uppdrag.'}</p>
      {!searchable && <p className="hh-search-message">Skriv minst {GLOBAL_SEARCH_MIN_LENGTH} tecken för att söka.</p>}
      {loading && <div className="hh-search-message hh-search-loading"><LoaderCircle size={17} aria-hidden="true" /><span>Söker i HusHub…</span></div>}
      {current?.phase === 'unauthorized' && <div className="hh-search-error"><LogIn size={18} aria-hidden="true" /><div><strong>Logga in igen för att söka</strong><p>{loginFailed ? 'Inloggningen kunde inte öppnas. Försök igen.' : 'Din inloggning behöver förnyas. Du kommer tillbaka till den här sidan.'}</p><button type="button" onClick={signInAgain} disabled={loggingIn}>{loggingIn ? 'Öppnar inloggning…' : 'Logga in igen'}</button></div></div>}
      {current?.phase === 'forbidden' && <div className="hh-search-error"><TriangleAlert size={18} aria-hidden="true" /><p>Du saknar behörighet att söka i den valda organisationen.</p></div>}
      {current?.phase === 'error' && <div className="hh-search-error"><TriangleAlert size={18} aria-hidden="true" /><div><strong>Sökningen kunde inte hämtas</strong><p>Kontrollera anslutningen och försök igen.</p><button type="button" onClick={() => setRevision(previous => previous + 1)}><RefreshCw size={13} aria-hidden="true" />Försök igen</button></div></div>}
      {partialMessage ? <div className="hh-search-partial"><TriangleAlert size={15} aria-hidden="true" /><span>{partialMessage}</span><button type="button" onClick={() => setRevision(previous => previous + 1)}>Försök igen</button></div> : null}
      {data && !results.length && <div className="hh-search-empty"><Search size={23} aria-hidden="true" /><strong>{data.issues.length ? 'Inga träffar i de inlästa modulerna' : 'Inga träffar'}</strong><p>Prova en annan beteckning, adress eller del av namnet.</p></div>}
      <div id={listId} className="hh-search-results" role="listbox" aria-label="Sökresultat i HusHub" aria-busy={loading}>
        {groups.map(group => <div className="hh-search-group" role="group" key={group.id} aria-labelledby={`${id}-module-${group.id}`}>
          <div id={`${id}-module-${group.id}`} className="hh-search-group-heading">{group.label}<span>{group.results.length}</span></div>
          {group.results.map(result => {
            const index = offset++
            const status = result.status ? STATUS_LABELS[result.status.toLocaleLowerCase('sv-SE')] ?? result.status : null
            const designation = result.propertyDesignation && !`${result.title} ${result.subtitle}`.includes(result.propertyDesignation) ? result.propertyDesignation : null
            return <Link key={result.id} id={resultId(index)} role="option" aria-selected={activeIndex === index} tabIndex={-1}
              href={result.href} prefetch={false} className="hh-search-result" onPointerMove={() => setNavigation(previous => previous?.key === requestKey && previous.index === index && !previous.keyboard ? previous : { key: requestKey, index, keyboard: false })} onClick={() => setOpen(false)}>
              <span className="hh-search-result-icon"><ResultIcon kind={result.kind} /></span><span className="hh-search-result-copy"><span className="hh-search-result-title">{result.title}</span><span className="hh-search-result-meta">{result.moduleId === 'tu' && result.kind === 'inspection' ? 'Utredning' : KIND_LABELS[result.kind]}{status && <> · {status}</>}</span>{(result.subtitle || designation) && <span className="hh-search-result-subtitle">{[designation, result.subtitle].filter(Boolean).join(' · ')}</span>}</span><ArrowUpRight className="hh-search-result-arrow" size={15} aria-hidden="true" />
            </Link>
          })}
        </div>)}
      </div>
      {data && (results.length > 0 || data.hasMore) && <div className="hh-search-footer">{data.hasMore ? <span>Fler träffar finns. Förfina sökningen för att hitta rätt.</span> : <span>Välj en träff för att öppna den.</span>}<span className="hh-search-keyboard-hint" aria-hidden="true">↑ ↓ · Enter</span></div>}
    </div>}
  </div>
}
