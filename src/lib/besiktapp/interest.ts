import 'server-only'
import { createHash } from 'node:crypto'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'
import { isInterestEmail, validateInterestSubmission, type InterestSubmission } from './interestContracts'

const MAX_BODY_BYTES = 16_384
const WINDOW_MS = 10 * 60_000

function deliverySettings() {
  const to = process.env.BESIKTAPP_INTEREST_TO?.trim()
  const from = process.env.ASSIGNMENTS_MAIL_FROM?.trim()
  if (!to || !isInterestEmail(to) || !from || /[\r\n]/.test(from) || !process.env.RESEND_API_KEY?.trim()) return null
  const fromAddress = /<([^<>]+)>$/.exec(from)?.[1] ?? from
  if (!isInterestEmail(fromAddress)) return null
  return { to, from }
}

export function isBesiktInterestAvailable(): boolean {
  return deliverySettings() !== null
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

export function interestEmailContent(value: InterestSubmission) {
  const lines = [
    ['Namn', value.name], ['E-post', value.email], ['Företag', value.company || 'Ej angivet'],
    ['Telefon', value.phone || 'Ej angivet'], ['Meddelande', value.message || 'Ej angivet'],
  ]
  return {
    subject: 'Ny intresseanmälan för BesiktApp',
    text: lines.map(([label, text]) => `${label}: ${text}`).join('\n\n'),
    html: `<h1>Intresse för BesiktApp</h1>${lines.map(([label, text]) => `<p><strong>${label}</strong><br>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`).join('')}`,
  }
}

// A bounded, instance-local brake, not a distributed rate limiter. Add an edge/WAF
// rule before exposing the form to a larger campaign; see docs/PUBLIC_PRODUCT_PAGES.md.
export function createInterestRateLimit() {
  const clients = new Map<string, { count: number; until: number }>()
  let total = { count: 0, until: 0 }
  return (client: string, now = Date.now()) => {
    if (total.until <= now) total = { count: 0, until: now + WINDOW_MS }
    for (const [key, entry] of clients) if (entry.until <= now) clients.delete(key)
    if (total.count >= 30) return false
    const entry = clients.get(client) ?? { count: 0, until: now + WINDOW_MS }
    if (entry.count >= 5 || (!clients.has(client) && clients.size >= 2000)) return false
    entry.count += 1
    total.count += 1
    clients.set(client, entry)
    return true
  }
}
const permitSubmission = createInterestRateLimit()

function reply(body: object, status: number) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...(status === 429 ? { 'Retry-After': '600' } : {}) } })
}

async function boundedJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES || !request.body) throw new Error('BODY_LIMIT')
  const reader = request.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > MAX_BODY_BYTES) { await reader.cancel(); throw new Error('BODY_LIMIT') }
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
    return JSON.parse(text)
  } finally { reader.releaseLock() }
}

export async function handleBesiktInterest(request: Request): Promise<Response> {
  if (request.headers.get('origin') !== new URL(request.url).origin) return reply({ error: 'Öppna formuläret på HusHubs webbplats och försök igen.' }, 403)
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return reply({ error: 'Formuläret kunde inte läsas.' }, 415)
  let body: unknown
  try { body = await boundedJson(request) } catch { return reply({ error: 'Formuläret är för stort eller kunde inte läsas.' }, 400) }
  const validated = validateInterestSubmission(body)
  if (!validated.ok) return reply({ error: validated.message, field: validated.field }, 400)
  const settings = deliverySettings()
  if (!settings) {
    console.error('[besiktapp.interest] delivery configuration missing or invalid')
    return reply({ error: 'Intresseformuläret är tillfälligt stängt. Försök igen senare.' }, 503)
  }
  // Trust only the Vercel-managed header in that environment. Else share a local bucket.
  const clientAddress = process.env.VERCEL === '1' ? request.headers.get('x-vercel-forwarded-for') ?? 'unknown' : 'local'
  const clientKey = createHash('sha256').update(clientAddress).digest('hex')
  if (!permitSubmission(clientKey)) return reply({ error: 'För många försök. Vänta tio minuter och försök igen.' }, 429)
  const value = validated.value
  const content = interestEmailContent(value)
  const fingerprint = createHash('sha256').update(JSON.stringify({ ...content, ...settings, replyTo: value.email })).digest('hex')
  try {
    const result = await sendAssignmentEmail({
      ...settings, ...content, replyTo: value.email,
      idempotencyKey: `besiktapp-interest/${value.submissionId}/${fingerprint}`,
    })
    if (!result.providerMessageId?.trim()) throw new Error('MISSING_PROVIDER_ID')
    return reply({ ok: true }, 200)
  } catch {
    console.error('[besiktapp.interest] email delivery not confirmed')
    return reply({ error: 'Vi kunde inte bekräfta att anmälan skickades. Dina uppgifter finns kvar. Försök igen.' }, 502)
  }
}
