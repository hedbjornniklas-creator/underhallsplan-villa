'use client'

import {
  ArrowLeft, Building2, ClipboardCheck, ClipboardList, Droplets,
  FileText, House, Ruler, Send, Settings2,
} from 'lucide-react'
import type { ObSectionKey } from './ObWizard'
import Sheet from './ObRoundSheet'

export type ObMenuSection = { key: ObSectionKey; label: string; partId?: string }

const icons = {
  grunddata: House, handlingar: FileText, forutsattningar: Settings2,
  'runda-ny': ClipboardList, runda: ClipboardList, review: ClipboardCheck,
  delivery: Send, areamatning: Ruler, fuktkontroll: Droplets,
}

export default function ObStepMenu({ sections, buildings, activeIndex, onSelect, onClose, onBack }: {
  sections: ObMenuSection[]
  buildings: { id: string; name: string }[]
  activeIndex: number
  onSelect: (section: ObMenuSection) => void
  onClose: () => void
  onBack: () => void
}) {
  return <Sheet title="Överlåtelsebesiktning" onClose={onClose} className="obm-step-menu"
    footer={<button type="button" className="obm-menu-back" onClick={onBack}>
      <ArrowLeft size={20} />Tillbaka till besiktningar
    </button>}>
    <div className="obm-menu-brand">
      <img src="/report-assets/BesiktApp.png" alt="BesiktApp" width={150} height={43} />
      <span>ÖB</span>
    </div>
    <nav aria-label="Besiktningens steg">
      {sections.map((section, index) => {
        const startsBuilding = section.partId && section.partId !== sections[index - 1]?.partId
        const startsShared = !section.partId && sections[index - 1]?.partId
        const name = buildings.find(building => building.id === section.partId)?.name
        const label = section.partId && section.key === 'forutsattningar' ? 'Förutsättningar'
          : section.partId && section.key === 'runda-ny' ? 'ÖB-runda' : section.label
        const Icon = icons[section.key as keyof typeof icons] ?? FileText
        return <div key={`${section.key}:${section.partId ?? ''}`} className={startsShared ? 'obm-menu-shared' : undefined}>
          {startsBuilding && <h3 className="obm-menu-building"><Building2 size={20} /><span>{name ?? section.label}</span></h3>}
          <button type="button" className="obm-menu-step" aria-current={activeIndex === index ? 'step' : undefined}
            aria-label={section.label} onClick={() => onSelect(section)}>
            <Icon size={20} />
            <span>{label}</span>
            <small>{index + 1}/{sections.length}</small>
          </button>
        </div>
      })}
    </nav>
  </Sheet>
}
