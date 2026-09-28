import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AppToastProvider } from '@/components/ui/AppToastProvider'
import MoistureDashboardClient from '@/components/moisture/MoistureDashboardClient'
import MoistureProjectClient from '@/components/moisture/MoistureProjectClient'
import type { MoistureOptions, MoistureProject } from '@/lib/moisture/domain'

const ORG = '11111111-1111-4111-8111-111111111111'
const PROPERTY = '22222222-2222-4222-8222-222222222222'
const BUILDING = '33333333-3333-4333-8333-333333333333'
const CUSTOMER = '44444444-4444-4444-8444-444444444444'
const PROJECT = '55555555-5555-4555-8555-555555555555'
const property = { id: PROPERTY, name: 'Exempelfastigheten', address: 'Exempelgatan 10', cadastralId: 'EXEMPELBYN 2:14', municipality: 'Exempelkommun', postalCode: '123 45', city: 'Exempelstad' }
const building = { id: BUILDING, name: 'Huvudbyggnad' }
const customer = { id: CUSTOMER, name: 'Exempelbolaget AB', customerNumber: '1001' }
let project: MoistureProject = {
  id: PROJECT, orgId: ORG, title: 'Fuktinventering inför ombyggnad', description: 'Undersökning av källare och anslutande byggnadsdelar.',
  scopes: ['inventory', 'design'], pricingMode: 'hourly', status: 'draft', revision: 1,
  createdAt: '2026-09-28T09:00:00Z', updatedAt: '2026-09-28T09:00:00Z',
  customerId: CUSTOMER, propertyId: PROPERTY, property, customer, buildings: [building],
}
const options: MoistureOptions = { properties: [{ ...property, buildings: [building] }], customers: [customer] }
const state = {
  mode: 'success', requests: [] as Array<{ method: string; url: string; body: Record<string, unknown> }>, navigation: '',
  setMode(mode: string) { state.mode = mode },
}
Object.assign(window, { __moistureTest: state })
window.addEventListener('preview-navigation', event => { state.navigation = (event as CustomEvent<string>).detail })

window.fetch = async (input, init) => {
  const url = String(input)
  if (!url.startsWith('/api/moisture/')) throw Error('Only the synthetic moisture API is available.')
  const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
  state.requests.push({ method: init?.method ?? 'GET', url, body })
  if (state.mode === 'network') throw Error('Synthetic connection failure')
  if (state.mode === 'conflict') return Response.json({ error: 'Uppdraget har ändrats. Ladda om innan du sparar igen.' }, { status: 409 })
  if (state.mode === 'validation') return Response.json({ error: 'Kontrollera uppgifterna i formuläret.', fieldErrors: { title: 'Kontrollera projektnamnet.' } }, { status: 400 })
  const inputProperty = body.property as { mode?: string } | undefined
  const chosenProperty = inputProperty?.mode === 'new' ? { ...property, ...inputProperty, id: PROPERTY } : property
  const newNames = body.newBuildings as string[] ?? []
  project = {
    ...project, ...body, id: String(body.projectId ?? project.id),
    property: chosenProperty, propertyId: PROPERTY,
    customer: body.customerId ? customer : null,
    buildings: [...(Array.isArray(body.buildingIds) && body.buildingIds.includes(BUILDING) ? [building] : []), ...newNames.map((name, index) => ({ id: `66666666-6666-4666-8666-${String(index).padStart(12, '0')}`, name }))],
    revision: init?.method === 'PATCH' ? project.revision + 1 : 1,
  } as MoistureProject
  return Response.json({ project }, { status: init?.method === 'PATCH' ? 200 : 201 })
}
const query = new URLSearchParams(window.location.search)
const empty = query.has('empty')
function Preview() {
  const [view, setView] = useState(query.has('detail') ? 'detail' : query.has('register') ? 'register' : 'list')
  useEffect(() => {
    const navigate = (event: Event) => {
      const path = String((event as CustomEvent<string>).detail).split('?')[0]
      setView(path.startsWith('/fuktsakerhet/projekt/') ? 'detail' : path === '/fuktsakerhet' || path === '/dashboard-v1' ? 'list' : 'register')
      window.scrollTo(0, 0)
    }
    window.addEventListener('preview-navigation', navigate)
    return () => window.removeEventListener('preview-navigation', navigate)
  }, [])
  return <AppToastProvider>
    <div className="synthetic-banner">Förhandsvisning · endast påhittade testuppgifter</div>
    {view === 'register' ? <main className="moisture-workspace"><h1>Registret ingår inte i förhandsvisningen</h1><p>Kund- och fastighetsregister kopplas in i den installerade modulen.</p><Link href="/fuktsakerhet">Till förhandsvisningen</Link></main> : view === 'detail'
      ? <MoistureProjectClient orgId={ORG} orgName="Exempel Konsult AB" initialProject={project} options={options} />
      : <MoistureDashboardClient orgId={ORG} orgName="Exempel Konsult AB" initialProjects={empty ? [] : [project]} options={empty ? { properties: [], customers: [] } : options} />}
  </AppToastProvider>
}
createRoot(document.getElementById('root')!).render(<Preview />)
