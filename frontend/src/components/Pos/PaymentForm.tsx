import React from 'react'
import { CreditCard, User, Calendar, Lock, Info, Phone } from 'lucide-react'

type Props = {
  amountText: string
  onAmountChange: (v: string) => void
  onAmountBlur: () => void
  isAmountDisabled: boolean

  cardNumberRaw: string
  onCardNumberChange: (v: string) => void

  cardHolderName: string
  onCardHolderNameChange: (v: string) => void

  expiryRaw: string
  onExpiryChange: (v: string) => void

  cvvRaw: string
  onCvvChange: (v: string) => void

  phoneText: string
  onPhoneChange: (v: string) => void

  detectedBank: string
  onFocusField: (field: 'cvv' | 'other') => void
  disabled?: boolean

  amountError?: string
  bankError?: string
}

export default function PaymentForm({
  amountText,
  onAmountChange,
  onAmountBlur,
  isAmountDisabled,
  cardNumberRaw,
  onCardNumberChange,
  cardHolderName,
  onCardHolderNameChange,
  expiryRaw,
  onExpiryChange,
  cvvRaw,
  onCvvChange,
  phoneText,
  onPhoneChange,
  detectedBank,
  onFocusField,
  disabled = false,
  amountError,
  bankError
}: Props) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs relative">
      {/* Decorative top stripe */}
      <div 
        className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl"
        style={{
          background: 'linear-gradient(to right, var(--tenant-gradient-from, #8F2500), var(--tenant-gradient-to, #BD390C))'
        }}
      />
      
      <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-5">
        Ödeme ve Kart Bilgileri
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Çekim Tutarı */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-slate-500">
            Çekim Tutarı <span className="text-rose-500">*</span>
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 text-xs font-bold">
              TL
            </div>
            <input
              type="text"
              inputMode="decimal"
              className="w-full h-10.5 pl-9 pr-3.5 bg-slate-50/50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-red-500/10 focus:border-red-600 focus:bg-white transition-all disabled:opacity-50"
              placeholder="0,00"
              value={amountText}
              disabled={disabled || isAmountDisabled}
              onChange={(e) => onAmountChange(e.target.value)}
              onBlur={onAmountBlur}
            />
          </div>
          {amountError && (
            <div className="text-[10px] font-bold text-rose-600 pl-1">
              {amountError}
            </div>
          )}
        </div>

        {/* Kart Numarası */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-slate-500">
            Kart Numarası <span className="text-rose-500">*</span>
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <CreditCard size={15} />
            </div>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="cc-number"
              className="w-full h-10.5 pl-9 pr-3.5 bg-slate-50/50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-red-500/10 focus:border-red-600 focus:bg-white transition-all disabled:opacity-50"
              placeholder="0000 0000 0000 0000"
              value={cardNumberRaw}
              disabled={disabled}
              onChange={(e) => onCardNumberChange(e.target.value)}
              onFocus={() => onFocusField('other')}
            />
          </div>
          {bankError && (
            <div className="text-[10px] font-bold text-rose-600 pl-1">
              {bankError}
            </div>
          )}
        </div>

        {/* Kart Sahibinin Adı Soyadı */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-slate-500">
            Kart Sahibinin Adı Soyadı <span className="text-rose-500">*</span>
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <User size={15} />
            </div>
            <input
              type="text"
              autoComplete="cc-name"
              className="w-full h-10.5 pl-9 pr-3.5 bg-slate-50/50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-red-500/10 focus:border-red-600 focus:bg-white transition-all disabled:opacity-50"
              placeholder="Ad ve soyad"
              value={cardHolderName}
              disabled={disabled}
              onChange={(e) => onCardHolderNameChange(e.target.value)}
              onFocus={() => onFocusField('other')}
            />
          </div>
        </div>

        {/* Telefon Numarası */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-slate-500">
            Telefon Numarası
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Phone size={15} />
            </div>
            {/*
              `name` + `autoComplete` BILEREK YAZILI, kaldirilmamali.
              Bu kutu `cc-name` ile `cc-exp` alanlarinin ARASINDA duruyor ve daha once hicbir
              otomatik-doldurma ipucu tasimiyordu. Tarayici formun tamamini "kredi karti formu"
              diye tanidigi icin, kullanici kayitli bir karti sectiginde etiketsiz olan bu
              kutuyu da KART NUMARASIYLA dolduruyordu; telefon girilmemis cekimlerde raporun
              Telefon sutununda 16 haneli kart numarasi gorunmesinin sebebi buydu.
              `tel` ipucu alani telefon olarak isaretler ve kart doldurmasinin disinda birakir.
            */}
            <input
              type="tel"
              name="tel"
              autoComplete="tel"
              inputMode="numeric"
              className="w-full h-10.5 pl-9 pr-3.5 bg-slate-50/50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-red-500/10 focus:border-red-600 focus:bg-white transition-all disabled:opacity-50"
              placeholder="(05XX) XXX XX XX"
              value={phoneText}
              disabled={disabled}
              onChange={(e) => onPhoneChange(e.target.value)}
              onFocus={() => onFocusField('other')}
            />
          </div>
        </div>

        {/* Son Kullanma Tarihi */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-slate-500">
            Son Kullanma Tarihi (AA/YY) <span className="text-rose-500">*</span>
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Calendar size={15} />
            </div>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="cc-exp"
              className="w-full h-10.5 pl-9 pr-3.5 bg-slate-50/50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-red-500/10 focus:border-red-600 focus:bg-white transition-all disabled:opacity-50"
              placeholder="AA/YY"
              value={expiryRaw}
              disabled={disabled}
              onChange={(e) => onExpiryChange(e.target.value)}
              onFocus={() => onFocusField('other')}
            />
          </div>
        </div>

        {/* CVV */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-slate-500">
            Güvenlik Kodu (CVV) <span className="text-rose-500">*</span>
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Lock size={15} />
            </div>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="cc-csc"
              className="w-full h-10.5 pl-9 pr-3.5 bg-slate-50/50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-red-500/10 focus:border-red-600 focus:bg-white transition-all disabled:opacity-50"
              placeholder="CVV"
              value={cvvRaw}
              disabled={disabled}
              onChange={(e) => onCvvChange(e.target.value)}
              onFocus={() => onFocusField('cvv')}
              onBlur={() => onFocusField('other')}
            />
          </div>
        </div>

        {/* Kart Bankası (Otomatik Tespit) */}
        <div className="md:col-span-2 space-y-1.5">
          <label className="block text-xs font-bold text-slate-500">
            Kart Bankası
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Info size={15} />
            </div>
            <input
              type="text"
              className="w-full h-10.5 pl-9 pr-3.5 bg-slate-50/80 border border-slate-200 rounded-xl text-sm font-bold text-slate-500 disabled:opacity-60"
              value={detectedBank || 'Kart numarasından otomatik tespit edilir'}
              disabled
            />
          </div>
        </div>
      </div>
    </div>
  )
}
