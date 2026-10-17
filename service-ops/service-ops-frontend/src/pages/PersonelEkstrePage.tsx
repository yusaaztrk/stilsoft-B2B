import { useEffect, useMemo, useState } from 'react'
import { BookUser, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import {
  createLedgerPayment,
  deleteLedgerEntry,
  EARNING_CURRENCIES,
  fetchTechnicianLedger,
  formatMoney,
  type TechnicianLedgerRow,
} from '../api/earnings'
import { useTechnicians } from '../hooks/useTechnicians'
import { usePermissions } from '../auth/PermissionsContext'
import { toast } from 'sonner'

/**
 * Personel Hak Ediş Ekstresi.
 *
 * B2B'deki Cari Ekstre ile GÖRSEL OLARAK benzer, VERİ OLARAK apayrıdır: cari ekstre müşterinin
 * borcunu/alacağını gösterir, bu defter şirketin personele olan borcunu gösterir. İkisi aynı
 * tabloya bağlı değildir ve olmamalıdır.
 *
 * Bakiye PARA BİRİMİ BAŞINA yürür. 90 USD ile 100 TRY tek toplamda birleştirilmez — hak edişler
 * çoğunlukla döviz bazlı ve tek değere indirgemek orijinal tutarı kaybettirir.
 */

const entryTypeLabels: Record<string, string> = {
  Earning: 'Hak Ediş',
  Payment: 'Ödeme',
  Adjustment: 'Düzeltme',
}

function todayIso(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 10)
}

function firstDayOfMonthIso(): string {
  const d = new Date()
  d.setDate(1)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 10)
}

export default function PersonelEkstrePage() {
  const { technicians } = useTechnicians({ role: 'Technician' })
  const { can, isSuperAdmin } = usePermissions()

  // Ödeme girişi yalnızca "tüm işleri görme" yetkisi olanlarda; kendi ekstresine bakan personel
  // kendi defterine hareket yazamamalı. Sunucu da aynı kontrolü yapıyor, bu sadece ekran.
  const canManage = isSuperAdmin || can('hakedis.tumIsleriGorme' as never)

  const [technicianId, setTechnicianId] = useState('')
  const [currency, setCurrency] = useState('')
  const [from, setFrom] = useState(firstDayOfMonthIso())
  const [to, setTo] = useState(todayIso())

  const [rows, setRows] = useState<TechnicianLedgerRow[]>([])
  const [balances, setBalances] = useState<{ currency: string; balance: number }[]>([])
  const [openingBalances, setOpeningBalances] = useState<{ currency: string; balance: number }[]>([])
  const [periodTotals, setPeriodTotals] = useState<{ currency: string; debit: number; credit: number }[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paymentSaving, setPaymentSaving] = useState(false)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payCurrency, setPayCurrency] = useState<string>('TRY')
  const [payDate, setPayDate] = useState(todayIso())
  const [payDescription, setPayDescription] = useState('')
  const [payReference, setPayReference] = useState('')
  const [payIsAdjustment, setPayIsAdjustment] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchTechnicianLedger({
        technicianId: technicianId || undefined,
        currency: currency || undefined,
        from: from || undefined,
        to: to || undefined,
      })
      setRows(res.data ?? [])
      setBalances(res.balances ?? [])
      setOpeningBalances(res.openingBalances ?? [])
      setPeriodTotals(res.periodTotals ?? [])
      setTruncated(Boolean(res.truncated))
    } catch (err) {
      setRows([])
      setBalances([])
      setOpeningBalances([])
      setPeriodTotals([])
      setTruncated(false)
      setError(err instanceof Error ? err.message : 'Ekstre alınamadı.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [technicianId, currency, from, to])

  const selectedTechnician = useMemo(
    () => technicians.find((t) => t.id === technicianId),
    [technicians, technicianId]
  )

  /**
   * Alt toplam satırı DÖNEM hareketlerini gösterir (borç/alacak), kapanış bakiyesini değil.
   * İkisi eskiden aynı sütunda "Bakiye" diye yazıyordu: satırlardaki yürüyen bakiye devri
   * içerirken alt toplam yalnızca dönem netiydi, iki sayı hiçbir zaman tutmuyordu.
   * Sunucudan geliyorsa o kullanılır; gelmiyorsa (eski sürüm) satırlardan hesaplanır.
   */
  const totals = useMemo(() => {
    if (periodTotals.length > 0) return periodTotals
    const byCurrency = new Map<string, { debit: number; credit: number }>()
    for (const r of rows) {
      const cur = byCurrency.get(r.currency) ?? { debit: 0, credit: 0 }
      cur.debit += Number(r.debit || 0)
      cur.credit += Number(r.credit || 0)
      byCurrency.set(r.currency, cur)
    }
    return Array.from(byCurrency.entries()).map(([cur, v]) => ({ currency: cur, ...v }))
  }, [rows, periodTotals])

  const closingByCurrency = useMemo(() => {
    const map = new Map<string, number>()
    for (const b of balances) map.set(b.currency, b.balance)
    return map
  }, [balances])

  const submitPayment = async () => {
    setPaymentError(null)

    if (!technicianId) {
      setPaymentError('Önce bir personel seçin.')
      return
    }
    const amount = parseFloat(payAmount.replace(',', '.'))
    if (isNaN(amount) || amount <= 0) {
      setPaymentError('Geçerli bir tutar girin.')
      return
    }

    setPaymentSaving(true)
    try {
      await createLedgerPayment({
        technicianId,
        amount,
        currency: payCurrency,
        entryDate: payDate ? new Date(`${payDate}T00:00:00`).toISOString() : undefined,
        description: payDescription.trim() || undefined,
        referenceNumber: payReference.trim() || undefined,
        isAdjustment: payIsAdjustment,
      })
      setPaymentOpen(false)
      setPayAmount('')
      setPayDescription('')
      setPayReference('')
      setPayIsAdjustment(false)
      await load()
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : 'Kayıt eklenemedi.')
    } finally {
      setPaymentSaving(false)
    }
  }

  /**
   * Silme onayı. Eskiden `confirm()` ile soruluyordu; tarayıcı kutusu sayfayı kilitliyor ve
   * mobilde tasarımın dışına düşüyordu. Silinecek satır artık state'te tutuluyor ve asıl
   * işlem modalın "Sil" düğmesine bağlı — `if (!confirm) return` deseni doğrudan modale
   * çevrilemez, çünkü modal cevabı senkron dönmez.
   */
  const [deleteTarget, setDeleteTarget] = useState<TechnicianLedgerRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const removeEntry = (row: TechnicianLedgerRow) => {
    if (row.entryType === 'Earning') return
    setDeleteTarget(row)
  }

  const confirmRemoveEntry = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteLedgerEntry(deleteTarget.id)
      setDeleteTarget(null)
      await load()
      toast.success('Hareket silindi.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Silinemedi.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-50 text-emerald-700 rounded-xl">
            <BookUser className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Personel Ekstresi</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Personelin hak ettiği tutarlar ve kendisine yapılan ödemeler
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Yenile
          </button>
          {canManage && (
            <button
              onClick={() => { setPaymentOpen(true); setPaymentError(null) }}
              disabled={!technicianId}
              title={technicianId ? undefined : 'Önce personel seçin'}
              className="flex items-center gap-2 px-3 py-2 bg-emerald-700 text-white rounded-lg text-sm font-semibold hover:bg-emerald-800 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              Ödeme / Düzeltme
            </button>
          )}
        </div>
      </div>

      {/* Filtreler */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Personel</label>
          <select
            value={technicianId}
            onChange={(e) => setTechnicianId(e.target.value)}
            className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full"
          >
            <option value="">Tüm personel</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>{t.fullName}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Para Birimi</label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full"
          >
            <option value="">Tümü</option>
            {EARNING_CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Başlangıç</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Bitiş</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full" />
        </div>
      </div>

      {/* Bakiye kartları — para birimi başına ayrı */}
      {balances.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {balances.map((b) => (
            <div key={b.currency} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                {b.currency} bakiye
              </div>
              <div className={`text-lg font-bold mt-1 ${b.balance >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {formatMoney(b.balance, b.currency)}
              </div>
              <div className="text-[10px] text-gray-400 mt-0.5">
                {b.balance >= 0 ? 'Personele ödenecek' : 'Personelden alacak'}
              </div>
              {/* Kartın kapsamı NET olsun: bu bakiye seçilen bitiş tarihine kadar olan HER ŞEYİ
                  kapsar, yalnızca ekrandaki dönemi değil. */}
              <div className="text-[10px] text-gray-400">
                {to ? `${new Date(to).toLocaleDateString('tr-TR')} tarihine kadar` : 'Tüm zamanlar'}
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="p-4 bg-rose-50 text-rose-700 border border-rose-100 rounded-xl text-sm">{error}</div>
      )}

      {truncated && (
        <div className="p-3 bg-amber-50 text-amber-800 border border-amber-100 rounded-xl text-xs">
          Bu aralıkta hareket sayısı listeleme sınırına ulaştı; tabloda hepsi görünmüyor.
          Bakiye kartları tam veriden hesaplandığı için doğru, ancak listeyi daraltmak için
          tarih aralığını küçültün.
        </div>
      )}

      {/* Ekstre tablosu */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-sm font-bold text-gray-800">
            {selectedTechnician ? selectedTechnician.fullName : 'Tüm personel'}
          </span>
          <span className="text-xs text-gray-500">{rows.length} hareket</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm mobile-stack">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold text-xs">Tarih</th>
                {!technicianId && <th className="px-4 py-2.5 text-left font-semibold text-xs">Personel</th>}
                <th className="px-4 py-2.5 text-left font-semibold text-xs">Açıklama</th>
                <th className="px-4 py-2.5 text-left font-semibold text-xs">Servis No</th>
                <th className="px-4 py-2.5 text-left font-semibold text-xs">Tür</th>
                <th className="px-4 py-2.5 text-right font-semibold text-xs">Borç</th>
                <th className="px-4 py-2.5 text-right font-semibold text-xs">Alacak</th>
                <th className="px-4 py-2.5 text-right font-semibold text-xs">Bakiye</th>
                <th className="px-4 py-2.5 text-center font-semibold text-xs">Döviz</th>
                {canManage && <th className="px-4 py-2.5 w-10" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {/* DEVİR — seçilen tarih aralığından öncesinin neti. Bu satır olmadan bakiye her
                  ay sıfırdan başlıyor ve geçmiş hak edişler yok sayılmış gibi görünüyordu. */}
              {!loading && openingBalances.map((ob) => (
                <tr key={`devir-${ob.currency}`} className="bg-slate-50/70">
                  <td data-label="Tarih" className="px-4 py-2.5 text-gray-500 text-xs">{from ? new Date(from).toLocaleDateString('tr-TR') : '—'}</td>
                  {!technicianId && <td data-label="Personel" className="px-4 py-2.5 text-gray-400 text-xs">—</td>}
                  <td data-label="Açıklama" className="px-4 py-2.5 font-semibold text-gray-700">Devir (önceki dönemden)</td>
                  <td data-label="Servis No" className="px-4 py-2.5 text-gray-400">—</td>
                  <td data-label="Tür" className="px-4 py-2.5 text-gray-400 text-xs">—</td>
                  <td data-label="Borç" className="px-4 py-2.5 text-right text-gray-400">—</td>
                  <td data-label="Alacak" className="px-4 py-2.5 text-right text-gray-400">—</td>
                  <td data-label="Bakiye" className="px-4 py-2.5 text-right font-bold text-gray-900">{formatMoney(ob.balance, ob.currency)}</td>
                  <td data-label="Döviz" className="px-4 py-2.5 text-center text-gray-500">{ob.currency}</td>
                  {canManage && <td />}
                </tr>
              ))}
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400">Yükleniyor...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400">Bu aralıkta hareket yok.</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50/60">
                    <td data-label="Tarih" className="px-4 py-2.5 whitespace-nowrap text-gray-700">
                      {new Date(r.entryDate).toLocaleDateString('tr-TR')}
                    </td>
                    {!technicianId && <td data-label="Personel" className="px-4 py-2.5 text-gray-700">{r.technicianName}</td>}
                    <td data-label="Açıklama" className="px-4 py-2.5 text-gray-800">{r.description}</td>
                    <td data-label="Servis No" className="px-4 py-2.5 text-gray-500">{r.referenceNumber || '—'}</td>
                    <td data-label="Tür" className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                        r.entryType === 'Earning'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                          : r.entryType === 'Payment'
                            ? 'bg-sky-50 text-sky-700 border-sky-100'
                            : 'bg-amber-50 text-amber-700 border-amber-100'
                      }`}>
                        {entryTypeLabels[r.entryType] ?? r.entryType}
                      </span>
                    </td>
                    <td data-label="Borç" className="px-4 py-2.5 text-right text-rose-700 font-medium">
                      {r.debit > 0 ? formatMoney(r.debit, r.currency) : '—'}
                    </td>
                    <td data-label="Alacak" className="px-4 py-2.5 text-right text-emerald-700 font-medium">
                      {r.credit > 0 ? formatMoney(r.credit, r.currency) : '—'}
                    </td>
                    <td data-label="Bakiye" className="px-4 py-2.5 text-right font-bold text-gray-900">
                      {formatMoney(r.balance, r.currency)}
                    </td>
                    <td data-label="Döviz" className="px-4 py-2.5 text-center text-gray-500">{r.currency}</td>
                    {canManage && (
                      <td className="px-4 py-2.5 text-center">
                        {r.entryType !== 'Earning' && (
                          <button
                            onClick={() => removeEntry(r)}
                            className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg"
                            title="Sil"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
            {totals.length > 0 && (
              <tfoot className="bg-gray-50 border-t border-gray-100">
                {totals.map((t) => (
                  <tr key={t.currency}>
                    <td colSpan={technicianId ? 4 : 5} className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">
                      {t.currency} dönem hareketi
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-rose-700">{formatMoney(t.debit, t.currency)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-emerald-700">{formatMoney(t.credit, t.currency)}</td>
                    {/* Bu sütun KAPANIŞ BAKİYESİ (devir + dönem), dönem neti değil. Eskiden
                        `credit - debit` yazıyordu ve son satırdaki yürüyen bakiyeyle
                        tutmuyordu — iki farklı hesap aynı başlık altındaydı. */}
                    <td className="px-4 py-2.5 text-right font-bold text-gray-900">
                      {formatMoney(closingByCurrency.get(t.currency) ?? (t.credit - t.debit), t.currency)}
                    </td>
                    <td className="px-4 py-2.5 text-center text-xs text-gray-500">{t.currency}</td>
                    {canManage && <td />}
                  </tr>
                ))}
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Ödeme / düzeltme girişi */}
      {paymentOpen && (
        <div className="fixed inset-0 z-[900] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={() => setPaymentOpen(false)}>
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-base font-bold text-gray-900">Ödeme / Düzeltme</h2>
                <p className="text-[11px] text-gray-500">{selectedTechnician?.fullName}</p>
              </div>
              <button onClick={() => setPaymentOpen(false)} className="p-2 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Tutar</label>
                  <input
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="0,00"
                    className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Para Birimi</label>
                  <select
                    value={payCurrency}
                    onChange={(e) => setPayCurrency(e.target.value)}
                    className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full"
                  >
                    {EARNING_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Tarih</label>
                <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Açıklama</label>
                <input
                  value={payDescription}
                  onChange={(e) => setPayDescription(e.target.value)}
                  placeholder="Personele ödeme"
                  className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Referans / Servis No</label>
                <input
                  value={payReference}
                  onChange={(e) => setPayReference(e.target.value)}
                  className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input type="checkbox" checked={payIsAdjustment} onChange={(e) => setPayIsAdjustment(e.target.checked)} />
                Ödeme değil, elle düzeltme olarak işaretle
              </label>

              {paymentError && (
                <div className="p-3 bg-rose-50 text-rose-700 border border-rose-100 rounded-lg text-xs">{paymentError}</div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setPaymentOpen(false)} className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Vazgeç
              </button>
              <button
                onClick={submitPayment}
                disabled={paymentSaving}
                className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 disabled:opacity-50"
              >
                {paymentSaving ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hareket silme onayı — tarayıcının confirm() kutusunun yerine. */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-[900] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onMouseDown={() => { if (!deleting) setDeleteTarget(null) }}
        >
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-bold text-gray-900">Hareket silinsin mi?</h2>
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="p-2 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-2">
              <p className="text-sm text-gray-600">Bu işlem geri alınamaz.</p>
              {/* Hangi satırın silindiği yazılı olsun: confirm() kutusu yalnızca
                  "Bu hareket silinsin mi?" diyordu ve hangi satır olduğu belli değildi. */}
              <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2 text-xs text-gray-700 space-y-0.5">
                {deleteTarget.description ? <div className="font-semibold text-gray-900">{deleteTarget.description}</div> : null}
                <div>
                  {deleteTarget.debit > 0
                    ? `Borç: ${formatMoney(deleteTarget.debit, deleteTarget.currency)}`
                    : `Alacak: ${formatMoney(deleteTarget.credit, deleteTarget.currency)}`}
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Vazgeç
              </button>
              <button
                onClick={confirmRemoveEntry}
                disabled={deleting}
                className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50"
              >
                {deleting ? 'Siliniyor...' : 'Sil'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
