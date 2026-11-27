import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)

function load<T>(path: string, dependencies: Record<string, unknown>, logs: unknown[][] = []): T {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', 'console', code)(
    (name: string) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
    compiled,
    compiled.exports,
    { error: (...values: unknown[]) => logs.push(values) },
  )
  return compiled.exports as T
}

type LookupOptions = {
  user?: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null
  authError?: unknown
  authThrows?: boolean
  identity?: unknown
  rpcError?: unknown
  rpcThrows?: boolean
}

function lookup(options: LookupOptions = {}) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
  const logs: unknown[][] = []
  let adminClients = 0
  const user = options.user === undefined
    ? { id: 'verified-auth-user', email: 'recipient@example.test', user_metadata: { account_type: 'task_recipient' } }
    : options.user
  const helper = load<{ getCurrentUserRecipientEntryDestination(): Promise<string | null> }>(
    'src/lib/tasks/recipientEntry.ts',
    {
      'server-only': {},
      '@/lib/supabase/server': {
        createSupabaseServerClient: () => ({ auth: { getUser: async () => {
          if (options.authThrows) throw new Error('Synthetic Auth unavailable')
          return { data: { user }, error: options.authError ?? null }
        } } }),
      },
      '@/lib/supabase/admin': {
        createSupabaseAdminClient: () => {
          adminClients++
          return {
            rpc: async (name: string, args: Record<string, unknown>) => {
              assert.equal(name, 'recipient_session_identity', 'Entry must not create accounts, memberships or grants')
              rpcCalls.push({ name, args })
              if (options.rpcThrows) throw new Error('Synthetic database unavailable')
              return { data: options.identity ?? null, error: options.rpcError ?? null }
            },
          }
        },
      },
      './recipientAuthPaths': { RECIPIENT_PORTAL_HOME: '/mina-uppdrag' },
    },
    logs,
  )
  return { ...helper, rpcCalls, logs, adminClients: () => adminClients }
}

test('a verified existing recipient can enter Mina uppdrag without any assigned-task lookup', async () => {
  const fixture = lookup({ identity: 'existing-recipient-identity' })
  assert.equal(await fixture.getCurrentUserRecipientEntryDestination(), '/mina-uppdrag')
  assert.deepEqual(fixture.rpcCalls, [{ name: 'recipient_session_identity', args: { p_auth_user_id: 'verified-auth-user' } }])
  assert.equal(fixture.adminClients(), 1)
  assert.deepEqual(fixture.logs, [])
})

test('no authenticated user or a rejected Auth response never reaches privileged recipient lookup', async () => {
  for (const options of [{ user: null }, { authError: { message: 'Synthetic revoked session' } }, { authThrows: true }]) {
    const fixture = lookup(options)
    assert.equal(await fixture.getCurrentUserRecipientEntryDestination(), null)
    assert.equal(fixture.adminClients(), 0)
    assert.deepEqual(fixture.rpcCalls, [])
  }
})

test('client-controlled account metadata cannot replace the verified recipient identity', async () => {
  const fixture = lookup({
    user: { id: 'real-auth-user', email: 'recipient@example.test', user_metadata: { account_type: 'task_recipient', recipient_identity_id: 'forged-identity', is_admin: true } },
    identity: null,
  })
  assert.equal(await fixture.getCurrentUserRecipientEntryDestination(), null)
  assert.deepEqual(fixture.rpcCalls[0].args, { p_auth_user_id: 'real-auth-user' })
})

test('missing, disabled, unconfirmed or email-mismatched identities rejected by the existing RPC do not redirect', async () => {
  // The service RPC, not task grants or browser claims, owns these checks.
  for (const identity of [null, '', false, 0, [], { id: 'unexpected-payload' }]) {
    const fixture = lookup({ identity })
    assert.equal(await fixture.getCurrentUserRecipientEntryDestination(), null)
  }
})

test('a database error fails closed even if data is also returned, without logging private server details', async () => {
  const fixture = lookup({ identity: 'recipient-id', rpcError: { code: 'SYNTHETIC_FAILURE', message: 'private@example.test secret-context' } })
  assert.equal(await fixture.getCurrentUserRecipientEntryDestination(), null)
  assert.equal(fixture.logs.length, 1)
  assert.doesNotMatch(JSON.stringify(fixture.logs), /private@example|secret-context/)
})

test('a thrown lookup failure retains the normal no-workspace fallback instead of granting access', async () => {
  const fixture = lookup({ rpcThrows: true })
  assert.equal(await fixture.getCurrentUserRecipientEntryDestination(), null)
  assert.equal(fixture.logs.length, 1)
})

type Product = { key: string; href: string; label: string; description: string }
type Element = { type: unknown; props: Record<string, unknown> }

class Redirect extends Error {
  destination: string
  constructor(destination: string) { super(`Redirect: ${destination}`); this.destination = destination }
}

function appEntry(options: { products?: Product[]; recipient?: string | null; productsError?: Error } = {}) {
  let recipientLookups = 0
  const Recovery = () => null
  const stubComponent = () => null
  const appModule = load<{ default(): Promise<Element> }>('src/app/app/page.tsx', {
    'react/jsx-runtime': require('react/jsx-runtime'),
    'next/link': { __esModule: true, default: stubComponent },
    'next/navigation': { redirect: (destination: string) => { throw new Redirect(destination) } },
    'lucide-react': { ArrowRight: stubComponent, Building2: stubComponent, ClipboardCheck: stubComponent, Settings2: stubComponent },
    '@/components/Protected': { __esModule: true, default: stubComponent },
    '@/components/auth/DashboardAccessRecovery': { __esModule: true, default: Recovery },
    '@/lib/auth/returnPath': { authLoginUrl: (destination: string) => `/login?next=${encodeURIComponent(destination)}` },
    '@/lib/auth/serverRecovery': { authRecoveryReason: () => 'unavailable', currentAuthReturnPath: async (fallback: string) => fallback },
    '@/lib/access/server': { getCurrentUserAccessibleProducts: async () => {
      if (options.productsError) throw options.productsError
      return options.products ?? []
    } },
    '@/lib/tasks/recipientEntry': { getCurrentUserRecipientEntryDestination: async () => {
      recipientLookups++
      return options.recipient ?? null
    } },
  })
  return { page: appModule.default, recipientLookups: () => recipientLookups, Recovery }
}

test('generic /app entry redirects an existing recipient with no product workspace straight to Mina uppdrag', async () => {
  const fixture = appEntry({ recipient: '/mina-uppdrag' })
  await assert.rejects(fixture.page(), (error: unknown) => error instanceof Redirect && error.destination === '/mina-uppdrag')
  assert.equal(fixture.recipientLookups(), 1)
})

test('an authenticated account without products or a verified recipient keeps the existing fallback', async () => {
  const fixture = appEntry()
  const element = await fixture.page()
  assert.equal(typeof element.type, 'function')
  assert.equal((element.type as { name: string }).name, 'EmptyWorkspaceState')
  assert.equal(fixture.recipientLookups(), 1)
})

test('single-workspace users retain their normal product destination without recipient lookup', async () => {
  for (const product of [
    { key: 'dashboard', href: '/dashboard-v1', label: 'BesiktApp', description: '' },
    { key: 'renoapp', href: '/renoapp/app', label: 'RenoApp', description: '' },
    { key: 'hushub_admin', href: '/admin', label: 'Administration', description: '' },
  ]) {
    const fixture = appEntry({ products: [product], recipient: '/mina-uppdrag' })
    await assert.rejects(fixture.page(), (error: unknown) => error instanceof Redirect && error.destination === product.href)
    assert.equal(fixture.recipientLookups(), 0)
  }
})

test('users with multiple products keep the workspace selector without recipient lookup', async () => {
  const fixture = appEntry({ products: [
    { key: 'dashboard', href: '/dashboard-v1', label: 'BesiktApp', description: '' },
    { key: 'renoapp', href: '/renoapp/app', label: 'RenoApp', description: '' },
  ], recipient: '/mina-uppdrag' })
  const element = await fixture.page()
  assert.equal(typeof element.type, 'function')
  assert.notEqual((element.type as { name: string }).name, 'EmptyWorkspaceState')
  assert.equal(fixture.recipientLookups(), 0)
})

test('an unauthenticated generic entry preserves the existing login return path', async () => {
  const fixture = appEntry({ productsError: new Error('UNAUTHORIZED'), recipient: '/mina-uppdrag' })
  await assert.rejects(fixture.page(), (error: unknown) => error instanceof Redirect && error.destination === '/login?next=%2Fapp')
  assert.equal(fixture.recipientLookups(), 0)
})

test('technical product lookup failures retain the existing recovery view', async () => {
  const fixture = appEntry({ productsError: new Error('Synthetic product lookup unavailable'), recipient: '/mina-uppdrag' })
  const element = await fixture.page()
  assert.equal(element.type, fixture.Recovery)
  assert.equal(element.props.reason, 'unavailable')
  assert.equal(element.props.returnTo, '/app')
  assert.equal(fixture.recipientLookups(), 0)
})
