import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type CustomerAgeingReportItemDto = {
  customerCode: string
  customerName: string
  region: string
  salesmanName: string
  group: string
  // Yaslandirma para birimi basina ayri yurur (2026-08-17): satir kendi para biriminde.
  currencyTypeId: number
  currencyCode: string
  totalDebit: number
  devir: number
  monthlyDebits: number[]
}

export type CustomerAgeingReportResponseDto = {
  year: number
  currencyTypeId: number
  currencyCode: string
  // Raporda hareketi olan para birimleri; ekran bunlari dugme yapar.
  availableCurrencyTypeIds: number[]
  items: CustomerAgeingReportItemDto[]
  grandTotalDebit: number
  grandTotalDevir: number
  grandMonthlyTotals: number[]
}

function buildAgeingQuery(year?: number, currencyTypeId?: number) {
  const params = new URLSearchParams()
  if (year) params.set('year', String(year))
  if (currencyTypeId) params.set('currencyTypeId', String(currencyTypeId))
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

function buildHeaders() {
  const headers: Record<string, string> = {}
  const token = localStorage.getItem('accessToken')
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export async function fetchCustomerAgeingReport(year?: number, currencyTypeId?: number, signal?: AbortSignal): Promise<CustomerAgeingReportResponseDto> {
  const qs = buildAgeingQuery(year, currencyTypeId)
  const res = await fetch(`${API_BASE_URL}/api/reports/customer-ageing${qs}`, {
    headers: buildHeaders(),
    signal
  })

  if (res.status === 401) {
    localStorage.removeItem('accessToken')
    if (typeof window !== 'undefined') redirectToLogin()
    throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.')
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || 'Yaşlandırma raporu alınamadı')
  }

  const json = await res.json()
  return json?.data as CustomerAgeingReportResponseDto
}

export async function fetchSupplierAgeingReport(year?: number, currencyTypeId?: number, signal?: AbortSignal): Promise<CustomerAgeingReportResponseDto> {
  const qs = buildAgeingQuery(year, currencyTypeId)
  const res = await fetch(`${API_BASE_URL}/api/reports/supplier-ageing${qs}`, {
    headers: buildHeaders(),
    signal
  })

  if (res.status === 401) {
    localStorage.removeItem('accessToken')
    if (typeof window !== 'undefined') redirectToLogin()
    throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.')
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || 'Tedarikçi yaşlandırma raporu alınamadı')
  }

  const json = await res.json()
  return json?.data as CustomerAgeingReportResponseDto
}

export type PriceGroupDto = {
  id: string
  code: number
  name: string
  invoiceType: string
  isActive: boolean
}

export type PriceListProductDto = {
  id: string
  kod4?: string | null
  barcode?: string | null
  groupCode?: string | null
  subGroupCode?: string | null
  stockCode: string
  stockName: string
  prices: Record<string, { price: number; currency: string } | null>
}

export type PriceListReportResponseDto = {
  priceGroups: PriceGroupDto[]
  items: PriceListProductDto[]
}

export async function fetchPriceListReport(signal?: AbortSignal): Promise<PriceListReportResponseDto> {
  const res = await fetch(`${API_BASE_URL}/api/reports/price-list`, {
    headers: buildHeaders(),
    signal
  })

  if (res.status === 401) {
    localStorage.removeItem('accessToken')
    if (typeof window !== 'undefined') redirectToLogin()
    throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.')
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || 'Fiyat listesi raporu alınamadı')
  }

  const json = await res.json()
  return json?.data as PriceListReportResponseDto
}

export type CustomerDebitCreditItemDto = {
  plasiyer: string
  cariAdi: string
  cariGrup: string
  bolge: string
  telefon: string
  borc: number
  alacak: number
  bakiye: number
  sonOdeme?: number | null
  sonOdemeTarihi?: string | null
}

export type CustomerDebitCreditReportDto = {
  items: CustomerDebitCreditItemDto[]
  currencyTypeId: number
  currencyCode: string
  availableCurrencyTypeIds: number[]
}

// Rapor para birimi basina calisir (2026-08-17): tutarlar secili paranin kendisindedir,
// TL'ye cevrilip toplanmaz.
export async function fetchCustomerDebitCreditReport(currencyTypeId?: number, signal?: AbortSignal): Promise<CustomerDebitCreditReportDto> {
  const qs = currencyTypeId ? `?currencyTypeId=${currencyTypeId}` : ''
  const res = await fetch(`${API_BASE_URL}/api/reports/cari-borc-alacak${qs}`, {
    headers: buildHeaders(),
    signal
  })

  if (res.status === 401) {
    localStorage.removeItem('accessToken')
    if (typeof window !== 'undefined') redirectToLogin()
    throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.')
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || 'Cari borç alacak raporu alınamadı')
  }

  const json = await res.json()
  return {
    items: (json?.data ?? []) as CustomerDebitCreditItemDto[],
    currencyTypeId: Number(json?.currencyTypeId ?? 1),
    currencyCode: String(json?.currencyCode ?? 'TRY'),
    availableCurrencyTypeIds: (json?.availableCurrencyTypeIds ?? [1]) as number[]
  }
}

export type LimitRiskReportItemDto = {
  bolge: string
  grupKodu: string
  cariKodu: string
  cariAdi: string
  borc: number
  alacak: number
  bakiye: number
  limit: number
  kalanLimit: number
  /** Satirin TAMAMI bu para birimindedir (borc, alacak, bakiye, limit, kalan limit). */
  paraBirimi?: number
  paraBirimiKodu?: string
  paraBirimiSimge?: string
  limitDurum: string
  satisPersoneli: string
}

export type LimitRiskReportResponse = {
  items: LimitRiskReportItemDto[]
  /** Limiti ya da hareketi olan para birimleri; suzgec dugmeleri bundan kurulur. */
  availableCurrencyTypeIds: number[]
}

export async function fetchLimitRiskReport(
  signal?: AbortSignal,
  currencyTypeId?: number | null
): Promise<LimitRiskReportResponse> {
  const qs = currencyTypeId != null && currencyTypeId > 0 ? `?currencyTypeId=${currencyTypeId}` : ''
  const res = await fetch(`${API_BASE_URL}/api/reports/limit-risk${qs}`, {
    headers: buildHeaders(),
    signal
  })

  if (res.status === 401) {
    localStorage.removeItem('accessToken')
    if (typeof window !== 'undefined') redirectToLogin()
    throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.')
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || 'Limit risk raporu alınamadı')
  }

  const json = await res.json()
  return {
    items: (json?.data ?? []) as LimitRiskReportItemDto[],
    availableCurrencyTypeIds: (json?.availableCurrencyTypeIds ?? [1]) as number[]
  }
}

export type ActiveBasketReportLineDto = {
  salesOrderLineId: number
  stockCode: string
  productName: string
  quantity: number
  unitPrice: number
  vatRate: number
}

export type ActiveBasketReportItemDto = {
  id: number
  processedAt: string
  orderNo: string
  customerCode: string
  customerName: string
  grandTotal: number
  processedBy: string
  lines: ActiveBasketReportLineDto[]
}

export async function fetchActiveBasketReport(query?: string, signal?: AbortSignal): Promise<ActiveBasketReportItemDto[]> {
  const qs = query ? `?query=${encodeURIComponent(query)}` : ''
  const res = await fetch(`${API_BASE_URL}/api/reports/active-basket${qs}`, {
    headers: buildHeaders(),
    signal
  })

  if (res.status === 401) {
    localStorage.removeItem('accessToken')
    if (typeof window !== 'undefined') redirectToLogin()
    throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.')
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || 'Aktif sepet raporu alınamadı')
  }

  const json = await res.json()
  return json?.data as ActiveBasketReportItemDto[]
}

/** Kullanıcı Aktif Sepet Raporu'ndan limit aşımıyla onay verebilir mi (rol yetkisi). */
export async function fetchOverLimitApprovalPermission(): Promise<boolean> {
  const res = await fetch(`${API_BASE_URL}/api/salesorders/over-limit-approval/permission`, {
    headers: buildHeaders()
  })
  if (!res.ok) return false
  const json = await res.json().catch(() => null)
  return Boolean(json?.data?.allowed)
}

/** Carinin sepetini limit aşımıyla siparişe çevirir (yalnız yetkili rol). */
export async function confirmBasketOverLimit(customerCode: string): Promise<{ siparisNo: string; message: string }> {
  const res = await fetch(`${API_BASE_URL}/api/salesorders/confirm-basket-over-limit`, {
    method: 'POST',
    headers: { ...buildHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerCode })
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || json?.success === false) {
    throw new Error(String(json?.message || `Sipariş oluşturulamadı (${res.status})`))
  }
  return { siparisNo: String(json?.data?.siparisNo ?? ''), message: String(json?.message ?? '') }
}

export async function deleteActiveBasketCustomer(customerCode: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/reports/active-basket/${encodeURIComponent(customerCode)}`, {
    method: 'DELETE',
    headers: buildHeaders()
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || 'Sepet silinemedi')
  }
}

export type AccountingSalesReportItemDto = {
  id: number
  type: string
  /**
   * SATIS | IADE. `type` carinin fatura tipini (FATURA/ACIK/ASKERIYE) söyler, belgenin
   * iade olup olmadığını DEĞİL. İade satırlarında bütün tutarlar eksi gelir; toplamlar
   * bu sayede matrahı doğru düşürür.
   */
  belgeNiteligi?: string
  isMuaf?: boolean
  tarih: string
  belgeNo: string
  cariKodu: string
  cariAdi: string
  adres: string
  sehir: string
  telefon: string
  brut: number
  iskonto: number
  netTutar: number
  kdv: number
  kdvTutari: number
  /** DAİMA TL. Belgenin kendi para birimindeki karşılığı `dovizGenelToplam`. */
  genelToplam: number
  /** Belgenin para birimi kodu — TRY / EUR / USD / GBP. */
  paraBirimi: string
  /** Fatura ANINDAKİ donmuş TL kuru; TL faturada 1. */
  kur: number
  /** Kurun kaynağı (TCMB / manuel / son bilinen) — denetim izi. */
  kurKaynagi?: string | null
  /** Belgenin kendi para birimindeki genel toplam; TL faturada null. */
  dovizGenelToplam: number | null
}

export type AccountingSalesReportResponse = {
  items: AccountingSalesReportItemDto[]
  /** Bu donemde hareketi olan para birimleri; suzgec dugmeleri bundan kurulur. */
  availableCurrencyTypeIds: number[]
}

export async function fetchAccountingSalesReport(
  startDate?: string,
  endDate?: string,
  search?: string,
  signal?: AbortSignal,
  currencyTypeId?: number | null
): Promise<AccountingSalesReportResponse> {
  const params = new URLSearchParams()
  if (startDate) params.set('startDate', startDate)
  if (endDate) params.set('endDate', endDate)
  if (search) params.set('search', search)
  if (currencyTypeId != null && currencyTypeId > 0) params.set('currencyTypeId', String(currencyTypeId))
  const qs = params.toString() ? `?${params.toString()}` : ''

  const res = await fetch(`${API_BASE_URL}/api/reports/accounting-sales${qs}`, {
    headers: buildHeaders(),
    signal
  })

  if (res.status === 401) {
    localStorage.removeItem('accessToken')
    if (typeof window !== 'undefined') redirectToLogin()
    throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.')
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || 'Muhasebe satış raporu alınamadı')
  }

  const json = await res.json()
  return {
    items: (json?.data ?? []) as AccountingSalesReportItemDto[],
    availableCurrencyTypeIds: (json?.availableCurrencyTypeIds ?? [1]) as number[]
  }
}

export interface StockInOutReportItemDto {
  stockCode: string
  stockName: string
  groupCode: string
  subGroupCode: string
  supplierName: string
  /** DEVİR: önceki yılların net hareketi + programa geçişteki açılış stoğu (DEVIR-…). 2026-10-11. */
  openingBalance?: number
  totalIn: number
  totalOut: number
  /** DEVİR + GİRİŞ − ÇIKIŞ (depo transferleri hariç — ürün düzeyinde net sıfır). */
  balance: number
  /** ServiceOps'tan; null = servis veritabanı okunamadı. */
  pendingMontage: number | null
  /** Teslim alınmamış alış siparişlerindeki miktar; bakiyeye DAHİL DEĞİL. */
  termin: number
  monthlyIn: number[]
  monthlyOut: number[]
}

export async function fetchStockInOutReport(
  year?: number,
  signal?: AbortSignal
): Promise<{ items: StockInOutReportItemDto[]; montajKaynagiOkunamadi: boolean }> {
  const qs = year ? `?year=${year}` : ''
  const res = await fetch(`${API_BASE_URL}/api/reports/stock-in-out${qs}`, {
    headers: buildHeaders(),
    signal
  })

  if (res.status === 401) {
    localStorage.removeItem('accessToken')
    if (typeof window !== 'undefined') redirectToLogin()
    throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.')
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || 'Stok giriş/çıkış raporu alınamadı')
  }

  const json = await res.json()
  return {
    items: (json?.data ?? []) as StockInOutReportItemDto[],
    montajKaynagiOkunamadi: Boolean(json?.montajKaynagiOkunamadi)
  }
}

/** Bekleyen montaj (ServiceOps montaj kaydı). 2026-10-11: kaynak ERP'nin eski tablosu değil. */
export type PendingInstallationDetailDto = {
  id: string
  serviceNumber?: string
  createdAt?: string | null
  dealerName: string
  installationName?: string | null
  installationPhone?: string | null
  plannedDate?: string | null
  status: string
  quantity: number
  address: string
  region: string
}

export async function fetchPendingInstallationDetails(
  stockCode: string,
  signal?: AbortSignal
): Promise<PendingInstallationDetailDto[]> {
  const res = await fetch(
    `${API_BASE_URL}/api/reports/stock-in-out/pending-details?stockCode=${encodeURIComponent(stockCode)}`,
    {
      headers: buildHeaders(),
      signal
    }
  )

  if (res.status === 401) {
    localStorage.removeItem('accessToken')
    if (typeof window !== 'undefined') redirectToLogin()
    throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.')
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || 'Montaj detayları alınamadı')
  }

  const json = await res.json()
  return json?.data as PendingInstallationDetailDto[]
}

export type CariSatisReportItemDto = {
  tarih: string
  islemTipi: string
  faturaNo: string
  cariKodu: string
  cariAdi: string
  stokKodu: string
  stokAdi: string
  stokGrup: string
  adet: number
  fiyat: number
  kdvOran: number
  kdvTutar: number
  kdvliTutar: number
  /** Belgenin kendi para birimi; yukaridaki tutarlar TL capasidir. */
  paraBirimi?: string
  kur?: number
  /** KDV dahil tutar, belgenin kendi parasinda. TL faturada null. */
  dovizKdvliTutar?: number | null
}

export async function fetchCariSatisReport(
  params: { startDate?: string; endDate?: string; customerCode?: string },
  signal?: AbortSignal
): Promise<CariSatisReportItemDto[]> {
  const sp = new URLSearchParams()
  if (params.startDate) sp.set('startDate', params.startDate)
  if (params.endDate) sp.set('endDate', params.endDate)
  if (params.customerCode) sp.set('customerCode', params.customerCode)

  const token = localStorage.getItem('accessToken')
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${API_BASE_URL}/api/reports/cari-satis?${sp.toString()}`, {
    headers,
    signal
  })

  if (res.status === 401) {
    localStorage.removeItem('accessToken')
    if (typeof window !== 'undefined') redirectToLogin()
    throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.')
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || 'Cari satış raporu alınamadı')
  }

  const json = await res.json()
  return (json?.data ?? []) as CariSatisReportItemDto[]
}

export type SalesMarketingReportItemDto = {
  /** Her satır BİR FATURA (2026-08-20). Öncesinde gün+plasiyer bazında toplanmış satırlardı. */
  id: number
  faturaNo: string
  /** Carinin ANA kodu (belge -1/-2/-3 alt hesabına yazılsa bile). */
  cariKodu: string
  /** Belgenin gerçekte yazıldığı hesap kodu — ekstreyle karşılaştırmak için. */
  cariHesapKodu: string
  cariAdi: string
  plasiyerKodu: string
  plasiyer: string
  tarih: string
  /** SATIŞ | İADE — alış ve hizmet artık bu rapora girmiyor. */
  islemTipi: string
  /** TL çapası — dört para birimi tek ölçüde toplanabilsin diye. */
  /** TL çapası. İskonto = ELLE girilen (kampanya hariç), Kampanya ayrı; Brüt − İskonto − Kampanya = Net. İadede eksi. */
  brut?: number
  iskonto?: number
  kampanya?: number
  /** Aynı üçü belgenin kendi para biriminde. */
  dovizBrut?: number
  dovizIskonto?: number
  dovizKampanya?: number
  toplamSatisNet: number
  toplamSatisKdvli: number
  /** Satırın kendi para birimi (1=TRY 2=EUR 3=USD 4=GBP) ve o paradaki tutarlar. */
  currencyTypeId?: number
  currencyCode?: string
  dovizNet?: number
  dovizKdvli?: number
}

/**
 * Rapor sonucu + plasiyer kısıtı.
 *
 * `restrictedSalesmanCode` doluysa oturum bir PLASİYERE ait ve sunucu veriyi zaten yalnızca o
 * koda daralttı. Ekran bunu seçiciyi kilitlemek için kullanır — kısıtın kendisi sunucuda,
 * burada değil; bu alan değiştirilse de dönen veri değişmez.
 */
export type SalesMarketingReportResult = {
  items: SalesMarketingReportItemDto[]
  restrictedSalesmanCode: string | null
  /**
   * Ekrandaki para birimi düğmeleri buradan kurulur. Liste seçili süzgeçten BAĞIMSIZ
   * kapsamdan gelir — süzgeçten sonra hesaplansaydı USD seçildiği anda diğer düğmeler
   * kaybolur, kullanıcı geri dönemezdi.
   */
  availableCurrencyTypeIds: number[]
  /** Sunucunun gerçekte gösterdiği ay — istemci hiçbir şey seçmediğinde firmanın içinde
   *  bulunduğu ay döner ve seçici bununla eşitlenir. */
  year: number
  month: number
  /** Sunucunun uyguladığı tarih aralığı (yyyy-MM-dd, bitiş dahil). */
  startDate: string
  endDate: string
}

export async function fetchSalesMarketingReport(
  params: { salesmanCode?: string; islemTipi?: string; currencyTypeId?: number; year?: number; month?: number; startDate?: string; endDate?: string },
  signal?: AbortSignal
): Promise<SalesMarketingReportResult> {
  const sp = new URLSearchParams()
  if (params.salesmanCode) sp.set('salesmanCode', params.salesmanCode)
  if (params.islemTipi) sp.set('islemTipi', params.islemTipi)
  if (params.currencyTypeId && params.currencyTypeId > 0) sp.set('currencyTypeId', String(params.currencyTypeId))
  if (params.year) sp.set('year', String(params.year))
  if (params.month) sp.set('month', String(params.month))
  // İKİ TARİH ARASI (2026-09-30): verilirse ay seçiminin yerine geçer, bitiş günü dahil.
  if (params.startDate) sp.set('startDate', params.startDate)
  if (params.endDate) sp.set('endDate', params.endDate)

  const token = localStorage.getItem('accessToken')
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${API_BASE_URL}/api/reports/sales-marketing?${sp.toString()}`, {
    headers,
    signal
  })

  if (res.status === 401) {
    localStorage.removeItem('accessToken')
    if (typeof window !== 'undefined') redirectToLogin()
    throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.')
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || 'Satış pazarlama raporu alınamadı')
  }

  const json = await res.json()
  return {
    items: (json?.data ?? []) as SalesMarketingReportItemDto[],
    restrictedSalesmanCode: String(json?.restrictedSalesmanCode ?? '').trim() || null,
    availableCurrencyTypeIds: ((json?.availableCurrencyTypeIds ?? []) as any[]).map((x) => Number(x)).filter((x) => x > 0),
    year: Number(json?.year ?? 0),
    month: Number(json?.month ?? 0),
    startDate: String(json?.startDate ?? ''),
    endDate: String(json?.endDate ?? '')
  }
}



