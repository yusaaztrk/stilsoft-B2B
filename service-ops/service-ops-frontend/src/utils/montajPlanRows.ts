import type { ServiceRecord, ServiceRecordInstallationTask } from '../hooks/useServiceRecords'
import { getCustomerOrDealerType } from './customerType'

/**
 * Montaj PLANLAMA listesinin satır birimi = KALEM.
 *
 * Montaj Kabul bir faturayı olduğu gibi gösterir: tek kayıt, altında kalemler. Planlama ise
 * kalem kalem yapılan bir iş — farklı ürün, farklı müşteri, farklı adres aynı satırda toplanınca
 * planlayan kişi neyi kime atadığını göremiyordu. Bu yüzden liste burada düzleştiriliyor:
 * her `ServiceRecordItem` kendi satırı. Kabul ekranı bu dosyayı kullanmaz, orası bozulmadı.
 *
 * Adet BÖLÜNMEZ: 3 adetlik bir kalem 3 satır değil, "3 adet" yazan tek satırdır (kabulde
 * girildiği gibi). Adedin tek tek durumu hâlâ ayrı ilerliyor — o satırlar satırın altındaki
 * açılır tabloda duruyor, listeyi şişirmiyor.
 */

/**
 * InstallationTaskStatus (sunucu sayı döner).
 *
 * **6 ve 7 EKSİKTİ ve sessizce "Planned"a düşüyordu.** `statusNameOf`'un varsayılanı 'Planned'
 * olduğu için "Teslim Edildi" ve "Ertelendi" satırları hem listede "Planlandı" görünüyor hem de
 * aşağıdaki bütün süzgeçlerde planlanmış sayılıyordu — yani kullanıcının istediği iki durum
 * geçişi (§8.8) hiçbir zaman çalışamazdı. Enum'a durum eklenince BURASI da güncellenmeli.
 */
const TASK_STATUS_NAMES: Record<number, string> = {
  0: 'Planned',
  1: 'InProgress',
  2: 'Completed',
  3: 'Cancelled',
  4: 'Deferred',
  5: 'Unreachable',
  6: 'Delivered',
  7: 'Postponed',
}

/**
 * "Henüz planlanmamış" sayılan durumlar — satır planlama sekmesine düşer.
 *
 * Kullanıcı kuralı (§8.8): Teslim Edildi / Ulaşılamadı / Ertelendi / Yeni Kayıt satırları
 * planlamaya geri döner, Teslimattakiler'de durmaz. Sunucu da bu dört durumda teknisyeni,
 * tarihi ve aktarım damgasını temizliyor (`InstallationsController.UpdateTaskStatus`) —
 * iki taraf aynı listeyi kullanmazsa satır iki sekmede birden ya da hiçbirinde görünmez.
 */
export const UNPLANNED_STATES = new Set(['Deferred', 'Delivered', 'Postponed', 'Unreachable'])

/**
 * İş bitti AMA içinde iptal edilmiş kalem var. Düz "Gerçekleşti" göstermek faturanın eksiksiz
 * tamamlandığı izlenimi veriyordu; ünlem, açıp içine bakmayı hatırlatıyor.
 * Sunucudaki karşılığı `InstallationsController.CompletedWithCancellations`.
 */
export const COMPLETED_WITH_CANCELLATIONS = 'CompletedWithCancellations'

/**
 * Durum etiketlerinin TEK kaynağı.
 *
 * Aynı durumun iki farklı adı vardı: `Deferred` listede "Yeni Kayıt", Kalem İşlemi
 * açılır listesinde "Ertelendi" yazıyordu — kullanıcı "Ertelendi" seçip tabloda "Yeni Kayıt"
 * görüyordu. Her ekran artık buradan okuyor.
 */
export const STATE_LABELS: Record<string, string> = {
  Planned: 'Planlandı',
  InProgress: 'Devam Ediyor',
  Completed: 'Gerçekleşti',
  [COMPLETED_WITH_CANCELLATIONS]: 'Gerçekleşti !',
  Cancelled: 'İptal',
  Deferred: 'Yeni Kayıt',
  // Teknisyen gitti, iş yapılamadı: kapı açılmadı / adres yanlış / müşteri erteledi.
  // Satır sahada ve teknisyende KALIR; tamamlanmış sayılmaz, hak ediş doğurmaz.
  Unreachable: 'Ulaşılamadı',
  Delivered: 'Teslim Edildi (Planlama Bekliyor)',
  Postponed: 'Ertelendi',
  Mixed: 'İşlemde',
}

export const STATE_COLORS: Record<string, string> = {
  Planned: 'bg-blue-100 text-blue-700 border-blue-200',
  InProgress: 'bg-amber-100 text-amber-700 border-amber-200',
  Completed: 'bg-green-100 text-green-700 border-green-200',
  [COMPLETED_WITH_CANCELLATIONS]: 'bg-green-100 text-green-800 border-green-300',
  Cancelled: 'bg-red-100 text-red-700 border-red-200',
  Deferred: 'bg-blue-100 text-blue-700 border-blue-200',
  Unreachable: 'bg-rose-100 text-rose-800 border-rose-300',
  Delivered: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  Postponed: 'bg-amber-100 text-amber-700 border-amber-200',
  Mixed: 'bg-orange-100 text-orange-700 border-orange-200',
}

export const statusNameOf = (task: any): string => {
  const raw = task?.status ?? task?.Status
  if (typeof raw === 'number') return TASK_STATUS_NAMES[raw] ?? 'Planned'
  const asNumber = Number(raw)
  if (!Number.isNaN(asNumber) && TASK_STATUS_NAMES[asNumber]) return TASK_STATUS_NAMES[asNumber]
  return String(raw || 'Planned')
}

/**
 * Sunucudaki `CombineStates` ile aynı kural: hepsi aynıysa o durum, karışıksa "İşlemde".
 * İki taraf ayrışırsa aynı kayıt iki ekranda iki farklı durum gösterir — kural tek olmalı.
 */
export function combineStates(states: string[]): string | null {
  const live = states.filter((s) => s && s !== 'Cancelled')
  if (live.length === 0) return null
  const first = live[0]
  return live.every((s) => s === first) ? first : 'Mixed'
}

/**
 * Kalem→kayıt birleştirmesi. Sunucudaki `CombineStatesWithCancellations` ile aynı kural —
 * ayrışırsa aynı kayıt listede ve detayda iki farklı durum gösterir.
 *
 * Hepsi iptalse İptal. Değilse iptal OLMAYANLARIN ortak durumu (karışıksa "İşlemde"); iş bitmiş
 * ama içeride iptal varsa "Gerçekleşti !".
 */
export function combineStatesWithCancellations(states: string[]): string | null {
  if (states.length === 0) return null

  const cancelled = states.filter((s) => s === 'Cancelled').length
  if (cancelled === states.length) return 'Cancelled'

  const combined = combineStates(states)
  return cancelled > 0 && combined === 'Completed' ? COMPLETED_WITH_CANCELLATIONS : combined
}

/**
 * Faturası olmayan kaydın `invoiceNo` alanına yazılan metin.
 *
 * Sabit olarak duruyor çünkü ÜÇ yerde birden karşılaştırılıyor: satırı kuran yer, listedeki
 * hücre biçimlendirmesi ve mobil "Bayiden Alınacaklar / Faturalı" bölünmesi. Metin elle
 * yazıldığında bir yerde "Bayiden Alınacak" (büyük A) olup eşleşme sessizce bozuluyordu.
 */
export const PICKUP_FROM_DEALER = 'Bayiden alınacak'

/** Satırın ürünü bayiden mi alınacak (faturası yok) — mobil bölünmenin tek ölçütü. */
export function isPickupFromDealer(row: { invoiceNo?: string | null }): boolean {
  return (row.invoiceNo ?? '') === PICKUP_FROM_DEALER
}

/** Fatura izi montaj kaydının açıklamasına "[Fatura No: X]" olarak yazılıyor. */
export function extractInvoiceNo(problemDescription?: string | null): string | null {
  const m = /\[Fatura No:\s*([^\]]+)\]/.exec(problemDescription || '')
  return m ? m[1].trim() : null
}

export type MontajPlanRow = {
  /** `${recordId}::${itemId}` — tablo satır anahtarı. */
  id: string
  recordId: string
  itemId: string | null
  /** Aksiyonlar (fiş, aktarım, geri gönderme) hâlâ KAYIT seviyesinde çalışıyor. */
  record: ServiceRecord
  tasks: ServiceRecordInstallationTask[]

  serviceNumber: string
  /** "2 / 3" — kaydın kaçıncı kalemi. Bölünmüş kayıtta hangi satırın nereden geldiğini verir. */
  lineLabel: string
  splitFrom: string | null
  customerType: string
  createdAt: string
  createdAtIso: string
  /**
   * Memnuniyet anketi KAYIT seviyesindedir (kalem değil): aynı faturanın iki kalemi için ayrı
   * puan tutulmuyor, bu yüzden aynı kaydın bütün satırları aynı puanı gösterir.
   * Satırda ayrıca tutulmasının sebebi tablo: sütunun süzgeci/sıralaması satır alanı üzerinden
   * çalışıyor, `record.satisfactionScore` iç içe olduğu için erişemiyor.
   */
  satisfactionScore: number
  installationType: string
  invoiceNo: string
  productName: string
  productStockCode: string
  serialNumber: string
  quantity: number
  /** Bir kişiye/güne bağlanmış adet (aktarılmış olsun olmasın). */
  plannedQuantity: number
  /** Henüz hiç planlanmamış adet. */
  remainingQuantity: number
  /** Planlanmış ama HENÜZ SAHAYA AKTARILMAMIŞ adet — planlama sekmesinin işi bitmemiş demektir. */
  pendingQuantity: number
  /** Sahaya aktarılmış ve daha bitmemiş adet — teslimattakiler sekmesinin satırı bu yüzden var. */
  transferredQuantity: number
  /** Gerçekleşmiş adet. */
  completedQuantity: number
  /**
   * Gidildi ama yapılamadı (müşteriye ulaşılamadı / adres yanlış / randevu ertelendi).
   * `transferredQuantity`'nin İÇİNDE sayılır — satır hâlâ sahada ve teknisyende. Ayrıca
   * gösterilmesinin sebebi: planlamacının müdahale etmesi gereken tek adet türü bu.
   */
  unreachableQuantity: number
  /** "Teslim edildi, montaj planlanacak" adet — planlamada bekler (§8.8). */
  deliveredQuantity: number
  /** Ertelenmiş adet — planlamada bekler (§8.8). */
  postponedQuantity: number
  /**
   * "Planlamaya geri gönder"in yollayacağı satırlar: sahaya aktarılmış AMA henüz
   * gerçekleşmemiş olanlar. Gerçekleşmiş satır bilerek dışarıda — yapılmış işi geri almak
   * aktarımı geri almakla aynı şey değil, onun yeri satırın kendi durum güncellemesi.
   * (Sunucu da aynı süzgeci uyguluyor; iki taraf ayrışırsa buton sayısı yaptığı işle çelişir.)
   */
  transferredTaskIds: string[]
  /**
   * Sahaya aktarılmış VE gerçekleşmiş satırlar. Ayrı tutuluyor çünkü bunları geri almak
   * "aktarımı geri al"dan farklı bir karar: yapılmış işi silmek demek, hak edişi de iptale
   * çeker. Geri gönderme ekranı bunu ayrı bir onayla soruyor.
   *
   * Ayrı olmasının ikinci sebebi: hepsi gerçekleşmişse `transferredTaskIds` boş kalıyor ve
   * buton hiç çizilmiyordu — kullanıcı sahadaki işi geri almanın hiçbir yolu olmadığını
   * görüyordu (bildirilen hata, 2026-08-11).
   */
  completedTransferredTaskIds: string[]
  state: string
  stateLabel: string
  /**
   * DURUM TARİHİ (2026-09-18 kullanıcı isteği: "iptal ise iptal tarihi, en son işlem
   * yapıldıysa o"). Satırın BUGÜNKÜ durumunun ne zaman oluştuğu.
   *
   * Gerçekleşen satırda `completedAt` okunur — geriye dönük işlenen işte bu SEÇİLEN gündür,
   * "şimdi" değil; kullanıcının istediği tam olarak bu. Diğer durumlarda satıra son dokunuş
   * (`updatedAt`) geçerli. İptalde kalemin kendi iptal damgası önce gelir.
   *
   * Karışık durumda ("İşlemde") satırların EN SON tarihi yazılır: kullanıcı o kalemde en son
   * ne zaman bir şey olduğunu arıyor.
   */
  stateDateIso: string | null
  /** Aynı tarihin ekranda yazılan hâli (gg.AA.yyyy); yoksa boş. */
  stateDate: string
  /** Kalem iptal edildi mi. Satır iptalse iki sekmede de listelenmez ama geçmişte durur. */
  isCancelled: boolean
  cancelReason: string | null
  customerName: string
  customerPhone: string
  address: string
  regionName: string
  dealerName: string
  /** Bu kaleme atanmış kişiler ve adetleri: "AHMET (2), MEHMET (1)". */
  technicianNames: string
  /**
   * Kalemin planlandığı gün(ler), EN ERKEN ÖNDE olacak şekilde: "25.08.2026, 26.08.2026".
   *
   * Sıra rastgele değil: tablodaki "Planlanan Gün" sütunu bu alan üzerinden tarih süzgeci
   * kullanıyor ve süzgeç metnin BAŞINDAKİ tarihi ayrıştırıyor. Sıralama bozulursa "şu güne
   * planlananlar" süzgeci aynı satır için bazen tutar bazen tutmaz olurdu.
   */
  plannedDates: string
  /**
   * Aynı bilginin sıralanabilir hâli (yyyy-MM-dd, en erken gün). Tabloda gizli değil —
   * "Planlanan Gün" sütununun sıralaması metne göre yapılırsa 01.09 < 25.08 çıkardı.
   */
  plannedDateIso: string
  status: string
  /** Bu KALEMİN fişi basıldı mı (kaydın geneli değil) — bkz. buildMontajPlanRows'daki not. */
  isPrinted: boolean
  /** Bu kalemin fişinin son basım anı; eski kayıtlarda tik olsa bile boş olabilir. */
  slipPrintedAt: string | null
  notes: string
}

/** Tarihi yerel gün anahtarına çevirir (yyyy-MM-dd). UTC'ye çevirmez: `toISOString()`
 *  +03'te gece yarısını bir önceki güne kaydırırdı. */
const toIsoDay = (value?: string | null) => {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const iki = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${iki(d.getMonth() + 1)}-${iki(d.getDate())}`
}

/** yyyy-MM-dd -> gg.AA.yyyy. Tabloda gösterilen biçim. */
const isoDayToLabel = (iso: string) => {
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${d}.${m}.${y}` : iso
}

const toDateLabel = (value?: string | null) => {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('tr-TR')
}

/**
 * Kayıt listesini kalem satırlarına düzleştirir. Kalemi olmayan (kalem kavramından önce açılmış)
 * kayıtlar kaybolmaz: kaydın kendisi tek kalemmiş gibi bir satır üretir.
 */
export function buildMontajPlanRows(records: ServiceRecord[]): MontajPlanRow[] {
  const rows: MontajPlanRow[] = []

  for (const record of records) {
    const allTasks = record.installationTasks ?? []
    const items = (record.items ?? []).slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    const splitMatch = /^(MNT-\d+)-(\d+)$/.exec(record.serviceNumber || '')

    const base = {
      recordId: record.id,
      record,
      serviceNumber: record.serviceNumber,
      splitFrom: splitMatch ? splitMatch[1] : null,
      customerType: getCustomerOrDealerType(record),
      createdAt: toDateLabel(record.createdAt),
      createdAtIso: record.createdAt,
      satisfactionScore: Number((record as any).satisfactionScore) || 0,
      installationType: record.installationType || 'Bayi',
      // Faturası olmayan kayıt "faturasız" değil, ürünün BAYİDEN ALINACAĞI anlamına geliyor —
      // ekranda da öyle yazıyor. Bu değer kolon süzgecinin de eşleştiği metin.
      invoiceNo: extractInvoiceNo(record.problemDescription) || PICKUP_FROM_DEALER,
      regionName: record.regionName || '-',
      dealerName: record.dealerName || '-',
      status: record.status,
      // NOT: `isPrinted` aşağıda KALEM bazında ezilir; buradaki değer yalnızca kalemi olmayan
      // (kalem kavramından önce açılmış) kayıtlar için geçerli kalır.
      isPrinted: !!record.isPrinted,
      slipPrintedAt: null as string | null,
    }

    const sources = items.length > 0
      ? items.map((item) => ({ item, tasks: allTasks.filter((t) => String(t.serviceRecordItemId ?? '') === item.id) }))
      : [{ item: null, tasks: allTasks }]

    sources.forEach(({ item, tasks }, index) => {
      // İptaller ne planlanmış ne de kalan sayılır; kalanı da onlar üzerinden hesaplarsak
      // iptal edilen bir adet kaleme geri dönmüyormuş gibi görünürdü.
      const live = tasks.filter((t) => statusNameOf(t) !== 'Cancelled')
      const planned = live.filter((t) => !UNPLANNED_STATES.has(statusNameOf(t)))
      const qtyOf = (t: ServiceRecordInstallationTask) => Number(t.quantity) || 1
      const plannedQuantity = planned.reduce((sum, t) => sum + qtyOf(t), 0)
      const quantity = item ? (Number(item.quantity) || 1) : (record.totalQuantity ?? 1)

      // İptal KALEMİN kendi damgasından okunur. Görev satırlarına bakmak yetmez: `live` iptalleri
      // zaten eliyor, dolayısıyla tümü iptal olmuş bir kalem "Yeni Kayıt" görünürdü. Kaydın
      // durumuna bakmak ise TERSİ hatayı yapıyordu — tek bir kalemin iptali faturanın bütün
      // kalemlerini "İptal" gösteriyordu, kullanıcının bildirdiği asıl sorun buydu.
      const isCancelled = !!item?.cancelledAt || record.status === 'Cancelled'
      const state = isCancelled ? 'Cancelled' : (combineStates(live.map(statusNameOf)) ?? 'Deferred')

      const isTransferred = (t: ServiceRecordInstallationTask) => !!t.transferredAt
      const completedQuantity = planned
        .filter((t) => statusNameOf(t) === 'Completed')
        .reduce((sum, t) => sum + qtyOf(t), 0)
      const pendingQuantity = planned
        .filter((t) => !isTransferred(t) && statusNameOf(t) !== 'Completed')
        .reduce((sum, t) => sum + qtyOf(t), 0)
      const transferredQuantity = planned
        .filter((t) => isTransferred(t) && statusNameOf(t) !== 'Completed')
        .reduce((sum, t) => sum + qtyOf(t), 0)
      // `planned` Ulaşılamadı'yı zaten ELİYOR (UNPLANNED_STATES) — bu sayı ondan hesaplanınca
      // her zaman 0 çıkıyor ve "N ulaşılamadı" rozeti hiç görünmüyordu. Kaynak `live` olmalı.
      const unreachableQuantity = live
        .filter((t) => statusNameOf(t) === 'Unreachable')
        .reduce((sum, t) => sum + qtyOf(t), 0)
      // Planlamaya geri düşmüş ama sebebi olan satırlar: planlamacının göreceği tek uyarı bu.
      const deliveredQuantity = live
        .filter((t) => statusNameOf(t) === 'Delivered')
        .reduce((sum, t) => sum + qtyOf(t), 0)
      const postponedQuantity = live
        .filter((t) => statusNameOf(t) === 'Postponed')
        .reduce((sum, t) => sum + qtyOf(t), 0)

      const byTechnician = new Map<string, number>()
      // ISO gün (yyyy-MM-dd) toplanıyor, etiket sonra üretiliyor: "25.08.2026" gibi metinleri
      // sıralamak gün/ay/yıl sırası yüzünden yanlış sonuç verir.
      const isoDays = new Set<string>()
      for (const t of live) {
        const durum = statusNameOf(t)
        /*
          PLANLAMAYA DÜŞEN SATIRIN TEKNİSYENİ VE GÜNÜ SÜTUNDA GÖRÜNÜR
          (2026-09-09 kullanıcı kuralı: "teknisyen ve tarih silinmesin"; öncesinde 2026-08-27
          aynı kuralı yalnız Ertelendi için koymuştu).

          Sunucu artık dört "planlamaya düşen" durumun HİÇBİRİNDE atanan kişiyi ve planlanan
          günü silmiyor (InstallationsController.UpdateTaskStatus). Burası o durumları atlamaya
          devam etseydi satır ekranda yine "Atanmadı / -" görünürdü — kullanıcının şikâyeti tam
          olarak buydu: planlanmış, sahaya çıkmış, fişi basılmış bir kalem geri çekilince
          hiç dokunulmamış bir satırdan ayırt edilemiyordu.

          Tek istisna: planlamaya düşmüş VE hiç kimseye atanmamış satır sütuna girmez. Onun
          için yazılacak bir isim yok; "Atanmadı" diye saymak, hiç dokunulmamış kalemlerin
          "Atanan Personel" sütununu boş yerine "Atanmadı" ile doldururdu.
        */
        if (UNPLANNED_STATES.has(durum) && !t.assignedTechnicianName) continue
        const name = t.assignedTechnicianName || 'Atanmadı'
        byTechnician.set(name, (byTechnician.get(name) ?? 0) + (Number(t.quantity) || 1))
        const iso = toIsoDay(t.plannedAt)
        if (iso) isoDays.add(iso)
      }

      const sortedDays = Array.from(isoDays).sort()

      /*
        SERVİS FİŞİ TİK'İ KALEM BAZLI (2026-09-09 kullanıcı isteği).

        Eskiden buradaki `isPrinted` kaydın bayrağıydı: bir faturanın TEK bir kaleminin fişini
        basmak, aynı faturanın bütün kalemlerini "Servis Fişi ✓" gösteriyordu ("şu an çok
        karışık, birini yazdırıyorum hepsinde tik geliyor"). Artık kalemin kendi damgası
        (`slipPrintedAt`) okunuyor.

        ESKİ KAYIT İSTİSNASI: damga 2026-09-09'da eklendi, ondan önce basılmış fişlerin kalem
        damgası yok. TEK kalemli kayıtta belirsizlik de yok — kaydın bayrağı zorunlu olarak o
        kalemi anlatır, tik korunur. Çok kalemli eski kayıtlarda hangi kalemin basıldığı
        veriden bilinemediği için tik düşer; uydurmak, kullanıcının düzeltmek istediği yanlış
        bilginin aynısını üretmek olurdu.
      */
      const itemSlipPrintedAt = item?.slipPrintedAt ?? null
      const itemIsPrinted = item
        ? (!!itemSlipPrintedAt || (items.length === 1 && !!record.isPrinted))
        : !!record.isPrinted

      /*
        DURUM TARİHİ — satırın kendi damgalarından okunur, kaydın genelinden değil.
        Kural `state` ile aynı sırayı izler: iptalse kalemin iptal damgası, gerçekleştiyse
        görevlerin gerçekleşme anı, kalan her durumda son dokunuş.
      */
      const stateDateIso = (() => {
        if (isCancelled && item?.cancelledAt) return item.cancelledAt
        const adaylar = live
          .filter((t) => (state === 'Mixed' ? true : statusNameOf(t) === state))
          .map((t) => (statusNameOf(t) === 'Completed' ? (t.completedAt ?? t.updatedAt) : t.updatedAt))
          .filter((x): x is string => !!x)
        if (adaylar.length === 0) {
          // Satırı hiç işlenmemiş ya da alanları boş eski kayıt: kaydın kendi damgası.
          const r = record as any
          return (state === 'Completed' ? r.completedAt : null) ?? r.updatedAt ?? null
        }
        return adaylar.sort()[adaylar.length - 1]
      })()

      rows.push({
        ...base,
        stateDateIso,
        stateDate: toDateLabel(stateDateIso),
        isPrinted: itemIsPrinted,
        slipPrintedAt: itemSlipPrintedAt,
        id: `${record.id}::${item?.id ?? 'kayit'}`,
        itemId: item?.id ?? null,
        tasks,
        lineLabel: items.length > 0 ? `${index + 1} / ${items.length}` : '1 / 1',
        productName: item?.productName || record.productName || '-',
        productStockCode: item?.productStockCode || record.productStockCode || '',
        serialNumber: item?.serialNumber || record.serialNumber || '',
        quantity,
        plannedQuantity,
        remainingQuantity: Math.max(0, quantity - plannedQuantity),
        pendingQuantity,
        transferredQuantity,
        completedQuantity,
        unreachableQuantity,
        deliveredQuantity,
        postponedQuantity,
        transferredTaskIds: planned
          .filter((t) => isTransferred(t) && statusNameOf(t) !== 'Completed')
          .map((t) => String(t.id)),
        completedTransferredTaskIds: planned
          .filter((t) => isTransferred(t) && statusNameOf(t) === 'Completed')
          .map((t) => String(t.id)),
        state,
        stateLabel: STATE_LABELS[state] ?? state,
        isCancelled,
        cancelReason: item?.cancelReason ?? null,
        // Müşteri/adres KALEMİN kendi bilgisidir; boşsa kaydınkine düşülür (eski kayıtlar).
        customerName: item?.customerName || record.customerName || '-',
        customerPhone: item?.customerPhone || record.customerPhone || '-',
        address: item?.customerAddress || record.customerAddress || '-',
        technicianNames: Array.from(byTechnician.entries())
          .map(([name, qty]) => (qty > 1 ? `${name} (${qty})` : name))
          .join(', '),
        plannedDates: sortedDays.map(isoDayToLabel).join(', '),
        plannedDateIso: sortedDays[0] ?? '',
        notes: item?.notes || '',
      })
    })
  }

  return rows
}

/**
 * Sekme ayrımı KALEM bazında — kaydın durumuna göre DEĞİL.
 *
 * Eskiden ayrımı kaydın statüsü yapıyordu (New/Planned = planlama, Workshop = teslimat) ve bu
 * yüzden kısmen aktarılan kayıt ikiye bölünüyordu: aktarılan kısım yeni bir MNT-xxxxxxx-N
 * kaydına taşınmasa, kalan kısım planlama sekmesinden düşerdi. Bölme kaldırıldı; onun yerine
 * aynı kayıt iki sekmede de görünebiliyor — ama farklı satırlarla ve satır neyi bekliyorsa
 * orada.
 *
 * Bir kalem ikisinde birden olabilir ve bu DOĞRUDUR: 3 adetin 2'si sahada, 1'i hâlâ planlanacak.
 */
/**
 * Süzgeç KALEMİN iptaline bakar, kaydınkine değil: 3 kalemlik bir faturanın bir kalemi iptal
 * edilince diğer ikisi planlamada kalmalı. `row.status` (kayıt durumu) kullanılırsa tek bir
 * iptal bütün faturayı iki sekmeden birden düşürür.
 */
export const isPlanningRow = (row: MontajPlanRow) =>
  !row.isCancelled && (row.remainingQuantity > 0 || row.pendingQuantity > 0)

export const isFieldRow = (row: MontajPlanRow) =>
  !row.isCancelled && row.transferredQuantity > 0

/**
 * SATIR (adet) seviyesinde sekme ayrımı — kalem satırının açılır tablosu bunu kullanır.
 *
 * Kalem satırı iki sekmede birden görünebiliyor (3 adedin 2'si sahada, 1'i planlanacak) ama
 * ALTINDAKİ adet satırları görünmemeli: kullanıcı planlamada sahaya çıkmış satırı, teslimatta
 * da henüz planlanmamış satırı görüyor ve "aktarılan satır planlamadan silinmiyor" diyordu
 * (§8.2 / §8.6). Kural tek yerde: gerçekleşen ve iptal olan satır İKİSİNDE DE yok — biri
 * Montaj Geçmişi'ne, diğeri iptal listesine ait.
 */
export const isPlanningTask = (task: any): boolean => {
  const s = statusNameOf(task)
  if (s === 'Cancelled' || s === 'Completed') return false
  return !(task?.transferredAt ?? task?.TransferredAt)
}

export const isFieldTask = (task: any): boolean => {
  const s = statusNameOf(task)
  if (s === 'Cancelled' || s === 'Completed') return false
  // Planlamaya geri düşen durumlar sahada durmaz; sunucu damgayı siliyor ama eski satırlarda
  // kalmış olabilir, o yüzden durum da ayrıca sınanıyor.
  if (UNPLANNED_STATES.has(s)) return false
  return !!(task?.transferredAt ?? task?.TransferredAt)
}

/*
 * Burada `historyStateOf` vardı: Montaj Geçmişi yalnızca bitmiş/iptal kalemleri listelerken
 * rozeti canlı durumdan değil kapanmış satırlardan hesaplıyordu. Kullanıcı 2026-08-12'de
 * geçmişin KABULDEN İTİBAREN her kalemi taşımasını istedi; liste canlı kalemleri de kapsayınca
 * canlı durum doğru bilgi oldu ve rozet yine `row.state`ten okunuyor. Bkz. MONTAJ-DEVIR §8.10.
 */
