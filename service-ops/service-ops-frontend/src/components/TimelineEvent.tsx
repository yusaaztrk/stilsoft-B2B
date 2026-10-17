import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { statusLabel } from '../utils/statusLabels'
import { API_BASE_URL } from '../config'
import GorselOnizleyici from './GorselOnizleyici'

interface TimelineEventProps {
  ev: any
  idx: number
}

const typeLabel: Record<string, string> = {
  StatusChanged: 'Durum Değişikliği',
  Assigned: 'Teknisyen Atandı',
  NoteAdded: 'Not Eklendi',
  WorkLogged: 'İş Kaydı',
  Created: 'Oluşturuldu',
  PhotoUploaded: 'Fotoğraf Yüklendi',
  FaultUpdate: 'Arıza Güncellemesi',
}

const badgeColor: Record<string, string> = {
  StatusChanged: 'bg-blue-100 text-blue-700',
  Assigned: 'bg-purple-100 text-purple-700',
  NoteAdded: 'bg-amber-100 text-amber-700',
  WorkLogged: 'bg-emerald-100 text-emerald-700',
  Created: 'bg-gray-100 text-gray-700',
  PhotoUploaded: 'bg-teal-100 text-teal-700',
  FaultUpdate: 'bg-rose-100 text-rose-700',
}

export default function TimelineEvent({ ev, idx }: TimelineEventProps) {
  const photoUrls = ev.photoUrls || (ev.photoUrl ? [ev.photoUrl] : [])
  const [buyutulenIdx, setBuyutulenIdx] = useState<number | null>(null)
  const tamUrl = (u: string) => (u.startsWith('http') || u.startsWith('data:') ? u : `${API_BASE_URL}${u}`)
  const [currentIdx, setCurrentIdx] = useState(0)

  const prevImage = (e: React.MouseEvent) => {
    e.stopPropagation()
    setCurrentIdx((prev) => (prev === 0 ? photoUrls.length - 1 : prev - 1))
  }

  const nextImage = (e: React.MouseEvent) => {
    e.stopPropagation()
    setCurrentIdx((prev) => (prev === photoUrls.length - 1 ? 0 : prev + 1))
  }

  let payload: any = {}
  try {
    payload = typeof ev.payload === 'string' ? JSON.parse(ev.payload) : (ev.payload || {})
  } catch {}

  if (payload.reason === 'Manual installation allocation') {
    payload.reason = 'Manuel montaj planlaması/ataması';
  } else if (payload.reason === 'Installation task planned and assigned') {
    payload.reason = 'Montaj görevi planlandı ve atandı';
  }

  return (
    <div key={idx} className="bg-gray-50 rounded-lg p-3 border-l-2 border-gray-200">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${badgeColor[ev.type] || 'bg-gray-100 text-gray-600'}`}>
            {typeLabel[ev.type] || ev.type}
          </span>
          <span className="text-xs font-semibold text-gray-700">{ev.actor || 'Sistem'}</span>
        </div>
        <span className="text-[10px] text-gray-400 shrink-0">
          {new Date(ev.timestamp).toLocaleString('tr-TR')}
        </span>
      </div>
      {ev.type === 'Assigned' && (
        <div className="text-xs text-gray-700 mt-1">
          <span className="text-gray-500">Teknisyen: </span>
          <span className="font-semibold">{payload.newValue || ev.technicianName || '-'}</span>
          {payload.reason && (
            <div className="mt-1 bg-white border border-gray-100 rounded px-2 py-1 text-gray-600 italic">
              "{payload.reason}"
            </div>
          )}
        </div>
      )}

      {ev.type === 'WorkLogged' && (
        <div className="text-xs text-gray-700 mt-1">
          {payload.reason || '-'}
          {payload.metadata?.Duration && (
            <span className="ml-1.5 text-gray-400">({payload.metadata.Duration} dk)</span>
          )}
        </div>
      )}

      {ev.type === 'StatusChanged' && (
        <div className="text-xs text-gray-700 mt-1">
          <span className="font-semibold">{payload.reason || `${payload.oldValue} → ${payload.newValue}`}</span>
        </div>
      )}

      {ev.type === 'Created' && (
        <div className="text-xs text-gray-500 mt-1">Kayıt sisteme eklendi.</div>
      )}

      {ev.type === 'FaultUpdate' && (
        <div className="text-xs text-gray-700 mt-1 space-y-2">
          {/* 1. Eklenen Görsel */}
          {photoUrls.length > 0 && (
            <div className="relative group max-w-xs overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm my-1.5">
              <img
                src={photoUrls[currentIdx].startsWith('http') ? photoUrls[currentIdx] : `${API_BASE_URL}${photoUrls[currentIdx]}`}
                alt={`Saha Fotoğrafı ${currentIdx + 1}`}
                className="w-full h-auto max-h-48 object-cover cursor-zoom-in hover:scale-[1.02] transition-transform duration-200"
                /*
                  Eskiden `window.open` ile YENİ SEKMEDE açılıyordu; WebView uygulamasında bu
                  kullanıcıyı tarayıcıya atıyor ve geri dönmek zor. Artık uygulamanın içinde
                  yakınlaştırılabilir görüntüleyici açılıyor, oklarla diğer fotoğraflara da geçiliyor.
                */
                onClick={() => setBuyutulenIdx(currentIdx)}
              />

              {photoUrls.length > 1 && (
                <>
                  <button
                    onClick={prevImage}
                    className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1 transition-colors z-10"
                    type="button"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={nextImage}
                    className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1 transition-colors z-10"
                    type="button"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded font-medium select-none z-10">
                    {currentIdx + 1} / {photoUrls.length}
                  </div>
                </>
              )}
            </div>
          )}

          {/* 2. Durum Değişikliği */}
          {ev.statusChange && (
            <div>
              <span className="text-gray-550 font-medium">Durum: </span>
              <span className="font-medium text-gray-500">{statusLabel(ev.statusChange.oldValue)}</span>
              <span className="mx-1.5 text-gray-400">→</span>
              <span className="font-semibold text-gray-900">{statusLabel(ev.statusChange.newValue)}</span>
              {ev.statusChange.performedBy && (
                <span className="ml-1.5 text-gray-500 italic">— {ev.statusChange.performedBy}</span>
              )}
            </div>
          )}

          {/* 3. İşlem Notu */}
          {ev.note && (
            <div className="bg-white border border-gray-100 rounded px-2.5 py-1.5 text-gray-700 italic font-medium">
              Not: "{ev.note}"
            </div>
          )}
        </div>
      )}

      {/* Büyütme: olayın TÜM fotoğrafları verilir, oklarla aralarında gezilir. */}
      <GorselOnizleyici
        gorseller={photoUrls.map(tamUrl)}
        acikIndex={buyutulenIdx}
        onKapat={() => setBuyutulenIdx(null)}
      />
    </div>
  )
}
