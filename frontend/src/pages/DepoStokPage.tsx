import React, { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import FormSelect from '../components/forms/FormSelect'
import Table, { type TableColumn } from '../components/Table'
import { fetchWarehousesDropdownForStock, fetchWarehouseInventoryForStock, type WarehouseInventoryItem } from '../api/warehouses'

function isAbortError(e: any) {
  if (!e) return false
  const name = String(e?.name ?? '')
  const msg = String(e?.message ?? '')
  return name === 'AbortError' || msg.toLowerCase().includes('aborted')
}

function formatQty(n: number) {
  const v = Number(n ?? 0)
  return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type WarehouseOption = { value: string; label: string }

export default function DepoStokPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([{ value: '', label: 'Depo seçiniz...' }])
  const [warehouseCode, setWarehouseCode] = useState('')

  // Sayfa "Güncel Stok Raporu": başlangıç tarihi BOŞ olmalı, yoksa yalnızca BUGÜN hareket
  // görmüş ürünler listelenir ve depodaki mevcut stok her üründe 0 görünür. Uç zaten
  // `from`/`to` alanlarını isteğe bağlı alıyor (WarehousesController.InventoryForStock).
  const [from, setFrom] = useState('')
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [items, setItems] = useState<WarehouseInventoryItem[]>([])
  const [totals, setTotals] = useState<{ totalIn: number; totalOut: number; balance: number }>({ totalIn: 0, totalOut: 0, balance: 0 })

  const columns = useMemo<TableColumn<WarehouseInventoryItem>[]>(
    () => [
      { key: 'stockCode', label: 'Stok Kodu', searchable: true },
      { key: 'stockName', label: 'Stok Adı', searchable: true },
      { key: 'totalIn', label: 'Giriş', render: (v) => formatQty(Number(v ?? 0)) },
      { key: 'totalOut', label: 'Çıkış', render: (v) => formatQty(Number(v ?? 0)) },
      { key: 'balance', label: 'Bakiye', render: (v) => formatQty(Number(v ?? 0)) }
    ],
    []
  )

  const canRun = useMemo(() => {
    // NEGATİF DEPO KODU GEÇERLİ: kaynak ERP sipariş/sanal depolarını negatif kodla tutuyor
    // (-20 SİPARİŞ, -21 YP SİPARİŞ aktif depolar). `> 0` süzgeci, listede görünen bu depoları
    // seçilebilir ama çalıştırılamaz yapıyordu. Backend de bu yüzden `== 0` kontrolü kullanıyor
    // (WarehousesController). Yalnızca sıfır geçersizdir.
    const code = Number(warehouseCode)
    return Number.isFinite(code) && code !== 0 && warehouseCode.trim() !== ''
  }, [warehouseCode])

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        const list = await fetchWarehousesDropdownForStock({ signal: ac.signal })
        const opts = (list ?? []).map((x: any) => ({ value: String(x.warehouseCode), label: `${x.warehouseCode} ${x.name ?? ''}`.trim() }))
        setWarehouses([{ value: '', label: 'Depo seçiniz...' }, ...opts])
      } catch {
        setWarehouses([{ value: '', label: 'Depo seçiniz...' }])
      }
    })()
    return () => ac.abort()
  }, [])

  const run = async () => {
    const code = Number(warehouseCode)
    if (!Number.isFinite(code) || code === 0 || warehouseCode.trim() === '') return

    const ac = new AbortController()
    try {
      setLoading(true)
      setError(null)

      const res = await fetchWarehouseInventoryForStock(
        code,
        { from: from || null, to: to || null },
        { signal: ac.signal }
      )

      setItems((res.items ?? []) as any)
      setTotals((res.totals ?? { totalIn: 0, totalOut: 0, balance: 0 }) as any)
    } catch (e: any) {
      if (isAbortError(e)) return
      setItems([])
      setTotals({ totalIn: 0, totalOut: 0, balance: 0 })
      setError(String(e?.message ?? 'Depo stok listesi alınamadı'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 bg-slate-50/30 min-h-[calc(100vh-64px)]">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800 tracking-tight flex items-center gap-2.5">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 shadow-sm">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
            </span>
            Depo Stok Durumu
          </h1>
          <p className="text-[11px] font-semibold text-slate-400 mt-1 ml-10.5">Depo İşlemleri / Güncel Stok Raporu</p>
        </div>
      </div>

      {/* Filter Panel */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 mb-6">
        <div className="grid grid-cols-12 gap-5 items-end">
          <div className="col-span-12 lg:col-span-4">
            <FormSelect label="Depo Seçimi" value={warehouseCode} onChange={(e) => setWarehouseCode(e.target.value)} options={warehouses} />
          </div>
          <div className="col-span-12 lg:col-span-3">
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5 ml-0.5">Tarih (Başlangıç)</label>
            <input type="date" className="h-10 px-3 text-sm text-slate-700 rounded-lg border border-slate-200 bg-white focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all outline-none w-full hover:border-slate-350" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="col-span-12 lg:col-span-3">
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5 ml-0.5">Tarih (Bitiş)</label>
            <input type="date" className="h-10 px-3 text-sm text-slate-700 rounded-lg border border-slate-200 bg-white focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all outline-none w-full hover:border-slate-350" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="col-span-12 lg:col-span-2">
            <button
              type="button"
              onClick={() => void run()}
              disabled={loading || !canRun}
              className="w-full h-10 inline-flex items-center justify-center gap-2 text-sm font-bold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all focus:outline-none"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={loading ? 'animate-spin' : ''}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              {loading ? 'Yükleniyor...' : 'Raporu Getir'}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-3.5 bg-red-50 border border-red-100 rounded-xl text-xs font-bold text-red-600 flex items-center gap-2.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {error}
        </div>
      )}

      <div className="grid grid-cols-12 gap-6 mb-6">
        {/* Summary Table */}
        <div className="col-span-12 lg:col-span-4">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
              <h2 className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-2">
                Genel Özet
              </h2>
            </div>
            <div>
              <div className="overflow-x-auto"><table className="w-full text-left border-collapse text-xs whitespace-nowrap">
                <thead>
                  <tr className="bg-slate-50/50">
                    <th className="px-4 py-2.5 font-bold text-slate-500 text-[10px] uppercase tracking-wider text-left border-b border-slate-100">Alan</th>
                    <th className="px-4 py-2.5 font-bold text-slate-500 text-[10px] uppercase tracking-wider text-right border-b border-slate-100">Değer</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-150/60">
                  {loading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i}>
                        <td className="px-4 py-3"><div className="h-3 bg-slate-100 rounded animate-pulse w-24" /></td>
                        <td className="px-4 py-3"><div className="h-3 bg-slate-100 rounded animate-pulse w-16 ml-auto" /></td>
                      </tr>
                    ))
                  ) : (
                    <>
                      <tr className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-2.5 text-slate-600 font-semibold">Toplam Giriş</td>
                        <td className="px-4 py-2.5 text-right font-bold text-emerald-600">{formatQty(Number(totals.totalIn ?? 0))}</td>
                      </tr>
                      <tr className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-2.5 text-slate-600 font-semibold">Toplam Çıkış</td>
                        <td className="px-4 py-2.5 text-right font-bold text-rose-500">{formatQty(Number(totals.totalOut ?? 0))}</td>
                      </tr>
                      <tr className="bg-slate-50/40">
                        <td className="px-4 py-3 font-bold text-slate-800">Bakiye</td>
                        <td className="px-4 py-3 text-right font-black text-slate-900 text-sm">{formatQty(Number(totals.balance ?? 0))}</td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table></div>
            </div>
          </div>
        </div>

        {/* Detailed Items Table */}
        <div className="col-span-12 lg:col-span-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xs font-bold text-slate-600 uppercase tracking-wider ml-1">
              Stok Kalemleri
            </h2>
            {items.length > 0 && (
              <span className="text-[10px] font-bold text-slate-500 bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-sm">
                {items.length} kayıt bulundu
              </span>
            )}
          </div>
          {loading ? (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8 space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-6">
                  <div className="h-3.5 bg-slate-100 rounded animate-pulse w-32" />
                  <div className="h-3.5 bg-slate-100 rounded animate-pulse flex-1" />
                  <div className="h-3.5 bg-slate-100 rounded animate-pulse w-20" />
                  <div className="h-3.5 bg-slate-100 rounded animate-pulse w-20" />
                  <div className="h-3.5 bg-slate-100 rounded animate-pulse w-20" />
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-6 py-16 text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-slate-50 border border-slate-100 text-slate-400 mb-4 shadow-inner">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
              </div>
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Henüz Kayıt Yok</div>
              <p className="text-xs text-slate-400 mt-1.5 max-w-xs mx-auto leading-relaxed">Görüntülenecek stok verisi bulunmuyor. Seçtiğiniz depo ve tarih aralığını kontrol edin.</p>
            </div>
          ) : (
            <Table
          onRefresh={() => void run()} columns={columns} data={items} showColumnFilters />
          )}
        </div>
      </div>
    </div>
  )
}
