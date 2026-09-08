import { createRoot } from 'react-dom/client'
import EbRemediationPortalClient from '../../src/components/eb/EbRemediationPortalClient'
import type { EbRemediationWorkspace } from '../../src/lib/eb/remediation'

// Synthetic workspace served by the isolated local UI harness.
async function mount() {
  const response = await fetch('/mock-workspace')
  const workspace = await response.json() as EbRemediationWorkspace
  createRoot(document.getElementById('root')!).render(
    <EbRemediationPortalClient initialWorkspace={workspace} endpoint="/mock-portal" />,
  )
}
void mount()
