import React from 'react'
import { ShieldCheck } from 'lucide-react'

type Props = {
  amount: number
  installmentCount: number
}

export default function PaymentHeader({ amount, installmentCount }: Props) {
  const formatMoney = (n: number) => {
    return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const showInstallmentBadge = installmentCount > 1 && amount > 0
  const perMonth = amount / installmentCount

  return (
    <div 
      className="relative overflow-hidden rounded-2xl p-6 mb-6 bg-white/80 backdrop-blur-xl border border-red-500/15 shadow-[0_8px_32px_rgba(220,38,38,0.03)]"
    >
      {/* Subtle glass reflection highlight */}
      <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/5 to-white/10 pointer-events-none" />

      <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-red-50/60 border border-red-550/15 px-3 py-1 text-[10px] font-bold text-red-600 tracking-wider uppercase">
            <ShieldCheck size={12} className="text-red-500" />
            <span>Güvenli Ödeme Altyapısı</span>
          </div>
          <h1 className="mt-3.5 text-xl sm:text-2xl font-black text-slate-800 tracking-tight">
            Kredi Kartı ile Ödeme
          </h1>
          <p className="mt-1 text-xs text-slate-500 max-w-md font-medium">
            Ödemeleriniz 3D Secure güvencesiyle 256-bit SSL şifreleme ile gerçekleştirilir.
          </p>
        </div>

        <div className="flex flex-col md:items-end border-t md:border-t-0 border-red-500/10 pt-4 md:pt-0 shrink-0">
          <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
            Toplam Ödenecek Tutar
          </span>
          <div className="mt-1 text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-none">
            {formatMoney(amount)} <span className="text-base font-bold text-slate-600">TL</span>
          </div>
          {showInstallmentBadge && (
            <div className="mt-2 text-[10px] text-red-600 bg-red-50/50 border border-red-500/15 rounded-lg px-2.5 py-1 font-semibold">
              {installmentCount} taksit × <span className="font-extrabold text-red-700">{formatMoney(perMonth)} TL</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
