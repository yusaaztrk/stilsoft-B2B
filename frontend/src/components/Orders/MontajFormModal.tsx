import React, { useState, useEffect } from 'react'
import { MontajSnapshot } from '../../contexts/CartContext'
import { PHONE_FORMAT_MESSAGE, PHONE_MAX_LENGTH, PHONE_PATTERN, formatPhoneNumber } from '../../utils/phone'
import { MONTAJ_REGIONS, resolveRegionFromCity } from '../../constants/locations'
import { fetchCustomerByCode } from '../../api/customers'

/** Ürüne değil, montajın gideceği yere ait alanlar — ikinci üründe tekrar yazılmaması gerekenler. */
type MontajAddressMemory = Pick<
  MontajSnapshot,
  'isimSoyisim' | 'telefon' | 'adres' | 'bolge' | 'bayiAciklama'
>

/**
 * Aynı sayfada ikinci/üçüncü montajlı ürün eklenirken adresin tekrar sorulmaması için son girilen
 * bilgiler burada tutulur.
 *
 * Bilerek modül düzeyinde bir değişken: istenen davranış "sayfa yenilenene kadar hatırla" —
 * localStorage kullanılsa yarın açıldığında da dolu gelir, bir state'e taşınsa modal her
 * kapandığında kaybolurdu. Sayfa yenilenince modül yeniden yüklenir ve hafıza sıfırlanır.
 *
 * Bayi bazında saklanır: cari değişince önceki bayinin son müşteri adresi yeni bayiye taşınmaz.
 */
let rememberedDealerKey: string | null = null
let rememberedAddress: MontajAddressMemory | null = null

const dealerKeyOf = (dealerName: string) => (dealerName || '').trim().toLocaleUpperCase('tr-TR')

function rememberMontajAddress(dealerName: string, details: MontajSnapshot) {
  rememberedDealerKey = dealerKeyOf(dealerName)
  rememberedAddress = {
    isimSoyisim: details.isimSoyisim,
    telefon: details.telefon,
    adres: details.adres,
    bolge: details.bolge,
    bayiAciklama: details.bayiAciklama
  }
}

/** Yalnızca aynı bayi için hatırlar; cari değişmişse null döner, yani ayrıca sıfırlamak gerekmez. */
function recallMontajAddress(dealerName: string): MontajAddressMemory | null {
  if (!rememberedAddress) return null
  return rememberedDealerKey === dealerKeyOf(dealerName) ? rememberedAddress : null
}

export type MontajFormModalProps = {
  isOpen: boolean
  onClose: () => void
  onSave: (details: MontajSnapshot) => void
  initialValues?: Partial<MontajSnapshot>
  dealerName: string
  productName: string
  quantity: number
  maxQuantity?: number
  submitButtonText?: string
  /**
   * Seçili carinin KARTINDAKİ bilgiler. Yeni montajda alanları önceden doldurmak için
   * kullanılır; kullanıcı üstüne yazabilir.
   *
   * En DÜŞÜK öncelikli kaynak: var olan bir montaj düzenleniyorsa onun değerleri,
   * aynı sayfada daha önce girilmiş bir adres varsa o kazanır. Yani bu alan hiçbir
   * zaman elle yazılmış bir bilgiyi ezmez.
   */
  customerDefaults?: {
    isimSoyisim?: string
    telefon?: string
    adres?: string
    bolge?: string
    /** "MEHMET YILMAZ kartından" gibi — formda küçük bir not olarak gösterilir. */
    kaynakEtiketi?: string
  }
  /**
   * "Adres Bilgilerini Getir" düğmesinin okuyacağı cari kodu (2026-09-17 kullanıcı isteği).
   * Verilirse düğme kartı o anda sunucudan okur; verilmezse `customerDefaults` kullanılır.
   * İkisi de yoksa düğme görünmez.
   */
  customerCode?: string
}

export const MontajFormModal: React.FC<MontajFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialValues,
  dealerName,
  productName,
  quantity,
  maxQuantity,
  submitButtonText = 'Kaydet ve Uygula',
  customerDefaults,
  customerCode
}) => {
  const maxQty = Math.max(1, maxQuantity ?? quantity ?? 1)

  const [form, setForm] = useState<MontajSnapshot>({
    bayiAdi: dealerName,
    urunAdi: productName,
    miktar: Math.min(maxQty, Math.max(1, quantity)),
    isimSoyisim: '',
    telefon: '',
    adres: '',
    bolge: '',
    bayiAciklama: ''
  })
  const [error, setError] = useState<string | null>(null)
  const [kartBilgisiKullanildi, setKartBilgisiKullanildi] = useState(false)
  const [kartGetiriliyor, setKartGetiriliyor] = useState(false)
  const [kartMesaji, setKartMesaji] = useState<string | null>(null)

  const kartKodu = String(customerCode ?? '').trim()
  const kartDugmesiGorunur = Boolean(kartKodu || customerDefaults)

  /**
   * "ADRES BİLGİLERİNİ GETİR" (2026-09-17 kullanıcı isteği: "basar basmaz carisinde yazılı
   * telefon ve adres bilgileri ve isim gelecek").
   *
   * Açılıştaki otomatik doldurmadan farkı: kullanıcı açıkça istediği için alanların ÜSTÜNE
   * YAZAR (elle girilmiş ya da hatırlanan değer olsa bile). Kart o anda sunucudan okunur ki
   * cari kartı az önce güncellendiyse eski bilgi gelmesin; okunamazsa sayfanın hazır
   * `customerDefaults` değeri kullanılır.
   *
   * Adres biçimi diğer iki kaynakla aynı: "adres / ilçe" (formda ayrı ilçe alanı yok),
   * Bölge ilden çözülür; eşleşmezse mevcut seçim korunur, uydurulmaz.
   */
  const kartBilgileriniGetir = async () => {
    setError(null)
    setKartMesaji(null)
    setKartGetiriliyor(true)
    try {
      let kaynak: { isimSoyisim?: string; telefon?: string; adres?: string; bolge?: string } | null = null

      if (kartKodu) {
        try {
          const c = await fetchCustomerByCode(kartKodu)
          if (c) {
            const adresSatiri = String((c as any)?.address ?? '').trim()
            const ilce = String((c as any)?.district ?? '').trim()
            kaynak = {
              isimSoyisim: String((c as any)?.name ?? '').trim(),
              telefon: String((c as any)?.phone ?? '').trim(),
              adres: [adresSatiri, ilce].filter(Boolean).join(' / '),
              bolge: resolveRegionFromCity((c as any)?.city)
            }
          }
        } catch {
          kaynak = null
        }
      }

      if (!kaynak && customerDefaults) kaynak = customerDefaults

      const doluAlanVar = Boolean(kaynak && (kaynak.isimSoyisim || kaynak.telefon || kaynak.adres))
      if (!kaynak || !doluAlanVar) {
        setError('Cari kartında ad, telefon veya adres bilgisi bulunamadı.')
        return
      }

      setForm((prev) => ({
        ...prev,
        isimSoyisim: (kaynak!.isimSoyisim || prev.isimSoyisim || '').toLocaleUpperCase('tr-TR'),
        telefon: kaynak!.telefon ? formatPhoneNumber(kaynak!.telefon) : prev.telefon,
        adres: (kaynak!.adres || prev.adres || '').toLocaleUpperCase('tr-TR'),
        bolge: kaynak!.bolge || prev.bolge
      }))

      const eksikler = [
        !kaynak.isimSoyisim ? 'isim' : '',
        !kaynak.telefon ? 'telefon' : '',
        !kaynak.adres ? 'adres' : '',
        !kaynak.bolge ? 'bölge' : ''
      ].filter(Boolean)
      setKartBilgisiKullanildi(false)
      setKartMesaji(
        eksikler.length
          ? `Cari kartındaki bilgiler getirildi. Kartta olmadığı için elle doldurun: ${eksikler.join(', ')}.`
          : 'Cari kartındaki isim, telefon, adres ve bölge getirildi.'
      )
    } finally {
      setKartGetiriliyor(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      const initialQty = initialValues?.miktar ?? quantity ?? 1
      const cappedQty = Math.min(maxQty, Math.max(1, initialQty))

      // Var olan bir montaj düzenleniyorsa gelen değerler kazanır. Yeni montajda alanlar boş
      // gelir; o zaman aynı sayfada en son girilen adres otomatik doldurulur.
      const isEditingExisting = Boolean(
        (initialValues?.adres || '').trim() || (initialValues?.isimSoyisim || '').trim()
      )
      /*
        Cari kartından gelen bilgiler EN ALTTA duruyor: önce varsa düzenlenen montajın
        kendi değerleri, sonra aynı sayfada en son girilen adres, en son cari kartı.
        Böylece otomatik doldurma elle yazılmış hiçbir şeyin üstüne yazmıyor.
      */
      const kartBilgisi: Partial<MontajSnapshot> = customerDefaults
        ? {
            ...(customerDefaults.isimSoyisim ? { isimSoyisim: customerDefaults.isimSoyisim } : {}),
            ...(customerDefaults.telefon ? { telefon: customerDefaults.telefon } : {}),
            ...(customerDefaults.adres ? { adres: customerDefaults.adres } : {}),
            ...(customerDefaults.bolge ? { bolge: customerDefaults.bolge } : {})
          }
        : {}

      const hatirlanan = recallMontajAddress(dealerName) ?? {}

      const seed: Partial<MontajSnapshot> = isEditingExisting
        ? initialValues ?? {}
        : { ...kartBilgisi, ...(initialValues ?? {}), ...hatirlanan }

      // Not yalnızca gerçekten karttan bir şey doldurduysak gösterilir.
      const kartKullanildi = !isEditingExisting
        && Object.keys(kartBilgisi).length > 0
        && Object.entries(kartBilgisi).some(([k, v]) => {
          const ustuneYazan = (hatirlanan as any)[k] ?? (initialValues as any)?.[k]
          return !String(ustuneYazan ?? '').trim() && String(v ?? '').trim()
        })
      setKartBilgisiKullanildi(kartKullanildi)

      setForm({
        bayiAdi: initialValues?.bayiAdi || dealerName,
        urunAdi: initialValues?.urunAdi || productName,
        miktar: cappedQty,
        isimSoyisim: (seed.isimSoyisim || '').toLocaleUpperCase('tr-TR'),
        telefon: formatPhoneNumber(seed.telefon || ''),
        adres: (seed.adres || '').toLocaleUpperCase('tr-TR'),
        bolge: seed.bolge || '',
        bayiAciklama: (seed.bayiAciklama || '').toLocaleUpperCase('tr-TR')
      })
      setError(null)
      setKartMesaji(null)
    }
  }, [isOpen, initialValues, dealerName, productName, quantity, maxQuantity, customerDefaults])

  if (!isOpen) return null

  const handleSave = () => {
    if (!form.isimSoyisim?.trim() || !form.telefon?.trim() || !form.adres?.trim() || !form.bolge?.trim()) {
      setError('Lütfen tüm zorunlu (*) alanları doldurunuz.')
      return
    }
    if (!PHONE_PATTERN.test(form.telefon.trim())) {
      setError(PHONE_FORMAT_MESSAGE)
      return
    }
    const finalMiktar = Math.max(1, Number(form.miktar || 1))
    if (finalMiktar > maxQty) {
      setError(`Montaj miktarı, kalendeki ürün adedinden (${maxQty}) fazla olamaz.`)
      return
    }
    setError(null)
    const details: MontajSnapshot = {
      ...form,
      bayiAdi: dealerName,
      urunAdi: productName,
      isimSoyisim: form.isimSoyisim.trim().toLocaleUpperCase('tr-TR'),
      adres: form.adres.trim().toLocaleUpperCase('tr-TR'),
      bayiAciklama: (form.bayiAciklama || '').trim().toLocaleUpperCase('tr-TR'),
      miktar: finalMiktar
    }

    // Sıradaki montajlı ürün bu bilgilerle açılsın.
    rememberMontajAddress(dealerName, details)
    onSave(details)
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-gray-200 overflow-hidden animate-in fade-in zoom-in duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-orange-50 to-amber-50/50">
          <div className="flex items-center gap-2 text-base font-bold text-gray-800">
            <span className="text-lg">🛠️</span>
            <span>Montaj Tanım & Adres Bilgileri</span>
          </div>
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-white transition-colors"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 max-h-[75vh] overflow-y-auto">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-semibold text-red-600">
              {error}
            </div>
          )}

          {kartMesaji && (
            <div className="mb-4 p-3 rounded-lg bg-sky-50 border border-sky-200 text-xs font-semibold text-sky-800">
              {kartMesaji} Montaj başka bir adrese gidecekse alanları değiştirin.
            </div>
          )}

          {kartBilgisiKullanildi && (
            <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-800">
              Adres ve bölge {customerDefaults?.kaynakEtiketi || 'cari kartından'} otomatik dolduruldu.
              Montaj başka bir adrese gidecekse alanları değiştirin.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-3">
              <label className="block text-xs font-bold text-gray-600 mb-1">Bayi Adı</label>
              <input
                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg bg-gray-50 text-gray-700 font-medium"
                value={form.bayiAdi || dealerName}
                disabled
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-gray-600 mb-1">Ürün Adı</label>
              <input
                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg bg-gray-50 text-gray-700 font-medium"
                value={form.urunAdi || productName}
                disabled
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1 flex items-center justify-between">
                <span>Miktar</span>
                <span className="text-[10px] text-gray-400 font-semibold">(Maks: {maxQty})</span>
              </label>
              <input
                type="number"
                min={1}
                max={maxQty}
                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg bg-white font-medium focus:ring-2 focus:ring-orange-400 focus:outline-none"
                value={form.miktar || 1}
                onChange={(e) => {
                  const val = Number(e.target.value)
                  if (val > maxQty) {
                    setForm((prev) => ({ ...prev, miktar: maxQty }))
                    setError(`Montaj miktarı, kalendeki ürün adedinden (${maxQty}) fazla olamaz.`)
                  } else if (val < 1) {
                    setForm((prev) => ({ ...prev, miktar: 1 }))
                    setError('Miktar en az 1 olmalıdır.')
                  } else {
                    setError(null)
                    setForm((prev) => ({ ...prev, miktar: val }))
                  }
                }}
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-gray-600 mb-1">
                İsim Soyisim <span className="text-red-500">*</span>
              </label>
              <input
                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg bg-white font-medium focus:ring-2 focus:ring-orange-400 focus:outline-none uppercase"
                placeholder="Müşteri Adı Soyadı"
                value={form.isimSoyisim || ''}
                onChange={(e) => setForm((prev) => ({ ...prev, isimSoyisim: e.target.value }))}
                onBlur={() => setForm((prev) => ({ ...prev, isimSoyisim: (prev.isimSoyisim || '').toLocaleUpperCase('tr-TR') }))}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">
                Telefon <span className="text-red-500">*</span>
              </label>
              <input
                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg bg-white font-medium focus:ring-2 focus:ring-orange-400 focus:outline-none"
                placeholder="0555 555 5555 555"
                maxLength={PHONE_MAX_LENGTH}
                value={form.telefon || ''}
                onChange={(e) => {
                  const formatted = formatPhoneNumber(e.target.value)
                  setForm((prev) => ({ ...prev, telefon: formatted }))
                }}
              />
            </div>
            <div className="md:col-span-3">
              <label className="block text-xs font-bold text-gray-600 mb-1">
                Adres <span className="text-red-500">*</span>
              </label>
              <input
                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg bg-white font-medium focus:ring-2 focus:ring-orange-400 focus:outline-none uppercase"
                placeholder="Montajın yapılacağı adres"
                value={form.adres || ''}
                onChange={(e) => setForm((prev) => ({ ...prev, adres: e.target.value }))}
                onBlur={() => setForm((prev) => ({ ...prev, adres: (prev.adres || '').toLocaleUpperCase('tr-TR') }))}
              />
            </div>
            <div className="md:col-span-3">
              <label className="block text-xs font-bold text-gray-600 mb-1">
                Bölge <span className="text-red-500">*</span>
              </label>
              <select
                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg bg-white font-medium focus:ring-2 focus:ring-orange-400 focus:outline-none"
                value={form.bolge || ''}
                onChange={(e) => setForm((prev) => ({ ...prev, bolge: e.target.value }))}
              >
                <option value="">Seçiniz...</option>
                {MONTAJ_REGIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="block text-xs font-bold text-gray-600 mb-1">Bayi Açıklama</label>
              <input
                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg bg-white font-medium focus:ring-2 focus:ring-orange-400 focus:outline-none uppercase"
                placeholder="Montajla ilgili ilave açıklama / not"
                value={form.bayiAciklama || ''}
                onChange={(e) => setForm((prev) => ({ ...prev, bayiAciklama: e.target.value }))}
                onBlur={() => setForm((prev) => ({ ...prev, bayiAciklama: (prev.bayiAciklama || '').toLocaleUpperCase('tr-TR') }))}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 flex items-center gap-2 bg-gray-50">
          {kartDugmesiGorunur && (
            <button
              type="button"
              onClick={() => void kartBilgileriniGetir()}
              disabled={kartGetiriliyor}
              className="px-4 py-2 text-xs font-semibold rounded-xl border border-sky-200 bg-white hover:bg-sky-50 text-sky-700 transition-all active:scale-95 flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-wait"
              title="Seçili carinin kartındaki isim, telefon ve adresi forma getirir"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              {kartGetiriliyor ? 'Getiriliyor…' : 'Adres Bilgilerini Getir'}
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-xl border border-gray-200 bg-white hover:bg-gray-100 text-gray-700 transition-all active:scale-95"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all active:scale-95 flex items-center gap-1.5"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            {submitButtonText}
          </button>
        </div>
      </div>
    </div>
  )
}
