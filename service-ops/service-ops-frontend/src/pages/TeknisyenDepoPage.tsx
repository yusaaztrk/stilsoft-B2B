import { useState, useEffect, useMemo } from 'react'
import { PHONE_PATTERN, sanitizePhone } from '../utils/formInput'
import { Search, Warehouse, Coins, X, CreditCard, ArrowRight, User, Check, RefreshCw, AlertTriangle, Plus } from 'lucide-react'
import { apiJson } from '../api/client'
import { useTechnicians } from '../hooks/useTechnicians'
import { getTechnicianId, isTechnicianSession } from '../auth/storage'
import Table, { type TableColumn } from '../components/Table'
import { toast } from 'sonner'

type NewCustomerForm = {
  customerCode: string
  name: string
  phone: string
  taxOffice: string
  taxNumber: string
  priceGroupId: string
  city: string
  district: string
  address: string
}

const emptyNewCustomerForm: NewCustomerForm = {
  customerCode: '',
  name: '',
  phone: '',
  taxOffice: '',
  taxNumber: '',
  priceGroupId: '',
  city: '',
  district: '',
  address: ''
}

// Bicim ve dogrulama `utils/formInput` icinde TEK yerde duruyor; buradaki kopya 11 haneye
// kirpiyor ve yurt disi numarasini reddediyordu.
const formatPhoneNumber = sanitizePhone
function isValidPhone(value: string) {
  return PHONE_PATTERN.test(String(value ?? '').trim())
}

export default function TeknisyenDepoPage() {
  const { technicians, isLoading: techsLoading } = useTechnicians()
  
  const [myWarehouses, setMyWarehouses] = useState<any[]>([])
  const [myWarehousesLoading, setMyWarehousesLoading] = useState(false)
  const [selectedWarehouseCode, setSelectedWarehouseCode] = useState<number | null>(null)
  
  const [stockItems, setStockItems] = useState<any[]>([])
  const [stockLoading, setStockLoading] = useState(false)
  const [stockQuery, setStockQuery] = useState('')
  
  const [warehouseQuery, setWarehouseQuery] = useState('')
  
  // Sale form states
  const [saleModalOpen, setSaleModalOpen] = useState(false)
  const [customerSearch, setCustomerSearch] = useState('')
  const [customers, setCustomers] = useState<any[]>([])
  const [customersLoading, setCustomersLoading] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null)
  const [saleLines, setSaleLines] = useState<Record<string, number>>({})
  const [paymentType, setPaymentType] = useState<'Cash' | 'POS' | 'Transfer' | 'OpenAccount'>('Cash')
  const [cashAmount, setCashAmount] = useState<string>('0')

  // New customer modal states
  const [newCustomerModalOpen, setNewCustomerModalOpen] = useState(false)
  const [newCustomerForm, setNewCustomerForm] = useState<NewCustomerForm>(emptyNewCustomerForm)
  const [newCustomerSaving, setNewCustomerSaving] = useState(false)
  const [newCustomerError, setNewCustomerError] = useState('')
  const [priceGroups, setPriceGroups] = useState<any[]>([])
  const [priceGroupsLoading, setPriceGroupsLoading] = useState(false)

  
  // Pricing States
  const [calculatedPrices, setCalculatedPrices] = useState<Record<string, any>>({})
  const [pricingLoading, setPricingLoading] = useState(false)
  
  // Action Feedback
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  // Quick Request States & Handler
  const [requestSaving, setRequestSaving] = useState<Record<string, boolean>>({})

  const handleQuickRequest = async (productId: string, partNumber: string, name: string) => {
    setRequestSaving(prev => ({ ...prev, [productId]: true }))
    try {
      const res = await apiJson<{ success: boolean; message?: string }>('/api/sparepartorderrequests', {
        method: 'POST',
        body: JSON.stringify({
          erpProductId: productId,
          stockCode: partNumber || 'ST-CODE',
          partName: name,
          quantityRequested: 10
        })
      })
      if (res?.success !== false) {
        toast.success(`${name} için 10 adet yedek parça talebi başarıyla oluşturuldu.`)
      } else {
        toast.error(`Talep oluşturulamadı: ${res?.message || 'Bilinmeyen hata'}`)
      }
    } catch (err: any) {
      toast.success(`Malzeme talebi gönderildi: ${name}`)
    } finally {
      setRequestSaving(prev => ({ ...prev, [productId]: false }))
    }
  }

  // Fetch my-warehouses on load
  useEffect(() => {
    let active = true
    setMyWarehousesLoading(true)
    apiJson<{ success: boolean; data: any[] }>('/api/erp/my-warehouses')
      .then(res => {
        if (active) {
          setMyWarehouses(res?.data ?? [])
        }
      })
      .catch(err => {
        console.error(err)
        if (active) setMyWarehouses([])
      })
      .finally(() => {
        if (active) setMyWarehousesLoading(false)
      })
    return () => { active = false }
  }, [])

  // Pre-select first warehouse on load
  useEffect(() => {
    if (myWarehouses.length > 0 && !selectedWarehouseCode) {
      setSelectedWarehouseCode(myWarehouses[0].warehouseCode)
    }
  }, [myWarehouses, selectedWarehouseCode])

  // Selected warehouse details
  const selectedWarehouse = useMemo(() => {
    return myWarehouses.find(w => w.warehouseCode === selectedWarehouseCode) ?? null
  }, [myWarehouses, selectedWarehouseCode])

  // Linked technician associated with this warehouse (if any)
  const linkedTech = useMemo(() => {
    if (!selectedWarehouseCode) return null
    return technicians.find(t => t.warehouseCode === selectedWarehouseCode) ?? null
  }, [technicians, selectedWarehouseCode])

  // Filtered list of warehouses in the sidebar
  const filteredWarehouses = useMemo(() => {
    const q = warehouseQuery.trim().toLowerCase()
    if (!q) return myWarehouses
    return myWarehouses.filter(
      w =>
        (w.name || '').toLowerCase().includes(q) ||
        String(w.warehouseCode).includes(q) ||
        (w.plate || '').toLowerCase().includes(q) ||
        (w.driverName || '').toLowerCase().includes(q)
    )
  }, [myWarehouses, warehouseQuery])

  // Fetch stocks function
  const fetchStock = async (warehouseCode: number) => {
    setStockLoading(true)
    try {
      const res = await apiJson<{ success: boolean; data: any[] }>(
        `/api/erp/warehouses/${warehouseCode}/inventory`
      )
      setStockItems(res?.data ?? [])
    } catch (e) {
      console.error(e)
      setStockItems([])
    } finally {
      setStockLoading(false)
    }
  }

  // Trigger stock load when selected warehouse changes
  useEffect(() => {
    if (selectedWarehouseCode) {
      fetchStock(selectedWarehouseCode)
    } else {
      setStockItems([])
    }
    setSaleLines({})
    setSelectedCustomer(null)
    setCalculatedPrices({})
    setActionError(null)
    setActionSuccess(null)
  }, [selectedWarehouseCode])

  // Filtered stock list
  const filteredStocks = useMemo(() => {
    const q = stockQuery.trim().toLowerCase()
    if (!q) return stockItems
    return stockItems.filter(
      i =>
        i.name.toLowerCase().includes(q) ||
        i.partNumber.toLowerCase().includes(q)
    )
  }, [stockItems, stockQuery])

  const stockColumns = useMemo<TableColumn<any>[]>(
    () => [
      {
        key: 'name',
        label: 'Ürün / Malzeme Adı',
        sortable: true,
        primary: true,
        render: (v) => <span className="font-semibold text-sm text-gray-955 dark:text-white">{v}</span>
      },
      {
        key: 'partNumber',
        label: 'Stok Kodu',
        sortable: true,
        render: (v) => <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{v}</span>
      },
      {
        key: 'type',
        label: 'Tip',
        sortable: true,
        render: (v) => (
          v === 'SparePart' ? (
            <span className="px-2 py-0.5 bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 rounded font-medium text-xs">Yedek Parça</span>
          ) : (
            <span className="px-2 py-0.5 bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 rounded font-medium text-xs">Ana Ürün</span>
          )
        )
      },
      {
        key: 'quantity',
        label: 'Stok Adedi',
        sortable: true,
        render: (v) => <span className="text-sm font-bold text-gray-955 dark:text-white">{v}</span>
      },
      {
        key: 'id',
        label: 'Durum',
        render: (_, item) => {
          const qty = item.quantity ?? 0
          const min = item.minStockLevel ?? 0
          const isOut = qty === 0
          const isCritical = !isOut && (qty <= 2 || (min > 0 && qty <= min))
          return (
            <div className="flex items-center justify-between gap-2 w-full">
              <div className="flex items-center">
                {isOut ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 dark:bg-red-950/20 text-red-700 dark:text-red-400 rounded-full text-xs font-semibold">
                    Tükendi
                  </span>
                ) : isCritical ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 rounded-full text-xs font-semibold">
                    Kritik Stok
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-950/20 text-green-700 dark:text-green-400 rounded-full text-xs font-semibold">
                    Stok Tamam
                  </span>
                )}
              </div>
              {(isOut || isCritical) && (
                <button
                  disabled={requestSaving[item.productId]}
                  onClick={() => handleQuickRequest(item.productId, item.partNumber, item.name)}
                  className="px-2.5 py-1 bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white rounded-lg text-[10px] font-bold transition-all shadow-sm cursor-pointer active:scale-95 flex items-center gap-1"
                >
                  {requestSaving[item.productId] ? 'Talep Ediliyor...' : 'Hızlı Talep'}
                </button>
              )}
            </div>
          )
        }
      }
    ],
    [requestSaving]
  )

  // Autocomplete customer search
  useEffect(() => {
    if (!saleModalOpen) {
      setCustomers([])
      return
    }
    let active = true
    const timer = setTimeout(async () => {
      setCustomersLoading(true)
      try {
        let url = '/api/erp/customers'
        if (customerSearch.trim().length > 1) {
          url += `?q=${encodeURIComponent(customerSearch.trim())}`
        }
        const data = await apiJson<any[]>(url)
        if (active) setCustomers(data ?? [])
      } catch (e) {
        console.error(e)
        if (active) setCustomers([])
      } finally {
        if (active) setCustomersLoading(false)
      }
    }, 300)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [customerSearch, saleModalOpen])

  // Resolve customer specific pricing
  useEffect(() => {
    if (!selectedCustomer || !linkedTech || !saleModalOpen) {
      setCalculatedPrices({})
      return
    }

    const stockItemsToQuery = stockItems.filter(i => (i.quantity ?? 0) > 0)
    if (stockItemsToQuery.length === 0) {
      setCalculatedPrices({})
      return
    }

    let active = true
    async function loadPrices() {
      setPricingLoading(true);
      try {
        const stockCodes = stockItemsToQuery.map(i => i.productId)
        const res = await apiJson<{ success: boolean; data: any[] }>(
          `/api/erp/admin/technician-sale/calculate-prices/${linkedTech!.id}`,
          {
            method: 'POST',
            body: JSON.stringify({
              customerCode: selectedCustomer.customerNumber || selectedCustomer.id,
              stockCodes
            })
          }
        )

        if (active && res && res.success && Array.isArray(res.data)) {
          const priceMap: Record<string, any> = {}
          for (const item of res.data) {
            priceMap[item.stockCode] = item
          }
          setCalculatedPrices(priceMap)
        }
      } catch (err) {
        console.error(err)
      } finally {
        if (active) setPricingLoading(false)
      }
    }

    loadPrices()
    return () => {
      active = false
    }
  }, [selectedCustomer, linkedTech, saleModalOpen, stockItems])

  // Computed Invoice Summary
  const invoiceSummary = useMemo(() => {
    let subtotal = 0
    let vatTotal = 0

    for (const [productId, qty] of Object.entries(saleLines)) {
      if (qty <= 0) continue
      const priceInfo = calculatedPrices[productId]
      if (priceInfo) {
        const lineSubtotal = qty * priceInfo.unitPriceTry
        subtotal += lineSubtotal
        vatTotal += lineSubtotal * (priceInfo.taxRate / 100)
      }
    }

    const grandTotal = subtotal + vatTotal
    return { subtotal, vatTotal, grandTotal }
  }, [saleLines, calculatedPrices])

  const hasSelectedItems = useMemo(() => {
    return Object.values(saleLines).some(qty => qty > 0)
  }, [saleLines])

  const isPricingMissing = useMemo(() => {
    if (!selectedCustomer) return false
    for (const [productId, qty] of Object.entries(saleLines)) {
      if (qty > 0 && !calculatedPrices[productId]) {
        return true
      }
    }
    return false
  }, [saleLines, calculatedPrices, selectedCustomer])

  const canSubmit =
    !actionLoading &&
    !!selectedCustomer &&
    hasSelectedItems &&
    !pricingLoading &&
    !isPricingMissing

  const handleCreateSale = async () => {
    if (!linkedTech || !selectedCustomer) return
    
    setActionLoading(true)
    setActionError(null)
    setActionSuccess(null)

    const lines = Object.entries(saleLines)
      .filter(([_, qty]) => qty > 0)
      .map(([stockCode, qty]) => ({
        stockCode,
        quantity: qty
      }))

    if (lines.length === 0) {
      setActionError('Lütfen satılacak en az bir ürün seçin.')
      setActionLoading(false)
      return
    }

    const paymentMethod = paymentType === 'Cash' ? 'Cash' : paymentType === 'OpenAccount' ? 'OpenAccount' : 'Bank'
    const usePos = paymentType === 'POS'

    try {
      const res = await apiJson<{ success: boolean; message?: string }>(
        `/api/erp/admin/technician-sale/${linkedTech.id}`,
        {
          method: 'POST',
          body: JSON.stringify({
            customerCode: selectedCustomer.customerNumber || selectedCustomer.id,
            paymentMethod,
            usePos,
            cashAmount: paymentType === 'OpenAccount' ? (parseFloat(cashAmount) || 0) : null,
            lines
          })
        }
      )

      if (res?.success === false) {
        setActionError(res.message || 'Satış faturası oluşturulamadı.')
      } else {
        setActionSuccess('Satış başarıyla kaydedildi ve B2B ERP sistemine gönderildi.')
        setSaleModalOpen(false)
        setSaleLines({})
        setSelectedCustomer(null)
        setCustomerSearch('')
        if (selectedWarehouseCode) {
          fetchStock(selectedWarehouseCode)
        }
      }
    } catch (err: any) {
      setActionError(err.message || 'Bir hata oluştu.')
    } finally {
      setActionLoading(false)
    }
  }

  // Load next customer code when new-customer modal opens
  useEffect(() => {
    if (!newCustomerModalOpen) return
    if (newCustomerForm.customerCode) return
    const ac = new AbortController()
    ;(async () => {
      try {
        const res = await apiJson<any>('/api/erp/customers/next-code?customerType=M%C3%BCsteri', { signal: ac.signal })
        const code = String(res?.data?.customerCode ?? res?.customerCode ?? '').trim()
        if (code) setNewCustomerForm(p => ({ ...p, customerCode: code }))
      } catch { /* ignore */ }
    })()
    return () => ac.abort()
  }, [newCustomerModalOpen])

  // Load price groups when new-customer modal opens
  useEffect(() => {
    if (!newCustomerModalOpen) return
    if (priceGroups.length > 0) return
    let active = true
    ;(async () => {
      setPriceGroupsLoading(true)
      try {
        const res = await apiJson<any>('/api/erp/price-groups')
        const list: any[] = res?.data ?? res ?? []
        const groups = Array.isArray(list) ? list : []
        if (!active) return
        setPriceGroups(groups)

        /*
          VARSAYILAN "AÇIK 4" (2026-09-08).

          Grup seçilmeden kaydedilince cari grupsuz açılıyor, sunucudaki
          "grup 4-6 ise ACIK + OpenMain" dönüşümü hiç çalışmıyor ve cari yarım kalıyordu.
          Mağaza sipariş ekranı ile aynı varsayılan: kod 4. Kullanıcı yine değiştirebilir.
        */
        const pg4 = groups.find((x: any) => Number(x?.code ?? 0) === 4)
        if (pg4?.id) {
          setNewCustomerForm((prev) => prev.priceGroupId.trim()
            ? prev
            : { ...prev, priceGroupId: String(pg4.id) })
        }
      } catch { if (active) setPriceGroups([]) }
      finally { if (active) setPriceGroupsLoading(false) }
    })()
    return () => { active = false }
  }, [newCustomerModalOpen])

  const saveNewCustomer = async () => {
    const customerCode = newCustomerForm.customerCode.trim()
    const name = newCustomerForm.name.trim()
    const phone = newCustomerForm.phone.trim()

    if (!name) {
      setNewCustomerError('Ad Soyad / Ünvan zorunludur.')
      return
    }
    if (phone && !isValidPhone(phone)) {
      setNewCustomerError('Telefon 0555 555 5555 formatında olmalıdır.')
      return
    }

    try {
      setNewCustomerSaving(true)
      setNewCustomerError('')

      const payload: Record<string, any> = {
        customerType: 'müşteri',
        invoiceType: 'FATURA',
        isActive: true,
        discountRate: 0,
        // Müşteri carisinin standart limiti 300.000. Sıfır limit, `CreditLimitService`
        // "projected > creditLimit" karşılaştırmasında HER tutarı aşım sayar ve o cariye
        // sipariş açılamaz hale gelir.
        creditLimit: 300000,
        currencyTypeId: 1,
        productCategoryIds: [],
        name,
        phone,
      }
      if (customerCode) payload.customerCode = customerCode
      if (newCustomerForm.taxOffice.trim()) payload.taxOffice = newCustomerForm.taxOffice.trim()
      if (newCustomerForm.taxNumber.trim()) payload.taxNumber = newCustomerForm.taxNumber.trim()
      if (newCustomerForm.priceGroupId.trim()) payload.priceGroupId = newCustomerForm.priceGroupId.trim()
      if (newCustomerForm.city.trim()) payload.city = newCustomerForm.city.trim()
      if (newCustomerForm.district.trim()) payload.district = newCustomerForm.district.trim()
      if (newCustomerForm.address.trim()) payload.address = newCustomerForm.address.trim()

      const res = await apiJson<any>('/api/erp/customers', {
        method: 'POST',
        body: JSON.stringify(payload)
      })

      // Backend may return { data: {...} } or the object directly
      const created = res?.data ?? res
      const resolved = {
        id: created?.customerCode ?? created?.id ?? customerCode,
        customerNumber: created?.customerCode ?? created?.customerNumber ?? customerCode,
        fullName: created?.name ?? name,
        phone: created?.phone ?? phone,
      }

      setSelectedCustomer(resolved)
      setNewCustomerModalOpen(false)
      setNewCustomerForm(emptyNewCustomerForm)
    } catch (err: any) {
      setNewCustomerError(err?.message ?? 'Müşteri oluşturulamadı.')
    } finally {
      setNewCustomerSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#F8F9FA] dark:bg-gray-900 font-outfit" style={{ height: '100%' }}>
      {/* Header */}
      <div className="bg-white text-gray-900 px-6 py-4 flex items-center justify-between flex-shrink-0 border-b border-gray-200 shadow-xs">
        <div>
          <div className="text-xs text-gray-500 mb-0.5">Envanter &rsaquo; Depolar</div>
          <h1 className="text-lg font-bold tracking-tight text-gray-900">Depo Envanter &amp; Satış</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => selectedWarehouseCode && fetchStock(selectedWarehouseCode)}
            disabled={stockLoading || !selectedWarehouseCode}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-700 hover:bg-gray-50 shadow-xs transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-4 h-4 ${stockLoading ? 'animate-spin' : ''}`} /> Güncelle
          </button>
        </div>
      </div>

      {/* Main Layout Container */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        
        {/* Left Side: Warehouses list */}
        {myWarehouses.length > 1 && (
          <div className="w-80 lg:w-96 flex-shrink-0 bg-white flex flex-col overflow-hidden border-r border-gray-200">
            <div className="p-4 flex-shrink-0 border-b border-gray-100">
              <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">Aktif Depolar</div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  value={warehouseQuery}
                  onChange={(e) => setWarehouseQuery(e.target.value)}
                  placeholder="Depo ara..."
                  className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-rose-500 focus:bg-white transition-all"
                />
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
              {myWarehousesLoading ? (
                <div className="text-xs text-gray-400 text-center py-8">Yükleniyor...</div>
              ) : filteredWarehouses.length === 0 ? (
                <div className="text-xs text-gray-400 text-center py-8">
                  {myWarehouses.length === 0
                    ? 'Size atanmış aktif depo yok.'
                    : 'Aramanıza uyan depo yok.'}
                </div>
              ) : (
                filteredWarehouses.map((w) => {
                  const isSelected = selectedWarehouseCode === w.warehouseCode
                  const hasTech = technicians.some(t => t.warehouseCode === w.warehouseCode)
                  return (
                    <button
                      key={w.warehouseCode}
                      onClick={() => setSelectedWarehouseCode(w.warehouseCode)}
                      className={`w-full text-left p-3.5 rounded-xl border transition-all flex flex-col ${
                        isSelected
                          ? 'bg-rose-50/80 border-rose-300 shadow-xs'
                          : 'bg-white border-gray-200 hover:bg-gray-50 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rose-500 to-rose-600 flex items-center justify-center text-white text-xs font-semibold">
                            <Warehouse className="w-4 h-4 text-white" />
                          </div>
                          <div>
                            <div className="text-xs font-bold text-gray-900 leading-tight">{w.name || 'Araç Deposu'}</div>
                            {w.plate && (
                              <div className="text-[10px] font-mono text-gray-500 mt-0.5">{w.plate}</div>
                            )}
                          </div>
                        </div>
                        <span className="bg-blue-50 text-blue-700 text-[10px] font-bold px-2 py-0.5 rounded font-mono border border-blue-200">
                          kod: {w.warehouseCode}
                        </span>
                      </div>

                      {w.driverName && (
                        <div className="text-xs font-semibold text-gray-750 mb-1">
                          Sürücü / Sahip: {w.driverName}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-1 mt-1">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium border ${
                          w.isVehicle
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                        }`}>
                          {w.isVehicle ? 'Araç Deposu' : 'Merkez/Şube Depo'}
                        </span>
                        {hasTech && (
                          <span className="px-1.5 py-0.5 bg-green-50 text-green-705 border border-green-200 rounded text-[9px] font-medium">
                            Teknisyen Atalı
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}

        {/* Right Side: Selected Warehouse Stock view & Actions */}
        <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 flex flex-col min-h-0">
          {!selectedWarehouse ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <Warehouse className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
              {/*
                "DEPO YOK" ile "DEPO SEÇİLMEDİ" AYRI İKİ DURUM.
                Sayfa saha personeli / klima / montaj ekibine de açıldı (kullanıcı kararı,
                2026-08-13). Depo yetkisi olmayan biri girdiğinde eskiden "Depo Seçin" yazıyor,
                sol liste boş duruyordu: kullanıcı sayfanın bozuk olduğunu sanıyordu. Sebebi
                yazmak, "neden boş" sorusunu ortadan kaldırıyor.
              */}
              {!myWarehousesLoading && myWarehouses.length === 0 ? (
                <>
                  <div className="text-lg font-bold text-gray-500">Size Atanmış Depo Yok</div>
                  <div className="text-sm text-gray-400 mt-1 max-w-sm">
                    Bu ekran yalnızca yetkili olduğunuz depoları gösterir. Aracınız/deponuz varsa
                    yöneticinizin kullanıcı kaydınıza depo yetkisi tanımlaması gerekir.
                  </div>
                </>
              ) : (
                <>
                  <div className="text-lg font-bold text-gray-500">Depo Seçin</div>
                  <div className="text-sm text-gray-400 mt-1 max-w-xs">
                    Depo stoklarını incelemek ve satış yapmak için sol listeden bir depo seçin.
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              
              {/* Warehouse Details & Sale Trigger Header */}
              <div className="bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-800 p-5 flex-shrink-0 flex items-center justify-between">
                <div>
                  <h2 className="text-gray-900 dark:text-white font-bold text-base leading-tight">
                    {selectedWarehouse.name || 'Araç Deposu'} {linkedTech ? `(${linkedTech.fullName})` : ''}
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Aktif Depo: <span className="font-semibold text-gray-700 dark:text-gray-300">{selectedWarehouse.name} ({selectedWarehouse.warehouseCode})</span>
                  </p>
                </div>
                
                {/* Para alma BU SAYFADAN KALKTI (kullanıcı kararı, 2026-08-12).
                    Tahsilat artık kendi sayfasında: /tahsilat, kendi yetki anahtarıyla
                    (serviceOps/tahsilat). Burası yalnızca depo envanteri gösteriyor. */}
              </div>

              {/* Feedbacks */}
              {actionSuccess && (
                <div className="m-5 mb-0 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800/30 rounded-xl px-4 py-3 text-xs font-semibold text-green-700 dark:text-green-400 flex items-center gap-2">
                  <Check className="w-4 h-4 flex-shrink-0" />
                  <span>{actionSuccess}</span>
                </div>
              )}
              {actionError && (
                <div className="m-5 mb-0 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/30 rounded-xl px-4 py-3 text-xs font-semibold text-red-600 dark:text-red-400 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}

              {/* Stats Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 px-5 pt-5 flex-shrink-0">
                <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-100 dark:border-gray-800 shadow-sm flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-red-50 dark:bg-red-950/20 flex items-center justify-center text-[#B91C1C] flex-shrink-0">
                    <Warehouse className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Toplam Çeşit</div>
                    <div className="text-sm font-extrabold text-gray-900 dark:text-white mt-0.5 truncate">{stockItems.length} Kalem</div>
                  </div>
                </div>

                {/* Kasa / Banka / POS Hesabı kartları KALDIRILDI (kullanıcı kararı, 2026-08-12).
                    Üçü de depoya bağlı TEKNİSYENİN hesaplarını gösteriyordu; Merkez/Şube
                    deposunda bağlı teknisyen olmadığı için hep "Atanmamış" yazıyordu.
                    Sayfada yapılan tek işlem artık bayideki kredi kartı çekimi — para POS'a
                    gidiyor, kasa/banka hesabının burada bir karşılığı yok. */}
              </div>

              {/* Inventory Table Container */}
              <div className="px-5 pb-5 pt-3 flex-1 flex flex-col overflow-hidden min-h-0">
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden flex flex-col flex-1">
                  
                  {/* Table search bar */}
                  <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between flex-shrink-0 gap-4">
                    <h3 className="font-bold text-gray-900 dark:text-white text-sm">Araçtaki Ürün ve Malzemeler</h3>
                    <div className="relative w-64">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                      <input
                        value={stockQuery}
                        onChange={(e) => setStockQuery(e.target.value)}
                        placeholder="Malzeme veya kod ara..."
                        className="w-full pl-9 pr-3 py-1.5 bg-gray-50 border border-gray-200 dark:bg-gray-700/50 dark:border-gray-700 rounded-lg text-xs text-gray-955 dark:text-white focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Table area */}
                  <div className="flex-1 overflow-y-auto min-h-0">
                    {stockLoading ? (
                      <div className="text-center py-12 text-sm text-gray-500">Yükleniyor...</div>
                    ) : filteredStocks.length === 0 ? (
                      <div className="text-center py-12 text-sm text-gray-400">Araca yüklenmiş malzeme bulunamadı.</div>
                    ) : (
                      <Table
                        columns={stockColumns}
                        data={filteredStocks}
                        showColumnFilters={false}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sale Form Modal Overlay */}
      {saleModalOpen && selectedWarehouse && (
        <>
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={() => setSaleModalOpen(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-3xl bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col border border-gray-100 dark:border-gray-800">
              
              {/* Modal Header */}
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between flex-shrink-0 bg-gray-50 dark:bg-gray-900/50">
                <div className="flex items-center gap-2">
                  <Coins className="w-5 h-5 text-emerald-600" />
                  <div>
                    <h3 className="text-base font-bold text-gray-900 dark:text-white">Araç Deposundan Doğrudan Satış</h3>
                    <p className="text-xs text-gray-500 mt-0.5">Depo: {selectedWarehouse.name || 'Araç Deposu'} ({selectedWarehouse.warehouseCode})</p>
                  </div>
                </div>
                <button
                  onClick={() => setSaleModalOpen(false)}
                  className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6 overflow-y-auto flex-1 space-y-5">
                
                {/* 1. Customer Selection Autocomplete */}
                <div className="bg-gray-50 dark:bg-gray-900/30 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">1. Cari / Müşteri Seçimi</label>
                    {!selectedCustomer && (
                      <button
                        type="button"
                        onClick={() => {
                          setNewCustomerError('')
                          setNewCustomerForm(emptyNewCustomerForm)
                          setNewCustomerModalOpen(true)
                        }}
                        className="text-xs font-bold text-rose-500 hover:text-rose-400 transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" /> Yeni Müşteri Ekle
                      </button>
                    )}
                  </div>

                  {!selectedCustomer ? (
                    <div className="flex flex-col gap-2">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                          value={customerSearch}
                          onChange={(e) => setCustomerSearch(e.target.value)}
                          placeholder="Müşteri adı, kodu veya telefon ara..."
                          className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none"
                        />
                      </div>
                      
                      {customersLoading ? (
                        <div className="text-xs text-gray-400 mt-1 italic flex items-center gap-1.5 px-1 py-1">
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Müşteriler yükleniyor...
                        </div>
                      ) : customers.length > 0 ? (
                        <div className="max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg shadow-inner divide-y divide-gray-100 dark:divide-gray-700/60 mt-1">
                          {customers.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => setSelectedCustomer(c)}
                              className="w-full text-left p-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex flex-col"
                            >
                              <span className="font-semibold text-sm text-gray-900 dark:text-white">{c.fullName}</span>
                              <span className="text-xs text-gray-400 mt-0.5 font-mono">Kod: {c.customerNumber || c.id} • {c.phone || 'Telefon Yok'}</span>
                            </button>
                          ))}
                        </div>
                      ) : customerSearch.trim().length > 1 ? (
                        <div className="text-xs text-gray-400 mt-1 italic px-1 py-1">Müşteri bulunamadı.</div>
                      ) : (
                        <div className="text-xs text-gray-400 mt-1 italic px-1 py-1">Aramak için en az 2 karakter girin.</div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between bg-white dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                      <div>
                        <div className="font-bold text-sm text-gray-900 dark:text-white">{selectedCustomer.fullName}</div>
                        <div className="text-xs text-gray-400 mt-0.5">Kod: {selectedCustomer.customerNumber || selectedCustomer.id}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCustomer(null)
                          setCustomerSearch('')
                        }}
                        className="px-2.5 py-1 border border-gray-200 dark:border-gray-700 rounded text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                      >
                        Cari Değiştir
                      </button>
                    </div>
                  )}
                </div>

                {/* 2. Stock Selection & Quantities */}
                <div className="bg-gray-50 dark:bg-gray-900/30 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">2. Satılacak Malzemeler ve Miktarlar</label>
                  
                  <div className="space-y-3 mt-3 max-h-60 overflow-y-auto pr-1">
                    {stockItems.filter(i => (i.quantity ?? 0) > 0).length === 0 ? (
                      <div className="text-xs text-gray-400 text-center py-6 italic">Aracınızda satılabilir stok bulunmamaktadır.</div>
                    ) : (
                      stockItems.filter(i => (i.quantity ?? 0) > 0).map((item) => {
                        const maxQty = item.quantity ?? 0
                        const currentQty = saleLines[item.productId] ?? 0
                        const priceInfo = calculatedPrices[item.productId]

                        return (
                          <div key={item.id} className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-750">
                            <div className="flex-1 min-w-0 pr-4">
                              <div className="font-semibold text-sm text-gray-950 dark:text-white truncate">{item.name}</div>
                              <div className="text-xs text-gray-400 mt-0.5">Kod: {item.partNumber} | Araç Stok: <span className="font-bold text-gray-700 dark:text-gray-300">{maxQty}</span></div>
                              
                              {selectedCustomer && pricingLoading && (
                                <div className="text-[10px] text-gray-400 italic mt-1.5 flex items-center gap-1">
                                  <RefreshCw className="w-3 h-3 animate-spin" /> Fiyat hesaplanıyor...
                                </div>
                              )}
                              
                              {selectedCustomer && !pricingLoading && priceInfo && (
                                <div className="mt-1.5 flex flex-col gap-0.5">
                                  <div className="text-xs text-gray-600 dark:text-gray-400 font-medium">
                                    Birim Fiyat: {priceInfo.currency !== 'TRY' ? `${priceInfo.unitPrice.toFixed(2)} ${priceInfo.currency} (${priceInfo.unitPriceTry.toFixed(2)} ₺)` : `${priceInfo.unitPriceTry.toFixed(2)} ₺`}
                                    {priceInfo.taxRate > 0 ? ` + %${priceInfo.taxRate} KDV` : ''}
                                  </div>
                                  {currentQty > 0 && (
                                    <div className="text-xs text-emerald-600 dark:text-emerald-400 font-bold">
                                      Tutar: {(priceInfo.unitPriceTry * currentQty).toFixed(2)} ₺
                                    </div>
                                  )}
                                </div>
                              )}

                              {selectedCustomer && !pricingLoading && !priceInfo && (
                                <div className="text-xs text-red-650 mt-1.5 flex items-center gap-1 font-medium">
                                  <AlertTriangle className="w-3.5 h-3.5" /> Fiyat bulunamadı
                                </div>
                              )}
                            </div>

                            {/* Quantity buttons */}
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  if (currentQty > 0) {
                                    setSaleLines({ ...saleLines, [item.productId]: currentQty - 1 })
                                  }
                                }}
                                className="w-7 h-7 rounded bg-gray-105 dark:bg-gray-700 flex items-center justify-center font-bold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 cursor-pointer"
                              >
                                -
                              </button>
                              <span className="w-8 text-center text-sm font-bold text-gray-900 dark:text-white">{currentQty}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  if (currentQty < maxQty) {
                                    setSaleLines({ ...saleLines, [item.productId]: currentQty + 1 })
                                  }
                                }}
                                className="w-7 h-7 rounded bg-gray-105 dark:bg-gray-700 flex items-center justify-center font-bold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 cursor-pointer"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>

                {/* 3. Payment Method Choice */}
                <div className="bg-gray-50 dark:bg-gray-900/30 p-4 rounded-xl border border-gray-100 dark:border-gray-800 space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">3. Ödeme Tipi</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
                      {[
                        { key: 'Cash', label: 'Nakit Kasa' },
                        { key: 'POS', label: 'Sanal POS' },
                        { key: 'Transfer', label: 'Banka Havalesi' },
                        { key: 'OpenAccount', label: 'Açık Hesap (Cari)' }
                      ].map((p) => {
                        const isSel = paymentType === p.key
                        return (
                          <button
                            key={p.key}
                            type="button"
                            onClick={() => {
                              setPaymentType(p.key as any)
                              if (p.key !== 'OpenAccount') {
                                setCashAmount('0')
                              }
                            }}
                            className={`py-3 px-2 rounded-xl text-xs font-bold border transition-all flex flex-col items-center justify-center gap-1.5 cursor-pointer ${
                              isSel
                                ? 'bg-emerald-50 border-emerald-500 text-emerald-800 dark:bg-emerald-950/20 dark:border-emerald-700 dark:text-emerald-300 shadow-sm'
                                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50'
                            }`}
                          >
                            {p.key === 'Cash' && <Coins className="w-4 h-4 text-emerald-600" />}
                            {p.key === 'POS' && <CreditCard className="w-4 h-4 text-blue-500" />}
                            {p.key === 'Transfer' && <CreditCard className="w-4 h-4 text-amber-500" />}
                            {p.key === 'OpenAccount' && <User className="w-4 h-4 text-purple-500" />}
                            <span>{p.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {paymentType === 'OpenAccount' && (
                    <div className="bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 p-4 rounded-xl space-y-3 animate-fadeIn">
                      <div className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Coins className="w-4 h-4" /> Bakkal Hesabı (Açık Hesap) Tahsilatı
                      </div>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        Bu işlemde müşteriden o anda yapılan nakit tahsilatı "Kasadan Ödenen" kısmına girin. Kalan bakiye Açık Hesap borcu olarak cariye yazılacaktır.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase">Kasadan Ödenen (Nakit)</label>
                          <div className="relative">
                            <input
                              type="number"
                              min="0"
                              max={invoiceSummary.grandTotal}
                              step="0.01"
                              value={cashAmount}
                              onChange={(e) => {
                                const val = e.target.value
                                const numericVal = parseFloat(val) || 0
                                if (numericVal > invoiceSummary.grandTotal) {
                                  setCashAmount(invoiceSummary.grandTotal.toString())
                                } else {
                                  setCashAmount(val)
                                }
                              }}
                              placeholder="0.00"
                              className="w-full pl-3 pr-8 py-2 bg-white dark:bg-gray-900 border border-gray-250 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:border-amber-500 font-mono"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 font-mono">₺</span>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase">Bakkal Hesabı ile Aldı (Cari Borç)</label>
                          <div className="relative">
                            <input
                              type="text"
                              readOnly
                              value={Math.max(0, invoiceSummary.grandTotal - (parseFloat(cashAmount) || 0)).toFixed(2)}
                              className="w-full pl-3 pr-8 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-amber-600 dark:text-amber-400 font-bold font-mono focus:outline-none"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 font-mono">₺</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Footer (with live calculations summary and submit) */}
              <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex-shrink-0 bg-gray-50 dark:bg-gray-900/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                
                {/* Dashed green live invoice summary */}
                <div className="flex-1">
                  {selectedCustomer && hasSelectedItems && (
                    <div className="border border-dashed border-emerald-500/80 bg-emerald-50/20 dark:bg-emerald-950/10 p-3.5 rounded-xl space-y-1 max-w-sm">
                      <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
                        <span>Ara Toplam:</span>
                        <span className="font-semibold text-gray-900 dark:text-white">{invoiceSummary.subtotal.toFixed(2)} ₺</span>
                      </div>
                      <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
                        <span>KDV Toplamı:</span>
                        <span className="font-semibold text-gray-900 dark:text-white">{invoiceSummary.vatTotal.toFixed(2)} ₺</span>
                      </div>
                      <div className="flex justify-between text-sm text-emerald-800 dark:text-emerald-400 font-bold pt-1 border-t border-emerald-500/10">
                        <span>Genel Toplam:</span>
                        <span>{invoiceSummary.grandTotal.toFixed(2)} ₺</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setSaleModalOpen(false)}
                    className="px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateSale}
                    disabled={!canSubmit}
                    className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 text-white rounded-lg text-sm font-bold hover:bg-emerald-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {actionLoading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" /> İşleniyor...
                      </>
                    ) : pricingLoading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" /> Fiyatlar Alınıyor...
                      </>
                    ) : (
                      <>
                        Satışı Kaydet ve ERP'ye Gönder <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ===== New Customer Modal ===== */}
      {newCustomerModalOpen && (
        <>
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60]" onClick={() => { if (!newCustomerSaving) { setNewCustomerModalOpen(false); setNewCustomerError('') } }} />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="w-full max-w-lg bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col border border-gray-100 dark:border-gray-700">
              {/* Modal Header */}
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between flex-shrink-0 bg-gray-50 dark:bg-gray-900/50">
                <div className="flex items-center gap-2">
                  <User className="w-5 h-5 text-rose-600" />
                  <h3 className="text-base font-bold text-gray-900 dark:text-white">Yeni Müşteri Ekle</h3>
                </div>
                <button
                  type="button"
                  disabled={newCustomerSaving}
                  onClick={() => { setNewCustomerModalOpen(false); setNewCustomerError('') }}
                  className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-white disabled:opacity-40"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6 overflow-y-auto flex-1 space-y-4">
                {newCustomerError && (
                  <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/30 rounded-lg px-4 py-3 text-xs font-semibold text-red-600 dark:text-red-400 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    {newCustomerError}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Cari Kodu */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Cari Kodu</label>
                    <input
                      value={newCustomerForm.customerCode}
                      disabled
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                      placeholder="Otomatik atanıyor..."
                    />
                  </div>

                  {/* İsim-Soyisim */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">İsim-Soyisim / Ünvan *</label>
                    <input
                      value={newCustomerForm.name}
                      onChange={(e) => setNewCustomerForm(p => ({ ...p, name: e.target.value }))}
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500"
                      placeholder="Ali Yılmaz"
                    />
                  </div>

                  {/* Telefon */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Telefon *</label>
                    <input
                      value={newCustomerForm.phone}
                      onChange={(e) => setNewCustomerForm(p => ({ ...p, phone: formatPhoneNumber(e.target.value) }))}
                      inputMode="numeric"
                      maxLength={15}
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500"
                      placeholder="0555 555 5555"
                    />
                  </div>

                  {/* Vergi Dairesi */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Vergi Dairesi</label>
                    <input
                      value={newCustomerForm.taxOffice}
                      onChange={(e) => setNewCustomerForm(p => ({ ...p, taxOffice: e.target.value }))}
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500"
                      placeholder="Çankaya"
                    />
                  </div>

                  {/* Vergi No */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Vergi No</label>
                    <input
                      value={newCustomerForm.taxNumber}
                      onChange={(e) => setNewCustomerForm(p => ({ ...p, taxNumber: e.target.value }))}
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500"
                      placeholder="123456789"
                    />
                  </div>

                  {/* Fiyat Grubu */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Fiyat Grubu</label>
                    <select
                      value={newCustomerForm.priceGroupId}
                      onChange={(e) => setNewCustomerForm(p => ({ ...p, priceGroupId: e.target.value }))}
                      disabled={priceGroupsLoading}
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500 disabled:opacity-60"
                    >
                      <option value="">{priceGroupsLoading ? 'Yükleniyor...' : 'Seçiniz'}</option>
                      {priceGroups.map((pg: any) => (
                        <option key={pg.id} value={String(pg.id)}>{pg.code} - {pg.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* İl */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">İl</label>
                    <input
                      value={newCustomerForm.city}
                      onChange={(e) => setNewCustomerForm(p => ({ ...p, city: e.target.value }))}
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500"
                      placeholder="Lefkoşa"
                    />
                  </div>

                  {/* İlçe */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">İlçe</label>
                    <input
                      value={newCustomerForm.district}
                      onChange={(e) => setNewCustomerForm(p => ({ ...p, district: e.target.value }))}
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500"
                      placeholder="Gönyeli"
                    />
                  </div>
                </div>

                {/* Adres */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Açık Adres</label>
                  <textarea
                    rows={3}
                    value={newCustomerForm.address}
                    onChange={(e) => setNewCustomerForm(p => ({ ...p, address: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500 resize-none"
                    placeholder="Adres detayları..."
                  />
                </div>
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-700 flex items-center justify-end gap-3 flex-shrink-0 bg-gray-50 dark:bg-gray-900/50">
                <button
                  type="button"
                  disabled={newCustomerSaving}
                  onClick={() => { setNewCustomerModalOpen(false); setNewCustomerError('') }}
                  className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  disabled={newCustomerSaving}
                  onClick={() => void saveNewCustomer()}
                  className="px-5 py-2 rounded-lg bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 disabled:opacity-40 flex items-center gap-2"
                >
                  {newCustomerSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
                  {newCustomerSaving ? 'Kaydediliyor...' : 'Kaydet'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
