import 'server-only'

import { createHash } from 'node:crypto'
import { after } from 'next/server'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'

const ADMIN_EMAIL = 'jn@hedbjorn.se'
const ALERT_WINDOW_MS = 6 * 60 * 60 * 1000
const alerts: Record<string, { title: string; action: string }> = {
  ACTION_CASE_AI_CREDIT_BALANCE: {
    title: 'OpenAI-saldot är slut',
    action: 'OpenAI returnerade credit_balance_exhausted. Fyll på API-saldot i det OpenAI-projekt som används av HusHub.',
  },
  ACTION_CASE_AI_QUOTA_EXCEEDED: {
    title: 'OpenAI har stoppat anrop på grund av saldo eller gränser',
    action: 'Kontrollera API-saldo samt projektets och organisationens kostnads- och användningsgränser hos OpenAI.',
  },
  ACTION_CASE_AI_ACCESS_FAILED: {
    title: 'AI-kalkylen saknar åtkomst till OpenAI',
    action: 'Kontrollera att OPENAI_API_KEY är giltig och har åtkomst till modellen i OPENAI_ACTION_CASE_MODEL.',
  },
  ACTION_CASE_AI_NOT_CONFIGURED: {
    title: 'AI-kalkylen saknar API-konfiguration',
    action: 'OPENAI_API_KEY saknas i servermiljön. Kontrollera driftsinställningarna.',
  },
}
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function scheduleActionCaseAiAdminAlert(code: string) {
  if (!Object.hasOwn(alerts, code)) return
  const alert = alerts[code]
  const environment = process.env.VERCEL_ENV?.trim() || process.env.NODE_ENV || 'development'
  const model = process.env.OPENAI_ACTION_CASE_MODEL?.trim() || 'gpt-5.4-mini'
  const windowStart = Math.floor(Date.now() / ALERT_WINDOW_MS) * ALERT_WINDOW_MS
  const from = process.env.ASSIGNMENTS_MAIL_FROM?.trim()
  const text = [
    'HusHub driftlarm: AI-kalkyl i Uppdrag', '',
    alert.title, alert.action, '',
    `Miljö: ${environment}`, `Modell: ${model}`, `Intern felkod: ${code}`,
    `Larmperiod från: ${new Date(windowStart).toISOString()} (6 timmar)`, '',
    'Användaren får ett generellt felmeddelande. Inga kalkylrader ändras av det misslyckade anropet.',
    'Begäran-id och leverantörens felkod finns i serverloggen under [action-case-costing].',
    'API-fakturering: https://platform.openai.com/settings/organization/billing',
  ].join('\n')
  // Stable payload and key across requests/instances; never include case data or a changing request id.
  const email = {
    to: ADMIN_EMAIL, from: from ?? '',
    subject: `HusHub driftlarm [${environment}]: ${alert.title}`,
    text, html: `<div style="white-space:pre-wrap;font-family:Arial,sans-serif">${escapeHtml(text)}</div>`,
  }
  const idempotencyKey = `action-case-ai-alert-${createHash('sha256').update(JSON.stringify(email)).digest('hex')}`
  try {
    after(async () => {
      if (!from || !process.env.RESEND_API_KEY?.trim()) {
        console.error('[action-case-costing.alert] mail configuration missing', { code, environment })
        return
      }
      try {
        await sendAssignmentEmail({ ...email, idempotencyKey })
      } catch {
        // A later occurrence retries the identical email, even after an uncertain send.
        console.error('[action-case-costing.alert] admin notification failed', { code, environment, idempotencyKey })
      }
    })
  } catch {
    console.error('[action-case-costing.alert] could not schedule admin notification', { code, environment })
  }
}
