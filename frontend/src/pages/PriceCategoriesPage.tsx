import React, { useEffect, useMemo, useRef, useState } from 'react'
import Modal from '../components/Modal'
import Table, { type TableColumn } from '../components/Table'
import FormInput from '../components/forms/FormInput'
import FormSelect from '../components/forms/FormSelect'
import { createPriceGroup, deletePriceGroup, fetchPriceGroups, updatePriceGroup, type PriceGroupDto } from '../api/priceGroups'
import { Sparkles, Trash2, Edit2, Plus, RotateCw, Check, X, Tag, Info, AlertTriangle } from 'lucide-react'

type EditForm = {
  id?: string
  code: string
  name: string
  invoiceType: 'FATURA' | 'ACIK' | 'ASKERIYE'
  formula: string
  sortOrder: string
  isActive: 'active' | 'passive'
}

type KdvMode = 'gross' | 'net'

function sanitizeIntText(input: string, opts?: { maxDigits?: number }) {
  const maxDigits = opts?.maxDigits ?? 10
  const raw = String(input ?? '')
  return raw.replace(/[^0-9]/g, '').slice(0, maxDigits)
}

function parsePositiveInt(value: string, fallback: number) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  const i = Math.floor(n)
  return i >= 0 ? i : fallback
}

export default function PriceCategoriesPage() {
  const [items, setItems] = useState<PriceGroupDto[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'passive'>('all')
  const [refreshTick, setRefreshTick] = useState(0)

  const [actionErrorOpen, setActionErrorOpen] = useState(false)
  const [actionErrorText, setActionErrorText] = useState<string>('')

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState<PriceGroupDto | null>(null)
  const [confirmMode, setConfirmMode] = useState<'activate' | 'deactivate' | 'delete'>('deactivate')

  const getActionErrorMessage = (raw: string) => {
    const text = String(raw ?? '').trim()
    if (!text) return 'İşlem gerçekleştirilemedi.'

    try {
      const json = JSON.parse(text)
      const msg = String((json as any)?.message ?? '').trim()
      if (msg) return msg
    } catch {
    }

    return text
  }

  const reload = async () => {
    try {
      setLoading(true)
      setError(null)
      const includeInactive = statusFilter !== 'active'
      const data = await fetchPriceGroups({ includeInactive })
      setItems(data)
    } catch (e: any) {
      setError(String(e?.message ?? 'Yüklenemedi'))
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, refreshTick])

  const [editOpen, setEditOpen] = useState(false)
  const [editMode, setEditMode] = useState<'create' | 'edit'>('create')
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const emptyForm: EditForm = {
    code: '',
    name: '',
    invoiceType: 'FATURA',
    formula: 'F4',
    sortOrder: '',
    isActive: 'active'
  }

  const [form, setForm] = useState<EditForm>(emptyForm)

  const [kdvMode, setKdvMode] = useState<KdvMode>('gross')
  const [applyDiscount, setApplyDiscount] = useState(false)
  const [multiplier, setMultiplier] = useState('1')
  const [adjustSign, setAdjustSign] = useState<'+' | '-'>('+')
  const [adjustAmount, setAdjustAmount] = useState('')

  const buildFormula = (args: {
    kdvMode: KdvMode
    applyDiscount: boolean
    multiplier: string
    adjustSign: '+' | '-'
    adjustAmount: string
  }) => {
    const mRaw = String(args.multiplier ?? '').trim()
    const m = mRaw && Number.isFinite(Number(mRaw)) ? Number(mRaw) : 1
    const aRaw = String(args.adjustAmount ?? '').trim()
    const a = aRaw && Number.isFinite(Number(aRaw)) ? Number(aRaw) : 0

    let inner = 'F4'
    if (m !== 1) inner = `${inner}*${m}`
    if (args.applyDiscount) inner = `${inner}*(1-DISCOUNT/100)`
    if (a !== 0) inner = `${inner}${args.adjustSign}${a}`

    if (args.kdvMode === 'net') return `REMOVE_KDV(${inner})`
    return inner
  }

  const tryParseFormulaToBuilder = (formula: string):
    | {
        kdvMode: KdvMode
        applyDiscount: boolean
        multiplier: string
        adjustSign: '+' | '-'
        adjustAmount: string
      }
    | null => {
    const raw = String(formula ?? '').trim()
    if (!raw) return null

    let kdvMode: KdvMode = 'gross'
    let inner = raw

    const netMatch = raw.match(/^REMOVE_KDV\((.*)\)$/i)
    if (netMatch) {
      kdvMode = 'net'
      inner = String(netMatch[1] ?? '').trim()
    }

    // Optional +/- fixed adjustment at the end (e.g. +10 or -5.5)
    let adjustSign: '+' | '-' = '+'
    let adjustAmount = ''
    const adjMatch = inner.match(/^(.*?)([+\-][0-9]+(?:\.[0-9]+)?)$/)
    if (adjMatch) {
      const candidate = String(adjMatch[2] ?? '').trim()
      if (candidate.startsWith('-')) adjustSign = '-'
      adjustAmount = candidate.replace(/^[-+]/, '')
      inner = String(adjMatch[1] ?? '').trim()
    }

    let applyDiscount = false
    const discToken = '*(1-DISCOUNT/100)'
    if (inner.includes(discToken)) {
      applyDiscount = true
      inner = inner.replace(discToken, '').trim()
    }

    let multiplier = '1'
    const multMatch = inner.match(/^F4\*([0-9]+(?:\.[0-9]+)?)$/i)
    if (multMatch) {
      multiplier = String(multMatch[1] ?? '1')
      inner = 'F4'
    }

    if (!/^F4$/i.test(inner)) {
      // Unknown pattern (custom formula). We can't map it to simplified builder.
      return null
    }

    return {
      kdvMode,
      applyDiscount,
      multiplier,
      adjustSign,
      adjustAmount
    }
  }

  const applyBuilderDefaultsByCode = (code: number) => {
    // Defaults that match seeded behaviour for 1-6, and keep others simple.
    if (code === 1) {
      setKdvMode('net')
      setApplyDiscount(false)
      setMultiplier('1')
      setAdjustSign('+')
      setAdjustAmount('')
      return
    }
    if (code === 2) {
      setKdvMode('net')
      setApplyDiscount(false)
      setMultiplier('0.88')
      setAdjustSign('+')
      setAdjustAmount('')
      return
    }
    if (code === 3) {
      setKdvMode('net')
      setApplyDiscount(true)
      setMultiplier('1')
      setAdjustSign('+')
      setAdjustAmount('')
      return
    }
    if (code === 4) {
      setKdvMode('gross')
      setApplyDiscount(false)
      setMultiplier('1')
      setAdjustSign('+')
      setAdjustAmount('')
      return
    }
    if (code === 5) {
      setKdvMode('gross')
      setApplyDiscount(false)
      setMultiplier('0.88')
      setAdjustSign('+')
      setAdjustAmount('')
      return
    }
    if (code === 6) {
      setKdvMode('gross')
      setApplyDiscount(true)
      setMultiplier('1')
      setAdjustSign('+')
      setAdjustAmount('')
      return
    }

    setKdvMode('gross')
    setApplyDiscount(false)
    setMultiplier('1')
    setAdjustSign('+')
    setAdjustAmount('')
  }

  const enforceInvoiceTypeByCode = (code: number) => {
    if (code === 7) {
      setForm((p) => ({ ...p, invoiceType: 'ASKERIYE' }))
      return
    }
    if (code >= 1 && code <= 3) {
      setForm((p) => ({ ...p, invoiceType: 'FATURA' }))
      return
    }
    if (code >= 4 && code <= 6) {
      setForm((p) => ({ ...p, invoiceType: 'ACIK' }))
      return
    }
  }

  const openCreate = () => {
    const maxSort = items.reduce((acc, x) => Math.max(acc, Number(x.sortOrder ?? 0)), 0)
    setEditMode('create')
    applyBuilderDefaultsByCode(4)
    setForm({ ...emptyForm, formula: 'F4', sortOrder: String(maxSort + 1) })
    setEditError(null)
    setEditOpen(true)
  }

  // Kurucu (builder) ile formül alanını senkron tutar. Özel formülde ilk çalıştırma
  // atlanır — bkz. openEdit içindeki skipFormulaSyncRef açıklaması.
  const skipFormulaSyncRef = useRef(false)

  const openEdit = (row: PriceGroupDto) => {
    setEditMode('edit')
    const rowFormula = String((row as any).formula ?? '').trim()
    const parsed = tryParseFormulaToBuilder(rowFormula)
    if (parsed) {
      setKdvMode(parsed.kdvMode)
      setApplyDiscount(parsed.applyDiscount)
      setMultiplier(parsed.multiplier)
      setAdjustSign(parsed.adjustSign)
      setAdjustAmount(parsed.adjustAmount)
      skipFormulaSyncRef.current = false
    } else {
      // Formül basit kurucuyla temsil EDİLEMİYOR (özel formül). Kurucuya varsayılanlar
      // yükleniyor ama aşağıdaki senkron efektinin bu varsayılanları formül alanının
      // ÜZERİNE YAZMASI engellenmeli: aksi halde düzenleme penceresini açıp kaydeden
      // kullanıcı, elle yazılmış formülü farkında olmadan varsayılanla değiştiriyordu.
      // Kullanıcı kurucudaki bir kontrolü DEĞİŞTİRİRSE efekt tekrar çalışır ve devralır.
      applyBuilderDefaultsByCode(Number(row.code))
      skipFormulaSyncRef.current = true
    }
    setForm({
      id: row.id,
      code: String(row.code),
      name: row.name,
      invoiceType: ((row as any).invoiceType ?? 'FATURA') as any,
      formula: String((row as any).formula ?? ''),
      sortOrder: String(row.sortOrder ?? 0),
      isActive: row.isActive ? 'active' : 'passive'
    })
    setEditError(null)
    setEditOpen(true)
  }

  useEffect(() => {
    if (!editOpen) return
    if (skipFormulaSyncRef.current) {
      skipFormulaSyncRef.current = false
      return
    }
    const next = buildFormula({ kdvMode, applyDiscount, multiplier, adjustSign, adjustAmount })
    setForm((p) => ({ ...p, formula: next }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editOpen, kdvMode, applyDiscount, multiplier, adjustSign, adjustAmount])

  const closeEdit = () => {
    if (saving) return
    setEditOpen(false)
  }

  const submit = async () => {
    try {
      setSaving(true)
      setEditError(null)

      const codeText = sanitizeIntText(form.code)
      const code = Number(codeText)
      const name = form.name.trim()
      const invoiceType = form.invoiceType
      const formula = form.formula.trim()
      const sortOrder = parsePositiveInt(form.sortOrder, 0)
      const isActive = form.isActive === 'active'

      if (!Number.isFinite(code) || code <= 0) {
        setEditError('Kod 0 dan büyük bir sayı olmalıdır.')
        return
      }
      if (!name) {
        setEditError('Ad boş bırakılamaz.')
        return
      }
      if (!formula) {
        setEditError('Formül boş bırakılamaz. Örn: F4 veya REMOVE_KDV(F4)')
        return
      }

      if (editMode === 'create') {
        await createPriceGroup({ code, name, invoiceType, formula, sortOrder })
      } else {
        if (!form.id) return
        await updatePriceGroup(form.id, { name, invoiceType, formula, sortOrder, isActive })
      }

      setEditOpen(false)
      setRefreshTick((x) => x + 1)
    } catch (e: any) {
      setEditError(String(e?.message ?? 'Kaydedilemedi'))
    } finally {
      setSaving(false)
    }
  }

  const openConfirm = (row: PriceGroupDto, mode: 'activate' | 'deactivate' | 'delete') => {
    setConfirmTarget(row)
    setConfirmMode(mode)
    setConfirmOpen(true)
  }

  const confirmAction = async () => {
    if (!confirmTarget) return
    try {
      setSaving(true)
      setError(null)

      if (confirmMode === 'delete') {
        await deletePriceGroup(confirmTarget.id)
      } else {
        await updatePriceGroup(confirmTarget.id, {
          name: confirmTarget.name,
          invoiceType: (confirmTarget as any).invoiceType,
          formula: String((confirmTarget as any).formula ?? ''),
          sortOrder: Number((confirmTarget as any).sortOrder ?? 0),
          isActive: confirmMode === 'activate'
        })
      }

      setConfirmOpen(false)
      setConfirmTarget(null)
      setRefreshTick((x) => x + 1)
    } catch (e: any) {
      const msg = String(e?.message ?? 'İşlem başarısız')
      setActionErrorText(msg)
      setActionErrorOpen(true)
    } finally {
      setSaving(false)
    }
  }

  const rows = useMemo(() => {
    const filtered =
      statusFilter === 'passive'
        ? items.filter((x) => x.isActive === false)
        : statusFilter === 'active'
          ? items.filter((x) => x.isActive !== false)
          : items

    return [...filtered].sort((a, b) => {
      const ao = Number(a.sortOrder ?? 0)
      const bo = Number(b.sortOrder ?? 0)
      if (ao !== bo) return ao - bo
      // numeric: true olmadan "10" kodu "2"den önce geliyordu (metin sıralaması). Ana ölçüt
      // sortOrder; eşit olduğunda (tohumlanmış grupların hepsi 0) sıralamayı bu satır belirliyor.
      return String(a.code).localeCompare(String(b.code), 'tr', { numeric: true })
    })
  }, [items, statusFilter])

  const columns = useMemo<TableColumn<PriceGroupDto>[]>(() => [
    {
      key: 'code',
      label: 'KOD',
      render: (_v, r) => <span className="font-mono text-xs font-bold text-zinc-500">{r.code}</span>
    },
    {
      key: 'name',
      label: 'KATEGORİ ADI',
      render: (_v, r) => <span className="text-sm font-semibold text-zinc-800">{r.name}</span>
    },
    {
      key: 'formula',
      label: 'HESAPLAMA FORMÜLÜ',
      accessorFn: (r) => String((r as any).formula ?? ''),
      render: (_v, r) => renderFormulaTokens((r as any).formula ?? '')
    },
    {
      key: 'sortOrder',
      label: 'SIRA',
      accessorFn: (r) => Number(r.sortOrder ?? 0),
      render: (_v, r) => <span className="font-semibold text-zinc-600 text-xs">{r.sortOrder ?? 0}</span>
    },
    {
      key: 'isActive',
      label: 'DURUM',
      // Metin taşınıyor: ham `true/false` ile "aktif" diye aranamaz.
      accessorFn: (r) => (r.isActive !== false ? 'Aktif' : 'Pasif'),
      filter: { type: 'select', options: [{ label: 'Aktif', value: 'Aktif' }, { label: 'Pasif', value: 'Pasif' }] },
      render: (_v, r) => {
        const active = r.isActive !== false
        return (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors ${
              active
                ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                : 'bg-zinc-150 text-zinc-650 border-zinc-250'
            }`}
          >
            {active ? 'Aktif' : 'Pasif'}
          </span>
        )
      }
    },
    {
      key: 'actions',
      label: 'İŞLEMLER',
      render: (_v, r) => (
        <div className="flex items-center justify-end gap-1 sm:opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); openEdit(r) }}
            className="inline-flex items-center gap-1 h-[26px] px-2.5 rounded-lg text-[10px] font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-100/60 transition-colors"
          >
            <Edit2 size={10} />
            Düzenle
          </button>

          {r.isActive !== false ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); openConfirm(r, 'deactivate') }}
              className="inline-flex items-center gap-1 h-[26px] px-2.5 rounded-lg text-[10px] font-bold bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-100/60 transition-colors"
            >
              Pasife Al
            </button>
          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); openConfirm(r, 'activate') }}
              className="inline-flex items-center gap-1 h-[26px] px-2.5 rounded-lg text-[10px] font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-100/60 transition-colors"
            >
              Aktife Al
            </button>
          )}

          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); openConfirm(r, 'delete') }}
            className="inline-flex items-center gap-1 h-[26px] px-2.5 rounded-lg text-[10px] font-bold bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-100/60 transition-colors"
          >
            <Trash2 size={10} />
            Sil
          </button>
        </div>
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  // Custom formula tokens highlighter
  const renderFormulaTokens = (formulaStr: string) => {
    const raw = String(formulaStr ?? '').trim()
    if (!raw) return <span className="text-zinc-350 italic">Girilmemiş</span>

    const tokens = raw.split(/([A-Za-z0-9_]+|\(|\)|\*|\+|\-|\/)/).filter(Boolean)

    return (
      <div className="flex flex-wrap items-center gap-1 font-mono text-[10px]">
        {tokens.map((token, idx) => {
          const upper = token.toUpperCase()
          if (upper === 'REMOVE_KDV') {
            return (
              <span key={idx} className="px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-100 font-semibold uppercase">
                {token}
              </span>
            )
          }
          if (upper === 'F4') {
            return (
              <span key={idx} className="px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100 font-extrabold">
                {token}
              </span>
            )
          }
          if (upper === 'DISCOUNT') {
            return (
              <span key={idx} className="px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-100 font-semibold uppercase">
                {token}
              </span>
            )
          }
          if (['*', '+', '-', '/'].includes(token)) {
            return (
              <span key={idx} className="text-zinc-400 font-bold px-0.5">
                {token}
              </span>
            )
          }
          if (['(', ')'].includes(token)) {
            return (
              <span key={idx} className="text-zinc-400 font-medium">
                {token}
              </span>
            )
          }
          if (/^[0-9.]+$/.test(token)) {
            return (
              <span key={idx} className="text-emerald-700 font-semibold px-0.5">
                {token}
              </span>
            )
          }
          return <span key={idx} className="text-zinc-700">{token}</span>
        })}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-zinc-100 shadow-sm">
        <div>
          <h1 className="text-xl font-bold text-zinc-950 tracking-tight">Fiyat Kategorileri</h1>
          <p className="text-xs text-zinc-400 mt-0.5">Farklı vade ve ödeme tipleri için fiyat hesaplama formüllerini yapılandırın.</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="h-[38px] inline-flex items-center gap-2 px-4 text-xs font-semibold rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-sm hover:shadow transition-all duration-150 hover:scale-[1.01] active:scale-[0.99]"
        >
          <Plus size={15} />
          Yeni Kategori Ekle
        </button>
      </div>

      {/* Modern Pill Filter & Top Stats */}
      <div className="bg-white border border-zinc-100 rounded-2xl shadow-sm p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex bg-zinc-100 p-1 rounded-xl w-fit">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              statusFilter === 'all' ? 'bg-white text-zinc-850 shadow-sm' : 'text-zinc-500 hover:text-zinc-705'
            }`}
          >
            Tümü (Aktif + Pasif)
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('active')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              statusFilter === 'active' ? 'bg-white text-emerald-700 shadow-sm' : 'text-zinc-500 hover:text-zinc-705'
            }`}
          >
            Sadece Aktif
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('passive')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              statusFilter === 'passive' ? 'bg-white text-zinc-700 shadow-sm' : 'text-zinc-500 hover:text-zinc-705'
            }`}
          >
            Sadece Pasif
          </button>
        </div>
        <div className="text-xs font-medium text-zinc-500">
          Toplam Fiyat Kategorisi: <span className="font-bold text-zinc-800">{rows.length}</span>
        </div>
      </div>

      {error ? (
        <div className="p-4 rounded-xl border border-rose-100 bg-rose-50 text-xs font-medium text-rose-700">
          {error}
        </div>
      ) : null}

      {/* Styled Grid Table */}
      <div className="bg-white border border-zinc-100 rounded-2xl shadow-sm overflow-hidden">
        <Table<PriceGroupDto>
          onRefresh={() => void reload()}
          columns={columns}
          data={rows}
          rowKey={(r) => String(r.id)}
          // Satır üstüne gelince beliren işlem düğmeleri `group-hover`a bağlı.
          rowClassName={() => 'group'}
          loading={loading}
        />
      </div>

      {/* Edit/Create Modal */}
      <Modal
        isOpen={editOpen}
        onClose={closeEdit}
        title={editMode === 'create' ? 'Yeni Fiyat Kategorisi Ekle' : 'Fiyat Kategorisini Düzenle'}
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <button
              type="button"
              disabled={saving}
              onClick={closeEdit}
              className="h-[36px] px-4 text-xs font-semibold rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 transition disabled:opacity-60 active:scale-[0.98]"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void submit()}
              className="h-[36px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-60 active:scale-[0.98]"
            >
              {saving ? 'Kaydediliyor...' : 'Kategoriyi Kaydet'}
            </button>
          </div>
        }
      >
        {editError ? (
          <div className="mb-4 p-3 rounded-xl border border-rose-100 bg-rose-50 text-xs font-semibold text-rose-700">
            {editError}
          </div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormInput
            label="Kategori Kodu *"
            value={form.code}
            onChange={(e) => {
              const next = sanitizeIntText(e.target.value)
              setForm((p) => ({ ...p, code: next }))
              const asNum = Number(next)
              if (Number.isFinite(asNum)) enforceInvoiceTypeByCode(asNum)
            }}
            placeholder="Örn: 4"
            inputMode="numeric"
            disabled={editMode === 'edit'}
          />
          
          <FormInput 
            label="Kategori Adı *" 
            value={form.name} 
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} 
            placeholder="Örn: 60 Gün Vade" 
          />

          <FormSelect
            label="Hesap Tipi *"
            value={form.invoiceType}
            onChange={(e) => setForm((p) => ({ ...p, invoiceType: e.target.value as any }))}
            options={[
              { value: 'FATURA', label: 'Fatura' },
              { value: 'ACIK', label: 'Açık Hesap' },
              { value: 'ASKERIYE', label: 'Askeriye Tipi (KDV Dahil Edilmez)' }
            ]}
          />

          <FormInput
            label="Listeleme Sırası"
            value={form.sortOrder}
            onChange={(e) => setForm((p) => ({ ...p, sortOrder: sanitizeIntText(e.target.value) }))}
            placeholder="1"
            inputMode="numeric"
          />

          {/* Dynamic Formula builder block */}
          <div className="sm:col-span-2 space-y-3 p-4 bg-zinc-50/80 border border-zinc-200/60 rounded-xl relative overflow-hidden">
            <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-700">
              <Sparkles size={14} className="text-indigo-500" />
              Formül Oluşturucu Sihirbazı
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <FormSelect
                label="KDV Oranı"
                value={kdvMode}
                onChange={(e) => setKdvMode(e.target.value as KdvMode)}
                options={[
                  { value: 'gross', label: 'KDV Dahil (Brüt)' },
                  { value: 'net', label: 'KDV Hariç (Net)' }
                ]}
              />

              <FormSelect
                label="İskonto Uygulama"
                value={applyDiscount ? 'yes' : 'no'}
                onChange={(e) => setApplyDiscount(e.target.value === 'yes')}
                options={[
                  { value: 'no', label: 'Uygulama' },
                  { value: 'yes', label: 'Uygula (DISCOUNT)' }
                ]}
              />

              <FormInput
                label="Fiyat Çarpanı"
                value={multiplier}
                onChange={(e) => setMultiplier(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="1"
                inputMode="decimal"
              />

              <div className="grid grid-cols-3 gap-2">
                <FormSelect
                  label="Sabit Tutar"
                  value={adjustSign}
                  onChange={(e) => setAdjustSign((e.target.value as any) || '+')}
                  options={[
                    { value: '+', label: '+ Ekle' },
                    { value: '-', label: '- Çıkar' }
                  ]}
                />
                <div className="col-span-2">
                  <FormInput
                    label=""
                    value={adjustAmount}
                    onChange={(e) => setAdjustAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder="0"
                    inputMode="decimal"
                  />
                </div>
              </div>
            </div>

            {/* Computed formula preview inside modal */}
            <div className="pt-2">
              <span className="text-[10px] font-bold text-zinc-450 uppercase tracking-wide block mb-1">Oluşturulan Formül Önizleme</span>
              <div className="bg-zinc-900 text-zinc-100 py-2.5 px-3 rounded-lg font-mono text-xs text-center border border-zinc-800 shadow-inner select-all">
                {form.formula || 'F4'}
              </div>
            </div>
          </div>

          <FormSelect
            label="Kategori Durumu"
            value={form.isActive}
            onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.value as any }))}
            options={[
              { value: 'active', label: 'Aktif' },
              { value: 'passive', label: 'Pasif' }
            ]}
          />

          {editMode !== 'create' ? (
            <div className="sm:col-span-2 text-[10px] text-zinc-400 font-medium">
              * Not: Mevcut kategorilerde kod değeri değiştirilemez.
            </div>
          ) : null}
        </div>
      </Modal>

      {/* Confirmation Modal */}
      <Modal
        isOpen={confirmOpen}
        onClose={() => {
          if (saving) return
          setConfirmOpen(false)
          setConfirmTarget(null)
        }}
        title={confirmMode === 'delete' ? 'Kategoriyi Sil' : confirmMode === 'activate' ? 'Kategoriyi Aktifleştir' : 'Kategoriyi Pasifleştir'}
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <button
              type="button"
              className="h-[36px] px-4 text-xs font-semibold rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 transition disabled:opacity-60"
              onClick={() => {
                setConfirmOpen(false)
                setConfirmTarget(null)
              }}
              disabled={saving}
            >
              Vazgeç
            </button>
            <button
              type="button"
              className={
                'h-[36px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-xl shadow-sm transition disabled:opacity-60 ' +
                (confirmMode === 'delete'
                  ? 'bg-rose-600 hover:bg-rose-700 text-white'
                  : confirmMode === 'activate'
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'bg-amber-600 hover:bg-amber-700 text-white')
              }
              onClick={() => void confirmAction()}
              disabled={saving}
            >
              {saving ? 'İşleniyor...' : confirmMode === 'delete' ? 'Sil' : confirmMode === 'activate' ? 'Aktifleştir' : 'Pasifleştir'}
            </button>
          </div>
        }
      >
        <div className="flex items-start gap-3 p-1">
          <div className={`p-2 rounded-xl ${confirmMode === 'delete' ? 'bg-rose-50 text-rose-600' : confirmMode === 'activate' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
            <AlertTriangle size={20} />
          </div>
          <div className="flex-1 space-y-1">
            <div className="text-sm text-zinc-750">
              {confirmMode === 'delete'
                ? 'Bu fiyat kategorisini silmek istediğinize emin misiniz?'
                : confirmMode === 'activate'
                  ? 'Bu fiyat kategorisini aktifleştirmek istediğinize emin misiniz?'
                  : 'Bu fiyat kategorisini pasifleştirmek istediğinize emin misiniz?'}
            </div>
            {confirmTarget ? (
              <div className="text-xs font-bold text-zinc-800 bg-zinc-50 border border-zinc-150 p-2 rounded-lg font-mono">
                {confirmTarget.code} - {confirmTarget.name} ({String((confirmTarget as any).formula ?? '')})
              </div>
            ) : null}
          </div>
        </div>
      </Modal>

      {/* Action Error Modal */}
      <Modal
        isOpen={actionErrorOpen}
        onClose={() => {
          setActionErrorOpen(false)
          setActionErrorText('')
        }}
        title="İşlem Başarısız"
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <button
              type="button"
              className="h-[36px] px-4 text-xs font-semibold rounded-xl bg-rose-50 text-rose-700 border border-rose-100 hover:bg-rose-100 transition active:scale-[0.98]"
              onClick={async () => {
                try {
                  const msg = getActionErrorMessage(actionErrorText)
                  await navigator.clipboard.writeText(msg)
                } catch {
                }
              }}
            >
              Hata Detayını Kopyala
            </button>
            <button
              type="button"
              className="h-[36px] px-4 text-xs font-semibold rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 transition"
              onClick={() => {
                setActionErrorOpen(false)
                setActionErrorText('')
              }}
            >
              Kapat
            </button>
          </div>
        }
      >
        <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-4 space-y-2">
          <div className="text-xs font-semibold text-rose-500 uppercase tracking-wider">Hata Mesajı</div>
          <div className="text-sm font-semibold text-rose-800 whitespace-pre-wrap leading-relaxed">{getActionErrorMessage(actionErrorText)}</div>
        </div>
      </Modal>
    </div>
  )
}
