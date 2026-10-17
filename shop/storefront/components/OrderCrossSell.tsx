import CartCrossSell from '@/components/CartCrossSell'
import { getOrderDetail } from '@/lib/account'
import { getProduct } from '@/lib/api'
import { sepetOnerileri, type OneriSatiri } from '@/lib/cartSuggestions'

/*
  SİPARİŞ SONRASI ÇAPRAZ SATIŞ (2026-09-21).

  Ödeme bitti, sepet boşaldı; müşteri "ödemeniz alındı" ekranında ve alışverişe en açık
  olduğu andadır. Sepetteki motorun aynısı (eksik set parçası, model koduna göre aksesuar,
  aynı kategoriden tamamlayıcı) burada SİPARİŞ SATIRLARINDAN çalışıyor — sepet artık boş.

  Sipariş satırında kategori yok; ürün kartı adresten çekiliyor (en fazla 6 satır, önbellekli
  katalog ucu). Kart bulunamazsa satır yine motora giriyor (set/aksesuar adı üzerinden çalışır),
  yalnız kategori önerisi o satır için çıkmaz.

  Metin bilerek farklı: "aynı teslimatta gelir" sözü burada doğru olmaz — yeni bir sipariş
  açılır. Dürüst hâli: teslimatı birleştirmek için aranabilir.
*/
export default async function OrderCrossSell({ orderNo }: { orderNo: string }) {
  const detail = await getOrderDetail(orderNo)
  const lines = detail?.order.lines ?? []
  if (lines.length === 0) return null

  const satirlar: OneriSatiri[] = await Promise.all(
    lines.slice(0, 6).map(async (l) => {
      const urun = l.slug ? await getProduct(l.slug).catch(() => null) : null
      const adet = l.quantity > 0 ? l.quantity : 1
      return {
        stockCode: l.stockCode,
        name: l.name,
        categorySlug: urun?.categorySlug ?? null,
        unitGrossPrice: urun?.grossPrice ?? (l.lineGross > 0 ? l.lineGross / adet : l.unitPrice),
        lineGross: l.lineGross > 0 ? l.lineGross : l.unitPrice * adet,
      }
    }),
  )

  const oneriler = await sepetOnerileri(satirlar, 3)
  if (oneriler.length === 0) return null

  return (
    <CartCrossSell
      urunler={oneriler}
      baslik="Siparişinizi tamamlayan ürünler"
      aciklama="Sepete ekleyip yeni bir sipariş açabilirsiniz; teslimatı aynı güne almak için bizi aramanız yeterli."
    />
  )
}
