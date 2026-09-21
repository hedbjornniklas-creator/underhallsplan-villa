export async function GET(_request, { params }) {
  const { id, operation } = await params
  if (id !== 'synthetic-mobile-inspection') return Response.json({ error: 'Synthetic inspection only' }, { status: 404 })
  if (operation === 'assignment-workflow') return Response.json({ workflow: null })
  if (operation === 'addon-orders') return Response.json({ addonOrders: [] })
  if (operation !== 'buildings') return Response.json({ error: 'Unexpected read' }, { status: 404 })
  await new Promise(resolve => setTimeout(resolve, 250))
  return Response.json({ data: {
    available: true, structure: { inspection_id: id, primary_part_id: 'main', revision: 1 },
    parts: ['main', 'guest'].map((part, index) => ({
      id: part, inspection_id: id, building_id: `building-${part}`, name: index ? 'Gästhus' : 'Huvudbyggnad',
      category_key: null, cover_path: null, scope_note: null, sort_order: index, revision: 1, floor_model: null,
    })), buildings: [], categories: [],
  } })
}
