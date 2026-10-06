export async function GET() {
  return Response.json({ available: true, rows: [], sharedRows: [], revision: 0 })
}
