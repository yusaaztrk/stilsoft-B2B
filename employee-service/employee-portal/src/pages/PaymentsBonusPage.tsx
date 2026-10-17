import React, { useEffect, useState } from 'react'
import { Gift, Users, History } from 'lucide-react'
import Layout from '../components/Layout'
import Modal from '../components/Modal'
import EmployeePicker from '../components/EmployeePicker'
import PaymentReportView, { money } from '../components/PaymentReportView'
import PaymentTypeRoster, { type RosterColumn } from '../components/PaymentTypeRoster'
import { PAYMENT_TYPE } from '../api/employeePayments'
import { createEmployeeBonusPlan } from '../api/employeeBonusPlans'
import ErpSourcePicker, { erpSourceError } from '../components/ErpSourcePicker'
import type { ErpPaymentSource } from '../api/employeePayments'
import { printPaymentForm } from '../utils/printPaymentForm'
import { bulkPayPlannedBonusPlans } from '../api/employeeBonusPlans'
import { fetchEmployees, type EmployeeDto } from '../api/employees'

export default function PaymentsBonusPage() {
  const [activeTab, setActiveTab] = useState<'roster' | 'history'>('roster')
  const [open, setOpen] = useState(false)
  const [employees, setEmployees] = useState<EmployeeDto[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [description, setDescription] = useState('Prim Ödemesi')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  // Ödemenin çıkacağı B2B kasa/bankası (son seçim hatırlanır).
  const [erpSource, setErpSource] = useState<ErpPaymentSource | null>(null)
  // Listeden açıldığında seçilenlerin bekleyen prim toplamı (döviz önizlemesi için).
  const [rosterTotal, setRosterTotal] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)

  // PRİM TANIMLAMA: bu ekranda hiç yoktu, plan yalnızca Çalışan Yönetimi içine gömülüydü.
  // Prim sayfasındaki "Prim Yatır" yalnızca mevcut planları ödediği için, planı olmayan
  // firmada hiçbir şey olmuyor ve "prim tanımlama çalışmıyor" görünüyordu.
  const [defineOpen, setDefineOpen] = useState(false)
  const [defEmployeeId, setDefEmployeeId] = useState('')
  const [defAmount, setDefAmount] = useState('')
  const [defDate, setDefDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [defReason, setDefReason] = useState('')
  const [defBusy, setDefBusy] = useState(false)
  const [defError, setDefError] = useState<string | null>(null)
  const [defPrint, setDefPrint] = useState(true)

  const currentUser = (() => {
    try { return String(localStorage.getItem('username') ?? '') || null } catch { return null }
  })()

  useEffect(() => {
    // Liste hem ödeme hem TANIMLAMA modalinda gerekli; yalnizca `open`'a bagliyken
    // tanimlama modali bos calisan listesiyle aciliyordu.
    if (!open && !defineOpen) return
    const ac = new AbortController()
    void fetchEmployees({ signal: ac.signal })
      .then((list) => setEmployees(list ?? []))
      .catch(() => setEmployees([]))
    return () => ac.abort()
  }, [open, defineOpen])

  const submit = async () => {
    if (selected.size === 0) {
      setError('En az bir çalışan seçin.')
      return
    }
    const erpHata = erpSourceError(erpSource)
    if (erpHata) {
      setError(erpHata)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const paidCount = await bulkPayPlannedBonusPlans({
        employeeIds: Array.from(selected),
        description: description.trim() || 'Prim Ödemesi',
        erpSource
      })
      setOpen(false)
      setSelected(new Set())
      setInfo(
        paidCount > 0
          ? `${paidCount} prim planı ödendi.`
          : 'Seçilen çalışanlarda ödenmeyi bekleyen prim planı bulunamadı.'
      )
      setReloadKey((k) => k + 1)
    } catch (e: any) {
      setError(String(e?.message ?? 'Prim ödemesi yapılamadı'))
    } finally {
      setBusy(false)
    }
  }

  const submitDefine = async () => {
    const id = Number(defEmployeeId)
    const value = Number(String(defAmount).replace(',', '.'))

    if (!id) { setDefError('Çalışan seçin.'); return }
    if (!(value > 0)) { setDefError('Tutar sıfırdan büyük olmalı.'); return }
    if (!defReason.trim()) { setDefError('Prim nedeni yazılmalı — belgeye basılıyor.'); return }

    setDefBusy(true)
    setDefError(null)
    try {
      await createEmployeeBonusPlan({
        employeeId: id,
        plannedDate: `${defDate}T00:00:00Z`,
        amount: value,
        description: defReason.trim()
      })

      const emp = employees.find((e) => e.id === id)
      const empName = emp ? `${emp.firstName} ${emp.lastName}`.trim() : 'Çalışan'

      if (defPrint) {
        printPaymentForm({
          kind: 'bonus',
          employeeName: empName,
          employeeCode: emp?.employeeCode ?? null,
          workplace: emp?.workplace ?? null,
          amount: value,
          date: defDate,
          period: defDate.slice(0, 7),
          description: defReason.trim(),
          preparedBy: currentUser
        })
      }

      setDefineOpen(false)
      setDefAmount('')
      setDefReason('')
      setInfo(`${empName} için ${value.toLocaleString('tr-TR')} ₺ prim tanımlandı.`)
      setReloadKey((k) => k + 1)
    } catch (e: any) {
      setDefError(String(e?.message ?? 'Prim tanımlanamadı'))
    } finally {
      setDefBusy(false)
    }
  }

  const bonusColumns: RosterColumn[] = [
    {
      key: 'pendingPlanTotal',
      label: 'Bekleyen Prim',
      align: 'right',
      render: (r) =>
        r.pendingPlanTotal > 0 ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-900">
            {money(r.pendingPlanTotal)} ₺
          </span>
        ) : (
          <span className="text-neutral-400">—</span>
        )
    },
    {
      key: 'periodTotal',
      label: 'Dönemde Ödenen',
      align: 'right',
      render: (r) => <span className="text-emerald-700">{money(r.periodTotal)} ₺</span>
    },
    {
      key: 'status',
      label: 'Durum',
      render: (r) =>
        r.pendingPlanTotal > 0 ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800 border border-amber-200">
            Bekliyor
          </span>
        ) : r.periodTotal > 0 ? (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800 border border-emerald-200">
            Ödendi
          </span>
        ) : (
          <span className="text-neutral-400">—</span>
        )
    }
  ]

  // Roster'dan toplu odeme: bekleyen PLANLARI oder. Plani olmayan personel atlanir -
  // plansiz prim yazmak, cari ekstrede karsiligi olmayan bir borc dogururdu.
  const payFromRoster = async (rows: { employeeId: number; pendingPlanTotal: number }[]) => {
    const targets = rows.filter((r) => r.pendingPlanTotal > 0).map((r) => r.employeeId)
    if (targets.length === 0) {
      setInfo('Seçilen personelde ödenmeyi bekleyen prim planı yok.')
      return
    }

    // Doğrudan ödemek yerine ödeme penceresi açılır: kasa/banka orada seçilir (2026-09-27).
    setSelected(new Set(targets))
    setRosterTotal(rows.filter((r) => r.pendingPlanTotal > 0).reduce((t, r) => t + r.pendingPlanTotal, 0))
    setError(null)
    setOpen(true)
  }

  return (
    <Layout>
      {/* Üst Sekme Seçici */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6 border-b border-ivory-300 pb-4">
        <div>
          <h1 className="font-serif text-2xl md:text-3xl text-obsidian-850 font-normal tracking-tight flex items-center gap-2.5">
            <Gift className="text-bronze-700" size={26} />
            Prim Yönetimi
          </h1>
          <p className="text-xs text-neutral-500 mt-1">
            Personel dönemsel prim dökümü, planlanan primler ve ödeme geçmişi.
          </p>
        </div>

        <div className="inline-flex p-1 bg-ivory-200/80 rounded-xl border border-ivory-300 shadow-inner">
          <button
            type="button"
            onClick={() => setActiveTab('roster')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition shadow-sm ${
              activeTab === 'roster'
                ? 'bg-white text-obsidian-850 shadow'
                : 'text-neutral-600 hover:text-obsidian-850 hover:bg-white/50 shadow-none'
            }`}
          >
            <Users size={14} className={activeTab === 'roster' ? 'text-bronze-700' : 'text-neutral-400'} />
            <span>Dönem Prim Listesi</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition shadow-sm ${
              activeTab === 'history'
                ? 'bg-white text-obsidian-850 shadow'
                : 'text-neutral-600 hover:text-obsidian-850 hover:bg-white/50 shadow-none'
            }`}
          >
            <History size={14} className={activeTab === 'history' ? 'text-bronze-700' : 'text-neutral-400'} />
            <span>Prim Verme & Hareket Geçmişi</span>
          </button>
        </div>
      </div>

      {info && (
        <div className="card shadow-card p-4 border-l-4 border-l-emerald-500 mb-4 flex items-center justify-between gap-4">
          <span className="text-sm text-neutral-700">{info}</span>
          <button type="button" onClick={() => setInfo(null)} className="btn-editorial">
            Kapat
          </button>
        </div>
      )}

      {activeTab === 'roster' ? (
        <PaymentTypeRoster
          type={PAYMENT_TYPE.bonus}
          reloadKey={reloadKey}
          bulkLabel="Seçilenlerin Bekleyen Primini Öde"
          emptyHint="Bu dönemde prim hareketi olan personel yok."
          onBulkAction={async (rows) => {
            await payFromRoster(rows)
          }}
          columns={bonusColumns}
        />
      ) : (
        <PaymentReportView
          type={PAYMENT_TYPE.bonus}
          title="Prim Ödemeleri"
          subtitle="Kime, ne zaman, ne kadar prim ödendiğinin dökümü."
          helpText="Önce 'Prim Tanımla' ile prim yazılır (cari ekstreye alacak düşer), sonra 'Prim Yatır' ile ödenir. Tanımlama sırasında imzalanacak belge de yazdırılabilir. Her ödeme seçilen B2B kasa/bankasından çıkar: B2B'ye 'Personel Ödemesi' olarak tek satır yazılır (toplu ödemede toplam, personel adı yazılmaz); kişi kırılımı Kasa Hareketleri ekranında görünür."
          reloadKey={reloadKey}
          action={
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setDefineOpen(true)} className="btn-editorial">
                <Gift size={13} />
                Prim Tanımla
              </button>
              <button type="button" onClick={() => setOpen(true)} className="btn-primary">
                <Gift size={13} />
                Prim Yatır
              </button>
            </div>
          }
        />
      )}

      <Modal isOpen={defineOpen} onClose={() => setDefineOpen(false)} title="Prim Tanımla">
        <div className="space-y-4">
          <div className="rounded-lg border border-ivory-300 bg-ivory-50 p-3 text-[13px] text-neutral-700">
            Tanımlanan prim cari ekstreye <strong>alacak</strong> olarak düşer. Para çıkışı yapmaz —
            ödeme "Prim Yatır" ile ayrıca yapılır.
          </div>

          <div className="space-y-1">
            <label htmlFor="def-emp" className="block text-[11px] uppercase tracking-wider text-neutral-400">
              Çalışan
            </label>
            <select id="def-emp" value={defEmployeeId} onChange={(e) => setDefEmployeeId(e.target.value)} className="input-base">
              <option value="">Seçiniz...</option>
              {[...employees]
                .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, 'tr-TR'))
                .map((e) => (
                  <option key={e.id} value={String(e.id)}>
                    {e.firstName} {e.lastName} — {e.employeeCode}
                  </option>
                ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="def-amount" className="block text-[11px] uppercase tracking-wider text-neutral-400">
                Tutar (₺)
              </label>
              <input
                id="def-amount"
                value={defAmount}
                inputMode="decimal"
                onChange={(e) => setDefAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
                className="input-base"
                placeholder="0"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="def-date" className="block text-[11px] uppercase tracking-wider text-neutral-400">
                Tarih
              </label>
              <input id="def-date" type="date" value={defDate} onChange={(e) => setDefDate(e.target.value)} className="input-base" />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="def-reason" className="block text-[11px] uppercase tracking-wider text-neutral-400">
              Prim Nedeni (belgeye basılır)
            </label>
            <input
              id="def-reason"
              value={defReason}
              onChange={(e) => setDefReason(e.target.value)}
              className="input-base"
              placeholder="Örn. Ağustos satış hedefi primi"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={defPrint} onChange={(e) => setDefPrint(e.target.checked)} />
            İmzalanacak prim belgesini yazdır
          </label>

          {defError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3 text-sm text-rose-800">{defError}</div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-ivory-300">
            <button type="button" onClick={() => setDefineOpen(false)} className="btn-editorial" disabled={defBusy}>
              Vazgeç
            </button>
            <button type="button" onClick={() => void submitDefine()} className="btn-primary" disabled={defBusy}>
              {defBusy ? 'Kaydediliyor...' : 'Primi Tanımla'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={open} onClose={() => setOpen(false)} title="Bekleyen Primleri Öde">
        <div className="space-y-4">
          <p className="text-[13px] text-neutral-600">
            Seçilen çalışanların <strong>ödenmeyi bekleyen</strong> prim planları ödenir. Planı olmayan çalışan
            atlanır.
          </p>

          <div className="space-y-1">
            <label htmlFor="bonus-desc" className="block text-[11px] uppercase tracking-wider text-neutral-400">
              Açıklama
            </label>
            <input
              id="bonus-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input-base"
            />
          </div>

          <EmployeePicker employees={employees} selected={selected} onChange={(v) => { setSelected(v); setRosterTotal(0) }} />

          <ErpSourcePicker value={erpSource} onChange={setErpSource} amountTry={rosterTotal} />

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3 text-sm text-rose-800">{error}</div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-ivory-300">
            <button type="button" onClick={() => setOpen(false)} className="btn-editorial" disabled={busy}>
              Vazgeç
            </button>
            <button type="button" onClick={() => void submit()} className="btn-primary" disabled={busy}>
              {busy ? 'Kaydediliyor...' : `${selected.size} çalışan için öde`}
            </button>
          </div>
        </div>
      </Modal>
    </Layout>
  )
}
