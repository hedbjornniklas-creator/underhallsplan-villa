import { createRoot } from 'react-dom/client'
import Accept from '../../src/app/accept/[token]/page'
import List from '../../src/app/(dashboard)/ob/assignments/page'
import Details from '../../src/app/(dashboard)/ob/assignments/[id]/page'
const path = window.location.pathname
createRoot(document.getElementById('root')!).render(path === '/list' ? <List /> : path === '/details' ? <Details /> : <Accept />)
