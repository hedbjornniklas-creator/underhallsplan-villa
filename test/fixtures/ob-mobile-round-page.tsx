import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import MobileRoundFixture from './ob-mobile-round'

const params = new URLSearchParams(location.search)
const props = params.has('extra-building')
  ? { buildingName: 'Garage', storageKey: params.has('status') ? 'fixture-notes:status:garage' : 'fixture-notes:garage' }
  : params.has('status') ? { storageKey: 'fixture-notes:status' } : {}
createRoot(document.getElementById('root')!).render(
  new URLSearchParams(location.search).has('strict')
    ? <StrictMode><MobileRoundFixture {...props} /></StrictMode>
    : <MobileRoundFixture {...props} />,
)
