import React, { useEffect, useMemo, useState } from 'react'
import { HandCoins, Users, History } from 'lucide-react'
import Layout from '../components/Layout'
import Modal from '../components/Modal'
import PaymentReportView, { money } from '../components/PaymentReportView'
import PaymentTypeRoster, { type RosterColumn } from '../components/PaymentTypeRoster'
import { createEmployeePayment, PAYMENT_TYPE, type TypeStatusEmployeeDto, type ErpPaymentSource } from '../api/employeePayments'
import { bulkCashPayout } from '../api/employeeLedger'
import ErpSourcePicker, { erpSourceError } from '../components/ErpSourcePicker'
import { fetchEmployees, type EmployeeDto } from '../api/employees'
import { printPaymentForm } from '../utils/printPaymentForm'
import AyarliTablo from '../components/table/AyarliTablo'

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function PaymentsAdvancePage() {
  const [activeTab, setActiveTab] = useState<'roster' | 'history'>('roster')
  const [open, setOpen] = useState(false)
  const [employees, setEmployees] = useState<EmployeeDto[]>([])
  const [employeeId, setEmployeeId] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayIso)
  const [deductFromSalary, setDeductFromSalary] = useState(true)
  const [description, setDescription] = useState('')
  // Avans elden veriliyor; imzalanacak belge tanimlama aninda basilir.
  const [printForm, setPrintForm] = useState(true)

  const currentUser = (() => {
    try { return String(localStorage.getItem('username') ?? '') || null } catch { return null }
  })()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  // Toplu avans: seçilen herkese aynı tutar verilir, tek tek girmeye gerek kalmasın.
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkRows, setBulkRows] = useState<TypeStatusEmployeeDto[]>([])
  const [bulkPeriod, setBulkPeriod] = useState('')
  const [bulkAmount, setBulkAmount] = useState('')
  const [bulkDeduct, setBulkDeduct] = useState(true)
  const [bulkDesc, setBulkDesc] = useState('Avans')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkPrint, setBulkPrint] = useState(true)
  const [bulkError, setBulkError] = useState<string | null>(null)
  // Ödemenin çıkacağı B2B kasa/bankası (tekil ve toplu pencerede ortak; son seçim hatırlanır).
  const [erpSource, setErpSource] = useState<ErpPaymentSource | null>(null)

  useEffect(() => {
    if (!open) return
    const ac = new AbortController()
    void fetchEmployees({ signal: ac.signal })
      .then((list) => setEmployees(list ?? []))
      .catch(() => setEmployees([]))
    return () => ac.abort()
  }, [open])

  const sortedEmployees = useMemo(
    () =>
      [...employees].sort((a, b) =>
        `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, 'tr-TR')
      ),
    [employees]
  )

  const advanceColumns: RosterColumn[] = [
    {
      key: 'periodTotal',
      label: 'Dönem Avansı',
      align: 'right',
      render: (r) => <span className="font-medium">{money(r.periodTotal)} ₺</span>
    },
    {
      key: 'deductibleTotal',
      label: 'Maaştan Düşülecek',
      align: 'right',
      render: (r) => <span className="text-amber-800">{money(r.deductibleTotal)} ₺</span>
    },
    {
      key: 'deductedTotal',
      label: 'Mahsup Edilen',
      align: 'right',
      render: (r) => <span className="text-emerald-700">{money(r.deductedTotal)} ₺</span>
    },
    {
      key: 'pendingDeductionTotal',
      label: 'Mahsup Bekleyen',
      align: 'right',
      render: (r) =>
        r.pendingDeductionTotal > 0 ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-900">
            {money(r.pendingDeductionTotal)} ₺
          </span>
        ) : (
          <span className="text-neutral-400">—</span>
        )
    }
  ]

  const submitBulk = async () => {
    const value = Number(String(bulkAmount).replace(',', '.'))
    if (!(value > 0)) {
      setBulkError('Tutar sıfırdan büyük olmalı.')
      return
    }
    const erpHataToplu = erpSourceError(erpSource)
    if (erpHataToplu) {
      setBulkError(erpHataToplu)
      return
    }

    setBulkBusy(true)
    setBulkError(null)
    try {
      // TOPLU ÇIKIŞ (2026-09-27): her personele yine AYRI ödeme kaydı açılır (cari ekstrede ve
      // kasada kişi kırılımı durur), ama kasaya ve B2B kasa/bankasına TEK toplam satır yazılır.
      // Eskiden kişi başı ayrı ödeme gönderiliyordu; B2B'ye kişi sayısı kadar satır düşerdi.
      await bulkCashPayout({
        employeeIds: bulkRows.map((r) => r.employeeId),
        paymentType: PAYMENT_TYPE.advance,
        salaryPeriod: bulkPeriod || undefined,
        customAmount: value,
        description: bulkDesc.trim() || 'Avans',
        paymentDate: `${todayIso()}T00:00:00Z`,
        deductFromSalary: bulkDeduct,
        erpSource
      })
      if (bulkPrint) {
        // Her personel icin AYRI belge: imza tek tek alinir.
        bulkRows.forEach((row) => {
          printPaymentForm({
            kind: 'advance',
            employeeName: row.employeeName,
            employeeCode: row.employeeCode ?? null,
            workplace: row.workplace ?? null,
            amount: value,
            date: todayIso(),
            period: bulkPeriod || undefined,
            description: bulkDesc.trim(),
            deductFromSalary: bulkDeduct,
            preparedBy: currentUser
          })
        })
      }

      setBulkOpen(false)
      setBulkAmount('')
      setReloadKey((k) => k + 1)
    } catch (e: any) {
      setBulkError(String(e?.message ?? 'Toplu avans kaydedilemedi'))
    } finally {
      setBulkBusy(false)
    }
  }

  const submit = async () => {
    const id = Number(employeeId)
    const value = Number(String(amount).replace(',', '.'))

    if (!id) {
      setError('Çalışan seçin.')
      return
    }
    if (!(value > 0)) {
      setError('Tutar sıfırdan büyük olmalı.')
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
      const reason = description.trim()
      if (!reason) {
        setError('Avans nedeni yazılmalı — belgeye basılıyor.')
        setBusy(false)
        return
      }

      await createEmployeePayment({
        employeeId: id,
        type: PAYMENT_TYPE.advance,
        amount: value,
        paymentDate: `${date}T00:00:00Z`,
        deductFromSalary,
        description: reason,
        erpSource
      })

      if (printForm) {
        const emp = employees.find((e) => e.id === id)
        printPaymentForm({
          kind: 'advance',
          employeeName: emp ? `${emp.firstName} ${emp.lastName}`.trim() : 'Çalışan',
          employeeCode: emp?.employeeCode ?? null,
          workplace: emp?.workplace ?? null,
          amount: value,
          date,
          period: date.slice(0, 7),
          description: reason,
          deductFromSalary,
          preparedBy: currentUser
        })
      }

      setOpen(false)
      setEmployeeId('')
      setAmount('')
      setReloadKey((k) => k + 1)
    } catch (e: any) {
      setError(String(e?.message ?? 'Avans kaydedilemedi'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Layout>
      {/* Üst Sekme Seçici */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6 border-b border-ivory-300 pb-4">
        <div>
          <h1 className="font-serif text-2xl md:text-3xl text-obsidian-850 font-normal tracking-tight flex items-center gap-2.5">
            <HandCoins className="text-bronze-700" size={26} />
            Avans Yönetimi
          </h1>
          <p className="text-xs text-neutral-500 mt-1">
            Personel dönemsel avans dökümü, mahsup durumları ve avans hareket geçmişi.
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
            <span>Dönem Avans Listesi</span>
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
            <span>Avans Verme & Hareket Geçmişi</span>
          </button>
        </div>
      </div>

      {/* Seçili Sekme İçeriği */}
      {activeTab === 'roster' ? (
        <PaymentTypeRoster
          type={PAYMENT_TYPE.advance}
          reloadKey={reloadKey}
          bulkLabel="Seçilenlere Avans Ver"
          emptyHint="Bu dönemde avans hareketi olan personel yok."
          onBulkAction={async (rows, period) => {
            setBulkRows(rows)
            setBulkPeriod(period)
            setBulkOpen(true)
          }}
          columns={advanceColumns}
        />
      ) : (
        <PaymentReportView
          type={PAYMENT_TYPE.advance}
          title="Avanslar"
          subtitle="Kime, ne zaman, ne kadar avans verildiğinin dökümü."
          helpText="Avans tek tek verilir. 'Maaştan kesilecek' işaretliyse, avansın ait olduğu dönemin maaşı ödenirken tutar otomatik düşülür ve avans 'mahsup edildi' olarak işaretlenir. Mahsup edilmiş bir avans silinemez. Her ödeme seçilen B2B kasa/bankasından çıkar: B2B'ye 'Personel Ödemesi' olarak tek satır yazılır (toplu ödemede toplam, personel adı yazılmaz); kişi kırılımı Kasa Hareketleri ekranında görünür."
          reloadKey={reloadKey}
          extraColumns="advance"
          action={
            <button type="button" onClick={() => setOpen(true)} className="btn-primary">
              <HandCoins size={13} />
              Avans Ver
            </button>
          }
        />
      )}

      <Modal isOpen={open} onClose={() => setOpen(false)} title="Avans Ver">
        <div className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="adv-emp" className="block text-[11px] uppercase tracking-wider text-neutral-400">
              Çalışan
            </label>
            <select
              id="adv-emp"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="input-base"
            >
              <option value="">Seçiniz...</option>
              {sortedEmployees.map((e) => (
                <option key={e.id} value={String(e.id)}>
                  {e.firstName} {e.lastName} — {e.employeeCode}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="adv-amount" className="block text-[11px] uppercase tracking-wider text-neutral-400">
                Tutar (₺)
              </label>
              <input
                id="adv-amount"
                value={amount}
                inputMode="decimal"
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
                className="input-base"
                placeholder="0"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="adv-date" className="block text-[11px] uppercase tracking-wider text-neutral-400">
                Tarih
              </label>
              <input
                id="adv-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="input-base"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="adv-desc" className="block text-[11px] uppercase tracking-wider text-neutral-400">
              Avans Nedeni (belgeye basılır)
            </label>
            <input
              id="adv-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input-base"
              placeholder="Örn. acil ihtiyaç talebi"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={deductFromSalary}
              onChange={(e) => setDeductFromSalary(e.target.checked)}
            />
            Maaştan kesilsin (avans mahsubu)
          </label>

          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={printForm} onChange={(e) => setPrintForm(e.target.checked)} />
            İmzalanacak avans belgesini yazdır
          </label>

          <ErpSourcePicker value={erpSource} onChange={setErpSource} amountTry={Number(String(amount).replace(',', '.')) || 0} />
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3 text-sm text-rose-800">{error}</div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-ivory-300">
            <button type="button" onClick={() => setOpen(false)} className="btn-editorial" disabled={busy}>
              Vazgeç
            </button>
            <button type="button" onClick={() => void submit()} className="btn-primary" disabled={busy}>
              {busy ? 'Kaydediliyor...' : 'Avansı Kaydet'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={bulkOpen} onClose={() => setBulkOpen(false)} title="Seçilenlere Toplu Avans">
        <div className="space-y-4">
          <div className="rounded-lg border border-ivory-300 bg-ivory-50 p-3 text-sm text-neutral-700">
            <strong>{bulkRows.length}</strong> personele <strong>{bulkPeriod || 'seçili dönem'}</strong> için
            kişi başı aynı tutarda avans yazılacak. Her personel için ayrı kayıt oluşur; cari ekstrede ve
            kasada tek tek görünür.
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="badv-amount" className="block text-[11px] uppercase tracking-wider text-neutral-400">
                Kişi Başı Tutar (₺)
              </label>
              <input
                id="badv-amount"
                value={bulkAmount}
                inputMode="decimal"
                onChange={(e) => setBulkAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
                className="input-base"
                placeholder="0"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="badv-desc" className="block text-[11px] uppercase tracking-wider text-neutral-400">
                Açıklama
              </label>
              <input
                id="badv-desc"
                value={bulkDesc}
                onChange={(e) => setBulkDesc(e.target.value)}
                className="input-base"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={bulkDeduct} onChange={(e) => setBulkDeduct(e.target.checked)} />
            Maaştan kesilsin (avans mahsubu)
          </label>

          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={bulkPrint} onChange={(e) => setBulkPrint(e.target.checked)} />
            Her personel için imzalanacak belge yazdır
          </label>

          <div className="max-h-40 overflow-y-auto rounded-lg border border-ivory-300">
            <AyarliTablo>
            <table className="w-full text-sm">
              <tbody>
                {bulkRows.map((r) => (
                  <tr key={r.employeeId} className="border-b border-ivory-200 last:border-0">
                    <td className="px-3 py-1.5">{r.employeeName}</td>
                    <td className="px-3 py-1.5 text-right text-neutral-500">
                      {money(Number(String(bulkAmount).replace(',', '.')) || 0)} ₺
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </AyarliTablo>
          </div>

          <ErpSourcePicker
            value={erpSource}
            onChange={setErpSource}
            amountTry={(Number(String(bulkAmount).replace(',', '.')) || 0) * bulkRows.length}
          />
          {bulkError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3 text-sm text-rose-800">{bulkError}</div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-ivory-300">
            <button type="button" onClick={() => setBulkOpen(false)} className="btn-editorial" disabled={bulkBusy}>
              Vazgeç
            </button>
            <button type="button" onClick={() => void submitBulk()} className="btn-primary" disabled={bulkBusy}>
              {bulkBusy ? 'Kaydediliyor...' : `${bulkRows.length} Personele Avans Ver`}
            </button>
          </div>
        </div>
      </Modal>
    </Layout>
  )
}
