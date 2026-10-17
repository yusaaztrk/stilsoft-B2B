import React, { useEffect, useMemo, useState } from 'react'
import Modal from '../Modal'
import FormInput from '../forms/FormInput'
import FormSelect from '../forms/FormSelect'
import { fetchProductCategoriesStateForDealer } from '../../api/productCategories'
import { fetchProducts } from '../../api/products'
import type { Product } from '../../types/Product'
import { fetchPriceGroups, type PriceGroupDto } from '../../api/priceGroups'
import { createBasketTotalDiscount, patchBasketTotalDiscount } from '../../api/campaigns'
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
    groupCode: string
    productStockCodes: string[]
    minBasketTotalText: string
    discountKind: DiscountKind
    discountValueText: string
    selectedPriceGroupCodes: number[]
    selectedDealerCodes?: string[]
    priority?: number
    stopNext?: boolean
  } | null
  onCreated?: (id: string) => void
}

type DiscountKind = 'Oran' | 'Tutar'

function parseDecimal(text: string) {
  const s = String(text ?? '').trim().replace(',', '.')
  if (!s) return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return n
}

export default function BasketTotalDiscountModal({ isOpen, onClose, campaignDraft, editingCampaignId, initialForm, onCreated }: Props) {
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
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const [groupsLoading, setGroupsLoading] = useState(false)
  const [groups, setGroups] = useState<string[]>([])
  const [groupMeta, setGroupMeta] = useState<Record<string, { description?: string | null; status: 'active' | 'passive' }>>({})

  const [productsLoading, setProductsLoading] = useState(false)
  const [products, setProducts] = useState<Product[]>([])

  const [priceGroupsLoading, setPriceGroupsLoading] = useState(false)
  const [priceGroups, setPriceGroups] = useState<PriceGroupDto[]>([])

  const [selectedGroupCode, setSelectedGroupCode] = useState<string>('')
  const [selectedStockCodes, setSelectedStockCodes] = useState<string[]>([])
  const [searchTerm, setSearchTerm] = useState('')

  const [minBasketTotalText, setMinBasketTotalText] = useState('')
  const [discountKind, setDiscountKind] = useState<DiscountKind>('Oran')
  const [discountValueText, setDiscountValueText] = useState('')

  const [selectedPriceGroupCodes, setSelectedPriceGroupCodes] = useState<number[]>([])
  const [selectedDealerCodes, setSelectedDealerCodes] = useState<string[]>([])

  const loadGroups = async () => {
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
  }

  const reset = () => {
    setError(null)
    setName('')
    setDescription('')
    setSelectedBgId('bg-red-silk')
    setSelectedTextColor('')
    setStartDate('')
    setEndDate('')
    setSelectedGroupCode('')
    setSelectedStockCodes([])
    setMinBasketTotalText('')
    setDiscountKind('Oran')
    setDiscountValueText('')
    setSelectedPriceGroupCodes([])
    setSelectedDealerCodes([])
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
      setSelectedGroupCode(initialForm.groupCode)
      setSelectedStockCodes((initialForm.productStockCodes ?? []).slice())
      setMinBasketTotalText(initialForm.minBasketTotalText)
      setDiscountKind(initialForm.discountKind)
      setDiscountValueText(initialForm.discountValueText)
      setSelectedPriceGroupCodes((initialForm.selectedPriceGroupCodes ?? []).slice())
      setSelectedDealerCodes((initialForm.selectedDealerCodes ?? []).slice())
      setPriority(String(initialForm.priority ?? 0))
      setStopNext(Boolean(initialForm.stopNext))
    } else if (campaignDraft) {
      setName(campaignDraft.name)
      const parsed = parseCampaignDescription(campaignDraft.description)
      setDescription(parsed.description)
      setSelectedBgId(parsed.bgId)
      setSelectedTextColor(parsed.textColor || '')
      setStartDate(campaignDraft.startDate)
      setEndDate(campaignDraft.endDate)
    }

    void loadGroups()

    const poll = window.setInterval(() => {
      void loadGroups()
    }, 5000)

    void (async () => {
      try {
        setPriceGroupsLoading(true)
        setError(null)
        const data = await fetchPriceGroups({ includeInactive: false })
        setPriceGroups(data)
      } catch (e: any) {
        setError(String(e?.message ?? 'Fiyat grupları alınamadı'))
      } finally {
        setPriceGroupsLoading(false)
      }
    })()

    return () => window.clearInterval(poll)
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
        // NOTE: ProductsController filters by `main` query param using Product.GroupCode
        const res = await fetchProducts({ main: selectedGroupCode.trim(), page: 1, pageSize: 200, includeDealer: true })
        setProducts(res.items as any)
      } catch (e: any) {
        setError(String(e?.message ?? 'Ürünler alınamadı'))
      } finally {
        setProductsLoading(false)
      }
    })()
  }, [isOpen, selectedGroupCode])

  const groupOptions = useMemo(() => {
    const items = groups
      .map((code) => {
        const meta = groupMeta?.[code]
        const desc = String(meta?.description ?? '').trim()
        return {
          value: code,
          label: desc ? `${code} - ${desc}` : code
        }
      })
      .sort((a, b) => a.label.localeCompare(b.label, 'tr'))

    return [{ value: '', label: groupsLoading ? 'Yükleniyor...' : 'Kategori seçin', disabled: true }, ...items]
  }, [groupMeta, groups, groupsLoading])

  const validate = () => {
    if (!name.trim()) return 'Kampanya adı zorunlu.'
    if (!startDate.trim()) return 'Başlangıç tarihi zorunlu.'
    if (!endDate.trim()) return 'Bitiş tarihi zorunlu.'
    if (!selectedGroupCode.trim()) return 'Kategori seçimi zorunlu.'

    const minBasket = parseDecimal(minBasketTotalText)
    if (minBasket == null) return 'Minimum sepet tutarı zorunlu.'
    if (minBasket < 0) return 'Minimum sepet tutarı 0’dan küçük olamaz.'

    const disc = parseDecimal(discountValueText)
    if (disc == null) return 'İndirim değeri zorunlu.'
    if (disc < 0) return 'İndirim değeri 0’dan küçük olamaz.'

    if (discountKind === 'Oran' && disc > 100) return 'Oran (%) 100’den büyük olamaz.'

    return null
  }

  const canSave = useMemo(
    () => validate() == null && !loading,
    [name, description, startDate, endDate, selectedGroupCode, minBasketTotalText, discountValueText, discountKind, loading]
  )

  const toggleStock = (code: string) => {
    setSelectedStockCodes((prev) => {
      if (prev.includes(code)) return prev.filter((x) => x !== code)
      return [...prev, code]
    })
  }

  const togglePriceGroup = (code: number) => {
    setSelectedPriceGroupCodes((prev) => {
      if (prev.includes(code)) return prev.filter((x) => x !== code)
      return [...prev, code]
    })
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleSave = async () => {
    const msg = validate()
    if (msg) {
      setError(msg)
      return
    }

    try {
      setLoading(true)
      setError(null)

      const minBasket = parseDecimal(minBasketTotalText) ?? 0
      const disc = parseDecimal(discountValueText) ?? 0

      if (editingCampaignId) {
        const patch: any = {}
        const base = initialForm ?? ({} as any)
        const finalDescription = formatCampaignDescription(description, selectedBgId, selectedTextColor)

        if (name.trim() !== String(base.name ?? '').trim()) patch.name = name.trim()
        if (finalDescription !== String(base.description ?? '')) patch.description = finalDescription
        if (startDate !== String(base.startDate ?? '')) patch.startDate = startDate
        if (endDate !== String(base.endDate ?? '')) patch.endDate = endDate

        if (selectedGroupCode !== String(base.groupCode ?? '')) patch.groupCode = selectedGroupCode

        const aStocks = (selectedStockCodes ?? []).slice().sort().join(',')
        const bStocks = (base.productStockCodes ?? []).slice().sort().join(',')
        if (aStocks !== bStocks) patch.productStockCodes = selectedStockCodes

        if (String(minBasket) !== String(base.minBasketTotalText ?? '')) patch.minBasketTotal = minBasket

        if ((discountKind ?? null) !== (base.discountKind ?? null)) patch.discountType = discountKind
        if (String(disc) !== String(base.discountValueText ?? '')) patch.discountValue = disc

        const a = (selectedPriceGroupCodes ?? []).slice().sort().join(',')
        const b = (base.selectedPriceGroupCodes ?? []).slice().sort().join(',')
        if (a !== b) patch.priceGroupCodes = selectedPriceGroupCodes

        const dA = (selectedDealerCodes ?? []).slice().sort().join(',')
        const dB = ((base as any).selectedDealerCodes ?? []).slice().sort().join(',')
        if (dA !== dB) patch.dealerCodes = selectedDealerCodes

        if ((Number(priority) || 0) !== (Number(base.priority) || 0)) patch.priority = Number(priority) || 0
        if (Boolean(stopNext) !== Boolean(base.stopNext)) patch.stopNext = stopNext

        const res = await patchBasketTotalDiscount(editingCampaignId, patch)
        onCreated?.(res.id)
      } else {
        const finalDescription = formatCampaignDescription(description, selectedBgId, selectedTextColor)
        const r = await createBasketTotalDiscount({
          name: name.trim(),
          description: finalDescription,
          startDate,
          priority: Number(priority) || 0,
          stopNext,
          endDate,
          groupCode: selectedGroupCode.trim(),
          productStockCodes: selectedStockCodes,
          minBasketTotal: minBasket,
          discountType: discountKind,
          discountValue: disc,
          priceGroupCodes: selectedPriceGroupCodes.length > 0 ? selectedPriceGroupCodes : (priceGroups.length > 0 ? priceGroups.map(pg => Number((pg as any).code)).filter(c => Number.isFinite(c)) : [1, 2, 3, 4, 5, 6, 7]),
          dealerCodes: selectedDealerCodes
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
      title={editingCampaignId ? 'Sepet Toplamı İndirimi (Düzenle)' : 'Sepet Toplamı İndirimi'}
      containerClassName="max-w-4xl"
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <FormSelect
                  label="Kategori"
                  requiredMark
                  value={selectedGroupCode}
                  options={groupOptions}
                  onChange={(e) => {
                    setSelectedGroupCode(e.target.value)
                    setSelectedStockCodes([])
                    if (error) setError(null)
                  }}
                />
              </div>

              <button
                type="button"
                className="h-[38px] px-3 text-xs font-semibold border border-gray-200 text-gray-700 rounded hover:bg-gray-50"
                onClick={() => void loadGroups()}
                disabled={groupsLoading}
              >
                Yenile
              </button>
            </div>
          </div>

          <FormInput
            label="Minimum Sepet Tutarı"
            requiredMark
            value={minBasketTotalText}
            inputMode="decimal"
            placeholder="0"
            onChange={(e) => {
              setMinBasketTotalText(e.target.value)
              if (error) setError(null)
            }}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <div className="text-sm font-semibold text-gray-700 mb-2">İndirim Türü</div>
            <div className="inline-flex rounded-lg border border-gray-200 bg-white overflow-hidden">
              <button
                type="button"
                onClick={() => setDiscountKind('Oran')}
                className={
                  'px-4 py-2 text-xs font-semibold ' +
                  (discountKind === 'Oran' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50')
                }
              >
                Oran (%)
              </button>
              <button
                type="button"
                onClick={() => setDiscountKind('Tutar')}
                className={
                  'px-4 py-2 text-xs font-semibold border-l border-gray-200 ' +
                  (discountKind === 'Tutar' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50')
                }
              >
                Tutar (TL)
              </button>
            </div>
          </div>

          <FormInput
            label={discountKind === 'Oran' ? 'İndirim Oranı (%)' : 'İndirim Tutarı (TL)'}
            requiredMark
            value={discountValueText}
            inputMode="decimal"
            placeholder={discountKind === 'Oran' ? '10' : '50'}
            onChange={(e) => {
              setDiscountValueText(e.target.value)
              if (error) setError(null)
            }}
          />
        </div>

        <div>
          <DealerSelector
            selectedDealerCodes={selectedDealerCodes}
            onChange={(next) => {
              setSelectedDealerCodes(next)
              if (error) setError(null)
            }}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold text-gray-700">Ürün Seçimi</div>
            <div className="text-xs text-gray-500">Ürün seçmezseniz kampanya tüm kategoriye uygulanır.</div>
          </div>

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

          <div className="border border-gray-200 rounded-lg bg-white">
            <div className="max-h-56 overflow-auto">
              {productsLoading && <div className="p-3 text-sm text-gray-500">Ürünler yükleniyor...</div>}
              {!productsLoading && !selectedGroupCode.trim() && <div className="p-3 text-sm text-gray-500">Önce kategori seçin.</div>}
              {!productsLoading && selectedGroupCode.trim() && products.length === 0 && (
                <div className="p-3 text-sm text-gray-500">Bu kategori için ürün bulunamadı.</div>
              )}
              {!productsLoading && products.length > 0 && (
                <div className="divide-y">
                  {products
                    .filter((p) => {
                      const q = String(searchTerm ?? '').trim().toLowerCase()
                      if (!q) return true
                      const code = String((p as any).stockCode ?? '').toLowerCase()
                      const name = String((p as any).name ?? '').toLowerCase()
                      return code.includes(q) || name.includes(q)
                    })
                    .map((p) => {
                      const code = String((p as any).stockCode ?? '').trim()
                      const name = String((p as any).name ?? '').trim()
                      const checked = selectedStockCodes.includes(code)
                      if (!code) return null
                      return (
                        <label key={code} className="flex items-start gap-3 px-3 py-2 hover:bg-gray-50">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              toggleStock(code)
                              if (error) setError(null)
                            }}
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-gray-900 truncate">{code}</div>
                            <div className="text-xs text-gray-500 truncate">{name}</div>
                          </div>
                        </label>
                      )
                    })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
