import { ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * GÜN SEÇİCİ — günlük çalışan listeler için.
 *
 * "Teslimattakiler" ve "Saha Planlaması" günlük ekranlardır: personel sabah açtığında O GÜNÜN
 * işlerini görmeli, bütün işler karışık gelmemeli (kullanıcı isteği, 2026-08-24). Bu yüzden
 * seçim varsayılan olarak BUGÜN'dür.
 *
 * ÇIKIŞ KAPISI ZORUNLU. Aynı özellik daha önce bir kez açılıp geri alınmıştı: tarih sessizce
 * uygulanıyor, kullanıcı neredeyse boş bir liste görüp "kayıtlar gelmiyor" sanıyordu. Burada
 * hangi güne bakıldığı AÇIKÇA yazıyor ve "Tümü" tek tıkla kısıtı kaldırıyor.
 *
 * Bileşen kendi durumunu tutmaz; tarihi çağıran sayfa yönetir (sekme değişince temizlemek
 * gerekiyor, o bilgi burada yok).
 */

export function bugunIso(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  // `toISOString()` UTC'ye çevirir; yerel saatle 03:00'ten önce DÜNÜ verir. Gün sınırı
  // kullanıcının takvimine göre olmalı.
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** ISO günü n gün kaydırır. */
export function gunKaydir(iso: string, gun: number): string {
  const temel = iso || bugunIso()
  const d = new Date(`${temel}T00:00:00`)
  d.setDate(d.getDate() + gun)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function etiket(iso: string): string {
  if (!iso) return 'Tüm günler'
  const bugun = bugunIso()
  if (iso === bugun) return 'Bugün'
  if (iso === gunKaydir(bugun, -1)) return 'Dün'
  if (iso === gunKaydir(bugun, 1)) return 'Yarın'
  const d = new Date(`${iso}T00:00:00`)
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('tr-TR')
}

export type GunSeciciProps = {
  /** Seçili gün (yyyy-aa-gg). Boş metin = kısıt yok. */
  deger: string
  onChange: (iso: string) => void
  /** Süzgeçten sonra kalan satır sayısı — kullanıcı neyi gördüğünü bilsin. */
  adet?: number
  className?: string
}

export default function GunSecici({ deger, onChange, adet, className }: GunSeciciProps) {
  const kisitli = Boolean(deger)

  return (
    <div className={'flex flex-wrap items-center gap-1.5 ' + (className ?? '')}>
      <button
        type="button"
        title="Önceki gün"
        onClick={() => onChange(gunKaydir(deger, -1))}
        className="h-[34px] w-[34px] flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      <input
        type="date"
        value={deger}
        onChange={(e) => onChange(e.target.value)}
        className="h-[34px] px-2.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
      />

      <button
        type="button"
        title="Sonraki gün"
        onClick={() => onChange(gunKaydir(deger, 1))}
        className="h-[34px] w-[34px] flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
      >
        <ChevronRight className="w-4 h-4" />
      </button>

      <button
        type="button"
        onClick={() => onChange(bugunIso())}
        className="h-[34px] px-3 text-xs font-semibold rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
      >
        Bugün
      </button>

      {/* Kısıtın görünür olması ve tek tıkla kalkması: boş liste "kayıt yok" sanılmasın. */}
      <span
        className={
          'h-[34px] inline-flex items-center gap-2 px-3 rounded-lg text-xs font-semibold border ' +
          (kisitli
            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
            : 'bg-gray-50 text-gray-500 border-gray-200')
        }
      >
        {etiket(deger)}
        {typeof adet === 'number' ? ` · ${adet} kayıt` : ''}
        {kisitli && (
          <button
            type="button"
            title="Tarih kısıtını kaldır"
            onClick={() => onChange('')}
            className="text-emerald-700 hover:text-emerald-900 font-bold"
          >
            Tümü
          </button>
        )}
      </span>
    </div>
  )
}
