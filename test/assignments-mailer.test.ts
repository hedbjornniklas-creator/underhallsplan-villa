import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { sendAssignmentEmail } from '../src/lib/assignments/mailer.ts'

test('maps PDF attachments to Resend and omits an empty attachment list', async (context) => {
  const previousFetch = globalThis.fetch
  const previousApiKey = process.env.RESEND_API_KEY
  const requests: Array<Record<string, unknown>> = []
  const headers: Headers[] = []

  context.after(() => {
    globalThis.fetch = previousFetch
    if (previousApiKey === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = previousApiKey
  })

  process.env.RESEND_API_KEY = 'test-key'
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
    headers.push(new Headers(init?.headers))
    return new Response(JSON.stringify({ id: 'message-123' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  const result = await sendAssignmentEmail({
    to: 'customer@example.se',
    from: 'HusHub <noreply@example.se>',
    subject: 'Bekräftelse mottagen',
    html: '<p>Klart</p>',
    text: 'Klart',
    idempotencyKey: 'test/one-logical-send',
    attachments: [
      {
        filename: 'Uppdragsbekraftelse-EB-2026-09-03-b617c9ba.pdf',
        contentBase64: 'JVBERi0xLjQ=',
        contentType: 'application/pdf',
      },
    ],
  })

  assert.deepEqual(result, { provider: 'resend', providerMessageId: 'message-123' })
  assert.equal(headers[0].get('Idempotency-Key'), 'test/one-logical-send')
  assert.deepEqual(requests[0]?.attachments, [
    {
      filename: 'Uppdragsbekraftelse-EB-2026-09-03-b617c9ba.pdf',
      content: 'JVBERi0xLjQ=',
      content_type: 'application/pdf',
    },
  ])

  await sendAssignmentEmail({
    to: 'customer@example.se',
    from: 'HusHub <noreply@example.se>',
    subject: 'Utan bilaga',
    html: '<p>Klart</p>',
    text: 'Klart',
  })

  assert.equal(Object.prototype.hasOwnProperty.call(requests[1], 'attachments'), false)
  assert.equal(headers[1].has('Idempotency-Key'), false)
})

test('timeout also aborts a provider response stalled after its headers', async context => {
  const previousFetch = globalThis.fetch
  const previousKey = process.env.RESEND_API_KEY
  const previousTimeout = process.env.RESEND_REQUEST_TIMEOUT_MS
  context.after(() => {
    globalThis.fetch = previousFetch
    if (previousKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previousKey
    if (previousTimeout === undefined) delete process.env.RESEND_REQUEST_TIMEOUT_MS; else process.env.RESEND_REQUEST_TIMEOUT_MS = previousTimeout
  })
  process.env.RESEND_API_KEY = 'test-key'
  process.env.RESEND_REQUEST_TIMEOUT_MS = '10'
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"id":'))
        init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true })
      },
    })
    return new Response(stream, { status: 200 })
  }) as typeof fetch
  await assert.rejects(sendAssignmentEmail({ to: 'test@example.test', from: 'sender@example.test', subject: 'Test', html: '<p>Test</p>', text: 'Test' }), /EMAIL_SEND_TIMEOUT/)
})
