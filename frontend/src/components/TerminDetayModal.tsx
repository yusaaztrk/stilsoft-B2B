import { useEffect, useState } from 'react'
import Modal from './Modal'
import { API_BASE_URL } from '../config/api'

/**
 * TERMİN KIRILIMI PENCERESİ — 2026-08-31 kullanıcı isteği.
 *
 * "Termin", teslim alınmamış alış siparişidir; belge BEKLİYOR durumundayken stoğa hiç
 * girmez, yani bakiyede görünmez. Kolondaki sayıya tıklanınca bu pencere o miktarın HANGİ
 * belgelerden geldiğini gösterir — "12 adet yolda" tek başına işe yaramıyordu, hangi
 * siparişte olduğu sorulunca kimse cevaplayamıyordu.
 *
 * `kaynak` iki ekran arasında UÇ SEÇER. Aynı veriyi veren iki ayrı uç var çünkü yetki her
 * ekranın kendi sayfa anahtarına bağlı: Toplu Fiyat Atama'yı görebilen ile Stok Giriş/Çıkış
 * Raporu'nu görebilen aynı kişi olmak zorunda değil. Tek ortak uç açsaydık, sayfayı
 * göremeyen kullanıcı veriyi yine de çekebilirdi.
 */

export type TerminKaynagi = 'bulkPricing' | 'stockInOut'

const UC_YOLU: Record<TerminKaynagi, string> = {
  bulkPricing: '/api/BulkPricing/termin-detay',
  stockInOut: '/api/reports/stock-in-out/termin-detay'
}

type TerminSatiri = {
  purchaseInvoiceId: number
  documentNo: string
  date: string
  supplierCode: string
  supplierName: string
  quantity: number
  warehouseCode: number | null
}

type Props = {
  acik: boolean
  onKapat: () => void
  stockCode: string | null
  stockName?: string | null
  kaynak: TerminKaynagi
}

const sayi = (v: number) => Number(v || 0).toLocaleString('tr-TR')

function tarihBicimi(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('tr-TR')
}

export default function TerminDetayModal({ acik, onKapat, stockCode, stockName, kaynak }: Props) {
  const [yukleniyor, setYukleniyor] = useState(false)
  const [hata, setHata] = useState<string | null>(null)
  const [satirlar, setSatirlar] = useState<TerminSatiri[]>([])

  useEffect(() => {
    if (!acik || !stockCode) return

    const ac = new AbortController()
    setYukleniyor(true)
    setHata(null)
    setSatirlar([])

    void (async () => {
      try {
        const token = localStorage.getItem('accessToken')
        const res = await fetch(
          `${API_BASE_URL}${UC_YOLU[kaynak]}?stockCode=${encodeURIComponent(stockCode)}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: ac.signal }
        )
        if (!res.ok) throw new Error(`Termin kırılımı alınamadı (${res.status})`)
        const json = await res.json()
        setSatirlar((json?.data?.items ?? []) as TerminSatiri[])
      } catch (e: any) {
        if (e?.name === 'AbortError') return
        setHata(String(e?.message ?? 'Termin kırılımı alınamadı'))
      } finally {
        setYukleniyor(false)
      }
    })()

    return () => ac.abort()
  }, [acik, stockCode, kaynak])

  const toplam = satirlar.reduce((a, x) => a + Number(x.quantity || 0), 0)

  return (
    <Modal
      isOpen={acik}
      onClose={onKapat}
      title={`${stockName ?? ''} (${stockCode ?? ''}) — Termindekiler`}
      containerClassName="max-w-3xl"
    >
      <p className="text-[11px] text-gray-500 mb-3">
        Teslim alınmamış alış siparişleri. Bu miktar stoğa girmediği için bakiyede görünmez;
        belge “Teslim Edildi” yapılınca stoğa geçer ve bu listeden düşer.
      </p>

      {yukleniyor && (
        <div className="py-8 text-center text-xs text-gray-500 flex items-center justify-center gap-2">
          <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <span>Yükleniyor...</span>
        </div>
      )}

      {hata && (
        <div className="p-3 bg-rose-50 border border-rose-100 text-xs text-rose-600 rounded-lg">{hata}</div>
      )}

      {!yukleniyor && !hata && satirlar.length === 0 && (
        <div className="py-8 text-center text-xs text-gray-400">Terminde bekleyen sipariş yok.</div>
      )}

      {!yukleniyor && !hata && satirlar.length > 0 && (
        <div className="overflow-x-auto border border-gray-100 rounded-lg">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-gray-50">
              <tr className="text-gray-400 font-bold uppercase text-[9px] tracking-wider">
                <th className="px-3 py-2">Belge No</th>
                <th className="px-3 py-2">Tarih</th>
                <th className="px-3 py-2">Tedarikçi</th>
                <th className="px-3 py-2 text-right">Depo</th>
                <th className="px-3 py-2 text-right">Miktar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {satirlar.map((r, i) => (
                <tr key={`${r.purchaseInvoiceId}-${i}`} className="hover:bg-gray-50/60">
                  <td className="px-3 py-2 font-mono font-semibold text-gray-800">{r.documentNo || '—'}</td>
                  <td className="px-3 py-2 text-gray-600">{tarihBicimi(r.date)}</td>
                  <td className="px-3 py-2 text-gray-700">
                    {r.supplierName || r.supplierCode || '—'}
                    {r.supplierName && r.supplierCode ? (
                      <span className="ml-1 text-[10px] text-gray-400 font-mono">{r.supplierCode}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600">{r.warehouseCode ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-bold text-indigo-700">{sayi(r.quantity)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 border-t border-gray-200">
              <tr>
                <td className="px-3 py-2 font-bold text-gray-700" colSpan={4}>Toplam</td>
                <td className="px-3 py-2 text-right font-bold text-indigo-800">{sayi(toplam)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Modal>
  )
}
