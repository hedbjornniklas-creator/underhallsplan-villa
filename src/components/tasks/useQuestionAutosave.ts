'use client'
import { useEffect, useRef, useState } from 'react'
import { useAutosaveQueue } from '@/hooks/useAutosaveQueue'

type Attempt<T> = { value: T; revision: number; requestId: string }
type Draft<T> = { value: T; saved: T; revision: number; pending: Attempt<T> | null }
const fingerprint = (value: unknown) => JSON.stringify(value)

// The owner flushes before changing questions. Retries replay the exact request
// before saving any newer typing, including after an uncertain network response.
export function useQuestionAutosave<T>({ save, valid, onSaved }: {
  save: (attempt: Attempt<T>) => Promise<void>;
  valid: (value: T) => boolean;
  onSaved: (value: T, revision: number) => void;
}) {
  const entry = useRef<Draft<T> | null>(null), key = useRef(''), failed = useRef(false), running = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null), mounted = useRef(true)
  const errorRef = useRef('')
  const localRef = useRef(true)
  const callbacks = useRef({ save, valid, onSaved }); callbacks.current = { save, valid, onSaved }
  const [state, setState] = useState({ busy: false, dirty: false, error: '', local: true })
  function publish(error = errorRef.current) {
    errorRef.current = error
    const current = entry.current
    const dirty = Boolean(current && (current.pending || fingerprint(current.value) !== fingerprint(current.saved)))
    let local = true
    if (key.current) try {
      if (dirty) localStorage.setItem(key.current, fingerprint(current))
      else localStorage.removeItem(key.current)
    } catch { local = !dirty }
    localRef.current = local
    if (mounted.current) setState({ busy: running.current, dirty, error, local })
  }
  const queue = useAutosaveQueue<true, void>({ save: async () => {
    if (failed.current || !entry.current) return
    running.current = true; publish('')
    try {
      while (mounted.current && entry.current) {
        const current = entry.current
        if (!current.pending) {
          if (fingerprint(current.value) === fingerprint(current.saved) || !callbacks.current.valid(current.value)) break
          current.pending = { value: structuredClone(current.value), revision: current.revision, requestId: crypto.randomUUID() }
          publish('')
        }
        const attempt = current.pending
        await callbacks.current.save(attempt)
        current.saved = attempt.value; current.revision = attempt.revision + 1; current.pending = null
        callbacks.current.onSaved(attempt.value, current.revision)
        publish('')
      }
    } catch (error) {
      failed.current = true
      publish(error instanceof Error ? error.message : 'Sparningen kunde inte bekräftas. Utkastet finns kvar.')
    } finally { running.current = false; publish(failed.current ? undefined : '') }
  } })
  const enqueue = useRef(queue.enqueue); enqueue.current = queue.enqueue
  function change(value: T) {
    if (!entry.current) return
    entry.current.value = structuredClone(value); publish()
    if (timer.current) clearTimeout(timer.current)
    if (!failed.current) timer.current = setTimeout(() => { void enqueue.current(true).catch(() => undefined) }, 700)
  }
  function seed(storageKey: string, value: T, revision: number, discard = false) {
    if (running.current) return null
    if (timer.current) clearTimeout(timer.current)
    key.current = storageKey; failed.current = false
    entry.current = { value: structuredClone(value), saved: structuredClone(value), revision, pending: null }
    let error = ''
    if (!discard) try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || 'null') as Draft<T> | null
      if (stored && Number.isSafeInteger(stored.revision) && stored.value && stored.saved &&
        (stored.pending === null || (stored.pending && typeof stored.pending.requestId === 'string' && stored.pending.revision === stored.revision && stored.pending.value))) {
        entry.current = stored
        if (stored.revision !== revision && !stored.pending) {
          failed.current = true; error = 'Det lokala utkastet avser en äldre version. Hämta den sparade frågan innan du fortsätter.'
        }
      }
    } catch { /* A missing or unreadable local draft never replaces server data. */ }
    publish(error)
    if (!failed.current) timer.current = setTimeout(() => { void enqueue.current(true).catch(() => undefined) }, 700)
    return entry.current.value
  }
  async function flush() {
    if (timer.current) clearTimeout(timer.current)
    await enqueue.current(true).catch(() => undefined)
    return !failed.current && !entry.current?.pending && (!entry.current || fingerprint(entry.current.value) === fingerprint(entry.current.saved))
  }
  async function retry() { failed.current = false; publish(''); return flush() }
  function acknowledge(revision: number) { if (entry.current && !entry.current.pending && !running.current && revision > entry.current.revision) { entry.current.revision = revision; publish() } }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (timer.current) clearTimeout(timer.current) } }, [])
  return { ...state, change, seed, flush, retry, acknowledge, isLocal: () => localRef.current, isBusy: () => running.current, value: () => entry.current?.value ?? null, revision: () => entry.current?.revision ?? 0 }
}
