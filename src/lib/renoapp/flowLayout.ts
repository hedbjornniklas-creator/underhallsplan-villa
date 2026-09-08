import { flextree } from 'd3-flextree'
import type { FlowOccurrence } from './flowEditor'

export const FLOW_CARD_WIDTH = 224
export const FLOW_CARD_INITIAL_HEIGHT = 117
export const FLOW_COLUMN_GAP = 40
export const FLOW_LAYOUT_VERSION = 'v2'

export function layoutFlow(rows: FlowOccurrence[], heights: Record<string, number>) {
  const positions = new Map<string, { x: number; y: number }>()
  if (!rows.length) return positions
  const children = new Map<string, FlowOccurrence[]>()
  for (const row of rows) if (row.parentId) children.set(row.parentId, [...(children.get(row.parentId) ?? []), row])
  const height = (row: FlowOccurrence) => heights[row.id] ?? FLOW_CARD_INITIAL_HEIGHT
  // Rotate the tidy tree to read left-to-right. Each branch is packed using the
  // actual card heights instead of distributing its children across global ranks.
  const layout = flextree<FlowOccurrence>({
    children: row => children.get(row.id),
    nodeSize: node => [height(node.data), FLOW_CARD_WIDTH + FLOW_COLUMN_GAP],
    spacing: (a, b) => a.parent === b.parent ? 16 : 24,
  })
  const tree = layout.hierarchy(rows[0])
  layout(tree)
  const nodes = tree.descendants()
  const top = Math.min(...nodes.map(node => node.x - height(node.data) / 2))
  for (const node of nodes) positions.set(node.data.id, {
    x: node.y + 16,
    y: node.x - height(node.data) / 2 - top + 16,
  })
  return positions
}
