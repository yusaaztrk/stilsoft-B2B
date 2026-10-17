'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useCart } from '@/context/CartContext'
import type { CatalogItem } from '@/lib/api'
import { displayName, formatPrice, mediaUrl } from '@/lib/format'

/*
  SETİNİ TAMAMLA (2026-09-20).

  Ankastre mutfak set olarak kurulur: fırın alan ocak ve davlumbaz da alır. Ürün sayfasındaki
  "benzer ürünler" bloğu aynı kategoriden RASTGELE ürün gösteriyordu — fırın bakan müşteriye
  başka bir fırın önermek sepeti büyütmez, kararı zorlaştırır.

  Burada tamamlayıcı ürünler seçili geliyor ve tek düğmeyle hepsi sepete ekleniyor. Amaç
  karşılaştırma değil, "evet bunlar da lazım" diyen müşteriye tek tıkta bitirtmek.

  Seçim kutuları AÇIK başlıyor ama müşteri istediğini çıkarabiliyor; kapalı başlasa düğme
  boş sepete ekleme yapardı ve blok işe yaramazdı.
*/

type Props = {
  baslik: string
  /** Açık olan ürün — listenin ilk satırı, seçimi kaldırılamaz. */
  mevcut: { stockCode: string; name: string; grossPrice: number; imageUrl?: string | null; slug: string }
  urunler: CatalogItem[]
  currency: string
}

export default function SetCompletion({ baslik, mevcut, urunler, currency }: Props) {
  const { addToCart, cart } = useCart()
  const [secili, setSecili] = useState<string[]>(urunler.filter((u) => u.inStock).map((u) => u.stockCode))
  const [durum, setDurum] = useState<'hazir' | 'ekleniyor' | 'eklendi'>('hazir')
  const [hata, setHata] = useState<string | null>(null)

  if (urunler.length === 0) return null

  const secililer = urunler.filter((u) => secili.includes(u.stockCode))
  const toplam = mevcut.grossPrice + secililer.reduce((t, u) => t + u.grossPrice, 0)

  // Ana ürün sepette zaten varsa TEKRAR EKLENMEZ: `addToCart` adedi artırıyor, müşteri
  // "sepete ekle" düğmesine bir kez basmışsa bu blok ikinci adedi eklerdi.
  const anaUrunSepette = (cart?.lines ?? []).some((l) => l.stockCode === mevcut.stockCode)
  const eklenecekAdet = secililer.length + (anaUrunSepette ? 0 : 1)

  const degistir = (kod: string) =>
    setSecili((onceki) => (onceki.includes(kod) ? onceki.filter((x) => x !== kod) : [...onceki, kod]))

  const sepeteEkle = async () => {
    setDurum('ekleniyor')
    setHata(null)

    // Sırayla ekleniyor, paralel değil: mağaza API'si sepeti tek kayıt olarak güncelliyor,
    // eşzamanlı istekler son yazanın kazandığı bir yarış üretirdi.
    const sira = [
      ...(anaUrunSepette ? [] : [{ stockCode: mevcut.stockCode, name: mevcut.name }]),
      ...secililer.map((u) => ({ stockCode: u.stockCode, name: u.name })),
    ]

    for (const urun of sira) {
      const sonuc = await addToCart(urun.stockCode, 1)
      if (!sonuc.ok) {
        setHata(sonuc.message ?? `${displayName(urun.name)} sepete eklenemedi.`)
        setDurum('hazir')
        return
      }
    }

    setDurum('eklendi')
  }

  return (
    <section className="set-completion">
      <div className="set-completion-head">
        <h2>{baslik}</h2>
        <p>Birlikte alındığında tek teslimat, tek montaj randevusu.</p>
      </div>

      <div className="set-completion-list">
        {/*
          Açık olan ürün listenin ilk satırı ve seçimi kaldırılamaz. Olmadığında toplam
          satırı ("setin toplamı") ile düğmenin yaptığı iş birbirini tutmuyordu: müşteri
          27.900 TL'lik seti eklediğini sanıp sepette yalnız 9.500 TL'lik iki aksesuarı
          buluyordu.
        */}
        <label className="set-item is-on is-current">
          <input type="checkbox" checked disabled readOnly aria-label="Bu ürün" />
          {mediaUrl(mevcut.imageUrl) && (
            <Image
              src={mediaUrl(mevcut.imageUrl) as string}
              alt={displayName(mevcut.name)}
              width={64}
              height={64}
              className="set-item-img"
            />
          )}
          <div className="set-item-body">
            <span className="set-item-name">{displayName(mevcut.name)}</span>
            <div className="set-item-price num">
              {formatPrice(mevcut.grossPrice, currency)}
              <span className="set-item-current"> · bu ürün</span>
            </div>
          </div>
        </label>

        {urunler.map((u) => {
          const isaretli = secili.includes(u.stockCode)
          const gorsel = mediaUrl(u.imageUrl)
          return (
            <label key={u.stockCode} className={`set-item${isaretli ? ' is-on' : ''}${u.inStock ? '' : ' is-out'}`}>
              <input
                type="checkbox"
                checked={isaretli}
                disabled={!u.inStock}
                onChange={() => degistir(u.stockCode)}
                aria-label={`${displayName(u.name)} ekle`}
              />
              {gorsel && (
                <Image src={gorsel} alt={displayName(u.name)} width={64} height={64} className="set-item-img" />
              )}
              <div className="set-item-body">
                <Link href={`/urun/${u.slug}`} className="set-item-name">
                  {displayName(u.name)}
                </Link>
                <div className="set-item-price num">
                  {formatPrice(u.grossPrice, u.currency)}
                  {!u.inStock && <span className="set-item-out"> · tükendi</span>}
                </div>
              </div>
            </label>
          )
        })}
      </div>

      <div className="set-completion-foot">
        <div className="set-total">
          <span>Seçilenlerle toplam</span>
          <b className="num">{formatPrice(toplam, currency)}</b>
        </div>
        {durum === 'eklendi' ? (
          <Link className="btn btn-dark" href="/sepet">
            Sepete eklendi — sepete git
          </Link>
        ) : (
          <button
            type="button"
            className="btn btn-dark"
            onClick={() => void sepeteEkle()}
            disabled={durum === 'ekleniyor' || eklenecekAdet === 0}
          >
            {durum === 'ekleniyor'
              ? 'Ekleniyor…'
              : eklenecekAdet === 0
                ? 'Hepsi sepette'
                : `${eklenecekAdet} ürünü sepete ekle`}
          </button>
        )}
      </div>

      {hata && <div className="set-completion-error">{hata}</div>}
    </section>
  )
}
