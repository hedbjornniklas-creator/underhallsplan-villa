/** Modules whose organization membership and invitation lifecycle is supported. */
export const SUPPORTED_ORGANIZATION_MODULES = ['inspections', 'technical_investigations'] as const

export const ORGANIZATION_MODULE_OPTIONS = [
  { key: 'inspections', label: 'ÖB', name: 'Överlåtelsebesiktning' },
  { key: 'technical_investigations', label: 'TU', name: 'Tekniska utredningar' },
] as const

export function parseOrganizationModules(value: unknown, errorCode = 'ORG_REQUEST_INVALID'): string[] {
  if (!Array.isArray(value) || value.length > SUPPORTED_ORGANIZATION_MODULES.length ||
      value.some(key => !SUPPORTED_ORGANIZATION_MODULES.includes(key)) || new Set(value).size !== value.length) {
    throw new Error(errorCode)
  }
  return [...value].sort()
}

/** An old TU-only form must not silently replace a newer OB+TU permission set. */
export function requireOrganizationModuleSetVersion(value: unknown) {
  if (value !== 2) throw new Error('ORG_MODULE_SELECTION_REFRESH_REQUIRED')
}

export function organizationModuleNames(keys: readonly string[]) {
  return ORGANIZATION_MODULE_OPTIONS.filter(module => keys.includes(module.key))
    .map(module => `${module.name} (${module.label})`).join(', ')
}
