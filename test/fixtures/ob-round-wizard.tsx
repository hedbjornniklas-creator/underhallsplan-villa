import type { ObSectionKey } from '../../src/components/ob/ObWizard'
import MobileRoundFixture from './ob-mobile-round'
import { useObBuilding } from '../../src/components/ob/ObBuildingContext'

// Observe dispatch from the real inspection page, without mounting unrelated report steps.
export default function PreviewWizard({ activeSection, inspection, onOpenStepMenu }: {
  activeSection: ObSectionKey
  inspection: { id: string }
  onOpenStepMenu?: () => void
}) {
  const building = useObBuilding()?.part
  if (activeSection === 'runda-ny' && new URLSearchParams(location.search).has('history-integration')) {
    return <MobileRoundFixture key={building?.id} onOpenStepMenu={onOpenStepMenu} buildingName={building?.name}
      storageKey={building ? `fixture-notes:${building.id}` : undefined} />
  }
  return <section data-selected-ob-section={activeSection} data-inspection-id={inspection.id} data-building-id={building?.id}>
    <button aria-label="Öppna stegmeny" onClick={onOpenStepMenu}>Stegmeny</button>
  </section>
}
