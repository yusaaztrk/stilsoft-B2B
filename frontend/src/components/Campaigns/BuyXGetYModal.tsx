import React, { useEffect, useMemo, useState } from 'react'
import Modal from '../Modal'
import FormInput from '../forms/FormInput'
import FormSelect from '../forms/FormSelect'
import { fetchProductCategoriesStateForDealer } from '../../api/productCategories'
import { fetchProducts } from '../../api/products'
import type { Product } from '../../types/Product'
import { fetchPriceGroups, type PriceGroupDto } from '../../api/priceGroups'
import { createBuyXGetY, patchBuyXGetY, type BuyXGetYRewardLineRequest } from '../../api/campaigns'
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
    triggerGroupCode: string
    triggerStockCodes: string[]
    triggerMinQtyText: string
    rewardLines: Array<{
      targetGroupCode: string
      targetProductId: string
      quantityText: string
      mode: 'gift' | 'discount'
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

type RewardFormLine = {
  id: string
  targetGroupCode: string
  targetProductId: string
  quantityText: string
  mode: 'gift' | 'discount'
  discountKind: DiscountKind
  discountValueText: string
  priceGroupCodes: number[]
  searchTerm?: string
}

function genId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function parseIntSafe(text: string) {
  const s = String(text ?? '').trim()
  if (!s) return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  const i = Math.floor(n)
  return i
}

function parseDecimal(text: string) {
  const s = String(text ?? '').trim().replace(',', '.')
  if (!s) return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return n
}

export default function BuyXGetYModal({ isOpen, onClose, campaignDraft, editingCampaignId, initialForm, onCreated }: Props) {
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

  const [triggerGroupCode, setTriggerGroupCode] = useState('')
  const [triggerProductsLoading, setTriggerProductsLoading] = useState(false)
  const [triggerProducts, setTriggerProducts] = useState<Product[]>([])
  const [triggerStockCodes, setTriggerStockCodes] = useState<string[]>([])
  const [triggerMinQtyText, setTriggerMinQtyText] = useState('1')
  const [triggerSearchTerm, setTriggerSearchTerm] = useState('')

  const [priceGroupsLoading, setPriceGroupsLoading] = useState(false)
  const [priceGroups, setPriceGroups] = useState<PriceGroupDto[]>([])

  const [rewardProductsByGroup, setRewardProductsByGroup] = useState<Record<string, Product[]>>({})

  const [rewardLines, setRewardLines] = useState<RewardFormLine[]>([
    {
      id: genId(),
      targetGroupCode: '',
      targetProductId: '',
      quantityText: '1',
      mode: 'gift',
      discountKind: 'Oran',
      discountValueText: '',
      priceGroupCodes: []
    }
  ])

  const reset = () => {
    setError(null)
    setName('')
    setDescription('')
    setSelectedBgId('bg-red-silk')
    setSelectedTextColor('')
    setStartDate('')
    setEndDate('')
    setTriggerGroupCode('')
    setTriggerProducts([])
    setTriggerStockCodes([])
    setTriggerMinQtyText('1')
    setGroups([])
    setGroupMeta({})
    setRewardProductsByGroup({})
    setRewardLines([
      {
        id: genId(),
        targetGroupCode: '',
        targetProductId: '',
        quantityText: '1',
        mode: 'gift',
        discountKind: 'Oran',
        discountValueText: '',
        priceGroupCodes: []
      }
    ])
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
      setTriggerGroupCode(initialForm.triggerGroupCode)
      setTriggerStockCodes((initialForm.triggerStockCodes ?? []).slice())
      setTriggerMinQtyText(initialForm.triggerMinQtyText)
      setRewardLines(
        (initialForm.rewardLines ?? []).map((r) => ({
          id: genId(),
          targetGroupCode: String(r.targetGroupCode ?? ''),
          targetProductId: String(r.targetProductId ?? ''),
          quantityText: String(r.quantityText ?? '1'),
          mode: r.mode === 'discount' ? 'discount' : 'gift',
          discountKind: (r.discountKind ?? 'Oran') as DiscountKind,
          discountValueText: String(r.discountValueText ?? ''),
          priceGroupCodes: (r.priceGroupCodes ?? []).slice()
        }))
      )
      ;(initialForm.rewardLines ?? []).forEach((x) => {
        if (x?.targetGroupCode) void ensureRewardProductsLoaded(x.targetGroupCode)
      })
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
    setTriggerSearchTerm('')

    if (!triggerGroupCode.trim()) {
      setTriggerProducts([])
      return
    }

    void (async () => {
      try {
        setTriggerProductsLoading(true)
        setError(null)

        // StockGroups map to Product.GroupCode (main) by default in our fetchProducts usage.
        const res = await fetchProducts({ main: triggerGroupCode.trim(), page: 1, pageSize: 200, includeDealer: true })
        setTriggerProducts(res.items as any)
      } catch (e: any) {
        setTriggerProducts([])
        setError(String(e?.message ?? 'Ürünler alınamadı'))
      } finally {
        setTriggerProductsLoading(false)
      }
    })()
  }, [isOpen, triggerGroupCode])

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

  const toggleTriggerStock = (code: string) => {
    setTriggerStockCodes((prev) => {
      const exists = prev.includes(code)
      return exists ? prev.filter((x) => x !== code) : [...prev, code]
    })
  }

  const ensureRewardProductsLoaded = async (groupCode: string) => {
    const key = String(groupCode ?? '').trim()
    if (!key) return
    if (rewardProductsByGroup[key]) return

    try {
      const res = await fetchProducts({ main: key, page: 1, pageSize: 200, includeDealer: true })
      setRewardProductsByGroup((prev) => ({ ...prev, [key]: res.items as any }))
    } catch (e: any) {
      setRewardProductsByGroup((prev) => ({ ...prev, [key]: [] }))
      setError(String(e?.message ?? 'Hedef ürünler alınamadı'))
    }
  }

  const addRewardLine = () => {
    setRewardLines((prev) => [
      ...prev,
      {
        id: genId(),
        targetGroupCode: '',
        targetProductId: '',
        quantityText: '1',
        mode: 'gift',
        discountKind: 'Oran',
        discountValueText: '',
        priceGroupCodes: []
      }
    ])
  }

  const removeRewardLine = (id: string) => {
    setRewardLines((prev) => prev.filter((x) => x.id !== id))
  }

  const toggleRewardPriceGroup = (lineId: string, code: number) => {
    setRewardLines((prev) =>
      prev.map((l) => {
        if (l.id !== lineId) return l
        const exists = l.priceGroupCodes.includes(code)
        const next = exists ? l.priceGroupCodes.filter((x) => x !== code) : [...l.priceGroupCodes, code]
        return { ...l, priceGroupCodes: next }
      })
    )
  }

  const validate = () => {
    if (!name.trim()) return 'Kampanya adı zorunlu.'
    if (!startDate.trim()) return 'Başlangıç tarihi zorunlu.'
    if (!endDate.trim()) return 'Bitiş tarihi zorunlu.'

    if (!triggerGroupCode.trim()) return 'Ana kategori seçimi zorunlu.'

    const minQty = parseIntSafe(triggerMinQtyText)
    if (minQty == null) return 'Minimum alım adedi zorunlu.'
    if (minQty <= 0) return 'Minimum alım adedi 0’dan büyük olmalıdır.'

    if (!rewardLines || rewardLines.length === 0) return 'En az 1 hedef ürün satırı eklemelisiniz.'

    for (let i = 0; i < rewardLines.length; i++) {
      const r = rewardLines[i]
      const qty = parseIntSafe(r.quantityText)
      if (!r.targetGroupCode.trim()) return `Hedef satır ${i + 1}: Kategori seçimi zorunlu.`
      if (!r.targetProductId.trim()) return `Hedef satır ${i + 1}: Ürün seçimi zorunlu.`
      if (qty == null || qty <= 0) return `Hedef satır ${i + 1}: Adet 0’dan büyük olmalıdır.`

      if (r.mode === 'discount') {
        const dv = parseDecimal(r.discountValueText)
        if (dv == null || dv <= 0) return `Hedef satır ${i + 1}: İndirim değeri zorunlu.`
        if (r.discountKind === 'Oran' && dv > 100) return `Hedef satır ${i + 1}: Oran (%) 100’den büyük olamaz.`
      }
    }

    return null
  }

  const canSave = useMemo(() => validate() == null && !loading, [campaignDraft, triggerGroupCode, triggerMinQtyText, triggerStockCodes, rewardLines, loading])

  const handleSave = async () => {
    const msg = validate()
    if (msg) {
      setError(msg)
      return
    }

    try {
      setLoading(true)
      setError(null)

      const minQty = parseIntSafe(triggerMinQtyText) ?? 1

      const mappedRewards: BuyXGetYRewardLineRequest[] = rewardLines.map((r) => {
        const qty = parseIntSafe(r.quantityText) ?? 1

        return {
          targetProductId: r.targetProductId,
          quantity: qty,
          isGift: r.mode === 'gift',
          discountType: r.mode === 'discount' ? r.discountKind : null,
          discountValue: r.mode === 'discount' ? (parseDecimal(r.discountValueText) ?? 0) : 0,
          priceGroupCodes: r.priceGroupCodes && r.priceGroupCodes.length > 0 ? r.priceGroupCodes.slice().sort((a, b) => a - b) : (priceGroups.length > 0 ? priceGroups.map(pg => Number((pg as any).code)).filter(c => Number.isFinite(c)) : [1, 2, 3, 4, 5, 6, 7])
        }
      })

      if (editingCampaignId) {
        const patch: any = {}
        const base = initialForm ?? ({} as any)
        const finalDescription = formatCampaignDescription(description, selectedBgId, selectedTextColor)

        if (name.trim() !== String(base.name ?? '').trim()) patch.name = name.trim()
        if (finalDescription !== String(base.description ?? '')) patch.description = finalDescription
        if (startDate !== String(base.startDate ?? '')) patch.startDate = startDate
        if (endDate !== String(base.endDate ?? '')) patch.endDate = endDate

        if (triggerGroupCode.trim() !== String(base.triggerGroupCode ?? '').trim()) patch.triggerGroupCode = triggerGroupCode.trim()

        const aStocks = (triggerStockCodes ?? []).slice().sort().join(',')
        const bStocks = (base.triggerStockCodes ?? []).slice().sort().join(',')
        if (aStocks !== bStocks) patch.triggerProductStockCodes = triggerStockCodes

        if (String(minQty) !== String(base.triggerMinQtyText ?? '')) patch.triggerMinQuantity = minQty

        const normalizeRewardForCompare = (arr: any[]) =>
          (arr ?? []).map((r) => ({
            targetProductId: String(r.targetProductId ?? '').trim(),
            quantity: parseIntSafe(String(r.quantityText ?? '1')) ?? 1,
            isGift: r.mode === 'gift',
            discountType: r.mode === 'discount' ? r.discountKind : null,
            discountValue: r.mode === 'discount' ? (parseDecimal(String(r.discountValueText ?? '')) ?? 0) : 0,
            priceGroupCodes: (r.priceGroupCodes ?? []).slice().sort((x: number, y: number) => x - y)
          }))

        const aRewards = normalizeRewardForCompare(rewardLines)
        const bRewards = normalizeRewardForCompare(base.rewardLines ?? [])
        if (JSON.stringify(aRewards) !== JSON.stringify(bRewards)) patch.rewardLines = mappedRewards

        if ((Number(priority) || 0) !== (Number(base.priority) || 0)) patch.priority = Number(priority) || 0
        if (Boolean(stopNext) !== Boolean(base.stopNext)) patch.stopNext = stopNext

        const dA = (selectedDealerCodes ?? []).slice().sort().join(',')
        const dB = ((base as any).selectedDealerCodes ?? []).slice().sort().join(',')
        if (dA !== dB) patch.dealerCodes = selectedDealerCodes

        const res = await patchBuyXGetY(editingCampaignId, patch)
        onCreated?.(res.id)
      } else {
        const finalDescription = formatCampaignDescription(description, selectedBgId, selectedTextColor)
        const res = await createBuyXGetY({
          name: name.trim(),
          description: finalDescription,
          startDate,
          priority: Number(priority) || 0,
          // Bos dizi = tum bayiler. Gonderilmezse bayi kisiti hic kaydedilmez.
          dealerCodes: selectedDealerCodes,
          stopNext,
          endDate,
          triggerGroupCode: triggerGroupCode.trim(),
          triggerProductStockCodes: triggerStockCodes,
          triggerMinQuantity: minQty,
          rewardLines: mappedRewards
        })

        onCreated?.(res.id)
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
      title={editingCampaignId ? 'X Alana Y Hediye / İndirimli Ürün (Düzenle)' : 'X Alana Y Hediye / İndirimli Ürün'}
      maxWidth="max-w-5xl"
      footer={
        <>
          <button
            type="button"
            className="px-4 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition"
            onClick={handleClose}
            disabled={loading}
          >
            İptal
          </button>
          <button
            type="button"
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition shadow-sm"
            onClick={handleSave}
            disabled={!canSave}
          >
            {loading ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl font-medium">{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormInput
            label="Kampanya Adı"
            requiredMark
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (error) setError(null)
            }}
          />
          <FormInput label="Açıklama" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormInput
            label="Başlangıç Tarihi"
            requiredMark
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value)
              if (error) setError(null)
            }}
          />
          <FormInput
            label="Bitiş Tarihi"
            requiredMark
            type="date"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value)
              if (error) setError(null)
            }}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormInput
            label="Öncelik"
            type="number"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            helperText="Büyük olan önce uygulanır. Aynı ürüne birden fazla kampanya denk gelirse sıralamayı bu belirler."
          />

          <label className="flex items-start gap-2.5 p-3 rounded-xl border border-gray-200 bg-gray-50/50 hover:bg-gray-50 cursor-pointer select-none">
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
            <div className="text-sm font-extrabold text-gray-900 mb-3">Ana Koşul (Tetikleyici Ürün)</div>

            <FormSelect
              label="Ana Kategori"
              requiredMark
              value={triggerGroupCode}
              options={groupOptions}
              onChange={(e) => {
                setTriggerGroupCode(String(e.target.value ?? ''))
                setTriggerStockCodes([])
                if (error) setError(null)
              }}
            />

            <div className="mt-3">
              <FormInput
                label="Minimum Alım Adedi"
                requiredMark
                value={triggerMinQtyText}
                inputMode="numeric"
                placeholder="1"
                onChange={(e) => {
                  setTriggerMinQtyText(e.target.value)
                  if (error) setError(null)
                }}
              />
            </div>

            <div className="mt-4">
              <div className="text-xs font-semibold text-gray-700 mb-2">Ana Ürünler (opsiyonel)</div>

              {triggerGroupCode.trim() && !triggerProductsLoading && triggerProducts.length > 0 && (
                <div className="mb-2">
                  <input
                    type="text"
                    placeholder="Ürün koduna veya adına göre filtrele..."
                    value={triggerSearchTerm}
                    onChange={(e) => setTriggerSearchTerm(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded px-2.5 py-1.5 h-8 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </div>
              )}

              <div className="border border-gray-200 rounded-lg p-2 max-h-[240px] overflow-auto bg-gray-50">
                {!triggerGroupCode.trim() && <div className="text-xs text-gray-500">Önce kategori seçin.</div>}
                {triggerGroupCode.trim() && triggerProductsLoading && <div className="text-xs text-gray-500">Yükleniyor...</div>}
                {triggerGroupCode.trim() && !triggerProductsLoading && triggerProducts.length === 0 && (
                  <div className="text-xs text-gray-500">Bu kategoride ürün bulunamadı.</div>
                )}

                {triggerGroupCode.trim() &&
                  !triggerProductsLoading &&
                  triggerProducts
                    .filter((p) => {
                      const q = String(triggerSearchTerm ?? '').trim().toLowerCase()
                      if (!q) return true
                      const code = String((p as any).stockCode ?? '').toLowerCase()
                      const name = String((p as any).name ?? '').toLowerCase()
                      return code.includes(q) || name.includes(q)
                    })
                    .map((p) => {
                      const code = String((p as any).stockCode ?? '')
                      if (!code) return null
                      const name = String((p as any).name ?? '')
                      const checked = triggerStockCodes.includes(code)
                      return (
                        <label key={code} className="flex items-center gap-2 py-1 text-xs text-gray-800">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              toggleTriggerStock(code)
                              if (error) setError(null)
                            }}
                          />
                          <span className="truncate">{name ? `${code} - ${name}` : code}</span>
                        </label>
                      )
                    })}
              </div>

              <div className="mt-2 text-[11px] text-gray-500">
                Ürün seçmezseniz kampanya seçilen kategorideki tüm ürünler için tetiklenir.
              </div>
            </div>
          </div>

          <div className="border border-gray-200 rounded-xl p-4 bg-white">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-extrabold text-gray-900">Hediye / İndirimli Ürünler</div>
              <button
                type="button"
                className="px-3 py-2 text-xs font-semibold bg-gray-900 text-white rounded hover:bg-black"
                onClick={addRewardLine}
              >
                Satır Ekle
              </button>
            </div>

            <div className="space-y-3">
              {rewardLines.map((r, idx) => {
                const isOnly = rewardLines.length === 1
                const productsForGroup = rewardProductsByGroup[r.targetGroupCode] ?? []

                const searchTerm = String(r.searchTerm ?? '').trim().toLowerCase()
                const filteredProducts = productsForGroup.filter((p) => {
                  if (!searchTerm) return true
                  const code = String((p as any).stockCode ?? '').toLowerCase()
                  const name = String((p as any).name ?? '').toLowerCase()
                  return code.includes(searchTerm) || name.includes(searchTerm)
                })

                const productOptions = [
                  { value: '', label: r.targetGroupCode ? 'Ürün seçin' : 'Önce kategori seçin' },
                  ...filteredProducts
                    .map((p) => ({
                      value: String((p as any).id ?? ''),
                      label: (() => {
                        const code = String((p as any).stockCode ?? '').trim()
                        const name = String((p as any).name ?? '').trim()
                        return name ? `${code} - ${name}` : code
                      })()
                    }))
                    .filter((x) => x.value)
                    .sort((a, b) => a.label.localeCompare(b.label, 'tr'))
                ]

                return (
                  <div key={r.id} className="border border-gray-200 rounded-xl p-3 bg-gray-50">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="text-xs font-extrabold text-gray-800">Satır {idx + 1}</div>
                      <button
                        type="button"
                        className="px-2 py-1 text-xs font-semibold border border-gray-200 text-gray-700 rounded hover:bg-white disabled:bg-gray-100 disabled:text-gray-300"
                        disabled={isOnly}
                        onClick={() => removeRewardLine(r.id)}
                      >
                        Sil
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <FormSelect
                        label="Hedef Kategori"
                        requiredMark
                        value={r.targetGroupCode}
                        options={groupOptions}
                        onChange={(e) => {
                          const v = String(e.target.value ?? '')
                          setRewardLines((prev) =>
                            prev.map((x) => (x.id === r.id ? { ...x, targetGroupCode: v, targetProductId: '', searchTerm: '' } : x))
                          )
                          void ensureRewardProductsLoaded(v)
                          if (error) setError(null)
                        }}
                      />

                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
                            Hedef Ürün <span className="text-red-500">*</span>
                          </label>
                          {r.targetGroupCode && (
                            <div className="relative w-44">
                              <input
                                type="text"
                                placeholder="Filtrele..."
                                value={r.searchTerm || ''}
                                onChange={(e) => {
                                  const val = e.target.value
                                  setRewardLines((prev) =>
                                    prev.map((x) => (x.id === r.id ? { ...x, searchTerm: val } : x))
                                  )
                                }}
                                className="w-full text-[11px] border border-gray-200 rounded-md px-2 py-0.5 h-6 focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
                              />
                            </div>
                          )}
                        </div>
                        <FormSelect
                          label=""
                          value={r.targetProductId}
                          options={productOptions}
                          onChange={(e) => {
                            const v = String(e.target.value ?? '')
                            setRewardLines((prev) => prev.map((x) => (x.id === r.id ? { ...x, targetProductId: v } : x)))
                            if (error) setError(null)
                          }}
                        />
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
                      <FormInput
                        label="Adet"
                        requiredMark
                        value={r.quantityText}
                        inputMode="numeric"
                        placeholder="1"
                        onChange={(e) => {
                          const v = e.target.value
                          setRewardLines((prev) => prev.map((x) => (x.id === r.id ? { ...x, quantityText: v } : x)))
                          if (error) setError(null)
                        }}
                      />

                      <div>
                        <div className="text-xs font-semibold text-gray-700 mb-2">Kampanya Türü</div>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            className={
                              'w-full flex items-center justify-center px-4 py-3 text-sm font-semibold rounded border min-h-[44px] ' +
                              (r.mode === 'gift'
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-gray-700 border-gray-200')
                            }
                            onClick={() => {
                              setRewardLines((prev) =>
                                prev.map((x) => (x.id === r.id ? { ...x, mode: 'gift', discountValueText: '' } : x))
                              )
                              if (error) setError(null)
                            }}
                          >
                            <span className="whitespace-nowrap">Hediye</span>
                          </button>
                          <button
                            type="button"
                            className={
                              'w-full flex items-center justify-center px-4 py-3 text-sm font-semibold rounded border min-h-[44px] ' +
                              (r.mode === 'discount'
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-gray-700 border-gray-200')
                            }
                            onClick={() => {
                              setRewardLines((prev) =>
                                prev.map((x) => (x.id === r.id ? { ...x, mode: 'discount' } : x))
                              )
                              if (error) setError(null)
                            }}
                          >
                            <span className="whitespace-nowrap">İndirim</span>
                          </button>
                        </div>
                      </div>
                    </div>



                    {r.mode === 'discount' && (
                      <div className="mt-3 space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
                          <div>
                            <div className="text-xs font-semibold text-gray-700 mb-2">İndirim Tipi</div>
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                className={
                                  'px-3 py-2 text-xs font-semibold rounded border ' +
                                  (r.discountKind === 'Oran'
                                    ? 'bg-blue-600 text-white border-blue-600'
                                    : 'bg-white text-gray-700 border-gray-200')
                                }
                                onClick={() => {
                                  setRewardLines((prev) =>
                                    prev.map((x) => (x.id === r.id ? { ...x, discountKind: 'Oran' } : x))
                                  )
                                  if (error) setError(null)
                                }}
                              >
                                Oran (%)
                              </button>
                              <button
                                type="button"
                                className={
                                  'px-3 py-2 text-xs font-semibold rounded border ' +
                                  (r.discountKind === 'Tutar'
                                    ? 'bg-blue-600 text-white border-blue-600'
                                    : 'bg-white text-gray-700 border-gray-200')
                                }
                                onClick={() => {
                                  setRewardLines((prev) =>
                                    prev.map((x) => (x.id === r.id ? { ...x, discountKind: 'Tutar' } : x))
                                  )
                                  if (error) setError(null)
                                }}
                              >
                                Tutar (TL)
                              </button>
                            </div>
                          </div>

                          <FormInput
                            label="İndirim Değeri"
                            requiredMark
                            value={r.discountValueText}
                            inputMode="decimal"
                            placeholder={r.discountKind === 'Oran' ? '30' : '100'}
                            onChange={(e) => {
                              const v = e.target.value
                              setRewardLines((prev) => prev.map((x) => (x.id === r.id ? { ...x, discountValueText: v } : x)))
                              if (error) setError(null)
                            }}
                          />
                        </div>

                      </div>
                    )}
                  </div>
                )
              })}
            </div>

          {/* Bayi secimi, odul satirlarindaki fiyat gruplarinin hemen ardinda. Fiyat grubu
              satir bazinda seciliyor ama bayi hedefi KAMPANYA seviyesinde (CampaignTargets). */}
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
