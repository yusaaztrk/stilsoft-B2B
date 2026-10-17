'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { isWithinCyprus, checkAddressEligibility } from '@/lib/cyprusLocation'

export type MemberAddress = {
  id: string
  title: string
  fullName: string
  phone: string
  city?: string | null
  district?: string | null
  address: string
  isDefault: boolean
  createdAt: string
}

export default function AddressManager() {
  const [addresses, setAddresses] = useState<MemberAddress[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingAddress, setEditingAddress] = useState<MemberAddress | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gpsStatus, setGpsStatus] = useState<string | null>(null)

  // Form fields
  const [title, setTitle] = useState('Ev')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [city, setCity] = useState('Lefkoşa')
  const [district, setDistrict] = useState('')
  const [address, setAddress] = useState('')
  const [isDefault, setIsDefault] = useState(false)

  const fetchAddresses = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/account/addresses', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setAddresses(Array.isArray(data) ? data : [])
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAddresses()
  }, [fetchAddresses])

  const openNewModal = () => {
    setEditingAddress(null)
    setTitle('Ev Adresim')
    setFullName('')
    setPhone('')
    setCity('Lefkoşa')
    setDistrict('')
    setAddress('')
    setIsDefault(addresses.length === 0)
    setError(null)
    setGpsStatus(null)
    setShowModal(true)
  }

  const openEditModal = (addr: MemberAddress) => {
    setEditingAddress(addr)
    setTitle(addr.title)
    setFullName(addr.fullName)
    setPhone(addr.phone)
    setCity(addr.city || 'Lefkoşa')
    setDistrict(addr.district ?? '')
    setAddress(addr.address)
    setIsDefault(addr.isDefault)
    setError(null)
    setGpsStatus(null)
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditingAddress(null)
    setGpsStatus(null)
  }

  const handleGpsAssist = () => {
    if (!navigator.geolocation) {
      setGpsStatus('Tarayıcınız konum servisini desteklemiyor.')
      return
    }
    setGpsStatus('Konumunuz alınıyor...')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        if (isWithinCyprus(latitude, longitude)) {
          setGpsStatus('✅ KKTC konumu doğrulandı.')
        } else {
          setGpsStatus('⚠️ Konumunuz KKTC (Kıbrıs) dışında tespit edildi.')
        }
      },
      () => {
        setGpsStatus('Konum izni alınamadı.')
      },
      { timeout: 8000 }
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (fullName.trim().length < 3) {
      setError('Ad soyad en az 3 karakter olmalıdır.')
      return
    }
    if (phone.trim().length < 7) {
      setError('Geçerli bir telefon numarası giriniz.')
      return
    }
    if (address.trim().length < 5) {
      setError('Lütfen açık adresinizi eksiksiz yazınız.')
      return
    }
    if (district.trim().length < 2) {
      setError('Lütfen ilçe / bölge / mahalle bilgisini giriniz — montaj ve kargo ekibi bu bilgiyi kullanıyor.')
      return
    }

    const check = checkAddressEligibility(city, address)
    if (!check.isEligible) {
      setError(check.reason ?? 'Teslimat adresi KKTC sınırları içerisinde olmalıdır.')
      return
    }

    setBusy(true)
    setError(null)

    const payload = {
      title: title.trim(),
      fullName: fullName.trim(),
      phone: phone.trim(),
      city: city.trim(),
      district: district.trim(),
      address: address.trim(),
      isDefault,
    }

    try {
      const url = editingAddress
        ? `/api/account/addresses/${editingAddress.id}`
        : '/api/account/addresses'
      const method = editingAddress ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        closeModal()
        await fetchAddresses()
      } else {
        const data = await res.json().catch(() => null)
        setError(data?.message ?? 'Adres kaydedilemedi.')
      }
    } catch {
      setError('Bağlantı hatası oluştu.')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('Bu adresi silmek istediğinize emin misiniz?')) return

    try {
      const res = await fetch(`/api/account/addresses/${id}`, { method: 'DELETE' })
      if (res.ok) {
        await fetchAddresses()
      }
    } catch {
      // ignore
    }
  }

  const handleSetDefault = async (id: string) => {
    try {
      const res = await fetch(`/api/account/addresses/${id}/default`, { method: 'PUT' })
      if (res.ok) {
        await fetchAddresses()
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className="address-manager-wrapper">
      <div className="address-section-top">
        <div>
          <h3>Kayıtlı Teslimat Adreslerim</h3>
          <p>Siparişlerinizin hızlı teslimatı için adreslerinizi yönetin.</p>
        </div>
        <button type="button" className="btn btn-dark btn-sm" onClick={openNewModal}>
          + Yeni Adres Ekle
        </button>
      </div>

      {loading ? (
        <div className="address-loading">Adresleriniz yükleniyor…</div>
      ) : addresses.length === 0 ? (
        <div className="empty-address-card">
          <div className="addr-empty-icon">📍</div>
          <h4>Kayıtlı Adresiniz Bulunmuyor</h4>
          <p>Siparişlerinizi tek tıkla teslim alabilmek için hemen bir adres ekleyin.</p>
          <button type="button" className="btn btn-line btn-sm" onClick={openNewModal}>
            İlk Adresimi Ekle
          </button>
        </div>
      ) : (
        <div className="address-cards-grid">
          {addresses.map((addr) => (
            <div key={addr.id} className={`address-card ${addr.isDefault ? 'is-default' : ''}`}>
              <div className="addr-card-head">
                <div className="addr-title-group">
                  <span className="addr-tag-icon">📍</span>
                  <strong className="addr-title">{addr.title}</strong>
                </div>
                {addr.isDefault && (
                  <span className="default-address-badge">Varsayılan</span>
                )}
              </div>

              <div className="addr-card-body">
                <p className="addr-name"><b>{addr.fullName}</b></p>
                <p className="addr-phone">{addr.phone}</p>
                <p className="addr-text">{addr.address}</p>
                {(addr.district || addr.city) && (
                  <p className="addr-city-region">
                    {[addr.district, addr.city].filter(Boolean).join(' / ')}
                  </p>
                )}
              </div>

              <div className="addr-card-actions">
                <button
                  type="button"
                  className="btn-addr-action edit"
                  onClick={() => openEditModal(addr)}
                >
                  Düzenle
                </button>
                <button
                  type="button"
                  className="btn-addr-action delete"
                  onClick={() => handleDelete(addr.id)}
                >
                  Sil
                </button>
                {!addr.isDefault && (
                  <button
                    type="button"
                    className="btn-addr-action set-default"
                    onClick={() => handleSetDefault(addr.id)}
                  >
                    Varsayılan Yap
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ADRES EKLE / DÜZENLE MODAL */}
      {showModal && (
        <div className="address-modal-backdrop" onClick={closeModal}>
          <div className="address-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="addr-modal-head">
              <h4>{editingAddress ? 'Adresi Düzenle' : 'Yeni Adres Ekle'}</h4>
              <button type="button" className="addr-modal-close" onClick={closeModal}>
                ✕
              </button>
            </div>

            <form className="addr-modal-form" onSubmit={handleSubmit}>
              <div className="addr-form-row">
                <label>
                  <span>Adres Başlığı (Ev, İş vb.)</span>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Örn: Ev Adresim"
                    required
                  />
                </label>

                <label>
                  <span>Teslim Alacak Kişi (Ad Soyad)</span>
                  <input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Adınız ve Soyadınız"
                    required
                  />
                </label>
              </div>

              <div className="addr-form-row">
                <label>
                  <span>İletişim Telefonu</span>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0533 000 00 00"
                    required
                  />
                </label>

                <label>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Şehir (KKTC)</span>
                    <button
                      type="button"
                      onClick={handleGpsAssist}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--brand)',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      📡 Konumu Doğrula
                    </button>
                  </div>
                  <select value={city} onChange={(e) => setCity(e.target.value)}>
                    <option value="Lefkoşa">Lefkoşa</option>
                    <option value="Girne">Girne</option>
                    <option value="Gazimağusa">Gazimağusa</option>
                    <option value="Güzelyurt">Güzelyurt</option>
                    <option value="İskele">İskele</option>
                    <option value="Lefke">Lefke</option>
                  </select>
                  {gpsStatus && (
                    <small style={{ fontSize: '10.5px', color: gpsStatus.includes('✅') ? '#15803d' : '#b91c1c', marginTop: '2px', display: 'block' }}>
                      {gpsStatus}
                    </small>
                  )}
                </label>
              </div>

              <label>
                <span>İlçe / Bölge / Mahalle *</span>
                <input
                  value={district}
                  onChange={(e) => setDistrict(e.target.value)}
                  placeholder="Örn: Ortaköy, Dereboyu, Alsancak vb."
                  required
                />
              </label>

              <label>
                <span>Açık Adres (Cadde, Sokak, Bina No, Daire)</span>
                <textarea
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  rows={3}
                  placeholder="Kuryemizin adresi kolay bulabilmesi için detaylı tarif yazabilirsiniz"
                  required
                />
              </label>

              <label className="addr-checkbox-label">
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                />
                <span>Bu adresi varsayılan teslimat adresi olarak ayarla</span>
              </label>

              {error && <p className="pw-error">{error}</p>}

              <div className="addr-modal-actions">
                <button type="button" className="btn btn-line" onClick={closeModal}>
                  Vazgeç
                </button>
                <button type="submit" className="btn btn-dark" disabled={busy}>
                  {busy ? 'Kaydediliyor…' : editingAddress ? 'Güncelle' : 'Adresi Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
