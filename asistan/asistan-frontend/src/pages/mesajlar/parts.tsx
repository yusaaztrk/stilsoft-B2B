import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, CheckCheck, Clock, Download, Image as ImageIcon, Maximize2, RotateCw, X, ZoomIn, ZoomOut } from 'lucide-react'
import { api, getToken } from '../../lib/session'

export type PanelMessage = { kind: 'ok' | 'err'; text: string } | null

/** Sayfa üstünde 4 sn görünen sonuç mesajı. */
export function usePanelMessage() {
  const [message, setMessage] = useState<PanelMessage>(null)
  const notify = useCallback((kind: 'ok' | 'err', text: string) => {
    setMessage({ kind, text })
    window.setTimeout(() => setMessage(null), 4000)
  }, [])
  return { message, notify }
}

export function MessageBanner({ message }: { message: PanelMessage }) {
  if (!message) return null
  return (
    <div className={`mb-3 px-4 py-2.5 rounded-2xl text-sm font-semibold border ${message.kind === 'ok' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
      {message.text}
    </div>
  )
}

export const sekmeGorunur = () => typeof document === 'undefined' || document.visibilityState === 'visible'

export function saat(iso?: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const bugun = new Date()
  const ayniGun = d.toDateString() === bugun.toDateString()
  return ayniGun
    ? d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
}

export function kalanSure(iso?: string | null) {
  if (!iso) return ''
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return ''
  const s = Math.floor(ms / 3600000)
  const d = Math.floor((ms % 3600000) / 60000)
  return s > 0 ? `${s} sa ${d} dk` : `${d} dk`
}

export function Tik({ m }: { m: Message }) {
  if (m.direction !== 'out') return null
  if (m.status === 'failed') return <span title={m.error ?? 'Gönderilemedi'}><AlertTriangle className="w-3.5 h-3.5 text-red-500" /></span>
  if (m.status === 'queued') return <Clock className="w-3.5 h-3.5 text-gray-400" />
  if (m.status === 'sent') return <Check className="w-3.5 h-3.5 text-gray-400" />
  if (m.status === 'delivered') return <CheckCheck className="w-3.5 h-3.5 text-gray-400" />
  if (m.status === 'read') return <CheckCheck className="w-3.5 h-3.5 text-sky-500" />
  return null
}

/** Medyayı (fotoğraf, ses, belge) servis üzerinden blob olarak indirir; Meta'nın adresi token ister. */
async function medyaGetir(id: number): Promise<Blob> {
  const token = getToken()
  const res = await fetch(`/api/panel/messages/${id}/media`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) {
    const d = await res.json().catch(() => null)
    throw new Error(d?.message || 'Medya alınamadı.')
  }
  return res.blob()
}

const UZANTI: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr',
  'video/mp4': 'mp4', 'video/3gpp': '3gp', 'application/pdf': 'pdf'
}

/** İndirilecek dosya adı: belgenin kendi adı, yoksa "whatsapp-<tür>-<mesaj no>.<uzantı>". */
export function medyaDosyaAdi(m: Message) {
  if (m.mediaFilename) return m.mediaFilename
  const mime = (m.mediaMime ?? '').split(';')[0].trim()
  const ext = UZANTI[mime] ?? mime.split('/')[1] ?? 'bin'
  return `whatsapp-${m.type}-${m.id}.${ext}`
}

function indir(url: string, ad: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = ad
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/**
 * Medya (2026-10-09): fotoğraf küçük önizleme olarak gelir; tıklayınca TAM EKRAN açılır (yakınlaştır,
 * döndür, indir). Ses/video oynatılır; belge ve diğer her şey için "İndir". Yükleme isteyince
 * (her açılışta Meta'dan çekmesin diye) — fotoğraf ise otomatik yüklenir, sohbette görünsün.
 */
export function Medya({ m }: { m: Message }) {
  const [url, setUrl] = useState<string | null>(null)
  const [hata, setHata] = useState<string | null>(null)
  const [yukleniyor, setYukleniyor] = useState(false)
  const [buyuk, setBuyuk] = useState(false)
  const mime = (m.mediaMime ?? '').toLowerCase()
  const gorsel = mime.startsWith('image/') || m.type === 'image' || m.type === 'sticker'

  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  const yukle = useCallback(async () => {
    setYukleniyor(true)
    setHata(null)
    try {
      setUrl(URL.createObjectURL(await medyaGetir(m.id)))
    } catch (e) {
      setHata((e as Error).message)
    } finally {
      setYukleniyor(false)
    }
  }, [m.id])

  // Fotoğraflar kendiliğinden yüklensin: personel "göster"e basmadan görsün.
  useEffect(() => { if (gorsel && !url && !hata) void yukle() }, [gorsel]) // eslint-disable-line react-hooks/exhaustive-deps

  const indirBtn = url && (
    <button type="button" onClick={() => indir(url, medyaDosyaAdi(m))} className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-700 hover:underline">
      <Download className="w-3.5 h-3.5" /> İndir
    </button>
  )

  if (url) {
    if (gorsel) {
      return (
        <div className="mt-1">
          <button type="button" onClick={() => setBuyuk(true)} className="group relative block" title="Büyüt">
            <img src={url} alt="" className="max-w-[260px] max-h-[320px] rounded-xl cursor-zoom-in" />
            <span className="absolute top-1.5 right-1.5 p-1 rounded-lg bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity">
              <Maximize2 className="w-3.5 h-3.5" />
            </span>
          </button>
          <div className="mt-1 flex items-center gap-3">
            <button type="button" onClick={() => setBuyuk(true)} className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-700 hover:underline">
              <ZoomIn className="w-3.5 h-3.5" /> Büyüt
            </button>
            {indirBtn}
          </div>
          {buyuk && <Lightbox url={url} ad={medyaDosyaAdi(m)} onClose={() => setBuyuk(false)} />}
        </div>
      )
    }
    if (mime.startsWith('audio/')) return <div className="mt-1 space-y-0.5"><audio src={url} controls className="max-w-[260px]" /><div>{indirBtn}</div></div>
    if (mime.startsWith('video/')) return <div className="mt-1 space-y-0.5"><video src={url} controls className="max-w-[260px] rounded-xl" /><div>{indirBtn}</div></div>
    return (
      <div className="mt-1 flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-700 truncate max-w-[200px]">{m.mediaFilename ?? m.typeLabel}</span>
        {indirBtn}
      </div>
    )
  }
  return (
    <div className="mt-1">
      <button type="button" onClick={() => void yukle()} disabled={yukleniyor} className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-700 hover:underline disabled:opacity-60">
        <ImageIcon className="w-3.5 h-3.5" /> {yukleniyor ? 'Yükleniyor…' : `${m.typeLabel} — ${gorsel ? 'göster' : 'aç / indir'}`}
      </button>
      {hata && (
        <div className="text-[11px] text-red-600 mt-0.5">
          {hata} <button type="button" onClick={() => void yukle()} className="underline font-bold">Tekrar dene</button>
        </div>
      )}
    </div>
  )
}

/**
 * Tam ekran görsel: tekerlek/düğmeyle yakınlaştır (1x-6x), sürükleyerek kaydır, 90° döndür, indir.
 * Esc kapatır, arka plana tıklamak da.
 */
export function Lightbox({ url, ad, onClose }: { url: string; ad: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1)
  const [rot, setRot] = useState(0)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(6, z + 0.5))
      if (e.key === '-') setZoom((z) => Math.max(1, z - 0.5))
    }
    window.addEventListener('keydown', onKey)
    const eski = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = eski
    }
  }, [onClose])

  useEffect(() => { if (zoom === 1) setPos({ x: 0, y: 0 }) }, [zoom])

  const btn = 'h-9 w-9 rounded-xl bg-white/10 hover:bg-white/20 text-white inline-flex items-center justify-center'
  return (
    <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between gap-2 p-3" onClick={(e) => e.stopPropagation()}>
        <span className="text-white/70 text-xs font-semibold truncate">{ad} · %{Math.round(zoom * 100)}</span>
        <div className="flex items-center gap-1.5">
          <button type="button" className={btn} onClick={() => setZoom((z) => Math.max(1, z - 0.5))} title="Uzaklaştır (-)"><ZoomOut className="w-4 h-4" /></button>
          <button type="button" className={btn} onClick={() => setZoom((z) => Math.min(6, z + 0.5))} title="Yakınlaştır (+)"><ZoomIn className="w-4 h-4" /></button>
          <button type="button" className={btn} onClick={() => setRot((r) => (r + 90) % 360)} title="Döndür"><RotateCw className="w-4 h-4" /></button>
          <button type="button" className={btn} onClick={() => indir(url, ad)} title="İndir"><Download className="w-4 h-4" /></button>
          <button type="button" className={btn} onClick={onClose} title="Kapat (Esc)"><X className="w-5 h-5" /></button>
        </div>
      </div>
      <div
        className="flex-1 overflow-hidden flex items-center justify-center select-none"
        onWheel={(e) => { e.stopPropagation(); setZoom((z) => Math.min(6, Math.max(1, z + (e.deltaY < 0 ? 0.25 : -0.25)))) }}
        onMouseDown={(e) => { if (zoom > 1) { e.preventDefault(); drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y } } }}
        onMouseMove={(e) => { const d = drag.current; if (d) setPos({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }) }}
        onMouseUp={() => { drag.current = null }}
        onMouseLeave={() => { drag.current = null }}
        onDoubleClick={(e) => { e.stopPropagation(); setZoom((z) => (z > 1 ? 1 : 2.5)) }}
      >
        <img
          src={url}
          alt=""
          onClick={(e) => e.stopPropagation()}
          draggable={false}
          style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom}) rotate(${rot}deg)`, transition: drag.current ? 'none' : 'transform 120ms ease-out' }}
          className={`max-w-[92vw] max-h-[82vh] object-contain ${zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'}`}
        />
      </div>
      <div className="p-2 text-center text-[11px] text-white/50">Tekerlek / çift tık: yakınlaştır · sürükle: kaydır · Esc: kapat</div>
    </div>
  )
}

/**
 * YALNIZ LOKAL GELİŞTİRME (import.meta.env.DEV): müşteri tarafını taklit eder.
 * Gerçek WhatsApp bağlanmadan ekranı denemek için; sunucudaki /dev/whatsapp/inbound ucuna gider
 * (o uç da yalnız Development'ta çalışır). Canlı derlemede bu bileşen hiç yer almaz.
 */
export function MusteriGibiYaz({ onSent }: { onSent: () => void }) {
  const [acik, setAcik] = useState(false)
  const [numara, setNumara] = useState('905331112233')
  const [ad, setAd] = useState('Deneme Müşteri')
  const [metin, setMetin] = useState('')
  const [durum, setDurum] = useState<string | null>(null)

  const gonder = async () => {
    if (!metin.trim()) return
    try {
      await api('/dev/whatsapp/inbound', { method: 'POST', anonymous: true, body: JSON.stringify({ from: numara.replace(/\D/g, ''), name: ad, text: metin }) })
      setMetin('')
      setDurum('Gönderildi — birkaç saniyede listeye düşer.')
      onSent()
    } catch (e) {
      setDurum((e as Error).message)
    }
  }

  if (!acik) {
    return (
      <button type="button" onClick={() => setAcik(true)} className="w-full h-8 rounded-xl border border-dashed border-amber-400 bg-amber-50 text-[11px] font-bold text-amber-800">
        Deneme: müşteri gibi yaz
      </button>
    )
  }
  return (
    <div className="rounded-2xl border border-dashed border-amber-400 bg-amber-50 p-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-black text-amber-800">DENEME — müşteri gibi yaz (yalnız lokal)</span>
        <button type="button" onClick={() => setAcik(false)} className="text-amber-700"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex gap-1.5">
        <input value={numara} onChange={(e) => setNumara(e.target.value)} placeholder="905331112233" className="w-1/2 h-8 px-2 rounded-lg border border-amber-200 text-xs" />
        <input value={ad} onChange={(e) => setAd(e.target.value)} placeholder="WhatsApp adı" className="w-1/2 h-8 px-2 rounded-lg border border-amber-200 text-xs" />
      </div>
      <div className="flex gap-1.5">
        <input
          value={metin}
          onChange={(e) => setMetin(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void gonder() }}
          placeholder="Müşterinin mesajı…"
          className="flex-1 h-8 px-2 rounded-lg border border-amber-200 text-xs"
        />
        <button type="button" onClick={() => void gonder()} className="h-8 px-3 rounded-lg bg-amber-500 text-white text-xs font-bold">Gönder</button>
      </div>
      <div className="text-[10px] text-amber-800">Kayıtlı cari denemek için: 905332512556 (ADEM, 120-01-000029)</div>
      {durum && <div className="text-[10px] font-semibold text-amber-900">{durum}</div>}
    </div>
  )
}

/* Gelen kutusu tipleri (2026-10-08: birim, önem, bekleme, son cevaplayan eklendi). */
export type Conversation = {
  id: number
  waId: string
  phone: string
  contactName?: string | null
  customerCode?: string | null
  customerName?: string | null
  customerMatchCount: number
  status: 'open' | 'closed'
  unreadCount: number
  lastMessageAt?: string | null
  lastMessagePreview?: string | null
  lastMessageDirection?: 'in' | 'out' | null
  lastInboundAt?: string | null
  windowOpen: boolean
  windowClosesAt?: string | null
  departmentId?: number | null
  departmentName?: string | null
  priority: Priority
  awaitingReply: boolean
  waitingSince?: string | null
  lastReplyBy?: string | null
  lastReplyAt?: string | null
  ai: {
    summary?: string | null
    topic?: string | null
    needsHuman: boolean
    reason?: string | null
    error?: string | null
    updatedAt?: string | null
  }
}

/** Asistanın bekleyen cevap taslağı (müşteriye kendiliğinden gitmez). */
export type AiDraft = {
  id: number
  body: string
  needsHuman: boolean
  topic?: string | null
  reason?: string | null
  departmentCode?: string | null
  basedOnMessageId?: number | null
  createdAt: string
  /** 3. aşama: taslak yazılırken bakılan kayıtlar (bakiye, sipariş, fatura, servis/montaj). */
  toolCalls?: AiToolCall[] | null
}

export type AiToolCall = { name: string; query?: string | null; ok: boolean; summary: string; ms: number; items?: AiToolItem[] | null }

/** Asistanın baktığı tek kayıt (servis/montaj, sipariş, fatura, bakiye). Tarihler ISO. */
export type AiToolItem = {
  ref: string
  kind: string
  status?: string | null
  date?: string | null
  planned?: string | null
  product?: string | null
  note?: string | null
  amount?: string | null
}

const gun = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '')

/** Kaydın tarih özeti: "açılış 03.10.2026 · planlanan 12.10.2026". */
export function kayitTarihleri(it: AiToolItem) {
  return [it.date ? gun(it.date) : null, it.planned ? `planlanan ${gun(it.planned)}` : null].filter(Boolean).join(' · ')
}

/**
 * Seçilen kayıttan müşteriye cevap metni (2026-10-09, kullanıcı: "seçilen kayda göre şablon oluşsun").
 * Yapay zekâ çağırmaz; kayıttaki bilgiyle hazır cümle kurar, personel kutuda düzeltip gönderir.
 */
export function kayitSablonu(tool: string, it: AiToolItem, musteri?: string | null) {
  const selam = musteri ? `Merhaba ${musteri},` : 'Merhaba,'
  const urun = it.product ? ` (${it.product})` : ''
  switch (tool) {
    case 'servis_montaj_kayitlari': {
      const tur = it.kind.toLocaleLowerCase('tr').startsWith('montaj') ? 'montaj' : `${it.kind.toLocaleLowerCase('tr')}`
      const plan = it.planned ? ` Planlanan tarih: ${gun(it.planned)}.` : ''
      const not = it.note && tur !== 'montaj' ? ` Kayıttaki bilgi: ${it.note}` : ''
      return `${selam} ${it.ref} numaralı ${tur} kaydınız${urun} şu an "${it.status ?? 'işlemde'}" durumunda.${plan}${not}`.trim()
    }
    case 'siparisler':
      return `${selam} ${it.ref} numaralı siparişinizin${urun} durumu: ${it.status ?? 'işlemde'}.${it.date ? ` Sipariş tarihi: ${gun(it.date)}.` : ''}`
    case 'faturalar':
      return `${selam} ${gun(it.date)} tarihli ${it.ref} numaralı faturanızın (${it.kind.toLocaleLowerCase('tr')}) tutarı ${it.amount ?? '-'}.`
    case 'cari_bakiye':
      return `${selam} güncel bakiyeniz ${it.amount ?? '-'}${it.status ? ` (${it.status})` : ''}.`
    default:
      return `${selam} ${it.ref}: ${it.status ?? ''}`.trim()
  }
}

export const TOOL_LABEL: Record<string, string> = {
  cari_bakiye: 'Bakiye',
  siparisler: 'Siparişler',
  faturalar: 'Faturalar',
  servis_montaj_kayitlari: 'Servis/Montaj'
}

export type Message = {
  id: number
  direction: 'in' | 'out'
  type: string
  typeLabel: string
  body?: string | null
  hasMedia: boolean
  mediaMime?: string | null
  mediaFilename?: string | null
  status: string
  error?: string | null
  sentBy?: string | null
  fromDraft?: boolean
  at: string
}

export type ConvEvent = {
  id: number
  kind: 'routed' | 'priority' | 'status' | 'note' | string
  actor: string
  data?: any
  at: string
}

/** Önem derecesi (2026-10-09): normal | Önemli | Acil. Acil her listede en üstte. */
export type Priority = 'normal' | 'important' | 'urgent'

export const PRIORITY_LABEL: Record<Priority, string> = { normal: 'Normal', important: 'Önemli', urgent: 'Acil' }

/** Bekleme uyarısı eşikleri (dk): uyarı sarı, gecikme kırmızı + yanıp söner. Ayarlar'dan. */
export type Sla = { warnMinutes: number; lateMinutes: number }
export const DEFAULT_SLA: Sla = { warnMinutes: 5, lateMinutes: 15 }

/** Hazır cevap: birime özel ya da (departmentId null) herkese. {musteri} müşterinin adıyla değişir. */
export type QuickReply = { id: number; departmentId?: number | null; title: string; body: string }

export type ServiceStatus = {
  numberConfigured: boolean
  canSend: boolean
  fakeProvider: boolean
  windowHours: number
  isAdmin: boolean
  canSeeAll: boolean
  departmentIds: number[]
  userName: string
  aiProvider?: string | null
  aiEnabled?: boolean
  sla?: Sla
}

export type Summary = {
  folders: { waiting: number; important: number; answered: number; unassigned: number; unread: number; oldestWaitingSince?: string | null; urgent?: number; late?: number }
  departments: { id: number; code: string; name: string; waiting: number; important: number; open: number; late?: number }[]
  sla?: Sla
  allDepartments: { id: number; name: string }[]
}

/**
 * Bekleme süresi metni ve rengi. Eşikler Ayarlar'dan (varsayılan 5 dk sarı, 15 dk KIRMIZI ve yanıp
 * söner — kullanıcı 2026-10-09: "15 dk'dan sonra kırmızı yansın").
 */
export function bekleme(iso?: string | null, sla: Sla = DEFAULT_SLA): { text: string; tone: 'ok' | 'warn' | 'late'; dk: number } | null {
  if (!iso) return null
  const dk = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))
  const text = dk < 1 ? 'az önce' : dk < 60 ? `${dk} dk` : dk < 1440 ? `${Math.floor(dk / 60)} sa ${dk % 60} dk` : `${Math.floor(dk / 1440)} gün`
  return { text, dk, tone: dk >= sla.lateMinutes ? 'late' : dk >= sla.warnMinutes ? 'warn' : 'ok' }
}

export const toneClass = {
  ok: 'bg-gray-100 text-gray-700',
  warn: 'bg-amber-100 text-amber-800',
  late: 'bg-red-600 text-white animate-pulse'
} as const

/** Masaüstü bildirimi (izin verildiyse). Sekme arka plandayken de geciken konuşmayı haber verir. */
export function masaustuBildirimi(baslik: string, govde: string) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const n = new Notification(baslik, { body: govde, tag: 'stilsoft-asistan', icon: '/favicon.ico' })
    n.onclick = () => { window.focus(); n.close() }
  } catch {
    /* bildirim süs */
  }
}

/** Yeni bekleyen mesaj sesi — dosya gerekmesin diye WebAudio ile kısa iki ton. */
export function bip() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    ;[0, 0.18].forEach((t, i) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = i === 0 ? 880 : 1320
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t)
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.15)
      o.connect(g).connect(ctx.destination)
      o.start(ctx.currentTime + t)
      o.stop(ctx.currentTime + t + 0.16)
    })
    window.setTimeout(() => void ctx.close(), 600)
  } catch {
    /* ses süs */
  }
}
