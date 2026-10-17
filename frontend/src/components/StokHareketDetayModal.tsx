import { useEffect, useState } from 'react'
import Modal from './Modal'
import { API_BASE_URL } from '../config/api'

/**
 * STOK GİRİŞ/ÇIKIŞ KIRILIMI — 2026-09-03 kullanıcı isteği ("girişlere çıkışlara bakiyelere
 * basınca da bir modal açılsın, nerede ne kadar var onu da görmüş oluruz").
 *
 * İki bölüm gösterir:
 *  1. DEPO KIRILIMI — "nerede ne kadar var". Toplamı raporun BAKİYE sütununa birebir oturur;
 *     bu yüzden devir (yıl başından öncesi) ayrı sütun olarak duruyor, yoksa "rakamlar
 *     tutmuyor" denir.
 *  2. HAREKET DÖKÜMÜ — hangi belgeyle girdi/çıktı. Yalnız seçili YIL, çünkü tıklanan
 *     TOP GİRİŞ / TOP ÇIKIŞ sütunları yıl bazlı.
 *
 * `tur` hangi sütuna basıldığını taşır: 'in' yalnız girişleri, 'out' yalnız çıkışları,
 * 'balance' ikisini birden listeler.
 */

export type HareketTuru = 'in' | 'out' | 'balance'

type DepoSatiri = {
  warehouseCode: number
  warehouseName: string
  isVehicle: boolean
  openingBalance: number
  yearIn: number
  yearOut: number
  /** Depo transferleri (2026-10-11): depoya girdi/çıktı ama firmaya değil — toplamlara dahil değil. */
  transferIn?: number
  transferOut?: number
  balance: number
}

type HareketSatiri = {
  id: number
  date: string
  direction: 'in' | 'out'
  /** normal | devir (açılış stoğu) | transfer (depo transferi) */
  movementKind?: 'normal' | 'devir' | 'transfer'
  quantity: number
  warehouseCode: number
  warehouseName: string
  invoiceNo: string
  customerCode: string
  customerName: string
}

type Veri = {
  stockCode: string
  stockName: string
  year: number
  kind: HareketTuru
  openingBalance: number
  totalIn: number
  totalOut: number
  transferIn?: number
  transferOut?: number
  balance: number
  warehouses: DepoSatiri[]
  movements: HareketSatiri[]
  movementTotalCount: number
  movementTruncated: boolean
}

type Props = {
  acik: boolean
  onKapat: () => void
  stockCode: string | null
  stockName?: string | null
  yil: number
  tur: HareketTuru
}

const sayi = (v: number) => Number(v || 0).toLocaleString('tr-TR')

function tarihBicimi(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('tr-TR')
}

const BASLIK: Record<HareketTuru, string> = {
  in: 'Girişler',
  out: 'Çıkışlar',
  balance: 'Bakiye Dökümü'
}

export default function StokHareketDetayModal({ acik, onKapat, stockCode, stockName, yil, tur }: Props) {
  const [yukleniyor, setYukleniyor] = useState(false)
  const [hata, setHata] = useState<string | null>(null)
  const [veri, setVeri] = useState<Veri | null>(null)

  useEffect(() => {
    if (!acik || !stockCode) return

    const ac = new AbortController()
    setYukleniyor(true)
    setHata(null)
    setVeri(null)

    void (async () => {
      try {
        const token = localStorage.getItem('accessToken')
        const sp = new URLSearchParams({ stockCode, year: String(yil), kind: tur })
        const res = await fetch(`${API_BASE_URL}/api/reports/stock-in-out/hareket-detay?${sp.toString()}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: ac.signal
        })
        /*
          404 = SUNUCU HENÜZ ESKİ. Bu pencerenin ucu (`hareket-detay`) frontend ile AYNI
          gün eklendi; paketler ayrı atılabildiği için arayüz yeni, DLL eski olabiliyor
          (bkz. bayat binary tuzağı). Çıplak "404" mesajı bunu bilmeyene hata gibi görünüp
          boşuna kayıt açtırıyor.
        */
        if (res.status === 404) {
          throw new Error('Bu pencere için sunucu güncellemesi gerekiyor (B2B.Erp.Api.dll). Diğer sütunlar etkilenmez.')
        }
        if (!res.ok) throw new Error(`Kırılım alınamadı (${res.status})`)
        const json = await res.json()
        setVeri((json?.data ?? null) as Veri | null)
      } catch (e: any) {
        if (e?.name === 'AbortError') return
        setHata(String(e?.message ?? 'Kırılım alınamadı'))
      } finally {
        setYukleniyor(false)
      }
    })()

    return () => ac.abort()
  }, [acik, stockCode, yil, tur])

  const depolar = veri?.warehouses ?? []
  const hareketler = veri?.movements ?? []

  return (
    <Modal
      isOpen={acik}
      onClose={onKapat}
      title={`${stockName ?? ''} (${stockCode ?? ''}) — ${BASLIK[tur]} · ${yil}`}
      containerClassName="max-w-5xl"
    >
      {yukleniyor && (
        <div className="py-10 text-center text-xs text-gray-500 flex items-center justify-center gap-2">
          <div className="w-5 h-5 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
          <span>Yükleniyor...</span>
        </div>
      )}

      {hata && (
        <div className="p-3 bg-rose-50 border border-rose-100 text-xs text-rose-600 rounded-lg">{hata}</div>
      )}

      {!yukleniyor && !hata && veri && (
        <div className="space-y-5">
          {/* Özet şeridi */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
              <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">Devir (önceki yıllar + açılış)</div>
              <div className="text-sm font-black text-slate-700 mt-0.5">{sayi(veri.openingBalance)}</div>
            </div>
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100">
              <div className="text-[9px] font-black uppercase tracking-wider text-emerald-500">{yil} Giriş</div>
              <div className="text-sm font-black text-emerald-700 mt-0.5">{sayi(veri.totalIn)}</div>
            </div>
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-100">
              <div className="text-[9px] font-black uppercase tracking-wider text-rose-500">{yil} Çıkış</div>
              <div className="text-sm font-black text-rose-700 mt-0.5">{sayi(veri.totalOut)}</div>
            </div>
            <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-100">
              <div className="text-[9px] font-black uppercase tracking-wider text-indigo-500">Bakiye</div>
              <div className="text-sm font-black text-indigo-700 mt-0.5">{sayi(veri.balance)}</div>
            </div>
          </div>

          {/* 1. Depo kırılımı */}
          <div>
            <div className="text-[10px] font-black uppercase tracking-wider text-gray-400 mb-1.5">
              Depo Kırılımı — nerede ne kadar var
            </div>
            {depolar.length === 0 ? (
              <div className="py-6 text-center text-xs text-gray-400 border border-gray-100 rounded-lg">
                Bu ürünün hiç stok hareketi yok.
              </div>
            ) : (
              <div className="overflow-x-auto border border-gray-100 rounded-lg">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-gray-50">
                    <tr className="text-gray-400 font-bold uppercase text-[9px] tracking-wider">
                      <th className="px-3 py-2">Depo</th>
                      <th className="px-3 py-2 text-right">Devir</th>
                      <th className="px-3 py-2 text-right">{yil} Giriş</th>
                      <th className="px-3 py-2 text-right">{yil} Çıkış</th>
                      <th className="px-3 py-2 text-right" title="Depolar arası transfer: depoya giren / depodan çıkan. Firmanın toplamını değiştirmez.">Transfer ±</th>
                      <th className="px-3 py-2 text-right">Bakiye</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {depolar.map((d) => (
                      <tr key={d.warehouseCode} className="hover:bg-gray-50/60">
                        <td className="px-3 py-2 text-gray-800">
                          <span className="font-mono font-semibold">{d.warehouseCode}</span>
                          {d.warehouseName ? <span className="ml-1.5">{d.warehouseName}</span> : null}
                          {d.isVehicle ? (
                            <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-[9px] font-bold text-amber-700">
                              ARAÇ
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-500">{sayi(d.openingBalance)}</td>
                        <td className="px-3 py-2 text-right text-emerald-600 font-semibold">{sayi(d.yearIn)}</td>
                        <td className="px-3 py-2 text-right text-rose-600 font-semibold">{sayi(d.yearOut)}</td>
                        <td className="px-3 py-2 text-right text-sky-700 whitespace-nowrap">
                          {(d.transferIn ?? 0) === 0 && (d.transferOut ?? 0) === 0
                            ? <span className="text-gray-300">—</span>
                            : <>+{sayi(d.transferIn ?? 0)} / −{sayi(d.transferOut ?? 0)}</>}
                        </td>
                        <td className={`px-3 py-2 text-right font-black ${d.balance < 0 ? 'text-rose-700' : 'text-indigo-700'}`}>
                          {sayi(d.balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t border-gray-200">
                    <tr>
                      <td className="px-3 py-2 font-bold text-gray-700">Toplam</td>
                      <td className="px-3 py-2 text-right font-bold text-gray-600">{sayi(veri.openingBalance)}</td>
                      <td className="px-3 py-2 text-right font-bold text-emerald-700">{sayi(veri.totalIn)}</td>
                      <td className="px-3 py-2 text-right font-bold text-rose-700">{sayi(veri.totalOut)}</td>
                      <td className="px-3 py-2 text-right text-[10px] text-gray-400">net 0</td>
                      <td className="px-3 py-2 text-right font-black text-indigo-800">{sayi(veri.balance)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* 2. Hareket dökümü */}
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <div className="text-[10px] font-black uppercase tracking-wider text-gray-400">
                {yil} Hareketleri {tur === 'in' ? '(yalnız girişler — transfer ve açılış hariç)' : tur === 'out' ? '(yalnız çıkışlar — transfer hariç)' : '(transfer ve açılış satırları etiketli)'}
              </div>
              <div className="text-[10px] text-gray-400">
                {veri.movementTruncated
                  ? `${sayi(hareketler.length)} / ${sayi(veri.movementTotalCount)} hareket (en yeniler)`
                  : `${sayi(veri.movementTotalCount)} hareket`}
              </div>
            </div>

            {hareketler.length === 0 ? (
              <div className="py-6 text-center text-xs text-gray-400 border border-gray-100 rounded-lg">
                {yil} yılında bu türde hareket yok.
              </div>
            ) : (
              <div className="overflow-x-auto border border-gray-100 rounded-lg max-h-[320px] overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-gray-50 sticky top-0 z-10">
                    <tr className="text-gray-400 font-bold uppercase text-[9px] tracking-wider">
                      <th className="px-3 py-2">Tarih</th>
                      <th className="px-3 py-2">Yön</th>
                      <th className="px-3 py-2">Belge No</th>
                      <th className="px-3 py-2">Cari</th>
                      <th className="px-3 py-2">Depo</th>
                      <th className="px-3 py-2 text-right">Miktar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {hareketler.map((h) => (
                      <tr key={h.id} className="hover:bg-gray-50/60">
                        <td className="px-3 py-2 text-gray-600">{tarihBicimi(h.date)}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${
                              h.direction === 'in'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-rose-50 text-rose-700 border border-rose-200'
                            }`}
                          >
                            {h.direction === 'in' ? 'Giriş' : 'Çıkış'}
                          </span>
                          {h.movementKind === 'transfer' && (
                            <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-sky-50 text-sky-700 border border-sky-200">Transfer</span>
                          )}
                          {h.movementKind === 'devir' && (
                            <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-slate-100 text-slate-600 border border-slate-200">Açılış</span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono font-semibold text-gray-800">{h.invoiceNo || '—'}</td>
                        <td className="px-3 py-2 text-gray-700">
                          {h.customerName || h.customerCode || '—'}
                          {h.customerName && h.customerCode ? (
                            <span className="ml-1 text-[10px] text-gray-400 font-mono">{h.customerCode}</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          <span className="font-mono">{h.warehouseCode}</span>
                          {h.warehouseName ? <span className="ml-1">{h.warehouseName}</span> : null}
                        </td>
                        <td
                          className={`px-3 py-2 text-right font-bold ${
                            h.direction === 'in' ? 'text-emerald-700' : 'text-rose-700'
                          }`}
                        >
                          {h.direction === 'in' ? '+' : '−'}
                          {sayi(h.quantity)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
