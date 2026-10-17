import { useEffect, useMemo, useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getMemberToken, readApiResponse } from '../lib/api'
import { readCart, writeCart, CART_EVENT, type CartItem } from '../lib/cart'
import cyprusData from '../lib/cyprusAddresses.json'
import { SearchableSelect } from '../components/ui/SearchableSelect'

type Address = {
  id: string
  title: string
  fullName: string
  phone: string
  city: string
  district: string
  region?: string
  mahalle?: string
  binaNo?: string
  daireNo?: string
  katNo?: string
  details: string
}

export function CheckoutPage() {
  const formRef = useRef<HTMLFormElement>(null)
  const nav = useNavigate()
  const [items, setItems] = useState<CartItem[]>(() => readCart())
  const [form, setForm] = useState(() => {
    const saved = localStorage.getItem('ecom_checkout_form')
    return saved ? JSON.parse(saved) : { customerName: '', email: '', phone: '', address: '' }
  })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // Save Address States
  const [saveAddress, setSaveAddress] = useState(() => {
    return localStorage.getItem('ecom_checkout_saveAddress') === 'true'
  })
  const [addressTitle, setAddressTitle] = useState(() => {
    return localStorage.getItem('ecom_checkout_addressTitle') || 'Adresim'
  })
  const [manualCity, setManualCity] = useState(() => {
    return localStorage.getItem('ecom_checkout_manualCity') || 'Kuzey Kıbrıs (KKTC)'
  })
  const [manualDistrict, setManualDistrict] = useState(() => {
    return localStorage.getItem('ecom_checkout_manualDistrict') || ''
  })
  const [manualRegion, setManualRegion] = useState(() => {
    return localStorage.getItem('ecom_checkout_manualRegion') || ''
  })
  const [manualMahalle, setManualMahalle] = useState(() => {
    return localStorage.getItem('ecom_checkout_manualMahalle') || ''
  })
  const [manualBinaNo, setManualBinaNo] = useState(() => {
    return localStorage.getItem('ecom_checkout_manualBinaNo') || ''
  })
  const [manualDaireNo, setManualDaireNo] = useState(() => {
    return localStorage.getItem('ecom_checkout_manualDaireNo') || ''
  })
  const [manualKatNo, setManualKatNo] = useState(() => {
    return localStorage.getItem('ecom_checkout_manualKatNo') || ''
  })
  const [manualDetails, setManualDetails] = useState(() => {
    return localStorage.getItem('ecom_checkout_manualDetails') || ''
  })

  // Sync cart items on login/logout or other changes
  useEffect(() => {
    const sync = () => setItems(readCart())
    window.addEventListener(CART_EVENT, sync)
    return () => {
      window.removeEventListener(CART_EVENT, sync)
    }
  }, [])

  const [design] = useState(() => {
    const saved = localStorage.getItem('ecom_store_design')
    return saved ? JSON.parse(saved) : { cargoFee: 150, freeShippingThreshold: 2000, currency: 'TL' }
  })
  const cargoFee = design.cargoFee ?? 150
  const threshold = design.freeShippingThreshold ?? 2000
  const currency = design.currency || 'TL'

  const total = useMemo(() => items.reduce((s, x) => s + (x.unitPrice ?? 0) * x.qty, 0), [items])

  const [calcResult, setCalcResult] = useState<any>(null)

  useEffect(() => {
    if (items.length === 0) {
      setCalcResult(null)
      return
    }
    let active = true
    const fetchCalculation = async () => {
      try {
        const token = getMemberToken()
        const res = await fetch('/api/storefront/cart/calculate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            items: items.map((i) => ({
              productId: i.id,
              tenantCode: i.tenantCode || '',
              quantity: i.qty,
            })),
          }),
        })
        const json = await res.json()
        if (active && json?.success && json?.data) {
          setCalcResult(json.data)
        }
      } catch (err) {
        console.error('Cart calculation error:', err)
      }
    }
    fetchCalculation()
    return () => {
      active = false
    }
  }, [items])

  // Coupon integration states
  const [couponCode, setCouponCode] = useState('')
  const [couponError, setCouponError] = useState<string | null>(null)
  const [couponSuccess, setCouponSuccess] = useState<string | null>(null)
  const [discountAmount, setDiscountAmount] = useState<number>(0)
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null)
  const [couponLoading, setCouponLoading] = useState(false)

  const offlineAllFreeShipping = items.length > 0 && items.every(i => !!i.isFreeShipping)
  const shipping = (offlineAllFreeShipping || total >= threshold || cargoFee === 0) ? 0 : cargoFee
  const displaySubtotal = calcResult ? calcResult.subtotal : total
  const displayCampaignDiscount = calcResult ? calcResult.totalCampaignDiscount : 0
  const displayShipping = calcResult ? calcResult.cargoFee : shipping
  const subtotalSum = calcResult ? (calcResult.finalTotal - calcResult.cargoFee) : (total - displayCampaignDiscount)
  const grandTotal = Math.max(0, subtotalSum - discountAmount) + displayShipping

  // Mobile Checkout Wizard States
  const [currentStep, setCurrentStep] = useState(1)
  const [cardNumber, setCardNumber] = useState('')
  const [expiry, setExpiry] = useState('')
  const [cvv, setCvv] = useState('')
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(false)
  const [orderNo, setOrderNo] = useState<string | null>(null)
  const [showSuccessModal, setShowSuccessModal] = useState(false)

  const getCheckoutItemPrices = () => {
    const eligibleItems = items.filter(item => (item.unitPrice ?? 0) > 0 && item.qty > 0);
    const originalSum = eligibleItems.reduce((sum, item) => sum + (item.unitPrice ?? 0) * item.qty, 0);

    const totalCampaignDiscount = calcResult ? (calcResult.totalCampaignDiscount ?? 0) : 0;
    const totalDiscount = totalCampaignDiscount + discountAmount;

    if (totalDiscount <= 0 || originalSum <= 0) {
      return items.map(item => ({
        ...item,
        originalPrice: item.unitPrice ?? 0,
        discountedPrice: item.unitPrice ?? 0,
        hasDiscount: false,
        campaignBadge: calcResult?.lines?.find((cl: any) => cl.productId === item.id && String(cl.tenantCode || '').toUpperCase() === String(item.tenantCode || '').toUpperCase())?.campaignBadge
      }));
    }

    const sortedEligible = [...eligibleItems].sort((a, b) => {
      const totalA = (a.unitPrice ?? 0) * a.qty;
      const totalB = (b.unitPrice ?? 0) * b.qty;
      return totalB - totalA;
    });

    const discountsMap = new Map<string, number>();
    let distributedDiscountSum = 0;

    sortedEligible.forEach((item) => {
      const lineOriginalTotal = (item.unitPrice ?? 0) * item.qty;
      let lineDiscount = lineOriginalTotal * (totalDiscount / originalSum);
      lineDiscount = Math.round(lineDiscount * 100) / 100;
      discountsMap.set(`${item.tenantCode}-${item.id}`, lineDiscount);
      distributedDiscountSum += lineDiscount;
    });

    const difference = totalDiscount - distributedDiscountSum;
    if (difference !== 0 && sortedEligible.length > 0) {
      const key0 = `${sortedEligible[0].tenantCode}-${sortedEligible[0].id}`;
      const existing = discountsMap.get(key0) ?? 0;
      discountsMap.set(key0, Math.round((existing + difference) * 100) / 100);
    }

    return items.map(item => {
      const key = `${item.tenantCode}-${item.id}`;
      const originalPrice = item.unitPrice ?? 0;
      const calcLine = calcResult?.lines?.find((cl: any) => cl.productId === item.id && String(cl.tenantCode || '').toUpperCase() === String(item.tenantCode || '').toUpperCase());
      const campaignBadge = calcLine?.campaignBadge;

      if (originalPrice <= 0 || item.qty <= 0) {
        return {
          ...item,
          originalPrice,
          discountedPrice: originalPrice,
          hasDiscount: false,
          campaignBadge
        };
      }

      const lineDiscount = discountsMap.get(key) ?? 0;
      const lineOriginalTotal = originalPrice * item.qty;
      const lineDiscountedTotal = Math.max(0, lineOriginalTotal - lineDiscount);
      const discountedPrice = Math.round((lineDiscountedTotal / item.qty) * 100) / 100;
      const hasDiscount = discountedPrice < originalPrice;

      return {
        ...item,
        originalPrice,
        discountedPrice,
        hasDiscount,
        campaignBadge
      };
    });
  };

  const formattedCardNumber = useMemo(() => {
    const digits = cardNumber.replace(/\D/g, '').slice(0, 16)
    return digits.replace(/(.{4})/g, '$1 ').trim()
  }, [cardNumber])

  const formattedExpiry = useMemo(() => {
    const digits = expiry.replace(/\D/g, '').slice(0, 4)
    if (digits.length <= 2) return digits
    return `${digits.slice(0, 2)}/${digits.slice(2)}`
  }, [expiry])


  async function applyCoupon() {
    if (!isLoggedIn) {
      setCouponError('Kupon kullanabilmek için üye girişi yapmanız gerekmektedir.')
      return
    }
    if (!couponCode.trim()) return
    setCouponLoading(true)
    setCouponError(null)
    setCouponSuccess(null)
    
    try {
      const token = getMemberToken()
      const res = await fetch('/api/storefront/coupons/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          code: couponCode.trim(),
          items: items.map((x) => {
            const calcLine = calcResult?.lines?.find((cl: any) => cl.productId === x.id && String(cl.tenantCode || '').toUpperCase() === String(x.tenantCode || '').toUpperCase())
            const unitPrice = calcLine ? calcLine.discountedPrice : (x.unitPrice ?? 0)
            return { productId: x.id, unitPrice, qty: x.qty }
          })
        })
      })
      const json = await readApiResponse(res)
      if (!res.ok || !json?.success) {
        throw new Error(json?.message || 'Kupon uygulanamadı.')
      }
      
      setDiscountAmount(Number(json.discountAmount))
      setAppliedCoupon(json.code)
      setCouponSuccess(`"${json.code}" kuponu uygulandı! ₺${json.discountAmount.toLocaleString('tr-TR')} indirim kazandınız.`)
    } catch (err) {
      setDiscountAmount(0)
      setAppliedCoupon(null)
      setCouponError(err instanceof Error ? err.message : 'Kupon uygulanamadı.')
    } finally {
      setCouponLoading(false)
    }
  }

  function removeCoupon() {
    setAppliedCoupon(null)
    setDiscountAmount(0)
    setCouponCode('')
    setCouponError(null)
    setCouponSuccess(null)
  }

  // Auth & address state
  const [userId, setUserId] = useState<string | null>(null)
  const [savedAddresses, setSavedAddresses] = useState<Address[]>([])
  const [addressMode, setAddressMode] = useState<'saved' | 'manual'>(() => {
    return (localStorage.getItem('ecom_checkout_addressMode') as 'saved' | 'manual') || 'saved'
  })
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(() => {
    return localStorage.getItem('ecom_checkout_selectedAddressId') || null
  })

  // LocalStorage Persistence Effects
  useEffect(() => {
    localStorage.setItem('ecom_checkout_form', JSON.stringify(form))
  }, [form])

  useEffect(() => {
    localStorage.setItem('ecom_checkout_saveAddress', String(saveAddress))
  }, [saveAddress])

  useEffect(() => {
    localStorage.setItem('ecom_checkout_addressTitle', addressTitle)
  }, [addressTitle])

  useEffect(() => {
    localStorage.setItem('ecom_checkout_manualCity', manualCity)
  }, [manualCity])

  useEffect(() => {
    localStorage.setItem('ecom_checkout_manualDistrict', manualDistrict)
  }, [manualDistrict])

  useEffect(() => {
    localStorage.setItem('ecom_checkout_manualRegion', manualRegion)
  }, [manualRegion])

  useEffect(() => {
    localStorage.setItem('ecom_checkout_manualMahalle', manualMahalle)
  }, [manualMahalle])

  useEffect(() => {
    localStorage.setItem('ecom_checkout_manualBinaNo', manualBinaNo)
  }, [manualBinaNo])

  useEffect(() => {
    localStorage.setItem('ecom_checkout_manualDaireNo', manualDaireNo)
  }, [manualDaireNo])

  useEffect(() => {
    localStorage.setItem('ecom_checkout_manualKatNo', manualKatNo)
  }, [manualKatNo])

  useEffect(() => {
    localStorage.setItem('ecom_checkout_manualDetails', manualDetails)
  }, [manualDetails])

  useEffect(() => {
    localStorage.setItem('ecom_checkout_addressMode', addressMode)
  }, [addressMode])

  useEffect(() => {
    if (selectedAddressId) {
      localStorage.setItem('ecom_checkout_selectedAddressId', selectedAddressId)
    } else {
      localStorage.removeItem('ecom_checkout_selectedAddressId')
    }
  }, [selectedAddressId])

  // Load user info and saved addresses if logged in
  useEffect(() => {
    const token = getMemberToken()
    if (!token) return

    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => readApiResponse(r))
      .then((json) => {
        const id: string | null = json?.data?.id ?? null
        if (id) {
          setUserId(id)
          fetch('/api/storefront/addresses', { headers: { Authorization: `Bearer ${token}` } })
            .then((r) => readApiResponse(r))
            .then((addrJson) => {
              const addrs: Address[] = addrJson?.data ?? []
              setSavedAddresses(addrs)
              const email: string = json?.data?.email ?? ''
              const fullName: string = json?.data?.fullName ?? ''
              const phone: string = json?.data?.phone ?? ''

              if (addrs.length === 0) {
                // No saved addresses → manual mode, pre-fill contact info
                const saved = localStorage.getItem('ecom_checkout_addressMode')
                setAddressMode((saved as 'saved' | 'manual') || 'manual')
                setForm((p) => ({
                  ...p,
                  email: p.email || email,
                  customerName: p.customerName || fullName,
                  phone: p.phone || phone,
                }))
              } else {
                // Has saved addresses
                const saved = localStorage.getItem('ecom_checkout_addressMode')
                setAddressMode((saved as 'saved' | 'manual') || 'saved')
                
                const savedSelectedId = localStorage.getItem('ecom_checkout_selectedAddressId')
                const activeId = savedSelectedId && addrs.some(a => a.id === savedSelectedId)
                  ? savedSelectedId
                  : addrs[0].id
                
                setSelectedAddressId(activeId)
                const activeAddr = addrs.find(a => a.id === activeId) || addrs[0]
                
                setForm((p) => ({
                  ...p,
                  email: p.email || email,
                  customerName: p.customerName || activeAddr.fullName || fullName,
                  phone: p.phone || activeAddr.phone || phone,
                  address: p.address || [
                    activeAddr.details,
                    activeAddr.binaNo ? `Bina: ${activeAddr.binaNo}` : '',
                    activeAddr.daireNo ? `Daire: ${activeAddr.daireNo}` : '',
                    activeAddr.katNo ? `Kat: ${activeAddr.katNo}` : '',
                    activeAddr.mahalle ? `${activeAddr.mahalle} Mah.` : '',
                    `${activeAddr.region || ''} / ${activeAddr.district || ''} / ${activeAddr.city || ''}`.replace(/^\s*\/\s*|\s*\/\s*$/, '')
                  ].filter(Boolean).join(', '),
                }))
              }
            })
            .catch(() => {
              setAddressMode('manual')
            })
        }
      })
      .catch(() => {
        setAddressMode('manual')
      })
  }, [])

  const isLoggedIn = !!userId
  const showSavedOption = isLoggedIn && savedAddresses.length > 0
  const isManualAddress = !showSavedOption || addressMode === 'manual'

  // When a saved address is picked, sync form fields
  function selectSavedAddress(addr: Address) {
    setSelectedAddressId(addr.id)
    setForm((p) => ({
      ...p,
      customerName: addr.fullName,
      phone: addr.phone,
      address: [
        addr.details,
        addr.binaNo ? `Bina: ${addr.binaNo}` : '',
        addr.daireNo ? `Daire: ${addr.daireNo}` : '',
        addr.katNo ? `Kat: ${addr.katNo}` : '',
        addr.mahalle ? `${addr.mahalle} Mah.` : '',
        `${addr.region || ''} / ${addr.district || ''} / ${addr.city || ''}`.replace(/^\s*\/\s*|\s*\/\s*$/, '')
      ].filter(Boolean).join(', '),
    }))
  }

  // Switch mode
  function switchMode(mode: 'saved' | 'manual') {
    setAddressMode(mode)
    if (mode === 'saved' && savedAddresses.length > 0) {
      const current = savedAddresses.find((a) => a.id === selectedAddressId) ?? savedAddresses[0]
      selectSavedAddress(current)
    } else if (mode === 'manual') {
      // Keep customerName & email, clear address fields so user fills manually
      setForm((p) => ({ ...p, address: '' }))
    }
  }

  function validateStep1() {
    setMessage(null)
    if (!form.customerName.trim()) {
      setMessage('Lütfen Ad Soyad alanını doldurun.')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return false
    }
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setMessage('Lütfen geçerli bir E-posta adresi girin.')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return false
    }
    if (!form.phone.trim() || form.phone.length !== 11) {
      setMessage('Telefon numarası 11 haneli olmalıdır.')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return false
    }
    if (isManualAddress) {
      if (!manualCity) {
        setMessage('Lütfen Şehir seçin.')
        return false
      }
      if (!manualDistrict) {
        setMessage('Lütfen İlçe seçin.')
        return false
      }
      if (!manualRegion) {
        setMessage('Lütfen Bölge seçin.')
        return false
      }
      if (!manualMahalle.trim()) {
        setMessage('Lütfen Mahalle alanını doldurun.')
        return false
      }
      if (!manualBinaNo.trim()) {
        setMessage('Lütfen Bina No alanını doldurun.')
        return false
      }
      if (!manualDaireNo.trim()) {
        setMessage('Lütfen Daire No alanını doldurun.')
        return false
      }
      if (!manualDetails.trim()) {
        setMessage('Lütfen Açık Adres Açıklaması alanını doldurun.')
        return false
      }
    } else {
      if (!form.address.trim()) {
        setMessage('Lütfen bir teslimat adresi seçin veya manuel girin.')
        return false
      }
    }
    return true
  }

  async function handleProceedToPayment() {
    setLoading(true)
    setMessage(null)
    try {
      const token = getMemberToken()
      const finalAddress = isManualAddress
        ? `${manualDetails}, Bina: ${manualBinaNo}, Daire: ${manualDaireNo}, Kat: ${manualKatNo}, ${manualMahalle} Mah., ${manualRegion} / ${manualDistrict} / ${manualCity}`
        : form.address

      const previousOrderNo = localStorage.getItem('ecom_checkout_orderNo') || orderNo || undefined

      const res = await fetch('/api/orders/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          ...form,
          address: finalAddress,
          lines: items.map((x) => ({ productId: x.id, tenantCode: x.tenantCode ?? '', quantity: x.qty })),
          couponCode: appliedCoupon || undefined,
          orderNo: previousOrderNo
        }),
      })
      const json = await readApiResponse(res)
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Sipariş oluşturulamadı')
      
      const newOrderNo = String(json.data.orderNo)
      localStorage.setItem('ecom_checkout_orderNo', newOrderNo)
      setOrderNo(newOrderNo)
      
      // Advance to Step 2
      setCurrentStep(2)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Sipariş oluşturulamadı')
    } finally {
      setLoading(false)
    }
  }

  async function handlePaymentComplete() {
    if (!orderNo) {
      setMessage('Sipariş numarası bulunamadı.')
      return
    }

    if (!cardNumber || !expiry || !cvv) {
      setMessage('Lütfen tüm kart bilgilerini eksiksiz doldurun.')
      return
    }

    setLoading(true)
    setMessage(null)
    try {
      const res = await fetch('/api/orders/complete-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ orderNo })
      })
      
      let errorMsg = 'Ödeme tamamlanırken bir hata oluştu.'
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.success) {
        // Save address if checked
        const token = getMemberToken()
        if (token && isLoggedIn && isManualAddress && saveAddress && addressTitle && manualCity && manualDistrict && manualDetails) {
          try {
            await fetch('/api/storefront/addresses', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
              },
              body: JSON.stringify({
                title: addressTitle,
                fullName: form.customerName,
                phone: form.phone,
                city: manualCity,
                district: manualDistrict,
                region: manualRegion,
                mahalle: manualMahalle,
                binaNo: manualBinaNo,
                daireNo: manualDaireNo,
                katNo: manualKatNo,
                details: manualDetails
              })
            })
          } catch {
            // Ignore address save failure so checkout is not blocked
          }
        }

        writeCart([])
        localStorage.removeItem('ecom_checkout_form')
        localStorage.removeItem('ecom_checkout_saveAddress')
        localStorage.removeItem('ecom_checkout_addressTitle')
        localStorage.removeItem('ecom_checkout_manualCity')
        localStorage.removeItem('ecom_checkout_manualDistrict')
        localStorage.removeItem('ecom_checkout_manualRegion')
        localStorage.removeItem('ecom_checkout_manualMahalle')
        localStorage.removeItem('ecom_checkout_manualBinaNo')
        localStorage.removeItem('ecom_checkout_manualDaireNo')
        localStorage.removeItem('ecom_checkout_manualKatNo')
        localStorage.removeItem('ecom_checkout_manualDetails')
        localStorage.removeItem('ecom_checkout_addressMode')
        localStorage.removeItem('ecom_checkout_selectedAddressId')
        localStorage.removeItem('ecom_checkout_orderNo')

        setShowSuccessModal(true)
        return
      }
      errorMsg = json.message || errorMsg
      throw new Error(errorMsg)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ödeme tamamlanamadı.')
    } finally {
      setLoading(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    
    // Check if mobile step wizard flow
    const isMobile = window.innerWidth < 1024
    if (isMobile) {
      if (currentStep === 1) {
        if (validateStep1()) {
          await handleProceedToPayment()
        }
      } else {
        if (!cardNumber || !expiry || !cvv) {
          setMessage('Lütfen tüm kart bilgilerini eksiksiz doldurun.')
          return
        }
        await handlePaymentComplete()
      }
      return
    }

    if (!validateStep1()) {
      return
    }

    setLoading(true)
    setMessage(null)
    try {
      const token = getMemberToken()

      const finalAddress = isManualAddress
        ? `${manualDetails}, Bina: ${manualBinaNo}, Daire: ${manualDaireNo}, Kat: ${manualKatNo}, ${manualMahalle} Mah., ${manualRegion} / ${manualDistrict} / ${manualCity}`
        : form.address

      const previousOrderNo = localStorage.getItem('ecom_checkout_orderNo')

      const res = await fetch('/api/orders/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          ...form,
          address: finalAddress,
          lines: items.map((x) => ({ productId: x.id, tenantCode: x.tenantCode ?? '', quantity: x.qty })),
          couponCode: appliedCoupon || undefined,
          orderNo: previousOrderNo || undefined
        }),
      })
      const json = await readApiResponse(res)
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Siparis olusturulamadi')
      
      localStorage.setItem('ecom_checkout_orderNo', String(json.data.orderNo))

      setMessage(`Sipariş alındı: ${json.data.orderNo}. Ödeme sayfasına yönlendiriliyorsunuz...`)
      nav('/odeme', {
        state: {
          orderNo: String(json?.data?.orderNo ?? ''),
          customerName: form.customerName,
          phone: form.phone,
          total: grandTotal,
          saveAddress: isLoggedIn && isManualAddress && saveAddress,
          addressTitle,
          city: manualCity,
          district: manualDistrict,
          region: manualRegion,
          mahalle: manualMahalle,
          binaNo: manualBinaNo,
          daireNo: manualDaireNo,
          katNo: manualKatNo,
          details: manualDetails,
        },
      })
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Siparis olusturulamadi')
    } finally {
      setLoading(false)
    }
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-20 text-center">
        <h1 className="text-2xl font-bold text-on-surface">Sepetiniz boş</h1>
        <Link className="mt-6 inline-flex rounded-xl bg-primary px-6 py-3 font-bold text-white" to="/kategoriler">Alışverişe Başla</Link>
      </div>
    )
  }

  const inputCls = 'h-11 w-full rounded-xl border border-zinc-200 px-4 outline-none focus:border-primary transition-colors'
  const labelCls = 'space-y-2 text-sm font-semibold text-zinc-600'

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 pb-24 pt-4">
      {/* Mobile Collapsible Order Summary */}
      <div className="lg:hidden bg-zinc-50 border border-zinc-150 rounded-2xl p-4 mb-4">
        <button
          type="button"
          onClick={() => setIsSummaryExpanded(!isSummaryExpanded)}
          className="w-full flex items-center justify-between font-bold text-sm text-zinc-750"
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-zinc-550">shopping_basket</span>
            <span>Sipariş Özeti ({items.reduce((acc, x) => acc + x.qty, 0)} Ürün)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-primary font-extrabold text-base">{grandTotal.toLocaleString('tr-TR')} {currency}</span>
            <span className={`material-symbols-outlined transition-transform duration-200 ${isSummaryExpanded ? 'rotate-180' : ''}`}>
              expand_more
            </span>
          </div>
        </button>

        {isSummaryExpanded && (
          <div className="mt-4 pt-4 border-t border-zinc-200/80 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
            {getCheckoutItemPrices().map((item) => {
              const hasDiscount = item.hasDiscount
              const itemPrice = item.discountedPrice
              const originalPrice = item.originalPrice

              return (
                <div key={`${item.tenantCode}-${item.id}`} className="flex justify-between gap-3 text-xs">
                  <div className="flex flex-col min-w-0">
                    <span className="text-zinc-650 truncate max-w-[200px]">{item.name} x {item.qty}</span>
                    {item.campaignBadge && (
                      <span className="text-[9px] font-bold text-primary">{item.campaignBadge}</span>
                    )}
                  </div>
                  <div className="flex flex-col items-end shrink-0 font-bold text-zinc-800">
                    {hasDiscount && (
                      <span className="text-[10px] text-zinc-400 line-through">{(originalPrice * item.qty).toLocaleString('tr-TR')} {currency}</span>
                    )}
                    <span>{(itemPrice * item.qty).toLocaleString('tr-TR')} {currency}</span>
                  </div>
                </div>
              )
            })}

            {/* Gift Items */}
            {calcResult?.giftItems?.map((gift: any) => (
              <div key={`gift-${gift.productId}`} className="flex justify-between gap-3 text-xs bg-emerald-50/50 p-1.5 rounded-lg border border-emerald-100/50">
                <span className="text-emerald-855 truncate max-w-[200px] font-semibold">🎁 [Hediye] {gift.productName} x {gift.quantity}</span>
                <span className="font-bold text-emerald-700 shrink-0">Bedava</span>
              </div>
            ))}
            
            {/* Coupon and Subtotals for mobile collapsible view */}
            <div className="pt-2 border-t border-zinc-200/60 space-y-2 text-xs">
              <div className="flex justify-between text-zinc-500 font-semibold">
                <span>Ara Toplam:</span>
                <span>{displaySubtotal.toLocaleString('tr-TR')} {currency}</span>
              </div>
              {displayCampaignDiscount > 0 && (
                <div className="flex justify-between text-emerald-650 font-bold">
                  <span>Kampanya İndirimi:</span>
                  <span>-{displayCampaignDiscount.toLocaleString('tr-TR')} {currency}</span>
                </div>
              )}
              {discountAmount > 0 && (
                <div className="flex justify-between text-green-600 font-bold">
                  <span>Kupon İndirimi:</span>
                  <span>-{discountAmount.toLocaleString('tr-TR')} {currency}</span>
                </div>
              )}
              <div className="flex justify-between text-zinc-500 font-semibold">
                <span>Kargo:</span>
                <span className={displayShipping === 0 ? 'text-green-600 font-bold' : ''}>
                  {displayShipping === 0 ? 'Ücretsiz' : `${displayShipping.toLocaleString('tr-TR')} ${currency}`}
                </span>
              </div>
              
              {/* Promo code area inside summary on mobile */}
              <div className="pt-2 border-t border-zinc-200/40">
                {appliedCoupon ? (
                  <div className="flex items-center justify-between bg-emerald-50 border border-emerald-250 rounded-xl p-2">
                    <span className="font-mono font-bold text-[10px] text-emerald-800 uppercase truncate">{appliedCoupon}</span>
                    <button
                      type="button"
                      onClick={removeCoupon}
                      className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center hover:bg-emerald-200 shrink-0"
                    >
                      <span className="material-symbols-outlined text-[10px] font-bold">close</span>
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Kupon Kodu"
                      value={couponCode}
                      onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                      className="h-8 flex-1 rounded-lg border border-zinc-200 px-2.5 outline-none focus:border-primary text-xs font-mono font-bold uppercase bg-white"
                    />
                    <button
                      type="button"
                      disabled={couponLoading || !couponCode.trim()}
                      onClick={applyCoupon}
                      className="h-8 px-3 rounded-lg bg-zinc-950 text-white font-bold text-xs hover:bg-zinc-800 active:scale-95 disabled:opacity-55 transition-all shrink-0"
                    >
                      {couponLoading ? '...' : 'Uygula'}
                    </button>
                  </div>
                )}
                {couponError && (
                  <p className="text-[10px] font-bold text-rose-600 mt-1">{couponError}</p>
                )}
                {couponSuccess && (
                  <p className="text-[10px] font-bold text-emerald-600 mt-1">{couponSuccess}</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_420px]">
        <form ref={formRef} id="checkout-form" onSubmit={submit} noValidate className="rounded-2xl border border-zinc-100 bg-white p-5 sm:p-6 shadow-sm">
          <h1 className="text-2xl font-bold text-on-surface lg:block hidden">Teslimat ve Ödeme</h1>
          <p className="mt-2 text-sm text-zinc-500 lg:block hidden">
            Sanal POS arayüzü hazır; ödeme entegrasyonu aktif olana kadar siparişler ödeme bekliyor olarak kaydedilir.
          </p>

          {/* Mobile Stepper Progress Bar */}
          <div className="flex items-center justify-center gap-2 mb-6 lg:hidden border-b border-zinc-105 pb-4">
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${currentStep === 1 ? 'bg-primary text-white' : 'bg-zinc-150 text-zinc-500'}`}>1</span>
              <span className={`text-xs font-bold ${currentStep === 1 ? 'text-primary' : 'text-zinc-500'}`}>Teslimat</span>
            </div>
            <span className="material-symbols-outlined text-zinc-300 text-sm">chevron_right</span>
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${currentStep === 2 ? 'bg-primary text-white' : 'bg-zinc-150 text-zinc-500'}`}>2</span>
              <span className={`text-xs font-bold ${currentStep === 2 ? 'text-primary' : 'text-zinc-500'}`}>Ödeme</span>
            </div>
          </div>

          {/* Delivery Details Block (Step 1 or Desktop) */}
          <div className={currentStep === 1 ? "block" : "hidden lg:block"}>
            {/* Personal info */}
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {[
                ['customerName', 'Ad Soyad'],
                ['email', 'E-posta'],
              ].map(([key, label]) => (
                <label key={key} className={labelCls}>
                  <span>{label}</span>
                  <input
                    required={currentStep === 1}
                    value={(form as Record<string, string>)[key]}
                    onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
                    className={inputCls}
                  />
                </label>
              ))}

              <label className={labelCls}>
                <span>Telefon</span>
                <input
                  required={currentStep === 1}
                  inputMode="numeric"
                  placeholder="05xxxxxxxxx"
                  value={form.phone}
                  maxLength={11}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 11)
                    setForm((p) => ({ ...p, phone: digits }))
                  }}
                  className={inputCls}
                />
              </label>
            </div>

            {/* Address Section */}
            <div className="mt-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-on-surface">Teslimat Adresi</h2>

                {/* Toggle buttons — only visible when logged in and has saved addresses */}
                {showSavedOption && (
                  <div className="flex rounded-xl border border-zinc-200 overflow-hidden text-xs font-bold">
                    <button
                      type="button"
                      onClick={() => switchMode('saved')}
                      className={`px-4 py-2 transition-colors ${
                        addressMode === 'saved'
                          ? 'bg-primary text-white'
                          : 'bg-white text-zinc-500 hover:bg-zinc-50'
                      }`}
                    >
                      <span className="material-symbols-outlined text-sm align-middle mr-1" style={{ fontSize: 14 }}>location_on</span>
                      Kayıtlı Adreslerim
                    </button>
                    <button
                      type="button"
                      onClick={() => switchMode('manual')}
                      className={`px-4 py-2 border-l border-zinc-200 transition-colors ${
                        addressMode === 'manual'
                          ? 'bg-primary text-white'
                          : 'bg-white text-zinc-500 hover:bg-zinc-50'
                      }`}
                    >
                      <span className="material-symbols-outlined text-sm align-middle mr-1" style={{ fontSize: 14 }}>edit</span>
                      Manuel Gir
                    </button>
                  </div>
                )}
              </div>

              {/* Saved addresses list */}
              {showSavedOption && addressMode === 'saved' && (
                <div className="space-y-3">
                  {savedAddresses.map((addr) => {
                    const selected = addr.id === selectedAddressId
                    return (
                      <button
                        key={addr.id}
                        type="button"
                        onClick={() => selectSavedAddress(addr)}
                        className={`w-full text-left rounded-2xl border-2 p-4 transition-all ${
                          selected
                            ? 'border-primary bg-primary/5 shadow-sm'
                            : 'border-zinc-100 bg-zinc-50 hover:border-zinc-300'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={`material-symbols-outlined mt-0.5 text-xl ${
                              selected ? 'text-primary' : 'text-zinc-400'
                            }`}
                          >
                            {selected ? 'radio_button_checked' : 'radio_button_unchecked'}
                          </span>
                          <div className="flex-1">
                            <p className={`font-bold text-sm ${selected ? 'text-primary' : 'text-on-surface'}`}>
                              {addr.title}
                            </p>
                            <p className="text-xs text-zinc-500 mt-0.5">{addr.fullName} · {addr.phone}</p>
                            <p className="text-xs text-zinc-650 mt-1 leading-relaxed">
                              {addr.details}
                              {addr.binaNo && `, Bina: ${addr.binaNo}`}
                              {addr.daireNo && `, Daire: ${addr.daireNo}`}
                              {addr.katNo && `, Kat: ${addr.katNo}`}
                              {addr.mahalle && `, ${addr.mahalle} Mah.`}
                              {addr.region && `, ${addr.region}`}
                              {`, ${addr.district} / ${addr.city}`}
                            </p>
                          </div>
                          {selected && (
                            <span className="text-[10px] font-bold bg-primary text-white px-2 py-0.5 rounded-full uppercase tracking-wide self-start">
                              Seçili
                            </span>
                          )}
                        </div>
                      </button>
                    )
                  })}

                  {/* Link to add more addresses */}
                  <button
                    type="button"
                    onClick={() => {
                      switchMode('manual')
                      setSaveAddress(true)
                    }}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline mt-1"
                  >
                    <span className="material-symbols-outlined text-sm">add_circle</span>
                    Yeni Adres Ekle
                  </button>
                </div>
              )}

              {/* Manual address layout */}
              {(!showSavedOption || addressMode === 'manual') && (
                <div className="space-y-4 border border-zinc-100 bg-zinc-50/30 p-5 rounded-2xl">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Şehir (İl)</label>
                      <select 
                        value={manualCity} 
                        onChange={e => setManualCity(e.target.value)}
                        className="w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm font-semibold" 
                        required={currentStep === 1 && (!showSavedOption || addressMode === 'manual')}
                      >
                        <option value="Kuzey Kıbrıs (KKTC)">Kuzey Kıbrıs (KKTC)</option>
                      </select>
                    </div>
                    <div className="space-y-1 flex flex-col justify-end">
                      <SearchableSelect
                        value={manualDistrict}
                        onChange={(val) => {
                          setManualDistrict(val)
                          setManualRegion('')
                        }}
                        options={Object.keys(cyprusData)}
                        placeholder="İlçe Seçin"
                        label="İlçe"
                        required={currentStep === 1 && (!showSavedOption || addressMode === 'manual')}
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1 flex flex-col justify-end">
                      <SearchableSelect
                        value={manualRegion}
                        onChange={(val) => setManualRegion(val)}
                        options={(cyprusData as Record<string, string[]>)[manualDistrict] || []}
                        placeholder="Bölge Seçin"
                        label="Bölge"
                        required={currentStep === 1 && (!showSavedOption || addressMode === 'manual')}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Mahalle</label>
                      <input 
                        value={manualMahalle} 
                        onChange={e => setManualMahalle(e.target.value)} 
                        className="w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm" 
                        placeholder="Mahalle yazın" 
                        required={currentStep === 1 && (!showSavedOption || addressMode === 'manual')} 
                        type="text" 
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Bina No</label>
                      <input 
                        value={manualBinaNo} 
                        onChange={e => setManualBinaNo(e.target.value)} 
                        className="w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm" 
                        placeholder="Bina No" 
                        required={currentStep === 1 && (!showSavedOption || addressMode === 'manual')} 
                        type="text" 
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Daire No</label>
                      <input 
                        value={manualDaireNo} 
                        onChange={e => setManualDaireNo(e.target.value)} 
                        className="w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm" 
                        placeholder="Daire" 
                        required={currentStep === 1 && (!showSavedOption || addressMode === 'manual')} 
                        type="text" 
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Kat No</label>
                      <input 
                        value={manualKatNo} 
                        onChange={e => setManualKatNo(e.target.value)} 
                        className="w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm" 
                        placeholder="Kat" 
                        required={currentStep === 1 && (!showSavedOption || addressMode === 'manual')} 
                        type="text" 
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Açık Adres Açıklaması</label>
                    <textarea 
                      value={manualDetails} 
                      onChange={e => setManualDetails(e.target.value)} 
                      className="w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm resize-none" 
                      placeholder="Adres Açıklaması..." 
                      rows={3} 
                      required={currentStep === 1 && (!showSavedOption || addressMode === 'manual')} 
                    />
                  </div>

                  {isLoggedIn && (
                    <div className="space-y-4 bg-zinc-100/50 p-4 rounded-xl border border-zinc-200/50 mt-4">
                      <label className="flex items-center gap-2 cursor-pointer font-bold text-xs text-zinc-700">
                        <input
                          type="checkbox"
                          checked={saveAddress}
                          onChange={(e) => setSaveAddress(e.target.checked)}
                          className="w-4 h-4 rounded text-primary focus:ring-primary border-zinc-300"
                        />
                        <span>Bu Adresi Kaydet</span>
                      </label>

                      {saveAddress && (
                        <div className="grid gap-4 sm:grid-cols-2 animate-in fade-in duration-200">
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Adres Başlığı</label>
                            <input
                              required={saveAddress && currentStep === 1}
                              value={addressTitle}
                              onChange={(e) => setAddressTitle(e.target.value)}
                              placeholder="Ev, İş vb."
                              className="w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Credit Card Form (Step 2 on mobile) */}
          <div className={currentStep === 2 ? "block space-y-6" : "hidden lg:hidden"}>
            <div>
              <h2 className="text-base font-bold text-on-surface mb-1">Kart Bilgileri</h2>
              <p className="text-xs text-zinc-500">Güvenli 3D ödeme altyapısı ile kart bilgilerinizi giriniz.</p>
            </div>

            <div className="space-y-4">
              <label className={labelCls}>
                <span>Kart Numarası</span>
                <input
                  type="text"
                  required={currentStep === 2}
                  inputMode="numeric"
                  placeholder="0000 0000 0000 0000"
                  maxLength={19}
                  value={formattedCardNumber}
                  onChange={(e) => setCardNumber(e.target.value)}
                  className={inputCls}
                />
              </label>

              <div className="grid grid-cols-2 gap-4">
                <label className={labelCls}>
                  <span>Son Kullanma Tarihi (AA/YY)</span>
                  <input
                    type="text"
                    required={currentStep === 2}
                    inputMode="numeric"
                    placeholder="AA/YY"
                    maxLength={5}
                    value={formattedExpiry}
                    onChange={(e) => setExpiry(e.target.value)}
                    className={inputCls}
                  />
                </label>

                <label className={labelCls}>
                  <span>CVV / CVC</span>
                  <input
                    type="password"
                    required={currentStep === 2}
                    inputMode="numeric"
                    placeholder="***"
                    maxLength={3}
                    value={cvv}
                    onChange={(e) => setCvv(e.target.value.replace(/\D/g, '').slice(0, 3))}
                    className={inputCls}
                  />
                </label>
              </div>

              <label className={labelCls}>
                <span>Kart Üzerindeki İsim</span>
                <input
                  type="text"
                  required={currentStep === 2}
                  placeholder="Ad Soyad"
                  defaultValue={form.customerName}
                  className={inputCls}
                />
              </label>
            </div>

            <button
              type="button"
              onClick={() => {
                setCurrentStep(1)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-500 hover:text-primary transition-colors mt-2"
            >
              <span className="material-symbols-outlined text-sm">arrow_back</span>
              Adres Bilgilerine Dön
            </button>
          </div>

          {message ? (
            <div className={`mt-4 rounded-xl p-4 text-sm font-semibold ${
              message.includes('başarıyla') ? 'bg-emerald-50 text-emerald-850 border border-emerald-100' : 'bg-primary/10 text-primary'
            }`}>{message}</div>
          ) : null}

          {/* Form Submit Button (Visible inside form on both mobile and desktop) */}
          <button
            type="submit"
            disabled={loading}
            className="mt-6 w-full rounded-xl bg-primary px-6 py-4 font-bold text-white disabled:opacity-60 hover:opacity-90 active:scale-[0.98] transition-all block"
          >
            {loading ? 'Yükleniyor...' : currentStep === 1 ? 'Ödemeye Geç' : 'Siparişi Tamamla'}
          </button>
        </form>

        {/* Desktop Sidebar Summary */}
        <aside className="hidden lg:block h-fit rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
          <h2 className="font-bold text-on-surface">Sipariş Özeti</h2>
          <div className="mt-4 space-y-3 pb-4 border-b border-zinc-100">
            {getCheckoutItemPrices().map((item) => {
              const hasDiscount = item.hasDiscount
              const itemPrice = item.discountedPrice
              const originalPrice = item.originalPrice

              return (
                <div key={`${item.tenantCode}-${item.id}`} className="flex justify-between gap-3 text-sm">
                  <div className="flex flex-col min-w-0">
                    <span className="text-zinc-650 truncate max-w-[220px]">{item.name} x {item.qty}</span>
                    {item.campaignBadge && (
                      <span className="text-xs text-primary font-bold">{item.campaignBadge}</span>
                    )}
                  </div>
                  <div className="flex flex-col items-end shrink-0 font-bold text-on-surface">
                    {hasDiscount && (
                      <span className="text-xs text-zinc-400 line-through">{(originalPrice * item.qty).toLocaleString('tr-TR')} {currency}</span>
                    )}
                    <span>{(itemPrice * item.qty).toLocaleString('tr-TR')} {currency}</span>
                  </div>
                </div>
              )
            })}

            {/* Gift Items */}
            {calcResult?.giftItems?.map((gift: any) => (
              <div key={`gift-${gift.productId}`} className="flex justify-between gap-3 text-sm bg-emerald-50/50 p-2 rounded-xl border border-emerald-100/50">
                <span className="text-emerald-855 truncate max-w-[220px] font-semibold">🎁 [Hediye] {gift.productName} x {gift.quantity}</span>
                <span className="font-bold text-emerald-700 shrink-0">Bedava</span>
              </div>
            ))}
          </div>

          {/* Coupon Input Area */}
          <div className="py-4 border-b border-zinc-100 space-y-3">
            <div className="text-xs font-bold text-zinc-500">İNDİRİM KUPONU</div>
            {appliedCoupon ? (
              <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                <div className="min-w-0">
                  <p className="font-mono font-bold text-xs text-emerald-800 uppercase truncate">{appliedCoupon}</p>
                  <p className="text-[10px] text-emerald-600 font-bold mt-0.5">{discountAmount.toLocaleString('tr-TR')} {currency} İndirim</p>
                </div>
                <button
                  type="button"
                  onClick={removeCoupon}
                  className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center hover:bg-emerald-250 transition-colors shrink-0"
                  title="Kuponu Kaldır"
                >
                  <span className="material-symbols-outlined text-[15px] font-bold">close</span>
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Kupon Kodu Girin"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                  className="h-9 flex-1 rounded-xl border border-zinc-200 px-3 outline-none focus:border-primary text-xs font-mono font-bold uppercase"
                />
                <button
                  type="button"
                  disabled={couponLoading || !couponCode.trim()}
                  onClick={applyCoupon}
                  className="h-9 px-4 rounded-xl bg-zinc-950 text-white font-bold text-xs hover:bg-zinc-800 active:scale-95 disabled:opacity-55 transition-all shrink-0"
                >
                  {couponLoading ? '...' : 'Uygula'}
                </button>
              </div>
            )}

            {couponError && (
              <p className="text-[10px] font-bold text-rose-600 bg-rose-50 border border-rose-100 p-2 rounded-lg">{couponError}</p>
            )}
            {couponSuccess && (
              <p className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 p-2 rounded-lg">{couponSuccess}</p>
            )}
          </div>

          {/* Total Price Display */}
          <div className="pt-4 space-y-2">
            <div className="flex justify-between text-xs text-zinc-500 font-semibold">
              <span>Ara Toplam:</span>
              <span>{displaySubtotal.toLocaleString('tr-TR')} {currency}</span>
            </div>
            {displayCampaignDiscount > 0 && (
              <div className="flex justify-between text-xs text-emerald-650 font-bold">
                <span>Kampanya İndirimi:</span>
                <span>-{displayCampaignDiscount.toLocaleString('tr-TR')} {currency}</span>
              </div>
            )}
            {discountAmount > 0 && (
              <div className="flex justify-between text-xs text-green-600 font-bold">
                <span>Kupon İndirimi:</span>
                <span>-{discountAmount.toLocaleString('tr-TR')} {currency}</span>
              </div>
            )}
            <div className="flex justify-between text-xs text-zinc-500 font-semibold">
              <span>Kargo:</span>
              <span className={displayShipping === 0 ? 'text-green-600 font-bold' : ''}>
                {displayShipping === 0 ? 'Ücretsiz' : `${displayShipping.toLocaleString('tr-TR')} ${currency}`}
              </span>
            </div>
            <div className="flex justify-between items-center text-xl font-extrabold text-primary pt-3 border-t border-zinc-150/60 mt-2">
              <span>Toplam:</span>
              <div className="flex items-center gap-2">
                {(discountAmount > 0 || displayCampaignDiscount > 0) && (
                  <span className="text-xs text-zinc-400 line-through font-normal">
                    {(displaySubtotal + displayShipping).toLocaleString('tr-TR')} {currency}
                  </span>
                )}
                <span>{grandTotal.toLocaleString('tr-TR')} {currency}</span>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Sticky Bottom Bar for Mobile Checkout Actions */}
      <div className="fixed bottom-0 inset-x-0 z-[60] bg-white border-t border-zinc-200/80 px-4 py-3 pb-[calc(10px+env(safe-area-inset-bottom))] shadow-[0_-8px_30px_rgb(0,0,0,0.08)] flex items-center justify-between gap-4 lg:hidden">
        <div className="min-w-0">
          <p className="text-[10px] font-bold text-zinc-450 uppercase tracking-wider">TOPLAM TUTAR</p>
          <p className="text-lg font-black text-primary">{grandTotal.toLocaleString('tr-TR')} {currency}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (formRef.current) {
              if (typeof formRef.current.requestSubmit === 'function') {
                formRef.current.requestSubmit()
              } else {
                formRef.current.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
              }
            }
          }}
          disabled={loading}
          className="rounded-xl bg-primary px-6 py-3 text-sm font-bold text-white shadow-md shadow-primary/20 active:scale-[0.97] transition-all disabled:opacity-60 shrink-0"
        >
          {loading ? 'Yükleniyor...' : currentStep === 1 ? 'Ödemeye Geç' : 'Siparişi Tamamla'}
        </button>
      </div>

      {showSuccessModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-zinc-150 flex flex-col items-center text-center space-y-6 animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-500 scale-110">
              <span className="material-symbols-outlined text-4xl font-bold">check_circle</span>
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold text-zinc-900">Ödemeniz Onaylandı!</h3>
              <p className="text-zinc-500 text-sm leading-relaxed">
                Ödemeniz onaylandı, faturanız mail adresine gönderildi, kontrol edebilirsiniz.
              </p>
            </div>
            <div className="w-full space-y-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowSuccessModal(false)
                  nav('/hesabim?tab=orders')
                }}
                className="w-full h-12 rounded-2xl bg-zinc-900 hover:bg-zinc-800 text-white font-bold text-sm transition-all active:scale-[0.98] shadow-sm flex items-center justify-center gap-1.5"
              >
                <span className="material-symbols-outlined text-lg">shopping_bag</span>
                Siparişlerime Git
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowSuccessModal(false)
                  nav('/')
                }}
                className="w-full h-12 rounded-2xl border border-zinc-200 hover:bg-zinc-50 text-zinc-700 font-bold text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-1.5"
              >
                <span className="material-symbols-outlined text-lg">home</span>
                Ana Sayfaya Dön
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
