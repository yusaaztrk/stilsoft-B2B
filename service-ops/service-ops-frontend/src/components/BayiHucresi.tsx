import { useEffect, useState } from 'react'
import { bayiEtiketi, anaCariKodu } from '../utils/bayiEtiketi'
import { fetchErpDealers } from '../api/erp'

/**
 * Montaj listelerindeki "Bayi" sütununun tek hücre bileşeni.
 *
 * Gerekçe ve dört farklı kaynak biçimin dökümü: `utils/bayiEtiketi.ts` dosya başında.
 *
 * İKİ SATIR: üstte ad, altta soluk kod. Tek satırda "AD (kod)" yazmak yerine böyle
 * yapıldı çünkü sütun dar ve uzun ticaret unvanları kodu satır dışına itiyordu; ayrıca
 * personel listede göz gezdirirken ADA bakıyor, kod yalnız doğrulama için gerekli.
 *
 * ADI OLMAYAN KAYIT GİZLENMİYOR: kod soluk ve italik gösterilip yanına küçük bir
 * "ad yok" işareti konuyor. Uydurma bir ad basmak ya da satırı boş bırakmak, verinin
 * eksik olduğunu saklardı — oysa bu kayıtların backend tarafında düzeltilmesi gerekiyor.
 */
/*
 * KAYITTA AD YOKSA CARİDEN ÇÖZÜLÜR (2026-09-27). Eski kayıtların ad alanında yalnız kod
 * var (`120-01-000626-1`); ad ana cari kartından okunup gösteriliyor. Kayıt DEĞİŞMEZ —
 * yalnız ekran. Her ana kod için tek istek; sonuç sayfa ömrü boyunca saklanır.
 */
const adOnbellegi = new Map<string, Promise<string>>()

function cariAdiCoz(kod: string): Promise<string> {
  const ana = anaCariKodu(kod)
  let bekleyen = adOnbellegi.get(ana)
  if (!bekleyen) {
    bekleyen = fetchErpDealers(undefined, ana, 'all')
      .then(list => (list.find(d => d.customerCode === ana) ?? list.find(d => d.customerCode === kod))?.name ?? '')
      .catch(() => '')
    adOnbellegi.set(ana, bekleyen)
  }
  return bekleyen
}

export default function BayiHucresi({
  dealerName,
  dealerCode,
}: {
  dealerName?: string | null
  dealerCode?: string | null
}) {
  const etiket = bayiEtiketi(dealerName, dealerCode)
  const [cozulenAd, setCozulenAd] = useState('')

  useEffect(() => {
    if (!etiket.adYok || !etiket.kod) return
    let aktif = true
    void cariAdiCoz(etiket.kod).then(ad => { if (aktif) setCozulenAd(ad) })
    return () => { aktif = false }
  }, [etiket.adYok, etiket.kod])

  const ad = etiket.ad || cozulenAd
  const kod = etiket.kod
  const adYok = !ad

  if (!ad && !kod) return <span className="text-gray-400">-</span>

  if (adYok) {
    return (
      <span className="inline-flex items-center gap-1.5" title="Bu kayıtta bayi adı yok, yalnız cari kodu var.">
        <span className="font-mono text-xs italic text-gray-500">{kod}</span>
        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">
          ad yok
        </span>
      </span>
    )
  }

  return (
    <span className="block min-w-0 w-full max-w-full">
      <span className="block truncate text-sm font-medium text-gray-900" title={ad}>
        {ad}
      </span>
      {kod && <span className="block font-mono text-[11px] leading-tight text-gray-400">{kod}</span>}
    </span>
  )
}
