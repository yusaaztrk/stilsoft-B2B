import { useEffect, useMemo, useState } from 'react'
import {
  addToPosTransfer,
  deletePosTransfer,
  fetchPosAccountSettings,
  fetchPosDay,
  runPosTransfer,
  fetchPosDayAll,
  type PosAccountSettingDto,
  type PosDaySummaryDto,
  type PosDayAllRow,
  type PosSourceTotal
} from '../api/posAccounts'

const money = (n: number) =>
  Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const todayIso = () => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * "Tüm POS hesapları" seçiminin değeri. Hesap kimlikleri pozitif olduğu için -1 çakışmaz;
 * null KULLANILAMAZ, o "henüz yüklenmedi" anlamına geliyor.
 */
const TUMU = -1

/**
 * HAREKETİN KAYNAĞI (2026-10-11, kullanıcı: "hangileri banka havale/EFT'den girdi, hangileri
 * sanal POS olmuş görelim"). Kodlar sunucudan gelir; sıralama da sunucunun tutara göre dizdiği gibi.
 */
const SOURCE_META: Record<string, { label: string; hint: string; cls: string }> = {
  vpos_eticaret: { label: 'Sanal POS · E-ticaret', hint: 'example.com sitesinden kartla ödenen sipariş', cls: 'bg-violet-100 text-violet-800 border-violet-200' },
  vpos_b2b: { label: 'Sanal POS · B2B', hint: 'B2B Sanal POS ekranından (veya bayi panelinden) kartla alınan ödeme', cls: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  banka: { label: 'Havale/EFT ekranı', hint: 'Banka Havale/EFT ekranından elle girilen kayıt (POS slipi)', cls: 'bg-sky-100 text-sky-800 border-sky-200' },
  fatura: { label: 'Satış faturası', hint: 'Fatura kesilirken POS ile alınan tahsilat', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  servis: { label: 'Servis faturası', hint: 'Servis/tamir faturası kesilirken POS ile alınan tahsilat', cls: 'bg-orange-100 text-orange-800 border-orange-200' },
  virman: { label: 'Virman', hint: 'Başka bir banka hesabından aktarılan', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  kasa: { label: 'Kasadan', hint: 'Kasa ekranından bankaya yatırılan', cls: 'bg-teal-100 text-teal-800 border-teal-200' },
  cek: { label: 'Çek', hint: 'Çek tahsili', cls: 'bg-rose-100 text-rose-800 border-rose-200' },
  aktarim: { label: 'Aktarım', hint: 'Günün vadesize süpürülmesi', cls: 'bg-slate-200 text-slate-700 border-slate-300' },
  masraf: { label: 'POS masrafı', hint: 'Banka masraf kaydı', cls: 'bg-red-50 text-red-700 border-red-200' },
  cikis: { label: 'Çıkış', hint: 'Diğer çıkış hareketi', cls: 'bg-slate-100 text-slate-600 border-slate-200' }
}
const sourceMeta = (s: string) => SOURCE_META[s] ?? { label: s || '—', hint: '', cls: 'bg-slate-100 text-slate-600 border-slate-200' }

/** Hesapların kaynak dökümlerini tek dökümde toplar ("Tümü" görünümünün üst özeti). */
const mergeSources = (lists: PosSourceTotal[][]): PosSourceTotal[] => {
  const map = new Map<string, PosSourceTotal>()
  for (const list of lists) for (const s of list ?? []) {
    const cur = map.get(s.source) ?? { source: s.source, count: 0, amount: 0 }
    map.set(s.source, { source: s.source, count: cur.count + s.count, amount: cur.amount + s.amount })
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount)
}

export default function PosTransferPage() {
  const [accounts, setAccounts] = useState<PosAccountSettingDto[]>([])
  const [posAccountId, setPosAccountId] = useState<number | null>(null)
  const [tumRows, setTumRows] = useState<PosDayAllRow[]>([])
  const [date, setDate] = useState(todayIso())
  const [day, setDay] = useState<PosDaySummaryDto | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmAdd, setConfirmAdd] = useState(false)
  // Kaynak çipine tıklanınca tablo yalnız o kaynağın hareketlerini gösterir.
  const [sourceFilter, setSourceFilter] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const data = await fetchPosAccountSettings()
        setAccounts(data.posAccounts)
        if (data.posAccounts.length && posAccountId == null) {
          setPosAccountId(data.posAccounts[0].posBankAccountDefinitionId)
        }
      } catch (e: any) {
        setError(e?.message || 'POS hesapları yüklenemedi.')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const load = async () => {
    if (!posAccountId) return
    try {
      setLoading(true)
      setError(null)
      setSelected([])
      setSourceFilter(null)

      if (posAccountId === TUMU) {
        // Genel görünümde tek hesabın gün özeti ANLAMSIZ; eski veri ekranda kalmasın.
        setDay(null)
        setTumRows(await fetchPosDayAll(date))
        return
      }

      setTumRows([])
      setDay(await fetchPosDay(posAccountId, date))
    } catch (e: any) {
      setError(e?.message || 'Gün yüklenemedi.')
      setDay(null)
      setTumRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posAccountId, date])

  const account = useMemo(
    () => accounts.find(a => a.posBankAccountDefinitionId === posAccountId) || null,
    [accounts, posAccountId]
  )

  const unsettledRows = useMemo(
    () => (day?.rows ?? []).filter(r => !r.isSettled && r.debit > 0),
    [day]
  )

  const selectedTotal = useMemo(
    () => unsettledRows.filter(r => selected.includes(r.bankAccountTransactionId)).reduce((s, r) => s + r.debit, 0),
    [unsettledRows, selected]
  )

  const act = async (fn: () => Promise<any>, okMessage: string) => {
    try {
      setBusy(true)
      setError(null)
      setNotice(null)
      await fn()
      setNotice(okMessage)
      await load()
    } catch (e: any) {
      setError(e?.message || 'İşlem başarısız.')
    } finally {
      setBusy(false)
      setConfirmAdd(false)
    }
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-slate-800">POS Aktarım</h1>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 bg-white border border-slate-200 rounded-xl p-4">
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">POS HESABI</label>
          <select
            className="w-full border border-slate-300 rounded-lg px-2 py-2 text-sm"
            value={posAccountId ?? ''}
            onChange={e => setPosAccountId(e.target.value ? Number(e.target.value) : null)}
          >
            {/* "Tümü" hesap hesap dolaşmadan hangi bankada ne olduğunu görmek için. */}
            <option value={TUMU}>★ TÜM POS HESAPLARI</option>
            {accounts.map(a => (
              <option key={a.posBankAccountDefinitionId} value={a.posBankAccountDefinitionId}>
                {a.accountName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">TARİH</label>
          <input
            type="date"
            /*
              GELECEK TARİHE AKTARIM YAPILMAZ (denetim md. 33).

              Manuel POS aktarımı ileri bir tarih için tetiklenebiliyordu: henüz gerçekleşmemiş
              bir günün tahsilatı için boş transfer fişi kesiliyordu. Seçici bugünle sınırlı.
            */
            max={todayIso()}
            className="w-full border border-slate-300 rounded-lg px-2 py-2 text-sm"
            value={date}
            onChange={e => {
              const picked = e.target.value
              setDate(picked && picked > todayIso() ? todayIso() : picked)
            }}
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">BAĞLI VADESİZ HESAP</label>
          <div className="w-full border border-slate-200 bg-slate-50 rounded-lg px-2 py-2 text-sm text-slate-700">
            {posAccountId === TUMU
              ? <span className="text-slate-500">Hesap başına aşağıda</span>
              : (day?.targetAccountName || <span className="text-amber-600">Tanımlı değil</span>)}
          </div>
        </div>
      </div>

      {error && <div className="mt-3 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-3">{error}</div>}
      {notice && <div className="mt-3 text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-3">{notice}</div>}

      {/*
        "AKTARIM CALISMIYOR" SANILMASININ SEBEBI (2026-08-21).
        Ekran BUGUNU aciyor, otomatik aktarim ise KAPANMIS gunu supuruyor. Bugune bakan
        kullanici "Aktarilan: 0,00" gorup aktarimin calismadigini sanıyordu. Gunun ne zaman
        supurulecegi burada yaziyor.
      */}
      {day && date === todayIso() && !day.transferId && account?.isAutoTransferEnabled && (
        <div className="mt-3 text-xs bg-blue-50 border border-blue-200 text-blue-800 rounded-lg p-3">
          Bugün henüz kapanmadı. Bugünün tahsilatları, gün kapandıktan sonra saat{' '}
          <b>{String(account.transferTime ?? '').slice(0, 5) || '00:00'}</b> otomatik aktarılır.
          Dünkü aktarımı görmek için tarihi bir gün geri alın.
        </div>
      )}

      {/* GENEL GÖRÜNÜM — bütün POS hesapları tek tabloda. */}
      {posAccountId === TUMU && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-3 text-xs mb-3">
            <span className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700">
              Gün Girişi: <b>{money(tumRows.reduce((s, r) => s + r.totalIn, 0))}</b>
            </span>
            <span className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-800">
              Aktarılan: <b>{money(tumRows.reduce((s, r) => s + r.transferredAmount, 0))}</b>
            </span>
            {tumRows.reduce((s, r) => s + r.unsettledAmount, 0) > 0 && (
              <span className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700">
                Aktarılmayan: <b>{money(tumRows.reduce((s, r) => s + r.unsettledAmount, 0))}</b>
              </span>
            )}
          </div>

          <SourceBreakdown items={mergeSources(tumRows.map(r => r.bySource))} />

          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-3 py-2">POS Hesabı</th>
                  <th className="text-left px-3 py-2">Vadesiz Hesap</th>
                  <th className="text-right px-3 py-2">Devir</th>
                  <th className="text-right px-3 py-2">Gün Girişi</th>
                  <th className="text-right px-3 py-2">Aktarılan</th>
                  <th className="text-right px-3 py-2">Aktarılmayan</th>
                  <th className="text-left px-3 py-2">Girişin Kaynağı</th>
                  <th className="text-left px-3 py-2">Aktaran</th>
                </tr>
              </thead>
              <tbody>
                {tumRows.length === 0 && !loading && (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">Kayıt yok.</td></tr>
                )}
                {tumRows.map(r => (
                  <tr key={r.posBankAccountDefinitionId} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setPosAccountId(r.posBankAccountDefinitionId)}
                        className="font-semibold text-slate-800 hover:text-emerald-700 underline decoration-dotted"
                        title="Bu hesabın hareketlerini aç"
                      >
                        {r.posAccountName}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{r.targetAccountName || '—'}</td>
                    <td className="px-3 py-2 text-right">{money(r.openingBalance)}</td>
                    <td className="px-3 py-2 text-right">{money(r.totalIn)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-emerald-700">{money(r.transferredAmount)}</td>
                    <td className={`px-3 py-2 text-right ${r.unsettledAmount > 0 ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>
                      {money(r.unsettledAmount)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {(r.bySource ?? []).length === 0 && <span className="text-slate-400">—</span>}
                        {(r.bySource ?? []).map(s => (
                          <span
                            key={s.source}
                            title={`${sourceMeta(s.source).hint} — ${s.count} hareket`}
                            className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${sourceMeta(s.source).cls}`}
                          >
                            {sourceMeta(s.source).label} <b>{money(s.amount)}</b>
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {r.transferId
                        ? (r.transferUser === 'SYSTEM' ? 'Otomatik' : (r.transferUser || '—'))
                        : <span className="text-slate-400">Aktarılmadı</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {day && (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
          <span className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700">
            Devir: <b>{money(day.openingBalance)}</b>
          </span>
          <span className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700">
            Gün Girişi: <b>{money(day.totalIn)}</b>
          </span>
          <span className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-800">
            Aktarılan: <b>{money(day.transferredAmount)}</b>
          </span>
          {day.unsettledAmount > 0 && (
            <span className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700">
              Aktarılmayan: <b>{money(day.unsettledAmount)}</b>
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            {day.transferId && selected.length > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmAdd(true)}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-semibold"
              >
                Aktarıma Dahil Et ({selected.length})
              </button>
            )}
            {!day.transferId && (
              <button
                type="button"
                disabled={busy || !day.targetBankAccountDefinitionId}
                onClick={() => void act(() => runPosTransfer(posAccountId!, date), 'Aktarım tamamlandı.')}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold"
              >
                Aktarımı Şimdi Yap
              </button>
            )}
            {day.transferId && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void act(() => deletePosTransfer(day.transferId!), 'Aktarım silindi.')}
                className="px-3 py-1.5 rounded-lg border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 font-semibold"
              >
                Aktarımı Sil
              </button>
            )}
          </div>
        </div>
      )}

      {day && (
        <SourceBreakdown
          items={day.bySource ?? []}
          active={sourceFilter}
          onPick={s => setSourceFilter(prev => (prev === s ? null : s))}
        />
      )}

      {/* Tümü görünümünde hareket tablosu yok: boş "hareket yok" tablosu yanıltıyordu. */}
      {posAccountId !== TUMU && (
      <div className="mt-4 overflow-x-auto border border-slate-200 rounded-xl bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 w-8"></th>
              <th className="text-left px-3 py-2 font-semibold">Tarih</th>
              <th className="text-left px-3 py-2 font-semibold">Açıklama</th>
              <th className="text-left px-3 py-2 font-semibold">Kaynak</th>
              <th className="text-left px-3 py-2 font-semibold">Karşı Taraf</th>
              <th className="text-right px-3 py-2 font-semibold">Giriş</th>
              <th className="text-right px-3 py-2 font-semibold">Çıkış</th>
              <th className="text-right px-3 py-2 font-semibold">Bakiye</th>
              <th className="text-left px-3 py-2 font-semibold">Durum</th>
              <th className="text-left px-3 py-2 font-semibold">Kullanıcı</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-slate-400">Yükleniyor…</td></tr>
            )}
            {!loading && (day?.rows.length ?? 0) === 0 && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-slate-400">Bu güne ait hareket yok.</td></tr>
            )}
            {!loading && day?.rows.filter(r => !sourceFilter || r.source === sourceFilter).map(r => (
              <tr
                key={r.bankAccountTransactionId}
                className={`border-t border-slate-100 ${r.isTransferRow ? 'bg-slate-50 font-semibold' : ''}`}
              >
                <td className="px-3 py-2">
                  {!r.isSettled && r.debit > 0 && day.transferId && (
                    <input
                      type="checkbox"
                      checked={selected.includes(r.bankAccountTransactionId)}
                      onChange={e =>
                        setSelected(prev =>
                          e.target.checked
                            ? [...prev, r.bankAccountTransactionId]
                            : prev.filter(x => x !== r.bankAccountTransactionId)
                        )
                      }
                    />
                  )}
                </td>
                <td className="px-3 py-2 text-slate-600">{new Date(r.date).toLocaleDateString('tr-TR')}</td>
                <td className="px-3 py-2 text-slate-800">{r.description}</td>
                <td className="px-3 py-2">
                  <span
                    title={sourceMeta(r.source).hint}
                    className={`text-[11px] px-2 py-0.5 rounded border whitespace-nowrap ${sourceMeta(r.source).cls}`}
                  >
                    {sourceMeta(r.source).label}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-600">{r.counterpartyName || r.counterpartyCode}</td>
                <td className="px-3 py-2 text-right">{money(r.debit)}</td>
                <td className="px-3 py-2 text-right">{money(r.credit)}</td>
                <td className="px-3 py-2 text-right">{money(r.balance)}</td>
                <td className="px-3 py-2">
                  {r.isTransferRow ? (
                    <span className="text-[11px] px-2 py-0.5 rounded bg-slate-200 text-slate-700">Aktarım</span>
                  ) : r.isSettled ? (
                    <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">Aktarıldı</span>
                  ) : (
                    <span className="text-[11px] px-2 py-0.5 rounded bg-red-100 text-red-700">Aktarılmadı</span>
                  )}
                </td>
                <td className="px-3 py-2 text-[11px] text-slate-400">{r.createUser}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {confirmAdd && day?.transferId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-5 max-w-md w-full shadow-xl">
            <h3 className="font-bold text-slate-800">Aktarıma Dahil Et</h3>
            <p className="mt-3 text-sm text-slate-600">
              Mevcut aktarım <b>{money(day.transferredAmount)}</b> idi.
              Seçilen <b>{selected.length}</b> hareket (<b>{money(selectedTotal)}</b>) dahil edilecek,
              aktarım <b>{money(day.transferredAmount + selectedTotal)}</b> olacak.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmAdd(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void act(() => addToPosTransfer(day.transferId!, selected), 'Hareketler dahil edildi.')}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold"
              >
                Onayla
              </button>
            </div>
          </div>
        </div>
      )}

      {posAccountId !== TUMU && (
      <p className="mt-3 text-[11px] text-slate-400">
        {account?.accountName} hesabına düşen sanal POS ve elle girilen slip hareketlerinin tamamı listelenir.
        Banka İşlemleri'nde silinen kayıt burada da anında görünmez olur.
      </p>
      )}
    </div>
  )
}

/** Günün girişleri kaynağa göre: tutar + adet. Tıklanınca (varsa) tabloyu o kaynağa süzer. */
function SourceBreakdown({
  items,
  active = null,
  onPick
}: {
  items: PosSourceTotal[]
  active?: string | null
  onPick?: (source: string) => void
}) {
  if (!items.length) return null
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
      <span className="text-[11px] font-semibold text-slate-500">GİRİŞİN KAYNAĞI:</span>
      {items.map(s => {
        const m = sourceMeta(s.source)
        const on = active === s.source
        return (
          <button
            key={s.source}
            type="button"
            disabled={!onPick}
            onClick={() => onPick?.(s.source)}
            title={m.hint + (onPick ? (on ? ' — süzgeci kaldırmak için tekrar tıklayın' : ' — yalnız bunları göstermek için tıklayın') : '')}
            className={`px-2.5 py-1 rounded-lg border ${m.cls} ${on ? 'ring-2 ring-offset-1 ring-slate-500' : ''} ${onPick ? 'hover:brightness-95 cursor-pointer' : 'cursor-default'}`}
          >
            {m.label}: <b>{money(s.amount)}</b> <span className="opacity-70">({s.count})</span>
          </button>
        )
      })}
      {active && onPick && (
        <button type="button" onClick={() => onPick(active)} className="text-[11px] text-slate-500 underline">
          Tümünü göster
        </button>
      )}
    </div>
  )
}
