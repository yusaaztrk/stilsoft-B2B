import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { X, PhoneOff, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { apiJson } from '../api/client'

/**
 * MÜŞTERİ MEMNUNİYET ANKETİ — Montaj Kabul, Montaj Geçmişi ve Ürün Arıza Kabul
 * (küçük ürün + büyük ev aletleri) ortak kullanır.
 *
 * Ayrı bir bileşen olmasının sebebi ikinci kullanım yeri: anket 2026-08-25'te Montaj
 * Geçmişi'ne de istendi. Kopyalanırsa iki ekran zamanla ayrışır — biri 5 yıldız, diğeri
 * 4; biri notu kaydeder, diğeri etmez. Kaydeden uç (`PUT .../satisfaction`) da tek yerde
 * kalsın diye kayıt buraya alındı.
 *
 * ÜRÜN ARIZA KABUL 2026-08-28'de buraya BAĞLANDI. O sayfa anketin kendi kopyasını
 * taşıyordu ve tam da korkulan şekilde ayrışmıştı: puan 5 önseçili geliyordu, kayıt bir
 * kez alınınca modal kilitleniyordu (yanlış puan düzeltilemiyordu), hücrede yıldız yerine
 * "ALINMADI" rozeti çıkıyordu. Veri tabanında hiçbir fark YOKTU — üç sayfa da aynı dört
 * kolona (`ServiceRecords.Satisfaction*`) aynı uçtan yazıyor; fark tamamen görüntü
 * katmanındaydı.
 *
 * Anket KAYIT seviyesindedir. Montaj Geçmişi'nin satırları kalem eksenlidir; oradan
 * çağrılırken satırın bağlı olduğu kayıt geçilir, kalem değil.
 */

/**
 * ULAŞILAMADI, puan skalasının DIŞINDA bir sonuçtur (2026-08-28 kullanıcı isteği).
 *
 * Müşteriye hiç ulaşılamadığında verilecek bir puan yoktur; 1 yıldız yazmak "memnun
 * değil" demektir ve ortalamayı haksızca aşağı çeker. Bu yüzden ayrı bir işaret olarak
 * -1 saklanıyor: yeni kolon (dolayısıyla göç) gerektirmiyor ve `SatisfactionScore`
 * null'dan da 1..5'ten de ayrışıyor. Sunucudaki süzgeç 0 sorulduğunda null, aksi hâlde
 * eşitlik aradığı için -1 kendiliğinden süzülebiliyor.
 */
export const MEMNUNIYET_ULASILAMADI = -1

export type MemnuniyetKaydi = {
  id: string
  serviceNumber?: string
  satisfactionScore?: number
  satisfactionNotes?: string
  satisfactionBy?: string
  satisfactionCreatedAt?: string
}

export type MemnuniyetAnketiModalProps = {
  /** Anketi açılan kayıt. null ise bileşen hiç render edilmez. */
  kayit: MemnuniyetKaydi | null
  onClose: () => void
  /**
   * Kaydı yapan işlev (sayfanın liste kancasındaki `updateSatisfaction`). Verilirse kayıt
   * onunla yapılır: uç çağrılır VE listedeki satır o anda güncellenir, liste baştan
   * çekilmez. Verilmezse eski yol: uç doğrudan çağrılır.
   */
  kaydet?: (id: string, score: number, notes: string) => Promise<unknown>
  /**
   * Kaydetmeden SONRA arka planda çağrılır, BEKLENMEZ — pencere çoktan kapanmış olur.
   * Listeyi sessizce tazelemek için (ör. `() => refetch(true)`).
   */
  onSaved?: () => void | Promise<void>
}

export default function MemnuniyetAnketiModal({ kayit, onClose, kaydet: kaydetIslevi, onSaved }: MemnuniyetAnketiModalProps) {
  const [score, setScore] = useState(0)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // Modal her açılışta kaydın KENDİ değerleriyle dolar. Yerel durum sıfırlanmazsa bir önceki
  // kaydın puanı yeni kaydın üstünde duruyor ve "Kaydet" yanlış puanı yazıyordu.
  useEffect(() => {
    setScore(Number(kayit?.satisfactionScore) || 0)
    setNotes(kayit?.satisfactionNotes || '')
  }, [kayit?.id, kayit?.satisfactionScore, kayit?.satisfactionNotes])

  if (!kayit) return null

  const ulasilamadi = score === MEMNUNIYET_ULASILAMADI

  /*
    HIZ (2026-10-05 kullanıcı bildirimi: "serviste memnuniyet anketi çok yavaş geliyor").
    Kayıttan sonra `await onSaved()` vardı ve sayfalar oraya `refetch` veriyordu: pencere,
    TÜM listenin "yükleniyor" göstergesiyle baştan çekilmesini bekleyip ancak öyle
    kapanıyordu. Kayıt sayısı arttıkça bu saniyeler sürdü. Artık: tek PUT → satır yerinde
    güncellenir → pencere hemen kapanır; liste tazelemesi arkada, sessiz ve beklenmeden.
  */
  const kaydet = async () => {
    setSaving(true)
    try {
      if (kaydetIslevi) {
        await kaydetIslevi(kayit.id, score, notes)
      } else {
        await apiJson(`/api/servicerecords/${kayit.id}/satisfaction`, {
          method: 'PUT',
          body: JSON.stringify({ satisfactionScore: score, satisfactionNotes: notes })
        })
      }
      toast.success(score === MEMNUNIYET_ULASILAMADI ? 'Ulaşılamadı olarak kaydedildi.' : 'Memnuniyet kaydedildi.')
      onClose()
      if (onSaved) void Promise.resolve(onSaved()).catch(() => undefined)
    } catch (e: any) {
      toast.error('Memnuniyet kaydedilemedi: ' + (e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
          <div className="p-5 border-b border-gray-100 flex items-center justify-between shrink-0">
            <div>
              <div className="text-lg font-bold text-gray-900">Müşteri Memnuniyet Anketi</div>
              <div className="text-xs text-gray-500">Fiş No: {kayit.serviceNumber}</div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          <div className="p-5 overflow-y-auto flex-1 space-y-4">
            <div className="space-y-1.5 text-center">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">Memnuniyet Derecesi</div>
              <div className={`flex items-center justify-center gap-2 text-3xl text-gray-300 ${ulasilamadi ? 'opacity-40' : ''}`}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    // Yıldıza basmak ULAŞILAMADI işaretini kaldırır: ikisi aynı anda doğru olamaz.
                    onClick={() => setScore(star)}
                    className={`hover:scale-110 transition-transform ${star <= score ? 'text-amber-400' : 'text-gray-200'}`}
                  >
                    ★
                  </button>
                ))}
              </div>
              <div className={`text-xs font-semibold ${ulasilamadi ? 'text-rose-600' : 'text-gray-500'}`}>
                {score === 5 && 'Çok Memnun (5/5)'}
                {score === 4 && 'Memnun (4/5)'}
                {score === 3 && 'Orta (3/5)'}
                {score === 2 && 'Memnun Değil (2/5)'}
                {score === 1 && 'Hiç Memnun Değil (1/5)'}
                {score === 0 && 'Değerlendirilmedi'}
                {ulasilamadi && 'Müşteriye Ulaşılamadı'}
              </div>

              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setScore(ulasilamadi ? 0 : MEMNUNIYET_ULASILAMADI)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                    ulasilamadi
                      ? 'bg-rose-50 border-rose-300 text-rose-700'
                      : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  <PhoneOff className="w-3.5 h-3.5" />
                  Müşteriye Ulaşılamadı
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xs font-semibold text-gray-500">Anket Notları / Müşteri Görüşleri</div>
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Müşteri geri bildirimlerini yazınız..."
                className="w-full text-xs p-2.5 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#B91C1C] resize-none"
              />
              <div className="text-[10px] text-gray-400">
                Puan vermeden yalnız not da bırakabilirsiniz; liste o satırı kırmızı tik ile işaretler.
              </div>
            </div>

            {kayit.satisfactionBy && (
              <div className="bg-gray-50 rounded-xl p-3 text-[10px] text-gray-500 space-y-1">
                <div><span className="font-bold">Değerlendiren Yetkili:</span> {kayit.satisfactionBy}</div>
                {kayit.satisfactionCreatedAt && (
                  <div><span className="font-bold">Değerlendirme Tarihi:</span> {new Date(kayit.satisfactionCreatedAt).toLocaleString('tr-TR')}</div>
                )}
              </div>
            )}
          </div>

          <div className="p-5 border-t border-gray-100 flex items-center justify-end gap-2 shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold hover:bg-gray-50"
            >
              Vazgeç
            </button>
            <button
              disabled={saving}
              onClick={kaydet}
              className={`px-4 py-2 rounded-lg text-sm font-semibold text-white ${saving ? 'bg-gray-300 text-gray-650' : 'bg-[#B91C1C] hover:bg-[#991B1B]'}`}
            >
              {saving ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

/**
 * Tablo hücresi. Üç durumu birbirinden AYIRIR (2026-08-28):
 *
 * 1. Ulaşılamadı (-1) → kırmızı rozet; yıldız hiç gösterilmez, çünkü puan değildir.
 * 2. Puan yok ama not var → tek kırmızı tik. Eskiden bu satır 5 gri yıldız ve "Anket Yok"
 *    gösteriyordu; yani girilmiş not ekranda GÖRÜNMÜYOR, kayıt değerlendirilmemiş sanılıyordu.
 * 3. Puan var → amber yıldızlar.
 *
 * Sütun üç sayfada da aynı görünsün diye burada.
 */
export function MemnuniyetHucresi({
  score,
  notes,
  by,
  onClick
}: { score: number; notes?: string; by?: string; onClick?: () => void }) {
  const puan = Number(score) || 0
  const notVar = !!(notes && notes.trim())

  const sarmala = (icerik: ReactNode, baslik: string) => (
    <div
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      className={'flex items-center gap-1 p-1 rounded transition ' + (onClick ? 'cursor-pointer hover:bg-slate-50' : '')}
      title={notVar ? `Not: ${notes}\nKişi: ${by || '-'}` : baslik}
    >
      {icerik}
    </div>
  )

  if (puan === MEMNUNIYET_ULASILAMADI) {
    return sarmala(
      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">
        <PhoneOff className="w-3 h-3" />
        Ulaşılamadı
      </span>,
      'Müşteriye ulaşılamadı'
    )
  }

  if (puan <= 0 && notVar) {
    return sarmala(
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600">
        <CheckCircle2 className="w-4 h-4" />
        Not
      </span>,
      'Puan verilmedi, not var'
    )
  }

  return sarmala(
    <>
      <div className="flex text-amber-400">
        {[1, 2, 3, 4, 5].map((star) => (
          <span key={star} className={`text-sm ${star <= puan ? 'text-amber-400' : 'text-gray-300'}`}>★</span>
        ))}
      </div>
      {puan > 0 ? (
        <span className="text-[10px] text-gray-500 font-bold">({puan})</span>
      ) : (
        <span className="text-[10px] text-gray-400 italic font-semibold">Anket Yok</span>
      )}
    </>,
    'Değerlendirme Ekle'
  )
}
