import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Download,
  MoreHorizontal,
  X,
  ChevronLeft,
  Trash2,
  ChevronRight,
  Send,
  RotateCcw,
  ClipboardList,
  Copy,
  XCircle
} from 'lucide-react'

import { apiJson } from '../api/client'
import { runStatusChange, statusLabel } from '../api/statusChangeGate'
import { useCardView } from '../hooks/useCardView'
import { useServiceRecordsPaged } from '../hooks/useServiceRecords'
import { useTechnicians } from '../hooks/useTechnicians'
import { deleteInstallationTaskPhoto, uploadInstallationTaskPhoto } from '../api/serviceRecords'
import { fetchServiceProductDetailByName, type ServiceProductDetailDto } from '../api/serviceProducts'
import Table, { type TableColumn } from '../components/Table'
import ActionDropdown from '../components/ActionDropdown'
import { TableActionButton } from '../components/TableActionButton'
import { toTurkishUpper } from '../utils/formInput'
import {
  buildMontajPlanRows,
  isFieldRow,
  isFieldTask,
  isPlanningRow,
  isPickupFromDealer,
  isPlanningTask,
  PICKUP_FROM_DEALER,
  statusNameOf,
  STATE_COLORS,
  STATE_LABELS,
  type MontajPlanRow,
} from '../utils/montajPlanRows'
import MontajIptalModal from '../components/MontajIptalModal'
import ServisFisiModal, { slipTasks, groupTasks, ensureWorkOrders } from '../components/ServisFisiModal'
import ServisGecmisiModal from '../components/ServisGecmisiModal'
import { printServiceSlip } from '../print/serviceSlip'
import GunSecici, { bugunIso } from '../components/GunSecici'
import FaturaPlanlamaModal from '../components/FaturaPlanlamaModal'
import SahayaAktarModal from '../components/SahayaAktarModal'
import { API_BASE_URL } from '../config'
import { getAccessToken } from '../auth/storage'
import { usePermissions, useCanViewHistory } from '../auth/PermissionsContext'
import PhoneLinks from '../components/PhoneLinks'
import GorselOnizleyici from '../components/GorselOnizleyici'
import BayiHucresi from '../components/BayiHucresi'

/**
 * Görev durumu → etiket/renk. Etiketler `montajPlanRows`'daki TEK kaynaktan türetiliyor:
 * burada elle yazılınca `Deferred` listede "Yeni Kayıt", aşağıdaki açılır listede "Ertelendi"
 * görünüyordu — kullanıcı seçtiği şeyi tabloda başka adla buluyordu.
 */
const STATUS_ORDER = ['Planned', 'InProgress', 'Completed', 'Delivered', 'Postponed', 'Cancelled', 'Deferred', 'Unreachable'] as const

const TASK_STATUS_VALUES: Record<string, number> = {
  Planned: 0,
  InProgress: 1,
  Completed: 2,
  Cancelled: 3,
  Deferred: 4,
  Unreachable: 5,
  Delivered: 6,
  Postponed: 7,
}

const taskStatusConfig: Record<string | number, { label: string; color: string; value: string }> =
  STATUS_ORDER.reduce((acc, value) => {
    const entry = {
      label: STATE_LABELS[value] ?? value,
      // Rozet dolgusu; STATE_COLORS kenarlık da taşıdığı için burada sadece dolgu/metin alınıyor.
      color: (STATE_COLORS[value] ?? 'bg-gray-100 text-gray-700')
        .split(' ')
        .filter((c) => !c.startsWith('border'))
        .join(' '),
      value,
    }
    const enumVal = TASK_STATUS_VALUES[value]
    if (enumVal !== undefined) {
      acc[enumVal] = entry
    }
    acc[value] = entry
    return acc
  }, {} as Record<string | number, { label: string; color: string; value: string }>)

/**
 * Kalem İşlemi modalındaki durum listesi.
 *
 * "Ulaşılamadı" bu listenin en önemli eklentisi: teknisyen gidip müşteriyi bulamadığında
 * eskiden karşılığı YOKTU. İki kötü seçenekten birine zorlanıyordu — İptal (iş gerçekten iptal
 * olmadığı hâlde fatura kalemi ölüyor) ya da "Yeni Kayıt" (teknisyeni, tarihi ve aktarım
 * damgasını silip işi sessizce planlamaya düşürüyor, "neden" sadece nota kalıyor).
 */
const taskStatusOptions = [
  { value: 'Planned', label: STATE_LABELS.Planned },
  { value: 'Completed', label: STATE_LABELS.Completed },
  { value: 'Delivered', label: 'Teslim Edildi (Planlama Bekliyor)' },
  { value: 'Unreachable', label: `${STATE_LABELS.Unreachable} (gidildi, yapılamadı)` },
  { value: 'Postponed', label: 'Ertelendi (planlamaya ertelendi düşer)' },
  { value: 'Deferred', label: 'Yeni Kayıt (planlamaya sıfır düşer)' },
  { value: 'Cancelled', label: STATE_LABELS.Cancelled },
]

/** Sunucu bu iki durumda sebep zorunlu tutuyor; buton önden kilitlensin diye burada da var. */
const REASON_REQUIRED_STATUSES = new Set(['Cancelled', 'Unreachable'])

/**
 * Kalem satırının durum rozeti. Durum türetme kuralı (hepsi aynıysa o durum, karışıksa
 * "İşlemde") sunucudakiyle tek kaynaktan geliyor — bkz. `utils/montajPlanRows`.
 */
const stateBadgeClass = (state: string) =>
  STATE_COLORS[state] ?? 'bg-gray-100 text-gray-700 border-gray-200'

export default function MontajYonetimiPage() {
  const [activeTab, setActiveTab] = useState<'bekleyen' | 'aktif'>('bekleyen')
  /** Varsayılan sekmenin yetkiye göre düzeltilmesi bir kez yapılır; sonra kullanıcının seçimi. */
  const [defaultTabResolved, setDefaultTabResolved] = useState(false)
  /**
   * Sub-tab visibility now comes from the shared permission context.
   *
   * This page used to work it out on its own, and every branch of that logic failed open: no
   * token, an unparseable token, a role claim it did not recognise, an empty key list, or the
   * answer simply not having arrived yet all resolved to "allow". A user with no permissions
   * at all therefore saw every tab, which is why sub-page permissions looked like they had
   * never been implemented. Denials now stand.
   */
  const { can, loaded: permissionsLoaded } = usePermissions()
  const canViewHistory = useCanViewHistory()


  // The route guard already waits for permissions before rendering this page, so `loaded` is
  // true here; it is still required rather than assumed, so an unguarded mount cannot leak.
  const hasPermission = (key: string) => permissionsLoaded && can(key)

  /**
   * Yalnızca "Teslimattakiler" yetkisi olan kullanıcı, varsayılan "Planlama" sekmesinde
   * kapsamı boş bir listeye düşüp "Kayıt bulunamadı" görüyordu. Açılış, kullanıcının
   * gerçekten görebildiği ilk sekme olsun.
   */
  useEffect(() => {
    if (!permissionsLoaded || defaultTabResolved) return
    setDefaultTabResolved(true)
    if (!can('montajYonetimi.planlama') && can('montajYonetimi.teslimat')) {
      setActiveTab('aktif')
    }
  }, [permissionsLoaded, defaultTabResolved, can])

  const navigate = useNavigate()
  const location = useLocation()
  const { technicians } = useTechnicians()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 200
  // Bidirectional Tab Sync with Header Shell
  useEffect(() => {
    (window as any).__montajActiveTab = activeTab
    window.dispatchEvent(new CustomEvent('montaj-yonetimi:tab-updated'))
  }, [activeTab])

  useEffect(() => {
    const handleTabChange = (e: Event) => {
      const tab = (e as CustomEvent).detail
      setActiveTab(tab)
      setPage(1)
    }
    window.addEventListener('shell:montaj-yonetimi-tab-change', handleTabChange)
    return () => window.removeEventListener('shell:montaj-yonetimi-tab-change', handleTabChange)
  }, [])

  /**
   * Tablodaki kolon süzgeçlerinden GEÇEN satırlar.
   *
   * Bu değer hep boş kalıyordu: `Table` `onFilteredDataChange` prop'unu alıyor ama
   * `AppDataTable`'a hiç geçirmiyordu. Dolayısıyla "Dışa Aktar" da `planRows`'u (listenin
   * tamamını) yazıyordu — kullanıcı süzüp dışa aktarınca filtresiz dosya iniyordu.
   */
  const [filteredRows, setFilteredRows] = useState<MontajPlanRow[]>([])

  // "Planlamaya Geri Gönder" — native window.confirm yerine uygulama içi onay modalı
  const [geriGonderTarget, setGeriGonderTarget] = useState<any | null>(null)
  const [geriGonderLoading, setGeriGonderLoading] = useState(false)
  const [geriGonderError, setGeriGonderError] = useState<string | null>(null)
  /** "Gerçekleşmiş satırları da geri al" — ayrı ve bilinçli bir onay (hak edişi de iptale çeker). */
  const [geriGonderCompleted, setGeriGonderCompleted] = useState(false)

  // İKİ SEKME DE AYNI KAYIT KÜMESİNİ ÇEKER; ayrımı kalem satırı yapar (bkz. isPlanningRow /
  // isFieldRow). Sebep: aktarım artık kaydı MNT-xxxxxxx-N diye bölmüyor, dolayısıyla kısmen
  // sahaya çıkmış bir kayıt hem "planlanacak" hem "sahada" satır taşıyabiliyor. Sekmeler kayıt
  // durumuna göre süzülseydi, bir kalemi aktarılan kayıt planlama sekmesinden tümüyle düşer ve
  // kalan kalemler planlanamaz hale gelirdi.
  //
  // "Ready" (hepsi gerçekleşti) kasıtlı olarak YOK: o kayıtlar Montaj Kabul'de
  // "Tamamlananları Göster" ile görünür.
  /*
    PASİFE ALINANLAR (2026-09-18 kullanıcı isteği): 90 günden eski kayıtlar varsayılan
    listede yok. Üst çubuktaki kutu `window` olayıyla haber veriyor; kabul ve arıza
    ekranlarıyla AYNI bayrak.
  */
  const [showPassive, setShowPassive] = useState(() => {
    return (window as any).__showPassive !== undefined ? !!(window as any).__showPassive : false
  })

  useEffect(() => {
    const onPassiveChanged = (e: any) => { setShowPassive(!!e.detail); setPage(1) }
    window.addEventListener('shell:show-passive-changed', onPassiveChanged)
    return () => window.removeEventListener('shell:show-passive-changed', onPassiveChanged)
  }, [])

  const { result, isLoading, error, refetch, markAsPrinted } = useServiceRecordsPaged({
    includePassive: showPassive,
    q: q || undefined,
    statuses: 'New,Planned,Workshop,InRepair,WaitingForParts,Delivered,Delayed',
    type: 'Installation',
    // Kapsam SEKMEYE göre istenir. Sunucunun kabul ettiği anahtarlar alt sekmelerdir
    // (montajYonetimi.planlama / .teslimat); çıplak 'montajYonetimi' geçerli bir kapsam anahtarı
    // değildir ve gönderilirse sessizce yok sayılıp montaj kökine düşülür.
    // Anahtar hiç gönderilmediğinde de aynı şey olurdu: bu ekran, Montaj Kabul'ün yetkisiyle
    // süzülürdü — sekme yetkileri ayrı verilebildiği için yanlış.
    scopeKey: activeTab === 'bekleyen' ? 'montajYonetimi.planlama' : 'montajYonetimi.teslimat',
    page,
    pageSize,
  })

  /**
   * "Yeni montaj" bu ekranın işi DEĞİL.
   *
   * Burada bir "Yeni Montaj" modalı vardı ve kaydı eski yoldan açıyordu: miktarı
   * `problemDescription` içine "Miktar: N" diye metin olarak yazıyor, hiç KALEM
   * (`ServiceRecordItem`) üretmiyordu. Kalem eksenine geçtikten sonra bu, planlanamayan
   * bozuk kayıtlar demek. Üstelik modalı açan bir düğme de yoktu (`/montaj-yonetimi/yeni`
   * rotası App.tsx'te zaten MontajKabulPage'e gidiyor), yalnızca `?create=1` ile
   * ulaşılabiliyordu.
   *
   * Modal kaldırıldı; eski adres doğru ekrana yönlendiriliyor.
   */
  useEffect(() => {
    const sp = new URLSearchParams(location.search)
    const shouldOpen = location.pathname.includes('/montaj-yonetimi/yeni') || sp.get('create') === '1'
    if (!shouldOpen) return
    navigate('/montaj-kabul/yeni', { replace: true })
  }, [location.pathname, location.search, navigate])


  const records = result.items

  /*
   * Bölge listesi ile ERP ürün/bayi listeleri buradan kaldırıldı.
   *
   * Üçü de YALNIZCA kaldırılan "Yeni Montaj" modalının açılır listelerini dolduruyordu, ama
   * modal açılsın açılmasın sayfa her yüklendiğinde çekiliyorlardı: ERP ürün listesi büyük bir
   * yanıt ve montaj planlaması bu verinin hiçbirine bakmıyor. Planlama ekranı artık yalnızca
   * kendi listesini ve teknisyenleri istiyor.
   */

  // Açılan satırın kimliği KALEM satırının kimliği (`kayıtId::kalemId`); görev ucu ise kayıt
  // kimliği istiyor. İkisi karışırsa istek 400'e düşer, o yüzden ayrı tutuluyorlar.
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null)
  const [expandedTasks, setExpandedTasks] = useState<any[]>([])
  const [expandedLoading, setExpandedLoading] = useState(false)
  const [taskActionId, setTaskActionId] = useState<string | null>(null)

  const fetchInstallationTasks = async (serviceId: string) => {
    const data = await apiJson<any[]>(`/api/installations/tasks?serviceId=${serviceId}`)
    return Array.isArray(data) ? data : []
  }

  const loadExpandedTasks = async (id: string) => {
    setExpandedLoading(true)
    try {
      setExpandedTasks(await fetchInstallationTasks(id))
    } catch {
      setExpandedTasks([])
    } finally {
      setExpandedLoading(false)
    }
  }

  /**
   * Onay ekranının başlığı: kullanıcının hangi satıra bastığını tanıyabilmesi için ürün +
   * müşteri. Alan adları hem camelCase hem PascalCase gelebiliyor (uçlar karışık dönüyor).
   */
  const describeTaskSubject = (task: any): string => {
    const product = task?.itemProductName ?? task?.ItemProductName ?? task?.productName ?? ''
    const customer = task?.itemCustomerName ?? task?.ItemCustomerName ?? ''
    return [product, customer].filter(Boolean).join(' · ') || 'Montaj kalemi'
  }

  /** `PhotoUrl` virgülle ayrılmış çoklu yol tutuyor; sayı oradan çıkar. */
  const countTaskPhotos = (task: any): number => {
    const raw = String(task?.photoUrl ?? task?.PhotoUrl ?? '').trim()
    if (!raw) return 0
    return raw.split(',').map((x) => x.trim()).filter(Boolean).length
  }

  /**
   * İŞLEM TARİHİ (2026-09-17 kullanıcı isteği: "tarih seçilebilecek şekilde, geçmişe dönük eksik
   * girilen veriler toparlanabilecek").
   *
   * Bugün seçiliyse sunucuya HİÇ gönderilmez; sunucu eskisi gibi şu anı yazar ve saat bilgisi
   * korunur. Geçmiş bir gün seçildiyse o günün yerel ÖĞLEN saati gider: gece yarısı gönderilse
   * UTC'ye çevrilince önceki güne kayardı (firma saati UTC+3).
   */
  const effectiveDateIso = (day?: string): string | undefined => {
    if (!day || day >= bugunIso()) return undefined
    const [y, m, d] = day.split('-').map(Number)
    if (!y || !m || !d) return undefined
    return new Date(y, m - 1, d, 12, 0, 0).toISOString()
  }

  const changeTaskStatus = async (task: any, nextStatus: string, reason?: string, customAddress?: string, actionDay?: string) => {
    const taskId = String(task.id ?? task.Id ?? '')
    if (!taskId) return
    setTaskActionId(taskId)
    setActionError(null)
    setActionSuccess(null)
    try {
      const idsToUpdate = Array.isArray(task.taskIds) ? task.taskIds : [taskId]

      // TOPLU GÜNCELLEMEDE ONAY BİR KEZ SORULUR.
      //
      // Bir kalem birden çok adet satırı taşıyabiliyor (`task.taskIds`) ve her satır ayrı bir
      // PATCH. Kapı isteğin içinde olduğu için sarmalanmasaydı kullanıcı 12 adetlik bir kalemde
      // 12 ayrı onay ekranı görürdü. Sarmalayıcı bir kez sorar, içerideki istekleri muaf tutar.
      const photoCount = countTaskPhotos(task)
      const effectiveDate = effectiveDateIso(actionDay)
      const detailRows = [
        ...(customAddress ? [{ label: 'Adres', value: customAddress }] : []),
        ...(effectiveDate
          ? [{ label: 'İşlem Tarihi', value: new Date(effectiveDate).toLocaleDateString('tr-TR') }]
          : []),
      ]
      const result = await runStatusChange(
        {
          kind: idsToUpdate.length > 1 ? `Montaj Kalemi (${idsToUpdate.length} adet)` : 'Montaj Kalemi',
          subject: describeTaskSubject(task),
          fromLabel: STATE_LABELS[statusNameOf(task)] ?? statusNameOf(task),
          toLabel: STATE_LABELS[nextStatus] ?? statusLabel(nextStatus),
          hasPhoto: photoCount > 0,
          photoCount,
          hasNote: Boolean(reason && reason.trim()),
          note: reason ?? null,
          details: detailRows.length > 0 ? detailRows : undefined
        },
        () =>
          Promise.all(
            idsToUpdate.map((tid: string) =>
              apiJson(`/api/installations/tasks/${tid}/status`, {
                method: 'PATCH',
                // `reason` HER ZAMAN gönderilir (boş bile olsa): sunucu artık alanı yalnızca
                // gönderildiyse yazıyor, çünkü göndermemek "notu sil" anlamına geliyordu ve
                // planlamada girilen açıklama sessizce kayboluyordu (§8.1).
                body: JSON.stringify({ status: nextStatus, reason: reason ?? '', customAddress: customAddress || undefined, effectiveDate })
              })
            )
          )
      )

      // null = kullanıcı onay ekranında İptal'e bastı. Hata değil: ekranda hiçbir şey
      // değişmemeli, uyarı da çıkmamalı.
      if (result === null) return
      const patchTask = (t: any) => {
        const id = String(t.id ?? t.Id ?? '')
        return idsToUpdate.includes(id) ? { 
          ...t, 
          status: nextStatus, 
          Status: nextStatus, 
          statusLabel: nextStatus, 
          StatusLabel: nextStatus, 
          notes: reason ?? '',
          Notes: reason ?? '',
          customAddress: customAddress ?? '',
          CustomAddress: customAddress ?? ''
        } : t
      }
      setExpandedTasks((items) => items.map(patchTask))
      setSelectedTaskForDetail((current: any) => current ? patchTask(current) : current)
      setActionSuccess('Kalem durumu güncellendi.')

      // DURUM YAZILDIKTAN SONRA ÇEKMECE KAPANIR.
      //
      // Açık kalınca kullanıcı işin geçtiğini göremiyor ("bir şey olmadı" sanıyor) ve aynı
      // düğmeye tekrar basıyordu; aynı kalem ikinci kez işleniyor, gerçekleşen iş mükerrer
      // hak ediş üretiyordu. Kapanma, işlemin bittiğinin görünür karşılığı.
      setDrawerOpen(false)
      setSelectedTaskForDetail(null)
      setSelectedRecordForDetail(null)

      // Kaydın genel Durumu (derivedState) ve — hepsi gerçekleşince — Teslimattakiler'den
      // düşüp düşmeyeceği ana listeden geliyor; burada yalnızca yerel taslak güncellenmişti,
      // liste tazelenmezse kayıt "İşlemde" gösterip yerinde kalmaya devam ediyordu.
      await refetch()
    } catch (e: any) {
      setActionError(String(e?.message ?? 'Kalem durumu güncellenemedi'))
    } finally {
      setTaskActionId(null)
    }
  }

  /**
   * Açılan satır artık bir KAYIT değil bir KALEM. Görevler kayıt bazında geliyor (uç serviceId
   * alıyor), o yüzden istek kaydın kimliğiyle atılıp yanıt kaleme göre süzülüyor — açılan
   * kalemin altında başka kalemin planlama satırları görünmemeli.
   */
  const toggleExpand = async (row: MontajPlanRow, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    if (expandedRow === row.id) {
      setExpandedRow(null)
      setExpandedRecordId(null)
      return
    }
    setExpandedRow(row.id)
    setExpandedRecordId(row.recordId)
    await loadExpandedTasks(row.recordId)
  }

  /**
   * İşlem menüsündeki "İşlem Yap": satırı AÇAR (kapatmaz). `toggleExpand` kolon tanımının içinden
   * çağrılsaydı `expandedRow`'un eski değerini görürdü — kolonlar ayrı memo'da kuruluyor.
   */
  const expandRowForAction = async (row: MontajPlanRow) => {
    setExpandedRow(row.id)
    setExpandedRecordId(row.recordId)
    await loadExpandedTasks(row.recordId)
  }

  /** Modal sonrası tazeleme: açık satırın görevleri KAYIT kimliğiyle yeniden çekilir. */
  const reloadExpanded = async () => {
    if (expandedRecordId) await loadExpandedTasks(expandedRecordId)
  }

  /**
   * Sekme değişince açık satır KAPANIR.
   *
   * `expandedTasks` sayfa seviyesinde tek bir state ve sekme değişiminde temizlenmiyordu:
   * planlama yapıp Teslimattakiler'e geçen kullanıcı, aynı satırın AKTARIMDAN ÖNCE çekilmiş
   * görev listesini görüyor, üzerinde işlem yapmaya çalışıyordu. "Yenileyince düzeliyor"
   * denen davranış buydu (§8.7).
   */
  useEffect(() => {
    setExpandedRow(null)
    setExpandedRecordId(null)
    setExpandedTasks([])
  }, [activeTab])

  /**
   * Açılır tablodaki ADET satırları — sekmeye göre süzülür.
   *
   * Kalem satırı iki sekmede birden görünebiliyor (3 adedin 2'si sahada, 1'i planlanacak) ve bu
   * doğru; ama altındaki satırların hepsini iki sekmede de basmak kullanıcının bildirdiği
   * karışıklığı yaratıyordu: sahaya aktarılan satır planlamada durmaya devam ediyor, gerçekleşen
   * satır her ikisinde de görünüyordu (§8.2 / §8.6). Kural `montajPlanRows`ta tek kaynakta.
   */
  const tasksOfRow = (row: MontajPlanRow) => {
    const ofItem = row.itemId
      ? expandedTasks.filter(
          (t: any) => String(t.serviceRecordItemId ?? t.ServiceRecordItemId ?? '') === row.itemId
        )
      : expandedTasks
    return ofItem.filter(activeTab === 'bekleyen' ? isPlanningTask : isFieldTask)
  }

  const installationRecords = useMemo(() => {
    return records
  }, [records])

  /**
   * Listenin satırları: her kalem bir satır. Adet satıra bölünmez, "3 adet" olarak durur.
   * Sekme, satırın ne beklediğine göre süzer — kaydın durumuna göre değil.
   */
  /**
   * MOBİL: Teslimattakiler iki bölüme ayrılır — "Bayiden Alınacaklar" ve "Faturalı".
   *
   * Kullanıcı kararı (2026-08-13): ayrım YALNIZCA kart/mobil görünümde. Masaüstü tablo tek
   * liste kalır; orada fatura no zaten kendi kolonunda ve kolon süzgeci var, ikinci bir kapı
   * eklemek yönetici ekranını gereksiz bölerdi.
   *
   * Ürünü bayiden alınacak iş ile faturalı iş sahada FARKLI iki güzergâh: birinde teknisyen
   * önce bayiye uğrayıp ürünü alıyor. Aynı listede karışık durunca kişi ikisini ayıklayamıyordu.
   */
  const { isCardView } = useCardView()
  const [pickupFilter, setPickupFilter] = useState<'all' | 'pickup' | 'invoiced'>('all')

  // Sekme değişince bölüm seçimi başa döner; Planlama'da bu ayrım hiç yok.
  useEffect(() => {
    setPickupFilter('all')
  }, [activeTab])

  const planRows = useMemo(() => {
    const all = buildMontajPlanRows(installationRecords)
    const processed = all.map(row => {
      /*
        GEÇEN GÜN ISO DEĞERDEN HESAPLANIR, EKRAN METNİNDEN DEĞİL (2026-09-02 canlı hata).

        `buildMontajPlanRows` iki alan üretiyor: `createdAt` EKRAN METNİ ("02.09.2026",
        `toLocaleDateString('tr-TR')` çıktısı), `createdAtIso` ise ham ISO değer. Burada
        ekran metni kullanılıyordu ve `new Date("02.09.2026")` onu AY.GÜN sırasıyla
        okuyup 9 Şubat sanıyordu: bugün açılan kayıt "205 Gün" görünüyordu.

        205 sayısı tesadüf değil — 9 Şubat ile 2 Eylül arası tam 205 gün.
      */
      const startStr = (row as any).createdAtIso || row.createdAt
      if (!startStr) return { ...row, elapsedDays: 0 }
      const anyRow = row as any
      const isCompleted = 
        row.status === 'Completed' || 
        row.status === 'Delivered' || 
        row.status === 'Cancelled' || 
        anyRow.derivedState === 'Completed' || 
        anyRow.derivedState === 'CompletedWithCancellations' || 
        anyRow.derivedState === 'Cancelled'
      const endStr = isCompleted 
        ? (anyRow.completedAt || anyRow.CompletedAt || anyRow.updatedAt || anyRow.UpdatedAt) 
        : null
      const startDate = new Date(startStr)
      const endDate = endStr ? new Date(endStr) : new Date()
      const diffTime = endDate.getTime() - startDate.getTime()
      const diffDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)))
      return { ...row, elapsedDays: diffDays }
    })
    return activeTab === 'bekleyen' ? processed.filter(isPlanningRow) : processed.filter(isFieldRow)
  }, [installationRecords, activeTab])

  /** Bölünme Teslimattakiler sekmesinde etkindir. */
  const pickupSplitActive = activeTab === 'aktif'

  const pickupCounts = useMemo(() => {
    let pickup = 0
    let invoiced = 0
    for (const r of planRows) {
      if (isPickupFromDealer(r)) pickup += 1
      else invoiced += 1
    }
    return { all: planRows.length, pickup, invoiced }
  }, [planRows])

  /*
    TESLIMATTAKILER GUNLUK EKRANDIR (2026-08-24, kullanici istegi: "tum teslimattakiler
    sayfalarina tarih secimi ekle, otomatik bugun secili olsun").

    Suzme SUNUCUDA degil BURADA yapiliyor: satirlar kalem/gorev ekseninde ve bir kaydin
    gorevleri farkli gunlere planlanmis olabiliyor. Kaydi sunucuda tarihe gore suzmek, ayni
    kaydin baska gunlere ait gorevlerini de listeden dusururdu. Burada gorevin KENDI
    planlanan gunune bakiliyor.

    Sekme degisince tarih sifirlanir; "Planlama" sekmesi sessizce bugune filtreli kalmasin.
  */
  const [gun, setGun] = useState<string>('')

  useEffect(() => {
    setGun(activeTab === 'aktif' ? bugunIso() : '')
  }, [activeTab])

  const gunFiltreliRows = useMemo(() => {
    // Sekme ayrimi kalkti (2026-08-25): gun secici artik PLANLAMA sekmesinde de var, bu yuzden
    // suzgec de orada calismali. Ayrim yalnizca VARSAYILAN'da kaldi (asagidaki useEffect):
    // Teslimattakiler bugune acilir, Planlama tum gunlerle acilir -- planlama ekrani henuz
    // planlanmamis (tarihsiz) isleri gosterebilmeli, bugune kilitli acilirsa hepsi kaybolurdu.
    if (!gun) return planRows
    return planRows.filter((r: any) => {
      const gorevler = Array.isArray(r?.tasks) ? r.tasks : []
      return gorevler.some((t: any) => {
        const p = t?.plannedAt ?? t?.PlannedAt
        if (!p) return false
        const d = new Date(String(p))
        if (isNaN(d.getTime())) return false
        const iki = (n: number) => String(n).padStart(2, '0')
        return `${d.getFullYear()}-${iki(d.getMonth() + 1)}-${iki(d.getDate())}` === gun
      })
    })
  }, [planRows, activeTab, gun])

  const visibleRows = useMemo(() => {
    if (!pickupSplitActive || pickupFilter === 'all') return gunFiltreliRows
    return gunFiltreliRows.filter((r) => (pickupFilter === 'pickup' ? isPickupFromDealer(r) : !isPickupFromDealer(r)))
  }, [gunFiltreliRows, pickupSplitActive, pickupFilter])

  const regionDistribution = useMemo(() => {
    // Bölge yoğunluğu artık KAYIT değil ADET sayıyor: bir bölgede 1 kayıt ama 12 adet montaj
    // olabiliyor, planlamada yükü belirleyen adet.
    const map = new Map<string, number>()
    for (const r of planRows) {
      const key = r.regionName && r.regionName !== '-' ? r.regionName : 'Bölge Yok'
      map.set(key, (map.get(key) ?? 0) + r.quantity)
    }
    const total = Array.from(map.values()).reduce((a, b) => a + b, 0) || 1
    return Array.from(map.entries())
      .map(([region, count]) => ({ region, count, percent: Math.round((count / total) * 100) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
  }, [planRows])

  const [drawerOpen, setDrawerOpen] = useState(false)
  /*
    Geçmişteki fotoğraflar `window.open` ile YENİ SEKMEDE açılıyordu — WebView
    uygulamasında bu kullanıcıyı tarayıcıya atıyor. Artık uygulama içinde
    yakınlaştırılabilir görüntüleyici açılıyor; listenin tamamı verilir ki oklarla gezilsin.
  */
  const [buyutulenGorseller, setBuyutulenGorseller] = useState<string[]>([])
  const [buyutulenIdx, setBuyutulenIdx] = useState<number | null>(null)
  const [drawerPhotoIdx, setDrawerPhotoIdx] = useState(0)
  const [photoDeleting, setPhotoDeleting] = useState(false)

  const [productDetail, setProductDetail] = useState<ServiceProductDetailDto | null>(null)
  const [productDetailLoading, setProductDetailLoading] = useState(false)
  const [productDetailError, setProductDetailError] = useState<string | null>(null)

  const [selectedTaskForDetail, setSelectedTaskForDetail] = useState<any>(null)
  const [selectedRecordForDetail, setSelectedRecordForDetail] = useState<any>(null)

  useEffect(() => {
    setDrawerPhotoIdx(0)
  }, [selectedTaskForDetail])

  const selectedRecord = useMemo(() => {
    if (selectedRecordForDetail) return selectedRecordForDetail
    if (!selectedTaskForDetail) return null
    return installationRecords.find(r => r.id === selectedTaskForDetail.ServiceId || r.id === selectedTaskForDetail.serviceId) ?? null
  }, [installationRecords, selectedRecordForDetail, selectedTaskForDetail])

  /**
   * KALEM İŞLEMİ EKRANI SATIRIN ÜRÜNÜNÜ GÖSTERİR, KAYDINKİNİ DEĞİL (2026-08-26 bildirimi).
   *
   * Başlıktaki ürün adı `selectedRecord.productName` okuyordu — bu, faturanın (kaydın) ANA
   * ürünüdür. Montaj kalem eksenine geçtiğinden beri bir kaydın altında birden çok ürün
   * olabiliyor; çamaşır makinesi satırının işlemi açıldığında ekranda aynı faturanın
   * televizyonu yazıyordu. Kullanıcı kalemi "gerçekleşti" yaparken hangi ürünü kapattığını
   * göremiyordu.
   *
   * Kalem, GÖREVİN KENDİ `serviceRecordItemId` damgasından bulunuyor — çağıran ekrana
   * bağlı değil. Satırı çağıran yerden geçirmek de mümkündü ama tek bir çağrı yeri
   * unutulduğunda hata sessizce geri gelirdi; damga her görevde zaten var.
   *
   * Kalemi olmayan ESKİ kayıtlar (kalem kavramından önce açılanlar) kaydın ürününe düşer;
   * onlarda kayıt = tek kalem olduğu için gösterilen ad zaten doğrudur.
   */
  const selectedItemForDetail = useMemo(() => {
    const itemId = String(
      selectedTaskForDetail?.serviceRecordItemId ?? selectedTaskForDetail?.ServiceRecordItemId ?? ''
    )
    if (!itemId) return null
    const items: any[] = selectedRecord?.items ?? selectedRecord?.Items ?? []
    return items.find((i: any) => String(i.id ?? i.Id ?? '') === itemId) ?? null
  }, [selectedTaskForDetail, selectedRecord])

  const selectedProductName: string =
    selectedItemForDetail?.productName || selectedRecord?.productName || '-'
  const selectedProductSerial: string =
    selectedItemForDetail?.serialNumber || selectedRecord?.serialNumber || ''

  useEffect(() => {
    let active = true
    if (!drawerOpen || !selectedProductName || selectedProductName === '-') {
      setProductDetail(null)
      setProductDetailError(null)
      setProductDetailLoading(false)
      return
    }

    setProductDetailLoading(true)
    setProductDetailError(null)

    // Ürün kartı da KALEMİN ürününü açar; başlıkla farklı ürün göstermesi anlamsızdı.
    const cleanProductName = selectedProductName.split(' (+')[0]
    fetchServiceProductDetailByName(cleanProductName)
      .then((d) => {
        if (!active) return
        setProductDetail(d)
      })
      .catch((e: any) => {
        if (!active) return
        setProductDetail(null)
        setProductDetailError(String(e?.message ?? 'Ürün detayı getirilemedi'))
      })
      .finally(() => {
        if (!active) return
        setProductDetailLoading(false)
      })

    return () => {
      active = false
    }
  }, [drawerOpen, selectedProductName])

  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  const [statusNote, setStatusNote] = useState<string>('')
  const [statusAddress, setStatusAddress] = useState<string>('')
  const [selectedTaskStatus, setSelectedTaskStatus] = useState<string>('Planned')
  /** Kalem İşlemi çekmecesindeki işlem tarihi; her açılışta bugüne döner. */
  const [statusDay, setStatusDay] = useState<string>(bugunIso())

  // Planlama sekmesinin iki modalı: fatura planlama ve sahaya aktarım. İkisi de artık satırın
  // KALEMİNE odaklanarak açılıyor — tıklanan satır hangi kalemse modalda yalnızca o görünür.
  const [planlamaOpen, setPlanlamaOpen] = useState(false)
  const [planlamaRecord, setPlanlamaRecord] = useState<any | null>(null)
  const [planlamaItemId, setPlanlamaItemId] = useState<string | null>(null)
  const [aktarimOpen, setAktarimOpen] = useState(false)
  const [aktarimRecord, setAktarimRecord] = useState<any | null>(null)
  const [aktarimItemId, setAktarimItemId] = useState<string | null>(null)

  // Servis fişi artık bu sayfadan oluşturuluyor ve basılıyor.
  const [gecmisRecordId, setGecmisRecordId] = useState<string | null>(null)
  // "i" butonu KALEM bazlı çalışır: hangi kalem satırından açıldıysa yalnızca o kalemin
  // geçmişini gösterir, kaydın diğer kalemlerinin adımlarıyla karışmaz.
  const [gecmisTaskId, setGecmisTaskId] = useState<string | null>(null)
  const [fisModalOpen, setFisModalOpen] = useState(false)
  const [fisRecord, setFisRecord] = useState<any | null>(null)
  const [fisItemId, setFisItemId] = useState<string | null>(null)
  /*
   * Burada bir zamanlar 12 tane state vardı: `infoData`, `infoPopupId`, `infoTaskId`,
   * `infoRecord`, `infoTask`, `infoTaskData`, `infoPhotoIdx`, `infoLoading`, `infoTimeline`,
   * `techModalOpen/List/Title`. Hiçbirini set eden kod kalmamıştı — geçmiş görüntüleme
   * `ServisGecmisiModal`'a taşındığında geride kalmışlar. Yanlarında da yalnızca lint susturmak
   * için yazılmış `if (false) console.log(...)` bir efekt duruyordu. Hepsi kaldırıldı.
   */

  const scanProductBarcodeIntoNote = async () => {
    const w = window as any
    const applyValue = (value: string) => {
      const cleaned = value.replace(/[^a-zA-Z0-9._/-]/g, '').slice(0, 80)
      if (!cleaned) return
      setStatusNote((prev) => `${prev}${prev.trim() ? '\n' : ''}Ürün barkodu: ${cleaned}`)
    }

    // Kamera/BarcodeDetector yoksa elle giriş: window.prompt yerine notun kendisine yönlendiriyoruz.
    // prompt tarayıcıyı kilitliyor, mobilde tasarımın dışına düşüyor ve girilen değeri
    // doğrulamıyordu; not alanı zaten aynı yere yazıyor.
    if (!w.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
      setActionError('Bu cihaz/tarayıcı barkod okumayı desteklemiyor. Seri numarasını yukarıdaki not alanına yazabilirsiniz.')
      return
    }

    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    const video = document.createElement('video')
    video.srcObject = stream
    await video.play()
    const detector = new w.BarcodeDetector({ formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code'] })
    try {
      for (let i = 0; i < 20; i++) {
        const codes = await detector.detect(video)
        const value = codes?.[0]?.rawValue
        if (value) {
          applyValue(value)
          return
        }
        await new Promise((resolve) => window.setTimeout(resolve, 200))
      }
      setActionError('Barkod okunamadı. Not alanına manuel girebilirsiniz.')
    } finally {
      stream.getTracks().forEach((track) => track.stop())
    }
  }


  /**
   * Planlama sekmesinin hattı: planla → fiş bas → sahaya aktar → kime.
   *
   * Aktarım artık tek tıkla değil, kendi modalında yapılıyor: hangi satırların gideceği ve her
   * satırın hangi saha personeline / klima ekibine düşeceği orada kesinleşiyor. Fiş kapısını da
   * o modal önden gösteriyor (sunucudaki kontrol yerinde duruyor).
   */
  const [cancelLoading, setCancelLoading] = useState(false)
  const [cancelRow, setCancelRow] = useState<MontajPlanRow | null>(null)
  const [postponeLoading, setPostponeLoading] = useState(false)

  /**
   * Satırın ERTELENEBİLİR planlama satırları.
   *
   * Gerçekleşmiş ve iptal edilmiş satırlar dışarıda: yapılmış işi ertelemek onu geri almak
   * demek olurdu, iptal ise zaten kapanmış bir satır. Hâlihazırda ertelenmiş olanlar da
   * dışarıda — aksi hâlde düğme hiç sönmez ve sunucuya boşuna istek gider.
   */
  const postponableTasks = (row: MontajPlanRow) =>
    (row.tasks ?? []).filter((t) => {
      const s = statusNameOf(t)
      return s !== 'Cancelled' && s !== 'Completed' && s !== 'Postponed'
    })

  /**
   * SATIRIN BÜTÜN KALEMLERİNİ TEK HAMLEDE ERTELER (2026-08-27 kullanıcı isteği:
   * "planlanın altına ertelendi butonu koy, basınca o kalemlerin hepsi ertelenmiş olsun").
   *
   * Teslimattakiler'deki "Ertelendi" ile AYNI uç ve aynı kural (`Postponed`); tek fark
   * tek satır yerine kalemin bütün satırlarına uygulanması. Sunucu bu durumda teknisyeni,
   * planlanan günü ve sahaya aktarım damgasını siliyor — satır planlamaya geri döner.
   *
   * İKİ ALAN BİLEREK GERİ GÖNDERİLİYOR / GÖNDERİLMİYOR:
   *  - `reason` HİÇ gönderilmez (boş string bile değil). Sunucu alanı yalnızca gönderildiyse
   *    yazıyor ve boş string "notu sil" demek; planlamada girilen açıklama silinirdi.
   *  - `customAddress` satırın KENDİ değeriyle geri gönderilir. Gönderilmezse sunucu onu
   *    değişmiş sayıp kalemin montaj adresini temizler.
   *
   * Onay ekranı satır satır değil TEK seferde sorulur; 12 adetlik bir kalemde 12 pencere
   * açmanın anlamı yok.
   */
  const postponeRow = async (row: MontajPlanRow) => {
    const targets = postponableTasks(row)
    if (targets.length === 0) return

    setPostponeLoading(true)
    setActionError(null)
    setActionSuccess(null)
    try {
      const done = await runStatusChange(
        {
          kind: `Montaj Kalemi Erteleme (${targets.length} satır)`,
          subject: row.productName || 'Montaj kalemi',
          fromLabel: STATE_LABELS[row.state ?? ''] ?? null,
          toLabel: STATE_LABELS.Postponed,
          hasPhoto: false,
          hasNote: false,
          warning: 'Ertelenen satırların teknisyeni, planlanan günü ve sahaya aktarım damgası silinir; satır planlamaya geri döner.'
        },
        async () => {
          for (const t of targets) {
            await apiJson(`/api/installations/tasks/${t.id}/status`, {
              method: 'PATCH',
              body: JSON.stringify({
                status: 'Postponed',
                customAddress: (t as any).customAddress ?? (t as any).CustomAddress ?? undefined
              }),
            })
          }
          return true
        }
      )
      // null = kullanıcı onay ekranında vazgeçti; hata değil, hiçbir şey değişmemeli.
      if (done === null) return

      setActionSuccess(`${targets.length} satır ertelendi.`)
      await refetch()
      await reloadExpanded()
    } catch (e: any) {
      setActionError(String(e?.message ?? 'Satırlar ertelenemedi'))
    } finally {
      setPostponeLoading(false)
    }
  }

  /**
   * İptal KALEM bazındadır — kayıt bazında değil.
   *
   * Eski hâli iki yönden birden bozuktu: kalem kimliğini (`itemId`) GÖREV ucuna
   * (`/tasks/{id}/status`) yolluyordu, ve niyeti zaten "kaydı iptal et"ti; bir kalemi iptal
   * etmek faturanın bütün kalemlerini "İptal" gösteriyor, kayıt her iki sekmeden düşüyordu.
   * Yeni uç yalnızca o kalemi ve onun satırlarını kapatır; kayıt ancak son yaşayan kalem de
   * iptal olunca iptale düşer.
   */
  const confirmCancel = async (reason: string) => {
    const row = cancelRow
    if (!row) return

    setCancelLoading(true)
    try {
      if (row.itemId) {
        await apiJson(`/api/installations/items/${row.itemId}/cancel`, {
          method: 'PATCH',
          body: JSON.stringify({ reason }),
        })
      } else {
        // Kalem kavramından önce açılmış kayıtta kalem yok: satırlar doğrudan kayda bağlı.
        // İptal sebebi zaten iptal modalında alınıyor; onay ekranı satır satır değil, TEK
        // seferde soruluyor (aksi halde 20 satırlık bir kalemde 20 pencere açılırdı).
        const targets = (row.tasks ?? []).filter((t) => statusNameOf(t) !== 'Cancelled')
        const cancelled = await runStatusChange(
          {
            kind: `Montaj Kalemi İptali (${targets.length} satır)`,
            subject: row.productName || 'Montaj kalemi',
            fromLabel: STATE_LABELS[row.state ?? ''] ?? null,
            toLabel: 'İptal',
            hasPhoto: false,
            hasNote: Boolean(reason && reason.trim()),
            note: reason,
            warning: 'İptal edilen satırlar planlamadan düşer ve hak ediş doğurmaz.'
          },
          async () => {
            for (const t of targets) {
              await apiJson(`/api/installations/tasks/${t.id}/status`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'Cancelled', reason }),
              })
            }
            return true
          }
        )
        if (cancelled === null) return
      }
      setCancelRow(null)
      setActionSuccess('Montaj kalemi iptal edildi.')
      await refetch()
      await reloadExpanded()
    } finally {
      setCancelLoading(false)
    }
  }

  const openPlanlama = (row: MontajPlanRow) => {
    setActionError(null)
    setActionSuccess(null)
    setPlanlamaRecord(row.record)
    setPlanlamaItemId(row.itemId)
    setPlanlamaOpen(true)
  }

  const openAktarim = (row: MontajPlanRow) => {
    setActionError(null)
    setActionSuccess(null)
    setAktarimRecord(row.record)
    setAktarimItemId(row.itemId)
    setAktarimOpen(true)
  }

  const openServisFisi = (record: any, itemId?: string) => {
    setActionError(null)
    setActionSuccess(null)
    setFisRecord(record)
    setFisItemId(itemId || null)
    setFisModalOpen(true)
  }

  const openDetail = (record: any, task: any) => {
    const rawStatus = task.status ?? task.Status
    const statusInfo = taskStatusConfig[rawStatus] ?? { value: String(rawStatus || 'Planned') }
    const taskWithService = { ...task, serviceId: record.id, ServiceId: record.id }
    setSelectedRecordForDetail(record)
    setSelectedTaskForDetail(taskWithService)
    setSelectedTaskStatus(statusInfo.value)
    setStatusNote('')
    setStatusDay(bugunIso())
    setStatusAddress(task.customAddress ?? task.CustomAddress ?? '')
    setActionError(null)
    setActionSuccess(null)
    setDrawerOpen(true)
  }


  const exportCsv = useCallback(() => {
    // Dışa aktarım EKRANDA NE GÖRÜNÜYORSA onu yazar: kolon süzgeçlerinden geçmiş satırlar.
    // Eskiden `planRows` (listenin tamamı) yazılıyordu — kullanıcı süzüp dışa aktarınca
    // filtresiz dosya iniyordu ve bu sessizce oluyordu.
    const rows = filteredRows.length > 0 ? filteredRows : planRows

    const headers = [
      'Montaj ID','Kalem','Kayıt Tarihi','Montaj Türü','Fatura No','Ürün','Stok Kodu','Seri No',
      'Adet','Planlanan','Kalan','Durum','Müşteri','Telefon','Adres','Bölge','Bayi',
      'Atanan','Planlanan Tarih'
    ]
    const escape = (v: any) => {
      const s = String(v ?? '')
      return /[\n\r",;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = [headers.join(';')]
    for (const r of rows) {
      lines.push([
        r.serviceNumber,
        r.lineLabel,
        r.createdAt,
        r.installationType,
        r.invoiceNo,
        r.productName,
        r.productStockCode,
        r.serialNumber,
        r.quantity,
        r.plannedQuantity,
        r.remainingQuantity,
        r.stateLabel,
        r.customerName,
        r.customerPhone,
        r.address,
        r.regionName,
        r.dealerName,
        r.technicianNames,
        r.plannedDates,
      ].map(escape).join(';'))
    }
    const blob = new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `montaj-listesi-${new Date().toISOString().slice(0,10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    // useCallback: bağımlılık olarak kullanıldığı efekt, memoize edilmediği için HER render'da
    // dinleyiciyi söküp yeniden bağlıyordu.
  }, [filteredRows, planRows])

  useEffect(() => {
    const handleExport = () => exportCsv()
    window.addEventListener('shell:montaj-yonetimi-export', handleExport)
    return () => window.removeEventListener('shell:montaj-yonetimi-export', handleExport)
  }, [exportCsv])

  const columns: TableColumn<MontajPlanRow>[] = useMemo(() => {
    // SATIR = KALEM. Ürün, adet, müşteri, adres ve durum kalemin kendisinden okunur; yalnızca
    // fatura/bayi/bölge gibi gerçekten kayıt seviyesinde olan alanlar kayıttan gelir. Montaj
    // Kabul'ün tablosu buna uymuyor ve UYMAMALI — orası faturayı olduğu gibi gösteren ekran.
    const cols: TableColumn<MontajPlanRow>[] = [
      {
        key: 'serviceNumber',
        label: 'Montaj ID',
        searchable: true,
        filter: { type: 'text' },
        render: (_v, row) => (
          <div>
            <span className="font-mono text-xs font-semibold text-[#B91C1C]">{row.serviceNumber}</span>
            <div className="text-[10px] text-gray-400 mt-0.5">{row.lineLabel} kalem</div>
            {/* Kısmi aktarımda kalan kısım için MNT-xxxxxxx-N kardeş kaydı açılıyor; rakamsız
                bakınca ikisi aynı fatura no'suyla görünüp bağımsız iki kayıt sanılabiliyor. */}
            {row.splitFrom && (
              <div className="text-[10px] text-gray-400">{row.splitFrom}'den bölündü</div>
            )}
          </div>
        )
      },
      {
        key: 'elapsedDays' as any,
        label: 'Geçen Gün',
        sortable: true,
        searchable: false,
        render: (_v, row: any) => {
          const diffDays = row.elapsedDays || 0
          let bgClass = 'bg-emerald-50 text-emerald-700 border-emerald-200'
          if (diffDays >= 15 && diffDays < 30) {
            bgClass = 'bg-amber-50 text-amber-700 border-amber-200'
          } else if (diffDays >= 30) {
            bgClass = 'bg-rose-50 text-rose-700 border-rose-200 font-bold animate-pulse'
          } else if (diffDays > 5 && diffDays < 15) {
            bgClass = 'bg-emerald-50/70 text-emerald-800 border-emerald-150'
          }
          return (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${bgClass}`}>
              {diffDays} Gün
            </span>
          )
        }
      },
      {
        key: 'productName',
        label: 'Ürün',
        searchable: true,
        filter: { type: 'text' },
        render: (_v, row) => (
          <div className="max-w-[240px]">
            <div className="text-xs font-semibold text-gray-900 truncate" title={row.productName}>{row.productName}</div>
            <div className="text-[10px] text-gray-400 truncate">
              {row.productStockCode || '-'}
              {row.serialNumber ? ` · SN: ${row.serialNumber}` : ''}
            </div>
          </div>
        )
      },
      {
        key: 'quantity',
        label: 'Adet',
        searchable: true,
        filter: { type: 'number' },
        render: (_v, row) => (
          // Adet kabulde girildiği gibi TEK satırda durur; alt alta adet satırı üretilmez.
          // Altındaki döküm sekmeye göre değişir: planlamada "ne kaldı", teslimatta "ne nerede".
          <div className="whitespace-nowrap">
            <span className="text-sm font-bold text-gray-900">{row.quantity}</span>
            <span className="text-[10px] text-gray-400"> adet</span>
            <div className="text-[10px] mt-0.5 space-y-0.5">
              {activeTab === 'bekleyen' ? (
                <>
                  {/* "Planlanmadı" = SEBEPSİZ bekleyen adet. Sahadan geri düşenler (ulaşılamadı /
                      teslim edildi / ertelendi) `remainingQuantity`'nin İÇİNDE olduğu için ayrıca
                      düşülüyor; yoksa aynı adet hem "planlanmadı" hem "ulaşılamadı" diye iki kez
                      yazılıyor ve 2 adetlik kalem 3 satır dökümü gösteriyordu. */}
                  {Math.max(0, row.remainingQuantity - row.unreachableQuantity - row.deliveredQuantity - row.postponedQuantity) > 0 && (
                    <div className="text-amber-700 font-bold">
                      {row.remainingQuantity - row.unreachableQuantity - row.deliveredQuantity - row.postponedQuantity} planlanmadı
                    </div>
                  )}
                  {row.pendingQuantity > 0 && (
                    <div className="text-blue-700 font-bold">{row.pendingQuantity} aktarım bekliyor</div>
                  )}
                  {/* Sahadan planlamaya GERİ DÜŞEN adetler: planlamacının neden yeniden
                      planlaması gerektiğini söyleyen tek yer (§8.8). */}
                  {row.unreachableQuantity > 0 && (
                    <div className="text-rose-700 font-bold">{row.unreachableQuantity} ulaşılamadı</div>
                  )}
                  {row.deliveredQuantity > 0 && (
                    <div className="text-emerald-700 font-bold">{row.deliveredQuantity} teslim edildi</div>
                  )}
                  {row.postponedQuantity > 0 && (
                    <div className="text-amber-700 font-bold">{row.postponedQuantity} ertelendi</div>
                  )}
                  {row.transferredQuantity > 0 && (
                    <div className="text-gray-400">{row.transferredQuantity} sahada</div>
                  )}
                </>
              ) : (
                <>
                  {row.transferredQuantity > 0 && (
                    <div className="text-emerald-700 font-bold">{row.transferredQuantity} sahada</div>
                  )}
                  {row.completedQuantity > 0 && (
                    <div className="text-green-700 font-bold">{row.completedQuantity} gerçekleşti</div>
                  )}
                  {(row.remainingQuantity > 0 || row.pendingQuantity > 0) && (
                    <div className="text-gray-400">{row.remainingQuantity + row.pendingQuantity} planlamada</div>
                  )}
                </>
              )}
            </div>
          </div>
        )
      },
      {
        key: 'state',
        label: 'Durum',
        searchable: true,
        filter: {
          type: 'select',
          options: [
            { label: 'Planlandı', value: 'Planned' },
            { label: 'İşlemde', value: 'Mixed' },
            { label: 'Gerçekleşti', value: 'Completed' },
            { label: 'Teslim Edildi', value: 'Delivered' },
            { label: 'Ertelendi', value: 'Postponed' },
            { label: 'Yeni Kayıt', value: 'Deferred' },
            { label: 'İptal', value: 'Cancelled' }
          ]
        },
        // Rozetin altındaki tarih de aranabilsin (2026-09-18).
        filterText: (row) => `${row.stateLabel ?? ''} ${row.state ?? ''} ${row.stateDate ?? ''}`,
        render: (_v, row) => (
          <div className="whitespace-nowrap">
            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${stateBadgeClass(row.state)}`}>
              {row.stateLabel}
            </span>
            {/* Satır bu duruma ne zaman geçti; geriye dönük işlenen işte seçilen gün. */}
            {row.stateDate && (
              <div className="text-[10px] font-semibold text-gray-500 mt-0.5">{row.stateDate}</div>
            )}
          </div>
        )
      },
      {
        key: 'customerName',
        label: 'Müşteri',
        searchable: true,
        filter: { type: 'text' },
        render: (_v, row) => (
          <div className="max-w-[180px]">
            <div className="text-xs font-medium text-gray-900 truncate" title={row.customerName}>{row.customerName}</div>
            <div className="text-[10px] text-gray-500"><PhoneLinks phone={row.customerPhone} compact /></div>
          </div>
        )
      },
      {
        key: 'address',
        label: 'Adres',
        searchable: true,
        filter: { type: 'text' },
        render: (_v, row) => (
          <span className="text-[11px] text-gray-700 block max-w-[220px] truncate" title={row.address}>
            {row.address}
          </span>
        )
      },
      {
        key: 'regionName',
        label: 'Bölge',
        searchable: true,
        filter: { type: 'text' },
        render: (_v, row) => (
          <span className="text-xs font-medium text-gray-900">{row.regionName}</span>
        )
      },
      /*
        PLANLANAN GUN ve ATANAN PERSONEL AYRI IKI SUTUN (2026-08-25, kullanici istegi:
        "Atanan / tarih kolonu ayri ayri olmali, tipki Beyaz Esya planlamadaki gibi").

        Eskiden tek sutundu: teknisyen adi ustte, tarih altta kucuk gri yazi. Iki sorun vardi:
        (1) sutunun suzgeci METIN'di, dolayisiyla "su gune planlananlari goster" diye gun
        secilemiyordu -- tarihi olan tek yer "Kayit Tarihi" idi ve o baska bir sey;
        (2) tarihe gore siralama da metne gore yapiliyordu.

        Ayrim iki sekmede de gecerli: bu dizi hem Planlama hem Teslimattakiler icin kullaniliyor.
        Boylece "2 ayri tarih" -- Kayit Tarihi ve Planlanan Gun -- ayri ayri suzulebiliyor.
      */
      {
        key: 'plannedDates',
        label: 'Planlanan Gün',
        sortable: true,
        searchable: true,
        filter: { type: 'date' },
        render: (_v, row) => {
          if (!row.plannedDates) {
            return <span className="text-gray-400 font-medium">-</span>
          }
          const gunler = row.plannedDates.split(',').map((g) => g.trim()).filter(Boolean)
          return (
            <div className="max-w-[130px]">
              <span className="text-xs text-gray-900 font-semibold">{gunler[0]}</span>
              {/* Bir kalem birden fazla güne bölünmüş olabilir (aynı ürünün 3 adedi iki güne).
                  İlk gün sütunda, kalanı ipucunda: sütun genişliği laptopta zaten dar. */}
              {gunler.length > 1 && (
                <span
                  className="ml-1 text-[10px] text-gray-500 font-semibold"
                  title={gunler.join(', ')}
                >
                  +{gunler.length - 1}
                </span>
              )}
            </div>
          )
        }
      },
      {
        key: 'technicianNames',
        label: 'Atanan Personel',
        searchable: true,
        filter: { type: 'text' },
        render: (_v, row) => {
          if (!row.technicianNames) {
            return <span className="text-[10px] text-amber-700 font-bold bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">Atanmadı</span>
          }
          return (
            <div className="flex items-center gap-1.5 max-w-[200px]">
              <span className="w-2 h-2 rounded-full bg-[#B91C1C] shadow-2xs shrink-0" />
              <span className="text-xs font-semibold text-gray-900 truncate" title={row.technicianNames}>{row.technicianNames}</span>
            </div>
          )
        }
      },
      {
        key: 'customerType',
        label: 'Müşteri Tipi',
        searchable: true,
        filter: {
          type: 'select',
          options: [
            { label: 'Bayi', value: 'Bayi' },
            { label: 'Mağaza', value: 'Mağaza' },
            { label: 'Müşteri', value: 'Müşteri' }
          ]
        },
        render: (_v, row) => {
          const badgeColor =
            row.customerType === 'Bayi'
              ? 'bg-blue-100 text-blue-800 border-blue-200 font-bold'
              : row.customerType === 'Mağaza'
              ? 'bg-purple-100 text-purple-800 border-purple-200 font-bold'
              : 'bg-emerald-100 text-emerald-800 border-emerald-200 font-bold'
          return (
            <span className={`inline-flex px-2 py-0.5 rounded text-xs border ${badgeColor}`}>
              {row.customerType}
            </span>
          )
        }
      },
      {
        key: 'installationType',
        label: 'Montaj Türü',
        searchable: true,
        filter: {
          type: 'select',
          options: [
            { label: 'Fatura', value: 'Fatura' },
            { label: 'Bayi', value: 'Bayi' },
            { label: 'Mağaza', value: 'Mağaza' }
          ]
        },
        render: (_v, row) => {
          let colorClass = 'bg-blue-100 text-blue-700 border-blue-200'
          if (row.installationType === 'Fatura') {
            colorClass = 'bg-purple-100 text-purple-700 border-purple-200'
          } else if (row.installationType === 'Mağaza') {
            colorClass = 'bg-teal-100 text-teal-700 border-teal-200'
          }
          return (
            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${colorClass}`}>
              {row.installationType}
            </span>
          )
        }
      },
      {
        key: 'invoiceNo',
        label: 'Fatura No',
        searchable: true,
        filter: { type: 'text' },
        render: (_v, row) => {
          if (isPickupFromDealer(row)) {
            return <span className="text-amber-700 text-[11px] font-semibold">{PICKUP_FROM_DEALER}</span>
          }
          return (
            <div className="font-semibold text-gray-800 flex items-center gap-1">
              <span className="text-[11px]">{row.invoiceNo}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  navigator.clipboard.writeText(row.invoiceNo)
                }}
                className="p-0.5 text-gray-400 hover:text-gray-650"
                title="Fatura No Kopyala"
              >
                <Copy className="w-3 h-3" />
              </button>
            </div>
          )
        }
      },
      {
        key: 'dealerName',
        label: 'Bayi',
        searchable: true,
        filter: { type: 'text' },
        // Tek biçim + adı olmayan kaydı işaretleme: bkz. `utils/bayiEtiketi.ts`.
        render: (_v, row) => (
          <span className="block max-w-[180px]">
            <BayiHucresi dealerName={row.dealerName} dealerCode={(row as any).dealerCode} />
          </span>
        )
      },
      {
        key: 'createdAt',
        label: 'Kayıt Tarihi',
        searchable: true,
        filter: { type: 'date' },
        render: (_v, row) => (
          <span className="text-xs text-gray-700">{row.createdAt}</span>
        )
      },
    ]

    cols.push({
      key: 'actions' as any,
      label: 'İşlem',
      searchable: false,
      render: (_v, row) => {
        const dropdownItems: any[] = []

        // KALEM KALEM DURUM İŞLEME (2026-09-17): satırı açar; açılan "Planlama Satırları"
        // tablosunda her satırın kendi "İşlem Yap" düğmesi var. Durum adet satırı bazında
        // ilerlediği için işlem orada yapılıyor, burada topluca durum değiştirilmez.
        dropdownItems.push({
          key: 'process',
          label: 'İşlem Yap',
          onClick: () => { void expandRowForAction(row) }
        })

        if (activeTab === 'bekleyen') {
          if (hasPermission('montajYonetimi.planlama')) {
            dropdownItems.push({
              key: 'cancel',
              label: 'İptal Et',
              onClick: () => setCancelRow(row),
              disabled: cancelLoading
            })
            dropdownItems.push({
              key: 'plan',
              label: 'Planla',
              onClick: () => openPlanlama(row)
            })

            // Ertelenecek satırı olmayan kalemde düğme HİÇ çizilmez ("Sahaya Aktar (N)" ile
            // aynı kural): hiç planlanmamış bir kalemin ertelenecek satırı da yoktur, düğmeyi
            // göstermek basınca hiçbir şey olmayan bir düğme demek olurdu.
            const ertelenecek = postponableTasks(row)
            if (ertelenecek.length > 0) {
              dropdownItems.push({
                key: 'postpone',
                label: `Ertelendi (${ertelenecek.length})`,
                onClick: () => postponeRow(row),
                disabled: postponeLoading
              })
            }
          }
          if ((row.status || '').toLowerCase() !== 'new') {
            // Tik ve tarih KALEMİN kendi damgasından (bkz. montajPlanRows'daki not). Tarih,
            // damgası olmayan eski kayıtlarda boş kalır — tik durur, tarih yazılmaz.
            const basimTarihi = row.slipPrintedAt
              ? new Date(row.slipPrintedAt).toLocaleDateString('tr-TR')
              : ''
            dropdownItems.push({
              key: 'slip',
              label: row.isPrinted
                ? (basimTarihi ? `Servis Fişi ✓ (${basimTarihi})` : 'Servis Fişi ✓')
                : 'Servis Fişi',
              onClick: () => openServisFisi(row.record, row.itemId ?? undefined)
            })
          }
          if (hasPermission('montajYonetimi.planlama') && (row.status || '').toLowerCase() !== 'new' && row.pendingQuantity > 0) {
            dropdownItems.push({
              key: 'transfer',
              label: `Sahaya Aktar (${row.pendingQuantity})`,
              onClick: () => openAktarim(row)
            })
          }
        } else if (activeTab === 'aktif') {
          if (hasPermission('montajYonetimi.geriPlanlama') && (row.transferredTaskIds.length + row.completedTransferredTaskIds.length) > 0) {
            dropdownItems.push({
              key: 'return',
              label: `Geri Gönder (${row.transferredTaskIds.length + row.completedTransferredTaskIds.length})`,
              onClick: () => { setGeriGonderError(null); setGeriGonderCompleted(false); setGeriGonderTarget(row) }
            })
          }
          if (hasPermission('montajYonetimi.teslimat')) {
            dropdownItems.push({
              key: 'cancel',
              label: 'İptal Et',
              onClick: () => setCancelRow(row),
              disabled: cancelLoading
            })
          }
        }

        if (dropdownItems.length === 0) return null

        return (
          <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
            <ActionDropdown items={dropdownItems} buttonLabel="İşlem" />
          </div>
        )
      }
    })

    /*
      SERVİS FİŞİ KOLONU (2026-09-17 kullanıcı isteği: "yazıldı yazılmadı, yazıldıysa altta
      tarih, yeşil ve kırmızı; İşlem kolonunun sağında").

      Kaynak menüdeki "Servis Fişi ✓" ile AYNI: kalemin kendi basım damgası (`isPrinted` /
      `slipPrintedAt`, bkz. montajPlanRows). Ayrı bir hesap yazılsaydı menü ile kolon aynı
      kalem için farklı şey söyleyebilirdi. Damgası olmayan eski kayıtlarda tarih boş kalır.
    */
    cols.push({
      key: 'isPrinted' as any,
      label: 'Servis Fişi',
      searchable: false,
      render: (_v, row) => {
        if (!row.isPrinted) {
          return (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border bg-rose-50 text-rose-700 border-rose-200 whitespace-nowrap">
              Yazılmadı
            </span>
          )
        }
        const tarih = row.slipPrintedAt ? new Date(row.slipPrintedAt).toLocaleDateString('tr-TR') : ''
        return (
          <div className="whitespace-nowrap">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border bg-emerald-50 text-emerald-700 border-emerald-200">
              Yazıldı
            </span>
            {tarih && <div className="text-[10px] font-semibold text-emerald-700 mt-0.5">{tarih}</div>}
          </div>
        )
      }
    })

    return cols
    // permissionsLoaded olmadan kolonlar yetkiler gelmeden kurulup bir daha kurulmuyordu:
    // yetkiye bağlı düğmeler (planlama, aktarım) yalnızca teknisyen listesi değişince beliriyordu.
  }, [activeTab, technicians, navigate, permissionsLoaded])

  return (
    <>


      <div className="p-4 lg:p-6 flex flex-col gap-4">
        {/* Modal dışındaki işlemlerin geri bildirimi */}
        {actionSuccess && (
          <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-xs font-semibold text-green-700">{actionSuccess}</div>
        )}
        {actionError && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs font-semibold text-red-600">{actionError}</div>
        )}

        {/* Liste kalem kalem süzülüp sayfalandığı için tablo istemci tarafında çalışıyor; sunucu
            bir seferde en çok 200 KAYIT veriyor. Fazlası varsa sessizce kaybolmasın diye
            söyleniyor — arama kutusu sunucuya gidiyor, daraltmak listeyi tamamlar. */}
        {!isLoading && !error && result.totalCount > installationRecords.length && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs font-semibold text-amber-800">
            Sunucuda {result.totalCount} kayıt var; en yeni {installationRecords.length} kaydın kalemleri
            listeleniyor. Aramayı daraltarak (müşteri, ürün, fatura no) aradığınız kaydı getirin.
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-visible relative [--table-sticky-top:64px] lg:[--table-sticky-top:54px]">

        {error ? (
          <div className="py-8 text-center text-sm text-red-650">{error}</div>
        ) : isLoading && planRows.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">Yükleniyor...</div>
        ) : planRows.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">Kayıt bulunamadı.</div>
        ) : (
          <>
          {pickupSplitActive && (
            <div className="flex items-stretch gap-2 p-3 border-b border-gray-100 bg-gray-50/50">
              <button
                type="button"
                onClick={() => setPickupFilter('all')}
                className={`flex-1 rounded-xl border px-3 py-2.5 text-left transition-all ${
                  pickupFilter === 'all'
                    ? 'bg-white shadow-sm border-gray-400 text-gray-900 ring-2 ring-gray-900/5'
                    : 'bg-white/80 border-gray-200 text-gray-500 hover:bg-white'
                }`}
              >
                <div className="text-[11px] font-bold uppercase tracking-wider text-gray-600">Tümü</div>
                <div className="text-lg font-black leading-tight text-gray-900">{pickupCounts.all}</div>
              </button>
              <button
                type="button"
                onClick={() => setPickupFilter('pickup')}
                className={`flex-1 rounded-xl border px-3 py-2.5 text-left transition-all ${
                  pickupFilter === 'pickup'
                    ? 'bg-amber-50 shadow-sm border-amber-400 text-amber-900 ring-2 ring-amber-500/10'
                    : 'bg-white/80 border-gray-200 text-gray-500 hover:bg-white'
                }`}
              >
                <div className="text-[11px] font-bold uppercase tracking-wider text-amber-800">Bayiden Alınacaklar</div>
                <div className="text-lg font-black leading-tight text-amber-900">{pickupCounts.pickup}</div>
              </button>
              <button
                type="button"
                onClick={() => setPickupFilter('invoiced')}
                className={`flex-1 rounded-xl border px-3 py-2.5 text-left transition-all ${
                  pickupFilter === 'invoiced'
                    ? 'bg-blue-50 shadow-sm border-blue-400 text-blue-900 ring-2 ring-blue-500/10'
                    : 'bg-white/80 border-gray-200 text-gray-500 hover:bg-white'
                }`}
              >
                <div className="text-[11px] font-bold uppercase tracking-wider text-blue-800">Faturalı</div>
                <div className="text-lg font-black leading-tight text-blue-900">{pickupCounts.invoiced}</div>
              </button>
            </div>
          )}
          {/* GUN SECICI — iki sekmede de var (2026-08-25 kullanici istegi: "gunde de gun secip
              gorebilmem lazim"). Varsayilan farkli: Teslimattakiler BUGUN, Planlama TUM GUNLER.
              Secili gun PLANLANAN gune bakar; tarihsiz (henuz planlanmamis) satirlar bir gun
              secilince listeden duser -- bileşenin "Tümü" düğmesi kısıtı tek tıkla kaldırır. */}
          <div className="px-3 pt-3">
            <GunSecici
              deger={gun}
              adet={visibleRows.length}
              onChange={(iso) => setGun(iso)}
            />
          </div>

          {pickupSplitActive && visibleRows.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-500">
              {pickupFilter === 'pickup'
                ? 'Bayiden alınacak iş yok.'
                : pickupFilter === 'invoiced'
                ? 'Faturalı iş yok.'
                : 'Kayıt bulunamadı.'}
            </div>
          ) : (
          <Table
            columns={columns}
            data={visibleRows}
            showColumnFilters
            serverSide={false}
            onFilteredDataChange={setFilteredRows}
            // 15 kolon 1366px laptop ekranına sığmıyor; kullanıcı kolon kapatabilsin ve seçimi
            // kalıcı olsun. Sekmeye göre ayrı anahtar: planlama ile teslimatta bakılan kolonlar
            // aynı değil.
            columnVisibilityKey={`montaj-yonetimi-${activeTab}`}
            rowKey={(r) => r.id}
            isRowExpanded={(r) => expandedRow === r.id}
            onToggleRowExpanded={(r) => toggleExpand(r)}
            renderExpandedRow={(row) => {
              const record = row.record
              return (
              <div className="bg-gray-50 p-4 shadow-inner">
                <div className="mb-2 font-semibold text-gray-700 text-sm flex items-center justify-between">
                  <span>Planlama Satırları — {row.productName}</span>
                  {/* Adet satırları LİSTEDE değil burada duruyor: her adedin durumu ayrı
                      ilerleyebiliyor (biri gerçekleşti, biri ertelendi), ama planlama listesi
                      bu yüzden şişmemeli. */}
                  <span className="text-xs font-normal text-gray-500">Her satır 1 adet; durumu ayrı ilerler.</span>
                </div>
                {expandedLoading ? (
                  <div className="text-sm text-gray-500 py-2">Görevler yükleniyor...</div>
                ) : (
                  (() => {
                    const displayTasks = tasksOfRow(row)
                    if (displayTasks.length === 0) {
                      return <div className="text-sm text-gray-500 py-2">Bu kalem için henüz planlama satırı yok.</div>
                    }
                    return (
                      <>
                      {/*
                        TELEFON: gerçek kart listesi.

                        Tabloyu CSS ile yığına çevirmek denendi ve yetmedi — etiket sütunu
                        değeri eziyor, hücre kısıtları kartı bozuyordu. Telefonda tablo hiç
                        basılmıyor; aşağıdaki kart aynı veriyi sahanın okuduğu sırayla veriyor:
                        ürün, kime, nereye, kim götürüyor, ne zaman.

                        MASAÜSTÜ TABLOSU AYNEN DURUYOR (`hidden md:block`).
                      */}
                      <div className="md:hidden space-y-2">
                        {displayTasks.map((t: any, idx: number) => {
                          const s2 = t.status ?? t.Status
                          const sl2 = t.statusLabel ?? t.StatusLabel
                          const sc2 = taskStatusConfig[s2] ?? { label: sl2 || s2, color: 'bg-gray-100 text-gray-700', value: String(s2 || 'Planned') }
                          const tname2 = t.technicianName ?? t.TechnicianName
                          const addr2 = t.customAddress ?? t.CustomAddress ?? ''
                          const cust2 = t.itemCustomerName ?? t.ItemCustomerName ?? record?.customerName ?? ''
                          const phone2 = t.itemCustomerPhone ?? t.ItemCustomerPhone ?? record?.customerPhone ?? ''
                          const region2 = t.regionName ?? t.RegionName ?? record?.regionName ?? ''
                          const planned2 = (t.plannedAt || t.plannedDate) ? new Date(t.plannedAt || t.plannedDate).toLocaleDateString('tr-TR') : ''
                          const item2 = t.itemProductName ?? t.ItemProductName ?? ''

                          return (
                            <div
                              key={(t.id || t.Id || idx) + '-m'}
                              className={`rounded-xl border bg-white p-3 ${!tname2 ? 'border-amber-200 bg-amber-50/30' : 'border-gray-200'}`}
                            >
                              {/* Başlık: sıra + durum. Durum en çok bakılan alan, sağ üstte sabit. */}
                              <div className="flex items-start justify-between gap-2">
                                <span className="text-[11px] font-mono font-bold text-gray-400">#{idx + 1}</span>
                                <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${sc2.color}`}>{sc2.label}</span>
                              </div>

                              {item2 && (
                                <div className="mt-1 text-[13px] font-semibold text-gray-900 leading-snug">{item2}</div>
                              )}

                              {/* Satırlar etiketsiz: ikon zaten ne olduğunu söylüyor ve
                                  84px'lik etiket sütunu dar ekranda değere yer bırakmıyordu. */}
                              <div className="mt-2 space-y-1.5 text-[12px]">
                                {cust2 && (
                                  <div className="flex items-start gap-2">
                                    <span className="text-gray-400 shrink-0">Müşteri</span>
                                    <span className="font-semibold text-gray-900 min-w-0">{cust2}</span>
                                  </div>
                                )}
                                {phone2 && (
                                  <div className="flex items-center gap-2">
                                    <span className="text-gray-400 shrink-0">Telefon</span>
                                    {/* Telefon tıklanabilir: teknisyen sahada arayacak. */}
                                    <PhoneLinks phone={phone2} className="font-semibold text-gray-900" compact />
                                  </div>
                                )}
                                {(region2 || addr2) && (
                                  <div className="flex items-start gap-2">
                                    <span className="text-gray-400 shrink-0">Adres</span>
                                    <span className="text-gray-800 min-w-0">
                                      {region2 && <span className="font-semibold">{region2}</span>}
                                      {region2 && addr2 ? ' · ' : ''}
                                      {addr2}
                                    </span>
                                  </div>
                                )}
                                <div className="flex items-start gap-2">
                                  <span className="text-gray-400 shrink-0">Atanan</span>
                                  <span className="min-w-0">
                                    {tname2
                                      ? <span className="font-semibold text-gray-900">{tname2}</span>
                                      : <span className="font-bold text-amber-700">Atanmadı</span>}
                                    {planned2 && <span className="text-gray-500"> · {planned2}</span>}
                                  </span>
                                </div>
                              </div>

                              {/* Aksiyonlar altta, ayrık ve tam genişlikte. */}
                              <div className="mt-2.5 pt-2 border-t border-gray-100 flex items-center justify-end gap-2">
                                {canViewHistory && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setGecmisRecordId(record.id)
                                      setGecmisTaskId(String(t.id ?? t.Id ?? ''))
                                    }}
                                    className="px-2.5 py-1.5 text-[11px] font-bold text-blue-600 border border-blue-200 rounded-lg bg-blue-50/50"
                                  >
                                    Geçmiş
                                  </button>
                                )}
                                {/* İki sekmede de var (2026-09-17): planlamadaki satırın da
                                    durumu, geçmiş tarihle, buradan işlenebiliyor. */}
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); openDetail(record, t) }}
                                  className="px-2.5 py-1.5 text-[11px] font-bold text-white bg-[#B91C1C] rounded-lg"
                                >
                                  İşlem Yap
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      <div className="hidden md:block overflow-x-auto rounded-lg border border-gray-200 bg-white">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-100/50 text-left text-[10px] uppercase tracking-wider text-gray-500 font-bold border-b border-gray-200">
                            <tr>
                              <th className="px-3 py-2">Sıra</th>
                              <th className="px-3 py-2">Kalem</th>
                              <th className="px-3 py-2">Bölge</th>
                              <th className="px-3 py-2">Bayi</th>
                              <th className="px-3 py-2">Müşteri</th>
                              <th className="px-3 py-2">Telefon</th>
                              <th className="px-3 py-2">Atanan Teknisyen</th>
                              <th className="px-3 py-2">Aktarım</th>
                              <th className="px-3 py-2">Durum</th>
                              <th className="px-3 py-2">Planlanan Tarih</th>
                              <th className="px-3 py-2">Oluşturulma Tarihi</th>
                              <th className="px-3 py-2">Atama Adresi</th>
                              <th className="px-3 py-2">Not / Açıklama</th>
                              <th className="px-3 py-2 text-right">İşlem</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {displayTasks.map((t: any, idx: number) => {
                          const s = t.status ?? t.Status
                          const sl = t.statusLabel ?? t.StatusLabel
                          const sc = taskStatusConfig[s] ?? { label: sl || s, color: 'bg-gray-100 text-gray-700', value: String(s || 'Planned') }
                          const tname = t.technicianName ?? t.TechnicianName
                          const tqty = t.quantity ?? t.Quantity ?? 1
                          const taddr = t.customAddress ?? t.CustomAddress ?? ''
                          const hasAddress = !!taddr
                          const hasTech = !!tname

                          return (
                            <tr key={t.id || t.Id || idx} className={`hover:bg-gray-50/50 transition-colors ${!hasTech ? 'bg-amber-50/40' : ''}`}>
                              <td data-mobile-hide data-label="Sıra" className="px-3 py-2 text-gray-500 font-mono font-bold">#{idx + 1}</td>
                              <td data-label="Kalem" className="px-3 py-2 text-gray-700 max-w-[160px] truncate" title={t.itemProductName ?? t.ItemProductName ?? ''}>
                                {t.itemProductName ?? t.ItemProductName ?? <span className="text-gray-300 italic">-</span>}
                              </td>
                              <td data-label="Bölge" className="px-3 py-2 text-gray-700">
                                {t.regionName ?? t.RegionName ?? record?.regionName ?? <span className="text-gray-300 italic">-</span>}
                              </td>
                              {/* Bayi kalem değil KAYIT seviyesinde; tüm kalemler aynı bayiye ait. */}
                              <td data-mobile-hide data-label="Bayi" className="px-3 py-2 text-gray-700 max-w-[150px] truncate" title={record?.dealerName ?? ''}>
                                {record?.dealerName || <span className="text-gray-300 italic">-</span>}
                              </td>
                              <td data-label="Müşteri" className="px-3 py-2 text-gray-700 max-w-[150px] truncate" title={t.itemCustomerName ?? t.ItemCustomerName ?? record?.customerName ?? ''}>
                                {t.itemCustomerName ?? t.ItemCustomerName ?? record?.customerName ?? <span className="text-gray-300 italic">-</span>}
                              </td>
                              <td data-mobile-hide data-label="Telefon" className="px-3 py-2 text-gray-600 whitespace-nowrap">
                                {t.itemCustomerPhone ?? t.ItemCustomerPhone ?? record?.customerPhone ?? <span className="text-gray-300 italic">-</span>}
                              </td>
                              <td data-label="Atanan Teknisyen" className="px-3 py-2">
                                {hasTech ? (
                                  <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-[9px] font-bold text-blue-700 flex-shrink-0">
                                      {tname.split(' ').filter(Boolean).slice(0, 2).map((n: string) => n[0]).join('')}
                                    </div>
                                    <span className="font-semibold text-gray-900 text-xs">{tname}</span>
                                  </div>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 text-[10px] font-bold">
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" /></svg>
                                    Atanmadı
                                  </span>
                                )}
                              </td>
                              {/* Aktarım artık kaydı bölmüyor; satırın sahada olup olmadığı
                                  yalnızca bu damgadan anlaşılır. */}
                              <td data-mobile-hide data-label="Aktarım" className="px-3 py-2 whitespace-nowrap">
                                {(t.transferredAt ?? t.TransferredAt) ? (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">
                                    Sahada · {new Date(t.transferredAt ?? t.TransferredAt).toLocaleDateString('tr-TR')}
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-500">
                                    Planlamada
                                  </span>
                                )}
                              </td>
                              <td data-label="Durum" className="px-3 py-2">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${sc.color}`}>
                                  {sc.label}
                                </span>
                              </td>
                              <td data-label="Planlanan Tarih" className="px-3 py-2 text-gray-600">{(t.plannedAt || t.plannedDate) ? new Date(t.plannedAt || t.plannedDate).toLocaleDateString('tr-TR') : '-'}</td>
                              <td data-mobile-hide data-label="Oluşturulma Tarihi" className="px-3 py-2 text-gray-500">{(t.createdAt || t.CreatedAt) ? new Date(t.createdAt || t.CreatedAt).toLocaleDateString('tr-TR') : '-'}</td>
                              <td data-label="Atama Adresi" className="px-3 py-2 max-w-[220px]">
                                {hasAddress ? (
                                  <div className="flex items-start gap-1.5">
                                    <svg className="w-3 h-3 mt-0.5 text-orange-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                    <span className="text-orange-700 font-medium text-[11px] leading-tight" title={taddr}>{taddr.length > 50 ? `${taddr.slice(0, 50)}…` : taddr}</span>
                                  </div>
                                ) : (
                                  <span className="text-gray-300 text-[10px] italic">Belirtilmedi</span>
                                )}
                              </td>
                              <td data-mobile-hide data-label="Not / Açıklama" className="px-3 py-2 text-gray-600 font-medium max-w-[200px] truncate" title={t.notes || t.Notes || ''}>{t.notes || t.Notes || '-'}</td>
                              <td data-mobile-hide data-label="İşlem" className="px-3 py-2 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  {/* "Gerçekleşti" işlemi ayrı bir yeşil butonda YOK — "İşlem Yap"
                                      açtığı Kalem İşlemi modalındaki Durum listesinde zaten var,
                                      iki ayrı yoldan aynı işi yapmak kafa karıştırıyordu. Kalemin
                                      o anki durumu da soldaki "Durum" sütununda görünüyor. */}
                                  {canViewHistory && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setGecmisRecordId(record.id)
                                        setGecmisTaskId(String(t.id ?? t.Id ?? ''))
                                      }}
                                      className="p-1 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-full transition-colors"
                                      title="Geçmişi Gör"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                    </button>
                                  )}
                                  {/* KALEM ÇEKMECESİ ARTIK PLANLAMA SEKMESİNDE DE AÇILIYOR
                                      (2026-09-17 kullanıcı isteği). Eskiden yalnızca sahadaki
                                      satırda vardı; sahaya aktarılmadan yapılmış ya da sisteme
                                      geç girilen işlerin durumu işlenemiyordu. Çekmecede işlem
                                      tarihi seçilebiliyor. Teknisyen/planlanan gün yine "Planla"
                                      modalından değişir. */}
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); openDetail(record, t) }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-[#B91C1C] hover:border-red-200 transition-colors whitespace-nowrap"
                                  >
                                    <MoreHorizontal className="w-3.5 h-3.5" />
                                    İşlem Yap
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                    </>
                    )
                  })()
                )}
              </div>
              )
            }}
          />
          )}
          </>
        )}


      </div>

      {/* Bölgesel yoğunluk — YALNIZCA PLANLAMA sekmesinde.
          Teslimattakiler'de kaldırıldı (kullanıcı isteği): orada iş zaten dağıtılmış oluyor,
          bölge kırılımı karar vermeye katkı sağlamadan ekranın altını dolduruyordu. */}
      {activeTab === 'bekleyen' && (
      <div className="mt-6">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Bölgesel Montaj Yoğunluğu</h3>
          <div className="space-y-4">
            {regionDistribution.map((item) => (
              <div key={item.region}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-gray-700">{item.region}</span>
                  <span className="font-medium text-gray-900">{item.count} adet</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-[#B91C1C] to-[#DC2626] rounded-full" style={{ width: `${item.percent}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      )}

      {/* "Yeni Montaj" modalı buradaydı — kaldırıldı.
          Kaydı eski yoldan açıyordu: miktarı problemDescription içine "Miktar: N" diye
          metin olarak yazıyor, hiç KALEM (ServiceRecordItem) üretmiyordu. Kalem eksenine
          geçtikten sonra bu, planlanamayan bozuk kayıt demek. Yeni kayıt Montaj Kabul'de
          açılır; bu ekranın adresi oraya yönlendiriyor. */}

      {drawerOpen && selectedRecord && selectedTaskForDetail && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => { setDrawerOpen(false); setSelectedTaskForDetail(null); setSelectedRecordForDetail(null) }} />
          <div className="fixed right-0 top-0 bottom-0 pt-safe pb-safe w-full max-w-lg bg-white z-50 shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-300">
            <div className="p-4 sm:p-6 border-b border-gray-100 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Kalem İşlemi</h2>
                <div className="text-xs text-gray-500">{selectedRecord.serviceNumber}</div>
              </div>
              <button onClick={() => { setDrawerOpen(false); setSelectedTaskForDetail(null); setSelectedRecordForDetail(null) }} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-6">
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="text-sm font-semibold text-gray-900">{selectedRecord.customerName || '-'}</div>
                <div className="text-xs text-gray-500 mt-1">{selectedRecord.regionName || '-'}</div>
                <div className="text-sm text-gray-700 mt-2">{selectedProductName}</div>
                {selectedProductSerial ? (
                  <div className="text-[10px] text-gray-500 mt-0.5">SN: {selectedProductSerial}</div>
                ) : null}
              </div>

              {actionSuccess ? (
                <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 text-xs font-semibold text-green-700">{actionSuccess}</div>
              ) : null}
              {actionError ? (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-xs font-semibold text-red-600">{actionError}</div>
              ) : null}

              <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-4">
                {(() => {
                  const rawStatus = selectedTaskForDetail.status ?? selectedTaskForDetail.Status
                  const statusInfo = taskStatusConfig[rawStatus] ?? { label: String(rawStatus || '-'), color: 'bg-gray-100 text-gray-700', value: String(rawStatus || 'Planned') }
                  const taskId = String(selectedTaskForDetail.id ?? selectedTaskForDetail.Id ?? '')
                  return (
                    <>
                      <div className="rounded-lg bg-gray-50 px-3 py-3">
                        <div className="text-sm font-semibold text-gray-900">Seçili Kalem</div>
                        <div className="text-xs text-gray-500 mt-1">
                          {selectedTaskForDetail.technicianName ?? selectedTaskForDetail.TechnicianName ?? 'Atanmadı'} • Miktar: {selectedTaskForDetail.quantity ?? selectedTaskForDetail.Quantity ?? 1}
                        </div>
                        <span className={`mt-2 inline-flex rounded px-2 py-0.5 text-[10px] font-bold ${statusInfo.color}`}>{statusInfo.label}</span>
                      </div>

                      <div className="space-y-1">
                        <div className="text-xs font-semibold text-gray-500">Bu Kalemin Notu / Barkod</div>
                        <textarea
                          value={statusNote}
                          onChange={(e) => setStatusNote(e.target.value)}
                          placeholder="Yapılan işlem, ek bilgi veya not..."
                          className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full min-h-[90px] resize-none"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={scanProductBarcodeIntoNote}
                        className="w-full py-2 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Ürün Barkodu Okut
                      </button>

                      {/* Görsel Yükleme ve Önizleme */}
                      <div className="space-y-2 border-t pt-4">
                        <div className="text-xs font-semibold text-gray-500">Görsel</div>
                        {(() => {
                          const rawUrl = selectedTaskForDetail.photoUrl || selectedTaskForDetail.PhotoUrl || ''
                          let urls = rawUrl.split(',').filter(Boolean)
                          let isDefaultRecordPhoto = false
                          if (urls.length === 0 && selectedRecord) {
                            const recPhoto = selectedRecord.photoUrls?.[0] || selectedRecord.PhotoUrls?.[0]
                            if (recPhoto) {
                              urls = [recPhoto]
                              isDefaultRecordPhoto = true
                            }
                          }
                          if (urls.length > 0) {
                            const currentUrl = urls[drawerPhotoIdx] || urls[0]
                            const fullUrl = currentUrl.startsWith('http') ? currentUrl : `${API_BASE_URL}${currentUrl}`
                            return (
                              <div className="relative group max-w-xs overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800 bg-white mb-2">
                                <img
                                  src={fullUrl}
                                  alt="Kalem Görseli"
                                  className="w-full h-auto max-h-48 object-cover cursor-zoom-in hover:scale-105 transition-transform duration-200"
                                  onClick={() => {
                                    setBuyutulenGorseller(urls.map((u: string) =>
                                      u.startsWith('http') || u.startsWith('data:') ? u : `${API_BASE_URL}${u}`))
                                    setBuyutulenIdx(drawerPhotoIdx < urls.length ? drawerPhotoIdx : 0)
                                  }}
                                />
                                {isDefaultRecordPhoto && (
                                  <div className="absolute top-2 left-2 bg-blue-600/90 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm select-none z-10">
                                    Kayıt Görseli (Varsayılan)
                                  </div>
                                )}

                                {/*
                                  GÖRSEL SİLME (2026-08-24, kullanıcı: "fotoğraf silme yok,
                                  bunu nasıl sileceğim").

                                  Varsayılan KAYIT görselinde bilerek GÖSTERİLMİYOR: o görsel
                                  bu kaleme ait değil, arıza kaydının kendisine ait. Buradan
                                  silinseydi kalemle ilgisi olmayan bir belge yok edilirdi.
                                */}
                                {!isDefaultRecordPhoto && (
                                  <button
                                    type="button"
                                    title="Bu görseli sil"
                                    disabled={photoDeleting}
                                    onClick={async (e) => {
                                      e.stopPropagation()
                                      const taskId = selectedTaskForDetail.id || selectedTaskForDetail.Id
                                      if (!taskId) return
                                      // Geri alınamaz: dosya sunucudan da siliniyor.
                                      if (!window.confirm(`Bu görsel kalıcı olarak silinsin mi? (${drawerPhotoIdx + 1} / ${urls.length})`)) return

                                      setPhotoDeleting(true)
                                      setActionError(null)
                                      setActionSuccess(null)
                                      try {
                                        const { remaining } = await deleteInstallationTaskPhoto(taskId, currentUrl)
                                        const kalanMetin = remaining.join(',')
                                        setSelectedTaskForDetail((prev: any) => prev ? { ...prev, photoUrl: kalanMetin, PhotoUrl: kalanMetin } : prev)
                                        setExpandedTasks((prev: any) => prev.map((t: any) => (t.id === taskId || t.Id === taskId) ? { ...t, photoUrl: kalanMetin, PhotoUrl: kalanMetin } : t))
                                        // Silinen son görselse imleç listenin dışında kalırdı.
                                        setDrawerPhotoIdx((prev) => Math.max(0, Math.min(prev, remaining.length - 1)))
                                        setActionSuccess('Görsel silindi.')
                                      } catch (err: any) {
                                        setActionError(String(err?.message ?? 'Görsel silinemedi'))
                                      } finally {
                                        setPhotoDeleting(false)
                                      }
                                    }}
                                    className={
                                      'absolute top-2 right-2 rounded-full p-1.5 shadow z-10 transition-colors ' +
                                      (photoDeleting ? 'bg-gray-400 text-white' : 'bg-red-600 text-white hover:bg-red-700')
                                    }
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {urls.length > 1 && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setDrawerPhotoIdx((prev) => (prev === 0 ? urls.length - 1 : prev - 1))
                                      }}
                                      className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1 transition-colors z-10"
                                    >
                                      <ChevronLeft className="w-4 h-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setDrawerPhotoIdx((prev) => (prev === urls.length - 1 ? 0 : prev + 1))
                                      }}
                                      className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1 transition-colors z-10"
                                    >
                                      <ChevronRight className="w-4 h-4" />
                                    </button>
                                    <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded font-medium select-none z-10">
                                      {drawerPhotoIdx + 1} / {urls.length}
                                    </div>
                                  </>
                                )}
                              </div>
                            )
                          }
                          return <div className="text-xs text-gray-400 italic mb-2">Fotoğraf yüklenmemiş.</div>
                        })()}
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
                          onChange={async (e) => {
                            const files = Array.from(e.target.files || [])
                            const taskId = selectedTaskForDetail.id || selectedTaskForDetail.Id
                            if (files.length === 0 || !taskId) return
                            setActionLoading(true)
                            setActionError(null)
                            setActionSuccess(null)
                            let finalUrl = selectedTaskForDetail.photoUrl || selectedTaskForDetail.PhotoUrl || ''
                            try {
                              for (const file of files) {
                                const res = await uploadInstallationTaskPhoto(taskId, file)
                                const uploadedUrl = res.url || ''
                                if (uploadedUrl) {
                                  finalUrl = finalUrl ? `${finalUrl},${uploadedUrl}` : uploadedUrl
                                }
                              }
                              setActionSuccess(`${files.length} fotoğraf başarıyla eklendi.`)
                              setSelectedTaskForDetail((prev: any) => prev ? { ...prev, photoUrl: finalUrl, PhotoUrl: finalUrl } : prev)
                              setExpandedTasks((prev: any) => prev.map((t: any) => (t.id === taskId || t.Id === taskId) ? { ...t, photoUrl: finalUrl, PhotoUrl: finalUrl } : t))
                            } catch (err: any) {
                              setActionError(String(err?.message ?? 'Fotoğraflar yüklenemedi'))
                            } finally {
                              setActionLoading(false)
                              e.currentTarget.value = ''
                            }
                          }}
                        />
                      </div>

                      {/*
                        DURUM ARTIK AÇILIR LİSTE + "Kalemi Güncelle" DEĞİL, HER DURUM AYRI DÜĞME
                        (2026-08-27 kullanıcı isteği: "direk tüm butonlar ayrı ayrı olsun,
                        basınca kalem güncelle yerine geçsin, her buton ayrı renk olsun ki
                        kafaları karışmasın").

                        İki tıklık iş (önce listeden seç, sonra güncelle) tek tığa indi; sahada
                        telefonla çalışılırken açılır liste hem küçük hem de seçtiğini
                        göstermiyordu.

                        RENKLER UYDURULMADI: `STATE_COLORS` durum rozetlerinin de kaynağı, yani
                        tablodaki "Gerçekleşti" rozeti hangi renkse buradaki düğme de o renk.
                        Ayrı bir palet yazılsaydı aynı durum iki yerde iki renk olurdu.

                        Sebep zorunlu olan iki durumun (İptal / Ulaşılamadı) düğmesi not
                        yazılana kadar KİLİTLİ: sunucu sebepsiz 400 dönüyor.
                      */}
                      {/* İŞLEM TARİHİ: geçmişe dönük eksik girilen işler için. Gelecek gün
                          seçilemez; bugün bırakılırsa sunucu şu anı yazar. "Gerçekleşti"de
                          tamamlanma (hak ediş) tarihi olur. */}
                      <div className="space-y-1">
                        <div className="text-xs font-semibold text-gray-500">İşlem Tarihi</div>
                        <input
                          type="date"
                          value={statusDay}
                          max={bugunIso()}
                          onChange={(e) => setStatusDay(e.target.value && e.target.value <= bugunIso() ? e.target.value : bugunIso())}
                          className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full"
                        />
                        {statusDay < bugunIso() && (
                          <div className="text-[11px] font-semibold text-amber-700">
                            Geçmiş tarihli işlem: durum {new Date(`${statusDay}T12:00:00`).toLocaleDateString('tr-TR')} tarihiyle işlenir.
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-gray-500">Durum — basınca doğrudan uygulanır</div>
                        <div className="grid grid-cols-2 gap-2">
                          {taskStatusOptions.map((opt) => {
                            const kilitli = REASON_REQUIRED_STATUSES.has(opt.value) && !statusNote.trim()
                            const calisiyor = taskActionId === taskId
                            const mevcut = statusInfo.value === opt.value
                            const renk = STATE_COLORS[opt.value] ?? 'bg-gray-100 text-gray-700 border-gray-200'
                            return (
                              <button
                                key={opt.value}
                                type="button"
                                disabled={calisiyor || kilitli}
                                title={kilitli ? 'Bu durum için önce not/sebep yazın' : undefined}
                                onClick={() =>
                                  changeTaskStatus(
                                    selectedTaskForDetail,
                                    opt.value,
                                    // NOT UYDURULMAZ. Buraya "Montaj kalemi durumu güncellendi."
                                    // diye bir yer tutucu yazılıyordu ve planlamada girilen
                                    // açıklamanın ÜSTÜNE biniyordu (MONTAJ-DEVIR §8.1).
                                    statusNote,
                                    statusAddress || selectedTaskForDetail.customAddress || selectedTaskForDetail.CustomAddress || '',
                                    statusDay
                                  )
                                }
                                className={
                                  'px-3 py-2.5 rounded-xl text-xs font-bold border text-left leading-tight transition ' +
                                  (calisiyor || kilitli
                                    ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                                    : `${renk} hover:brightness-95 cursor-pointer`) +
                                  (mevcut ? ' ring-2 ring-offset-1 ring-gray-400' : '')
                                }
                              >
                                {STATE_LABELS[opt.value] ?? opt.value}
                                {mevcut && <span className="block text-[9px] font-semibold opacity-70 mt-0.5">şu anki durum</span>}
                                {kilitli && <span className="block text-[9px] font-semibold mt-0.5">sebep gerekli</span>}
                              </button>
                            )
                          })}
                        </div>
                        {taskActionId === taskId && (
                          <div className="text-[11px] font-semibold text-gray-500 pt-1">Güncelleniyor…</div>
                        )}
                      </div>
                    </>
                  )
                })()}
              </div>



            </div>
          </div>
        </>
      )}


      {/* "Atanan Teknisyenler" modalı buradaydı: onu açan hiçbir şey yoktu (techModalOpen hiç
          true olmuyordu). Atanan kişiler zaten tablodaki "Atanan / Tarih" sütununda ve kalem
          çekmecesinde görünüyor. */}

      {geriGonderTarget && (
        <>
          <div
            className="fixed inset-0 bg-black/30 z-[60]"
            onClick={() => { if (!geriGonderLoading) setGeriGonderTarget(null) }}
          />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
              <div className="p-5 border-b border-gray-100">
                <div className="text-base font-bold text-gray-900">Planlamaya Geri Gönder</div>
              </div>
              <div className="p-5 space-y-3">
                {(() => {
                  const openCount = geriGonderTarget.transferredTaskIds.length
                  const doneCount = geriGonderTarget.completedTransferredTaskIds.length
                  const willRevert = openCount + (geriGonderCompleted ? doneCount : 0)
                  return (
                    <>
                      <p className="text-sm text-gray-600">
                        <span className="font-mono font-semibold text-gray-900">{geriGonderTarget.serviceNumber}</span> kaydının
                        <span className="font-semibold text-gray-900"> {geriGonderTarget.productName} </span>
                        kalemindeki <span className="font-semibold text-gray-900">{willRevert} satır</span> sahadan
                        geri alınıp planlamaya dönecek. Aynı kaydın diğer kalemleri sahada kalır.
                      </p>

                      {/* GERÇEKLEŞMİŞ SATIRLAR AYRI ONAY İSTER.
                          Aktarımı geri almak ile yapılmış işi geri almak aynı şey değil. Ama
                          satırların hepsi tamamlanmışsa (sahada iş bitmiş, sonra "yanlış girildi"
                          denmiş) bu kutu olmadan buton HİÇBİR ŞEY yapmıyordu. */}
                      {doneCount > 0 && (
                        <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={geriGonderCompleted}
                            onChange={(e) => setGeriGonderCompleted(e.target.checked)}
                            className="mt-0.5 rounded border-amber-300 text-amber-700 focus:ring-amber-500"
                          />
                          <span className="text-xs text-amber-900 leading-relaxed">
                            <span className="font-bold">Gerçekleşmiş {doneCount} satırı da geri al.</span>{' '}
                            Yapılmış iş işaretlenmemiş sayılır ve bu satırların <span className="font-semibold">hak edişi iptal edilir</span>.
                          </span>
                        </label>
                      )}

                      {openCount === 0 && doneCount > 0 && !geriGonderCompleted && (
                        <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600">
                          Bu kalemin sahadaki satırlarının hepsi gerçekleşmiş durumda. Geri almak için
                          yukarıdaki kutuyu işaretleyin.
                        </div>
                      )}

                      {geriGonderError && (
                        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs font-semibold text-red-600">{geriGonderError}</div>
                      )}
                    </>
                  )
                })()}
              </div>
              <div className="p-4 border-t border-gray-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={geriGonderLoading}
                  onClick={() => setGeriGonderTarget(null)}
                  className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  disabled={
                    geriGonderLoading ||
                    // Geri alınacak satır yoksa buton çalışmamalı: eskiden basılabiliyor, istek
                    // gidiyor, sunucu hiçbir şey yapmadan başarı dönüyordu.
                    (geriGonderTarget.transferredTaskIds.length +
                      (geriGonderCompleted ? geriGonderTarget.completedTransferredTaskIds.length : 0)) === 0
                  }
                  onClick={async () => {
                    setGeriGonderLoading(true)
                    setGeriGonderError(null)
                    try {
                      // taskIds gönderilmesi şart: sunucu boş gelirse kaydın SAHADAKİ TÜM
                      // satırlarını geri alır, oysa burada geri alınan tek bir kalem.
                      const ids = [
                        ...geriGonderTarget.transferredTaskIds,
                        ...(geriGonderCompleted ? geriGonderTarget.completedTransferredTaskIds : []),
                      ]
                      await apiJson(`/api/servicerecords/${geriGonderTarget.recordId}/status`, {
                        method: 'PATCH',
                        body: JSON.stringify({
                          status: 'Planned',
                          taskIds: ids,
                          includeCompleted: geriGonderCompleted,
                          notes: `"${geriGonderTarget.productName}" kalemi sahadan planlamaya geri çekildi.`
                        })
                      })
                      await refetch()
                      await reloadExpanded()
                      setActionSuccess(`${ids.length} satır planlamaya geri alındı.`)
                      setGeriGonderTarget(null)
                    } catch (err: any) {
                      setGeriGonderError(String(err?.message ?? 'Geri çekme işlemi başarısız'))
                    } finally {
                      setGeriGonderLoading(false)
                    }
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-bold text-white ${geriGonderLoading ? 'bg-gray-300' : 'bg-orange-600 hover:bg-orange-700'} disabled:bg-gray-300`}
                >
                  {geriGonderLoading ? 'Gönderiliyor...' : 'Evet, Geri Gönder'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <ServisGecmisiModal
        recordId={gecmisRecordId}
        taskId={gecmisTaskId}
        onClose={() => { setGecmisRecordId(null); setGecmisTaskId(null) }}
      />

      <ServisFisiModal
        isOpen={fisModalOpen}
        record={fisRecord}
        itemId={fisItemId}
        onClose={() => { setFisModalOpen(false); setFisItemId(null); }}
        onMarkPrinted={markAsPrinted}
        onPrint={(rec, tasks) => {
          printServiceSlip(rec, tasks)
        }}
        onChanged={refetch}
      />


      <FaturaPlanlamaModal
        isOpen={planlamaOpen}
        record={planlamaRecord}
        focusItemId={planlamaItemId}
        technicians={technicians}
        onClose={() => { setPlanlamaOpen(false); setPlanlamaRecord(null); setPlanlamaItemId(null) }}
        onChanged={async () => {
          await refetch()
          await reloadExpanded()
        }}
        onPrintSlip={async (rec, itemId) => {
          const taskData = await apiJson<any[]>(`/api/installations/tasks?serviceId=${rec.id}`)
          const grouped = groupTasks(slipTasks(taskData, itemId), itemId)
          // Basılan fişin İŞ EMRİ de açılır; yoksa Sahaya Aktar "fiş oluşturulmadı" deyip
          // kullanıcıyı aynı fişi ikinci kez oluşturmaya gönderiyordu.
          await ensureWorkOrders(rec, grouped)
          // Damga basılan KALEME düşer; yoksa aynı faturanın diğer kalemleri de basılmış görünür.
          await markAsPrinted(rec.id, itemId ?? null)
          printServiceSlip(rec, grouped)
          await refetch()
          await reloadExpanded()
        }}
        onOpenSahayaAktar={(rec, itemId) => {
          // Planlama kapanır, aktarım açılır: aynı akışın bir sonraki adımı.
          setPlanlamaOpen(false)
          setPlanlamaRecord(null)
          setPlanlamaItemId(null)
          setActionError(null)
          setActionSuccess(null)
          setAktarimRecord(rec)
          setAktarimItemId(itemId ?? null)
          setAktarimOpen(true)
        }}
      />

      <SahayaAktarModal
        isOpen={aktarimOpen}
        record={aktarimRecord}
        focusItemId={aktarimItemId}
        technicians={technicians}
        onClose={() => { setAktarimOpen(false); setAktarimRecord(null); setAktarimItemId(null) }}
        onTransferred={async () => {
          setActionSuccess('Seçilen satırlar sahaya aktarıldı.')
          await refetch()
          await reloadExpanded()
        }}
        onOpenServisFisi={(rec, itemId) => {
          // Yalnızca fiş HİÇ YOKSA buraya düşülür; oluşturmak form gerektiriyor.
          setAktarimOpen(false)
          openServisFisi(rec, itemId || undefined)
        }}
        onPrintSlip={async (rec, itemId) => {
          // Fiş var ama basılmamış: yazdırmayı burada bitiriyoruz ki aktarım modalı kapanmasın
          // ve kullanıcı planla → yazdır → aktar akışını tek ekranda tamamlasın.
          const taskData = await apiJson<any[]>(`/api/installations/tasks?serviceId=${rec.id}`)
          const grouped = groupTasks(slipTasks(taskData, itemId), itemId)
          // Fiş hiç oluşturulmamışsa burada açılır (bkz. ensureWorkOrders).
          await ensureWorkOrders(rec, grouped)
          // Damga ÖNCE atılıyor: yazdırma penceresi açıldıktan sonra kod akışı geri gelmeyebilir
          // (native yazdırma ekranı), damga o durumda hiç yazılmazdı.
          await markAsPrinted(rec.id, itemId ?? null)
          printServiceSlip(rec, grouped)
          await refetch()
          await reloadExpanded()
        }}
      />

      <MontajIptalModal
        open={!!cancelRow}
        onClose={() => setCancelRow(null)}
        onConfirm={confirmCancel}
        serviceNumber={cancelRow?.serviceNumber}
        productName={cancelRow?.productName}
        quantity={cancelRow?.quantity}
        customerName={cancelRow?.customerName}
        transferredQuantity={cancelRow?.transferredQuantity}
        completedQuantity={cancelRow?.completedQuantity}
      />
      </div>
      {/* Geçmiş görsellerinin büyütülmesi; tıklanan fotoğrafın sırası ile açılır. */}
      <GorselOnizleyici
        gorseller={buyutulenGorseller}
        acikIndex={buyutulenIdx}
        onKapat={() => setBuyutulenIdx(null)}
      />
    </>

  )
}
