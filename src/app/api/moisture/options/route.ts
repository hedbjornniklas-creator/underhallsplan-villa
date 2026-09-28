import { getMoistureOptions, requireMoistureRequestContext } from '@/lib/moisture/server'
import { moistureErrorResponse, moistureJson } from '@/lib/moisture/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const context = await requireMoistureRequestContext(request)
    return moistureJson({ options: await getMoistureOptions(context) })
  } catch (error) {
    return moistureErrorResponse(error)
  }
}
