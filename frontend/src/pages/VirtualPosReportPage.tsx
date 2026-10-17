import { useState, useEffect, useMemo } from 'react'
import Table, { type TableColumn } from '../components/Table'
import {
  fetchPosTransactions,
  posOutcomeLabel,
  posOutcomeOf,
  VirtualPosTransactionDto
} from '../api/virtualPos'
import VirtualPosPaymentModal from '../components/VirtualPosPaymentModal'
import { CreditCard, CheckCircle2, XCircle, Clock, RefreshCw } from 'lucide-react'

export default function VirtualPosReportPage() {
  const [transactions, setTransactions] = useState<VirtualPosTransactionDto[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [paymentModalOpen, setPaymentModalOpen] = useState(false)

  const loadTransactions = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchPosTransactions()
      setTransactions(data)
    } catch (err: any) {
      setError(err?.message || 'İşlem raporları yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadTransactions()
  }, [])

  const columns = useMemo<TableColumn<VirtualPosTransactionDto>[]>(() => [
    {
      key: 'transactionDate',
      label: 'Tarih',
      // Süzgeç ve sıralama ekrandaki metin üzerinden: ham ISO değerinde kullanıcı
      // "22.08" yazıp arayamıyordu.
      //
      // Değer SAATLİ ("22.08.2026 14:30"); ortak tarih ayrıştırıcısı saati kesip günü
      // karşılaştırıyor, o yüzden tarih süzgeci burada da doğru çalışır.
      filter: { type: 'date' },
      accessorFn: (t) => new Date(t.transactionDate).toLocaleString('tr-TR'),
      render: (v) => <span className="font-medium text-slate-600 whitespace-nowrap">{String(v ?? '')}</span>
    },
    {
      key: 'orderNo',
      label: 'Sipariş / Belge No',
      render: (_v, t) => <span className="font-mono font-semibold text-slate-800">{t.orderNo}</span>
    },
    {
      key: 'customerCode',
      label: 'Cari Kodu',
      render: (_v, t) => <span className="font-semibold text-slate-700">{t.customerCode || '—'}</span>
    },
    {
      key: 'bankName',
      label: 'Banka',
      render: (_v, t) => <span className="font-bold text-slate-900">{t.bankName}</span>
    },
    {
      key: 'card',
      label: 'Kart Bilgisi',
      accessorFn: (t) => `${t.cardHolderName ?? ''} ${t.maskedCardNumber ?? ''}`.trim(),
      render: (_v, t) => (
        <>
          <div className="font-semibold text-slate-800">{t.cardHolderName || '—'}</div>
          <div className="text-[10px] font-mono text-slate-500">{t.maskedCardNumber || '—'}</div>
        </>
      )
    },
    {
      key: 'installmentCount',
      label: 'Taksit',
      // Sıralama SAYIYA göre olsun diye ham değer taşınıyor; metin `render`da kuruluyor.
      // Etiketi taşısaydık "10 Taksit" ile "2 Taksit" alfabetik sıralanırdı.
      accessorFn: (t) => Number(t.installmentCount ?? 0),
      render: (_v, t) => (
        <span className="text-center block font-bold text-slate-700">
          {t.installmentCount > 1 ? `${t.installmentCount} Taksit` : 'Tek Çekim'}
        </span>
      )
    },
    {
      key: 'amount',
      label: 'Tutar',
      accessorFn: (t) => Number(t.amount ?? 0),
      render: (_v, t) => (
        <span className="font-bold text-emerald-700 whitespace-nowrap text-sm">
          {t.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}{' '}
          {String(t.currencyCode ?? 'TRY').toUpperCase() === 'TRY' ? 'TL' : String(t.currencyCode).toUpperCase()}
        </span>
      )
    },
    {
      key: 'durum',
      label: 'Durum',
      accessorFn: (t) => posOutcomeLabel(posOutcomeOf(t), t),
      render: (_v, t) => {
        // "Başarılı değil" ile "başarısız" ayrı şeyler; doğrulanamayan ve sonucu beklenen
        // ödemeler kırmızı yazılmaz. Bkz. `posOutcomeOf`.
        const outcome = posOutcomeOf(t)
        const tone =
          outcome === 'success' ? 'bg-emerald-100 text-emerald-800'
            : outcome === 'failed' ? 'bg-red-100 text-red-800'
              : outcome === 'attention' ? 'bg-amber-100 text-amber-800'
                : 'bg-slate-100 text-slate-700'
        const Icon = outcome === 'success' ? CheckCircle2 : outcome === 'failed' ? XCircle : Clock
        return (
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${tone}`}>
            <Icon className="w-3.5 h-3.5" /> {posOutcomeLabel(outcome, t)}
          </span>
        )
      }
    },
    {
      key: 'aciklama',
      label: 'Onay Kodu / Açıklama',
      accessorFn: (t) =>
        posOutcomeOf(t) === 'success' ? `Onay: ${t.authCode ?? ''}` : String(t.errorDescription ?? ''),
      render: (_v, t) =>
        posOutcomeOf(t) === 'success' ? (
          <span className="font-mono font-bold text-slate-800">Onay: {t.authCode}</span>
        ) : posOutcomeOf(t) === 'failed' ? (
          <span className="text-red-600 font-medium">{t.errorDescription || 'Hata'}</span>
        ) : (
          <span className="text-amber-700 font-medium">
            {t.errorDescription || 'Banka sonucu henüz alınmadı — bankadan teyit edilmeli.'}
          </span>
        )
    }
  ], [])

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-xs border border-gray-200">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2.5">
            <CreditCard className="w-6 h-6 text-emerald-600" />
            Sanal POS Tahsilat ve Çekim Raporları
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            6 Banka Multi-POS 3D Secure Tahsilat Geçmişi ve Anlık Kredi Kartı Ödeme Yönetimi
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadTransactions}
            disabled={loading}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Yenile
          </button>

          <button
            onClick={() => setPaymentModalOpen(true)}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-600/20 transition-all flex items-center gap-2 cursor-pointer"
          >
            <CreditCard className="w-4 h-4" />
            Yeni Kredi Kartı Tahsilatı Yap
          </button>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-slate-50">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
            Son Çekim İşlemleri ({transactions.length})
          </span>
        </div>

        {error && (
          <div className="p-4 bg-red-50 text-red-700 text-xs font-semibold">
            {error}
          </div>
        )}

        <Table<VirtualPosTransactionDto>
          onRefresh={() => void loadTransactions()}
          columns={columns}
          data={transactions}
          rowKey={(t) => String(t.id)}
          loading={loading}
        />
      </div>

      {/* Virtual POS Modal */}
      <VirtualPosPaymentModal
        isOpen={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        onSuccess={loadTransactions}
      />
    </div>
  )
}
