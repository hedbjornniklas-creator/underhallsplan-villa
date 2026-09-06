type SendAssignmentEmailAttachment = {
  filename: string
  contentBase64: string
  contentType?: string | null
}

type SendAssignmentEmailInput = {
  to: string
  from: string
  replyTo?: string | null
  subject: string
  html: string
  text: string
  attachments?: SendAssignmentEmailAttachment[]
  idempotencyKey?: string
}

type SendAssignmentEmailResult = {
  provider: string
  providerMessageId: string | null
}

export async function sendAssignmentEmail(
  input: SendAssignmentEmailInput
): Promise<SendAssignmentEmailResult> {
  const resendApiKey = process.env.RESEND_API_KEY

  if (!resendApiKey) {
    console.error('[assignments.mailer] missing env', { env: 'RESEND_API_KEY' })
    throw new Error('RESEND_API_KEY saknas. Konfigurera mejlprovider innan utskick.')
  }

  const configuredTimeout = Number(process.env.RESEND_REQUEST_TIMEOUT_MS ?? 15000)
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 15000
  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  let data: { id?: string; message?: string }
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
        ...(input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: input.from,
        to: [input.to],
        reply_to: input.replyTo ?? undefined,
        subject: input.subject,
        html: input.html,
        text: input.text,
        attachments:
          input.attachments && input.attachments.length > 0
            ? input.attachments.map((attachment) => ({
                filename: attachment.filename,
                content: attachment.contentBase64,
                content_type: attachment.contentType ?? undefined,
              }))
            : undefined,
      }),
      signal: controller.signal,
    })
    // Reading the response body must stay inside the same timeout as the request.
    data = (await response.json().catch(error => {
      if (controller.signal.aborted) throw error
      return {}
    })) as { id?: string; message?: string }
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw new Error('EMAIL_SEND_TIMEOUT')
    }
    throw error
  } finally {
    clearTimeout(timeoutHandle)
  }

  if (!response.ok) {
    console.error('[assignments.mailer] resend request failed', {
      status: response.status,
      response: data.message ?? null,
      to: input.to,
      subject: input.subject,
    })
    throw new Error(data.message ?? 'Mejlutskick misslyckades.')
  }

  return {
    provider: 'resend',
    providerMessageId: data.id ?? null,
  }
}
