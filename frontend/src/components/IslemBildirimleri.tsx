import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, ChevronDown, ChevronRight, CornerDownRight, Trash2, Zap } from 'lucide-react'

import { OPERATION_EFFECTS_EVENT, type OperationEffectsPayload } from '../utils/operationEffects'

/**
 * ANLIK İŞLEM BİLDİRİMLERİ — ÜST ÇUBUKTA (2026-10-04 kullanıcı isteği: "sol altta çıkan
 * bildirimleri header'daki zilin sağına al, yeni ikon koy, her bildirim gelince ikon güncellensin").
 *
 * Kaynak değişmedi: sunucu her başarılı yazma isteğinde `X-Operation-Effects` başlığı döndürüyor,
 * `main.tsx` onu okuyup `OPERATION_EFFECTS_EVENT` yayınlıyor (bkz. utils/operationEffects). Eskiden
 * sol altta beliren kutu ekranın üstünü kapatıyordu; artık:
 *  - yeni işlem gelince ikon canlanır, sayaç artar ve ikonun altında birkaç saniyelik kısa özet çıkar;
 *  - tıklayınca son işlemlerin listesi açılır (ne yapıldı + arkasında ne oldu);
 *  - liste sekme boyunca tutulur (sessionStorage): "Sayfayı Yenile" düğmesi geçmişi silmez.
 */

type Kayit = OperationEffectsPayload & { id: number; at: number }

const SAKLAMA_ANAHTARI = 'b2b.islemBildirimleri.v1'
const EN_FAZLA = 30
const OZET_SURESI_MS = 3500
const PANEL_GENISLIK = 360

function oku(): { list: Kayit[]; seenAt: number } {
  try {
    const raw = sessionStorage.getItem(SAKLAMA_ANAHTARI)
    if (!raw) return { list: [], seenAt: 0 }
    const parsed = JSON.parse(raw)
    return {
      list: Array.isArray(parsed?.list) ? parsed.list.slice(0, EN_FAZLA) : [],
      seenAt: Number(parsed?.seenAt) || 0,
    }
  } catch {
    return { list: [], seenAt: 0 }
  }
}

function yaz(list: Kayit[], seenAt: number) {
  try {
    sessionStorage.setItem(SAKLAMA_ANAHTARI, JSON.stringify({ list, seenAt }))
  } catch {
    // Saklama yalnız kolaylık; yazılamazsa liste bu sayfa ömrü boyunca bellekte kalır.
  }
}

const saat = (ms: number) =>
  new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

const gecenSure = (ms: number) => {
  const sn = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (sn < 60) return 'az önce'
  const dk = Math.floor(sn / 60)
  if (dk < 60) return `${dk} dk önce`
  const sa = Math.floor(dk / 60)
  return `${sa} sa önce`
}

export default function IslemBildirimleri() {
  const ilk = useRef(oku())
  const [list, setList] = useState<Kayit[]>(ilk.current.list)
  const [seenAt, setSeenAt] = useState<number>(ilk.current.seenAt)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [ozet, setOzet] = useState<Kayit | null>(null)
  const [canli, setCanli] = useState(false)
  const [acikDetay, setAcikDetay] = useState<Record<number, boolean>>({})
  const nextId = useRef((ilk.current.list[0]?.id ?? 0) + 1)
  const btnRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const ozetTimer = useRef<number | null>(null)
  const canliTimer = useRef<number | null>(null)

  const okunmamis = list.filter((k) => k.at > seenAt).length

  // Yeni işlem: listeye ekle, ikonu canlandır, kısa özeti göster.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<OperationEffectsPayload>).detail
      if (!detail?.actions?.length && !detail?.effects?.length) return
      const kayit: Kayit = { ...detail, id: nextId.current++, at: Date.now() }

      setList((prev) => [kayit, ...prev].slice(0, EN_FAZLA))
      setCanli(true)
      if (canliTimer.current) window.clearTimeout(canliTimer.current)
      canliTimer.current = window.setTimeout(() => setCanli(false), 1600)

      setOzet(kayit)
      if (ozetTimer.current) window.clearTimeout(ozetTimer.current)
      ozetTimer.current = window.setTimeout(() => setOzet(null), OZET_SURESI_MS)
    }
    window.addEventListener(OPERATION_EFFECTS_EVENT, handler)
    return () => {
      window.removeEventListener(OPERATION_EFFECTS_EVENT, handler)
      if (ozetTimer.current) window.clearTimeout(ozetTimer.current)
      if (canliTimer.current) window.clearTimeout(canliTimer.current)
    }
  }, [])

  useEffect(() => {
    yaz(list, seenAt)
  }, [list, seenAt])

  // Panel açıkken gelen işlem de "görüldü" sayılır.
  useEffect(() => {
    if (open && list.length > 0 && list[0].at > seenAt) setSeenAt(list[0].at)
  }, [open, list, seenAt])

  const konumla = () => {
    const el = btnRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const pad = 8
    const left = Math.max(pad, Math.min(window.innerWidth - PANEL_GENISLIK - pad, rect.right - PANEL_GENISLIK))
    setPos({ top: rect.bottom + 8, left })
  }

  useLayoutEffect(() => {
    if (!open && !ozet) return
    konumla()
    window.addEventListener('resize', konumla)
    window.addEventListener('scroll', konumla, true)
    return () => {
      window.removeEventListener('resize', konumla)
      window.removeEventListener('scroll', konumla, true)
    }
  }, [open, ozet])

  // Dışarı tıklama / ESC paneli kapatır.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = () => {
    if (open) {
      setOpen(false)
      return
    }
    konumla()
    setOzet(null)
    setOpen(true)
  }

  const temizle = () => {
    setList([])
    setAcikDetay({})
  }

  return (
    <div className="relative" ref={btnRef}>
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={toggle}
        className={`relative h-10 w-10 flex items-center justify-center rounded-full transition-all outline-none ${
          open ? 'bg-white/25 text-white' : 'bg-white/10 hover:bg-white/20 text-white/90 hover:text-white'
        }`}
        aria-label="Anlık işlem bildirimleri"
        title="Anlık işlem bildirimleri"
      >
        {canli && <span className="absolute inset-0 rounded-full bg-emerald-400/50 animate-ping" />}
        <Zap size={18} className={`relative transition-transform ${canli ? 'scale-125 text-emerald-200' : ''}`} fill={canli ? 'currentColor' : 'none'} />
        {okunmamis > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-emerald-500 rounded-full text-[10px] font-black text-white flex items-center justify-center shadow-sm border border-emerald-900/40">
            {okunmamis > 9 ? '9+' : okunmamis}
          </span>
        )}
      </button>

      {/* Kısa özet: yeni işlem gelince ikonun altında birkaç saniye görünür. */}
      {ozet && !open && pos &&
        createPortal(
          <button
            type="button"
            onClick={toggle}
            style={{ top: pos.top, left: pos.left + PANEL_GENISLIK - 300 }}
            className="fixed z-[70] w-[300px] text-left rounded-xl border border-emerald-200 bg-white shadow-xl shadow-emerald-900/10 px-3 py-2.5 flex items-start gap-2"
          >
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" />
            <span className="min-w-0">
              <span className="block text-[12px] font-black text-emerald-950 truncate">
                {ozet.actions[0] ?? 'İşlem tamamlandı'}
              </span>
              <span className="block text-[10.5px] font-semibold text-emerald-700">
                {ozet.effects.length > 0 ? `${ozet.effects.length} sonuç sisteme uygulandı · ayrıntı için tıklayın` : 'Başarıyla kaydedildi'}
              </span>
            </span>
          </button>,
          document.body,
        )}

      {open && pos &&
        createPortal(
          <div
            ref={panelRef}
            onMouseDown={(e) => e.stopPropagation()}
            style={{ top: pos.top, left: pos.left, width: PANEL_GENISLIK }}
            className="fixed z-[70] bg-white rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.25)] border border-slate-100 overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-teal-50/60 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-bold text-slate-800">Anlık İşlem Bildirimleri ({list.length})</span>
              </div>
              {list.length > 0 && (
                <button
                  type="button"
                  onClick={temizle}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white hover:bg-rose-50 text-slate-600 hover:text-rose-700 border border-slate-200 hover:border-rose-200 text-[10.5px] font-bold transition"
                >
                  <Trash2 size={11} />
                  Hepsini Temizle
                </button>
              )}
            </div>

            <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-100">
              {list.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
                  <Zap className="w-8 h-8 text-slate-300" />
                  <span>Bu oturumda henüz bir işlem yapılmadı.</span>
                </div>
              ) : (
                list.map((k) => {
                  const detayAcik = !!acikDetay[k.id]
                  const yeni = k.at > seenAt
                  return (
                    <div key={k.id} className={`px-4 py-2.5 ${yeni ? 'bg-emerald-50/40' : ''}`}>
                      <div className="flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" />
                        <div className="min-w-0 flex-1">
                          {k.actions.length > 0 ? (
                            k.actions.map((a, i) => (
                              <div key={i} className="text-[12px] font-bold text-slate-800 leading-snug">{a}</div>
                            ))
                          ) : (
                            <div className="text-[12px] font-bold text-slate-800">İşlem tamamlandı</div>
                          )}
                          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-400 font-semibold">
                            <span title={saat(k.at)}>{gecenSure(k.at)} · {saat(k.at)}</span>
                            {k.effects.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setAcikDetay((p) => ({ ...p, [k.id]: !p[k.id] }))}
                                className="inline-flex items-center gap-0.5 text-emerald-700 hover:text-emerald-900"
                              >
                                {detayAcik ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                                {k.effects.length + (k.overflow || 0)} sonuç
                              </button>
                            )}
                          </div>
                          {detayAcik && (
                            <ul className="mt-1.5 space-y-1">
                              {k.effects.map((e, i) => (
                                <li key={i} className="flex items-start gap-1.5 text-[11px] leading-snug text-slate-600">
                                  <CornerDownRight className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                                  <span>{e}</span>
                                </li>
                              ))}
                              {k.overflow > 0 && (
                                <li className="pl-4 text-[10.5px] font-semibold text-slate-400">ve {k.overflow} sonuç daha…</li>
                              )}
                            </ul>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
