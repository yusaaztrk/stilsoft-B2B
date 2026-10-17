import React, { useEffect, useMemo, useState } from 'react'
import Modal from '../Modal'
import FormInput from '../forms/FormInput'
import FormSelect from '../forms/FormSelect'
import { fetchProductCategoriesStateForDealer } from '../../api/productCategories'
import { fetchProducts } from '../../api/products'
import type { Product } from '../../types/Product'
import { fetchPriceGroups, type PriceGroupDto } from '../../api/priceGroups'
import { createPackageCampaign, patchPackageCampaign } from '../../api/campaigns'
import DealerSelector from './DealerSelector'
import { CAMPAIGN_BACKGROUNDS, TEXT_COLOR_OPTIONS, parseCampaignDescription, formatCampaignDescription } from '../../utils/campaignBgHelper'
import { Package, Plus, Trash2, Search } from 'lucide-react'

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
    items: Array<{ groupCode: string; stockCode: string; quantity: number }>
    operationKind: OperationKind | null
    operationValueText: string
    selectedPriceGroupCodes: number[]
    priority?: number
    stopNext?: boolean
    selectedDealerCodes?: string[]
  } | null
  onCreated?: (id: string) => void
}

type OperationKind = 'Tutar' | 'Oran'

/** Paket satiri. `searchTerm` satirin urun filtre kutusudur (inline tipte eksikti). */
type PackageRow = {
  id: string
  groupCode: string
  stockCode: string
  quantityText: string
  searchTerm?: string
}

function parseDecimal(text: string) {
  const s = String(text ?? '').trim().replace(',', '.')
  if (!s) return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return n
}

function parseIntSafe(text: string) {
  const n = parseInt(String(text ?? '').trim(), 10)
  if (isNaN(n) || n <= 0) return null
  return n
}

function makeId() {
  return Math.random().toString(36).slice(2, 9)
}

export default function PackageCampaignModal({ isOpen, onClose, campaignDraft, editingCampaignId, initialForm, onCreated }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [groupsLoading, setGroupsLoading] = useState(false)
  const [groups, setGroups] = useState<string[]>([])
  const [groupMeta, setGroupMeta] = useState<Record<string, { description?: string | null; status: 'active' | 'passive' }>>({})

  const [productsByGroup, setProductsByGroup] = useState<Record<string, Product[]>>({})
  const [productsLoadingByGroup, setProductsLoadingByGroup] = useState<Record<string, boolean>>({})

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedBgId, setSelectedBgId] = useState('bg-red-silk')
  const [selectedTextColor, setSelectedTextColor] = useState('')
  const [priority, setPriority] = useState('0')
  const [stopNext, setStopNext] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const [rows, setRows] = useState<PackageRow[]>([
    { id: makeId(), groupCode: '', stockCode: '', quantityText: '1' }
  ])

  const [operationKind, setOperationKind] = useState<OperationKind | null>(null)
  const [operationValueText, setOperationValueText] = useState('')

  const [priceGroupsLoading, setPriceGroupsLoading] = useState(false)
  const [priceGroups, setPriceGroups] = useState<PriceGroupDto[]>([])
  const [selectedPriceGroupCodes, setSelectedPriceGroupCodes] = useState<number[]>([])

  const [selectedDealerCodes, setSelectedDealerCodes] = useState<string[]>([])

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
    setRows([{ id: makeId(), groupCode: '', stockCode: '', quantityText: '1' }])
    setOperationKind(null)
    setOperationValueText('')
    setSelectedPriceGroupCodes([])
    setSelectedDealerCodes([])
    setGroups([])
    setGroupMeta({})
    setProductsByGroup({})
    setProductsLoadingByGroup({})
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
      setOperationKind(initialForm.operationKind)
      setOperationValueText(initialForm.operationValueText)
      setSelectedPriceGroupCodes(initialForm.selectedPriceGroupCodes)
      const rws = (initialForm.items ?? []).map((x) => ({ id: makeId(), groupCode: x.groupCode, stockCode: x.stockCode, quantityText: String(x.quantity) }))
      setRows(rws.length ? rws : [{ id: makeId(), groupCode: '', stockCode: '', quantityText: '1' }])
      setPriority(String(initialForm.priority ?? 0))
      setStopNext(Boolean(initialForm.stopNext))
      setSelectedDealerCodes(((initialForm as any).selectedDealerCodes ?? []).slice())
      ;(initialForm.items ?? []).forEach((x) => {
        if (x.groupCode) void ensureProductsLoaded(x.groupCode)
      })
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
        setGroups((state?.mains ?? []).slice())
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

  const groupOptions = useMemo(() => {
    const items = (groups ?? [])
      .map((code) => {
        const c = String(code ?? '').trim()
        const meta = groupMeta[c]
        const desc = String(meta?.description ?? '').trim()
        const label = desc ? `${c} - ${desc}` : c
        return { value: c, label }
      })
      .filter((x) => x.value)
      .sort((a, b) => a.label.localeCompare(b.label, 'tr'))

    return [{ value: '', label: groupsLoading ? 'Yükleniyor...' : 'Kategori seçin', disabled: true }, ...items]
  }, [groups, groupsLoading, groupMeta])

  const ensureProductsLoaded = async (groupCode: string) => {
    const g = String(groupCode ?? '').trim()
    if (!g) return
    if (productsByGroup[g]) return

    setProductsLoadingByGroup((prev) => ({ ...prev, [g]: true }))
    try {
      const res = await fetchProducts({ main: g, page: 1, pageSize: 500, includeDealer: true })
      setProductsByGroup((prev) => ({ ...prev, [g]: (res.items ?? []) as any }))
    } catch (e: any) {
      setError(String(e?.message ?? 'Ürünler alınamadı'))
      setProductsByGroup((prev) => ({ ...prev, [g]: [] }))
    } finally {
      setProductsLoadingByGroup((prev) => ({ ...prev, [g]: false }))
    }
  }

  const updateRow = (id: string, patch: Partial<PackageRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const removeRow = (id: string) => {
    setRows((prev) => {
      const next = prev.filter((r) => r.id !== id)
      return next.length > 0 ? next : [{ id: makeId(), groupCode: '', stockCode: '', quantityText: '1' }]
    })
  }

  const addRow = () => {
    setRows((prev) => [...prev, { id: makeId(), groupCode: '', stockCode: '', quantityText: '1' }])
  }

  const togglePriceGroup = (code: number) => {
    setSelectedPriceGroupCodes((prev) => {
      if (prev.includes(code)) return prev.filter((x) => x !== code)
      return [...prev, code]
    })
  }

  const validate = () => {
    if (!name.trim()) return 'Kampanya adı zorunlu.'
    if (!startDate) return 'Başlangıç tarihi zorunlu.'
    if (!endDate) return 'Bitiş tarihi zorunlu.'

    const normalized = rows
      .map((r) => ({
        groupCode: String(r.groupCode ?? '').trim(),
        stockCode: String(r.stockCode ?? '').trim(),
        qty: parseIntSafe(r.quantityText)
      }))
      .filter((r) => r.stockCode && r.qty != null)

    if (normalized.length === 0) return 'Pakete en az 1 ürün eklemelisiniz.'

    const invalid = rows.find((r) => {
      const gc = String(r.groupCode ?? '').trim()
      const sc = String(r.stockCode ?? '').trim()
      const qty = parseIntSafe(r.quantityText)
      return !gc || !sc || qty == null
    })
    if (invalid) return 'Tüm satırlarda kategori, ürün ve adet zorunludur.'

    if (!operationKind) return 'İşlem tipi seçimi zorunlu.'

    const op = parseDecimal(operationValueText)
    if (op == null) return operationKind === 'Oran' ? 'İndirim oranı zorunlu.' : 'Paket fiyatı zorunlu.'
    if (op < 0) return 'Değer 0’dan küçük olamaz.'
    if (operationKind === 'Oran' && op > 100) return 'Oran (%) 100’den büyük olamaz.'

    return null
  }

  const canSave = useMemo(
    () => validate() == null && !loading,
    [campaignDraft, rows, operationKind, operationValueText, loading]
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

      const items = rows.map((r) => ({
        groupCode: String(r.groupCode ?? '').trim(),
        stockCode: String(r.stockCode ?? '').trim(),
        quantity: parseIntSafe(r.quantityText) ?? 1
      }))

      const opValue = parseDecimal(operationValueText) ?? 0
      const opKind = operationKind as OperationKind

      const finalDescription = formatCampaignDescription(description, selectedBgId, selectedTextColor)
      const payload = {
        name,
        description: finalDescription,
        startDate,
        priority: Number(priority) || 0,
        // Bos dizi = tum bayiler. Gonderilmezse bayi kisiti hic kaydedilmez.
        dealerCodes: selectedDealerCodes,
        stopNext,
        endDate,
        items,
        operationType: opKind,
        operationValue: opValue,
        priceGroupCodes: selectedPriceGroupCodes.length > 0 ? selectedPriceGroupCodes : (priceGroups.length > 0 ? priceGroups.map(pg => Number((pg as any).code)).filter(c => Number.isFinite(c)) : [1, 2, 3, 4, 5, 6, 7])
      } as any

      if (editingCampaignId) {
        const patch: any = {}
        const base: any = initialForm ?? {}

        if (name !== base.name) patch.name = name
        if (finalDescription !== base.description) patch.description = finalDescription
        if (startDate !== base.startDate) patch.startDate = startDate
        if (endDate !== base.endDate) patch.endDate = endDate

        const normItems = (items ?? []).map((x) => ({ stockCode: String(x.stockCode ?? '').trim(), quantity: Number(x.quantity ?? 0) }))
        const baseItems = (base.items ?? []).map((x: any) => ({ stockCode: String(x.stockCode ?? '').trim(), quantity: Number(x.quantity ?? 0) }))
        const aItems = JSON.stringify(normItems)
        const bItems = JSON.stringify(baseItems)
        if (aItems !== bItems) patch.items = items

        if ((opKind ?? null) !== (base.operationKind ?? null)) patch.operationType = opKind
        if (String(opValue) !== String(base.operationValueText ?? '')) patch.operationValue = opValue

        const a = (selectedPriceGroupCodes ?? []).slice().sort().join(',')
        const b = (base.selectedPriceGroupCodes ?? []).slice().sort().join(',')
        if (a !== b) patch.priceGroupCodes = selectedPriceGroupCodes

        if ((Number(priority) || 0) !== (Number(base.priority) || 0)) patch.priority = Number(priority) || 0
        if (Boolean(stopNext) !== Boolean(base.stopNext)) patch.stopNext = stopNext

        const dA = (selectedDealerCodes ?? []).slice().sort().join(',')
        const dB = ((base as any).selectedDealerCodes ?? []).slice().sort().join(',')
        if (dA !== dB) patch.dealerCodes = selectedDealerCodes

        const res = await patchPackageCampaign(editingCampaignId, patch)
        onCreated?.(res.id)
      } else {
        const res = await createPackageCampaign(payload)
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
      title={editingCampaignId ? 'Paket Kampanya (Düzenle)' : 'Paket Kampanya'}
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

        <div className="bg-slate-50/70 rounded-xl border border-slate-200 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Package size={16} className="text-indigo-600" />
                Paket Ürünleri
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">Paket içeriğine eklenecek kategori, ürün ve adetleri belirleyin</p>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-xs transition-all active:scale-95 cursor-pointer"
              onClick={() => {
                addRow()
                if (error) setError(null)
              }}
            >
              <Plus size={14} />
              Yeni Ürün Ekle
            </button>
          </div>

          <div className="space-y-3">
            {rows.map((r, idx) => {
              const g = String(r.groupCode ?? '').trim()
              const products = g ? productsByGroup[g] ?? [] : []
              const pl = Boolean(productsLoadingByGroup[g])

              const searchTerm = String(r.searchTerm ?? '').trim().toLowerCase()
              const filteredProducts = products.filter((p) => {
                if (!searchTerm) return true
                const code = String((p as any).stockCode ?? '').toLowerCase()
                const name = String((p as any).name ?? '').toLowerCase()
                return code.includes(searchTerm) || name.includes(searchTerm)
              })

              const productOptions = [{ value: '', label: g ? (pl ? 'Yükleniyor...' : 'Ürün seçin') : 'Önce kategori seçin' }].concat(
                (filteredProducts ?? [])
                  .map((p) => ({ value: String((p as any).stockCode ?? ''), label: `${String((p as any).stockCode ?? '')} - ${String((p as any).name ?? '')}` }))
                  .filter((x) => x.value)
                  .sort((a, b) => a.label.localeCompare(b.label, 'tr'))
              )

              return (
                <div key={r.id} className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs hover:border-indigo-200 transition-all flex flex-col md:flex-row items-stretch md:items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 bg-slate-100 rounded-lg px-2.5 py-1.5 w-fit shrink-0">
                    <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-extrabold">{idx + 1}</span>
                    <span>Ürün</span>
                  </div>

                  <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                    <div className="md:col-span-4">
                      <FormSelect
                        label="Kategori"
                        requiredMark
                        value={r.groupCode}
                        options={groupOptions}
                        onChange={(e) => {
                          const next = String(e.target.value ?? '')
                          updateRow(r.id, { groupCode: next, stockCode: '', searchTerm: '' })
                          if (next.trim()) void ensureProductsLoaded(next)
                          if (error) setError(null)
                        }}
                      />
                    </div>

                    <div className="md:col-span-6 space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
                          Ürün Seçimi <span className="text-red-500">*</span>
                        </label>
                        {g && (
                          <div className="relative w-44">
                            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                            <input
                              type="text"
                              placeholder="Filtrele..."
                              value={r.searchTerm || ''}
                              onChange={(e) => updateRow(r.id, { searchTerm: e.target.value })}
                              className="w-full text-[11px] border border-gray-200 rounded-md pl-6 pr-2 py-0.5 h-6 focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-slate-50"
                            />
                          </div>
                        )}
                      </div>
                      <FormSelect
                        label=""
                        value={r.stockCode}
                        options={productOptions}
                        onChange={(e) => {
                          updateRow(r.id, { stockCode: String(e.target.value ?? '') })
                          if (error) setError(null)
                        }}
                      />
                    </div>

                    <div className="md:col-span-2">
                      <FormInput
                        label="Adet"
                        requiredMark
                        value={r.quantityText}
                        inputMode="numeric"
                        placeholder="1"
                        onChange={(e) => {
                          updateRow(r.id, { quantityText: e.target.value })
                          if (error) setError(null)
                        }}
                      />
                    </div>
                  </div>

                  {rows.length > 1 && (
                    <button
                      type="button"
                      title="Satırı Sil"
                      className="p-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 rounded-lg transition-all self-end md:self-center shrink-0 cursor-pointer"
                      onClick={() => removeRow(r.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <div className="text-sm font-semibold text-gray-700 mb-2">İşlem Tipi</div>
            <div className="inline-flex w-full rounded-lg border border-gray-200 bg-white overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  setOperationKind('Tutar')
                  setOperationValueText('')
                }}
                className={
                  'flex-1 px-4 py-2 text-xs font-semibold ' +
                  (operationKind === 'Tutar' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50')
                }
              >
                Sabit Paket Fiyatı
              </button>
              <button
                type="button"
                onClick={() => {
                  setOperationKind('Oran')
                  setOperationValueText('')
                }}
                className={
                  'flex-1 px-4 py-2 text-xs font-semibold border-l border-gray-200 ' +
                  (operationKind === 'Oran' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50')
                }
              >
                % İndirim
              </button>
            </div>
          </div>

          <div>
            {operationKind === 'Tutar' && (
              <FormInput
                label="Paket Net Fiyatı (TL)"
                requiredMark
                value={operationValueText}
                inputMode="decimal"
                placeholder="1000"
                onChange={(e) => {
                  setOperationValueText(e.target.value)
                  if (error) setError(null)
                }}
              />
            )}

            {operationKind === 'Oran' && (
              <FormInput
                label="İndirim Oranı (%)"
                requiredMark
                value={operationValueText}
                inputMode="decimal"
                placeholder="10"
                onChange={(e) => {
                  setOperationValueText(e.target.value)
                  if (error) setError(null)
                }}
              />
            )}

            {!operationKind && <div className="text-xs text-gray-500 mt-2">Değer girmek için önce işlem tipini seçin.</div>}
          </div>

          <div className="mt-3 pt-3 border-t border-gray-200">
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
    </Modal>
  )
}
