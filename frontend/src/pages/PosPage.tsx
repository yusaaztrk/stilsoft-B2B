import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom'
import { fetchCustomersDropdown, type CustomerDto } from '../api/customers'
import { fetchCustomerLedger } from '../api/customerLedger'
import { fetchAccountingPeriods } from '../services/accountingPeriodService'
import { fetchBinLookup, type BinLookupInstallmentRuleDto } from '../api/bins'
import { fetchInstallmentRules, type InstallmentRuleDto } from '../api/installmentRules'
import { initiate3DPayment, fetchPaymentStatus, type PosPaymentStatusDto } from '../api/virtualPos'
import PosReportPage from './PosReportPage'
import InstallmentRulesAdminPage from './InstallmentRulesAdminPage'
import { type BankVariant, type ThemeVariant } from '../app/components/CreditCard'
import {
  POS_CANCEL_RETURN_TEXT,
  POS_DEALER_SALES_CONTRACT_TEXT,
  POS_PRIVACY_TEXT,
  POS_SERVICE_TERMS_TEXT
} from '../constants/posLegalTexts'
import { PHONE_MAX_DIGITS } from '../utils/phone'

// Redesigned POS sub-components
import PaymentHeader from '../components/Pos/PaymentHeader'
import CustomerSelector from '../components/Pos/CustomerSelector'
import CustomerBalanceCard from '../components/Pos/CustomerBalanceCard'
import CreditCardPreview from '../components/Pos/CreditCardPreview'
import PaymentForm from '../components/Pos/PaymentForm'
import InstallmentSelector from '../components/Pos/InstallmentSelector'
import SecurityTrustBar from '../components/Pos/SecurityTrustBar'
import PaymentInfoTabs from '../components/Pos/PaymentInfoTabs'

type LayoutContext = {
  activeMenuId: string
  activeTabId?: string
  setActiveTabId?: (id?: string) => void
}

type PosNavigationState = {
  source?: 'invoice_mark_paid' | 'invoice_create' | string
  invoiceId?: number | null
  invoiceNo?: string | null
  customerCode?: string | null
  amount?: number | null
  posBankAccountDefinitionId?: number | null
}

let pos3DWindow: Window | null = null

function open3DPopupWindow(htmlContent: string) {
  if (typeof window === 'undefined' || !htmlContent) return
  const width = 680
  const height = 720
  const left = Math.max(0, Math.round((window.screen.width - width) / 2))
  const top = Math.max(0, Math.round((window.screen.height - height) / 2))

  try {
    if (pos3DWindow && !pos3DWindow.closed) pos3DWindow.close()
  } catch {
  }
  pos3DWindow = null

  const popup = window.open(
    'about:blank',
    '_blank',
    `width=${width},height=${height},top=${top},left=${left},scrollbars=yes,resizable=yes,status=yes`
  )

  if (!popup) return

  try {
    popup.document.open()
    popup.document.write(htmlContent)
    popup.document.close()
    popup.focus()
    pos3DWindow = popup
  } catch {
    popup.close()
    throw new Error('3D güvenlik penceresi açılamadı. Tarayıcı açılır pencere engelini kaldırıp tekrar deneyin.')
  }
}

// Metin alanlari cok satirli: CRLF ve LF birlikte gelebiliyor.
const SATIR_AYIRICI = /\r?\n/

function PosPaymentView() {
  // Taksit bilgisi üç AYRI çok satırlı metin olarak tutuluyor (taksit / min tutar / açıklama)
  // ve satırlar birbirine SIRA NUMARASIYLA bağlı. Tabloya olduğu gibi basılınca hepsi tek
  // satırda birleşiyor ve "TEK ÇEKİM 3 TAKSİT 5 TAKSİT | 1 250 250" gibi okunmaz hale geliyordu.
  // Burada satırlar eşleştirilip taksit sayısına göre sıralanıyor, ekrana da satır satır basılıyor.
  type InstallmentLine = {
    taksit: string
    minTutar: string
    aciklama: string
    sira: number
  }

  type InstallmentRow = {
    banka: string
    satirlar: InstallmentLine[]
  }

  // Load Google Font Montserrat dynamically
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const linkId = 'montserrat-font-link'
      if (!document.getElementById(linkId)) {
        const link = document.createElement('link')
        link.id = linkId
        link.rel = 'stylesheet'
        link.href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800;900&display=swap'
        document.head.appendChild(link)
      }
    }
  }, [])

  const [installmentsLoading, setInstallmentsLoading] = useState(false)
  const [installments, setInstallments] = useState<InstallmentRuleDto[]>([])
  const [installmentsError, setInstallmentsError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        setInstallmentsLoading(true)
        const list = await fetchInstallmentRules({ includeInactive: false })
        setInstallments(list)
        setInstallmentsError(null)
      } catch (e: any) {
        /*
          HATA ARTIK SESSİZ YUTULMUYOR (2026-08-27).

          Burası `catch {}` ile boş liste yazıyordu: uç 403 dönerken tablo "kayıt yok" gibi
          görünüyor, kullanıcı bozuk mu yetkisiz mi ayırt edemiyordu. Sebebi anlamak bir
          günlük araştırma gerektirdi; sebep ekranda yazsaydı bir dakikaydı.
        */
        setInstallments([])
        setInstallmentsError(String(e?.message ?? 'Taksit oranları yüklenemedi.'))
      } finally {
        setInstallmentsLoading(false)
      }
    })()
  }, [])

  const splitLines = (v: unknown) =>
    String(v ?? '')
      .split(SATIR_AYIRICI)
      .map((x) => String(x ?? '').trim())

  // "TEK ÇEKİM" -> 1, "3 TAKSİT" -> 3. Sıralama için; çözülemeyen satır sona düşer.
  const taksitSayisi = (line: string) => {
    const s = String(line ?? '').trim().toLowerCase().replace(/ı/g, 'i')
    if (!s) return 9999
    if (s.includes('tek')) return 1
    const m = s.match(/(\d+)/)
    const n = m?.[1] ? Number(m[1]) : NaN
    if (!Number.isFinite(n)) return 9999
    return n === 0 ? 1 : n
  }

  const formatMinTutar = (v: string) => {
    const raw = String(v ?? '').trim()
    if (!raw) return ''
    const n = Number(raw.replace(/\./g, '').replace(',', '.'))
    if (!Number.isFinite(n)) return raw
    return `${n.toLocaleString('tr-TR')} TL`
  }

  const data: InstallmentRow[] = useMemo(() => {
    return (installments ?? []).map((x) => {
      const taksitler = splitLines(x.installmentText)
      const minler = splitLines(x.minAmountText)
      const aciklamalar = splitLines(x.descriptionText)

      const satirlar = taksitler
        .map((t, i) => ({
          taksit: t,
          minTutar: formatMinTutar(minler[i] ?? ''),
          aciklama: aciklamalar[i] ?? '',
          sira: taksitSayisi(t)
        }))
        .filter((r) => r.taksit || r.minTutar || r.aciklama)
        .sort((a, b) => a.sira - b.sira)

      return { banka: String(x.bankName ?? ''), satirlar }
    })
  }, [installments])

  const [openSection, setOpenSection] = useState<'installments' | 'dealer' | 'service' | 'privacy' | 'cancel' | null>('installments')

  // Form alanları BOŞ başlar. Öncesinde geliştirme artığı olarak gerçek görünümlü alıcı
  // bilgileri ve (aşağıda) tam kart numarası + CVV varsayılan state olarak duruyordu:
  // canlıda POS sayfasını açan her bayi ekranda dolu bir kart görüyordu.
  const [buyerFullName, setBuyerFullName] = useState('')
  const [buyerCompanyTitle, setBuyerCompanyTitle] = useState('')
  const [buyerAddress, setBuyerAddress] = useState('')
  const [buyerPhone, setBuyerPhone] = useState('')
  const [buyerEmail, setBuyerEmail] = useState('')

  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDto | null>(null)

  const [amountText, setAmountText] = useState('')
  const [cardNumberRaw, setCardNumberRaw] = useState('')
  const [cardHolderName, setCardHolderName] = useState('')
  const [expiryRaw, setExpiryRaw] = useState('')
  const [cvvRaw, setCvvRaw] = useState('')
  const [phoneText, setPhoneText] = useState('')
  const [installmentCount, setInstallmentCount] = useState('0')
  const [cardFlipped, setCardFlipped] = useState(false)
  const [paymentSuccess, setPaymentSuccess] = useState(false)

  /*
    SONUÇ SUNUCUDAN OKUNUR (2026-09-16 kullanıcı bildirimi: "bayi parayı çektik sanar,
    mal beleşe gider").

    Eskiden 3D penceresinden gelen `POS_PAYMENT_COMPLETE` mesajı doğrudan "başarılı" sayılıyordu.
    O mesajı sonuç sayfasındaki "Tamam" düğmesi gönderiyor ve düğme BAŞARISIZ ekranda da var —
    banka reddettiği hâlde bayinin ekranında yeşil kutu çıkıyordu. Mesaj artık yalnız "durumu
    şimdi sor" sinyali; karar `payment-status` ucundan gelir.
  */
  const [payOrderNo, setPayOrderNo] = useState<string | null>(null)
  const [payResult, setPayResult] = useState<PosPaymentStatusDto | null>(null)
  const [payWatching, setPayWatching] = useState(false)

  const [htmlForm3D, setHtmlForm3D] = useState<string | null>(null)
  const [posLoading, setPosLoading] = useState(false)
  const [posErrorMsg, setPosErrorMsg] = useState<string | null>(null)

  const location = useLocation()
  const navigate = useNavigate()
  const navState = (location.state ?? null) as PosNavigationState | null

  const [invoiceFlow, setInvoiceFlow] = useState<{
    invoiceId: number | null
    invoiceNo: string | null
    customerCode: string | null
    amount: number | null
    posBankAccountDefinitionId: number | null
  } | null>(null)

  /**
   * Ödemenin sonucunu sunucuya sorar. `true` dönerse karar kesindir ve izleme durur.
   *
   * "bekliyor" bir sonuç değildir: banka henüz konuşmamıştır, ekranda yeşil ya da kırmızı
   * hiçbir şey gösterilmez.
   */
  const refreshPaymentResult = useCallback(async (orderNo: string): Promise<boolean> => {
    try {
      const st = await fetchPaymentStatus(orderNo)
      if (!st) return false
      setPayResult(st)

      if (st.durum === 'basarili') {
        setPaymentSuccess(true)
        setHtmlForm3D(null)
        if (invoiceFlow?.invoiceId) {
          window.setTimeout(() => navigate('/invoice/fatura-listesi'), 1200)
        }
        return true
      }

      if (st.durum === 'basarisiz' || st.durum === 'dogrulanamadi') {
        setPaymentSuccess(false)
        setHtmlForm3D(null)
        return true
      }

      return false
    } catch {
      // Ağ hatası kararı değiştirmez; bir sonraki yoklamada tekrar denenir.
      return false
    }
  }, [invoiceFlow, navigate])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data === 'POS_PAYMENT_COMPLETE') {
        // Pencere "bitti" diyor; NE olduğunu sunucu söyler.
        if (payOrderNo) void refreshPaymentResult(payOrderNo)
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [payOrderNo, refreshPaymentResult])

  /*
    Banka sonucu ERP'ye kendi sunucusundan da yollayabiliyor (pencere hiç kapanmasa bile).
    Bu yüzden ödeme başladıktan sonra durum 4 saniyede bir sorulur; 10 dakika sonra izleme
    durur ve kayıt "bekliyor" kalır — ekranda da öyle yazar.
  */
  useEffect(() => {
    if (!payWatching || !payOrderNo) return

    let durdu = false
    const baslangic = Date.now()

    const zamanlayici = window.setInterval(() => {
      void (async () => {
        if (durdu) return
        const karar = await refreshPaymentResult(payOrderNo)
        if (karar || Date.now() - baslangic > 10 * 60 * 1000) {
          durdu = true
          setPayWatching(false)
        }
      })()
    }, 4000)

    return () => {
      durdu = true
      window.clearInterval(zamanlayici)
    }
  }, [payWatching, payOrderNo, refreshPaymentResult])

  const [binLookupLoading, setBinLookupLoading] = useState(false)
  const [binLookupBankName, setBinLookupBankName] = useState('')
  const [binLookupBankCode, setBinLookupBankCode] = useState<number>(0)
  // Kartin bankasi ile TAKSIT tablosunun geldigi banka AYNI OLMAK ZORUNDA DEGIL.
  // BankBins.TAKSIT_BANKA_KODU farkli bir bankayi gosterebiliyor; o zaman ekranda
  // "Kart Bankasi: Ziraat" yazarken taksitler baska bankanin tablosundan geliyor.
  // Bu ayrimi gostermezsek "Ziraat'e 5 taksit tanimladim ama kutu gelmedi" oluyor.
  const [binLookupInstallmentBankName, setBinLookupInstallmentBankName] = useState('')
  const [binLookupInstallments, setBinLookupInstallments] = useState<BinLookupInstallmentRuleDto[]>([])

  const contractDateText = useMemo(() => {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const date = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
    return `${date} ${time}`
  }, [])

  const fetchPosCariList = useCallback(
    (opts?: { q?: string; includeInactive?: boolean; limit?: number; signal?: AbortSignal }) =>
      // `limit` GECIRILMEK ZORUNDA: uc artik sunucuda suzuyor ve sinirliyor; burada dusurulurse
      // istek yine butun cari listesini indirir ve secim kutusu donmaya devam eder.
      //
      // `lite` DE GECIRILIR: secim kutusu satir basina 25 alanin yalnizca kodunu ve adini
      // kullaniyor, tam kayit canlida 4,2 MB tutuyordu ve kutu her acilista donuyordu.
      // Secilen carinin adres/telefon/e-postasi asagida AYRICA cekiliyor.
      fetchCustomersDropdown({ q: opts?.q, includeInactive: false, includeMuhtelif: false, limit: opts?.limit, lite: true, signal: opts?.signal }),
    []
  )

  const applyCustomerToBuyer = (c: CustomerDto | null) => {
    setSelectedCustomer(c)
    if (!c) return

    const addrParts = [c.address, c.district, c.city].map((x) => String(x ?? '').trim()).filter(Boolean)
    setBuyerFullName(String(c.name ?? '').trim() || 'TEST CARISI 123456')
    setBuyerCompanyTitle(String(c.name ?? '').trim() || 'DEMO TİCARET LİMİTED')
    setBuyerAddress(addrParts.join(' ') || 'ADRES')
    setBuyerPhone(String(c.phone ?? '').trim() || '123456')
    setBuyerEmail(String(c.email ?? '').trim() || 'DENEME@A.COM')

    /*
      SECIM KUTUSU HAFIF, SECILEN KAYIT TAM.

      Liste `lite` geldigi icin adres/telefon/e-posta alanlari BOS gelir; ustteki atamalar o
      durumda yer tutucu yaziyor ("ADRES", "123456"). Bankaya giden alici bilgisi bu olamaz,
      bu yuzden secim yapilir yapilmaz o carinin TAM kaydi tek satirlik bir istekle cekilip
      alanlar duzeltiliyor. Istek tek cari icin, listeyi tekrar indirmiyor.
    */
    const code = String(c.customerCode ?? '').trim()
    const alreadyFull = String(c.phone ?? '').trim() || String(c.email ?? '').trim() || addrParts.length > 0
    if (!code || alreadyFull) return

    void (async () => {
      try {
        const list = await fetchCustomersDropdown({ q: code, includeInactive: false, includeMuhtelif: false, limit: 5 })
        const full = (list ?? []).find((x) => String(x.customerCode ?? '').trim().toLowerCase() === code.toLowerCase())
        if (!full) return
        const parts = [full.address, full.district, full.city].map((x) => String(x ?? '').trim()).filter(Boolean)
        if (parts.length > 0) setBuyerAddress(parts.join(' '))
        const phone = String(full.phone ?? '').trim()
        if (phone) setBuyerPhone(phone)
        const email = String(full.email ?? '').trim()
        if (email) setBuyerEmail(email)
      } catch {
        // Tam kayit gelmezse yer tutucular kalir; odeme yolu kirilmaz.
      }
    })()
  }

  useEffect(() => {
    const cc = String(navState?.customerCode ?? '').trim()
    const amount = Number(navState?.amount ?? 0)
    const invoiceId = Number(navState?.invoiceId ?? 0)
    const posId = Number(navState?.posBankAccountDefinitionId ?? 0)
    const invoiceNo = navState?.invoiceNo != null ? String(navState.invoiceNo) : null

    if (!cc && !Number.isFinite(amount)) return

    setInvoiceFlow({
      invoiceId: Number.isFinite(invoiceId) && invoiceId > 0 ? invoiceId : null,
      invoiceNo: invoiceNo && invoiceNo.trim() ? invoiceNo.trim() : null,
      customerCode: cc || null,
      amount: Number.isFinite(amount) && amount > 0 ? amount : null,
      posBankAccountDefinitionId: Number.isFinite(posId) && posId > 0 ? posId : null
    })
  }, [navState])

  useEffect(() => {
    const cc = String(invoiceFlow?.customerCode ?? '').trim()
    if (!cc) return

    const ac = new AbortController()
    void (async () => {
      try {
        const list = await fetchCustomersDropdown({ q: cc, includeInactive: false, signal: ac.signal })
        const exact = (list ?? []).find((x) => String(x.customerCode ?? '').trim().toLowerCase() === cc.toLowerCase())
        if (exact) applyCustomerToBuyer(exact)
      } catch {
      }
    })()
    return () => ac.abort()
  }, [invoiceFlow?.customerCode])

  useEffect(() => {
    const amt = Number(invoiceFlow?.amount ?? 0)
    if (!Number.isFinite(amt) || amt <= 0) return
    setAmountText(formatMoneyTR(amt))
  }, [invoiceFlow?.amount])

  useEffect(() => {
    if (selectedCustomer || invoiceFlow?.customerCode) return
    const ac = new AbortController()
    void (async () => {
      try {
        const list = await fetchPosCariList({ signal: ac.signal })
        const filteredList = (list ?? []).filter((c) => (c as any).accountRole !== 'INVOICE_ACCOUNT' && !String(c.customerCode ?? '').endsWith('-1'))
        if (filteredList.length === 1) {
          applyCustomerToBuyer(filteredList[0])
        }
      } catch {
      }
    })()
    return () => ac.abort()
  }, [fetchPosCariList, invoiceFlow?.customerCode, selectedCustomer])

  const digitsOnly = (s: string) => String(s ?? '').replace(/\D+/g, '')
  const cardDigits = useMemo(() => digitsOnly(cardNumberRaw).slice(0, 19), [cardNumberRaw])
  const bin6 = useMemo(() => cardDigits.slice(0, 6), [cardDigits])

  useEffect(() => {
    if (bin6.length !== 6) {
      setBinLookupLoading(false)
      setBinLookupBankName('')
      setBinLookupInstallmentBankName('')
      setBinLookupInstallments([])
      return
    }

    const ac = new AbortController()
    void (async () => {
      try {
        setBinLookupLoading(true)
        const res = await fetchBinLookup(bin6, { signal: ac.signal })
        setBinLookupBankName(String(res?.bank?.name ?? '').trim())
        setBinLookupBankCode(0)
        setBinLookupInstallmentBankName(String(res?.installmentBank?.name ?? '').trim())
        setBinLookupInstallments(Array.isArray(res?.installments) ? res.installments : [])
      } catch {
        if (ac.signal.aborted) return
        setBinLookupBankName('')
        setBinLookupBankCode(0)
        setBinLookupInstallmentBankName('')
        setBinLookupInstallments([])
      } finally {
        if (ac.signal.aborted) return
        setBinLookupLoading(false)
      }
    })()

    return () => ac.abort()
  }, [bin6])

  const detectedBank = binLookupBankName

  const detectedBrand = useMemo(() => {
    if (!cardDigits) return ''
    if (cardDigits.startsWith('9792')) return 'TROY'
    if (cardDigits.startsWith('4')) return 'VISA'
    const first2 = Number(cardDigits.slice(0, 2))
    if (first2 >= 51 && first2 <= 55) return 'MASTERCARD'
    return ''
  }, [cardDigits])

  const detectedCardType = useMemo(() => {
    switch (detectedBrand) {
      case 'MASTERCARD':
        return 'mastercard'
      case 'TROY':
        return 'troy'
      case 'VISA':
        return 'visa'
      default:
        return ''
    }
  }, [detectedBrand])

  const normalizeBankNameForTheme = (raw: string) => {
    const s = String(raw ?? '')
      .trim()
      .toLowerCase()
      .replace(/ı/g, 'i')
      .normalize('NFD')
      .replace(/\p{Diacritic}+/gu, '')
      .replace(/\./g, '')
      .replace(/\s+/g, ' ')
      .trim()
    return s
  }

  const detectedVariant = useMemo<BankVariant | ThemeVariant>(() => {
    const b = normalizeBankNameForTheme(detectedBank)
    if (!b) return 'gradient-blue'

    if (b.includes('is bankasi') || b.includes('isbank') || b.includes('turkiye is bankasi') || b.includes('turkiyeisbankasi')) return 'isbank'
    if (b.includes('garanti')) return 'garanti'
    if (b.includes('yapi kredi') || b.includes('yapikredi')) return 'yapikredi'
    if (b.includes('akbank')) return 'akbank'
    if (b.includes('ziraat')) return 'ziraat'
    if (b.includes('halk')) return 'halkbank'
    if (b.includes('qnb') || b.includes('finansbank')) return 'qnb'
    if (b.includes('deniz')) return 'denizbank'
    if (b.includes('teb') || b.includes('turk ekonomi bankasi') || b.includes('turk ekonomibankasi')) return 'teb'
    if (b.includes('enpara')) return 'enpara'
    if (b.includes('albaraka')) return 'albaraka'
    if (b.includes('kuveyt turk') || b.includes('kuveytturk')) return 'kuveytturk'

    return 'gradient-blue'
  }, [detectedBank])

  const normalizeTextForMatch = (v: string) => {
    const s = String(v ?? '').trim().toLowerCase().replace(/ı/g, 'i')
    const noMarks = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    return noMarks.replace(/\./g, '').replace(/\s+/g, ' ').trim()
  }

  const resolveInstallmentRuleForBank = (bank: string, rules: InstallmentRuleDto[]) => {
    const b = normalizeTextForMatch(bank)
    if (!b) return null

    const direct = rules.find((r) => normalizeTextForMatch(r.bankName) === b)
    if (direct) return direct

    return null
  }

  const parseInstallmentOptionValue = (line: string) => {
    const s = normalizeTextForMatch(line)
    if (!s) return null
    if (s.includes('tek') || s.includes('0 taksit') || s.includes('0taksit')) return '0'
    const m = s.match(/(\d+)\s*taksit/)
    if (m?.[1]) return String(Number(m[1]))
    return null
  }

  const matchedInstallmentRule = useMemo(() => {
    if (binLookupInstallments.length) {
      const sorted = [...binLookupInstallments].sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder))
      const first = sorted[0]
      if (!first) return null
      return {
        id: String(first.id),
        bankName: String(first.bankName ?? ''),
        installmentText: String(first.installmentText ?? ''),
        minAmountText: String(first.minAmountText ?? ''),
        descriptionText: String(first.descriptionText ?? ''),
        sortOrder: Number(first.sortOrder ?? 0),
        isActive: Boolean(first.isActive)
      } as InstallmentRuleDto
    }

    return resolveInstallmentRuleForBank(detectedBank, installments)
  }, [binLookupInstallments, detectedBank, installments])

  const installmentMinByValue = useMemo(() => {
    const rule = matchedInstallmentRule
    if (!rule) return {} as Record<string, number>

    // BOS SATIRLAR ELENMEZ. Taksit satirlari ile minimum tutar satirlari birbirine SIRA
    // NUMARASIYLA bagli; birinden bos satir atilirsa esleme kayiyor ve minimumlar
    // sessizce yanlis taksite yaziliyor. Ornek: Ziraat'te Tek Cekim'in minimumu bos
    // birakilirsa ("" / 250 / 250) eleme sonrasi 250 Tek Cekim'e, 250 uc taksite
    // gidiyor, bes taksit minimumsuz kaliyordu. Cozulemeyen satir asagida atlaniyor.
    const instLines = String(rule.installmentText ?? '')
      .split(SATIR_AYIRICI)
      .map((x) => String(x ?? '').trim())

    const minLines = String(rule.minAmountText ?? '')
      .split(SATIR_AYIRICI)
      .map((x) => String(x ?? '').trim())

    const map: Record<string, number> = {}
    for (let i = 0; i < instLines.length; i++) {
      const value = parseInstallmentOptionValue(instLines[i])
      if (!value) continue
      const min = Number(String(minLines[i] ?? '').replace(/\./g, '').replace(',', '.'))
      map[value] = Number.isFinite(min) ? min : 0
    }

    return map
  }, [matchedInstallmentRule])

  const installmentOptions = useMemo(() => {
    const rule = matchedInstallmentRule
    if (!rule) return [{ value: '0', label: 'Tek Çekim' }]

    const instLines = String(rule.installmentText ?? '')
      .split(/\r?\n/)
      .map((x) => String(x ?? '').trim())
      .filter(Boolean)

    const options: Array<{ value: string; label: string }> = []
    for (let i = 0; i < instLines.length; i++) {
      const value = parseInstallmentOptionValue(instLines[i])
      if (!value) continue
      if (options.some((o) => o.value === value)) continue

      options.push({ value, label: value === '0' ? 'Tek Çekim' : value })
    }

    if (!options.length) return [{ value: '0', label: 'Tek Çekim' }]
    options.sort((a, b) => Number(a.value) - Number(b.value))
    return options
  }, [matchedInstallmentRule])

  useEffect(() => {
    if (!installmentOptions.some((o) => o.value === installmentCount)) {
      setInstallmentCount(installmentOptions[0]?.value ?? '0')
    }
  }, [installmentCount, installmentOptions])

  const formatCardNumberInput = (d: string) => {
    const clean = digitsOnly(d).slice(0, 16)
    return clean.replace(/(.{4})/g, '$1 ').trim()
  }

  const formatExpiry = (raw: string) => {
    const d = digitsOnly(raw).slice(0, 4)
    if (d.length <= 2) return d
    return d.slice(0, 2) + '/' + d.slice(2)
  }

  const normalizedExpiry = useMemo(() => formatExpiry(expiryRaw), [expiryRaw])

  const luhnOk = (d: string) => {
    if (d.length < 12) return false
    let sum = 0
    let dbl = false
    for (let i = d.length - 1; i >= 0; i--) {
      let n = Number(d[i])
      if (!Number.isFinite(n)) return false
      if (dbl) {
        n *= 2
        if (n > 9) n -= 9
      }
      sum += n
      dbl = !dbl
    }
    return sum % 10 === 0
  }

  const isExpiryValid = (mmYY: string) => {
    const m = mmYY.match(/^(\d{2})\/(\d{2})$/)
    if (!m) return false
    const mm = Number(m[1])
    const yy = Number(m[2])
    if (mm < 1 || mm > 12) return false
    const now = new Date()
    const curYY = now.getFullYear() % 100
    const curMM = now.getMonth() + 1
    if (yy < curYY) return false
    if (yy === curYY && mm < curMM) return false
    return true
  }

  const amountValue = useMemo(() => {
    const normalized = String(amountText ?? '').replace(/\./g, '').replace(',', '.')
    const n = Number(normalized)
    return Number.isFinite(n) ? n : 0
  }, [amountText])

  // Secili taksidin minimumu tutmuyorsa odeme baslatilamaz. Tek Cekim de dahil: onun da
  // kendi minimumu var ve disarida birakmak icin bir sebep yok.
  // Tutar degisince secili taksit minimumun altina dusebiliyor. Kilitli bir secenegin
  // uzerinde kalmak, "Odemeyi Tamamla" sebebi gorunmeden kapali dursun demek; acik olan
  // en yuksek taksite dusuyoruz. amountValue burada tanimli oldugu icin bu etki yukaridaki
  // secenek-dogrulama etkisinden AYRI duruyor.
  useEffect(() => {
    if (amountValue <= 0) return

    const seciliMin = Number(installmentMinByValue?.[installmentCount] ?? 0)
    if (!(seciliMin > 0 && amountValue < seciliMin)) return

    const uygun = installmentOptions
      .filter((o) => {
        const m = Number(installmentMinByValue?.[o.value] ?? 0)
        return !(m > 0 && amountValue < m)
      })
      .sort((a, b) => Number(b.value) - Number(a.value))

    if (uygun.length) setInstallmentCount(uygun[0].value)
  }, [amountValue, installmentCount, installmentMinByValue, installmentOptions])

  const installmentMinBlocked = useMemo(() => {
    const min = Number(installmentMinByValue?.[installmentCount] ?? 0)
    if (!Number.isFinite(min) || min <= 0) return false
    return amountValue > 0 && amountValue < min
  }, [amountValue, installmentCount, installmentMinByValue])

  const [customerBalance, setCustomerBalance] = useState<number>(0)

  /*
    BAKİYE ARTIK CARİ EKSTREYLE AYNI MALİ DÖNEMDEN OKUNUYOR (2026-09-03 kullanıcı
    bildirimi: "sanal postaki bakiye ile cari ekstredeki bakiye neden tutmuyor").

    Ekstre `periodId` göndererek okuyor, POS hiç göndermiyordu. Uç dönem gelmediğinde
    "Tüm Dönemler" dalına düşüyor ve DEVİR satırlarını (`IsOpeningBalance`) çifte sayım
    olmasın diye ELİYOR — bkz. CustomerLedgerController.List. Geçmiş yılın hareketleri
    bu veritabanında yoksa (Excel bakiye aktarımıyla açılan cariler) devir satırı tek
    kaynaktır; elenince borç eksik görünüyordu: 120-01-000655'te ekstre ₺606.713,95
    derken POS ₺601.150,06 yazıyordu, aradaki ₺5.563,89 tam olarak 31.12.2025 tarihli
    DEVIR-2026 satırı.

    Dönem seçimi ekstredeki kuralın aynısı: ilk KAPANMAMIŞ dönem, o da yoksa listenin
    ilki. Dönem çözülene kadar bakiye çekilmez — önce yanlış sayı gösterip sonra
    düzeltmek, kullanıcının gördüğü ilk rakamın yanlış olması demek.
  */
  const [ledgerPeriodId, setLedgerPeriodId] = useState<number | null>(null)
  const [ledgerPeriodResolved, setLedgerPeriodResolved] = useState(false)

  useEffect(() => {
    let iptal = false
    void fetchAccountingPeriods()
      .then((list) => {
        if (iptal) return
        const donemler = list ?? []
        const acikDonem = donemler.find((p) => !p.isClosed) || donemler[0]
        setLedgerPeriodId(acikDonem?.id ?? null)
      })
      .catch(() => {
        // Dönem listesi alınamazsa eski davranışa dön: dönemsiz oku, hiç bakiye
        // göstermemektense devir satırı elenmiş bakiye daha iyidir.
        if (!iptal) setLedgerPeriodId(null)
      })
      .finally(() => {
        if (!iptal) setLedgerPeriodResolved(true)
      })
    return () => { iptal = true }
  }, [])

  useEffect(() => {
    if (!selectedCustomer) {
      setCustomerBalance(0)
      return
    }
    if (!ledgerPeriodResolved) return

    const ac = new AbortController()
    void (async () => {
      try {
        const ledger = await fetchCustomerLedger(selectedCustomer.customerCode, {
          periodId: ledgerPeriodId ?? undefined,
          signal: ac.signal
        })
        setCustomerBalance(ledger?.summary?.balance ?? 0)
      } catch (err) {
        console.error('Error fetching customer balance:', err)
        setCustomerBalance(0)
      }
    })()
    return () => ac.abort()
  }, [selectedCustomer, ledgerPeriodId, ledgerPeriodResolved])

  const customerMissing = !selectedCustomer
  const creditLimitBlocked = !selectedCustomer

  const balanceText = useMemo(() => {
    return customerBalance.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }, [customerBalance])

  const replaceBetween = (input: string, start: string, end: string, value: string) => {
    const s = input.indexOf(start)
    if (s < 0) return input
    const from = s + start.length
    const e = input.indexOf(end, from)
    if (e < 0) return input
    return input.slice(0, from) + value + input.slice(e)
  }

  const applyContractVariables = (raw: string) => {
    let out = raw
    out = replaceBetween(out, 'Adı - soyadı/Unvanı :\n                    ', ' \n\n                        Adresi :', buyerFullName)
    out = replaceBetween(out, 'Adresi :\n                    ', ' \n\n                        Telefon :', buyerAddress)
    out = replaceBetween(out, 'Telefon :\n                    ', ' \n\n                        FV\n                        E-mail :', buyerPhone)
    out = replaceBetween(out, 'E-mail :\n                    ', ' \n\n                        Madde 2- Konu;', buyerEmail)
    out = out.replace('../../....', contractDateText)
    return out
  }

  const formatAmountText = (raw: string) => {
    const cleaned = normalizeAmountInput(raw)
    const normalized = String(cleaned ?? '').replace(/\./g, '').replace(',', '.')
    const n = Number(normalized)
    if (!Number.isFinite(n) || n <= 0) return '0,00'
    return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  // 11 haneye kirpiliyordu; yurt disi numarasinin sonu sessizce dusuyordu. Buradaki numara
  // bankaya yalnizca ILETISIM bilgisi (`tel`) olarak gider — 3D Secure kodunu banka kartta
  // kayitli numaraya yollar, bu alana degil — o yuzden sinirin acilmasi odemeyi etkilemez.
  const normalizePhoneDigits = (raw: string) => {
    return digitsOnly(raw).slice(0, PHONE_MAX_DIGITS)
  }

  // 11 haneli numaralar BIREBIR eskisi gibi gorunur: `(0532) 123 45 67`. Fazla haneler
  // kirpilmak yerine sona ayri grup olarak eklenir.
  const formatPhoneTR = (raw: string) => {
    const d = normalizePhoneDigits(raw)
    if (!d) return ''
    const p1 = d.slice(0, 1)
    const p2 = d.slice(1, 4)
    const p3 = d.slice(4, 7)
    const p4 = d.slice(7, 9)
    const p5 = d.slice(9, 11)
    const rest = d.slice(11)
    const first = p1 && p2 ? `(${p1}${p2})` : p1 ? `(${p1}` : ''
    return [first, p3, p4, p5, rest].filter(Boolean).join(' ').trim()
  }

  const normalizeCardHolderName = (raw: string) => {
    const s = String(raw ?? '').replace(/[^a-zA-Z\sğüşöçıİĞÜŞÖÇ]/g, '')
    return s.slice(0, 26)
  }

  const dealerContractText = useMemo(() => applyContractVariables(POS_DEALER_SALES_CONTRACT_TEXT), [buyerAddress, buyerEmail, buyerFullName, buyerPhone, contractDateText])
  const serviceTermsText = useMemo(() => applyContractVariables(POS_SERVICE_TERMS_TEXT), [buyerAddress, buyerEmail, buyerFullName, buyerPhone, contractDateText])

  const isCardValid = useMemo(() => {
    const card16 = cardDigits.slice(0, 16)
    const cardOk = card16.length === 16 && luhnOk(card16)
    const nameOk = cardHolderName.trim().length >= 3
    const expOk = isExpiryValid(normalizedExpiry)
    const cvvOk = digitsOnly(cvvRaw).length === 3
    const amountOk = amountValue > 0
    return cardOk && nameOk && expOk && cvvOk && amountOk && !installmentMinBlocked
  }, [amountValue, cardDigits, cardHolderName, cvvRaw, installmentMinBlocked, normalizedExpiry])

  const bankMissing = bin6.length === 6 && !binLookupLoading && !detectedBank
  const bankOk = Boolean(detectedBank) && !binLookupLoading

  const canPay = isCardValid && bankOk && !creditLimitBlocked && !customerMissing

  const amountError = useMemo(() => {
    if (customerMissing) return 'Lütfen cari seçiniz'
    if (amountValue <= 0) return ''
    return ''
  }, [amountValue, customerMissing])

  const bankError = useMemo(() => {
    if (bankMissing) return 'Banka tanımlı değil'
    return ''
  }, [bankMissing])

  const installmentError = useMemo(() => {
    const min = Number(installmentMinByValue?.[installmentCount] ?? 0)
    if (!Number.isFinite(min) || min <= 0) return ''
    if (amountValue > 0 && amountValue < min) return `Seçilen taksit için minimum tutar ${min.toLocaleString('tr-TR')} olmalıdır.`
    return ''
  }, [amountValue, installmentCount, installmentMinByValue])

  const normalizeAmountInput = (raw: string) => {
    const s = String(raw ?? '')
    let out = ''
    let hasComma = false
    for (const ch of s) {
      if (ch >= '0' && ch <= '9') {
        out += ch
        continue
      }
      if ((ch === ',' || ch === '.') && !hasComma) {
        out += ','
        hasComma = true
      }
    }
    return out
  }

  const formatMoneyTR = (n: number) => {
    return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const handlePayment = useCallback(() => {
    void (async () => {
      try {
        setPosLoading(true)
        setPosErrorMsg(null)
        setPaymentSuccess(false)
        setPayResult(null)
        setPayOrderNo(null)
        setPayWatching(false)

        const expParts = normalizedExpiry.split('/')
        const mm = expParts[0] || ''
        const yy = expParts[1] || ''

        const res = await initiate3DPayment({
          customerCode: selectedCustomer?.customerCode || '',
          amount: amountValue,
          cardHolderName: cardHolderName.trim().toUpperCase(),
          cardNumber: cardDigits,
          expMonth: mm,
          expYear: yy,
          cvc: cvvRaw,
          bankCode: binLookupBankCode || 0,
          installmentCount: Number(installmentCount) || 0,
          phone: phoneText
        })

        if (res.success && res.htmlForm) {
          // İşlem numarası olmadan sonucu soramayız; pencere yine açılır ama izleme başlamaz.
          if (res.orderNo) {
            setPayOrderNo(res.orderNo)
            setPayWatching(true)
          }
          setHtmlForm3D(res.htmlForm)
          open3DPopupWindow(res.htmlForm)
        } else {
          setPosErrorMsg(res.message || '3D Ödeme başlatılamadı.')
        }
      } catch (err: any) {
        setPosErrorMsg(err?.message || 'Ödeme işlemi sırasında bir hata oluştu.')
      } finally {
        setPosLoading(false)
      }
    })()
  }, [selectedCustomer, amountValue, cardHolderName, cardDigits, normalizedExpiry, cvvRaw, binLookupBankCode, installmentCount, phoneText])

  return (
    <div className="-m-4 bg-slate-50 min-h-screen pb-12 font-montserrat px-4 sm:px-6 lg:px-8 pt-6 animate-in fade-in duration-200">
      <div className="max-w-[1440px] mx-auto">
        
        {/* Dynamic header */}
        <PaymentHeader amount={amountValue} installmentCount={Number(installmentCount) || 0} />

        {/* Invoice collection info */}
        {invoiceFlow?.invoiceId ? (
          <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50/70 backdrop-blur-xs px-5 py-4 text-xs text-amber-900 shadow-xs flex items-center justify-between">
            <div>
              <div className="font-extrabold text-amber-955">Fatura Tahsilatı Bağlantısı</div>
              <div className="mt-0.5 font-medium text-amber-800">
                Belge No: {invoiceFlow.invoiceNo ?? `#${invoiceFlow.invoiceId}`}
              </div>
            </div>
            <span className="font-black text-sm text-amber-955">{formatMoneyTR(Number(invoiceFlow.amount ?? 0))} TL</span>
          </div>
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Cari Selection & Card Preview */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* Customer Selector */}
            <CustomerSelector 
              selectedCustomer={selectedCustomer} 
              onChange={applyCustomerToBuyer} 
              fetcher={fetchPosCariList} 
              disabled={Boolean(invoiceFlow?.customerCode)}
            />

            {/* Customer Balance Card */}
            <CustomerBalanceCard 
              customer={selectedCustomer} 
              balance={customerBalance} 
            />

            {/* Credit Card Graphic Preview */}
            <CreditCardPreview 
              cardNumber={cardNumberRaw}
              cardHolder={cardHolderName}
              expiryDate={expiryRaw}
              cvv={cvvRaw}
              cardType={detectedCardType}
              bankName={detectedBank}
              variant={detectedVariant}
              flipped={cardFlipped}
              onFlippedChange={setCardFlipped}
            />

          </div>

          {/* Right Column: Payment Form & Action Button */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* Details Form */}
            <PaymentForm 
              amountText={amountText}
              onAmountChange={(v) => setAmountText(normalizeAmountInput(v))}
              onAmountBlur={() => setAmountText((p) => formatAmountText(p))}
              isAmountDisabled={Boolean(invoiceFlow?.amount)}
              cardNumberRaw={cardNumberRaw}
              onCardNumberChange={(v) => setCardNumberRaw(formatCardNumberInput(v))}
              cardHolderName={cardHolderName}
              onCardHolderNameChange={(v) => {
                setPaymentSuccess(false)
                setCardHolderName(normalizeCardHolderName(v))
              }}
              expiryRaw={normalizedExpiry}
              onExpiryChange={(v) => setExpiryRaw(digitsOnly(v).slice(0, 4))}
              cvvRaw={cvvRaw}
              onCvvChange={(v) => setCvvRaw(digitsOnly(v).slice(0, 3))}
              phoneText={phoneText}
              onPhoneChange={(v) => {
                setPaymentSuccess(false)
                setPhoneText(formatPhoneTR(v))
              }}
              detectedBank={detectedBank}
              onFocusField={(field) => setCardFlipped(field === 'cvv')}
              disabled={creditLimitBlocked}
              amountError={amountError}
              bankError={bankError}
            />

            {/* Installment Options selector */}
            <InstallmentSelector 
              detectedBank={detectedBank}
              installmentBankName={binLookupInstallmentBankName}
              binLookupLoading={binLookupLoading}
              installmentOptions={installmentOptions}
              installmentCount={installmentCount}
              onSelectInstallment={setInstallmentCount}
              amountValue={amountValue}
              installmentMinByValue={installmentMinByValue}
              disabled={creditLimitBlocked}
              error={installmentError}
            />

            {/* Secure CTA Payment Button Card */}
            <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs relative overflow-hidden">
              <button
                type="button"
                disabled={!canPay || posLoading}
                className={`w-full h-12 text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-2.5 tracking-wider uppercase select-none ${
                  canPay && !posLoading
                    ? 'text-white shadow-md hover:shadow-lg active:translate-y-px cursor-pointer'
                    : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                }`}
                style={
                  canPay && !posLoading
                    ? {
                        background:
                          'linear-gradient(90deg, var(--tenant-gradient-from, #8F2500), var(--tenant-gradient-to, #BD390C))'
                      }
                    : undefined
                }
                onClick={handlePayment}
              >
                {posLoading ? (
                  <>
                    <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    <span>Bankanızla güvenli bağlantı kuruluyor...</span>
                  </>
                ) : (
                  <>
                    <span>🔒 {amountValue > 0 ? `${formatMoneyTR(amountValue)} TL Güvenli Ödeme Yap` : 'Ödemeyi Tamamla'}</span>
                  </>
                )}
              </button>

              <div className="mt-3 text-center text-[10px] text-slate-400 font-medium leading-relaxed">
                "Ödeme Yap" butonuna basarak bankanızın güvenli 3D Secure SMS doğrulama ekranına yönlendirilmeyi kabul edersiniz.
              </div>

              {posErrorMsg && (
                <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50/50 p-4 text-xs font-bold text-rose-700 flex items-start gap-2.5">
                  <span className="text-sm">⚠️</span>
                  <div>
                    <div className="font-bold text-slate-900 mb-0.5">Ödeme İşlemi Başarısız</div>
                    {posErrorMsg}
                  </div>
                </div>
              )}

              {/* Sonuç kutuları SUNUCUNUN kararını gösterir; 3D penceresinden gelen mesaj tek başına yeterli değildir. */}
              {paymentSuccess && payResult?.durum === 'basarili' && (
                <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 text-xs font-bold text-emerald-800 flex items-start gap-2.5">
                  <span className="text-sm">✅</span>
                  <div>
                    <div className="font-bold text-slate-900 mb-0.5">Ödeme Başarıyla Tamamlandı</div>
                    Banka onayladı{payResult.authCode ? ` (onay kodu: ${payResult.authCode})` : ''}. Ödeme cari hesap ekstrenize işlendi.
                  </div>
                </div>
              )}

              {payResult?.durum === 'basarisiz' && (
                <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50/60 p-4 text-xs font-bold text-rose-800 flex items-start gap-2.5">
                  <span className="text-sm">❌</span>
                  <div>
                    <div className="font-bold text-slate-900 mb-0.5">Ödeme Alınamadı</div>
                    Banka işlemi reddetti, tahsilat YAPILMADI.{payResult.message ? ` Bankanın bildirdiği sebep: ${payResult.message}` : ''}
                  </div>
                </div>
              )}

              {payResult?.durum === 'dogrulanamadi' && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-xs font-bold text-amber-900 flex items-start gap-2.5">
                  <span className="text-sm">⚠️</span>
                  <div>
                    <div className="font-bold text-slate-900 mb-0.5">Sonuç Doğrulanamadı</div>
                    Bankadan kesin sonuç alınamadı. <span className="font-extrabold">Tahsilat yapılmış SAYMAYIN</span>, aynı işlemi tekrar denemeden önce Kredi Kartı Çekim Raporu'ndan kontrol edin.
                  </div>
                </div>
              )}

              {payWatching && (!payResult || payResult.durum === 'bekliyor') && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs font-bold text-slate-600 flex items-start gap-2.5">
                  <span className="text-sm">⏳</span>
                  <div>
                    <div className="font-bold text-slate-900 mb-0.5">Bankanın Sonucu Bekleniyor</div>
                    Müşteri banka ekranında SMS şifresini girene kadar sonuç belli değildir. Bu kutu yeşile dönmeden <span className="font-extrabold">tahsilat yapılmış saymayın.</span>
                  </div>
                </div>
              )}
            </div>

            {/* Trust Badges Bar */}
            <SecurityTrustBar />

          </div>
        </div>

        {/* Info & Legal Tabs */}
        <PaymentInfoTabs 
          openSection={openSection || 'installments'} 
          setOpenSection={setOpenSection} 
          installmentsLoading={installmentsLoading} 
          installmentsError={installmentsError}
          installmentRows={data} 
          dealerContractText={dealerContractText} 
          serviceTermsText={serviceTermsText} 
          privacyText={POS_PRIVACY_TEXT} 
          cancelText={POS_CANCEL_RETURN_TEXT} 
        />

      </div>

      {/* 3D Bank SMS Overlay Modal */}
      {htmlForm3D && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 overflow-hidden flex flex-col text-center border border-slate-100">
            <div className="absolute top-0 left-0 w-full h-1.5 bg-emerald-500" />
            
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping shrink-0" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 absolute shrink-0" />
                <h3 className="font-bold text-xs text-slate-800">3D Secure Doğrulama Sayfası</h3>
              </div>
              <button
                onClick={() => setHtmlForm3D(null)}
                className="text-slate-400 hover:text-slate-700 text-xs font-bold px-2 py-0.5 bg-slate-50 hover:bg-slate-100 rounded-md transition"
              >
                Kapat ✕
              </button>
            </div>

            <div className="my-6 p-5 bg-emerald-50/50 border border-emerald-100 rounded-2xl text-emerald-950 text-center">
              <div className="text-3xl mb-2.5">🛡️</div>
              <h4 className="font-extrabold text-sm mb-1 text-slate-900">Banka Güvenlik Ekranı Açıldı</h4>
              <p className="text-xs text-slate-500 leading-relaxed mb-4">
                Telefonunuza gelecek olan onay SMS şifresini girebileceğiniz banka ekranı ayrı bir pencerede açılmıştır. Pencere kapanmadıysa aşağıdaki butona tıklayabilirsiniz.
              </p>

              <button
                type="button"
                onClick={() => {
                  try {
                    setPosErrorMsg(null)
                    open3DPopupWindow(htmlForm3D)
                  } catch (err: any) {
                    setPosErrorMsg(err?.message || '3D güvenlik penceresi açılamadı.')
                  }
                }}
                className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>🔒 Güvenlik Ekranını Tekrar Aç</span>
              </button>
            </div>

            <div className="text-[10px] text-slate-400 font-medium">
              Banka doğrulaması onaylandığında bu pencere otomatik olarak kapanacaktır.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function PosPage() {
  const { activeTabId } = useOutletContext<LayoutContext>()

  if (activeTabId === 'posReport') {
    return <PosReportPage />
  }

  if (activeTabId === 'taksitOranlari') {
    return <InstallmentRulesAdminPage />
  }

  return (
    <div>
      <PosPaymentView />
    </div>
  )
}
