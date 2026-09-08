import { createRoot } from 'react-dom/client'
import EbFollowUpOrder from '../../src/components/eb/EbFollowUpOrder'

createRoot(document.getElementById('root')!).render(
  <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
    <h1 className="text-2xl font-semibold">Fastställt utlåtande — lokal testdata</h1>
    <p>Originalrapporten förblir tillgänglig utan köp.</p>
    <EbFollowUpOrder endpoint="/mock-follow-up" />
  </main>,
)
