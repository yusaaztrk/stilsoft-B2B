import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, ShieldCheck, AlertTriangle, Info } from 'lucide-react'
import { MessageBanner, PageHeader, SHOP_API, authHeaders, formatDate, formatPrice, input, label, usePanelMessage, type Reconciliation } from './shared'

export default function MutabakatPage() {
  const { message, notify } = usePanelMessage()
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null)
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(false)

  const loadReconciliation = useCallback(async (gun: number) => {
    setLoading(true)
    try {
      const res = await fetch(`${SHOP_API}/api/admin/reconciliation?gun=${gun}`, { headers: authHeaders(false) })
      if (!res.ok) throw new Error()
      setReconciliation(await res.json())
    } catch {
      notify('err', 'Mutabakat raporu alınamadı. ERP servisi çalışıyor mu?')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadReconciliation(30) }, [loadReconciliation])

  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Mutabakat" desc="POS, sipariş ve faturanın birbirini tutmadığı yerler."  />
      <MessageBanner message={message} />

      {(
        <div>
          <div className="flex flex-wrap gap-2 mb-4">
            <select
              className={`${input} mt-0 max-w-[160px]`}
              value={days}
              onChange={(e) => {
                const next = Number(e.target.value)
                setDays(next)
                void loadReconciliation(next)
              }}
            >
              <option value={7}>Son 7 gün</option>
              <option value={30}>Son 30 gün</option>
              <option value={90}>Son 90 gün</option>
              <option value={365}>Son 1 yıl</option>
            </select>
            <button
              type="button"
              onClick={() => void loadReconciliation(days)}
              className="h-11 px-5 rounded-2xl bg-gray-900 text-white text-sm font-semibold hover:bg-black inline-flex items-center gap-2"
            >
              <RefreshCw size={15} />
              Yenile
            </button>

            {reconciliation && (
              <div className="flex flex-wrap gap-2 ml-auto">
                <div className="px-4 py-2 rounded-2xl border border-red-200 bg-red-50">
                  <div className="text-[10px] font-bold text-red-600 uppercase">Kritik</div>
                  <div className="text-lg font-black text-red-700">{reconciliation.counts.kritik}</div>
                </div>
                <div className="px-4 py-2 rounded-2xl border border-amber-200 bg-amber-50">
                  <div className="text-[10px] font-bold text-amber-600 uppercase">Uyarı</div>
                  <div className="text-lg font-black text-amber-700">{reconciliation.counts.uyari}</div>
                </div>
                <div className="px-4 py-2 rounded-2xl border border-gray-200 bg-white">
                  <div className="text-[10px] font-bold text-gray-500 uppercase">Bilgi</div>
                  <div className="text-lg font-black text-gray-900">{reconciliation.counts.bilgi}</div>
                </div>
              </div>
            )}
          </div>

          {loading && <div className="text-sm text-gray-500">Rapor hazırlanıyor...</div>}

          {!loading && reconciliation && reconciliation.findings.length === 0 && (
            <div className="rounded-2xl border border-green-200 bg-green-50 px-5 py-6 flex items-start gap-3">
              <ShieldCheck size={20} className="text-green-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-extrabold text-green-800">Her şey tutuyor.</div>
                <div className="text-sm text-green-700 mt-0.5">
                  Son {reconciliation.window} günde POS, sipariş ve fatura arasında açık bulunamadı.
                </div>
              </div>
            </div>
          )}

          {!loading && reconciliation && reconciliation.findings.length > 0 && (
            <div className="space-y-2">
              {reconciliation.findings.map((finding, index) => {
                const tone =
                  finding.severity === 'kritik'
                    ? { box: 'border-red-200 bg-red-50', title: 'text-red-800', icon: <AlertTriangle size={18} className="text-red-600 shrink-0 mt-0.5" /> }
                    : finding.severity === 'uyari'
                      ? { box: 'border-amber-200 bg-amber-50', title: 'text-amber-800', icon: <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" /> }
                      : { box: 'border-gray-200 bg-white', title: 'text-gray-800', icon: <Info size={18} className="text-gray-400 shrink-0 mt-0.5" /> }

                return (
                  <div key={`${finding.kind}-${finding.orderNo}-${index}`} className={`rounded-2xl border px-4 py-3 flex items-start gap-3 ${tone.box}`}>
                    {tone.icon}
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm font-bold ${tone.title}`}>{finding.message}</div>
                      <div className="text-[11px] text-gray-600 mt-1 flex flex-wrap gap-x-4 gap-y-1">
                        <span className="font-mono">{finding.orderNo}</span>
                        <span>{finding.customerName || finding.customerCode}</span>
                        <span>{formatDate(finding.orderedAt)}</span>
                        {finding.orderTotal > 0 && <span>Sipariş: {formatPrice(finding.orderTotal, 'TRY')}</span>}
                        {finding.paidAmount != null && <span>Tahsilat: {formatPrice(finding.paidAmount, 'TRY')}</span>}
                        {finding.invoiceNo && <span>Fatura: {finding.invoiceNo}</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="text-[11px] text-gray-500 mt-4">
            Rapor hiçbir kaydı düzeltmez, yalnızca gösterir. Para hareketiyle ilgili bir kaydı
            otomatik düzeltmek, yanlış tespitte parayı ikinci kez oynatmak olurdu.
          </div>
        </div>
      )}

    </div>
  )
}
