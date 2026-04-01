export type BesiktAppAdminTab =
  | 'docs'
  | 'comps'
  | 'control-points'
  | 'room-types'
  | 'certifications'
  | 'forutsattningar'
  | 'addon-services'

export const BESIKTAPP_ADMIN_TABS: {
  key: BesiktAppAdminTab
  label: string
  description: string
}[] = [
  {
    key: 'docs',
    label: 'Dokumenttyper',
    description: 'Hantera dokumentmallar, etiketter och vilka typer som ska finnas i systemet.',
  },
  {
    key: 'comps',
    label: 'Komponentkatalog',
    description: 'Underhåll komponenttyper, livslängder och grunddata för bedömningar.',
  },
  {
    key: 'room-types',
    label: 'Rumstyper',
    description: 'Bygg upp vilka rumstyper som används i interiöra flöden och kontrollpunkter.',
  },
  {
    key: 'addon-services',
    label: 'Tilläggsuppdrag',
    description: 'Konfigurera tilläggstjänster och extra uppdrag som kan kopplas till arbetet.',
  },
  {
    key: 'certifications',
    label: 'Certifieringar',
    description: 'Styr certifierings- och medlemskapstyper för organisationer och användare.',
  },
  {
    key: 'forutsattningar',
    label: 'Förutsättningar',
    description: 'Redigera antaganden och styrparametrar som används i plattformens logik.',
  },
  {
    key: 'control-points',
    label: 'Kontrollpunkter',
    description: 'Hantera kontrollpunkter, triggers och utfall för besiktningsstödet.',
  },
]

export const RENOAPP_ADMIN_TABS = [
  {
    href: '/admin/renoapp',
    label: 'Översikt',
    description: 'Överblick över onboarding, ansökningsguide och vidare handläggning.',
    match: (pathname: string) => pathname === '/admin/renoapp',
  },
  {
    href: '/admin/renoapp/brf/create',
    label: 'Skapa BRF',
    description: 'Skapa BRF manuellt och skicka första styrelseinviten.',
    match: (pathname: string) => pathname === '/admin/renoapp/brf/create',
  },
  {
    href: '/admin/renoapp/brf-requests',
    label: 'BRF-ansökningar',
    description: 'Granska inkomna BRF-intresseanmälningar.',
    match: (pathname: string) => pathname === '/admin/renoapp/brf-requests',
  },
  {
    href: '/admin/renoapp/action-types',
    label: 'Renoveringstyper',
    description: 'Styr vilka renoveringstyper som visas för boende.',
    match: (pathname: string) => pathname === '/admin/renoapp/action-types',
  },
  {
    href: '/admin/renoapp/questions',
    label: 'Frågor',
    description: 'Bygg upp RenoApps frågebank och återanvändbara svarsalternativ.',
    match: (pathname: string) => pathname === '/admin/renoapp/questions',
  },
  {
    href: '/admin/renoapp/participants',
    label: 'Medverkande',
    description: 'Hantera entreprenörer, konsulter och vilken information som ska samlas in.',
    match: (pathname: string) => pathname === '/admin/renoapp/participants',
  },
  {
    href: '/admin/renoapp/review-flags',
    label: 'Flaggor',
    description: 'Definiera risker och saknade delar som ska lyftas till styrelsen.',
    match: (pathname: string) => pathname === '/admin/renoapp/review-flags',
  },
  {
    href: '/admin/renoapp/document-types',
    label: 'Underlagstyper',
    description: 'Hantera den centrala katalogen av underlag i RenoApp.',
    match: (pathname: string) => pathname === '/admin/renoapp/document-types',
  },
  {
    href: '/admin/renoapp/terminology',
    label: 'Terminologi',
    description: 'Lås och underhåll RenoApps ordlista, alias och grundregler.',
    match: (pathname: string) => pathname === '/admin/renoapp/terminology',
  },
] as const
