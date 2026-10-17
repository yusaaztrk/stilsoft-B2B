import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import LegalPage from '@/components/LegalPage'
import { getContentPage, listContentPages } from '@/lib/api'

type Params = { slug: string }

/** Yayındaki sayfaların adresleri önceden üretilir — Google'ın tarayacağı sayfalar bunlar. */
export async function generateStaticParams(): Promise<Params[]> {
  const pages = await listContentPages()
  return pages.map((p) => ({ slug: p.slug }))
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params
  const page = await getContentPage(slug)
  if (!page) return { title: 'Sayfa bulunamadı' }

  return {
    title: page.title,
    description: (page.summary ?? page.body).slice(0, 160),
    alternates: { canonical: `/sayfa/${page.slug}` },
    robots: { index: true, follow: true },
  }
}

/**
 * Gövde DÜZ METİN olarak saklanıyor, HTML değil — panele HTML yazma imkânı vermek, bir personel
 * hesabı ele geçtiğinde vitrinin her sayfasına betik sokulabilmesi demek olurdu.
 *
 * Bu yüzden biçimlendirme burada, sınırlı bir dille yorumlanıyor:
 *   "## " ile başlayan satır → ara başlık
 *   "- "  ile başlayan satır → madde
 *   boş satırla ayrılan bloklar → paragraf
 */
function render(body: string) {
  const blocks = body.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)

  return blocks.map((block, index) => {
    if (block.startsWith('## ')) {
      return <h2 key={index}>{block.slice(3).trim()}</h2>
    }

    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length > 0 && lines.every((l) => l.startsWith('- '))) {
      return (
        <ul key={index}>
          {lines.map((line, i) => (
            <li key={i}>{line.slice(2).trim()}</li>
          ))}
        </ul>
      )
    }

    return <p key={index}>{block}</p>
  })
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const page = await getContentPage(slug)
  if (!page) notFound()

  return (
    <LegalPage title={page.title} lede={page.summary ?? undefined}>
      {render(page.body)}
    </LegalPage>
  )
}
