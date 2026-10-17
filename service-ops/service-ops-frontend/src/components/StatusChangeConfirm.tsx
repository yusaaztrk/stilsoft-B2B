import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Camera, CheckCircle2, FileText, X } from 'lucide-react'
import { registerStatusChangeConfirm } from '../api/statusChangeGate'

/**
 * DURUM DEĞİŞİKLİĞİ ONAY EKRANI (kullanıcı kararı, 2026-08-13).
 *
 * ServiceOps'ta bir durumu değiştirmek geri alınması pahalı bir iştir: hak ediş doğurur, kalemi
 * planlamadan düşürür, faturayı tetikler, bayiye bildirim gider. Buna rağmen çoğu ekranda tek
 * tıkla oluyordu ve saha sık sık görselsiz/notsuz kaydediyordu. Kural artık şu: durum
 * değiştiren HER işlem önce ekranı kaplayan bir özet gösterir, "şuradan şuraya" der, görsel ve
 * not eklenip eklenmediğini AÇIKÇA yazar, 5 saniye Kaydet'i kilitli tutar.
 *
 * Beş saniye BEKLEME amaçlıdır, otomatik kaydetme değil: sayaç dolunca hiçbir şey olmaz,
 * yalnızca Kaydet aktifleşir. Kullanıcı basmadan işlem uygulanmaz (soruldu ve böyle seçildi).
 *
 * Mobil ile web ayrımı YOK: saha uygulaması bu arayüzü WebView'de açtığı için tek uygulama
 * ikisini birden karşılıyor.
 *
 * Kullanım (çağrı yerinde tek satır):
 *
 *   const confirmStatusChange = useStatusChangeConfirm()
 *   const ok = await confirmStatusChange({ fromLabel: 'Planlandı', toLabel: 'Gerçekleşti', ... })
 *   if (!ok) return
 */

export type StatusChangeConfirmRequest = {
  /** Başlık — hangi kayıt/kalem üzerinde çalışıldığı (ör. "MNT-0000051-3 · Klima 12000"). */
  subject?: string
  /** Değişikliğin bağlamı: "Montaj Kalemi", "Servis Kaydı", "Kargo"... */
  kind?: string
  /** Mevcut durumun okunabilir adı. Bilinmiyorsa boş bırakılabilir. */
  fromLabel?: string | null
  /** Gidilecek durumun okunabilir adı. */
  toLabel: string
  /** Bu işlemle birlikte görsel yükleniyor mu / kayıtta görsel var mı. */
  hasPhoto: boolean
  /** Varsa görsel adedi — özet satırında gösterilir. */
  photoCount?: number
  /** Bu işlemle birlikte not/açıklama girildi mi. */
  hasNote: boolean
  /** Girilen not — özet kutusunda gösterilir. */
  note?: string | null
  /** Ek satırlar: teknisyen, tarih, adres gibi işlemle birlikte değişen alanlar. */
  details?: Array<{ label: string; value: string }>
  /** Kırmızı uyarı satırı — geri alınamaz sonuçlar için (ör. "Bu işlem fatura kesecek"). */
  warning?: string | null
}

type PendingRequest = StatusChangeConfirmRequest & { resolve: (ok: boolean) => void }

type ConfirmFn = (request: StatusChangeConfirmRequest) => Promise<boolean>

const StatusChangeConfirmContext = createContext<ConfirmFn | null>(null)

/**
 * Kaydet'in kilitli kalacağı süre.
 *
 * 5 saniyeydi; kullanıcı 2026-08-31'de 1 saniyeye indirilmesini istedi — gün içinde çok
 * sayıda durum değişikliği yapılıyor ve bekleme işi yavaşlatıyordu. Kilit tamamen
 * kaldırılmadı: amaç yanlışlıkla art arda basmayı engellemek, o iş 1 saniyeyle de görülüyor.
 */
const COUNTDOWN_SECONDS = 1

export function StatusChangeConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingRequest | null>(null)
  const [remaining, setRemaining] = useState(COUNTDOWN_SECONDS)

  /**
   * Sağlayıcı yeniden render olduğunda `confirm` kimliğinin değişmemesi gerekiyor: çağrı
   * yerleri onu useCallback/useEffect bağımlılığına koyuyor ve her renderda yeni bir fonksiyon
   * vermek o kancaları boşuna tetikler.
   */
  const pendingRef = useRef<PendingRequest | null>(null)
  pendingRef.current = pending

  const confirm = useCallback<ConfirmFn>((request) => {
    return new Promise<boolean>((resolve) => {
      // Açık bir onay dururken ikincisi gelirse (çift tık, iki ayrı satır) öncekini İPTAL say.
      // Sessizce üzerine yazmak, ilk isteği sonsuza kadar bekletir ve çağıran `await`te asılı
      // kalırdı.
      pendingRef.current?.resolve(false)

      setRemaining(COUNTDOWN_SECONDS)
      setPending({ ...request, resolve })
    })
  }, [])

  useEffect(() => {
    if (!pending) return
    if (remaining <= 0) return

    const timer = window.setTimeout(() => setRemaining((n) => n - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [pending, remaining])

  const settle = useCallback((ok: boolean) => {
    const current = pendingRef.current
    setPending(null)
    current?.resolve(ok)
  }, [])

  // ESC = İptal. Modal ekranı kapladığı için klavye çıkışı olmadan kullanıcı kilitlenmiş
  // hissediyor; Enter BİLEREK bağlanmadı — beş saniyelik bekleme refleks onayı engellemek için.
  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') settle(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, settle])

  // `apiFetch` içindeki kapı React ağacının dışında çalışıyor; onay ekranını açabilmek için
  // fonksiyonu modül seviyesindeki geçide kaydediyoruz. Sağlayıcı sökülünce kayıt da siliniyor,
  // aksi halde ölü bir ağaca kurulmuş `setState` çağrılırdı.
  useEffect(() => {
    registerStatusChangeConfirm(confirm)
    return () => registerStatusChangeConfirm(null)
  }, [confirm])

  return (
    <StatusChangeConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <StatusChangeConfirmDialog
          request={pending}
          remaining={remaining}
          onCancel={() => settle(false)}
          onSave={() => settle(true)}
        />
      )}
    </StatusChangeConfirmContext.Provider>
  )
}

function StatusChangeConfirmDialog({
  request,
  remaining,
  onCancel,
  onSave
}: {
  request: StatusChangeConfirmRequest
  remaining: number
  onCancel: () => void
  onSave: () => void
}) {
  const locked = remaining > 0
  const photoCount = request.photoCount ?? (request.hasPhoto ? 1 : 0)

  // PORTAL ŞART — telefonda modal HİÇ görünmüyordu.
  //
  // Sağlayıcı rota ağacının içinde duruyor ve `position: fixed`, `transform` / `filter` /
  // `backdrop-filter` taşıyan bir ata elemanın içinde ARTIK ekrana göre değil O ELEMANA göre
  // konumlanır (CSS'in "containing block" kuralı). Mobil kabuk kaydırılabilir panelleri
  // dönüşümle taşıdığı için onay ekranı görünmez bir kutunun içinde kalıyordu. `document.body`
  // altına basınca ata zinciri devreden çıkıyor.
  //
  // z-index de tavana çekildi: sayfalardaki çekmeceler ve fotoğraf büyütme z-100'e kadar
  // çıkıyor, onay ekranı her durumda üstte olmalı.
  return createPortal(
    <div className="fixed inset-0 z-[2147483000] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onCancel} />

      <div className="relative w-full sm:max-w-lg bg-white sm:rounded-3xl rounded-t-3xl shadow-2xl border border-slate-200 max-h-[92vh] flex flex-col overflow-hidden">
        <div className="p-4 sm:p-5 bg-slate-900 text-white flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
              {request.kind || 'Durum Güncellemesi'}
            </div>
            <div className="text-base font-black leading-tight truncate">
              {request.subject || 'Onaylıyor musunuz?'}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-2 -m-1 rounded-full hover:bg-white/10 transition-colors shrink-0"
            title="İptal (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto bg-slate-50/70">
          {/* Geçiş: en çok bakılan bilgi, en üstte ve en büyük. */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
              Durum Değişikliği
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-3 py-1.5 rounded-xl text-sm font-bold bg-slate-100 text-slate-600 border border-slate-200">
                {request.fromLabel || 'Mevcut durum'}
              </span>
              <span className="text-orange-500 font-black text-lg">➔</span>
              <span className="px-3 py-1.5 rounded-xl text-sm font-black bg-emerald-50 text-emerald-700 border border-emerald-200">
                {request.toLabel}
              </span>
            </div>
          </div>

          {/* Görsel ve not: eksikse UYARI rengiyle, "eklemediniz" diye açıkça yazılır. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <ChecklistRow
              ok={request.hasPhoto}
              icon={<Camera className="w-4 h-4" />}
              okText={photoCount > 1 ? `${photoCount} görsel eklendi` : 'Görsel eklendi'}
              missingText="Görsel eklemediniz"
            />
            <ChecklistRow
              ok={request.hasNote}
              icon={<FileText className="w-4 h-4" />}
              okText="Not yazıldı"
              missingText="Not yazmadınız"
            />
          </div>

          {request.hasNote && request.note && (
            <div className="bg-white rounded-2xl border border-slate-200 p-3.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                Girilen Not
              </div>
              <p className="text-xs text-slate-800 font-medium whitespace-pre-line leading-relaxed">
                {request.note}
              </p>
            </div>
          )}

          {request.details && request.details.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
              {request.details.map((d) => (
                <div key={d.label} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 shrink-0">
                    {d.label}
                  </span>
                  <span className="text-xs font-semibold text-slate-900 text-right min-w-0">{d.value}</span>
                </div>
              ))}
            </div>
          )}

          {request.warning && (
            <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-2xl p-3.5">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <p className="text-xs font-semibold text-red-800 leading-relaxed">{request.warning}</p>
            </div>
          )}
        </div>

        <div className="p-4 sm:p-5 bg-white border-t border-slate-200 flex items-center gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-3 rounded-2xl text-sm font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors cursor-pointer"
          >
            İptal
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={locked}
            className={`flex-1 px-4 py-3 rounded-2xl text-sm font-black text-white transition-colors ${
              locked
                ? 'bg-slate-400 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-700 cursor-pointer'
            }`}
          >
            {locked ? `Kaydet (${remaining})` : 'Kaydet'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

function ChecklistRow({
  ok,
  icon,
  okText,
  missingText
}: {
  ok: boolean
  icon: React.ReactNode
  okText: string
  missingText: string
}) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-2xl border px-3.5 py-3 ${
        ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-900'
      }`}
    >
      <span className="shrink-0">{ok ? <CheckCircle2 className="w-4 h-4" /> : icon}</span>
      <span className="text-xs font-bold leading-tight">{ok ? okText : missingText}</span>
    </div>
  )
}

/**
 * Onay ekranını açar. Sağlayıcı monte edilmemişse HATA VERMEZ, doğrudan "onaylandı" döner —
 * kapıyı düşürmek yerine akışı kesmek daha kötü olurdu: bu bir yetki kapısı değil, kullanıcıya
 * yapılan bir gösterim. Yine de sağlayıcı App'te kökte duruyor, bu dal beklenmedik bir durum.
 */
export function useStatusChangeConfirm(): ConfirmFn {
  const ctx = useContext(StatusChangeConfirmContext)
  const fallback = useMemo<ConfirmFn>(() => () => Promise.resolve(true), [])
  return ctx ?? fallback
}
