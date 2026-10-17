import React, { useEffect, useMemo, useRef, useState } from 'react'
import Table, { type TableColumn } from '../components/Table'
import { fetchPriceGroups, type PriceGroupDto } from '../api/priceGroups'
import NotificationPopup, { type NotificationVariant } from '../components/NotificationPopup'
import Modal from '../components/Modal'
import { fetchLimitRiskReport } from '../api/reports'
import { fetchSalesmenDropdown } from '../api/salesmen'
import { fetchCustomerAuthorizedContact, upsertCustomerAuthorizedContact, type CustomerAuthorizedContactDto } from '../api/customerAuthorizedContacts'
import { fetchNextCustomerCode } from '../api/customers'
import { fetchBayiMuhtelifCustomersForCariOffers, type BayiMuhtelifCustomerDto } from '../api/cariOffers'
import { PHONE_FORMAT_MESSAGE, PHONE_PATTERN, formatPhoneNumber } from '../utils/phone'


type Customer = {
  customerCode: string
  name: string
  address?: string | null
  city?: string | null
  district?: string | null
  phone?: string | null
  fax?: string | null
  email?: string | null
  taxOffice?: string | null
  taxNumber?: string | null
  identityNumber?: string | null
  customerType: string
  invoiceType: string
  productCategory?: string | null
  isActive: boolean
  priceGroupId?: string | null
  discountRate: number
  salesmanCode?: string | null
  creditLimit: number
  creditLimitUsd?: number
  creditLimitEur?: number
  creditLimitGbp?: number
  parentCustomerCode?: string | null
  currencyTypeId: number
  productCategoryIds?: string[]
}

type AuthorizedContactFormState = {
  fullName: string
  phone: string
}

type SalesmanOption = { label: string; value: string }

type CustomerRow = Customer & { actions: string }

type PriceGroup = { id: string; code: number; name: string; invoiceType?: string | null }

type ProductCategory = { id: string; name: string; parentId?: string | null; isActive?: boolean }

type ApiValidationError = {
  title?: string
  detail?: string
  errors?: Record<string, string[]>
}

type ExcelImportRowError = {
  rowNumber: number
  customerCode?: string | null
  errors: string[]
}

type ExcelImportResult = {
  successCount: number
  rowErrors: ExcelImportRowError[]
}

const validationFieldLabels: Record<string, string> = {
  Phone: 'Telefon',
  phone: 'Telefon',
  IdentityNumber: 'TC Kimlik No',
  identityNumber: 'TC Kimlik No',
  TaxNumber: 'Vergi No',
  taxNumber: 'Vergi No',
  TaxOffice: 'Vergi Dairesi',
  taxOffice: 'Vergi Dairesi',
  Email: 'Email',
  email: 'Email',
  CustomerCode: 'Cari Kodu',
  customerCode: 'Cari Kodu',
  Name: 'Cari Adı',
  name: 'Cari Adı',
  ProductCategoryIds: 'Ürün Kategorisi',
  productCategoryIds: 'Ürün Kategorisi',
  FullName: 'Yetkili Ad Soyad',
  fullName: 'Yetkili Ad Soyad'
}

const CITIES = [
  'LEFKOŞA',
  'GİRNE',
  'LEFKE',
  'GAZİMAĞUSA',
  'İSKELE',
  'GÜZELYURT'
]

const DISTRICTS = [
  'AKDENİZ', 'AKDOĞAN', 'ALAYKÖY', 'ALSANCAK', 'ALTAYLILAR', 'ASLANKÖY', 'AYDEMET', 'AYDINKÖY',
  'AYLUKA', 'BAFRA', 'BAHÇELER', 'BALIKESİR', 'BELLAPAİS', 'BOĞAZKÖY', 'BOSTANCI', 'ÇAĞLAYAN',
  'ÇAMLIBEL', 'ÇANAKKALE', 'ÇATALKÖY', 'DEĞİRMENLİK', 'DEMİRHAN', 'DEREBOYU', 'DERİNCE', 'DİKMEN',
  'DİPKARPAZ', 'DOĞANCI', 'DUMLUPINAR', 'EDREMİT', 'ERDEMLİ', 'ESENTEPE', 'GAZİVEREN', 'GEÇİTKALE',
  'GELİNCİK', 'GEMİKONAĞI', 'GÖÇMENKÖY', 'GÖNYELİ', 'GÜNGÖR', 'GÜVERCİNLİK', 'HAMİTKÖY', 'HASPOLAT',
  'KALECİK', 'KAPALI MARAŞ', 'KARAKUM', 'KARAOĞLANOĞLU', 'KERMİYA', 'KIRKLAR', 'KOZANKÖY',
  'KÖŞKLÜÇİFTLİK', 'KUMYALI', 'KUZUCUK', 'KÜÇÜKKAYMAKLI', 'LAPTA', 'MARMARA', 'MEHMETÇİK', 'MELİKGAZİ',
  'MERKEZ', 'MİNARELİKÖY', 'ORTAKÖY', 'OZANKÖY', 'ÖTÜKEN', 'PAŞAKÖY', 'SAKARYA', 'SALAMİSYOLU',
  'SANAYİ', 'SERDARLI', 'SINIRÜSTÜ', 'SURLARİÇİ', 'SÜTLÜCE', 'TAŞKINKÖY', 'TATLISU', 'TEPEBASI',
  'TUZLA', 'ULUKIŞLA', 'VADİLİ', 'YAYLA', 'YENİBOĞAZİÇİ', 'YENİERENKÖY', 'YENİKENT', 'YENİŞEHİR',
  'YEŞİLKÖY', 'YILMAZKÖY', 'YİĞİTLER', 'ZEYTİNLİK', 'ZÜMRÜTKÖY'
]

type FormState = {
  customerCode: string
  name: string
  address: string
  city: string
  district: string
  phone: string
  fax: string
  email: string
  taxOffice: string
  taxNumber: string
  identityNumber: string
  customerType: string
  invoiceType: string
  productCategory: string
  categoryAccessMode: 'All' | 'Custom'
  productCategoryIds: string[]
  isActive: boolean
  priceGroupId: string
  discountRate: string
  salesmanCode: string
  creditLimit: string
  creditLimitUsd: string
  creditLimitEur: string
  creditLimitGbp: string
  parentCustomerCode: string
  currencyTypeId: string
  initialBalance: string
}

import { API_BASE_URL } from '../config/api'

function buildHeaders(includeJson: boolean) {
  const headers: Record<string, string> = {}
  if (includeJson) headers['Content-Type'] = 'application/json'
  const token = localStorage.getItem('accessToken')
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

function parseDecimalInput(s: string) {
  const v = String(s ?? '').trim().replace(/\./g, '').replace(',', '.')
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function normalizeCustomerFormPayload(form: FormState) {
  const customerCode = form.customerCode.trim()
  const name = form.name.trim()
  const customerType = form.customerType.trim()
  const invoiceType = form.invoiceType.trim()

  const phone = form.phone.trim()

  const discountRate = parseDecimalInput(form.discountRate) ?? 0
  const isSube = String(customerType ?? '').trim().toLocaleLowerCase('tr-TR') === 'şube' ||
    String(customerType ?? '').trim().toLocaleLowerCase('tr-TR') === 'sube'
  // PARA BİRİMİ BAŞINA AYRI LİMİT (2026-08-19). Dolarlı satış yalnızca dolar limitine,
  // euro satış euro limitine yürür; hiçbir yerde kura bölünüp TL limitine yazılmaz.
  const creditLimit = isSube ? 0 : (parseDecimalInput(form.creditLimit) ?? 0)
  const creditLimitUsd = isSube ? 0 : (parseDecimalInput(form.creditLimitUsd) ?? 0)
  const creditLimitEur = isSube ? 0 : (parseDecimalInput(form.creditLimitEur) ?? 0)
  const creditLimitGbp = isSube ? 0 : (parseDecimalInput(form.creditLimitGbp) ?? 0)
  // Cari artık para birimi TAŞIMAZ (2026-08-17): kart alanı kaldırıldı, kayıt her zaman
  // TL (1) ile gider. Hareketin para birimi belgenin kendi para birimidir.
  const currencyTypeId = 1
  const initialBalance = isSube ? undefined : parseDecimalInput(form.initialBalance)

  return {
    customerCode,
    name,
    address: form.address.trim() || undefined,
    city: form.city.trim() || undefined,
    district: form.district.trim() || undefined,
    phone: phone && phone !== '0' ? phone : undefined,
    fax: form.fax.trim() || undefined,
    email: form.email.trim() || undefined,
    taxOffice: form.taxOffice.trim() || undefined,
    taxNumber: form.taxNumber.trim() || undefined,
    identityNumber: form.identityNumber.trim() || undefined,
    customerType,
    invoiceType,
    productCategory: form.productCategory.trim() || undefined,
    categoryAccessMode: form.categoryAccessMode === 'All' ? 'All' : 'Custom',
    productCategoryIds: form.categoryAccessMode === 'All' ? [] : form.productCategoryIds,
    isActive: Boolean(form.isActive),
    priceGroupId: form.priceGroupId.trim() || undefined,
    discountRate,
    salesmanCode: form.salesmanCode.trim() || undefined,
    creditLimit,
    creditLimitUsd,
    creditLimitEur,
    creditLimitGbp,
    parentCustomerCode: form.parentCustomerCode.trim() || undefined,
    currencyTypeId,
    initialBalance: initialBalance ?? undefined
  }
}

function customerToFormState(row: Customer): FormState {
  const normalizeCustomerType = (v: string | null | undefined) => {
    const s = String(v ?? '').trim()
    if (!s) return ''
    const k = s.toLocaleLowerCase('tr-TR')
    if (k === 'müşteri' || k === 'musteri') return 'Müşteri'
    if (k === 'bayi') return 'Bayi'
    if (k === 'alt bayi' || k === 'altbayi') return 'Alt Bayi'
    if (k === 'çalışan' || k === 'calisan') return 'Çalışan'
    if (k === 'şube' || k === 'sube') return 'Şube'
    if (k === 'parekende' || k === 'perakende') return 'Parekende'
    if (k === 'mağaza' || k === 'magaza') return 'Mağaza'
    if (k === 'hizmet') return 'Hizmet'
    return s
  }

  const rawAccessMode = (row as any).categoryAccessMode
  const isAllMode = rawAccessMode === 'All' || rawAccessMode === 1 || rawAccessMode === null || rawAccessMode === undefined

  return {
    customerCode: row.customerCode ?? '',
    name: row.name ?? '',
    address: row.address ?? '',
    city: row.city ?? '',
    district: row.district ?? '',
    phone: row.phone ?? '',
    fax: row.fax ?? '',
    email: row.email ?? '',
    taxOffice: row.taxOffice ?? '',
    taxNumber: row.taxNumber ?? '',
    identityNumber: row.identityNumber ?? '',
    customerType: normalizeCustomerType(row.customerType),
    invoiceType: row.invoiceType ?? 'FATURA',
    productCategory: row.productCategory ?? '',
    categoryAccessMode: isAllMode ? 'All' : 'Custom',
    productCategoryIds: isAllMode ? [] : ((row as any).productCategoryIds ?? []),
    isActive: Boolean(row.isActive),
    priceGroupId: row.priceGroupId ?? '',
    discountRate: String(row.discountRate ?? 0),
    salesmanCode: row.salesmanCode ?? '',
    creditLimit: String(row.creditLimit ?? 0),
    creditLimitUsd: String(row.creditLimitUsd ?? 0),
    creditLimitEur: String(row.creditLimitEur ?? 0),
    creditLimitGbp: String(row.creditLimitGbp ?? 0),
    parentCustomerCode: row.parentCustomerCode ?? '',
    currencyTypeId: String(row.currencyTypeId ?? 1),
    initialBalance: ''
  }
}

function buildValidationErrorMessage(json: ApiValidationError) {
  const parts: string[] = []
  if (json.detail) parts.push(json.detail)
  if (json.errors) {
    for (const [field, messages] of Object.entries(json.errors)) {
      const label = validationFieldLabels[field] ?? field
      for (const m of messages ?? []) {
        parts.push(`${label}: ${m}`)
      }
    }
  }
  return parts.length ? parts.join('\n') : 'Bir hata oluştu'
}

export default function CariEklePage() {
  /*
    KALAN LIMIT (2026-08-24, kullanici istegi: "burada limit var ama kalan limiti de koy").

    Kalan limit basit bir cikarma DEGIL: cari hareketlerinin borc/alacagi, portfoydeki
    bekleyen cekler ve alt hesaplarin ana hesaba toplanmasi hesaba giriyor; ustelik her para
    birimi kendi limitine yuruyor. Bu hesap Limit Risk Raporu ucunda yasiyor ve BURAYA
    KOPYALANMIYOR — kopya kural, zamanla asil kuraldan ayrisiyor.

    Bu sutun TL satirini gosterir; sayfadaki "Limit" sutunu da TL limitidir.

    Yetki: rapor ucu `reports/limitRiskSatisRaporu` yetkisi istiyor. Yetkisi olmayan
    kullanicida istek 403 doner; sutun sessizce "-" gosterir. Yetki KAPISI ZORLANMAZ.
  */
  const [kalanLimitByCode, setKalanLimitByCode] = useState<Record<string, number>>({})
  const [kalanLimitDurum, setKalanLimitDurum] = useState<'yukleniyor' | 'hazir' | 'yok'>('yukleniyor')

  useEffect(() => {
    const ac = new AbortController()

    void (async () => {
      try {
        const rapor = await fetchLimitRiskReport(ac.signal)
        if (ac.signal.aborted) return

        const harita: Record<string, number> = {}
        for (const satir of rapor.items ?? []) {
          // Yalnizca TL satiri (paraBirimi 1). Alan bos gelirse TL sayilir.
          const cur = Number(satir?.paraBirimi ?? 1)
          if (cur !== 1) continue
          const kod = String(satir?.cariKodu ?? '').trim()
          if (!kod) continue
          harita[kod.toUpperCase()] = Number(satir?.kalanLimit ?? 0)
        }

        setKalanLimitByCode(harita)
        setKalanLimitDurum('hazir')
      } catch {
        if (ac.signal.aborted) return
        setKalanLimitByCode({})
        setKalanLimitDurum('yok')
      }
    })()

    return () => ac.abort()
  }, [])
  const emptyForm: FormState = {
    customerCode: '',
    name: '',
    address: '',
    city: '',
    district: '',
    phone: '0',
    fax: '',
    email: '',
    taxOffice: '',
    taxNumber: '',
    identityNumber: '',
    customerType: '',
    invoiceType: 'FATURA',
    productCategory: '',
    categoryAccessMode: 'All',
    productCategoryIds: [],
    isActive: true,
    priceGroupId: '',
    discountRate: '0',
    salesmanCode: '',
    creditLimit: '300000',
    creditLimitUsd: '0',
    creditLimitEur: '0',
    creditLimitGbp: '0',
    parentCustomerCode: '',
    currencyTypeId: '1',
    initialBalance: ''
  }

  const [items, setItems] = useState<Customer[]>([])

  const [priceGroups, setPriceGroups] = useState<PriceGroup[]>([])
  const [productCategories, setProductCategories] = useState<ProductCategory[]>([])
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false)

  const [salesmanOptions, setSalesmanOptions] = useState<SalesmanOption[]>([])

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [popupOpen, setPopupOpen] = useState(false)
  const [popupTitle, setPopupTitle] = useState<string>('')
  const [popupMessage, setPopupMessage] = useState<string>('')
  const [popupVariant, setPopupVariant] = useState<NotificationVariant>('info')

  const excelFileInputRef = useRef<HTMLInputElement | null>(null)
  const [excelImportOpen, setExcelImportOpen] = useState(false)
  const [excelImportBusy, setExcelImportBusy] = useState(false)
  const [excelImportResult, setExcelImportResult] = useState<ExcelImportResult | null>(null)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmTitle, setConfirmTitle] = useState('')
  const [confirmMessage, setConfirmMessage] = useState('')
  const [confirmCustomerCode, setConfirmCustomerCode] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<'toggle' | 'delete'>('toggle')

  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authLoading, setAuthLoading] = useState(false)
  const [authSaving, setAuthSaving] = useState(false)
  const [authCustomerCode, setAuthCustomerCode] = useState<string | null>(null)
  const [authForm, setAuthForm] = useState<AuthorizedContactFormState>({ fullName: '', phone: '0' })
  const [authModalError, setAuthModalError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [form, setForm] = useState<FormState>(emptyForm)
  const [modalOpen, setModalOpen] = useState(false)
  const [editCode, setEditCode] = useState<string | null>(null)
  const [initialEditSnapshot, setInitialEditSnapshot] = useState<string | null>(null)

  const [citySearch, setCitySearch] = useState('')
  const [cityDropdownOpen, setCityDropdownOpen] = useState(false)
  const [districtSearch, setDistrictSearch] = useState('')
  const [districtDropdownOpen, setDistrictDropdownOpen] = useState(false)

  const [parentSearch, setParentSearch] = useState('')
  const [parentDropdownOpen, setParentDropdownOpen] = useState(false)
  const parentDropdownRef = useRef<HTMLDivElement | null>(null)

  const cityRef = useRef<HTMLDivElement | null>(null)
  const districtRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (cityRef.current && !cityRef.current.contains(e.target as Node)) {
        setCityDropdownOpen(false)
      }
      if (districtRef.current && !districtRef.current.contains(e.target as Node)) {
        setDistrictDropdownOpen(false)
      }
      if (parentDropdownRef.current && !parentDropdownRef.current.contains(e.target as Node)) {
        setParentDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
    }
  }, [])

  const priceGroupById = useMemo(() => new Map(priceGroups.map((x) => [String(x.id), x])), [priceGroups])

  const normalizeInvoiceType = (v: any) => {
    const s = String(v ?? '').trim().toUpperCase()
    if (s === 'ASKERIYE') return 'ASKERIYE'
    if (s === 'ACIK') return 'ACIK'
    if (s === 'FATURA') return 'FATURA'
    return ''
  }

  const selectedPriceGroupInvoiceType = useMemo(() => {
    const pg = priceGroupById.get(String(form.priceGroupId || ''))
    if (!pg) return null
    if (pg.code === 7 || String(pg.invoiceType ?? '').trim().toUpperCase() === 'ASKERIYE') return 'ASKERIYE'
    const inv = normalizeInvoiceType(pg?.invoiceType)
    return inv || null
  }, [form.priceGroupId, priceGroupById])

  useEffect(() => {
    if (!selectedPriceGroupInvoiceType) return
    setForm((p) => {
      if (p.invoiceType === selectedPriceGroupInvoiceType) return p
      return { ...p, invoiceType: selectedPriceGroupInvoiceType }
    })
  }, [selectedPriceGroupInvoiceType])

  const categoryById = useMemo(() => new Map(productCategories.map((x) => [x.id, x])), [productCategories])
  const categoryChildrenByParent = useMemo(() => {
    const m = new Map<string, ProductCategory[]>()
    for (const c of productCategories) {
      if (!c.parentId) continue
      const key = String(c.parentId)
      const list = m.get(key) ?? []
      list.push(c)
      m.set(key, list)
    }
    for (const [k, list] of m) {
      m.set(
        k,
        [...list].sort((a, b) => String(a.name).localeCompare(String(b.name)))
      )
    }
    return m
  }, [productCategories])

  const mainCategories = useMemo(
    () => [...productCategories].filter((x) => !x.parentId).sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [productCategories]
  )

  const allCategoryIds = useMemo(() => productCategories.map((x) => x.id), [productCategories])
  const allCategoriesSelected = useMemo(() => {
    return form.categoryAccessMode === 'All'
  }, [form.categoryAccessMode])

  const selectedCategoryNames = useMemo(() => {
    if (form.categoryAccessMode === 'All') return 'Hepsi seçili'
    if (!form.productCategoryIds.length) return 'Hiçbiri (Erişim Yok)'
    return form.productCategoryIds
      .map((id) => categoryById.get(id)?.name)
      .filter(Boolean)
      .join(', ')
  }, [categoryById, form.categoryAccessMode, form.productCategoryIds])

  const toggleMainCategory = (mainId: string, checked: boolean) => {
    setForm((p) => {
      const baseIds = p.categoryAccessMode === 'All' ? allCategoryIds : p.productCategoryIds
      const next = new Set(baseIds)
      const subs = categoryChildrenByParent.get(mainId) ?? []

      if (checked) {
        next.add(mainId)
        for (const s of subs) next.add(s.id)
      } else {
        next.delete(mainId)
        for (const s of subs) next.delete(s.id)
      }

      return { ...p, categoryAccessMode: 'Custom', productCategoryIds: Array.from(next) }
    })
  }

  const toggleSubCategory = (subId: string, checked: boolean) => {
    setForm((p) => {
      const baseIds = p.categoryAccessMode === 'All' ? allCategoryIds : p.productCategoryIds
      const next = new Set(baseIds)
      const sub = categoryById.get(subId)
      const parentId = sub?.parentId ? String(sub.parentId) : null

      if (checked) {
        if (parentId) next.delete(parentId)
        next.add(subId)

        if (parentId) {
          const subs = categoryChildrenByParent.get(parentId) ?? []
          const allSubsSelected = subs.length > 0 && subs.every((s) => next.has(s.id))
          if (allSubsSelected) {
            for (const s of subs) next.delete(s.id)
            next.add(parentId)
          }
        }
      } else {
        next.delete(subId)
      }

      return { ...p, categoryAccessMode: 'Custom', productCategoryIds: Array.from(next) }
    })
  }

  const fetchCustomers = async () => {
    const qs = new URLSearchParams({ includeInactive: 'true' }).toString()
    const res = await fetch(`${API_BASE_URL}/api/customers?${qs}`, {
      headers: { ...buildHeaders(true) }
    })
    if (!res.ok) throw new Error(`Customers fetch failed (${res.status})`)
    const json = await res.json()
    return (json?.data ?? []) as Customer[]
  }


  const fetchPriceGroups = async () => {
    const res = await fetch(`${API_BASE_URL}/api/pricegroups`, {
      headers: { ...buildHeaders(true) }
    })
    if (!res.ok) throw new Error(`PriceGroups fetch failed (${res.status})`)
    const json = await res.json()
    return (json?.data ?? []) as PriceGroup[]
  }

  const fetchProductCategories = async () => {
    const qs = new URLSearchParams({ includeInactive: 'true' }).toString()
    const res = await fetch(`${API_BASE_URL}/api/productcategories/list?${qs}`, {
      headers: { ...buildHeaders(true) }
    })
    if (!res.ok) throw new Error(`ProductCategories fetch failed (${res.status})`)
    const json = await res.json()
    return (json?.data ?? []) as ProductCategory[]
  }

  const [showBayiMuhtelifleri, setShowBayiMuhtelifleri] = useState(false)

  const fetchBayiMuhtelifleri = async () => {
    const list = await fetchBayiMuhtelifCustomersForCariOffers({ take: 500 })
    return (list ?? []).map(
      (x): Customer =>
        ({
          customerCode: String(x.customerCode ?? '').trim(),
          name: String(x.name ?? '').trim(),
          address: x.address ?? null,
          city: x.city ?? null,
          district: x.district ?? null,
          phone: x.phone ?? null,
          fax: null,
          email: x.email ?? null,
          taxOffice: x.taxOffice ?? null,
          taxNumber: x.taxNumber ?? null,
          identityNumber: null,
          customerType: 'Bayi Muhtelif',
          invoiceType: 'FATURA',
          productCategory: null,
          isActive: true,
          priceGroupId: null,
          discountRate: 0,
          salesmanCode: null,
          creditLimit: 0,
          creditLimitUsd: 0,
          creditLimitEur: 0,
          creditLimitGbp: 0,
          parentCustomerCode: null,
          currencyTypeId: 1,
          productCategoryIds: []
        }) as any
    )
  }

  const reload = async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      setError(null)
      const data = showBayiMuhtelifleri ? await fetchBayiMuhtelifleri() : await fetchCustomers()
      setItems(data)
    } catch (e: any) {
      setError(String(e?.message ?? 'Bir hata oluştu'))
      setItems([])
    } finally {
      if (!silent) setLoading(false)
    }
  }

  const showPopup = (variant: NotificationVariant, title: string, message: string) => {
    setPopupVariant(variant)
    setPopupTitle(title)
    setPopupMessage(message)
    setPopupOpen(true)
  }

  const downloadExcel = async (url: string, filename: string) => {
    const res = await fetch(url, { headers: { ...buildHeaders(false) } })
    if (!res.ok) throw new Error(`Excel indirilemedi (${res.status})`)
    const blob = await res.blob()
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(href)
  }

  const startExcelImport = async (file: File) => {
    try {
      setExcelImportBusy(true)
      setExcelImportResult(null)

      const fd = new FormData()
      fd.append('file', file)

      const res = await fetch(`${API_BASE_URL}/api/customers/excel-import`, {
        method: 'POST',
        headers: { ...buildHeaders(false) },
        body: fd
      })

      const json = await res.json().catch(() => null)
      if (!res.ok) {
        const msg = String(json?.message ?? json?.error ?? `Import başarısız (${res.status})`)
        throw new Error(msg)
      }

      const data = (json?.data ?? null) as ExcelImportResult | null
      setExcelImportResult(data)
      setExcelImportOpen(true)
      await reload()

      const okCount = Number(data?.successCount ?? 0)
      const errCount = Number(data?.rowErrors?.length ?? 0)
      showPopup('success', 'Import Tamamlandı', `Başarılı: ${okCount}\nHatalı: ${errCount}`)
    } catch (e: any) {
      showPopup('error', 'Import Hatası', String(e?.message ?? 'Bir hata oluştu'))
    } finally {
      setExcelImportBusy(false)
      if (excelFileInputRef.current) excelFileInputRef.current.value = ''
    }
  }

  useEffect(() => {
    void (async () => {
      /*
        ÜÇ LİSTE BAĞIMSIZ YÜKLENİR (2026-08-26, kullanıcı: "müşterinin fiyat grubu
        güncellenmiyor, seçilmiyor").

        Eski hâl: üç istek PEŞ PEŞE bekleniyor ve üç `setState` de HEPSİ bittikten sonra
        çalışıyordu. Biri patlayınca `catch`'e düşülüyor ve ÜÇÜ BİRDEN boş kalıyordu —
        ekranda Fiyat Grubu, Salesman ve Ürün Kategorisi açılır listeleri "Seçiniz..."
        dışında hiçbir seçenek göstermiyor, kullanıcı da "seçilmiyor" diye yaşıyordu.
        Hata mesajı hangi listenin düştüğünü de söylemiyordu.

        Yeni hâl: `allSettled` ile üçü PARALEL gider (daha hızlı) ve her biri kendi başına
        yazılır. Biri patlarsa yalnızca o liste boş kalır, diğer ikisi çalışmaya devam eder;
        mesaj da hangisinin düştüğünü söyler.
      */
      const [pgR, pcR, smR] = await Promise.allSettled([
        fetchPriceGroups(),
        fetchProductCategories(),
        fetchSalesmenDropdown()
      ])

      const dusenler: string[] = []

      if (pgR.status === 'fulfilled') setPriceGroups(pgR.value)
      else dusenler.push('Fiyat Grupları')

      if (pcR.status === 'fulfilled') setProductCategories(pcR.value)
      else dusenler.push('Ürün Kategorileri')

      if (smR.status === 'fulfilled') {
        setSalesmanOptions(
          (smR.value ?? [])
            .map((x) => ({ value: String(x.salesmanCode ?? '').trim(), label: `${x.salesmanCode} - ${x.description}` }))
            .filter((x) => x.value.length > 0)
            .sort((a, b) => a.label.localeCompare(b.label, 'tr'))
        )
      } else dusenler.push('Plasiyerler')

      if (dusenler.length > 0) {
        const ilkHata =
          (pgR.status === 'rejected' && pgR.reason) ||
          (pcR.status === 'rejected' && pcR.reason) ||
          (smR.status === 'rejected' && smR.reason)
        setError(`${dusenler.join(', ')} yüklenemedi: ${(ilkHata as any)?.message ?? 'bilinmeyen hata'}`)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBayiMuhtelifleri])

  useEffect(() => {
    if (!modalOpen) return
    if (editCode) return
    const type = String(form.customerType ?? '').trim()
    if (!type) {
      setForm((p) => ({ ...p, customerCode: '' }))
      return
    }

    const normalizedType = type.toLocaleLowerCase('tr-TR')
    const isBranch = normalizedType === 'şube' || normalizedType === 'sube'
    const isAltBayi = normalizedType === 'alt bayi' || normalizedType === 'altbayi'
    const parentCode = String(form.parentCustomerCode ?? '').trim()
    if ((isBranch || isAltBayi) && !parentCode) {
      setForm((p) => ({ ...p, customerCode: '' }))
      return
    }

    const ac = new AbortController()
    void (async () => {
      try {
        const code = await fetchNextCustomerCode(type, { parentCustomerCode: isBranch ? parentCode : undefined, signal: ac.signal })
        setForm((p) => ({ ...p, customerCode: code }))
      } catch {
      }
    })()
    return () => ac.abort()
  }, [editCode, form.customerType, form.parentCustomerCode, modalOpen])

  useEffect(() => {
    if (!modalOpen) return
    const t = String(form.customerType ?? '').trim().toLocaleLowerCase('tr-TR')
    const requiresParent = t === 'şube' || t === 'sube' || t === 'alt bayi' || t === 'altbayi'
    if (!requiresParent && form.parentCustomerCode) {
      setForm((p) => ({ ...p, parentCustomerCode: '' }))
    }
  }, [form.customerType, form.parentCustomerCode, modalOpen])

  const isBranchForm = useMemo(() => {
    const t = String(form.customerType ?? '').trim().toLocaleLowerCase('tr-TR')
    return t === 'şube' || t === 'sube'
  }, [form.customerType])

  /**
   * ŞUBENİN FİYATI BAĞLI CARİDEN GELİR.
   *
   * Karar backend'de veriliyor (CustomersController.ResolveBranchPriceGroupIdAsync); buradaki
   * doldurma yalnızca alanın GÖRÜNÜR olması için. Fatura/Açık zaten fiyat grubunun tipinden
   * türediği için ikisi de kilitli: form serbest bırakıldığında şube ana cariden farklı bir
   * gruba düşüyor ve sepet aynı ürüne başka tutar yazıyordu.
   */
  useEffect(() => {
    if (!modalOpen) return
    if (!isBranchForm) return

    const parentCode = String(form.parentCustomerCode ?? '').trim()
    if (!parentCode) return

    const parent = items.find((x) => String(x.customerCode ?? '').trim() === parentCode)
    const parentPriceGroupId = String(parent?.priceGroupId ?? '').trim()
    if (!parentPriceGroupId) return

    setForm((p) => (p.priceGroupId === parentPriceGroupId ? p : { ...p, priceGroupId: parentPriceGroupId }))
  }, [form.parentCustomerCode, isBranchForm, items, modalOpen])

  const parentOptions = useMemo(() => {
    const t = String(form.customerType ?? '').trim().toLocaleLowerCase('tr-TR')
    const isBranchOrAlt = t === 'şube' || t === 'sube' || t === 'alt bayi' || t === 'altbayi'

    const filtered = isBranchOrAlt
      ? items.filter((x) => {
        const ct = String(x.customerType ?? '').trim().toLocaleLowerCase('tr-TR')
        const isDealer = ct === 'bayi'
        const code = String(x.customerCode ?? '').trim()
        const is120 = code.startsWith('120')
        return isDealer && is120
      })
      : items

    return [...filtered]
      .sort((a, b) => String(a.customerCode).localeCompare(String(b.customerCode)))
      .map((x) => ({ value: x.customerCode, label: `[${x.customerCode}] ${x.name}` }))
  }, [form.customerType, items])

  /*
    CARİ KARTINDA E-TİCARET SİPARİŞLERİ (2026-09-09 kullanıcı isteği).

    E-ticaretten üye olan müşterinin carisi 120-11- ile açılıyor ama kartında internetten
    kaç sipariş verdiğine dair hiçbir iz yoktu; bayinin bunu görmesi için ayrı bir ekrana
    gidip cari kodunu araması gerekiyordu.

    Liste YALNIZCA e-ticaret carilerinde ve YALNIZCA kart açıkken çekiliyor: bayi carileri
    için hem anlamsız hem de her kart açılışında gereksiz bir istek olurdu.
  */
  const [shopOrders, setShopOrders] = useState<{
    orderNo: string
    processedAt: string
    grandTotal: number
    lineCount: number
    montageCount: number
    isPaid: boolean
    isCancelled: boolean
    invoiceNo?: string | null
  }[]>([])
  const [shopOrdersLoading, setShopOrdersLoading] = useState(false)

  const isShopCustomer = String(editCode ?? '').trim().startsWith('120-11-')

  useEffect(() => {
    if (!modalOpen || !isShopCustomer || !editCode) {
      setShopOrders([])
      return
    }

    let cancelled = false
    setShopOrdersLoading(true)

    void (async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/ecommerce/panel/customer-orders/${encodeURIComponent(editCode)}`,
          { headers: { ...buildHeaders(false) } }
        )
        if (!res.ok) throw new Error()
        const body = await res.json()
        if (!cancelled) setShopOrders(Array.isArray(body?.data) ? body.data : [])
      } catch {
        // Sipariş listesi alınamadıysa kartın geri kalanı çalışmaya devam etmeli:
        // cari düzenlemeyi bir listenin hatasına bağlamak yanlış olurdu.
        if (!cancelled) setShopOrders([])
      } finally {
        if (!cancelled) setShopOrdersLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [modalOpen, isShopCustomer, editCode])

  const salesmanLabelByCode = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of salesmanOptions) {
      const code = String(o.value ?? '').trim()
      if (!code) continue
      m.set(code, String(o.label ?? code))
    }
    return m
  }, [salesmanOptions])

  const columns: TableColumn<CustomerRow>[] = useMemo(
    () => [
      {
        key: 'customerType',
        label: 'Cari Tipi',
        searchable: true,
        filter: {
          type: 'select',
          options: [
            { label: 'Müşteri', value: 'Müşteri' },
            { label: 'Bayi', value: 'Bayi' },
            { label: 'Alt Bayi', value: 'Alt Bayi' },
            { label: 'Çalışan', value: 'Çalışan' },
            { label: 'Şube', value: 'Şube' },
            { label: 'Parekende', value: 'Parekende' },
            { label: 'Mağaza', value: 'Mağaza' },
            { label: 'Hizmet', value: 'Hizmet' }
          ]
        }
      },
      { key: 'customerCode', label: 'Cari Kodu', searchable: true },
      { key: 'name', label: 'Cari Adı', searchable: true },
      {
        /*
          CARİ NEREDEN AÇILDI (2026-09-09 kullanıcı isteği).

          E-ticaretten üye olan müşterinin carisi 120-11- ile açılıyor ve listede diğer
          carilerden hiçbir farkı yoktu: "internetten mi geldi, biz mi açtık" sorusunun
          cevabı ancak kod tek tek okunarak bulunuyordu.

          Ayrım KOD ÖNEKİNDEN, ayrı bir bayrak kolonundan değil: önek zaten sistemin her
          yerinde bu anlamda kullanılıyor (sipariş ucu 120-11- dışına sipariş açmıyor),
          ikinci bir kaynak açmak ikisinin ayrışacağı gün demekti.
        */
        key: 'eticaretKaynak',
        label: 'Kaynak',
        sortable: true,
        accessorFn: (r: any) =>
          String(r?.customerCode ?? '').trim().startsWith('120-11-') ? 'E-Ticaret' : 'B2B',
        filter: {
          type: 'select',
          options: [
            { label: 'E-Ticaret', value: 'E-Ticaret' },
            { label: 'B2B', value: 'B2B' }
          ]
        },
        render: (_v: any, r: any) => {
          const isShop = String(r?.customerCode ?? '').trim().startsWith('120-11-')
          return isShop ? (
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 ring-1 ring-blue-200"
              title="Bu cari e-ticaret üyeliğiyle açıldı."
            >
              E-Ticaret
            </span>
          ) : (
            <span className="text-[10px] text-gray-400">B2B</span>
          )
        }
      },
      {
        key: 'creditLimit',
        label: 'Limit',
        searchable: true
      },
      {
        key: 'kalanLimit',
        label: 'Kalan Limit',
        sortable: true,
        accessorFn: (r: any) => {
          const kod = String(r?.customerCode ?? '').trim().toUpperCase()
          const deger = kalanLimitByCode[kod]
          // Raporda satiri olmayan cari: hic hareketi ve hic limiti yok demektir; kalan
          // limit kendi TL limitidir.
          return deger != null ? deger : Number(r?.creditLimit ?? 0)
        },
        render: (_v: any, r: any) => {
          if (kalanLimitDurum === 'yukleniyor') {
            return <span className="text-gray-400 text-xs">Hesaplanıyor...</span>
          }
          if (kalanLimitDurum === 'yok') {
            // Yetki yok ya da rapor alinamadi. Rakam UYDURULMAZ.
            return <span className="text-gray-400 text-xs" title="Kalan limit hesabı alınamadı">-</span>
          }

          const kod = String(r?.customerCode ?? '').trim().toUpperCase()
          const raporDegeri = kalanLimitByCode[kod]
          const deger = raporDegeri != null ? raporDegeri : Number(r?.creditLimit ?? 0)
          const metin = Number(deger).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

          return (
            <span className={'text-xs font-semibold ' + (deger < 0 ? 'text-red-600' : 'text-emerald-600')}>
              {metin}
            </span>
          )
        }
      },
      {
        key: 'salesmanCode',
        label: 'Plasiyer',
        searchable: true,
        filter: { type: 'select', options: salesmanOptions },
        render: (v) => {
          const code = String(v ?? '').trim()
          if (!code) return ''
          return salesmanLabelByCode.get(code) ?? code
        }
      },
      {
        key: 'priceGroupId',
        label: 'Fiyat Grubu',
        searchable: true,
        filter: {
          type: 'select',
          options: priceGroups.map(pg => ({ label: `${pg.code} - ${pg.name}`, value: pg.id }))
        },
        render: (v) => {
          const pg = priceGroupById.get(String(v ?? ''))
          if (!pg) return '-'
          return `${pg.code} - ${pg.name}`
        }
      },
      { key: 'city', label: 'İl', searchable: true },
      { key: 'district', label: 'İlçe', searchable: true },
      { key: 'phone', label: 'Telefon', searchable: true },
      {
        key: 'email',
        label: 'Email',
        searchable: true,
        render: (v) => {
          const str = String(v ?? '').trim()
          if (str.length <= 20) return str
          return `${str.substring(0, 20)}...`
        }
      },
      {
        key: 'address',
        label: 'Adres',
        searchable: true,
        render: (v) => {
          const str = String(v ?? '').trim()
          if (str.length <= 30) return str
          return `${str.substring(0, 30)}...`
        }
      },
      { key: 'taxOffice', label: 'Vergi Dairesi', searchable: true },
      { key: 'taxNumber', label: 'Vergi No', searchable: true },
      {
        key: 'isActive',
        label: 'Durum',
        searchable: true,
        filter: {
          type: 'select',
          options: [
            { label: 'Aktif', value: 'true' },
            { label: 'Pasif', value: 'false' }
          ]
        },
        render: (_v, row) => {
          const active = row.isActive !== false
          return (
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium leading-none ${active ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-rose-100 text-rose-800 border border-rose-200'}`}>
              {active ? 'Aktif' : 'Pasif'}
            </span>
          )
        }
      },
      {
        key: 'actions',
        label: 'İşlemler',
        render: (_v, row) => (
          <div className="flex items-center gap-1.5">
            {showBayiMuhtelifleri ? null : (
              <button
                type="button"
                disabled={saving}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  startEdit(row)
                }}
                className="inline-flex items-center gap-1 h-[24px] px-2 rounded-md text-[10px] font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-100 transition-colors"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                Düzenle
              </button>
            )}
            {showBayiMuhtelifleri ? null : (
              <button
                type="button"
                disabled={saving}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  void (async () => {
                    try {
                      setAuthLoading(true)
                      setAuthCustomerCode(row.customerCode)
                      const data = await fetchCustomerAuthorizedContact(row.customerCode)
                      setAuthForm({
                        fullName: String(data?.fullName ?? ''),
                        phone: String(data?.phone ?? '0') || '0'
                      })
                      setAuthModalOpen(true)
                    } catch (err: any) {
                      const status = Number(err?.status ?? 0)
                      if (status === 404) {
                        setAuthCustomerCode(row.customerCode)
                        setAuthForm({ fullName: '', phone: '0' })
                        setAuthModalOpen(true)
                        return
                      }
                      showPopup('error', 'Hata', String(err?.message ?? 'Bir hata oluştu'))
                    } finally {
                      setAuthLoading(false)
                    }
                  })()
                }}
                className="inline-flex items-center gap-1 h-[24px] px-2 rounded-md text-[10px] font-medium bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-100 transition-colors"
                title="Yetkili Bilgisi"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                Yetkili
              </button>
            )}
            {showBayiMuhtelifleri ? null : (
              <button
                type="button"
                disabled={saving}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const isAct = row.isActive !== false
                  setConfirmTitle(isAct ? 'Pasife Al' : 'Aktif Et')
                  setConfirmMessage(`Cari ${isAct ? 'pasife alınsın mı' : 'aktif edilsin mi'}? (${row.customerCode})`)
                  setConfirmCustomerCode(row.customerCode)
                  setConfirmAction('toggle')
                  setConfirmOpen(true)
                }}
                className={
                  row.isActive !== false
                    ? "inline-flex items-center gap-1 h-[24px] px-2 rounded-md text-[10px] font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 transition-colors"
                    : "inline-flex items-center gap-1 h-[24px] px-2 rounded-md text-[10px] font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-colors"
                }
              >
                {row.isActive !== false ? 'Pasife Al' : 'Aktif Et'}
              </button>
            )}
          </div>
        )
      }
    ],
    [saving, salesmanLabelByCode, showBayiMuhtelifleri, salesmanOptions, priceGroups, priceGroupById]
  )

  const saveAuthorizedContact = async () => {
    if (!authCustomerCode) return

    try {
      setAuthSaving(true)
      setAuthModalError(null)

      const payload: CustomerAuthorizedContactDto = {
        customerCode: authCustomerCode,
        fullName: String(authForm.fullName ?? '').trim(),
        phone: String(authForm.phone ?? '').trim() || undefined
      }

      if (!payload.fullName) {
        setAuthModalError('Yetkili Ad Soyad zorunludur')
        return
      }

      if (payload.phone && !PHONE_PATTERN.test(payload.phone)) {
        setAuthModalError(PHONE_FORMAT_MESSAGE)
        return
      }

      await upsertCustomerAuthorizedContact(payload)
      showPopup('success', 'Başarılı', 'Yetkili bilgisi güncellendi')
      setAuthModalOpen(false)
    } catch (e: any) {
      const raw = String(e?.message ?? '').trim()
      if (raw && (raw.startsWith('{') || raw.startsWith('['))) {
        try {
          const j = JSON.parse(raw) as any
          if (j?.errors && typeof j.errors === 'object') {
            const parts: string[] = []
            for (const [field, messages] of Object.entries(j.errors)) {
              const label = validationFieldLabels[field] ?? field
              for (const m of (messages as any[]) ?? []) {
                parts.push(`${label}: ${String(m)}`)
              }
            }
            if (parts.length) {
              setAuthModalError(parts.join('\n'))
              return
            }
          }
        } catch {
        }
      }
      const msg = raw || String(e?.message ?? 'Bir hata oluştu')
      setAuthModalError(msg)
    } finally {
      setAuthSaving(false)
    }
  }

  const submit = async () => {
    try {
      setSaving(true)
      setError(null)

      const payload = normalizeCustomerFormPayload(form)
      const { customerCode, name, customerType, invoiceType } = payload

      if (!customerCode || !name || !customerType || !invoiceType) {
        showPopup('error', 'Eksik Alan', 'Lütfen zorunlu alanları doldurun (Cari Kodu, Cari Adı, Bayi Tip, Fatura/Açık)')
        return
      }

      const isEdit = Boolean(editCode)
      const currentSnapshot = JSON.stringify(payload)
      if (isEdit) {
        if (initialEditSnapshot && currentSnapshot === initialEditSnapshot) {
          showPopup('info', 'Bilgi', 'Değişiklik yapılmadı')
          return
        }
      }

      const url = isEdit ? `${API_BASE_URL}/api/customers/${encodeURIComponent(editCode as string)}` : `${API_BASE_URL}/api/customers`
      const method = isEdit ? 'PUT' : 'POST'
      const body = isEdit ? JSON.stringify({ ...payload, customerCode: undefined }) : JSON.stringify(payload)

      const res = await fetch(url, {
        method,
        headers: { ...buildHeaders(true) },
        body
      })

      const rawText = await res.text().catch(() => '')
      if (!res.ok) {
        const trimmed = String(rawText ?? '').trim()
        if (trimmed && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
          try {
            const json = JSON.parse(trimmed) as ApiValidationError
            throw new Error(buildValidationErrorMessage(json))
          } catch (err: any) {
            if (err instanceof Error) throw err
          }
        }
        throw new Error(trimmed || `Cari kaydı başarısız (${res.status})`)
      }

      const json = rawText ? (JSON.parse(rawText) as any) : null
      const returned = (json?.data ?? null) as Customer | null

      if (isEdit) {
        if (returned) {
          const updatedForm = customerToFormState(returned)
          setForm(updatedForm)
          setInitialEditSnapshot(JSON.stringify(normalizeCustomerFormPayload(updatedForm)))
          const nextCode = String((returned as any)?.customerCode ?? '').trim()
          if (nextCode && nextCode !== String(editCode ?? '').trim()) {
            setEditCode(nextCode)
          }
        } else {
          setInitialEditSnapshot(currentSnapshot)
        }
        showPopup('success', 'Başarılı', 'Güncellendi')
      } else {
        showPopup('success', 'Başarılı', 'Kaydedildi')
        setForm(emptyForm)
        setEditCode(null)
        setInitialEditSnapshot(null)
      }

      await reload(true)
    } catch (e: any) {
      const msg = String(e?.message ?? 'Bir hata oluştu')
      showPopup('error', 'Hata', msg)
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (row: Customer) => {
    setModalOpen(true)
    setEditCode(row.customerCode)
    const nextForm = customerToFormState(row)
    setForm(nextForm)
    setInitialEditSnapshot(JSON.stringify(normalizeCustomerFormPayload(nextForm)))
  }

  const toggleCustomerActive = async (customerCode: string) => {
    try {
      setSaving(true)
      setError(null)
      const res = await fetch(`${API_BASE_URL}/api/customers/${encodeURIComponent(customerCode)}/toggle-active`, {
        method: 'POST',
        headers: { ...buildHeaders(true) }
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `İşlem başarısız (${res.status})`)
      }
      const json = await res.json().catch(() => null)
      setItems((prev) =>
        prev.map((x) => (x.customerCode === customerCode ? { ...x, isActive: !x.isActive } : x))
      )
      await reload(true)
      showPopup('success', 'Başarılı', json?.message || 'Cari durumu güncellendi')
    } catch (e: any) {
      const msg = String(e?.message ?? 'Bir hata oluştu')
      showPopup('error', 'Hata', msg)
    } finally {
      setSaving(false)
    }
  }

  const deleteCustomer = async (customerCode: string) => {
    try {
      setSaving(true)
      setError(null)
      const res = await fetch(`${API_BASE_URL}/api/customers/${encodeURIComponent(customerCode)}`, {
        method: 'DELETE',
        headers: { ...buildHeaders(true) }
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `İşlem başarısız (${res.status})`)
      }
      const json = await res.json().catch(() => null)
      if (editCode === customerCode) {
        setEditCode(null)
        setForm(emptyForm)
      }
      setItems((prev) => prev.filter((x) => x.customerCode !== customerCode))
      await reload(true)
      showPopup('success', 'Başarılı', json?.message || 'Cari silindi')
    } catch (e: any) {
      const msg = String(e?.message ?? 'Bir hata oluştu')
      showPopup('error', 'Hata', msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Modal
        isOpen={excelImportOpen}
        onClose={() => {
          if (excelImportBusy) return
          setExcelImportOpen(false)
        }}
        title="Excel Import Sonucu"
        containerClassName="max-w-3xl"
        footer={
          <button
            type="button"
            disabled={excelImportBusy}
            onClick={() => setExcelImportOpen(false)}
            className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition disabled:opacity-60"
          >
            Kapat
          </button>
        }
      >
        <div className="space-y-3">
          <div className="text-sm font-semibold text-gray-800">Başarılı kayıt: {Number(excelImportResult?.successCount ?? 0)}</div>

          {(excelImportResult?.rowErrors?.length ?? 0) === 0 ? (
            <div className="text-sm text-emerald-700 font-semibold">Hata yok</div>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-3 py-2 text-xs font-bold bg-gray-50 text-gray-700">Hatalı Satırlar</div>
              <div className="max-h-[360px] overflow-auto">
                {(excelImportResult?.rowErrors ?? []).map((e, idx) => (
                  <div key={`${e.rowNumber}-${idx}`} className="px-3 py-2 border-t border-gray-200">
                    <div className="text-xs font-bold text-gray-900">
                      Satır: {e.rowNumber}
                      {e.customerCode ? ` | Cari: ${e.customerCode}` : ''}
                    </div>
                    <div className="mt-1 text-xs text-rose-700 whitespace-pre-line">{(e.errors ?? []).join('\n')}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={authModalOpen}
        onClose={() => {
          if (authSaving) return
          setAuthModalOpen(false)
          setAuthCustomerCode(null)
          setAuthForm({ fullName: '', phone: '0' })
          setAuthModalError(null)
        }}
        title={authCustomerCode ? `Yetkili Bilgisi - ${authCustomerCode}` : 'Yetkili Bilgisi'}
        footer={
          <>
            <button
              type="button"
              disabled={authSaving}
              onClick={() => {
                setAuthModalOpen(false)
                setAuthCustomerCode(null)
                setAuthForm({ fullName: '', phone: '0' })
              }}
              className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition disabled:opacity-60"
            >
              Kapat
            </button>
            <button
              type="button"
              disabled={authSaving || !authCustomerCode}
              onClick={() => void saveAuthorizedContact()}
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-60"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
              {authSaving ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </>
        }
      >
        {authModalError && <div className="mb-3 text-xs font-semibold text-red-600 whitespace-pre-line">{authModalError}</div>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Yetkili Ad Soyad *</div>
            <input
              value={authForm.fullName}
              onChange={(e) => setAuthForm((p) => ({ ...p, fullName: e.target.value }))}
              className="input-base h-9 text-sm"
              placeholder="Ali Yılmaz"
            />
          </div>
          <div className="space-y-1">
            <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Telefon</div>
            <input
              inputMode="numeric"
              value={authForm.phone}
              onChange={(e) => {
                const formatted = formatPhoneNumber(e.target.value)
                setAuthForm((p) => ({ ...p, phone: formatted }))
              }}
              className="input-base h-9 text-sm"
              placeholder="0555 555 5555 555"
            />
          </div>
          {authLoading && <div className="md:col-span-2 text-xs text-gray-500">Yükleniyor...</div>}
        </div>
      </Modal>

      <Modal
        isOpen={confirmOpen}
        onClose={() => {
          if (saving) return
          setConfirmOpen(false)
          setConfirmCustomerCode(null)
        }}
        title={confirmTitle || 'Onay'}
        footer={
          <>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setConfirmOpen(false)
                setConfirmCustomerCode(null)
              }}
              className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition disabled:opacity-60"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={saving || !confirmCustomerCode}
              onClick={() => {
                if (!confirmCustomerCode) return
                setConfirmOpen(false)
                if (confirmAction === 'delete') {
                  void deleteCustomer(confirmCustomerCode)
                } else {
                  void toggleCustomerActive(confirmCustomerCode)
                }
                setConfirmCustomerCode(null)
              }}
              className={`h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg text-white shadow-sm transition disabled:opacity-60 ${
                confirmAction === 'delete'
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              {confirmAction === 'delete' ? 'Evet, Sil' : 'Evet, Değiştir'}
            </button>
          </>
        }
      >
        <div className="text-sm text-gray-700 whitespace-pre-line">{confirmMessage}</div>
      </Modal>

      <NotificationPopup
        isOpen={popupOpen}
        title={popupTitle}
        message={popupMessage}
        variant={popupVariant}
        onClose={() => setPopupOpen(false)}
      />
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Cari Yönetimi</h1>
          <p className="text-xs text-gray-400 mt-0.5">Tanımlar / Cari Ekle & Düzenle</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={excelFileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (!f) return
              void startExcelImport(f)
            }}
          />

          <button
            type="button"
            disabled={saving || loading || showBayiMuhtelifleri}
            onClick={() => {
              void (async () => {
                try {
                  await downloadExcel(`${API_BASE_URL}/api/customers/excel-template`, 'cari-template.xlsx')
                } catch (e: any) {
                  showPopup('error', 'Hata', String(e?.message ?? 'Bir hata oluştu'))
                }
              })()
            }}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-white text-gray-800 border border-gray-200 hover:bg-gray-50 shadow-sm transition disabled:opacity-60"
          >
            Template
          </button>

          <button
            type="button"
            disabled={saving || loading || showBayiMuhtelifleri}
            onClick={() => {
              void (async () => {
                try {
                  await downloadExcel(`${API_BASE_URL}/api/customers/excel-export`, 'cariler.xlsx')
                } catch (e: any) {
                  showPopup('error', 'Hata', String(e?.message ?? 'Bir hata oluştu'))
                }
              })()
            }}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-white text-gray-800 border border-gray-200 hover:bg-gray-50 shadow-sm transition disabled:opacity-60"
          >
            Export
          </button>

          <button
            type="button"
            disabled={excelImportBusy || saving || loading || showBayiMuhtelifleri}
            onClick={() => excelFileInputRef.current?.click()}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white shadow-sm transition disabled:opacity-60"
          >
            {excelImportBusy ? 'Import...' : 'Import'}
          </button>

          <button
            type="button"
            onClick={() => setShowBayiMuhtelifleri((p) => !p)}
            className={
              'h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg border shadow-sm transition ' +
              (showBayiMuhtelifleri ? 'bg-gray-900 text-white border-gray-900 hover:bg-black' : 'bg-white text-gray-800 border-gray-200 hover:bg-gray-50')
            }
          >
            Bayi Muhtelifleri
          </button>
          <button
            type="button"
            disabled={showBayiMuhtelifleri}
            onClick={() => {
              setEditCode(null)
              setForm(emptyForm)
              setModalOpen(true)
            }}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-60"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Yeni Cari
          </button>
        </div>
      </div>

      {/*
        PAYLASILAN `Modal` KULLANILIYOR (2026-08-24, kullanici: "her modalda olan surukleme
        ve buyutme ozelligi cari ekle sayfasinda yok").

        Bu pencere elle yazilmis kapsayici isaretlemeyle duruyordu; basliktan tutup tasima ve
        sag alt koseden boyutlandirma paylasilan bilesende yasadigi icin burada HIC yoktu.
        Isaretleme kaldirildi, ayni govde bilesene tasindi.

        `sizeKey` sabit: baslik kayda gore degisiyor (`Cari Guncelle - 120-01-000865`), ve
        bilesen olcuyu varsayilan olarak BASLIGA gore hatirliyor. Sabit anahtar verilmezse
        her cari icin ayri bir olcu tutulurdu.
      */}
      <Modal
        isOpen={modalOpen}
        onClose={() => {
          if (saving) return
          setModalOpen(false)
        }}
        title={editCode ? `Cari Güncelle - ${editCode}` : 'Yeni Cari'}
        sizeKey="cariEkleForm"
        containerClassName="max-w-5xl"
        scrollable
        footer={
          <>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setForm(emptyForm)
                  setEditCode(null)
                }}
                className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition disabled:opacity-60"
              >
                Temizle
              </button>
              {editCode && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    if (!editCode) return
                    setConfirmTitle('Onay')
                    setConfirmMessage(`Cari silinsin mi? (${editCode})`)
                    setConfirmCustomerCode(editCode)
                    setConfirmAction('delete')
                    setConfirmOpen(true)
                  }}
                  className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white shadow-sm transition disabled:opacity-60"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                  Sil
                </button>
              )}
              <button
                type="button"
                disabled={saving}
                onClick={() => void submit()}
                className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-60"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                {saving ? 'Kaydediliyor...' : editCode ? 'Güncelle' : 'Kaydet'}
              </button>
          </>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Tip *</div>
                <div className="flex items-end gap-2">
                  <select
                    value={form.customerType}
                    onChange={(e) => {
                      const nextType = e.target.value
                      setForm((p) => {
                        const updated = { ...p, customerType: nextType }
                        if (!editCode) {
                          if (nextType === 'Müşteri') {
                            updated.creditLimit = '300000'
                          } else {
                            updated.creditLimit = '0'
                          }
                        }
                        return updated
                      })
                    }}
                    className="input-base h-9 text-sm flex-1"
                  >
                    <option value="">Seçiniz...</option>
                    <option value="Müşteri">Müşteri</option>
                    <option value="Bayi">Bayi</option>
                    <option value="Çalışan">Çalışan</option>
                    <option value="Şube">Şube</option>
                    <option value="Mağaza">Mağaza</option>
                    <option value="Hizmet">Hizmet</option>
                  </select>

                  {(String(form.customerType ?? '').trim().toLocaleLowerCase('tr-TR') === 'şube' ||
                    String(form.customerType ?? '').trim().toLocaleLowerCase('tr-TR') === 'sube') && (
                      <div className="relative flex-1" ref={parentDropdownRef}>
                        <button
                          type="button"
                          onClick={() => {
                            setParentDropdownOpen((p) => !p)
                            setParentSearch('')
                          }}
                          className="input-base h-9 text-sm flex items-center justify-between bg-white w-full text-left font-medium"
                        >
                          <span className="truncate">
                            {(() => {
                              const found = parentOptions.find((o) => o.value === form.parentCustomerCode)
                              return found ? found.label : 'Bağlı Cari'
                            })()}
                          </span>
                          <span className="text-gray-400">▼</span>
                        </button>
                        {parentDropdownOpen && (
                          <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl p-2 max-h-60 overflow-y-auto w-72">
                            <input
                              type="text"
                              className="input-base h-8 text-xs mb-1 w-full bg-gray-50 px-2"
                              placeholder="Cari ara..."
                              value={parentSearch}
                              onChange={(e) => setParentSearch(e.target.value)}
                              autoFocus
                            />
                            <div className="space-y-0.5 mt-1">
                              <div
                                role="button"
                                onClick={() => {
                                  setForm((p) => ({ ...p, parentCustomerCode: '' }))
                                  setParentDropdownOpen(false)
                                }}
                                className="px-2 py-1.5 text-xs text-gray-500 rounded hover:bg-gray-50 cursor-pointer"
                              >
                                Temizle
                              </div>
                              {parentOptions
                                .filter((o) => {
                                  const query = parentSearch.trim().toLocaleLowerCase('tr-TR')
                                  if (!query) return true
                                  return o.label.toLocaleLowerCase('tr-TR').includes(query) || o.value.toLocaleLowerCase('tr-TR').includes(query)
                                })
                                .map((o) => (
                                  <div
                                    key={o.value}
                                    role="button"
                                    onClick={() => {
                                      setForm((p) => ({ ...p, parentCustomerCode: o.value }))
                                      setParentDropdownOpen(false)
                                    }}
                                    className={`px-2 py-1.5 text-xs rounded hover:bg-gray-100 cursor-pointer ${form.parentCustomerCode === o.value ? 'bg-gray-100 font-semibold text-gray-900' : 'text-gray-700'
                                      }`}
                                  >
                                    {o.label}
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Cari Kodu *</div>
                <input
                  value={form.customerCode}
                  disabled={true}
                  onChange={(e) => setForm((p) => ({ ...p, customerCode: e.target.value }))}
                  className="input-base h-9 text-sm"
                  placeholder="Otomatik"
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Cari Adı *</div>
                <input
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value.toLocaleUpperCase('tr-TR') }))}
                  className="input-base h-9 text-sm"
                  placeholder="Ali Yılmaz"
                />
              </div>

              <div className="space-y-1 relative" ref={cityRef}>
                <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">İl</div>
                <button
                  type="button"
                  onClick={() => {
                    setCityDropdownOpen((p) => !p)
                    setCitySearch('')
                  }}
                  className="input-base h-9 text-sm flex items-center justify-between bg-white w-full text-left"
                >
                  <span className="truncate">{form.city || 'Seçiniz...'}</span>
                  <span className="text-gray-400">▼</span>
                </button>
                {cityDropdownOpen && (
                  <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl p-2 max-h-60 overflow-y-auto">
                    <input
                      type="text"
                      className="input-base h-8 text-xs mb-1 w-full bg-gray-50 px-2"
                      placeholder="İl ara..."
                      value={citySearch}
                      onChange={(e) => setCitySearch(e.target.value.toLocaleUpperCase('tr-TR'))}
                      autoFocus
                    />
                    <div className="space-y-0.5 mt-1">
                      <div
                        role="button"
                        onClick={() => {
                          setForm((p) => ({ ...p, city: '' }))
                          setCityDropdownOpen(false)
                        }}
                        className="px-2 py-1.5 text-xs text-gray-500 rounded hover:bg-gray-50 cursor-pointer"
                      >
                        Temizle
                      </div>
                      {CITIES.filter((c) => c.includes(citySearch)).map((c) => (
                        <div
                          key={c}
                          role="button"
                          onClick={() => {
                            setForm((p) => ({ ...p, city: c }))
                            setCityDropdownOpen(false)
                          }}
                          className={`px-2 py-1.5 text-xs rounded hover:bg-gray-100 cursor-pointer ${form.city === c ? 'bg-gray-100 font-semibold text-gray-900' : 'text-gray-700'
                            }`}
                        >
                          {c}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-1 relative" ref={districtRef}>
                <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">İlçe</div>
                <button
                  type="button"
                  onClick={() => {
                    setDistrictDropdownOpen((p) => !p)
                    setDistrictSearch('')
                  }}
                  className="input-base h-9 text-sm flex items-center justify-between bg-white w-full text-left"
                >
                  <span className="truncate">{form.district || 'Seçiniz...'}</span>
                  <span className="text-gray-400">▼</span>
                </button>
                {districtDropdownOpen && (
                  <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl p-2 max-h-60 overflow-y-auto">
                    <input
                      type="text"
                      className="input-base h-8 text-xs mb-1 w-full bg-gray-50 px-2"
                      placeholder="İlçe ara..."
                      value={districtSearch}
                      onChange={(e) => setDistrictSearch(e.target.value.toLocaleUpperCase('tr-TR'))}
                      autoFocus
                    />
                    <div className="space-y-0.5 mt-1">
                      <div
                        role="button"
                        onClick={() => {
                          setForm((p) => ({ ...p, district: '' }))
                          setDistrictDropdownOpen(false)
                        }}
                        className="px-2 py-1.5 text-xs text-gray-500 rounded hover:bg-gray-50 cursor-pointer"
                      >
                        Temizle
                      </div>
                      {DISTRICTS.filter((d) => d.includes(districtSearch)).map((d) => (
                        <div
                          key={d}
                          role="button"
                          onClick={() => {
                            setForm((p) => ({ ...p, district: d }))
                            setDistrictDropdownOpen(false)
                          }}
                          className={`px-2 py-1.5 text-xs rounded hover:bg-gray-100 cursor-pointer ${form.district === d ? 'bg-gray-100 font-semibold text-gray-900' : 'text-gray-700'
                            }`}
                        >
                          {d}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Adres</div>
                <input value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value.toLocaleUpperCase('tr-TR') }))} className="input-base h-9 text-sm" placeholder="Ankara" />
              </div>

              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Telefon</div>
                <input
                  inputMode="numeric"
                  value={form.phone}
                  onChange={(e) => {
                    const formatted = formatPhoneNumber(e.target.value)
                    setForm((p) => ({ ...p, phone: formatted }))
                  }}
                  className="input-base h-9 text-sm"
                  placeholder="0555 555 5555 555"
                />
              </div>
              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Fax</div>
                <input value={form.fax} onChange={(e) => setForm((p) => ({ ...p, fax: e.target.value.toLocaleUpperCase('tr-TR') }))} className="input-base h-9 text-sm" placeholder="0312XXXXXXX" />
              </div>
              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Email</div>
                <input value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value.toLocaleLowerCase('tr-TR') }))} className="input-base h-9 text-sm" placeholder="ali.yilmaz@firma.com" />
              </div>

              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Vergi Dairesi</div>
                <input value={form.taxOffice} onChange={(e) => setForm((p) => ({ ...p, taxOffice: e.target.value.toLocaleUpperCase('tr-TR') }))} className="input-base h-9 text-sm" placeholder="Çankaya" />
              </div>
              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Vergi No</div>
                <input value={form.taxNumber} onChange={(e) => setForm((p) => ({ ...p, taxNumber: e.target.value.toLocaleUpperCase('tr-TR') }))} className="input-base h-9 text-sm" placeholder="1234567890" />
              </div>
              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">TCKimlik No</div>
                <input
                  inputMode="numeric"
                  value={form.identityNumber}
                  onChange={(e) => {
                    const digits = String(e.target.value ?? '').replace(/\D/g, '').slice(0, 11)
                    setForm((p) => ({ ...p, identityNumber: digits }))
                  }}
                  className="input-base h-9 text-sm"
                  placeholder="11111111111"
                />
              </div>

              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Ürün Kategorisi</div>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setCategoryDropdownOpen((p) => !p)}
                    className="input-base h-9 text-sm flex items-center justify-between"
                  >
                    <span className="truncate">
                      {allCategoriesSelected
                        ? 'Hepsi seçili'
                        : form.productCategoryIds.length
                          ? selectedCategoryNames
                          : 'Seçiniz...'}
                    </span>
                    <span className="text-gray-500">▼</span>
                  </button>

                  {categoryDropdownOpen && (
                    <div className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg p-2">
                      <label className="flex items-center gap-2 px-2 py-1 text-sm text-gray-800 hover:bg-gray-50 rounded cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={allCategoriesSelected}
                          onChange={(e) => {
                            const checked = e.target.checked
                            setForm((p) => ({
                              ...p,
                              categoryAccessMode: checked ? 'All' : 'Custom',
                              productCategoryIds: []
                            }))
                          }}
                        />
                        <span className="font-semibold">Hepsi</span>
                      </label>

                      <div className="my-1 border-t border-gray-200" />

                      {mainCategories.map((m) => {
                        const subs = categoryChildrenByParent.get(m.id) ?? []
                        const isAll = form.categoryAccessMode === 'All'
                        const mainChecked = isAll || form.productCategoryIds.includes(m.id)
                        const subSelectedCount = isAll ? subs.length : subs.filter((s) => form.productCategoryIds.includes(s.id)).length
                        const indeterminate = !isAll && !mainChecked && subSelectedCount > 0
                        const mainIsActive = (m as any).isActive !== false

                        return (
                          <div key={m.id} className="mb-1">
                            <label
                              className={
                                'flex items-center gap-2 px-2 py-1 text-sm hover:bg-gray-50 rounded cursor-pointer select-none ' +
                                (mainIsActive ? 'text-gray-800' : 'text-gray-400')
                              }
                            >
                              <input
                                type="checkbox"
                                checked={mainChecked}
                                ref={(el) => {
                                  if (!el) return
                                  el.indeterminate = indeterminate
                                }}
                                onChange={(e) => toggleMainCategory(m.id, e.target.checked)}
                              />
                              <span className="font-semibold">{m.name}</span>
                            </label>

                            {subs.length > 0 && (
                              <div className="pl-6">
                                {subs.map((s) => (
                                  (() => {
                                    const subIsActive = (s as any).isActive !== false
                                    const subChecked = isAll || form.productCategoryIds.includes(s.id)
                                    return (
                                      <label
                                        key={s.id}
                                        className={
                                          'flex items-center gap-2 px-2 py-1 text-sm hover:bg-gray-50 rounded cursor-pointer select-none ' +
                                          (subIsActive ? 'text-gray-800' : 'text-gray-400')
                                        }
                                      >
                                        <input
                                          type="checkbox"
                                          checked={subChecked}
                                          onChange={(e) => toggleSubCategory(s.id, e.target.checked)}
                                        />
                                        <span>{s.name}</span>
                                      </label>
                                    )
                                  })()
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Fatura/Açık *</div>
                <select
                  value={form.invoiceType}
                  disabled={isBranchForm}
                  onChange={(e) => {
                    const nextType = e.target.value
                    setForm((p) => {
                      let nextPgId = p.priceGroupId
                      if (nextType === 'ASKERIYE') {
                        const pg7 = priceGroups.find((x) => x.code === 7)
                        if (pg7) nextPgId = pg7.id
                      } else if (nextType === 'ACIK') {
                        const pg = priceGroups.find((x) => x.id === p.priceGroupId)
                        if (!pg || pg.code < 4 || pg.code === 7) {
                          const pg4 = priceGroups.find((x) => x.code === 4)
                          if (pg4) nextPgId = pg4.id
                        }
                      } else if (nextType === 'FATURA') {
                        const pg = priceGroups.find((x) => x.id === p.priceGroupId)
                        if (!pg || pg.code >= 4) {
                          const pg1 = priceGroups.find((x) => x.code === 1)
                          if (pg1) nextPgId = pg1.id
                        }
                      }
                      return { ...p, invoiceType: nextType, priceGroupId: nextPgId }
                    })
                  }}
                  className="input-base h-9 text-sm"
                >
                  <option value="FATURA">Fatura Carisi (Normal)</option>
                  <option value="ASKERIYE">Askeriye Carisi (KDV'siz Fatura)</option>
                  <option value="ACIK">Açık Cari (Fatura Hesabı Bağlı)</option>
                </select>
              </div>

              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                  {isBranchForm ? 'Fiyat Grubu (Bağlı Cariden)' : 'Fiyat Grubu'}
                </div>
                <select
                  value={form.priceGroupId}
                  disabled={isBranchForm}
                  onChange={(e) => setForm((p) => ({ ...p, priceGroupId: e.target.value }))}
                  className="input-base h-9 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                >
                  <option value="">Seçiniz...</option>
                  {priceGroups
                    .filter((pg) => {
                      if (form.invoiceType === 'ASKERIYE') return pg.code === 7
                      if (form.invoiceType === 'ACIK') return pg.code >= 4 && pg.code <= 6
                      if (form.invoiceType === 'FATURA') return pg.code <= 3
                      return true
                    })
                    .map((pg) => {
                      const mappedCode = pg.code >= 4 && pg.code <= 6 ? pg.code - 3 : pg.code
                      const mappedPg = priceGroups.find((x) => x.code === mappedCode)
                      const hint = pg.code >= 4 && pg.code <= 6 && mappedPg ? ` → (Fatura Eşleşmesi: ${mappedPg.code} - ${mappedPg.name})` : ''
                      return (
                        <option key={pg.id} value={pg.id}>
                          {pg.code} - {pg.name}{hint}
                        </option>
                      )
                    })}
                </select>
              </div>

              {form.invoiceType === 'ASKERIYE' && (
                <div className="md:col-span-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🎖️</span>
                    <div>
                      <span className="font-bold">Askeriye Cari Mimarisi:</span> Fiyat Grubu 7 (Askeriye) olarak atanır ve yalnızca <code className="bg-emerald-100 px-1 py-0.5 rounded font-mono font-bold text-emerald-800">{form.customerCode ? `${form.customerCode}-3` : '{CariKodu}-3'}</code> (Askeriye Hesabı) açılır. Sipariş ve teklif işlemlerinde KDV eklenmez.
                    </div>
                  </div>
                </div>
              )}

              {form.invoiceType === 'FATURA' && (
                <div className="md:col-span-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base">📄</span>
                    <div>
                      <span className="font-bold">Fatura Cari Mimarisi:</span> Bu cari oluşturulduğunda yalnızca <code className="bg-blue-100 px-1 py-0.5 rounded font-mono font-bold text-blue-800">{form.customerCode ? `${form.customerCode}-1` : '{CariKodu}-1'}</code> (Fatura Hesabı) açılır. Açık Cari hesabı açılmaz.
                    </div>
                  </div>
                </div>
              )}

              {form.invoiceType === 'ACIK' && (
                <div className="md:col-span-3 p-3 bg-purple-50 border border-purple-200 rounded-lg text-xs text-purple-900 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base">💡</span>
                    <div>
                      <span className="font-bold">Açık Cari Mimarisi:</span> Bu cari oluşturulduğunda otomatik olarak hem <code className="bg-purple-100 px-1 py-0.5 rounded font-mono font-bold text-purple-800">{form.customerCode ? `${form.customerCode}-1` : '{CariKodu}-1'}</code> (Fatura Hesabı) hem de <code className="bg-purple-100 px-1 py-0.5 rounded font-mono font-bold text-purple-800">{form.customerCode ? `${form.customerCode}-2` : '{CariKodu}-2'}</code> (Açık Cari Hesabı) açılır.
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">İskonto Oranı</div>
                <input value={form.discountRate} onChange={(e) => setForm((p) => ({ ...p, discountRate: e.target.value }))} className="input-base h-9 text-sm" placeholder="0" />
              </div>

              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Salesman Code</div>
                <select
                  value={form.salesmanCode}
                  onChange={(e) => setForm((p) => ({ ...p, salesmanCode: e.target.value }))}
                  className="input-base h-9 text-sm"
                >
                  <option value="">Seçiniz...</option>
                  {salesmanOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              {String(form.customerType ?? '').trim().toLocaleLowerCase('tr-TR') !== 'şube' &&
                String(form.customerType ?? '').trim().toLocaleLowerCase('tr-TR') !== 'sube' && (
                  <>
                    {/* PARA BİRİMİ BAŞINA AYRI LİMİT (2026-08-19, kullanıcı kuralı).
                        Dolarlı satış dolar limitine, euro satış euro limitine yürür; belge
                        tutarı hiçbir yerde kura çevrilmez. Limiti 0 olan para biriminde
                        satış yapılamaz — o para birimini kullanmayacaksanız 0 bırakın. */}
                    <div className="space-y-1">
                      <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Limit (₺ TL)</div>
                      <input
                        inputMode="numeric"
                        value={form.creditLimit}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '')
                          setForm((p) => ({ ...p, creditLimit: val }))
                        }}
                        className="input-base h-9 text-sm"
                        placeholder="0"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Limit ($ USD)</div>
                      <input
                        inputMode="numeric"
                        value={form.creditLimitUsd}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '')
                          setForm((p) => ({ ...p, creditLimitUsd: val }))
                        }}
                        className="input-base h-9 text-sm"
                        placeholder="0"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Limit (€ EUR)</div>
                      <input
                        inputMode="numeric"
                        value={form.creditLimitEur}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '')
                          setForm((p) => ({ ...p, creditLimitEur: val }))
                        }}
                        className="input-base h-9 text-sm"
                        placeholder="0"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Limit (£ GBP)</div>
                      <input
                        inputMode="numeric"
                        value={form.creditLimitGbp}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '')
                          setForm((p) => ({ ...p, creditLimitGbp: val }))
                        }}
                        className="input-base h-9 text-sm"
                        placeholder="0"
                      />
                    </div>
                  </>
                )}



              {/* Cari kartındaki "Döviz" (kur tipi) alanı KALDIRILDI (2026-08-17).
                  Bir cariye her para biriminde alım/satım yapılabilir; hareketin para birimi
                  belgenin (ürün/fatura/çek/kasa) kendi para birimidir, carinin değil.
                  Alan burada seçilebildiği sürece her hareket ona çevriliyordu. */}

              {!editCode &&
                String(form.customerType ?? '').trim().toLocaleLowerCase('tr-TR') !== 'şube' &&
                String(form.customerType ?? '').trim().toLocaleLowerCase('tr-TR') !== 'sube' && (
                  <div className="space-y-1">
                    <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Aktif Ekstre Başlangıç Bakiyesi (Devir)</div>
                    <input
                      value={form.initialBalance}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9.,-]/g, '')
                        setForm((p) => ({ ...p, initialBalance: val }))
                      }}
                      className="input-base h-9 text-sm"
                      placeholder="Örn: -10000 veya +513261"
                    />
                  </div>
                )}

              <div className="space-y-1 flex items-end">
                <label className="flex items-center gap-2 text-sm text-gray-700 select-none">
                  <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))} />
                  Aktif
                </label>
              </div>

              {/* E-TICARET SIPARISLERI — yalnızca 120-11- carilerinde. */}
              {isShopCustomer && (
                <div className="col-span-full mt-2 rounded-lg border border-blue-100 bg-blue-50/40 p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="text-[11px] font-bold text-blue-900 uppercase tracking-wide">
                      E-Ticaret siparişleri
                    </div>
                    <button
                      type="button"
                      onClick={() => window.open('/eticaret/siparisler', '_blank')}
                      className="text-[11px] font-semibold text-blue-700 hover:text-blue-900"
                    >
                      Sipariş ekranını aç →
                    </button>
                  </div>

                  {shopOrdersLoading ? (
                    <div className="text-xs text-gray-500">Yükleniyor…</div>
                  ) : shopOrders.length === 0 ? (
                    <div className="text-xs text-gray-500">
                      Bu cariye ait internet siparişi yok. (Cari e-ticaret üyeliğiyle açılmış.)
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="text-[10px] uppercase text-gray-500">
                            <th className="py-1 pr-3">Sipariş</th>
                            <th className="py-1 pr-3">Tarih</th>
                            <th className="py-1 pr-3 text-right">Tutar</th>
                            <th className="py-1 pr-3">Durum</th>
                            <th className="py-1">Fatura</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shopOrders.map((o) => (
                            <tr key={o.orderNo} className="border-t border-blue-100/70">
                              <td className="py-1 pr-3 font-mono">{o.orderNo}</td>
                              <td className="py-1 pr-3 text-gray-600">
                                {o.processedAt ? new Date(o.processedAt).toLocaleDateString('tr-TR') : '-'}
                              </td>
                              <td className="py-1 pr-3 text-right tabular-nums font-semibold">
                                {Number(o.grandTotal ?? 0).toLocaleString('tr-TR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2
                                })}
                              </td>
                              <td className="py-1 pr-3">
                                {o.isCancelled ? (
                                  <span className="text-red-600 font-semibold">İptal</span>
                                ) : o.isPaid ? (
                                  <span className="text-emerald-700 font-semibold">Ödendi</span>
                                ) : (
                                  <span className="text-amber-700 font-semibold">Ödeme bekliyor</span>
                                )}
                                {o.montageCount > 0 && (
                                  <span className="ml-1 text-violet-700">· montaj {o.montageCount}</span>
                                )}
                              </td>
                              <td className="py-1 font-mono text-gray-600">{o.invoiceNo || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

        </div>
      </Modal>

      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-bold text-gray-800">Cari Listesi</div>
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ara (cari kodu / cari adı)..."
            className="w-80 h-[34px] pl-8 pr-3 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
          />
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-visible relative">
        {loading && items.length === 0 ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="h-3 bg-gray-100 rounded animate-pulse w-24" />
                <div className="h-3 bg-gray-100 rounded animate-pulse flex-1" />
                <div className="h-3 bg-gray-100 rounded animate-pulse w-16" />
                <div className="h-3 bg-gray-100 rounded animate-pulse w-20" />
                <div className="h-3 bg-gray-100 rounded animate-pulse w-28" />
              </div>
            ))}
          </div>
        ) : (
          <Table
          onRefresh={() => void reload(true)}
            columns={columns}
            data={items.map((x) => ({ ...x, id: (x as any).id || x.customerCode, actions: '' }))}
            showColumnFilters
            globalSearch={search}
            loading={loading}
            initialColumnFilters={{
              isActive: {
                selectedOptions: ['true'],
                value: 'true',
                operator: 'in'
              }
            }}
          />
        )}
      </div>
    </div>
  )
}
