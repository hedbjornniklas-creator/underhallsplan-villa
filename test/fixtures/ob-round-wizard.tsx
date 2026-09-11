import type { ObSectionKey } from '../../src/components/ob/ObWizard'

// Observe dispatch from the real inspection page, without mounting unrelated report steps.
export default function PreviewWizard({ activeSection, inspection, onOpenStepMenu }: {
  activeSection: ObSectionKey
  inspection: { id: string }
  onOpenStepMenu?: () => void
}) {
  return <section data-selected-ob-section={activeSection} data-inspection-id={inspection.id}>
    <button aria-label="Öppna stegmeny" onClick={onOpenStepMenu}>Stegmeny</button>
  </section>
}
