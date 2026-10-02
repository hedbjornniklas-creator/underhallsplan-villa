'use client'

import { createContext, useContext, type RefObject } from 'react'
import { ArrowLeft, Menu } from 'lucide-react'
import ObLocalDraftStatus from './ObLocalDraftStatus'

export const ObInspectionNavigationContext = createContext<{
  address: string
  step: number
  total: number
  onBack: () => void
} | null>(null)

export default function ObInspectionHeader({ inspectionId, title, address, step, total, onBack, onOpenMenu, portalContainer, onDraftOpenChange }: {
  inspectionId: string
  title: string
  address?: string
  step?: number
  total?: number
  onBack?: () => void
  onOpenMenu?: () => void
  portalContainer?: RefObject<HTMLDivElement | null>
  onDraftOpenChange?: (open: boolean) => void
}) {
  const navigation = useContext(ObInspectionNavigationContext)
  const back = onBack ?? navigation?.onBack
  const currentStep = step ?? navigation?.step ?? 0
  const stepCount = total ?? navigation?.total ?? 0
  return <header className="ob-inspection-header">
    {back && <button type="button" className="ob-inspection-back" onClick={back} aria-label="Tillbaka till besiktningar" title="Tillbaka till besiktningar">
      <ArrowLeft size={23} />
    </button>}
    <div className="ob-inspection-heading">
      <p>{navigation?.address || address || 'Besiktning'}{currentStep > 0 && <span> · {currentStep}/{stepCount}</span>}</p>
      <h1>{title}</h1>
    </div>
    <ObLocalDraftStatus key={inspectionId} inspectionId={inspectionId}
      portalContainer={portalContainer} onOpenChange={onDraftOpenChange} />
    {onOpenMenu && <button type="button" className="ob-inspection-menu" onClick={onOpenMenu}
      aria-label="Öppna stegmeny" title="Öppna stegmeny"><Menu size={23} /></button>}
  </header>
}
