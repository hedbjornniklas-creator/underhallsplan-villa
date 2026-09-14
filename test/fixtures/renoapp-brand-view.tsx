import { createRoot } from 'react-dom/client'
import RenoAppHeader from '../../src/components/renoapp/RenoAppHeader'
import RenoAppPublicHeader from '../../src/components/renoapp/RenoAppPublicHeader'
import { PublicSessionProvider } from '../../src/components/public/PublicSession'
import PasswordAuthPanel from '../../src/components/auth/PasswordAuthPanel'
import Overview from '../../src/app/renoapp/app/page'
import Brf from '../../src/app/renoapp/app/brf/page'
import Users from '../../src/app/renoapp/app/users/page'
import Invite from '../../src/app/renoapp/invite/[token]/page'

const path = location.pathname
const login = path.endsWith('/login')
const legacy = path === '/legacy'
const page = path.endsWith('/brf') ? <Brf /> : path.endsWith('/users') ? <Users /> : <Overview />
createRoot(document.getElementById('root')!).render(legacy ? <PasswordAuthPanel /> : (
  <div className="renoapp-scope">
    {login ? <PublicSessionProvider><div className="public-site"><RenoAppPublicHeader />
      <main id="public-content" className="public-auth"><h1>Logga in i RenoApp</h1><PasswordAuthPanel accent="renoapp" /></main>
    </div></PublicSessionProvider> : <><RenoAppHeader />{path.includes('/invite/') ? <Invite /> : <main className="reno-portal-main">{page}</main>}</>}
  </div>
))
