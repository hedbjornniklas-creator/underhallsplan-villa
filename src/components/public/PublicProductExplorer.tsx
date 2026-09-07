'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRef, useState, type KeyboardEvent } from 'react'
import { Building2, ChevronRight, ClipboardCheck } from 'lucide-react'
import { PUBLIC_PRODUCTS, type PublicProductId } from '@/lib/publicNavigation'

const products = [
  {
    id: 'renoapp' as const,
    icon: Building2,
    image: '/landing/renovering-editorial-v2.png',
    alt: 'Illustrationsbild: två boende planerar sin renovering vid köksbordet.',
    title: 'Från renoveringsansökan till styrelsens beslut.',
    description: 'Den boende får hjälp att beskriva sin renovering. Styrelsen granskar ansökan, ber om kompletteringar och dokumenterar beslutet. Allt samlas i samma ärende.',
  },
  {
    id: 'besiktapp' as const,
    icon: ClipboardCheck,
    image: '/landing/besiktning-editorial-v2.png',
    alt: 'Illustrationsbild: en besiktningsman arbetar med sin surfplatta i en villa.',
    title: 'Från besiktning på plats till färdigt utlåtande.',
    description: 'Samla uppdrag, bilder och anteckningar. Använd mallar och AI-stöd i besiktningsarbetet och hitta tillbaka till underlaget när kunden hör av sig.',
  },
]

export default function PublicProductExplorer() {
  const [selected, setSelected] = useState<PublicProductId>('renoapp')
  const tabs = useRef<(HTMLButtonElement | null)[]>([])

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % products.length
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index - 1 + products.length) % products.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = products.length - 1
    else return
    event.preventDefault()
    setSelected(products[next].id)
    tabs.current[next]?.focus()
  }

  return (
    <section id="produkter" className={`hushub-product-explorer is-${selected}`} aria-label="Våra produkter">
      <div className="public-container hushub-explorer-layout">
        <div role="tablist" aria-label="Välj produkt" aria-orientation="vertical" className="hushub-explorer-tabs">
          {products.map((product, index) => (
            <button
              key={product.id}
              ref={element => { tabs.current[index] = element }}
              type="button" role="tab" id={`product-tab-${product.id}`}
              aria-controls={`product-panel-${product.id}`} aria-selected={selected === product.id}
              tabIndex={selected === product.id ? 0 : -1}
              onClick={() => setSelected(product.id)} onKeyDown={event => handleKeyDown(event, index)}
              className={`hushub-explorer-tab is-${product.id}`}
            >
              <span className="hushub-explorer-icon"><product.icon size={22} aria-hidden="true" /></span>
              <span>{PUBLIC_PRODUCTS[product.id].name}</span>
              <ChevronRight className="hushub-explorer-chevron" size={22} aria-hidden="true" />
            </button>
          ))}
        </div>
        {products.map(product => {
          const info = PUBLIC_PRODUCTS[product.id]
          return (
            <div key={product.id} role="tabpanel" id={`product-panel-${product.id}`}
              aria-labelledby={`product-tab-${product.id}`} hidden={selected !== product.id}
              tabIndex={0} className="hushub-explorer-panel">
              <div className="hushub-explorer-photo">
                <Image src={product.image} alt={product.alt} width={1122} height={1402}
                  sizes="(max-width: 767px) 90vw, (max-width: 1100px) 36vw, 420px" />
                <div className="hushub-explorer-badge">
                  <Image src={info.logo} alt="" width={info.width} height={info.height} />
                </div>
              </div>
              <div className="hushub-explorer-copy">
                <span className="hushub-explorer-name">{info.name}</span>
                <h2>{product.title}</h2>
                <p>{product.description}</p>
                <Link href={info.infoHref} className="public-button">Läs om {info.name}</Link>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
