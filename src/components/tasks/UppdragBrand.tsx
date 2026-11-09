import Image from 'next/image'

export default function UppdragBrand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`uppdrag-brand${compact ? ' uppdrag-brand-compact' : ''}`}>
      <span className="uppdrag-brand-lockup">
        <Image
          src="/uppdrag/brand/symbol.svg"
          alt={compact ? 'Gizmo' : ''}
          width={40}
          height={40}
          className="uppdrag-brand-image"
          priority
        />
        {!compact ? <span className="uppdrag-brand-name">Gizmo</span> : null}
      </span>
      {!compact ? <span className="uppdrag-brand-endorsement">från HusHub</span> : null}
    </span>
  )
}
