import type { Metadata } from 'next'
import Link from 'next/link'
import CartTable from '@/components/CartTable'
import CartCrossSell from '@/components/CartCrossSell'
import CheckoutHelpBox from '@/components/CheckoutHelpBox'
import KktcGate from '@/components/KktcGate'
import { getCart } from '@/lib/cart'
import { sepetOnerileri } from '@/lib/cartSuggestions'
import { getStorefront } from '@/lib/api'
import { COMPANY_FALLBACK, resolveCompanyInfo } from '@/lib/companyInfo'

export const metadata: Metadata = {
  title: 'Sepetim',
  robots: { index: false, follow: false },
}

export default async function CartPage() {
  // Sepet girişsiz açılır (2026-09-20): misafir sepeti zaten oturuma bağlı, üyelik ödeme
  // adımında telefonla saniyeler içinde açılıyor. Sepeti görmek için üye olmaya zorlamak
  // müşteriyi daha ürüne bakarken kaçırıyordu.
  const cart = await getCart()

  // Çapraz satış sunucuda hesaplanıyor: sepet zaten burada, katalog listesi 300 sn önbellekli.
  const [oneriler, settings] = await Promise.all([sepetOnerileri(cart.lines, 3), getStorefront().catch(() => null)])

  return (
    <div className="wrap">
      <div className="crumbs">
        <Link href="/">Anasayfa</Link>
        <span>›</span>
        <span>Sepetim</span>
      </div>

      <div className="cart-page">
        <h1>Sepetim</h1>
        {/* Konum doğrulaması BİR KEZ burada (ödeme sayfasında değil) — bkz. KktcGate. */}
        <KktcGate>
          <CartTable initial={cart} />
        </KktcGate>

        {/*
          Çapraz satış sepet tablosunun ALTINDA: müşterinin önce ne aldığını görmesi,
          sonra "bunu da ister misin" sorusunu duyması gerekiyor. Üstte olsaydı sepeti
          görmeden önerilerle karşılaşırdı.
        */}
        {cart.lines.length > 0 && <CartCrossSell urunler={oneriler} />}

        {/*
          SEPETTE "SİZİ ARAYALIM" (2026-09-21).

          Sepeti dolduran ama ödeme adımını tamamlamayan müşteri, e-ticaretteki en pahalı
          kayıp: ürünü seçmiş, fiyatı kabul etmiş, son adımda duruyor. Kart bilgisi girmek
          istemeyen ya da havale/EFT'de tereddüt eden müşteri için buradaki tek satır,
          siparişin telefonda kapanmasını sağlıyor.

          Çapraz satışın ALTINDA: önce "bunu da ekle", sonra "yardım ister misin".
        */}
        {/* 2026-10-04: "Takıldınız mı?" kutusu — tek dokunuşla arama + WhatsApp + "beni arayın". */}
        {cart.lines.length > 0 && (
          <div className="cart-geri-ara">
            <CheckoutHelpBox
              kaynak="sepet"
              telefon={resolveCompanyInfo(settings).phone}
              whatsapp={settings?.whatsAppNumber?.trim() || COMPANY_FALLBACK.whatsApp}
            />
          </div>
        )}
      </div>
    </div>
  )
}
