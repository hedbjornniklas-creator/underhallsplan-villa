'use client'

import { useState } from 'react'
import {
  AlertTriangle,
  Ban,
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Mail,
  MessageCircle,
  Send,
  XCircle,
} from 'lucide-react'
import type {
  TaskNotificationDeliveryStatus as DeliveryStatus,
  TaskNotificationDeliveryView,
} from '@/lib/tasks/contracts'

type Props = {
  deliveries: TaskNotificationDeliveryView[]
  problemCount: number
  timeZone: string
}

const statusPresentation: Record<
  DeliveryStatus,
  { label: string; className: string; icon: typeof Clock3 }
> = {
  queued: {
    label: 'Köad',
    className: 'bg-slate-100 text-slate-700',
    icon: Clock3,
  },
  processing: {
    label: 'Pågår i HusHub',
    className: 'bg-violet-50 text-violet-700',
    icon: Clock3,
  },
  sending: {
    label: 'Skickas',
    className: 'bg-blue-50 text-blue-700',
    icon: Send,
  },
  sent: {
    label: 'Överlämnad till kanalen',
    className: 'bg-blue-50 text-blue-700',
    icon: Send,
  },
  delivered: {
    label: 'Levererad',
    className: 'bg-emerald-50 text-emerald-700',
    icon: CheckCircle2,
  },
  read: {
    label: 'Öppnad',
    className: 'bg-emerald-50 text-emerald-700',
    icon: CheckCircle2,
  },
  replied: {
    label: 'Besvarad',
    className: 'bg-emerald-50 text-emerald-700',
    icon: CheckCircle2,
  },
  failed: {
    label: 'Misslyckad',
    className: 'bg-red-50 text-red-700',
    icon: XCircle,
  },
  ambiguous: {
    label: 'Kräver kontroll',
    className: 'bg-amber-50 text-amber-800',
    icon: AlertTriangle,
  },
  cancelled: {
    label: 'Avbruten',
    className: 'bg-slate-100 text-slate-600',
    icon: Ban,
  },
}

function channelLabel(channel: TaskNotificationDeliveryView['channel']) {
  if (channel === null) return 'Kanal väljs vid utskick'
  if (channel === 'email') return 'E-post'
  if (channel === 'whatsapp') return 'WhatsApp'
  return 'HusHub'
}

function deliveryStatusLabel(delivery: TaskNotificationDeliveryView) {
  if (delivery.status === 'sending') {
    if (delivery.channel === 'email') return 'Skickas till e-posttjänsten'
    if (delivery.channel === 'whatsapp') return 'Skickas till WhatsApp-tjänsten'
    return 'Skickas'
  }
  if (delivery.status !== 'sent') {
    return statusPresentation[delivery.status].label
  }
  if (delivery.channel === 'email') return 'Överlämnad till e-posttjänsten'
  if (delivery.channel === 'whatsapp') return 'Överlämnad till WhatsApp-tjänsten'
  return 'Överlämnad till HusHub'
}

function ChannelIcon({ channel }: { channel: TaskNotificationDeliveryView['channel'] }) {
  if (channel === 'email') return <Mail aria-hidden="true" size={16} />
  if (channel === 'whatsapp') return <MessageCircle aria-hidden="true" size={16} />
  return <Bell aria-hidden="true" size={16} />
}

function formatStatusTime(value: string, timeZone: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Tid saknas'
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(date)
  } catch {
    return new Intl.DateTimeFormat('sv-SE', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date)
  }
}

export default function TaskNotificationDeliveryStatus({
  deliveries,
  problemCount,
  timeZone,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const visibleDeliveries = expanded ? deliveries : deliveries.slice(0, 4)
  const hasOutboxStatus = deliveries.some((delivery) => delivery.stage === 'outbox')

  if (deliveries.length === 0 && problemCount === 0) return null

  return (
    <>
      {problemCount > 0 ? (
        <div
          role="alert"
          className="mt-4 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-950"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0 text-red-600" size={20} />
          <div>
            <p className="text-sm font-semibold">
              {problemCount === 1
                ? 'En notifiering behöver kontrolleras'
                : `${problemCount} notifieringar behöver kontrolleras`}
            </p>
            <p className="mt-1 text-xs leading-5 text-red-800">
              En notifiering är markerad som misslyckad eller oklar. Kontrollera statusen nedan innan du kontaktar mottagaren på nytt.
            </p>
          </div>
        </div>
      ) : null}

      {deliveries.length > 0 ? (
        <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-labelledby="task-notification-status-heading">
          <div className="border-b border-slate-100 px-4 py-3.5">
            <h3 id="task-notification-status-heading" className="text-sm font-semibold text-slate-950">
              Senaste notifieringar
            </h3>
            <p className="mt-0.5 text-xs leading-5 text-slate-500">
              Visar vad HusHub säkert kan bekräfta för varje kanal.
            </p>
            {hasOutboxStatus ? (
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Köad eller Pågår betyder att HusHub förbereder notifieringen. Kanalstatus visas när utskicket har skapats.
              </p>
            ) : null}
          </div>

          <ul className="divide-y divide-slate-100">
            {visibleDeliveries.map((delivery) => {
              const presentation = statusPresentation[delivery.status]
              const StatusIcon = presentation.icon
              return (
                <li key={delivery.id} className="px-4 py-3.5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{delivery.label}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-500">
                        {delivery.stage === 'outbox' ? (
                          <>
                            <span className="inline-flex items-center gap-1">
                              <Bell aria-hidden="true" size={16} /> HusHub
                            </span>
                            <span>· {channelLabel(null)}</span>
                          </>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <ChannelIcon channel={delivery.channel} />
                            {channelLabel(delivery.channel)}
                          </span>
                        )}
                        {delivery.isFallback ? <span>· Reservkanal</span> : null}
                        <span>· {formatStatusTime(delivery.statusAt, timeZone)}</span>
                      </p>
                    </div>
                    <span
                      className={`inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold sm:shrink-0 ${presentation.className}`}
                    >
                      <StatusIcon aria-hidden="true" size={13} />
                      {deliveryStatusLabel(delivery)}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>

          {deliveries.length > 4 ? (
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="flex min-h-11 w-full items-center justify-center gap-1.5 border-t border-slate-100 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              aria-expanded={expanded}
            >
              {expanded ? <ChevronUp aria-hidden="true" size={15} /> : <ChevronDown aria-hidden="true" size={15} />}
              {expanded ? 'Visa färre' : `Visa alla ${deliveries.length}`}
            </button>
          ) : null}
        </section>
      ) : null}
    </>
  )
}
