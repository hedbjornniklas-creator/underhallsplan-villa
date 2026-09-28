import {
  createMoistureProject,
  listMoistureProjects,
  requireMoistureRequestContext,
} from '@/lib/moisture/server'
import { moistureErrorResponse, moistureJson, readMoistureBody } from '@/lib/moisture/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const context = await requireMoistureRequestContext(request)
    const projects = await listMoistureProjects(context)
    return moistureJson({ projects })
  } catch (error) {
    return moistureErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireMoistureRequestContext(request)
    const body = await readMoistureBody(request)
    const project = await createMoistureProject(context, body)
    return moistureJson({ project }, 201)
  } catch (error) {
    return moistureErrorResponse(error)
  }
}
