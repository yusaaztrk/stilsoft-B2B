import { useEffect, useMemo, useState } from 'react'
import { fetchErpAccounts, type ErpAccountOption, type ErpPaymentSource } from '../api/employeePayments'

/**
 * ÖDEMENİN ÇIKACAĞI B2B KASA / BANKASI (2026-09-27 kullanıcı kararı).
 *
 * Personel ödemeleri artık B2B'deki kasa ve bankalardan çıkıyor. Seçilen hesaba tek
 * "Personel Ödemesi" satırı yazılır (toplu ödemede toplam, personel adı yazılmaz).
 * Tutar TL girilir; dövizli hesapta kur TCMB döviz satışından gelir ve elle düzeltilebilir,
 * hesaptan çıkacak döviz tutarı altta gösterilir.
 */

let lastAccounts: ErpAccountOption[] | null = null

/**
 * Ödemeyi göndermeden önceki kontrol; sorun yoksa null.
 *
 * Kaynak zorunlu: kullanıcının B2B'de yetkili hesabı varsa EVET. Hiç hesabı yoksa (B2B
 * kullanıcısı olmayan personel yöneticisi) ödeme eskisi gibi yalnız personel programına yazılır;
 * aksi hâlde bu kullanıcılar hiç ödeme yapamazdı. Dövizli hesapta kur boşsa sunucu TCMB kuruna
 * düşerdi — ekranda görünenle yazılan ayrışmasın diye burada durdurulur.
 */
export function erpSourceError(source: ErpPaymentSource | null): string | null {
  const accounts = lastAccounts ?? []
  if (!source) return accounts.length > 0 ? 'Lütfen ödemenin çıkacağı kasa ya da bankayı seçiniz.' : null
  const acc = accounts.find((a) => a.kind === source.kind && a.id === source.accountId)
  if (acc && acc.currencyCode !== 'TRY' && !(Number(source.rate) > 0)) return `Lütfen ${acc.currencyCode} kurunu giriniz.`
  return null
}

const money = (n: number, code = 'TRY') =>
  `${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${code === 'TRY' ? '₺' : code}`

type Props = {
  value: ErpPaymentSource | null
  onChange: (value: ErpPaymentSource | null) => void
  /** Ödenecek toplam TL — döviz önizlemesi için. */
  amountTry: number
  disabled?: boolean
}

const CURRENCY_LABEL: Record<string, string> = { TRY: 'TL', USD: 'USD', EUR: 'EUR', GBP: 'GBP' }

const CURRENCY_BADGE: Record<string, string> = {
  TRY: 'bg-slate-100 text-slate-700 border-slate-200',
  USD: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  EUR: 'bg-sky-50 text-sky-700 border-sky-200',
  GBP: 'bg-violet-50 text-violet-700 border-violet-200'
}

const norm = (s: string) => s.toLocaleLowerCase('tr-TR')

export default function ErpSourcePicker({ value, onChange, amountTry, disabled }: Props) {
  const [accounts, setAccounts] = useState<ErpAccountOption[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rateText, setRateText] = useState(value?.rate ? String(value.rate).replace('.', ',') : '')
  // Önce tür (kasa/banka), sonra para birimi ve arama — uzun tek listeden seçmek zordu (2026-09-27).
  const [kind, setKind] = useState<1 | 2>(value?.kind ?? 1)
  const [currency, setCurrency] = useState<string>('ALL')
  const [search, setSearch] = useState('')
  const [listOpen, setListOpen] = useState(!value)

  useEffect(() => {
    let active = true
    fetchErpAccounts()
      .then((list) => {
        if (!active) return
        lastAccounts = list
        setAccounts(list)
      })
      .catch((e) => {
        if (!active) return
        lastAccounts = []
        setAccounts([])
        setError(String(e?.message ?? 'Kasa/banka listesi alınamadı'))
      })
    return () => { active = false }
  }, [])

  // Pencere yeniden açıldığında hatırlanan seçimin kuru kutuda görünsün.
  useEffect(() => {
    if (value?.rate && !rateText) setRateText(String(value.rate).replace('.', ','))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.rate])

  const selected = useMemo(
    () => (value && accounts ? accounts.find((a) => a.kind === value.kind && a.id === value.accountId) ?? null : null),
    [value, accounts]
  )

  const isForeign = !!selected && selected.currencyCode !== 'TRY'
  const rate = isForeign ? Number(rateText.replace(',', '.')) : 1
  const foreignAmount = isForeign && rate > 0 ? Math.round((amountTry / rate) * 100) / 100 : null

  const counts = useMemo(() => ({
    1: (accounts ?? []).filter((a) => a.kind === 1).length,
    2: (accounts ?? []).filter((a) => a.kind === 2).length
  }), [accounts])

  const currenciesOfKind = useMemo(() => {
    const set = new Set((accounts ?? []).filter((a) => a.kind === kind).map((a) => a.currencyCode))
    return ['TRY', 'USD', 'EUR', 'GBP'].filter((c) => set.has(c))
  }, [accounts, kind])

  const visible = useMemo(() => {
    const q = norm(search.trim())
    return (accounts ?? [])
      .filter((a) => a.kind === kind)
      .filter((a) => currency === 'ALL' || a.currencyCode === currency)
      .filter((a) => !q || norm(a.name).includes(q))
  }, [accounts, kind, currency, search])

  const pick = (acc: ErpAccountOption) => {
    const initialRate = acc.currencyCode === 'TRY' ? null : acc.rate
    setRateText(initialRate ? String(initialRate).replace('.', ',') : '')
    onChange({ kind: acc.kind, accountId: acc.id, rate: initialRate })
    setListOpen(false)
  }

  const changeKind = (k: 1 | 2) => {
    setKind(k)
    setCurrency('ALL')
    setSearch('')
    setListOpen(true)
    if (value && value.kind !== k) onChange(null)
  }

  const changeRate = (text: string) => {
    setRateText(text)
    if (!value) return
    const r = Number(text.replace(',', '.'))
    onChange({ ...value, rate: r > 0 ? r : null })
  }

  if (accounts === null) {
    return <div className="text-[11px] text-slate-400">Kasa / banka listesi yükleniyor…</div>
  }

  if (accounts.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
        {error ?? "B2B'de yetkili olduğunuz kasa/banka yok; ödeme yalnız personel programına kaydedilir."}
      </div>
    )
  }

  const chip = (active: boolean) =>
    'px-2.5 py-1 rounded-md text-[11px] font-bold border transition ' +
    (active ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50')

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <span className="text-[11px] font-bold text-slate-700">
          Ödeme Kaynağı (B2B) <span className="text-red-500">*</span>
        </span>
        <span className="text-[10px] text-slate-400">B2B'ye "Personel Ödemesi" olarak tek satır, isimsiz</span>
      </div>

      {/* 1) Tür */}
      <div className="grid grid-cols-2 gap-2">
        {([1, 2] as const).map((k) => (
          <button
            key={k}
            type="button"
            disabled={disabled || counts[k] === 0}
            onClick={() => changeKind(k)}
            className={
              'rounded-lg border px-3 py-2 text-sm font-bold transition disabled:opacity-40 ' +
              (kind === k ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50')
            }
          >
            {k === 1 ? 'Kasa' : 'Banka'} <span className={kind === k ? 'text-slate-300' : 'text-slate-400'}>({counts[k]})</span>
          </button>
        ))}
      </div>

      {/* Seçili hesap */}
      {selected && !listOpen ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-300 bg-white px-3 py-2">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">{selected.kind === 1 ? 'Kasa' : 'Banka'}</div>
            <div className="truncate text-sm font-semibold text-slate-900" title={selected.name}>{selected.name}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={'rounded border px-1.5 py-0.5 text-[10px] font-bold ' + (CURRENCY_BADGE[selected.currencyCode] ?? CURRENCY_BADGE.TRY)}>
              {CURRENCY_LABEL[selected.currencyCode] ?? selected.currencyCode}
            </span>
            <button type="button" disabled={disabled} onClick={() => setListOpen(true)} className="text-[11px] font-bold text-slate-600 underline">
              Değiştir
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* 2) Para birimi + arama */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" className={chip(currency === 'ALL')} onClick={() => setCurrency('ALL')}>Tümü</button>
            {currenciesOfKind.map((c) => (
              <button key={c} type="button" className={chip(currency === c)} onClick={() => setCurrency(c)}>
                {CURRENCY_LABEL[c]}
              </button>
            ))}
          </div>
          <input
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
            placeholder={kind === 1 ? 'Kasa ara (ad / kod)…' : 'Banka ara (ad / hesap no)…'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={disabled}
          />

          {/* 3) Liste */}
          <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
            {visible.length === 0 ? (
              <div className="px-3 py-4 text-center text-[12px] text-slate-400">Eşleşen hesap yok.</div>
            ) : (
              visible.map((a) => {
                const isSel = !!value && value.kind === a.kind && value.accountId === a.id
                return (
                  <button
                    key={`${a.kind}:${a.id}`}
                    type="button"
                    disabled={disabled}
                    onClick={() => pick(a)}
                    className={
                      'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] transition ' +
                      (isSel ? 'bg-emerald-50 font-semibold text-emerald-900' : 'text-slate-800 hover:bg-slate-50')
                    }
                  >
                    <span className="truncate" title={a.name}>{a.name}</span>
                    <span className={'shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold ' + (CURRENCY_BADGE[a.currencyCode] ?? CURRENCY_BADGE.TRY)}>
                      {CURRENCY_LABEL[a.currencyCode] ?? a.currencyCode}
                    </span>
                  </button>
                )
              })
            )}
          </div>
          {selected && (
            <button type="button" onClick={() => setListOpen(false)} className="text-[11px] font-bold text-slate-500 underline">
              Vazgeç — seçili hesapta kal ({selected.name})
            </button>
          )}
        </>
      )}

      {isForeign && selected && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[11px] font-bold text-sky-900 whitespace-nowrap">1 {selected.currencyCode} =</label>
            <input
              inputMode="decimal"
              className="w-28 rounded-md border border-sky-300 bg-white px-2 py-1 text-sm text-right"
              value={rateText}
              onChange={(e) => changeRate(e.target.value)}
              disabled={disabled}
              placeholder="Kur"
            />
            <span className="text-[11px] text-sky-900">₺ {selected.rate ? '(TCMB döviz satış, değiştirilebilir)' : '(TCMB kuru alınamadı, elle girin)'}</span>
          </div>
          <div className="text-[12px] font-bold text-sky-950">
            {!(rate > 0)
              ? 'Geçerli bir kur giriniz.'
              : amountTry > 0 && foreignAmount !== null
                ? <>Hesaptan <span className="text-sky-700">{money(foreignAmount, selected.currencyCode)}</span> çıkacak ({money(amountTry)})</>
                : 'Hesaptan çıkacak döviz tutarı, ödenecek TL tutarın bu kura bölünmesiyle hesaplanır.'}
          </div>
        </div>
      )}
    </div>
  )
}
