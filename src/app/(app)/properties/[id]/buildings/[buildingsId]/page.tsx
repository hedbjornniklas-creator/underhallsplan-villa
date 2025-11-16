'use client'

import Protected from '@/components/Protected'
import { supabase } from '@/lib/supabaseClient'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type Building = { id: string; name: string }

type ComponentRow = {
  id: string
  name: string
  status: string | null
  installed_year: number | null
  lifecycle_years: number | null
  last_action_date: string | null
  notes: string | null
}

type Disclosure = { id: string; title: string; content: string | null; link_url: string | null }

/** Nya typer för basinfon */
type BasicField = {
  id: string
  key: string
  label: string
  field_type: 'number' | 'boolean' | 'select' | 'text'
  options: any | null
  field_group: string | null
  is_critical: boolean | null
  order_index: number | null
}

type BasicValue = {
  id: string
  field_id: string
  value_text: string | null
}

export default function BuildingPage() {
  const { id, buildingId } = useParams() as { id: string; buildingId: string }
  const router = useRouter()

  const [building, setBuilding] = useState<Building | null>(null)

  // Handlingar & upplysningar
  const [disclosures, setDisclosures] = useState<Disclosure[]>([])
  const [newDisclosureTitle, setNewDisclosureTitle] = useState('')
  const [newDisclosureContent, setNewDisclosureContent] = useState('')

  // Basinfon (ny modell)
  const [basicFields, setBasicFields] = useState<BasicField[]>([])
  const [basicValues, setBasicValues] = useState<BasicValue[]>([])
  const [savingFieldId, setSavingFieldId] = useState<string | null>(null)

  // Delete state för byggnad
  const [deleting, setDeleting] = useState(false)

  // -------------------- LOAD --------------------
  useEffect(() => {
    loadBuilding()
    loadDisclosures()
    loadBasicFieldsAndValues()
  }, [buildingId])

  const loadBuilding = async () => {
    const { data } = await supabase
      .from('buildings')
      .select('id,name')
      .eq('id', buildingId)
      .single()
    if (data) setBuilding(data)
  }

  const loadDisclosures = async () => {
    const { data } = await supabase
      .from('building_disclosures')
      .select('*')
      .eq('building_id', buildingId)
      .order('created_at', { ascending: false })
    if (data) setDisclosures(data as Disclosure[])
  }

  const loadBasicFieldsAndValues = async () => {
    // 1) Hämta fält (global mall)
    const { data: fieldsData, error: fieldsError } = await supabase
      .from('basic_fields')
      .select(
        'id, key, label, field_type, options, field_group, is_critical, order_index'
      )
      .eq('is_active', true)
      .order('field_group', { ascending: true })
      .order('order_index', { ascending: true })

    if (fieldsError) {
      alert(fieldsError.message)
      return
    }

    setBasicFields((fieldsData ?? []) as BasicField[])

    // 2) Hämta värden för denna byggnad
    const { data: valuesData, error: valuesError } = await supabase
      .from('building_basic_values')
      .select('id, field_id, value_text')
      .eq('building_id', buildingId)

    if (valuesError) {
      alert(valuesError.message)
      return
    }

    setBasicValues((valuesData ?? []) as BasicValue[])
  }

  // -------------------- BASINFO – HELPERS --------------------

  const getValueForField = (fieldId: string): string => {
    const v = basicValues.find(bv => bv.field_id === fieldId)
    return v?.value_text ?? ''
  }

  const saveBasicValue = async (field: BasicField, rawValue: string) => {
    const value = rawValue.trim()
    setSavingFieldId(field.id)

    const payload = {
      building_id: buildingId,
      field_id: field.id,
      value_text: value === '' ? null : value,
    }

    const { data, error } = await supabase
      .from('building_basic_values')
      .upsert(payload, {
        onConflict: 'building_id,field_id',
      })
      .select('id, field_id, value_text')
      .single()

    setSavingFieldId(null)

    if (error) {
      alert(error.message)
      return
    }

    const row = data as BasicValue

    setBasicValues(prev => {
      const existing = prev.find(v => v.field_id === field.id)
      if (existing) {
        return prev.map(v =>
          v.field_id === field.id
            ? { ...v, value_text: row.value_text }
            : v
        )
      }
      return [...prev, row]
    })
  }

  // Enkel flagga: vilka kritiska fält saknar värde?
  const missingCriticalCount = useMemo(() => {
    return basicFields.filter(f => {
      if (!f.is_critical) return false
      const v = basicValues.find(x => x.field_id === f.id)
      return !v || !v.value_text || v.value_text.trim() === ''
    }).length
  }, [basicFields, basicValues])

  // Dela upp fält i tre grupper: Bas, Utsida, Insida
  const baseFields = useMemo(
    () =>
      basicFields.filter(
        f => f.field_group !== 'Utsida' && f.field_group !== 'Insida'
      ),
    [basicFields]
  )

  const outsideFields = useMemo(
    () => basicFields.filter(f => f.field_group === 'Utsida'),
    [basicFields]
  )

  const insideFields = useMemo(
    () => basicFields.filter(f => f.field_group === 'Insida'),
    [basicFields]
  )

  // -------------------- ADD NEW --------------------
  const addDisclosure = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newDisclosureTitle.trim()) return
    const { data, error } = await supabase
      .from('building_disclosures')
      .insert({
        building_id: buildingId,
        title: newDisclosureTitle.trim(),
        content: newDisclosureContent.trim() || null,
      })
      .select('*')
      .single()
    if (error) return alert(error.message)
    setDisclosures(prev => [data as Disclosure, ...prev])
    setNewDisclosureTitle('')
    setNewDisclosureContent('')
  }

  // -------------------- DELETE BUILDING --------------------
  const deleteBuilding = async () => {
    if (!building) return
    const ok = confirm(
      `Är du säker på att du vill ta bort byggnaden "${building.name}"? Detta går inte att ångra.`
    )
    if (!ok) return

    try {
      setDeleting(true)

      // Här förutsätter vi att ev. child-tabeller hanteras med ON DELETE CASCADE i databasen.
      const { error } = await supabase
        .from('buildings')
        .delete()
        .eq('id', buildingId)

      if (error) {
        alert('Kunde inte ta bort byggnaden: ' + error.message)
        return
      }

      // Tillbaka till fastighetssidan
      router.push(`/properties/${id}`)
    } finally {
      setDeleting(false)
    }
  }

  // -------------------- RENDER --------------------
  return (
    <Protected>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs text-gray-500">
              <Link href={`/properties/${id}`} className="underline">
                ← Till fastighet
              </Link>
            </div>
            <h1 className="text-xl md:text-2xl font-semibold mt-1">
              {building?.name ?? 'Byggnad'}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            {missingCriticalCount > 0 && (
              <div className="text-xs md:text-sm text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1 rounded-lg">
                ⚠ {missingCriticalCount} kritiska basinformationsfält saknar värde.
              </div>
            )}

            <button
              onClick={deleteBuilding}
              disabled={deleting}
              className="text-xs md:text-sm px-3 py-2 rounded border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {deleting ? 'Tar bort…' : 'Ta bort byggnad'}
            </button>
          </div>
        </div>

        {/* 1. HANDLINGAR & UPPLYSNINGAR */}
        <div className="bg-white rounded-xl shadow p-4 space-y-3">
          <h2 className="font-semibold">Handlingar & upplysningar</h2>
          {disclosures.length === 0 ? (
            <div className="text-sm text-gray-600">Inga upplysningar än.</div>
          ) : (
            <ul className="space-y-1">
              {disclosures.map(d => (
                <li key={d.id}>
                  <div className="font-medium">{d.title}</div>
                  {d.content && (
                    <div className="text-xs text-gray-500">{d.content}</div>
                  )}
                  {d.link_url && (
                    <a
                      href={d.link_url}
                      target="_blank"
                      className="text-xs text-emerald-700 underline"
                    >
                      Visa dokument
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={addDisclosure} className="border-t pt-3 space-y-2">
            <input
              className="border rounded px-2 py-1 text-sm w-full"
              placeholder="Titel"
              value={newDisclosureTitle}
              onChange={e => setNewDisclosureTitle(e.target.value)}
            />
            <textarea
              className="border rounded px-2 py-1 text-sm w-full"
              placeholder="Beskrivning"
              value={newDisclosureContent}
              onChange={e => setNewDisclosureContent(e.target.value)}
            />
            <button className="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded">
              + Lägg till
            </button>
          </form>
        </div>

        {/* 2. BASINFORMATION */}
        <div className="bg-white rounded-xl shadow p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Basinformation</h2>
            {missingCriticalCount > 0 && (
              <span className="text-xs text-amber-700">
                ⚠ Fyll i saknade kritiska fält
              </span>
            )}
          </div>

          {basicFields.length === 0 ? (
            <div className="text-sm text-gray-600">
              Inga basinformationsfält är definierade ännu. Lägg upp dem under
              Settings → Basinformationsfält.
            </div>
          ) : baseFields.length === 0 ? (
            <div className="text-sm text-gray-600">
              Inga fält är kopplade till Basinformations-rutan (fält där
              field_group inte är "Utsida" eller "Insida").
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {baseFields.map(field => {
                const value = getValueForField(field.id)
                const isMissingCritical =
                  field.is_critical && (!value || value.trim() === '')

                let options: string[] = []
                if (Array.isArray(field.options)) {
                  options = field.options as string[]
                }

                return (
                  <div key={field.id} className="space-y-1">
                    <div className="flex items-center gap-1 text-xs text-gray-700">
                      <span className="font-medium">{field.label}</span>
                      {field.is_critical && (
                        <span className="text-[10px] text-amber-700">
                          (kritisk)
                        </span>
                      )}
                      {isMissingCritical && (
                        <span className="text-[10px] text-amber-700">⚠</span>
                      )}
                    </div>

                    {field.field_type === 'number' && (
                      <input
                        type="number"
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={value}
                        onChange={e =>
                          saveBasicValue(field, e.target.value)
                        }
                      />
                    )}

                    {field.field_type === 'text' && (
                      <input
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={value}
                        onChange={e =>
                          saveBasicValue(field, e.target.value)
                        }
                      />
                    )}

                    {field.field_type === 'boolean' && (
                      <select
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={value || ''}
                        onChange={e =>
                          saveBasicValue(field, e.target.value)
                        }
                      >
                        <option value="">Välj…</option>
                        {(options.length ? options : ['Ja', 'Nej', 'Okänt']).map(
                          opt => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          )
                        )}
                      </select>
                    )}

                    {field.field_type === 'select' && (
                      <select
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={value || ''}
                        onChange={e =>
                          saveBasicValue(field, e.target.value)
                        }
                      >
                        <option value="">Välj…</option>
                        {options.map(opt => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    )}

                    {savingFieldId === field.id && (
                      <div className="text-[10px] text-gray-400">
                        Sparar…
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 3. UTSIDA */}
        <div className="bg-white rounded-xl shadow p-4 space-y-3">
          <h2 className="font-semibold">Utsida</h2>

          {outsideFields.length === 0 ? (
            <div className="text-sm text-gray-600">
              Inga fält är definierade för Utsida (field_group = "Utsida").
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {outsideFields.map(field => {
                const value = getValueForField(field.id)
                const isMissingCritical =
                  field.is_critical && (!value || value.trim() === '')

                let options: string[] = []
                if (Array.isArray(field.options)) {
                  options = field.options as string[]
                }

                return (
                  <div key={field.id} className="space-y-1">
                    <div className="flex items-center gap-1 text-xs text-gray-700">
                      <span className="font-medium">{field.label}</span>
                      {field.is_critical && (
                        <span className="text-[10px] text-amber-700">
                          (kritisk)
                        </span>
                      )}
                      {isMissingCritical && (
                        <span className="text-[10px] text-amber-700">⚠</span>
                      )}
                    </div>

                    {field.field_type === 'number' && (
                      <input
                        type="number"
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={value}
                        onChange={e =>
                          saveBasicValue(field, e.target.value)
                        }
                      />
                    )}

                    {field.field_type === 'text' && (
                      <input
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={value}
                        onChange={e =>
                          saveBasicValue(field, e.target.value)
                        }
                      />
                    )}

                    {field.field_type === 'boolean' && (
                      <select
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={value || ''}
                        onChange={e =>
                          saveBasicValue(field, e.target.value)
                        }
                      >
                        <option value="">Välj…</option>
                        {(options.length ? options : ['Ja', 'Nej', 'Okänt']).map(
                          opt => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          )
                        )}
                      </select>
                    )}

                    {field.field_type === 'select' && (
                      <select
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={value || ''}
                        onChange={e =>
                          saveBasicValue(field, e.target.value)
                        }
                      >
                        <option value="">Välj…</option>
                        {options.map(opt => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    )}

                    {savingFieldId === field.id && (
                      <div className="text-[10px] text-gray-400">
                        Sparar…
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 4. INSIDA */}
        <div className="bg-white rounded-xl shadow p-4 space-y-3">
          <h2 className="font-semibold">Insida</h2>

          {insideFields.length === 0 ? (
            <div className="text-sm text-gray-600">
              Inga fält är definierade för Insida (field_group = "Insida").
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {insideFields.map(field => {
                const value = getValueForField(field.id)
                const isMissingCritical =
                  field.is_critical && (!value || value.trim() === '')

                let options: string[] = []
                if (Array.isArray(field.options)) {
                  options = field.options as string[]
                }

                return (
                  <div key={field.id} className="space-y-1">
                    <div className="flex items-center gap-1 text-xs text-gray-700">
                      <span className="font-medium">{field.label}</span>
                      {field.is_critical && (
                        <span className="text-[10px] text-amber-700">
                          (kritisk)
                        </span>
                      )}
                      {isMissingCritical && (
                        <span className="text-[10px] text-amber-700">⚠</span>
                      )}
                    </div>

                    {field.field_type === 'number' && (
                      <input
                        type="number"
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={value}
                        onChange={e =>
                          saveBasicValue(field, e.target.value)
                        }
                      />
                    )}

                    {field.field_type === 'text' && (
                      <input
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={value}
                        onChange={e =>
                          saveBasicValue(field, e.target.value)
                        }
                      />
                    )}

                    {field.field_type === 'boolean' && (
                      <select
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={value || ''}
                        onChange={e =>
                          saveBasicValue(field, e.target.value)
                        }
                      >
                        <option value="">Välj…</option>
                        {(options.length ? options : ['Ja', 'Nej', 'Okänt']).map(
                          opt => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          )
                        )}
                      </select>
                    )}

                    {field.field_type === 'select' && (
                      <select
                        className="border rounded px-2 py-1 text-sm w-full"
                        value={value || ''}
                        onChange={e =>
                          saveBasicValue(field, e.target.value)
                        }
                      >
                        <option value="">Välj…</option>
                        {options.map(opt => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    )}

                    {savingFieldId === field.id && (
                      <div className="text-[10px] text-gray-400">
                        Sparar…
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </Protected>
  )
}
