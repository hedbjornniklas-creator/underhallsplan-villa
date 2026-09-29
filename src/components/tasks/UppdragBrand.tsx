import Image from 'next/image'

export default function UppdragBrand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`uppdrag-brand${compact ? ' uppdrag-brand-compact' : ''}`}>
      <Image
        src={compact ? '/uppdrag/brand/symbol.svg' : '/uppdrag/brand/logo.svg'}
        alt="HusHub Uppdrag"
        width={compact ? 40 : 180}
        height={compact ? 40 : 45}
        className="uppdrag-brand-image"
        priority
      />
      {!compact ? <span className="uppdrag-brand-endorsement">från HusHub</span> : null}
    </span>
  )
}
