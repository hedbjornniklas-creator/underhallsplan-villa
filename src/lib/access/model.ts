export const PLATFORM_PRODUCT_KEYS = ['renoapp', 'dashboard', 'hushub_admin'] as const

export type PlatformProductKey = (typeof PLATFORM_PRODUCT_KEYS)[number]

export const PLATFORM_SCOPE_TYPES = ['global', 'brf', 'organization', 'property', 'case'] as const

export type PlatformScopeType = (typeof PLATFORM_SCOPE_TYPES)[number]

export const PLATFORM_MODULE_KEYS = {
  renoapp: ['board_portal', 'case_review', 'admin'] as const,
  dashboard: [
    'home',
    'inspections',
    'construction_inspections',
    'technical_investigations',
    'maintenance_plan',
    'reports',
    'admin',
  ] as const,
  hushub_admin: ['landing', 'besiktapp_admin', 'renoapp_admin', 'access_management'] as const,
} as const

export type PlatformModuleKeyMap = {
  [K in keyof typeof PLATFORM_MODULE_KEYS]: (typeof PLATFORM_MODULE_KEYS)[K][number]
}

export type PlatformModuleKey = PlatformModuleKeyMap[PlatformProductKey]
