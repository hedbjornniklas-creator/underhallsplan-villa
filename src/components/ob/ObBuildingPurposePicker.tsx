'use client'

import { useId, useRef, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { BUILDING_PURPOSE_SOURCE, buildingCategoryLabel, findBuildingPurposes, type BuildingCategory } from '@/lib/buildings/buildingPurpose'

export default function ObBuildingPurposePicker({ categories, value, onChange }: {
  categories: BuildingCategory[]; value: string | null; onChange: (value: string | null) => void
}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null)
  const [expanded, setExpanded] = useState(false), [search, setSearch] = useState(''), [limit, setLimit] = useState(10)
  const selected = categories.find(row => row.key === value)
  const results = findBuildingPurposes(categories, search)
  const choose = (key: string | null) => { onChange(key); setExpanded(false); trigger.current?.focus() }
  return <div className="min-w-0">
    <span id={`${id}-label`} className="block text-sm">Byggnadsändamål <span className="text-gray-500">(valfritt)</span></span>
    <button ref={trigger} type="button" aria-labelledby={`${id}-label ${id}-value`} aria-expanded={expanded} aria-controls={`${id}-options`}
      className="obm-input mt-2 flex w-full items-center justify-between gap-3 text-left"
      onClick={() => { setExpanded(!expanded); setSearch(''); setLimit(10) }}>
      <span id={`${id}-value`} className="min-w-0 break-words">{buildingCategoryLabel(categories, value) ?? 'Ej angivet'}</span>
      <ChevronDown size={20} className="shrink-0" />
    </button>
    {selected && <p className="mt-2 break-words text-xs text-gray-500">
      {selected.catalogue_entry ? `${selected.catalogue_entry.path.slice(0, -1).join(' / ')}${selected.catalogue_entry.path.length > 1 ? ' · ' : ''}Version ${selected.catalogue_entry.version}` : 'Tidigare kategori'}
    </p>}
    {expanded && <div id={`${id}-options`} className="mt-3 min-w-0" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setExpanded(false); trigger.current?.focus() }
    }}>
      <div className="relative">
        <Search size={20} className="pointer-events-none absolute left-3 top-4 text-gray-500" />
        <input autoFocus type="search" aria-label="Sök byggnadsändamål" placeholder="Sök byggnadsändamål" className="obm-input w-full !pl-10"
          value={search} onChange={event => { setSearch(event.target.value); setLimit(20) }} />
      </div>
      <fieldset className="mt-2 min-w-0 divide-y divide-gray-200" aria-label="Välj byggnadsändamål">
        <label className="flex min-h-12 cursor-pointer items-center gap-3 py-3">
          <input type="radio" name={id} checked={value === null} onChange={() => choose(null)} /><span>Ej angivet</span>
        </label>
        {selected && !selected.catalogue_entry && <label className="flex min-h-12 cursor-pointer items-center gap-3 py-3">
          <input type="radio" name={id} checked onChange={() => choose(selected.key)} />
          <span className="min-w-0 break-words">{selected.label}<small className="block text-gray-500">Tidigare kategori</small></span>
        </label>}
        {results.slice(0, limit).map(row => <label key={row.key} className="flex min-h-12 cursor-pointer items-center gap-3 py-3">
          <input type="radio" name={id} checked={value === row.key} onChange={() => choose(row.key)} />
          <span className="min-w-0 break-words"><span className="block font-medium">{row.label}</span>
            <small className="block text-gray-500">{row.catalogue_entry!.path.slice(0, -1).join(' / ') || row.catalogue_entry!.label}</small>
          </span>
        </label>)}
      </fieldset>
      {!results.length && <p className="py-3 text-sm text-gray-500">Inga matchande ändamål.</p>}
      {results.length > limit && <button type="button" className="min-h-11 text-sm text-blue-700" onClick={() => setLimit(results.length)}>
        Visa alla {results.length} ändamål
      </button>}
    </div>}
    <p className="mt-2 text-xs text-gray-500">Katalog: <a className="underline" href={BUILDING_PURPOSE_SOURCE} target="_blank" rel="noreferrer">Boverkets Ändamålskatalog</a>. Val anges av besiktningsmannen.</p>
  </div>
}
