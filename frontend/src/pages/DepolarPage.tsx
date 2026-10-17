import React, { useEffect, useMemo, useState } from 'react'
import { fetchAllPages } from '../lib/fetchAllPages'
import { Plus, Pencil, Search, Trash2, Eye } from 'lucide-react'
import Modal from '../components/Modal'
import NotificationPopup from '../components/NotificationPopup'
import Table, { type TableColumn } from '../components/Table'
import ActionDropdown from '../components/ActionDropdown'
import {
  createWarehouse,
  deleteWarehouse,
  fetchWarehouseInventory,
  fetchWarehouseMovements,
  fetchWarehouses,
  updateWarehouse,
  type WarehouseDto,
  type WarehouseInventoryItem,
  type WarehouseMovementItem
} from '../api/warehouses'
import { fetchSalesmenDropdown, type SalesmanDropdownItem } from '../api/salesmen'

function isAbortError(e: any) {
  if (!e) return false
  const name = String(e?.name ?? '')
  const msg = String(e?.message ?? '')
  return name === 'AbortError' || msg.toLowerCase().includes('aborted')
}

export default function DepolarPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [rows, setRows] = useState<WarehouseDto[]>([])
  const [includeInactive, setIncludeInactive] = useState(false)

  const [salesmen, setSalesmen] = useState<SalesmanDropdownItem[]>([])
  const salesmanByCode = useMemo(() => {
    const out: Record<string, string> = {}
    for (const s of salesmen) {
      const code = String(s.salesmanCode ?? '').trim()
      if (code) out[code] = String(s.description ?? '').trim()
    }
    return out
  }, [salesmen])

  const [modalOpen, setModalOpen] = useState(false)
  const [editCode, setEditCode] = useState<number | null>(null)
  const [modalError, setModalError] = useState<string | null>(null)

  const [detailOpen, setDetailOpen] = useState(false)
  const [detailWarehouse, setDetailWarehouse] = useState<WarehouseDto | null>(null)
  const [detailFrom, setDetailFrom] = useState(() => new Date().toISOString().slice(0, 10))
  const [detailTo, setDetailTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [detailInvItems, setDetailInvItems] = useState<WarehouseInventoryItem[]>([])
  const [detailInvTotals, setDetailInvTotals] = useState<{ totalIn: number; totalOut: number; balance: number }>({ totalIn: 0, totalOut: 0, balance: 0 })
  const [detailMovItems, setDetailMovItems] = useState<WarehouseMovementItem[]>([])

  const [form, setForm] = useState<WarehouseDto>({
    warehouseCode: 0,
    name: '',
    salesmanCode: null,
    isVehicle: false,
    plate: null,
    driverName: null,
    vehicleType: null,
    vehicleModel: null,
    negativeBalanceControl: false,
    isActive: true
  })

  const loadAll = async (signal?: AbortSignal) => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchWarehouses({ includeInactive, signal })
      setRows(data)
    } catch (e: any) {
      if (isAbortError(e)) return
      setRows([])
      setError(String(e?.message ?? 'Depolar alınamadı'))
    } finally {
      setLoading(false)
    }
  }

  const detailInvColumns = useMemo<TableColumn<WarehouseInventoryItem>[]>(
    () => [
      {
        key: 'stockCode',
        label: 'Stok',
        searchable: true,
        render: (v) => String(v ?? '')
      },
      {
        key: 'totalIn',
        label: 'Giriş',
        render: (v) => Number(v ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      },
      {
        key: 'totalOut',
        label: 'Çıkış',
        render: (v) => Number(v ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      },
      {
        key: 'balance',
        label: 'Bakiye',
        render: (v) => Number(v ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      }
    ],
    []
  )

  const detailMovColumns = useMemo<TableColumn<WarehouseMovementItem>[]>(
    () => [
      { key: 'date', label: 'Tarih', searchable: true, filter: { type: 'date' }, render: (v) => String(v ?? '').slice(0, 10) },
      { key: 'invoiceNo', label: 'Fiş No', searchable: true },
      { key: 'customerCode', label: 'Cari', searchable: true },
      {
        key: 'direction',
        label: 'Yön',
        searchable: true,
        render: (v) => {
          const d = String(v ?? '')
          if (d === 'G' || d === 'In') return 'Giriş'
          if (d === 'C' || d === 'Out') return 'Çıkış'
          return d
        }
      },
      {
        key: 'stockCode',
        label: 'Stok',
        searchable: true,
        render: (v) => String(v ?? '')
      },
      {
        key: 'quantity',
        label: 'Miktar',
        render: (v) => Number(v ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      },
      {
        key: 'netUnitPrice',
        label: 'Fiyat',
        render: (v) => Number(v ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      },
      { key: 'invoiceNo', label: 'Açıklama', searchable: true, render: (v) => String(v ?? '') }
    ],
    []
  )

 
  useEffect(() => {
    const ac = new AbortController()
    void loadAll(ac.signal)
    return () => ac.abort()
  }, [includeInactive])

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        const list = await fetchSalesmenDropdown({ signal: ac.signal })
        setSalesmen(list)
      } catch {
        setSalesmen([])
      }
    })()
    return () => ac.abort()
  }, [])

  const openCreate = () => {
    setEditCode(null)
    setModalError(null)
    setForm({
      warehouseCode: 0,
      name: '',
      salesmanCode: null,
      isVehicle: false,
      plate: null,
      driverName: null,
      vehicleType: null,
      vehicleModel: null,
      negativeBalanceControl: false,
      isActive: true
    })
    setModalOpen(true)
  }

  const openDetail = async (w: WarehouseDto) => {
    setDetailWarehouse(w)
    const today = new Date().toISOString().slice(0, 10)
    setDetailFrom(today)
    setDetailTo(today)
    setDetailInvItems([])
    setDetailInvTotals({ totalIn: 0, totalOut: 0, balance: 0 })
    setDetailMovItems([])
    setDetailOpen(true)

    const ac = new AbortController()
    try {
      setLoading(true)
      const code = Number(w.warehouseCode)
      const inv = await fetchWarehouseInventory(code, {}, { signal: ac.signal })
      setDetailInvItems(inv.items ?? [])
      setDetailInvTotals(inv.totals ?? { totalIn: 0, totalOut: 0, balance: 0 })
      // Bütün hareketler sayfa sayfa (2026-10-08): eskiden yalnız son 200 hareket geliyordu.
      await fetchAllPages(async (skip, take) => (await fetchWarehouseMovements(code, { take, skip }, { signal: ac.signal })).items ?? [], {
        key: (x: any) => String(x.id),
        onPage: (all) => setDetailMovItems(all)
      })
    } catch (e: any) {
      if (!isAbortError(e)) setError(String(e?.message ?? 'Depo detayı alınamadı'))
    } finally {
      setLoading(false)
    }
  }

  const reloadDetail = async () => {
    if (!detailWarehouse) return
    const ac = new AbortController()
    try {
      setLoading(true)
      setError(null)
      const code = Number(detailWarehouse.warehouseCode)
      const inv = await fetchWarehouseInventory(
        code,
        { from: detailFrom || null, to: detailTo || null },
        { signal: ac.signal }
      )
      setDetailInvItems(inv.items ?? [])
      setDetailInvTotals(inv.totals ?? { totalIn: 0, totalOut: 0, balance: 0 })
      await fetchAllPages(
        async (skip, take) =>
          (await fetchWarehouseMovements(code, { from: detailFrom || null, to: detailTo || null, take, skip }, { signal: ac.signal })).items ?? [],
        { key: (x: any) => String(x.id), onPage: (all) => setDetailMovItems(all) }
      )
    } catch (e: any) {
      if (!isAbortError(e)) setError(String(e?.message ?? 'Depo detayı alınamadı'))
    } finally {
      setLoading(false)
    }
  }

  const openEdit = (w: WarehouseDto) => {
    setEditCode(Number(w.warehouseCode))
    setModalError(null)
    setForm({
      warehouseCode: Number(w.warehouseCode),
      name: w.name ?? '',
      salesmanCode: w.salesmanCode ?? null,
      isVehicle: Boolean((w as any).isVehicle ?? false),
      plate: String((w as any).plate ?? '').trim() || null,
      driverName: String((w as any).driverName ?? '').trim() || null,
      vehicleType: String((w as any).vehicleType ?? '').trim() || null,
      vehicleModel: String((w as any).vehicleModel ?? '').trim() || null,
      negativeBalanceControl: Boolean(w.negativeBalanceControl),
      isActive: Boolean(w.isActive)
    })
    setModalOpen(true)
  }

  const save = async () => {
    try {
      setLoading(true)
      setModalError(null)
      setSuccess(null)

      const code = Number(form.warehouseCode)
      if (!Number.isFinite(code) || code <= 0) throw new Error('Depo kodu zorunludur')

      const isVehicle = Boolean((form as any).isVehicle)
      const plate = String((form as any).plate ?? '').trim()
      if (isVehicle && !plate) throw new Error('Araç seçiliyse plaka zorunludur')

      const driverName = String((form as any).driverName ?? '').trim()
      if (driverName && !/^[A-Za-zÇĞİÖŞÜçğıöşü\s]+$/.test(driverName)) {
        throw new Error('Sürücü sadece harf olmalıdır')
      }

      const vehicleModel = String((form as any).vehicleModel ?? '').trim()
      if (vehicleModel && !/^\d{4}$/.test(vehicleModel)) {
        throw new Error('Model sadece 4 haneli sayı olmalıdır')
      }

      const payload: WarehouseDto = {
        warehouseCode: code,
        name: String(form.name ?? '').trim() || null,
        salesmanCode: String(form.salesmanCode ?? '').trim() || null,
        isVehicle,
        plate: plate || null,
        driverName: String((form as any).driverName ?? '').trim() || null,
        vehicleType: String((form as any).vehicleType ?? '').trim() || null,
        vehicleModel: String((form as any).vehicleModel ?? '').trim() || null,
        negativeBalanceControl: Boolean(form.negativeBalanceControl),
        isActive: Boolean(form.isActive)
      }

      if (editCode) {
        await updateWarehouse(editCode, payload)
        setSuccess('Depo güncellendi')
      } else {
        await createWarehouse(payload)
        setSuccess('Depo oluşturuldu')
      }

      setModalOpen(false)
      setEditCode(null)
      await loadAll()
    } catch (e: any) {
      setModalError(String(e?.message ?? 'Depo kaydedilemedi'))
    } finally {
      setLoading(false)
    }
  }

  const remove = async (w: WarehouseDto) => {
    try {
      setLoading(true)
      setError(null)
      setSuccess(null)
      const code = Number(w.warehouseCode)
      if (!Number.isFinite(code) || code === 0) throw new Error('Geçersiz depo kodu')
      await deleteWarehouse(code)
      setSuccess('Depo silindi')
      await loadAll()
    } catch (e: any) {
      setError(String(e?.message ?? 'Depo silinemedi'))
    } finally {
      setLoading(false)
    }
  }
  const columns = useMemo<TableColumn<WarehouseDto>[]>(
    () => [
      { key: 'warehouseCode', label: 'Depo Kodu', searchable: true },
      { key: 'name', label: 'Depo Adı', searchable: true },
      {
        key: 'isVehicle',
        label: 'Araç',
        searchable: true,
        filter: {
          type: 'select',
          options: [
            { label: 'Evet', value: 'evet' },
            { label: 'Hayır', value: 'hayır' }
          ]
        },
        render: (v, row) => {
          const isVehicle = Boolean((row as any).isVehicle)
          if (!isVehicle) return 'Hayır'
          const plate = String((row as any).plate ?? '').trim()
          return plate ? `Evet (${plate})` : 'Evet'
        }
      },
      {
        key: 'salesmanCode',
        label: 'Plasiyer',
        searchable: true,
        render: (v) => {
          const sc = String(v ?? '').trim()
          const salesmanName = sc ? salesmanByCode[sc] : ''
          return sc ? `${sc} ${salesmanName}`.trim() : ''
        }
      },
      {
        key: 'negativeBalanceControl',
        label: 'Negatif Kontrol',
        searchable: true,
        filter: {
          type: 'select',
          options: [
            { label: 'Evet', value: 'evet' },
            { label: 'Hayır', value: 'hayır' }
          ]
        },
        render: (v) => (v ? 'Evet' : 'Hayır')
      },
      {
        key: 'isActive',
        label: 'Aktif',
        searchable: true,
        filter: {
          type: 'select',
          options: [
            { label: 'Evet', value: 'evet' },
            { label: 'Hayır', value: 'hayır' }
          ]
        },
        render: (v) => (v ? 'Evet' : 'Hayır')
      },
      {
        key: 'warehouseCode',
        label: 'İşlemler',
        render: (_, row) => (
          <div className="flex items-center gap-1.5 justify-end relative z-10" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                void openDetail(row)
              }}
              className="px-2.5 h-7 inline-flex items-center gap-1 text-[11px] font-bold rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition"
            >
              <Eye size={12} />
              Detay
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                openEdit(row)
              }}
              className="px-2.5 h-7 inline-flex items-center gap-1 text-[11px] font-bold rounded bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 transition"
            >
              <Pencil size={12} />
              Düzenle
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                if (window.confirm('Bu depoyu silmek istediğinize emin misiniz?')) {
                  void remove(row)
                }
              }}
              className="px-2.5 h-7 inline-flex items-center gap-1 text-[11px] font-bold rounded bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 transition"
            >
              <Trash2 size={12} />
              Sil
            </button>
          </div>
        )
      }
    ],
    [openDetail, openEdit, remove, salesmanByCode]
  )

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Depolar</h1>
          <p className="text-xs text-gray-400 mt-0.5">Depo İşlemleri / Depo Yönetimi</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
            <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} className="accent-emerald-600" />
            Pasifleri göster
          </label>
          <button
            type="button"
            onClick={openCreate}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Yeni Depo
          </button>
        </div>
      </div>

      {error && <div className="mb-3 text-xs font-semibold text-red-600">{error}</div>}

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-visible relative overflow-x-auto">
        {loading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="h-3 bg-gray-100 rounded animate-pulse w-16" />
                <div className="h-3 bg-gray-100 rounded animate-pulse flex-1" />
                <div className="h-3 bg-gray-100 rounded animate-pulse w-20" />
                <div className="h-3 bg-gray-100 rounded animate-pulse w-16" />
                <div className="h-3 bg-gray-100 rounded animate-pulse w-24" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <div className="text-gray-300 text-2xl mb-1">🏭</div>
            <div className="text-xs text-gray-400 font-medium">Kayıt bulunamadı.</div>
          </div>
        ) : (
          <div className="min-w-[900px]">
            <Table
          onRefresh={() => void loadAll()} columns={columns} data={rows} showColumnFilters />
          </div>
        )}
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editCode ? 'Depo Güncelle' : 'Yeni Depo'}
        footer={
          <>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition"
            >
              Vazgeç
            </button>
            <button
              type="button"
              onClick={save}
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-50"
              disabled={loading}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              Kaydet
            </button>
          </>
        }
      >
        {modalError && <div className="mb-3 text-xs font-semibold text-red-600 whitespace-pre-line">{modalError}</div>}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Depo Kodu</label>
            <input
              type="number"
              className="input-base"
              value={String(form.warehouseCode)}
              onChange={(e) => setForm((p) => ({ ...p, warehouseCode: Number(e.target.value) }))}
              disabled={Boolean(editCode)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Depo Adı</label>
            <input
              className="input-base"
              value={String(form.name ?? '')}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="Depo adı"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Plasiyer</label>
            <select
              className="input-base"
              value={String(form.salesmanCode ?? '')}
              onChange={(e) => setForm((p) => ({ ...p, salesmanCode: e.target.value || null }))}
            >
              <option value="" disabled>
                Seçiniz...
              </option>
              {salesmen.map((s) => (
                <option key={String(s.salesmanCode)} value={String(s.salesmanCode)}>
                  {String(s.salesmanCode)} {String(s.description ?? '').trim()}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-6 mt-6">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={Boolean((form as any).isVehicle)}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    isVehicle: e.target.checked,
                    plate: e.target.checked ? (p as any).plate : null,
                    driverName: e.target.checked ? (p as any).driverName : null,
                    vehicleType: e.target.checked ? (p as any).vehicleType : null,
                    vehicleModel: e.target.checked ? (p as any).vehicleModel : null
                  }))
                }
              />
              Araç mı?
            </label>

            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={Boolean(form.negativeBalanceControl)}
                onChange={(e) => setForm((p) => ({ ...p, negativeBalanceControl: e.target.checked }))}
              />
              Negatif Bakiye Kontrol
            </label>

            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={Boolean(form.isActive)} onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))} />
              Aktif
            </label>
          </div>

          {Boolean((form as any).isVehicle) ? (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Plaka</label>
                <input
                  className="input-base"
                  value={String((form as any).plate ?? '')}
                  onChange={(e) => setForm((p) => ({ ...p, plate: e.target.value }))}
                  placeholder="34 ABC 123"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Sürücü (opsiyonel)</label>
                <input
                  className="input-base"
                  value={String((form as any).driverName ?? '')}
                  onChange={(e) => {
                    const v = String(e.target.value ?? '')
                      .replace(/[^A-Za-zÇĞİÖŞÜçğıöşü\s]/g, '')
                    setForm((p) => ({ ...p, driverName: v }))
                  }}
                  placeholder="Sürücü adı"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Araç Tipi (opsiyonel)</label>
                <input
                  className="input-base"
                  value={String((form as any).vehicleType ?? '')}
                  onChange={(e) => setForm((p) => ({ ...p, vehicleType: e.target.value }))}
                  placeholder="Kamyonet"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Model (opsiyonel)</label>
                <input
                  className="input-base"
                  value={String((form as any).vehicleModel ?? '')}
                  onChange={(e) => {
                    const v = String(e.target.value ?? '').replace(/\D/g, '').slice(0, 4)
                    setForm((p) => ({ ...p, vehicleModel: v }))
                  }}
                  placeholder="2020"
                />
              </div>
            </>
          ) : null}
        </div>
      </Modal>

      <Modal
        isOpen={detailOpen}
        onClose={() => setDetailOpen(false)}
        title={`Depo Detay: ${detailWarehouse ? `${detailWarehouse.warehouseCode} ${String(detailWarehouse.name ?? '').trim()}`.trim() : ''}`}
        containerClassName="max-w-6xl"
        footer={
          <>
            <button
              type="button"
              onClick={() => setDetailOpen(false)}
              className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition"
            >
              Kapat
            </button>
          </>
        }
        scrollable
      >
        {detailWarehouse && Boolean((detailWarehouse as any).isVehicle) ? (
          <div className="mb-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 rounded-lg border border-gray-100 bg-gray-50">
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest">Araç</div>
              <div className="mt-1 text-sm font-semibold text-gray-800">
                {String((detailWarehouse as any).plate ?? '').trim() || 'Plaka yok'}
              </div>
              <div className="mt-1 text-xs text-gray-600">
                {String((detailWarehouse as any).driverName ?? '').trim() || ''}
              </div>
            </div>
            <div className="p-3 rounded-lg border border-gray-100 bg-gray-50">
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest">Tip / Model</div>
              <div className="mt-1 text-sm font-semibold text-gray-800">
                {String((detailWarehouse as any).vehicleType ?? '').trim() || '-'}
              </div>
              <div className="mt-1 text-xs text-gray-600">
                {String((detailWarehouse as any).vehicleModel ?? '').trim() || ''}
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-12 gap-4 mb-4">
          <div className="col-span-12 lg:col-span-4">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Tarih (Başlangıç)</label>
            <input type="date" className="input-base" value={detailFrom} onChange={(e) => setDetailFrom(e.target.value)} />
          </div>
          <div className="col-span-12 lg:col-span-4">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Tarih (Bitiş)</label>
            <input type="date" className="input-base" value={detailTo} onChange={(e) => setDetailTo(e.target.value)} />
          </div>
          <div className="col-span-12 lg:col-span-4" />
        </div>

        <div className="flex items-center justify-end mb-4">
          <button
            type="button"
            onClick={() => void reloadDetail()}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-50"
            disabled={loading || !detailWarehouse}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Getir
          </button>
        </div>

        <div className="grid grid-cols-12 gap-4 mb-4">
          <div className="col-span-12 lg:col-span-6">
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-visible relative overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 text-[10px] font-semibold text-gray-500 uppercase tracking-widest border-b border-gray-100">
                    <th className="px-3 py-2 text-left">Özet</th>
                    <th className="px-3 py-2 text-right">Toplam Giriş</th>
                    <th className="px-3 py-2 text-right">Toplam Çıkış</th>
                    <th className="px-3 py-2 text-right">Bakiye</th>
                  </tr>
                </thead>
                <tbody className="text-[12px]">
                  <tr className="border-t border-gray-100">
                    <td className="px-3 py-2">Depo</td>
                    <td className="px-3 py-2 text-right">{Number(detailInvTotals.totalIn ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2 text-right">{Number(detailInvTotals.totalOut ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2 text-right font-semibold">{Number(detailInvTotals.balance ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="col-span-12 lg:col-span-6">
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-visible relative overflow-x-auto">
              {detailInvItems.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <div className="text-gray-300 text-lg">📦</div>
                  <div className="text-[10px] text-gray-400">Veri yok.</div>
                </div>
              ) : (
                <div className="min-w-[560px]">
                  <Table
          onRefresh={() => void loadAll()}
                    columns={detailInvColumns}
                    data={detailInvItems}
                    showColumnFilters
                    rowClassName={(row) => {
                      const minStock = Number((row as any).minStock ?? 0)
                      const balance = Number((row as any).balance ?? (row as any).quantity ?? 0)
                      if (minStock > 0 && balance <= minStock) return 'bg-red-50 [&>td]:bg-red-50'
                      return ''
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-visible relative overflow-x-auto">
          {detailMovItems.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <div className="text-gray-300 text-lg">📦</div>
              <div className="text-[10px] text-gray-400">Veri yok.</div>
            </div>
          ) : (
            <div className="min-w-[1100px]">
              <Table
          onRefresh={() => void loadAll()} columns={detailMovColumns} data={detailMovItems} showColumnFilters />
            </div>
          )}
        </div>
      </Modal>

      {success ? <NotificationPopup isOpen title="Başarılı" message={success} variant="success" onClose={() => setSuccess(null)} /> : null}
    </div>
  )
}
