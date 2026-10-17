import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { Minus, Plus, ShoppingCart, Trash2, X, ShoppingBag, Gift } from 'lucide-react'

import Modal from '../Modal'
import { MontajFormModal } from './MontajFormModal'
import { useCart, type CartLine } from '../../contexts/CartContext'
import { fetchActiveCampaigns, type ActiveCampaignDto } from '../../api/campaigns'
import CampaignCarousel from './CampaignCarousel'
import CampaignsListModal from './CampaignsListModal'
import CampaignDetailPopover from './CampaignDetailPopover'
import { applyCampaignsToCart, type CartItem as CampaignCartItem, type AppliedCampaign } from '../../services/campaignApplier'
import { fetchPriceGroups, type PriceGroupDto } from '../../api/priceGroups'
import { kdvKarariVer } from './kdvKarari'
import { API_BASE_URL } from '../../config/api'
import { fetchCustomerByCode } from '../../api/customers'
import { resolveRegionFromCity } from '../../constants/locations'

type Props = {
  dealerCode: string
  dealerLabel: string
  deliveryCustomerCode?: string
  deliveryCustomerLabel?: string
  priceGroupId?: string
  apiBaseUrl?: string
  fabAnchorRef?: React.RefObject<HTMLElement>
  toAbsoluteMediaUrl?: (url: string | null | undefined) => string
  hideCampaignHeader?: boolean
  canOnlySeePriceGroup4?: boolean
  /**
   * Carinin fiyat grubu OGRENILEMEDI mi.
   *
   * "Grubu yok" ile ayni sey DEGIL: grubu olmayan cariye FATURA kurallari uygulanabilir,
   * ogrenilemeyen caride ise hicbir sey varsayilamaz. Ikisi eskiden ayni bos degerle
   * temsil ediliyordu ve sepet, ogrenemedigi durumda KDV EKLIYORDU.
   */
  priceGroupUnknown?: boolean
  montajDetailsByProductId?: Record<
    string,
    {
      bayiAdi?: string
      urunAdi?: string
      miktar?: number
      isimSoyisim?: string
      telefon?: string
      adres?: string
      bolge?: string
      bayiAciklama?: string
    }
  >
}

function formatMoney(v: number) {
  const n = Number(v ?? 0)
  const safe = Number.isFinite(n) ? n : 0
  return safe.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Sepette ÇEVRİM YOK (2026-08-17): her ürün kendi para biriminde toplanır, gösterilir,
// siparişe öyle gider. Eskiden her satır carinin kartındaki dövize çevriliyordu
// (1.090,91 USD sepette 1.038,55 € görünüyordu); cari artık para birimi taşımıyor.
const CURRENCY_SYMBOLS: Record<string, string> = { TRY: '₺', EUR: '€', USD: '$', GBP: '£' }

function currencyCodeOf(product: any): string {
  const c = String(product?.currency ?? '').trim().toUpperCase()
  return CURRENCY_SYMBOLS[c] ? c : 'TRY'
}

function currencySymbolOf(code: string): string {
  return CURRENCY_SYMBOLS[String(code ?? '').trim().toUpperCase()] ?? '₺'
}

const CURRENCY_ORDER = ['TRY', 'USD', 'EUR', 'GBP']

export default function SiparisCartSection(props: Props) {
  const {
    dealerCode,
    dealerLabel,
    deliveryCustomerCode,
    deliveryCustomerLabel,
    priceGroupId,
    apiBaseUrl = API_BASE_URL,
    fabAnchorRef,
    toAbsoluteMediaUrl,
    hideCampaignHeader,
    canOnlySeePriceGroup4 = false,
    priceGroupUnknown = false,
    montajDetailsByProductId
  } = props

  const cart = useCart()

  const productSearchRef = useRef<HTMLInputElement | null>(null)
  const [cartFabTop, setCartFabTop] = useState<number>(140)
  const [cartFabReady, setCartFabReady] = useState(false)

  const [cartOpen, setCartOpen] = useState(false)
  const [clearCartConfirmOpen, setClearCartConfirmOpen] = useState(false)
  const [removeLineConfirmKey, setRemoveLineConfirmKey] = useState<string | null>(null)

  const [creatingOrder, setCreatingOrder] = useState(false)
  const [confirmCreateOrderOpen, setConfirmCreateOrderOpen] = useState(false)
  const [orderSuccessOpen, setOrderSuccessOpen] = useState(false)
  const [orderSuccessOrderNo, setOrderSuccessOrderNo] = useState<string | null>(null)
  const [orderSuccessMessage, setOrderSuccessMessage] = useState<string | null>(null)

  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const [creditLimitErrorOpen, setCreditLimitErrorOpen] = useState(false)
  const [creditLimitErrorMessage, setCreditLimitErrorMessage] = useState<string | null>(null)

  const [generalErrorOpen, setGeneralErrorOpen] = useState(false)
  const [generalErrorMessage, setGeneralErrorMessage] = useState<string | null>(null)

  const [editingMontajLineKey, setEditingMontajLineKey] = useState<string | null>(null)
  const [editingMontajForm, setEditingMontajForm] = useState<{
    bayiAdi?: string
    urunAdi?: string
    miktar?: number
    isimSoyisim?: string
    telefon?: string
    adres?: string
    bolge?: string
    bayiAciklama?: string
  }>({
    bayiAdi: '',
    urunAdi: '',
    miktar: 1,
    isimSoyisim: '',
    telefon: '',
    adres: '',
    bolge: '',
    bayiAciklama: ''
  })
  const [editingMontajError, setEditingMontajError] = useState<string | null>(null)

  const showToast = (message: string) => {
    setToastMessage(message)
    window.setTimeout(() => setToastMessage(null), 1800)
  }

  const [campaigns, setCampaigns] = useState<ActiveCampaignDto[]>([])
  const [campaignsLoading, setCampaignsLoading] = useState(false)
  const [campaignsModalOpen, setCampaignsModalOpen] = useState(false)
  const [campaignDetailOpen, setCampaignDetailOpen] = useState(false)
  const [selectedProductForCampaign, setSelectedProductForCampaign] = useState<{ stockCode: string; name: string } | null>(null)

  const [priceGroups, setPriceGroups] = useState<PriceGroupDto[]>([])
  const [productPriceMetaByProductId, setProductPriceMetaByProductId] = useState<Record<string, { taxRate: number }>>({})

  /**
   * FİYAT GRUPLARI — YÜKLENMEDEN TOPLAM HESAPLANAMAZ (2026-08-24, kullanıcı bildirimi:
   * "sepette fiyatlar bozuldu, bazen saçmalıyor").
   *
   * Satır toplamı, seçili grubun formülünde `REMOVE_KDV` geçip geçmediğine bakıyor:
   * geçiyorsa fiyat NET olarak saklanmış demek ve olduğu gibi kullanılıyor, geçmiyorsa
   * BRÜT sayılıp KDV'ye bölünüyor.
   *
   * Bu liste sunucudan ASENKRON geliyor. Gelmeden önce `selectedPg` null, formül boş metin
   * okunuyor ve kod "brüt" dalına düşüp fiyatı 1,16'ya BÖLÜYORDU. Liste gelince bölme
   * kalkıyor. Sonuç: aynı sepet, aynı cari, iki farklı Genel Toplam — hangisinin
   * görüneceği isteğin ne zaman döndüğüne bağlıydı. İstek hata verirse (yavaş ağ, tablet)
   * yanlış değer KALICI oluyordu.
   *
   * Artık üç şey var: yükleme durumu, hata durumunda yeniden deneme ve — asıl önemlisi —
   * grup çözülene kadar toplamların GÖSTERİLMEMESİ (aşağıda `fiyatGrubuBelirsiz`).
   */
  const [priceGroupsLoading, setPriceGroupsLoading] = useState(true)

  useEffect(() => {
    let iptal = false

    void (async () => {
      // İki deneme: ilk istek koparsa sessizce yanlış hesaba düşmek yerine tekrar dene.
      for (let deneme = 0; deneme < 2; deneme++) {
        try {
          const pg = await fetchPriceGroups({ includeInactive: false })
          if (iptal) return
          setPriceGroups(pg)
          setPriceGroupsLoading(false)
          return
        } catch {
          if (iptal) return
          if (deneme === 0) await new Promise((r) => setTimeout(r, 1200))
        }
      }
      if (!iptal) {
        setPriceGroups([])
        setPriceGroupsLoading(false)
      }
    })()

    return () => {
      iptal = true
    }
  }, [])

  useEffect(() => {
    if (!dealerCode) {
      setCampaigns([])
      return
    }

    void (async () => {
      try {
        setCampaignsLoading(true)
        const data = await fetchActiveCampaigns({ customerCode: dealerCode || undefined, includeExpired: false })
        setCampaigns(data)
      } catch {
        setCampaigns([])
      } finally {
        setCampaignsLoading(false)
      }
    })()
  }, [dealerCode])

  useEffect(() => {
    if (cart.lines.length > 0) {
      void cart.refreshCartPrices(dealerCode)
    }
  }, [dealerCode, cart.lines.length, cart.refreshCartPrices])

  useEffect(() => {
    if (cartOpen && cart.lines.length > 0) {
      void cart.refreshCartPrices(dealerCode)
    }
  }, [cartOpen, dealerCode, cart.lines.length, cart.refreshCartPrices])

  const cartLinesForDealer = useMemo(() => {
    return cart.lines.filter((l) => String(l.dealer?.id ?? '') === String(dealerCode ?? ''))
  }, [cart.lines, dealerCode])

  const selectedPg = useMemo(() => {
    const id = String(priceGroupId ?? '').trim()
    if (!id) return null
    const byId = priceGroups.find((x) => String(x.id) === id)
    if (byId) return byId
    const asCode = Number(id)
    if (Number.isFinite(asCode) && asCode > 0) {
      return priceGroups.find((x) => Number((x as any)?.code ?? 0) === asCode) ?? null
    }
    return null
  }, [priceGroupId, priceGroups])

  /**
   * KDV KARARI VERİLEBİLİR Mİ — TEK ÖLÇÜT.
   *
   * (2026-08-24, kullanıcı bildirimi: "ilk eklerken KDV'li gelmişti, sayfayı yenileyip
   * tekrar o cariyi seçtim, KDV'ler gitti.")
   *
   * Bu ölçüt eskiden İKİYE bölünmüştü ve ikisi çelişiyordu:
   *   - Hesaplama tarafı "grubun kaydı elimde mi" diye soruyordu; grubu boş olan caride
   *     cevap HAYIR oluyor, fatura tipi BİLİNMİYOR sayılıp KDV EKLENMİYORDU.
   *   - Uyarı tarafı ise "grup atanmışsa ve bulunamadıysa" diye soruyordu; grup hiç
   *     atanmamışsa belirsizlik YOK sayıyordu.
   *
   * Sonuç: fiyat grubu boş kalan bir caride ekran hiçbir uyarı vermeden, "Hesaplanıyor"
   * bile yazmadan, sipariş düğmesi açık hâlde KDV'siz bir Genel Toplam gösteriyordu.
   * Sessiz yanlış, gürültülü yanlıştan kötüdür.
   *
   * Artık tek soru var ve üç hâli ayırıyor:
   *   1. Cari kaydı hiç okunamadı (`priceGroupUnknown`) → karar YOK, beklenir.
   *   2. Cariye grup atanmış ama listede karşılığı yok/henüz gelmedi → karar YOK, beklenir.
   *   3. Cariye grup ATANMAMIŞ → bu da bir cevaptır; FATURA sayılır (v28 öncesi davranış),
   *      fiyat net kabul edilir ve üstüne KDV eklenir.
   */
  const kararVerilebilir = useMemo(() => {
    if (priceGroupUnknown) return false
    const id = String(priceGroupId ?? '').trim()
    if (!id) return true
    return !priceGroupsLoading && Boolean(selectedPg)
  }, [priceGroupId, priceGroupsLoading, selectedPg, priceGroupUnknown])

  const fiyatGrubuBelirsiz = !kararVerilebilir

  /**
   * BELIRSIZKEN RAKAM GOSTERILMEZ (2026-08-24, kullanici: "gerekirse beklesin ama bilgi
   * kesin dogru gelsin").
   *
   * Fiyat grubu cozulene kadar KDV karari verilemiyor; o sirada bir sayi basmak, kullaniciya
   * dogrulugu belirsiz bir tutar gostermek demek. Yanlis sayi yerine bekleme yazisi
   * gosteriliyor — kullanici neyi bekledigini biliyor ve yanlis rakama gore is yapmiyor.
   */
  const paraYaz = (deger: number, simge = '') =>
    fiyatGrubuBelirsiz ? 'Hesaplanıyor...' : `${formatMoney(deger)}${simge ? ' ' + simge : ''}`


  /**
   * KDV karari TEK KAYNAKTAN (`kdvKarari.ts`). Gerekce orada yazili; ozeti: bu karar iki
   * yerde kopyalanmisti ve eksik bilgiyle tahmin yuruttugu icin ayni sepet rolden role
   * farkli toplam gosteriyordu.
   */
  const kdvKarar = useMemo(() => {
    return kdvKarariVer(
      {
        cozuldu: kararVerilebilir,
        kod: selectedPg ? Number((selectedPg as any)?.code ?? 0) : null,
        formul: (selectedPg as any)?.formula ?? null,
        faturaTipi: (selectedPg as any)?.invoiceType ?? null,
      },
      Boolean(canOnlySeePriceGroup4),
    )
  }, [kararVerilebilir, selectedPg, canOnlySeePriceGroup4])

  const selectedInvoiceType = kdvKarar.faturaTipi

  const isAskeriyeFatura = useMemo(() => {
    return selectedInvoiceType === 'ASKERİYE'
  }, [selectedInvoiceType])

  /*
    MONTAJ FORMU ÖN DOLGUSU (2026-09-08 kullanıcı isteği).

    Montaj penceresi açılınca ad / telefon / adres / bölge, siparişin gittiği carinin
    kartından hazır gelir. Kaynak öncelikle TESLİM carisi (mağaza siparişinde seçilen
    son müşteri), o yoksa siparişi veren cari.

    DİKKAT: bayi siparişinde bu adres bayinin KENDİ adresidir; montaj çoğu zaman
    bayinin müşterisine gider. O yüzden modal, alanları karttan doldurduğunda görünür
    bir uyarı basıyor ve her alan elle değiştirilebiliyor — sessizce doldurup teknisyeni
    yanlış adrese göndermesin.
  */
  const montajDefaultsCode = String(deliveryCustomerCode || dealerCode || '').trim()
  const [montajCustomerDefaults, setMontajCustomerDefaults] = useState<
    { isimSoyisim?: string; telefon?: string; adres?: string; bolge?: string; kaynakEtiketi?: string } | undefined
  >(undefined)

  useEffect(() => {
    if (!montajDefaultsCode) {
      setMontajCustomerDefaults(undefined)
      return
    }
    const controller = new AbortController()
    void (async () => {
      try {
        const c = await fetchCustomerByCode(montajDefaultsCode, { signal: controller.signal })
        if (!c) {
          setMontajCustomerDefaults(undefined)
          return
        }
        const addr = String((c as any)?.address ?? '').trim()
        const district = String((c as any)?.district ?? '').trim()
        const ad = String((c as any)?.name ?? '').trim()
        const defaults = {
          isimSoyisim: ad,
          telefon: String((c as any)?.phone ?? '').trim(),
          adres: [addr, district].filter(Boolean).join(' / '),
          bolge: resolveRegionFromCity((c as any)?.city),
          kaynakEtiketi: ad ? `${ad} kartından` : 'cari kartından'
        }
        const doluAlanVar = Boolean(defaults.isimSoyisim || defaults.telefon || defaults.adres || defaults.bolge)
        setMontajCustomerDefaults(doluAlanVar ? defaults : undefined)
      } catch {
        // Kart okunamazsa form boş açılır; eski davranış. Kullanıcıya hata göstermeye
        // gerek yok, alanlar zaten elle doldurulabiliyor.
        setMontajCustomerDefaults(undefined)
      }
    })()
    return () => controller.abort()
  }, [montajDefaultsCode])

  const cartItems = useMemo(() => {
    return cartLinesForDealer
      .map((l) => {
        const realBaseUnit = Number(l.product.unitPrice ?? 0)
        const isDisplay4 = Boolean(canOnlySeePriceGroup4) && Number(l.product.displayUnitPrice ?? 0) > 0
        const displayBaseUnit = isDisplay4 ? Number(l.product.displayUnitPrice) : realBaseUnit
        const baseUnit = displayBaseUnit

        const wantsInstall = String(l.montaj ?? '').toLowerCase().includes('montaj istiyorum')
        const inlineFeeUnit = Number((l.product as any)?.installationFee ?? 0)
        const inlineIsInstallable = Boolean((l.product as any)?.isInstallable) || (Number.isFinite(inlineFeeUnit) && inlineFeeUnit > 0)
        const installUnit = wantsInstall && inlineIsInstallable && Number.isFinite(inlineFeeUnit) && inlineFeeUnit > 0 ? inlineFeeUnit : 0

        const metaTaxForInstall = Number(productPriceMetaByProductId[l.product.id]?.taxRate)
        const effectiveTaxRateForInstall = Number.isFinite(metaTaxForInstall) ? metaTaxForInstall : Number(l.product.kdvRate ?? 0)

        const unitWithInstall = baseUnit + installUnit
        const realUnitWithInstall = realBaseUnit + installUnit

        /*
          SUNUCUYA MONTAJIN NET KARŞILIĞI GİDER (2026-08-26).

          Sipariş gövdesi montajı ürün fiyatına KATIP tek bir birim fiyat olarak gönderiyor
          (`fiyat: realUnitWithInstall`). Sunucu bu tutara KDV uyguluyor — ama montaj bedeli
          zaten KDV DAHİL girilmiş olduğu için KDV'si ikinci kez hesaplanıyordu.

          Örnek: ürün 7.285,71 · montaj 300,00 (KDV dahil, %5)
              gönderilen 7.585,71 x 1,05 = 7.965,00   ← 15,00 fazla
              doğrusu     7.571,43 x 1,05 = 7.950,00

          Sunucunun formülüne dokunmadan çözülüyor: montaj bedeli katılmadan ÖNCE kendi
          oranıyla nete çevriliyor. Böylece sunucunun uyguladığı KDV, montajın kendi KDV'sini
          de doğru üretiyor ve ekrandaki özet ile kayıt birebir tutuyor.
        */
        const installUnitNet = installUnit > 0 && effectiveTaxRateForInstall > 0
          ? installUnit / (1 + effectiveTaxRateForInstall / 100)
          : installUnit
        const realUnitWithInstallNet = realBaseUnit + installUnitNet
        const rawLineTotal = unitWithInstall * Number(l.qty ?? 0)

        const metaTax = Number(productPriceMetaByProductId[l.product.id]?.taxRate)
        const effectiveTaxRate = Number.isFinite(metaTax) ? metaTax : Number(l.product.kdvRate ?? 0)

        /*
          FORMUL BILINMIYORSA BOLME YAPILMAZ (2026-08-24, kullanici bildirimi:
          "plasiyerde farkli, superadminde farkli", "diger rollerde de sacmaliyor").

          `formulaAlreadyNet`, secili fiyat grubunun formulunde REMOVE_KDV gecip gecmedigine
          bakiyor: geciyorsa fiyat NET saklanmis demek, oldugu gibi kullanilir; gecmiyorsa
          BRUT sayilip KDV'ye bolunur.

          Sorun: grup COZULEMEDIGINDE formul bos string okunuyor ve kod sessizce "brut" dalina
          dusup fiyati 1,16'ya BOLUYORDU. Ayni sepet, ayni cari, iki farkli Genel Toplam —
          hangisinin gorunecegi grubun elde olup olmamasina bagliydi. Role gore degismesinin
          sebebi de buydu.

          Neden "bolme" tarafi varsayilan OLAMAZ: her sey dogru yuklendiginde o dal zaten
          neredeyse hic calismiyor. FATURA tipi gruplarin (kod 1-3) TAMAMI REMOVE_KDV'li,
          yani net; kod 4-6 ACIK tipe dusuyor ve orada KDV hic uygulanmiyor. Yani "formul bos"
          bir is kurali degil, VERI EKSIKLIGININ isareti; o eksiklikte fiyati degistirmek
          degistirmemekten kotudur.

          Belirsizlik SESSIZ degil: `fiyatGrubuBelirsiz` iken sepette uyari cikiyor ve
          siparis olusturma kapali.
        */
        const formulaAlreadyNet = kdvKarar.fiyatZatenNet
        // `isDisplay4` satir bazli oldugu icin karara BURADA ekleniyor: perakende fiyat
        // gosteriliyorsa KDV zaten fiyatin icinde, ustune eklenmez.
        const shouldApplyVat = kdvKarar.kdvEklenir && !isDisplay4
        const vatFactor = 1 + (Number(effectiveTaxRate) || 0) / 100

        // lineTotal is net (KDV hariç), used for display per-row
        const lineTotal = shouldApplyVat ? (!formulaAlreadyNet && vatFactor > 0 ? rawLineTotal / vatFactor : rawLineTotal) : rawLineTotal
        const rawProductLineTotal = baseUnit * Number(l.qty ?? 0)
        const productLineTotal = shouldApplyVat ? (!formulaAlreadyNet && vatFactor > 0 ? rawProductLineTotal / vatFactor : rawProductLineTotal) : rawProductLineTotal
        /*
          MONTAJ BEDELİ KDV MATRAHINA GİRMEZ (2026-08-26, kullanıcı: "KDV'yi dahil edip
          üstüne ataması lazımdı ama KDV ile beraber bir daha ekledi").

          Montaj bedeli KDV DAHİL girilir ve kırılımı da öyle gösterilir
          (`buildInstallationFeeSummary`: net = brüt / (1+oran)). Ama KDV burada
          `lineTotal` üzerinden hesaplanıyordu ve `lineTotal` montajı DA içeriyor
          (`unitWithInstall = baseUnit + installUnit`). Sonuç: montajın KDV'si iki kez.

          Canlı örnek — ürün 7.285,71 · montaj 300,00 (285,71 + %5 14,29):
              yanlış: KDV (7.285,71 + 300,00) x %5 = 379,29 → genel toplam 7.965,00
              doğru : KDV  7.285,71          x %5 = 364,29 → genel toplam 7.950,00
          Fazlalık tam olarak montajın kendi KDV'si kadar (300 x %5 = 15,00).

          Matrah artık YALNIZCA ürün tarafı (`productLineTotal` / `rawProductLineTotal`).
          Montajın KDV'si zaten kendi brüt tutarının içinde ve özet satırında ayrıca
          gösteriliyor; genel toplam `ürün net + ürün KDV + montaj brüt` olarak doğru kurulur.
        */
        const lineKdv = shouldApplyVat ? (!formulaAlreadyNet && vatFactor > 0 ? rawProductLineTotal - productLineTotal : (productLineTotal * effectiveTaxRate) / 100) : 0

        return {
          line: l,
          lineTotal,
          productLineTotal,
          lineKdv,
          baseUnit,
          realBaseUnit,
          displayBaseUnit,
          installUnit,
          unitWithInstall,
          realUnitWithInstall,
          realUnitWithInstallNet,
          effectiveTaxRate,
          rawLineTotal,
          rawProductLineTotal,
          vatFactor,
          formulaAlreadyNet,
          shouldApplyVat,
          isDisplay4
        }
      })
      .filter(Boolean) as any[]
  }, [cartLinesForDealer, productPriceMetaByProductId, selectedInvoiceType, selectedPg, isAskeriyeFatura, canOnlySeePriceGroup4])

  const [campaignResult, setCampaignResult] = useState<any>({
    appliedCampaigns: [],
    totalDiscount: 0,
    giftItems: [],
    itemDiscounts: {},
    nonGiftLines: null
  })
  const [campaignEvaluating, setCampaignEvaluating] = useState(false)
  /** Son gönderilen kampanya hesabının sırası: geç dönen ESKİ cevap yenisinin üstüne yazmasın. */
  const campaignEvalSeq = useRef(0)

  const displayCartItems = useMemo(() => {
    return cartItems
      .map((it: any) => {
        const matchingNonGift = campaignResult?.nonGiftLines?.find(
          (l: any) => l.stockCode?.toUpperCase() === it.line.product.stockCode?.toUpperCase()
        )
        
        // Always use the real cart quantity for instant updates,
        // rather than waiting for the debounced campaign evaluation response.
        const qtyToUse = it.line.qty

        const rawLineTotal = it.unitWithInstall * qtyToUse
        const rawProductLineTotal = it.baseUnit * qtyToUse
        const shouldApplyVat = kdvKarar.kdvEklenir && !it.isDisplay4
        const factor = 1 + (Number(it.effectiveTaxRate) || 0) / 100
        const formulaAlreadyNet = kdvKarar.fiyatZatenNet

        const lineTotal = shouldApplyVat ? (!formulaAlreadyNet && factor > 0 ? rawLineTotal / factor : rawLineTotal) : rawLineTotal
        const productLineTotal = shouldApplyVat ? (!formulaAlreadyNet && factor > 0 ? rawProductLineTotal / factor : rawProductLineTotal) : rawProductLineTotal
        const lineKdv = shouldApplyVat ? (!formulaAlreadyNet && factor > 0 ? rawLineTotal - lineTotal : (lineTotal * (Number(it.effectiveTaxRate) || 0)) / 100) : 0

        return { ...it, displayQty: qtyToUse, lineTotal, productLineTotal, lineKdv, rawLineTotal, rawProductLineTotal, vatFactor: factor, formulaAlreadyNet, shouldApplyVat }
      })
      .filter((it: any) => it.displayQty > 0)
  }, [cartItems, campaignResult, selectedInvoiceType, selectedPg, isAskeriyeFatura])

  useEffect(() => {
    if (!dealerCode || cartItems.length === 0) {
      setCampaignResult({ appliedCampaigns: [], totalDiscount: 0, giftItems: [], itemDiscounts: {}, nonGiftLines: null })
      return
    }

    const timer = setTimeout(async () => {
      const seq = ++campaignEvalSeq.current
      try {
        setCampaignEvaluating(true)
        const token = localStorage.getItem('accessToken')
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (token) headers.Authorization = `Bearer ${token}`

        const body = {
          customerCode: dealerCode,
          lines: cartItems.map((it: any) => ({
            stockCode: it.line.product.stockCode,
            quantity: Number(it.line.qty),
            unitPrice: Number(it.line.product.unitPrice),
            vatRate: (selectedInvoiceType === 'ACIK' || isAskeriyeFatura) ? 0 : (it.effectiveTaxRate ?? it.line.product.kdvRate ?? 0)
          })),
          priceGroupCode: selectedPg ? Number((selectedPg as any)?.code ?? 0) : undefined
        }

        const res = await fetch(`${apiBaseUrl}/api/campaigns/evaluate-salesorder`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body)
        })

        if (!res.ok) {
          throw new Error('Failed to evaluate campaigns')
        }

        const json = await res.json()
        const data = json.data
        // Bu arada sepet yine değiştiyse sonucu yeni hesap yazacak.
        if (seq !== campaignEvalSeq.current) return

        if (data) {
          const appliedCampaigns = (data.appliedCampaignDetails ?? []).map((c: any) => ({
            campaignId: c.campaignId,
            campaignName: c.campaignName,
            campaignType: c.campaignType,
            discountAmount: c.appliedDiscountAmount,
            discountType: c.discountType === 'Oran' ? 'Oran' : 'Tutar',
            appliedTo: c.campaignType === 1 ? 'basket' : 'product',
            productStockCode: c.stockCodesJson ? JSON.parse(c.stockCodesJson)[0] : undefined
          }))

          const itemDiscounts: Record<string, number> = {}
          data.lines.forEach((l: any) => {
            if (!l.isGift && l.discountAmount > 0) {
              itemDiscounts[l.stockCode] = (itemDiscounts[l.stockCode] || 0) + l.discountAmount
            }
          })

          const giftItems = data.lines
            .filter((l: any) => l.isGift)
            .map((l: any) => ({
              product: {
                id: l.stockCode,
                stockCode: l.stockCode,
                name: l.productName || l.stockCode,
                unitPrice: l.unitPrice,
                kdvRate: l.vatRate,
                isGift: true
              },
              qty: l.quantity,
              lineTotal: l.lineTotal,
              discountAmount: l.discountAmount
            }))

          const nonGiftLines = data.lines
            .filter((l: any) => !l.isGift)
            .map((l: any) => ({
              stockCode: l.stockCode,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              discountAmount: l.discountAmount,
              lineTotal: l.lineTotal
            }))

          setCampaignResult({
            appliedCampaigns,
            totalDiscount: data.discountTotal,
            giftItems,
            itemDiscounts,
            nonGiftLines
          })
        }
      } catch (err) {
        console.error(err)
      } finally {
        if (seq === campaignEvalSeq.current) setCampaignEvaluating(false)
      }
    }, 250)

    return () => clearTimeout(timer)
  }, [dealerCode, cartItems, selectedInvoiceType, apiBaseUrl])

  // Sepette hangi para birimleri var (ürünün KENDİ para birimi; cari kartına bakılmaz).
  const cartCurrencies = useMemo(() => {
    const set = new Set<string>()
    for (const it of cartItems) set.add(currencyCodeOf(it?.line?.product))
    for (const g of (campaignResult.giftItems || [])) set.add(currencyCodeOf(g?.product))
    const list = Array.from(set)
    list.sort((a, b) => {
      const ia = CURRENCY_ORDER.indexOf(a)
      const ib = CURRENCY_ORDER.indexOf(b)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })
    return list
  }, [cartItems, campaignResult])

  // Sepetin tek para birimi varsa o; karışıksa ilk sıradaki. Yalnız tek satırlık
  // özet/rozet gösterimlerinde kullanılır — toplamlar para birimi başına ayrı yürür.
  const primaryCurrency = cartCurrencies[0] ?? 'TRY'
  const primaryCurrencySymbol = currencySymbolOf(primaryCurrency)
  const isMixedCurrencyCart = cartCurrencies.length > 1

  // Toplamlar PARA BİRİMİ BAŞINA ayrı yürür; hiçbir satır başka bir dövize çevrilmez.
  const totalsByCurrency = useMemo(() => {
    type Bucket = {
      currency: string
      symbol: string
      netSum: number
      productNetSum: number
      brutSum: number
      campaignDiscount: number
      /** Kalem indirimleri düşülmüş net ve KDV — KDV indirimli satır üzerinden. */
      netAfter: number
      kdvAfter: number
    }

    const buckets = new Map<string, Bucket>()
    const bucketOf = (currency: string): Bucket => {
      const key = currency || 'TRY'
      let b = buckets.get(key)
      if (!b) {
        b = { currency: key, symbol: currencySymbolOf(key), netSum: 0, productNetSum: 0, brutSum: 0, campaignDiscount: 0, netAfter: 0, kdvAfter: 0 }
        buckets.set(key, b)
      }
      return b
    }

    const kalemIndirimleri = (campaignResult.itemDiscounts || {}) as Record<string, number>

    for (const it of displayCartItems) {
      const bucket = bucketOf(currencyCodeOf(it.line?.product))
      const factor = it.vatFactor ?? (1 + (Number(it.effectiveTaxRate) || 0) / 100)
      const formulaAlreadyNet = it.formulaAlreadyNet ?? false
      const shouldApplyVat = it.shouldApplyVat ?? true
      const qty = Number(it.displayQty ?? it.line?.qty ?? 0)

      // Net (araToplam): lineTotal zaten doğru (qty × birim net fiyat)
      const itemNet = Number(it.lineTotal ?? 0)
      const itemProductNet = Number(it.productLineTotal ?? 0)

      // Brüt: birim başına yeniden oluştur → 0,01 kuruş birikme hatası sıfırlanır
      let itemBrut: number

      if (shouldApplyVat && factor > 1) {
        if (formulaAlreadyNet) {
          // Fiyat NET olarak saklanmış → round(baseUnit × vatFactor) × qty
          const brutPerUnit        = Math.round(it.baseUnit * factor * 100) / 100
          const brutInstallPerUnit = it.installUnit > 0 ? Math.round(it.installUnit * factor * 100) / 100 : 0
          itemBrut = (brutPerUnit + brutInstallPerUnit) * qty
        } else {
          // Fiyat BRÜT olarak saklanmış → rawLineTotal direkt brüt
          itemBrut = Number(it.rawLineTotal ?? it.lineTotal ?? 0)
        }
      } else {
        // KDV yok (ACIK tip veya %0) → brüt = net
        itemBrut = itemNet
      }

      bucket.netSum        += itemNet
      bucket.productNetSum += itemProductNet
      bucket.brutSum       += itemBrut

      /*
        KDV İNDİRİMLİ SATIR ÜZERİNDEN (2026-09-18) — sunucu `BuildResponse` ile aynı kural.
        Kampanya indirimi F4'e uygulanıp carinin grubuna formülle taşındığı için satırın
        birim fiyatı düşer; KDV düşmüş fiyatın KDV'sidir. Kalemin KDV'si (brüt − net)
        indirimli net oranında küçülür; sepet geneli indirim (kalemlere dağılmayan) KDV
        tabanını değiştirmez.
      */
      const sc = String(it.line?.product?.stockCode ?? '').trim()
      const itemDiscount = canOnlySeePriceGroup4 ? 0 : Math.min(itemNet, Math.max(0, Number(kalemIndirimleri[sc] ?? 0)))
      const itemNetAfter = itemNet - itemDiscount
      const itemKdv = Math.max(0, itemBrut - itemNet)
      bucket.netAfter += itemNetAfter
      bucket.kdvAfter += itemNet > 0 ? itemKdv * (itemNetAfter / itemNet) : itemKdv
    }

    // Kampanya hediyesi: 0,01 sabit (kampanya yapısı korunuyor, KDV'siz).
    // Hediye, hediye ürünün KENDİ para biriminin kovasına yazılır.
    for (const g of (campaignResult.giftItems || [])) {
      const bucket = bucketOf(currencyCodeOf(g?.product))
      const giftTotal = 0.01 * Number(g.qty || 1)
      bucket.netSum        += giftTotal
      bucket.productNetSum += giftTotal
      bucket.brutSum       += giftTotal
      bucket.netAfter      += giftTotal
    }

    // Kampanya indirimi de kalemin para birimindedir: indirim ürünün fiyatından
    // hesaplanıyor, fiyat da ürünün kendi para biriminde. Kalem bazlı indirimler
    // (itemDiscounts) stok koduyla eşleştirilip kendi kovasına yazılır.
    if (!canOnlySeePriceGroup4) {
      const currencyByStockCode = new Map<string, string>()
      for (const it of displayCartItems) {
        const sc = String(it.line?.product?.stockCode ?? '').trim()
        if (sc) currencyByStockCode.set(sc, currencyCodeOf(it.line?.product))
      }

      const itemDiscounts = kalemIndirimleri
      for (const [stockCode, amount] of Object.entries(itemDiscounts)) {
        const value = Number(amount || 0)
        if (!Number.isFinite(value) || value <= 0) continue
        bucketOf(currencyByStockCode.get(String(stockCode).trim()) ?? primaryCurrency).campaignDiscount += value
      }

      // Kalem bazına dağılmayan (sepet geneli) indirimler: kalem indirimlerinin
      // toplamından artan kısım. Tek para birimli sepette bu kovaya, karışık sepette
      // ilk para birimine yazılır — çevrilmez.
      const giftDiscounts = (campaignResult.giftItems || []).reduce(
        (acc: number, g: any) => acc + Number(g.discountAmount || 0),
        0
      )
      const itemDiscountSum = Object.values(itemDiscounts).reduce(
        (acc: number, v: any) => acc + (Number(v) || 0),
        0
      )
      const basketLevelDiscount = Math.max(
        0,
        Number(campaignResult.totalDiscount ?? 0) - giftDiscounts - itemDiscountSum
      )
      if (basketLevelDiscount > 0) {
        bucketOf(primaryCurrency).campaignDiscount += basketLevelDiscount
      }
    }

    const list = Array.from(buckets.values()).map((b) => {
      const araToplam     = Math.round(b.netSum * 100) / 100
      const urunAraToplam = Math.round(b.productNetSum * 100) / 100
      // KDV = brüt - net: brüt her zaman tam (birim başına yeniden oluşturuldu),
      // bu sayede araToplam + kdv = brutSum daima eşit olur, 0,01 sapması olmaz.
      const campaignDiscount = Math.round(b.campaignDiscount * 100) / 100

      /*
        KAMPANYA İNDİRİMİ = FATURA İSKONTOSU (2026-09-18 kullanıcı kuralı: "aynı satış
        faturasındaki iskonto kutucuğu gibi olsun").

        İndirim KDV DAHİL tutardan düşer, net ve KDV kalan orana göre ayrışır; genel toplam
        "taban − indirim"dir. Hesap satış faturasıyla TEK KAYNAKTAN: `iskontoyuAyristir`
        ([[fatura-iskonto-kdv-dahil]]). Eskiden yalnız genel toplamdan düşülüyor, net ve KDV
        satırları indirimsiz kalıyordu — ekranda net + KDV, genel toplamı tutmuyordu.
      */
      /*
        2026-09-18 (ikinci karar): kampanya indirimi F4 TABANLI ve kalem bazlı olduğu için
        toplam artık "iskonto kutusu" (KDV dahil tutardan düşme) gibi değil, SATIR gibi
        hesaplanır: net = kalem netleri − kalem indirimleri, KDV = indirimli satırın KDV'si,
        genel = net + KDV. Böylece grup 1'deki cari 26.000→21.000 klimayı tam 21.000 öder.
        Kalemlere dağılmayan sepet geneli indirim netten düşer, KDV tabanı değişmez (sunucu
        `BuildResponse` ile birebir). `iskontoyuAyristir` yolu bilerek bırakıldı.
      */
      const kalemIndirimToplam = Math.round(b.campaignDiscount * 100) / 100
      const sepetGeneliIndirim = Math.max(0, kalemIndirimToplam - Math.round((b.netSum - b.netAfter) * 100) / 100)
      const netIndirimli = Math.max(0, Math.round((b.netAfter - sepetGeneliIndirim) * 100) / 100)
      const kdvIndirimli = Math.max(0, Math.round(b.kdvAfter * 100) / 100)
      const genelIndirimli = Math.round((netIndirimli + kdvIndirimli) * 100) / 100

      return {
        currency: b.currency,
        symbol: b.symbol,
        araToplam: netIndirimli,
        // Montajsız ürün satırı da indirimli net oranında küçülür; iki satır arasında
        // indirimin yarısı uygulanmış gibi görünmesin.
        urunAraToplam: araToplam > 0
          ? Math.round(urunAraToplam * (netIndirimli / araToplam) * 100) / 100
          : urunAraToplam,
        kdv: kdvIndirimli,
        genel: genelIndirimli,
        campaignDiscount
      }
    })

    list.sort((a, b) => {
      const ia = CURRENCY_ORDER.indexOf(a.currency)
      const ib = CURRENCY_ORDER.indexOf(b.currency)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })

    return list
  }, [displayCartItems, campaignResult, canOnlySeePriceGroup4, primaryCurrency])

  // Tek para birimli sepette (olağan durum) eski tek-blok görünümünü besler.
  // Karışık sepette yalnız ilk para biriminin kovasıdır — ekranda her kova ayrı basılır.
  const totals = useMemo(
    () =>
      totalsByCurrency[0] ?? {
        currency: primaryCurrency,
        symbol: primaryCurrencySymbol,
        araToplam: 0,
        urunAraToplam: 0,
        kdv: 0,
        genel: 0,
        campaignDiscount: 0
      },
    [totalsByCurrency, primaryCurrency, primaryCurrencySymbol]
  )

  const campaignSummaryList = useMemo(() => {
    if (canOnlySeePriceGroup4) return []
    // Her satır KENDİ para biriminin simgesiyle basılır; tutarlar çevrilmez.
    const list: Array<{ title: string; subtitle?: string; amount: number; isGift?: boolean; symbol: string }> = []

    for (const gift of (campaignResult.giftItems || [])) {
      const unitP = 0.01
      const qty = Number(gift.qty || 1)
      const amount = unitP * qty
      const symbol = currencySymbolOf(currencyCodeOf(gift.product))
      list.push({
        title: `🎁 Kampanya Hediyesi: ${gift.product?.name || gift.product?.stockCode}`,
        subtitle: `${qty} Adet x ${formatMoney(unitP)} ${symbol} (Hediye Ürün)`,
        amount,
        isGift: true,
        symbol
      })
    }

    for (const c of (campaignResult.appliedCampaigns || [])) {
      if (c.discountAmount > 0) {
        list.push({
          title: `🏷️ ${c.campaignName}`,
          amount: Number(c.discountAmount),
          symbol: primaryCurrencySymbol
        })
      }
    }

    return list
  }, [campaignResult, primaryCurrencySymbol, canOnlySeePriceGroup4])
  // Montaj özeti de para birimi başına: montaj bedeli ürünün fiyatından türüyor,
  // dolayısıyla ürünün para birimindedir. `currency` verilmezse tüm sepet toplanır.
  const buildInstallationFeeSummary = (currency?: string) => {
    const items = (cartItems as any[]).filter(
      (it) =>
        Number(it.installUnit ?? 0) > 0 &&
        (!currency || currencyCodeOf(it.line?.product) === currency)
    )
    const gross = items.reduce((acc, it) => acc + Number(it.installUnit ?? 0) * Number(it.line?.qty ?? 0), 0)
    if (!Number.isFinite(gross) || gross <= 0) return { gross: 0, net: 0, vat: 0, rateLabel: '' }

    const rates = Array.from(
      new Set(
        items
          .map((it) => Number(it.effectiveTaxRate ?? 0))
          .filter((x) => Number.isFinite(x) && x > 0)
          .map((x) => Math.round(x))
      )
    )

    const sums = items.reduce(
      (acc, it) => {
        const qty = Number(it.line?.qty ?? 0)
        const itemGross = Math.max(0, Number(it.installUnit ?? 0) * qty)
        const rate = Number(it.effectiveTaxRate ?? 0)
        const factor = 1 + (Number.isFinite(rate) ? rate : 0) / 100
        const itemNet = factor > 0 ? itemGross / factor : itemGross
        return { net: acc.net + itemNet, gross: acc.gross + itemGross }
      },
      { net: 0, gross: 0 }
    )

    const net = sums.net
    const vat = Math.max(0, sums.gross - sums.net)
    const rateLabel = rates.length === 1 ? `%${rates[0]}` : rates.length > 1 ? '%Karışık' : ''
    return { gross: sums.gross, net, vat, rateLabel }
  }

  const installationFeeSummary = useMemo(
    () => buildInstallationFeeSummary(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cartItems]
  )

  // Fiyat grubu çözülmeden sipariş oluşturulamaz: ekrandaki toplam yanlış olabilir ve
  // kullanıcı gördüğü rakama güvenerek gönderir.
  const canCreateOrder = cartItems.length > 0 && Boolean(dealerCode) && !fiyatGrubuBelirsiz

  const formatMontajBreakdownText = (it: any) => {
    const qty = Number(it?.line?.qty ?? 0)
    const rate = Number(it?.effectiveTaxRate ?? it?.line?.product?.kdvRate ?? 0)

    const gross = Math.max(0, Number(it?.installUnit ?? 0) * qty)
    if (!Number.isFinite(gross) || gross <= 0) return null
    const factor = 1 + (Number.isFinite(rate) ? rate : 0) / 100
    const net = factor > 0 ? gross / factor : gross
    const vat = Math.max(0, gross - net)
    const readable = `Montaj = ${formatMoney(gross)}`
    const tag = `[MONTAJ net=${net.toFixed(2)} vat=${vat.toFixed(2)} gross=${gross.toFixed(2)} rate=${Number.isFinite(rate) ? rate : 0}]`
    return { readable, tag }
  }

  const submitOrder = async () => {
    if (!canCreateOrder) return

    try {
      setCreatingOrder(true)

      const token = localStorage.getItem('accessToken')
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`

      const mapCurrencyToCurrencyTypeId = (currency: string | null | undefined): number => {
        const c = String(currency ?? '').trim().toUpperCase()
        if (c === 'EUR') return 2
        if (c === 'USD') return 3
        if (c === 'GBP') return 4
        return 1
      }

      const body = {
        cariKodu: deliveryCustomerCode || dealerCode,
        teslimCariKodu: dealerCode,
        lines: cartItems.map((it: any, idx: number) => ({
          stokKodu: it.line.product.stockCode,
          aciklama: (() => {
            const note = String(it.line.note ?? '').trim()
            const m = formatMontajBreakdownText(it)
            if (!m) return note
            const parts = [note, m.readable].filter((x) => String(x ?? '').trim().length > 0)
            return parts.join('\n')
          })(),
          montajIsimSoyisim: it.line.montajDetails?.isimSoyisim ?? montajDetailsByProductId?.[it.line.product.id]?.isimSoyisim ?? null,
          montajTelefon: it.line.montajDetails?.telefon ?? montajDetailsByProductId?.[it.line.product.id]?.telefon ?? null,
          montajAdres: it.line.montajDetails?.adres ?? montajDetailsByProductId?.[it.line.product.id]?.adres ?? null,
          montajBolge: it.line.montajDetails?.bolge ?? montajDetailsByProductId?.[it.line.product.id]?.bolge ?? null,
          montajBayiAdi: it.line.montajDetails?.bayiAdi ?? montajDetailsByProductId?.[it.line.product.id]?.bayiAdi ?? null,
          montajUrunAdi: it.line.montajDetails?.urunAdi ?? montajDetailsByProductId?.[it.line.product.id]?.urunAdi ?? null,
          montajBayiAciklama: it.line.montajDetails?.bayiAciklama ?? montajDetailsByProductId?.[it.line.product.id]?.bayiAciklama ?? null,
          miktar: it.line.qty,
          fiyat: String(it.line.montaj ?? '').toLowerCase().includes('montaj istiyorum')
            ? Number(it.realUnitWithInstallNet ?? it.realUnitWithInstall ?? it.line.product.unitPrice)
            : Number(it.realBaseUnit ?? it.line.product.unitPrice),
          currencyTypeId: mapCurrencyToCurrencyTypeId(it.line.product.currency),
          kdvOran: selectedInvoiceType === 'ACIK' ? 0 : (it.effectiveTaxRate ?? it.line.product.kdvRate ?? 0),
          sira: idx + 1,
          kampanyaKodu: null,
          montaj: String(it.line.montaj ?? '').toLowerCase().includes('montaj istiyorum'),
          grupId: null
        })),
        campaignDiscount: totals.campaignDiscount,
        campaignDetailsJson: JSON.stringify(campaignResult.appliedCampaigns)
      }

      const res = await fetch(`${apiBaseUrl}/api/salesorders/confirm`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      })

      if (!res.ok) {
        let jsonErr: any = null
        try {
          jsonErr = await res.json()
        } catch {
          jsonErr = null
        }

        const code = String(jsonErr?.code ?? '')
        const msg = String(jsonErr?.message ?? '')

        if (code === 'CREDIT_LIMIT_EXCEEDED') {
          const creditLimit = Number(jsonErr?.data?.creditLimit)
          const projected = Number(jsonErr?.data?.projected)
          const currencyTypeId = Number(jsonErr?.data?.currencyTypeId ?? 1)
          const currencySymbol = String(jsonErr?.data?.currencySymbol || (currencyTypeId === 3 ? '$' : currencyTypeId === 2 ? '€' : currencyTypeId === 4 ? '£' : '₺'))
          const requiredPaymentRaw = Number.isFinite(creditLimit) && Number.isFinite(projected) ? projected - creditLimit : NaN
          const requiredPayment = Number.isFinite(requiredPaymentRaw) ? Math.max(0, requiredPaymentRaw) : NaN
          const requiredSuffix =
            Number.isFinite(requiredPayment) && requiredPayment > 0
              ? ` Sipariş verebilmek için ${formatMoney(requiredPayment)} ${currencySymbol} kadar ödeme yapmanız gerekiyor.`
              : ''
          setCreditLimitErrorMessage((msg || 'Limitiniz yetersiz') + requiredSuffix)
          setCreditLimitErrorOpen(true)
          return
        }

        const text = msg || (jsonErr ? JSON.stringify(jsonErr) : await res.text())
        setGeneralErrorMessage(text || 'Sipariş oluşturulamadı')
        setGeneralErrorOpen(true)
        return
      }

      const json = await res.json()
      setOrderSuccessMessage(String(json?.message ?? 'Siparişiniz başarıyla oluşturuldu.'))
      setOrderSuccessOrderNo(String(json?.data?.siparisNo ?? json?.data?.SiparisNo ?? ''))
      setOrderSuccessOpen(true)

      // Yalnız siparişi verilen carinin sepeti düşer (bkz. CartContext.clearAfterOrder).
      cart.clearAfterOrder(dealerCode)
      setCartOpen(false)
    } catch {
      setGeneralErrorMessage('Sipariş oluşturulamadı')
      setGeneralErrorOpen(true)
    } finally {
      setCreatingOrder(false)
    }
  }

  useLayoutEffect(() => {
    let raf = 0
    let attempts = 0

    const calc = () => {
      const el = fabAnchorRef?.current ?? productSearchRef.current
      const searchRect = (el as any)?.getBoundingClientRect?.()
      if (!searchRect || searchRect.height === 0) {
        attempts += 1
        if (attempts < 60) schedule()
        return
      }

      const top = Math.max(120, searchRect.bottom + 12)
      setCartFabTop(top)
      setCartFabReady(true)
    }

    const schedule = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(calc)
    }

    setCartFabReady(false)
    attempts = 0
    schedule()
    window.addEventListener('resize', schedule)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('resize', schedule)
    }
  }, [])

  if (!dealerCode) return null

  return (
    <>
      {!hideCampaignHeader ? (
        <>
          {!campaignsLoading && campaigns.length > 0 && (
            <div className="mb-4">
              <CampaignCarousel campaigns={campaigns} />
            </div>
          )}

          {!campaignsLoading && campaigns.length > 0 && (
            <div className="mb-4 flex justify-center">
              <button
                type="button"
                onClick={() => setCampaignsModalOpen(true)}
                className="px-6 py-2 text-white font-semibold rounded-lg shadow-md transition-all hover:opacity-90 active:scale-95"
                style={{ background: 'linear-gradient(90deg, var(--tenant-gradient-from, #8F2500), var(--tenant-gradient-to, #BD390C))' }}
              >
                Tüm Kampanyaları Gör ({campaigns.length})
              </button>
            </div>
          )}

          <CampaignsListModal isOpen={campaignsModalOpen} onClose={() => setCampaignsModalOpen(false)} campaigns={campaigns} />

          <CampaignDetailPopover
            isOpen={campaignDetailOpen}
            onClose={() => {
              setCampaignDetailOpen(false)
              setSelectedProductForCampaign(null)
            }}
            campaigns={campaigns.filter((c) =>
              selectedProductForCampaign
                ? c.discounts.some((d) => d.stokKodu === selectedProductForCampaign.stockCode) ||
                c.conditions.some((cond) => {
                  if (!cond.productStockCodesJson) return false
                  try {
                    const stockCodes = JSON.parse(cond.productStockCodesJson) as string[]
                    return stockCodes.includes(selectedProductForCampaign.stockCode)
                  } catch {
                    return false
                  }
                })
                : false
            )}
            productName={selectedProductForCampaign?.name}
          />
        </>
      ) : null}

      {!fabAnchorRef ? <input ref={productSearchRef} className="hidden" /> : null}

      <div className="fixed right-2 z-40" style={{ top: cartFabTop, visibility: cartFabReady ? 'visible' : 'hidden' }}>
        <button
          type="button"
          onClick={() => setCartOpen(true)}
          className="group w-14 h-14 flex items-center justify-center rounded-2xl bg-white border border-gray-200 hover:bg-green-50 hover:border-green-300 active:bg-green-100 transition-colors shadow-lg"
          title="Sepet"
        >
          <div className="relative">
            <ShoppingCart size={22} className="text-gray-700 group-hover:text-green-700" />
            {(() => {
              const totalQty = cartItems.reduce((acc: number, it: any) => acc + (Number(it.line?.qty) || 0), 0);
              return totalQty > 0 ? (
                <span className="absolute -top-2 -right-2 min-w-5 h-5 px-1 rounded-full bg-pink-600 text-white text-[10px] font-extrabold flex items-center justify-center">
                  {totalQty}
                </span>
              ) : null;
            })()}
          </div>
        </button>
      </div>

      {cartOpen && (
        <div className="fixed inset-0 z-50">
          <style dangerouslySetInnerHTML={{__html: `
            @keyframes fadeInBackdrop {
              from { opacity: 0; }
              to { opacity: 0.35; }
            }
            @keyframes slideInRightDrawer {
              from { transform: translateX(100%); }
              to { transform: translateX(0); }
            }
            .animate-fade-in-backdrop {
              animation: fadeInBackdrop 0.25s forwards ease-out;
            }
            .animate-slide-in-right-drawer {
              animation: slideInRightDrawer 0.25s forwards cubic-bezier(0.16, 1, 0.3, 1);
            }
          `}} />
          <button type="button" className="absolute inset-0 bg-black opacity-0 animate-fade-in-backdrop" onClick={() => setCartOpen(false)} aria-label="Kapat" />

          {/*
            TABLETTE ALT KISIM EKRAN DISINDA KALIYORDU (2026-08-24, kullanici bildirimi).

            Iki sebep birlikte:
              1) `h-screen` = `100vh`, mobil tarayicida adres cubugu GIZLIYKEN olculen
                 yukseklik. Cubuk gorunurken cekmece ekrandan tasiyor ve alti kesiliyor.
                 `100dvh` o anda gorunen yuksekligi verir.
              2) Kaydirma alani `min-h-0` almiyordu — bkz. oradaki not.
          */}
          <div className="fixed right-0 top-0 h-screen supports-[height:100dvh]:h-[100dvh] w-full md:w-[60vw] max-w-[900px] bg-white shadow-[-8px_0_24px_rgba(0,0,0,0.12)] flex flex-col animate-slide-in-right-drawer">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <div>
                <div className="text-xl font-bold text-gray-900">Sepet</div>
                <div className="mt-1 text-xs font-semibold text-gray-600">
                  {dealerLabel}
                  {deliveryCustomerCode && deliveryCustomerCode !== dealerCode ? (
                    <span className="ml-2 text-gray-500">→ {deliveryCustomerLabel || deliveryCustomerCode}</span>
                  ) : null}
                </div>
              </div>
              <button type="button" className="text-red-500 hover:text-red-600" onClick={() => setCartOpen(false)} aria-label="Kapat" title="Kapat">
                <X size={18} />
              </button>
            </div>

            {/* Desktop Table Headers */}
            <div className="hidden md:grid items-center px-6 py-2.5 text-[11px] font-bold text-gray-400 uppercase tracking-wide border-b border-gray-200 bg-gray-50/80" style={{ gridTemplateColumns: '2fr 2fr 1fr 1.3fr 1.1fr 1fr 40px' }}>
              <div>Ürün Adı</div>
              <div>Açıklama</div>
              <div className="text-right">Birim Fiyat</div>
              <div className="text-right">Montaj Fiyatı</div>
              <div className="text-center">Miktar</div>
              <div className="text-right">Toplam</div>
              <div />
            </div>

            {/*
              `min-h-0` SART. Flex cocugunun varsayilan `min-height: auto` degeri bu kutunun
              ICERIGINDEN kisa olmasini engelliyor: sepette birkac satir olunca kutu icerik
              boyuna buyuyor, altindaki toplam blogu ve "Siparisi Olustur / Sepeti Temizle"
              dugmeleri asagi kayip ekran disinda kaliyordu. Tablette daha erken goruluyor:
              ekran kisa ama cekmece genis, satirlar sarmadan uzuyor.
            */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {displayCartItems.map((it: any) => {
                const rate = Number(it.effectiveTaxRate ?? it.line?.product?.kdvRate ?? 0)
                const factor = 1 + (Number.isFinite(rate) ? rate : 0) / 100
                const installUnitGross = Number(it.installUnit ?? 0)
                const installUnitNet = installUnitGross > 0 && factor > 0 ? installUnitGross / factor : installUnitGross
                const installUnitVat = Math.max(0, installUnitGross - installUnitNet)
                const rateLabel = Number.isFinite(rate) && rate > 0 ? `%${Math.round(rate)}` : '%0'

                return (
                  <React.Fragment key={it.line.key}>
                    {/* Desktop View */}
                    <div className="hidden md:grid items-center px-6 py-3 border-b border-gray-100 hover:bg-gray-50/60 transition-colors" style={{ gridTemplateColumns: '2fr 2fr 1fr 1.3fr 1.1fr 1fr 40px' }}>

                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-[38px] h-[52px] bg-gray-100 border border-gray-200 rounded-md overflow-hidden flex items-center justify-center shrink-0">
                          {it.line.product.imageUrl ? (
                            <img
                              src={toAbsoluteMediaUrl ? toAbsoluteMediaUrl(String(it.line.product.imageUrl)) : String(it.line.product.imageUrl)}
                              alt=""
                              className="w-[38px] h-[52px] object-contain"
                            />
                          ) : null}
                        </div>
                        <div className="text-xs font-semibold text-gray-800 leading-4 whitespace-normal break-words">{it.line.product.name}</div>
                      </div>

                      <div className="flex flex-col gap-1.5 min-w-0">
                        <input
                          value={it.line.note}
                          onChange={(e) => cart.setNote(it.line.key, e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400 transition"
                          placeholder="Not ekle..."
                        />

                        {(Boolean(it.line.product.isInstallable) || it.line.montaj === 'Montaj istiyorum.') && (
                          <div className="flex flex-wrap items-center gap-1 text-[11px]">
                            <select
                              value={it.line.montaj}
                              onChange={(e) => {
                                const val = e.target.value as 'Montaj istemiyorum.' | 'Montaj istiyorum.'
                                if (val === 'Montaj istiyorum.') {
                                  setEditingMontajLineKey(it.line.key)
                                  setEditingMontajForm(
                                    it.line.montajDetails || montajDetailsByProductId?.[it.line.product.id] || {
                                      bayiAdi: dealerLabel || '',
                                      urunAdi: it.line.product.name || '',
                                      miktar: it.line.qty || 1,
                                      isimSoyisim: '',
                                      telefon: '',
                                      adres: '',
                                      bolge: '',
                                      bayiAciklama: ''
                                    }
                                  )
                                  setEditingMontajError(null)
                                } else {
                                  cart.updateLineMontaj(it.line.key, 'Montaj istemiyorum.')
                                }
                              }}
                              className="text-[11px] font-semibold py-0.5 px-1.5 rounded border border-orange-200 bg-orange-50/70 text-orange-900 focus:ring-1 focus:ring-orange-400 cursor-pointer"
                            >
                              <option value="Montaj istemiyorum.">Montaj İstemiyorum</option>
                              <option value="Montaj istiyorum.">Montaj İstiyorum</option>
                            </select>

                            {it.line.montaj === 'Montaj istiyorum.' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingMontajLineKey(it.line.key)
                                  setEditingMontajForm(
                                    it.line.montajDetails || montajDetailsByProductId?.[it.line.product.id] || {
                                      bayiAdi: dealerLabel || '',
                                      urunAdi: it.line.product.name || '',
                                      miktar: it.line.qty || 1,
                                      isimSoyisim: '',
                                      telefon: '',
                                      adres: '',
                                      bolge: '',
                                      bayiAciklama: ''
                                    }
                                  )
                                  setEditingMontajError(null)
                                }}
                                className="inline-flex items-center gap-1 text-[10px] font-bold text-orange-600 hover:text-orange-700 bg-white hover:bg-orange-50 px-1.5 py-0.5 rounded border border-orange-300 transition"
                                title="Montaj Bilgilerini Düzenle"
                              >
                                <span>✏️ Düzenle</span>
                                {it.line.montajDetails?.isimSoyisim && (
                                  <span className="text-[10px] text-gray-500 font-normal truncate max-w-[80px]">
                                    ({it.line.montajDetails.isimSoyisim})
                                  </span>
                                )}
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="text-right">
                        <div className="text-[13px] font-extrabold text-gray-900">{formatMoney(it.baseUnit)}</div>
                      </div>

                      <div className="text-right">
                        {installUnitGross > 0 ? (
                          <>
                            <div className="text-[13px] font-extrabold text-orange-500">{formatMoney(installUnitGross)}</div>
                            <div className="mt-0.5 text-[10px] leading-[14px] text-gray-400 whitespace-nowrap">
                              <span className="text-gray-500">{formatMoney(installUnitNet)}</span>
                              <span className="mx-0.5">+</span>
                              <span>KDV {rateLabel}</span>
                              <span className="ml-0.5 text-gray-500">{formatMoney(installUnitVat)}</span>
                            </div>
                          </>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </div>

                      <div className="flex items-center justify-center pl-3">
                        <div className="inline-flex items-center rounded-lg border border-gray-200 bg-white overflow-hidden shadow-sm">
                          <button
                            type="button"
                            className="h-8 w-8 flex items-center justify-center hover:bg-gray-100 text-gray-600 transition-colors"
                            onClick={() => {
                              const q = Number(it.line.qty ?? 0)
                              if (q <= 1) {
                                setRemoveLineConfirmKey(it.line.key)
                                return
                              }
                              cart.updateQty(it.line.key, -1)
                            }}
                            aria-label="Azalt"
                            title="Azalt"
                          >
                            <Minus size={13} />
                          </button>
                          <div className="h-8 w-9 flex items-center justify-center text-xs font-bold text-gray-800 border-l border-r border-gray-200">{it.line.qty}</div>
                          <button
                            type="button"
                            className="h-8 w-8 flex items-center justify-center hover:bg-gray-100 text-gray-600 transition-colors"
                            onClick={() => cart.updateQty(it.line.key, 1)}
                            aria-label="Arttır"
                            title="Arttır"
                          >
                            <Plus size={13} />
                          </button>
                        </div>
                      </div>

                      <div className="text-right text-sm font-bold text-orange-600">{paraYaz(it.lineTotal)}</div>

                      <div className="flex items-center justify-end">
                        <button
                          type="button"
                          className="w-8 h-8 flex items-center justify-center rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                          onClick={() => setRemoveLineConfirmKey(it.line.key)}
                          aria-label="Sil"
                          title="Sil"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>

                      {(() => {
                        const sc = String(it.line.product.stockCode ?? '').trim()
                        const lineDirectDiscount = Number(campaignResult?.itemDiscounts?.[sc] ?? 0)

                        // Sepet bazlı kampanyaların bu satıra düşen payı
                        const basketCampaigns = (campaignResult?.appliedCampaigns ?? [])
                          .filter((c: AppliedCampaign) => c.appliedTo === 'basket')
                        const totalBasketDiscount = basketCampaigns.reduce((s: number, c: AppliedCampaign) => s + c.discountAmount, 0)
                        const cartTotal = cartItems.reduce((s, item) => {
                          return s + (Number(item.line.product.unitPrice) || 0) * (Number(item.line.qty) || 0)
                        }, 0)
                        const lineTotal = (Number(it.line.product.unitPrice) || 0) * (Number(it.line.qty) || 0)
                        const basketShare = (cartTotal > 0 && lineTotal > 0)
                          ? totalBasketDiscount * lineTotal / cartTotal : 0

                        const totalDiscount = lineDirectDiscount + basketShare
                        if (canOnlySeePriceGroup4 || totalDiscount <= 0) return null

                        const campNames = (campaignResult?.appliedCampaigns ?? [])
                          .filter((c: AppliedCampaign) => c.discountAmount > 0)
                          .map((c: AppliedCampaign) => c.campaignName).filter(Boolean).join(', ')

                        return (
                          <div className="col-span-full mt-1 ml-[50px] flex items-center gap-1.5 text-[11px] font-bold text-green-700">
                            <Gift size={12} className="text-green-600 shrink-0" />
                            <span>
                              Kampanya: -{totalDiscount.toLocaleString('tr-TR', {
                                minimumFractionDigits: 2, maximumFractionDigits: 2
                              })} TL
                            </span>
                            {campNames && (
                              <span className="font-normal text-green-600 truncate max-w-[200px]">({campNames})</span>
                            )}
                          </div>
                        )
                      })()}
                    </div>

                    {/* Mobile Stacked Card View */}
                    <div className="flex md:hidden flex-col p-4 border-b border-gray-100 gap-3">
                      <div className="flex gap-3">
                        {/* Product Image */}
                        <div className="w-[60px] h-[80px] bg-gray-50 border border-gray-200 rounded overflow-hidden flex items-center justify-center shrink-0">
                          {it.line.product.imageUrl ? (
                            <img
                              src={toAbsoluteMediaUrl ? toAbsoluteMediaUrl(String(it.line.product.imageUrl)) : String(it.line.product.imageUrl)}
                              alt=""
                              className="w-full h-full object-contain"
                            />
                          ) : (
                            <ShoppingCart size={20} className="text-gray-300" />
                          )}
                        </div>
                        
                        {/* Name and Price */}
                        <div className="flex-1 min-w-0 flex flex-col justify-between">
                          <div>
                            <div className="text-xs font-bold text-gray-800 leading-4 break-words">{it.line.product.name}</div>
                            {it.line.product.stockCode && (
                              <div className="text-[10px] font-semibold text-gray-400 mt-1">{it.line.product.stockCode}</div>
                            )}
                          </div>
                          <div className="flex flex-col gap-0.5 mt-2">
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-[10px] text-gray-400 font-semibold">Birim:</span>
                              <span className="text-xs font-bold text-gray-800">{formatMoney(it.baseUnit)} {currencySymbolOf(currencyCodeOf(it.line?.product))}</span>
                            </div>
                            {installUnitGross > 0 && (
                              <div className="flex items-baseline gap-1.5">
                                <span className="text-[10px] text-orange-450 font-semibold">Montaj:</span>
                                <span className="text-xs font-bold text-orange-500">{formatMoney(installUnitGross)} {currencySymbolOf(currencyCodeOf(it.line?.product))}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Delete Button */}
                        <button
                          type="button"
                          className="text-gray-400 hover:text-red-500 p-1 self-start"
                          onClick={() => setRemoveLineConfirmKey(it.line.key)}
                          aria-label="Sil"
                          title="Sil"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>

                      {/* Note Field */}
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Açıklama / Not</label>
                        <input
                          value={it.line.note}
                          onChange={(e) => cart.setNote(it.line.key, e.target.value)}
                          className="w-full px-3 py-2 text-xs border border-gray-300 rounded bg-white"
                          placeholder="Not ekleyin..."
                        />
                      </div>

                      {/* Montaj Select Option */}
                      {(Boolean(it.line.product.isInstallable) || it.line.montaj === 'Montaj istiyorum.') && (
                        <div className="flex flex-wrap items-center gap-2 text-[11px] bg-slate-50 p-2 rounded-lg border border-slate-100">
                          <select
                            value={it.line.montaj}
                            onChange={(e) => {
                              const val = e.target.value as 'Montaj istemiyorum.' | 'Montaj istiyorum.'
                              if (val === 'Montaj istiyorum.') {
                                setEditingMontajLineKey(it.line.key)
                                setEditingMontajForm(
                                  it.line.montajDetails || montajDetailsByProductId?.[it.line.product.id] || {
                                    bayiAdi: dealerLabel || '',
                                    urunAdi: it.line.product.name || '',
                                    miktar: it.line.qty || 1,
                                    isimSoyisim: '',
                                    telefon: '',
                                    adres: '',
                                    bolge: '',
                                    bayiAciklama: ''
                                  }
                                )
                                setEditingMontajError(null)
                              } else {
                                cart.updateLineMontaj(it.line.key, 'Montaj istemiyorum.')
                              }
                            }}
                            className="text-[11px] font-semibold py-1 px-2 rounded border border-orange-200 bg-white text-orange-950 focus:ring-1 focus:ring-orange-400 cursor-pointer"
                          >
                            <option value="Montaj istemiyorum.">Montaj İstemiyorum</option>
                            <option value="Montaj istiyorum.">Montaj İstiyorum</option>
                          </select>

                          {it.line.montaj === 'Montaj istiyorum.' && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingMontajLineKey(it.line.key)
                                setEditingMontajForm(
                                  it.line.montajDetails || montajDetailsByProductId?.[it.line.product.id] || {
                                    bayiAdi: dealerLabel || '',
                                    urunAdi: it.line.product.name || '',
                                    miktar: it.line.qty || 1,
                                    isimSoyisim: '',
                                    telefon: '',
                                    adres: '',
                                    bolge: '',
                                    bayiAciklama: ''
                                  }
                                )
                                setEditingMontajError(null)
                              }}
                              className="inline-flex items-center gap-1 text-[10px] font-bold text-orange-600 hover:text-orange-700 bg-white hover:bg-orange-50 px-2 py-1 rounded border border-orange-300 transition"
                            >
                              <span>✏️ Düzenle</span>
                            </button>
                          )}
                        </div>
                      )}

                      {/* Quantity Controls and Line Total */}
                      <div className="flex items-center justify-between mt-1 pt-2 border-t border-gray-100">
                        {/* Quantity */}
                        <div className="flex items-center rounded-lg border border-gray-200 bg-white overflow-hidden shadow-sm">
                          <button
                            type="button"
                            className="h-8 w-8 flex items-center justify-center hover:bg-gray-100 text-gray-600 transition-colors"
                            onClick={() => {
                              const q = Number(it.line.qty ?? 0)
                              if (q <= 1) {
                                setRemoveLineConfirmKey(it.line.key)
                                return
                              }
                              cart.updateQty(it.line.key, -1)
                            }}
                            aria-label="Azalt"
                          >
                            <Minus size={13} />
                          </button>
                          <div className="h-8 w-9 flex items-center justify-center text-xs font-bold text-gray-800 border-l border-r border-gray-200">
                            {it.line.qty}
                          </div>
                          <button
                            type="button"
                            className="h-8 w-8 flex items-center justify-center hover:bg-gray-100 text-gray-600 transition-colors"
                            onClick={() => cart.updateQty(it.line.key, 1)}
                            aria-label="Arttır"
                          >
                            <Plus size={13} />
                          </button>
                        </div>

                        {/* Line Total */}
                        <div className="text-right">
                          <div className="text-[10px] text-gray-400 font-semibold">Toplam</div>
                          <div className="text-sm font-extrabold text-orange-600 mt-0.5">{paraYaz(it.lineTotal, currencySymbolOf(currencyCodeOf(it.line?.product)))}</div>
                        </div>
                      </div>

                      {/* Campaign Info if any */}
                      {(() => {
                        const sc = String(it.line.product.stockCode ?? '').trim()
                        const lineDirectDiscount = Number(campaignResult?.itemDiscounts?.[sc] ?? 0)
                        const basketCampaigns = (campaignResult?.appliedCampaigns ?? [])
                          .filter((c: AppliedCampaign) => c.appliedTo === 'basket')
                        const totalBasketDiscount = basketCampaigns.reduce((s: number, c: AppliedCampaign) => s + c.discountAmount, 0)
                        const cartTotal = cartItems.reduce((s, item) => {
                          return s + (Number(item.line.product.unitPrice) || 0) * (Number(item.line.qty) || 0)
                        }, 0)
                        const lineTotal = (Number(it.line.product.unitPrice) || 0) * (Number(it.line.qty) || 0)
                        const basketShare = (cartTotal > 0 && lineTotal > 0)
                          ? totalBasketDiscount * lineTotal / cartTotal : 0

                        const totalDiscount = lineDirectDiscount + basketShare
                        if (totalDiscount <= 0) return null

                        return (
                          <div className="flex items-center gap-1.5 text-[10px] font-bold text-green-700 bg-green-50 p-2 rounded-lg border border-green-100">
                            <Gift size={12} className="text-green-600 shrink-0" />
                            <span>Kampanya: -{formatMoney(totalDiscount)} {currencySymbolOf(currencyCodeOf(it.line?.product))}</span>
                          </div>
                        )
                      })()}
                    </div>
                  </React.Fragment>
                )
              })}

              {campaignResult.giftItems && campaignResult.giftItems.map((gift: any, idx: number) => {
                return (
                  <React.Fragment key={`gift-${gift.product.stockCode}-${idx}`}>
                    {/* Desktop View */}
                    <div className="hidden md:grid items-center px-6 py-3 border-b border-gray-100 bg-green-50/20 hover:bg-green-50/40 transition-colors" style={{ gridTemplateColumns: '2fr 2fr 1fr 1.3fr 1.1fr 1fr 40px' }}>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-[38px] h-[52px] bg-green-100 border border-green-200 rounded-md overflow-hidden flex items-center justify-center shrink-0">
                          <Gift size={20} className="text-green-600" />
                        </div>
                        <div className="text-xs font-semibold text-green-800 leading-4 whitespace-normal break-words">
                          {gift.product.name}
                          <span className="ml-1.5 px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-[9px] font-extrabold uppercase">Hediye</span>
                        </div>
                      </div>
                      <div className="text-xs text-green-600 font-medium">Kampanya Hediyesi</div>
                      <div className="text-right">
                        <div className="text-xs font-bold text-green-700">
                          {formatMoney(gift.product.unitPrice > 0 ? gift.product.unitPrice : 0.01)} {currencySymbolOf(currencyCodeOf(gift.product))}
                        </div>
                        <div className="text-[10px] font-semibold text-green-600">Hediye Ürün</div>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-gray-300">—</span>
                      </div>
                      <div className="text-center font-bold text-green-700 text-xs">{gift.qty} Adet</div>
                      <div className="text-right text-sm font-bold text-green-700">
                        {formatMoney((gift.product.unitPrice > 0 ? gift.product.unitPrice : 0.01) * gift.qty)} {currencySymbolOf(currencyCodeOf(gift.product))}
                      </div>
                      <div />
                    </div>

                    {/* Mobile View */}
                    <div className="flex md:hidden flex-col p-4 border-b border-gray-100 bg-green-50/10 gap-3">
                      <div className="flex gap-3">
                        <div className="w-[60px] h-[80px] bg-green-50 border border-green-200 rounded overflow-hidden flex items-center justify-center shrink-0">
                          <Gift size={24} className="text-green-600" />
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col justify-between">
                          <div>
                            <div className="text-xs font-bold text-green-800 leading-4 break-words">
                              {gift.product.name}
                            </div>
                            <div className="mt-1">
                              <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-[9px] font-extrabold uppercase">Hediye</span>
                            </div>
                          </div>
                          <div className="flex items-baseline gap-1.5 mt-2">
                            <span className="text-[10px] text-green-600 font-semibold">Miktar:</span>
                            <span className="text-xs font-bold text-green-800">{gift.qty} Adet</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </React.Fragment>
                )
              })}

              {cartItems.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                  <ShoppingCart size={40} className="mb-3 opacity-30" />
                  <div className="text-sm font-semibold">Sepet boş</div>
                </div>
              )}


            {/*
              TOPLAM BLOGU KAYDIRILAN ALANIN ICINDE (2026-08-24, kullanici bildirimi:
              "genel toplamin alti tablette gozukmuyor").

              Onceden bu blok kaydirma alaninin DISINDA, dugmelerle kardesti. Kendisi kisa
              degil: her para birimi icin ayri kova, kampanya dokumu, KDV satirlari ve Genel
              Toplam. Tablette bu blok tek basina kalan yuksekligi doldurunca dugmeler asagi
              tasiyordu; urun listesini kisaltmak (min-h-0) sorunu cozmuyordu cunku tasiran
              sey liste degil TOPLAM blogunun kendisiydi.

              Simdi urunler + toplamlar birlikte kayiyor; asagida SADECE dugmeler duruyor ve
              onlar `shrink-0` oldugu icin her zaman ekranda.
            */}
            <div className="bg-gray-50 border-t border-gray-200 p-6">
              {/* Toplamlar para birimi başına ayrı blok: karışık sepette USD kalemler USD,
                  TL kalemler TL toplanır. Hiçbir tutar başka bir dövize çevrilmez. */}
              {totalsByCurrency.map((bucket, bucketIdx) => {
                const bucketInstallation = buildInstallationFeeSummary(bucket.currency)
                const bucketCampaigns = campaignSummaryList.filter((item) => item.symbol === bucket.symbol)

                return (
                  <div
                    key={bucket.currency}
                    className={bucketIdx > 0 ? 'mt-5 pt-5 border-t-2 border-dashed border-gray-300' : ''}
                  >
                    {isMixedCurrencyCart && (
                      <div className="mb-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-gray-200 text-gray-700 text-[11px] font-extrabold uppercase tracking-wide">
                        {bucket.currency} {bucket.symbol}
                      </div>
                    )}

                    <div className="space-y-2 text-sm font-semibold text-gray-700">
                      {fiyatGrubuBelirsiz && (
                        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-800">
                          Fiyat grubu bilgisi alınamadı. Toplamlar doğrulanana kadar sipariş
                          oluşturulamaz — sayfayı yenileyin.
                        </div>
                      )}

                      <div className="flex items-center justify-between">
                        <div className="text-gray-600">Montajsız Ürün Fiyatı</div>
                        <div className="font-extrabold text-gray-900">{paraYaz(bucket.urunAraToplam, bucket.symbol)}</div>
                      </div>

                      {bucketInstallation.gross > 0 ? (
                        <div className="bg-white border border-gray-200 rounded px-3 py-2">
                          <div className="flex items-center justify-between">
                            <div className="text-gray-700 font-extrabold">Toplam Montaj (KDV Dahil)</div>
                            <div className="text-gray-900 font-extrabold">{formatMoney(bucketInstallation.gross)} {bucket.symbol}</div>
                          </div>
                          <div className="mt-1 grid grid-cols-3 gap-2 text-[11px] font-semibold text-gray-600">
                            <div>
                              <div className="uppercase tracking-wide">KDV Hariç</div>
                              <div className="text-gray-900 font-bold">{formatMoney(bucketInstallation.net)}</div>
                            </div>
                            <div>
                              <div className="uppercase tracking-wide">KDV {bucketInstallation.rateLabel || '%0'}</div>
                              <div className="text-gray-900 font-bold">{formatMoney(bucketInstallation.vat)}</div>
                            </div>
                            <div className="text-right">
                              <div className="uppercase tracking-wide">KDV Dahil</div>
                              <div className="text-gray-900 font-extrabold">{formatMoney(bucketInstallation.gross)}</div>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      <div className="flex items-center justify-between text-gray-500">
                        <div>KDV</div>
                        <div>{paraYaz(bucket.kdv, bucket.symbol)}</div>
                      </div>

                      {bucketCampaigns.length > 0 && (
                        <div className="bg-green-50/90 border border-green-200 rounded-xl p-3 space-y-2">
                          <div className="flex items-center justify-between text-xs font-extrabold text-green-800 uppercase tracking-wide">
                            <div className="flex items-center gap-1.5">
                              <Gift size={14} className="text-green-600" />
                              <span>Kampanya Detayları ({bucketCampaigns.length})</span>
                            </div>
                            {bucket.campaignDiscount > 0 && (
                              <span className="text-green-700 font-bold">-{formatMoney(bucket.campaignDiscount)} {bucket.symbol}</span>
                            )}
                          </div>

                          <div className="space-y-1.5 pt-1.5 border-t border-green-200/70">
                            {bucketCampaigns.map((item, idx) => (
                              <div key={idx} className="flex justify-between items-start text-[11px] text-green-900 font-medium">
                                <div className="flex flex-col pr-2">
                                  <span className="font-bold">{item.title}</span>
                                  {item.subtitle && <span className="text-[10px] text-green-700">{item.subtitle}</span>}
                                </div>
                                <span className="font-extrabold text-green-700 whitespace-nowrap">
                                  {item.isGift ? `${formatMoney(item.amount)} ${item.symbol}` : `-${formatMoney(item.amount)} ${item.symbol}`}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 pt-4 border-t border-gray-200 flex items-center justify-between">
                      <div className="text-lg font-extrabold text-gray-900">Genel Toplam</div>
                      <div className="text-xl font-extrabold text-gray-900">{paraYaz(bucket.genel, bucket.symbol)}</div>
                    </div>
                  </div>
                )
              })}
            </div>
            </div>

            <div className="px-6 py-4 shrink-0 border-t border-gray-200 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-3 bg-white">
              <button
                type="button"
                className="px-5 py-2.5 text-sm font-semibold bg-red-50 border border-red-200 text-red-600 rounded-lg hover:bg-red-100 hover:border-red-300 transition-colors text-center"
                onClick={() => setClearCartConfirmOpen(true)}
              >
                Sepeti Temizle
              </button>
              <button
                type="button"
                disabled={!canCreateOrder}
                className={
                  'px-6 py-2.5 text-sm font-semibold rounded-lg transition-colors text-center ' +
                  (canCreateOrder ? 'bg-green-600 text-white hover:bg-green-700 shadow-sm' : 'bg-gray-200 text-gray-400 cursor-not-allowed')
                }
                onClick={() => {
                  if (!canCreateOrder) return
                  setConfirmCreateOrderOpen(true)
                }}
              >
                {creatingOrder ? 'Oluşturuluyor...' : 'Siparişi Oluştur'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Modal
        isOpen={confirmCreateOrderOpen}
        onClose={() => {
          if (creatingOrder) return
          setConfirmCreateOrderOpen(false)
        }}
        title="Sepet Onayı"
      >
        <div className="flex flex-col items-center text-center py-4">
          <div className="w-16 h-16 bg-green-50 border border-green-200 rounded-2xl flex items-center justify-center text-green-600 mb-4 animate-bounce">
            <ShoppingBag size={32} />
          </div>
          <h3 className="text-base font-extrabold text-gray-900">Siparişi Onaylıyor musunuz?</h3>
          <p className="text-xs text-gray-500 mt-1.5 max-w-sm">
            Sepetinizdeki ürünler için sipariş kaydı oluşturulacaktır. Lütfen sipariş özetini kontrol edin.
          </p>
          
          <div className="w-full mt-6 bg-zinc-50 border border-gray-200 rounded-2xl p-4 text-left space-y-2.5">
            <div className="flex justify-between items-center text-xs font-semibold text-gray-500">
              <span>Ürün Kalemi:</span>
              <span className="text-gray-800 font-bold">{cartItems.length} Kalem</span>
            </div>
            {totalsByCurrency.map((bucket, bucketIdx) => (
              <div
                key={bucket.currency}
                className={bucketIdx > 0 ? 'pt-2.5 border-t border-dashed border-gray-300 space-y-2.5' : 'space-y-2.5'}
              >
                {isMixedCurrencyCart && (
                  <div className="text-[10px] font-extrabold uppercase tracking-wide text-gray-400">
                    {bucket.currency}
                  </div>
                )}
                <div className="flex justify-between items-center text-xs font-semibold text-gray-500">
                  <span>Ara Toplam:</span>
                  <span className="text-gray-800 font-bold">{formatMoney(bucket.urunAraToplam)} {bucket.symbol}</span>
                </div>
                {bucket.campaignDiscount > 0 && (
                  <div className="flex justify-between items-center text-xs font-semibold text-green-600">
                    <span>Kampanya İndirimi:</span>
                    <span className="font-bold">-{formatMoney(bucket.campaignDiscount)} {bucket.symbol}</span>
                  </div>
                )}
                <div className="flex justify-between items-center text-xs font-semibold text-gray-500">
                  <span>KDV Toplamı:</span>
                  <span className="text-gray-800 font-bold">{formatMoney(bucket.kdv)} {bucket.symbol}</span>
                </div>
                <div className="pt-2.5 border-t border-gray-200 flex justify-between items-center">
                  <span className="text-xs font-extrabold text-gray-900">Genel Toplam:</span>
                  <span className="text-base font-black text-orange-600">{paraYaz(bucket.genel, bucket.symbol)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2.5 border-t border-gray-100 pt-4">
          <button
            type="button"
            className="px-5 py-2.5 text-xs font-bold rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 active:scale-95 transition-all"
            disabled={creatingOrder}
            onClick={() => setConfirmCreateOrderOpen(false)}
          >
            Vazgeç
          </button>
          <button
            type="button"
            className={
              'px-6 py-2.5 text-xs font-bold rounded-xl active:scale-95 transition-all ' +
              (canCreateOrder
                ? 'bg-green-600 text-white hover:bg-green-700 shadow-sm shadow-green-600/10'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed')
            }
            disabled={!canCreateOrder}
            onClick={async () => {
              setConfirmCreateOrderOpen(false)
              await submitOrder()
            }}
          >
            Onayla
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={orderSuccessOpen}
        onClose={() => {
          setOrderSuccessOpen(false)
          setOrderSuccessOrderNo(null)
          setOrderSuccessMessage(null)
        }}
        title="Sipariş Oluşturuldu"
        hideHeader
        scrollable={false}
        footer={
          <button
            type="button"
            onClick={() => {
              setOrderSuccessOpen(false)
              setOrderSuccessOrderNo(null)
              setOrderSuccessMessage(null)
            }}
            className="px-6 py-2 text-sm font-semibold rounded bg-green-600 text-white hover:bg-green-700"
          >
            Tamam
          </button>
        }
      >
        <div className="flex flex-col items-center text-center py-6">
          <div className="relative w-20 h-20">
            <div className="absolute inset-0 rounded-full bg-green-100 animate-pulse" />
            <div className="absolute inset-2 rounded-full bg-green-600" />
            <div className="absolute inset-0 flex items-center justify-center text-white text-3xl font-extrabold">✓</div>
          </div>
          <div className="mt-5 text-xl font-extrabold text-gray-900">Siparişiniz oluşturuldu</div>
          {orderSuccessOrderNo && <div className="mt-2 text-sm font-semibold text-gray-700">{orderSuccessOrderNo}</div>}
          {orderSuccessMessage && <div className="mt-2 text-sm text-gray-600">{orderSuccessMessage}</div>}
        </div>
      </Modal>

      <Modal
        isOpen={clearCartConfirmOpen}
        onClose={() => setClearCartConfirmOpen(false)}
        title="Sepeti Temizle"
        footer={
          <>
            <button
              type="button"
              className="px-4 py-2 text-xs font-semibold border border-gray-200 text-gray-700 rounded hover:bg-gray-50"
              onClick={() => setClearCartConfirmOpen(false)}
            >
              Vazgeç
            </button>
            <button
              type="button"
              className="px-4 py-2 text-xs font-semibold bg-pink-600 text-white rounded hover:bg-pink-700"
              onClick={() => {
                // Ekranda görünen carinin sepeti; diğer carilerin sepetleri kalır.
                cart.clear(dealerCode)
                setClearCartConfirmOpen(false)
              }}
            >
              Temizle
            </button>
          </>
        }
      >
        <div className="text-sm text-gray-700">Sepet temizlensin mi?</div>
      </Modal>

      <Modal
        isOpen={creditLimitErrorOpen}
        onClose={() => setCreditLimitErrorOpen(false)}
        title="Uyarı"
        footer={
          <>
            <button
              type="button"
              onClick={() => setCreditLimitErrorOpen(false)}
              className="px-4 py-2 rounded-md text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700"
            >
              Tamam
            </button>
          </>
        }
      >
        <div className="text-sm text-gray-700">{creditLimitErrorMessage || 'Limitiniz yetersiz'}</div>
      </Modal>

      <Modal
        isOpen={generalErrorOpen}
        onClose={() => setGeneralErrorOpen(false)}
        title="Uyarı"
        footer={
          <>
            <button
              type="button"
              onClick={() => setGeneralErrorOpen(false)}
              className="px-4 py-2 rounded-md text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700"
            >
              Tamam
            </button>
          </>
        }
      >
        <div className="text-sm text-gray-700 whitespace-pre-wrap break-words">{generalErrorMessage || 'Sipariş oluşturulamadı'}</div>
      </Modal>

      <MontajFormModal
        isOpen={editingMontajLineKey != null}
        onClose={() => setEditingMontajLineKey(null)}
        dealerName={editingMontajForm.bayiAdi || dealerLabel || ''}
        productName={editingMontajForm.urunAdi || ''}
        quantity={editingMontajForm.miktar || 1}
        initialValues={editingMontajForm}
        customerDefaults={montajCustomerDefaults}
        customerCode={montajDefaultsCode || undefined}
        submitButtonText="Kaydet ve Uygula"
        onSave={(details) => {
          if (!editingMontajLineKey) return
          cart.updateLineMontaj(editingMontajLineKey, 'Montaj istiyorum.', details)
          setEditingMontajLineKey(null)
          showToast('Montaj bilgileri güncellendi.')
        }}
      />

      {removeLineConfirmKey != null && (
        <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-md rounded-lg shadow-2xl border border-gray-200 p-8 text-center">
            <div className="mx-auto w-14 h-14 rounded-full border-4 border-yellow-400 flex items-center justify-center text-yellow-500 text-3xl font-extrabold">!</div>
            <div className="mt-5 text-lg font-semibold text-gray-900">Sil ?</div>
            <div className="mt-3 text-sm text-gray-700">Seçilen satır silinecektir onaylıyor musunuz ?</div>

            <div className="mt-6 flex items-center justify-center gap-4">
              <button
                type="button"
                className="px-6 py-2 text-sm font-semibold bg-pink-600 text-white rounded hover:bg-pink-700"
                onClick={() => {
                  if (!removeLineConfirmKey) return
                  cart.removeLine(removeLineConfirmKey)
                  setRemoveLineConfirmKey(null)
                }}
              >
                Evet
              </button>
              <button
                type="button"
                className="px-6 py-2 text-sm font-semibold bg-green-500 text-white rounded hover:bg-green-600"
                onClick={() => setRemoveLineConfirmKey(null)}
              >
                Hayır
              </button>
            </div>
          </div>
        </div>
      )}

      {toastMessage && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-[60] w-[520px] max-w-[92vw]">
          <div className="bg-green-300/80 text-gray-900 text-sm font-semibold px-6 py-3 rounded shadow-lg border border-green-400">{toastMessage}</div>
        </div>
      )}

      {void selectedProductForCampaign}
      {void showToast}
    </>
  )
}