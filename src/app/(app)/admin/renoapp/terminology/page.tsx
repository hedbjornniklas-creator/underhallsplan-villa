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

type SortKey = 'label' | 'groupLabel' | 'termLevel' | 'inputKind' | 'aliasCount' | 'isActive'

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

function renderSortIcon(active: boolean, dir: 'asc' | 'desc') {
  if (!active) return <span className="text-gray-300">◇</span>
  return <span className="text-gray-500">{dir === 'asc' ? '↑' : '↓'}</span>
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
  const [groupFilter, setGroupFilter] = useState('')
  const [levelFilter, setLevelFilter] = useState('')
  const [inputFilter, setInputFilter] = useState('')
  const [activeFilter, setActiveFilter] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'groupLabel',
    dir: 'asc',
  })
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

        if (!response.ok) {
          throw new Error(payload.error ?? 'Kunde inte läsa terminologi.')
        }

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

  const sortedTerms = useMemo(() => {
    const filtered = terms.filter((term) => {
      const normalizedQuery = query.trim().toLowerCase()
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

      if (normalizedQuery && !haystack.includes(normalizedQuery)) return false
      if (groupFilter && term.groupId !== groupFilter) return false
      if (levelFilter && term.termLevel !== levelFilter) return false
      if (inputFilter && term.inputKind !== inputFilter) return false
      if (activeFilter === 'active' && !term.isActive) return false
      if (activeFilter === 'inactive' && term.isActive) return false
      return true
    })

    const valueFor = (term: TerminologyTerm) => {
      switch (sort.key) {
        case 'label':
          return term.label
        case 'groupLabel':
          return term.groupLabel
        case 'termLevel':
          return labelForTermLevel(term.termLevel)
        case 'inputKind':
          return labelForInputKind(term.inputKind)
        case 'aliasCount':
          return term.aliases.length
        case 'isActive':
          return term.isActive ? 1 : 0
        default:
          return term.groupLabel
      }
    }

    return [...filtered].sort((left, right) => {
      const leftValue = valueFor(left)
      const rightValue = valueFor(right)
      let comparison = 0

      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        comparison = leftValue - rightValue
      } else {
        comparison = String(leftValue).localeCompare(String(rightValue), 'sv')
      }

      if (comparison === 0) {
        comparison =
          left.groupLabel.localeCompare(right.groupLabel, 'sv') ||
          left.sortOrder - right.sortOrder ||
          left.label.localeCompare(right.label, 'sv')
      }

      return sort.dir === 'asc' ? comparison : -comparison
    })
  }, [activeFilter, groupFilter, inputFilter, levelFilter, query, sort, terms])

  const aliasTerm = aliasTermId ? terms.find((item) => item.id === aliasTermId) ?? null : null
  const ruleTerm = ruleTermId ? terms.find((item) => item.id === ruleTermId) ?? null : null

  const toggleSort = (key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }
    )
  }

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

  const openEditTermModal = (term: TerminologyTerm) => {
    setTermDraft(createDraftFromTerm(term))
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
        <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="rounded-xl bg-white p-4 shadow">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Terminologi</h2>
            <div className="text-xs text-gray-500">renoapp_terminology_terms</div>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Sök..."
              className="border rounded px-2 py-1 text-sm"
            />
            <button
              type="button"
              onClick={openNewTermModal}
              className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white"
            >
              + Ny
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
            <span className="text-gray-400">Sortera:</span>
            {[
              ['label', 'Term'],
              ['groupLabel', 'Grupp'],
              ['termLevel', 'Nivå'],
              ['inputKind', 'Typ'],
              ['aliasCount', 'Alias'],
              ['isActive', 'Aktiv'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => toggleSort(key as SortKey)}
                className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 hover:bg-gray-50"
              >
                {label}
                {renderSortIcon(sort.key === key, sort.dir)}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
            <span className="text-gray-400">Filtrera:</span>
            <select
              className="border rounded-full px-2.5 py-1 bg-white"
              value={groupFilter}
              onChange={(event) => setGroupFilter(event.target.value)}
            >
              <option value="">Grupp</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.label}
                </option>
              ))}
            </select>
            <select
              className="border rounded-full px-2.5 py-1 bg-white"
              value={levelFilter}
              onChange={(event) => setLevelFilter(event.target.value)}
            >
              <option value="">Nivå</option>
              <option value="ux">UX</option>
              <option value="technical">Teknisk</option>
              <option value="classification">Klassning</option>
              <option value="status">Status</option>
              <option value="document_phase">Dokumentfas</option>
              <option value="decision">Beslut</option>
            </select>
            <select
              className="border rounded-full px-2.5 py-1 bg-white"
              value={inputFilter}
              onChange={(event) => setInputFilter(event.target.value)}
            >
              <option value="">Typ</option>
              <option value="user_visible">Användarspråk</option>
              <option value="system_internal">Systemintern</option>
              <option value="system_generated">Systemgenererad</option>
            </select>
            <select
              className="border rounded-full px-2.5 py-1 bg-white"
              value={activeFilter}
              onChange={(event) => setActiveFilter(event.target.value)}
            >
              <option value="">Aktiv</option>
              <option value="active">Endast aktiva</option>
              <option value="inactive">Endast inaktiva</option>
            </select>
          </div>

          <div className="space-y-2">
            <table className="w-full table-fixed border-separate border-spacing-y-2 text-[11px]">
              <thead>
                <tr className="whitespace-nowrap text-left text-[10px] uppercase text-gray-400">
                  <th className="w-[22%] px-3 py-1">Term</th>
                  <th className="w-[14%] px-3 py-1">Kod</th>
                  <th className="w-[16%] px-3 py-1">Grupp</th>
                  <th className="w-[10%] px-3 py-1">Nivå</th>
                  <th className="w-[12%] px-3 py-1">Typ</th>
                  <th className="w-[8%] px-3 py-1">Alias</th>
                  <th className="w-[6%] px-3 py-1">Aktiv</th>
                  <th className="w-[12%] px-3 py-1 text-center">Åtgärder</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="py-4 text-xs text-gray-500" colSpan={8}>
                      Laddar terminologi...
                    </td>
                  </tr>
                ) : sortedTerms.length === 0 ? (
                  <tr>
                    <td className="py-4 text-xs text-gray-500" colSpan={8}>
                      Inga rader.
                    </td>
                  </tr>
                ) : (
                  sortedTerms.map((term) => (
                    <tr key={term.id} className="group transition-colors hover:bg-blue-50">
                      <td className="rounded-l-xl border border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                        <div className="truncate font-medium text-gray-900">{term.label}</div>
                        <div className="truncate text-[10px] text-gray-500">
                          {term.definition || '-'}
                        </div>
                      </td>
                      <td className="border-y border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                        <div className="truncate">{term.code}</div>
                        {term.isLocked ? (
                          <div className="text-[10px] uppercase tracking-[0.12em] text-gray-400">
                            låst
                          </div>
                        ) : null}
                      </td>
                      <td className="border-y border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                        <div className="truncate">{term.groupLabel}</div>
                      </td>
                      <td className="border-y border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                        <div className="truncate">{labelForTermLevel(term.termLevel)}</div>
                      </td>
                      <td className="border-y border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                        <div className="truncate">{labelForInputKind(term.inputKind)}</div>
                      </td>
                      <td className="border-y border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                        <div className="truncate">{term.aliases.length}</div>
                      </td>
                      <td className="border-y border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                        <div className="truncate">{term.isActive ? 'Ja' : 'Nej'}</div>
                      </td>
                      <td className="rounded-r-xl border border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                        <div className="grid grid-cols-3 gap-1 whitespace-nowrap text-[11px]">
                          <button
                            type="button"
                            onClick={() => {
                              setAliasTermId(term.id)
                              setAliasDrafts(createAliasDrafts(term))
                            }}
                            className="w-full rounded-md border border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100"
                          >
                            Alias
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRuleTermId(term.id)
                              setRuleDrafts(createRuleDrafts(term))
                            }}
                            className="w-full rounded-md border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                          >
                            Regler
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditTermModal(term)}
                            className="w-full rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                          >
                            Editera
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {termModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-xl bg-white p-4 shadow-lg">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">
                  {termDraft.id ? 'Redigera term' : 'Ny term'}
                </h3>
                {termDraft.id ? (
                  <div className="mt-1 text-xs text-gray-500">Kod: {termDraft.code}</div>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTermModalOpen(false)}
                  className="rounded-md border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
                >
                  Avbryt
                </button>
                <button
                  type="button"
                  onClick={() => void saveTermOnly()}
                  disabled={savingKey === (termDraft.id ?? 'new-term')}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {savingKey === (termDraft.id ?? 'new-term') ? 'Sparar...' : 'Spara'}
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <div className="text-xs font-medium text-gray-600">Grupp</div>
                <select
                  value={termDraft.groupId}
                  onChange={(event) =>
                    setTermDraft((current) => ({ ...current, groupId: event.target.value }))
                  }
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">Välj grupp</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <div className="text-xs font-medium text-gray-600">Kod</div>
                <input
                  value={termDraft.code || (!termDraft.id ? slugifyTermCode(termDraft.label) : termDraft.code)}
                  readOnly={Boolean(termDraft.id && termDraft.isLocked)}
                  onChange={(event) =>
                    setTermDraft((current) => ({ ...current, code: event.target.value }))
                  }
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="space-y-1">
                <div className="text-xs font-medium text-gray-600">Visningsnamn</div>
                <input
                  value={termDraft.label}
                  onChange={(event) =>
                    setTermDraft((current) => ({ ...current, label: event.target.value }))
                  }
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="space-y-1">
                <div className="text-xs font-medium text-gray-600">Sortering</div>
                <input
                  value={termDraft.sortOrder}
                  onChange={(event) =>
                    setTermDraft((current) => ({ ...current, sortOrder: event.target.value }))
                  }
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="space-y-1">
                <div className="text-xs font-medium text-gray-600">Nivå</div>
                <select
                  value={termDraft.termLevel}
                  onChange={(event) =>
                    setTermDraft((current) => ({
                      ...current,
                      termLevel: event.target.value as DraftTerm['termLevel'],
                    }))
                  }
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="ux">UX</option>
                  <option value="technical">Teknisk</option>
                  <option value="classification">Klassning</option>
                  <option value="status">Status</option>
                  <option value="document_phase">Dokumentfas</option>
                  <option value="decision">Beslut</option>
                </select>
              </label>

              <label className="space-y-1">
                <div className="text-xs font-medium text-gray-600">Typ</div>
                <select
                  value={termDraft.inputKind}
                  onChange={(event) =>
                    setTermDraft((current) => ({
                      ...current,
                      inputKind: event.target.value as DraftTerm['inputKind'],
                    }))
                  }
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="user_visible">Användarspråk</option>
                  <option value="system_internal">Systemintern</option>
                  <option value="system_generated">Systemgenererad</option>
                </select>
              </label>

              <label className="space-y-1 md:col-span-2">
                <div className="text-xs font-medium text-gray-600">Definition</div>
                <textarea
                  value={termDraft.definition}
                  onChange={(event) =>
                    setTermDraft((current) => ({ ...current, definition: event.target.value }))
                  }
                  rows={4}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div className="mt-4 grid gap-2 md:grid-cols-4">
              <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={termDraft.isLocked}
                  disabled={Boolean(termDraft.id && termDraft.isLocked)}
                  onChange={(event) =>
                    setTermDraft((current) => ({ ...current, isLocked: event.target.checked }))
                  }
                />
                Låst
              </label>
              <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm">
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
              <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm">
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
              <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm">
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
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-xl bg-white p-4 shadow-lg">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">Alias - {aliasTerm.label}</h3>
                <div className="mt-1 text-xs text-gray-500">{aliasTerm.code}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAliasTermId(null)}
                  className="rounded-md border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
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
                  className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm text-blue-800 hover:bg-blue-100"
                >
                  + Nytt alias
                </button>
                <button
                  type="button"
                  onClick={() => void saveAliases()}
                  disabled={savingKey === `aliases:${aliasTerm.id}`}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {savingKey === `aliases:${aliasTerm.id}` ? 'Sparar...' : 'Spara'}
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {aliasDrafts.length === 0 ? (
                <div className="rounded-md border border-dashed border-gray-300 px-3 py-4 text-sm text-gray-500">
                  Inga alias ännu.
                </div>
              ) : (
                aliasDrafts.map((alias, index) => (
                  <div
                    key={alias.id ?? `alias-${index}`}
                    className="grid gap-2 rounded-md border border-gray-200 p-3 md:grid-cols-[1fr_120px_120px_auto]"
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
                      className="rounded-md border border-gray-300 px-3 py-2 text-sm"
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
                      className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                      placeholder="Sortering"
                    />
                    <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm">
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
                      className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 hover:bg-rose-100"
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
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-4">
          <div className="w-full max-w-5xl rounded-xl bg-white p-4 shadow-lg">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">Regler - {ruleTerm.label}</h3>
                <div className="mt-1 text-xs text-gray-500">{ruleTerm.code}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRuleTermId(null)}
                  className="rounded-md border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
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
                  className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-100"
                >
                  + Ny regel
                </button>
                <button
                  type="button"
                  onClick={() => void saveRules()}
                  disabled={savingKey === `rules:${ruleTerm.id}`}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {savingKey === `rules:${ruleTerm.id}` ? 'Sparar...' : 'Spara'}
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {ruleDrafts.length === 0 ? (
                <div className="rounded-md border border-dashed border-gray-300 px-3 py-4 text-sm text-gray-500">
                  Inga regler ännu.
                </div>
              ) : (
                ruleDrafts.map((rule, index) => (
                  <div key={rule.id ?? `rule-${index}`} className="rounded-md border border-gray-200 p-3">
                    <div className="grid gap-2 md:grid-cols-2">
                      <input
                        value={rule.ruleKey}
                        onChange={(event) =>
                          setRuleDrafts((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, ruleKey: event.target.value } : item
                            )
                          )
                        }
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm"
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
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm"
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
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                        placeholder="Sortering"
                      />
                      <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm">
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
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-2"
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
                        rows={7}
                        className="rounded-md border border-gray-300 px-3 py-2 font-mono text-xs md:col-span-2"
                        placeholder='{"key":"value"}'
                      />
                    </div>
                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() =>
                          setRuleDrafts((current) =>
                            current.filter((_, itemIndex) => itemIndex !== index)
                          )
                        }
                        className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 hover:bg-rose-100"
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
