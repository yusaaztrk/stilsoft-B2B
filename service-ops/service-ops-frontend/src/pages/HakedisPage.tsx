import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, RefreshCw, Search, WalletCards } from 'lucide-react'
import { toast } from 'sonner'
import {
  CURRENCY_SYMBOLS,
  EARNING_CURRENCIES,
  fetchEarnings,
  formatMoney,
  syncEarnings,
  updateEarningStatus,
  type EarningSourceType,
  type EarningStatus,
  type TechnicianEarning,
} from '../api/earnings'

/**
 * KUR KURALI (bu sayfanın en çok hata üreten yeri).
 *
 * Hak ediş tutarı KENDİ para biriminde saklanır ve asla çevrilip ezilmez. Sayfa eskiden her
 * tutarı TL sayıp tek bir USD kuruna bölüyordu: 90 GBP'lik hak ediş listede "₺90,00 / $2,34"
 * görünüyordu — ne tutar doğruydu ne para birimi. Artık:
 *   - "Tutar" sütunu kaydın kendi para biriminde ve tek doğru kaynak,
 *   - "TL karşılığı" sunucuda saklanan `localAmount`tan gelir (onay anındaki kurla hesaplanmış),
 *     yoksa aşağıdaki kur tablosundan TAHMİNİ olarak hesaplanır ve öyle işaretlenir,
 *   - toplamlar para birimi başına ayrı; TL genel toplamı yalnızca kuru bilinen satırları kapsar.
 */

/** 1 birim dövizin kaç TL olduğu. TRY her zaman 1'dir ve değiştirilemez. */
type RateMap = Record<string, number>

const DEFAULT_RATES: RateMap = { TRY: 1, USD: 38.5, EUR: 41.5, GBP: 48.5 }
const RATE_STORAGE_KEY = 'hakedis.kurlari'

function loadRates(): RateMap {
  try {
    const raw = localStorage.getItem(RATE_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_RATES }
    const parsed = JSON.parse(raw) as RateMap
    return { ...DEFAULT_RATES, ...parsed, TRY: 1 }
  } catch {
    return { ...DEFAULT_RATES }
  }
}

const statusLabels: Record<EarningStatus, string> = {
  Pending: 'Bekleyen',
  Approved: 'Onaylandı',
  PostedToLedger: 'Cari Ekstreye İşlendi',
  Cancelled: 'İptal',
}

const sourceLabels: Record<EarningSourceType, string> = {
  ServiceRecord: 'Ürün Arıza',
  InstallationTask: 'Montaj',
  CargoTrackingTask: 'Kargo/Teslimat',
}

export default function HakedisPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<TechnicianEarning[]>([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [status, setStatus] = useState<EarningStatus | ''>('')
  const [sourceType, setSourceType] = useState<EarningSourceType | ''>('')
  const [q, setQ] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetchEarnings({ status, sourceType })
      setItems(res.data ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [status, sourceType])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return items
    return items.filter((item) =>
      [
        item.technicianName,
        item.technicianCariCode,
        item.sourceNumber,
        item.customerName,
        item.productName,
      ].some((value) => String(value ?? '').toLowerCase().includes(needle))
    )
  }, [items, q])

  const [rates, setRates] = useState<RateMap>(loadRates)

  const setRate = (currency: string, value: number) => {
    const next = { ...rates, [currency]: value > 0 ? value : 0, TRY: 1 }
    setRates(next)
    try { localStorage.setItem(RATE_STORAGE_KEY, JSON.stringify(next)) } catch { /* yoksay */ }
  }

  /**
   * Bir hak edişin TL karşılığı.
   * Öncelik sunucuda saklanan değerde: o, onay anındaki kurla hesaplanmıştır ve sonradan kur
   * kutusu oynatılınca geçmiş tutarların değişmemesi gerekir. Yoksa güncel kurla TAHMİN edilir.
   */
  const toTry = (item: TechnicianEarning): { value: number | null; estimated: boolean } => {
    const amount = Number(item.amount || 0)
    if (!amount) return { value: 0, estimated: false }
    if (item.currency === 'TRY') return { value: amount, estimated: false }
    if (item.localAmount != null) return { value: Number(item.localAmount), estimated: false }
    const rate = rates[item.currency]
    if (!rate || rate <= 0) return { value: null, estimated: false }
    return { value: amount * rate, estimated: true }
  }

  /** Toplamlar PARA BİRİMİ BAŞINA. Farklı dövizleri tek sayıda toplamak anlamsız. */
  const totalsByCurrency = useMemo(() => {
    const map = new Map<string, { amount: number; tryValue: number; missingRate: number }>()
    for (const item of filtered) {
      const cur = item.currency || 'TRY'
      const bucket = map.get(cur) ?? { amount: 0, tryValue: 0, missingRate: 0 }
      bucket.amount += Number(item.amount || 0)
      const converted = toTry(item)
      if (converted.value == null) bucket.missingRate += 1
      else bucket.tryValue += converted.value
      map.set(cur, bucket)
    }
    return Array.from(map.entries())
      .map(([currency, v]) => ({ currency, ...v }))
      .sort((a, b) => a.currency.localeCompare(b.currency))
  }, [filtered, rates])

  const grandTotalTry = totalsByCurrency.reduce((sum, t) => sum + t.tryValue, 0)
  const missingRateCount = totalsByCurrency.reduce((sum, t) => sum + t.missingRate, 0)

  const handleSync = async () => {
    setSyncing(true)
    try {
      await syncEarnings()
      await load()
    } finally {
      setSyncing(false)
    }
  }

  const [defineModalOpen, setDefineModalOpen] = useState(false)
  const [targetEarning, setTargetEarning] = useState<TechnicianEarning | null>(null)
  const [inputAmount, setInputAmount] = useState<string>('90')
  const [inputCurrency, setInputCurrency] = useState<string>('USD')
  const [defineSaving, setDefineSaving] = useState(false)

  const setItemStatus = async (
    id: string,
    nextStatus: EarningStatus,
    amount?: number,
    currency?: string,
    exchangeRate?: number
  ) => {
    await updateEarningStatus(id, nextStatus, amount, currency, { exchangeRate })
    await load()
  }

  const handleOpenDefineModal = (item: TechnicianEarning) => {
    setTargetEarning(item)
    setInputAmount(item.amount > 0 ? String(item.amount) : '90')
    setInputCurrency(item.currency || 'USD')
    setDefineModalOpen(true)
  }

  const handleSaveDefinedHakedis = async () => {
    if (!targetEarning) return
    const parsedAmt = parseFloat(inputAmount)
    if (isNaN(parsedAmt) || parsedAmt <= 0) {
      toast.error('Lütfen geçerli bir hak ediş tutarı giriniz.')
      return
    }

    setDefineSaving(true)
    try {
      // Kur BİLGİ olarak gidiyor: sunucu TL karşılığını ayrı alanda saklar, girilen tutar ve
      // para birimi olduğu gibi korunur.
      //
      // Kur eskiden YALNIZCA USD için gönderiliyordu; sterlin veya euro ile onaylanan hak edişin
      // TL karşılığı hiç oluşmuyor, raporlarda o satır sessizce yok sayılıyordu. Artık seçilen
      // para biriminin kuru neyse o gider (TRY için 1).
      const rateForCurrency = inputCurrency === 'TRY' ? 1 : rates[inputCurrency]

      await setItemStatus(
        targetEarning.id,
        'Approved',
        parsedAmt,
        inputCurrency,
        rateForCurrency > 0 ? rateForCurrency : undefined
      )
      setDefineModalOpen(false)
      setTargetEarning(null)
    } finally {
      setDefineSaving(false)
    }
  }

  const [activeTab, setActiveTab] = useState<'hakedis' | 'ekstre'>('hakedis')

  // Buradaki tek "TL çevrimi" kaynağı `toTry`. Sayfada ayrıca tutulan tek USD kuru, gösterim
  // para birimi seçici ve ekranda türetilen ekstre toplamları kaldırıldı: hepsi her tutarı TL
  // varsayıp tek kura bölüyordu (90 GBP → "₺90 / $2,34"). Gerçek ekstre /personel-ekstre'de.

  return (
    <div className="p-4 lg:p-6 space-y-4 font-outfit">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Hakediş & Teknisyen Cari Ekstresi</h1>
          <p className="text-sm text-gray-500">Tamamlanan servis, montaj ve teslimat işlerinin hakedişleri ve teknisyen cari hareketleri</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#B91C1C] px-4 text-sm font-semibold text-white hover:bg-red-800 transition-all disabled:opacity-60 shadow-sm"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            Senkronize Et
          </button>
        </div>
      </div>

      {/* Tabs & Currency Selector */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('hakedis')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'hakedis'
                ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Hakediş Listesi
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ekstre')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'ekstre'
                ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Teknisyen Cari Ekstresi
          </button>
        </div>

        {/* Kur tablosu: her döviz için ayrı. Tek bir USD kuru bütün tutarları bozuyordu. */}
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Kurlar (1 birim = ? TL)</span>
          {EARNING_CURRENCIES.filter((c) => c !== 'TRY').map((c) => (
            <div key={c} className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs">
              <span className="font-semibold text-slate-500">{CURRENCY_SYMBOLS[c]} {c}</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={rates[c] ?? ''}
                onChange={(e) => setRate(c, parseFloat(e.target.value))}
                className="w-16 font-bold text-slate-900 outline-none text-right"
              />
              <span className="font-bold text-slate-700">TL</span>
            </div>
          ))}
        </div>
      </div>

      {activeTab === 'hakedis' ? (
        <>
          <div className="grid gap-3 md:grid-cols-[1fr_180px_220px_180px]">
            <label className="relative block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Teknisyen, cari, fiş no, müşteri ara"
                className="h-10 w-full rounded-md border border-gray-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-[#B91C1C]"
              />
            </label>
            <select value={status} onChange={(event) => setStatus(event.target.value as EarningStatus | '')} className="h-10 rounded-md border border-gray-200 bg-white px-3 text-sm">
              <option value="">Tüm Durumlar</option>
              {Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <select value={sourceType} onChange={(event) => setSourceType(event.target.value as EarningSourceType | '')} className="h-10 rounded-md border border-gray-200 bg-white px-3 text-sm">
              <option value="">Tüm İş Tipleri</option>
              {Object.entries(sourceLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            {/* Toplam para birimi başına; altında yalnızca kuru bilinenlerin TL karşılığı. */}
            <div className="flex flex-col justify-center gap-0.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm">
              <div className="flex items-center gap-1.5 text-[11px] text-gray-500 font-semibold">
                <WalletCards className="h-3.5 w-3.5 text-[#B91C1C]" /> Toplam
              </div>
              {totalsByCurrency.length === 0 ? (
                <span className="text-xs text-gray-400">—</span>
              ) : (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {totalsByCurrency.map((t) => (
                    <span key={t.currency} className="font-bold text-gray-900 text-xs whitespace-nowrap">
                      {formatMoney(t.amount, t.currency)}
                    </span>
                  ))}
                </div>
              )}
              <div className="text-[10px] text-gray-500">
                ≈ {formatMoney(grandTotalTry, 'TRY')} TL karşılığı
                {missingRateCount > 0 && (
                  <span className="text-amber-600 font-semibold"> · {missingRateCount} satırın kuru yok</span>
                )}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm mobile-stack">
                <thead className="bg-gray-50 text-left text-xs uppercase font-bold text-gray-600">
                  <tr>
                    <th className="px-4 py-3">Teknisyen</th>
                    <th className="px-4 py-3">İş / Fiş</th>
                    <th className="px-4 py-3">Müşteri / Ürün</th>
                    <th className="px-4 py-3">Tamamlanma</th>
                    <th className="px-4 py-3">Tutar</th>
                    <th className="px-4 py-3">TL Karşılığı</th>
                    <th className="px-4 py-3">Durum</th>
                    <th className="px-4 py-3 text-right">İşlem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">Yükleniyor...</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">Hakediş kaydı bulunamadı.</td></tr>
                  ) : filtered.map((item) => {
                    const converted = toTry(item)
                    return (
                      <tr key={item.id} className="align-top hover:bg-slate-50/50">
                        <td className="px-4 py-3" data-label="Teknisyen">
                          <div className="font-bold text-gray-900">{item.technicianName || '-'}</div>
                          <div className="text-xs text-gray-500 font-mono">{item.technicianCariCode || 'Cari kod yok'}</div>
                        </td>
                        <td className="px-4 py-3" data-label="İş / Fiş">
                          <div className="font-semibold text-gray-900">{sourceLabels[item.sourceType] ?? item.sourceType}</div>
                          <div className="text-xs text-gray-500 font-mono">{item.sourceNumber || '-'}</div>
                        </td>
                        <td className="px-4 py-3" data-label="Müşteri / Ürün">
                          <div className="font-medium text-gray-800">{item.customerName || '-'}</div>
                          <div className="text-xs text-gray-500">{item.productName || '-'}</div>
                        </td>
                        <td className="px-4 py-3 text-gray-700" data-label="Tamamlanma">{new Date(item.completedAt).toLocaleString('tr-TR')}</td>
                        {/* Kaydın KENDİ para birimi — tek doğru kaynak. */}
                        <td className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap" data-label="Tutar">
                          {formatMoney(Number(item.amount || 0), item.currency)}
                        </td>
                        {/* TL karşılığı: sunucudaki kurdan kesin, yoksa güncel kurdan tahmini. */}
                        <td className="px-4 py-3 whitespace-nowrap" data-label="TL Karşılığı">
                          {converted.value == null ? (
                            <span className="text-xs font-semibold text-amber-600">kur girilmemiş</span>
                          ) : (
                            <span className={`font-extrabold ${converted.estimated ? 'text-slate-500' : 'text-emerald-700'}`}>
                              {converted.estimated && '≈ '}
                              {formatMoney(converted.value, 'TRY')}
                            </span>
                          )}
                          {item.exchangeRate != null && item.currency !== 'TRY' && (
                            <div className="text-[10px] text-gray-400">kur {Number(item.exchangeRate).toLocaleString('tr-TR')}</div>
                          )}
                        </td>
                        <td className="px-4 py-3" data-label="Durum">
                          <span className="inline-flex rounded-md bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700">{statusLabels[item.status] ?? item.status}</span>
                          {item.postedLedgerReference && <div className="mt-1 text-xs text-gray-500">{item.postedLedgerReference}</div>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                             {item.status === 'Pending' && (
                               <button type="button" onClick={() => handleOpenDefineModal(item)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition shadow-sm">
                                 <CheckCircle2 className="h-3.5 w-3.5" />
                                 Hak Ediş Tanımla
                               </button>
                             )}
                            {item.status === 'Approved' && (
                              <button type="button" onClick={() => setItemStatus(item.id, 'PostedToLedger')} className="h-8 rounded-lg border border-blue-300 bg-blue-50 px-2.5 text-xs font-bold text-blue-800 hover:bg-blue-100 transition">
                                Ekstreye İşle
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        /*
          Ekstre AYRI BİR SAYFADA (/personel-ekstre).

          Buradaki eski sekme hak ediş listesinden ekranda türetiliyordu ve iki yanlışı vardı:
          (1) her tutarı TL varsayıp elle girilen bir kura bölerek "USD karşılığı" yazıyordu —
          90 USD'lik bir hak ediş "₺90 / $2,34" görünüyordu; (2) yalnızca alacak tarafı vardı,
          personele yapılan ödemeler hiç yer almadığı için bakiye sürekli artıyordu.
          Gerçek defter (borç/alacak/bakiye, para birimi başına) TechnicianLedgerEntries'te.
        */
        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm text-center space-y-3">
          <div className="mx-auto w-12 h-12 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center">
            <WalletCards className="w-6 h-6" />
          </div>
          <h2 className="text-base font-bold text-slate-900">Personel Ekstresi ayrı sayfada</h2>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            Borç / alacak / bakiye hareketleri, personele yapılan ödemeler ve para birimi başına
            bakiye Personel Ekstresi sayfasında tutuluyor.
          </p>
          <button
            type="button"
            onClick={() => navigate('/personel-ekstre')}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-emerald-700 px-5 text-sm font-semibold text-white hover:bg-emerald-800"
          >
            Personel Ekstresini Aç →
          </button>
        </div>
      )}

      {/* Hak Ediş Tanımlama Modal */}
      {defineModalOpen && targetEarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-100 font-outfit space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-base">Hak Ediş Tanımla</h3>
              <button type="button" onClick={() => setDefineModalOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <div className="bg-slate-50 p-3 rounded-xl space-y-1 text-xs text-slate-700">
              <div><span className="font-bold">Teknisyen:</span> {targetEarning.technicianName}</div>
              <div><span className="font-bold">Servis Fiş No:</span> {targetEarning.sourceNumber || '-'}</div>
              <div><span className="font-bold">Müşteri:</span> {targetEarning.customerName || '-'}</div>
              <div><span className="font-bold">Ürün:</span> {targetEarning.productName || '-'}</div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Hak Ediş Tutarı</label>
                <input
                  type="number"
                  step="0.01"
                  value={inputAmount}
                  onChange={(e) => setInputAmount(e.target.value)}
                  placeholder="Örn: 90"
                  className="w-full h-10 px-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-[#B91C1C]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Para Birimi</label>
                <select
                  value={inputCurrency}
                  onChange={(e) => setInputCurrency(e.target.value)}
                  className="w-full h-10 px-3 border border-slate-200 rounded-xl text-sm font-bold bg-white outline-none focus:border-[#B91C1C]"
                >
                  <option value="USD">USD ($)</option>
                  <option value="TRY">TRY (₺)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDefineModalOpen(false)}
                className="flex-1 h-10 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={handleSaveDefinedHakedis}
                disabled={defineSaving}
                className="flex-1 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-sm disabled:opacity-50"
              >
                {defineSaving ? 'Kaydediliyor...' : 'Hak Edişi Onayla'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
