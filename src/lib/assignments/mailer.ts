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

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
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
  })

  const data = (await response.json().catch(() => ({}))) as { id?: string; message?: string }

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
