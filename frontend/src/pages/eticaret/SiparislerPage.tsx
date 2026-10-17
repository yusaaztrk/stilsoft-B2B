import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Info, RefreshCw, ShieldCheck } from 'lucide-react'
import { AppDataTable, type DataTableRowAction } from '../../components/data-table'
import type { ColumnDef } from '@tanstack/react-table'
import { serviceOpsBaseUrl } from '../../config/api'
import EticaretHavaleOnay from '../EticaretHavaleOnay'
import { MessageBanner, PageHeader, SHOP_API, authHeaders, formatDate, formatPrice, input, label, paymentLabels, usePanelMessage, type ShopOrder } from './shared'
import { OrderDetailModal, useOrderDetail } from './OrderDetailModal'

export default function SiparislerPage() {
  const { message, notify } = usePanelMessage()
  const { orderDetail, setOrderDetail, openOrder } = useOrderDetail(notify)
  const [orders, setOrders] = useState<ShopOrder[]>([])
  const [search, setSearch] = useState('')
  const [days, setDays] = useState(30)
  const [orderPage, setOrderPage] = useState(0)
  const [orderPageSize, setOrderPageSize] = useState(25)
  const [loading, setLoading] = useState(false)

  const loadOrders = useCallback(async (term: string, gun: number) => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ gun: String(gun) })
      if (term.trim()) qs.set('ara', term.trim())
      const res = await fetch(`${SHOP_API}/api/admin/orders?${qs}`, { headers: authHeaders(false) })
      if (!res.ok) throw new Error()
      setOrders(await res.json())
    } catch {
      notify('err', 'Sipariş listesi alınamadı.')
    } finally {
      setLoading(false)
    }
  }, [])

  const cancelOrder = async (orderNo: string) => {
    const reason = window.prompt(
      `${orderNo} numaralı sipariş iptal edilecek.\n\n` +
      '• Montaj kayıtları iptale alınır, teslimat kaydı silinir.\n' +
      '• PARA İADESİ YAPILMAZ — bankadan siz iade edip cari ekstresine işlemelisiniz.\n\n' +
      'İptal gerekçesi (isteğe bağlı):'
    )

    // prompt iptal edilirse null döner; boş metin gerekçesiz iptal demek ve geçerli.
    if (reason === null) return

    try {
      const res = await fetch(`${SHOP_API}/api/admin/orders/${encodeURIComponent(orderNo)}/cancel`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ reason })
      })
      const body = await res.json().catch(() => null)

      if (!res.ok) {
        notify('err', body?.message ?? 'Sipariş iptal edilemedi.')
        return
      }

      await loadOrders(search, days)
      if (orderDetail?.order.orderNo === orderNo) setOrderDetail(null)

      notify(
        'ok',
        body?.cargoRemoved === false
          ? 'Sipariş iptal edildi. Teslimat kaydı silinemedi — ServiceOps ekranından elle kapatın.'
          : 'Sipariş iptal edildi.'
      )
    } catch {
      notify('err', 'Sipariş iptal edilemedi.')
    }
  }

  const orderStats = useMemo(() => {
    let paidTotal = 0
    let awaiting = 0
    let paidNotInvoiced = 0
    let iptalEdilmisOdenen = 0
    let iptalEdilmisTutar = 0

    for (const order of orders) {
      if (order.isPaid) {
        /*
          İPTAL EDİLMİŞ SİPARİŞ "TAHSİL EDİLEN"E GİRMİYOR (2026-09-21).

          Sayaç `isPaid` olan her siparişin tutarını topluyordu — iptal edilenler dahil.
          Parası iade edilmiş bir sipariş kasada duruyormuş gibi görünüyor ve üstteki
          rakam ŞİŞİK çıkıyordu; bayi o rakama bakarak gün sonu yapıyor.

          Aynı sorun "faturası bekleyen" sayacında da vardı: iptal edilmiş siparişin
          faturası beklenmiyor, kesilmemesi gerekiyor.

          Ödeme KAYDINA dokunulmuyor (kullanıcı kararı: şimdilik yalnız görünüm); yalnız
          bu iki sayaç iptalleri dışarıda bırakıyor ve kaç tanesi olduğu ayrıca yazılıyor.
        */
        if (order.isCancelled) {
          iptalEdilmisOdenen += 1
          iptalEdilmisTutar += order.grandTotal
        } else {
          paidTotal += order.grandTotal
          if (!order.invoiceNo) paidNotInvoiced += 1
        }
      } else if (order.paymentStatus === 'Pending') {
        // Yalnızca Pending sayılıyor: Failed ve NeedsReview "beklemiyor", biri başarısız
        // olmuş biri insan bakmayı bekliyor. İkisi Mutabakat sekmesinin işi.
        awaiting += 1
      }
    }

    return { count: orders.length, paidTotal, awaiting, paidNotInvoiced, iptalEdilmisOdenen, iptalEdilmisTutar }
  }, [orders])

  const orderColumns = useMemo<ColumnDef<ShopOrder, any>[]>(() => [
    {
      accessorKey: 'orderNo',
      header: 'Sipariş No',
      meta: { filterType: 'text', width: '150px' },
      cell: ({ getValue }) => (
        <span className="font-mono text-xs font-semibold text-gray-900">{String(getValue() ?? '')}</span>
      )
    },
    {
      id: 'customer',
      accessorFn: (row) => `${row.customerName ?? ''} ${row.customerCode}`.trim(),
      header: 'Müşteri',
      meta: { filterType: 'text' },
      cell: ({ row }) => (
        <div>
          <div className="font-semibold text-gray-900">
            {row.original.customerName || row.original.customerCode}
          </div>
          <div className="text-[11px] text-gray-500 font-mono">{row.original.customerCode}</div>
        </div>
      )
    },
    {
      accessorKey: 'processedAt',
      header: 'Tarih',
      meta: { filterType: 'date', width: '130px' },
      cell: ({ getValue }) => (
        <span className="text-gray-600 whitespace-nowrap">{formatDate(String(getValue() ?? ''))}</span>
      )
    },
    {
      accessorKey: 'grandTotal',
      header: 'Tutar',
      meta: { filterType: 'number', showTotal: true, width: '140px' },
      cell: ({ row }) => (
        <div className="text-right">
          <div className="font-semibold tabular-nums">{formatPrice(row.original.grandTotal, 'TRY')}</div>
          <div className="text-[11px] text-gray-500 font-normal">{row.original.lineCount} kalem</div>
        </div>
      )
    },
    {
      accessorKey: 'paymentStatus',
      header: 'Ödeme',
      meta: { filterType: 'select', width: '130px' },
      cell: ({ row }) => {
        const badge = paymentLabels[row.original.paymentStatus] ?? {
          text: row.original.paymentStatus,
          className: 'bg-gray-100 border-gray-200 text-gray-600'
        }

        /*
          İPTAL EDİLMİŞ SİPARİŞTE "ÖDENDİ" TEK BAŞINA YANILTICI (2026-09-21).

          İptal akışı ödeme kaydına BİLEREK dokunmuyor: para gerçekten alınmıştı ve iadeyi
          bayi elle yapıyor (iptal uyarısında da yazıyor). Ama sütunda yalnız "Ödendi"
          görünürse, iptal edilip parası iade edilmiş bir sipariş hâlâ tahsil edilmiş gibi
          duruyor — kullanıcı bunu canlıda bildirdi.

          Rozet artık ikisini birden söylüyor: para alınmıştı VE sipariş iptal edildi.
          Para kaydına dokunulmuyor (2026-09-21 kullanıcı kararı: "şu an için sadece
          görünüm düzelsin"), yalnız okunan bilgi dürüst hâle geliyor.
        */
        if (row.original.isCancelled && row.original.isPaid) {
          return (
            <span
              className="px-3 py-1.5 rounded-full text-xs font-bold border inline-block bg-orange-50 border-orange-200 text-orange-800"
              title="Ödeme alınmıştı, sipariş sonradan iptal edildi. İade ve banka kaydı elle yönetilir."
            >
              Ödendi · iptal
            </span>
          )
        }

        return (
          <span className={`px-3 py-1.5 rounded-full text-xs font-bold border inline-block ${badge.className}`}>
            {badge.text}
          </span>
        )
      }
    },
    {
      id: 'invoice',
      accessorFn: (row) => row.invoiceNo ?? (row.isPaid ? 'Kesilmedi' : '-'),
      header: 'Fatura',
      meta: { filterType: 'text', width: '150px' },
      cell: ({ row }) =>
        row.original.invoiceNo ? (
          <div>
            <div className="font-mono text-xs font-semibold text-gray-900">{row.original.invoiceNo}</div>
            <div className="text-[11px] text-gray-500">{formatDate(row.original.invoiceDate)}</div>
          </div>
        ) : (
          <span className="text-gray-400">{row.original.isPaid ? 'Kesilmedi' : '-'}</span>
        )
    },
    {
      id: 'sevkiyat',
      accessorFn: (row) =>
        row.isCancelled
          ? 'İptal'
          : row.montageCount > 0
            ? (row.hasCargo ? 'Kargo + Montaj' : 'Montaj')
            : 'Kargo',
      header: 'Sevkiyat',
      meta: { filterType: 'select', width: '150px' },
      cell: ({ row }) => {
        // İPTAL her şeyin önünde: iptal edilmiş siparişin sevkiyatı yok, kargo/montaj
        // rozetlerini göstermek bayiyi hâlâ bir iş varmış gibi düşündürürdü.
        if (row.original.isCancelled) {
          return (
            <span className="px-3 py-1.5 rounded-full text-xs font-bold border bg-red-50 border-red-200 text-red-700">
              İptal edildi
            </span>
          )
        }

        return (
          <div className="flex flex-wrap gap-1">
            {row.original.hasCargo && (
              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold border bg-sky-50 border-sky-200 text-sky-700">
                Kargo
              </span>
            )}
            {row.original.montageCount > 0 && (
              <span
                className="px-2.5 py-1 rounded-full text-[11px] font-bold border bg-violet-50 border-violet-200 text-violet-700"
                title="Montajı seçilen kalemler kargoya girmez, montaj ekibi götürür."
              >
                Montaj {row.original.montageCount}
              </span>
            )}
          </div>
        )
      }
    }
  ], [])

  useEffect(() => { void loadOrders('', 30) }, [loadOrders])

  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Siparişler" desc="İnternetten gelen siparişler; ödeme, fatura, kargo ve montaj durumuyla birlikte."  />
      <MessageBanner message={message} />

      {(
        <div>
          {/* Havale/EFT bekleyenler en üstte: bayi parayı görünce burada onaylar (2026-09-20). */}
          <EticaretHavaleOnay />
          <div className="flex flex-wrap gap-2 mb-4">
            <input
              className={`${input} mt-0 max-w-xs`}
              placeholder="Sipariş no veya cari kodu"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void loadOrders(search, days)}
            />
            <select
              className={`${input} mt-0 max-w-[160px]`}
              value={days}
              onChange={(e) => {
                const next = Number(e.target.value)
                setDays(next)
                void loadOrders(search, next)
              }}
            >
              <option value={7}>Son 7 gün</option>
              <option value={30}>Son 30 gün</option>
              <option value={90}>Son 90 gün</option>
              <option value={365}>Son 1 yıl</option>
            </select>
            <button
              type="button"
              onClick={() => void loadOrders(search, days)}
              className="h-11 px-5 rounded-2xl bg-gray-900 text-white text-sm font-semibold hover:bg-black inline-flex items-center gap-2"
            >
              <RefreshCw size={15} />
              Yenile
            </button>
          </div>

          {/*
            Dönem özeti. Ayrı bir uçtan değil, ekranda zaten duran listeden hesaplanıyor:
            aynı sayıyı iki kaynaktan üretmek, ikisinin farklı çıktığı günü hazırlamak olur.

            Başlık listede ne varsa onu söylüyor — arama kutusu doluyken sayılar süzülmüş
            listeye ait ve "son 30 gün" demek yanlış olurdu.
          */}
          {!loading && orders.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
                <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                  {search.trim() ? 'Aramada bulunan' : `Son ${days} gün`}
                </div>
                <div className="text-xl font-black text-gray-900 mt-0.5 tabular-nums">
                  {orderStats.count} <span className="text-sm font-bold text-gray-400">sipariş</span>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
                <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Tahsil edilen</div>
                <div className="text-xl font-black text-gray-900 mt-0.5 tabular-nums">
                  {formatPrice(orderStats.paidTotal, 'TRY')}
                </div>
                {orderStats.iptalEdilmisOdenen > 0 && (
                  <div
                    className="text-[11px] font-semibold text-orange-700 mt-0.5"
                    title="Parası alınıp sonradan iptal edilen siparişler. İade ve banka kaydı elle yönetilir."
                  >
                    {orderStats.iptalEdilmisOdenen} iptal hariç ({formatPrice(orderStats.iptalEdilmisTutar, 'TRY')})
                  </div>
                )}
              </div>

              {/* Ödeme bekleyen: müşteri siparişi açtı, kart işlemi tamamlanmadı. Yüksekse
                  ödeme adımında bir sorun var demektir. */}
              <div
                className={`rounded-2xl border px-4 py-3 ${
                  orderStats.awaiting > 0 ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'
                }`}
              >
                <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Ödeme bekleyen</div>
                <div
                  className={`text-xl font-black mt-0.5 tabular-nums ${
                    orderStats.awaiting > 0 ? 'text-amber-700' : 'text-gray-900'
                  }`}
                >
                  {orderStats.awaiting} <span className="text-sm font-bold opacity-60">sipariş</span>
                </div>
              </div>

              {/* Bayinin asıl iş listesi: parası alınmış ama faturası kesilmemiş siparişler.
                  Fatura kesilene kadar teslimat kaydı da açılmıyor (§10.c), yani bu sayı
                  doğrudan "bekleyen sevkiyat" demek. */}
              <div
                className={`rounded-2xl border px-4 py-3 ${
                  orderStats.paidNotInvoiced > 0 ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-white'
                }`}
              >
                <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Faturası bekleyen</div>
                <div
                  className={`text-xl font-black mt-0.5 tabular-nums ${
                    orderStats.paidNotInvoiced > 0 ? 'text-blue-700' : 'text-gray-900'
                  }`}
                >
                  {orderStats.paidNotInvoiced} <span className="text-sm font-bold opacity-60">sipariş</span>
                </div>
              </div>
            </div>
          )}

          <AppDataTable<ShopOrder>
            data={orders}
            columns={orderColumns}
            rowId={(row) => row.orderNo}
            onRowClick={(row) => void openOrder(row.orderNo)}
            onRefresh={() => void loadOrders(search, days)}
            rowActions={(row) => {
              const actions: DataTableRowAction<ShopOrder>[] = [
                {
                  key: 'detay',
                  label: 'Sipariş dökümü',
                  onClick: () => void openOrder(row.orderNo)
                }
              ]

              if (row.hasCargo && !row.isCancelled) {
                actions.push({
                  key: 'kargo',
                  label: 'Kargo takibini aç',
                  // Teslimat kaydı ServiceOps'ta; ERP'de aynı ekranın kopyası yok ve
                  // olmamalı — kayıt tek yerde tutulmalı.
                  onClick: () => window.open(`${serviceOpsBaseUrl()}/kargo-takibi`, '_blank')
                })
              }

              if (row.montageCount > 0 && !row.isCancelled) {
                actions.push({
                  key: 'montaj',
                  label: 'Montaj Yönetimi\'ni aç',
                  onClick: () => window.open(`${serviceOpsBaseUrl()}/montaj-yonetimi`, '_blank')
                })
              }

              if (!row.isCancelled) {
                actions.push({
                  key: 'iptal',
                  label: 'Siparişi iptal et',
                  danger: true,
                  // Faturalanmış siparişte ERP zaten reddediyor; düğmeyi burada da kapatmak
                  // kullanıcıyı reddedilecek bir işlemi denemekten kurtarıyor.
                  disabled: Boolean(row.invoiceNo),
                  disabledReason: 'Faturası kesilmiş sipariş iptal edilemez. Önce faturayı silin.',
                  onClick: () => void cancelOrder(row.orderNo)
                })
              }

              return actions
            }}
            states={{
              loading,
              emptyTitle: 'Bu aralıkta sipariş yok.',
              emptyDescription: 'Tarih aralığını genişletmeyi ya da arama kutusunu boşaltmayı deneyin.'
            }}
            showExcelExport
            excelFileName="eticaret-siparisler"
            showFooterTotals
            pagination={{
              pageIndex: orderPage,
              pageSize: orderPageSize,
              totalCount: orders.length,
              pageCount: Math.max(1, Math.ceil(orders.length / orderPageSize)),
              onPageChange: setOrderPage,
              onPageSizeChange: setOrderPageSize
            }}
          />

          <div className="text-[11px] text-gray-500 mt-3">
            Satıra tıklayınca siparişin tam dökümü ve mağaza tarafındaki işlem kaydı açılır.
            Fatura kesildiği anda teslimat kaydı ServiceOps'ta kendiliğinden oluşur.
          </div>
        </div>
      )}
      <OrderDetailModal orderDetail={orderDetail} setOrderDetail={setOrderDetail} />
    </div>
  )
}
