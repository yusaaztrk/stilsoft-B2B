import React from 'react'

type InstallmentLine = {
  taksit: string
  minTutar: string
  aciklama: string
  sira: number
}

// Bir bankanin taksit secenekleri artik tek metin degil, eslestirilmis satirlar.
// Onceki halde "TEK CEKIM 3 TAKSIT 5 TAKSIT" ve "1 250 250" yan yana yapisiyordu:
// hangi minimumun hangi taksite ait oldugu ekrandan okunamiyordu.
type InstallmentRow = {
  banka: string
  satirlar: InstallmentLine[]
}

type SectionType = 'installments' | 'dealer' | 'service' | 'privacy' | 'cancel'

type Props = {
  openSection: SectionType
  setOpenSection: (section: SectionType) => void
  installmentsLoading: boolean
  /** Yükleme başarısızsa sebebi; boş liste ile hatayı ayırt etmek için. */
  installmentsError?: string | null
  installmentRows: InstallmentRow[]
  dealerContractText: string
  serviceTermsText: string
  privacyText: string
  cancelText: string
}

export default function PaymentInfoTabs({
  openSection,
  setOpenSection,
  installmentsLoading,
  installmentsError,
  installmentRows,
  dealerContractText,
  serviceTermsText,
  privacyText,
  cancelText
}: Props) {
  const tabs = [
    { id: 'installments', label: 'Taksit Oranları' },
    { id: 'dealer', label: 'Bayi Sözleşmesi' },
    { id: 'service', label: 'Hizmet Koşulları' },
    { id: 'privacy', label: 'Gizlilik İlkeleri' },
    { id: 'cancel', label: 'İptal ve İade' }
  ] as const

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden mt-6">
      {/* Tab Headers bar */}
      <div className="flex border-b border-slate-100 bg-slate-50/50 overflow-x-auto custom-scrollbar">
        {tabs.map((tab) => {
          const isActive = openSection === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setOpenSection(tab.id)}
              className={`px-5 py-3.5 text-xs font-bold border-b-2 transition-all whitespace-nowrap cursor-pointer ${
                isActive
                  ? 'border-red-600 text-red-600 bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-100/30'
              }`}
              style={isActive ? { borderBottomColor: 'var(--tenant-gradient-from, #8F2500)', color: 'var(--tenant-gradient-from, #8F2500)' } : undefined}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab Contents */}
      <div className="p-5 min-h-[220px]">
        {openSection === 'installments' && (
          <div className="animate-in fade-in duration-200">
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 font-bold">
                    <th className="text-left px-4 py-3 font-bold uppercase tracking-wider">Banka Adı</th>
                    <th className="text-left px-4 py-3 font-bold uppercase tracking-wider">Taksit Seçenekleri</th>
                    <th className="text-left px-4 py-3 font-bold uppercase tracking-wider">Min. Tutar</th>
                    <th className="text-left px-4 py-3 font-bold uppercase tracking-wider">Açıklama / Notlar</th>
                  </tr>
                </thead>
                <tbody className="font-medium text-slate-700">
                  {installmentsLoading ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-400 font-semibold">
                        Taksit bilgileri yükleniyor...
                      </td>
                    </tr>
                  ) : installmentsError ? (
                    <tr>
                      {/* Boş liste ile hata ayrı görünmeli; eskiden ikisi de aynı yazıyı veriyordu. */}
                      <td colSpan={4} className="px-4 py-8 text-center text-red-600 font-semibold">
                        Taksit oranları yüklenemedi: {installmentsError}
                      </td>
                    </tr>
                  ) : installmentRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-400 font-semibold">
                        Tasarruflu taksit verisi bulunamadı.
                      </td>
                    </tr>
                  ) : (
                    installmentRows.map((r, idx) => {
                      const satirlar = r.satirlar?.length ? r.satirlar : [{ taksit: '-', minTutar: '', aciklama: '', sira: 9999 }]
                      // Banka adi hucresi tum satirlarina yayiliyor (rowSpan). Boylece taksit,
                      // minimum tutar ve aciklama ayni satirda hizali duruyor.
                      return satirlar.map((line, li) => (
                        <tr
                          key={`${r.banka}-${idx}-${li}`}
                          className={`hover:bg-slate-50/40 transition-colors ${
                            li === 0 && idx > 0 ? 'border-t border-slate-200' : ''
                          }`}
                        >
                          {li === 0 && (
                            <td
                              rowSpan={satirlar.length}
                              className="px-4 py-3 font-bold text-slate-900 align-top border-r border-slate-100"
                            >
                              {r.banka}
                            </td>
                          )}
                          <td className="px-4 py-2.5 whitespace-nowrap font-semibold text-slate-700">{line.taksit}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap font-semibold text-slate-900 tabular-nums">
                            {line.minTutar || '-'}
                          </td>
                          <td className="px-4 py-2.5 text-slate-500">{line.aciklama}</td>
                        </tr>
                      ))
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {openSection === 'dealer' && (
          <div className="animate-in fade-in duration-200">
            <div className="max-h-[260px] overflow-y-auto p-4 rounded-xl border border-slate-200 bg-slate-50/50">
              <pre className="whitespace-pre-wrap text-xs text-slate-650 select-text font-sans leading-relaxed">
                {dealerContractText}
              </pre>
            </div>
          </div>
        )}

        {openSection === 'service' && (
          <div className="animate-in fade-in duration-200">
            <div className="max-h-[260px] overflow-y-auto p-4 rounded-xl border border-slate-200 bg-slate-50/50">
              <pre className="whitespace-pre-wrap text-xs text-slate-650 select-text font-sans leading-relaxed">
                {serviceTermsText}
              </pre>
            </div>
          </div>
        )}

        {openSection === 'privacy' && (
          <div className="animate-in fade-in duration-200">
            <div className="max-h-[260px] overflow-y-auto p-4 rounded-xl border border-slate-200 bg-slate-50/50">
              <pre className="whitespace-pre-wrap text-xs text-slate-650 select-text font-sans leading-relaxed">
                {privacyText}
              </pre>
            </div>
          </div>
        )}

        {openSection === 'cancel' && (
          <div className="animate-in fade-in duration-200">
            <div className="max-h-[260px] overflow-y-auto p-4 rounded-xl border border-slate-200 bg-slate-50/50">
              <pre className="whitespace-pre-wrap text-xs text-slate-650 select-text font-sans leading-relaxed">
                {cancelText}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
