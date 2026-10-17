import React from 'react'
import CreditCard, { type BankVariant, type CardType, type ThemeVariant } from '../../app/components/CreditCard'

type Props = {
  cardNumber: string
  cardHolder: string
  expiryDate: string
  cvv: string
  cardType: CardType | ''
  bankName: string
  variant: BankVariant | ThemeVariant
  flipped: boolean
  onFlippedChange: (flipped: boolean) => void
}

export default function CreditCardPreview({
  cardNumber,
  cardHolder,
  expiryDate,
  cvv,
  cardType,
  bankName,
  variant,
  flipped,
  onFlippedChange
}: Props) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs transition-all duration-200">
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
          Kart Önizleme
        </div>
        <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-lg flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Güvenli Giriş
        </span>
      </div>
      <div className="flex justify-center py-2">
        <div className="w-full max-w-[340px] sm:max-w-[380px]">
          <CreditCard
            cardNumber={cardNumber}
            cardHolder={cardHolder}
            expiryDate={expiryDate}
            cvv={cvv}
            cardType={cardType}
            bankName={bankName}
            variant={variant}
            hasContactless
            flipped={flipped}
            onFlippedChange={onFlippedChange}
          />
        </div>
      </div>
    </div>
  )
}
