import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import MobileRoundFixture from './ob-mobile-round'

createRoot(document.getElementById('root')!).render(
  new URLSearchParams(location.search).has('strict')
    ? <StrictMode><MobileRoundFixture /></StrictMode>
    : <MobileRoundFixture />,
)
