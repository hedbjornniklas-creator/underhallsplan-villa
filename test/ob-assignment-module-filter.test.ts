import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

type AssignmentRoute = {
  GET: () => Promise<Response>
}

function loadRoute(items: Array<{ id: string; assignment_type: string }>) {
  const file = 'src/app/api/ob/assignments/route.ts'
  const output = ts.transpileModule(
    readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'),
    {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }
  ).outputText
  const compiled = { exports: {} }
  const issueCalls: string[][] = []

  new Function('require', 'module', 'exports', output)(
    (name: string) => {
      if (name === 'next/server') {
        return { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } }
      }
      if (name === '@/lib/assignments/linkIncidents') {
        return {
          listAssignmentLinkIssues: async (_orgId: string, assignmentIds: string[]) => {
            issueCalls.push(assignmentIds)
            return { available: true, items: [] }
          },
        }
      }
      if (name === '@/lib/assignments/server') {
        return {
          listAssignmentsByOrg: async () => items,
          requireOrgContext: async () => ({ orgId: 'org-1', orgName: 'Organisation' }),
        }
      }
      throw new Error(`Unexpected dependency: ${name}`)
    },
    compiled,
    compiled.exports
  )

  return { route: compiled.exports as AssignmentRoute, issueCalls }
}

test('the OB assignment list excludes every other module assignment type', async () => {
  const { route, issueCalls } = loadRoute([
    { id: 'ob-1', assignment_type: 'OB' },
    { id: 'tu-1', assignment_type: 'TU' },
    { id: 'eb-1', assignment_type: 'EB' },
    { id: 'status-1', assignment_type: 'STATUS' },
    { id: 'uhp-1', assignment_type: 'UHP' },
  ])

  const response = await route.GET()
  const payload = await response.json() as { items: Array<{ id: string }> }

  assert.equal(response.status, 200)
  assert.deepEqual(payload.items.map((item) => item.id), ['ob-1'])
  assert.deepEqual(issueCalls, [['ob-1']])
})
