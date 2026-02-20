type SendAssignmentEmailInput = {
  to: string
  from: string
  replyTo?: string | null
  subject: string
  html: string
  text: string
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
    }),
  })

  const data = (await response.json().catch(() => ({}))) as { id?: string; message?: string }

  if (!response.ok) {
    throw new Error(data.message ?? 'Mejlutskick misslyckades.')
  }

  return {
    provider: 'resend',
    providerMessageId: data.id ?? null,
  }
}
