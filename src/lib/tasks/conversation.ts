import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { sendTaskAccessLinkEmail } from './automation'
import { buildTaskEmailHtml } from './emailTemplates'
import { hasInternalTaskModuleAccess } from './internalAccess'
import { issueDirectTaskAccessLink } from './recipientAuth'
import type {
  TaskEventAuthorSide,
  TaskEventView,
  TaskLatestMessageView,
} from './contracts'

type ConversationViewer =
  | { kind: 'profile'; profileId: string }
  | { kind: 'contact'; contactId: string; accessLinkId?: string | null }

type ConversationEventRow = {
  id: string
  task_id: string
  event_type: string
  actor_type: string
  actor_profile_id: string | null
  actor_contact_id: string | null
  actor_name: string | null
  message: string | null
  created_at: string
}

type ConversationReadRow = {
  task_id: string
  last_read_comment_id: string | null
  last_read_comment_created_at: string | null
}

export type TaskConversationSnapshot = {
  comments: TaskEventView[]
  unreadMessageCount: number
  latestMessage: TaskLatestMessageView | null
  latestIncomingMessageEventId: string | null
}

export type CommentNotificationActor =
  | {
      kind: 'profile'
      profileId: string
      name: string
    }
  | {
      kind: 'contact'
      contactId: string
      accessLinkId: string
      name: string
    }

const EMPTY_SNAPSHOT: TaskConversationSnapshot = {
  comments: [],
  unreadMessageCount: 0,
  latestMessage: null,
  latestIncomingMessageEventId: null,
}

const CONVERSATION_TASK_BATCH_SIZE = 100
const CONVERSATION_PAGE_SIZE = 500

function asErrorCode(error: unknown, fallback: string) {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : ''
  return message.match(/TASK_[A-Z0-9_]+/)?.[0] ?? fallback
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function publicBaseUrl(requestOrigin?: string | null) {
  const configured = process.env.APP_BASE_URL?.trim()
  if (process.env.NODE_ENV === 'production' && !configured) {
    throw new Error('MISSING_ENV:APP_BASE_URL')
  }
  const candidate = configured || requestOrigin?.trim()
  if (!candidate) throw new Error('MISSING_ENV:APP_BASE_URL')
  const url = new URL(candidate)
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && local)) {
    throw new Error('INVALID_ENV:APP_BASE_URL')
  }
  return url.origin
}

function dueDateLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('sv-SE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function compareCursor(
  event: Pick<ConversationEventRow, 'id' | 'created_at'>,
  cursor: ConversationReadRow | undefined
) {
  if (!cursor?.last_read_comment_created_at) return 1
  const timeComparison = event.created_at.localeCompare(cursor.last_read_comment_created_at)
  if (timeComparison !== 0) return timeComparison
  if (!cursor.last_read_comment_id) return 1
  if (event.id === cursor.last_read_comment_id) return 0
  return event.id > cursor.last_read_comment_id ? 1 : -1
}

export function taskEventAuthorSide(
  event: {
    actor_type?: string | null
    actor_profile_id?: string | null
    actor_contact_id?: string | null
  },
  viewer: ConversationViewer
): TaskEventAuthorSide {
  if (event.actor_type === 'system' || event.actor_type === 'ai') return 'system'
  if (
    viewer.kind === 'profile' &&
    event.actor_type === 'profile' &&
    event.actor_profile_id === viewer.profileId
  ) {
    return 'self'
  }
  if (
    viewer.kind === 'contact' &&
    event.actor_type === 'contact' &&
    event.actor_contact_id === viewer.contactId
  ) {
    return 'self'
  }
  return 'other'
}

/**
 * Loads the complete comment stream separately from the capped activity list.
 * This keeps unread counts exact even when a task has more than 20 events.
 */
export async function loadTaskConversationSnapshots(input: {
  taskIds: string[]
  viewer: ConversationViewer
  unreadTaskIds?: ReadonlySet<string>
}) {
  const taskIds = [...new Set(input.taskIds)].sort((left, right) => left.localeCompare(right))
  const snapshots = new Map<string, TaskConversationSnapshot>()
  for (const taskId of taskIds) snapshots.set(taskId, EMPTY_SNAPSHOT)
  if (taskIds.length === 0) return snapshots

  const admin = createSupabaseAdminClient()
  const comments: ConversationEventRow[] = []
  const readRows: ConversationReadRow[] = []

  for (
    let taskOffset = 0;
    taskOffset < taskIds.length;
    taskOffset += CONVERSATION_TASK_BATCH_SIZE
  ) {
    const taskBatch = taskIds.slice(taskOffset, taskOffset + CONVERSATION_TASK_BATCH_SIZE)
    const [batchComments, batchReads] = await Promise.all([
      (async () => {
        const rows: ConversationEventRow[] = []
        for (let rowOffset = 0; ; rowOffset += CONVERSATION_PAGE_SIZE) {
          const { data, error } = await admin
            .from('task_events')
            .select('id,task_id,event_type,actor_type,actor_profile_id,actor_contact_id,actor_name,message,created_at')
            .in('task_id', taskBatch)
            .eq('event_type', 'comment')
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(rowOffset, rowOffset + CONVERSATION_PAGE_SIZE - 1)
          if (error) throw new Error('TASK_CONVERSATION_READ_FAILED')
          const page = (data ?? []) as ConversationEventRow[]
          rows.push(...page)
          if (page.length < CONVERSATION_PAGE_SIZE) break
        }
        return rows
      })(),
      (async () => {
        const rows: ConversationReadRow[] = []
        for (let rowOffset = 0; ; rowOffset += CONVERSATION_PAGE_SIZE) {
          let query = admin
            .from('task_conversation_reads')
            .select('task_id,last_read_comment_id,last_read_comment_created_at')
            .in('task_id', taskBatch)
          query = input.viewer.kind === 'profile'
            ? query.eq('reader_profile_id', input.viewer.profileId)
            : query.eq('reader_contact_id', input.viewer.contactId)
          const { data, error } = await query
            .order('task_id', { ascending: true })
            .range(rowOffset, rowOffset + CONVERSATION_PAGE_SIZE - 1)
          if (error) {
            const code = asErrorCode(error, 'TASKS_SCHEMA_REQUIRED')
            throw new Error(
              code === 'TASKS_SCHEMA_REQUIRED' ? code : 'TASK_CONVERSATION_READ_FAILED'
            )
          }
          const page = (data ?? []) as ConversationReadRow[]
          rows.push(...page)
          if (page.length < CONVERSATION_PAGE_SIZE) break
        }
        return rows
      })(),
    ])
    comments.push(...batchComments)
    readRows.push(...batchReads)
  }

  const cursors = new Map(
    readRows.map((row) => [row.task_id, row])
  )
  // New append-only events can shift an offset page while this loop is
  // running. De-duplicate by the immutable event id so that such a shift can
  // never inflate the thread or unread count.
  const uniqueComments = new Map(comments.map((comment) => [comment.id, comment]))
  const byTask = new Map<string, ConversationEventRow[]>()
  for (const comment of uniqueComments.values()) {
    if (!comment.message?.trim()) continue
    if (
      input.viewer.kind === 'contact' &&
      comment.actor_contact_id !== input.viewer.contactId &&
      comment.actor_type !== 'profile'
    ) {
      continue
    }
    const list = byTask.get(comment.task_id) ?? []
    list.push(comment)
    byTask.set(comment.task_id, list)
  }
  for (const taskComments of byTask.values()) {
    taskComments.sort((left, right) => {
      const createdComparison = right.created_at.localeCompare(left.created_at)
      return createdComparison !== 0 ? createdComparison : right.id.localeCompare(left.id)
    })
  }

  for (const taskId of taskIds) {
    const taskComments = byTask.get(taskId) ?? []
    const latest = taskComments[0] ?? null
    const incoming = taskComments.filter(
      (event) => taskEventAuthorSide(event, input.viewer) === 'other'
    )
    const trackUnread = !input.unreadTaskIds || input.unreadTaskIds.has(taskId)
    snapshots.set(taskId, {
      comments: taskComments.map((comment) => ({
        id: comment.id,
        type: 'comment',
        actorName: comment.actor_name?.trim() || 'HusHub',
        message: comment.message?.trim() || '',
        fromStatus: null,
        toStatus: null,
        createdAt: comment.created_at,
        authorSide: taskEventAuthorSide(comment, input.viewer),
      })),
      unreadMessageCount: trackUnread
        ? incoming.filter((event) => compareCursor(event, cursors.get(taskId)) > 0).length
        : 0,
      latestMessage: latest
        ? {
            id: latest.id,
            actorName: latest.actor_name?.trim() || 'HusHub',
            message: latest.message?.trim() || '',
            createdAt: latest.created_at,
            authorSide: taskEventAuthorSide(latest, input.viewer),
          }
        : null,
      latestIncomingMessageEventId: trackUnread ? incoming[0]?.id ?? null : null,
    })
  }
  return snapshots
}

export async function markTaskConversationRead(input: {
  taskId: string
  throughEventId: string
  reader:
    | { kind: 'profile'; profileId: string }
    | { kind: 'contact'; contactId: string; accessLinkId: string }
}) {
  if (!input.taskId || !input.throughEventId) throw new Error('TASK_CONVERSATION_CURSOR_REQUIRED')
  const admin = createSupabaseAdminClient()
  const { error } = await admin.rpc('mark_task_conversation_read', {
    p_task_id: input.taskId,
    p_through_event_id: input.throughEventId,
    p_actor_profile_id: input.reader.kind === 'profile' ? input.reader.profileId : null,
    p_actor_contact_id: input.reader.kind === 'contact' ? input.reader.contactId : null,
    p_actor_access_link_id: input.reader.kind === 'contact' ? input.reader.accessLinkId : null,
  })
  if (error) throw new Error(asErrorCode(error, 'TASK_CONVERSATION_MARK_READ_FAILED'))
}

async function updateDeliveryFailure(deliveryId: string, errorCode: string) {
  const admin = createSupabaseAdminClient()
  await admin
    .from('task_message_deliveries')
    .update({
      status: 'failed',
      failed_at: new Date().toISOString(),
      error_message: errorCode,
    })
    .eq('id', deliveryId)
}

/**
 * Persists a token-free notification audit before attempting delivery. A mail
 * or link-provider failure is returned as a warning and never rolls back the
 * already saved task comment.
 */
export async function notifyTaskComment(input: {
  orgId: string
  taskId: string
  eventId: string
  message: string
  actor: CommentNotificationActor
  requestOrigin?: string | null
}): Promise<{ warning: string | null }> {
  const genericWarning = 'Meddelandet finns sparat, men e-postnotifieringen kunde inte skickas.'
  try {
    const admin = createSupabaseAdminClient()
    const { data: task, error: taskError } = await admin
      .from('operational_tasks')
      .select('id,title,context_label,due_at,issuer_profile_id,assignee_profile_id,assignee_contact_id')
      .eq('id', input.taskId)
      .eq('org_id', input.orgId)
      .is('archived_at', null)
      .maybeSingle()
    if (taskError || !task) throw new Error('TASK_NOT_FOUND')

    const recipient = input.actor.kind === 'contact' || task.assignee_profile_id === input.actor.profileId
      ? { kind: 'profile' as const, id: String(task.issuer_profile_id) }
      : task.assignee_profile_id
        ? { kind: 'profile' as const, id: String(task.assignee_profile_id) }
        : task.assignee_contact_id
          ? { kind: 'contact' as const, id: String(task.assignee_contact_id) }
          : null
    if (!recipient) return { warning: genericWarning }
    if (
      input.actor.kind === recipient.kind &&
      (input.actor.kind === 'profile' ? input.actor.profileId : input.actor.contactId) === recipient.id
    ) {
      return { warning: null }
    }

    if (
      recipient.kind === 'profile' &&
      !(await hasInternalTaskModuleAccess({ orgId: input.orgId, profileId: recipient.id }))
    ) {
      throw new Error('TASK_NOTIFICATION_RECIPIENT_ACCESS_DENIED')
    }

    const [{ data: recipientRow, error: recipientError }, { data: senderRow }] = await Promise.all([
      recipient.kind === 'profile'
        ? admin.from('profiles').select('id,full_name,email').eq('id', recipient.id).maybeSingle()
        : admin
            .from('organization_contacts')
            .select('id,name,email')
            .eq('id', recipient.id)
            .eq('org_id', input.orgId)
            .eq('is_active', true)
            .maybeSingle(),
      input.actor.kind === 'profile'
        ? admin.from('profiles').select('id,email').eq('id', input.actor.profileId).maybeSingle()
        : admin
            .from('organization_contacts')
            .select('id,email')
            .eq('id', input.actor.contactId)
            .eq('org_id', input.orgId)
            .maybeSingle(),
    ])
    if (recipientError || !recipientRow) throw new Error('TASK_NOTIFICATION_RECIPIENT_NOT_FOUND')
    const profileRecipientEmail = recipient.kind === 'profile'
      ? normalizeEmail(recipientRow.email)
      : ''
    const senderEmail = normalizeEmail(senderRow?.email)
    const recipientName = recipient.kind === 'profile'
      ? ('full_name' in recipientRow && typeof recipientRow.full_name === 'string' && recipientRow.full_name.trim()) || profileRecipientEmail || 'Mottagare'
      : ('name' in recipientRow && typeof recipientRow.name === 'string' && recipientRow.name.trim()) || 'Mottagare'
    if (recipient.kind === 'profile' && !profileRecipientEmail) return { warning: genericWarning }

    const auditText = [
      `Nytt meddelande från ${input.actor.name}`,
      `Uppdrag: ${task.title}`,
      task.context_label ? `Projekt: ${task.context_label}` : null,
      `Slutdatum: ${dueDateLabel(String(task.due_at))}`,
      '',
      input.message,
      '',
      recipient.kind === 'contact'
        ? 'En personlig direktlänk bifogades i leveransen men sparades inte i meddelandeloggen.'
        : 'En länk till uppdraget bifogades i leveransen.',
    ].filter((line): line is string => line !== null).join('\n')

    const { data: notification, error: notificationError } = await admin
      .from('task_messages')
      .insert({
        org_id: input.orgId,
        task_id: input.taskId,
        direction: input.actor.kind === 'contact' ? 'inbound' : 'outbound',
        message_type: 'comment',
        actor_type: input.actor.kind,
        actor_profile_id: input.actor.kind === 'profile' ? input.actor.profileId : null,
        actor_contact_id: input.actor.kind === 'contact' ? input.actor.contactId : null,
        actor_access_link_id: input.actor.kind === 'contact' ? input.actor.accessLinkId : null,
        actor_name: input.actor.name,
        body_text: auditText,
        generated_by_ai: false,
        metadata: {
          eventId: input.eventId,
          notification: true,
          recipientKind: recipient.kind,
          recipientId: recipient.id,
          tokenPersisted: false,
        },
      })
      .select('id')
      .single()
    if (notificationError || !notification) throw new Error('TASK_MESSAGE_CREATE_FAILED')

    const idempotencyKey = `task-comment:${input.eventId}:email:${recipient.kind}:${recipient.id}`
    let actionUrl: string
    let accessLinkId: string | null = null
    let deliveryRecipientEmail = profileRecipientEmail
    try {
      const baseUrl = publicBaseUrl(input.requestOrigin)
      if (recipient.kind === 'profile') {
        actionUrl = `${baseUrl}/uppdrag?task=${encodeURIComponent(input.taskId)}`
      } else {
        if (input.actor.kind !== 'profile') throw new Error('TASK_ACCESS_CREATOR_INVALID')
        const directLink = await issueDirectTaskAccessLink({
          taskId: input.taskId,
          contactId: recipient.id,
          createdByProfileId: input.actor.profileId,
          baseUrl,
        })
        actionUrl = directLink.url
        accessLinkId = directLink.accessLinkId
        deliveryRecipientEmail = normalizeEmail(directLink.recipientEmail)
        if (!deliveryRecipientEmail) throw new Error('TASK_NOTIFICATION_RECIPIENT_EMAIL_MISSING')
      }
    } catch {
      return { warning: genericWarning }
    }

    if (senderEmail && senderEmail === deliveryRecipientEmail) return { warning: null }

    const { data: delivery, error: deliveryError } = await admin
      .from('task_message_deliveries')
      .insert({
        org_id: input.orgId,
        task_id: input.taskId,
        message_id: notification.id,
        channel: 'email',
        recipient_address: deliveryRecipientEmail,
        provider: 'resend',
        status: 'queued',
        scheduled_at: new Date().toISOString(),
        attempt_count: 0,
        max_attempts: 1,
        idempotency_key: idempotencyKey,
        provider_payload: {
          eventId: input.eventId,
          recipientKind: recipient.kind,
          recipientId: recipient.id,
          tokenPersisted: false,
        },
      })
      .select('id')
      .single()
    if (deliveryError || !delivery) throw new Error('TASK_DELIVERY_CREATE_FAILED')

    await admin
      .from('task_message_deliveries')
      .update({
        status: 'sending',
        attempt_count: 1,
        provider_payload: {
          eventId: input.eventId,
          recipientKind: recipient.kind,
          recipientId: recipient.id,
          ...(accessLinkId ? { accessLinkId } : {}),
          tokenPersisted: false,
        },
      })
      .eq('id', delivery.id)

    const dueLabel = dueDateLabel(String(task.due_at))
    const subject = `Nytt meddelande från ${input.actor.name}: ${task.title}`
    const text = [
      `Hej ${recipientName},`,
      '',
      `${input.actor.name} har skrivit i uppdraget ”${task.title}”:`,
      '',
      input.message,
      '',
      `Öppna uppdraget: ${actionUrl}`,
      '',
      'Meddelandet skickades via HusHub.',
    ].join('\n')
    const html = buildTaskEmailHtml({
      previewText: `${input.actor.name} har skrivit i ${task.title}`,
      eyebrow: 'Nytt meddelande i HusHub',
      heading: 'Du har fått ett nytt meddelande',
      recipientName,
      lead: `${input.actor.name} har skrivit i uppdraget.`,
      taskTitle: String(task.title),
      contextLabel: typeof task.context_label === 'string' ? task.context_label : null,
      dueLabel,
      message: { authorName: input.actor.name, text: input.message },
      actionUrl,
      actionLabel: 'Läs och svara',
      notice: recipient.kind === 'contact'
        ? 'Länken är personlig och öppnar bara detta uppdrag. Vidarebefordra den inte.'
        : null,
    })

    try {
      const sent = await sendTaskAccessLinkEmail({
        to: deliveryRecipientEmail,
        replyTo: senderEmail || null,
        subject,
        text,
        html,
        idempotencyKey: accessLinkId ? `${idempotencyKey}:bearer:${accessLinkId}` : idempotencyKey,
      })
      const sentAt = new Date().toISOString()
      await Promise.all([
        admin
          .from('task_message_deliveries')
          .update({
            status: 'sent',
            sent_at: sentAt,
            provider_message_id: sent.providerMessageId,
            error_message: null,
          })
          .eq('id', delivery.id),
        admin
          .from('task_messages')
          .update({ provider_message_id: sent.providerMessageId })
          .eq('id', notification.id),
      ])
      return { warning: null }
    } catch (error) {
      await updateDeliveryFailure(delivery.id, asErrorCode(error, 'TASK_NOTIFICATION_EMAIL_FAILED'))
      return { warning: genericWarning }
    }
  } catch (error) {
    console.error('[tasks.conversation] comment notification failed', {
      code: asErrorCode(error, 'TASK_COMMENT_NOTIFICATION_FAILED'),
      taskId: input.taskId,
      eventId: input.eventId,
    })
    return { warning: genericWarning }
  }
}
