import React from 'react'
import CustomerSelect from '../forms/CustomerSelect'
import { type CustomerDto } from '../../api/customers'

type Props = {
  selectedCustomer: CustomerDto | null
  onChange: (c: CustomerDto | null) => void
  fetcher: (opts: { q?: string; includeInactive?: boolean; limit?: number; signal?: AbortSignal }) => Promise<CustomerDto[]>
  disabled?: boolean
}

export default function CustomerSelector({ selectedCustomer, onChange, fetcher, disabled }: Props) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
      <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
        Ödeme Yapan Cari Hesap
      </div>
      <CustomerSelect
        label="Cari Hesap Seçimi"
        requiredMark
        value={selectedCustomer}
        onChange={onChange}
        fetcher={fetcher}
        disabled={disabled}
      />
    </div>
  )
}
