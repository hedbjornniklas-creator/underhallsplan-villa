'use client'

import { useEffect, useMemo, useState } from 'react'

type TerminologyGroup = {
  id: string
  key: string
  label: string
  description: string | null
  sortOrder: number
  isLocked: boolean
  isActive: boolean
}

type TerminologyAlias = {
  id: string
  alias: string
  sortOrder: number
  isActive: boolean
}

type TerminologyRule = {
  id: string
  ruleKey: string
  label: string
  description: string | null
  config: unknown
  sortOrder: number
  isActive: boolean
}

type TerminologyTerm = {
  id: string
  groupId: string
  groupKey: string
  groupLabel: string
  code: string
  label: string
  definition: string | null
  termLevel: 'ux' | 'technical' | 'classification' | 'status' | 'document_phase' | 'decision'
  inputKind: 'user_visible' | 'system_internal' | 'system_generated'
  isLocked: boolean
  isUserSelectable: boolean
  isSystemGenerated: boolean
  isActive: boolean
  sortOrder: number
  metadata: unknown
  aliases: TerminologyAlias[]
  rules: TerminologyRule[]
}

type DraftTerm = {
  id?: string
  groupId: string
  code: string
  label: string
  definition: string
  termLevel: TerminologyTerm['termLevel']
  inputKind: TerminologyTerm['inputKind']
  isLocked: boolean
  isUserSelectable: boolean
  isSystemGenerated: boolean
  isActive: boolean
  sortOrder: string
}

type DraftAlias = {
  id?: string
  alias: string
  sortOrder: string
  isActive: boolean
}

type DraftRule = {
  id?: string
  ruleKey: string
  label: string
  description: string
  configText: string
  sortOrder: string
  isActive: boolean
}

const EMPTY_TERM: DraftTerm = {
  groupId: '',
  code: '',
  label: '',
  definition: '',
  termLevel: 'ux',
  inputKind: 'user_visible',
  isLocked: true,
  isUserSelectable: true,
  isSystemGenerated: false,
  isActive: true,
  sortOrder: '100',
}

function slugifyTermCode(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_')
}

function labelForTermLevel(value: TerminologyTerm['termLevel']) {
  switch (value) {
    case 'technical':
      return 'Teknisk'
    case 'classification':
      return 'Klassning'
    case 'status':
      return 'Status'
    case 'document_phase':
      return 'Dokumentfas'
    case 'decision':
      return 'Beslut'
    default:
      return 'UX'
  }
}

function labelForInputKind(value: TerminologyTerm['inputKind']) {
  switch (value) {
    case 'system_internal':
      return 'Systemintern'
    case 'system_generated':
      return 'Systemgenererad'
    default:
      return 'Användarspråk'
  }
}

function createDraftFromTerm(item: TerminologyTerm): DraftTerm {
  return {
    id: item.id,
    groupId: item.groupId,
    code: item.code,
    label: item.label,
    definition: item.definition ?? '',
    termLevel: item.termLevel,
    inputKind: item.inputKind,
    isLocked: item.isLocked,
    isUserSelectable: item.isUserSelectable,
    isSystemGenerated: item.isSystemGenerated,
    isActive: item.isActive,
    sortOrder: String(item.sortOrder),
  }
}

function createAliasDrafts(item: TerminologyTerm): DraftAlias[] {
  return item.aliases.map((alias) => ({
    id: alias.id,
    alias: alias.alias,
    sortOrder: String(alias.sortOrder),
    isActive: alias.isActive,
  }))
}

function createRuleDrafts(item: TerminologyTerm): DraftRule[] {
  return item.rules.map((rule) => ({
    id: rule.id,
    ruleKey: rule.ruleKey,
    label: rule.label,
    description: rule.description ?? '',
    configText: JSON.stringify(rule.config ?? {}, null, 2),
    sortOrder: String(rule.sortOrder),
    isActive: rule.isActive,
  }))
}

export default function RenoAppTerminologyAdminPage() {
  const [groups, setGroups] = useState<TerminologyGroup[]>([])
  const [terms, setTerms] = useState<TerminologyTerm[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [termModalOpen, setTermModalOpen] = useState(false)
  const [termDraft, setTermDraft] = useState<DraftTerm>(EMPTY_TERM)
  const [aliasTermId, setAliasTermId] = useState<string | null>(null)
  const [aliasDrafts, setAliasDrafts] = useState<DraftAlias[]>([])
  const [ruleTermId, setRuleTermId] = useState<string | null>(null)
  const [ruleDrafts, setRuleDrafts] = useState<DraftRule[]>([])

  useEffect(() => {
    let active = true

    const load = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/renoapp/admin/terminology', { cache: 'no-store' })
        const payload = (await response.json().catch(() => ({}))) as {
          groups?: TerminologyGroup[]
          terms?: TerminologyTerm[]
          error?: string
        }

        if (!response.ok) throw new Error(payload.error ?? 'Kunde inte läsa terminologi.')
        if (!active) return
        setGroups(payload.groups ?? [])
        setTerms(payload.terms ?? [])
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Kunde inte läsa terminologi.')
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [])

  const filteredTerms = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return terms.filter((term) => {
      if (groupFilter !== 'all' && term.groupId !== groupFilter) return false
      if (!normalizedQuery) return true

      const haystack = [
        term.label,
        term.code,
        term.groupLabel,
        term.definition ?? '',
        labelForTermLevel(term.termLevel),
        labelForInputKind(term.inputKind),
        ...term.aliases.map((alias) => alias.alias),
        ...term.rules.map((rule) => `${rule.ruleKey} ${rule.label}`),
      ]
        .join(' ')
        .toLowerCase()

      return haystack.includes(normalizedQuery)
    })
  }, [groupFilter, query, terms])

  const aliasTerm = aliasTermId ? terms.find((item) => item.id === aliasTermId) ?? null : null
  const ruleTerm = ruleTermId ? terms.find((item) => item.id === ruleTermId) ?? null : null

  const saveBundle = async (
    draft: DraftTerm,
    aliases: DraftAlias[],
    rules: DraftRule[],
    stateKey: string
  ) => {
    setSavingKey(stateKey)
    setError(null)

    try {
      const normalizedRules = rules
        .filter((rule) => rule.ruleKey.trim() || rule.label.trim() || rule.description.trim())
        .map((rule) => {
          let config: unknown = {}
          const configText = rule.configText.trim()
          if (configText) {
            try {
              config = JSON.parse(configText)
            } catch {
              throw new Error(`Ogiltig JSON i regel "${rule.label || rule.ruleKey || 'ny regel'}".`)
            }
          }

          return {
            id: rule.id,
            ruleKey: rule.ruleKey,
            label: rule.label,
            description: rule.description,
            config,
            sortOrder: Number(rule.sortOrder || '100'),
            isActive: rule.isActive,
          }
        })

      const response = await fetch('/api/renoapp/admin/terminology', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          term: {
            id: draft.id,
            groupId: draft.groupId,
            code: draft.code || slugifyTermCode(draft.label),
            label: draft.label,
            definition: draft.definition,
            termLevel: draft.termLevel,
            inputKind: draft.inputKind,
            isLocked: draft.isLocked,
            isUserSelectable: draft.isUserSelectable,
            isSystemGenerated: draft.isSystemGenerated,
            isActive: draft.isActive,
            sortOrder: Number(draft.sortOrder || '100'),
            metadata: {},
          },
          aliases: aliases.map((alias) => ({
            id: alias.id,
            alias: alias.alias,
            sortOrder: Number(alias.sortOrder || '100'),
            isActive: alias.isActive,
          })),
          rules: normalizedRules,
        }),
      })

      const payload = (await response.json().catch(() => ({}))) as {
        item?: TerminologyTerm
        error?: string
      }

      if (!response.ok || !payload.item) {
        throw new Error(payload.error ?? 'Kunde inte spara terminologi.')
      }

      const saved = payload.item
      setTerms((current) =>
        [...current.filter((item) => item.id !== saved.id), saved].sort(
          (left, right) =>
            left.groupLabel.localeCompare(right.groupLabel, 'sv') ||
            left.sortOrder - right.sortOrder ||
            left.label.localeCompare(right.label, 'sv')
        )
      )
      setTermDraft(createDraftFromTerm(saved))
      if (aliasTermId === saved.id) setAliasDrafts(createAliasDrafts(saved))
      if (ruleTermId === saved.id) setRuleDrafts(createRuleDrafts(saved))
      return saved
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara terminologi.')
      return null
    } finally {
      setSavingKey(null)
    }
  }

  const openNewTermModal = () => {
    setTermDraft({ ...EMPTY_TERM, groupId: groups[0]?.id ?? '' })
    setTermModalOpen(true)
  }

  const openEditTermModal = (item: TerminologyTerm) => {
    setTermDraft(createDraftFromTerm(item))
    setTermModalOpen(true)
  }

  const saveTermOnly = async () => {
    const existing = termDraft.id ? terms.find((item) => item.id === termDraft.id) ?? null : null
    const saved = await saveBundle(
      termDraft,
      existing ? createAliasDrafts(existing) : [],
      existing ? createRuleDrafts(existing) : [],
      termDraft.id ?? 'new-term'
    )
    if (saved) setTermModalOpen(false)
  }

  const saveAliases = async () => {
    if (!aliasTerm) return
    const saved = await saveBundle(
      createDraftFromTerm(aliasTerm),
      aliasDrafts,
      createRuleDrafts(aliasTerm),
      `aliases:${aliasTerm.id}`
    )
    if (saved) {
      setAliasTermId(saved.id)
      setAliasDrafts(createAliasDrafts(saved))
    }
  }

  const saveRules = async () => {
    if (!ruleTerm) return
    const saved = await saveBundle(
      createDraftFromTerm(ruleTerm),
      createAliasDrafts(ruleTerm),
      ruleDrafts,
      `rules:${ruleTerm.id}`
    )
    if (saved) {
      setRuleTermId(saved.id)
      setRuleDrafts(createRuleDrafts(saved))
    }
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-8 md:px-6 md:pb-10">
      {error ? (
        <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <section className="rounded-[28px] border border-stone-200/80 bg-white/92 p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-stone-900">Terminologi</h3>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              Låst ordförråd, alias och grundregler för RenoApp.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Sök..."
              className="rounded-2xl border border-stone-300 px-4 py-2.5 text-sm text-stone-900"
            />
            <button
              type="button"
              onClick={openNewTermModal}
              className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
            >
              + Ny term
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setGroupFilter('all')}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              groupFilter === 'all'
                ? 'border-stone-900 bg-stone-900 text-white'
                : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-100'
            }`}
          >
            Alla grupper
          </button>
          {groups.map((group) => (
            <button
              key={group.id}
              type="button"
              onClick={() => setGroupFilter(group.id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                groupFilter === group.id
                  ? 'border-stone-900 bg-stone-900 text-white'
                  : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-100'
              }`}
            >
              {group.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="mt-5 rounded-2xl border border-stone-200 bg-stone-50 p-5 text-sm text-stone-600">
            Laddar terminologi...
          </div>
        ) : filteredTerms.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-stone-200 bg-stone-50 p-5 text-sm text-stone-600">
            Inga termer hittades.
          </div>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-stone-500">
                  <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Term</th>
                  <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Kod</th>
                  <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Grupp</th>
                  <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Nivå</th>
                  <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Typ</th>
                  <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Aktiv</th>
                  <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Åtgärder</th>
                </tr>
              </thead>
              <tbody>
                {filteredTerms.map((term) => (
                  <tr key={term.id} className="border-t border-stone-200">
                    <td className="px-3 py-4 align-top">
                      <div className="font-medium text-stone-900">{term.label}</div>
                      <div className="mt-1 max-w-[360px] text-xs text-stone-600">
                        {term.definition || '-'}
                      </div>
                    </td>
                    <td className="px-3 py-4 align-top text-stone-700">
                      <div>{term.code}</div>
                      {term.isLocked ? (
                        <div className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
                          låst
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-4 align-top text-stone-700">{term.groupLabel}</td>
                    <td className="px-3 py-4 align-top text-stone-700">
                      {labelForTermLevel(term.termLevel)}
                    </td>
                    <td className="px-3 py-4 align-top text-stone-700">
                      {labelForInputKind(term.inputKind)}
                    </td>
                    <td className="px-3 py-4 align-top text-stone-700">
                      {term.isActive ? 'Ja' : 'Nej'}
                    </td>
                    <td className="px-3 py-4 align-top">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setAliasTermId(term.id)
                            setAliasDrafts(createAliasDrafts(term))
                          }}
                          className="rounded-xl border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50"
                        >
                          Alias
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRuleTermId(term.id)
                            setRuleDrafts(createRuleDrafts(term))
                          }}
                          className="rounded-xl border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-50"
                        >
                          Regler
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditTermModal(term)}
                          className="rounded-xl border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50"
                        >
                          Editera
                        </button>
                      </div>
                      <div className="mt-2 text-xs text-stone-500">
                        {term.aliases.length} alias · {term.rules.length} regler
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {termModalOpen ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-auto bg-black/40 p-4">
          <div className="w-full max-w-5xl rounded-[28px] border border-stone-200 bg-white p-6 shadow-xl">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-2xl font-semibold text-stone-900">
                  {termDraft.id ? 'Redigera term' : 'Ny term'}
                </h3>
                <p className="mt-1 text-sm text-stone-600">
                  Huvudtermen styr kod, definition och hur ordet används i RenoApp.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setTermModalOpen(false)}
                  className="rounded-xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                >
                  Avbryt
                </button>
                <button
                  type="button"
                  onClick={() => void saveTermOnly()}
                  disabled={savingKey === (termDraft.id ?? 'new-term')}
                  className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:opacity-60"
                >
                  {savingKey === (termDraft.id ?? 'new-term') ? 'Sparar...' : 'Spara'}
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-stone-800">Grupp</span>
                <select
                  value={termDraft.groupId}
                  onChange={(event) =>
                    setTermDraft((current) => ({ ...current, groupId: event.target.value }))
                  }
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                >
                  <option value="">Välj grupp</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-stone-800">Kod</span>
                <input
                  value={termDraft.code || (!termDraft.id ? slugifyTermCode(termDraft.label) : termDraft.code)}
                  readOnly={termDraft.isLocked && Boolean(termDraft.id)}
                  onChange={(event) =>
                    setTermDraft((current) => ({ ...current, code: event.target.value }))
                  }
                  className={`w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm ${
                    termDraft.isLocked && termDraft.id ? 'bg-stone-100 text-stone-700' : ''
                  }`}
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-stone-800">Visningsnamn</span>
                <input
                  value={termDraft.label}
                  onChange={(event) =>
                    setTermDraft((current) => ({ ...current, label: event.target.value }))
                  }
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-stone-800">Sortering</span>
                <input
                  value={termDraft.sortOrder}
                  onChange={(event) =>
                    setTermDraft((current) => ({ ...current, sortOrder: event.target.value }))
                  }
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-stone-800">Termnivå</span>
                <select
                  value={termDraft.termLevel}
                  onChange={(event) =>
                    setTermDraft((current) => ({
                      ...current,
                      termLevel: event.target.value as DraftTerm['termLevel'],
                    }))
                  }
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                >
                  <option value="ux">UX</option>
                  <option value="technical">Teknisk</option>
                  <option value="classification">Klassning</option>
                  <option value="status">Status</option>
                  <option value="document_phase">Dokumentfas</option>
                  <option value="decision">Beslut</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-stone-800">Användning</span>
                <select
                  value={termDraft.inputKind}
                  onChange={(event) =>
                    setTermDraft((current) => ({
                      ...current,
                      inputKind: event.target.value as DraftTerm['inputKind'],
                    }))
                  }
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                >
                  <option value="user_visible">Användarspråk</option>
                  <option value="system_internal">Systemintern</option>
                  <option value="system_generated">Systemgenererad</option>
                </select>
              </label>

              <label className="block md:col-span-2">
                <span className="mb-2 block text-sm font-semibold text-stone-800">Definition</span>
                <textarea
                  value={termDraft.definition}
                  onChange={(event) =>
                    setTermDraft((current) => ({ ...current, definition: event.target.value }))
                  }
                  rows={4}
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                />
              </label>

              <label className="flex items-center gap-3 rounded-2xl border border-stone-300 px-4 py-3 text-sm">
                <input
                  type="checkbox"
                  checked={termDraft.isLocked}
                  disabled={Boolean(termDraft.id && termDraft.isLocked)}
                  onChange={(event) =>
                    setTermDraft((current) => ({ ...current, isLocked: event.target.checked }))
                  }
                />
                Låst huvudterm
              </label>

              <label className="flex items-center gap-3 rounded-2xl border border-stone-300 px-4 py-3 text-sm">
                <input
                  type="checkbox"
                  checked={termDraft.isUserSelectable}
                  onChange={(event) =>
                    setTermDraft((current) => ({
                      ...current,
                      isUserSelectable: event.target.checked,
                    }))
                  }
                />
                Användarvalbar
              </label>

              <label className="flex items-center gap-3 rounded-2xl border border-stone-300 px-4 py-3 text-sm">
                <input
                  type="checkbox"
                  checked={termDraft.isSystemGenerated}
                  onChange={(event) =>
                    setTermDraft((current) => ({
                      ...current,
                      isSystemGenerated: event.target.checked,
                    }))
                  }
                />
                Systemgenererad
              </label>

              <label className="flex items-center gap-3 rounded-2xl border border-stone-300 px-4 py-3 text-sm">
                <input
                  type="checkbox"
                  checked={termDraft.isActive}
                  onChange={(event) =>
                    setTermDraft((current) => ({ ...current, isActive: event.target.checked }))
                  }
                />
                Aktiv
              </label>
            </div>
          </div>
        </div>
      ) : null}

      {aliasTerm ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-auto bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-[28px] border border-stone-200 bg-white p-6 shadow-xl">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-2xl font-semibold text-stone-900">Alias för {aliasTerm.label}</h3>
                <p className="mt-1 text-sm text-stone-600">
                  Alias hjälper er hålla ett tydligt ordförråd utan att skapa dubbla huvudtermer.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setAliasTermId(null)}
                  className="rounded-xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                >
                  Stäng
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setAliasDrafts((current) => [
                      ...current,
                      { alias: '', sortOrder: String(current.length * 10 + 10), isActive: true },
                    ])
                  }
                  className="rounded-xl border border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-50"
                >
                  + Nytt alias
                </button>
                <button
                  type="button"
                  onClick={() => void saveAliases()}
                  disabled={savingKey === `aliases:${aliasTerm.id}`}
                  className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:opacity-60"
                >
                  {savingKey === `aliases:${aliasTerm.id}` ? 'Sparar...' : 'Spara'}
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-3">
              {aliasDrafts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-4 text-sm text-stone-600">
                  Inga alias ännu.
                </div>
              ) : (
                aliasDrafts.map((alias, index) => (
                  <div
                    key={alias.id ?? `alias-${index}`}
                    className="grid gap-3 rounded-2xl border border-stone-200 p-4 md:grid-cols-[1fr_120px_120px_auto]"
                  >
                    <input
                      value={alias.alias}
                      onChange={(event) =>
                        setAliasDrafts((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, alias: event.target.value } : item
                          )
                        )
                      }
                      className="rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                      placeholder="Alias"
                    />
                    <input
                      value={alias.sortOrder}
                      onChange={(event) =>
                        setAliasDrafts((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, sortOrder: event.target.value } : item
                          )
                        )
                      }
                      className="rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                      placeholder="Sortering"
                    />
                    <label className="flex items-center gap-3 rounded-2xl border border-stone-300 px-4 py-3 text-sm">
                      <input
                        type="checkbox"
                        checked={alias.isActive}
                        onChange={(event) =>
                          setAliasDrafts((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, isActive: event.target.checked } : item
                            )
                          )
                        }
                      />
                      Aktivt
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setAliasDrafts((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index)
                        )
                      }
                      className="rounded-xl border border-rose-200 px-4 py-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                    >
                      Ta bort
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {ruleTerm ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-auto bg-black/40 p-4">
          <div className="w-full max-w-5xl rounded-[28px] border border-stone-200 bg-white p-6 shadow-xl">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-2xl font-semibold text-stone-900">Regler för {ruleTerm.label}</h3>
                <p className="mt-1 text-sm text-stone-600">
                  V1-reglerna är lätta nyckel-värdeblock som kan användas som grund för framtida logik.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setRuleTermId(null)}
                  className="rounded-xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                >
                  Stäng
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setRuleDrafts((current) => [
                      ...current,
                      {
                        ruleKey: '',
                        label: '',
                        description: '',
                        configText: '{\n  \n}',
                        sortOrder: String(current.length * 10 + 10),
                        isActive: true,
                      },
                    ])
                  }
                  className="rounded-xl border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-50"
                >
                  + Ny regel
                </button>
                <button
                  type="button"
                  onClick={() => void saveRules()}
                  disabled={savingKey === `rules:${ruleTerm.id}`}
                  className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:opacity-60"
                >
                  {savingKey === `rules:${ruleTerm.id}` ? 'Sparar...' : 'Spara'}
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-4">
              {ruleDrafts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-4 text-sm text-stone-600">
                  Inga regler ännu.
                </div>
              ) : (
                ruleDrafts.map((rule, index) => (
                  <div
                    key={rule.id ?? `rule-${index}`}
                    className="rounded-2xl border border-stone-200 p-4"
                  >
                    <div className="grid gap-3 md:grid-cols-2">
                      <input
                        value={rule.ruleKey}
                        onChange={(event) =>
                          setRuleDrafts((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, ruleKey: event.target.value } : item
                            )
                          )
                        }
                        className="rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                        placeholder="Regelnyckel"
                      />
                      <input
                        value={rule.label}
                        onChange={(event) =>
                          setRuleDrafts((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, label: event.target.value } : item
                            )
                          )
                        }
                        className="rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                        placeholder="Etikett"
                      />
                      <input
                        value={rule.sortOrder}
                        onChange={(event) =>
                          setRuleDrafts((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, sortOrder: event.target.value } : item
                            )
                          )
                        }
                        className="rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                        placeholder="Sortering"
                      />
                      <label className="flex items-center gap-3 rounded-2xl border border-stone-300 px-4 py-3 text-sm">
                        <input
                          type="checkbox"
                          checked={rule.isActive}
                          onChange={(event) =>
                            setRuleDrafts((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, isActive: event.target.checked } : item
                              )
                            )
                          }
                        />
                        Aktiv
                      </label>
                      <textarea
                        value={rule.description}
                        onChange={(event) =>
                          setRuleDrafts((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, description: event.target.value } : item
                            )
                          )
                        }
                        rows={2}
                        className="rounded-2xl border border-stone-300 px-4 py-3 text-sm md:col-span-2"
                        placeholder="Beskrivning"
                      />
                      <textarea
                        value={rule.configText}
                        onChange={(event) =>
                          setRuleDrafts((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, configText: event.target.value } : item
                            )
                          )
                        }
                        rows={8}
                        className="rounded-2xl border border-stone-300 px-4 py-3 font-mono text-xs md:col-span-2"
                        placeholder='{"key":"value"}'
                      />
                    </div>
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={() =>
                          setRuleDrafts((current) =>
                            current.filter((_, itemIndex) => itemIndex !== index)
                          )
                        }
                        className="rounded-xl border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                      >
                        Ta bort
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
