import { useState, useEffect, useCallback, useRef } from 'react'
import { sekmeGorunur } from '../utils/sekmeGorunur'
import { apiJson } from '../api/client'
import { keepWorkshopEnteredAt } from '../utils/atolyeGun'
import { describeNextStatusChange, statusLabel } from '../api/statusChangeGate'
import { getTechnicianId, isTechnicianSession } from '../auth/storage'
import { fetchErpDealers, type ErpDealerDto } from '../api/erp'

let cachedDealers: ErpDealerDto[] | null = null
let fetchPromise: Promise<ErpDealerDto[]> | null = null

/*
  AD→KOD HARİTASI OTURUM BOYUNCA SAKLANIR (2026-08-26, ölçüm: Saha Arıza açılışı
  4,5 MB / 7,57 sn; bunun 1,3 MB'ı ve ~5 sn'si bu istek).

  `getDealersMap` bütün cari listesini (`/api/erp/dealers?type=all`) yalnızca satırdaki
  bayi adının sonuna `(kod)` eklemek için indiriyor. Modül içi `cachedDealers` bunu
  gezinme boyunca tutuyor ama HER TAM SAYFA YENİLEMESİNDE sıfırlanıyor: kullanıcı her
  Ctrl+F5'te 1,3 MB'ı yeniden indiriyordu.

  İndirilen 1,3 MB'ın işe yarayan kısmı yalnızca ad→kod eşlemesi. O yüzden listenin
  kendisi değil, ÜRETİLEN HARİTA `sessionStorage`'a yazılıyor: aynı oturumdaki sonraki
  açılışlar isteği hiç atmıyor.

  Süre sınırlı: yeni açılan bir cari en geç yarım saat içinde haritaya girer. O ana kadarki
  tek etki, o carinin adının yanında kodun görünmemesi — kozmetik ve kendiliğinden düzelir.
*/
const HARITA_ANAHTAR = 'erp_bayi_ad_kod_v1'
const HARITA_TAZE_MS = 30 * 60_000

function haritayiOku(): Record<string, string> | null {
  try {
    const ham = sessionStorage.getItem(HARITA_ANAHTAR)
    if (!ham) return null
    const kayit = JSON.parse(ham)
    if (!kayit || typeof kayit !== 'object') return null
    if (Date.now() - Number(kayit.zaman ?? 0) > HARITA_TAZE_MS) return null
    return kayit.harita && typeof kayit.harita === 'object' ? kayit.harita : null
  } catch { return null }
}

function haritayiYaz(harita: Record<string, string>): void {
  try {
    sessionStorage.setItem(HARITA_ANAHTAR, JSON.stringify({ zaman: Date.now(), harita }))
  } catch { /* kota dolu / gizli mod: önbellek olmadan da çalışır */ }
}

async function getDealersMap(): Promise<Record<string, string>> {
  const saklanan = haritayiOku()
  if (saklanan) return saklanan

  if (cachedDealers) {
    const map: Record<string, string> = {}
    for (const d of cachedDealers) {
      if (d.name) {
        map[d.name.toLowerCase().trim()] = d.customerCode
      }
    }
    return map
  }

  if (!fetchPromise) {
    // Kayıtlardaki bayi adı bayi/mağaza/müşteri carilerinden herhangi biri olabilir,
    // bu yüzden ad→kod eşlemesi için üç tipin tamamı gerekiyor.
    fetchPromise = fetchErpDealers(undefined, undefined, 'all')
      .then(dealers => {
        cachedDealers = dealers
        return dealers
      })
      .catch(err => {
        console.error('[useServiceRecords] Failed to fetch dealers for lookup:', err)
        fetchPromise = null
        return []
      })
  }

  const list = await fetchPromise
  const map: Record<string, string> = {}
  for (const d of list) {
    if (d.name) {
      map[d.name.toLowerCase().trim()] = d.customerCode
    }
  }
  if (Object.keys(map).length > 0) haritayiYaz(map)
  return map
}

async function mapRecordDealers(record: ServiceRecord, dealersMap: Record<string, string>): Promise<ServiceRecord> {
  if (record.dealerName) {
    const cleaned = record.dealerName.trim()
    const code = dealersMap[cleaned.toLowerCase()]
    if (code && !cleaned.includes(`(${code})`)) {
      return { ...record, dealerName: `${cleaned} (${code})` }
    }
  }
  return record
}

async function mapRecordsDealers(records: ServiceRecord[]): Promise<ServiceRecord[]> {
  try {
    const map = await getDealersMap()
    return records.map(r => {
      if (r.dealerName) {
        const cleaned = r.dealerName.trim()
        const code = map[cleaned.toLowerCase()]
        if (code && !cleaned.includes(`(${code})`)) {
          return { ...r, dealerName: `${cleaned} (${code})` }
        }
      }
      return r
    })
  } catch {
    return records
  }
}


export interface ServiceRecord {
  id: string
  serviceNumber: string
  /** Kağıt fiş numarası — elle girilir, `serviceNumber`'dan (AT-/SH-) ayrıdır. */
  manualReceiptNo?: string | null
  status: string
  statusLabel: string
  /** Kaydın son işlem anı; durum tarihi bundan yazılır (2026-09-18). */
  updatedAt?: string | null
  /** İş kapandıysa kapanış anı — geriye dönük işlenen işte SEÇİLEN gün. */
  completedAt?: string | null
  /** Ürünün İLK kez atölyeye alındığı an; hiç girmediyse boş (bkz. utils/atolyeGun). */
  workshopEnteredAt?: string | null
  type: string
  typeLabel: string
  createdAt: string
  estimatedDeliveryDate?: string
  plannedAt?: string
  customerName?: string
  customerPhone?: string
  customerAddress?: string
  latitude?: number
  longitude?: number
  productName: string
  productStockCode?: string | null
  serialNumber?: string
  isUnderWarranty: boolean
  /** Teslim alma kaynağı; 1 = Mağazadan. Bkz. utils/customerType.ts */
  pickupSourceId?: number | null
  /** Garanti başlangıç tarihi (ISO). Garanti yoksa boştur — bkz. utils/garanti.ts */
  warrantyStartDate?: string | null
  dealerName?: string
  dealerCode?: string
  dealerPhone?: string
  dealerAddress?: string
  assignedTechnicianId?: string
  assignedTechnicianName?: string
  /**
   * Kayda bağlı BÜTÜN teknisyenler (`ServiceRecordDto.AssignedTechnicians`). Montaj kayıtlarında
   * kişi kaydın üzerinde değil planlama satırlarında durur; sunucu ikisini de doldurur.
   * Sunucu en baştan gönderiyordu, tipte eksikti.
   */
  assignedTechnicians?: string[] | null
  assignedTechnicianAvatar?: string
  regionId?: string
  regionName?: string
  priority: string
  priorityLabel: string
  problemDescription?: string
  receivingNote?: string
  lastAction?: string
  userRouteTick?: boolean
  userRouteHour?: string
  userRouteSortOrder?: number
  routeOrder?: number
  plannedStartTime?: string
  plannedEndTime?: string
  routeDate?: string
  technicianId?: string
  isPrinted?: boolean
  /** Servis faturası kesildi mi ve hangi numarayla. Sunucu tekilliği garanti eder; bu, ekranda göstermek için. */
  isInvoiced?: boolean
  invoiceReference?: string | null
  satisfactionScore?: number
  satisfactionNotes?: string
  customerType?: string
  satisfactionBy?: string
  satisfactionCreatedAt?: string
  installationType?: string
  hasWorkOrder?: boolean
  /** Montaj kalemleri — planlama bunların üzerinden yapılır. */
  items?: ServiceRecordItem[]
  /**
   * Kaydın planlama satırları (1 adetlik görevler). Sunucu bunu zaten dönüyordu ama tipte yoktu,
   * bu yüzden Montaj Planlama listesi kalem başına "kaç adedi planlandı, kime, hangi güne"
   * bilgisini göstermek için satır satır ayrıca istek atmak zorunda kalıyordu.
   */
  installationTasks?: ServiceRecordInstallationTask[]
  /** Kalemlerin miktar toplamı; eski "Miktar: N" metninin yerini alır. */
  totalQuantity?: number
}

export interface ServiceRecordItem {
  id: string
  productName: string
  productStockCode?: string | null
  serialNumber?: string | null
  quantity: number
  notes?: string | null
  sortOrder: number
  /** Kalemin kendi montaj adresi; boşsa kaydın müşteri bilgisi geçerlidir. */
  customerName?: string | null
  customerPhone?: string | null
  customerAddress?: string | null
  externalRef?: string | null
  /** Dolu ise kalem iptal edildi. İptal kalem seviyesinde: kaydın diğer kalemleri işlemeye devam eder. */
  cancelledAt?: string | null
  cancelReason?: string | null
  /** Bu KALEMİN servis fişinin son basım anı; hiç basılmadıysa boş.
   *  Kaydın `isPrinted` bayrağıyla karıştırma: o kayıt geneli ve sahaya aktarım kilidi. */
  slipPrintedAt?: string | null
}

/** Liste yanıtındaki planlama satırı (`ServiceRecordDto.InstallationTasks`). */
export interface ServiceRecordInstallationTask {
  id: string
  assignedTechnicianId?: string | null
  assignedTechnicianName?: string | null
  plannedAt?: string | null
  /** Sunucu sayı döner (0 Planned, 1 InProgress, 2 Completed, 3 Cancelled, 4 Deferred). */
  status: number
  statusLabel: string
  quantity: number
  notes?: string | null
  customAddress?: string | null
  photoUrl?: string | null
  serialNumber?: string | null
  serviceRecordItemId?: string | null
  itemProductName?: string | null
  /**
   * Satır sahaya aktarıldıysa aktarım anı, aktarılmadıysa boş.
   *
   * Planlama ve Teslimattakiler ayrımı artık buradan çıkıyor. Eskiden ayrım kaydın durumundaydı
   * ve kısmen aktarılan kayıt MNT-xxxxxxx-N diye ikiye bölünüyordu; bölme kaldırıldı.
   */
  transferredAt?: string | null
  /** Gerçekleşme anı. Geriye dönük işlenen işte SEÇİLEN gün (bkz. EffectiveDate). */
  completedAt?: string | null
  /** Satıra en son ne zaman dokunuldu — gerçekleşmemiş satırların "durum tarihi". */
  updatedAt?: string | null
}

interface UseServiceRecordsOptions {
  status?: string
  technicianId?: string
  regionId?: string
  plannedFrom?: string
  plannedTo?: string
}

export interface ServiceRecordQuery {
  q?: string
  status?: string
  statuses?: string
  type?: string
  technicianId?: string
  regionId?: string
  dateFrom?: string
  dateTo?: string
  /**
   * Tek bir PLANLANAN gün ('YYYY-MM-DD').
   *
   * dateFrom/dateTo kaydın OLUŞTURULMA tarihine bakar; Saha Planlaması ise "bugün yapılacak
   * işler" ekranıdır. İkisi karıştırılınca geçen hafta açılıp bugüne planlanan iş listede
   * çıkmıyor, bugün açılıp haftaya planlanan iş çıkıyordu.
   */
  plannedDate?: string
  /**
   * PLANLANAN gün aralığı ('YYYY-MM-DD').
   *
   * `plannedDate` tek gün sorar; gün bazlı ekranlarda kullanıcı aralık seçtiğinde bitiş
   * tarihinin gidecek bir yeri yoktu ve sessizce atılıyordu — 03–13 arası seçmek yalnızca 03'ü
   * getiriyordu. Sunucu bu iki alanı (PlannedFrom/PlannedTo) zaten destekliyordu.
   */
  plannedFrom?: string
  plannedTo?: string
  satisfactionScore?: number
  /**
   * PASİF kayıtları da getir.
   *
   * 90 günden eski kayıtlar varsayılan listede görünmez (sunucu süzer; istemcide süzmek
   * işe yaramaz çünkü sayfalama sunucuda). Ekrandaki "Pasife Alınanları Göster" kutusu
   * bunu açar. Arama yapılırken sunucu bu süzgeci zaten uygulamaz.
   */
  includePassive?: boolean
  page?: number
  pageSize?: number
  installationType?: string
  /**
   * 'small' | 'large'. The hook has always forwarded this and the API has always accepted it
   * (ServiceRecordQueryDto.Category); it was just missing here, so every caller that filtered
   * by product size failed to compile and the büyük/küçük ürün pages could not narrow at all.
   */
  category?: string
  /**
   * Hangi sekme soruluyor ('buyukUrun.atolye' gibi).
   *
   * Kapsam sekme başına tanımlı — bir rol atölyede her şeyi, teslimatta yalnızca kendine
   * atananları görebiliyor. Sunucu hangi sekmede olduğumuzu bilmeden bu ayrımı yapamaz ve
   * sayfanın tamamı için tek bir kapsam uygulamak zorunda kalır. Sunucu değeri beyaz listeye
   * göre doğrular; buradan gelen metin tek başına yetki genişletemez.
   */
  scopeKey?: string
}

export interface PagedResult<T> {
  items: T[]
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}

interface DashboardStats {
  totalServices: number
  todayServices: number
  pendingServices: number
  completedToday: number
  statusCounts: Record<string, number>
}

export function useServiceRecords(options: UseServiceRecordsOptions = {}) {
  const [records, setRecords] = useState<ServiceRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const listSeq = useRef(0)

  // Sayfalanmış sürümdeki `fetchPaged` ile AYNI kural: arka plan yenilemesi ekranı
  // "yükleniyor"a düşürmez. Gerekçe orada yazılı.
  const fetchRecords = useCallback(async (silent = false) => {
    try {
      if (!silent) setIsLoading(true)
      const params = new URLSearchParams()
      if (options.status) params.append('status', options.status)
      const technicianId = options.technicianId
      if (technicianId) params.append('technicianId', technicianId)
      if (options.regionId) params.append('regionId', options.regionId)
      if (options.plannedFrom) params.append('plannedFrom', options.plannedFrom)
      if (options.plannedTo) params.append('plannedTo', options.plannedTo)

      // Bayi adı zenginleştirmesi listeyi bekletmez; gerekçesi useServiceRecordsPaged'te yazılı.
      const seq = ++listSeq.current
      const data = await apiJson<ServiceRecord[]>(`/api/servicerecords?${params}`)
      setRecords(data ?? [])
      setError(null)
      if (data?.length) {
        void mapRecordsDealers(data).then((mapped) => {
          if (seq === listSeq.current) setRecords(mapped)
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setRecords([])
    } finally {
      setIsLoading(false)
    }
  }, [options.status, options.technicianId, options.regionId, options.plannedFrom, options.plannedTo])

  useEffect(() => {
    fetchRecords()
    // Yedek yoklama — SignalR bağlıyken gerek kalmıyor, kopmaya karşı duruyor. Sessiz.
    const interval = setInterval(() => { if (sekmeGorunur()) fetchRecords(true) }, 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') fetchRecords(true) }
    document.addEventListener('visibilitychange', onVisible)
    // Toplu işlemde art arda gelen olaylar TEK yenilemede birleşir (2026-10-05).
    let olayZamanlayici: ReturnType<typeof setTimeout> | null = null
    const onSignalR = () => {
      if (olayZamanlayici) clearTimeout(olayZamanlayici)
      olayZamanlayici = setTimeout(() => { olayZamanlayici = null; fetchRecords(true) }, 1500)
    }
    window.addEventListener('signalr:service_record_updated', onSignalR)
    window.addEventListener('signalr:installation_updated', onSignalR)
    return () => {
      clearInterval(interval)
      if (olayZamanlayici) clearTimeout(olayZamanlayici)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('signalr:service_record_updated', onSignalR)
      window.removeEventListener('signalr:installation_updated', onSignalR)
    }
  }, [fetchRecords])

  const createRecord = async (recordData: Partial<ServiceRecord>) => {
    try {
      const newRecord = await apiJson<ServiceRecord>(`/api/servicerecords`, {
        method: 'POST',
        body: JSON.stringify(recordData)
      })
      const map = await getDealersMap()
      const mapped = await mapRecordDealers(newRecord, map)
      setRecords(prev => [mapped, ...prev])
      return mapped
    } catch (err) {
      throw err
    }
  }

  const updateStatus = async (id: string, status: string, notes?: string, performedByTechnicianId?: string) => {
    try {
      hintRecordStatusChange(records.find((r) => r.id === id), notes)
      const updated = await apiJson<ServiceRecord>(`/api/servicerecords/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, notes, performedByTechnicianId: performedByTechnicianId || undefined })
      })
      const map = await getDealersMap()
      const mapped = await mapRecordDealers(updated, map)
      setRecords(prev => prev.map(r => r.id === id ? mapped : r))
      return mapped
    } catch (err) {
      throw err
    }
  }

  const assignTechnician = async (id: string, technicianId: string) => {
    try {
      const updated = await apiJson<ServiceRecord>(`/api/servicerecords/${id}/assign`, {
        method: 'POST',
        body: JSON.stringify({ technicianId })
      })
      const map = await getDealersMap()
      const mapped = await mapRecordDealers(updated, map)
      setRecords(prev => prev.map(r => r.id === id ? mapped : r))
      return mapped
    } catch (err) {
      throw err
    }
  }

  return {
    records,
    isLoading,
    error,
    refetch: fetchRecords,
    createRecord,
    updateStatus,
    assignTechnician
  }
}

/**
 * Onay ekranına, sunucuya GİTMEYEN bağlamı taşır: kaydın şu anki durumu ve servis numarası.
 *
 * Kapı `apiFetch` içinde olduğu için gövdedeki hedef durumu zaten görüyor; "şuradan" bilgisi
 * yalnızca istemcideki listede var. Bu yüzden istek atılmadan hemen önce ipucu bırakılıyor.
 * İpucu bırakmak zorunlu değil — verilmezse özet "Mevcut durum ➔ Hedef" diye çıkar.
 */
function hintRecordStatusChange(record: ServiceRecord | undefined, notes?: string) {
  describeNextStatusChange({
    kind: 'Servis Kaydı',
    subject: record
      ? [record.serviceNumber, record.productName].filter(Boolean).join(' · ')
      : undefined,
    fromLabel: record ? (record.statusLabel || statusLabel(record.status)) : null,
    // Görsel kayıt üzerinden yükleniyor; bu çağrıyla birlikte yeni bir görsel gelmiyorsa
    // "eklemediniz" demek doğru olan — kullanıcı tam da bunu görmek istiyor.
    hasPhoto: false,
    note: notes ?? null
  })
}

export function useServiceRecordsPaged(query: ServiceRecordQuery) {
  const [result, setResult] = useState<PagedResult<ServiceRecord>>({
    items: [],
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
    totalCount: 0,
    totalPages: 0,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /**
   * Bayi adı zenginleştirmesi LİSTEYİ BEKLETMEZ.
   *
   * `mapRecordsDealers` bütün cari listesini çekiyor (`/api/erp/dealers`, ~1,3 MB, ölçülen ~2,3 sn
   * ve ServiceOps üzerinden B2B'ye zincirli bir çağrı). Bu `await` liste sonucunun ÖNÜNDEYDİ:
   * kayıtlar elde olduğu hâlde ekran o süre boyunca "Yükleniyor..." kalıyor, kullanıcı sayfayı
   * elle yeniliyordu ("ilk açılışta donuyor", MONTAJ-DEVIR §8.7). Artık kayıtlar hemen basılıyor,
   * bayi kodu geldiğinde satırlar güncelleniyor.
   *
   * Sayaç, geç dönen zenginleştirmenin DAHA YENİ bir sonucu ezmesini engelliyor.
   */
  const requestSeq = useRef(0)

  /**
   * Tarih aralığı sınırlarını GÜNÜN TAMAMINI kapsayacak şekilde gönderir.
   *
   * Sunucu bu alanları DateTime olarak okuyor: "2026-08-13" değeri 13 Ağustos 00:00 demek.
   * Bitiş sınırı böyle gönderilince o günün 00:00'dan sonraki bütün kayıtları aralığın DIŞINDA
   * kalıyordu — kullanıcı 03–13 arasını seçtiğinde 13'ü (ve saati olan her kaydı) göremiyordu.
   * Başlangıç gün başına, bitiş gün sonuna sabitlenir. Zaten saat içeren değerlere dokunulmaz.
   */
  const startOfDayParam = (value: string) => {
    const v = String(value).trim()
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00` : v
  }
  const endOfDayParam = (value: string) => {
    const v = String(value).trim()
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59.999` : v
  }

  /**
   * ARKA PLAN YENİLEMESİ EKRANI "YÜKLENİYOR"A DÜŞÜRMEZ (2026-08-21 kullanıcı bildirimi).
   *
   * `setIsLoading(true)` koşulsuz çağrılıyordu: yoklama, SignalR olayı ve sekmeye dönüş dahil
   * HER yenilemede liste yükleniyor durumuna girip baştan çiziliyordu. Kullanıcının "durmadan
   * yeniliyor" dediği şey buydu — isteğin kendisi değil, ekranın titremesi. Servis ekipleri
   * satır seçerken/kaydırırken altlarından liste kayıyordu.
   *
   * `silent` ile ayrım net: kullanıcının beklediği yüklemeler (ilk açılış, süzgeç/sayfa
   * değişimi) göstergeyi yakar; kendiliğinden olanlar sessizce veriyi tazeler. Veri yine
   * güncellenir, sadece ekran zıplamaz.
   */
  const fetchPaged = useCallback(async (silent = false) => {
    const seq = ++requestSeq.current
    try {
      if (!silent) setIsLoading(true)
      const params = new URLSearchParams()
      if (query.q) params.set('q', query.q)
      const effectiveStatuses = query.statuses || (query.status && query.status.includes(',') ? query.status : undefined)
      const effectiveStatus = query.status && !query.status.includes(',') ? query.status : undefined
      if (effectiveStatus) params.set('status', effectiveStatus)
      if (effectiveStatuses) params.set('statuses', effectiveStatuses)
      if (query.type) params.set('type', query.type)
      if (query.category) params.set('category', query.category)
      const technicianId = query.technicianId
      if (technicianId) params.set('technicianId', technicianId)
      if (query.regionId) params.set('regionId', query.regionId)
      if (query.dateFrom) params.set('dateFrom', startOfDayParam(query.dateFrom))
      if (query.dateTo) params.set('dateTo', endOfDayParam(query.dateTo))
      if (query.plannedDate) params.set('plannedDate', query.plannedDate)
      // Planlanan gün ARALIĞI. Bunlar gönderilmediği için gün bazlı sekmelerde aralığın bitişi
      // sessizce düşüyor ve aralık tek güne çöküyordu (bkz. SahaArizaPage).
      if (query.plannedFrom) params.set('plannedFrom', startOfDayParam(query.plannedFrom))
      if (query.plannedTo) params.set('plannedTo', endOfDayParam(query.plannedTo))
      if (query.installationType) params.set('installationType', query.installationType)
      if (query.satisfactionScore !== undefined && query.satisfactionScore !== null) {
        params.set('satisfactionScore', String(query.satisfactionScore))
      }
      if (query.includePassive) params.set('includePassive', 'true')
      if (query.scopeKey) params.set('scopeKey', query.scopeKey)
      params.set('page', String(query.page ?? 1))
      params.set('pageSize', String(query.pageSize ?? 20))

      const data = await apiJson<PagedResult<ServiceRecord>>(`/api/servicerecords/paged?${params}`)
      // Önce ham sonuç: liste bayi kodu beklemeden çizilir.
      setResult(data)
      setError(null)
      if (data?.items?.length) {
        void mapRecordsDealers(data.items).then((mappedItems) => {
          if (seq !== requestSeq.current) return
          setResult((prev) => ({ ...prev, items: mappedItems }))
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setResult((prev) => ({ ...prev, items: [], totalCount: 0, totalPages: 0 }))
    } finally {
      setIsLoading(false)
    }
  }, [query.q, query.status, query.statuses, query.type, query.category, query.technicianId, query.regionId, query.dateFrom, query.dateTo, query.plannedDate, query.plannedFrom, query.plannedTo, query.scopeKey, query.satisfactionScore, query.installationType, query.includePassive, query.page, query.pageSize])

  useEffect(() => {
    // İlk yükleme kullanıcının beklediği yükleme: gösterge yanar.
    fetchPaged()

    // YEDEK YOKLAMA — SignalR bağlıyken buna neredeyse hiç gerek yok; yalnızca bağlantı
    // koparsa (ağ, vekil, cihaz uykusu) sayfa bayat kalmasın diye duruyor. 30 sn'den 60 sn'ye
    // çıkarıldı ve artık SESSİZ: veri tazelenir, ekran yükleniyor durumuna girmez.
    // 2026-10-05: arka plandaki sekmede yoklama yapılmaz (bkz. utils/sekmeGorunur).
    const interval = setInterval(() => { if (sekmeGorunur()) fetchPaged(true) }, 60_000)

    // Sekmeye dönüş ve canlı olaylar da sessiz: kullanıcı bir şey istemedi, arka planda oldu.
    const onVisible = () => { if (document.visibilityState === 'visible') fetchPaged(true) }
    document.addEventListener('visibilitychange', onVisible)
    /*
      CANLI OLAYLAR BİRLEŞTİRİLİR (2026-10-05, "servis çok yavaş"). Bir kullanıcının toplu
      işlemi (10 satırın durumu) 10+ olay yayıyor ve bağlı HER ekran her olayda binlerce
      kayıtlık listeyi baştan çekiyordu. 1,5 sn içindeki olaylar tek yenilemede birleşir;
      arka plandaki sekme olayı biriktirir, öne gelince zaten yenilenir.
    */
    let olayZamanlayici: ReturnType<typeof setTimeout> | null = null
    const onSignalR = () => {
      if (!sekmeGorunur()) return
      if (olayZamanlayici) clearTimeout(olayZamanlayici)
      olayZamanlayici = setTimeout(() => { olayZamanlayici = null; fetchPaged(true) }, 1500)
    }
    window.addEventListener('signalr:service_record_updated', onSignalR)
    window.addEventListener('signalr:installation_updated', onSignalR)
    window.addEventListener('signalr:cargo_updated', onSignalR)
    return () => {
      clearInterval(interval)
      if (olayZamanlayici) clearTimeout(olayZamanlayici)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('signalr:service_record_updated', onSignalR)
      window.removeEventListener('signalr:installation_updated', onSignalR)
      window.removeEventListener('signalr:cargo_updated', onSignalR)
    }
  }, [fetchPaged])

  const updateStatus = async (id: string, status: string, notes?: string, performedByTechnicianId?: string) => {
    const rawId = id.split('_')[0]
    hintRecordStatusChange(result.items.find((r) => r.id === id), notes)
    const updated = await apiJson<ServiceRecord>(`/api/servicerecords/${rawId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, notes, performedByTechnicianId: performedByTechnicianId || undefined })
    })
    const map = await getDealersMap()
    const mapped = await mapRecordDealers(updated, map)
    setResult((prev) => ({ ...prev, items: prev.items.map((r) => (r.id === id ? keepWorkshopEnteredAt(r, mapped) : r)) }))
    return mapped
  }

  const assignTechnician = async (id: string, technicianId: string) => {
    const rawId = id.split('_')[0]
    const updated = await apiJson<ServiceRecord>(`/api/servicerecords/${rawId}/assign`, {
      method: 'POST',
      body: JSON.stringify({ technicianId })
    })
    const map = await getDealersMap()
    const mapped = await mapRecordDealers(updated, map)
    setResult((prev) => ({ ...prev, items: prev.items.map((r) => (r.id === id ? keepWorkshopEnteredAt(r, mapped) : r)) }))
    return mapped
  }

  /**
   * `status` is part of the API contract (PlanServiceRecordDto.Status) and callers were already
   * passing it. It was neither accepted here nor put in the body, so planning a record quietly
   * left its status untouched while the caller believed it had been moved on.
   */
  const plan = async (
    id: string,
    // `plannedDate: null` is what the "geri planlama" paths send to unplan a record. See the
    // note in the caller: the API does not currently clear on null, so that flow is only
    // type-correct here, not yet functionally fixed.
    payload: { plannedDate: string | null; technicianId?: string | null; status?: string }
  ) => {
    const rawId = id.split('_')[0]
    const updated = await apiJson<ServiceRecord>(`/api/servicerecords/${rawId}/plan`, {
      method: 'PATCH',
      body: JSON.stringify({
        plannedDate: payload.plannedDate,
        technicianId: payload.technicianId ?? null,
        ...(payload.status ? { status: payload.status } : {})
      })
    })
    const map = await getDealersMap()
    const mapped = await mapRecordDealers(updated, map)
    setResult((prev) => ({ ...prev, items: prev.items.map((r) => (r.id === id ? keepWorkshopEnteredAt(r, mapped) : r)) }))
    return mapped
  }

  /**
   * Fişi basılmış olarak damgalar.
   *
   * `itemId` verilirse damga o KALEME düşer (`ServiceRecordItems.SlipPrintedAt`); listedeki
   * tik ve basım tarihi oradan okunur. Verilmezse yalnızca kaydın `IsPrinted` bayrağı yazılır
   * — o bayrak sahaya aktarım kilidi olduğu için her iki durumda da set edilir.
   */
  const markAsPrinted = async (id: string, itemId?: string | null) => {
    const rawId = id.split('_')[0]
    const query = itemId ? `?itemId=${encodeURIComponent(itemId)}` : ''
    const updated = await apiJson<ServiceRecord>(`/api/servicerecords/${rawId}/printed${query}`, {
      method: 'PATCH'
    })
    const map = await getDealersMap()
    const mapped = await mapRecordDealers(updated, map)
    setResult((prev) => ({ ...prev, items: prev.items.map((r) => (r.id === id ? keepWorkshopEnteredAt(r, mapped) : r)) }))
    return mapped
  }

  const updateSatisfaction = async (id: string, satisfactionScore: number, satisfactionNotes?: string) => {
    const rawId = id.split('_')[0]
    const updated = await apiJson<ServiceRecord>(`/api/servicerecords/${rawId}/satisfaction`, {
      method: 'PUT',
      body: JSON.stringify({ satisfactionScore, satisfactionNotes })
    })
    const map = await getDealersMap()
    const mapped = await mapRecordDealers(updated, map)
    setResult((prev) => ({ ...prev, items: prev.items.map((r) => (r.id === id ? keepWorkshopEnteredAt(r, mapped) : r)) }))
    return mapped
  }

  return {
    result,
    isLoading,
    error,
    refetch: fetchPaged,
    updateStatus,
    assignTechnician,
    plan,
    markAsPrinted,
    updateSatisfaction,
  }
}

export function useDashboardStats() {
  const [stats, setStats] = useState<DashboardStats>({
    totalServices: 0,
    todayServices: 0,
    pendingServices: 0,
    completedToday: 0,
    statusCounts: {}
  })
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [statusCounts, todayServices] = await Promise.all([
          apiJson<Record<string, number>>('/api/servicerecords/status-counts'),
          apiJson<ServiceRecord[]>('/api/servicerecords/today')
        ])

        const total = Object.values(statusCounts).reduce((a, b) => (a as number) + (b as number), 0) as number
        const completedToday = todayServices.filter((s) =>
          s.status === 'Delivered' || s.status === 'Ready'
        ).length

        const pendingServices = (statusCounts['New'] ?? 0) + (statusCounts['Workshop'] ?? 0)

        setStats({
          totalServices: total,
          todayServices: todayServices.length,
          pendingServices,
          completedToday,
          statusCounts
        })
      } catch (err) {
        console.error('Failed to fetch dashboard stats:', err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchStats()
    const interval = setInterval(() => { if (sekmeGorunur()) void fetchStats() }, 60000) // Refresh every minute
    return () => clearInterval(interval)
  }, [])

  return { stats, isLoading }
}

export function useTodayServices() {
  const [services, setServices] = useState<ServiceRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchToday = async () => {
      try {
        const data = await apiJson<ServiceRecord[]>('/api/servicerecords/today')
        const mapped = await mapRecordsDealers(data ?? [])
        setServices(mapped)
      } catch (err) {
        console.error('Failed to fetch today services:', err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchToday()
  }, [])

  return { services, isLoading }
}

export function useDelayedServices() {
  const [services, setServices] = useState<ServiceRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const ac = new AbortController()
    const fetchDelayed = async () => {
      try {
        const data = await apiJson<ServiceRecord[]>('/api/servicerecords/delayed', { signal: ac.signal })
        const mapped = await mapRecordsDealers(data ?? [])
        setServices(mapped)
      } catch (err: any) {
        if (err?.name === 'AbortError') return
        console.error('Failed to fetch delayed services:', err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchDelayed()
    return () => ac.abort()
  }, [])

  return { services, isLoading }
}
