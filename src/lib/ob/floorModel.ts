export type ObFloorLevel = { level: number; name: string }
export type ObFloorModel = { levels: ObFloorLevel[]; revision: number }

export function validFloorLevels(value: unknown): value is ObFloorLevel[] {
  if (!Array.isArray(value) || !value.length || value.length > 64) return false
  const numbers = new Set<number>()
  for (const row of value) {
    if (!row || !Number.isInteger(row.level) || row.level < -99 || row.level > 199 ||
      typeof row.name !== 'string' || row.name.length > 80 || numbers.has(row.level)) return false
    numbers.add(row.level)
  }
  return numbers.has(0)
}

export const levelKey = (level: number) => `plan${level}`
export const floorModelKeys = (model: ObFloorModel) =>
  [...model.levels].sort((a, b) => a.level - b.level).map(row => levelKey(row.level))

export function modelFloorLabel(model: ObFloorModel, key: string): string {
  if (key === 'ovrigt' || key === '\u00f6vrigt') return 'Allm\u00e4nt'
  const row = model.levels.find(item => levelKey(item.level) === key)
  if (!row) return key
  return `Plan ${row.level}${row.name.trim() ? ` \u00b7 ${row.name.trim()}` : ''}`
}

export function modelFloorRank(model: ObFloorModel, key: string): number {
  if (key === 'ovrigt' || key === '\u00f6vrigt') return -1000
  return model.levels.find(row => levelKey(row.level) === key)?.level ?? 1000
}
