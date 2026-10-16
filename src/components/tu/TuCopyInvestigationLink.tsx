'use client'

import { CopyPlus } from 'lucide-react'
import PendingLink from '@/components/ui/PendingLink'
import { tuCopyHref } from '@/lib/tu/copy'

export default function TuCopyInvestigationLink({ inspectionId, organizationId, iconOnly = false, className }: {
  inspectionId: string; organizationId: string; iconOnly?: boolean; className?: string
}) {
  const label = 'Ny utredning med samma uppgifter'
  return <PendingLink href={tuCopyHref(inspectionId, organizationId)} prefetch={false}
    autoPending pendingLabel={iconOnly ? null : 'Hämtar uppgifter...'}
    icon={<CopyPlus size={iconOnly ? 18 : 16} aria-hidden />}
    title={label} aria-label={label}
    onClick={event => event.stopPropagation()}
    onKeyDown={event => event.stopPropagation()}
    className={`${className ?? 'inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-800 hover:bg-violet-50'} ${iconOnly ? '[&>span]:hidden' : ''}`}>
    {iconOnly ? null : label}
  </PendingLink>
}
