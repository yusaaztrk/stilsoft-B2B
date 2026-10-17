import { PRICE_GROUP_TARGET_PREFIX } from '../components/Campaigns/DealerSelector'
import React, { useEffect, useMemo, useState } from 'react'
import { ArrowUpDown, Filter, Search, CheckCircle, AlertCircle } from 'lucide-react'
import Modal from '../components/Modal'
import ActionDropdown from '../components/ActionDropdown'
import CampaignCreateModal from '../components/Campaigns/CampaignCreateModal'
import BasketTotalDiscountModal from '../components/Campaigns/BasketTotalDiscountModal'
import QuantityTieredDiscountModal from '../components/Campaigns/QuantityTieredDiscountModal'
import BuyXGetYModal from '../components/Campaigns/BuyXGetYModal'
import SelectedProductDiscountModal from '../components/Campaigns/SelectedProductDiscountModal'
import CategoryBrandDiscountModal from '../components/Campaigns/CategoryBrandDiscountModal'
import PackageCampaignModal from '../components/Campaigns/PackageCampaignModal'
import { fetchCampaignById, fetchCampaigns, softDeleteCampaign, type CampaignDetailsResponse } from '../api/campaigns'
import { fetchProducts } from '../api/products'
import { API_BASE_URL } from '../config/api'
import { CAMPAIGN_BACKGROUNDS, parseCampaignDescription } from '../utils/campaignBgHelper'

export default function CampaignsPage() {
    type Row = {
        id: string
        KAMPANYA_ADI: string
        KAMPANYA_ACIKLAMA: string
        BASLANGIC_TARIH: string
        BITIS_TARIH: string
        KAMPANYA_TIPI: string
        /** Uygulama sirasi; buyuk olan once uygulanir. */
        ONCELIK: number
        AKTIF: boolean
    }

    type ColumnKey = 'KAMPANYA_ADI' | 'KAMPANYA_ACIKLAMA' | 'BASLANGIC_TARIH' | 'BITIS_TARIH' | 'KAMPANYA_TIPI' | 'ONCELIK' | 'AKTIF'
    type SortDir = 'asc' | 'desc'

    const [createOpen, setCreateOpen] = useState(false)
    const [basketDiscountOpen, setBasketDiscountOpen] = useState(false)
    const [basketDiscountDraft, setBasketDiscountDraft] = useState<null | { name: string; description: string; startDate: string; endDate: string }>(null)
    const [basketDiscountEditingId, setBasketDiscountEditingId] = useState<string | null>(null)
    const [basketDiscountInitialForm, setBasketDiscountInitialForm] = useState<any>(null)
    const [qtyTierOpen, setQtyTierOpen] = useState(false)
    const [qtyTierDraft, setQtyTierDraft] = useState<null | { name: string; description: string; startDate: string; endDate: string }>(null)
    const [qtyTierEditingId, setQtyTierEditingId] = useState<string | null>(null)
    const [qtyTierInitialForm, setQtyTierInitialForm] = useState<any>(null)
    const [buyXGetYOpen, setBuyXGetYOpen] = useState(false)
    const [buyXGetYDraft, setBuyXGetYDraft] = useState<null | { name: string; description: string; startDate: string; endDate: string }>(null)
    const [buyXGetYEditingId, setBuyXGetYEditingId] = useState<string | null>(null)
    const [buyXGetYInitialForm, setBuyXGetYInitialForm] = useState<any>(null)
    const [productDiscountOpen, setProductDiscountOpen] = useState(false)
    const [productDiscountDraft, setProductDiscountDraft] = useState<null | { name: string; description: string; startDate: string; endDate: string }>(null)
    const [productDiscountEditingId, setProductDiscountEditingId] = useState<string | null>(null)
    const [productDiscountInitialForm, setProductDiscountInitialForm] = useState<any>(null)
    const [catBrandOpen, setCatBrandOpen] = useState(false)
    const [catBrandDraft, setCatBrandDraft] = useState<null | { name: string; description: string; startDate: string; endDate: string }>(null)
    const [catBrandEditingId, setCatBrandEditingId] = useState<string | null>(null)
    const [catBrandInitialForm, setCatBrandInitialForm] = useState<any>(null)
    const [packageOpen, setPackageOpen] = useState(false)
    const [packageDraft, setPackageDraft] = useState<null | { name: string; description: string; startDate: string; endDate: string }>(null)
    const [packageEditingId, setPackageEditingId] = useState<string | null>(null)
    const [packageInitialForm, setPackageInitialForm] = useState<any>(null)

    const [settingsLoading, setSettingsLoading] = useState(false)
    const [settingsSaving, setSettingsSaving] = useState(false)
    const [giftAccountingMode, setGiftAccountingMode] = useState<number>(2)
    const [giftSymbolicPrice, setGiftSymbolicPrice] = useState<string>('0.01')
    const [accessTokenExpiration, setAccessTokenExpiration] = useState<number>(60)
    const [alertBeforeMinutes, setAlertBeforeMinutes] = useState<number>(3)
    const [settingsAlert, setSettingsAlert] = useState<{
        isOpen: boolean
        title: string
        message: string
        type: 'success' | 'error'
    } | null>(null)

    const loadSettings = async () => {
        try {
            setSettingsLoading(true)
            const token = localStorage.getItem('accessToken')
            const headers: Record<string, string> = {}
            if (token) headers.Authorization = `Bearer ${token}`

            const res = await fetch(`${API_BASE_URL}/api/SessionSettings`, { headers })
            if (res.ok) {
                const json = await res.json()
                const data = json?.data
                if (data) {
                    setGiftAccountingMode(2)
                    setGiftSymbolicPrice(data.campaignGiftSymbolicPrice ? String(data.campaignGiftSymbolicPrice) : '0.01')
                    setAccessTokenExpiration(Number(data.accessTokenExpirationMinutes ?? 60))
                    setAlertBeforeMinutes(Number(data.alertBeforeMinutes ?? 3))
                }
            }
        } catch (e) {
            console.error('Ayarlar yüklenirken hata:', e)
        } finally {
            setSettingsLoading(false)
        }
    }

    const saveSettings = async () => {
        try {
            setSettingsSaving(true)
            const token = localStorage.getItem('accessToken')
            const headers: Record<string, string> = {
                'Content-Type': 'application/json'
            }
            if (token) headers.Authorization = `Bearer ${token}`

            const body = {
                accessTokenExpirationMinutes: accessTokenExpiration,
                alertBeforeMinutes: alertBeforeMinutes,
                campaignGiftAccountingMode: 2,
                campaignGiftSymbolicPrice: parseFloat(giftSymbolicPrice) || 0.01
            }

            const res = await fetch(`${API_BASE_URL}/api/SessionSettings`, {
                method: 'PUT',
                headers,
                body: JSON.stringify(body)
            })

            if (res.ok) {
                setSettingsAlert({
                    isOpen: true,
                    title: 'Başarılı',
                    message: 'Muhasebe ayarları başarıyla güncellendi.',
                    type: 'success'
                })
            } else {
                setSettingsAlert({
                    isOpen: true,
                    title: 'Hata',
                    message: 'Muhasebe ayarları güncellenemedi.',
                    type: 'error'
                })
            }
        } catch (e) {
            console.error('Ayarlar kaydedilirken hata:', e)
            setSettingsAlert({
                isOpen: true,
                title: 'Hata',
                message: 'Muhasebe ayarları kaydedilirken hata oluştu.',
                type: 'error'
            })
        } finally {
            setSettingsSaving(false)
        }
    }

    useEffect(() => {
        void loadSettings()
    }, [])

    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const [rows, setRows] = useState<Row[]>([])

    const [detailsOpen, setDetailsOpen] = useState(false)
    const [detailsLoading, setDetailsLoading] = useState(false)
    const [detailsError, setDetailsError] = useState<string | null>(null)
    const [details, setDetails] = useState<CampaignDetailsResponse | null>(null)

    const [page, setPage] = useState(1)
    const [pageSize, setPageSize] = useState(20)
    const [total, setTotal] = useState(0)
    const [totalPages, setTotalPages] = useState(1)

    const [deleteCampaignConfirm, setDeleteCampaignConfirm] = useState<{ id: string; name: string } | null>(null)
    const [deleteCampaignLoading, setDeleteCampaignLoading] = useState(false)
    const [deleteCampaignError, setDeleteCampaignError] = useState<string | null>(null)

    const [filters, setFilters] = useState<Record<ColumnKey, { q: string }>>({
        KAMPANYA_ADI: { q: '' },
        KAMPANYA_ACIKLAMA: { q: '' },
        BASLANGIC_TARIH: { q: '' },
        BITIS_TARIH: { q: '' },
        KAMPANYA_TIPI: { q: '' },
        ONCELIK: { q: '' },
        AKTIF: { q: '' }
    })

    const [sort, setSort] = useState<{ key: ColumnKey; dir: SortDir } | null>(null)
    const [menuOpenKey, setMenuOpenKey] = useState<ColumnKey | null>(null)

    const toDateText = (v: any) => {
        const s = String(v ?? '').trim()
        if (!s) return ''
        return s.length >= 10 ? s.slice(0, 10) : s
    }

    const kampanyaTipiLabel = (v: any) => {
        const n = Number(v)
        if (n === 1) return 'Sepet Toplam İndirim'
        if (n === 2) return 'Adet Bazlı Kademeli İndirim'
        if (n === 3) return 'X Alana Y Hediye / İndirimli Ürün'
        if (n === 4) return 'Seçili Ürün İndirimi'
        if (n === 5) return 'Kategori-Marka Bazlı İndirim'
        if (n === 6) return 'Paket Kampanya'
        return String(v ?? '').trim()
    }

    const load = async () => {
        try {
            setLoading(true)
            setError(null)

            const typeFilterText = String(filters.KAMPANYA_TIPI.q ?? '').trim().toLowerCase()
            const typeToCode = () => {
                if (!typeFilterText) return ''
                const asNum = Number(typeFilterText)
                if (Number.isFinite(asNum) && asNum > 0) return String(asNum)
                if (typeFilterText.includes('sepet')) return '1'
                if (typeFilterText.includes('kademeli') || typeFilterText.includes('adet')) return '2'
                if (typeFilterText.includes('x alana') || typeFilterText.includes('hediye') || typeFilterText.includes('indirimli')) return '3'
                if (typeFilterText.includes('seçili') || typeFilterText.includes('urun') || typeFilterText.includes('ürün')) return '4'
                if (typeFilterText.includes('kategori') || typeFilterText.includes('marka')) return '5'
                if (typeFilterText.includes('paket')) return '6'
                return ''
            }

            const mapSortKey = (key: ColumnKey) => {
                if (key === 'KAMPANYA_ADI') return 'name'
                if (key === 'KAMPANYA_ACIKLAMA') return 'description'
                if (key === 'BASLANGIC_TARIH') return 'startDate'
                if (key === 'BITIS_TARIH') return 'endDate'
                if (key === 'KAMPANYA_TIPI') return 'kampanyaTipi'
                if (key === 'ONCELIK') return 'priority'
                if (key === 'AKTIF') return 'isActive'
                return 'createTime'
            }

            const res = await fetchCampaigns({
                page,
                pageSize,
                name: filters.KAMPANYA_ADI.q,
                description: filters.KAMPANYA_ACIKLAMA.q,
                startDate: filters.BASLANGIC_TARIH.q,
                endDate: filters.BITIS_TARIH.q,
                kampanyaTipi: typeToCode(),
                isActive: filters.AKTIF.q,
                sort: sort ? mapSortKey(sort.key) : 'createTime',
                dir: sort?.dir ?? 'desc'
            })

            setTotal(res.total)
            setTotalPages(res.totalPages)
            setPage(res.page)
            setPageSize(res.pageSize)

            const mapped = (res.items ?? []).map((x: any) => {
                return {
                    id: String(x.id ?? ''),
                    KAMPANYA_ADI: String(x.name ?? ''),
                    KAMPANYA_ACIKLAMA: String(x.description ?? ''),
                    BASLANGIC_TARIH: toDateText(x.startDate),
                    BITIS_TARIH: toDateText(x.endDate),
                    KAMPANYA_TIPI: kampanyaTipiLabel(x.kampanyaTipi),
                    ONCELIK: Number(x.priority ?? 0),
                    AKTIF: Boolean(x.isActive)
                } as Row
            })
            setRows(mapped)
        } catch (e: any) {
            setRows([])
            setError(String(e?.message ?? 'Kampanyalar alınamadı'))
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        void load()
    }, [page, pageSize, sort])

    const confirmDeleteCampaign = async () => {
        if (!deleteCampaignConfirm?.id) return
        try {
            setDeleteCampaignLoading(true)
            setDeleteCampaignError(null)
            await softDeleteCampaign(deleteCampaignConfirm.id)
            setDeleteCampaignConfirm(null)
            await load()
        } catch (e: any) {
            setDeleteCampaignError(String(e?.message ?? 'Kampanya silinemedi'))
        } finally {
            setDeleteCampaignLoading(false)
        }
    }

    const norm = (v: any) => String(v ?? '').trim().toLowerCase()
    const match = (value: string, q: string) => {
        const v = norm(value)
        const n = norm(q)
        if (!n) return true
        return v.includes(n)
    }

    const matchBool = (value: boolean, q: string) => {
        const n = norm(q)
        if (!n) return true
        if (['evet', 'e', 'true', '1', 'aktif'].includes(n)) return value === true
        if (['hayir', 'h', 'false', '0', 'pasif'].includes(n)) return value === false
        return true
    }

    const visibleRows = useMemo(() => rows, [rows])

    const setFilterQ = (key: ColumnKey, q: string) => {
        setFilters((prev) => ({ ...prev, [key]: { ...prev[key], q } }))
        setPage(1)
    }

    useEffect(() => {
        const t = window.setTimeout(() => {
            void load()
        }, 250)
        return () => window.clearTimeout(t)
    }, [filters])

    const pageButtons = useMemo(() => {
        const cur = page
        const last = totalPages
        const out: Array<number | '...'> = []
        const push = (v: number | '...') => {
            if (out.length === 0 || out[out.length - 1] !== v) out.push(v)
        }
        const windowSize = 2
        const start = Math.max(2, cur - windowSize)
        const end = Math.min(last - 1, cur + windowSize)

        push(1)
        if (start > 2) push('...')
        for (let p = start; p <= end; p++) push(p)
        if (end < last - 1) push('...')
        if (last > 1) push(last)
        return out
    }, [page, totalPages])

    const toggleAktif = (id: string) => {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, AKTIF: !r.AKTIF } : r)))
    }

    const openDetails = async (id: string) => {
        try {
            setDetailsOpen(true)
            setDetailsLoading(true)
            setDetailsError(null)
            setDetails(null)

            const data = await fetchCampaignById(id)
            setDetails(data)
        } catch (e: any) {
            setDetailsError(String(e?.message ?? 'Detay alınamadı'))
        } finally {
            setDetailsLoading(false)
        }
    }

    function extractSelectedPriceGroups(d: any) {
        // Sunucu artık seçili fiyat gruplarını doğrudan veriyor ve bu liste 6 ile sınırlı değil.
        // iskontoFiyat1..6 yalnızca ESKİ kayıtlar için okunuyor: o kolonlar altı grupla sınırlı
        // olduğu için 7. grup (Askeriye Tipi Fatura) buradan asla çıkmazdı.
        const fromServer = d?.priceGroupCodes
        if (Array.isArray(fromServer) && fromServer.length > 0) {
            return fromServer.map((x: any) => Number(x)).filter((x: number) => Number.isFinite(x) && x >= 1)
        }

        const out: number[] = []
        if (d?.iskontoFiyat1 != null) out.push(1)
        if (d?.iskontoFiyat2 != null) out.push(2)
        if (d?.iskontoFiyat3 != null) out.push(3)
        if (d?.iskontoFiyat4 != null) out.push(4)
        if (d?.iskontoFiyat5 != null) out.push(5)
        if (d?.iskontoFiyat6 != null) out.push(6)
        return out
    }

    /**
     * Kampanyaya bağlı bayi (cari) kodları. TargetType 2 = SpecificCustomer.
     * Hiç hedef yoksa boş dizi döner ve bu "tüm bayiler" demektir.
     * Bu geri yükleme olmadan, düzenleme ekranı bayi seçimini boş gösterip kaydedince
     * mevcut kısıtı sessizce siliyordu.
     */
    function extractDealerCodes(data: any) {
        // TUZAK: sunucu enum'u METİN olarak veriyor ("SpecificCustomer"), sayı olarak
        // değil. Sadece Number(...) === 2 diye bakmak her zaman boş liste döndürür ve
        // düzenleme ekranı bayi seçimini kaybeder. İki biçimi de kabul et.
        const typeOf = (raw: any): 'customer' | 'priceGroup' | null => {
            const s = String(raw ?? '').trim().toLowerCase()
            if (raw === 2 || s === '2' || s === 'specificcustomer') return 'customer'
            if (raw === 4 || s === '4' || s === 'customerpricegroup') return 'priceGroup'
            return null
        }
        return (((data as any)?.targets ?? []) as any[])
            .map((t) => {
                const id = String(t?.targetId ?? '').trim()
                if (!id) return ''
                const kind = typeOf(t?.targetType)
                // Fiyat grubu hedefi (2026-10-04) seçiciye "PG:<id>" belirteci olarak döner —
                // "bu grubun TAMAMI, sonradan açılanlar dahil". Bkz. DealerSelector.
                if (kind === 'priceGroup') return `${PRICE_GROUP_TARGET_PREFIX}${id}`
                return kind === 'customer' ? id : ''
            })
            .filter(Boolean)
    }

    const normalizeIskontoKind = (v: any) => {
        const n = Number(v)
        if (n === 1) return 'Tutar'
        if (n === 2) return 'Oran'

        const s = String(v ?? '').trim().toLowerCase()
        if (s === 'tutar') return 'Tutar'
        if (s === 'oran') return 'Oran'
        return null
    }

    const resolveKampanyaTipiCode = (v: any) => {
        const n = Number(v)
        if (Number.isFinite(n) && n > 0) return n

        const s = String(v ?? '').trim().toLowerCase()
        if (!s) return 0
        if (s === 'baskettotaldiscount' || s.includes('baskettotal') || s.includes('sepet')) return 1
        if (s === 'quantitytiereddiscount' || s.includes('quantitytiered') || s.includes('kademeli') || s.includes('adet')) return 2
        if (s === 'buyxgety' || s.includes('buyxgety') || s.includes('xal') || s.includes('x al') || s.includes('hediye')) return 3
        if (s === 'productdiscount' || s.includes('productdiscount') || s.includes('urun') || s.includes('ürün')) return 4
        if (s === 'categorybranddiscount' || s.includes('categorybrand') || s.includes('kategori') || s.includes('marka')) return 5
        if (s === 'packagecampaign' || s.includes('packagecampaign') || s.includes('paket')) return 6
        return 0
    }

    const openEdit = async (id: string) => {
        try {
            setError(null)
            const data = await fetchCampaignById(id)

            const tip = resolveKampanyaTipiCode((data as any)?.kampanyaTipi)
            const name = String((data as any)?.name ?? '')
            const description = String((data as any)?.description ?? '')
            const startDate = toDateText((data as any)?.startDate)
            const endDate = toDateText((data as any)?.endDate)
            // Öncelik/StopNext her kampanya tipinde ortak; altı initialForm'a da bunlar taşınmazsa
            // düzenleme ekranı 0/false gösterir ve alan bir daha değiştirilemez.
            const priority = Number((data as any)?.priority ?? 0) || 0
            const stopNext = Boolean((data as any)?.stopNext)
            const selectedDealerCodes = extractDealerCodes(data)

            if (tip === 1) {
                const cond = ((data as any)?.conditions ?? [])[0]
                const disc = ((data as any)?.discounts ?? [])[0]

                const groupCode = String(cond?.categoryCode ?? disc?.grupKodu ?? '').trim()
                const productStockCodes = ((cond?.productStockCodes ?? []) as any[]).map((x) => String(x ?? '').trim()).filter(Boolean)
                const minBasketTotalText = String(disc?.minSepetTutari ?? '')
                const discountKind = normalizeIskontoKind(disc?.iskontoTipi)
                const discountValueText = String(disc?.deger ?? '')
                const selectedPriceGroupCodes = extractSelectedPriceGroups(disc)

                setBasketDiscountInitialForm({
                    name,
                    description,
                    startDate,
                    endDate,
                    groupCode,
                    productStockCodes,
                    minBasketTotalText,
                    discountKind,
                    discountValueText,
                    selectedPriceGroupCodes,
                    priority,
                    stopNext,
                    selectedDealerCodes
                })
                setBasketDiscountEditingId(id)
                setBasketDiscountDraft(null)
                setBasketDiscountOpen(true)
                return
            }

            if (tip === 4) {
                const cond = ((data as any)?.conditions ?? [])[0]
                const disc = ((data as any)?.discounts ?? [])[0]

                const groupCode = String(cond?.categoryCode ?? disc?.grupKodu ?? '').trim()
                const productStockCodes = ((cond?.productStockCodes ?? []) as any[]).map((x) => String(x ?? '').trim()).filter(Boolean)
                const discountKind = normalizeIskontoKind(disc?.iskontoTipi)
                const discountValueText = String(disc?.deger ?? '')
                const selectedPriceGroupCodes = extractSelectedPriceGroups(disc)
                // Ürüne özel kampanyalı fiyat (2026-10-07): hedef fiyatlı satırlar listeye döner.
                const targetItems = (((data as any)?.discounts ?? []) as any[])
                    .filter((d) => d?.hedefFiyat != null && String(d?.stokKodu ?? '').trim())
                    .map((d) => ({
                        stockCode: String(d.stokKodu).trim(),
                        productId: d.targetProductId ?? null,
                        targetPrice: Number(d.hedefFiyat)
                    }))

                setProductDiscountInitialForm({
                    name,
                    description,
                    startDate,
                    endDate,
                    groupCode,
                    productStockCodes,
                    discountKind,
                    discountValueText,
                    selectedPriceGroupCodes,
                    priority,
                    stopNext,
                    selectedDealerCodes,
                    targetItems
                })
                setProductDiscountEditingId(id)
                setProductDiscountDraft(null)
                setProductDiscountOpen(true)
                return
            }

            if (tip === 2) {
                const rawConditions = (((data as any)?.conditions ?? []) as any[]).slice()
                const rawDiscounts = (((data as any)?.discounts ?? []) as any[]).slice()
                const conditions = rawConditions.sort((a, b) => Number(a?.minimum ?? 0) - Number(b?.minimum ?? 0))
                const discounts = rawDiscounts.sort((a, b) => Number(a?.minSepetTutari ?? 0) - Number(b?.minSepetTutari ?? 0))

                const cond0 = conditions[0] ?? {}
                const selectedGroupCode = String(((cond0?.groupCodes ?? [])[0] ?? cond0?.categoryCode ?? '') as any).trim()
                const selectedStockCodes = ((cond0?.productStockCodes ?? []) as any[]).map((x) => String(x ?? '').trim()).filter(Boolean)

                const tiers = conditions.map((c: any, idx: number) => {
                    const d = discounts[idx] ?? discounts.find((disc: any) => Number(disc?.minSepetTutari ?? 0) === Number(c?.minimum ?? 0)) ?? {}
                    return {
                        minQuantityText: String(c?.minimum ?? ''),
                        maxQuantityText: c?.maximum == null ? '' : String(c.maximum),
                        discountKind: (normalizeIskontoKind(d?.iskontoTipi) ?? 'Oran') as any,
                        discountValueText: String(d?.deger ?? ''),
                        priceGroupCodes: extractSelectedPriceGroups(d)
                    }
                })

                setQtyTierInitialForm({
                    name,
                    description,
                    startDate,
                    endDate,
                    selectedGroupCode,
                    selectedStockCodes,
                    tiers,
                    priority,
                    stopNext,
                    selectedDealerCodes
                })
                setQtyTierEditingId(id)
                setQtyTierDraft(null)
                setQtyTierOpen(true)
                return
            }

            if (tip === 3) {
                const cond = ((data as any)?.conditions ?? [])[0]
                const actions = (((data as any)?.actions ?? []) as any[]).slice()
                const discounts = (((data as any)?.discounts ?? []) as any[]).slice()

                const triggerGroupCode = String(cond?.categoryCode ?? '').trim()
                const triggerStockCodes = ((cond?.productStockCodes ?? []) as any[]).map((x) => String(x ?? '').trim()).filter(Boolean)
                const triggerMinQtyText = String(cond?.minimum ?? '1')

                const productIds: string[] = []
                for (const a of actions) {
                    if (a?.targetProductId) productIds.push(String(a.targetProductId))
                }
                for (const d of discounts) {
                    if (d?.targetProductId) productIds.push(String(d.targetProductId))
                }

                const distinctIds = Array.from(new Set(productIds.filter(Boolean)))
                const idToGroup: Record<string, string> = {}
                if (distinctIds.length > 0) {
                    const res = await fetchProducts({ ids: distinctIds.join(','), page: 1, pageSize: 200, includeDealer: true })
                        ; (res.items ?? []).forEach((p: any) => {
                            const pid = String(p?.id ?? '').trim()
                            const g = String(p?.groupCode ?? '').trim()
                            if (pid) idToGroup[pid] = g
                        })
                }

                const rewardLines: any[] = []

                for (const a of actions) {
                    const pid = String(a?.targetProductId ?? '').trim()
                    if (!pid) continue
                    rewardLines.push({
                        targetGroupCode: idToGroup[pid] ?? '',
                        targetProductId: pid,
                        quantityText: String(a?.quantity ?? 1),
                        mode: 'gift',
                        discountKind: 'Oran',
                        discountValueText: '',
                        priceGroupCodes: []
                    })
                }

                for (const d of discounts) {
                    const pid = String(d?.targetProductId ?? '').trim()
                    if (!pid) continue
                    rewardLines.push({
                        targetGroupCode: idToGroup[pid] ?? '',
                        targetProductId: pid,
                        quantityText: String(d?.rewardQuantity ?? 1),
                        mode: 'discount',
                        discountKind: (normalizeIskontoKind(d?.iskontoTipi) ?? 'Oran') as any,
                        discountValueText: String(d?.deger ?? ''),
                        priceGroupCodes: extractSelectedPriceGroups(d)
                    })
                }

                setBuyXGetYInitialForm({
                    name,
                    description,
                    startDate,
                    endDate,
                    triggerGroupCode,
                    triggerStockCodes,
                    triggerMinQtyText,
                    rewardLines,
                    priority,
                    stopNext,
                    selectedDealerCodes
                })
                setBuyXGetYEditingId(id)
                setBuyXGetYDraft(null)
                setBuyXGetYOpen(true)
                return
            }

            if (tip === 5) {
                const cond = ((data as any)?.conditions ?? [])[0]
                const disc = ((data as any)?.discounts ?? [])[0]

                const categoryCode = String(cond?.categoryCode ?? '').trim()
                const brandField = (String(cond?.brandField ?? '').trim() || null) as any
                const brandCode = String(cond?.brandCode ?? '').trim()
                const discountKind = (normalizeIskontoKind(disc?.iskontoTipi) || null) as any
                const discountValueText = String(disc?.deger ?? '')
                const selectedPriceGroupCodes = extractSelectedPriceGroups(disc)

                setCatBrandInitialForm({
                    name,
                    description,
                    startDate,
                    endDate,
                    categoryCode,
                    brandField,
                    brandCode,
                    discountKind,
                    discountValueText,
                    selectedPriceGroupCodes,
                    priority,
                    stopNext,
                    selectedDealerCodes
                })
                setCatBrandEditingId(id)
                setCatBrandDraft(null)
                setCatBrandOpen(true)
                return
            }

            if (tip === 6) {
                const cond = ((data as any)?.conditions ?? []).find((x: any) => x?.packageItemsJson) ?? ((data as any)?.conditions ?? [])[0]
                const disc = ((data as any)?.discounts ?? [])[0]

                const pkg = parsePackageItems(cond?.packageItemsJson)
                const stockCodes = pkg.map((p: any) => String(p.stockCode ?? '').trim()).filter(Boolean)
                const groupCodeByStock: Record<string, string> = {}
                if (stockCodes.length > 0) {
                    const results = await Promise.all(
                        stockCodes.map(async (sc: string) => {
                            try {
                                const r = await fetchProducts({ q: sc, page: 1, pageSize: 20, includeDealer: true })
                                const exact = (r.items ?? []).find((x: any) => String(x?.stockCode ?? '').trim().toLowerCase() === sc.toLowerCase())
                                return { stockCode: sc, groupCode: String((exact as any)?.groupCode ?? '').trim() }
                            } catch {
                                return { stockCode: sc, groupCode: '' }
                            }
                        })
                    )
                    results.forEach((x) => {
                        if (x.stockCode) groupCodeByStock[x.stockCode] = x.groupCode
                    })
                }

                const items = pkg.map((p: any) => {
                    const sc = String(p.stockCode ?? '').trim()
                    return { groupCode: groupCodeByStock[sc] ?? '', stockCode: sc, quantity: Number(p.quantity ?? 1) }
                })
                const operationKind = (normalizeIskontoKind(disc?.iskontoTipi) || null) as any
                const operationValueText = String(disc?.deger ?? '')
                const selectedPriceGroupCodes = extractSelectedPriceGroups(disc)

                setPackageInitialForm({
                    name,
                    description,
                    startDate,
                    endDate,
                    items,
                    operationKind,
                    operationValueText,
                    selectedPriceGroupCodes,
                    priority,
                    stopNext,
                    selectedDealerCodes
                })
                setPackageEditingId(id)
                setPackageDraft(null)
                setPackageOpen(true)
                return
            }

            setError('Bu kampanya tipi için düzenleme henüz desteklenmiyor.')
        } catch (e: any) {
            setError(String(e?.message ?? 'Kampanya düzenleme verisi alınamadı'))
        }
    }

    const parsePackageItems = (jsonText: string | null | undefined) => {
        const raw = String(jsonText ?? '').trim()
        if (!raw) return [] as Array<{ stockCode: string; quantity: number }>
        try {
            const arr = JSON.parse(raw)
            if (!Array.isArray(arr)) return []
            return arr
                .map((x: any) => ({ stockCode: String(x?.stockCode ?? x?.stokKodu ?? '').trim(), quantity: Number(x?.quantity ?? x?.adet ?? 0) }))
                .filter((x: any) => x.stockCode)
        } catch {
            return []
        }
    }

    const discountTypeLabel = (v: any) => {
        const s = String(v ?? '').trim().toLowerCase()
        if (s === 'tutar' || s === '1') return 'Tutar'
        if (s === 'oran' || s === '2') return 'Oran'
        return String(v ?? '').trim()
    }

    const conditionTypeLabel = (v: any) => {
        const n = Number(v)
        if (n === 1) return 'Minimum Adet'
        if (n === 2) return 'Minimum Tutar'
        if (n === 3) return 'Kategori Bazlı'
        if (n === 4) return 'Ürün Bazlı'
        if (n === 5) return 'Müşteri Grubu Bazlı'
        if (n === 6) return 'Paket Ürünleri'
        return String(v ?? '').trim()
    }

    const actionTypeLabel = (v: any) => {
        const n = Number(v)
        if (n === 1) return 'Oransal İndirim'
        if (n === 2) return 'Tutar İndirim'
        if (n === 3) return 'Hediye Ürün'
        if (n === 4) return 'Ücretsiz Kargo'
        if (n === 5) return 'Fiyat Grubu Değiştir'
        const s = String(v ?? '').trim().toLowerCase()
        if (s.includes('percentage')) return 'Oransal İndirim'
        if (s.includes('fixed')) return 'Tutar İndirim'
        if (s.includes('gift')) return 'Hediye Ürün'
        if (s.includes('free')) return 'Ücretsiz Kargo'
        if (s.includes('pricegroup')) return 'Fiyat Grubu Değiştir'
        return String(v ?? '').trim()
    }

    const targetTypeLabel = (v: any) => {
        const n = Number(v)
        if (n === 1) return 'Tüm Müşteriler'
        if (n === 2) return 'Belirli Müşteri'
        if (n === 3) return 'Bölge'
        if (n === 4) return 'Müşteri Fiyat Grubu'
        return String(v ?? '').trim()
    }

    const fmtDiscountValue = (kind: any, value: any) => {
        const t = discountTypeLabel(kind)
        const n = Number(value ?? 0)
        if (t === 'Oran') return `%${n}`
        if (t === 'Tutar') return `${n} TL`
        return String(value ?? '')
    }

    const priceGroupsLabel = (d: any) => {
        const out: number[] = []
        if (d?.iskontoFiyat1 != null) out.push(1)
        if (d?.iskontoFiyat2 != null) out.push(2)
        if (d?.iskontoFiyat3 != null) out.push(3)
        if (d?.iskontoFiyat4 != null) out.push(4)
        if (d?.iskontoFiyat5 != null) out.push(5)
        if (d?.iskontoFiyat6 != null) out.push(6)
        return out.length ? out.join(', ') : '-'
    }

    return (
        <div>
            <div className="flex items-center justify-between mb-5">
                <div>
                    <h1 className="text-xl font-bold text-gray-900 tracking-tight">Kampanya Listesi</h1>
                    <p className="text-xs text-gray-400 mt-0.5">Pazarlama / Kampanyalar</p>
                </div>
                <button
                    type="button"
                    className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition"
                    onClick={() => setCreateOpen(true)}
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    Kampanya Ekle
                </button>
            </div>

            {/* Muhasebe ve Kampanya Ayarları Paneli */}
            <div className="mb-6 p-4 bg-white border border-gray-100 rounded-xl shadow-sm">
                <h2 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Hediye Ürün Muhasebe & Kampanya Ayarları
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end max-w-xl">
                    <div>
                        <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">Sembolik Hediye Birim Fiyatı (TL)</label>
                        <input
                            type="text"
                            value={giftSymbolicPrice}
                            onChange={(e) => setGiftSymbolicPrice(e.target.value)}
                            placeholder="0.01"
                            className="w-full text-xs border border-gray-200 rounded px-3 py-2 h-9 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        />
                    </div>
                    <div>
                        <button
                            type="button"
                            disabled={settingsSaving || settingsLoading}
                            onClick={() => void saveSettings()}
                            className="h-9 px-4 text-xs font-semibold rounded bg-slate-800 hover:bg-slate-700 text-white transition disabled:opacity-50"
                        >
                            {settingsSaving ? 'Kaydediliyor...' : 'Ayarları Kaydet'}
                        </button>
                    </div>
                </div>
            </div>

            {error && <div className="mb-3 text-sm font-semibold text-red-600">{error}</div>}
            {loading && <div className="mb-3 text-sm text-gray-500">Yükleniyor...</div>}

            <div className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-x-auto max-w-full relative">
                <table className="w-full min-w-[1000px] table-fixed">
                    <colgroup>
                        <col style={{ width: '180px' }} />
                        <col style={{ width: '200px' }} />
                        <col style={{ width: '130px' }} />
                        <col style={{ width: '130px' }} />
                        <col style={{ width: '160px' }} />
                        <col style={{ width: '90px' }} />
                        <col style={{ width: '100px' }} />
                        <col style={{ width: '110px' }} />
                    </colgroup>
                    <thead>
                        <tr className="bg-gray-100 border-b border-gray-300">
                            {(
                                [
                                    { key: 'KAMPANYA_ADI', label: 'Kampanya Adı' },
                                    { key: 'KAMPANYA_ACIKLAMA', label: 'Açıklama' },
                                    { key: 'BASLANGIC_TARIH', label: 'Başlangıç Tarihi' },
                                    { key: 'BITIS_TARIH', label: 'Bitiş Tarihi' },
                                    { key: 'KAMPANYA_TIPI', label: 'Kampanya Tipi' },
                                    { key: 'ONCELIK', label: 'Öncelik' },
                                    { key: 'AKTIF', label: 'Aktif' }
                                ] as Array<{ key: ColumnKey; label: string }>
                            ).map((c) => (
                                <th
                                    key={c.key}
                                    className="px-3 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wide"
                                >
                                    <div className="flex items-center justify-center gap-2">
                                        <button
                                            type="button"
                                            className="inline-flex items-center justify-center gap-1"
                                            onClick={() => {
                                                setSort((prev) => {
                                                    if (!prev || prev.key !== c.key) return { key: c.key, dir: 'asc' }
                                                    return { key: c.key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                                                })
                                            }}
                                            title="Sırala"
                                        >
                                            {c.label}
                                            <ArrowUpDown size={12} className="text-gray-500" />
                                        </button>

                                        <div className="relative">
                                            <button
                                                type="button"
                                                className={
                                                    'inline-flex items-center justify-center w-7 h-7 rounded border ' +
                                                    (menuOpenKey === c.key ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white')
                                                }
                                                onClick={() => setMenuOpenKey((prev) => (prev === c.key ? null : c.key))}
                                                title="Filtre"
                                            >
                                                <Filter size={14} className="text-gray-600" />
                                            </button>

                                            {menuOpenKey === c.key && (
                                                <div className="absolute right-0 mt-2 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-30 p-2">
                                                    <div className="text-[11px] font-semibold text-gray-500 uppercase px-2 py-1">Sıralama</div>
                                                    <button
                                                        type="button"
                                                        className="w-full text-left px-2 py-2 text-xs hover:bg-gray-50 rounded"
                                                        onClick={() => {
                                                            setSort({ key: c.key, dir: 'asc' })
                                                            setMenuOpenKey(null)
                                                        }}
                                                    >
                                                        A-Z
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="w-full text-left px-2 py-2 text-xs hover:bg-gray-50 rounded"
                                                        onClick={() => {
                                                            setSort({ key: c.key, dir: 'desc' })
                                                            setMenuOpenKey(null)
                                                        }}
                                                    >
                                                        Z-A
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </th>
                            ))}

                            <th className="px-3 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wide">İşlemler</th>
                        </tr>

                        <tr className="bg-white border-b border-gray-200">
                            {(
                                [
                                    { key: 'KAMPANYA_ADI', placeholder: 'Ara...' },
                                    { key: 'KAMPANYA_ACIKLAMA', placeholder: 'Ara...' },
                                    { key: 'BASLANGIC_TARIH', placeholder: 'YYYY-AA-GG' },
                                    { key: 'BITIS_TARIH', placeholder: 'YYYY-AA-GG' },
                                    { key: 'KAMPANYA_TIPI', placeholder: 'Ara...' },
                                    { key: 'ONCELIK', placeholder: 'Ara...' },
                                    { key: 'AKTIF', placeholder: 'Evet/Hayır' }
                                ] as Array<{ key: ColumnKey; placeholder: string }>
                            ).map((c) => (
                                <th key={c.key} className="px-2 py-2">
                                    <div className="relative">
                                        <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                                        <input
                                            value={filters[c.key].q}
                                            onChange={(e) => setFilterQ(c.key, e.target.value)}
                                            placeholder={c.placeholder}
                                            className="w-full text-xs border border-gray-200 rounded pl-7 pr-2 py-2 h-9 focus:outline-none focus:ring-2 focus:ring-blue-200"
                                        />
                                    </div>
                                </th>
                            ))}
                            <th className="px-2 py-2">
                                <div className="text-[11px] text-gray-400 text-center">-</div>
                            </th>
                        </tr>
                    </thead>

                    <tbody>
                        {visibleRows.map((r, idx) => {
                            const parsed = parseCampaignDescription(r.KAMPANYA_ACIKLAMA)
                            const customBg = CAMPAIGN_BACKGROUNDS.find((bg) => bg.id === parsed.bgId)

                            return (
                                <tr
                                    key={r.id}
                                    className={
                                        'border-b border-gray-200 hover:bg-gray-50 transition-colors ' + (idx % 2 === 1 ? 'bg-gray-50/50' : 'bg-white')
                                    }
                                >
                                    <td className="px-3 py-3 text-sm text-gray-800 text-center truncate">{r.KAMPANYA_ADI}</td>
                                    <td className="px-3 py-3 text-sm text-gray-800 text-center truncate">
                                        <div className="flex items-center justify-center gap-2">
                                            {customBg && (
                                                <span
                                                    className="w-3.5 h-3.5 rounded-full shrink-0 border border-slate-300 shadow-sm"
                                                    style={{ background: customBg.style }}
                                                    title={customBg.name}
                                                />
                                            )}
                                            <span className="truncate">{parsed.description || '-'}</span>
                                        </div>
                                    </td>
                                    <td className="px-3 py-3 text-sm text-gray-800 text-center">{r.BASLANGIC_TARIH}</td>
                                    <td className="px-3 py-3 text-sm text-gray-800 text-center">{r.BITIS_TARIH}</td>
                                    <td className="px-3 py-3 text-sm text-gray-800 text-center truncate">{r.KAMPANYA_TIPI || '-'}</td>
                                    <td className="px-3 py-3 text-sm text-gray-800 text-center">{r.ONCELIK}</td>
                                    <td className="px-3 py-3 text-sm text-gray-800 text-center">
                                        <input type="checkbox" checked={r.AKTIF} onChange={() => toggleAktif(r.id)} className="h-4 w-4" />
                                    </td>
                                    <td className="px-3 py-3 text-sm text-gray-800">
                                        <div className="flex items-center justify-center">
                                            <ActionDropdown
                                                items={[
                                                    {
                                                        key: 'detail',
                                                        label: 'Detay',
                                                        onClick: () => void openDetails(r.id)
                                                    },
                                                    {
                                                        key: 'edit',
                                                        label: 'Düzenle',
                                                        onClick: () => void openEdit(r.id)
                                                    },
                                                    {
                                                        key: 'delete',
                                                        label: 'Sil',
                                                        danger: true,
                                                        onClick: () => setDeleteCampaignConfirm({ id: r.id, name: String(r.KAMPANYA_ADI ?? '').trim() })
                                                    }
                                                ]}
                                            />
                                        </div>
                                    </td>
                                </tr>
                            )
                        })}

                        {visibleRows.length === 0 && (
                            <tr>
                                <td colSpan={8} className="px-6 py-10 text-center text-sm text-gray-500">
                                    Kriterlere uygun kayıt bulunamadı.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {deleteCampaignConfirm != null && (
                <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-6">
                    <div className="bg-white w-full max-w-md rounded-lg shadow-2xl border border-gray-200 p-8 text-center">
                        <div className="mx-auto w-14 h-14 rounded-full border-4 border-yellow-400 flex items-center justify-center text-yellow-500 text-3xl font-extrabold">
                            !
                        </div>
                        <div className="mt-5 text-lg font-semibold text-gray-900">Kampanya silinsin mi?</div>
                        <div className="mt-3 text-sm text-gray-700">
                            <span className="font-semibold text-gray-900">{deleteCampaignConfirm?.name || '-'}</span> kampanyasını silmek istediğinize emin misiniz?
                        </div>

                        {deleteCampaignError && <div className="mt-3 text-sm font-semibold text-red-600">{deleteCampaignError}</div>}

                        <div className="mt-6 flex items-center justify-center gap-4">
                            <button
                                type="button"
                                className="px-6 py-2 text-sm font-semibold bg-pink-600 text-white rounded hover:bg-pink-700 disabled:bg-gray-200 disabled:text-gray-500"
                                disabled={deleteCampaignLoading}
                                onClick={() => void confirmDeleteCampaign()}
                            >
                                Evet
                            </button>
                            <button
                                type="button"
                                className="px-6 py-2 text-sm font-semibold bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-200 disabled:text-gray-500"
                                disabled={deleteCampaignLoading}
                                onClick={() => {
                                    setDeleteCampaignConfirm(null)
                                    setDeleteCampaignError(null)
                                }}
                            >
                                Hayır
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="mt-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="text-xs text-gray-500">
                    Toplam: <span className="font-semibold text-gray-700">{total}</span>
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        <div className="text-xs text-gray-600">Sayfa başına</div>
                        <select
                            className="input-base h-9 text-xs"
                            value={String(pageSize)}
                            onChange={(e) => {
                                setPageSize(Number(e.target.value) || 20)
                                setPage(1)
                            }}
                        >
                            {[10, 20, 50, 100].map((n) => (
                                <option key={n} value={String(n)}>
                                    {n}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            disabled={page <= 1}
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            className={
                                'px-3 py-2 text-xs font-semibold rounded border ' +
                                (page <= 1 ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' : 'bg-white text-gray-700 border-gray-300')
                            }
                        >
                            Geri
                        </button>

                        {pageButtons.map((p, idx) =>
                            p === '...' ? (
                                <div key={`e_${idx}`} className="px-2 text-xs text-gray-400">
                                    ...
                                </div>
                            ) : (
                                <button
                                    key={p}
                                    type="button"
                                    onClick={() => setPage(p)}
                                    className={
                                        'w-9 h-9 text-xs font-semibold rounded border ' +
                                        (p === page ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50')
                                    }
                                >
                                    {p}
                                </button>
                            )
                        )}

                        <button
                            type="button"
                            disabled={page >= totalPages}
                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                            className={
                                'px-3 py-2 text-xs font-semibold rounded border ' +
                                (page >= totalPages ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' : 'bg-white text-gray-700 border-gray-300')
                            }
                        >
                            İleri
                        </button>
                    </div>
                </div>
            </div>

            <CampaignCreateModal
                isOpen={createOpen}
                onClose={() => setCreateOpen(false)}
                onContinue={(draft) => {
                    setCreateOpen(false)

                    const type = String(draft.KAMPANYA_TIPI ?? '').trim()
                    if (type === 'BasketTotalDiscount' || type === '1') {
                        setBasketDiscountDraft({
                            name: draft.KAMPANYA_ADI,
                            description: draft.KAMPANYA_ACIKLAMA,
                            startDate: draft.BASLANGIC_TARIH,
                            endDate: draft.BITIS_TARIH
                        })
                        setBasketDiscountOpen(true)
                    }
                    if (type === 'QuantityTieredDiscount' || type === '2') {
                        setQtyTierDraft({
                            name: draft.KAMPANYA_ADI,
                            description: draft.KAMPANYA_ACIKLAMA,
                            startDate: draft.BASLANGIC_TARIH,
                            endDate: draft.BITIS_TARIH
                        })
                        setQtyTierOpen(true)
                    }

                    if (type === 'BuyXGetY' || type === '3') {
                        setBuyXGetYDraft({
                            name: draft.KAMPANYA_ADI,
                            description: draft.KAMPANYA_ACIKLAMA,
                            startDate: draft.BASLANGIC_TARIH,
                            endDate: draft.BITIS_TARIH
                        })
                        setBuyXGetYOpen(true)
                    }

                    if (type === 'ProductDiscount' || type === '4') {
                        setProductDiscountDraft({
                            name: draft.KAMPANYA_ADI,
                            description: draft.KAMPANYA_ACIKLAMA,
                            startDate: draft.BASLANGIC_TARIH,
                            endDate: draft.BITIS_TARIH
                        })
                        setProductDiscountOpen(true)
                    }

                    if (type === 'CategoryBrandDiscount' || type === '5') {
                        setCatBrandDraft({
                            name: draft.KAMPANYA_ADI,
                            description: draft.KAMPANYA_ACIKLAMA,
                            startDate: draft.BASLANGIC_TARIH,
                            endDate: draft.BITIS_TARIH
                        })
                        setCatBrandOpen(true)
                    }

                    if (type === 'PackageCampaign' || type === '6') {
                        setPackageDraft({
                            name: draft.KAMPANYA_ADI,
                            description: draft.KAMPANYA_ACIKLAMA,
                            startDate: draft.BASLANGIC_TARIH,
                            endDate: draft.BITIS_TARIH
                        })
                        setPackageOpen(true)
                    }
                }}
            />

            <BasketTotalDiscountModal
                isOpen={basketDiscountOpen}
                onClose={() => {
                    setBasketDiscountOpen(false)
                    setBasketDiscountEditingId(null)
                    setBasketDiscountInitialForm(null)
                }}
                campaignDraft={basketDiscountDraft}
                editingCampaignId={basketDiscountEditingId}
                initialForm={basketDiscountInitialForm}
                onCreated={() => {
                    setBasketDiscountDraft(null)
                    setBasketDiscountEditingId(null)
                    setBasketDiscountInitialForm(null)
                    void load()
                }}
            />

            <QuantityTieredDiscountModal
                isOpen={qtyTierOpen}
                onClose={() => {
                    setQtyTierOpen(false)
                    setQtyTierEditingId(null)
                    setQtyTierInitialForm(null)
                }}
                campaignDraft={qtyTierDraft}
                editingCampaignId={qtyTierEditingId}
                initialForm={qtyTierInitialForm}
                onCreated={() => {
                    setQtyTierDraft(null)
                    setQtyTierEditingId(null)
                    setQtyTierInitialForm(null)
                    void load()
                }}
            />

            <BuyXGetYModal
                isOpen={buyXGetYOpen}
                onClose={() => {
                    setBuyXGetYOpen(false)
                    setBuyXGetYEditingId(null)
                    setBuyXGetYInitialForm(null)
                }}
                campaignDraft={buyXGetYDraft}
                editingCampaignId={buyXGetYEditingId}
                initialForm={buyXGetYInitialForm}
                onCreated={() => {
                    setBuyXGetYDraft(null)
                    setBuyXGetYEditingId(null)
                    setBuyXGetYInitialForm(null)
                    void load()
                }}
            />

            <SelectedProductDiscountModal
                isOpen={productDiscountOpen}
                onClose={() => {
                    setProductDiscountOpen(false)
                    setProductDiscountEditingId(null)
                    setProductDiscountInitialForm(null)
                }}
                campaignDraft={productDiscountDraft}
                editingCampaignId={productDiscountEditingId}
                initialForm={productDiscountInitialForm}
                onCreated={() => {
                    setProductDiscountDraft(null)
                    setProductDiscountEditingId(null)
                    setProductDiscountInitialForm(null)
                    void load()
                }}
            />

            <CategoryBrandDiscountModal
                isOpen={catBrandOpen}
                onClose={() => {
                    setCatBrandOpen(false)
                    setCatBrandEditingId(null)
                    setCatBrandInitialForm(null)
                }}
                campaignDraft={catBrandDraft}
                editingCampaignId={catBrandEditingId}
                initialForm={catBrandInitialForm}
                onCreated={() => {
                    setCatBrandDraft(null)
                    setCatBrandEditingId(null)
                    setCatBrandInitialForm(null)
                    void load()
                }}
            />

            <PackageCampaignModal
                isOpen={packageOpen}
                onClose={() => {
                    setPackageOpen(false)
                    setPackageEditingId(null)
                    setPackageInitialForm(null)
                }}
                campaignDraft={packageDraft}
                editingCampaignId={packageEditingId}
                initialForm={packageInitialForm}
                onCreated={() => {
                    setPackageDraft(null)
                    setPackageEditingId(null)
                    setPackageInitialForm(null)
                    void load()
                }}
            />

            <Modal
                isOpen={detailsOpen}
                onClose={() => {
                    setDetailsOpen(false)
                    setDetails(null)
                    setDetailsError(null)
                }}
                title="Kampanya Detayı"
                footer={
                    <button
                        type="button"
                        className="px-4 py-2 text-xs font-semibold border border-gray-200 text-gray-700 rounded hover:bg-gray-50"
                        onClick={() => {
                            setDetailsOpen(false)
                            setDetails(null)
                            setDetailsError(null)
                        }}
                    >
                        Kapat
                    </button>
                }
                scrollable
            >
                {detailsError && <div className="mb-3 text-sm font-semibold text-red-600">{detailsError}</div>}
                {detailsLoading && <div className="text-sm text-gray-500">Yükleniyor...</div>}

                {!detailsLoading && details && (
                    <div className="space-y-4">
                        <div className="border border-gray-200 rounded-lg bg-white">
                            <div className="px-4 py-2 text-xs font-semibold text-gray-600 uppercase bg-gray-50 border-b border-gray-200">Genel Bilgiler</div>
                            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                                <div>
                                    <div className="text-xs font-semibold text-gray-500">Kampanya Adı</div>
                                    <div className="text-gray-900">{String(details.name ?? '')}</div>
                                </div>
                                <div>
                                    <div className="text-xs font-semibold text-gray-500">Durum</div>
                                    <div className="text-gray-900">{details.isActive ? 'Aktif' : 'Pasif'}</div>
                                </div>
                                <div className="md:col-span-2">
                                    <div className="text-xs font-semibold text-gray-500">Açıklama</div>
                                    <div className="text-gray-900 whitespace-pre-line">{String(details.description ?? '').trim() || '-'}</div>
                                </div>
                                <div>
                                    <div className="text-xs font-semibold text-gray-500">Başlangıç</div>
                                    <div className="text-gray-900">{toDateText(details.startDate)}</div>
                                </div>
                                <div>
                                    <div className="text-xs font-semibold text-gray-500">Bitiş</div>
                                    <div className="text-gray-900">{toDateText(details.endDate)}</div>
                                </div>
                                <div>
                                    <div className="text-xs font-semibold text-gray-500">Öncelik</div>
                                    <div className="text-gray-900">{Number((details as any).priority ?? 0)}</div>
                                </div>
                            </div>
                        </div>

                        <div className="border border-gray-200 rounded-lg bg-white">
                            <div className="px-4 py-2 text-xs font-semibold text-gray-600 uppercase bg-gray-50 border-b border-gray-200">Koşullar / Kapsam</div>
                            <div className="p-4">
                                {(details.conditions ?? []).length === 0 ? (
                                    <div className="text-sm text-gray-500">Koşul bulunamadı.</div>
                                ) : (
                                    <div className="space-y-3">
                                        {(details.conditions ?? []).map((c) => {
                                            const pkg = parsePackageItems((c as any).packageItemsJson)
                                            const stocks = ((c as any).productStockCodes ?? []) as string[]
                                            const min = (c as any).minimum
                                            const max = (c as any).maximum
                                            const op = String((c as any).operator ?? '').trim()
                                            const val = (c as any).value
                                            return (
                                                <div key={String((c as any).id ?? '')} className="border border-gray-200 rounded-lg">
                                                    <div className="px-3 py-2 text-xs font-semibold bg-gray-50 border-b border-gray-200">{conditionTypeLabel((c as any).conditionType)}</div>
                                                    <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                                                        <div>
                                                            <div className="text-xs font-semibold text-gray-500">Kategori</div>
                                                            <div className="text-gray-900">{String((c as any).categoryCode ?? '').trim() || '-'}</div>
                                                        </div>
                                                        <div>
                                                            <div className="text-xs font-semibold text-gray-500">Koşul</div>
                                                            <div className="text-gray-900">
                                                                {op || val != null ? `${op || ''} ${val != null ? String(val) : ''}`.trim() : '-'}
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <div className="text-xs font-semibold text-gray-500">KOD Alanı</div>
                                                            <div className="text-gray-900">{String((c as any).brandField ?? '').trim() || '-'}</div>
                                                        </div>
                                                        <div>
                                                            <div className="text-xs font-semibold text-gray-500">KOD Değeri</div>
                                                            <div className="text-gray-900">{String((c as any).brandCode ?? '').trim() || '-'}</div>
                                                        </div>

                                                        <div>
                                                            <div className="text-xs font-semibold text-gray-500">Minimum</div>
                                                            <div className="text-gray-900">{min == null ? '-' : Number(min)}</div>
                                                        </div>
                                                        <div>
                                                            <div className="text-xs font-semibold text-gray-500">Maksimum</div>
                                                            <div className="text-gray-900">{max == null ? '-' : Number(max)}</div>
                                                        </div>

                                                        {stocks.length > 0 && (
                                                            <div className="md:col-span-2">
                                                                <div className="text-xs font-semibold text-gray-500 mb-2">Seçili Ürünler</div>
                                                                <div className="flex flex-wrap gap-2">
                                                                    {stocks.slice(0, 50).map((s, idx) => (
                                                                        <div key={s + '_' + idx} className="px-2 py-1 text-xs border border-gray-200 rounded bg-white">
                                                                            {String(s ?? '').trim()}
                                                                        </div>
                                                                    ))}
                                                                    {stocks.length > 50 && (
                                                                        <div className="px-2 py-1 text-xs text-gray-500">+{stocks.length - 50} daha</div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {pkg.length > 0 && (
                                                            <div className="md:col-span-2">
                                                                <div className="text-xs font-semibold text-gray-500 mb-2">Paket Ürünleri</div>
                                                                <div className="border border-gray-200 rounded overflow-hidden">
                                                                    <table className="w-full text-sm">
                                                                        <thead>
                                                                            <tr className="bg-gray-50 text-xs text-gray-600">
                                                                                <th className="px-3 py-2 text-left">Stok Kodu</th>
                                                                                <th className="px-3 py-2 text-right">Adet</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody>
                                                                            {pkg.map((p, idx) => (
                                                                                <tr key={p.stockCode + '_' + idx} className="border-t border-gray-100">
                                                                                    <td className="px-3 py-2">{p.stockCode}</td>
                                                                                    <td className="px-3 py-2 text-right">{p.quantity}</td>
                                                                                </tr>
                                                                            ))}
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="border border-gray-200 rounded-lg bg-white">
                            <div className="px-4 py-2 text-xs font-semibold text-gray-600 uppercase bg-gray-50 border-b border-gray-200">İndirim / Fiyat Grupları</div>
                            <div className="p-4">
                                {(details.discounts ?? []).length === 0 ? (
                                    <div className="text-sm text-gray-500">İndirim kaydı bulunamadı.</div>
                                ) : (
                                    <div className="border border-gray-200 rounded overflow-hidden">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="bg-gray-50 text-xs text-gray-600">
                                                    <th className="px-3 py-2 text-left">Hedef</th>
                                                    <th className="px-3 py-2 text-left">Tip</th>
                                                    <th className="px-3 py-2 text-left">Değer</th>
                                                    <th className="px-3 py-2 text-right">Min. Sepet</th>
                                                    <th className="px-3 py-2 text-left">Fiyat Grupları</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(details.discounts ?? []).map((d: any) => (
                                                    <tr key={String(d?.id ?? '')} className="border-t border-gray-100">
                                                        <td className="px-3 py-2">{String(d?.stokKodu ?? d?.grupKodu ?? '').trim() || '-'}</td>
                                                        <td className="px-3 py-2">{discountTypeLabel(d?.iskontoTipi)}</td>
                                                        <td className="px-3 py-2">{fmtDiscountValue(d?.iskontoTipi, d?.deger)}</td>
                                                        <td className="px-3 py-2 text-right">{Number(d?.minSepetTutari ?? 0)}</td>
                                                        <td className="px-3 py-2">{priceGroupsLabel(d)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </Modal>

            {settingsAlert && settingsAlert.isOpen && (
                <Modal
                    isOpen={settingsAlert.isOpen}
                    onClose={() => setSettingsAlert(null)}
                    title={settingsAlert.title}
                    containerClassName="max-w-md"
                    footer={
                        <button
                            type="button"
                            className="px-5 py-2 text-xs font-bold text-white bg-orange-600 rounded-lg hover:bg-orange-700 transition"
                            onClick={() => setSettingsAlert(null)}
                        >
                            Tamam
                        </button>
                    }
                >
                    <div className="flex flex-col items-center text-center p-4">
                        {settingsAlert.type === 'success' ? (
                            <CheckCircle className="text-green-500 w-14 h-14 mb-3 animate-bounce" />
                        ) : (
                            <AlertCircle className="text-red-500 w-14 h-14 mb-3" />
                        )}
                        <h4 className="text-base font-bold text-gray-800 mb-1">{settingsAlert.title}</h4>
                        <p className="text-xs text-gray-600 font-medium">{settingsAlert.message}</p>
                    </div>
                </Modal>
            )}
        </div>
    )
}
