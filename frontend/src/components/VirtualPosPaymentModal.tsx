import React, { useState, useEffect, useRef, useCallback } from 'react'
import { X, CreditCard, ShieldCheck, Lock, CheckCircle2, AlertCircle } from 'lucide-react'
import { lookupBin, initiate3DPayment, BinLookupResponseDto, InstallmentOptionDto } from '../api/virtualPos'
import { CARI_SEARCH_LIMIT, buildCariSearchQuery } from '../utils/cariRemoteSearch'
import SearchableCariSelect, { type CariOption } from './SearchableCariSelect'
import { fetchCustomersDropdown } from '../api/customers'

interface VirtualPosPaymentModalProps {
  isOpen: boolean
  onClose: () => void
  initialCustomerCode?: string
  initialAmount?: number
  onSuccess?: () => void
}

export default function VirtualPosPaymentModal({
  isOpen,
  onClose,
  initialCustomerCode = '',
  initialAmount = 0,
  onSuccess
}: VirtualPosPaymentModalProps) {
  const [customerCode, setCustomerCode] = useState(initialCustomerCode)
  /**
   * Cari listesi. `SearchableCariSelect` bu listeyi ZORUNLU istiyor; verilmedigi icin
   * bilesen `options.find` uzerinde patliyor ve tahsilat modali acildigi anda cari
   * secimi kullanilamaz oluyordu. Liste yalnizca modal ACIKKEN cekilir.
   */
  const [cariOptions, setCariOptions] = useState<CariOption[]>([])
  const [amount, setAmount] = useState(initialAmount > 0 ? String(initialAmount) : '')
  const [cardHolderName, setCardHolderName] = useState('')
  const [cardNumber, setCardNumber] = useState('')
  const [expMonth, setExpMonth] = useState('')
  const [expYear, setExpYear] = useState('')
  const [cvc, setCvc] = useState('')

  const [binData, setBinData] = useState<BinLookupResponseDto | null>(null)
  const [selectedInstallment, setSelectedInstallment] = useState<InstallmentOptionDto | null>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [htmlForm3D, setHtmlForm3D] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  useEffect(() => {
    if (initialCustomerCode) setCustomerCode(initialCustomerCode)
    if (initialAmount > 0) setAmount(String(initialAmount))
  }, [initialCustomerCode, initialAmount, isOpen])

  /**
   * CARI ARAMASI SUNUCUDA (2026-08-22) — Cari Ekstre'deki düzenin aynısı.
   *
   * Eskiden modal açılınca BÜTÜN cari listesi indiriliyordu (binlerce satır) ve kutu o
   * gelene kadar boş duruyordu. Artık her arama sunucuda süzülüyor, en fazla
   * CARI_SEARCH_LIMIT satır dönüyor.
   */
  const toCariOption = (c: any): CariOption => {
    const code = String(c?.customerCode ?? '').trim()
    const name = String(c?.name ?? '').trim()
    return {
      value: code,
      label: `(${code}) ${name || code}`,
      code,
      name,
      phone: String(c?.phone ?? '').trim(),
      type: 'customer',
      customerType: String(c?.customerType ?? '').trim()
    }
  }

  const cariRemoteSearch = useCallback(async (query: string, typeKey: string): Promise<CariOption[]> => {
    try {
      const list = await fetchCustomersDropdown({
        includeInactive: false,
        q: buildCariSearchQuery(query, typeKey),
        limit: CARI_SEARCH_LIMIT
      })
      return (list ?? []).map(toCariOption).filter((o) => o.value)
    } catch {
      // Liste alinamazsa secici bos kalir; odeme akisi cari kodu elle gelmisse yine calisir.
      return []
    }
  }, [])

  /**
   * Modal hazır gelen bir cari koduyla açılabiliyor. O kaydın ETİKETİNİ çözmek için tek
   * satırlık bir istek atılır — aksi halde kutu, arama yapılana kadar kodu çıplak gösterirdi.
   */
  useEffect(() => {
    if (!isOpen) return
    const code = String(initialCustomerCode ?? '').trim()
    if (!code) {
      setCariOptions([])
      return
    }
    const ac = new AbortController()
    void (async () => {
      try {
        const list = await fetchCustomersDropdown({ includeInactive: false, q: code, limit: 5, signal: ac.signal })
        setCariOptions((list ?? []).map(toCariOption).filter((o) => o.value))
      } catch {
        setCariOptions([])
      }
    })()
    return () => ac.abort()
  }, [isOpen, initialCustomerCode])

  // Live BIN Lookup trigger on first 6 digits
  useEffect(() => {
    const cleanCard = cardNumber.replace(/\D/g, '')
    if (cleanCard.length >= 6) {
      const bin6 = cleanCard.substring(0, 6)
      const amtNum = Number(amount) || 100
      void (async () => {
        try {
          const res = await lookupBin(bin6, amtNum)
          setBinData(res)
          if (res?.installments && res.installments.length > 0) {
            setSelectedInstallment(res.installments[0])
          }
        } catch {
          // ignore lookup error
        }
      })()
    } else {
      setBinData(null)
      setSelectedInstallment(null)
    }
  }, [cardNumber, amount])

  // Listen for 3D payment completion message from callback iframe/popup
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data === 'POS_PAYMENT_COMPLETE') {
        setHtmlForm3D(null)
        if (onSuccess) onSuccess()
        onClose()
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [onSuccess, onClose])

  if (!isOpen) return null

  const handleFormatCardNumber = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 16)
    const formatted = digits.replace(/(\d{4})/g, '$1 ').trim()
    setCardNumber(formatted)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const cleanCard = cardNumber.replace(/\D/g, '')
    const amtNum = Number(amount)
    if (!customerCode) {
      setError('Lütfen bir cari seçiniz.')
      return
    }
    if (!amtNum || amtNum <= 0) {
      setError('Lütfen geçerli bir tutar giriniz.')
      return
    }
    if (cleanCard.length < 15) {
      setError('Lütfen 16 haneli kredi kartı numarasını eksiksiz giriniz.')
      return
    }
    if (!expMonth || !expYear) {
      setError('Son kullanma tarihini (Ay/Yıl) giriniz.')
      return
    }
    if (cvc.length < 3) {
      setError('CVC kodunu giriniz.')
      return
    }

    try {
      setLoading(true)
      const res = await initiate3DPayment({
        customerCode,
        amount: amtNum,
        cardHolderName: cardHolderName.trim().toUpperCase(),
        cardNumber: cleanCard,
        expMonth,
        expYear,
        cvc,
        installmentCount: selectedInstallment?.merchantInstallment ?? 0,
        bankCode: binData?.bankCode
      })

      if (res.success && res.htmlForm) {
        setHtmlForm3D(res.htmlForm)
      } else {
        setError(res.message || '3D Ödeme başlatılamadı.')
      }
    } catch (err: any) {
      setError(err?.message || 'Ödeme işlemi sırasında bir hata oluştu.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-xl">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white leading-tight">Sanal POS ile Kredi Kartı Ödeme</h3>
              <p className="text-xs text-slate-400">3D Secure 256-Bit SSL Güvenli Tahsilat</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5 custom-scrollbar">
          {error && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs font-semibold text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {htmlForm3D ? (
            <div className="space-y-3">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 shrink-0 text-blue-600" />
                <span>Bankanın 3D Secure SMS doğrulama sayfasına yönlendiriliyorsunuz...</span>
              </div>
              <iframe
                ref={iframeRef}
                srcDoc={htmlForm3D}
                className="w-full h-96 border border-gray-200 rounded-xl shadow-inner"
                title="3D Secure"
              />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Cari Selection & Amount */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wide mb-1">
                    Tahsilat Yapılacak Cari
                  </label>
                  <SearchableCariSelect
                    value={customerCode}
                    onChange={(val) => setCustomerCode(val)}
                    options={cariOptions}
                    remoteSearch={cariRemoteSearch}
                    remoteLimit={CARI_SEARCH_LIMIT}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wide mb-1">
                    Çekim Tutarı (TL)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00 TL"
                    className="w-full h-10 px-3 text-sm font-bold text-slate-900 bg-slate-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                    required
                  />
                </div>
              </div>

              {/* Card Details */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-emerald-600" /> Kart Bilgileri
                  </span>
                  {binData && (
                    <span className="px-2.5 py-0.5 text-[11px] font-bold bg-emerald-100 text-emerald-800 rounded-full">
                      {binData.bankName} ({binData.cardType1})
                    </span>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-600 mb-1">Kart Üzerindeki İsim</label>
                  <input
                    type="text"
                    value={cardHolderName}
                    onChange={(e) => setCardHolderName(e.target.value.toUpperCase())}
                    placeholder="AD SOYAD"
                    className="w-full h-9 px-3 text-xs font-semibold uppercase bg-white border border-gray-200 rounded-lg focus:outline-none focus:border-blue-600"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-600 mb-1">Kart Numarası</label>
                  <input
                    type="text"
                    value={cardNumber}
                    onChange={(e) => handleFormatCardNumber(e.target.value)}
                    placeholder="0000 0000 0000 0000"
                    className="w-full h-9 px-3 text-sm font-mono tracking-wider font-semibold bg-white border border-gray-200 rounded-lg focus:outline-none focus:border-blue-600"
                    maxLength={19}
                    required
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-600 mb-1">Son Kullanma Ay</label>
                    <select
                      value={expMonth}
                      onChange={(e) => setExpMonth(e.target.value)}
                      className="w-full h-9 px-2 text-xs font-semibold bg-white border border-gray-200 rounded-lg focus:outline-none focus:border-blue-600"
                      required
                    >
                      <option value="">Ay</option>
                      {/* padStart: JavaScript'te String.prototype.padLeft YOK, cagrilinca TypeError atiyordu. */}
                      {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-600 mb-1">Son Kullanma Yıl</label>
                    <select
                      value={expYear}
                      onChange={(e) => setExpYear(e.target.value)}
                      className="w-full h-9 px-2 text-xs font-semibold bg-white border border-gray-200 rounded-lg focus:outline-none focus:border-blue-600"
                      required
                    >
                      <option value="">Yıl</option>
                      {Array.from({ length: 10 }, (_, i) => String(2026 + i)).map((y) => (
                        <option key={y} value={y.slice(2)}>{y}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-600 mb-1">CVC / CVV</label>
                    <input
                      type="password"
                      value={cvc}
                      onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      placeholder="***"
                      className="w-full h-9 px-3 text-xs font-mono font-bold bg-white border border-gray-200 rounded-lg focus:outline-none focus:border-blue-600"
                      maxLength={4}
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Installment Selection Table */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wide mb-2">
                  Taksit Seçenekleri {binData && `(${binData.bankName})`}
                </label>
                <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100 max-h-48 overflow-y-auto custom-scrollbar">
                  {(!binData?.installments || binData.installments.length === 0) ? (
                    <div
                      onClick={() => setSelectedInstallment({ merchantInstallment: 0, bankInstallment: 0, installmentText: 'Tek Çekim', minAmount: 1, totalAmount: Number(amount) || 0, monthlyAmount: Number(amount) || 0, description: 'Tek Çekim' })}
                      className={`p-3 text-xs font-semibold flex items-center justify-between cursor-pointer transition-colors ${!selectedInstallment || selectedInstallment.merchantInstallment === 0 ? 'bg-emerald-50 border-emerald-500 text-emerald-900' : 'hover:bg-gray-50'}`}
                    >
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className={`w-4 h-4 ${!selectedInstallment || selectedInstallment.merchantInstallment === 0 ? 'text-emerald-600' : 'text-gray-300'}`} />
                        <span>Tek Çekim (Peşin)</span>
                      </div>
                      <span className="font-bold">{Number(amount || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL</span>
                    </div>
                  ) : (
                    binData.installments.map((inst) => {
                      const isSelected = selectedInstallment?.merchantInstallment === inst.merchantInstallment
                      return (
                        <div
                          key={inst.merchantInstallment}
                          onClick={() => setSelectedInstallment(inst)}
                          className={`p-3 text-xs font-semibold flex items-center justify-between cursor-pointer transition-colors ${isSelected ? 'bg-emerald-50 text-emerald-900' : 'hover:bg-gray-50'}`}
                        >
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className={`w-4 h-4 ${isSelected ? 'text-emerald-600' : 'text-gray-300'}`} />
                            <span>{inst.installmentText}</span>
                            {inst.description && <span className="text-[10px] text-gray-500">({inst.description})</span>}
                          </div>
                          <div className="text-right">
                            <span className="font-bold block">{inst.totalAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL</span>
                            {inst.merchantInstallment > 1 && (
                              <span className="text-[10px] text-slate-500 block">Aylık {inst.monthlyAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL x {inst.merchantInstallment}</span>
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                {loading ? (
                  <span>3D Güvenli Ödeme Başlatılıyor...</span>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>3D Güvenli Ödeme Yap ({(selectedInstallment?.totalAmount ?? Number(amount) ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL)</span>
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
