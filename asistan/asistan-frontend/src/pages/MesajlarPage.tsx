import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRightLeft, Bell, Bot, CheckCircle2, Eye, Flame, Inbox, Layers, Lock, MessageCircle, MessageSquareText, Pencil, RefreshCw, Search, Send, Sparkles, Star, StickyNote, Timer, Trash2, Unlock, UserCheck, X, Archive, HelpCircle, AlertTriangle } from 'lucide-react'
import { api } from '../lib/session'
import {
  DEFAULT_SLA, kayitSablonu, kayitTarihleri, MessageBanner, Medya, MusteriGibiYaz, PRIORITY_LABEL, TOOL_LABEL, Tik, bekleme, bip, kalanSure, masaustuBildirimi, saat, sekmeGorunur, toneClass, usePanelMessage,
  type AiDraft, type ConvEvent, type Conversation, type Message, type Priority, type QuickReply, type ServiceStatus, type Summary
} from './mesajlar/parts'

/*
  GELEN KUTUSU — çok kişili (2026-10-08, kullanıcı kararları).

  Tek WhatsApp hattını 15-20 personel kullanır. Her konuşma bir BİRİME düşer ve birime ORTAK
  düşer: üstlenme/kilit yok, birimdeki herkes görür ve cevaplar. İki kişi aynı anda yazmasın
  diye "şu an bakıyor" uyarısı ve son cevaplayan gösterilir (engellemez).

  Solda klasörler (Cevap bekleyen / Önemli / Cevaplanan / Atanmamış / Kapalı / Tümü) ve kişinin
  birimleri; ortada liste (bekleme süresi renkli: 15 dk sarı, 60 dk kırmızı); sağda sohbet.
  Mesajların arasında hareketler (devir, önem, iç not) da görünür — "kim ne yaptı" belli olsun.

  Canlı güncelleme yoklamayla: özet+liste 5 sn, açık konuşma 3 sn. Sekme arka plandayken durur.
  Kişinin kapsamındaki bekleyen sayısı artınca kısa ses çalar.

  2026-10-09 (kullanıcı isteği):
   - Bekleme uyarısı Ayarlar'daki eşiklerle: uyarı (5 dk) sarı, gecikme (15 dk) KIRMIZI ve yanıp söner;
     geciken konuşma sayısı listenin üstünde şerit olarak, artınca ses + masaüstü bildirimi.
   - Önem derecesi: Normal / Önemli / Acil. Acil her listede en üstte, alevli kırmızı işaret.
   - Hazır cevaplar: birime özel ya da genel; {musteri} müşterinin adıyla dolar.
   - Fotoğraf sohbette görünür; tıklayınca tam ekran (yakınlaştır/döndür/indir). Her medya indirilebilir.

  ASİSTAN (2. aşama): yapay zekâ müşteriye KENDİLİĞİNDEN yazmaz, yalnız TASLAK hazırlar. Taslak
  yazma kutusunun üstünde çıkar; personel "Onayla ve gönder" ya da "Düzenle" (metin kutuya iner,
  gönderilince taslak "düzeltilmiş" sayılır) ya da "Sil" der. Konuşma başlığında asistanın özeti,
  konusu ve "insan gerekli" uyarısı görünür; asistan hata verdiyse "Yeniden dene" (ücretli çağrı).
*/

// 'open': birim görünümü — birimin bütün açık konuşmaları, cevap bekleyenler üstte.
type Folder = 'waiting' | 'important' | 'answered' | 'unassigned' | 'closed' | 'all' | 'open'
type Selection = { folder: Folder; departmentId: number | null }
type ThreadItem = { kind: 'msg'; at: string; m: Message } | { kind: 'evt'; at: string; e: ConvEvent }

const FOLDERS: { id: Folder; label: string; icon: any; seeAllOnly?: boolean }[] = [
  { id: 'waiting', label: 'Cevap bekleyen', icon: Inbox },
  { id: 'important', label: 'Önemli', icon: Star },
  { id: 'answered', label: 'Cevaplanan', icon: CheckCircle2 },
  { id: 'unassigned', label: 'Atanmamış', icon: HelpCircle, seeAllOnly: true },
  { id: 'closed', label: 'Kapalı', icon: Archive },
  { id: 'all', label: 'Tümü', icon: Layers }
]

function eventText(e: ConvEvent, depName: (id?: number | null) => string): string {
  const d = e.data ?? {}
  switch (e.kind) {
    case 'routed':
      return d.to == null ? `${e.actor}, konuşmayı atanmamış kuyruğa aldı` : `${e.actor}, konuşmayı ${depName(d.to)} birimine yönlendirdi`
    case 'priority':
      return d.priority === 'urgent'
        ? `${e.actor}, ACİL olarak işaretledi`
        : d.priority === 'important'
          ? `${e.actor}, önemli olarak işaretledi`
          : `${e.actor}, önem işaretini kaldırdı`
    case 'status':
      return d.status === 'closed' ? `${e.actor}, konuşmayı kapattı` : `${e.actor}, konuşmayı yeniden açtı`
    default:
      return `${e.actor}: ${e.kind}`
  }
}

export default function MesajlarPage() {
  const { message, notify } = usePanelMessage()
  const [status, setStatus] = useState<ServiceStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [sel, setSel] = useState<Selection>({ folder: 'waiting', departmentId: null })
  const [search, setSearch] = useState('')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selected, setSelected] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [events, setEvents] = useState<ConvEvent[]>([])
  const [viewers, setViewers] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [mode, setMode] = useState<'reply' | 'note'>('reply')
  const [sending, setSending] = useState(false)
  const [aiDraft, setAiDraft] = useState<AiDraft | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  // Kutudaki metin asistan taslağından düzenleniyorsa taslağın kimliği: gönderim taslak ucundan
  // geçsin ki kayıtta "düzeltilerek gönderildi" olarak kalsın (iyileştirme için ölçü).
  const [editingDraftId, setEditingDraftId] = useState<number | null>(null)
  const [, setTick] = useState(0) // bekleme sürelerini tazelemek için (30 sn)
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([])
  // Taslakta açılan "baktığı kayıtlar" listesi (araç adı); null = kapalı.
  const [openTool, setOpenTool] = useState<string | null>(null)
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickQ, setQuickQ] = useState('')
  const [notifPerm, setNotifPerm] = useState<string>(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission))

  const lastIdRef = useRef<number | null>(null)
  const lastEventIdRef = useRef<number>(0)
  const statusSinceRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const nearBottomRef = useRef(true)
  const prevWaitingRef = useRef<number | null>(null)
  const prevLateRef = useRef<number | null>(null)
  const textRef = useRef<HTMLTextAreaElement | null>(null)

  const sla = summary?.sla ?? status?.sla ?? DEFAULT_SLA

  const depName = useCallback(
    (id?: number | null) => summary?.allDepartments.find((d) => d.id === id)?.name ?? (id == null ? 'Atanmamış' : `#${id}`),
    [summary]
  )

  // --- servis durumu + kapsam (bir kez) + hazır cevaplar
  useEffect(() => {
    api<ServiceStatus>('/api/panel/status')
      .then(setStatus)
      .catch((e) => setStatusError((e as Error).message))
    api<QuickReply[]>('/api/panel/quick-replies').then(setQuickReplies).catch(() => { /* hazır cevap süs */ })
  }, [])

  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 30000)
    return () => window.clearInterval(t)
  }, [])

  // --- özet (klasör + birim sayıları)
  const loadSummary = useCallback(async () => {
    try {
      const s = await api<Summary>('/api/panel/summary')
      setSummary(s)
      const w = s.folders.waiting
      const late = s.folders.late ?? 0
      if (prevWaitingRef.current != null && w > prevWaitingRef.current) bip()
      // Gecikme eşiğini yeni aşan konuşma: ses + (izin varsa) masaüstü bildirimi — sekme arkadayken de.
      if (prevLateRef.current != null && late > prevLateRef.current) {
        bip()
        masaustuBildirimi('Cevap bekleyen konuşma gecikti', `${late} konuşma ${s.sla?.lateMinutes ?? DEFAULT_SLA.lateMinutes} dakikadan uzun süredir cevap bekliyor.`)
      }
      prevWaitingRef.current = w
      prevLateRef.current = late
      document.title = late > 0 ? `(${late}!) ${w} bekleyen — Stilsoft Asistan` : w > 0 ? `(${w}) Stilsoft Asistan` : 'Stilsoft Asistan'
    } catch {
      /* geçici */
    }
  }, [])

  // --- liste
  const loadList = useCallback(async (quiet = false) => {
    if (!quiet) setListLoading(true)
    try {
      const qs = new URLSearchParams({ pageSize: '200', folder: sel.folder })
      if (sel.departmentId != null) qs.set('departmentId', String(sel.departmentId))
      if (search.trim()) qs.set('q', search.trim())
      const data = await api<{ items: Conversation[] }>(`/api/panel/conversations?${qs}`)
      setConversations(data.items)
    } catch (e) {
      if (!quiet) notify('err', (e as Error).message)
    } finally {
      if (!quiet) setListLoading(false)
    }
  }, [sel, search, notify])

  useEffect(() => {
    const t = window.setTimeout(() => void loadList(), search ? 300 : 0)
    return () => window.clearTimeout(t)
  }, [loadList, search])

  useEffect(() => {
    void loadSummary()
    const t = window.setInterval(() => {
      if (!sekmeGorunur()) return
      void loadSummary()
      void loadList(true)
    }, 5000)
    return () => window.clearInterval(t)
  }, [loadList, loadSummary])

  // --- seçili konuşma
  const scrollToBottom = () => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  const markRead = useCallback(async (id: number) => {
    try {
      await api(`/api/panel/conversations/${id}/read`, { method: 'POST' })
      setConversations((list) => list.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)))
    } catch {
      /* süs */
    }
  }, [])

  const openConversation = useCallback(async (id: number) => {
    setSelectedId(id)
    setMessages([])
    setEvents([])
    setViewers([])
    setDraft('')
    setMode('reply')
    setAiDraft(null)
    setEditingDraftId(null)
    lastIdRef.current = null
    lastEventIdRef.current = 0
    statusSinceRef.current = null
    try {
      const data = await api<{ conversation: Conversation; draft: AiDraft | null; messages: Message[]; events: ConvEvent[]; viewers: string[]; serverTime: string }>(
        `/api/panel/conversations/${id}/messages`
      )
      setSelected(data.conversation)
      setAiDraft(data.draft ?? null)
      setMessages(data.messages)
      setEvents(data.events)
      setViewers(data.viewers)
      lastIdRef.current = data.messages.length ? data.messages[data.messages.length - 1].id : 0
      lastEventIdRef.current = data.events.length ? data.events[data.events.length - 1].id : 0
      statusSinceRef.current = data.serverTime
      nearBottomRef.current = true
      window.setTimeout(scrollToBottom, 0)
      if (data.conversation.unreadCount > 0) void markRead(id)
    } catch (e) {
      notify('err', (e as Error).message)
      setSelectedId(null)
      setSelected(null)
    }
  }, [markRead, notify])

  const poll = useCallback(async () => {
    if (selectedId == null || lastIdRef.current == null) return
    try {
      const qs = new URLSearchParams({ afterId: String(lastIdRef.current), afterEventId: String(lastEventIdRef.current) })
      if (statusSinceRef.current) qs.set('statusSince', statusSinceRef.current)
      const data = await api<{ conversation: Conversation; draft: AiDraft | null; messages: Message[]; events: ConvEvent[]; viewers: string[]; statuses: { id: number; status: string; error?: string | null }[]; serverTime: string }>(
        `/api/panel/conversations/${selectedId}/messages?${qs}`
      )
      setSelected(data.conversation)
      setAiDraft(data.draft ?? null)
      setViewers(data.viewers)
      statusSinceRef.current = data.serverTime
      if (data.messages.length || data.statuses.length) {
        setMessages((prev) => {
          const byId = new Map(prev.map((m) => [m.id, m]))
          for (const m of data.messages) byId.set(m.id, m)
          for (const s of data.statuses) {
            const m = byId.get(s.id)
            if (m) byId.set(s.id, { ...m, status: s.status, error: s.error ?? m.error })
          }
          return Array.from(byId.values()).sort((a, b) => a.id - b.id)
        })
      }
      if (data.events.length) {
        setEvents((prev) => [...prev, ...data.events.filter((e) => !prev.some((p) => p.id === e.id))])
        lastEventIdRef.current = data.events[data.events.length - 1].id
      }
      if (data.messages.length) {
        lastIdRef.current = data.messages[data.messages.length - 1].id
        if (nearBottomRef.current) window.setTimeout(scrollToBottom, 0)
        if (data.messages.some((m) => m.direction === 'in') && sekmeGorunur()) void markRead(selectedId)
      }
    } catch (e: any) {
      // Konuşma başka birime devredildi ve artık kapsam dışı: kapat.
      if (e?.status === 404) {
        notify('ok', 'Konuşma başka bir birime devredildi.')
        setSelectedId(null)
        setSelected(null)
      }
    }
  }, [selectedId, markRead, notify])

  useEffect(() => {
    const t = window.setInterval(() => { if (sekmeGorunur()) void poll() }, 3000)
    return () => window.clearInterval(t)
  }, [poll])

  const afterAction = () => {
    void poll()
    void loadList(true)
    void loadSummary()
  }

  // --- gönder / not
  const submit = async () => {
    const text = draft.trim()
    if (!text || selectedId == null || sending) return
    setSending(true)
    try {
      if (mode === 'note') {
        await api(`/api/panel/conversations/${selectedId}/notes`, { method: 'POST', body: JSON.stringify({ text }) })
        setDraft('')
      } else {
        // Metin asistan taslağından düzenlendiyse taslak ucundan gönder: kayıtta "düzeltilerek
        // gönderildi" kalsın. Taslak bu arada geçersizleştiyse (başkası gönderdi / yenisi geldi)
        // mesaj kaybolmasın diye normal gönderime düşülür.
        let item: Message | null = null
        if (editingDraftId != null) {
          try {
            item = (await api<{ item: Message }>(`/api/panel/conversations/${selectedId}/drafts/${editingDraftId}/send`, { method: 'POST', body: JSON.stringify({ text }) })).item
          } catch (e: any) {
            if (e?.status !== 409) throw e
            notify('ok', 'Asistan taslağı değişmişti; mesaj normal gönderildi.')
          }
          setEditingDraftId(null)
        }
        if (!item) {
          item = (await api<{ item: Message }>(`/api/panel/conversations/${selectedId}/messages`, { method: 'POST', body: JSON.stringify({ text }) })).item
        }
        setDraft('')
        if (item) {
          const sent = item
          setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]))
          lastIdRef.current = Math.max(lastIdRef.current ?? 0, sent.id)
        }
      }
      nearBottomRef.current = true
      window.setTimeout(scrollToBottom, 0)
      afterAction()
    } catch (e) {
      notify('err', (e as Error).message)
      void poll()
    } finally {
      setSending(false)
    }
  }

  // --- asistan taslağı: onayla / düzenle / sil / yeniden dene
  const sendAiDraft = async () => {
    if (!aiDraft || selectedId == null || aiBusy) return
    setAiBusy(true)
    try {
      const d = await api<{ item: Message }>(`/api/panel/conversations/${selectedId}/drafts/${aiDraft.id}/send`, { method: 'POST', body: JSON.stringify({}) })
      setAiDraft(null)
      setEditingDraftId(null)
      if (d.item) {
        const sent = d.item
        setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]))
        lastIdRef.current = Math.max(lastIdRef.current ?? 0, sent.id)
      }
      nearBottomRef.current = true
      window.setTimeout(scrollToBottom, 0)
      afterAction()
    } catch (e) {
      notify('err', (e as Error).message)
      void poll()
    } finally {
      setAiBusy(false)
    }
  }

  const editAiDraft = () => {
    if (!aiDraft) return
    setMode('reply')
    setDraft(aiDraft.body)
    setEditingDraftId(aiDraft.id)
  }

  const discardAiDraft = async () => {
    if (!aiDraft || selectedId == null || aiBusy) return
    setAiBusy(true)
    try {
      await api(`/api/panel/conversations/${selectedId}/drafts/${aiDraft.id}/discard`, { method: 'POST' })
      if (editingDraftId === aiDraft.id) setEditingDraftId(null)
      setAiDraft(null)
    } catch (e) {
      notify('err', (e as Error).message)
      void poll()
    } finally {
      setAiBusy(false)
    }
  }

  const retryAi = async () => {
    if (selectedId == null || aiBusy) return
    setAiBusy(true)
    try {
      await api(`/api/panel/conversations/${selectedId}/ai/retry`, { method: 'POST' })
      notify('ok', 'Asistan yeniden çalışıyor; taslak birkaç saniye içinde gelir.')
    } catch (e) {
      notify('err', (e as Error).message)
    } finally {
      setAiBusy(false)
    }
  }

  const route = async (departmentId: number | null) => {
    if (selectedId == null) return
    try {
      const r = await api<{ stillVisible: boolean }>(`/api/panel/conversations/${selectedId}/route`, { method: 'POST', body: JSON.stringify({ departmentId }) })
      notify('ok', departmentId == null ? 'Atanmamış kuyruğa alındı.' : `${depName(departmentId)} birimine yönlendirildi.`)
      if (!r.stillVisible) {
        setSelectedId(null)
        setSelected(null)
      }
      afterAction()
    } catch (e) {
      notify('err', (e as Error).message)
    }
  }

  const setPriority = async (priority: Priority) => {
    if (!selected || selected.priority === priority) return
    try {
      await api(`/api/panel/conversations/${selected.id}/priority`, { method: 'POST', body: JSON.stringify({ priority }) })
      setSelected({ ...selected, priority })
      afterAction()
    } catch (e) {
      notify('err', (e as Error).message)
    }
  }

  // --- hazır cevap: kutuya ekle ({musteri} → müşteri adı), kullanım sayacı
  const applyQuickReply = (q: QuickReply) => {
    if (!selected) return
    const ad = selected.customerName || selected.contactName || ''
    const metin = q.body.replace(/\{musteri\}/gi, ad).replace(/\{numara\}/gi, selected.phone)
    setMode('reply')
    setDraft((d) => (d.trim() ? `${d.trimEnd()}\n${metin}` : metin))
    setQuickOpen(false)
    setQuickQ('')
    window.setTimeout(() => textRef.current?.focus(), 0)
    void api(`/api/panel/quick-replies/${q.id}/used`, { method: 'POST' }).catch(() => undefined)
  }

  const quickForSelected = useMemo(() => {
    const dep = selected?.departmentId ?? null
    const term = quickQ.trim().toLocaleLowerCase('tr')
    return quickReplies
      .filter((q) => q.departmentId == null || q.departmentId === dep)
      .filter((q) => !term || q.title.toLocaleLowerCase('tr').includes(term) || q.body.toLocaleLowerCase('tr').includes(term))
  }, [quickReplies, selected?.departmentId, quickQ])

  const askNotif = async () => {
    try {
      if (typeof Notification === 'undefined') return
      setNotifPerm(await Notification.requestPermission())
    } catch {
      /* süs */
    }
  }

  const setConvStatus = async (s: 'open' | 'closed') => {
    if (selectedId == null) return
    try {
      await api(`/api/panel/conversations/${selectedId}/status`, { method: 'POST', body: JSON.stringify({ status: s }) })
      notify('ok', s === 'closed' ? 'Konuşma kapatıldı. Müşteri yeniden yazarsa kendiliğinden açılır.' : 'Konuşma yeniden açıldı.')
      afterAction()
    } catch (e) {
      notify('err', (e as Error).message)
    }
  }

  const rematch = async () => {
    if (selectedId == null) return
    try {
      const d = await api<{ matches: { customerCode: string; name: string }[] }>(`/api/panel/conversations/${selectedId}/rematch`, { method: 'POST' })
      notify('ok', d.matches.length ? `${d.matches.length} cari bulundu: ${d.matches.map((m) => m.customerCode).join(', ')}` : 'Bu numaraya kayıtlı cari yok.')
      afterAction()
    } catch (e) {
      notify('err', (e as Error).message)
    }
  }

  const thread: ThreadItem[] = useMemo(() => {
    const items: ThreadItem[] = [
      ...messages.map((m) => ({ kind: 'msg' as const, at: m.at, m })),
      ...events.map((e) => ({ kind: 'evt' as const, at: e.at, e }))
    ]
    return items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  }, [messages, events])

  const folderCount = (f: Folder) => {
    if (!summary) return null
    const x = summary.folders
    return f === 'waiting' ? x.waiting : f === 'important' ? x.important : f === 'answered' ? x.answered : f === 'unassigned' ? x.unassigned : null
  }

  const selectedTitle =
    sel.departmentId != null
      ? `${depName(sel.departmentId)} — ${sel.folder === 'open' ? 'açık konuşmalar' : FOLDERS.find((f) => f.id === sel.folder)?.label}`
      : FOLDERS.find((f) => f.id === sel.folder)?.label

  const oldest = bekleme(summary?.folders.oldestWaitingSince, sla)
  const lateCount = summary?.folders.late ?? 0

  return (
    <div className="h-full flex flex-col">
      <MessageBanner message={message} />
      {statusError && <div className="mb-3 px-4 py-2.5 rounded-2xl text-sm font-semibold border bg-red-50 border-red-200 text-red-700">{statusError}</div>}
      {status?.fakeProvider && (
        <div className="mb-3 px-4 py-2 rounded-2xl text-xs font-semibold border bg-amber-50 border-amber-200 text-amber-800">
          Deneme modu: WhatsApp hesabı henüz bağlanmadı. Gönderilen mesajlar müşteriye GİTMİYOR, yalnız kaydediliyor.
        </div>
      )}
      {status && !status.canSeeAll && status.departmentIds.length === 0 && (
        <div className="mb-3 px-4 py-2 rounded-2xl text-xs font-semibold border bg-amber-50 border-amber-200 text-amber-800">
          Henüz hiçbir birime eklenmediniz; bu yüzden konuşma göremiyorsunuz. Yöneticiniz Ayarlar sayfasından sizi bir birime ekleyebilir.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[210px_330px_minmax(0,1fr)] gap-3 flex-1 min-h-[480px] min-w-0">
        {/* ---------------- klasörler + birimler */}
        <aside className="rounded-3xl border border-gray-200 bg-white p-2 overflow-y-auto hidden lg:block min-w-0">
          {FOLDERS.filter((f) => !f.seeAllOnly || status?.canSeeAll).map((f) => {
            const active = sel.folder === f.id && sel.departmentId == null
            const n = folderCount(f.id)
            const Icon = f.icon
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setSel({ folder: f.id, departmentId: null })}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-sm font-semibold ${active ? 'bg-green-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`}
              >
                <span className="flex items-center gap-2"><Icon className="w-4 h-4" /> {f.label}</span>
                {n != null && n > 0 && <span className={`text-[11px] font-black ${active ? 'text-white' : f.id === 'waiting' ? 'text-red-600' : 'text-gray-500'}`}>{n}</span>}
              </button>
            )
          })}
          {oldest && (
            <div className={`mx-2 mt-1 mb-2 px-2 py-1 rounded-lg text-[11px] font-bold ${toneClass[oldest.tone]}`}>En eski bekleyen: {oldest.text}</div>
          )}

          <div className="mt-3 mb-1 px-3 text-[10px] font-black uppercase tracking-wider text-gray-400">Birimler</div>
          {(summary?.departments ?? []).map((d) => {
            const active = sel.departmentId === d.id
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => setSel({ folder: 'open', departmentId: d.id })}
                className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl text-[13px] font-semibold ${active ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'}`}
              >
                <span className="truncate">{d.name}</span>
                <span className="flex items-center gap-1.5 shrink-0">
                  {(d.late ?? 0) > 0 && <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse" title={`${d.late} konuşma gecikti`} />}
                  {d.important > 0 && <Star className={`w-3 h-3 ${active ? 'text-amber-300' : 'text-amber-500'}`} fill="currentColor" />}
                  {d.waiting > 0 ? (
                    <span className={`text-[11px] font-black ${active ? 'text-white' : 'text-red-600'}`} title="Cevap bekleyen">{d.waiting}</span>
                  ) : d.open > 0 ? (
                    <span className={`text-[11px] font-bold ${active ? 'text-gray-300' : 'text-gray-400'}`} title="Açık (cevaplanmış)">{d.open}</span>
                  ) : null}
                </span>
              </button>
            )
          })}
          {summary && summary.departments.length === 0 && <div className="px-3 py-2 text-[11px] text-gray-400">Birim yok.</div>}
        </aside>

        {/* ---------------- liste */}
        <div className={`rounded-3xl border border-gray-200 bg-white flex flex-col min-h-0 min-w-0 ${selectedId != null ? 'hidden lg:flex' : 'flex'}`}>
          <div className="p-3 border-b border-gray-100 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-black text-gray-900 truncate">{selectedTitle}</div>
              <button type="button" onClick={() => { void loadList(); void loadSummary() }} title="Yenile" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
                <RefreshCw className={`w-4 h-4 ${listLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            {/* Dar ekranda klasör seçimi */}
            <select
              className="lg:hidden w-full h-9 px-2 rounded-xl border border-gray-200 text-sm font-semibold"
              value={sel.departmentId != null ? `d:${sel.departmentId}` : `f:${sel.folder}`}
              onChange={(e) => {
                const v = e.target.value
                setSel(v.startsWith('d:') ? { folder: 'open', departmentId: Number(v.slice(2)) } : { folder: v.slice(2) as Folder, departmentId: null })
              }}
            >
              {FOLDERS.filter((f) => !f.seeAllOnly || status?.canSeeAll).map((f) => (
                <option key={f.id} value={`f:${f.id}`}>{f.label}{folderCount(f.id) ? ` (${folderCount(f.id)})` : ''}</option>
              ))}
              {(summary?.departments ?? []).map((d) => (
                <option key={d.id} value={`d:${d.id}`}>{d.name}{d.waiting ? ` (${d.waiting})` : ''}</option>
              ))}
            </select>
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ad, numara, cari ara…"
                className="w-full h-9 pl-9 pr-3 rounded-2xl border border-gray-200 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-gray-900/10"
              />
            </div>
            {lateCount > 0 && (
              <button
                type="button"
                onClick={() => { setSel({ folder: 'waiting', departmentId: null }); setSearch('') }}
                className="w-full px-3 py-2 rounded-xl bg-red-600 text-white text-xs font-black flex items-center gap-2 animate-pulse"
                title="Cevap bekleyenleri göster"
              >
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="text-left">{lateCount} konuşma {sla.lateMinutes} dakikadan uzun süredir cevap bekliyor</span>
              </button>
            )}
            {notifPerm === 'default' && (
              <button type="button" onClick={() => void askNotif()} className="w-full px-3 py-1.5 rounded-xl border border-dashed border-gray-300 text-[11px] font-bold text-gray-600 hover:bg-gray-50 inline-flex items-center justify-center gap-1.5">
                <Bell className="w-3.5 h-3.5" /> Masaüstü bildirimlerini aç (geciken konuşmalar için)
              </button>
            )}
            {import.meta.env.DEV && <MusteriGibiYaz onSent={() => { void loadList(true); void loadSummary() }} />}
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 && !listLoading && <div className="p-6 text-center text-sm text-gray-500">Bu klasörde konuşma yok.</div>}
            {conversations.map((c) => {
              const w = c.awaitingReply && c.status === 'open' ? bekleme(c.waitingSince, sla) : null
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => void openConversation(c.id)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 border-l-4 ${
                    w?.tone === 'late' ? 'border-l-red-500 bg-red-50/40' : c.priority === 'urgent' ? 'border-l-red-300' : 'border-l-transparent'
                  } ${selectedId === c.id ? 'bg-gray-100' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className={`truncate text-sm flex items-center gap-1.5 ${c.unreadCount > 0 ? 'font-black text-gray-900' : 'font-semibold text-gray-800'}`}>
                      {c.priority === 'urgent' && <span title="Acil"><Flame className="w-3.5 h-3.5 text-red-600 shrink-0" fill="currentColor" /></span>}
                      {c.priority === 'important' && <span title="Önemli"><Star className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="currentColor" /></span>}
                      <span className="truncate">{c.customerName || c.contactName || c.phone}</span>
                    </div>
                    {w ? (
                      <span className={`shrink-0 px-1.5 py-0.5 rounded-md text-[10px] font-black inline-flex items-center gap-0.5 ${toneClass[w.tone]}`} title="Cevapsız bekliyor">
                        <Timer className="w-3 h-3" /> {w.text}
                      </span>
                    ) : (
                      <span className="shrink-0 text-[11px] text-gray-400">{saat(c.lastMessageAt)}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <div className="truncate text-xs text-gray-500">
                      {c.lastMessageDirection === 'out' ? `${c.lastReplyBy ?? 'Siz'}: ` : ''}
                      {c.lastMessagePreview}
                    </div>
                    {c.unreadCount > 0 && (
                      <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-green-600 text-white text-[11px] font-black inline-flex items-center justify-center">{c.unreadCount}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 text-[10px]">
                    <span className={`px-1.5 py-0.5 rounded-md font-bold ${c.departmentId ? 'bg-sky-50 text-sky-700' : 'bg-gray-100 text-gray-500'}`}>{c.departmentName ?? 'Atanmamış'}</span>
                    {c.ai.topic && <span className="px-1.5 py-0.5 rounded-md font-bold bg-indigo-50 text-indigo-700 truncate max-w-[110px]" title={c.ai.summary ?? undefined}>{c.ai.topic}</span>}
                    {c.ai.needsHuman && <span title="Asistan: insan kararı gerekli"><Bot className="w-3.5 h-3.5 text-amber-600 shrink-0" /></span>}
                    <span className="text-gray-400 truncate">{c.phone}{c.customerCode ? ` · ${c.customerCode}` : ''}{c.status === 'closed' ? ' · kapalı' : ''}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* ---------------- sohbet */}
        <div className={`rounded-3xl border border-gray-200 bg-white flex flex-col min-h-0 min-w-0 ${selectedId == null ? 'hidden lg:flex' : 'flex'}`}>
          {selected == null ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-2">
              <MessageCircle className="w-10 h-10" />
              <div className="text-sm font-semibold">Bir konuşma seçin.</div>
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-gray-100 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex items-start gap-2">
                    <button type="button" onClick={() => { setSelectedId(null); setSelected(null) }} className="lg:hidden p-1 -ml-1 text-gray-500" aria-label="Listeye dön">
                      <X className="w-5 h-5" />
                    </button>
                    <div className="min-w-0">
                      <div className="text-sm font-black text-gray-900 truncate">{selected.customerName || selected.contactName || selected.phone}</div>
                      <div className="text-xs text-gray-500 truncate">
                        {selected.phone}
                        {selected.contactName && selected.customerName ? ` · WhatsApp adı: ${selected.contactName}` : ''}
                        {selected.customerCode
                          ? ` · Cari: ${selected.customerCode}${selected.customerMatchCount > 1 ? ` (+${selected.customerMatchCount - 1} cari daha)` : ''}`
                          : ' · Kayıtlı cari yok'}
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-1.5">
                    <div className="inline-flex rounded-xl border border-gray-200 overflow-hidden" role="group" aria-label="Önem derecesi">
                      {(['normal', 'important', 'urgent'] as Priority[]).map((p) => {
                        const on = selected.priority === p
                        const tone = p === 'urgent' ? 'bg-red-600 text-white' : p === 'important' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-800'
                        return (
                          <button
                            key={p}
                            type="button"
                            onClick={() => void setPriority(p)}
                            title={`Önem: ${PRIORITY_LABEL[p]}`}
                            className={`h-8 px-2 text-xs font-bold inline-flex items-center gap-1 border-r last:border-r-0 border-gray-200 ${on ? tone : 'text-gray-500 hover:bg-gray-50'}`}
                          >
                            {p === 'urgent' ? <Flame className="w-3.5 h-3.5" fill={on ? 'currentColor' : 'none'} /> : p === 'important' ? <Star className="w-3.5 h-3.5" fill={on ? 'currentColor' : 'none'} /> : null}
                            {PRIORITY_LABEL[p]}
                          </button>
                        )
                      })}
                    </div>
                    <button type="button" onClick={rematch} title="Telefonla cariyi yeniden ara" className="h-8 px-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 inline-flex items-center gap-1">
                      <UserCheck className="w-4 h-4" /> Cari
                    </button>
                    {selected.status === 'open' ? (
                      <button type="button" onClick={() => void setConvStatus('closed')} className="h-8 px-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 inline-flex items-center gap-1">
                        <Lock className="w-4 h-4" /> Kapat
                      </button>
                    ) : (
                      <button type="button" onClick={() => void setConvStatus('open')} className="h-8 px-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 inline-flex items-center gap-1">
                        <Unlock className="w-4 h-4" /> Aç
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-600">
                    <ArrowRightLeft className="w-4 h-4" /> Birim:
                    <select
                      value={selected.departmentId ?? ''}
                      onChange={(e) => void route(e.target.value === '' ? null : Number(e.target.value))}
                      className="h-8 px-2 rounded-xl border border-gray-200 text-xs font-bold text-gray-800 bg-white"
                    >
                      {(status?.canSeeAll || selected.departmentId == null) && <option value="">Atanmamış</option>}
                      {(summary?.allDepartments ?? []).map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </label>
                  {selected.awaitingReply && selected.status === 'open' && (() => {
                    const w = bekleme(selected.waitingSince, sla)
                    return w ? (
                      <span className={`px-2 py-1 rounded-lg text-[11px] font-black inline-flex items-center gap-1 ${toneClass[w.tone]}`}>
                        <Timer className="w-3.5 h-3.5" /> {w.dk < 1 ? 'Az önce yazdı' : `Cevap bekliyor · ${w.text}`}
                      </span>
                    ) : null
                  })()}
                  {!selected.awaitingReply && selected.lastReplyBy && (
                    <span className="text-[11px] text-gray-500">Son cevaplayan: <b>{selected.lastReplyBy}</b> · {saat(selected.lastReplyAt)}</span>
                  )}
                  {viewers.length > 0 && (
                    <span className="px-2 py-1 rounded-lg text-[11px] font-bold bg-violet-50 text-violet-700 inline-flex items-center gap-1">
                      <Eye className="w-3.5 h-3.5" /> {viewers.join(', ')} şu an bakıyor
                    </span>
                  )}
                  {selected.ai.topic && (
                    <span className="px-2 py-1 rounded-lg text-[11px] font-bold bg-indigo-50 text-indigo-700 inline-flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5" /> {selected.ai.topic}
                    </span>
                  )}
                  {selected.ai.needsHuman && (
                    <span className="px-2 py-1 rounded-lg text-[11px] font-bold bg-amber-100 text-amber-800 inline-flex items-center gap-1" title={selected.ai.reason ?? undefined}>
                      <AlertTriangle className="w-3.5 h-3.5" /> Asistan: insan kararı gerekli
                    </span>
                  )}
                </div>
                {/* Asistanın konuşma özeti — personel baştan okumadan ne olduğunu anlasın. */}
                {selected.ai.summary && (
                  <div className="text-[11px] text-gray-600 flex items-start gap-1.5">
                    <Bot className="w-3.5 h-3.5 shrink-0 mt-0.5 text-indigo-500" />
                    <span className="min-w-0"><b className="text-gray-700">Asistan özeti:</b> {selected.ai.summary}</span>
                  </div>
                )}
                {selected.ai.error && (
                  <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-xl px-2 py-1.5 flex items-center justify-between gap-2">
                    <span className="min-w-0">Asistan taslak üretemedi: {selected.ai.error}</span>
                    <button type="button" onClick={() => void retryAi()} disabled={aiBusy} className="shrink-0 h-7 px-2 rounded-lg bg-white border border-red-200 font-bold text-red-700 disabled:opacity-50 inline-flex items-center gap-1">
                      <RefreshCw className={`w-3.5 h-3.5 ${aiBusy ? 'animate-spin' : ''}`} /> Yeniden dene
                    </button>
                  </div>
                )}
              </div>

              <div
                ref={scrollRef}
                onScroll={(e) => {
                  const el = e.currentTarget
                  nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
                }}
                className="flex-1 overflow-y-auto px-4 py-4 space-y-2 bg-[#f4f1ea]"
              >
                {thread.map((it) =>
                  it.kind === 'evt' ? (
                    it.e.kind === 'note' ? (
                      <div key={`e${it.e.id}`} className="flex justify-center">
                        <div className="max-w-[85%] rounded-2xl px-3 py-2 bg-yellow-50 border border-yellow-200 shadow-sm">
                          <div className="text-[10px] font-black text-yellow-800 flex items-center gap-1"><StickyNote className="w-3 h-3" /> İç not — {it.e.actor} · {saat(it.e.at)}</div>
                          <div className="text-sm text-gray-900 whitespace-pre-wrap break-words">{it.e.data?.text}</div>
                        </div>
                      </div>
                    ) : (
                      <div key={`e${it.e.id}`} className="flex justify-center">
                        <div className="px-3 py-1 rounded-full bg-white/70 text-[11px] text-gray-600 font-semibold">
                          {eventText(it.e, depName)} · {saat(it.e.at)}
                        </div>
                      </div>
                    )
                  ) : (
                    <div key={`m${it.m.id}`} className={`flex ${it.m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[78%] rounded-2xl px-3 py-2 shadow-sm ${it.m.direction === 'out' ? (it.m.status === 'failed' ? 'bg-red-50 border border-red-200' : 'bg-[#dcf8c6]') : 'bg-white'}`}>
                        {it.m.hasMedia && <Medya m={it.m} />}
                        {!it.m.hasMedia && !it.m.body && it.m.typeLabel && <div className="text-xs italic text-gray-500">{it.m.typeLabel}</div>}
                        {it.m.body && <div className="text-sm text-gray-900 whitespace-pre-wrap break-words">{it.m.body}</div>}
                        {it.m.status === 'failed' && it.m.error && <div className="text-[11px] text-red-600 mt-1">{it.m.error}</div>}
                        <div className="flex items-center justify-end gap-1 mt-0.5 text-[10px] text-gray-500">
                          {it.m.fromDraft && <span title="Asistan taslağı onaylanarak gönderildi"><Bot className="w-3 h-3 text-indigo-500" /></span>}
                          {it.m.direction === 'out' && it.m.sentBy && <span>{it.m.sentBy} ·</span>}
                          <span>{saat(it.m.at)}</span>
                          <Tik m={it.m} />
                        </div>
                      </div>
                    </div>
                  )
                )}
              </div>

              <div className="p-3 border-t border-gray-100">
                {/*
                  ASİSTAN TASLAĞI — müşteriye GİTMEDİ. Üç yol: olduğu gibi onayla, kutuya alıp düzelt,
                  ya da sil. Taslak kutuya alındıysa panel kısalır (metin aşağıda duruyor).
                */}
                {aiDraft && (
                  <div className="mb-2 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-black text-indigo-800 inline-flex items-center gap-1">
                        <Bot className="w-3.5 h-3.5" /> Asistan taslağı — müşteriye gitmedi
                      </span>
                      <span className="text-[10px] text-indigo-700/70 shrink-0">{saat(aiDraft.createdAt)}</span>
                    </div>
                    {aiDraft.needsHuman && (
                      <div className="mt-1 text-[11px] font-bold text-amber-800 flex items-start gap-1">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>Asistan bu konuda emin değil{aiDraft.reason ? `: ${aiDraft.reason}` : ''} — göndermeden önce okuyun.</span>
                      </div>
                    )}
                    {/* Asistanın baktığı kayıtlar — personel taslaktaki rakamı nereden aldığını görsün, gerekirse ERP'den doğrulasın. */}
                    {aiDraft.toolCalls && aiDraft.toolCalls.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <span className="text-[10px] font-bold text-indigo-700">Baktığı kayıtlar:</span>
                        {aiDraft.toolCalls.map((t, i) => {
                          const has = (t.items?.length ?? 0) > 0
                          const open = openTool === `${aiDraft.id}:${i}`
                          return (
                            <button
                              key={i}
                              type="button"
                              disabled={!has}
                              onClick={() => setOpenTool(open ? null : `${aiDraft.id}:${i}`)}
                              title={has ? 'Kayıtları göster' : t.query ? `Aranan: ${t.query}` : undefined}
                              className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${t.ok ? 'bg-white border border-indigo-100 text-indigo-800' : 'bg-red-50 border border-red-200 text-red-700'} ${has ? 'hover:bg-indigo-100 cursor-pointer' : 'cursor-default'} ${open ? 'ring-2 ring-indigo-300' : ''}`}
                            >
                              {TOOL_LABEL[t.name] ?? t.name}: {t.summary}{has ? (open ? ' ▲' : ' ▼') : ''}
                            </button>
                          )
                        })}
                      </div>
                    )}
                    {/* Seçilen aracın kayıtları — hangi kayda bakıldığı görünür; "Bu kayıtla cevap yaz" kayıttan cümle kurar (yapay zekâ çağırmaz). */}
                    {aiDraft.toolCalls?.map((t, i) => openTool === `${aiDraft.id}:${i}` && t.items && (
                      <div key={`list${i}`} className="mt-1.5 rounded-xl border border-indigo-100 bg-white divide-y divide-indigo-50 max-h-[220px] overflow-y-auto">
                        {t.items.map((it, j) => (
                          <div key={j} className="px-2.5 py-2 flex items-start justify-between gap-2">
                            <div className="min-w-0 text-[11px] text-gray-700">
                              <div className="font-black text-gray-900">
                                {it.ref} <span className="font-semibold text-gray-500">· {it.kind}</span>
                                {it.status && <span className="ml-1 px-1.5 py-0.5 rounded-md bg-sky-50 text-sky-800 font-bold">{it.status}</span>}
                                {it.amount && <span className="ml-1 font-bold text-gray-800">{it.amount}</span>}
                              </div>
                              {kayitTarihleri(it) && <div className="text-gray-500">{kayitTarihleri(it)}</div>}
                              {it.product && <div className="truncate">{it.product}</div>}
                              {it.note && <div className="text-gray-500 line-clamp-2">{it.note}</div>}
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                const metin = kayitSablonu(t.name, it, selected.customerName || selected.contactName)
                                setMode('reply')
                                setEditingDraftId(null)
                                setDraft((d) => (d.trim() ? `${d.trimEnd()}\n${metin}` : metin))
                                window.setTimeout(() => textRef.current?.focus(), 0)
                              }}
                              className="shrink-0 h-7 px-2 rounded-lg bg-indigo-600 text-white text-[10px] font-bold hover:bg-indigo-700"
                              title="Bu kaydın bilgisiyle cevap metnini yazma kutusuna ekler"
                            >
                              Bu kayıtla cevap yaz
                            </button>
                          </div>
                        ))}
                      </div>
                    ))}
                    {editingDraftId === aiDraft.id ? (
                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold text-indigo-900">Taslak aşağıdaki kutuya alındı; düzeltip gönderin.</span>
                        <span className="flex items-center gap-1.5">
                          <button type="button" onClick={() => { setDraft(''); setEditingDraftId(null) }} className="h-7 px-2.5 rounded-lg border border-indigo-200 bg-white text-[11px] font-bold text-indigo-800 hover:bg-indigo-50">
                            Vazgeç
                          </button>
                          <button type="button" onClick={() => { setDraft(''); void discardAiDraft() }} disabled={aiBusy} className="h-7 px-2.5 rounded-lg border border-gray-200 bg-white text-[11px] font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-1">
                            <Trash2 className="w-3 h-3" /> Sil
                          </button>
                        </span>
                      </div>
                    ) : (
                      <>
                        <div className="mt-1.5 text-sm text-gray-900 whitespace-pre-wrap break-words bg-white rounded-xl border border-indigo-100 px-2.5 py-2">{aiDraft.body}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void sendAiDraft()}
                            disabled={aiBusy || sending || !selected.windowOpen || status?.canSend === false}
                            title={!selected.windowOpen ? '24 saat penceresi kapandı' : undefined}
                            className="h-8 px-3 rounded-xl bg-green-600 text-white text-xs font-bold hover:bg-green-700 disabled:opacity-50 inline-flex items-center gap-1.5"
                          >
                            <Send className="w-3.5 h-3.5" /> {aiBusy ? '…' : 'Onayla ve gönder'}
                          </button>
                          <button type="button" onClick={editAiDraft} disabled={aiBusy} className="h-8 px-3 rounded-xl border border-indigo-200 bg-white text-xs font-bold text-indigo-800 hover:bg-indigo-50 disabled:opacity-50 inline-flex items-center gap-1.5">
                            <Pencil className="w-3.5 h-3.5" /> Düzenle
                          </button>
                          <button type="button" onClick={() => void discardAiDraft()} disabled={aiBusy} className="h-8 px-3 rounded-xl border border-gray-200 bg-white text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-1.5">
                            <Trash2 className="w-3.5 h-3.5" /> Sil
                          </button>
                          <button type="button" onClick={() => void retryAi()} disabled={aiBusy} className="h-8 px-2.5 rounded-xl text-xs font-bold text-gray-500 hover:bg-gray-100 disabled:opacity-50 inline-flex items-center gap-1" title="Asistan yeni bir taslak hazırlasın (ücretli çağrı)">
                            <RefreshCw className={`w-3.5 h-3.5 ${aiBusy ? 'animate-spin' : ''}`} /> Yeni taslak
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-1 mb-2">
                  <button
                    type="button"
                    onClick={() => setMode('reply')}
                    className={`h-7 px-3 rounded-lg text-xs font-bold ${mode === 'reply' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600'}`}
                  >
                    Müşteriye cevap
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMode('note'); setEditingDraftId(null) }}
                    className={`h-7 px-3 rounded-lg text-xs font-bold inline-flex items-center gap-1 ${mode === 'note' ? 'bg-yellow-400 text-gray-900' : 'bg-gray-100 text-gray-600'}`}
                  >
                    <StickyNote className="w-3.5 h-3.5" /> İç not (müşteri görmez)
                  </button>
                  {mode === 'reply' && selected.windowOpen && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setQuickOpen((o) => !o)}
                        className={`h-7 px-3 rounded-lg text-xs font-bold inline-flex items-center gap-1 ${quickOpen ? 'bg-sky-600 text-white' : 'bg-sky-50 text-sky-700 hover:bg-sky-100'}`}
                        title="Hazır cevaplar"
                      >
                        <MessageSquareText className="w-3.5 h-3.5" /> Hazır cevap
                      </button>
                      {quickOpen && (
                        <div className="absolute bottom-9 left-0 z-20 w-[340px] max-w-[85vw] rounded-2xl border border-gray-200 bg-white shadow-xl p-2">
                          <input
                            autoFocus
                            value={quickQ}
                            onChange={(e) => setQuickQ(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Escape') setQuickOpen(false) }}
                            placeholder="Hazır cevap ara…"
                            className="w-full h-8 px-2.5 mb-1.5 rounded-xl border border-gray-200 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-sky-200"
                          />
                          <div className="max-h-[260px] overflow-y-auto space-y-1">
                            {quickForSelected.length === 0 && (
                              <div className="px-2 py-3 text-[11px] text-gray-500 text-center">
                                {quickReplies.length === 0 ? 'Henüz hazır cevap yok. Yönetici Ayarlar sayfasından ekleyebilir.' : 'Bu birim için eşleşen hazır cevap yok.'}
                              </div>
                            )}
                            {quickForSelected.map((q) => (
                              <button key={q.id} type="button" onClick={() => applyQuickReply(q)} className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-sky-50">
                                <div className="text-xs font-black text-gray-900 flex items-center justify-between gap-2">
                                  <span className="truncate">{q.title}</span>
                                  {q.departmentId == null && <span className="text-[9px] font-bold text-gray-400 shrink-0">GENEL</span>}
                                </div>
                                <div className="text-[11px] text-gray-600 line-clamp-2">{q.body}</div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {mode === 'reply' && editingDraftId != null && (
                    <span className="text-[10px] font-bold text-indigo-700 inline-flex items-center gap-1"><Bot className="w-3.5 h-3.5" /> asistan taslağı düzenleniyor</span>
                  )}
                  {mode === 'reply' && selected.windowOpen && (
                    <span className="ml-auto text-[11px] text-gray-400">Yanıt süresi: {kalanSure(selected.windowClosesAt)} kaldı</span>
                  )}
                </div>
                {mode === 'reply' && !selected.windowOpen ? (
                  <div className="p-3 rounded-2xl bg-amber-50 text-sm text-amber-900 font-semibold">
                    Müşterinin son mesajının üzerinden {status?.windowHours ?? 24} saat geçti. WhatsApp kuralı gereği müşteri tekrar yazana kadar serbest
                    mesaj gönderilemez (onaylı şablon gönderimi sonraki aşamada). İç not yazabilirsiniz.
                  </div>
                ) : (
                  <div className="flex items-end gap-2">
                    <textarea
                      ref={textRef}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          void submit()
                        }
                      }}
                      rows={2}
                      maxLength={mode === 'note' ? 2000 : 4096}
                      placeholder={mode === 'note' ? 'Birim arkadaşlarınıza not… (müşteriye gitmez)' : 'Mesaj yazın… (Enter gönderir, Shift+Enter alt satır)'}
                      className={`flex-1 resize-none rounded-2xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${mode === 'note' ? 'border-yellow-300 bg-yellow-50 focus:ring-yellow-300/40' : 'border-gray-200 focus:ring-gray-900/10'}`}
                    />
                    <button
                      type="button"
                      onClick={() => void submit()}
                      disabled={sending || !draft.trim() || (mode === 'reply' && status?.canSend === false)}
                      className={`h-11 px-4 rounded-2xl text-sm font-bold disabled:opacity-50 inline-flex items-center gap-2 ${mode === 'note' ? 'bg-yellow-400 text-gray-900 hover:bg-yellow-500' : 'bg-green-600 text-white hover:bg-green-700'}`}
                    >
                      {mode === 'note' ? <StickyNote className="w-4 h-4" /> : <Send className="w-4 h-4" />} {sending ? '…' : mode === 'note' ? 'Not ekle' : 'Gönder'}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
