import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { sendAssignmentEmail } from '../src/lib/assignments/mailer.ts'

test('maps PDF attachments to Resend and omits an empty attachment list', async (context) => {
  const previousFetch = globalThis.fetch
  const previousApiKey = process.env.RESEND_API_KEY
  const requests: Array<Record<string, unknown>> = []

  context.after(() => {
    globalThis.fetch = previousFetch
    if (previousApiKey === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = previousApiKey
  })

  process.env.RESEND_API_KEY = 'test-key'
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
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
    attachments: [
      {
        filename: 'Uppdragsbekraftelse-EB-2026-09-03-b617c9ba.pdf',
        contentBase64: 'JVBERi0xLjQ=',
        contentType: 'application/pdf',
      },
    ],
  })

  assert.deepEqual(result, { provider: 'resend', providerMessageId: 'message-123' })
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
})
