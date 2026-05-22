const BASE_ASSIGNMENT_ADDON_KEYS = new Set(['besiktning_av_huvudbyggnad'])

export function isBaseAssignmentAddonKey(key: string | null | undefined) {
  return BASE_ASSIGNMENT_ADDON_KEYS.has(String(key ?? '').trim().toLowerCase())
}

export function isCustomerSelectableAddonKey(key: string | null | undefined) {
  return !isBaseAssignmentAddonKey(key)
}
