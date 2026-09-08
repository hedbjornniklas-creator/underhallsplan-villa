import { createRoot } from 'react-dom/client'
import BesiktInvitationsAdmin from '../../src/components/public/BesiktInvitationsAdmin'
import BesiktInvitationAccept from '../../src/components/public/BesiktInvitationAccept'

createRoot(document.getElementById('root')!).render(window.location.pathname.startsWith('/admin')
  ? <BesiktInvitationsAdmin />
  : <main className="public-main"><BesiktInvitationAccept /></main>)
