import React, { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import DataGrid, { type DataGridColumn } from '../components/datagrid/DataGrid'
import Modal from '../components/Modal'
import FormInput from '../components/forms/FormInput'
import FormSelect from '../components/forms/FormSelect'
import { fetchProducts } from '../api/products'
import { fetchPriceGroups, type PriceGroupDto } from '../api/priceGroups'
import {
  deleteCustomerProductPriceOverride,
  fetchCustomerProductPriceOverridesByCustomer,
  upsertCustomerProductPriceOverride,
  type CustomerProductPriceOverrideDto
} from '../api/customerProductPriceOverrides'
import type { Product } from '../types/Product'

type Customer = { customerCode: string; name: string }

import { API_BASE_URL } from '../config/api'

function buildHeaders(includeJson: boolean) {
  const headers: Record<string, string> = {}
  if (includeJson) headers['Content-Type'] = 'application/json'
  const token = localStorage.getItem('accessToken')
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

function formatMoney(value: number | null | undefined) {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return ''
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function parseDecimalInput(s: string) {
  const raw = String(s ?? '').trim()
  if (!raw) return null
  const normalized = raw.replace(/\./g, '').replace(',', '.')
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

type EditForm = {
  id?: string
  customerCode: string
  productId: string
  priceGroupId: string
  price: string
  currency: string
}

type Row = CustomerProductPriceOverrideDto

export default function CustomerPriceOverridesPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [customers, setCustomers] = useState<Array<Customer & { priceGroupId?: string | null }>>([])
  const [priceGroups, setPriceGroups] = useState<PriceGroupDto[]>([])
  const [products, setProducts] = useState<Product[]>([])

  const [selectedCustomerCode, setSelectedCustomerCode] = useState('')
  const [selectedPriceGroupId, setSelectedPriceGroupId] = useState('')
  const [defaultPriceGroupId, setDefaultPriceGroupId] = useState<string>('')
  const [defaultSaving, setDefaultSaving] = useState(false)

  const [items, setItems] = useState<CustomerProductPriceOverrideDto[]>([])

  const productById = useMemo(() => {
    const m: Record<string, Product> = {}
    products.forEach((p) => {
      m[p.id] = p
    })
    return m
  }, [products])

  const priceGroupById = useMemo(() => {
    const m: Record<string, PriceGroupDto> = {}
    priceGroups.forEach((pg) => {
      m[pg.id] = pg
    })
    return m
  }, [priceGroups])

  const customerOptions = useMemo(() => {
    const list = [...customers].sort((a, b) => String(a.customerCode).localeCompare(String(b.customerCode)))
    return list.map((c) => ({ value: c.customerCode, label: `[${c.customerCode}] ${c.name || c.customerCode}` }))
  }, [customers])

  const priceGroupOptions = useMemo(() => {
    return priceGroups
      .slice()
      .filter((x) => x.isActive)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.code).localeCompare(String(b.code)))
      .map((pg) => ({ value: pg.id, label: `${String(pg.code).toUpperCase()} - ${pg.name}` }))
  }, [priceGroups])

  const loadCustomers = async () => {
    const qs = new URLSearchParams({ includeInactive: 'true' }).toString()
    const res = await fetch(`${API_BASE_URL}/api/customers?${qs}`, { headers: { ...buildHeaders(false) } })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(t || `Cariler alınamadı (${res.status})`)
    }
    const json = await res.json()
    return (json?.data ?? []) as Array<Customer & { priceGroupId?: string | null }>
  }

  const updateCustomerDefaultPriceGroup = async (customerCode: string, priceGroupId: string) => {
    const payload = { priceGroupId: priceGroupId ? priceGroupId : null }
    const res = await fetch(`${API_BASE_URL}/api/customers/${encodeURIComponent(customerCode)}/price-group`, {
      method: 'PUT',
      headers: { ...buildHeaders(true) },
      body: JSON.stringify(payload)
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(t || `Default fiyat kategorisi güncellenemedi (${res.status})`)
    }
    await res.json().catch(() => undefined)
  }

  const reloadBaseData = async () => {
    const [c, pg, pr] = await Promise.all([
      loadCustomers(),
      fetchPriceGroups({ includeInactive: false }),
      fetchProducts({ page: 1, pageSize: 500, includeInactive: true, includeDealer: false })
    ])

    setCustomers(c)
    setPriceGroups(pg)
    setProducts(pr.items)

    const resolvedCustomerCode = selectedCustomerCode || c[0]?.customerCode || ''
    if (resolvedCustomerCode && resolvedCustomerCode !== selectedCustomerCode) setSelectedCustomerCode(resolvedCustomerCode)

    const customerDefaultPg = c.find((x) => x.customerCode === resolvedCustomerCode)?.priceGroupId ?? ''
    setDefaultPriceGroupId(String(customerDefaultPg ?? ''))

    const fallbackPg =
      pg
        .slice()
        .filter((x) => x.isActive)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.code).localeCompare(String(b.code)))[0]?.id ?? ''

    const resolvedFilterPg = (customerDefaultPg as string) || selectedPriceGroupId || fallbackPg
    if (resolvedFilterPg && resolvedFilterPg !== selectedPriceGroupId) setSelectedPriceGroupId(resolvedFilterPg)
  }

  const reloadOverrides = async (opts?: { customerCode?: string; priceGroupId?: string }) => {
    const cc = String(opts?.customerCode ?? selectedCustomerCode ?? '').trim()
    if (!cc) {
      setItems([])
      return
    }

    const pgId = String(opts?.priceGroupId ?? selectedPriceGroupId ?? '').trim()

    const data = await fetchCustomerProductPriceOverridesByCustomer({
      customerCode: cc,
      priceGroupId: pgId || undefined,
      includeInactive: false
    })

    setItems(data)
  }

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true)
        setError(null)
        await reloadBaseData()
      } catch (e: any) {
        setError(String(e?.message ?? 'Yüklenemedi'))
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const customerDefaultPg = customers.find((x) => x.customerCode === selectedCustomerCode)?.priceGroupId ?? ''
    setDefaultPriceGroupId(String(customerDefaultPg ?? ''))
    void (async () => {
      try {
        setLoading(true)
        setError(null)
        await reloadOverrides()
      } catch (e: any) {
        setError(String(e?.message ?? 'Yüklenemedi'))
        setItems([])
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomerCode, selectedPriceGroupId])

  const applyDefaultPriceGroup = async (nextId: string) => {
    const customerCode = String(selectedCustomerCode ?? '').trim()
    if (!customerCode) return
    try {
      setDefaultSaving(true)
      setError(null)
      await updateCustomerDefaultPriceGroup(customerCode, nextId)

      setCustomers((prev) => prev.map((c) => (c.customerCode === customerCode ? { ...c, priceGroupId: nextId || null } : c)))
      setDefaultPriceGroupId(nextId)

      // Use new default as filter too (so user immediately sees prices that will apply)
      if (nextId && nextId !== selectedPriceGroupId) {
        setSelectedPriceGroupId(nextId)
      } else {
        await reloadOverrides({ customerCode, priceGroupId: selectedPriceGroupId })
      }
    } catch (e: any) {
      setError(String(e?.message ?? 'Güncellenemedi'))
    } finally {
      setDefaultSaving(false)
    }
  }

  const rows = useMemo(() => {
    return [...items].sort((a, b) => {
      const aStock = String(productById[a.productId]?.stockCode ?? '')
      const bStock = String(productById[b.productId]?.stockCode ?? '')
      if (aStock !== bStock) return aStock.localeCompare(bStock)
      return String(a.id).localeCompare(String(b.id))
    })
  }, [items, productById])

  const columns: Array<DataGridColumn<Row>> = useMemo(
    () => [
      {
        key: 'product',
        header: 'ÜRÜN',
        width: 380,
        render: (r) => {
          const p = productById[r.productId]
          if (!p) return <span className="text-xs text-gray-500">(Ürün bulunamadı)</span>
          return (
            <div className="flex flex-col">
              <span className="font-mono text-xs">{p.stockCode}</span>
              <span className="text-sm">{p.name}</span>
            </div>
          )
        }
      },
      {
        key: 'priceGroup',
        header: 'KATEGORİ',
        width: 180,
        render: (r) => {
          const pg = priceGroupById[r.priceGroupId]
          return pg ? `${pg.code} - ${pg.name}` : '(Kategori bulunamadı)'
        }
      },
      {
        key: 'price',
        header: 'FİYAT',
        width: 120,
        align: 'right',
        render: (r) => formatMoney(r.price)
      },
      {
        key: 'cur',
        header: 'CUR',
        width: 80,
        render: (r) => <span className="font-mono text-xs">{String(r.currency ?? '').toUpperCase()}</span>
      },
      {
        key: 'actions',
        header: '',
        width: 90,
        align: 'right',
        render: (r) => (
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              className="h-8 w-8 flex items-center justify-center rounded hover:bg-red-50"
              title="Pasife Al"
              onClick={(e) => {
                e.stopPropagation()
                askDelete(r)
              }}
            >
              <Trash2 size={16} className="text-red-600" />
            </button>
          </div>
        )
      }
    ],
    [priceGroupById, productById]
  )

  const [editOpen, setEditOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [productSearch, setProductSearch] = useState('')

  const emptyForm: EditForm = {
    customerCode: '',
    productId: '',
    priceGroupId: '',
    price: '',
    currency: 'TL'
  }

  const [form, setForm] = useState<EditForm>(emptyForm)

  const openCreate = () => {
    setEditError(null)
    setProductSearch('')
    setForm({
      ...emptyForm,
      customerCode: selectedCustomerCode,
      priceGroupId: selectedPriceGroupId,
      currency: 'TL'
    })
    setEditOpen(true)
  }

  const closeEdit = () => {
    if (saving) return
    setEditOpen(false)
  }

  const filteredProductOptions = useMemo(() => {
    const q = productSearch.trim().toLowerCase()
    const list = products
      .slice()
      .sort((a, b) => String(a.stockCode).localeCompare(String(b.stockCode)))
      .filter((p) => {
        if (!q) return true
        return p.stockCode.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
      })
      .slice(0, 300)

    return list.map((p) => ({ value: p.id, label: `[${p.stockCode}] ${p.name}` }))
  }, [productSearch, products])

  const submit = async () => {
    try {
      setSaving(true)
      setEditError(null)

      const customerCode = String(form.customerCode ?? '').trim()
      const productId = String(form.productId ?? '').trim()
      const priceGroupId = String(form.priceGroupId ?? '').trim()
      const currency = String(form.currency ?? '').trim().toUpperCase()
      const price = parseDecimalInput(form.price)

      if (!customerCode) {
        setEditError('Bayi seçiniz')
        return
      }
      if (!productId) {
        setEditError('Ürün seçiniz')
        return
      }
      if (!priceGroupId) {
        setEditError('Fiyat kategorisi seçiniz')
        return
      }
      if (price == null || price <= 0) {
        setEditError('Fiyat geçersiz')
        return
      }
      if (currency.length < 2 || currency.length > 3) {
        setEditError('Para birimi geçersiz (ör: TL, USD, EUR)')
        return
      }

      await upsertCustomerProductPriceOverride({ customerCode, productId, priceGroupId, price, currency })

      setEditOpen(false)
      await reloadOverrides({ customerCode, priceGroupId })
    } catch (e: any) {
      setEditError(String(e?.message ?? 'Kaydedilemedi'))
    } finally {
      setSaving(false)
    }
  }

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<CustomerProductPriceOverrideDto | null>(null)

  const askDelete = (row: CustomerProductPriceOverrideDto) => {
    setDeleteTarget(row)
    setDeleteOpen(true)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      setSaving(true)
      setError(null)
      await deleteCustomerProductPriceOverride(deleteTarget.id)
      setDeleteOpen(false)
      setDeleteTarget(null)
      await reloadOverrides()
    } catch (e: any) {
      setError(String(e?.message ?? 'Silinemedi'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Bayi Özel Fiyat</h1>
          <p className="text-xs text-gray-400 mt-0.5">Fiyatlandırma / Özel Fiyat Yönetimi</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition"
        >
          <Plus size={15} />
          Yeni
        </button>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-3 grid grid-cols-1 md:grid-cols-3 gap-3">
        <FormSelect
          label="Bayi"
          value={selectedCustomerCode}
          onChange={(e) => setSelectedCustomerCode(e.target.value)}
          options={customerOptions}
        />

        <FormSelect
          label="Default Fiyat Kategorisi"
          value={defaultPriceGroupId}
          onChange={(e) => void applyDefaultPriceGroup(e.target.value)}
          options={[{ value: '', label: 'Seçiniz...' }, ...priceGroupOptions]}
        />

        <FormSelect
          label="Override Liste Filtresi"
          value={selectedPriceGroupId}
          onChange={(e) => setSelectedPriceGroupId(e.target.value)}
          options={[{ value: '', label: 'Tümü' }, ...priceGroupOptions]}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500">
        <div>{defaultSaving ? 'Default fiyat kategorisi güncelleniyor...' : ''}</div>
        <div>Toplam: {rows.length}</div>
      </div>

      {error ? <div className="text-xs font-semibold text-red-600">{error}</div> : null}

      <DataGrid<Row>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        isLoading={loading}
        emptyText="Kayıt bulunamadı."
        heightClassName="max-h-[calc(100vh-260px)]"
      />

      <Modal
        isOpen={editOpen}
        onClose={closeEdit}
        title="Özel Fiyat Ekle"
        footer={
          <>
            <button
              type="button"
              disabled={saving}
              onClick={closeEdit}
              className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void submit()}
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-60"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              {saving ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </>
        }
      >
        {editError ? <div className="mb-3 text-xs font-semibold text-red-600">{editError}</div> : null}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormSelect
            label="Bayi"
            value={form.customerCode}
            onChange={(e) => setForm((p) => ({ ...p, customerCode: e.target.value }))}
            options={customerOptions}
          />

          <FormSelect
            label="Fiyat Kategorisi"
            value={form.priceGroupId}
            onChange={(e) => setForm((p) => ({ ...p, priceGroupId: e.target.value }))}
            options={priceGroupOptions}
          />

          <div className="md:col-span-2">
            <FormInput
              label="Ürün ara"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Stok kodu / ürün adı"
            />
          </div>

          <div className="md:col-span-2">
            <FormSelect
              label="Ürün"
              value={form.productId}
              onChange={(e) => setForm((p) => ({ ...p, productId: e.target.value }))}
              options={[{ value: '', label: 'Seçiniz...' }, ...filteredProductOptions]}
            />
          </div>

          <FormInput label="Fiyat" value={form.price} onChange={(e) => setForm((p) => ({ ...p, price: e.target.value }))} inputMode="decimal" />

          <FormSelect
            label="Currency"
            value={form.currency}
            onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value }))}
            options={[
              { value: 'TL', label: 'TL' },
              { value: 'USD', label: 'USD' },
              { value: 'EUR', label: 'EUR' },
              { value: 'GBP', label: 'GBP' }
            ]}
          />
        </div>
      </Modal>

      <Modal
        isOpen={deleteOpen}
        onClose={() => {
          if (saving) return
          setDeleteOpen(false)
          setDeleteTarget(null)
        }}
        title="Pasife Al"
        footer={
          <>
            <button
              type="button"
              className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition"
              onClick={() => {
                setDeleteOpen(false)
                setDeleteTarget(null)
              }}
              disabled={saving}
            >
              Vazgeç
            </button>
            <button
              type="button"
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white shadow-sm transition disabled:opacity-60"
              onClick={() => void confirmDelete()}
              disabled={saving}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
              Pasife Al
            </button>
          </>
        }
      >
        <div className="text-sm text-gray-700">Bu özel fiyat pasife alınsın mı?</div>
        {deleteTarget ? (
          <div className="mt-2 text-xs text-gray-500">
            {productById[deleteTarget.productId]?.stockCode ?? deleteTarget.productId}
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
