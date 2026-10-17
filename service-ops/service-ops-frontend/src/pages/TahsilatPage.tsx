import { CreditCard, ExternalLink } from 'lucide-react'

import { B2B_POS_PAYMENT_PATH, buildB2BUrl } from '../auth/b2bLink'

/**
 * Tahsilat — saha ekibinin para alma ekranı.
 *
 * Sahadaki ekibin bu sayfada yaptığı TEK iş kart çekimi. Bu yüzden burada kasa/banka hesabı,
 * stok kalemi, müşteri seçimi gibi hiçbir şey yok: çekim, bayideki kredi kartı ekranında
 * yapılıyor ve oradaki "Kredi Kartı Çekim Raporu"na düşüyor.
 *
 * Neden ayrı sayfa: eskiden Araç Depoları sayfasındaki bir düğmeydi ve depoya bağlı
 * teknisyene bağlıydı — Merkez/Şube deposunda bağlı teknisyen olmadığı için düğme hiç
 * açılmıyordu. Kendi sayfası olunca yetkisi de kendi anahtarından (serviceOps/tahsilat)
 * veriliyor; depo yetkisiyle ilgisi kalmadı.
 *
 * Oturum devri: bağlantı sync parametrelerini taşıyor, B2B tarafında RequireAuth bunu
 * /api/auth/exchange ile kendi token'ına takas ediyor — yeni sekmede tekrar şifre sorulmuyor.
 */
export default function TahsilatPage() {
  const openPos = () => {
    window.open(buildB2BUrl(B2B_POS_PAYMENT_PATH), '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="p-5">
      <div className="mb-5">
        <h1 className="text-gray-900 dark:text-white font-bold text-lg leading-tight">Tahsilat</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Müşteriden kredi kartı ile ödeme alın. Çekim, Kredi Kartı Çekim Raporu'na düşer.
        </p>
      </div>

      <div className="max-w-xl bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 flex items-center justify-center text-emerald-600 flex-shrink-0">
            <CreditCard className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <h2 className="text-gray-900 dark:text-white font-bold text-base">Kredi Kartı ile Tahsilat</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
              Çekim ekranı yeni bir sekmede açılır. Tekrar şifre girmeniz gerekmez.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={openPos}
          className="mt-5 w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 active:scale-[0.99] transition-all shadow-sm shadow-emerald-600/10"
        >
          <CreditCard className="w-4 h-4" />
          Tahsilat Yap
          <ExternalLink className="w-3.5 h-3.5 opacity-80" />
        </button>
      </div>
    </div>
  )
}
