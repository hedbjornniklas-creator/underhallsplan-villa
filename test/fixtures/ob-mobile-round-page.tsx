import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import MobileRoundFixture from './ob-mobile-round'

const props = new URLSearchParams(location.search).has('extra-building')
  ? { buildingName: 'Garage', storageKey: 'fixture-notes:garage' } : {}
createRoot(document.getElementById('root')!).render(
  new URLSearchParams(location.search).has('strict')
    ? <StrictMode><MobileRoundFixture {...props} /></StrictMode>
    : <MobileRoundFixture {...props} />,
)
