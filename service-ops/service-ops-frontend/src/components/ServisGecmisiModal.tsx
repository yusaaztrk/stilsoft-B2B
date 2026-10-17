import { useEffect, useState } from 'react'
import DurumNotuVeGorselEkle from './DurumNotuVeGorselEkle'
import { X } from 'lucide-react'
import { apiJson } from '../api/client'
import { API_BASE_URL } from '../config'
import { formatProblemDescriptionTR, formatStepDescriptionTR, getStatusLabelTR } from '../utils/serviceHistoryFormat'
import GorselOnizleyici from './GorselOnizleyici'

/**
 * "i" (geçmiş) modalı. Atölye ve Saha sayfalarındaki uygulamanın aynısı; montaj kalemlerinin
 * yanındaki buton da artık bunu açıyor, böylece üç ekranda da aynı adımlar aynı biçimde düşüyor.
 *
 * `taskId` verilirse görünüm KALEM BAZLI olur: özet kartı hâlâ kaydın genel bilgisini gösterir
 * (müşteri/bayi/arıza), ama "Yapılan İşlemler" listesi yalnızca o kalemin kendi durum
 * geçişlerini içerir — kaydın diğer kalemlerinin adımları karışmaz. Bir montaj kaydında birden
 * çok kalem farklı zamanlarda farklı durumlara geçebildiği için (bkz. "her adet ayrı ilerler"
 * kuralı) genel/fatura seviyesinde TEK bir "i" görünümü yanıltıcıydı.
 */

type Props = {
  recordId: string | null
  onClose: () => void
  /** Verilirse geçmiş bu KALEME daralır — kayıt genelindeki diğer kalemlerin adımları girmez. */
  taskId?: string | null
  /** Başlıkta gösterilecek alt metin. */
  subtitle?: string
}

export default function ServisGecmisiModal({ recordId, onClose, taskId = null, subtitle }: Props) {
  // Not/görsel eklendikten sonra tarihçe yeniden çekilsin diye sayaç.
  const [yenile, setYenile] = useState(0)
  const effectiveSubtitle = subtitle ?? (taskId ? '🛠️ Bu Kalemin İşlem Adımları' : '🛠️ Ürün Servis Adımları & İşlem Tarihçesi')
  const [infoData, setInfoData] = useState<any | null>(null)
  const [infoLoading, setInfoLoading] = useState(false)
  const [infoTimeline, setInfoTimeline] = useState<any[]>([])
  const [photoLightboxUrl, setPhotoLightboxUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!recordId) return
    let active = true

    setInfoLoading(true)
    setInfoTimeline([])
    void (async () => {
      try {
        const timelineUrl = taskId
          ? `/api/servicerecords/${recordId}/timeline?taskId=${taskId}`
          : `/api/servicerecords/${recordId}/timeline`
        const [data, tl] = await Promise.all([
          apiJson<any>(`/api/servicerecords/${recordId}`),
          apiJson<any[]>(timelineUrl).catch(() => []),
        ])
        if (!active) return
        setInfoData(data)

        let rawEvents: any[] = Array.isArray(tl) ? tl : []
        if (rawEvents.length === 0 && data && Array.isArray(data.notes)) {
          rawEvents = data.notes
        }

        const initialPhotos: string[] = []
        const subsequentCards: any[] = []

        for (const ev of rawEvents) {
          const evPhotos = (ev.photos || []).map((p: any) => typeof p === 'string' ? p : (p.url || p.path)).filter(Boolean)
          const evTime = new Date(ev.createdAt || ev.timestamp || data?.createdAt).getTime()
          const recTime = new Date(data?.createdAt || Date.now()).getTime()

          // İlk fotoğraflar (kayıt açılışının 2 dakikası içinde) özet karta gider.
          if ((ev.type === 'photo' || ev.statusLabel === 'Fotoğraf Yüklendi') && Math.abs(evTime - recTime) < 120000 && subsequentCards.length === 0) {
            initialPhotos.push(...evPhotos)
            continue
          }

          // 2 dakika içindeki fotoğraf hareketi bir önceki adımla birleşir.
          if (ev.type === 'photo' && subsequentCards.length > 0) {
            const lastCard = subsequentCards[subsequentCards.length - 1]
            const diffMs = Math.abs(evTime - new Date(lastCard.createdAt).getTime())
            if (diffMs < 120000) {
              lastCard.photos = Array.from(new Set([...(lastCard.photos || []), ...evPhotos]))
              continue
            }
          }

          subsequentCards.push({
            id: ev.id,
            // Kalem görünümünde kaydın geneline ait adımlar da listeleniyor (kabul, sahaya
            // aktarım, faturalama). Rozet olmadan bunlar "bu kaleme yapılmış" sanılıyordu.
            isRecordLevel: ev.isRecordLevel === true,
            authorName: (ev.authorName && ev.authorName !== 'Sistem')
              ? ev.authorName
              : ((ev.user && ev.user !== 'Sistem')
                ? ev.user
                : ((ev.performedBy && ev.performedBy !== 'Sistem') ? ev.performedBy : (data?.assignedTechnicianName || 'Sistem'))),
            createdAt: ev.createdAt || ev.timestamp || data?.createdAt,
            fromStatus: ev.fromStatus || ev.oldStatus,
            toStatus: ev.toStatus || ev.newStatus || ev.status,
            statusLabel: ev.statusLabel || (ev.type === 'photo' ? 'Fotoğraf Yüklendi' : 'İşlem Güncellemesi'),
            content: ev.content || ev.note || ev.description || '',
            photos: evPhotos,
          })
        }

        // "İlk Ürün Kabulü" kaydın genelinin açılış adımıdır — kalem bazlı görünümde yeri yok,
        // yalnızca o kalemin kendi adımları listelenir.
        if (taskId) {
          setInfoTimeline(subsequentCards)
        } else {
          const firstEvent = subsequentCards.find(c => c.authorName && c.authorName !== 'Sistem' && c.authorName !== 'system')
          const initialAuthor = firstEvent?.authorName || data?.createdByName || data?.assignedTechnicianName || 'Servis Kabul Yetkilisi'
          const initialCard = {
            id: 'initial-entry',
            authorName: initialAuthor,
            createdAt: data?.createdAt || new Date().toISOString(),
            fromStatus: null,
            toStatus: data?.status || 'New',
            statusLabel: 'İlk Ürün Kabulü',
            content: `📦 İLK ÜRÜN KABULÜ YAPILDI\n• Müşteri: ${data?.customerName || '-'} (${data?.customerPhone || ''})${data?.dealerName ? '\n• Bayi: ' + data.dealerName : ''}\n• Arıza / Şikayet:\n${formatProblemDescriptionTR(data?.problemDescription)}\n• Seri Numarası: ${data?.serialNumber || 'SN Yok'}${data?.receivingNote ? '\n• Teslim Alma Notu: ' + data.receivingNote : ''}`,
            photos: Array.from(new Set(initialPhotos)),
          }
          setInfoTimeline([initialCard, ...subsequentCards])
        }
      } catch {
        if (active) setInfoData(null)
      } finally {
        if (active) setInfoLoading(false)
      }
    })()

    return () => { active = false }
  }, [recordId, taskId, yenile])

  if (!recordId) return null

  const close = () => {
    setInfoData(null)
    setInfoTimeline([])
    onClose()
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60]" onClick={close} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4">
        <div className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col border border-gray-200">

          <div className="p-4 sm:p-5 bg-slate-900 text-white flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-red-600 flex items-center justify-center font-black text-white shadow font-mono text-sm">
                {infoData?.serviceNumber ? infoData.serviceNumber.slice(0, 2) : 'SR'}
              </div>
              <div>
                <div className="text-base font-black tracking-tight flex items-center gap-2">
                  <span>{infoData?.serviceNumber || 'Servis Kaydı'}</span>
                  {infoData?.statusLabel && (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-white/20 text-white border border-white/30">
                      {infoData.statusLabel}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-300 font-medium">{effectiveSubtitle}</div>
              </div>
            </div>
            <button onClick={close} className="p-2 hover:bg-white/10 rounded-full transition-colors text-white cursor-pointer">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-5 overflow-y-auto space-y-5 bg-slate-50/60">
            {/*
              DURUM NOTU / GÖRSEL EKLE (2026-08-24, kullanıcı isteği: "montaj geçmişinde
              işlemin altındaki saate basınca açılan yerde durum notu ekle butonu olmalıydı").

              Tarihçeyi okuyan kişi çoğu zaman ekleyecek bir şeyi de olan kişidir; ayrı bir
              ekrana gitmeye zorlamak yerine burada duruyor. Kaydın DURUMUNU değiştirmez —
              yalnızca not ve görsel iliştirir; durum akışı ilgili yönetim ekranından yürür.
            */}
            <DurumNotuVeGorselEkle
              recordId={String(recordId)}
              onSaved={() => { setYenile((n) => n + 1) }}
            />

            {infoLoading ? (
              <div className="py-12 text-center text-sm text-gray-500 font-medium animate-pulse">İşlem Geçmişi Yükleniyor...</div>
            ) : !infoData ? (
              <div className="py-12 text-center text-sm text-red-500 font-medium">Bilgi yüklenemedi.</div>
            ) : (
              <>
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
                    <div className="text-xs font-bold text-gray-800 uppercase tracking-wider">Cihaz & Müşteri Özeti</div>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-950">
                      {infoData.productName}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-[10px] text-gray-400 font-bold uppercase">Müşteri Adı &amp; Tel</span>
                      <div className="font-bold text-gray-900 mt-0.5">{infoData.customerName || '-'}</div>
                      <div className="text-[10px] text-gray-500 font-mono">{infoData.customerPhone || ''}</div>
                      {infoData.customerAddress && (
                        <div className="text-[10px] text-gray-400 mt-1 max-w-[250px] whitespace-pre-wrap leading-tight">{infoData.customerAddress}</div>
                      )}
                    </div>
                    <div>
                      <span className="text-[10px] text-gray-400 font-bold uppercase">Seri Numarası &amp; Bölge</span>
                      <div className="font-mono font-bold text-gray-800 mt-0.5">{infoData.serialNumber || 'SN Yok'}</div>
                      <div className="text-[10px] text-gray-500 font-medium">{infoData.regionName || '-'}</div>
                    </div>

                    {Array.isArray(infoData.items) && infoData.items.length > 0 && (
                      <div className="col-span-2 bg-slate-50 p-2.5 rounded-xl border border-slate-150 text-xs">
                        <div className="font-bold text-slate-700 mb-1">Montaj Kalemleri ({infoData.items.length})</div>
                        <div className="space-y-0.5">
                          {infoData.items.map((it: any) => (
                            <div key={it.id} className="flex items-center justify-between gap-2 text-gray-800">
                              <span className="truncate">{it.productName}</span>
                              <span className="font-bold text-gray-600 shrink-0">{it.quantity} adet</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {infoData.problemDescription && (
                      <div className="col-span-2 bg-red-50 p-2.5 rounded-xl border border-red-100 text-xs">
                        <div className="font-bold text-red-700 mb-0.5">Arıza / Şikayet</div>
                        <div className="text-gray-800 leading-relaxed whitespace-pre-line">
                          {formatProblemDescriptionTR(infoData.problemDescription)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center justify-between">
                    <span>📋 Yapılan İşlemler ve Ürün Tarihçesi ({infoTimeline.length} Adım)</span>
                    <span className="text-[10px] font-semibold text-slate-500 font-mono">Adım Adım Liste</span>
                  </div>

                  {infoTimeline.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-xs text-gray-400">
                      Henüz geçmiş işlem kaydı yok.
                    </div>
                  ) : (
                    infoTimeline.map((item: any, idx: number) => {
                      const author = item.authorName || item.user || item.performedBy || infoData?.assignedTechnicianName || 'Servis Kabul Yetkilisi'
                      const initials = author.split(' ').filter(Boolean).slice(0, 2).map((n: string) => n[0]).join('').toUpperCase() || 'SK'
                      const dateObj = item.createdAt ? new Date(item.createdAt) : new Date()
                      const dateStr = dateObj.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' - ' + dateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })

                      const photos: any[] = item.photos || (item.photoUrl ? [item.photoUrl] : [])
                      const fromStatus = item.fromStatus || item.oldStatus
                      const toStatus = item.toStatus || item.newStatus || item.status

                      const noteText = item.content || item.note || item.description
                      const isGenericNote = !noteText || noteText === 'Durum güncellemesi yapıldı.' || noteText === 'İşlem gerçekleştirildi.'

                      return (
                        <div key={idx} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden transition hover:shadow-md">
                          <div className="p-3 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-2 shadow-inner">
                            <div className="flex items-center gap-1.5 text-xs font-black">
                              {fromStatus && toStatus ? (
                                <div className="flex items-center gap-1.5 bg-white/10 px-2.5 py-1 rounded-lg border border-white/20">
                                  <span className="text-gray-300 font-semibold">{getStatusLabelTR(fromStatus)}</span>
                                  <span className="text-orange-400 font-extrabold">➔</span>
                                  <span className="text-emerald-400 font-extrabold">{getStatusLabelTR(toStatus)}</span>
                                </div>
                              ) : (
                                <span className="bg-red-600 text-white px-2.5 py-1 rounded-lg text-xs font-bold shadow-sm">
                                  {item.statusLabel || (toStatus ? getStatusLabelTR(toStatus) : 'İlk Ürün Kabulü')}
                                </span>
                              )}
                            </div>

                            <div className="text-[11px] font-mono text-slate-300 font-bold bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-700">
                              🕒 {dateStr}
                            </div>
                          </div>

                          <div className="px-4 py-2.5 bg-slate-50 border-b border-gray-100 flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 rounded-lg bg-red-600 text-white flex items-center justify-center font-bold text-xs shadow-sm">
                                {initials}
                              </div>
                              <div>
                                <div className="font-bold text-gray-900 leading-tight">{author}</div>
                                <div className="text-[10px] text-gray-500 font-medium">İşlemi Yapan Personel</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {item.isRecordLevel && (
                                <span
                                  className="text-[10px] font-bold text-slate-600 bg-white border border-slate-300 px-2 py-0.5 rounded"
                                  title="Bu adım kaydın tamamına ait; tek bir kaleme değil."
                                >
                                  Kayıt Geneli
                                </span>
                              )}
                              <span className="text-[10px] font-bold text-slate-500 bg-slate-200/70 px-2 py-0.5 rounded">
                                Adım #{idx + 1}
                              </span>
                            </div>
                          </div>

                          {photos.length > 0 && (
                            <div className="p-3 bg-slate-100/70 border-b border-gray-100">
                              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                                <span>📷 İşlem Görselleri ({photos.length})</span>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {photos.map((photo: any, pIdx: number) => {
                                  const rawUrl = typeof photo === 'string' ? photo : (photo.url || photo.path)
                                  const photoUrl = !rawUrl ? '' : (rawUrl.startsWith('http') || rawUrl.startsWith('data:') ? rawUrl : `${API_BASE_URL}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`)
                                  return (
                                    <div
                                      key={pIdx}
                                      onClick={() => setPhotoLightboxUrl(photoUrl)}
                                      className="relative aspect-video rounded-xl overflow-hidden bg-black/5 cursor-pointer border border-gray-200 group shadow-sm"
                                    >
                                      <img src={photoUrl} alt="İşlem Görseli" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white font-bold text-xs gap-1">
                                        🔍 Büyüt (Görsel Detayı)
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )}

                          <div className="p-4 bg-white space-y-1.5">
                            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">İşlem Açıklaması</div>
                            <p className="text-xs text-gray-900 font-medium leading-relaxed whitespace-pre-line bg-slate-50 p-3 rounded-xl border border-slate-100">
                              {isGenericNote && fromStatus && toStatus
                                ? `Ürün durumu "${getStatusLabelTR(fromStatus)}" aşamasından "${getStatusLabelTR(toStatus)}" aşamasına güncellendi.`
                                : formatStepDescriptionTR(noteText || 'İşlem gerçekleştirildi.')}
                            </p>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/*
        Eski hâli görseli sadece tam ekran basıyordu: yakınlaştırma yoktu, etiket/seri no
        okunamıyordu. Ortak görüntüleyici tekerlek, iki parmak ve çift dokunuşla büyütür.
      */}
      <GorselOnizleyici
        gorseller={photoLightboxUrl ? [photoLightboxUrl] : []}
        acikIndex={photoLightboxUrl ? 0 : null}
        onKapat={() => setPhotoLightboxUrl(null)}
      />
    </>
  )
}
