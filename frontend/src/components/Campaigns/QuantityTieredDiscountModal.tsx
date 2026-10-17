import React, { useEffect, useMemo, useState } from 'react'
import Modal from '../Modal'
import FormInput from '../forms/FormInput'
import FormSelect from '../forms/FormSelect'
import { fetchProductCategoriesStateForDealer } from '../../api/productCategories'
import { fetchProducts } from '../../api/products'
import type { Product } from '../../types/Product'
import { fetchPriceGroups, type PriceGroupDto } from '../../api/priceGroups'
import { createQuantityTieredDiscount, patchQuantityTieredDiscount, type QuantityTierRequest } from '../../api/campaigns'
import DealerSelector from './DealerSelector'
import { CAMPAIGN_BACKGROUNDS, TEXT_COLOR_OPTIONS, parseCampaignDescription, formatCampaignDescription } from '../../utils/campaignBgHelper'

type Props = {
  isOpen: boolean
  onClose: () => void
  campaignDraft: {
    name: string
    description: string
    startDate: string
    endDate: string
  } | null
  editingCampaignId?: string | null
  initialForm?: {
    name: string
    description: string
    startDate: string
    endDate: string
    selectedGroupCode: string
    selectedStockCodes: string[]
    tiers: Array<{
      minQuantityText: string
      maxQuantityText: string
      discountKind: DiscountKind
      discountValueText: string
      priceGroupCodes: number[]
    }>
    priority?: number
    stopNext?: boolean
    selectedDealerCodes?: string[]
  } | null
  onCreated?: (id: string) => void
}

type DiscountKind = 'Oran' | 'Tutar'

type TierForm = {
  id: string
  minQuantityText: string
  maxQuantityText: string
  discountKind: DiscountKind
  discountValueText: string
  priceGroupCodes: number[]
}

function parseDecimal(text: string) {
  const s = String(text ?? '').trim().replace(',', '.')
  if (!s) return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return n
}

function genId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`
}

export default function QuantityTieredDiscountModal({ isOpen, onClose, campaignDraft, editingCampaignId, initialForm, onCreated }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedBgId, setSelectedBgId] = useState('bg-red-silk')
  const [selectedTextColor, setSelectedTextColor] = useState('')
  // Uygulama sırası: BÜYÜK olan ÖNCE uygulanır. Bu alan hiç yoktu; kampanyalar her zaman
  // öncelik 0 ile kaydediliyor, dolayısıyla çakışan kurallarda hangisinin uygulanacağı
  // belirsiz kalıyordu.
  const [priority, setPriority] = useState('0')
  // Bu kampanya uygulanırsa sonraki kampanyalar hiç denenmesin. Varlıkta ve değerlendiricide
  // vardı ama hiçbir ekrandan ayarlanamıyordu; kampanyalar her zaman üst üste biniyordu.
  const [stopNext, setStopNext] = useState(false)
  // Kampanyanin uygulanacagi bayiler. BOS = tum bayiler (hedef satiri yazilmaz).
  const [selectedDealerCodes, setSelectedDealerCodes] = useState<string[]>([])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const [groupsLoading, setGroupsLoading] = useState(false)
  const [groups, setGroups] = useState<string[]>([])
  const [groupMeta, setGroupMeta] = useState<Record<string, { description?: string | null; status: 'active' | 'passive' }>>({})
  const [selectedGroupCode, setSelectedGroupCode] = useState<string>('')

  const [productsLoading, setProductsLoading] = useState(false)
  const [products, setProducts] = useState<Product[]>([])
  const [selectedStockCodes, setSelectedStockCodes] = useState<string[]>([])
  const [searchTerm, setSearchTerm] = useState('')

  const [priceGroupsLoading, setPriceGroupsLoading] = useState(false)
  const [priceGroups, setPriceGroups] = useState<PriceGroupDto[]>([])

  const [tiers, setTiers] = useState<TierForm[]>([{
    id: genId(),
    minQuantityText: '1',
    maxQuantityText: '',
    discountKind: 'Oran',
    discountValueText: '',
    priceGroupCodes: []
  }])

  const reset = () => {
    setError(null)
    setName('')
    setDescription('')
    setSelectedBgId('bg-red-silk')
    setSelectedTextColor('')
    setPriority('0')
    setStopNext(false)
    setStartDate('')
    setEndDate('')
    setSelectedGroupCode('')
    setSelectedStockCodes([])
    setTiers([{
      id: genId(),
      minQuantityText: '1',
      maxQuantityText: '',
      discountKind: 'Oran',
      discountValueText: '',
      priceGroupCodes: []
    }])
    setSelectedDealerCodes([])
    setGroups([])
    setGroupMeta({})
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  useEffect(() => {
    if (!isOpen) return

    if (initialForm) {
      setName(initialForm.name)
      const parsed = parseCampaignDescription(initialForm.description)
      setDescription(parsed.description)
      setSelectedBgId(parsed.bgId)
      setSelectedTextColor(parsed.textColor || '')
      setStartDate(initialForm.startDate)
      setEndDate(initialForm.endDate)
      setSelectedGroupCode(initialForm.selectedGroupCode)
      setSelectedStockCodes((initialForm.selectedStockCodes ?? []).slice())
      const rawTiers = (initialForm.tiers ?? []).slice().sort((a: any, b: any) => {
        const minA = parseDecimal(String(a?.minQuantityText ?? '0')) ?? 0
        const minB = parseDecimal(String(b?.minQuantityText ?? '0')) ?? 0
        return minA - minB
      })
      setTiers(
        rawTiers.map((t: any) => ({
          id: genId(),
          minQuantityText: String(t.minQuantityText ?? ''),
          maxQuantityText: String(t.maxQuantityText ?? ''),
          discountKind: (t.discountKind ?? 'Oran') as DiscountKind,
          discountValueText: String(t.discountValueText ?? ''),
          priceGroupCodes: (t.priceGroupCodes ?? []).slice()
        }))
      )
      setPriority(String(initialForm.priority ?? 0))
      setStopNext(Boolean(initialForm.stopNext))
      setSelectedDealerCodes(((initialForm as any).selectedDealerCodes ?? []).slice())
    } else if (campaignDraft) {
      setName(campaignDraft.name)
      const parsed = parseCampaignDescription(campaignDraft.description)
      setDescription(parsed.description)
      setSelectedBgId(parsed.bgId)
      setSelectedTextColor(parsed.textColor || '')
      setStartDate(campaignDraft.startDate)
      setEndDate(campaignDraft.endDate)
    }

    void (async () => {
      try {
        setGroupsLoading(true)
        setError(null)
        const state = await fetchProductCategoriesStateForDealer({ includeDealer: true })
        const mains = (state?.mains ?? []).slice()
        setGroups(mains)
        setGroupMeta((state?.meta ?? {}) as any)
      } catch (e: any) {
        setGroups([])
        setGroupMeta({})
        setError(String(e?.message ?? 'Kategoriler alınamadı'))
      } finally {
        setGroupsLoading(false)
      }
    })()

    void (async () => {
      try {
        setPriceGroupsLoading(true)
        setError(null)
        const data = await fetchPriceGroups({ includeInactive: false })
        setPriceGroups(data)
      } catch (e: any) {
        setPriceGroups([])
        setError(String(e?.message ?? 'Fiyat grupları alınamadı'))
      } finally {
        setPriceGroupsLoading(false)
      }
    })()
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    setSearchTerm('')

    if (!selectedGroupCode.trim()) {
      setProducts([])
      return
    }

    void (async () => {
      try {
        setProductsLoading(true)
        setError(null)
        const res = await fetchProducts({ main: selectedGroupCode.trim(), page: 1, pageSize: 200, includeDealer: true })
        setProducts(res.items as any)
      } catch (e: any) {
        setProducts([])
        setError(String(e?.message ?? 'Ürünler alınamadı'))
      } finally {
        setProductsLoading(false)
      }
    })()
  }, [isOpen, selectedGroupCode])

  const groupOptions = useMemo(() => {
    const items = (groups ?? [])
      .map((code) => {
        const meta = groupMeta?.[code]
        const desc = String(meta?.description ?? '').trim()
        return { value: code, label: desc ? `${code} - ${desc}` : code }
      })
      .sort((a, b) => a.label.localeCompare(b.label, 'tr'))
    return [{ value: '', label: groupsLoading ? 'Yükleniyor...' : 'Kategori seçin', disabled: true }, ...items]
  }, [groupMeta, groups, groupsLoading])

  const toggleStock = (code: string) => {
    setSelectedStockCodes((prev) => {
      const exists = prev.includes(code)
      return exists ? prev.filter((x) => x !== code) : [...prev, code]
    })
  }

  const toggleTierPriceGroup = (tierId: string, code: number) => {
    setTiers((prev) =>
      prev.map((t) => {
        if (t.id !== tierId) return t
        const exists = t.priceGroupCodes.includes(code)
        const next = exists ? t.priceGroupCodes.filter((x) => x !== code) : [...t.priceGroupCodes, code]
        return { ...t, priceGroupCodes: next }
      })
    )
  }

  const addTier = () => {
    setTiers((prev) => {
      const last = prev[prev.length - 1]
      const lastMax = last ? parseDecimal(last.maxQuantityText) : null

      if (lastMax == null) {
        setError('Yeni koşul eklemek için önceki koşulun Max adet değerini girin.')
        return prev
      }

      const nextMin = lastMax + 1
      return [
        ...prev,
        {
          id: genId(),
          minQuantityText: String(nextMin),
          maxQuantityText: '',
          discountKind: 'Oran',
          discountValueText: '',
          priceGroupCodes: []
        }
      ]
    })
  }

  const removeTier = (tierId: string) => {
    setTiers((prev) => prev.filter((t) => t.id !== tierId))
  }

  const validate = () => {
    if (!name.trim()) return 'Kampanya adı zorunlu.'
    if (!startDate) return 'Başlangıç tarihi zorunlu.'
    if (!endDate) return 'Bitiş tarihi zorunlu.'

    // Edit modunda yalnızca başlık alanları (ad/açıklama/tarih) değiştiriliyorsa,
    // mevcut tier verisi (eski kampanyalar / kısmi hydrate) validasyonda hata üretebiliyor.
    // Bu senaryoda tier/target validasyonunu bypass edip sadece başlık alanlarını kaydetmeye izin veriyoruz.
    if (editingCampaignId && initialForm) {
      const base = initialForm as any

      const baseGroup = String(base.selectedGroupCode ?? '').trim()
      const currentGroup = String(selectedGroupCode ?? '').trim()
      const effectiveGroup = currentGroup || baseGroup

      const targetsSame =
        effectiveGroup === baseGroup &&
        ((currentGroup ? (selectedStockCodes ?? []) : (base.selectedStockCodes ?? [])) as string[])
          .slice()
          .sort()
          .join(',') === (base.selectedStockCodes ?? []).slice().sort().join(',')

      const normCurrentTiers = (tiers ?? []).map((t) => ({
        minQuantity: Number(parseDecimal(t.minQuantityText) ?? 0),
        maxQuantity: t.maxQuantityText ? Number(parseDecimal(t.maxQuantityText) ?? 0) : null,
        discountType: t.discountKind,
        discountValue: Number(parseDecimal(t.discountValueText) ?? 0),
        priceGroupCodes: (t.priceGroupCodes ?? []).slice().sort((a, b) => a - b)
      }))
      const normBaseTiers = (base.tiers ?? []).map((t: any) => ({
        minQuantity: Number(t?.minQuantityText ?? 0),
        maxQuantity: t?.maxQuantityText ? Number(t.maxQuantityText) : null,
        discountType: t?.discountKind,
        discountValue: Number(String(t?.discountValueText ?? '0').replace(',', '.')),
        priceGroupCodes: (t?.priceGroupCodes ?? []).slice().sort((a: any, b: any) => a - b)
      }))

      const tiersSame = JSON.stringify(normCurrentTiers) === JSON.stringify(normBaseTiers)

      if (targetsSame && tiersSame) return null
    }

    if (!selectedGroupCode.trim()) return 'Kategori seçimi zorunlu.'
    if (tiers.length === 0) return 'En az 1 koşul (kademe) eklemelisiniz.'

    const parsed = tiers.map((t, idx) => {
      const min = parseDecimal(t.minQuantityText)
      const max = parseDecimal(t.maxQuantityText)
      const value = parseDecimal(t.discountValueText)
      if (min == null || min <= 0) return { ok: false as const, msg: `Kademeler: ${idx + 1}. satır min adet geçersiz` }
      if (max != null && max < min) return { ok: false as const, msg: `Kademeler: ${idx + 1}. satır max adet min’den küçük olamaz` }
      if (value == null || value < 0) return { ok: false as const, msg: `Kademeler: ${idx + 1}. satır indirim değeri geçersiz` }
      if (t.discountKind === 'Oran' && value > 100) return { ok: false as const, msg: `Kademeler: ${idx + 1}. satır oran 100’den büyük olamaz` }
      const pgs = t.priceGroupCodes && t.priceGroupCodes.length > 0 ? t.priceGroupCodes : (priceGroups.length > 0 ? priceGroups.map(pg => Number((pg as any).code)).filter(c => Number.isFinite(c)) : [1, 2, 3, 4, 5, 6, 7])
      return { ok: true as const, min, max: max == null ? null : max, value, priceGroups: pgs }
    })

    for (const p of parsed) {
      if (!p.ok) return p.msg
    }

    const okParsed = parsed.filter((x): x is Extract<typeof x, { ok: true }> => x.ok)

    // Enforce ordered tiers (as entered): tier[i].min must be > tier[i-1].max and tier[i-1].max must exist
    for (let i = 1; i < okParsed.length; i++) {
      const prev = okParsed[i - 1]
      const cur = okParsed[i]
      if (prev.max == null) return `Kademeler: ${i}. satırın Max adedi boşken yeni kademe eklenemez.`
      if (cur.min <= prev.max) return `Kademeler: ${i + 1}. satırın Min adedi, önceki kademenin Max adedinden büyük olmalıdır.`
    }

    for (let pg = 1; pg <= 6; pg++) {
      const ranges = okParsed
        .map((t, idx) => ({ idx, selected: t.priceGroups.includes(pg), min: t.min, max: t.max }))
        .filter((x) => x.selected)

      for (let i = 0; i < ranges.length; i++) {
        for (let j = i + 1; j < ranges.length; j++) {
          const aMin = ranges[i].min
          const aMax = ranges[i].max ?? Number.POSITIVE_INFINITY
          const bMin = ranges[j].min
          const bMax = ranges[j].max ?? Number.POSITIVE_INFINITY
          const overlap = aMin <= bMax && bMin <= aMax
          if (overlap) return `Fiyat ${pg} için miktar aralıkları çakışıyor (kademeler: ${ranges[i].idx + 1} ve ${ranges[j].idx + 1})`
        }
      }
    }

    return null
  }

  const canSave = useMemo(
    () => validate() == null && !loading,
    [editingCampaignId, initialForm, name, description, startDate, endDate, selectedGroupCode, selectedStockCodes, tiers, loading]
  )

  const handleSave = async () => {
    const msg = validate()
    if (msg) {
      setError(msg)
      return
    }

    try {
      setLoading(true)
      setError(null)

      const sortedTiers = tiers.slice().sort((a, b) => {
        const minA = parseDecimal(a.minQuantityText) ?? 0
        const minB = parseDecimal(b.minQuantityText) ?? 0
        return minA - minB
      })

      const mappedTiers: QuantityTierRequest[] = sortedTiers.map((t) => {
        const min = parseDecimal(t.minQuantityText) ?? 0
        const max = parseDecimal(t.maxQuantityText)
        const val = parseDecimal(t.discountValueText) ?? 0
        return {
          minQuantity: min,
          maxQuantity: max == null ? null : max,
          discountType: t.discountKind,
          discountValue: val,
          priceGroupCodes: t.priceGroupCodes && t.priceGroupCodes.length > 0 ? t.priceGroupCodes.slice().sort((a, b) => a - b) : (priceGroups.length > 0 ? priceGroups.map(pg => Number((pg as any).code)).filter(c => Number.isFinite(c)) : [1, 2, 3, 4, 5, 6, 7])
        }
      })

      if (editingCampaignId) {
        const patch: any = {}
        const base = initialForm ?? ({} as any)
        const finalDescription = formatCampaignDescription(description, selectedBgId, selectedTextColor)

        const baseGroup = String((base as any).selectedGroupCode ?? '').trim()
        const currentGroup = String(selectedGroupCode ?? '').trim()
        const effectiveGroup = currentGroup || baseGroup

        const effectiveStockCodes: string[] = (currentGroup ? (selectedStockCodes ?? []) : ((base as any).selectedStockCodes ?? []))
          .slice()
          .map((x: any) => String(x ?? '').trim())
          .filter(Boolean)

        if (name.trim() !== String(base.name ?? '').trim()) patch.name = name.trim()
        if (finalDescription !== String(base.description ?? '')) patch.description = finalDescription
        if (startDate !== String(base.startDate ?? '')) patch.startDate = startDate
        if (endDate !== String(base.endDate ?? '')) patch.endDate = endDate

        // When edit modal is opened, selection UI might not be hydrated; avoid sending invalid empty groupCodes.
        if (effectiveGroup && effectiveGroup !== baseGroup) patch.groupCodes = [effectiveGroup]

        const aStocks = (effectiveStockCodes ?? []).slice().sort().join(',')
        const bStocks = (base.selectedStockCodes ?? []).slice().sort().join(',')
        if (aStocks !== bStocks) patch.productStockCodes = effectiveStockCodes

        const normTiers = mappedTiers.map((t) => ({
          minQuantity: t.minQuantity,
          maxQuantity: t.maxQuantity ?? null,
          discountType: t.discountType,
          discountValue: t.discountValue,
          priceGroupCodes: (t.priceGroupCodes ?? []).slice().sort((a, b) => a - b)
        }))
        const baseNorm = (base.tiers ?? []).map((t: any) => ({
          minQuantity: parseDecimal(String(t?.minQuantityText ?? '0')) ?? 0,
          maxQuantity: t?.maxQuantityText ? parseDecimal(String(t.maxQuantityText)) ?? null : null,
          discountType: t?.discountKind,
          discountValue: parseDecimal(String(t?.discountValueText ?? '0')) ?? 0,
          priceGroupCodes: (t?.priceGroupCodes ?? []).slice().sort((a: any, b: any) => a - b)
        }))
        if (JSON.stringify(normTiers) !== JSON.stringify(baseNorm)) patch.tiers = mappedTiers

        if ((Number(priority) || 0) !== (Number(base.priority) || 0)) patch.priority = Number(priority) || 0
        if (Boolean(stopNext) !== Boolean(base.stopNext)) patch.stopNext = stopNext

        const dA = (selectedDealerCodes ?? []).slice().sort().join(',')
        const dB = ((base as any).selectedDealerCodes ?? []).slice().sort().join(',')
        if (dA !== dB) patch.dealerCodes = selectedDealerCodes

        const res = await patchQuantityTieredDiscount(editingCampaignId, patch)
        onCreated?.(res.id)
      } else {
        const finalDescription = formatCampaignDescription(description, selectedBgId, selectedTextColor)
        const r = await createQuantityTieredDiscount({
          name: name.trim(),
          startDate,
          priority: Number(priority) || 0,
          // Bos dizi = tum bayiler. Gonderilmezse bayi kisiti hic kaydedilmez.
          dealerCodes: selectedDealerCodes,
          stopNext,
          endDate,
          description: finalDescription,
          groupCodes: [selectedGroupCode.trim()],
          productStockCodes: selectedStockCodes,
          tiers: mappedTiers
        })

        onCreated?.(r.id)
      }

      handleClose()
    } catch (e: any) {
      setError(String(e?.message ?? 'Kampanya kaydedilemedi'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={editingCampaignId ? 'Adet Bazlı Kademeli İndirim (Düzenle)' : 'Adet Bazlı Kademeli İndirim'}
      footer={
        <>
          <button
            type="button"
            className="px-4 py-2 text-xs font-semibold border border-gray-200 text-gray-700 rounded hover:bg-gray-50"
            onClick={handleClose}
          >
            Vazgeç
          </button>
          <button
            type="button"
            className="px-4 py-2 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-500"
            onClick={handleSave}
            disabled={!canSave}
          >
            Kaydet
          </button>
        </>
      }
    >
      {error && <div className="mb-3 text-sm font-semibold text-red-600">{error}</div>}

      <div className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormInput label="Kampanya Adı" requiredMark value={name} onChange={(e) => setName(e.target.value)} />
          <FormInput label="Açıklama" value={description} onChange={(e) => setDescription(e.target.value)} />
          <FormInput label="Başlangıç Tarihi" requiredMark type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <FormInput label="Bitiş Tarihi" requiredMark type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          <FormInput
            label="Öncelik"
            type="number"
            min={0}
            max={1000}
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            hint="Büyük olan önce uygulanır. Aynı ürüne birden fazla kampanya denk gelirse sıralamayı bu belirler."
          />
          <label className="flex items-start gap-2.5 rounded-xl border border-gray-200 bg-gray-50/60 p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={stopNext}
              onChange={(e) => setStopNext(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-xs text-gray-700 leading-relaxed">
              <span className="block font-semibold text-gray-900">Bu kampanya uygulanırsa diğerleri uygulanmasın</span>
              Kampanyalar öncelik sırasına göre üst üste uygulanır. Bu kutu işaretliyse, bu kampanya
              bir siparişe uygulandığı anda daha düşük öncelikli kampanyalar hiç denenmez.
            </span>
          </label>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-2">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Kampanya Arka Planı</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {CAMPAIGN_BACKGROUNDS.map((bg) => {
                const isSelected = selectedBgId === bg.id
                const effectiveColor = selectedTextColor || bg.textColor
                return (
                  <button
                    key={bg.id}
                    type="button"
                    onClick={() => setSelectedBgId(bg.id)}
                    className={`relative h-12 rounded-xl overflow-hidden text-center flex flex-col items-center justify-center border-2 transition-all duration-200 hover:scale-[1.01] ${
                      isSelected ? 'border-blue-600 ring-2 ring-blue-100 scale-[1.02]' : 'border-slate-200 hover:border-slate-400'
                    }`}
                    style={{ background: bg.style }}
                  >
                    <span
                      className="text-[11px] font-extrabold px-1 text-center truncate w-full"
                      style={{ color: effectiveColor, textShadow: bg.textShadow }}
                    >
                      {bg.name}
                    </span>
                    {isSelected && (
                      <div className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-blue-600 border border-white flex items-center justify-center shadow-sm">
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="4">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Yazı Rengi</label>
            <div className="flex flex-wrap gap-1.5 p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
              {TEXT_COLOR_OPTIONS.map((opt) => {
                const isSelected = selectedTextColor === opt.color
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSelectedTextColor(opt.color)}
                    title={opt.name}
                    className={`h-7 px-2 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 border ${
                      isSelected
                        ? 'border-blue-600 ring-2 ring-blue-200 font-extrabold bg-blue-50 text-blue-900 scale-105'
                        : 'border-slate-300 hover:border-slate-400 bg-white text-slate-700'
                    }`}
                  >
                    {opt.color ? (
                      <span className="w-3 h-3 rounded-full border border-black/20 shrink-0" style={{ backgroundColor: opt.color }} />
                    ) : (
                      <span className="w-3 h-3 rounded-full border border-slate-300 bg-linear-to-tr from-slate-200 to-slate-400 shrink-0" />
                    )}
                    <span>{opt.name}</span>
                  </button>
                )
              })}
              
              {/* Custom Color Picker */}
              <div className="flex items-center gap-1 mt-1 pt-1 border-t border-slate-200 w-full">
                <span className="text-[10px] font-bold text-slate-500 uppercase">Özel Renk:</span>
                <input
                  type="color"
                  value={selectedTextColor || '#ffffff'}
                  onChange={(e) => setSelectedTextColor(e.target.value)}
                  className="w-6 h-6 rounded cursor-pointer border border-slate-300 bg-transparent p-0"
                  title="Özel Renk Seç"
                />
                <span className="text-[11px] font-mono text-slate-600 ml-1">{selectedTextColor || 'Varsayılan'}</span>
                {selectedTextColor && (
                  <button
                    type="button"
                    onClick={() => setSelectedTextColor('')}
                    className="text-[10px] text-red-600 hover:underline ml-auto font-semibold"
                  >
                    Temizle
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="border border-gray-200 rounded-xl p-4 bg-white">
            <div className="text-sm font-extrabold text-gray-900 mb-3">Hedef Seçimi</div>

            <FormSelect
              label="Kategori"
              requiredMark
              value={selectedGroupCode}
              options={groupOptions}
              onChange={(e) => {
                setSelectedGroupCode(String(e.target.value ?? ''))
                setSelectedStockCodes([])
                if (error) setError(null)
              }}
            />

            <div className="mt-4">
              <div className="text-xs font-semibold text-gray-700 mb-2">Ürünler (Kategoriye göre)</div>

              {selectedGroupCode.trim() && !productsLoading && products.length > 0 && (
                <div className="mb-2">
                  <input
                    type="text"
                    placeholder="Ürün koduna veya adına göre filtrele..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded px-2.5 py-1.5 h-8 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </div>
              )}

              <div className="border border-gray-200 rounded-lg p-2 max-h-[240px] overflow-auto bg-gray-50">
                {!selectedGroupCode.trim() && <div className="text-xs text-gray-500">Önce kategori seçin.</div>}
                {selectedGroupCode.trim() && productsLoading && <div className="text-xs text-gray-500">Yükleniyor...</div>}
                {selectedGroupCode.trim() && !productsLoading && products.length === 0 && (
                  <div className="text-xs text-gray-500">Bu kategoride ürün bulunamadı.</div>
                )}

                {selectedGroupCode.trim() &&
                  !productsLoading &&
                  products
                    .filter((p) => {
                      const q = String(searchTerm ?? '').trim().toLowerCase()
                      if (!q) return true
                      const code = String((p as any).stockCode ?? '').toLowerCase()
                      const name = String((p as any).name ?? '').toLowerCase()
                      return code.includes(q) || name.includes(q)
                    })
                    .map((p) => {
                      const code = String((p as any).stockCode ?? '')
                      if (!code) return null
                      const name = String((p as any).name ?? '')
                      const checked = selectedStockCodes.includes(code)
                      return (
                        <label key={code} className="flex items-center gap-2 py-1 text-xs text-gray-800">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              toggleStock(code)
                              if (error) setError(null)
                            }}
                          />
                          <span className="truncate">{name ? `${code} - ${name}` : code}</span>
                        </label>
                      )
                    })}
              </div>

              <div className="mt-2 text-[11px] text-gray-500">
                Ürün seçmezseniz kampanya seçilen kategorideki tüm ürünler için geçerli kabul edilir.
              </div>
            </div>
          </div>

          <div className="border border-gray-200 rounded-xl p-4 bg-white">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-extrabold text-gray-900">Koşullar (Kademeler)</div>
              <button
                type="button"
                className="px-3 py-2 text-xs font-semibold bg-gray-900 text-white rounded hover:bg-black"
                onClick={addTier}
              >
                Yeni Koşul Ekle
              </button>
            </div>

            <div className="space-y-3">
              {tiers.map((t, idx) => {
                const isOnly = tiers.length === 1
                return (
                  <div key={t.id} className="border border-gray-200 rounded-xl p-3 bg-gray-50">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="text-xs font-extrabold text-gray-800">Kademe {idx + 1}</div>
                      <button
                        type="button"
                        className="px-2 py-1 text-xs font-semibold border border-gray-200 text-gray-700 rounded hover:bg-white disabled:bg-gray-100 disabled:text-gray-300"
                        disabled={isOnly}
                        onClick={() => removeTier(t.id)}
                      >
                        Sil
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <FormInput
                        label="Min. Adet"
                        value={t.minQuantityText}
                        onChange={(e) => {
                          const v = e.target.value
                          setTiers((prev) => prev.map((x) => (x.id === t.id ? { ...x, minQuantityText: v } : x)))
                          if (error) setError(null)
                        }}
                        placeholder="Örn: 1"
                      />
                      <FormInput
                        label="Max. Adet"
                        value={t.maxQuantityText}
                        onChange={(e) => {
                          const v = e.target.value
                          setTiers((prev) => prev.map((x) => (x.id === t.id ? { ...x, maxQuantityText: v } : x)))
                          if (error) setError(null)
                        }}
                        placeholder="Boş: sınırsız"
                      />
                    </div>

                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
                      <div>
                        <div className="text-xs font-semibold text-gray-700 mb-2">İndirim Türü</div>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            className={
                              'px-3 py-2 text-xs font-semibold rounded border ' +
                              (t.discountKind === 'Oran' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-200')
                            }
                            onClick={() => {
                              setTiers((prev) => prev.map((x) => (x.id === t.id ? { ...x, discountKind: 'Oran' } : x)))
                              if (error) setError(null)
                            }}
                          >
                            Oran (%)
                          </button>
                          <button
                            type="button"
                            className={
                              'px-3 py-2 text-xs font-semibold rounded border ' +
                              (t.discountKind === 'Tutar' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-200')
                            }
                            onClick={() => {
                              setTiers((prev) => prev.map((x) => (x.id === t.id ? { ...x, discountKind: 'Tutar' } : x)))
                              if (error) setError(null)
                            }}
                          >
                            Tutar (TL)
                          </button>
                        </div>
                      </div>

                      <FormInput
                        label="Değer"
                        value={t.discountValueText}
                        onChange={(e) => {
                          const v = e.target.value
                          setTiers((prev) => prev.map((x) => (x.id === t.id ? { ...x, discountValueText: v } : x)))
                          if (error) setError(null)
                        }}
                        placeholder={t.discountKind === 'Oran' ? 'Örn: 10' : 'Örn: 50'}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          {/* Bayi secimi, fiyat gruplarinin hemen ardinda. Fiyat gruplari kademe bazinda
              seciliyor ama bayi hedefi KAMPANYA seviyesinde (CampaignTargets); bu yuzden
              tek blok halinde ve kademelerin altinda duruyor. */}
          <div className="mt-4 pt-3 border-t border-gray-200">
            <DealerSelector
              selectedDealerCodes={selectedDealerCodes}
              onChange={(next) => {
                setSelectedDealerCodes(next)
                if (error) setError(null)
              }}
            />
          </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
