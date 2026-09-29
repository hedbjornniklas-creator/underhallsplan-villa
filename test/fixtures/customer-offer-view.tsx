import React from 'react'
import { createRoot } from 'react-dom/client'
import UppdragScope from '@/components/tasks/UppdragScope'
import { AppToastProvider } from '@/components/ui/AppToastProvider'
import CustomerOfferEditor from '@/components/tasks/CustomerOfferEditor'
import ActionCaseCustomerPortal from '@/components/tasks/ActionCaseCustomerPortal'
import { emptyCustomerOffer } from '@/lib/action-cases/customerOffers'
import { actionCase, customer, token } from './customer-offer-data'

async function start() {
  const workspace = await (await fetch('/fixture')).json()
  const params = new URLSearchParams(location.search)
  if (params.has('empty')) {
    workspace.draft = emptyCustomerOffer()
    workspace.revision = 0
    workspace.offers = []
  }
  if (params.has('expired') && workspace.offers[0])
    workspace.offers[0].snapshot.validUntil = '2020-01-01'
  const portal = {
    accessState: 'open' as const,
    participant: customer,
    customerOffers: { enabled: true, offers: workspace.offers },
    actionCase: {
      ...actionCase,
      items: [],
      description: null,
      attachments: actionCase.attachments.filter((f) =>
        f.grantedParticipantIds.includes(customer.id)
      )
    }
  }
  const external = location.pathname === '/kund'
  createRoot(document.getElementById('root')!).render(
    <AppToastProvider>
      <UppdragScope external>
        <div className="mx-auto max-w-6xl border-b border-slate-200 px-4 py-2 text-xs text-slate-500 print:hidden">
          Fiktivt testprojekt · Inga mejl eller riktiga godkännanden skickas ·{' '}
          <a className="underline" href="/intern">
            Intern offert
          </a>{' '}
          ·{' '}
          <a className="underline" href="/kund">
            Kundvy
          </a>
        </div>
        {external ? (
          <ActionCaseCustomerPortal portal={portal} token={token} />
        ) : (
          <CustomerOfferEditor
            actionCase={actionCase}
            initial={workspace}
            issuerName="Exempelbygg AB"
            replyEmail="byggare@example.test"
          />
        )}
      </UppdragScope>
    </AppToastProvider>
  )
}
void start()
