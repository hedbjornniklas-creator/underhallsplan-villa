import DashboardV1Client, { type ModuleCardData } from './DashboardV1Client'
import { hasCurrentUserAccess } from '@/lib/access/server'

const MODULE_CATALOG: Array<
  ModuleCardData & { moduleKey: 'inspections' | 'construction_inspections' | 'technical_investigations' }
> = [
  {
    id: 'ob',
    moduleKey: 'inspections',
    title: 'Överlåtelsebesiktning',
    description:
      'Skapa och hantera överlåtelsebesiktningar med fokus på ett enkelt operativt flöde.',
    href: '/ob',
    accentClass: 'from-indigo-500 to-sky-400',
    badgeClass: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  },
  {
    id: 'eb',
    moduleKey: 'construction_inspections',
    title: 'Entreprenadbesiktning',
    description:
      'Samla entreprenadobjekt, kallelser och slutbesiktningar i ett grönt BesiktApp-flöde.',
    href: '/eb',
    accentClass: 'from-emerald-500 to-lime-400',
    badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
  {
    id: 'tu',
    moduleKey: 'technical_investigations',
    title: 'Tekniska utredningar',
    description:
      'Hantera uppdragsbekräftelser och utlåtanden för tekniska utredningar i ett fristående lila flöde.',
    href: '/tu',
    accentClass: 'from-violet-600 to-fuchsia-400',
    badgeClass: 'border-violet-200 bg-violet-50 text-violet-700',
  },
]

export default async function DashboardV1Page() {
  const accessResults = await Promise.all(
    MODULE_CATALOG.map((module) =>
      hasCurrentUserAccess({ productKey: 'dashboard', moduleKey: module.moduleKey })
    )
  )
  const modules = MODULE_CATALOG.filter((_, index) => accessResults[index]).map((module) => ({
    id: module.id,
    title: module.title,
    description: module.description,
    href: module.href,
    accentClass: module.accentClass,
    badgeClass: module.badgeClass,
  }))

  return <DashboardV1Client modules={modules} />
}
