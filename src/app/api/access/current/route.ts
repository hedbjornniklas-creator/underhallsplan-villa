import { NextResponse } from 'next/server'
import { getCurrentUserAccessibleProducts } from '@/lib/access/server'

export async function GET() {
  try {
    const products = await getCurrentUserAccessibleProducts()

    return NextResponse.json({
      products: products.map((product) => ({
        key: product.key,
        label: product.label,
        href: product.href,
      })),
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    }

    return NextResponse.json({ error: 'Kunde inte läsa aktuell access.' }, { status: 500 })
  }
}
