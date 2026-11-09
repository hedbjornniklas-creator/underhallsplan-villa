import { createRoot } from 'react-dom/client'
import Topbar from '../../src/components/Topbar'
import UppdragScope from '../../src/components/tasks/UppdragScope'
import Loading from '../../src/app/(dashboard)/uppdrag/loading'

function Fixture() {
  return <><Topbar /><UppdragScope external><div className="mx-auto max-w-4xl px-5 py-6">
    <h1 className="text-2xl font-semibold">Projekt</h1>
    <div className="mt-6 border-y border-[#D5DCDD] py-4"><strong>Fiktivt testprojekt</strong><p className="mt-1 text-sm text-[#596368]">Anna Exempel</p></div>
    <Loading />
    <a className="text-[#206961] underline" href="/mina-uppdrag">Mina uppdrag</a>
  </div></UppdragScope></>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
