import React, { useCallback, useEffect, useState } from 'react'
import { Landmark, RefreshCcw } from 'lucide-react'
import { fetchBankAccountDefinitions, type BankAccountDefinitionDto } from '../api/bankAccountDefinitions'
import { createBankAccountTransaction } from '../api/bankAccountTransactions'

/*
  E-TİCARET HAVALE/EFT ONAYI (2026-09-20).

  Vitrin müşterisi "Havale/EFT" seçince sipariş "Havale istendi" olarak açılıyor, parayı
  gönderince "Gönderdim" diyor. Burada bayi banka ekstresinde parayı görünce:
    1) ERP'de banka hareketi (cari tahsilat) yazılır — mevcut Banka Havale/EFT ucuyla,
       muhasebe kuralı tek yerde kalsın diye;
    2) mağaza API'sine onay gider → ERP'de ödeme "Paid", montaj/kargo tamamlama koşar,
       müşteriye "ödemeniz alındı" SMS'i gider.
  Sıra bilinçli: hareket yazılamazsa onay hiç gitmez; onay giderken hata olursa hareket
  durur, düğme yeniden basılabilir (ERP zaten ödenmişse anlaşılır cevap döner).
*/

const SHOP_API =
  (import.meta as any).env?.VITE_SHOP_API_BASE_URL ||
  (import.meta as any).env?.VITE_SHOP_API_URL ||
  'http://localhost:5150'

type OpenTransfer = {
  orderNo: string
  customerCode: string
  customerName?: string | null
  phone?: string | null
  amount: number
  status: 'BankTransferRequested' | 'BankTransferSent' | string
  note?: string | null
  requestedAtUtc?: string
  orderedAtUtc?: string
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('accessToken')
  const tenant = localStorage.getItem('tenantCode')
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(tenant ? { 'X-Tenant-Code': tenant } : {})
  }
}

const money = (n: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(Number(n) || 0)
const fmtDate = (v?: string) => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('tr-TR')
}

export default function EticaretHavaleOnay() {
  const [rows, setRows] = useState<OpenTransfer[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [banks, setBanks] = useState<BankAccountDefinitionDto[]>([])
  const [confirming, setConfirming] = useState<OpenTransfer | null>(null)
  const [bankId, setBankId] = useState<string>('')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${SHOP_API}/api/admin/bank-transfers`, { headers: authHeaders() })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.message ?? `Havale listesi alınamadı (${res.status})`)
      setRows((json?.data ?? []) as OpenTransfer[])
    } catch (e: any) {
      setError(String(e?.message ?? 'Havale listesi alınamadı.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    void (async () => {
      try {
        const list = await fetchBankAccountDefinitions()
        setBanks((list ?? []).filter((b: any) => b?.isActive !== false))
      } catch {
        setBanks([])
      }
    })()
  }, [load])

  const confirm = async () => {
    if (!confirming) return
    const bank = banks.find((b) => String(b.id) === bankId)
    if (!bank) {
      setError('Paranın geldiği banka hesabını seçin.')
      return
    }
    setBusy(true)
    setError('')
    try {
      // 1) ERP banka hareketi (cari tahsilat)
      await createBankAccountTransaction({
        bankAccountDefinitionId: Number(bank.id),
        date: new Date().toISOString().slice(0, 10),
        direction: 1,
        amount: Number(confirming.amount),
        currencyRate: 1,
        currencyAmount: Number(confirming.amount),
        counterpartyType: 1,
        counterpartyCode: confirming.customerCode,
        counterpartyName: confirming.customerName ?? undefined,
        description: `E-ticaret havale — Sipariş ${confirming.orderNo}${reference ? ` (${reference})` : ''}`,
        posFee: 0
      })
      // 2) Sipariş onayı (Paid + tamamlama + SMS)
      const res = await fetch(`${SHOP_API}/api/admin/bank-transfers/${encodeURIComponent(confirming.orderNo)}/confirm`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ customerCode: confirming.customerCode, reference })
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.message ?? 'Banka hareketi yazıldı ama sipariş onayı gönderilemedi. Tekrar deneyin.')
      setConfirming(null)
      setReference('')
      await load()
    } catch (e: any) {
      setError(String(e?.message ?? 'Onay tamamlanamadı.'))
    } finally {
      setBusy(false)
    }
  }

  const reject = async (row: OpenTransfer) => {
    const reason = window.prompt('Reddetme sebebi (müşteriye SMS ile gider):', 'Havale hesabımıza ulaşmadı.')
    if (reason === null) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${SHOP_API}/api/admin/bank-transfers/${encodeURIComponent(row.orderNo)}/reject`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ customerCode: row.customerCode, reason })
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.message ?? 'Reddedilemedi.')
      await load()
    } catch (e: any) {
      setError(String(e?.message ?? 'Reddedilemedi.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/40 mb-4">
      <div className="px-4 py-3 border-b border-amber-100 flex items-center justify-between gap-3">
        <div className="text-sm font-bold text-gray-900 flex items-center gap-2">
          <Landmark className="w-4 h-4 text-amber-600" /> Havale / EFT bekleyen siparişler
          <span className="text-xs font-semibold text-amber-800 bg-amber-100 rounded-full px-2 py-0.5">{rows.length}</span>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
          <RefreshCcw className="w-3.5 h-3.5" /> Yenile
        </button>
      </div>
      {error && <div className="px-4 py-2 text-sm text-red-700 bg-red-50 border-b border-red-100">{error}</div>}
      {loading && rows.length === 0 ? (
        <div className="px-4 py-4 text-sm text-gray-500">Yükleniyor…</div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-4 text-sm text-gray-500">Bekleyen havale yok.</div>
      ) : (
        <table className="min-w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2 text-left">Sipariş</th>
              <th className="px-4 py-2 text-left">Müşteri</th>
              <th className="px-4 py-2 text-right">Tutar</th>
              <th className="px-4 py-2 text-left">Durum</th>
              <th className="px-4 py-2 text-left">İstendi</th>
              <th className="px-4 py-2 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-100">
            {rows.map((r) => (
              <tr key={r.orderNo} className="bg-white/60">
                <td className="px-4 py-2 font-mono font-semibold text-gray-900">{r.orderNo}</td>
                <td className="px-4 py-2">
                  <div className="font-semibold text-gray-800">{r.customerName || r.customerCode}</div>
                  <div className="text-[11px] text-gray-500">{r.customerCode}{r.phone ? ` · ${r.phone}` : ''}</div>
                </td>
                <td className="px-4 py-2 text-right font-bold tabular-nums">{money(r.amount)}</td>
                <td className="px-4 py-2">
                  {r.status === 'BankTransferSent' ? (
                    <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold bg-emerald-50 text-emerald-700">Gönderdim dedi</span>
                  ) : (
                    <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold bg-gray-100 text-gray-700">Bildirim bekleniyor</span>
                  )}
                  {r.note && <div className="text-[11px] text-gray-500 mt-0.5">{r.note}</div>}
                </td>
                <td className="px-4 py-2 text-xs text-gray-600 whitespace-nowrap">{fmtDate(r.requestedAtUtc)}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <button type="button" disabled={busy} onClick={() => { setConfirming(r); setBankId(''); setReference('') }} className="rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 mr-1.5 disabled:opacity-50">Ödeme alındı</button>
                  <button type="button" disabled={busy} onClick={() => void reject(r)} className="rounded-md border border-red-200 text-red-700 hover:bg-red-50 text-xs font-bold px-3 py-1.5 disabled:opacity-50">Reddet</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {confirming && (
        <div className="px-4 py-3 border-t border-amber-100 bg-white">
          <div className="text-sm font-bold text-gray-900 mb-2">
            {confirming.orderNo} · {money(confirming.amount)} — paranın geldiği hesap
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
            <label className="block">
              <span className="block text-[11px] font-semibold text-gray-600 mb-1">Banka hesabı</span>
              <select className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm bg-white" value={bankId} onChange={(e) => setBankId(e.target.value)}>
                <option value="">Seçiniz…</option>
                {banks.map((b: any) => (
                  <option key={String(b.id)} value={String(b.id)}>{b.bankName ? `${b.bankName} — ` : ''}{b.accountName ?? b.name ?? b.iban ?? b.id}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-gray-600 mb-1">Dekont / referans (isteğe bağlı)</span>
              <input className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" value={reference} onChange={(e) => setReference(e.target.value)} />
            </label>
            <div className="flex gap-2">
              <button type="button" disabled={busy || !bankId} onClick={() => void confirm()} className="rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2 disabled:opacity-50">
                {busy ? 'Kaydediliyor…' : 'Onayla ve tahsilatı yaz'}
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirming(null)} className="rounded-md border border-gray-200 text-gray-700 text-xs font-semibold px-4 py-2">Vazgeç</button>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-gray-500">Önce ERP'de banka hareketi (cari tahsilatı) yazılır, sonra sipariş onaylanıp müşteriye SMS gider.</div>
        </div>
      )}
    </div>
  )
}
