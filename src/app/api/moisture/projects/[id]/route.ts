import {
  getMoistureProject,
  requireMoistureRequestContext,
  updateMoistureProject,
} from '@/lib/moisture/server'
import { moistureErrorResponse, moistureJson, readMoistureBody } from '@/lib/moisture/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, route: RouteContext) {
  try {
    const context = await requireMoistureRequestContext(request)
    const { id } = await route.params
    const project = await getMoistureProject(context, id)
    if (!project) return moistureJson({ error: 'Fuktprojektet kunde inte hittas.' }, 404)
    return moistureJson({ project })
  } catch (error) {
    return moistureErrorResponse(error)
  }
}

export async function PATCH(request: Request, route: RouteContext) {
  try {
    const context = await requireMoistureRequestContext(request)
    const { id } = await route.params
    const body = await readMoistureBody(request)
    const project = await updateMoistureProject(context, id, body)
    return moistureJson({ project })
  } catch (error) {
    return moistureErrorResponse(error)
  }
}
