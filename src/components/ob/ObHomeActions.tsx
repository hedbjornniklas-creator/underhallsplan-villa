'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ClipboardPlus, FilePlus2, Send } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { useToast } from '@/components/ui/AppToastProvider'
import './ob-home.css'

type PropertySeedRow = {
  id: string
  owner: string | null
  created_at: string | null
  name: string
  address: string | null
  postal_code: string | null
  city: string | null
  municipality: string | null
  cadastral_id: string | null
  owner_name: string | null
  client_name: string | null
  contact_person: string | null
  tenure_type: string | null
  dwelling_type: string | null
  property_type: string | null
  plot_area_m2: number | null
  area_m2: number | null
  area_sqm: number | null
  tax_value: number | null
  planning_status: string | null
  type_code: string | null
  heating: string | null
  ventilation: string | null
  roof_type: string | null
  year_built: number | null
  cover_path: string | null
  status: string | null
  last_inspected: string | null
  last_inspection_at: string | null
}


type ObSnapshotClient = {
  from: (table: 'ob_property_snapshot') => {
    upsert: (payload: Record<string, unknown>, options: { onConflict: string }) => Promise<{ error: unknown | null }>
  }
}

function CreateInspectionButton() {
  const router = useRouter()
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  const buildSnapshotPayload = (inspectionId: string, propertyData: PropertySeedRow) => ({
    inspection_id: inspectionId,
    source_property_id: propertyData.id,
    source_property_owner: propertyData.owner ?? null,
    source_property_created_at: propertyData.created_at ?? null,
    imported_at: new Date().toISOString(),
    snapshot_version: 1,
    name: propertyData.name ?? null,
    address: propertyData.address ?? null,
    postal_code: propertyData.postal_code ?? null,
    city: propertyData.city ?? null,
    municipality: propertyData.municipality ?? null,
    cadastral_id: propertyData.cadastral_id ?? null,
    owner_name: propertyData.owner_name ?? null,
    client_name: propertyData.client_name ?? null,
    contact_person: propertyData.contact_person ?? null,
    tenure_type: propertyData.tenure_type ?? null,
    dwelling_type: propertyData.dwelling_type ?? null,
    property_type: propertyData.property_type ?? null,
    plot_area_m2: propertyData.plot_area_m2 ?? null,
    area_m2: propertyData.area_m2 ?? null,
    area_sqm: propertyData.area_sqm ?? null,
    tax_value: propertyData.tax_value ?? null,
    planning_status: propertyData.planning_status ?? null,
    type_code: propertyData.type_code ?? null,
    heating: propertyData.heating ?? null,
    ventilation: propertyData.ventilation ?? null,
    roof_type: propertyData.roof_type ?? null,
    year_built: propertyData.year_built ?? null,
    cover_path: propertyData.cover_path ?? null,
    status: propertyData.status ?? null,
    last_inspected: propertyData.last_inspected ?? null,
    last_inspection_at: propertyData.last_inspection_at ?? null,
  })

  const handleCreateFromScratch = async () => {
    if (creating) return

    try {
      setCreating(true)

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError) throw userError
      if (!user) {
        router.replace('/login')
        return
      }

      const today = new Date().toISOString().slice(0, 10)
      const short = Math.random().toString(36).slice(2, 6).toUpperCase()
      const tempName = `Fastighet ${today} ${short}`

      const { data: propertyData, error: propertyError } = await supabase
        .from('properties')
        .insert({
          owner: user.id,
          name: tempName,
          status: 'Utkast',
        })
        .select(
          'id,owner,created_at,name,address,postal_code,city,municipality,cadastral_id,owner_name,client_name,contact_person,tenure_type,dwelling_type,property_type,plot_area_m2,area_m2,area_sqm,tax_value,planning_status,type_code,heating,ventilation,roof_type,year_built,cover_path,status,last_inspected,last_inspection_at'
        )
        .single()

      if (propertyError || !propertyData) {
        throw propertyError ?? new Error('Kunde inte skapa fastighet.')
      }

      const sourceProperty = propertyData as PropertySeedRow

      const { data: inspectionData, error: inspectionError } = await supabase
        .from('inspections')
        .insert({
          property_id: sourceProperty.id,
          type: 'OB',
          inspection_family: 'OB',
          inspection_variant: 'OB',
          status: 'draft',
        })
        .select('id')
        .single()

      if (inspectionError || !inspectionData) {
        throw inspectionError ?? new Error('Kunde inte skapa besiktning.')
      }

      const { error: conditionsError } = await supabase
        .from('inspection_conditions')
        .insert({
          inspection_id: inspectionData.id,
          furnishing_level: 'fullt_moblerad',
        })

      if (conditionsError) {
        await supabase.from('inspections').delete().eq('id', inspectionData.id)
        await supabase.from('properties').delete().eq('id', sourceProperty.id)
        throw conditionsError
      }

      const snapshotClient = supabase as unknown as ObSnapshotClient
      const { error: snapshotError } = await snapshotClient
        .from('ob_property_snapshot')
        .upsert(buildSnapshotPayload(inspectionData.id, sourceProperty), {
          onConflict: 'inspection_id',
        })

      if (snapshotError) {
        await supabase.from('inspections').delete().eq('id', inspectionData.id)
        await supabase.from('properties').delete().eq('id', sourceProperty.id)
        throw snapshotError
      }

      router.push(`/properties/${sourceProperty.id}/ob/${inspectionData.id}`)
    } catch (error) {
      console.error('Could not create inspection from scratch:', error)
      toast.error('Kunde inte skapa ny besiktning. Försök igen.')
    } finally {
      setCreating(false)
    }
  }


  return <button type="button" className="obh-primary" disabled={creating} onClick={() => void handleCreateFromScratch()}>
    <ClipboardPlus size={18} aria-hidden="true" />
    <span>{creating ? 'Skapar besiktning...' : 'Skapa ny besiktning'}</span>
  </button>
}

function QuickSend({ onSent }: { onSent: () => void }) {
  type QuickOrdererRole = 'seller' | 'buyer' | 'apartment' | ''

  const [email, setEmail] = useState('')
  const [ordererRole, setOrdererRole] = useState<QuickOrdererRole>('')
  const [preferredDate, setPreferredDate] = useState('')
  const [preferredTime, setPreferredTime] = useState('')
  const [priceAmount, setPriceAmount] = useState('')
  const [isSending, setIsSending] = useState(false)
  const toast = useToast()
  const [createdLink, setCreatedLink] = useState<string | null>(null)

  const handleQuickSend = async () => {
    if (isSending) return
    const normalized = email.trim().toLowerCase()
    const normalizedPrice = priceAmount.trim()

    if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      toast.error('Ange en giltig mejladress.')
      return
    }

    if (!ordererRole) {
      toast.error('V\u00e4lj uppdragsgivare (S\u00e4ljare, K\u00f6pare eller L\u00e4genhet).')
      return
    }

    if (!normalizedPrice) {
      toast.error('Pris är obligatoriskt innan utskick.')
      return
    }

    const parsedPrice = Number(normalizedPrice.replace(',', '.'))
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      toast.error('Ange ett giltigt pris.')
      return
    }

    try {
      setIsSending(true)
      setCreatedLink(null)

      const response = await fetch('/api/ob/assignments/quick-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerEmail: normalized,
          ordererRole,
          preferredDate: preferredDate.trim(),
          preferredTime: preferredTime.trim(),
          priceAmount: normalizedPrice,
        }),
      })

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string
        acceptUrl?: string
      }

      if (!response.ok) {
        if (payload.acceptUrl) {
          setCreatedLink(payload.acceptUrl)
          toast.error('Bekräftelsen skapades, men mejlet kunde inte skickas.')
          onSent()
        } else {
          toast.error(payload.error ?? 'Kunde inte skicka uppdragsbekräftelse.')
        }
        return
      }

      setEmail('')
      setPreferredDate('')
      setPreferredTime('')
      setPriceAmount('')
      toast.success('Uppdragsbekräftelse skickad.')
      onSent()
    } catch {
      toast.error('Kunde inte skicka uppdragsbekräftelse.')
    } finally {
      setIsSending(false)
    }
  }


  return <form className="obh-quick-form" onSubmit={event => { event.preventDefault(); void handleQuickSend() }}>
    <fieldset disabled={isSending}>
      <legend>Uppdragsgivare</legend>
      <div className="obh-roles">
        {([{ value: 'seller', label: 'Säljare' }, { value: 'buyer', label: 'Köpare' }, { value: 'apartment', label: 'Lägenhet' }] as const).map(role =>
          <label key={role.value}>
            <input type="radio" name="quick-orderer" value={role.value} checked={ordererRole === role.value}
              onChange={() => setOrdererRole(role.value)} required />
            <span>{role.label}</span>
          </label>)}
      </div>
    </fieldset>
    <label className="obh-email">Kundens e-post
      <input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)}
        placeholder="kund@epost.se" required disabled={isSending} />
    </label>
    <label>Datum
      <input type="date" value={preferredDate} onChange={event => setPreferredDate(event.target.value)} disabled={isSending} />
    </label>
    <label>Tid
      <input type="time" value={preferredTime} onChange={event => setPreferredTime(event.target.value)} disabled={isSending} />
    </label>
    <label>Pris (SEK)
      <input type="text" inputMode="decimal" value={priceAmount} onChange={event => setPriceAmount(event.target.value)}
        placeholder="0" required disabled={isSending} />
    </label>
    <button type="submit" className="obh-primary" disabled={isSending}>
      <Send size={18} aria-hidden="true" /><span>{isSending ? 'Skickar...' : 'Skicka bekräftelse'}</span>
    </button>
    {createdLink && <p className="obh-feedback">Bekräftelsen är skapad. <a href={createdLink} target="_blank" rel="noopener noreferrer">Öppna kundlänk</a></p>}
  </form>
}

export default function ObHomeActions({ onSent }: { onSent: () => void }) {
  return <section className="obh" aria-label="Skapa ÖB-uppdrag">
    <div className="obh-actions">
      <CreateInspectionButton />
      <Link href="/ob/assignments/new"><FilePlus2 size={18} aria-hidden="true" /><span>Skapa uppdragsbekräftelse</span></Link>
      <nav aria-label="Separata listor" className="obh-list-links">
        <Link href="/ob/assignments">Uppdragsbekräftelser</Link>
        <Link href="/inspections">Besiktningar</Link>
      </nav>
    </div>
    <details className="obh-quick">
      <summary><Send size={18} aria-hidden="true" /><span>Snabbskicka uppdragsbekräftelse</span><ChevronDown size={18} aria-hidden="true" /></summary>
      <QuickSend onSent={onSent} />
    </details>
  </section>
}
