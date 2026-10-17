import { CARI_EKSTRE_TIPLERI, TUM_CARI_EKSTRE_TIPLERI } from '../utils/cariEkstreKapsami'
import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { PHONE_FORMAT_MESSAGE, PHONE_MAX_DIGITS, PHONE_PATTERN, formatPhoneNumber } from '../utils/phone'
import { Navigate, useOutletContext } from 'react-router-dom'
import { Eye, EyeOff, FileText, Coins, Building2, Layers, UserCheck, Shield, Check, Info, Trash2, ArrowLeftRight, Wrench, Bell, FileSpreadsheet, CreditCard, ShoppingCart } from 'lucide-react'
import Table, { type TableColumn } from '../components/Table'
import { turkishIncludes } from '../utils/turkishSearch'
import CategoryManagementPage from './CategoryManagementPage'
import ProductGridPage from './ProductGridPage'
import AtliFiyatlandirmaPage from './AtliFiyatlandirmaPage'
import PriceCategoriesPage from './PriceCategoriesPage'
import CariEklePage from './CariEklePage'
import DeletionLogsPage from './DeletionLogsPage'
import InstallmentRulesAdminPage from './InstallmentRulesAdminPage'
import BankAccountDefinitionsPage from './BankAccountDefinitionsPage'
import PosAccountSettingsPage from './PosAccountSettingsPage'
import PosTransferPage from './PosTransferPage'
import CampaignsPage from './CampaignsPage'
import BulkPricingPage from './BulkPricingPage'
import SuppliersPage from './SuppliersPage'
import DepolarPage from './DepolarPage'
import ProjeYonetimiPage from './ProjeYonetimiPage'
import GlobalUsersAdminPage from './GlobalUsersAdminPage'
import AllUsersAdminPage from './AllUsersAdminPage'
import SsaOnboardPage from './SsaOnboardPage'
import JwtSessionSettingsPage from './JwtSessionSettingsPage'
import KasalarimPage from './KasalarimPage'
import NotificationsPage from './NotificationsPage'
import UserActivitiesPage from './UserActivitiesPage'
import { SystemErrorLogsPage } from './SystemErrorLogsPage'
import MaliDonemlerPage from './MaliDonemlerPage'
import SistemDenetimiPage from './SistemDenetimiPage'
import CheckBranchesPage from './CheckBranchesPage'
import NotificationPopup from '../components/NotificationPopup'
import Modal from '../components/Modal'
import { fetchWarehouses, type WarehouseDto } from '../api/warehouses'
import { fetchCashAccounts } from '../api/cashAccounts'
import { fetchBankAccountDefinitions } from '../api/bankAccountDefinitions'
import { API_BASE_URL } from '../config/api'
import AccessScopePicker from '../components/users/AccessScopePicker'
import GarantiDeposuAyarPage from './GarantiDeposuAyarPage'

type LayoutContext = {
  activeMenuId: string
  activeTabId?: string
  setActiveTabId?: (id?: string) => void
  isSuperAdmin?: boolean
}

/**
 * Rol Yetkileri ekranında her düğmenin NE YAPTIĞINI anlatan metinler.
 *
 * Kartların altında ham anahtar yazıyordu ('deleteRule/deleteRule/faturaDokum' gibi, modül adı
 * anahtarın içinde de geçtiği için iki kez). Bu, yetkiyi verecek kişiye hiçbir şey anlatmıyor;
 * en kötüsü de bazı düğmelerin adı yaptığı işin TERSİNİ ima ediyordu.
 *
 * Silme Ayarları'nın tamamı bu yüzden yanlış okunuyordu. Koddaki gerçek davranış
 * (bkz. InvoicesController.Delete, CariOffersController, PurchaseInvoicesController):
 *
 *   - 'deleteRule/<belge>' AÇIKSA o belge türünde silme 24 SAATLE SINIRLANIR. Yani düğme bir
 *     YETKİ değil KISITTIR: yeşil = daha az silebilir. Değişkenin koddaki adı bile
 *     `hasRestriction`. Kapalıyken süre sınırı yoktur.
 *   - 'deleteRule/tumIslemleriSilebilsin' ise BAŞKALARININ kayıtlarını silmeye izin verir.
 *     Kendi oluşturduğu kaydı herkes zaten silebilir (ControllerExtensions.CanDeleteRecordAsync
 *     kullanıcı adını karşılaştırıp koşulsuz true dönüyor), o yüzden "tüm işlemleri silebilsin"
 *     adı yanıltıcıydı.
 *
 * Anahtar biçimi: `moduleKey/key`.
 */
const PERMISSION_INFO: Record<string, { label?: string; help: string }> = {
  // 2026-09-18: Müşteri Teklifi penceresindeki "Cari Ekle" düğmesi. Sunucu tarafı
  // CustomerOffersController.CreateCari; sayfa kaydı CustomerOfferPagesSchema.
  // 2026-09-18: Hizmet Harcama Raporu sayfasi. Sunucu tarafi ServiceExpenseReportController;
  // sayfa kaydi AddedPagesSchema.
  'reports/hizmetHarcamaRaporu': {
    label: 'Hizmet Harcama Raporu',
    help: 'Alis faturalarindaki hizmet satirlarini (nakliye, iscilik vb.) hizmet turune gore toplayan rapor: hangi hizmete ne kadar harcandigi, tedarikci kirilimi ve aylik seyir. Yalnizca harcama tarafini gosterir, satilan hizmetleri degil.'
  },
  'invoice/musteriTeklifiCariEkle': {
    label: 'Müşteri Teklifi: Cari Ekle',
    help: 'Açıkken teklif penceresinde "Cari Ekle" düğmesi görünür; kullanıcı muhtelif bilgileriyle kalıcı bir BAYİ carisi açıp teklifi o carinin adına sürdürebilir. Cari kodu otomatik verilir (120-01-). Kapalıyken düğme hiç görünmez, muhtelif teklif vermek etkilenmez.'
  },
  'deleteRule/deleteRule/faturaDokum': {
    label: 'Fatura Dökümü: 24 saat kuralı',
    help: 'Açıkken fatura dökümü kayıtları yalnızca oluşturulduktan sonraki 24 saat içinde silinebilir. Kapalıyken süre sınırı yoktur.'
  },
  'deleteRule/deleteRule/musteriTeklifi': {
    label: 'Müşteri Teklifi: 24 saat kuralı',
    help: 'Açıkken müşteri teklifleri yalnızca ilk 24 saat içinde silinebilir. Kapalıyken süre sınırı yoktur.'
  },
  'deleteRule/deleteRule/proforma': {
    label: 'Proforma: 24 saat kuralı',
    help: 'Açıkken proformalar yalnızca ilk 24 saat içinde silinebilir. Kapalıyken süre sınırı yoktur.'
  },
  'deleteRule/deleteRule/alis': {
    label: 'Alış Siparişleri: 24 saat kuralı',
    help: 'Açıkken alış siparişleri yalnızca ilk 24 saat içinde silinebilir. Kapalıyken süre sınırı yoktur.'
  },
  'deleteRule/deleteRule/garantiDegisim': {
    label: 'Garanti Değişim: 24 saat kuralı',
    help: 'Açıkken garanti değişim kayıtları yalnızca oluşturulduktan sonraki 24 saat içinde silinebilir ve düzenlenebilir. Kapalıyken süre sınırı yoktur.'
  },
  // 2026-09-16: kasa, banka, çek/senet, depo, sipariş ve garanti kayıtları. Sunucu tarafı
  // ControllerExtensions.DeleteRuleViolationAsync; sayfa listesi DeleteRuleSchema.Rules.
  'deleteRule/deleteRule/kasaHareket': {
    label: 'Kasa Giriş/Çıkış: 24 saat kuralı',
    help: 'Açıkken kasa giriş/çıkış hareketleri yalnızca oluşturulduktan sonraki 24 saat içinde silinebilir. Kapalıyken süre sınırı yoktur.'
  },
  'deleteRule/deleteRule/kasaTransfer': {
    label: 'Kasalar Arası Transfer: 24 saat kuralı',
    help: 'Açıkken kasalar arası transferler yalnızca ilk 24 saat içinde silinebilir. Kapalıyken süre sınırı yoktur.'
  },
  'deleteRule/deleteRule/virman': {
    label: 'Virman: 24 saat kuralı',
    help: 'Açıkken virman kayıtları yalnızca ilk 24 saat içinde silinebilir. Kapalıyken süre sınırı yoktur.'
  },
  'deleteRule/deleteRule/bankaHareket': {
    label: 'Banka Havale/EFT: 24 saat kuralı',
    help: 'Açıkken banka havale/EFT hareketleri yalnızca ilk 24 saat içinde silinebilir. Kapalıyken süre sınırı yoktur.'
  },
  'deleteRule/deleteRule/bankaMasraf': {
    label: 'Banka Masrafları: 24 saat kuralı',
    help: 'Açıkken banka masraf kayıtları yalnızca ilk 24 saat içinde silinebilir. Kapalıyken süre sınırı yoktur.'
  },
  'deleteRule/deleteRule/kredi': {
    label: 'Krediler: 24 saat kuralı',
    help: 'Açıkken krediler ve kredi ödemeleri yalnızca ilk 24 saat içinde silinebilir veya iptal edilebilir. Kapalıyken süre sınırı yoktur.'
  },
  'deleteRule/deleteRule/posAktarim': {
    label: 'POS Aktarım: 24 saat kuralı',
    help: 'Açıkken POS aktarımları yalnızca ilk 24 saat içinde silinebilir. Kapalıyken süre sınırı yoktur.'
  },
  'deleteRule/deleteRule/musteriCeki': {
    label: 'Müşteri Çekleri: 24 saat kuralı',
    help: 'Açıkken müşteri çekleri yalnızca ilk 24 saat içinde silinebilir. Kapalıyken süre sınırı yoktur.'
  },
  'deleteRule/deleteRule/borcCeki': {
    label: 'Borç Çekleri: 24 saat kuralı',
    help: 'Açıkken borç çekleri yalnızca ilk 24 saat içinde silinebilir veya iptal edilebilir. Kapalıyken süre sınırı yoktur.'
  },
  'deleteRule/deleteRule/borcSenedi': {
    label: 'Borç Senetleri: 24 saat kuralı',
    help: 'Açıkken borç senetleri yalnızca ilk 24 saat içinde silinebilir veya iptal edilebilir. Kapalıyken süre sınırı yoktur.'
  },
  'deleteRule/deleteRule/depoTransfer': {
    label: 'Depo Transfer: 24 saat kuralı',
    help: 'Açıkken depo transferleri yalnızca ilk 24 saat içinde silinebilir. Kapalıyken süre sınırı yoktur.'
  },
  'deleteRule/deleteRule/irsaliye': {
    label: 'İrsaliye: 24 saat kuralı',
    help: 'Açıkken irsaliyeler yalnızca ilk 24 saat içinde silinebilir. Kapalıyken süre sınırı yoktur.'
  },
  'deleteRule/deleteRule/siparis': {
    label: 'Sipariş: 24 saat kuralı',
    help: 'Açıkken siparişler ve sipariş kalemleri yalnızca ilk 24 saat içinde silinebilir. Kapalıyken süre sınırı yoktur.'
  },
  'deleteRule/deleteRule/garantiKayit': {
    label: 'Garanti Kayıtları: 24 saat kuralı',
    help: 'Açıkken ürün garanti kayıtları yalnızca ilk 24 saat içinde silinebilir. Kapalıyken süre sınırı yoktur.'
  },
  'deleteRule/deleteRule/tumIslemleriSilebilsin': {
    label: 'Başkalarının kayıtlarını da silebilsin',
    help: 'Kendi oluşturduğu kaydı herkes silebilir; bu yetki başka kullanıcıların oluşturduğu kayıtları da silmeye izin verir.'
  },

  'bildirimler/bildirimlerGelen': {
    label: 'Gelen Bildirimler',
    help: 'Kendisine gönderilen bildirimleri görebilir. Tüm rollere açıktır.'
  },
  'bildirimler/bildirimlerGonder': {
    label: 'Bildirim Gönder',
    help: 'Başka kullanıcılara bildirim gönderebilir. Varsayılan olarak kapalıdır.'
  },
  'invoice/garantiDegisim': {
    label: 'Garanti Değişim',
    help: 'Garanti değişim ekranına erişebilir ve yeni değişim kaydedebilir.'
  },
  'invoice/garantiDegisimSil': {
    label: 'Sil',
    help: 'Garanti değişim kayıtlarını silmeye izin verir. Kapalı olduğunda kullanıcı sil butonunu göremez.'
  },
  'invoice/faturaTakip': {
    label: 'Fatura Takip',
    help: 'Fatura takip ekranını görür: planlanmamış faturalar, günün rotası, geçmiş ve görseller. Fatura Dökümü ekranında gördüğü faturalar (alış hariç) listelenir.'
  },
  'invoice/faturaTakipPlanla': {
    label: 'Planla',
    help: 'Faturaları teknisyene atar, başka güne alır ve planı kaldırır.'
  },
  'invoice/faturaTakipDurum': {
    label: 'Durum Güncelle',
    help: 'Tamamlandı / teslim edilemedi işaretler, durumu geri alır ve görsel ekler.'
  },
  'invoice/faturaTakipBasim': {
    label: 'Rota Basımı',
    help: 'Günün rotasını teknisyen başına A4 olarak basar.'
  },
  'serviceOps/faturaTakip': {
    label: 'Fatura Takip',
    help: 'Serviste kendisine atanan faturaları görür; teslim edildi / edilemedi işaretleyip yorum ve görsel ekler.'
  },
  'serviceOps/faturaTakip.tumIsleriGorme': {
    label: 'Tüm İşleri Görme',
    help: 'Servisteki Fatura Takip ekranında tüm teknisyenlerin faturalarını görür. Kapalıysa yalnızca kendisine atananları.'
  }
}


function KullaniciListesiView() {
  const { isSuperAdmin } = useOutletContext<LayoutContext>()

  type Row = {
    id: number
    roleId: number
    kullaniciAdi: string
    unvan: string
    cariKodu: string
    cariAdi: string
    email: string
    telefon: string
    salesmanCode?: string
    warehouseCodes?: number[]
    /** Kullanıcının varsayılan deposu; satış faturasında kalemin öntanımlı çıkış deposunu belirler. */
    defaultWarehouseCode?: number | null
    cashAccountId?: number | null
    bankAccountId?: number | null
    cashAccountIds?: number[]
    bankAccountIds?: number[]
    yetki: string
    isActive: boolean
    serviceOpsAccess?: boolean
    employeeAccess?: boolean
    asistanAccess?: boolean
    /** Cari ekstrede görebileceği tipler; null = hepsi (2026-10-11). */
    cariEkstreTipleri?: string[] | null
    sifre?: string
    actions: string
    discountRate?: number
    isCariPlasiyeri?: boolean
  }


  const validationFieldLabels: Record<string, string> = {
    Username: 'Kullanıcı Adı',
    Mail: 'Email',
    Password: 'Şifre',
    Unvan: 'Ünvan',
    Gsm: 'Telefon',
    Carikodu: 'Cari Kodu',
    DefaultWarehouseCode: 'Depo',
    RoleId: 'Yetki'
  }

  const [popupOpen, setPopupOpen] = useState(false)
  const [popupType, setPopupType] = useState<'success' | 'error' | 'info'>('info')
  const [popupTitle, setPopupTitle] = useState('')
  const [popupMessage, setPopupMessage] = useState('')

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmUserId, setConfirmUserId] = useState<number | null>(null)
  const [confirmMessage, setConfirmMessage] = useState('')

  const showPopup = (type: 'success' | 'error' | 'info', title: string, message: string) => {
    setPopupType(type)
    setPopupTitle(title)
    setPopupMessage(message)
    setPopupOpen(true)
  }

  const buildHeaders = (includeJson: boolean) => {
    const headers: Record<string, string> = {}
    if (includeJson) headers['Content-Type'] = 'application/json'
    const token = localStorage.getItem('accessToken')
    if (token) headers.Authorization = `Bearer ${token}`
    const tenantCode = String(localStorage.getItem('tenantCode') ?? '').trim()
    if (tenantCode) headers['X-Tenant-Code'] = tenantCode
    return headers
  }

  const readErrorText = async (res: Response) => {
    const text = await res.text().catch(() => '')
    const trimmed = String(text ?? '').trim()
    if (!trimmed) return `İşlem başarısız (${res.status})`
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const j = JSON.parse(trimmed)
        const msg = j?.message || j?.error || j?.title
        if (typeof msg === 'string' && msg.trim()) return msg.trim()

        const errors = j?.errors
        if (errors && typeof errors === 'object') {
          const parts: string[] = []
          Object.entries(errors).forEach(([k, v]) => {
            if (Array.isArray(v)) v.forEach((x) => parts.push(`${k}: ${x}`))
            else if (typeof v === 'string') parts.push(`${k}: ${v}`)
          })
          if (parts.length) {
            return parts
              .map((p) => {
                const idx = p.indexOf(':')
                if (idx <= 0) return p
                const key = p.slice(0, idx)
                const rest = p.slice(idx + 1).trim()
                const label = validationFieldLabels[key] ?? key
                return `${label}: ${rest}`
              })
              .join('\n')
          }
        }
      } catch {
      }
    }
    return trimmed
  }

  const fetchRoles = async () => {
    const res = await fetch(`${API_BASE_URL}/api/roles`, {
      headers: {
        ...buildHeaders(true)
      }
    })

    if (!res.ok) {
      throw new Error(`Roles fetch failed (${res.status})`)
    }

    const json = await res.json()
    return (json?.data ?? []) as Array<{ id: number; name: string; displayName: string; code?: string; isSuperAdmin?: boolean }>
  }

  const fetchUsers = async () => {
    const res = await fetch(`${API_BASE_URL}/api/users`, {
      headers: {
        ...buildHeaders(true)
      }
    })

    if (!res.ok) {
      throw new Error(`Users fetch failed (${res.status})`)
    }

    const json = await res.json()
    const items = (json?.data ?? []) as any[]

    return items.map(
      (u): Row => ({
        id: Number(u.id),
        roleId: Number(u.roleId ?? 0),
        kullaniciAdi: String(u.username ?? ''),
        unvan: String(u.unvan ?? ''),
        cariKodu: String(u.carikodu ?? ''),
        cariAdi: String(u.cariAdi ?? u.carikodu ?? ''),
        email: String(u.mail ?? ''),
        telefon: String(u.gsm ?? ''),
        salesmanCode: String(u.salesmanCode ?? ''),
        // NEGATİF DEPO KODU GEÇERLİDİR (ör. -21 YP SİPARİŞ); filtre `!== 0`. `> 0` süzgeci
        // negatif kodlu depoları listeden düşürüp kullanıcı düzenlenince yetkiyi siliyordu.
        warehouseCodes: Array.isArray(u.warehouseCodes) ? (u.warehouseCodes as any[]).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n !== 0) : [],
        defaultWarehouseCode: Number.isFinite(Number(u.defaultWarehouseCode)) && Number(u.defaultWarehouseCode) !== 0 ? Number(u.defaultWarehouseCode) : null,
        cashAccountId: u.defaultCashAccountId ? Number(u.defaultCashAccountId) : null,
        bankAccountId: u.defaultBankAccountId ? Number(u.defaultBankAccountId) : null,
        cashAccountIds: Array.isArray(u.cashAccountIds) ? (u.cashAccountIds as any[]).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0) : (u.defaultCashAccountId ? [Number(u.defaultCashAccountId)] : []),
        bankAccountIds: Array.isArray(u.bankAccountIds) ? (u.bankAccountIds as any[]).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0) : (u.defaultBankAccountId ? [Number(u.defaultBankAccountId)] : []),
        yetki: String(u.roleName ?? ''),
        isActive: Boolean(u.isActive ?? true),
        serviceOpsAccess: Boolean(u.serviceOpsAccess ?? false),
        employeeAccess: Boolean(u.employeeAccess ?? false),
        asistanAccess: Boolean(u.asistanAccess ?? false),
        cariEkstreTipleri: Array.isArray(u.cariEkstreTipleri) ? (u.cariEkstreTipleri as any[]).map((x) => String(x)) : null,
        sifre: isSuperAdmin ? String(u.password ?? '') : undefined,
        actions: '',
        discountRate: u.discountRate !== undefined && u.discountRate !== null ? Number(u.discountRate) : undefined,
        isCariPlasiyeri: Boolean(u.isCariPlasiyeri)
      })
    )
  }

  type CustomerOption = {
    customerCode: string
    name: string
    parentCustomerCode?: string | null
    customerType?: string | null
    /** Owning salesman, used to tick a whole book of customers at once. */
    salesmanCode?: string | null
  }

  const fetchCustomers = async () => {
    /**
     * `lite=true` — SEÇİCİYE YETEN BEŞ ALAN (2026-08-22).
     *
     * Bu sayfanın cari kapsam seçicisi listenin TAMAMINA ihtiyaç duyuyor (plasiyer ve
     * şube kırılımıyla gruplama yapıyor), yani istek kaldırılamıyor. Ama uç satır başına
     * 25 alan gönderiyordu — adres, e-posta, vergi bilgileri, dört kredi limiti — ve
     * hiçbiri burada kullanılmıyor. Canlıda ölçülen tam liste 4,2 MB idi.
     *
     * Aşağıdaki eşleme zaten yalnızca bu beş alanı okuyor; `lite` onları tel üzerinde de
     * tekilleştiriyor.
     */
    const res = await fetch(`${API_BASE_URL}/api/customers/dropdown?includeInactive=true&lite=true`, {
      headers: {
        ...buildHeaders(true)
      }
    })

    if (!res.ok) {
      throw new Error(`Customers fetch failed (${res.status})`)
    }

    const json = await res.json()
    const items = (json?.data ?? []) as any[]
    return items.map(
      (x): CustomerOption => ({
        customerCode: String(x.customerCode ?? ''),
        name: String(x.name ?? ''),
        parentCustomerCode: x.parentCustomerCode ?? null,
        customerType: x.customerType ?? null,
        salesmanCode: x.salesmanCode ?? null
      })
    )
  }

  const createUser = async (payload: {
    username: string
    mail: string
    password: string
    unvan: string
    gsm?: string
    carikodu?: string
    salesmanCode?: string
    warehouseCodes?: number[]
    defaultWarehouseCode?: number | null
    defaultCashAccountId?: number | null
    defaultBankAccountId?: number | null
    cashAccountIds?: number[]
    bankAccountIds?: number[]
    isActive: boolean
    roleId: number
    discountRate?: number | null
    isCariPlasiyeri?: boolean
    serviceOpsAccess: boolean
    employeeAccess: boolean
    asistanAccess: boolean
    cariEkstreTipleri?: string[]
  }) => {
    const res = await fetch(`${API_BASE_URL}/api/users`, {
      method: 'POST',
      headers: {
        ...buildHeaders(true)
      },
      body: JSON.stringify(payload)
    })

    if (!res.ok) {
      throw new Error(await readErrorText(res))
    }

    return await res.json()
  }

  const updateUser = async (
    id: number,
    payload: {
      username: string
      mail: string
      password?: string
      unvan: string
      gsm?: string
      carikodu?: string
      salesmanCode?: string
      warehouseCodes?: number[]
      defaultWarehouseCode?: number | null
      defaultCashAccountId?: number | null
      defaultBankAccountId?: number | null
      cashAccountIds?: number[]
      bankAccountIds?: number[]
      isActive: boolean
      roleId: number
      discountRate?: number | null
      isCariPlasiyeri?: boolean
      serviceOpsAccess: boolean
      employeeAccess: boolean
      asistanAccess: boolean
      cariEkstreTipleri?: string[]
    }
  ) => {
    const res = await fetch(`${API_BASE_URL}/api/users/${id}`, {
      method: 'PUT',
      headers: {
        ...buildHeaders(true)
      },
      body: JSON.stringify(payload)
    })

    if (!res.ok) {
      throw new Error(await readErrorText(res))
    }

    return await res.json()
  }

  const deleteUser = async (id: number) => {
    const res = await fetch(`${API_BASE_URL}/api/users/${id}`, {
      method: 'DELETE',
      headers: {
        ...buildHeaders(false)
      }
    })

    if (!res.ok) {
      throw new Error(await readErrorText(res))
    }

    if (res.status === 204) return null
    const text = await res.text().catch(() => '')
    const trimmed = String(text ?? '').trim()
    if (!trimmed) return null
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed
    }
  }

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  /** Tablo EKRANDA KALIRKEN yapılan tazeleme. Bkz. `reload`. */
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [roles, setRoles] = useState<Array<{ id: number; name: string; displayName: string; code?: string; isSuperAdmin?: boolean }>>([])
  const [customers, setCustomers] = useState<CustomerOption[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseDto[]>([])

  // PLASİYER ROLÜ NUMARADAN DEĞİL KODDAN BULUNUR (2026-08-17).
  //
  // Ekran boyunca `roleId === 10` yazılıydı. Tohumlanan listede 10 gerçekten Plasiyer, yani
  // bugün doğru çalışıyor; ama rol numarası sabit bir sözleşme değil — firma rolü silip
  // yeniden oluşturursa ya da ikinci bir plasiyer rolü tanımlarsa plasiyer alanları (indirim
  // oranı, plasiyer kodu, cari plasiyeri) sessizce yanlış role bağlanır. `Role.Code` alanı
  // zaten var ve tohumda "Plasiyer"; numara yerine ona bakılıyor, bulunamazsa 10'a düşülüyor.
  const salesmanRoleId = useMemo(() => {
    const byCode = roles.find((r) => (r.code ?? '').trim().toLowerCase() === 'plasiyer')
    return byCode?.id ?? 10
  }, [roles])
  const [cashAccounts, setCashAccounts] = useState<any[]>([])
  const [bankAccounts, setBankAccounts] = useState<any[]>([])
  const [regions, setRegions] = useState<Array<{ id: string; name: string }>>([])

  /**
   * Listeyi tazeler.
   *
   * <b>`background` neden var:</b> `loading` bayrağı tabloyu iskelet ekranla DEĞİŞTİRİYOR,
   * yani `<Table
          onRefresh={() => void reload()}>` bileşenini söküp yeniden kuruyordu. Silme ya da kayıttan sonra her
   * seferinde sütun süzgeçleri, sıralama, sayfa numarası ve kaydırma konumu sıfırlanıyor;
   * kullanıcı bunu "sayfa yenileniyor" diye görüyordu. İlk açılışta iskelet DOĞRU (ekranda
   * gösterilecek bir şey yok), ama zaten dolu bir tabloyu boşaltmak için sebep yok — veri
   * sessizce yerine geçer.
   */
  const reload = async (options?: { customerList?: CustomerOption[]; background?: boolean }) => {
    const background = options?.background ?? false
    try {
      if (background) setRefreshing(true)
      else setLoading(true)
      setError(null)
      const next = await fetchUsers()
      const list = options?.customerList ?? customers
      const customerIndex = new Map(list.map((c) => [c.customerCode, c.name] as const))
      setRows(next.map((r) => ({ ...r, cariAdi: r.cariAdi || customerIndex.get(r.cariKodu) || r.cariKodu })))
    } catch (e: any) {
      setError(e?.message ?? 'Bir hata oluştu')
    } finally {
      if (background) setRefreshing(false)
      else setLoading(false)
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true)
        // Tablo ve formun temel listelerini paralel yükle
        const [roleItems, warehouseItems, cashItems, bankItems, userItems] = await Promise.all([
          fetchRoles(),
          fetchWarehouses(),
          fetchCashAccounts(),
          fetchBankAccountDefinitions(),
          fetchUsers()
        ])
        setRoles(roleItems)
        setWarehouses(warehouseItems)
        setCashAccounts(cashItems ?? [])
        setBankAccounts(bankItems ?? [])
        setRows(userItems)
        setLoading(false)

        // Cari seçeneklerini ve servis bölgelerini arka planda yükle (tablo render'ını bekletmez)
        fetchCustomers()
          .then((customerItems) => {
            setCustomers(customerItems)
            const customerIndex = new Map(customerItems.map((c) => [c.customerCode, c.name] as const))
            setRows((prev) =>
              prev.map((r) => ({
                ...r,
                cariAdi: r.cariAdi || customerIndex.get(r.cariKodu) || r.cariKodu
              }))
            )
          })
          .catch((err) => {
            console.error('Failed to load customers dropdown:', err)
          })

        fetch(`${API_BASE_URL}/api/service-ops/technicians/regions`, {
          headers: { ...buildHeaders(true) }
        }).then(async (resRegions) => {
          if (resRegions.ok) {
            const regionItems = await resRegions.json()
            setRegions(regionItems ?? [])
          }
        }).catch((err) => {
          console.error('Failed to load regions:', err)
        })

      } catch (e: any) {
        setError(String(e?.message ?? 'Bir hata oluştu'))
        setLoading(false)
      }
    })()
  }, [])

  type FormState = {
    id: number | null
    username: string
    title: string
    email: string
    phoneNumber: string
    currentCode: string
    currentPassword: string
    password: string
    confirmPassword: string
    salesmanCode: string
    warehouseCodes: string[]
    defaultWarehouseCode: string
    cashAccountId: number | null
    bankAccountId: number | null
    cashAccountIds: number[]
    bankAccountIds: number[]
    roleId: number
    isActive: boolean
    discountRate: string
    isCariPlasiyeri: boolean
    serviceOpsAccess: boolean
    employeeAccess: boolean
    asistanAccess: boolean
    /** Görebileceği cari ekstre tipleri — hepsi işaretliyse kısıtlama yok. */
    cariEkstreTipleri: string[]
  }

  function friendlyValidationMessage(key: string, message: string) {
    const k = String(key ?? '').toLowerCase()
    const m = String(message ?? '').trim()
    const label =
      k === 'username'
        ? 'Kullanıcı Adı'
        : k === 'mail' || k === 'email'
          ? 'Email'
          : k === 'unvan' || k === 'title'
            ? 'Ünvan'
            : k === 'gsm' || k === 'phonenumber'
              ? 'Telefon'
              : k === 'roleid'
                ? 'Rol'
                : k === 'warehousecodes'
                  ? 'Depo'
                  : k === 'defaultwarehousecode'
                    ? 'Varsayılan Depo'
                    : key

    const lowered = m.toLowerCase()
    if (lowered.includes('not a valid e-mail address') || lowered.includes('valid e-mail')) {
      return `${label}: Geçerli bir email adresi giriniz`
    }
    if (lowered.includes('is required')) {
      return `${label}: Zorunlu alan`
    }
    if (lowered.includes('must be unique')) {
      return `${label}: Daha önce kullanılmış`
    }
    if (lowered.includes('invalid')) {
      return `${label}: Geçersiz`
    }
    return `${label}: ${m}`
  }

  function friendlyApiErrorMessage(e: any, fallback: string) {
    const raw = String(e?.message ?? '').trim()
    if (!raw) return fallback

    if (raw.startsWith('{') || raw.startsWith('[')) {
      try {
        const j = JSON.parse(raw)
        const errors = j?.errors
        if (errors && typeof errors === 'object') {
          const parts: string[] = []
          Object.entries(errors).forEach(([k, v]) => {
            if (Array.isArray(v)) v.forEach((x) => parts.push(friendlyValidationMessage(k, String(x))))
            else if (typeof v === 'string') parts.push(friendlyValidationMessage(k, v))
          })
          if (parts.length) return parts.join('\n')
        }
      } catch {
        return raw
      }
    }

    if (raw === 'One or more validation errors occurred.') return fallback
    return raw
  }

  const emptyForm: FormState = {
    id: null,
    username: '',
    title: '',
    email: '',
    phoneNumber: '',
    currentCode: '',
    currentPassword: '',
    password: '',
    confirmPassword: '',
    salesmanCode: '',
    warehouseCodes: [],
    defaultWarehouseCode: '',
    cashAccountId: null,
    bankAccountId: null,
    cashAccountIds: [],
    bankAccountIds: [],
    roleId: 1,
    isActive: true,
    discountRate: '',
    isCariPlasiyeri: false,
    serviceOpsAccess: false,
    employeeAccess: false,
    asistanAccess: false,
    cariEkstreTipleri: [...TUM_CARI_EKSTRE_TIPLERI]
  }

  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create')
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)

  // Cari seçicinin arama/açık-kapalı durumu ve dışarı tıklama davranışı artık CariScopePicker'ın
  // kendi içinde; iki ekran onu paylaştığı için burada tutulmasının anlamı kalmadı.

  const [techCreateOpen, setTechCreateOpen] = useState(false)
  const [techActionLoading, setTechActionLoading] = useState(false)
  const [techActionError, setTechActionError] = useState<string | null>(null)

  const [activeView, setActiveView] = useState<'users' | 'technicians'>('users')
  const [technicians, setTechnicians] = useState<any[]>([])
  const [techLoading, setTechLoading] = useState(false)
  const [techError, setTechError] = useState<string | null>(null)
  const [editingTechId, setEditingTechId] = useState<string | null>(null)
  const [confirmTechId, setConfirmTechId] = useState<string | null>(null)

  const loadTechnicians = async (options?: { background?: boolean }) => {
    const background = options?.background ?? false
    try {
      // Kullanıcı tablosundaki ile aynı gerekçe: dolu bir listeyi tazelemek için boşaltmak
      // gerekmiyor.
      if (!background) setTechLoading(true)
      setTechError(null)
      const res = await fetch(`${API_BASE_URL}/api/service-ops/technicians`, {
        headers: buildHeaders(true)
      })
      if (!res.ok) {
        throw new Error(`Teknisyenler yüklenemedi (${res.status})`)
      }
      const json = await res.json()
      setTechnicians(Array.isArray(json) ? json : json?.data ?? [])
    } catch (e: any) {
      setTechError(e?.message || 'Teknisyen listesi alınamadı')
    } finally {
      if (!background) setTechLoading(false)
    }
  }

  useEffect(() => {
    if (activeView === 'technicians') {
      void loadTechnicians()
    }
  }, [activeView])
  const [newTech, setNewTech] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    expertise: '',
    username: '',
    password: '',
    roles: [] as string[],
    /** Teknisyenin KENDİ kodu. Users.ServiceOpsCariKodu'ya yazılır — kimliktir, kapsam değil. */
    cariKodu: '',
    /**
     * Teknisyenin göreceği cariler; Users.Carikodu'ya yazılır. Kabul ekranlarındaki filtre bunu
     * okur. Kendi kodundan ayrı bir sütunda durur (bkz. migration AddUserServiceOpsCariKodu):
     * ikisi aynı alanda tutulduğunda "TECH-2026-003,*" gibi bir değer oluşuyor ve `*` B2B'de
     * "kısıtlama yok" anlamına geldiği için teknisyen bütün carilere açılıyordu.
     */
    cariScope: '',
    roleId: '' as number | '',
    /** Teknisyenin kendi aracı / kasası — tekil, çünkü bir teknisyenin bir aracı olur. */
    warehouseCode: '' as number | '',
    cashAccountId: '' as number | '',
    bankAccountId: '' as number | '',
    posAccountId: '' as number | '',
    primaryRegionId: '' as string | '',
    /**
     * B2B tarafındaki erişim yetkileri — kullanıcı formundakiyle aynı alanlar. Teknisyen kaydı bir
     * B2B kullanıcısı da yaratıyor ama bu listeler hiç yazılmıyordu, dolayısıyla teknisyenlerin
     * B2B'de tek bir depo/kasa/banka yetkisi bile olmuyordu.
     */
    warehouseCodes: [] as string[],
    cashAccountIds: [] as number[],
    bankAccountIds: [] as number[],
    /**
     * WhatsApp Asistanı'na giriş (2026-10-11). Teknisyenler Kullanıcılar listesinde görünmüyor
     * (servis personeli rolleri orada gizli), bu formda da kutu yoktu → asistana açılamıyorlardı.
     */
    asistanAccess: false
  })
  /** Sistem rolü listesi uzun; kullanıcı formundaki gibi aranabilir olmalı. */
  const [techRoleQuery, setTechRoleQuery] = useState('')

  const branchesByParent = useMemo(() => {
    const map: Record<string, CustomerOption[]> = {}
    for (const it of customers ?? []) {
      const code = String(it?.customerCode ?? '').trim()
      if (!code) continue
      const parent = String((it as any)?.parentCustomerCode ?? '').trim()
      if (!parent) continue
      if (!code.startsWith('01-')) continue
        ; (map[parent] ??= []).push(it)
    }

    Object.keys(map).forEach((k) => {
      map[k] = (map[k] ?? []).slice().sort((a, b) => String(a.customerCode).localeCompare(String(b.customerCode)))
    })

    return map
  }, [customers])

  const visibleCustomers = useMemo(() => {
    const selectedRole = roles.find((x) => Number(x.id) === Number(form.roleId))
    const isAltBayiRole = Boolean(
      selectedRole &&
      (selectedRole.name === 'AltBayi' || selectedRole.displayName.toLowerCase().includes('alt bayi') || (selectedRole as any)?.code === 'AltBayi')
    )

    if (isAltBayiRole) {
      return (customers ?? []).filter((it) => {
        const ct = String(it?.customerType ?? '').trim().toLocaleLowerCase('tr-TR')
        return ct === 'şube' || ct === 'sube' || ct === 'bayi'
      })
    }

    const items = customers ?? []
    return items.filter((it) => {
      const code = String(it?.customerCode ?? '').trim()
      if (!code) return false
      const parent = String((it as any)?.parentCustomerCode ?? '').trim()
      if (code.startsWith('120-') && parent) return false
      return true
    })
  }, [customers, roles, form.roleId])

  const customerDropdownItems = visibleCustomers

  /** Customer code to a readable label, falling back to the code when it is not in the list. */
  const customerNameOf = useCallback(
    (code: string) => {
      if (code === '*') return 'Tüm Cariler'
      const found = customers.find((c) => c.customerCode === code)
      return found ? `[${code}] ${found.name}` : code
    },
    [customers]
  )

  const openCreateModal = () => {
    setModalMode('create')
    setForm(emptyForm)
    setShowNewPassword(false)
    setModalError(null)
    setModalOpen(true)
  }

  const openEditModal = (row: Row) => {
    setModalMode('edit')
    setForm({
      id: row.id,
      username: row.kullaniciAdi,
      title: row.unvan,
      email: row.email,
      phoneNumber: row.telefon,
      currentCode: row.cariKodu,
      currentPassword: '',
      password: '',
      confirmPassword: '',
      salesmanCode: String(row.salesmanCode ?? ''),
      warehouseCodes: (row.warehouseCodes ?? []).map((x) => String(x)),
      defaultWarehouseCode: row.defaultWarehouseCode != null ? String(row.defaultWarehouseCode) : '',
      cashAccountId: row.cashAccountId ?? null,
      bankAccountId: row.bankAccountId ?? null,
      cashAccountIds: row.cashAccountIds ?? (row.cashAccountId ? [row.cashAccountId] : []),
      bankAccountIds: row.bankAccountIds ?? (row.bankAccountId ? [row.bankAccountId] : []),
      roleId: Number.isFinite(row.roleId) && row.roleId > 0 ? row.roleId : 1,
      isActive: row.isActive,
      discountRate: row.discountRate !== undefined && row.discountRate !== null ? String(row.discountRate) : '',
      isCariPlasiyeri: Boolean(row.isCariPlasiyeri),
      serviceOpsAccess: Boolean(row.serviceOpsAccess),
      employeeAccess: Boolean(row.employeeAccess),
      asistanAccess: Boolean(row.asistanAccess),
      cariEkstreTipleri: row.cariEkstreTipleri && row.cariEkstreTipleri.length ? [...row.cariEkstreTipleri] : [...TUM_CARI_EKSTRE_TIPLERI]
    })
    setShowNewPassword(false)
    setModalError(null)
    setModalOpen(true)
  }

  const closeModal = () => {
    if (saving) return
    // Seçicinin geçici durumu (arama, "tümü seçili" özeti) AccessScopePicker'ın içinde; modal
    // kapanınca bileşen unmount olduğu için ayrıca sıfırlanması gerekmiyor.
    setModalOpen(false)
  }

  const submitModal = async () => {
    try {
      setSaving(true)
      setModalError(null)

      const username = form.username.trim()
      const title = form.title.trim()
      const email = form.email.trim()
      const phoneNumber = form.phoneNumber.trim()
      const currentCode = form.currentCode.trim()
      const roleId = form.roleId
      const salesmanCode = form.salesmanCode.trim()

      const selectedRole = roles.find((x) => Number(x.id) === Number(roleId))
      const roleIsSuperAdmin = Boolean((selectedRole as any)?.isSuperAdmin)
      // NEGATİF DEPO KODU GEÇERLİDİR (ör. -21 YP SİPARİŞ); filtre `!== 0`.
      const warehouseCodes = roleIsSuperAdmin
        ? []
        : (form.warehouseCodes ?? [])
          .map((x) => Number(String(x ?? '').trim()))
          .filter((n) => Number.isFinite(n) && n !== 0)
          .filter((n, idx, arr) => arr.indexOf(n) === idx)

      // Varsayılan depo yalnızca verilen yetkiler arasından gidebilir; sunucu da aynı kuralı
      // doğruluyor, burada süzmek 400 yerine sessiz ve doğru davranış demek.
      //
      // SÜPER ADMİN AYRIK: depo YETKİSİ tutulmuyor (zaten hepsine erişir), o yüzden yetki
      // listesiyle süzülemez — aktif depolardan hangisi seçildiyse o gider. Burada `null`a
      // sabitlendiği için süper adminin varsayılan deposu hiç kaydedilemiyordu.
      const defaultWarehouseCodeNum = Number(String(form.defaultWarehouseCode ?? '').trim())
      const defaultWarehouseCode = roleIsSuperAdmin
        ? (Number.isFinite(defaultWarehouseCodeNum) && defaultWarehouseCodeNum !== 0 ? defaultWarehouseCodeNum : null)
        : Number.isFinite(defaultWarehouseCodeNum) && defaultWarehouseCodeNum !== 0 && warehouseCodes.includes(defaultWarehouseCodeNum)
          ? defaultWarehouseCodeNum
          : null



      if (!username || !title || !email) {
        setModalError('Lütfen zorunlu alanları doldurun')
        return
      }

      if (email && !email.includes('@')) {
        setModalError('Geçerli bir email adresi giriniz')
        return
      }

      if (!Number.isFinite(roleId) || roleId <= 0) {
        setModalError('RoleId geçersiz')
        return
      }

      let discountRateVal: number | null = null
      const discountStr = String(form.discountRate ?? '').trim()
      if (discountStr !== '') {
        const num = Number(discountStr)
        if (!Number.isFinite(num) || num < 0 || num > 100) {
          setModalError('İndirim oranı 0 ile 100 arasında bir değer olmalıdır.')
          return
        }
        discountRateVal = num
      } else if (roleId === salesmanRoleId) {
        setModalError('Plasiyer rolü için indirim oranı zorunludur.')
        return
      }

      if (phoneNumber && !PHONE_PATTERN.test(phoneNumber)) {
        setModalError(PHONE_FORMAT_MESSAGE)
        return
      }
      const normalizedPhone = phoneNumber

      if (modalMode === 'create') {
        if (!form.password) {
          setModalError('Şifre zorunludur')
          return
        }
        if (form.password !== form.confirmPassword) {
          setModalError('Şifreler eşleşmiyor!')
          return
        }

        await createUser({
          username,
          unvan: title,
          mail: email,
          gsm: normalizedPhone || undefined,
          // Sent for every role, including Plasiyer. It used to be suppressed for role 10 on
          // the assumption that a Plasiyer is scoped by salesman code alone, so their customer
          // scope silently never saved — the dialog reported success and changed nothing.
          // '*' is the explicit "all customers"; an empty selection means the same thing and is
          // normalised to it rather than being dropped from the payload.
          carikodu: currentCode || '*',
          salesmanCode: roleId === salesmanRoleId ? salesmanCode || undefined : undefined,
          warehouseCodes,
          defaultWarehouseCode,
          cashAccountIds: form.cashAccountIds,
          bankAccountIds: form.bankAccountIds,
          defaultCashAccountId: form.cashAccountIds[0] ?? null,
          defaultBankAccountId: form.bankAccountIds[0] ?? null,
          password: form.password,
          isActive: form.isActive,
          roleId,
          discountRate: discountRateVal,
          isCariPlasiyeri: roleId === salesmanRoleId ? form.isCariPlasiyeri : false,
          serviceOpsAccess: form.serviceOpsAccess,
          employeeAccess: form.employeeAccess,
          asistanAccess: form.asistanAccess,
          // Hepsi işaretli = kısıtlama yok (sunucu null saklar).
          cariEkstreTipleri: form.cariEkstreTipleri
        })
      } else {
        if (!form.id) {
          setModalError('Kullanıcı id bulunamadı')
          return
        }
        if (form.password && form.password !== form.confirmPassword) {
          setModalError('Yeni şifreler eşleşmiyor!')
          return
        }

        await updateUser(form.id, {
          username,
          unvan: title,
          mail: email,
          gsm: normalizedPhone || undefined,
          // Sent for every role, including Plasiyer. It used to be suppressed for role 10 on
          // the assumption that a Plasiyer is scoped by salesman code alone, so their customer
          // scope silently never saved — the dialog reported success and changed nothing.
          // '*' is the explicit "all customers"; an empty selection means the same thing and is
          // normalised to it rather than being dropped from the payload.
          carikodu: currentCode || '*',
          salesmanCode: roleId === salesmanRoleId ? salesmanCode || undefined : undefined,
          warehouseCodes,
          defaultWarehouseCode,
          cashAccountIds: form.cashAccountIds,
          bankAccountIds: form.bankAccountIds,
          defaultCashAccountId: form.cashAccountIds[0] ?? null,
          defaultBankAccountId: form.bankAccountIds[0] ?? null,
          password: form.password.trim().length ? form.password : undefined,
          isActive: form.isActive,
          roleId,
          discountRate: discountRateVal,
          isCariPlasiyeri: roleId === salesmanRoleId ? form.isCariPlasiyeri : false,
          serviceOpsAccess: form.serviceOpsAccess,
          employeeAccess: form.employeeAccess,
          asistanAccess: form.asistanAccess,
          // Hepsi işaretli = kısıtlama yok (sunucu null saklar).
          cariEkstreTipleri: form.cariEkstreTipleri
        })
      }

      setModalOpen(false)
      showPopup('success', 'Başarılı', modalMode === 'create' ? 'Kullanıcı oluşturuldu' : 'Kullanıcı güncellendi')
      await reload({ background: true })
    } catch (e: any) {
      const msg = friendlyApiErrorMessage(e, 'Bir hata oluştu')
      setModalError(msg)
      showPopup('error', 'Hata', msg)
    } finally {
      setSaving(false)
    }
  }

  const onEdit = async (row: Row) => {
    openEditModal(row)
  }

  const onDelete = async (row: Row) => {
    try {
      await deleteUser(row.id)

      // Sunucu silmeyi onayladı: satır ANINDA listeden kalkar. Tazelemeyi beklemek,
      // silinen satırın bir süre daha ekranda durması demekti.
      setRows((prev) => prev.filter((r) => r.id !== row.id))
      showPopup('success', 'Başarılı', 'Kullanıcı silindi')

      // Sunucu tarafında başka bir şey de değişmiş olabilir (yetki, cari bağı). Arka planda
      // tazelenir; tablo ekranda kalır, süzgeç ve kaydırma bozulmaz.
      await reload({ background: true })
    } catch (e: any) {
      const msg = String(e?.message ?? 'Bir hata oluştu')
      setError(msg)
      showPopup('error', 'Hata', msg)
    }
  }

  const onDeleteTech = async (id: string) => {
    try {
      setTechActionLoading(true)
      const res = await fetch(`${API_BASE_URL}/api/service-ops/technicians/${id}`, {
        method: 'DELETE',
        headers: buildHeaders(true)
      })
      if (!res.ok) {
        const text = await res.text()
        let errMessage = 'Teknisyen silinemedi'
        try {
          const parsed = JSON.parse(text)
          errMessage = parsed.message || parsed.error || errMessage
        } catch {
          if (text) errMessage = text
        }
        throw new Error(errMessage)
      }
      setTechnicians((prev) => prev.filter((t: any) => String(t?.id ?? '') !== String(id)))
      showPopup('success', 'Başarılı', 'Teknisyen başarıyla silindi.')
      await loadTechnicians({ background: true })
    } catch (e: any) {
      showPopup('error', 'Hata', e?.message || 'Teknisyen silinemedi')
    } finally {
      setTechActionLoading(false)
    }
  }

  const submitTechModal = async () => {
    if (techActionLoading) return
    const username = newTech.username.trim()
    const password = newTech.password.trim()

    if (!editingTechId) {
      if (!username) {
        setTechActionError('Kullanıcı adı zorunlu')
        return
      }
      if (!password || password.length < 6) {
        setTechActionError('Şifre en az 6 karakter olmalı')
        return
      }
    } else {
      if (password && password.length < 6) {
        setTechActionError('Şifre en az 6 karakter olmalı')
        return
      }
    }

    setTechActionLoading(true)
    setTechActionError(null)

    try {
      if (editingTechId) {
        const res = await fetch(`${API_BASE_URL}/api/service-ops/technicians/${editingTechId}`, {
          method: 'PUT',
          headers: buildHeaders(true),
          body: JSON.stringify({
            firstName: newTech.firstName,
            lastName: newTech.lastName,
            phone: newTech.phone,
            email: newTech.email || null,
            username: newTech.username || null,
            expertiseAreas: newTech.expertise
              ? newTech.expertise.split(',').map((s) => s.trim()).filter(Boolean)
              : [],
            roles: newTech.roles,
            cariKodu: newTech.cariKodu || null,
            cariScope: newTech.cariScope || null,
            roleId: newTech.roleId ? Number(newTech.roleId) : null,
            warehouseCode: newTech.warehouseCode || null,
            warehouseName: warehouses.find(w => w.warehouseCode === newTech.warehouseCode)?.name || null,
            cashAccountId: newTech.cashAccountId || null,
            cashAccountName: cashAccounts.find(c => c.id === newTech.cashAccountId)?.name || null,
            bankAccountId: newTech.bankAccountId || null,
            bankAccountName: bankAccounts.find(b => b.id === newTech.bankAccountId)?.accountName || null,
            posAccountId: newTech.posAccountId || null,
            posAccountName: bankAccounts.find(b => b.id === newTech.posAccountId)?.accountName || null,
            primaryRegionId: newTech.primaryRegionId || null,
            // B2B kullanıcısının erişim yetkileri. ServiceOps bu alanları yok sayar; teknisyen
            // kaydıyla birlikte yaratılan B2B kullanıcısına yazılırlar.
            // NEGATİF DEPO KODU GEÇERLİDİR (ör. -21 YP SİPARİŞ); filtre `!== 0`.
            warehouseCodes: newTech.warehouseCodes.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n !== 0),
            cashAccountIds: newTech.cashAccountIds,
            bankAccountIds: newTech.bankAccountIds,
            asistanAccess: newTech.asistanAccess
          })
        })

        const text = await res.text()
        if (!res.ok) {
          let errMessage = 'Teknisyen güncellenemedi'
          try {
            const parsed = JSON.parse(text)
            errMessage = parsed.message || parsed.error || errMessage
          } catch {
            if (text) errMessage = text
          }
          throw new Error(errMessage)
        }

        if (password) {
          // Kimlik ServiceOps'un id'si olabilir; sunucu kullanıcı adıyla da eşleştirsin (2026-09-18).
          const resPass = await fetch(`${API_BASE_URL}/api/service-ops/technicians/${editingTechId}/password`, {
            method: 'PUT',
            headers: buildHeaders(true),
            body: JSON.stringify({ password, username: newTech.username || undefined })
          })
          if (!resPass.ok) {
            const textPass = await resPass.text()
            let errMessage = 'Şifre güncellenemedi'
            try {
              const parsed = JSON.parse(textPass)
              errMessage = parsed.message || parsed.error || errMessage
            } catch {
              if (textPass) errMessage = textPass
            }
            throw new Error(errMessage)
          }
        }

        setTechCreateOpen(false)
        setEditingTechId(null)
        showPopup('success', 'Başarılı', 'Teknisyen başarıyla güncellendi.')
        await loadTechnicians({ background: true })
      } else {
        const res = await fetch(`${API_BASE_URL}/api/service-ops/technicians`, {
          method: 'POST',
          headers: buildHeaders(true),
          body: JSON.stringify({
            firstName: newTech.firstName,
            lastName: newTech.lastName,
            phone: newTech.phone,
            email: newTech.email || null,
            expertiseAreas: newTech.expertise
              ? newTech.expertise.split(',').map((s) => s.trim()).filter(Boolean)
              : [],
            roles: newTech.roles,
            cariKodu: newTech.cariKodu || null,
            cariScope: newTech.cariScope || null,
            roleId: newTech.roleId ? Number(newTech.roleId) : null,
            username,
            password,
            warehouseCode: newTech.warehouseCode || null,
            warehouseName: warehouses.find(w => w.warehouseCode === newTech.warehouseCode)?.name || null,
            cashAccountId: newTech.cashAccountId || null,
            cashAccountName: cashAccounts.find(c => c.id === newTech.cashAccountId)?.name || null,
            bankAccountId: newTech.bankAccountId || null,
            bankAccountName: bankAccounts.find(b => b.id === newTech.bankAccountId)?.accountName || null,
            posAccountId: newTech.posAccountId || null,
            posAccountName: bankAccounts.find(b => b.id === newTech.posAccountId)?.accountName || null,
            primaryRegionId: newTech.primaryRegionId || null,
            // B2B kullanıcısının erişim yetkileri. ServiceOps bu alanları yok sayar; teknisyen
            // kaydıyla birlikte yaratılan B2B kullanıcısına yazılırlar.
            // NEGATİF DEPO KODU GEÇERLİDİR (ör. -21 YP SİPARİŞ); filtre `!== 0`.
            warehouseCodes: newTech.warehouseCodes.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n !== 0),
            cashAccountIds: newTech.cashAccountIds,
            bankAccountIds: newTech.bankAccountIds,
            asistanAccess: newTech.asistanAccess
          })
        })

        const text = await res.text()
        if (!res.ok) {
          let errMessage = 'Teknisyen oluşturulamadı'
          try {
            const parsed = JSON.parse(text)
            errMessage = parsed.message || parsed.error || errMessage
          } catch {
            if (text) errMessage = text
          }
          throw new Error(errMessage)
        }

        setTechCreateOpen(false)
        showPopup('success', 'Başarılı', 'Teknisyen başarıyla oluşturuldu.')
        await loadTechnicians({ background: true })
      }
    } catch (e: any) {
      setTechActionError(e?.message || 'İşlem başarısız oldu')
    } finally {
      setTechActionLoading(false)
    }
  }

  const [search, setSearch] = useState('')

  const columns: TableColumn<Row>[] = useMemo(
    () => {
      const roleOptions = roles
        .map((r) => ({
          label: r.displayName || r.name,
          value: r.displayName || r.name
        }))
        .filter((x) => x.value.trim().length > 0)

      const cols: TableColumn<Row>[] = [
        { key: 'kullaniciAdi', label: 'Kullanıcı Adı', searchable: true },
        { key: 'unvan', label: 'Ünvan', searchable: true },
        {
          key: 'cariAdi',
          label: 'Cari Adı',
          searchable: true,
          /*
            A scope can now name dozens of customers. Printed straight into the cell it stretched
            the table far past the screen, so anything past the first is collapsed behind a count
            and opened on click.
          */
          render: (_v, row) => <CariScopeCell codes={row.cariKodu} nameOf={customerNameOf} />
        },
        { key: 'email', label: 'Email', searchable: true },
        { key: 'telefon', label: 'Telefon', searchable: true },
        { key: 'yetki', label: 'Yetki', searchable: true, filter: { type: 'select', options: roleOptions } },
        {
          key: 'discountRate',
          label: 'İndirim Oranı',
          render: (_v, row) => row.discountRate !== undefined && row.discountRate !== null ? `%${row.discountRate}` : '—'
        },
        {
          key: 'isActive',
          label: 'Aktif',
          searchable: true,
          filter: {
            type: 'select',
            options: [
              { label: 'Aktif', value: 'true' },
              { label: 'Pasif', value: 'false' }
            ]
          },
          render: (v) => (v ? 'Aktif' : 'Pasif')
        },
        {
          key: 'serviceOpsAccess',
          label: 'Servis Bağlantısı',
          render: (v) => (v ? 'Var' : 'Yok')
        },
        {
          key: 'employeeAccess',
          label: 'Çalışan Yönetimi',
          render: (v) => (v ? 'Var' : 'Yok')
        },
        {
          key: 'asistanAccess',
          label: 'Asistan (WhatsApp)',
          render: (v) => (v ? 'Var' : 'Yok')
        }
      ]

      if (isSuperAdmin) {
        cols.splice(5, 0, {
          key: 'sifre',
          label: 'Şifre',
          searchable: true,
          render: (value) => <span className="font-mono">{String(value ?? '')}</span>
        })
      }

      cols.push({
        key: 'actions',
        label: '',
        render: (_value, row) => (
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                void onEdit(row)
              }}
              className="inline-flex items-center gap-1 h-[24px] px-2 rounded-md text-[10px] font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-100 transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
              Düzenle
            </button>
            {row.roleId !== 1 && row.yetki.toLowerCase() !== 'superadmin' && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setConfirmMessage(`${row.kullaniciAdi} kullanıcısını silmek istediğinize emin misiniz?`)
                  setConfirmUserId(row.id)
                  setConfirmOpen(true)
                }}
                className="inline-flex items-center gap-1 h-[24px] px-2 rounded-md text-[10px] font-medium bg-red-50 text-red-700 hover:bg-red-100 border border-red-100 transition-colors"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                Sil
              </button>
            )}
          </div>
        )
      })

      return cols
    },
    [isSuperAdmin, roles]
  )

  const techColumns = useMemo(
    () => {
      const cols: TableColumn<any>[] = [
        {
          key: 'fullName',
          label: 'Ad Soyad',
          searchable: true,
          render: (_v, row) => `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim()
        },
        { key: 'username', label: 'Kullanıcı Adı', searchable: true },
        { key: 'phone', label: 'Telefon', searchable: true },
        { key: 'email', label: 'Email', searchable: true },
        // Alan artık kendi kodu + kapsam listesini birlikte taşıyor; sütun yalnızca kimliği gösterir.
        { key: 'cariKodu', label: 'Cari Kodu', searchable: true, render: (v, row) => v || row.employeeNumber || '—' },
        {
          key: 'cariScope',
          label: 'Cari Yetkisi',
          render: (_v, row) => <CariScopeCell codes={row.cariScope ?? '*'} nameOf={customerNameOf} />
        },
        { key: 'roleName', label: 'Yetki Rolü', searchable: true, render: (v, row) => v || (roles.find(r => r.id === row.roleId)?.displayName || '—') },

        { key: 'warehouseName', label: 'Araç Deposu', render: (_v, row) => row.warehouseName ? `[${row.warehouseCode}] ${row.warehouseName}` : '—' },
        { key: 'cashAccountName', label: 'Kasa', render: (v) => v || '—' },
        { key: 'bankAccountName', label: 'Banka', render: (v) => v || '—' },
        { key: 'posAccountName', label: 'POS', render: (v) => v || '—' },
        {
          key: 'actions',
          label: '',
          render: (_v, row) => (
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setNewTech({
                    firstName: row.firstName || '',
                    lastName: row.lastName || '',
                    phone: row.phone || '',
                    email: row.email || '',
                    expertise: Array.isArray(row.expertiseAreas) ? row.expertiseAreas.join(', ') : '',
                    username: row.username || '',
                    password: '',
                    roles: Array.isArray(row.roles) ? row.roles : [],
                    cariKodu: row.cariKodu || row.employeeNumber || '',
                    cariScope: row.cariScope || '',
                    roleId: row.roleId || '',
                    warehouseCode: row.warehouseCode || '',
                    cashAccountId: row.cashAccountId || '',
                    bankAccountId: row.bankAccountId || '',
                    posAccountId: row.posAccountId || '',
                    primaryRegionId: row.primaryRegionId || '',
                    warehouseCodes: Array.isArray(row.warehouseCodes) ? row.warehouseCodes.map((x: any) => String(x)) : [],
                    cashAccountIds: Array.isArray(row.cashAccountIds) ? row.cashAccountIds.map((x: any) => Number(x)) : [],
                    bankAccountIds: Array.isArray(row.bankAccountIds) ? row.bankAccountIds.map((x: any) => Number(x)) : [],
                    asistanAccess: Boolean(row.asistanAccess)
                  })
                  setEditingTechId(row.id)
                  setTechActionError(null)
                  setTechRoleQuery('')
                  setTechCreateOpen(true)
                }}
                className="inline-flex items-center gap-1 h-[24px] px-2 rounded-md text-[10px] font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-100 transition-colors"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                Düzenle
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setConfirmMessage(`${row.firstName} ${row.lastName} teknisyenini silmek istediğinize emin misiniz?`)
                  setConfirmTechId(row.id)
                  setConfirmOpen(true)
                }}
                className="inline-flex items-center gap-1 h-[24px] px-2 rounded-md text-[10px] font-medium bg-red-50 text-red-700 hover:bg-red-100 border border-red-100 transition-colors"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                Sil
              </button>
            </div>
          )
        }
      ]
      return cols
    },
    [warehouses, cashAccounts, bankAccounts, regions]
  )

  /**
   * ARAÇ DEPOSU seçeneği listesi. Doğrudan satış ucu araç OLMAYAN depoyu reddettiği için
   * (`Seçilen depo bir araç deposu değildir`) seçici yalnızca araç depolarını gösterir;
   * eskiden 18 deponun hepsi listeleniyor ve hata ancak fatura anında ortaya çıkıyordu.
   *
   * Kayıtlı depo araç değilse (eski veri) listeden DÜŞÜRÜLMEZ — yoksa modal açıldığında
   * seçim sessizce boşalır ve kaydedince teknisyenin deposu silinirdi.
   */
  const vehicleWarehouseOptions = useMemo(() => {
    const current = Number(newTech.warehouseCode)
    return warehouses.filter(
      (w) => w.isVehicle === true || (Number.isFinite(current) && current !== 0 && w.warehouseCode === current)
    )
  }, [warehouses, newTech.warehouseCode])

  const filteredTechs = useMemo(() => {
    const q = search.trim()
    if (!q) return technicians

    return technicians.filter((r) => {
      const fullName = `${String(r.firstName ?? '')} ${String(r.lastName ?? '')}`
      return (
        turkishIncludes(fullName, q) ||
        turkishIncludes(r.username, q) ||
        turkishIncludes(r.email, q) ||
        turkishIncludes(r.phone, q)
      )
    })
  }, [technicians, search])

  /**
   * "Kullanıcılar" listesi ile "Teknisyenler" listesi AYRI: saha kadrosu kullanıcı listesinde
   * görünmez.
   *
   * İki sekme vardı ama ikisi de aynı kişileri gösterebiliyordu: teknisyenin B2B tarafında da bir
   * kullanıcı satırı oluyor (yetki çözümü oradan okunuyor), dolayısıyla at001/kl001/sh001 gibi
   * hesaplar ofis kullanıcılarının arasına karışıyordu. Kadro tek yerden — Teknisyenler
   * sekmesinden — yönetilsin diye burada süzülüyor.
   *
   * Hem rol KODU hem görünen ADI karşılaştırılıyor: uçtan hangisinin geldiği role göre değişiyor
   * (Code 'KlimaEkibi', Name 'Klima Ekibi').
   */
  const filteredRows = useMemo(() => {
    const technicianRoles = new Set([
      'servispersonel', 'servis personeli',
      'klimaekibi', 'klima ekibi',
      'sahamontajekibi', 'saha montaj ekibi',
      'servismudur', 'servis müdürü', 'servis mudur'
    ])
    const officeRows = rows.filter((r) => !technicianRoles.has(r.yetki.trim().toLowerCase()))

    const q = search.trim()
    if (!q) return officeRows

    return officeRows.filter((r) => {
      return (
        turkishIncludes(r.kullaniciAdi, q) ||
        turkishIncludes(r.unvan, q) ||
        turkishIncludes(r.cariAdi, q) ||
        turkishIncludes(r.email, q) ||
        turkishIncludes(r.telefon, q) ||
        turkishIncludes(r.yetki, q)
      )
    })
  }, [rows, search])

  return (
    <div>
      <Modal
        isOpen={confirmOpen}
        onClose={() => {
          if (saving) return
          setConfirmOpen(false)
          setConfirmUserId(null)
          setConfirmTechId(null)
        }}
        title="Onay"
        footer={
          <>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setConfirmOpen(false)
                setConfirmUserId(null)
                setConfirmTechId(null)
              }}
              className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition disabled:opacity-60"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={saving || (!confirmUserId && !confirmTechId)}
              onClick={() => {
                if (confirmTechId) {
                  const techId = confirmTechId
                  setConfirmOpen(false)
                  setConfirmTechId(null)
                  void onDeleteTech(techId)
                } else {
                  const id = confirmUserId
                  if (!id) return
                  setConfirmOpen(false)
                  setConfirmUserId(null)
                  const row = rows.find((x) => x.id === id)
                  if (!row) return
                  void onDelete(row)
                }
              }}
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white shadow-sm transition disabled:opacity-60"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
              Sil
            </button>
          </>
        }
      >
        <div className="text-sm text-gray-700 whitespace-pre-line">{confirmMessage}</div>
      </Modal>

      <NotificationPopup isOpen={popupOpen} onClose={() => setPopupOpen(false)} variant={popupType} title={popupTitle} message={popupMessage} />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">
              {activeView === 'users' ? 'Kullanıcı Listesi' : 'Teknisyen Listesi'}
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">Yönetim / Kullanıcı Yönetimi</p>
          </div>
          <div className="flex items-center gap-2 ml-4">
            <button
              type="button"
              onClick={() => setActiveView('users')}
              className={
                'h-[34px] px-4 rounded-lg text-xs font-semibold uppercase tracking-wide border transition ' +
                (activeView === 'users'
                  ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 shadow-sm')
              }
            >
              Kullanıcılar
            </button>
            <button
              type="button"
              onClick={() => setActiveView('technicians')}
              className={
                'h-[34px] px-4 rounded-lg text-xs font-semibold uppercase tracking-wide border transition ' +
                (activeView === 'technicians'
                  ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 shadow-sm')
              }
            >
              Teknisyenler
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Arama..."
              className="w-full sm:w-56 h-[34px] pl-8 pr-3 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
            />
          </div>
          {activeView === 'users' && (
            <button
              type="button"
              onClick={openCreateModal}
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Yeni Kullanıcı
            </button>
          )}
          {activeView === 'technicians' && (
            <button
              type="button"
              onClick={() => {
                let maxSeq = 0
                for (const t of (technicians ?? [])) {
                  const code = String((t as any).cariKodu || (t as any).employeeNumber || '').toUpperCase()
                  if (code.includes('TEK-')) {
                    const parts = code.split('TEK-')
                    const num = parseInt(parts[1], 10)
                    if (!isNaN(num) && num > maxSeq) maxSeq = num
                  }
                }
                const defaultCariKodu = `TEK-${String(maxSeq + 1).padStart(5, '0')}`
                const defaultRole = roles.find((r) => r.code === 'ServisPersonel' || r.name === 'Teknisyen') || roles[0]

                setNewTech({
                  firstName: '',
                  lastName: '',
                  phone: '',
                  email: '',
                  expertise: '',
                  username: '',
                  password: '',
                  roles: [],
                  cariKodu: defaultCariKodu,
                  cariScope: '',
                  roleId: defaultRole ? defaultRole.id : '',
                  warehouseCode: '',
                  cashAccountId: '',
                  bankAccountId: '',
                  posAccountId: '',
                  primaryRegionId: '',
                  warehouseCodes: [],
                  cashAccountIds: [],
                  bankAccountIds: [],
                  asistanAccess: false
                })
                setEditingTechId(null)
                setTechActionError(null)
                setTechRoleQuery('')
                setTechCreateOpen(true)
              }}
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Yeni Teknisyen
            </button>
          )}
        </div>
      </div>

      {error && <div className="mb-3 text-xs font-semibold text-red-600">{error}</div>}

      {techCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity"
            onMouseDown={() => {
              setTechCreateOpen(false)
              setEditingTechId(null)
            }}
          />

          <div className="relative z-10 w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh] my-auto" data-disable-global-uppercase="true">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 shrink-0">
              <div>
                <div className="text-base font-bold text-slate-800">
                  {editingTechId ? 'Teknisyen Düzenle' : 'Yeni Teknisyen'}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {editingTechId ? 'Kaydedince bilgiler güncellenecek.' : 'Kaydedince listeye eklenecek.'}
                </div>
              </div>
              <button
                type="button"
                disabled={techActionLoading}
                onClick={() => {
                  setTechCreateOpen(false)
                  setEditingTechId(null)
                }}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="px-6 py-5 overflow-y-auto flex-1 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Cari Kodu</div>
                  <input
                    value={newTech.cariKodu}
                    onChange={(e) => setNewTech((p) => ({ ...p, cariKodu: e.target.value }))}
                    placeholder="TEK-00001"
                    className="w-full h-8 px-2.5 text-xs font-mono border border-gray-200 rounded focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition"
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Yetki Rolü (Sistem Rolü)</div>
                  {/*
                    Arama kutusu: rol listesi büyüdükçe yeni eklenen bir rolü açılırda bulmak
                    zorlaşıyordu. Süzme yalnızca görünümü etkiler, seçili değeri değil.
                  */}
                  <input
                    value={techRoleQuery}
                    onChange={(e) => setTechRoleQuery(e.target.value)}
                    placeholder="Rol ara..."
                    className="w-full h-8 px-2.5 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition"
                  />
                  <select
                    value={newTech.roleId}
                    onChange={(e) => setNewTech((p) => ({ ...p, roleId: e.target.value === '' ? '' : Number(e.target.value) }))}
                    className="w-full h-8 px-2 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition bg-white"
                  >
                    <option value="">Rol Seçin...</option>
                    {roles
                      .filter((r) => {
                        const q = techRoleQuery.trim().toLocaleLowerCase('tr')
                        if (!q) return true
                        // Seçili rol her zaman listede kalmalı, yoksa arama yazıldığı anda
                        // <select> değeri listede bulunmaz ve seçim görünmez olur.
                        if (Number(r.id) === Number(newTech.roleId)) return true
                        return `${r.displayName ?? ''} ${r.name ?? ''} ${r.code ?? ''}`
                          .toLocaleLowerCase('tr')
                          .includes(q)
                      })
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.displayName || r.name} ({r.code})
                        </option>
                      ))}
                  </select>
                </div>

                {/*
                  Kabul ekranlarındaki liste bu kapsama göre süzülür. Teknisyenin kendi TEK-xxxxx
                  kodu kimliğidir, kapsam değil — cari atanmadığında kabul listelerinde hiçbir şey
                  görünmemesinin sebebi buydu.
                */}
                <div className="md:col-span-2">
                  <CariScopePicker
                    value={newTech.cariScope}
                    onChange={(next) => setNewTech((p) => ({ ...p, cariScope: next }))}
                    customers={customerDropdownItems}
                    emptyIsAll={false}
                    emptyLabel="Cari atanmadı"
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Ad</div>
                  <input
                    value={newTech.firstName}
                    onChange={(e) => setNewTech((p) => ({ ...p, firstName: e.target.value.replace(/[^a-zA-ZğüşıöçĞÜŞİÖÇ\s]/g, '') }))}
                    className="w-full h-8 px-2.5 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition"
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Soyad</div>
                  <input
                    value={newTech.lastName}
                    onChange={(e) => setNewTech((p) => ({ ...p, lastName: e.target.value.replace(/[^a-zA-ZğüşıöçĞÜŞİÖÇ\s]/g, '') }))}
                    className="w-full h-8 px-2.5 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition"
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Telefon</div>
                  <input
                    type="tel"
                    maxLength={PHONE_MAX_DIGITS}
                    value={newTech.phone}
                    onChange={(e) => setNewTech((p) => ({ ...p, phone: e.target.value.replace(/[^0-9]/g, '') }))}
                    className="w-full h-8 px-2.5 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition"
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Email</div>
                  <input
                    type="email"
                    value={newTech.email}
                    onChange={(e) => setNewTech((p) => ({ ...p, email: e.target.value.replace(/\s+/g, '') }))}
                    className="w-full h-8 px-2.5 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition"
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Teknisyen Kullanıcı Adı</div>
                  <input
                    disabled={Boolean(editingTechId)}
                    value={newTech.username}
                    onChange={(e) => setNewTech((p) => ({ ...p, username: e.target.value }))}
                    className="w-full h-8 px-2.5 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition disabled:bg-gray-100 disabled:text-gray-500"
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                    {editingTechId ? 'Yeni Şifre (Değiştirmek için)' : 'Teknisyen Şifre'}
                  </div>
                  <input
                    type="password"
                    value={newTech.password}
                    onChange={(e) => setNewTech((p) => ({ ...p, password: e.target.value }))}
                    className="w-full h-8 px-2.5 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition"
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Araç Deposu (B2B)</div>
                  <select 
                    value={newTech.warehouseCode} 
                    onChange={(e) => setNewTech((p) => ({ ...p, warehouseCode: e.target.value === '' ? '' : Number(e.target.value) }))} 
                    className="w-full h-8 px-2 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition bg-white"
                  >
                    <option value="">Depo Yok / Seçin</option>
                    {vehicleWarehouseOptions.map(w => (
                      <option key={w.warehouseCode} value={w.warehouseCode}>
                        [{w.warehouseCode}] {w.name}
                      </option>
                    ))}
                  </select>
                  <div className="text-[10px] text-gray-500">
                    Teknisyenin satışları bu depodan düşer. Yalnızca araç depoları listelenir.
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Nakit Kasa Hesabı</div>
                  <select 
                    value={newTech.cashAccountId} 
                    onChange={(e) => setNewTech((p) => ({ ...p, cashAccountId: e.target.value === '' ? '' : Number(e.target.value) }))} 
                    className="w-full h-8 px-2 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition bg-white"
                  >
                    <option value="">Kasa Yok / Seçin</option>
                    {cashAccounts.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Banka Havale Hesabı</div>
                  <select 
                    value={newTech.bankAccountId} 
                    onChange={(e) => setNewTech((p) => ({ ...p, bankAccountId: e.target.value === '' ? '' : Number(e.target.value) }))} 
                    className="w-full h-8 px-2 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition bg-white"
                  >
                    <option value="">Banka Yok / Seçin</option>
                    {bankAccounts.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.accountName} ({b.accountCode})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Sanal POS Banka Hesabı</div>
                  <select 
                    value={newTech.posAccountId} 
                    onChange={(e) => setNewTech((p) => ({ ...p, posAccountId: e.target.value === '' ? '' : Number(e.target.value) }))} 
                    className="w-full h-8 px-2 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition bg-white"
                  >
                    <option value="">POS Yok / Seçin</option>
                    {bankAccounts.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.accountName} ({b.accountCode})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Bölge</div>
                  <select 
                    value={newTech.primaryRegionId} 
                    onChange={(e) => setNewTech((p) => ({ ...p, primaryRegionId: e.target.value }))} 
                    className="w-full h-8 px-2 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition bg-white"
                  >
                    <option value="">Bölge Yok / Seçin</option>
                    {regions.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Uzmanlık da payload'a gidiyordu ama girilecek bir alan yoktu. */}
                <div className="md:col-span-2 space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                    Uzmanlık Alanları (virgülle ayırın)
                  </div>
                  <input
                    value={newTech.expertise}
                    onChange={(e) => setNewTech((p) => ({ ...p, expertise: e.target.value }))}
                    placeholder="Klima, Beyaz Eşya, Elektrik"
                    className="w-full h-8 px-2.5 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition"
                  />
                </div>

                {/* Kullanıcı formuyla aynı bileşen — "aynı olacak" ancak tek kaynakla garanti edilir. */}
                <AccessScopePicker
                  title="B2B İşlem ve Erişim Yetkileri"
                  // Teknisyenin varsayılan deposu her zaman yukarıdaki "Araç Deposu"dur; sunucu
                  // onu B2B kullanıcısının `DefaultWarehouseCode` alanına yazıyor. İkinci bir
                  // seçici, aynı bilgiyi iki yerden sorup çelişki üretmekten başka işe yaramaz.
                  showDefaultWarehouse={false}
                  value={{
                    warehouseCodes: newTech.warehouseCodes,
                    cashAccountIds: newTech.cashAccountIds,
                    bankAccountIds: newTech.bankAccountIds
                  }}
                  onChange={(next) => setNewTech((p) => ({ ...p, ...next }))}
                  warehouses={warehouses}
                  cashAccounts={cashAccounts}
                  bankAccounts={bankAccounts}
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700 select-none cursor-pointer" title="WhatsApp Asistanı programına giriş">
                <input
                  type="checkbox"
                  checked={newTech.asistanAccess}
                  onChange={(e) => setNewTech((p) => ({ ...p, asistanAccess: e.target.checked }))}
                />
                Asistan (WhatsApp) — asistan.example.com'a kendi kullanıcı adı/şifresiyle girer
              </label>

              {techActionError && (
                <div className="bg-red-50 border border-red-200 rounded p-2.5 text-xs text-red-600">
                  {techActionError}
                </div>
              )}

              {!editingTechId && (!newTech.username.trim() || newTech.password.trim().length < 6) && (
                <div className="bg-amber-50 border border-amber-200 rounded p-2.5 text-xs text-amber-700">
                  Kullanıcı adı zorunlu. Şifre en az 6 karakter olmalı.
                </div>
              )}
              {editingTechId && newTech.password.trim().length > 0 && newTech.password.trim().length < 6 && (
                <div className="bg-amber-50 border border-amber-200 rounded p-2.5 text-xs text-amber-700">
                  Yeni şifre en az 6 karakter olmalı.
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-gray-200 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setTechCreateOpen(false)
                  setEditingTechId(null)
                }}
                className="h-8 px-4 text-xs font-semibold rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={
                  techActionLoading || (editingTechId 
                    ? (newTech.password.trim().length > 0 && newTech.password.trim().length < 6)
                    : (!newTech.username.trim() || newTech.password.trim().length < 6)
                  )
                }
                onClick={submitTechModal}
                className={`h-8 px-4 text-xs font-semibold rounded text-white shadow-sm transition ${
                  techActionLoading || (editingTechId 
                    ? (newTech.password.trim().length > 0 && newTech.password.trim().length < 6)
                    : (!newTech.username.trim() || newTech.password.trim().length < 6)
                  )
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {techActionLoading ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity"
            onMouseDown={() => {
              closeModal()
            }}
          />

          <div className="relative z-10 w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh] my-auto" data-disable-global-uppercase="true">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 shrink-0">
              <div className="text-base font-bold text-slate-800">
                {modalMode === 'create' ? 'Yeni Kullanıcı' : 'Kullanıcı Güncelle'}
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={closeModal}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="px-6 py-5 overflow-y-auto flex-1 space-y-4">
              {modalError && <div className="mb-3 text-xs font-semibold text-red-600 whitespace-pre-line bg-red-50 border border-red-200 rounded-lg p-3">{modalError}</div>}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Rol</div>
                  <select
                    value={String(form.roleId)}
                    onChange={(e) => {
                      const nextRoleId = Number(e.target.value)
                      setForm((p) => ({ ...p, roleId: nextRoleId }))

                      const selectedRole = roles.find((x) => Number(x.id) === Number(nextRoleId))
                      const roleIsSuperAdmin = Boolean((selectedRole as any)?.isSuperAdmin)
                      if (roleIsSuperAdmin) {
                        setForm((p) => ({ ...p, warehouseCodes: [] }))
                      }
                    }}
                    className="input-base h-9 text-sm"
                  >
                    {roles.length === 0 && <option value={String(form.roleId)}>Rol yükleniyor...</option>}
                    {roles.map((r) => (
                      <option key={r.id} value={String(r.id)}>
                        {r.displayName}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Kullanıcı Adı</div>
                  <input
                    value={form.username}
                    onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))}
                    className="input-base h-9 text-sm"
                    placeholder="Kullanıcı adı"
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Ünvan</div>
                  <input
                    value={form.title}
                    onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                    className="input-base h-9 text-sm"
                    placeholder="Ünvan"
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Email</div>
                  <input
                    value={form.email}
                    onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                    className="input-base h-9 text-sm"
                    placeholder="email@domain.com"
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Telefon</div>
                  <input
                    inputMode="numeric"
                    value={form.phoneNumber}
                    onChange={(e) => {
                      const formatted = formatPhoneNumber(e.target.value)
                      setForm((p) => ({ ...p, phoneNumber: formatted }))
                    }}
                    className="input-base h-9 text-sm"
                    placeholder="0555 555 5555 555"
                  />
                </div>

                <CariScopePicker
                  value={form.currentCode}
                  onChange={(next) => setForm((p) => ({ ...p, currentCode: next }))}
                  customers={customerDropdownItems}
                />

                {(() => {
                  const selectedRole = roles.find((x) => Number(x.id) === Number(form.roleId))
                  // Süper admin zaten her yere erişir; YETKİ seçicisi gösterilirse yetkiler yokmuş
                  // gibi görünür. VARSAYILAN depo ise ayrı bir şey: erişimi kısmaz, yalnızca fatura
                  // kaleminin öntanımlı çıkış deposunu söyler. Alan hiç sunulmadığı için süper
                  // adminde bu öntanım boş kalıyor, depo her satırda elle seçiliyordu.
                  if ((selectedRole as any)?.isSuperAdmin) {
                    return (
                      <div className="space-y-1">
                        <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Varsayılan Depo</div>
                        <select
                          value={String(form.defaultWarehouseCode ?? '')}
                          onChange={(e) => setForm((p) => ({ ...p, defaultWarehouseCode: e.target.value }))}
                          className="input-base h-9 text-sm"
                        >
                          <option value="">Seçiniz...</option>
                          {warehouses.map((w) => (
                            <option key={w.warehouseCode} value={String(w.warehouseCode)}>
                              {w.warehouseCode} - {w.name}
                            </option>
                          ))}
                        </select>
                        <div className="text-[10px] text-gray-500 leading-snug">
                          Fatura kalemlerinde öntanımlı çıkış deposu. Süper adminin depo erişimi kısıtlanmaz.
                        </div>
                      </div>
                    )
                  }

                  return (
                    <AccessScopePicker
                      value={{
                        warehouseCodes: (form.warehouseCodes ?? []).map((x) => String(x)),
                        defaultWarehouseCode: String(form.defaultWarehouseCode ?? ''),
                        cashAccountIds: form.cashAccountIds ?? [],
                        bankAccountIds: form.bankAccountIds ?? []
                      }}
                      onChange={(next) => setForm((p) => ({ ...p, ...next, defaultWarehouseCode: String(next.defaultWarehouseCode ?? '') }))}
                      warehouses={warehouses}
                      cashAccounts={cashAccounts}
                      bankAccounts={bankAccounts}
                    />
                  )
                })()}

                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                    {modalMode === 'create' ? 'Şifre' : 'Yeni Şifre'}
                  </div>
                  <div className="relative">
                    <input
                      value={form.password}
                      onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                      className="input-base h-9 text-sm pr-10"
                      data-no-capitalize="true"
                      placeholder={modalMode === 'create' ? 'Şifre' : 'Yeni şifre'}
                      type={showNewPassword ? 'text' : 'password'}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((p) => !p)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                      aria-label={showNewPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
                      title={showNewPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
                    >
                      {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                    {modalMode === 'create' ? 'Şifre Tekrar' : 'Yeni Şifre Tekrar'}
                  </div>
                  <div className="relative">
                    <input
                      value={form.confirmPassword}
                      onChange={(e) => setForm((p) => ({ ...p, confirmPassword: e.target.value }))}
                      className="input-base h-9 text-sm pr-10"
                      data-no-capitalize="true"
                      placeholder={modalMode === 'create' ? 'Şifre tekrar' : 'Yeni şifre tekrar'}
                      type={showNewPassword ? 'text' : 'password'}
                    />
                  </div>
                </div>

                {form.roleId === salesmanRoleId && (
                  <div className="space-y-1">
                    <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Plasiyer Kodu</div>
                    <input
                      value={form.salesmanCode}
                      onChange={(e) => setForm((p) => ({ ...p, salesmanCode: e.target.value }))}
                      className="input-base h-9 text-sm"
                    />
                  </div>
                )}

                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">İndirim Oranı (%)</div>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={form.discountRate}
                    onChange={(e) => setForm((p) => ({ ...p, discountRate: e.target.value }))}
                    className="input-base h-9 text-sm"
                    placeholder="Örn: 10"
                  />
                </div>

                {form.roleId === salesmanRoleId && (
                  <div className="col-span-1 md:col-span-2 space-y-1">
                    <label className="flex items-center gap-2 text-sm text-gray-700 select-none cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.isCariPlasiyeri}
                        onChange={(e) => setForm((p) => ({ ...p, isCariPlasiyeri: e.target.checked }))}
                      />
                      Cari Plasiyeri
                    </label>
                    <div className="text-[11px] text-gray-500">
                      Cari müşteri teklifi ekranında cariler yalnızca bu plasiyeri görür.
                    </div>
                  </div>
                )}

                <div className="col-span-1 md:col-span-2 flex items-center gap-6 pt-2">
                  <label className="flex items-center gap-2 text-sm text-gray-700 select-none cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.isActive}
                      onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
                    />
                    Aktif
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700 select-none cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.serviceOpsAccess}
                      onChange={(e) => setForm((p) => ({ ...p, serviceOpsAccess: e.target.checked }))}
                    />
                    Servis Bağlantısı (Service-Ops)
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700 select-none cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.employeeAccess}
                      onChange={(e) => setForm((p) => ({ ...p, employeeAccess: e.target.checked }))}
                    />
                    Çalışan Yönetimi
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700 select-none cursor-pointer" title="WhatsApp Asistanı programına giriş (süper yönetici rolü her zaman girer)">
                    <input
                      type="checkbox"
                      checked={form.asistanAccess}
                      onChange={(e) => setForm((p) => ({ ...p, asistanAccess: e.target.checked }))}
                    />
                    Asistan (WhatsApp)
                  </label>
                </div>

                {/*
                  CARİ EKSTRE TİPLERİ (2026-10-11, kullanıcı: "müdürlere tedarikçi, bayi, müşteri cari
                  ekstrelerini görüntüleme / görüntülememe yetkisi verebilmeliyim"). Hepsi işaretli =
                  kısıtlama yok. Kapı sunucuda: Cari Ekstre, Yönetim Ekstre ve ekstre pencereleri 403 döner.
                */}
                <div className="col-span-1 md:col-span-2 space-y-1.5 pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Cari ekstrede görebileceği tipler</div>
                    <button
                      type="button"
                      className="text-[11px] text-emerald-700 hover:underline"
                      onClick={() => setForm((p) => ({ ...p, cariEkstreTipleri: [...TUM_CARI_EKSTRE_TIPLERI] }))}
                    >
                      Hepsini seç
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                    {CARI_EKSTRE_TIPLERI.map((t) => (
                      <label key={t.key} className="flex items-center gap-1.5 text-sm text-gray-700 select-none cursor-pointer" title={t.hint}>
                        <input
                          type="checkbox"
                          checked={form.cariEkstreTipleri.includes(t.key)}
                          onChange={(e) =>
                            setForm((p) => ({
                              ...p,
                              cariEkstreTipleri: e.target.checked
                                ? Array.from(new Set([...p.cariEkstreTipleri, t.key]))
                                : p.cariEkstreTipleri.filter((x) => x !== t.key)
                            }))
                          }
                        />
                        {t.label}
                      </label>
                    ))}
                  </div>
                  <div className="text-[11px] text-gray-500">
                    {form.cariEkstreTipleri.length === TUM_CARI_EKSTRE_TIPLERI.length || form.cariEkstreTipleri.length === 0
                      ? 'Kısıtlama yok: bütün carilerin ekstresini görür.'
                      : `Yalnız işaretli tiplerin ekstresini görür; diğerlerinde "yetkiniz yok" uyarısı alır.`}
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50/80 flex items-center justify-end gap-2.5 shrink-0 rounded-b-2xl">
              <button
                type="button"
                disabled={saving}
                onClick={closeModal}
                className="h-[36px] px-4 text-xs font-semibold rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition disabled:opacity-60 cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void submitModal()}
                className="h-[36px] inline-flex items-center gap-1.5 px-5 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition disabled:opacity-60 cursor-pointer"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                {saving ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-visible relative">
        {/*
          Arka plan tazelemesi görünür ama TABLOYU KAPATMAZ. Hiç belirti olmasaydı kullanıcı
          verinin güncellendiğini bilemezdi; tabloyu iskelete çevirmek ise süzgeçleri ve
          kaydırmayı sıfırlıyordu — asıl şikâyet buydu.
        */}
        {refreshing && (
          <div className="absolute right-3 top-2 z-10 flex items-center gap-1.5 rounded-full bg-slate-900/5 px-2.5 py-1 text-[10px] font-bold text-slate-500">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            Güncelleniyor
          </div>
        )}
        {activeView === 'users' ? (
          loading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="h-3 bg-gray-100 rounded animate-pulse w-24" />
                  <div className="h-3 bg-gray-100 rounded animate-pulse flex-1" />
                  <div className="h-3 bg-gray-100 rounded animate-pulse w-16" />
                  <div className="h-3 bg-gray-100 rounded animate-pulse w-20" />
                  <div className="h-3 bg-gray-100 rounded animate-pulse w-16" />
                </div>
              ))}
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <div className="text-gray-300 text-2xl mb-1">—</div>
              <div className="text-xs text-gray-400 font-medium">Kayıt bulunamadı.</div>
            </div>
          ) : (
            <Table
          onRefresh={() => void reload()} columns={columns} data={filteredRows} showColumnFilters />
          )
        ) : (
          techLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="h-3 bg-gray-100 rounded animate-pulse w-24" />
                  <div className="h-3 bg-gray-100 rounded animate-pulse flex-1" />
                  <div className="h-3 bg-gray-100 rounded animate-pulse w-16" />
                  <div className="h-3 bg-gray-100 rounded animate-pulse w-20" />
                  <div className="h-3 bg-gray-100 rounded animate-pulse w-16" />
                </div>
              ))}
            </div>
          ) : techError ? (
            <div className="p-4 text-center text-xs font-semibold text-red-600">
              {techError}
            </div>
          ) : filteredTechs.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <div className="text-gray-300 text-2xl mb-1">—</div>
              <div className="text-xs text-gray-400 font-medium">Teknisyen bulunamadı.</div>
            </div>
          ) : (
            <Table
          onRefresh={() => void reload()} columns={techColumns} data={filteredTechs} showColumnFilters />
          )
        )}
      </div>
    </div>
  )
}

function PlaceholderView({ title }: { title: string }) {
  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">{title}</h1>
          <p className="text-xs text-gray-400 mt-0.5">Yönetim</p>
        </div>
      </div>
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm px-6 py-10 text-center">
        <div className="text-gray-300 text-2xl mb-1">⚙️</div>
        <div className="text-xs text-gray-400 font-medium">Bu ekran sonraki adımda birebir yapılacak.</div>
      </div>
    </div>
  )
}

function ToggleSwitch({
  checked,
  onChange,
  disabled = false
}: {
  checked: boolean
  onChange: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1 ${
        checked ? 'bg-emerald-600' : 'bg-gray-200'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

/**
 * Modül anahtarı → ekranda görünen ad ve ikon. TEK KAYNAK.
 *
 * Bu eşleme rol yetkileri ekranında İKİ ayrı if/else zinciri olarak duruyordu (sol modül
 * listesi ve sağ panelin başlığı) ve ikisi birbirinden kaymıştı: `reports`, `pos` ve
 * `eticaret` hiçbirinde yoktu, `bildirimler` ile `serviceOps` yalnızca solda vardı.
 *
 * Etiketi olmayan modül ham anahtarıyla ("reports") basılıyordu; kullanıcı Türkçe adlarla
 * dolu bir listede "Satış Pazarlama Raporu"nu ararken sekmenin orada olduğunu göremedi ve
 * sayfanın yetkisi hiç yok sandı. Sayfa kayıtlıydı, yetki satırları da vardı — görünmeyen
 * şey sekmenin ADIYDI.
 *
 * Yeni modül eklerken buraya bir satır ekle; iki ayrı yeri güncellemek gerekmiyor.
 */
const MODULE_META: Record<string, { label: string; icon: any }> = {
  invoice: { label: 'Fatura İşlemleri', icon: FileText },
  cash: { label: 'Kasa İşlemleri', icon: Coins },
  virman: { label: 'Virman', icon: ArrowLeftRight },
  bank: { label: 'Banka İşlemleri', icon: Building2 },
  check: { label: 'Çek / Senet', icon: Layers },
  employee: { label: 'Çalışan Yönetimi', icon: UserCheck },
  users: { label: 'Sistem Ayarları', icon: Shield },
  // Bildirimler artık Sistem Ayarları'nın içinde değil, kendi başlığı.
  bildirimler: { label: 'Bildirimler', icon: Bell },
  deleteRule: { label: 'Silme Ayarları', icon: Trash2 },
  serviceOps: { label: 'Servis İşlemleri', icon: Wrench },
  reports: { label: 'Raporlar', icon: FileSpreadsheet },
  pos: { label: 'Sanal POS', icon: CreditCard },
  eticaret: { label: 'E-Ticaret', icon: ShoppingCart }
}

/** Etiketi tanımlı değilse ham anahtar basılır — yeni modül gözden kaçmasın diye. */
function moduleLabel(moduleKey: string): string {
  return MODULE_META[moduleKey]?.label ?? moduleKey
}

function RolYetkileriView() {

  const buildHeaders = (includeJson: boolean) => {
    const headers: Record<string, string> = {}
    if (includeJson) headers['Content-Type'] = 'application/json'
    const token = localStorage.getItem('accessToken')
    if (token) headers.Authorization = `Bearer ${token}`
    const tenantCode = String(localStorage.getItem('tenantCode') ?? '').trim()
    if (tenantCode) headers['X-Tenant-Code'] = tenantCode
    return headers
  }

  type RoleItem = { id: number; code: string; name: string; displayName: string; isActive: boolean; isSuperAdmin: boolean; campaignsEnabled?: boolean; overLimitApprovalEnabled?: boolean }
  type PageItem = { id: number; moduleKey: string; key: string; displayName: string; sortOrder: number; isActive: boolean }
  type PermissionItem = { pageId: number; moduleKey: string; pageKey: string; displayName: string; canAccess: boolean }

  const [roles, setRoles] = useState<RoleItem[]>([])
  const [pages, setPages] = useState<PageItem[]>([])
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null)
  const [permissions, setPermissions] = useState<PermissionItem[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [activeModuleTab, setActiveModuleTab] = useState<string>('invoice')

  const invoiceBsyHideKey = 'bsyHHide'
  const invoiceBsyComingSoonKey = 'bsyHComingSoon'

  const invoiceSubKey = 'faturaDokumUstBilgiGuncelle'
  const invoiceParentKey = 'faturaDokum'
  const alisSubKey = 'alisUstBilgiGuncelle'
  const alisParentKey = 'alis'

  const konsinyeParentKey = 'irsaliye'
  const konsinyeQtyEditKey = 'irsaliyeQuantityEdit'
  const konsinyeSevkQtyEditKey = 'irsaliyeShippedQuantityEdit'
  const konsinyeStatusOnaylandiKey = 'irsaliyeStatusOnaylandi'
  const konsinyeStatusSevkEdildiKey = 'irsaliyeStatusSevkEdildi'

  const musteriTeklifiKey = 'musteriTeklifi'

  const subKeysMap = useMemo(() => {
    return {
      faturaDokum: [
        'faturaDokumUstBilgiGuncelle',
        'faturaDokumOdemeAlindi',
        'faturaDokumNakitMiktar',
        'faturaDokumBarkod',
        'faturaDokumBasim',
        'faturaDokumSil',
        'faturaDokumTipSatis',
        'faturaDokumTipTamir',
        'faturaDokumTipIade',
        'faturaDokumTipAlis',
        'faturaDokumTipHizmet'
      ],
      siparis: [
        'siparisSadeceFiyat4Gorsun'
      ],
      satisFatura: [
        'satisFaturaDepoBakiyeGorsun',
        'satisFaturaOdemeAl',
        'satisFaturaProformaGorsun',
        'satisFaturaSiparisGorsun',
        'satisFaturaMagazaSiparisGorsun',
        'satisFaturaServisGorsun',
        'satisFaturaKonsinyeGorsun'
      ],
      musteriTeklifi: [
        'musteriTeklifiDuzenle',
        'musteriTeklifiSil',
        'musteriTeklifiProformaAktar',
        'musteriTeklifiBasim',
        'musteriTeklifiCariEkle'
      ],
      cariTeklifleri: [
        'cariTeklifleriDuzenle',
        'cariTeklifleriSil',
        'cariTeklifleriProformaAktar',
        'cariTeklifleriBasim'
      ],
      bayiTeklifleri: [
        'bayiTeklifleriBasim',
        'bayiTeklifleriSil'
      ],
      proforma: [
        'proformaFaturaDokumeAktar',
        'proformaBasim',
        'proformaSil'
      ],
      alis: [
        'alisUstBilgiGuncelle',
        'alisDuzenle',
        'alisTermin',
        'alisSil',
        'alisTipAlis',
        'alisTipHizmet',
        'alisTipIade'
      ],
      termin: [
        'terminDurumDegistir'
      ],
      garantiDegisim: [
        'garantiDegisimSil'
      ],
      // Aynı ana anahtar iki modülde de var (invoice/faturaTakip ve serviceOps/faturaTakip);
      // alt sayfa kendi modülünde arandığı için karışmıyor.
      faturaTakip: [
        'faturaTakipPlanla',
        'faturaTakipDurum',
        'faturaTakipBasim',
        'faturaTakip.tumIsleriGorme'
      ],
      bildirimler: [
        'bildirimlerGelen',
        'bildirimlerGonder'
      ],
      montajKabul: [
        'montajKabul.yeniKabul',
        'montajKabul.kabulDuzenle',
        'montajKabul.tumIsleriGorme'
      ],
      montajYonetimi: [
        'montajYonetimi.planlama',
        'montajYonetimi.planlama.tumIsleriGorme',
        'montajYonetimi.teslimat',
        'montajYonetimi.teslimat.tumIsleriGorme',
        'montajYonetimi.geriPlanlama',
        'montajYonetimi.tumIsleriGorme'
      ],
      buyukEvAletleriKabul: [
        'buyukEvAletleriKabul.yeniKabul',
        'buyukEvAletleriKabul.tumIsleriGorme'
      ],
      buyukUrun: [
        'buyukUrun.planlama',
        'buyukUrun.planlama.tumIsleriGorme',
        'buyukUrun.sahaPlanlama',
        'buyukUrun.sahaPlanlama.tumIsleriGorme',
        'buyukUrun.atolye',
        'buyukUrun.atolye.tumIsleriGorme',
        'buyukUrun.hazirTeslimat',
        'buyukUrun.hazirTeslimat.tumIsleriGorme',
        'buyukUrun.teslimattakiler',
        'buyukUrun.teslimattakiler.tumIsleriGorme',
        'buyukUrun.islemKaydet',
        'buyukUrun.yedekParca',
        'buyukUrun.tumIsleriGorme'
      ],
      kucukUrunKabul: [
        'kucukUrunKabul.yeniKabul',
        'kucukUrunKabul.tumIsleriGorme'
      ],
      atolyeAriza: [
        'atolyeAriza.atolye',
        'atolyeAriza.atolye.tumIsleriGorme',
        'atolyeAriza.hazirTeslimat',
        'atolyeAriza.hazirTeslimat.tumIsleriGorme',
        'atolyeAriza.teslimattakiler',
        'atolyeAriza.teslimattakiler.tumIsleriGorme',
        'atolyeAriza.islemKaydet',
        'atolyeAriza.yedekParca',
        'atolyeAriza.tumIsleriGorme'
      ],
      kargoTakibi: [
        'kargoTakibi.durumGuncelle',
        'kargoTakibi.tumIsleriGorme'
      ],
      kargoPlanlama: [
        'kargoPlanlama.yeniPlan',
        'kargoPlanlama.tumIsleriGorme'
      ],
      teknisyenler: [
        'teknisyenler.yeniTeknisyen',
        'teknisyenler.teknisyenDuzenle',
        'teknisyenler.sifreDegistir',
        'teknisyenler.tumIsleriGorme'
      ],
      musterilerBayiler: [
        'musterilerBayiler.yeniMusteri',
        'musterilerBayiler.musteriDuzenle'
      ],
      stok: [
        'stok.yeniStok',
        'stok.stokGuncelle',
        'stok.tumIsleriGorme'
      ],
      aracDepolari: [
        'aracDepolari.depoTransfer',
        'aracDepolari.tumIsleriGorme'
      ]
    } as Record<string, string[]>
  }, [])

  const allSubKeys = useMemo(() => {
    return Object.values(subKeysMap).flat()
  }, [subKeysMap])

  const normalizeInvoicePermissions = (items: PermissionItem[]) => {
    const musteriTeklifiPageId = pages.find((x) => x.moduleKey === 'invoice' && x.key === musteriTeklifiKey)?.id
    const proformaPageId = pages.find((x) => x.moduleKey === 'invoice' && x.key === 'proforma')?.id

    let next = items
    if (musteriTeklifiPageId && proformaPageId) {
      const proformaAllowed = next.find((x) => x.pageId === proformaPageId)?.canAccess ?? false
      if (proformaAllowed) {
        next = next.map((x) => (x.pageId === musteriTeklifiPageId ? { ...x, canAccess: true } : x))
      }
    }

    const cariTeklifleriPageId = pages.find((x) => x.moduleKey === 'invoice' && x.key === 'cariTeklifleri')?.id
    const bayiTeklifleriPageId = pages.find((x) => x.moduleKey === 'invoice' && x.key === 'bayiTeklifleri')?.id

    if (cariTeklifleriPageId && bayiTeklifleriPageId) {
      const bayiAllowed = next.find((x) => x.pageId === bayiTeklifleriPageId)?.canAccess ?? false
      if (bayiAllowed) {
        next = next.map((x) => (x.pageId === cariTeklifleriPageId ? { ...x, canAccess: true } : x))
      }
    }

    return next
  }

  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const [editForm, setEditForm] = useState({
    code: '',
    name: '',
    displayName: '',
    description: '',
    isActive: true
  })

  const [createForm, setCreateForm] = useState({
    code: '',
    name: '',
    displayName: '',
    description: '',
    isActive: true
  })

  const updateRole = async (roleId: number) => {
    const payload = {
      code: editForm.code.trim(),
      name: editForm.name.trim(),
      displayName: editForm.displayName.trim(),
      description: editForm.description.trim() || undefined,
      isActive: editForm.isActive
    }

    const res = await fetch(`${API_BASE_URL}/api/roles/${roleId}`, {
      method: 'PUT',
      headers: { ...buildHeaders(true) },
      body: JSON.stringify(payload)
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(text || `Role update failed (${res.status})`)
    }

    return await res.json().catch(() => null)
  }

  const deleteRole = async (roleId: number) => {
    const res = await fetch(`${API_BASE_URL}/api/roles/${roleId}`, {
      method: 'DELETE',
      headers: { ...buildHeaders(true) }
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(text || `Role delete failed (${res.status})`)
    }
    return await res.json()
  }

  const fetchRoles = async () => {
    const res = await fetch(`${API_BASE_URL}/api/roles`, { headers: { ...buildHeaders(true) } })
    if (!res.ok) throw new Error(`Roles fetch failed (${res.status})`)
    const json = await res.json()
    return (json?.data ?? []) as RoleItem[]
  }

  const fetchPages = async () => {
    const res = await fetch(`${API_BASE_URL}/api/pages`, { headers: { ...buildHeaders(true) } })
    if (!res.ok) throw new Error(`Pages fetch failed (${res.status})`)
    const json = await res.json()
    return (json?.data ?? []) as PageItem[]
  }

  const fetchRolePermissions = async (roleId: number) => {
    const res = await fetch(`${API_BASE_URL}/api/roles/${roleId}/permissions`, { headers: { ...buildHeaders(true) } })
    if (!res.ok) throw new Error(`Role permissions fetch failed (${res.status})`)
    const json = await res.json()
    return (json?.data ?? []) as PermissionItem[]
  }

  const saveRolePermissions = async (roleId: number, items: PermissionItem[]) => {
    const res = await fetch(`${API_BASE_URL}/api/roles/${roleId}/permissions`, {
      method: 'PUT',
      headers: { ...buildHeaders(true) },
      body: JSON.stringify({ permissions: items.map((x) => ({ pageId: x.pageId, canAccess: x.canAccess })) })
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(text || `Role permissions update failed (${res.status})`)
    }
    return await res.json()
  }

  const createRole = async () => {
    const payload = {
      code: createForm.code.trim(),
      name: createForm.name.trim(),
      displayName: createForm.displayName.trim(),
      description: createForm.description.trim() || undefined,
      isActive: createForm.isActive
    }

    const res = await fetch(`${API_BASE_URL}/api/roles`, {
      method: 'POST',
      headers: { ...buildHeaders(true) },
      body: JSON.stringify(payload)
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(text || `Role create failed (${res.status})`)
    }

    return await res.json()
  }

  const groupedPages = useMemo(() => {
    const map = new Map<string, PageItem[]>()
    pages.filter((p) => p.moduleKey !== 'service').forEach((p) => {
      const list = map.get(p.moduleKey) ?? []
      list.push(p)
      map.set(p.moduleKey, list)
    })
    for (const [, list] of map) list.sort((a, b) => a.sortOrder - b.sortOrder)
    const priority: Record<string, number> = {
      bank: 1,
      cash: 2,
      virman: 3,
      check: 4,
      employee: 5,
      invoice: 6,
      pos: 7,
      reports: 8,
      users: 9,
      deleteRule: 10,
      serviceOps: 11
    }
    return Array.from(map.entries()).sort((a, b) => {
      const pa = priority[a[0]] ?? 99
      const pb = priority[b[0]] ?? 99
      if (pa !== pb) return pa - pb
      return a[0].localeCompare(b[0])
    })
  }, [pages])

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true)
        setError(null)
        setSuccess(null)
        const [r, p] = await Promise.all([fetchRoles(), fetchPages()])
        setRoles(r)
        setPages(p)
        setSelectedRoleId(null)
      } catch (e: any) {
        setError(e?.message ?? 'Bir hata oluştu')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  useEffect(() => {
    if (!selectedRoleId) {
      setPermissions([])
      return
    }
    void (async () => {
      try {
        setLoading(true)
        setError(null)
        setSuccess(null)
        const data = await fetchRolePermissions(selectedRoleId)
        setPermissions(data)
      } catch (e: any) {
        setError(e?.message ?? 'Bir hata oluştu')
      } finally {
        setLoading(false)
      }
    })()
  }, [selectedRoleId])

  useEffect(() => {
    setPermissions((prev) => {
      const hide = prev.find((x) => x.moduleKey === 'invoice' && x.pageKey === invoiceBsyHideKey)?.canAccess ?? false
      const coming = prev.find((x) => x.moduleKey === 'invoice' && x.pageKey === invoiceBsyComingSoonKey)?.canAccess ?? false
      if (!(hide && coming)) return prev

      return prev.map((x) =>
        x.moduleKey === 'invoice' && x.pageKey === invoiceBsyComingSoonKey ? { ...x, canAccess: false } : x
      )
    })
  }, [invoiceBsyComingSoonKey, invoiceBsyHideKey])

  useEffect(() => {
    if (groupedPages.length > 0 && !groupedPages.some(([k]) => k === activeModuleTab)) {
      setActiveModuleTab(groupedPages[0][0])
    }
  }, [groupedPages, activeModuleTab])

  const togglePermission = (pageId: number) => {
    setPermissions((prev) => prev.map((x) => (x.pageId === pageId ? { ...x, canAccess: !x.canAccess } : x)))
  }

  const submitPermissions = async () => {
    if (!selectedRoleId) return
    try {
      setSaving(true)
      setError(null)
      setSuccess(null)
      await saveRolePermissions(selectedRoleId, normalizeInvoicePermissions(permissions))
      setSuccess('Yetkiler başarıyla kaydedildi.')
    } catch (e: any) {
      setError(e?.message ?? 'Bir hata oluştu')
    } finally {
      setSaving(false)
    }
  }

  /**
   * Kampanya anahtarı sayfa yetkisi DEĞİL, ticari bir kural — bu yüzden ayrı bir uca gidiyor ve
   * anında kaydediliyor (sayfa yetkilerinin "Kaydet" akışına bağlı değil).
   */
  const toggleRoleCampaigns = async (roleId: number, next: boolean) => {
    try {
      setSaving(true)
      setError(null)
      setSuccess(null)
      const res = await fetch(`${API_BASE_URL}/api/roles/${roleId}/campaigns`, {
        method: 'PATCH',
        headers: { ...buildHeaders(true) },
        body: JSON.stringify({ campaignsEnabled: next })
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `Kampanya ayarı güncellenemedi (${res.status})`)
      }
      setRoles((prev) => prev.map((r) => (r.id === roleId ? { ...r, campaignsEnabled: next } : r)))
      setSuccess(next ? 'Kampanyalar bu role açıldı.' : 'Kampanyalar bu role kapatıldı.')
    } catch (e: any) {
      setError(e?.message ?? 'Bir hata oluştu')
    } finally {
      setSaving(false)
    }
  }

  /** Limit aşımıyla sipariş onayı (2026-10-14) — kampanya anahtarı gibi kendi ucuna anında yazılır. */
  const toggleRoleOverLimitApproval = async (roleId: number, next: boolean) => {
    try {
      setSaving(true)
      setError(null)
      setSuccess(null)
      const res = await fetch(`${API_BASE_URL}/api/roles/${roleId}/over-limit-approval`, {
        method: 'PATCH',
        headers: { ...buildHeaders(true) },
        body: JSON.stringify({ overLimitApprovalEnabled: next })
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `Limit aşımı onay yetkisi güncellenemedi (${res.status})`)
      }
      setRoles((prev) => prev.map((r) => (r.id === roleId ? { ...r, overLimitApprovalEnabled: next } : r)))
      setSuccess(next ? 'Bu rol limit aşımıyla sipariş onaylayabilir.' : 'Bu rolün limit aşımı onay yetkisi kapatıldı.')
    } catch (e: any) {
      setError(e?.message ?? 'Bir hata oluştu')
    } finally {
      setSaving(false)
    }
  }

  const openCreate = () => {
    setCreateForm({ code: '', name: '', displayName: '', description: '', isActive: true })
    setCreateOpen(true)
  }

  const closeCreate = () => {
    if (saving) return
    setCreateOpen(false)
  }

  const submitCreate = async () => {
    try {
      setSaving(true)
      setError(null)
      if (!createForm.code.trim() || !createForm.name.trim() || !createForm.displayName.trim()) {
        setError('Lütfen Code/Name/DisplayName alanlarını doldurun')
        return
      }
      await createRole()
      setCreateOpen(false)
      const r = await fetchRoles()
      setRoles(r)
    } catch (e: any) {
      setError(e?.message ?? 'Bir hata oluştu')
    } finally {
      setSaving(false)
    }
  }

  const selectedRole = useMemo(() => {
    return roles.find((r) => r.id === selectedRoleId) ?? null
  }, [roles, selectedRoleId])

  const openEdit = () => {
    if (!selectedRoleId || !selectedRole) return
    setEditForm({
      code: selectedRole.code ?? '',
      name: selectedRole.name ?? '',
      displayName: selectedRole.displayName ?? '',
      description: '',
      isActive: Boolean(selectedRole.isActive)
    })
    setEditOpen(true)
  }

  const closeEdit = () => {
    if (saving) return
    setEditOpen(false)
  }

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  const handleDeleteRole = async () => {
    if (!selectedRoleId || !selectedRole) return
    try {
      setSaving(true)
      setError(null)
      await deleteRole(selectedRoleId)
      setDeleteConfirmOpen(false)
      const r = await fetchRoles()
      setRoles(r)
      setSelectedRoleId(null)
    } catch (e: any) {
      setError(e?.message ?? 'Rol silinirken bir hata oluştu')
    } finally {
      setSaving(false)
    }
  }

  const submitEdit = async () => {
    if (!selectedRoleId) return
    try {
      setSaving(true)
      setError(null)
      if (!editForm.code.trim() || !editForm.name.trim() || !editForm.displayName.trim()) {
        setError('Lütfen Code, Name ve DisplayName alanlarını doldurun')
        return
      }
      await updateRole(selectedRoleId)
      setEditOpen(false)
      const r = await fetchRoles()
      setRoles(r)
      setSelectedRoleId((prev) => (prev && r.some((x) => x.id === prev) ? prev : null))
    } catch (e: any) {
      setError(e?.message ?? 'Bir hata oluştu')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 max-w-[1600px] mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 pb-6 border-b border-gray-100">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <Shield className="w-5 h-5 text-emerald-600" />
            <span>Rol Yetkileri</span>
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">Yönetim / Rol & Yetki Yönetimi</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={saving || loading || !selectedRoleId}
            onClick={openEdit}
            className={
              'h-9 px-4 text-xs font-bold rounded-xl border active:scale-95 transition-all disabled:opacity-50 ' +
              (saving || loading || !selectedRoleId
                ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 hover:text-gray-900 shadow-sm')
            }
          >
            Rolü Düzenle
          </button>
          <button
            type="button"
            disabled={saving || loading || !selectedRoleId || selectedRole?.isSuperAdmin}
            onClick={() => setDeleteConfirmOpen(true)}
            className={
              'h-9 px-3.5 text-xs font-bold rounded-xl border active:scale-95 transition-all disabled:opacity-50 ' +
              (saving || loading || !selectedRoleId || selectedRole?.isSuperAdmin
                ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
                : 'bg-white text-rose-600 border-rose-200 hover:bg-rose-50 hover:border-rose-300 shadow-sm')
            }
            title="Seçili Rolü Sil"
          >
            Rolü Sil
          </button>
          <button
            type="button"
            disabled={saving || loading || !selectedRoleId}
            onClick={() => {
              setPermissions((prev) => prev.map((x) => ({ ...x, canAccess: true })))
            }}
            className={
              'h-9 px-4 text-xs font-bold rounded-xl border active:scale-95 transition-all disabled:opacity-50 ' +
              (saving || loading || !selectedRoleId
                ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
                : 'bg-white text-emerald-600 border-emerald-200 hover:bg-emerald-50 hover:border-emerald-300 shadow-sm')
            }
          >
            Tüm Yetkileri Aç
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="h-9 inline-flex items-center gap-1.5 px-4 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm active:scale-95 transition-all"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Yeni Rol
          </button>
          <button
            type="button"
            disabled={saving || loading || !selectedRoleId}
            onClick={() => void submitPermissions()}
            className={
              'h-9 inline-flex items-center gap-1.5 px-5 text-xs font-bold rounded-xl shadow-sm active:scale-95 transition-all disabled:opacity-50 ' +
              (saving || loading || !selectedRoleId
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white')
            }
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </div>

      {/* Kampanya anahtarı: sayfa yetkisi değil ticari bir kural, o yüzden sayfa listesinin
          dışında ve kendi ucuna anında kaydediliyor. */}
      {selectedRoleId && selectedRole && !selectedRole.isSuperAdmin && (
        <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-bold text-amber-900">Kampanyalar</div>
            <div className="text-[11px] text-amber-700/90">
              Kapalıyken <b>{selectedRole.displayName || selectedRole.name}</b> rolüyle giren
              kullanıcılar hiçbir kampanyadan yararlanamaz; kampanyalar listelenmez ve sepette
              indirim uygulanmaz.
            </div>
          </div>
          <button
            type="button"
            disabled={saving || loading}
            onClick={() => void toggleRoleCampaigns(selectedRoleId, !(selectedRole.campaignsEnabled ?? true))}
            className={
              'h-8 shrink-0 inline-flex items-center gap-1.5 px-4 text-xs font-bold rounded-xl shadow-sm active:scale-95 transition-all disabled:opacity-50 ' +
              ((selectedRole.campaignsEnabled ?? true)
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'bg-rose-600 hover:bg-rose-700 text-white')
            }
            title={(selectedRole.campaignsEnabled ?? true) ? 'Kampanyaları bu role kapat' : 'Kampanyaları bu role aç'}
          >
            {(selectedRole.campaignsEnabled ?? true) ? 'Açık' : 'Kapalı'}
          </button>
        </div>
      )}

      {/* Limit aşımıyla onay: işlem yetkisi, sayfa yetkisi değil. Süper Admin zaten yetkili. */}
      {selectedRoleId && selectedRole && !selectedRole.isSuperAdmin && (
        <div className="mb-4 p-3 rounded-xl bg-sky-50 border border-sky-100 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-bold text-sky-900">Limit Aşımıyla Sipariş Onayı</div>
            <div className="text-[11px] text-sky-700/90">
              Açıkken <b>{selectedRole.displayName || selectedRole.name}</b> rolündeki kullanıcılar Aktif Sepet
              Raporu'ndan, kredi limiti yetmeyen carinin sepetini siparişe çevirebilir. Sepetteki
              "Limitiniz yetersiz" uyarısı herkes için aynen kalır.
            </div>
          </div>
          <button
            type="button"
            disabled={saving || loading}
            onClick={() => void toggleRoleOverLimitApproval(selectedRoleId, !(selectedRole.overLimitApprovalEnabled ?? false))}
            className={
              'h-8 shrink-0 inline-flex items-center gap-1.5 px-4 text-xs font-bold rounded-xl shadow-sm active:scale-95 transition-all disabled:opacity-50 ' +
              ((selectedRole.overLimitApprovalEnabled ?? false)
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'bg-slate-400 hover:bg-slate-500 text-white')
            }
            title={(selectedRole.overLimitApprovalEnabled ?? false) ? 'Bu rolün yetkisini kapat' : 'Bu role yetki ver'}
          >
            {(selectedRole.overLimitApprovalEnabled ?? false) ? 'Açık' : 'Kapalı'}
          </button>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-100 text-xs font-semibold text-red-600 flex items-center gap-2">
          <Info className="w-4 h-4 text-red-500" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-xs font-semibold text-emerald-600 flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-500" />
          <span>{success}</span>
        </div>
      )}

      {/* Role Picker Card */}
      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4 mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">İşlem Yapılan Rol:</span>
          <select
            value={String(selectedRoleId ?? '')}
            onChange={(e) => {
              const value = Number(e.target.value)
              setSelectedRoleId(Number.isFinite(value) && value > 0 ? value : null)
            }}
            className="h-9 px-3 text-xs font-bold border border-gray-200 rounded-xl bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all cursor-pointer"
          >
            <option value="">Önce rol seçin</option>
            {roles.map((r) => (
              <option key={r.id} value={String(r.id)}>
                {r.displayName} {r.isSuperAdmin ? '(Super Admin)' : ''}
              </option>
            ))}
          </select>
        </div>
        
        {selectedRole && (
          <div className="text-xs text-gray-400 font-medium">
            Seçili Rolün {pages.filter(p => p.moduleKey !== 'service').length} sayfada yetki durumunu yönetiyorsunuz.
          </div>
        )}
      </div>

      {!selectedRoleId ? (
        <div className="bg-white border border-dashed border-gray-200 rounded-2xl shadow-sm p-12 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
            <Shield className="h-5 w-5" />
          </div>
          <h2 className="text-sm font-bold text-gray-900">Önce rol seçin</h2>
          <p className="mt-1 text-xs font-medium text-gray-400">
            Yetkileri görüntülemek ve düzenlemek için üstteki listeden bir rol seçin.
          </p>
        </div>
      ) : (
      /* Main Grid: Sidebar + Perms Area */
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
        {/* Sidebar Tabs */}
        <div className="lg:col-span-1 bg-white border border-gray-100 rounded-2xl shadow-sm p-3 space-y-1">
          <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider px-3 mb-2">Modüller</span>
          {groupedPages.map(([moduleKey, list]) => {
            const isActive = activeModuleTab === moduleKey
            const label = moduleLabel(moduleKey)
            const IconComp = MODULE_META[moduleKey]?.icon ?? FileText

            // Calculate active vs total perms
            const total = list.length
            const active = list.filter((p) => permissions.find((x) => x.pageId === p.id)?.canAccess).length
            const ratioText = `${active}/${total}`

            return (
              <button
                key={moduleKey}
                type="button"
                onClick={() => setActiveModuleTab(moduleKey)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all duration-200 ${
                  isActive
                    ? 'bg-emerald-50 text-emerald-700 font-bold shadow-sm'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <IconComp className={`w-4 h-4 ${isActive ? 'text-emerald-600' : 'text-gray-400'}`} />
                  <span className="text-xs">{label}</span>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                  isActive ? 'bg-emerald-200/50 text-emerald-800' : 'bg-gray-100 text-gray-500'
                }`}>
                  {ratioText}
                </span>
              </button>
            )
          })}
        </div>

        {/* Permissions List */}
        <div className="lg:col-span-3">
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                {moduleLabel(activeModuleTab)} Sayfa Yetkileri
              </span>
              <div className="flex items-center gap-3">
                {selectedRoleId && (
                  <button
                    type="button"
                    onClick={() => {
                      setPermissions((prev) =>
                        prev.map((x) =>
                          x.moduleKey === activeModuleTab ? { ...x, canAccess: true } : x
                        )
                      )
                    }}
                    className="text-[11px] font-bold text-emerald-600 hover:text-emerald-700 hover:underline cursor-pointer transition-all"
                  >
                    Modülün Tüm Yetkilerini Aç
                  </button>
                )}
                <span className="text-[10px] font-bold text-gray-400 uppercase">Durum</span>
              </div>
            </div>

            {loading ? (
              <div className="p-8 text-center text-xs text-gray-500 flex flex-col items-center gap-2">
                <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                <span>Yetki verileri yükleniyor...</span>
              </div>
            ) : (
              <div className="p-5 space-y-4">
                {(() => {
                  const currentGroup = groupedPages.find(([k]) => k === activeModuleTab)
                  if (!currentGroup) return <p className="text-xs text-gray-400">Yetkilendirilecek sayfa bulunamadı.</p>

                  const [, list] = currentGroup
                  const scopedInvoiceChild = activeModuleTab === 'invoice' ? list.find((x) => x.key === invoiceSubKey) : undefined
                  const scopedAlisChild = activeModuleTab === 'invoice' ? list.find((x) => x.key === alisSubKey) : undefined
                  const invoiceBsyHidePage = activeModuleTab === 'invoice' ? list.find((x) => x.key === invoiceBsyHideKey) : undefined
                  const invoiceBsyComingSoonPage = activeModuleTab === 'invoice' ? list.find((x) => x.key === invoiceBsyComingSoonKey) : undefined
                  
                  // ALT YETKİLER LİSTEDEN HER MODÜLDE ÇIKARILIR.
                  //
                  // Bu süzgeç yalnızca 'invoice' ve 'serviceOps' için uygulanıyordu. Diğer her
                  // modülde alt yetkiler İKİ KEZ çiziliyordu: bir kez üst kartın "ALT YETKİLER"
                  // bölümünde, bir kez de kendi başına bağımsız kart olarak. Ekranda en görünür
                  // örneği Bildirimler'di — 'Gelen Bildirimler' ve 'Bildirim Gönder' hem
                  // 'Bildirimler' kartının altında hem de ayrı kartlar olarak duruyordu.
                  //
                  // İki kart aynı PageId'ye bağlı olduğu için tehlikesi görüntüden ibaret değil:
                  // kullanıcı hangisini kapattığını takip edemiyor, biri açık biri kapalı
                  // görünüyordu.
                  const viewList = list.filter((x) =>
                    !allSubKeys.includes(x.key) &&
                    x.key !== invoiceBsyHideKey &&
                    x.key !== invoiceBsyComingSoonKey
                  )

                  return (
                    <>
                      {/*
                        Silme Ayarları'nda düğmelerin yönü sezgiye TERS: belge kuralları bir
                        yetki değil KISIT (açık = yalnızca 24 saat içinde silinebilir). Kart
                        metinleri bunu tek tek yazıyor ama bölümün başında da söylenmeli,
                        yoksa yönetici hepsini "açarak" istemeden herkesi kısıtlıyor.
                      */}
                      {activeModuleTab === 'deleteRule' && (
                        <div className="border border-blue-200/60 bg-blue-50/40 rounded-2xl p-4 mb-4 flex items-start gap-2.5">
                          <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                          <div className="text-[11px] text-blue-900 leading-relaxed">
                            <span className="font-bold block mb-1">Bu bölümdeki düğmeler kısıt koyar, yetki vermez.</span>
                            Belge türü düğmeleri <b>açıkken</b> o belge yalnızca oluşturulduktan sonraki
                            <b> 24 saat</b> içinde silinebilir; kapalıyken süre sınırı yoktur.
                            Kendi oluşturduğu kaydı <b>herkes</b> silebilir — başkasının kaydını silmek için
                            "Başkalarının kayıtlarını da silebilsin" gerekir.
                          </div>
                        </div>
                      )}

                      {/* BSY(H) Custom Header Card for Invoice */}
                      {activeModuleTab === 'invoice' && (invoiceBsyHidePage || invoiceBsyComingSoonPage) && (
                        <div className="border border-amber-200/60 bg-amber-50/20 rounded-2xl p-4 mb-4">
                          <h4 className="text-xs font-bold text-amber-800 uppercase tracking-wide flex items-center gap-1.5 mb-3">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                            <span>BSY (H) Seçenekleri</span>
                          </h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {invoiceBsyHidePage && (() => {
                              const bsyHideChecked = permissions.find((x) => x.pageId === invoiceBsyHidePage.id)?.canAccess ?? false
                              return (
                                <div className="flex items-center justify-between p-3 rounded-xl border border-amber-200/30 bg-white">
                                  <div>
                                    <span className="block text-xs font-semibold text-gray-800">Ürünü Gösterme</span>
                                    <span className="block text-[10px] text-gray-400 mt-0.5">invoice/bsyHHide</span>
                                  </div>
                                  <ToggleSwitch
                                    checked={bsyHideChecked}
                                    onChange={() => {
                                      const next = !bsyHideChecked
                                      setPermissions((prev) => {
                                        let updated = prev.map((x) =>
                                          x.pageId === invoiceBsyHidePage.id ? { ...x, canAccess: next } : x
                                        )
                                        if (next && invoiceBsyComingSoonPage) {
                                          updated = updated.map((x) =>
                                            x.pageId === invoiceBsyComingSoonPage.id ? { ...x, canAccess: false } : x
                                          )
                                        }
                                        return updated
                                      })
                                    }}
                                  />
                                </div>
                              )
                            })()}

                            {invoiceBsyComingSoonPage && (() => {
                              const bsyComingChecked = permissions.find((x) => x.pageId === invoiceBsyComingSoonPage.id)?.canAccess ?? false
                              return (
                                <div className="flex items-center justify-between p-3 rounded-xl border border-amber-200/30 bg-white">
                                  <div>
                                    <span className="block text-xs font-semibold text-gray-800">ComingSoon ile Göster</span>
                                    <span className="block text-[10px] text-gray-400 mt-0.5">invoice/bsyHComingSoon</span>
                                  </div>
                                  <ToggleSwitch
                                    checked={bsyComingChecked}
                                    onChange={() => {
                                      const next = !bsyComingChecked
                                      setPermissions((prev) => {
                                        let updated = prev.map((x) =>
                                          x.pageId === invoiceBsyComingSoonPage.id ? { ...x, canAccess: next } : x
                                        )
                                        if (next && invoiceBsyHidePage) {
                                          updated = updated.map((x) =>
                                            x.pageId === invoiceBsyHidePage.id ? { ...x, canAccess: false } : x
                                          )
                                        }
                                        return updated
                                      })
                                    }}
                                  />
                                </div>
                              )
                            })()}
                          </div>
                        </div>
                      )}

                      {/* Main Permissions List grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {viewList.map((p) => {
                          const checked = permissions.find((x) => x.pageId === p.id)?.canAccess ?? false
                          const isKonsinyeParent = p.moduleKey === 'invoice' && p.key === konsinyeParentKey

                          const cardSubKeys = subKeysMap[p.key as keyof typeof subKeysMap] ?? []
                          const cardSubPages = cardSubKeys.map(k => pages.find(x => x.moduleKey === p.moduleKey && x.key === k)).filter(Boolean) as PageItem[]

                          const konsinyeChildren = isKonsinyeParent
                            ? [
                                pages.find((x) => x.moduleKey === 'invoice' && x.key === konsinyeQtyEditKey),
                                pages.find((x) => x.moduleKey === 'invoice' && x.key === konsinyeSevkQtyEditKey),
                                pages.find((x) => x.moduleKey === 'invoice' && x.key === konsinyeStatusOnaylandiKey),
                                pages.find((x) => x.moduleKey === 'invoice' && x.key === konsinyeStatusSevkEdildiKey)
                              ].filter(Boolean)
                            : []

                          return (
                            <div key={p.id} className={`p-4 border rounded-2xl bg-white flex flex-col justify-between transition-all duration-200 ${
                              checked ? 'border-emerald-100 shadow-sm shadow-emerald-500/[0.02]' : 'border-gray-100 hover:border-gray-200'
                            }`}>
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  {/* Açıklaması olan yetkide ham anahtar yerine ne yaptığını
                                      anlatan cümle gösterilir; anahtar yalnızca fare üstüne
                                      gelince (title) görünür — geliştirici için orada, yetkiyi
                                      verecek kişinin gözünü yormaz. */}
                                  <span className="block text-xs font-bold text-gray-900">
                                    {PERMISSION_INFO[`${p.moduleKey}/${p.key}`]?.label ?? p.displayName}
                                  </span>
                                  {PERMISSION_INFO[`${p.moduleKey}/${p.key}`]?.help ? (
                                    <span
                                      className="block text-[10px] text-gray-500 mt-1 leading-relaxed"
                                      title={`${p.moduleKey}/${p.key}`}
                                    >
                                      {PERMISSION_INFO[`${p.moduleKey}/${p.key}`]!.help}
                                    </span>
                                  ) : (
                                    <span className="block text-[10px] text-gray-400 mt-0.5">{p.moduleKey}/{p.key}</span>
                                  )}
                                </div>
                                <ToggleSwitch
                                  checked={checked}
                                  onChange={() => {
                                    const next = !checked
                                    setPermissions((prev) => {
                                      let updated = prev.map((x) => (x.pageId === p.id ? { ...x, canAccess: next } : x))
                                      if (!next && cardSubPages.length > 0) {
                                        const subIds = cardSubPages.map(x => x.id)
                                        updated = updated.map((x) =>
                                          subIds.includes(x.pageId) ? { ...x, canAccess: false } : x
                                        )
                                      }
                                      return updated
                                    })
                                  }}
                                />
                              </div>

                              {/* Nested Sub-Permissions (Alt Yetkiler) */}
                              {cardSubPages.length > 0 && (
                                <div className="mt-3 pt-3 border-t border-gray-100/60 pl-2 space-y-2">
                                  <span className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-2">Alt Yetkiler</span>
                                  {cardSubPages.filter(sp => !['alisTipAlis', 'alisTipHizmet', 'alisTipIade'].includes(sp.key)).map(sp => {
                                    const spChecked = permissions.find(x => x.pageId === sp.id)?.canAccess ?? false
                                    return (
                                      <div key={sp.id} className="flex items-center justify-between p-2 rounded-xl bg-gray-50/50 border border-gray-100">
                                        <div>
                                          <span className={`block text-[11px] font-semibold ${
                                            sp.key.split('.').length > 2 ? 'text-emerald-700 pl-3' : 'text-gray-700'
                                          }`}>
                                            {sp.key.endsWith('.tumIsleriGorme')
                                              // Sekme kapsamı ('buyukUrun.atolye.tumIsleriGorme') üstündeki sekmenin
                                              // altında ve ona bağlı okunmalı. Hepsi aynı genel yazıyla görünseydi
                                              // ekranda beş tane ayırt edilemez 'Tüm İşleri Görme' satırı olurdu.
                                              ? (sp.key.split('.').length > 2
                                                  ? '↳ Tüm işleri görsün (kapalıysa: sadece kendine atananlar)'
                                                  : 'Tüm İşleri/Kayıtları Görebilsin (Tüm Liste)')
                                              : sp.key === 'satisFaturaDepoBakiyeGorsun'
                                                ? 'Depo Stok Bilgisi'
                                                : sp.key === 'satisFaturaOdemeAl'
                                                  ? 'Ödemeyi Hemen Al'
                                                  : (PERMISSION_INFO[`${p.moduleKey}/${sp.key}`]?.label ?? sp.displayName)}
                                          </span>
                                          {PERMISSION_INFO[`${p.moduleKey}/${sp.key}`]?.help ? (
                                            <span className="block text-[9px] text-gray-500 mt-0.5 leading-relaxed" title={`${p.moduleKey}/${sp.key}`}>
                                              {PERMISSION_INFO[`${p.moduleKey}/${sp.key}`]!.help}
                                            </span>
                                          ) : (
                                            <span className="block text-[9px] text-gray-400 mt-0.5">{p.moduleKey}/{sp.key}</span>
                                          )}
                                        </div>
                                        <ToggleSwitch
                                          checked={spChecked}
                                          disabled={!checked}
                                          onChange={() => {
                                            const next = !spChecked
                                            setPermissions((prev) =>
                                              prev.map((x) => (x.pageId === sp.id ? { ...x, canAccess: next } : x))
                                            )
                                          }}
                                        />
                                      </div>
                                    )
                                  })}

                                  {(() => {
                                    const typeSubPages = cardSubPages.filter(sp => ['alisTipAlis', 'alisTipHizmet', 'alisTipIade'].includes(sp.key))
                                    if (typeSubPages.length === 0) return null
                                    return (
                                      <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-gray-100/40">
                                        {typeSubPages.map(sp => {
                                          const spChecked = permissions.find(x => x.pageId === sp.id)?.canAccess ?? false
                                          return (
                                            <div key={sp.id} className="flex flex-col items-center justify-center p-2 rounded-xl bg-gray-50/50 border border-gray-100 text-center gap-1.5">
                                              <span className="block text-[10px] font-semibold text-gray-700 leading-none">
                                                {sp.displayName}
                                              </span>
                                              <ToggleSwitch
                                                checked={spChecked}
                                                disabled={!checked}
                                                onChange={() => {
                                                  const next = !spChecked
                                                  setPermissions((prev) =>
                                                    prev.map((x) => (x.pageId === sp.id ? { ...x, canAccess: next } : x))
                                                  )
                                                }}
                                              />
                                            </div>
                                          )
                                        })}
                                      </div>
                                    )
                                  })()}
                                </div>
                              )}

                              {/* Konsinye Alt Yetkileri */}
                              {isKonsinyeParent && konsinyeChildren.length > 0 && (
                                <div className="mt-3 pt-3 border-t border-gray-100/60">
                                  <span className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-2">Alt Yetkiler</span>
                                  <div className="space-y-2">
                                    {konsinyeChildren.map((cp: any) => {
                                      const cChecked = permissions.find((x) => x.pageId === cp.id)?.canAccess ?? false
                                      const label =
                                        cp.key === konsinyeQtyEditKey
                                          ? 'Kaç Adet düzenle'
                                          : cp.key === konsinyeSevkQtyEditKey
                                            ? 'Sevk Adedi düzenle'
                                            : cp.key === konsinyeStatusOnaylandiKey
                                              ? 'Durum: onaylandı'
                                              : cp.key === konsinyeStatusSevkEdildiKey
                                                ? 'Durum: sevk edildi'
                                                : cp.displayName

                                      return (
                                        <div key={cp.id} className="flex items-center justify-between p-2 rounded-xl bg-gray-50/50 border border-gray-100">
                                          <div>
                                            <span className="block text-[11px] font-semibold text-gray-700">{label}</span>
                                            <span className="block text-[9px] text-gray-400 mt-0.5">invoice/{cp.key}</span>
                                          </div>
                                          <ToggleSwitch
                                            checked={cChecked}
                                            disabled={!checked}
                                            onChange={() => {
                                              const next = !cChecked
                                              setPermissions((prev) =>
                                                prev.map((x) => (x.pageId === cp.id ? { ...x, canAccess: next } : x))
                                              )
                                            }}
                                          />
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )
                })()}
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onMouseDown={closeCreate} />
          <div className="relative z-10 w-full max-w-3xl mx-4 bg-white rounded-xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-800">Yeni Rol</div>
              <button
                type="button"
                disabled={saving}
                onClick={closeCreate}
                className="text-xs font-semibold text-gray-500 hover:text-gray-700"
              >
                Kapat
              </button>
            </div>

            <div className="px-5 py-4">
              <div className="text-xs font-bold text-gray-700 uppercase tracking-wide">Rol Bilgileri</div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Code</div>
                  <input
                    value={createForm.code}
                    onChange={(e) => setCreateForm((p) => ({ ...p, code: e.target.value }))}
                    className="input-base h-9 text-sm"
                    placeholder="Admin2"
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Name</div>
                  <input
                    value={createForm.name}
                    onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))}
                    className="input-base h-9 text-sm"
                    placeholder="Admin2"
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Display Name</div>
                  <input
                    value={createForm.displayName}
                    onChange={(e) => setCreateForm((p) => ({ ...p, displayName: e.target.value }))}
                    className="input-base h-9 text-sm"
                    placeholder="Admin 2"
                  />
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <div className="md:col-span-2 space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Açıklama</div>
                  <input
                    value={createForm.description}
                    onChange={(e) => setCreateForm((p) => ({ ...p, description: e.target.value }))}
                    className="input-base h-9 text-sm"
                    placeholder="(opsiyonel)"
                  />
                </div>

                <label className="flex items-center gap-2 text-sm text-gray-700 select-none md:justify-end">
                  <input
                    type="checkbox"
                    checked={createForm.isActive}
                    onChange={(e) => setCreateForm((p) => ({ ...p, isActive: e.target.checked }))}
                  />
                  Aktif
                </label>
              </div>
            </div>


            <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={closeCreate}
                className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition disabled:opacity-60"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void submitCreate()}
                className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-60"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                {saving ? 'Kaydediliyor...' : 'Oluştur'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onMouseDown={closeEdit} />
          <div className="relative z-10 w-full max-w-2xl mx-4 bg-white rounded-xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-800">Rol Düzenle</div>
              <button
                type="button"
                disabled={saving}
                onClick={closeEdit}
                className="text-xs font-semibold text-gray-500 hover:text-gray-700"
              >
                Kapat
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Code</div>
                  <input
                    value={editForm.code}
                    onChange={(e) => setEditForm((p) => ({ ...p, code: e.target.value }))}
                    className="input-base h-9 text-sm"
                    placeholder="Admin"
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Name</div>
                  <input
                    value={editForm.name}
                    onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
                    className="input-base h-9 text-sm"
                    placeholder="Admin"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Açıklama</div>
                <input
                  value={editForm.description}
                  onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))}
                  className="input-base h-9 text-sm"
                  placeholder="(opsiyonel)"
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700 select-none">
                <input
                  type="checkbox"
                  checked={editForm.isActive}
                  onChange={(e) => setEditForm((p) => ({ ...p, isActive: e.target.checked }))}
                />
                Aktif
              </label>
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={closeEdit}
                className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition disabled:opacity-60"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void submitEdit()}
                className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-60"
              >
                {saving ? 'Kaydediliyor...' : 'Güncelle'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmOpen && selectedRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-gray-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto mb-4">
              <Trash2 size={24} />
            </div>
            <h3 className="text-base font-bold text-gray-900 text-center">Rolü Sil</h3>
            <p className="text-xs text-gray-500 text-center mt-2">
              <span className="font-bold text-gray-800">"{selectedRole.displayName}"</span> isimli rolü silmek istediğinize emin misiniz?
            </p>
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200/60 rounded-xl p-3 mt-3 text-center leading-relaxed">
              ⚠️ Bu role tanımlı kullanıcı(lar) varsa rol silinemez.
            </p>
            <div className="flex gap-2.5 mt-5">
              <button
                type="button"
                disabled={saving}
                onClick={() => setDeleteConfirmOpen(false)}
                className="flex-1 h-9 text-xs font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleDeleteRole()}
                className="flex-1 h-9 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-sm transition disabled:opacity-50 cursor-pointer"
              >
                {saving ? 'Siliniyor...' : 'Evet, Sil'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The customer scope of one user, in a table cell.
 *
 * A scope is a comma-separated list of customer codes; '*' means every customer. Multi-customer
 * scopes are shown as a count and expanded on click — rendering fifty codes inline pushed the
 * table several screens wide.
 */
type CariScopeCustomer = { customerCode: string; name?: string | null; salesmanCode?: string | null }


/**
 * "Cari Yetkisi / Listesi" seçicisi.
 *
 * Kullanıcı ve teknisyen ekleme ekranlarının ikisi de aynı şeyi soruyor: bu kişi hangi carilerin
 * kayıtlarını görsün. Blok yalnızca kullanıcı modalında duruyordu; teknisyen tarafına kopyalamak
 * yerine buraya çıkarıldı, böylece iki ekran aynı davranışı paylaşır ve biri düzeltilip diğeri
 * unutulamaz.
 *
 * Değer, alanın kendisinde ne saklanıyorsa o: virgülle ayrılmış kod listesi. '*' (ya da boş)
 * kısıtlamasız demek — çoklu seçimden önce kaydedilmiş kapsamlar da bu yüzden doğru okunur.
 */
function CariScopePicker({
  value,
  onChange,
  customers,
  label = 'Cari Yetkisi / Listesi',
  emptyIsAll = true,
  emptyLabel = 'Seçiniz...'
}: {
  value: string
  onChange: (next: string) => void
  customers: CariScopeCustomer[]
  label?: string
  /**
   * Boş değerin ne anlama geldiği. Kullanıcılarda boş "kısıtlama yok" demek ve API hep böyle
   * okudu. Teknisyende bu tehlikeli: aynı alan B2B'nin cari kısıtlaması olarak da okunuyor, yani
   * boş bırakılan bir teknisyen bütün carilere açılırdı. Orada boş, "cari atanmadı" demek.
   */
  emptyIsAll?: boolean
  emptyLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [salesmanPick, setSalesmanPick] = useState('')
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const isAll = value === '*' || (emptyIsAll && value.trim() === '')

  const selected = useMemo(
    () => (isAll ? [] : value.split(',').map((c) => c.trim()).filter(Boolean)),
    [value, isAll]
  )

  const setCodes = (codes: string[]) => {
    const unique = Array.from(new Set(codes.map((c) => c.trim()).filter(Boolean)))
    // Hiçbir şey seçili değilse kısıtlama yok demektir; '*' bunu açıkça söyler.
    onChange(unique.length === 0 ? (emptyIsAll ? '*' : '') : unique.join(','))
  }

  const toggle = (code: string) => {
    setCodes(selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code])
  }

  /** Baştaki sıfırlar kayıttan kayda değiştiği için kodlar sıfırsız karşılaştırılır. */
  const normaliseSalesman = (raw?: string | null) => {
    const s = String(raw ?? '').trim()
    if (!s) return ''
    return s.replace(/^0+/, '') || s
  }

  const salesmanOptions = useMemo(() => {
    const counts = new Map<string, { code: string; label: string; count: number }>()
    for (const c of customers) {
      const code = normaliseSalesman(c.salesmanCode)
      if (!code) continue
      const entry = counts.get(code)
      if (entry) entry.count++
      else counts.set(code, { code, label: String(c.salesmanCode ?? code).trim(), count: 1 })
    }
    return Array.from(counts.values()).sort((a, b) => a.code.localeCompare(b.code, 'tr'))
  }, [customers])

  return (
    <div className="space-y-1 relative" ref={boxRef}>
      <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">{label}</div>
      <button
        type="button"
        onClick={() => {
          setOpen((p) => !p)
          setSearch('')
        }}
        className="input-base h-9 text-sm flex items-center justify-between bg-white w-full text-left font-medium"
      >
        <span className="truncate">
          {isAll
            ? '★ TÜM CARİLER (HEPSİ - KISITLAMASIZ)'
            : selected.length === 0
            ? emptyLabel
            : selected.length === 1
            ? (() => {
                const found = customers.find((c) => c.customerCode === selected[0])
                return found ? `[${found.customerCode}] ${found.name}` : selected[0]
              })()
            : `${selected.length} cari seçili`}
        </span>
        <span className="text-gray-400">▼</span>
      </button>

      {/* Seçilenler, listeyi açmadan da okunabilsin diye. */}
      {!isAll && selected.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {selected.map((code) => {
            const found = customers.find((c) => c.customerCode === code)
            return (
              <span
                key={code}
                className="inline-flex items-center gap-1 rounded bg-gray-100 border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-700"
              >
                <span className="truncate max-w-[170px]">{found ? `[${code}] ${found.name}` : code}</span>
                <button
                  type="button"
                  onClick={() => toggle(code)}
                  className="text-gray-400 hover:text-red-500"
                  aria-label={`${code} kaldır`}
                >
                  ×
                </button>
              </span>
            )
          })}
          <button type="button" onClick={() => setCodes([])} className="text-[10px] text-red-500 hover:underline px-1">
            Temizle
          </button>
        </div>
      )}

      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl p-2 max-h-72 overflow-y-auto">
          <input
            type="text"
            className="input-base h-8 text-xs mb-1 w-full bg-gray-50 px-2"
            placeholder="Cari ara..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />

          {/*
            Plasiyere göre toplu seçim. Ayrı bir yetki türü değil, kısayol: o plasiyerin carilerini
            aynı listeye işaretler, sonuç yine elle düzeltilebilir düz bir kod kümesidir.
          */}
          <div className="flex items-center gap-1 mb-1">
            <select
              className="input-base h-8 text-xs flex-1 bg-gray-50 px-2"
              value={salesmanPick}
              onChange={(e) => setSalesmanPick(e.target.value)}
            >
              <option value="">Plasiyerin carilerini işaretle...</option>
              {salesmanOptions.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} — {s.label} ({s.count})
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!salesmanPick}
              onClick={() => {
                const codes = customers
                  .filter((c) => normaliseSalesman(c.salesmanCode) === salesmanPick)
                  .map((c) => c.customerCode)
                setCodes([...selected, ...codes])
                setSalesmanPick('')
              }}
              className="h-8 px-2 rounded bg-gray-900 text-white text-[11px] font-semibold disabled:opacity-40"
            >
              + Ekle
            </button>
          </div>

          <div className="space-y-0.5 mt-1">
            <div
              role="button"
              onClick={() => {
                onChange('*')
                setOpen(false)
              }}
              className={`px-2 py-1.5 text-xs rounded hover:bg-gray-100 cursor-pointer ${
                isAll ? 'bg-gray-100 font-semibold text-gray-900' : 'text-gray-700'
              }`}
            >
              ★ TÜM CARİLER (HEPSİ - KISITLAMASIZ)
            </div>
            {customers
              .filter((c) => {
                const query = search.trim().toLocaleLowerCase('tr-TR')
                if (!query) return true
                return (
                  String(c.customerCode ?? '').toLocaleLowerCase('tr-TR').includes(query) ||
                  String(c.name ?? '').toLocaleLowerCase('tr-TR').includes(query)
                )
              })
              .map((c) => {
                const checked = selected.includes(c.customerCode)
                return (
                  <label
                    key={c.customerCode}
                    className={`flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-gray-100 cursor-pointer ${
                      checked ? 'bg-gray-100 font-semibold text-gray-900' : 'text-gray-700'
                    }`}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggle(c.customerCode)} className="accent-gray-900" />
                    <span className="truncate">
                      [{c.customerCode}] {c.name}
                      {c.salesmanCode ? <span className="text-gray-400"> · {c.salesmanCode}</span> : null}
                    </span>
                  </label>
                )
              })}
          </div>
        </div>
      )}
    </div>
  )
}

function CariScopeCell({ codes, nameOf }: { codes: string; nameOf: (code: string) => string }) {
  const [open, setOpen] = useState(false)

  const list = useMemo(
    () =>
      String(codes ?? '')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
    [codes]
  )

  if (list.length === 0) return <span className="text-gray-400">—</span>
  if (list.length === 1 && list[0] === '*') return <span className="text-gray-700">Tüm Cariler</span>
  if (list.length === 1) return <span className="text-gray-700">{nameOf(list[0])}</span>

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="inline-flex items-center gap-1 text-xs font-semibold text-gray-700 hover:text-gray-900"
      >
        <span className="rounded bg-gray-100 border border-gray-200 px-1.5 py-0.5">Liste ({list.length})</span>
        <span className="text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-1 max-h-48 overflow-y-auto rounded border border-gray-200 bg-white p-1">
          {list.map((code) => (
            <div key={code} className="px-1.5 py-0.5 text-[11px] text-gray-700 whitespace-nowrap">
              {nameOf(code)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function UsersPage() {
  const { activeTabId } = useOutletContext<LayoutContext>()

  if (activeTabId === 'genelAyarlar') {
    return <JwtSessionSettingsPage />
  }

  if (activeTabId === 'globalUsers') {
    return <GlobalUsersAdminPage />
  }

  if (activeTabId === 'allUsers') {
    return <AllUsersAdminPage />
  }

  if (activeTabId === 'projeYonetimi') {
    return <ProjeYonetimiPage />
  }

  if (activeTabId === 'onboard') {
    return <SsaOnboardPage />
  }

  if (activeTabId === 'depolar') {
    return <DepolarPage />
  }

  // Arızalı ürünlerin toplandığı deponun seçildiği tek ayar.
  if (activeTabId === 'garantiDeposu') {
    return <GarantiDeposuAyarPage />
  }

  if (activeTabId === 'subeler') {
    return <CheckBranchesPage />
  }

  if (activeTabId === 'kasalarim') {
    return <KasalarimPage />
  }

  if (activeTabId === 'bankaHesapTanim') {
    return <BankAccountDefinitionsPage />
  }

  if (activeTabId === 'posHesapAyar') {
    return <PosAccountSettingsPage />
  }

  if (activeTabId === 'posAktarim') {
    return <PosTransferPage />
  }

  if (activeTabId === 'rolYetkileri') {
    return <RolYetkileriView />
  }

  if (activeTabId === 'kategoriYonetimi') {
    return <CategoryManagementPage />
  }

  if (activeTabId === 'urunYonetimi') {
    return <ProductGridPage />
  }

  if (activeTabId === 'atiliFiyatlandirma') {
    return <AtliFiyatlandirmaPage />
  }

  if (activeTabId === 'fiyatKategorileri') {
    return <PriceCategoriesPage />
  }

  if (activeTabId === 'cariEkle') {
    return <CariEklePage />
  }

  if (activeTabId === 'irsaliye') {
    return <Navigate to="/invoice/konsinye" replace />
  }

  if (activeTabId === 'silinenKayitlar') {
    return <DeletionLogsPage />
  }

  if (activeTabId === 'installmentRules') {
    return <InstallmentRulesAdminPage />
  }

  if (activeTabId === 'kampanya') {
    return <CampaignsPage />
  }

  if (activeTabId === 'topluFiyatAtama') {
    return <BulkPricingPage />
  }

  if (activeTabId === 'bildirimler') {
    return <NotificationsPage />
  }

  if (activeTabId === 'tedarikciEkle') {
    return <SuppliersPage />
  }

  if (activeTabId === 'userActivities') {
    return <UserActivitiesPage />
  }

  if (activeTabId === 'systemErrorLogs') {
    return <SystemErrorLogsPage />
  }

  if (activeTabId === 'maliDonemler') {
    return <MaliDonemlerPage />
  }

  if (activeTabId === 'sistemDenetimi') {
    return <SistemDenetimiPage />
  }

  return (
    <div>
      <KullaniciListesiView />
    </div>
  )
}
