import React, { useState, useEffect, useCallback, useMemo } from 'react'
import Table, { type TableColumn } from '../components/Table'
import {
  Calendar,
  Lock,
  Unlock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  ArrowRight,
  ShieldAlert,
  FileCheck2,
  DollarSign,
  RotateCcw
} from 'lucide-react'
import {
  fetchAccountingPeriods,
  validateCloseAccountingPeriod,
  closeAccountingPeriod,
  deleteAccountingPeriod,
  AccountingPeriod,
  PeriodClosingValidationReport
} from '../services/accountingPeriodService'

export default function MaliDonemlerPage() {
  const [periods, setPeriods] = useState<AccountingPeriod[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Close Wizard Modal
  const [selectedPeriodForClose, setSelectedPeriodForClose] = useState<AccountingPeriod | null>(null)
  const [customTransferName, setCustomTransferName] = useState('')
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1)
  const [validationReport, setValidationReport] = useState<PeriodClosingValidationReport | null>(null)
  const [validating, setValidating] = useState(false)
  const [closing, setClosing] = useState(false)

  // Revert Modal State
  const [selectedPeriodForRevert, setSelectedPeriodForRevert] = useState<AccountingPeriod | null>(null)
  const [reverting, setReverting] = useState(false)

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchAccountingPeriods()
      setPeriods(data)
    } catch (err: any) {
      setError(err?.message || 'Mali dönemler yüklenirken bir hata oluştu.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const startClosingWizard = async (period: AccountingPeriod) => {
    setSelectedPeriodForClose(period)
    const now = new Date()
    const nowStr = `${now.toLocaleDateString('tr-TR')} ${now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`
    setCustomTransferName(`Devir (${nowStr})`)
    setWizardStep(1)
    setValidationReport(null)
    try {
      setValidating(true)
      const report = await validateCloseAccountingPeriod(period.id)
      setValidationReport(report)
    } catch (err: any) {
      alert(err?.message || 'Ön kontrol başarısız oldu')
    } finally {
      setValidating(false)
    }
  }

  const handleExecuteClose = async () => {
    if (!selectedPeriodForClose) return
    try {
      setClosing(true)
      const result = await closeAccountingPeriod(selectedPeriodForClose.id, customTransferName)
      // Kapatma başarılı ama dönem içinde onaysız belge kalmış olabilir: sunucu engellemiyor,
      // uyarıyı geçiriyor. Sessizce yutulmasın — başarı mesajının altına eklenir.
      const uyarilar = result.warnings ?? []
      setSuccessMsg(uyarilar.length > 0
        ? result.message + '\n\nDİKKAT:\n' + uyarilar.map(u => '• ' + u).join('\n')
        : result.message)
      setSelectedPeriodForClose(null)
      loadData()
    } catch (err: any) {
      alert(err?.message || 'Dönem kapatılamadı')
    } finally {
      setClosing(false)
    }
  }

  const handleRevertClick = (period: AccountingPeriod) => {
    setSelectedPeriodForRevert(period)
  }

  const executeRevert = async () => {
    if (!selectedPeriodForRevert) return
    try {
      setReverting(true)
      await deleteAccountingPeriod(selectedPeriodForRevert.id)
      setSuccessMsg(`"${selectedPeriodForRevert.name}" dönemi geri alındı. Sistem ${selectedPeriodForRevert.fiscalYear - 1} mali dönemine döndürüldü.`)
      setSelectedPeriodForRevert(null)
      loadData()
    } catch (err: any) {
      alert(err?.message || 'Dönem geri alınamadı')
    } finally {
      setReverting(false)
    }
  }

  const minFiscalYear = periods.length > 0 ? Math.min(...periods.map((x) => x.fiscalYear)) : 0
  const maxFiscalYear = periods.length > 0 ? Math.max(...periods.map((x) => x.fiscalYear)) : 0

  const columns = useMemo<TableColumn<AccountingPeriod>[]>(() => [
    {
      key: 'code',
      label: 'Kod',
      render: (_v, p) => <span className="font-mono font-bold text-slate-900">{p.code}</span>
    },
    {
      key: 'name',
      label: 'Dönem Adı',
      render: (_v, p) => <span className="font-semibold text-slate-800">{p.name}</span>
    },
    {
      key: 'fiscalYear',
      label: 'Mali Yıl',
      accessorFn: (p) => Number(p.fiscalYear ?? 0),
      render: (_v, p) => <span className="font-bold text-indigo-600">{p.fiscalYear}</span>
    },
    {
      key: 'range',
      label: 'Tarih Aralığı',
      accessorFn: (p) =>
        `${new Date(p.startDate).toLocaleDateString('tr-TR')} - ${new Date(p.endDate).toLocaleDateString('tr-TR')}`,
      render: (v) => <span className="text-slate-500">{String(v ?? '')}</span>
    },
    {
      key: 'isClosed',
      label: 'Durum',
      // Metin taşınıyor: ham `true/false` ile "kapalı" diye aranamaz.
      accessorFn: (p) => String(p.statusName ?? (p.isClosed ? 'Kapalı' : 'Açık')),
      render: (_v, p) => (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-extrabold ${
          p.isClosed
            ? 'bg-rose-50 text-rose-700 border border-rose-200'
            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
        }`}>
          {p.isClosed ? <Lock size={12} /> : <Unlock size={12} />}
          <span>{p.statusName}</span>
        </span>
      )
    },
    {
      key: 'isActive',
      label: 'Aktiflik',
      accessorFn: (p) => (p.isActive ? 'Aktif Dönem' : 'Pasif'),
      filter: { type: 'select', options: [{ label: 'Aktif Dönem', value: 'Aktif Dönem' }, { label: 'Pasif', value: 'Pasif' }] },
      render: (_v, p) =>
        p.isActive ? (
          <span className="inline-flex items-center gap-1 text-emerald-600 font-bold">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Aktif Dönem</span>
          </span>
        ) : (
          <span className="text-slate-400 font-medium">Pasif</span>
        )
    },
    {
      key: 'actions',
      label: 'İşlemler',
      render: (_v, p) => {
        // "Geri al" YALNIZCA en son dönemde ve tek dönem kalmadıysa çıkar — eski tablodaki
        // kuralın aynısı.
        const canRevert = p.fiscalYear > minFiscalYear && p.fiscalYear === maxFiscalYear
        return (
          <div className="flex items-center justify-end gap-2">
            {!p.isClosed && (
              <button
                onClick={() => startClosingWizard(p)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg transition text-[11px] shadow-xs"
              >
                <Lock size={13} />
                <span>Dönemi Kapat & Devret</span>
              </button>
            )}
            {canRevert && (
              <button
                onClick={() => handleRevertClick(p)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold rounded-lg border border-rose-200 transition text-[11px]"
                title="Dönemi Geri Al (Bir Önceki Döneme Dön)"
              >
                <RotateCcw size={13} />
                <span>Dönemi Geri Al</span>
              </button>
            )}
          </div>
        )
      }
    }
  ], [minFiscalYear, maxFiscalYear, startClosingWizard, handleRevertClick])

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl text-indigo-600">
            <Calendar size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Mali Dönemler & Devir Yönetimi</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Yıl sonu mali dönemlerin takibi, ön kontroller ve yeni döneme otomatik cari bakiye devri
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => loadData()}
            className="p-2.5 text-slate-600 hover:bg-slate-100 rounded-xl border border-slate-200 transition"
            title="Yenile"
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      {/* Success Notification */}
      {successMsg && (
        <div className="flex items-start justify-between gap-3 bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl text-xs font-semibold">
          <div className="flex items-start gap-2">
            <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
            {/* Uyarılar satır sonlarıyla geliyor; `whitespace-pre-line` olmadan hepsi tek satıra eziliyordu. */}
            <span className="whitespace-pre-line">{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-600 hover:text-emerald-800">
            &times;
          </button>
        </div>
      )}

      {/* Error Notification */}
      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-xl text-xs font-semibold">
          <XCircle size={18} className="text-red-600" />
          <span>{error}</span>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 text-xs font-medium">Mali dönemler yükleniyor...</div>
        ) : periods.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs font-medium">Henüz eklenmiş bir mali dönem bulunmuyor.</div>
        ) : (
          <Table<AccountingPeriod>
          onRefresh={() => void loadData()}
            columns={columns}
            data={periods}
            rowKey={(p) => String(p.id)}
          />
        )}
      </div>



      {/* Period Closing Wizard Modal */}
      {selectedPeriodForClose && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full p-6 space-y-6 animate-in fade-in zoom-in-95 duration-200">
            {/* Wizard Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
                  <Lock size={20} />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    Dönem Kapatma & Devir Sihirbazı ({selectedPeriodForClose.name})
                  </h3>
                  <p className="text-xs text-slate-500">Mali dönem sonu ön kontrolleri ve yeni döneme açılış kaydı devri</p>
                </div>
              </div>
              <button onClick={() => setSelectedPeriodForClose(null)} className="text-slate-400 hover:text-slate-600 font-bold text-lg">&times;</button>
            </div>

            {/* Stepper Header */}
            <div className="flex items-center justify-between px-2">
              <div className={`flex items-center gap-2 text-xs font-bold ${wizardStep === 1 ? 'text-indigo-600' : 'text-slate-400'}`}>
                <span className="h-6 w-6 rounded-full bg-indigo-100 flex items-center justify-center text-xs">1</span>
                <span>Ön Kontroller</span>
              </div>
              <div className="h-0.5 flex-1 bg-slate-200 mx-3" />
              <div className={`flex items-center gap-2 text-xs font-bold ${wizardStep === 2 ? 'text-indigo-600' : 'text-slate-400'}`}>
                <span className="h-6 w-6 rounded-full bg-indigo-100 flex items-center justify-center text-xs">2</span>
                <span>Bakiye Özeti</span>
              </div>
              <div className="h-0.5 flex-1 bg-slate-200 mx-3" />
              <div className={`flex items-center gap-2 text-xs font-bold ${wizardStep === 3 ? 'text-indigo-600' : 'text-slate-400'}`}>
                <span className="h-6 w-6 rounded-full bg-indigo-100 flex items-center justify-center text-xs">3</span>
                <span>Onay & Kapatma</span>
              </div>
            </div>

            {/* Wizard Body */}
            {validating ? (
              <div className="py-12 text-center space-y-3">
                <RefreshCw size={24} className="animate-spin text-indigo-600 mx-auto" />
                <p className="text-xs font-semibold text-slate-600">Dönem içi veriler ve cari bakiyeler taranıyor...</p>
              </div>
            ) : (
              <div>
                {/* STEP 1: Pre-Checks */}
                {wizardStep === 1 && (
                  <div className="space-y-4 text-xs">
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                      <div className="flex justify-between text-slate-700 font-semibold">
                        <span>Dönem İçi Toplam Cari Hareket Sayısı:</span>
                        <span className="font-bold text-slate-900">{validationReport?.totalEntriesInPeriod ?? 0}</span>
                      </div>
                      <div className="flex justify-between text-slate-700 font-semibold">
                        <span>İşlem Gören Cari Hesap Sayısı:</span>
                        <span className="font-bold text-slate-900">{validationReport?.totalCustomers ?? 0}</span>
                      </div>
                    </div>

                    {validationReport?.criticalErrors && validationReport.criticalErrors.length > 0 && (
                      <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 space-y-2">
                        <div className="flex items-center gap-2 font-bold text-rose-700">
                          <ShieldAlert size={16} />
                          <span>Kapatmayı Engelleyen Kritik Hatalar:</span>
                        </div>
                        <ul className="list-disc list-inside space-y-1 text-[11px] font-medium text-rose-800">
                          {validationReport.criticalErrors.map((err, idx) => (
                            <li key={idx}>{err}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {validationReport?.warnings && validationReport.warnings.length > 0 && (
                      <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 space-y-2">
                        <div className="flex items-center gap-2 font-bold text-amber-700">
                          <AlertTriangle size={16} />
                          <span>Sistem Uyarıları:</span>
                        </div>
                        <ul className="list-disc list-inside space-y-1 text-[11px] font-medium text-amber-800">
                          {validationReport.warnings.map((warn, idx) => (
                            <li key={idx}>{warn}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* STEP 2: Currency Summaries */}
                {wizardStep === 2 && (
                  <div className="space-y-4 text-xs">
                    <h4 className="font-bold text-slate-800 flex items-center gap-1.5">
                      <DollarSign size={16} className="text-indigo-600" />
                      <span>Dönem Sonu Döviz Cinsinden Bakiyeler</span>
                    </h4>

                    {validationReport?.currencySummaries.length === 0 ? (
                      <div className="p-4 text-center text-slate-400">Bu dönemde hareket kaydı bulunmuyor.</div>
                    ) : (
                      <div className="border border-slate-200 rounded-xl overflow-hidden">
                        <table className="w-full text-left">
                          <thead className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600">
                            <tr>
                              <th className="p-3">Para Birimi</th>
                              <th className="p-3 text-right">Toplam Borç</th>
                              <th className="p-3 text-right">Toplam Alacak</th>
                              <th className="p-3 text-right">Devredecek Net Bakiye</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {validationReport?.currencySummaries.map((s) => (
                              <tr key={s.currencyTypeId}>
                                <td className="p-3 font-bold text-indigo-700">{s.currencyCode}</td>
                                <td className="p-3 text-right font-mono">{s.totalDebit.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
                                <td className="p-3 text-right font-mono">{s.totalCredit.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
                                <td className={`p-3 text-right font-mono font-extrabold ${s.netBalance >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                  {s.netBalance.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} {s.currencyCode}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* STEP 3: Final Confirmation */}
                {wizardStep === 3 && (
                  <div className="space-y-4 text-xs">
                    <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-900 space-y-2">
                      <div className="flex items-center gap-2 font-bold text-indigo-800">
                        <FileCheck2 size={18} />
                        <span>Kapatma Onayı & Devir Açıklaması</span>
                      </div>
                      <p className="text-slate-700 leading-relaxed text-[11px]">
                        <strong>{selectedPeriodForClose.name}</strong> kapatılacak ve <strong>{selectedPeriodForClose.fiscalYear + 1} Mali Yılı</strong> için her carinin net bakiyesine göre <strong>Devir (Açılış) Kaydı</strong> oluşturulacaktır.
                      </p>
                      <ul className="list-disc list-inside text-[11px] text-slate-600 space-y-1 pt-1">
                        <li>Eski dönem hareketleri kesinlikle silinmez ve değiştirilemez.</li>
                        <li>Kapalı döneme geri tarihli yeni işlem eklenemez.</li>
                        <li>İşlem tek bir transaction içerisinde güvenle tamamlanır.</li>
                      </ul>
                    </div>

                    <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-2">
                      <label className="block font-bold text-slate-800 text-xs">
                        Devir Kaydı Açıklaması / Özel Devir Adı
                      </label>
                      <input
                        type="text"
                        value={customTransferName}
                        onChange={(e) => setCustomTransferName(e.target.value)}
                        placeholder="Örn: 2026-2027 Devir Kaydı veya 2027 Yılı Açılış Devri"
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold text-xs text-slate-800"
                      />
                      <p className="text-[11px] text-slate-400">
                        Cari ekstre hareket detaylarında görünecek açıklama metni. İster varsayılanı kullanın, ister özel bir ad yazın.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Wizard Footer Controls */}
            <div className="flex items-center justify-between border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setSelectedPeriodForClose(null)}
                className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl font-semibold hover:bg-slate-50 transition text-xs"
              >
                Vazgeç
              </button>

              <div className="flex items-center gap-2">
                {wizardStep > 1 && (
                  <button
                    type="button"
                    onClick={() => setWizardStep((prev) => (prev - 1) as 1 | 2)}
                    className="px-4 py-2 border border-slate-200 text-slate-700 rounded-xl font-semibold hover:bg-slate-50 transition text-xs"
                  >
                    Geri
                  </button>
                )}

                {wizardStep < 3 ? (
                  <button
                    type="button"
                    disabled={validationReport?.canClose === false}
                    onClick={() => setWizardStep((prev) => (prev + 1) as 2 | 3)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs shadow-sm transition disabled:opacity-40"
                  >
                    <span>İlerle</span>
                    <ArrowRight size={14} />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={closing}
                    onClick={handleExecuteClose}
                    className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs shadow-sm transition disabled:opacity-50"
                  >
                    <Lock size={14} />
                    <span>{closing ? 'Devrediliyor...' : 'Dönemi Kapat ve Devret'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Revert Period Confirmation Modal */}
      {selectedPeriodForRevert && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3.5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-rose-50 border border-rose-100 text-rose-600 rounded-xl">
                  <RotateCcw size={22} />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    Mali Dönemi Geri Al & İptal Et
                  </h3>
                  <p className="text-xs text-slate-500">Devir kayıtlarının kaldırılması ve dönemin geri alınması</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedPeriodForRevert(null)}
                className="text-slate-400 hover:text-slate-600 font-bold text-lg"
              >
                &times;
              </button>
            </div>

            {/* Impact Details */}
            <div className="space-y-3 text-xs">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between text-slate-700">
                  <span className="font-semibold">Geri Alınacak Dönem:</span>
                  <span className="font-bold text-slate-900 bg-white px-2.5 py-1 rounded-lg border border-slate-200">
                    {selectedPeriodForRevert.name} ({selectedPeriodForRevert.fiscalYear})
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-700">
                  <span className="font-semibold">Aktif Edilecek Dönem:</span>
                  <span className="font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                    {selectedPeriodForRevert.fiscalYear - 1} Mali Yılı (Açık Dönem)
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-amber-50/80 border border-amber-200/80 text-amber-900 space-y-2">
                <div className="flex items-center gap-2 font-bold text-amber-800 text-xs">
                  <AlertTriangle size={16} className="text-amber-600 flex-shrink-0" />
                  <span>Sistem Geri Alma Etkileri</span>
                </div>
                <ul className="list-disc list-inside space-y-1 text-[11px] text-amber-800/90 font-medium pl-1">
                  <li>Bu döneme ait tüm açılış bakiye (devir) kayıtları tamamen <strong>silinecektir</strong>.</li>
                  <li>Sistem otomatik olarak <strong>{selectedPeriodForRevert.fiscalYear - 1} mali dönemine</strong> döndürülecektir.</li>
                  <li>Yapılan bu geri alma işlemi <strong>Silinen Kayıtlar</strong> kütüğüne kaydedilecektir.</li>
                </ul>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setSelectedPeriodForRevert(null)}
                className="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl font-semibold hover:bg-slate-50 transition text-xs"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={reverting}
                onClick={executeRevert}
                className="flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-xs shadow-sm transition disabled:opacity-50"
              >
                <RotateCcw size={15} />
                <span>{reverting ? 'Geri Alınıyor...' : `Evet, Dönemi Geri Al ve ${selectedPeriodForRevert.fiscalYear - 1}'e Dön`}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
