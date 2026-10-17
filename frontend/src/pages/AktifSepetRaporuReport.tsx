import React, { useEffect, useRef, useState, useMemo } from 'react'
import Table, { type TableColumn } from '../components/Table'
import { useCart } from '../contexts/CartContext'
import {
  fetchActiveBasketReport,
  deleteActiveBasketCustomer,
  fetchOverLimitApprovalPermission,
  confirmBasketOverLimit
} from '../api/reports'

const CURRENCY_SYMBOLS: Record<string, string> = { TRY: '₺', USD: '$', EUR: '€', GBP: '£' }

function symbolOf(currency?: string | null) {
  const code = String(currency ?? 'TRY').toUpperCase()
  return CURRENCY_SYMBOLS[code] ?? `${code} `
}

function formatMoney(n: number, currency?: string | null) {
  const v = Number(n ?? 0)
  return `${symbolOf(currency)}${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Karışık dövizli sepette TEK TOPLAM YAZILMAZ.
 *
 * Sepet fiyatları ürünün satış dövizinden geliyor; dolarlı ve TL'li kalem aynı sepette
 * olabiliyor. Backend `totalsByCurrency` gönderiyor — tek sayı yazmak 100 $ ile 100 ₺'yi
 * 200 sayardı.
 */
function renderTotal(row: any, field: 'subtotal' | 'discountTotal' | 'vatTotal' | 'grandTotal') {
  const totals: any[] = Array.isArray(row?.totalsByCurrency) ? row.totalsByCurrency : []
  if (totals.length > 1) {
    return (
      <div className="flex flex-col items-end gap-0.5">
        {totals.map((t) => (
          <span key={String(t.currency)} className="whitespace-nowrap">
            {formatMoney(Number(t[field] ?? 0), t.currency)}
          </span>
        ))}
      </div>
    )
  }
  const single = totals.length === 1 ? totals[0] : null
  const currency = single?.currency ?? row?.currency ?? 'TRY'
  const value = single ? Number(single[field] ?? 0) : Number(row?.[field] ?? 0)
  return <span className="whitespace-nowrap">{formatMoney(value, currency)}</span>
}

export default function AktifSepetRaporuReport() {
  const cart = useCart()
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<any[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  /*
    LİMİT AŞIMIYLA ONAY (2026-10-14 kullanıcı isteği). Düğme yalnız rolünde yetki açık olana
    (Kullanıcılar → rol yetkileri → "Limit Aşımıyla Sipariş Onayı"), Süper Admin'e ve SSA'ya
    görünür; sunucu da aynı yetkiyi ayrıca kontrol ediyor. Sepetteki "Limitiniz yetersiz"
    akışı değişmedi.
  */
  const [canApproveOverLimit, setCanApproveOverLimit] = useState(false)
  const [approvingCode, setApprovingCode] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void fetchOverLimitApprovalPermission()
      .then((allowed) => {
        if (active) setCanApproveOverLimit(allowed)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  const loadData = async (searchQuery?: string) => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchActiveBasketReport(searchQuery)
      setItems(data || [])
    } catch (err: any) {
      setError(err?.message || 'Aktif sepet raporu yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }

  // Reload when search query changes
  useEffect(() => {
    const timer = setTimeout(() => {
      void loadData(query)
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  // Auto-reload when cart lines change (debounced 1.5s to let sync finish first)
  const cartLinesRef = useRef(cart.lines)
  useEffect(() => {
    cartLinesRef.current = cart.lines
    const timer = setTimeout(() => {
      void loadData(query)
    }, 1500)
    return () => clearTimeout(timer)
  }, [cart.lines])

  const onDelete = async (customerCode: string) => {
    const ok = window.confirm('Seçili carinin sepetindeki tüm ürünleri silmek istediğinize emin misiniz?')
    if (!ok) return

    try {
      setLoading(true)
      await deleteActiveBasketCustomer(customerCode)
      const targetKeys = cart.lines
        .filter((l) => l.dealer?.id === customerCode)
        .map((l) => l.key)
      targetKeys.forEach((key) => {
        cart.removeLine(key)
      })
      window.alert('Sepet temizlendi.')
      await loadData(query)
    } catch (err: any) {
      setError(err?.message || 'Sepet temizlenirken bir hata oluştu.')
    } finally {
      setLoading(false)
    }
  }

  const onApproveOverLimit = async (row: any) => {
    const code = String(row?.customerCode ?? row?.id ?? '')
    if (!code) return
    const ok = window.confirm(
      `${code} ${row?.customerName ?? ''}\n\nBu carinin sepeti KREDİ LİMİTİ AŞILARAK siparişe çevrilecek. ` +
        'İşlem sizin adınızla kayda geçer. Onaylıyor musunuz?'
    )
    if (!ok) return

    try {
      setApprovingCode(code)
      setError(null)
      const result = await confirmBasketOverLimit(code)
      // Sepet sunucuda sipariş yolunda temizlendi; bu tarayıcıdaki kopyası da düşülür.
      cart.lines
        .filter((l) => l.dealer?.id === code)
        .forEach((l) => cart.removeLine(l.key))
      window.alert(result.message || `${result.siparisNo} numaralı sipariş oluşturuldu.`)
      await loadData(query)
    } catch (err: any) {
      setError(err?.message || 'Sipariş oluşturulamadı.')
    } finally {
      setApprovingCode(null)
    }
  }

  const columns: TableColumn<any>[] = useMemo(
    () => [
      {
        key: 'processedAt',
        label: 'Son İşlem Tarihi',
        searchable: true,
        filter: { type: 'date' },
        render: (v, row) => {
          const isExpanded = expandedId === row.id
          return (
            <div className="flex items-center gap-2 font-medium">
              <span
                className="text-slate-400 text-[10px] transition-transform duration-200"
                style={{ display: 'inline-block', transform: isExpanded ? 'rotate(90deg)' : 'none' }}
              >
                ▶
              </span>
              {v}
            </div>
          )
        }
      },
      { key: 'customerCode', label: 'Cari Kodu', searchable: true },
      { key: 'customerName', label: 'Cari Adı', searchable: true },
      { key: 'subtotal', label: 'Ara Toplam', searchable: true, render: (v, row) => renderTotal(row, 'subtotal') },
      {
        key: 'discountTotal',
        label: 'Kampanya İndirimi',
        searchable: true,
        render: (v, row) => {
          const totals: any[] = Array.isArray(row?.totalsByCurrency) ? row.totalsByCurrency : []
          const hasDiscount = totals.length > 0
            ? totals.some((t) => Number(t.discountTotal ?? 0) > 0)
            : Number(row.discountTotal ?? row.DiscountTotal ?? 0) > 0
          return hasDiscount ? (
            <span className="text-emerald-700 font-semibold">-{renderTotal(row, 'discountTotal')}</span>
          ) : (
            <span className="text-gray-400">₺0,00</span>
          )
        }
      },
      { key: 'vatTotal', label: 'KDV Toplamı', searchable: true, render: (v, row) => renderTotal(row, 'vatTotal') },
      {
        key: 'grandTotal',
        label: 'Genel Toplam',
        searchable: true,
        render: (v, row) => (
          <span className="font-bold text-slate-900">{renderTotal(row, 'grandTotal')}</span>
        )
      },
      { key: 'processedBy', label: 'İşlem Yapan', searchable: true },
      {
        key: 'id',
        label: 'İşlemler',
        render: (v, row) => (
          <div className="flex items-center gap-3">
            {canApproveOverLimit && (
              <button
                type="button"
                disabled={approvingCode !== null}
                onClick={(e) => {
                  e.stopPropagation()
                  void onApproveOverLimit(row)
                }}
                className="text-xs font-semibold text-amber-700 hover:text-amber-800 whitespace-nowrap disabled:opacity-50"
                title="Kredi limiti yetmese de bu sepeti siparişe çevir (yetkili onayı)"
              >
                {approvingCode === String(row?.customerCode ?? v) ? 'Onaylanıyor...' : 'Limit Aşımıyla Onayla'}
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                void onDelete(String(v))
              }}
              className="text-xs font-semibold text-red-600 hover:text-red-700"
            >
              Sil
            </button>
          </div>
        )
      }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expandedId, canApproveOverLimit, approvingCode, cart.lines, query]
  )

  const toggleExpand = (row: any) => {
    if (expandedId === row.id) {
      setExpandedId(null)
    } else {
      setExpandedId(row.id)
    }
  }

  const renderExpandedRow = (row: any) => {
    const childCols = [
      { key: 'stockCode', label: 'Stok Kodu' },
      { key: 'productName', label: 'Stok Adı' },
      { key: 'quantity', label: 'Miktar', render: (v: any) => String(v ?? '') },
      { key: 'unitPrice', label: 'Birim Fiyat', render: (v: any, line: any) => formatMoney(Number(v ?? 0), line.currency) },
      {
        // Sepetteki gibi: "Montaj istiyorum" satırında ürünün montaj bedeli satıra katılır.
        key: 'installationFee',
        label: 'Montaj',
        render: (v: any, line: any) =>
          Number(v ?? 0) > 0 ? formatMoney(Number(v), line.currency) : <span className="text-gray-400">-</span>
      },
      {
        key: 'campaignTitle',
        label: 'Kampanya Bilgisi',
        render: (v: any, line: any) => {
          const title = String(line.campaignTitle || line.CampaignTitle || '').trim()
          const isGift = Boolean(line.isGift || line.IsGift)
          if (isGift) {
            return (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                🎁 Hediye Ürün
              </span>
            )
          }
          if (title) {
            return (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                🏷️ {title}
              </span>
            )
          }
          return <span className="text-gray-400 text-[11px]">-</span>
        }
      },
      {
        key: 'discountAmount',
        label: 'İndirim Tutarı',
        render: (v: any, line: any) => {
          const disc = Number(line.discountAmount ?? line.DiscountAmount ?? 0)
          return disc > 0 ? (
            <span className="text-emerald-700 font-semibold">-{formatMoney(disc, line.currency)}</span>
          ) : (
            <span className="text-gray-400">₺0,00</span>
          )
        }
      },
      { key: 'vatRate', label: 'KDV %', render: (v: any, line: any) => `%${line.vatRate ?? line.VatRate ?? 0}` },
      { key: 'vatAmount', label: 'KDV Tutarı', render: (v: any, line: any) => formatMoney(Number(line.vatAmount ?? line.VatAmount ?? 0), line.currency) },
      { key: 'lineTotal', label: 'Satır Toplamı', render: (v: any, line: any) => formatMoney(Number(line.lineTotal ?? line.LineTotal ?? 0), line.currency) }
    ] as any
    return (
      <div className="bg-slate-50/50 border border-slate-200/60 rounded-xl overflow-hidden p-3 shadow-inner">
        <h4 className="text-xs font-semibold text-slate-700 mb-2">Sepet Kalemleri ({row.lines?.length ?? 0} Kalem)</h4>
        <Table
          onRefresh={() => void loadData()} columns={childCols} data={row.lines || []} showColumnFilters={false} />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Aktif Sepet Raporu</h1>
          <p className="text-xs text-gray-400 mt-0.5">Raporlar / Aktif Sepet Raporu</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Arama..."
              className="h-[34px] w-56 pl-8 pr-3 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition"
            />
          </div>
          <button
            type="button"
            onClick={() => void loadData(query)}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            Yenile
          </button>
        </div>
      </div>

      {error && <div className="mb-3 text-xs font-semibold text-red-600">{error}</div>}
      {loading && <div className="mt-2 text-xs text-gray-500">Yükleniyor...</div>}

      <div className="overflow-x-auto">
        <div className="min-w-[1200px] overflow-visible relative">
          <Table
          onRefresh={() => void loadData()}
            columns={columns}
            data={items}
            showColumnFilters
            rowKey={(r) => String(r.id)}
            isRowExpanded={(r) => expandedId === r.id}
            onToggleRowExpanded={toggleExpand}
            renderExpandedRow={renderExpandedRow}
          />
        </div>
      </div>
    </div>
  )
}
