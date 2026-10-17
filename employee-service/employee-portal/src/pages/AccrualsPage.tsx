import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, RefreshCw, Wallet } from 'lucide-react'
import Layout from '../components/Layout'
import Modal from '../components/Modal'
import NotificationPopup, { type NotificationVariant } from '../components/NotificationPopup'
import {
  fetchAccrualDetail,
  fetchAccruals,
  formatMinutes,
  type AccrualDto,
  type AccrualSummaryDto
} from '../api/employeeAccruals'
import AyarliTablo from '../components/table/AyarliTablo'

function currentPeriod(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function money(value: number): string {
  return `₺${(Number(value) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function AccrualsPage() {
  const [period, setPeriod] = useState(currentPeriod)
  const [rows, setRows] = useState<AccrualDto[]>([])
  const [summary, setSummary] = useState<AccrualSummaryDto | null>(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [popup, setPopup] = useState<{ variant: NotificationVariant; title: string; message: string } | null>(null)

  const [detail, setDetail] = useState<AccrualDto | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchAccruals(period)
      setRows(res.data)
      setSummary(res.summary)
    } catch (e: any) {
      setPopup({ variant: 'error', title: 'Hata', message: String(e?.message ?? 'Hakedişler alınamadı') })
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR')
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.employeeName.toLocaleLowerCase('tr-TR').includes(q) ||
        String(r.employeeCode ?? '').toLocaleLowerCase('tr-TR').includes(q)
    )
  }, [rows, search])

  const openDetail = async (employeeId: number) => {
    setDetailLoading(true)
    try {
      const data = await fetchAccrualDetail(employeeId, period)
      setDetail(data)
    } catch (e: any) {
      setPopup({ variant: 'error', title: 'Hata', message: String(e?.message ?? 'Puantaj dökümü alınamadı') })
    } finally {
      setDetailLoading(false)
    }
  }

  const attentionRows = useMemo(
    () => rows.filter((r) => r.absentDays > 0 || r.openCheckInCount > 0 || r.annualLeaveRemainingDays < 0),
    [rows]
  )

  return (
    <Layout>
      <div className="space-y-6 pb-12">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pt-2">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-[10px] tracking-[0.22em] text-bronze-700 font-semibold uppercase">
              <span>DÖNEM</span>
              <span className="text-bronze-300">•</span>
              <span>{period}</span>
            </div>
            <h1 className="font-serif text-3xl md:text-4xl text-obsidian-850 font-normal tracking-tight">
              Hakedişler & Puantaj
            </h1>
            <p className="text-xs text-neutral-500 max-w-2xl">
              Mesai kayıtları, iş günü takvimi, izinler ve avanslar birleştirilerek dönem hakedişi hesaplanır.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value || currentPeriod())}
              className="input-base w-40"
              aria-label="Hakediş dönemi"
            />
            <button type="button" onClick={() => void load()} className="btn-editorial">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              <span>Yenile</span>
            </button>
          </div>
        </div>

        {/* Özet kartları */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="card shadow-card p-5">
            <div className="text-[10px] text-neutral-400 font-medium tracking-[0.2em] uppercase">BRÜT HAKEDİŞ</div>
            <div className="font-serif text-2xl md:text-3xl text-obsidian-850 my-1.5">{money(summary?.totalGross ?? 0)}</div>
            <div className="text-[11px] text-neutral-500">{summary?.employeeCount ?? 0} personel</div>
          </div>

          <div className="card shadow-card p-5">
            <div className="text-[10px] text-neutral-400 font-medium tracking-[0.2em] uppercase">MAHSUP AVANS</div>
            <div className="font-serif text-2xl md:text-3xl text-obsidian-850 my-1.5">{money(summary?.totalAdvances ?? 0)}</div>
            <div className="text-[11px] text-neutral-500">maaştan düşülecek</div>
          </div>

          <div className="card shadow-card p-5">
            <div className="text-[10px] text-neutral-400 font-medium tracking-[0.2em] uppercase">ÖDENECEK NET</div>
            <div className="font-serif text-2xl md:text-3xl text-obsidian-850 my-1.5">{money(summary?.totalNetPayable ?? 0)}</div>
            <div className="text-[11px] text-neutral-500">ödenmişler düşüldü</div>
          </div>

          <div className="card shadow-card p-5">
            <div className="text-[10px] text-neutral-400 font-medium tracking-[0.2em] uppercase">FAZLA MESAİ</div>
            <div className="font-serif text-2xl md:text-3xl text-obsidian-850 my-1.5">
              {Math.round((summary?.totalOvertimeMinutes ?? 0) / 60)}
              <span className="text-base text-neutral-400 ml-1">saat</span>
            </div>
            <div className="text-[11px] text-neutral-500">
              {(summary?.totalAbsentDays ?? 0).toLocaleString('tr-TR')} gün devamsızlık
            </div>
          </div>
        </div>

        {attentionRows.length > 0 && (
          <div className="card shadow-card p-4 border-amber-200 bg-amber-50/50">
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={15} className="text-amber-600 mt-0.5 shrink-0" />
              <div className="text-xs text-amber-900">
                <strong>{attentionRows.length} personelde dikkat gerektiren durum var:</strong>{' '}
                {attentionRows
                  .slice(0, 6)
                  .map((r) => r.employeeName)
                  .join(', ')}
                {attentionRows.length > 6 ? ` ve ${attentionRows.length - 6} kişi daha` : ''}. Devamsızlık,
                kapatılmamış mesai kaydı veya izin bakiyesi aşımı olabilir.
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            className="input-base max-w-xs"
            placeholder="Personel ara…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Personel ara"
          />
          <span className="text-[11px] text-neutral-400">{filtered.length} kayıt</span>
        </div>

        <div className="overflow-x-auto card shadow-card">
          <AyarliTablo>
          <table className="w-full text-xs min-w-[1080px]">
            <thead>
              <tr className="border-b border-ivory-300 text-left text-[10px] uppercase tracking-wider text-neutral-400">
                <th className="px-4 py-3 font-medium">Personel</th>
                <th className="px-3 py-3 font-medium text-center">İş günü</th>
                <th className="px-3 py-3 font-medium text-center">Gelen</th>
                <th className="px-3 py-3 font-medium text-center">İzin</th>
                <th className="px-3 py-3 font-medium text-center">Devamsız</th>
                <th className="px-3 py-3 font-medium text-center">Geç</th>
                <th className="px-3 py-3 font-medium text-right">Fazla mesai</th>
                <th className="px-3 py-3 font-medium text-right">Brüt</th>
                <th className="px-3 py-3 font-medium text-right">Avans</th>
                <th className="px-3 py-3 font-medium text-right">Ödenecek</th>
                <th className="px-3 py-3 font-medium text-center">Yıllık izin</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-neutral-400">Hesaplanıyor…</td>
                </tr>
              )}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-neutral-400">Kayıt yok.</td>
                </tr>
              )}

              {!loading &&
                filtered.map((r) => (
                  <tr key={r.employeeId} className="border-b border-ivory-200 hover:bg-ivory-100/60">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => void openDetail(r.employeeId)}
                        className="font-medium text-obsidian-850 hover:text-bronze-700 text-left"
                      >
                        {r.employeeName}
                      </button>
                      <div className="text-[10px] text-neutral-400">{r.employeeCode} · {r.scheduleName}</div>
                    </td>
                    <td className="px-3 py-3 text-center text-neutral-600">{r.expectedWorkDays}</td>
                    <td className="px-3 py-3 text-center text-neutral-600">{r.attendedDays}</td>
                    <td className="px-3 py-3 text-center text-neutral-600">
                      {r.paidLeaveDays > 0 || r.unpaidLeaveDays > 0
                        ? `${r.paidLeaveDays}${r.unpaidLeaveDays > 0 ? ` +${r.unpaidLeaveDays} üz.` : ''}`
                        : '—'}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {r.absentDays > 0 ? <span className="badge-rose">{r.absentDays}</span> : <span className="text-neutral-400">—</span>}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {r.lateDays > 0 ? <span className="badge-amber">{r.lateDays}</span> : <span className="text-neutral-400">—</span>}
                    </td>
                    <td className="px-3 py-3 text-right text-neutral-600">
                      {r.overtimeMinutes > 0 ? formatMinutes(r.overtimeMinutes) : '—'}
                    </td>
                    <td className="px-3 py-3 text-right font-medium text-obsidian-850">{money(r.grossAccrual)}</td>
                    <td className="px-3 py-3 text-right text-neutral-600">
                      {r.deductibleAdvances > 0 ? `-${money(r.deductibleAdvances)}` : '—'}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-obsidian-850">{money(r.netPayable)}</td>
                    <td className="px-3 py-3 text-center">
                      <span className={r.annualLeaveRemainingDays < 0 ? 'text-rose-600 font-medium' : 'text-neutral-600'}>
                        {r.annualLeaveRemainingDays} / {r.annualLeaveEntitlementDays}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          </AyarliTablo>
        </div>

        <p className="text-[11px] text-neutral-400 max-w-3xl">
          Günlük ücret, dönemin iş günü sayısına bölünerek bulunur. Devamsızlık ve ücretsiz izin bu tutar
          üzerinden kesilir; fazla mesai saat ücreti mesai tanımındaki çarpanla hesaplanır. Yemek hakedişi
          fiilen işe gelinen gün sayısıyla çarpılır.
        </p>
      </div>

      {/* Gün gün döküm */}
      <Modal
        isOpen={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.employeeName} · ${detail.period} puantajı` : 'Puantaj'}
      >
        {detailLoading && <div className="text-xs text-neutral-500 py-6 text-center">Yükleniyor…</div>}

        {detail && !detailLoading && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Aylık maaş', value: money(detail.monthlySalary) },
                { label: 'Günlük ücret', value: money(detail.dailyWage) },
                { label: 'Saatlik ücret', value: money(detail.hourlyWage) },
                { label: 'Kıdem', value: `${detail.seniorityYears} yıl` }
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-ivory-300 p-3">
                  <div className="text-[10px] text-neutral-400 uppercase tracking-wider">{item.label}</div>
                  <div className="text-sm font-medium text-obsidian-850 mt-1">{item.value}</div>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-ivory-300 divide-y divide-ivory-200 text-xs">
              {/*
                DÖKÜM YUKARIDAN AŞAĞI TOPLANIR (2026-10-04). Eskiden "Brüt hakediş" en üstteydi ve
                altında prim / fazla mesai "+" ile tekrar yazılıyordu: brüt bunları ZATEN içerdiği
                için okuyan kişi fazla mesaiyi iki kez ekliyor, kesintiyi brütten bir daha düşüyordu.
                Sıra artık: bugüne kadarki maaş − kesinti + prim + fazla mesai = brüt.
              */}
              {[
                {
                  label: (detail.elapsedSalary ?? detail.monthlySalary) < detail.monthlySalary
                    ? 'Bugüne kadarki maaş (ay sürüyor)'
                    : 'Aylık maaş',
                  value: money(detail.elapsedSalary ?? detail.monthlySalary)
                },
                { label: 'Devamsızlık / eksik saat / ücretsiz izin kesintisi', value: `-${money(detail.absenceDeduction)}` },
                { label: 'Vardiya primi (zamlı dilimler)', value: `+${money(detail.shiftPremium)}` },
                { label: `Fazla mesai (${formatMinutes(detail.overtimeMinutes)})`, value: `+${money(detail.overtimePay)}` }
              ].map((row) => (
                <div key={row.label} className="flex justify-between px-3 py-2">
                  <span className="text-neutral-500">{row.label}</span>
                  <span className="font-medium text-obsidian-850">{row.value}</span>
                </div>
              ))}
              <div className="flex justify-between px-3 py-2 bg-ivory-50">
                <span className="font-medium text-obsidian-850">= Brüt hakediş</span>
                <span className="font-semibold text-obsidian-850">{money(detail.grossAccrual)}</span>
              </div>
              {(detail.compensatedMinutes ?? 0) > 0 && (
                <div className="px-3 py-2 text-[11px] text-neutral-500">
                  Mesai saatleri dışında çalışılan {formatMinutes(detail.compensatedMinutes)} aynı günlerin eksik
                  saatini kapattı; kesinti yazılmadı, fazla mesai de sayılmadı.
                </div>
              )}
              {[
                { label: 'Mahsup edilecek avans', value: `-${money(detail.deductibleAdvances)}` },
                { label: 'Bu dönem ödenen', value: `-${money(detail.alreadyPaid)}` }
              ].map((row) => (
                <div key={row.label} className="flex justify-between px-3 py-2">
                  <span className="text-neutral-500">{row.label}</span>
                  <span className="font-medium text-obsidian-850">{row.value}</span>
                </div>
              ))}
              <div className="flex justify-between px-3 py-2.5 bg-ivory-100">
                <span className="font-medium text-obsidian-850">Ödenecek net</span>
                <span className="font-semibold text-obsidian-850">{money(detail.netPayable)}</span>
              </div>
              <div className="flex justify-between px-3 py-2">
                <span className="text-neutral-500">Yemek hakedişi (ayrıca)</span>
                <span className="font-medium text-obsidian-850">{money(detail.mealAccrual)}</span>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 mb-2">
                <CalendarClock size={12} />
                <span>Gün dökümü</span>
              </div>
              <div className="max-h-72 overflow-y-auto scrollbar-thin-dark rounded-lg border border-ivory-300">
                <AyarliTablo>
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-ivory-100">
                    <tr className="text-left text-[10px] uppercase tracking-wider text-neutral-400">
                      <th className="px-3 py-2 font-medium">Gün</th>
                      <th className="px-3 py-2 font-medium text-right">Beklenen</th>
                      <th className="px-3 py-2 font-medium text-right">Çalışılan</th>
                      <th className="px-3 py-2 font-medium">Durum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.days.map((d) => (
                      <tr key={d.date} className="border-t border-ivory-200">
                        <td className="px-3 py-1.5 text-neutral-600">{d.date}</td>
                        <td className="px-3 py-1.5 text-right text-neutral-500">
                          {d.expectedMinutes > 0 ? formatMinutes(d.expectedMinutes) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right text-obsidian-850">
                          {d.workedMinutes > 0 ? formatMinutes(d.workedMinutes) : '—'}
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="flex flex-wrap gap-1">
                            {/* Eski sürüm sunucuda `blocks` gelmeyebilir; alan yokken çökmemeli. */}
                            {(d.blocks ?? [])
                              .filter((b) => b.payMultiplier !== 1 && b.workedMinutes > 0)
                              .map((b) => (
                                <span key={b.start} className="badge-amber">
                                  {b.label} ×{b.payMultiplier}
                                </span>
                              ))}
                            {d.isHoliday && <span className="badge-editorial">{d.holidayName ?? 'TATİL'}</span>}
                            {d.isLeave && <span className="badge-navy">{d.isPaidLeave ? 'İZİNLİ' : 'ÜCRETSİZ'}</span>}
                            {d.workedDuringLeave && <span className="badge-navy">İZİNDEN ERKEN DÖNDÜ / KISMİ İZİN</span>}
                            {!d.isLeave && (d.leaveMinutes ?? 0) > 0 && (
                              <span className="badge-navy">İZİN {formatMinutes(d.leaveMinutes)}</span>
                            )}
                            {(d.compensatedMinutes ?? 0) > 0 && (
                              <span className="badge-editorial">EKSİK KAPANDI {formatMinutes(d.compensatedMinutes)}</span>
                            )}
                            {d.isAbsent && <span className="badge-rose">DEVAMSIZ</span>}
                            {d.isLate && <span className="badge-amber">GEÇ</span>}
                            {d.hasOpenCheckIn && <span className="badge-amber">AÇIK KAYIT</span>}
                            {d.overtimeMinutes > 0 && <span className="badge-emerald">+{formatMinutes(d.overtimeMinutes)}</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </AyarliTablo>
              </div>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-neutral-500">
              <Wallet size={12} />
              <span>
                Yıllık izin: {detail.annualLeaveUsedDays} gün kullanıldı, {detail.annualLeaveRemainingDays} gün kaldı
                (hak: {detail.annualLeaveEntitlementDays} gün).
              </span>
            </div>
          </div>
        )}
      </Modal>

      {popup && (
        <NotificationPopup
          isOpen
          variant={popup.variant}
          title={popup.title}
          message={popup.message}
          onClose={() => setPopup(null)}
        />
      )}
    </Layout>
  )
}
