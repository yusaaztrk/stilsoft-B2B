import React from 'react'

type Props = {
  detectedBank: string
  /** Taksit tablosunun geldigi banka. Kartin bankasindan FARKLI olabilir. */
  installmentBankName?: string
  binLookupLoading: boolean
  installmentOptions: Array<{ value: string; label: string }>
  installmentCount: string
  onSelectInstallment: (v: string) => void
  amountValue: number
  installmentMinByValue: Record<string, number>
  disabled?: boolean
  error?: string
}

export default function InstallmentSelector({
  detectedBank,
  installmentBankName = '',
  binLookupLoading,
  installmentOptions,
  installmentCount,
  onSelectInstallment,
  amountValue,
  installmentMinByValue,
  disabled = false,
  error
}: Props) {
  const formatMoney = (n: number) => {
    return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const showPlaceholder = !detectedBank || binLookupLoading || installmentOptions.length === 0

  // Karsilastirma icin sadelestir: nokta, bosluk ve Turkce karakter farklari yuzunden
  // ayni banka farkli gorunmesin.
  const sadelestir = (v: string) =>
    String(v ?? '')
      .toLowerCase()
      .replace(/ı/g, 'i')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '')

  // Kartin bankasi ile taksit tablosunun bankasi farkliysa bunu SOYLE. Aksi halde
  // "Ziraat karti taktim ama Ziraat'e tanimladigim taksit gelmedi" gibi, sebebi
  // ekranda hic gorunmeyen bir durum olusuyor.
  const farkliTaksitBankasi =
    Boolean(installmentBankName) &&
    Boolean(detectedBank) &&
    sadelestir(installmentBankName) !== sadelestir(detectedBank)

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
          Taksit Seçenekleri
        </label>
        {!showPlaceholder && installmentBankName && (
          <span
            className={`text-[11px] font-semibold px-2 py-1 rounded-lg border ${
              farkliTaksitBankasi
                ? 'bg-amber-50 border-amber-200 text-amber-700'
                : 'bg-slate-50 border-slate-200 text-slate-500'
            }`}
            title={
              farkliTaksitBankasi
                ? `Bu kart ${installmentBankName} POS'undan çekiliyor (${detectedBank} bankasının kullanılabilir bir POS tanımı yok), taksit tablosu da oradan uygulanıyor. Seçenekleri değiştirmek için Taksit Oranları ekranında ${installmentBankName} kaydını düzenleyin.`
                : undefined
            }
          >
            Taksit tablosu: {installmentBankName}
            {farkliTaksitBankasi ? ' (kart bankasından farklı)' : ''}
          </span>
        )}
      </div>

      {showPlaceholder ? (
        <div className="p-5 bg-slate-50 border border-slate-200 border-dashed rounded-xl text-center text-xs text-slate-400 font-semibold leading-relaxed">
          {binLookupLoading 
            ? 'Kart bankası sorgulanıyor...' 
            : 'Taksit seçeneklerini görmek için lütfen kart numaranızı giriniz.'}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {installmentOptions.map((opt) => {
              const isSelected = installmentCount === opt.value
              const count = Number(opt.value) || 1
              const perMonth = amountValue / count
              const minAmt = Number(installmentMinByValue?.[opt.value] ?? 0)
              // TUTAR 0 IKEN DE KILITLI. Onceki kosul (amountValue > 0) yuzunden cekim
              // tutari girilmeden butun kutular secilebilir duruyordu; kullanici 5 Taksit'i
              // secip sonra minimumun altinda bir tutar yaziyordu. Kutu goruntulenmeye devam
              // ediyor, sadece secilemez oluyor - hangi tutardan itibaren acilacagi
              // uzerindeki "Min:" satirinda yaziyor.
              const isBlocked = minAmt > 0 && amountValue < minAmt

              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={isBlocked || disabled}
                  onClick={() => onSelectInstallment(opt.value)}
                  className={`p-3 text-left rounded-xl border transition-all flex flex-col justify-between h-22 relative overflow-hidden select-none cursor-pointer ${
                    isBlocked
                      ? 'opacity-40 bg-slate-50 border-slate-200 cursor-not-allowed'
                      : isSelected
                      ? 'border-transparent text-white ring-2 ring-offset-1 ring-red-500/10'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50'
                  }`}
                  style={
                    isSelected && !isBlocked
                      ? {
                          background:
                            'linear-gradient(135deg, var(--tenant-gradient-from, #8F2500), var(--tenant-gradient-to, #BD390C))'
                        }
                      : undefined
                  }
                >
                  <div className="flex items-center justify-between w-full">
                    <span 
                      className={`text-xs font-extrabold ${
                        isSelected ? 'text-white' : 'text-slate-700'
                      }`}
                    >
                      {opt.label === 'Tek Çekim' ? 'Tek Çekim' : `${opt.label} Taksit`}
                    </span>
                    
                    {/* Custom checkbox */}
                    <div 
                      className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                        isSelected 
                          ? 'border-white bg-white text-red-700' 
                          : 'border-slate-300 bg-white'
                      }`}
                    >
                      {isSelected && (
                        <span 
                          className="w-1.5 h-1.5 rounded-full" 
                          style={{
                            backgroundColor: 'var(--tenant-gradient-from, #8F2500)'
                          }}
                        />
                      )}
                    </div>
                  </div>

                  <div className="mt-2.5">
                    <span 
                      className={`text-sm font-black tracking-tight ${
                        isSelected ? 'text-white' : 'text-slate-800'
                      }`}
                    >
                      {formatMoney(perMonth)}
                    </span>
                    <span 
                      className={`text-[9px] font-bold ml-1 ${
                        isSelected ? 'text-white/85' : 'text-slate-400'
                      }`}
                    >
                      TL {count > 1 ? '/ Ay' : ''}
                    </span>
                  </div>

                  {minAmt > 0 && (
                    <div 
                      className={`text-[8.5px] font-semibold truncate w-full mt-1 ${
                        isSelected ? 'text-white/80' : 'text-slate-400'
                      }`}
                    >
                      Min: {formatMoney(minAmt)} TL
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          {error && (
            <div className="text-[10px] font-bold text-rose-600 pl-1">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
