import { useEffect, useMemo, useState } from 'react'
import { X, Paperclip } from 'lucide-react'
import { API_BASE_URL } from '../config'
import { getAccessToken } from '../auth/storage'

/**
 * KABUL EKRANLARINDAN SONRADAN NOT VE GÖRSEL EKLEME.
 *
 * (2026-08-24, kullanıcı isteği: "resim sonradan ekleyebilmemiz lazım... durum notu ekle gibi
 * bir şey olmalı, üç tür için de".)
 *
 * Kabul ekranları bilinçli olarak DURUM DEĞİŞTİRMİYOR — kaydın durumu ilgili yönetim
 * ekranından (Saha / Atölye / Montaj) yürüyor ve çekmecede bunu söyleyen bir uyarı var.
 * Buradaki iş durum değiştirmek değil: kabulden sonra eline geçen bir belgeyi ya da bilgiyi
 * kayda İLİŞTİRMEK. O yüzden yalnızca not ve görsel yazılır, durum alanına dokunulmaz.
 *
 * Not ve görseller AYRI uçlara gider (`/notes` ve `/photo`); ikisi de doluysa önce not
 * yazılır. Görsellerden biri yüklenemezse diğerleri iptal EDİLMEZ — yüklenenler kayda
 * girmiş olur ve hangisinin başarısız olduğu söylenir; hepsini geri almak, sahada çekilmiş
 * bir fotoğrafı ikinci kez istemek demekti.
 */

export type DurumNotuVeGorselEkleProps = {
  recordId: string
  /** Kaydedildikten sonra çağrılır (liste/zaman çizelgesi tazelensin diye). */
  onSaved?: () => void | Promise<void>
  className?: string
}

export default function DurumNotuVeGorselEkle({ recordId, onSaved, className }: DurumNotuVeGorselEkleProps) {
  const [acik, setAcik] = useState(false)
  const [not, setNot] = useState('')
  const [dosyalar, setDosyalar] = useState<File[]>([])
  const [kaydediyor, setKaydediyor] = useState(false)
  const [hata, setHata] = useState<string | null>(null)
  const [basari, setBasari] = useState<string | null>(null)

  // Önizleme adresleri dosya listesiyle birlikte üretilir ve liste değişince serbest
  // bırakılır; render içinde üretilseydi her çizimde yeni nesne birikirdi.
  const onizlemeler = useMemo(() => dosyalar.map((f) => URL.createObjectURL(f)), [dosyalar])
  useEffect(() => () => onizlemeler.forEach((u) => URL.revokeObjectURL(u)), [onizlemeler])

  const temizle = () => {
    setNot('')
    setDosyalar([])
    setHata(null)
  }

  const kaydet = async () => {
    const metin = not.trim()
    if (!metin && dosyalar.length === 0) {
      setHata('Not yazın ya da görsel seçin.')
      return
    }

    setKaydediyor(true)
    setHata(null)
    setBasari(null)

    const token = getAccessToken()
    const basliklar = token ? { Authorization: `Bearer ${token}` } : undefined

    try {
      if (metin) {
        const res = await fetch(`${API_BASE_URL}/api/servicerecords/${encodeURIComponent(recordId)}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(basliklar ?? {}) },
          body: JSON.stringify({ content: metin }),
        })
        if (!res.ok) throw new Error((await res.text().catch(() => '')) || `Not kaydedilemedi (${res.status})`)
      }

      const basarisiz: string[] = []
      for (const dosya of dosyalar) {
        const form = new FormData()
        form.append('file', dosya)
        const res = await fetch(`${API_BASE_URL}/api/servicerecords/${encodeURIComponent(recordId)}/photo`, {
          method: 'POST',
          headers: basliklar,
          body: form,
        })
        if (!res.ok) basarisiz.push(dosya.name)
      }

      if (basarisiz.length > 0) {
        setHata(`${basarisiz.length} görsel yüklenemedi: ${basarisiz.join(', ')}`)
      } else {
        setBasari(
          metin && dosyalar.length > 0
            ? `Not ve ${dosyalar.length} görsel eklendi.`
            : metin
              ? 'Not eklendi.'
              : `${dosyalar.length} görsel eklendi.`
        )
        temizle()
        setAcik(false)
      }

      await onSaved?.()
    } catch (e: any) {
      setHata(String(e?.message ?? 'Kaydedilemedi'))
    } finally {
      setKaydediyor(false)
    }
  }

  if (!acik) {
    return (
      <div className={className}>
        {basari && (
          <div className="mb-2 rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-[11px] font-semibold text-green-700">
            {basari}
          </div>
        )}
        <button
          type="button"
          onClick={() => { setAcik(true); setBasari(null) }}
          className="w-full py-2 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 inline-flex items-center justify-center gap-2"
        >
          <Paperclip className="w-4 h-4" />
          Durum Notu / Görsel Ekle
        </button>
      </div>
    )
  }

  return (
    <div className={'rounded-xl border border-gray-200 bg-white p-3 space-y-3 ' + (className ?? '')}>
      <div className="text-xs font-semibold text-gray-500">Durum Notu / Görsel Ekle</div>

      <textarea
        value={not}
        onChange={(e) => setNot(e.target.value)}
        placeholder="Kayda eklenecek not..."
        className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full min-h-[80px] resize-none"
      />

      {dosyalar.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {dosyalar.map((dosya, i) => (
            <div key={`${dosya.name}-${dosya.size}-${i}`} className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200 bg-gray-100">
              <img src={onizlemeler[i]} alt={dosya.name} className="w-full h-full object-cover" />
              <button
                type="button"
                title="Görseli kaldır"
                onClick={() => setDosyalar((p) => p.filter((_, j) => j !== i))}
                className="absolute top-0.5 right-0.5 bg-red-600 text-white rounded-full p-0.5 shadow"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          const yeni = Array.from(e.target.files || [])
          // Seçim EKLENİR: bir görseli silip yenisini eklerken kalanlar kaybolmasın.
          setDosyalar((p) => {
            const anahtar = (f: File) => `${f.name}|${f.size}|${f.lastModified}`
            const mevcut = new Set(p.map(anahtar))
            return [...p, ...yeni.filter((f) => !mevcut.has(anahtar(f)))]
          })
          // Kaldırılan dosya tekrar seçilebilsin diye alan sıfırlanır.
          e.target.value = ''
        }}
        className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs w-full"
      />

      {hata && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[11px] font-semibold text-red-600">{hata}</div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={kaydediyor}
          onClick={() => void kaydet()}
          className={'flex-1 py-2 rounded-xl text-sm font-semibold ' + (kaydediyor ? 'bg-gray-300 text-gray-600' : 'bg-gray-900 text-white hover:bg-gray-800')}
        >
          {kaydediyor ? 'Kaydediliyor...' : 'Kaydet'}
        </button>
        <button
          type="button"
          disabled={kaydediyor}
          onClick={() => { temizle(); setAcik(false) }}
          className="px-4 py-2 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Vazgeç
        </button>
      </div>
    </div>
  )
}
