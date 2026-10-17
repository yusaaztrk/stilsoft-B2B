import { useEffect, useState } from 'react'
import Modal from './Modal'
import { apiJson } from '../api/client'
import { sanitizePhone, toTurkishUpper } from '../utils/formInput'

interface QuickAddCustomerModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (customer: { customerCode: string; name: string; phone: string; address: string }) => void
}

export default function QuickAddCustomerModal({ isOpen, onClose, onSuccess }: QuickAddCustomerModalProps) {
  const [customerCode, setCustomerCode] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [taxOffice, setTaxOffice] = useState('')
  const [taxNumber, setTaxNumber] = useState('')
  const [city, setCity] = useState('')
  const [district, setDistrict] = useState('')
  const [address, setAddress] = useState('')

  const [loadingCode, setLoadingCode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  /*
    FİYAT GRUBU + KREDİ LİMİTİ (2026-09-08 canlı hata).

    Bu modal cariyi `priceGroupId` GÖNDERMEDEN ve `creditLimit: 0` ile açıyordu. Sonuç:
      - fiyat grubu BOŞ  → cari hiçbir gruba bağlı değil,
      - `invoiceType` FATURA'da kalıyor → `AccountRole = Normal`,
      - kredi limiti 0   → `CreditLimitService` "projected > creditLimit" diyor ve
        sıfır limitte HER tutar limit aşımı sayılıyor; o cariye sipariş açılamıyor.

    Sunucu (`CustomersController.Create`) fiyat grubu 4-6 geldiğinde `invoiceType`'ı
    "ACIK" yapıp hesabı `OpenMain` kuruyor — mağaza sipariş ekranı doğru çalışıyordu
    çünkü grup 4'ü gönderiyor. Buradan açılan cariler o dönüşümü hiç görmüyordu.

    Doğru olan yol MagazaSiparisPage: grup **kod 4**, limit **300.000**. Burası artık
    onu birebir taklit ediyor.
  */
  const [priceGroups, setPriceGroups] = useState<any[]>([])
  const [priceGroupId, setPriceGroupId] = useState('')
  const [priceGroupsLoading, setPriceGroupsLoading] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setCustomerCode('')
      setName('')
      setPhone('')
      setTaxOffice('')
      setTaxNumber('')
      setCity('')
      setDistrict('')
      setAddress('')
      setError('')
      setPriceGroupId('')
      return
    }

    const ac = new AbortController()

    ;(async () => {
      setPriceGroupsLoading(true)
      try {
        const res = await apiJson<any>('/api/erp/price-groups', { signal: ac.signal })
        const list: any[] = res?.data ?? res ?? []
        const groups = Array.isArray(list) ? list : []
        setPriceGroups(groups)

        // Yeni müşteri carisi VARSAYILAN OLARAK "Açık 4". Mağaza sipariş ekranındaki
        // `defaultPriceGroupIdForNewCustomer` ile aynı kural.
        const pg4 = groups.find((x: any) => Number(x?.code ?? 0) === 4)
        if (pg4?.id) setPriceGroupId(String(pg4.id))
      } catch {
        setPriceGroups([])
      } finally {
        setPriceGroupsLoading(false)
      }
    })()

    ;(async () => {
      setLoadingCode(true)
      try {
        /*
          CARİ TİPİ ASCII GÖNDERİLİR (2026-08-31 canlı hata: "cari kodu oluşmuyor,
          yazmıyor buraya").

          Eskiden `M%C3%BCsteri` gönderiliyordu — çözümü "Müsteri", yani ü var ama ş YOK.
          Sunucudaki `NormalizeCustomerType` yalnızca "müşteri" ya da "musteri" kabul ediyor;
          bu yazım ikisine de uymayıp ön ek çözülemiyor ve uç kod üretemiyordu.

          ASCII "musteri" hem normalize listesinde var hem de URL kodlaması belirsizliği
          taşımıyor. Türkçe harf, taşındığı her katmanda yeni bir kaçış hatası riski demek.
        */
        const res = await apiJson<any>('/api/erp/customers/next-code?customerType=musteri', { signal: ac.signal })
        // Yanıt gövdesi büyük/küçük harfli gelebiliyor; ikisini de oku.
        const code = String(res?.data?.customerCode ?? res?.data?.CustomerCode ?? res?.customerCode ?? '').trim()
        if (code) setCustomerCode(code)
        else setError('Cari kodu alınamadı. Kaydetmeden önce kodu elle girin.')
      } catch {
        // SESSİZ YUTMA YOK: kod gelmezse kayıt koda bağlanmıyor ve servis kaydı carisiz
        // kalıyor. Kullanıcı bunu kaydetmeden önce görmeli.
        setError('Cari kodu alınamadı. Kaydetmeden önce kodu elle girin.')
      } finally {
        setLoadingCode(false)
      }
    })()

    return () => ac.abort()
  }, [isOpen])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('İsim-Soyisim zorunludur.')
      return
    }
    if (!phone.trim()) {
      setError('Telefon numarası zorunludur.')
      return
    }
    if (!address.trim()) {
      setError('Adres zorunludur.')
      return
    }
    /*
      GRUPSUZ KAYIT YASAK. Eskiden fiyat grubu hiç gönderilmiyordu ve cari sessizce
      grupsuz açılıyordu; hata ancak aylar sonra "bu cariye sipariş açılmıyor" olarak
      ortaya çıkıyordu. Grup gelmediyse kullanıcı bunu KAYDETMEDEN önce görmeli.
    */
    if (!priceGroupId.trim()) {
      setError(priceGroupsLoading
        ? 'Fiyat grupları yükleniyor, lütfen bekleyin.'
        : 'Fiyat grubu alınamadı. Bu haliyle kaydedilen cari eksik olur — sayfayı yenileyip tekrar deneyin.')
      return
    }

    try {
      setSaving(true)
      setError('')

      const payload: Record<string, any> = {
        customerType: 'müşteri',
        // Sunucu grup 4-6 görünce bunu "ACIK"a çeviriyor; burada FATURA yazmak
        // mağaza sipariş yolundaki `createEndCustomer` ile aynı davranış.
        invoiceType: 'FATURA',
        isActive: true,
        discountRate: 0,
        creditLimit: 300000,
        currencyTypeId: 1,
        productCategoryIds: [],
        priceGroupId: priceGroupId.trim(),
        name: toTurkishUpper(name.trim()),
        phone: sanitizePhone(phone.trim()),
        address: toTurkishUpper(address.trim()),
      }

      if (customerCode.trim()) payload.customerCode = customerCode.trim()
      if (taxOffice.trim()) payload.taxOffice = toTurkishUpper(taxOffice.trim())
      if (taxNumber.trim()) payload.taxNumber = toTurkishUpper(taxNumber.trim())
      if (city.trim()) payload.city = toTurkishUpper(city.trim())
      if (district.trim()) payload.district = toTurkishUpper(district.trim())

      const res = await apiJson<any>('/api/erp/customers', {
        method: 'POST',
        body: JSON.stringify(payload)
      })

      const assignedCode = String(
        res?.data?.customerCode ?? res?.data?.CustomerCode ?? res?.customerCode ?? customerCode
      ).trim()

      /*
        KODSUZ DÖNMEK YASAK. Boş kod dönerse çağıran ekran `dealerCode` alanına boş yazıyor;
        cari ERP'de oluşuyor ama servis kaydı ona BAĞLANMIYOR. Sonuç: iş teslim ediliyor,
        faturası kesilemiyor. Canlıda 40 kayıt bu yüzden carisiz kaldı.
      */
      if (!assignedCode) {
        setError('Cari oluşturuldu ancak kodu alınamadı. Cari listesinden kodu bulup kayda elle bağlayın.')
        setSaving(false)
        return
      }

      onSuccess({
        customerCode: assignedCode,
        name: toTurkishUpper(name.trim()),
        phone: sanitizePhone(phone.trim()),
        address: toTurkishUpper(address.trim())
      })
      onClose()
    } catch (err: any) {
      console.error(err)
      setError(err?.message || 'Müşteri kaydedilirken bir hata oluştu.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Yeni Müşteri Ekle">
      <form onSubmit={handleSave} className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3.5 py-2.5 rounded-lg font-medium">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="space-y-1">
            <label className="font-semibold text-gray-700">Cari Kodu</label>
            <input
              type="text"
              value={customerCode}
              onChange={(e) => setCustomerCode(e.target.value)}
              placeholder={loadingCode ? 'Kodu yükleniyor...' : '120-03-000008'}
              className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg w-full font-mono text-gray-700 font-semibold focus:outline-none"
            />
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-gray-700">
              İsim-Soyisim <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(toTurkishUpper(e.target.value))}
              placeholder="MÜŞTERİ AD SOYAD"
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg w-full focus:outline-none focus:ring-1 focus:ring-blue-600 uppercase font-medium"
            />
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-gray-700">
              Telefon <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(sanitizePhone(e.target.value))}
              placeholder="0555 555 5555"
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg w-full focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-gray-700">Fiyat Grubu</label>
            <select
              value={priceGroupId}
              onChange={(e) => setPriceGroupId(e.target.value)}
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg w-full focus:outline-none focus:ring-1 focus:ring-blue-600 font-medium"
            >
              <option value="">{priceGroupsLoading ? 'Yükleniyor...' : 'Seçiniz...'}</option>
              {priceGroups.map((pg: any) => (
                <option key={String(pg.id)} value={String(pg.id)}>{pg.name ?? pg.code}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-gray-700">Vergi Dairesi</label>
            <input
              type="text"
              value={taxOffice}
              onChange={(e) => setTaxOffice(toTurkishUpper(e.target.value))}
              placeholder="VERGİ DAİRESİ"
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg w-full focus:outline-none focus:ring-1 focus:ring-blue-600 uppercase font-medium"
            />
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-gray-700">Vergi No</label>
            <input
              type="text"
              value={taxNumber}
              onChange={(e) => setTaxNumber(toTurkishUpper(e.target.value))}
              placeholder="VERGİ VEYA TC NO"
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg w-full focus:outline-none focus:ring-1 focus:ring-blue-600 uppercase font-medium"
            />
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-gray-700">İl</label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(toTurkishUpper(e.target.value))}
              placeholder="İL"
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg w-full focus:outline-none focus:ring-1 focus:ring-blue-600 uppercase font-medium"
            />
          </div>

          <div className="space-y-1 md:col-span-2">
            <label className="font-semibold text-gray-700">İlçe</label>
            <input
              type="text"
              value={district}
              onChange={(e) => setDistrict(toTurkishUpper(e.target.value))}
              placeholder="İLÇE"
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg w-full focus:outline-none focus:ring-1 focus:ring-blue-600 uppercase font-medium"
            />
          </div>

          <div className="space-y-1 md:col-span-2">
            <label className="font-semibold text-gray-700">
              Adres <span className="text-red-500">*</span>
            </label>
            <textarea
              rows={3}
              value={address}
              onChange={(e) => setAddress(toTurkishUpper(e.target.value))}
              placeholder="AÇIK ADRES..."
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg w-full focus:outline-none focus:ring-1 focus:ring-blue-600 resize-none uppercase font-medium"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t pt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-xs font-semibold rounded-lg hover:bg-gray-50 transition cursor-pointer"
          >
            Vazgeç
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition cursor-pointer"
          >
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
