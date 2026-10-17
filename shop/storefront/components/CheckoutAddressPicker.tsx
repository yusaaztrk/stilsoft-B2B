'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { MemberAddress } from '@/lib/account'

/**
 * Ödeme ekranındaki "Adresi Değiştir" düğmesi.
 *
 * Seçim, adresi yalnızca ekranda değiştirmiyor — `PUT /api/account/addresses/{id}/default`
 * çağrısı ERP cari kartını da güncelliyor (bkz. AccountController.SyncDefaultAddressToErpAsync),
 * çünkü sipariş oluşturma ucu adres kabul etmiyor; teslimat her zaman carideki güncel adresten
 * okunuyor. `router.refresh()` bu yüzden şart: sunucu bileşenindeki adres önizlemesi ve
 * `preparePendingOrder` bir sonraki adımda YENİ adresi görmeli.
 */
export default function CheckoutAddressPicker({
  addresses,
  activeId,
}: {
  addresses: MemberAddress[]
  activeId?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (addresses.length === 0) return null

  const handlePick = async (id: string) => {
    if (id === activeId) {
      setOpen(false)
      return
    }

    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/account/addresses/${id}/default`, { method: 'PUT' })
      if (!res.ok) {
        setError('Adres değiştirilemedi. Lütfen tekrar deneyin.')
        return
      }
      setOpen(false)
      router.refresh()
    } catch {
      setError('Bağlantı hatası oluştu.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="checkout-address-picker">
      <button type="button" className="c-change-addr-btn" onClick={() => setOpen((v) => !v)}>
        {open ? 'Kapat' : 'Adresi Değiştir'}
      </button>

      {open && (
        <div className="checkout-address-picker-list">
          {addresses.map((addr) => (
            <button
              key={addr.id}
              type="button"
              className={`checkout-address-picker-item${addr.id === activeId ? ' active' : ''}`}
              onClick={() => void handlePick(addr.id)}
              disabled={busyId === addr.id}
            >
              <span className="picker-item-title">
                <b>{addr.title}</b>
                {addr.id === activeId && <span className="picker-active-tag">Kullanılıyor</span>}
              </span>
              <span className="picker-item-body">
                {[addr.address, addr.district, addr.city].filter(Boolean).join(', ')}
              </span>
            </button>
          ))}
          {error && <p className="pw-error">{error}</p>}
        </div>
      )}
    </div>
  )
}
