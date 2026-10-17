import React, { useCallback, useState } from 'react'
import { serviceOpsBaseUrl } from '../../config/api'
import { Modal, SHOP_API, authHeaders, btnGhost, formatDate, formatPrice, label, paymentLabels, type OrderDetail, type OrderEvent } from './shared'

/* Sipariş detayı penceresi — Siparişler ve Üyeler (üye hareketlerinden sipariş açma) ortak kullanır. */
export function useOrderDetail(notify: (kind: 'ok' | 'err', text: string) => void) {
  const [orderDetail, setOrderDetail] = useState<{ order: OrderDetail; events: OrderEvent[] } | null>(null)
  const openOrder = useCallback(async (orderNo: string) => {
    try {
      const res = await fetch(`${SHOP_API}/api/admin/orders/${encodeURIComponent(orderNo)}/detail`, {
        headers: authHeaders(false)
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setOrderDetail({ order: data.data.order, events: data.data.events ?? [] })
    } catch {
      notify('err', 'Sipariş detayı alınamadı.')
    }
  }, [notify])
  return { orderDetail, setOrderDetail, openOrder }
}

export function OrderDetailModal({
  orderDetail,
  setOrderDetail
}: {
  orderDetail: { order: OrderDetail; events: OrderEvent[] } | null
  setOrderDetail: (v: { order: OrderDetail; events: OrderEvent[] } | null) => void
}) {
  return (
    <>
      {orderDetail && (
        <Modal
          title={`Sipariş ${orderDetail.order.orderNo}`}
          wide
          onClose={() => setOrderDetail(null)}
          footer={<button type="button" onClick={() => setOrderDetail(null)} className={btnGhost}>Kapat</button>}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
            <div className="rounded-xl border border-gray-200 p-4">
              <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">Müşteri</div>
              <div className="font-semibold text-gray-900">{orderDetail.order.customerName || orderDetail.order.customerCode}</div>
              <div className="text-xs text-gray-500 font-mono">{orderDetail.order.customerCode}</div>
              {orderDetail.order.customerPhone && (
                <div className="text-xs text-gray-500 mt-1">{orderDetail.order.customerPhone}</div>
              )}
            </div>
            <div className="rounded-xl border border-gray-200 p-4">
              <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">Durum</div>
              <div className="text-sm text-gray-700">
                Tarih: <b>{formatDate(orderDetail.order.processedAt)}</b>
              </div>
              <div className="text-sm text-gray-700">
                Tutar: <b>{formatPrice(orderDetail.order.grandTotal, 'TRY')}</b>
                <span className="text-gray-500"> (KDV {formatPrice(orderDetail.order.vatTotal, 'TRY')})</span>
              </div>
              <div className="text-sm text-gray-700">
                Ödeme: <b>{(paymentLabels[orderDetail.order.paymentStatus] ?? { text: orderDetail.order.paymentStatus }).text}</b>
                {orderDetail.order.paymentAttempts > 1 && (
                  <span className="text-gray-500"> · {orderDetail.order.paymentAttempts} deneme</span>
                )}
              </div>
              <div className="text-sm text-gray-700">
                Fatura:{' '}
                <b>
                  {orderDetail.order.invoices.length > 0
                    ? orderDetail.order.invoices.map((i) => i.invoiceNo).join(', ')
                    : 'kesilmedi'}
                </b>
              </div>
              {orderDetail.order.customerAddress && (
                <div className="text-xs text-gray-500 mt-2">{orderDetail.order.customerAddress}</div>
              )}
            </div>
          </div>

          {/*
            TESLİMAT (KARGO) DURUMU.
            Kayıt artık ÖDEME anında açılıyor ("Siparişiniz Alındı"); fatura kesilince fatura
            numarasıyla güncelleniyor. Beş aşama ServiceOps'ta yürüyor, panel yalnızca okuyor —
            durumu iki yerden yönetmek, hangisinin doğru olduğunu belirsizleştirirdi.
          */}
          {orderDetail.order.cargoExpected === false ? (
            <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 mb-5 text-[12px] text-violet-900">
              Siparişin tamamı <b>montajlı</b>. Kargo kaydı açılmaz — ürünü montaj ekibi
              götürür ve iş <b>Montaj Yönetimi</b> ekranında görünür.
            </div>
          ) : orderDetail.order.cargo ? (
            <div className="rounded-xl border border-gray-200 p-4 mb-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                  Teslimat durumu
                </div>
                <button
                  type="button"
                  onClick={() => window.open(`${serviceOpsBaseUrl()}/kargo-takibi`, '_blank')}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-800"
                >
                  Kargo takibini aç →
                </button>
              </div>

              {orderDetail.order.cargo.exists ? (
                <>
                  {/* Beş aşama şeridi: hangi adımda olduğu tek bakışta okunmalı. */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {['Siparişiniz Alındı', 'Planlandı', 'Hazırlanıyor', 'Dağıtımda', 'Teslim Edildi'].map(
                      (label, index) => {
                        const done = index <= (orderDetail.order.cargo?.status ?? -1)
                        return (
                          <span
                            key={label}
                            className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                              done
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                : 'bg-gray-50 border-gray-200 text-gray-400'
                            }`}
                          >
                            {label}
                          </span>
                        )
                      }
                    )}
                  </div>

                  <div className="text-[11px] text-gray-500 mt-2">
                    {orderDetail.order.cargo.plannedDate && (
                      <>Planlanan: <b>{formatDate(orderDetail.order.cargo.plannedDate)}</b> · </>
                    )}
                    Son güncelleme: {formatDate(orderDetail.order.cargo.updatedAt)}
                  </div>
                </>
              ) : (
                <div className="text-sm text-gray-500">
                  Teslimat kaydı henüz açılmadı. Kayıt <b>ödeme onaylandığında</b> açılıyor;
                  ödeme tamamlanmadıysa ya da ServiceOps'a ulaşılamadıysa burası boş kalır.
                </div>
              )}

              {(orderDetail.order.montageCount ?? 0) > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100 text-[11px] text-violet-800">
                  Siparişin <b>{orderDetail.order.montageCount}</b> kalemi montajlı; o kalemler
                  kargoya girmez, montaj ekibi götürür.
                </div>
              )}
            </div>
          ) : null}

          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">
            Sipariş kalemleri
          </div>

          <div className="rounded-xl border border-gray-200 overflow-hidden mb-5">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-2.5 text-[11px] font-bold text-gray-500 uppercase">Ürün</th>
                  <th className="px-4 py-2.5 text-[11px] font-bold text-gray-500 uppercase text-right">Adet</th>
                  <th className="px-4 py-2.5 text-[11px] font-bold text-gray-500 uppercase text-right">Birim</th>
                  <th className="px-4 py-2.5 text-[11px] font-bold text-gray-500 uppercase text-right">KDV</th>
                  <th className="px-4 py-2.5 text-[11px] font-bold text-gray-500 uppercase text-right">Satır</th>
                </tr>
              </thead>
              <tbody>
                {orderDetail.order.lines.map((line) => (
                  <tr key={line.lineNo} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-gray-900">{line.productName || line.stockCode}</div>
                      <div className="text-[11px] text-gray-500 font-mono">{line.stockCode}</div>
                      {line.montage && (
                        <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-[10px] font-bold text-violet-700">
                          Montaj istendi
                          {line.installationStatus && <span className="font-normal">· {line.installationStatus}</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{line.quantity}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatPrice(line.unitPrice, 'TRY')}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">%{line.vatRate}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{formatPrice(line.lineTotal, 'TRY')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-[11px] text-gray-500 mb-4">
            Satır fiyatları <b>siparişten</b> okunuyor, bugünkü katalogdan değil — geçmiş bir
            siparişte güncel fiyatı göstermek, müşterinin ödemediği bir tutarı göstermek olurdu.
          </div>

          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">
            Mağaza işlem kaydı
          </div>

          {orderDetail.events.length === 0 ? (
            <div className="text-sm text-gray-500">
              Bu sipariş için mağaza tarafında kayıt yok. Olay kaydı sonradan eklendiği için eski
              siparişlerde boş görünür.
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-left border-collapse text-sm">
                <tbody>
                  {orderDetail.events.map((event, index) => (
                    <tr key={index} className="border-b border-gray-100 last:border-0">
                      <td className="px-4 py-2.5 whitespace-nowrap text-gray-500 text-xs">{formatDate(event.createdAt)}</td>
                      <td className="px-4 py-2.5 font-mono text-xs font-semibold text-gray-900">{event.event}</td>
                      <td className="px-4 py-2.5 text-gray-600">{event.detail || '-'}</td>
                      <td className="px-4 py-2.5 text-gray-400 text-xs font-mono">{event.clientIp || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
    </>
  )
}
