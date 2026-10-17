import React from 'react'
import { Wallet, Building2 } from 'lucide-react'
import { type CustomerDto } from '../../api/customers'

type Props = {
  customer: CustomerDto | null
  balance: number
}

export default function CustomerBalanceCard({ customer, balance }: Props) {
  if (!customer) return null

  const balanceText = balance.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const isNegative = balance < 0

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs transition-all duration-200 relative overflow-hidden">
      {/* Decorative side color bar */}
      <div 
        className="absolute left-0 top-0 bottom-0 w-1.5"
        style={{
          background: 'linear-gradient(to bottom, var(--tenant-gradient-from, #8F2500), var(--tenant-gradient-to, #BD390C))'
        }}
      />
      
      <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 pl-2">
        Cari Detay ve Bakiye
      </div>

      <div className="space-y-4 pl-2">
        {/* Customer Identity */}
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-500 shrink-0">
            <Building2 size={16} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              {customer.customerCode || 'CARİ KODU BELİRTİLMEMİŞ'}
            </div>
            <div className="text-sm font-extrabold text-slate-800 leading-snug mt-0.5 break-words">
              {customer.name || 'Cari Ünvan Bilgisi Yok'}
            </div>
          </div>
        </div>

        {/* Balance Information */}
        <div className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-100 rounded-xl">
          <div className="flex items-center gap-2 text-slate-500">
            <Wallet size={14} />
            <span className="text-xs font-bold">Mevcut Bakiye</span>
          </div>
          <span 
            className={`text-sm font-black tracking-tight ${
              isNegative ? 'text-rose-600' : 'text-slate-800'
            }`}
          >
            {balanceText} TL
          </span>
        </div>
      </div>
    </div>
  )
}
