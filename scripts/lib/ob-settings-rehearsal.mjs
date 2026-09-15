import { randomUUID } from 'node:crypto'

// Explicit scope shared by schema reproduction and isolated permission probes.
export const settingsTables = [
  'document_types', 'settings_disclosure_items', 'settings_basinfo_fields',
  'settings_condition_options', 'settings_overview_items', 'settings_overview_groups',
  'settings_overview_options', 'settings_exterior_items', 'settings_exterior_groups',
  'settings_exterior_options', 'settings_interior_room_types', 'settings_interior_groups',
  'settings_interior_options', 'settings_control_points', 'settings_control_point_options',
  'settings_text_snippets', 'settings_control_point_outcomes', 'settings_addon_services',
  'settings_certifications',
]

export function settingsProbeRows() {
  const ids = Object.fromEntries(settingsTables.map(table => [table, randomUUID()]))
  const key = 'test_' + randomUUID().replaceAll('-', '')
  const label = 'TEST settings permission'
  const rows = {
    document_types: { code: key, label },
    settings_disclosure_items: { code: key, label },
    settings_basinfo_fields: { code: key, label },
    settings_condition_options: { group_code: key, value_code: key, label },
    settings_overview_items: { key, label },
    settings_overview_groups: { key, label, overview_item_id: ids.settings_overview_items },
    settings_overview_options: { value: key, label, group_id: ids.settings_overview_groups },
    settings_exterior_items: { key, label },
    settings_exterior_groups: { key, label, item_id: ids.settings_exterior_items },
    settings_exterior_options: { value: key, label, group_id: ids.settings_exterior_groups },
    settings_interior_room_types: { key, label },
    settings_interior_groups: { key, label },
    settings_interior_options: { value: key, label, group_id: ids.settings_interior_groups },
    settings_control_points: { key, scope: 'interior', title: label },
    settings_control_point_options: { value: key, label, control_point_id: ids.settings_control_points },
    settings_text_snippets: { code: key, type: 'risk', title: label, text: label },
    settings_control_point_outcomes: { outcome_key: key, label, control_point_id: ids.settings_control_points },
    settings_addon_services: { key, name: label },
    settings_certifications: { key, name: label },
  }
  return Object.fromEntries(settingsTables.map(table => [table, { id: ids[table], ...rows[table], is_active: false }]))
}

export const settingsEditorPaths = [
  '/settings/forutsattningar', '/settings/handlingar-upplysningar',
  '/settings/ob-control-points', '/settings/ob-insida', '/settings/ob-utsida',
]
