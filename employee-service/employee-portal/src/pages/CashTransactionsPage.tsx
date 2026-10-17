import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, RefreshCw, Wallet } from 'lucide-react'
import Layout from '../components/Layout'
import { fetchCashTransactions, type CashTransactionItemDto } from '../api/employeePayments'
import { fetchCashAccountSummary, type CashAccountSummaryDto } from '../api/employeeLedger'
import AyarliTablo from '../components/table/AyarliTablo'

const money = (v: number) =>
  new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v ?? 0)

const dmy = (iso?: string | null) => {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('tr-TR')
}

const PAYMENT_LABEL: Record<number, string> = {
  1: 'Maaş',
  2: 'Prim',
  3: 'Avans',
  4: 'Yemek'
}

function firstOfMonthIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Personel kasasının hareket dökümü.
 *
 * Kasa ERP'nin gerçek kasasından AYRIDIR (`EmployeeCashAccounts`); bakiyesi eksiye düşebilir,
 * kasaya para girişi yapmak zorunlu değildir. İleride bayi kasa/banka yapısına bağlanacak.
 *
 * Toplu ödemeler kasaya tek üst satır olarak yazılır ("Maaş toplu ödemesi (20 personel)");
 * satır açıldığında hangi personele ne kadar ödendiği alt kırılımdan gelir. Bakiye yalnızca
 * üst satırlardan hesaplanır — kırılım satırları da sayılsa aynı para iki kez çıkmış görünürdü.
 */
export default function CashTransactionsPage() {
  const [summary, setSummary] = useState<CashAccountSummaryDto | null>(null)
  const [rows, setRows] = useState<CashTransactionItemDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [from, setFrom] = useState(firstOfMonthIso)
  const [to, setTo] = useState(todayIso)

  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [children, setChildren] = useState<Record<number, CashTransactionItemDto[]>>({})
  const [childBusy, setChildBusy] = useState(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const [sum, list] = await Promise.all([
        fetchCashAccountSummary({ signal }),
        fetchCashTransactions({ from, to, signal })
      ])
      setSummary(sum)
      setRows(list.data)
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      setError(String(e?.message ?? 'Kasa hareketleri yüklenemedi'))
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
  }, [load])

  const toggle = async (row: CashTransactionItemDto) => {
    if (!row.isBulk) return
    if (expandedId === row.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(row.id)
    if (children[row.id]) return

    setChildBusy(true)
    try {
      const res = await fetchCashTransactions({ parentId: row.id })
      setChildren((prev) => ({ ...prev, [row.id]: res.data }))
    } catch {
      setChildren((prev) => ({ ...prev, [row.id]: [] }))
    } finally {
      setChildBusy(false)
    }
  }

  const rangeTotals = useMemo(() => {
    const out = rows.filter((r) => r.direction === 2).reduce((a, r) => a + (r.amount ?? 0), 0)
    const inn = rows.filter((r) => r.direction === 1).reduce((a, r) => a + (r.amount ?? 0), 0)
    return { out, inn }
  }, [rows])

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-neutral-900 flex items-center gap-2">
              <Wallet size={18} />
              Kasa Hareketleri
            </h1>
            <p className="text-sm text-neutral-500 mt-1">
              {summary ? `${summary.name} (${summary.code})` : 'Personel kasası'} — personele yapılan tüm
              ödemelerin çıkış dökümü. Bakiye eksiye düşebilir.
            </p>
          </div>
          <button type="button" onClick={() => void load()} className="btn-editorial" disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : undefined} />
            Yenile
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-ivory-300 bg-white p-4">
            <div className="text-[11px] uppercase tracking-wider text-neutral-400">Kasa Bakiyesi</div>
            <div
              className={`text-2xl font-semibold mt-1 ${
                (summary?.balance ?? 0) < 0 ? 'text-rose-700' : 'text-neutral-900'
              }`}
            >
              {money(summary?.balance ?? 0)} ₺
            </div>
          </div>
          <div className="rounded-xl border border-ivory-300 bg-white p-4">
            <div className="text-[11px] uppercase tracking-wider text-neutral-400">Seçili Aralık — Çıkış</div>
            <div className="text-2xl font-semibold mt-1 text-rose-700">{money(rangeTotals.out)} ₺</div>
          </div>
          <div className="rounded-xl border border-ivory-300 bg-white p-4">
            <div className="text-[11px] uppercase tracking-wider text-neutral-400">Seçili Aralık — Giriş</div>
            <div className="text-2xl font-semibold mt-1 text-emerald-700">{money(rangeTotals.inn)} ₺</div>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-ivory-300 bg-white p-4">
          <div className="space-y-1">
            <label htmlFor="cash-from" className="block text-[11px] uppercase tracking-wider text-neutral-400">
              Başlangıç
            </label>
            <input
              id="cash-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="input-base"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="cash-to" className="block text-[11px] uppercase tracking-wider text-neutral-400">
              Bitiş
            </label>
            <input id="cash-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input-base" />
          </div>
          <button type="button" onClick={() => void load()} className="btn-primary" disabled={loading}>
            Raporla
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3 text-sm text-rose-800">{error}</div>
        )}

        <div className="rounded-xl border border-ivory-300 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <AyarliTablo>
            <table className="w-full text-sm">
              <thead className="bg-ivory-100 text-[11px] uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-3 py-2 text-left w-8" />
                  <th className="px-3 py-2 text-left">Tarih</th>
                  <th className="px-3 py-2 text-left">İşlem</th>
                  <th className="px-3 py-2 text-left">Açıklama</th>
                  <th className="px-3 py-2 text-left">Referans</th>
                  <th className="px-3 py-2 text-left">B2B Kasa / Banka</th>
                  <th className="px-3 py-2 text-right">Giriş</th>
                  <th className="px-3 py-2 text-right">Çıkış</th>
                  <th className="px-3 py-2 text-left">İşlemi Yapan</th>
                </tr>
              </thead>
              <tbody>
                {loading && rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-neutral-400">
                      Yükleniyor...
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-neutral-400">
                      Bu aralıkta kasa hareketi yok.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const isOpen = expandedId === r.id
                    const kids = children[r.id] ?? []
                    return (
                      <React.Fragment key={r.id}>
                        <tr
                          className={`border-t border-ivory-200 ${r.isBulk ? 'cursor-pointer hover:bg-ivory-50' : ''}`}
                          onClick={() => void toggle(r)}
                        >
                          <td className="px-3 py-2 text-neutral-400">
                            {r.isBulk ? (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">{dmy(r.date)}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {r.paymentType ? PAYMENT_LABEL[r.paymentType] ?? 'Ödeme' : 'Ödeme'}
                            {r.isBulk ? (
                              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">
                                TOPLU
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">{r.description ?? r.counterpartyName ?? '-'}</td>
                          <td className="px-3 py-2 font-mono text-[11px] text-neutral-500">{r.referenceNo ?? '-'}</td>
                          <td className="px-3 py-2 text-[11px]">
                            {r.erpAccountName ? (
                              <>
                                <span className="font-semibold text-obsidian-850">{r.erpAccountKind === 2 ? 'Banka' : 'Kasa'}: {r.erpAccountName}</span>
                                {r.erpCurrencyTypeId && r.erpCurrencyTypeId !== 1 && r.erpCurrencyAmount != null ? (
                                  <span className="block text-sky-700">
                                    {money(r.erpCurrencyAmount)} {({2:'EUR',3:'USD',4:'GBP'} as Record<number, string>)[r.erpCurrencyTypeId] ?? ''} · kur {r.erpRate}
                                  </span>
                                ) : null}
                              </>
                            ) : (
                              <span className="text-neutral-400">-</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-emerald-700">
                            {r.direction === 1 ? money(r.amount) : ''}
                          </td>
                          <td className="px-3 py-2 text-right text-rose-700">
                            {r.direction === 2 ? money(r.amount) : ''}
                          </td>
                          <td className="px-3 py-2 text-neutral-500">{r.createUser ?? '-'}</td>
                        </tr>

                        {isOpen ? (
                          <tr className="bg-ivory-50/70">
                            <td />
                            <td colSpan={8} className="px-3 py-2">
                              <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-1">
                                Personel Kırılımı
                              </div>
                              {childBusy && kids.length === 0 ? (
                                <div className="text-neutral-400 text-sm py-2">Yükleniyor...</div>
                              ) : kids.length === 0 ? (
                                <div className="text-neutral-400 text-sm py-2">Kırılım bulunamadı.</div>
                              ) : (
                                <table className="w-full text-sm">
                                  <tbody>
                                    {kids.map((k) => (
                                      <tr key={k.id} className="border-t border-ivory-200">
                                        <td className="px-2 py-1.5">{k.counterpartyName ?? '-'}</td>
                                        <td className="px-2 py-1.5 font-mono text-[11px] text-neutral-500">
                                          {k.referenceNo ?? '-'}
                                        </td>
                                        <td className="px-2 py-1.5 text-right text-rose-700">{money(k.amount)} ₺</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    )
                  })
                )}
              </tbody>
            </table>
            </AyarliTablo>
          </div>
        </div>
      </div>
    </Layout>
  )
}
