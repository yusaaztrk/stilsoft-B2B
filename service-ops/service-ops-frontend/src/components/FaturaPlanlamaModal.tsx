import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Loader2,
  Phone,
  RotateCcw,
  Trash2,
  Users,
} from 'lucide-react'

import Modal from './Modal'
import { apiJson } from '../api/client'
import { runStatusChange } from '../api/statusChangeGate'
import type { Technician } from '../hooks/useTechnicians'
import { toTurkishUpper } from '../utils/formInput'
import { ASSIGNABLE_TEAM_ORDER, TEAM_LABELS, teamOf, teamLabelOf, groupRowsByTechnician } from './teams'

/**
 * Montaj Yönetimi → PLANLAMA sekmesinin tek aksiyonu.
 *
 * Bu ekranda İŞİN DURUMU DEĞİŞTİRİLMEZ. Planlama sekmesi bir durum yönetimi ekranı değil,
 * "planla → fiş bas → sahaya aktar → kime" hattının ilk adımı. Durum güncellemesi (Gerçekleşti,
 * Devam Ediyor…) yalnızca kayıt sahaya aktarıldıktan sonra, TESLİMATTAKİLER sekmesinde yapılır.
 *
 * Bir kalemin adedi tek kişiye gitmeyebilir (20 adetlik bir ürün 3 farklı teknisyene
 * bölünebilir). O yüzden ekleme tek satırlık değil: kullanıcı önce bir "dağıtım listesi"
 * biriktirir (kalem + kişi + adet + tarih), sonra hepsini TEK istekte planlar. Sunucu her
 * adedi kendi 1 adetlik görevine böler — bu bilinçli: her adedin durumu ayrı ayrı ilerleyebilmeli.
 *
 * ADET EKRANDA BÖLÜNMEZ (kullanıcı kararı, 2026-08-10). Eskiden kalan her adet için ayrı bir
 * seçim kutulu satır basılıyordu; 20 adetlik bir kalem 20 satır demekti ve planlayan kişi neyi
 * seçtiğini kaybediyordu. Artık kalem tek satır, adet kabulde girildiği gibi bir SAYI alanı.
 * Bölme hâlâ mümkün: 5 yazıp X'e ekle, kalan 15 için Y'ye ekle. Sunucudaki 1 adetlik görev
 * modeli değişmedi — yalnızca bu ekrandaki gösterim değişti.
 */

type Props = {
  isOpen: boolean
  /** Montaj Yönetimi listesindeki kayıt satırı. */
  record: any | null
  /**
   * Tıklanan satırın kalemi. Planlama listesi kalem kalem olduğu için modal da yalnızca o
   * kalemi gösterir; boş geçilirse (eski çağrı) kaydın tüm kalemleri listelenir.
   */
  focusItemId?: string | null
  /** Sayfadan geçer; hook burada çağrılsa her modal ayrı bir 30 sn'lik yoklama açardı. */
  technicians: Technician[]
  onClose: () => void
  /** Liste tazelemesi. */
  onChanged?: () => Promise<unknown> | void
  /**
   * Fişi YERİNDE yazdırır; bu modal açık kalır.
   *
   * Eskiden akış üç ekrandı: planla → kapat → Servis Fişi ekranını aç → yazdır → kapat →
   * Sahaya Aktar'ı aç. Planlamayı yapan kişi aynı ekranda fişi basıp sahaya verebilsin diye
   * yazdırma buraya taşındı.
   */
  onPrintSlip?: (record: any, itemId?: string | null) => Promise<unknown> | void
  /** Sahaya aktarım adımını açar (planlama modalı kapanır, aktarım modalı gelir). */
  onOpenSahayaAktar?: (record: any, itemId?: string | null) => void
}

const CANCELLED = new Set<string | number>([3, 'Cancelled'])
const UNPLANNED = new Set<string | number>([4, 'Deferred', 6, 'Delivered', 7, 'Postponed', 5, 'Unreachable'])

const isCancelled = (t: any) => CANCELLED.has(t.status ?? t.Status)
const isUnplanned = (t: any) => UNPLANNED.has(t.status ?? t.Status)

/** Planlanmış sayılan satır: iptal de edilmemiş, plansız da bırakılmamış. */
const isLive = (t: any) => !isCancelled(t) && !isUnplanned(t)

const todayIso = () => new Date().toISOString().slice(0, 10)

type PendingRow = {
  key: string
  itemId: string
  itemProductName: string
  technicianId: string
  quantity: number
  plannedDate: string
  address: string
  note: string
}

export default function FaturaPlanlamaModal({ isOpen, record, focusItemId, technicians, onClose, onChanged, onPrintSlip, onOpenSahayaAktar }: Props) {
  const recordId: string | undefined = record?.id

  const [items, setItems] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  /** Bu oturumda fiş basıldı mı — düğme etiketi ve "aktar" ipucu için. */
  const [printedHere, setPrintedHere] = useState(false)

  /**
   * Fişi yazdırır, modal AÇIK KALIR.
   *
   * Kapatıp Servis Fişi ekranına gitmek yerine burada bitiriliyor: planlamayı yapan kişi
   * satırları atadıktan hemen sonra fişi basıp sahaya aktarabilsin.
   */
  const printInPlace = async () => {
    if (!record || printing) return
    setPrinting(true)
    setError(null)
    try {
      await onPrintSlip?.(record, focusItemId)
      setPrintedHere(true)
    } catch (e: any) {
      setError(String(e?.message ?? 'Fiş yazdırılamadı'))
    } finally {
      setPrinting(false)
    }
  }

  // Kalem başına "bu seferde kaç adet planlanacak" + o seçime uygulanacak atama bilgisi
  const [qtyByItem, setQtyByItem] = useState<Record<string, number>>({})
  const [selTechId, setSelTechId] = useState('')
  const [selDate, setSelDate] = useState(todayIso())
  const [selAddress, setSelAddress] = useState('')
  const [selNote, setSelNote] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  // Biriktirilen dağıtım listesi — "Planla ve Kaydet" ile tek istekte gönderilir.
  const [pending, setPending] = useState<PendingRow[]>([])

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null)

  // "Kime Ne Atandı" özetinde bir grubu topluca geri alma (planı kaldırma) durumu
  const [groupBusyKey, setGroupBusyKey] = useState<string | null>(null)
  const [groupError, setGroupError] = useState<string | null>(null)
  // Bir kişinin satırına tıklanınca altında kalem bazında (sepet sepet) adet dökümü açılır
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<string[]>([])


  /** Kişi bazlı toplu geri alma onayı — native window.confirm yerine uygulama içi kapı. */
  const [unplanTarget, setUnplanTarget] = useState<{ technicianId: string; technicianName: string; totalQuantity: number; rows: { id: string }[] } | null>(null)

  const [workloads, setWorkloads] = useState<Record<string, { count: number; records: any[] }>>({})
  const [workloadsLoading, setWorkloadsLoading] = useState(false)

  useEffect(() => {
    if (!isOpen || !selDate) return
    const ac = new AbortController()
    setWorkloadsLoading(true)
    void (async () => {
      try {
        const params = new URLSearchParams({
          plannedFrom: `${selDate}T00:00:00`,
          plannedTo: `${selDate}T23:59:59`
        })
        const rows = await apiJson<any[]>(`/api/servicerecords?${params}`, { signal: ac.signal } as any)
        const inactiveStatuses = new Set(['Delivered', 'Cancelled'])
        const map: Record<string, { count: number; records: any[] }> = {}

        for (const row of Array.isArray(rows) ? rows : []) {
          if (inactiveStatuses.has(String(row.status))) continue
          if (record && row.id === record.id) continue

          // YÜK = ADET, kayıt değil.
          //
          // Eskiden kişi başına KAYIT sayılıyordu: 20 adetlik tek bir montaj kaydı "1 iş"
          // görünüyor, 1'er adetlik üç kayıt "3 iş" görünüyordu. Planlayanın gördüğü sayı
          // teknisyenin o günkü gerçek yüküyle ilgisizdi. Montaj kayıtlarında yük satır
          // satırdır; satırı olmayan kayıtlarda (arıza/atölye) kaydın kendisi 1 iş sayılır.
          const perTech = new Map<string, number>()

          const taskRows = Array.isArray(row.installationTasks) ? row.installationTasks : []
          const liveTasks = taskRows.filter((t: any) => isLive(t))

          if (liveTasks.length > 0) {
            for (const task of liveTasks) {
              const techId = task.assignedTechnicianId ? String(task.assignedTechnicianId) : ''
              if (!techId) continue
              perTech.set(techId, (perTech.get(techId) ?? 0) + (Number(task.quantity) || 1))
            }
          } else {
            const owner = row.assignedTechnicianId ?? row.technicianId
            if (owner) perTech.set(String(owner), 1)
          }

          for (const [techId, qty] of perTech) {
            if (!map[techId]) map[techId] = { count: 0, records: [] }
            map[techId].count += qty
            map[techId].records.push(row)
          }
        }
        setWorkloads(map)
      } catch {
        setWorkloads({})
      } finally {
        if (!ac.signal.aborted) setWorkloadsLoading(false)
      }
    })()
    return () => ac.abort()
  }, [selDate, isOpen, record?.id])

  const load = async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      const [itemRes, taskRes] = await Promise.all([
        apiJson<any>(`/api/installations/items?serviceId=${id}`),
        apiJson<any[]>(`/api/installations/tasks?serviceId=${id}`),
      ])
      setItems(Array.isArray(itemRes?.items) ? itemRes.items : [])
      setTasks(Array.isArray(taskRes) ? taskRes : [])
    } catch (e: any) {
      setError(String(e?.message ?? 'Kalemler ve planlama satırları yüklenemedi'))
      setItems([])
      setTasks([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isOpen || !recordId) return
    setSubmitError(null)
    setSubmitSuccess(null)
    setGroupError(null)
    setPending([])
    setQtyByItem({})
    setSelTechId('')
    setSelDate(todayIso())
    setSelAddress('')
    setSelNote('')
    void load(recordId)
  }, [isOpen, recordId, focusItemId])

  /** Kalem bazında planlanan / kalan adet (sunucudaki gerçek durum). */
  const itemState = useMemo(() => {
    // Odaklanılan kalem varsa yalnızca o: liste satırı zaten tek kalemi temsil ediyor, modalın
    // kaydın diğer kalemlerini açması "yanlış kalemi planladım" hatasının kapısı.
    const source = (focusItemId
      ? items.filter((i: any) => String(i.id ?? i.Id) === focusItemId)
      : items
    )
      // İPTAL EDİLMİŞ KALEM PLANLANAMAZ. Uç `IsCancelled`/`CancelledAt` gönderiyordu ama burada
      // hiç bakılmıyordu: iptal edilen kalemin bütün satırları Cancelled olduğu için "planlanan 0,
      // kalan = adet" çıkıyor ve kalem "Planlanacak Kalemler" listesinde canlıymış gibi
      // görünüyordu. Sunucu tarafında da ayrıca reddediliyor (Allocate → CancelledItem).
      .filter((i: any) => !(i.isCancelled ?? i.IsCancelled ?? i.cancelledAt ?? i.CancelledAt))

    return source.map((i: any) => {
      const id = String(i.id ?? i.Id)
      const quantity = Number(i.quantity ?? i.Quantity) || 0
      const planned = tasks
        .filter((t: any) => String(t.serviceRecordItemId ?? t.ServiceRecordItemId ?? '') === id && isLive(t))
        .reduce((s: number, t: any) => s + (Number(t.quantity ?? t.Quantity) || 1), 0)
      return {
        id,
        productName: i.productName ?? i.ProductName ?? '-',
        serialNumber: i.serialNumber ?? i.SerialNumber ?? '',
        customerName: i.customerName ?? i.CustomerName ?? '',
        customerPhone: i.customerPhone ?? i.CustomerPhone ?? '',
        customerAddress: i.customerAddress ?? i.CustomerAddress ?? '',
        quantity,
        planned,
        remaining: Math.max(0, quantity - planned),
      }
    })
  }, [items, tasks, focusItemId])

  const itemById = useMemo(() => {
    const map = new Map<string, (typeof itemState)[number]>()
    for (const i of itemState) map.set(i.id, i)
    return map
  }, [itemState])

  /** Taslakta bekleyen adetler düşüldükten sonra o kalemde gerçekten kalan adet. */
  const pendingByItem = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of pending) map.set(p.itemId, (map.get(p.itemId) ?? 0) + p.quantity)
    return map
  }, [pending])

  const remainingAfterPending = (itemId: string) => {
    const item = itemById.get(itemId)
    if (!item) return 0
    return Math.max(0, item.remaining - (pendingByItem.get(itemId) ?? 0))
  }

  const technicianById = useMemo(() => {
    const map = new Map<string, Technician>()
    for (const t of technicians) map.set(t.id, t)
    return map
  }, [technicians])

  /** Montaja yeni atanabilecek ekipler — servis personeli/atölye/müdür buraya düşmez. */
  const techniciansByTeam = useMemo(() => {
    return ASSIGNABLE_TEAM_ORDER.map((key) => ({
      key,
      label: TEAM_LABELS[key],
      list: technicians
        .filter((t) => t.isActive !== false && teamOf(t.roles) === key)
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'tr')),
    })).filter((g) => g.list.length > 0)
  }, [technicians])

  const totals = useMemo(() => {
    const quantity = itemState.reduce((s, i) => s + i.quantity, 0)
    const planned = itemState.reduce((s, i) => s + i.planned, 0)
    const pendingTotal = pending.reduce((s, p) => s + p.quantity, 0)
    return { quantity, planned, pendingTotal, remaining: Math.max(0, quantity - planned - pendingTotal) }
  }, [itemState, pending])

  /**
   * Planlanacak kalemler: her kalem TEK satır, yanında planlanacak adet alanı. Kalan adet
   * bittiyse kalem listeden düşer — burada yalnızca planlanmamış adetler görünür, planlanmış
   * olanlar aşağıdaki "Kime Ne Atandı" özetinde.
   */
  const openItems = useMemo(() => {
    return itemState
      .map((item) => ({ ...item, selectable: remainingAfterPending(item.id) }))
      .filter((item) => item.selectable > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemState, pendingByItem])

  /** Alanı boş bırakan kullanıcı "hepsi" demek istiyor: varsayılan kalanın tamamı. */
  const qtyOf = (itemId: string, selectable: number) => {
    const raw = qtyByItem[itemId]
    if (raw === undefined) return selectable
    return Math.max(0, Math.min(raw, selectable))
  }

  const setQty = (itemId: string, value: number, selectable: number) => {
    setFormError(null)
    setQtyByItem((prev) => ({ ...prev, [itemId]: Math.max(0, Math.min(value, selectable)) }))
  }

  const selectedTotal = useMemo(
    () => openItems.reduce((sum, item) => sum + qtyOf(item.id, item.selectable), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openItems, qtyByItem]
  )

  // Planlanacak kalemler tek bir adrese ortaksa adres alanı kendiliğinden dolar; kullanıcı
  // isterse düzenler. Ortak değilse elle girilen değere dokunulmaz.
  useEffect(() => {
    const addresses = new Set(
      openItems
        .filter((item) => qtyOf(item.id, item.selectable) > 0)
        .map((item) => item.customerAddress || record?.customerAddress || '')
    )
    if (addresses.size === 1) setSelAddress([...addresses][0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openItems, qtyByItem])

  const assignSelected = () => {
    const picked = openItems
      .map((item) => ({ item, qty: qtyOf(item.id, item.selectable) }))
      .filter(({ qty }) => qty > 0)

    // Teknisyen ARTIK ZORUNLU DEĞİL; adet ve tarih hâlâ zorunlu (tarihsiz planlama diye bir
    // şey yok, satırın hangi güne düştüğü planlamanın kendisi).
    if (picked.length === 0 || !selDate) {
      setFormError('Adet girin ve tarih seçin. Personeli sonra atayabilirsiniz.')
      return
    }
    setFormError(null)
    setPending((prev) => [
      ...prev,
      ...picked.map(({ item, qty }) => ({
        key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${item.id}`,
        itemId: item.id,
        itemProductName: item.productName,
        technicianId: selTechId,
        quantity: qty,
        plannedDate: selDate,
        address: selAddress,
        note: selNote,
      })),
    ])
    // Adet alanları sıfırlanır ki kalan adet yeniden varsayılan gelsin (bölerek planlama).
    setQtyByItem({})
    setSelNote('')
    // Teknisyen ve tarih kasıtlı olarak korunuyor: aynı ekibe aynı günde birden çok seçim yapmak
    // yaygın, her seferinde yeniden seçtirmek gereksiz tıklama demek.
  }

  const removePending = (key: string) => setPending((prev) => prev.filter((p) => p.key !== key))

  const refresh = async () => {
    if (!recordId) return
    await load(recordId)
    await onChanged?.()
  }

  const submitPending = async () => {
    if (!recordId || pending.length === 0) return
    setSubmitting(true)
    setSubmitError(null)
    setSubmitSuccess(null)
    try {
      const res = await apiJson<any>('/api/installations/allocate', {
        method: 'POST',
        body: JSON.stringify({
          plannedDateUtc: new Date(pending[0].plannedDate).toISOString(),
          totalQuantity: totals.quantity,
          allocations: pending.map((p) => ({
            serviceId: recordId,
            serviceRecordItemId: p.itemId,
            // Boş metin GÖNDERİLMEZ: sunucuda alan `Guid?` ve "" değeri model bağlamada
            // 400'e düşer. Alan hiç gönderilmezse null gelir, sunucu da atamasız görev açar.
            technicianId: p.technicianId || undefined,
            quantity: p.quantity,
            notes: p.note || undefined,
            customAddress: p.address || undefined,
            plannedDateUtc: new Date(p.plannedDate).toISOString(),
          })),
        }),
      })

      const created = res?.created ?? res?.acceptedCount ?? 0
      if (created === 0) {
        const reason = res?.rejectedAllocations?.[0]?.reason ?? ''
        setSubmitError(
          reason === 'MissingTechnician'
            ? 'Seçilen teknisyenlerden biri bulunamadı.'
            : `Planlama reddedildi${reason ? ` (${reason})` : ''}.`
        )
        return
      }

      // Bu istekte kaç farklı kişiye gittiği değil, toplam kaç adet planlandığı söylenir —
      // dağılımın kendisi zaten aşağıdaki "Kime Ne Atandı" özetinde anlık görünüyor.
      setSubmitSuccess(`${created} adet planlandı.`)
      setPending([])
      await refresh()
    } catch (e: any) {
      setSubmitError(String(e?.message ?? 'Planlama kaydedilemedi'))
    } finally {
      setSubmitting(false)
    }
  }

  /** Sahaya aktarılmış satır sayısı — planlamadan geri alınamaz, yalnızca bilgi olarak yazılır. */
  const transferredCount = useMemo(() => {
    return tasks.filter(
      (t: any) =>
        isLive(t) &&
        (t.transferredAt ?? t.TransferredAt) &&
        (!focusItemId || String(t.serviceRecordItemId ?? t.ServiceRecordItemId ?? '') === focusItemId)
    ).length
  }, [tasks, focusItemId])

  /** Sunucudaki canlı (iptal/plansız olmayan) planlama satırları — özet ve düzenleme buradan beslenir. */
  const planRows = useMemo(() => {
    return tasks
      .filter(isLive)
      // Sahaya aktarılmış satır bu ekrandan geri alınamaz: "Kime Ne Atandı" grubundaki geri alma
      // düğmesi satırı "Yeni Kayıt"a çekiyor ve sahadaki iş sessizce planlanmamışa dönerdi.
      // Aktarılanı geri almanın yeri Teslimattakiler sekmesindeki "Planlamaya Geri Gönder".
      .filter((t: any) => !(t.transferredAt ?? t.TransferredAt))
      // Odaklanılan kalem varsa özet de o kalemle sınırlı; yoksa "kime ne atandı" başka
      // kalemlerin atamalarını da sayıp bu kalem fazladan planlanmış gibi görünürdü.
      .filter((t: any) => !focusItemId || String(t.serviceRecordItemId ?? t.ServiceRecordItemId ?? '') === focusItemId)
      .map((t: any) => ({
        id: String(t.id ?? t.Id),
        itemId: String(t.serviceRecordItemId ?? t.ServiceRecordItemId ?? ''),
        itemProductName: t.itemProductName ?? t.ItemProductName ?? '-',
        technicianId: String(t.assignedTechnicianId ?? t.AssignedTechnicianId ?? ''),
        technicianName: t.technicianName ?? t.TechnicianName ?? '',
        plannedAt: t.plannedAt ?? t.PlannedAt ?? null,
        quantity: Number(t.quantity ?? t.Quantity) || 1,
        customAddress: t.customAddress ?? t.CustomAddress ?? '',
        notes: t.notes ?? t.Notes ?? '',
      }))
  }, [tasks, focusItemId])

  /** "Kime Ne Atandı" — planlanan satırlar teknisyene göre gruplu. */
  const technicianGroups = useMemo(
    () => groupRowsByTechnician(planRows, (id) => technicianById.get(id)?.roles),
    [planRows, technicianById]
  )

  /**
   * Bir kişiye planlanmış TÜM adetleri tek hamlede geri alır (plansıza/"Yeni Kayıt"a çeker).
   * Adetler tekrar yukarıdaki "Planlanacak Kalemler" listesinde belirir, direkt yeniden
   * planlanabilir. Tek tek satır satır geri almak yerine kişi bazında toplu geri alma —
   * 20+ adetlik bir grubu düzeltmek tek tıkla olmalı, yoksa fonksiyonel değil.
   */
  const unplanGroup = async (group: { technicianId: string; technicianName: string; totalQuantity: number; rows: { id: string }[] }) => {
    const groupKey = group.technicianId || '__unassigned__'
    setGroupBusyKey(groupKey)
    setGroupError(null)
    try {
      // Kişi bazında TOPLU geri alma: onay tek seferde sorulur, içerideki satır istekleri
      // kapıdan muaf geçer. Sarmalanmasaydı 20 adetlik bir grup 20 onay ekranı açardı.
      const result = await runStatusChange(
        {
          kind: `Planlama Geri Alma (${group.totalQuantity} adet)`,
          subject: group.technicianName || 'Atanmamış',
          fromLabel: 'Planlandı',
          toLabel: 'Yeni Kayıt',
          hasPhoto: false,
          hasNote: true,
          note: 'Planlama geri alındı.',
          details: [{ label: 'Satır', value: `${group.rows.length} planlama satırı` }]
        },
        () =>
          Promise.all(
            group.rows.map((row) =>
              apiJson(`/api/installations/tasks/${row.id}/status`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'Deferred', reason: 'Planlama geri alındı.' }),
              })
            )
          )
      )
      if (result === null) return
      setUnplanTarget(null)
      await refresh()
    } catch (e: any) {
      setGroupError(String(e?.message ?? 'Geri alma başarısız'))
    } finally {
      setGroupBusyKey(null)
    }
  }



  const toggleGroupExpanded = (groupKey: string) => {
    setExpandedGroupKeys((prev) => (prev.includes(groupKey) ? prev.filter((k) => k !== groupKey) : [...prev, groupKey]))
  }

  /** Bir kişinin toplam adedini kalem bazında ("sepet sepet") ayırır — tek satırda toplanmaz. */
  const itemBreakdown = (rows: { itemProductName: string; quantity: number }[]) => {
    const map = new Map<string, number>()
    for (const row of rows) {
      map.set(row.itemProductName, (map.get(row.itemProductName) ?? 0) + row.quantity)
    }
    return Array.from(map.entries())
  }

  const technicianSelect = (value: string, onChange: (v: string) => void, className: string) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      {/* BOŞ SEÇENEK ARTIK GEÇERLİ BİR TERCİH (2026-08-25 kullanıcı isteği): işi bugünden
          güne planlayıp personeli günü gelince atamak. Etiket bunu açıkça söylüyor; eskiden
          "seçin..." yazıyordu ve boş bırakınca planlama sessizce reddediliyordu. */}
      <option value="">— Personel atamadan planla (sonra atanacak) —</option>
      {techniciansByTeam.map((g) => (
        <optgroup key={g.key} label={g.label}>
          {g.list.map((t) => {
            // Seçilen GÜNDEKİ adet yükü. Eşik teknisyenin kendi MaxDailyTasks değerinden
            // okunuyor; sabit "4" yazıyordu ve kimsenin gerçek kapasitesiyle ilgisi yoktu.
            // Bu yalnızca bir uyarı — sunucuda kapasite reddi bilerek kaldırılmış durumda.
            const load = workloads[t.id]?.count ?? 0
            const cap = Number(t.maxDailyTasks) > 0 ? Number(t.maxDailyTasks) : 8
            return (
              <option key={t.id} value={t.id}>
                {t.fullName} ({load}/{cap} adet{load >= cap ? ' - Yoğun' : ''})
              </option>
            )
          })}
        </optgroup>
      ))}
    </select>
  )

  if (!record) return null

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        focusItemId && itemState.length === 1
          ? `Kalem Planlama · ${record.serviceNumber ?? ''} · ${itemState[0].productName}`
          : `Fatura Planlama · ${record.serviceNumber ?? ''}`
      }
      containerClassName="max-w-5xl"
      footer={
        <>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-700 hover:bg-gray-50"
          >
            Kapat
          </button>

          {/* Planlanmış satır yoksa basılacak bir şey de yok — düğmeler o zaman görünmüyor. */}
          {tasks.length > 0 && onPrintSlip && (
            <button
              onClick={printInPlace}
              disabled={printing}
              className={
                'inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition shadow-sm text-white ' +
                (printing ? 'bg-amber-300 cursor-not-allowed' : 'bg-amber-600 hover:bg-amber-700 cursor-pointer')
              }
            >
              {printing ? 'Yazdırılıyor...' : printedHere ? 'Fişi Tekrar Yazdır' : 'Fiş Yazdır'}
            </button>
          )}

          {tasks.length > 0 && onOpenSahayaAktar && (
            <button
              onClick={() => onOpenSahayaAktar(record, focusItemId)}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
            >
              Sahaya Aktar
            </button>
          )}
        </>
      }
    >
      <div className="space-y-5">
        {/* Müşteri/Bölge kasıtlı olarak burada YOK: bir kayıtta farklı kalemler farklı son
            müşteriye ve adrese gidebiliyor (bkz. "bir fatura = bir montaj kaydı" kuralı) — tek
            değer gösterip yanıltmak yerine müşteri bilgisi zaten aşağıda kalem bazında duruyor. */}
        <div className="rounded-xl bg-gray-50 border border-gray-150 px-4 py-3 text-xs text-gray-600 flex flex-wrap gap-x-6 gap-y-1">
          <span><span className="font-bold text-gray-800">Bayi:</span> {record.dealerName || '-'}</span>
          {record.regionName && (
            <span><span className="font-bold text-gray-800">Bölge:</span> <span className="font-bold text-red-700">{record.regionName}</span></span>
          )}
          <span>
            <span className="font-bold text-gray-800">Adet:</span>{' '}
            {totals.planned}/{totals.quantity} planlandı
            {totals.pendingTotal > 0 && <span className="text-blue-700 font-bold"> · {totals.pendingTotal} listede bekliyor</span>}
            {totals.remaining > 0 && <span className="text-amber-700 font-bold"> · {totals.remaining} kaldı</span>}
          </span>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs font-semibold text-red-600">{error}</div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" /> Yükleniyor...
          </div>
        ) : (
          <>
            {/* 1) Planlanacak kalemler — kalem başına TEK satır, adet bir sayı alanı */}
            <div className="space-y-2">
              <div className="text-xs font-bold text-gray-700 uppercase tracking-wider">Planlanacak Kalemler</div>
              {openItems.length === 0 ? (
                <div className="text-sm text-gray-400 py-6 text-center bg-gray-50 rounded-xl border border-dashed border-gray-200">
                  Planlanacak adet kalmadı — hepsi listeye eklendi veya zaten planlandı.
                </div>
              ) : (
                <div className="space-y-2">
                  {openItems.map((item) => {
                    const qty = qtyOf(item.id, item.selectable)
                    // Bölge KAYIT seviyesinde: kalemin kendi bölgesi yok (`item.regionName`
                    // hiçbir zaman var olmadı, ifade hep kaydınkine düşüyordu).
                    const itemRegion = record.regionName || ''
                    return (
                      <div
                        key={item.id}
                        className={`rounded-xl border bg-white px-3 py-2.5 flex flex-wrap items-center justify-between gap-3 ${qty > 0 ? 'border-[#B91C1C]/30 bg-red-50/20' : 'border-gray-150'}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-gray-800 truncate" title={item.productName}>{item.productName}</div>
                          <div className="text-[10px] text-gray-500 flex flex-wrap items-center gap-x-2">
                            {itemRegion && (
                              <span className="inline-flex items-center gap-0.5 font-bold text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide shrink-0">{itemRegion}</span>
                            )}
                            <span>{item.customerName || '-'}</span>
                            {item.customerPhone && (
                              <span className="inline-flex items-center gap-0.5"><Phone className="w-2.5 h-2.5" />{item.customerPhone}</span>
                            )}
                            <span className="truncate max-w-[220px]" title={item.customerAddress}>{item.customerAddress || '-'}</span>
                          </div>
                          <div className="text-[10px] text-gray-400 mt-0.5">
                            Kabulde {item.quantity} adet · {item.planned} planlandı · {item.selectable} planlanabilir
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <label className="text-[10px] font-bold text-gray-500 uppercase">Planlanacak</label>
                          <input
                            type="number"
                            min={0}
                            max={item.selectable}
                            value={qty}
                            onChange={(e) => setQty(item.id, Number(e.target.value.replace(/\D/g, '')) || 0, item.selectable)}
                            className="w-20 px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-sm font-bold text-center"
                          />
                          <span className="text-[11px] text-gray-500">/ {item.selectable}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* 2) Seçilenleri ata — büyük adetler birden çok kişiye bölünebilir */}
            <div className="space-y-2">
              <div className="text-xs font-bold text-gray-700 uppercase tracking-wider">Seçilenleri Ata</div>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Sol Taraf: Atama Formu */}
                <div className="lg:col-span-2 rounded-xl border border-gray-150 bg-white p-4 space-y-3">
                  <div className="text-xs font-semibold text-gray-600">
                    Bu atamada: <span className="text-[#B91C1C] font-bold">{selectedTotal} adet</span>
                    <span className="text-gray-400 font-normal"> · adedi bölmek için sayıyı düşürüp kalanı ikinci kişiye ekleyin</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="space-y-1 lg:col-span-2">
                      <label className="text-[10px] font-bold text-gray-500 uppercase">Saha Personeli / Klima Ekibi</label>
                      {technicianSelect(selTechId, setSelTechId, 'px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full')}
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-500 uppercase">Tarih</label>
                      {/* Geçmiş güne montaj planlanamaz: ne alanda ne sunucuda sınır vardı,
                          dünkü güne planlanan iş hiçbir listede "bugünün işi" olarak çıkmıyordu. */}
                      <input
                        type="date"
                        min={todayIso()}
                        value={selDate}
                        onChange={(e) => setSelDate(e.target.value)}
                        className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full"
                      />
                      {selDate && selDate < todayIso() && (
                        <div className="text-[10px] font-bold text-amber-700">Geçmiş bir tarih seçili.</div>
                      )}
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-500 uppercase">Montaj Adresi</label>
                      <input
                        value={selAddress}
                        onChange={(e) => setSelAddress(toTurkishUpper(e.target.value))}
                        placeholder="Adres..."
                        className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full"
                      />
                    </div>
                    <div className="space-y-1 lg:col-span-4">
                      <label className="text-[10px] font-bold text-gray-500 uppercase">Not</label>
                      <input
                        value={selNote}
                        onChange={(e) => setSelNote(toTurkishUpper(e.target.value))}
                        placeholder="Bu seçime ait not..."
                        className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full"
                      />
                    </div>
                  </div>

                  {formError && (
                    <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs font-semibold text-red-600">{formError}</div>
                  )}

                  <button
                    type="button"
                    disabled={selectedTotal === 0}
                    onClick={assignSelected}
                    className={
                      'w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold transition ' +
                      (selectedTotal === 0
                        ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        : 'bg-gray-900 text-white hover:bg-gray-800')
                    }
                  >
                    <CheckSquare className="w-4 h-4" />
                    Listeye Ekle ({selectedTotal} adet)
                  </button>
                </div>

                {/* Sağ Taraf: Teknisyenin Bugünkü İşleri */}
                <div className="lg:col-span-1 rounded-xl border border-gray-150 bg-white p-4 space-y-3 flex flex-col justify-between">
                  <div className="space-y-3">
                    <h3 className="font-extrabold text-slate-800 text-[10px] uppercase tracking-wider border-b border-gray-100 pb-2 flex items-center justify-between">
                      {/* Başlık "Bugünkü" diyordu ama liste SEÇİLEN GÜNÜ gösteriyor. */}
                      <span>Seçilen Gündeki İşleri</span>
                      <span className="text-[10px] text-gray-500 font-normal">
                        {selDate ? new Date(selDate).toLocaleDateString('tr-TR') : 'Bugün'}
                        {selTechId && workloads[selTechId] ? ` · ${workloads[selTechId].count} adet` : ''}
                      </span>
                    </h3>

                    {workloadsLoading ? (
                      <div className="text-center py-6 text-slate-400 text-xs">Yükleniyor...</div>
                    ) : !selTechId ? (
                      <div className="text-center py-6 text-slate-400 text-xs">Lütfen bir teknisyen seçin.</div>
                    ) : !workloads[selTechId] || workloads[selTechId].records.length === 0 ? (
                      <div className="text-center py-6 text-slate-400 text-xs">Planlanmış görevi bulunmuyor.</div>
                    ) : (
                      <div className="space-y-2 overflow-y-auto max-h-[160px] pr-1">
                        {workloads[selTechId].records.map((row: any) => (
                          <div key={row.id} className="border border-slate-100 bg-slate-50/50 rounded-xl p-2.5 space-y-1 shadow-3xs text-[11px]">
                            <div className="flex items-center justify-between">
                              <span className="font-mono font-black text-[#B91C1C] text-[9px]">{row.serviceNumber}</span>
                              <span className="text-[8px] px-1.5 py-0.5 rounded-full font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                {row.statusLabel || row.status}
                              </span>
                            </div>
                            <div className="font-bold text-slate-800">{row.customerName || 'Müşteri'}</div>
                            {row.productName && (
                              <div className="text-slate-600 text-[10px]">
                                Cihaz: {row.productName}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

              {/* Dağıtım taslağı — henüz kaydedilmedi */}
              {pending.length > 0 && (
                <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-3">
                  <div className="text-xs font-bold text-blue-800 uppercase tracking-wider flex items-center justify-between">
                    <span>Dağıtım Listesi ({pending.reduce((s, p) => s + p.quantity, 0)} adet, {pending.length} satır)</span>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-blue-150 bg-white">
                    <table className="w-full text-xs">
                      <thead className="bg-blue-50 text-left text-[10px] uppercase tracking-wider text-blue-700 font-bold border-b border-blue-100">
                        <tr>
                          <th className="px-3 py-2">Kalem</th>
                          <th className="px-3 py-2">Personel / Ekip</th>
                          <th className="px-3 py-2 text-center">Adet</th>
                          <th className="px-3 py-2">Tarih</th>
                          <th className="px-3 py-2">Adres</th>
                          <th className="px-3 py-2 text-right">Sil</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {pending.map((p) => {
                          const tech = technicianById.get(p.technicianId)
                          return (
                            <tr key={p.key}>
                              <td className="px-3 py-2 text-gray-700 max-w-[160px] truncate" title={p.itemProductName}>{p.itemProductName}</td>
                              <td className="px-3 py-2">
                                <div className="font-semibold text-gray-900">{tech?.fullName ?? '-'}</div>
                                <div className="text-[10px] text-gray-400">{teamLabelOf(tech?.roles)}</div>
                              </td>
                              <td className="px-3 py-2 text-center font-bold text-gray-700">{p.quantity}</td>
                              <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{p.plannedDate ? new Date(p.plannedDate).toLocaleDateString('tr-TR') : '-'}</td>
                              <td className="px-3 py-2 text-gray-500 max-w-[180px] truncate" title={p.address}>{p.address || '-'}</td>
                              <td className="px-3 py-2 text-right">
                                <button type="button" onClick={() => removePending(p.key)} className="p-1 text-red-500 hover:bg-red-50 rounded" title="Listeden kaldır">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  {submitError && (
                    <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs font-semibold text-red-600">{submitError}</div>
                  )}

                  <button
                    type="button"
                    disabled={submitting}
                    onClick={submitPending}
                    className={
                      'w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold transition ' +
                      (submitting ? 'bg-gray-300 text-gray-600' : 'bg-[#B91C1C] text-white hover:bg-[#991B1B]')
                    }
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    {submitting ? 'Planlanıyor...' : `Planla ve Kaydet (${pending.length} satır)`}
                  </button>
                </div>
              )}

              {submitSuccess && (
                <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-xs font-semibold text-green-700 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" /> {submitSuccess}
                </div>
              )}

            {/* 3) Kime ne atandı — sade özet, kişi bazında toplu geri alma */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" /> Kime Ne Atandı
                </div>
                <div className="text-[11px] text-gray-500">Geri al, adet tekrar yukarıda planlanabilir hale gelir.</div>
              </div>

              {groupError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs font-semibold text-red-600">{groupError}</div>
              )}

              {transferredCount > 0 && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-[11px] font-semibold text-emerald-800">
                  {transferredCount} satır sahaya aktarıldı ve burada listelenmez. Geri almak için
                  Teslimattakiler sekmesindeki “Planlamaya Geri Gönder”i kullanın.
                </div>
              )}

              {technicianGroups.length === 0 ? (
                <div className="text-sm text-gray-400 py-6 text-center bg-gray-50 rounded-xl border border-dashed border-gray-200">
                  Henüz planlama satırı yok.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {technicianGroups.map((group) => {
                    const groupKey = group.technicianId || '__unassigned__'
                    const busy = groupBusyKey === groupKey
                    const expanded = expandedGroupKeys.includes(groupKey)
                    return (
                      <div key={groupKey} className="rounded-xl border border-gray-150 bg-white overflow-hidden">
                        {/* Kart içine <button> sarmıyoruz — iç içe button geçersiz HTML ve
                            tıklamayı yutar (bkz. DEVIR.md §6). Satır div, "Geri Al" tek button. */}
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => toggleGroupExpanded(groupKey)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleGroupExpanded(groupKey) }}
                          className="w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors text-left cursor-pointer"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {expanded ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />}
                            <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-[10px] font-bold text-blue-700 flex-shrink-0">
                              {group.technicianName.split(' ').filter(Boolean).slice(0, 2).map((n) => n[0]).join('')}
                            </div>
                            <div className="min-w-0">
                              <div className={'text-sm font-bold truncate ' + (group.technicianId ? 'text-gray-900' : 'text-amber-700')}>
                                {group.technicianName}
                              </div>
                              <div className="text-[10px] text-gray-400 truncate">
                                {group.technicianId ? TEAM_LABELS[group.team] : 'Atanacak kişi seçilmedi'} · {group.itemNames.length} kalem çeşidi
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-sm font-bold text-gray-700 bg-gray-100 rounded-full px-3 py-1">
                              {group.totalQuantity} adet
                            </span>

                            <button
                              type="button"
                              disabled={busy}
                              onClick={(e) => { e.stopPropagation(); setGroupError(null); setUnplanTarget(group) }}
                              className="p-1.5 text-orange-600 hover:bg-orange-50 rounded-lg transition-colors disabled:opacity-40"
                              title="Bu kişiye planlanan tüm adetleri geri al"
                            >
                              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>

                        {expanded && (
                          <div className="border-t border-gray-100 divide-y divide-gray-50">
                            {itemBreakdown(group.rows).map(([itemName, qty]) => (
                              <div key={itemName} className="flex items-center justify-between gap-3 px-4 py-2 text-xs">
                                <span className="text-gray-700 truncate" title={itemName}>{itemName}</span>
                                <span className="flex-shrink-0 font-bold text-gray-600 bg-gray-50 rounded-full px-2.5 py-0.5">{qty} adet</span>
                              </div>
                            ))}
                          </div>
                        )}


                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Geri alma onayı: window.confirm tarayıcıyı kilitliyor, mobilde tasarımın dışına
                düşüyor ve iptal edilen adet sayısını gösteremiyordu. */}
            {unplanTarget && (
              <div className="rounded-xl border border-orange-200 bg-orange-50/60 px-4 py-3 space-y-3">
                <div className="flex items-start gap-2 text-xs font-semibold text-orange-900">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>
                    <strong>{unplanTarget.technicianName}</strong> için planlanan{' '}
                    <strong>{unplanTarget.totalQuantity} adet</strong> geri alınacak. Adetler tekrar
                    "Planlanacak Kalemler" listesine döner, kimseye atanmamış olur.
                  </span>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={!!groupBusyKey}
                    onClick={() => setUnplanTarget(null)}
                    className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="button"
                    disabled={!!groupBusyKey}
                    onClick={() => unplanGroup(unplanTarget)}
                    className={
                      'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white ' +
                      (groupBusyKey ? 'bg-gray-300' : 'bg-orange-600 hover:bg-orange-700')
                    }
                  >
                    {groupBusyKey ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                    Evet, geri al
                  </button>
                </div>
              </div>
            )}

            <div className="rounded-xl bg-purple-50 border border-purple-150 px-4 py-3 text-[11px] text-purple-800 leading-relaxed">
              Sıradaki adım: aşağıdaki <strong>Fiş Yazdır</strong> ile fişi basın, ardından
              <strong> Sahaya Aktar</strong> ile satırları sahaya gönderin. Fiş basılmadan aktarım yapılamaz.
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
