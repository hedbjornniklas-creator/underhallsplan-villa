'use client'

import Image from 'next/image'
import { ArrowLeft, CircleDot, FileText, FolderOpen, MapPin, Send } from 'lucide-react'
import type { ReactNode } from 'react'
import PendingLink from '@/components/ui/PendingLink'
import './moisture.css'

export const SCOPE_OPTIONS = [
  { value: 'inventory', label: 'Fuktinventering', description: 'Befintlig byggnad och dess förutsättningar.' },
  { value: 'description', label: 'Fuktsäkerhetsbeskrivning', description: 'Krav, ansvar och planerade kontroller.' },
  { value: 'design', label: 'Projektering med riskvärdering', description: 'Konstruktioner, risker och åtgärder.' },
] as const

export function scopeLabel(value: string) {
  return SCOPE_OPTIONS.find(option => option.value === value)?.label ?? value
}

export function pricingLabel(value: string) {
  return ({ undecided: 'Inte bestämt', fixed: 'Fast pris', hourly: 'Löpande' } as Record<string, string>)[value] ?? value
}

export function statusLabel(value: string) {
  return ({ draft: 'Grunddata', active: 'Pågående', completed: 'Klart', archived: 'Arkiverat' } as Record<string, string>)[value] ?? value
}

export function formatUpdated(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Datum saknas' : date.toLocaleDateString('sv-SE')
}

export function MoistureWorkspace({ orgName, title, description, backHref, backLabel, children }: {
  orgName: string | null
  title: string
  description?: string
  backHref: string
  backLabel: string
  children: ReactNode
}) {
  return <div className="moisture-workspace">
    <header className="moisture-header">
      <div className="moisture-brand-row">
        <Image src="/report-assets/BesiktApp.png" alt="BesiktApp" width={150} height={43} priority />
        <span className="moisture-org">{orgName || 'Arbetsorganisation'}</span>
      </div>
      <PendingLink href={backHref} autoPending pendingLabel="Öppnar …" className="moisture-back" icon={<ArrowLeft size={16} aria-hidden />}>{backLabel}</PendingLink>
      <div className="moisture-heading">
        <p className="moisture-eyebrow">Fuktsäkerhet</p>
        <h1>{title}</h1>
        {description && <p className="moisture-muted">{description}</p>}
      </div>
    </header>
    {children}
  </div>
}

const FUTURE_STEPS = [
  { title: 'Offert och uppdrag', description: 'Pris, omfattning och uppdragsbekräftelse.', icon: FileText },
  { title: 'Handlingar och förberedelse', description: 'Dokument, källor och förslag från AI.', icon: FolderOpen },
  { title: 'Platsbesök', description: 'Observationer, fuktmätningar och bilder.', icon: MapPin },
  { title: 'Dokument och leverans', description: 'Granskning, PDF och länk till beställaren.', icon: Send },
]

export function MoistureGuide() {
  return <aside className="moisture-guide" aria-labelledby="moisture-guide-title">
    <h2 id="moisture-guide-title">Projektets guide</h2>
    <ol>
      <li className="moisture-guide-current" aria-current="step">
        <span className="moisture-step-icon"><CircleDot size={18} aria-hidden /></span>
        <div><strong>Grunddata</strong><p>Kund, fastighet, byggnader och uppdragets omfattning.</p><span className="moisture-step-label">Tillgängligt nu</span></div>
      </li>
      {FUTURE_STEPS.map(({ title, description, icon: Icon }) => <li key={title}>
        <span className="moisture-step-icon"><Icon size={18} aria-hidden /></span>
        <div><strong>{title}</strong><p>{description}</p><span className="moisture-step-label">Ännu inte tillgängligt</span></div>
      </li>)}
    </ol>
  </aside>
}

export type MoistureApiFailure = { message: string; fieldErrors: Record<string, string> }

export function readApiFailure(payload: unknown, fallback: string): MoistureApiFailure {
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const entries = body.fieldErrors && typeof body.fieldErrors === 'object' ? Object.entries(body.fieldErrors) : []
  return {
    message: typeof body.error === 'string' && body.error.trim() ? body.error : fallback,
    fieldErrors: Object.fromEntries(entries.filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
  }
}
