import React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { formatPhoneNumber } from '../utils/phone'
import Table, { type TableColumn } from '../components/Table'
import Modal from '../components/Modal'
import FormSelect from '../components/forms/FormSelect'
import FormInput from '../components/forms/FormInput'
import { ShieldCheck, Plus, Clock, Info, ShieldAlert, CheckCircle, AlertCircle, RefreshCw, User } from 'lucide-react'
import {
  fetchWarranties,
  fetchWarrantyById,
  createWarranty,
  updateWarrantyStatus,
  fetchWarrantyKpis,
  fetchWarrantyProductPrice,
  fetchNextSerialNoPreview,
  warrantyCurrencySymbol,
  type WarrantyRecord,
  type WarrantyHistory,
  type WarrantyKpis
} from '../api/warranty'
import { fetchDealers, fetchEndCustomers, createEndCustomer, fetchNextCustomerCode, type CustomerDto } from '../api/customers'
import { fetchPriceGroups, type PriceGroupDto } from '../api/priceGroups'
import { fetchSalesmenDropdown, type SalesmanDropdownItem } from '../api/salesmen'
import { fetchProducts } from '../api/products'
import { type Product } from '../types/Product'

/**
 * Tutarı KENDİ para biriminin simgesiyle yazar.
 *
 * Önceden simge sabit "₺" idi: ürünün satış fiyatı dolar olsa bile garanti kaydı TL
 * görünüyordu. Simge artık kaydın `currencyTypeId` alanından geliyor; alan boşsa (eski
 * kayıtlar) yine ₺ çıkar, davranış değişmez.
 */
function formatMoney(n: number, currencyTypeId?: number | null) {
  const v = Number(n ?? 0)
  const symbol = warrantyCurrencySymbol(currencyTypeId)
  return `${symbol}${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function WarrantyReport() {
  const [data, setData] = useState<WarrantyRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [kpis, setKpis] = useState<WarrantyKpis | null>(null)

  // Filters
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // Modals state
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [addCustomerModalOpen, setAddCustomerModalOpen] = useState(false)

  // Selected warranty for details
  const [selectedWarranty, setSelectedWarranty] = useState<WarrantyRecord | null>(null)
  const [warrantyHistories, setWarrantyHistories] = useState<WarrantyHistory[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  // Dropdown lists
  const [dealers, setDealers] = useState<CustomerDto[]>([])
  const [endCustomers, setEndCustomers] = useState<CustomerDto[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [priceGroups, setPriceGroups] = useState<PriceGroupDto[]>([])
  const [salesmen, setSalesmen] = useState<SalesmanDropdownItem[]>([])

  // Create form state
  const [customerType, setCustomerType] = useState<'cari' | 'müşteri'>('cari')
  const [selectedCustomerCode, setSelectedCustomerCode] = useState('')
  const [selectedProductCode, setSelectedProductCode] = useState('')
  const [transactionType, setTransactionType] = useState('GARANTİ')
  const [serialNo, setSerialNo] = useState('')
  const [previewSerialNo, setPreviewSerialNo] = useState('')
  const [brandModel, setBrandModel] = useState('')
  const [faultDescription, setFaultDescription] = useState('')
  const [warrantyPeriod, setWarrantyPeriod] = useState(36)
  const [salesmanCode, setSalesmanCode] = useState('')

  // Financial fields
  const [quantity, setQuantity] = useState(1)
  const [grossAmount, setGrossAmount] = useState(0)
  const [discountAmount, setDiscountAmount] = useState(0)
  const [vatRate, setVatRate] = useState(0)
  const [netAmount, setNetAmount] = useState(0)
  const [vatAmount, setVatAmount] = useState(0)
  const [totalAmount, setTotalAmount] = useState(0)
  const [priceResolving, setPriceResolving] = useState(false)
  // Tutarların para birimi. Kullanıcı seçmiyor: ürünün satış fiyatı hangi paradaysa o.
  // Elle seçtirmek, fiyatla tutarın farklı para birimlerinde olmasına izin verirdi.
  const [currencyTypeId, setCurrencyTypeId] = useState(1)

  // Add customer form state
  const [newCustomerCode, setNewCustomerCode] = useState('')
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newCustomerPhone, setNewCustomerPhone] = useState('')
  const [newCustomerTaxOffice, setNewCustomerTaxOffice] = useState('')
  const [newCustomerTaxNumber, setNewCustomerTaxNumber] = useState('')
  const [newCustomerPriceGroupId, setNewCustomerPriceGroupId] = useState('')
  const [newCustomerCity, setNewCustomerCity] = useState('')
  const [newCustomerDistrict, setNewCustomerDistrict] = useState('')
  const [newCustomerAddress, setNewCustomerAddress] = useState('')
  const [customerSaving, setCustomerSaving] = useState(false)

  // Update status state
  const [newStatus, setNewStatus] = useState('')
  const [statusDescription, setStatusDescription] = useState('')
  const [statusUpdating, setStatusUpdating] = useState(false)

  const loadData = async () => {
    try {
      setLoading(true)
      setError(null)
      const list = await fetchWarranties({
        search: searchQuery,
        status: statusFilter,
        startDate: startDate || undefined,
        endDate: endDate || undefined
      })
      setData(list)
      const kpiData = await fetchWarrantyKpis()
      setKpis(kpiData)
    } catch (e: any) {
      setError(e.message || 'Veriler yüklenirken hata oluştu.')
    } finally {
      setLoading(false)
    }
  }

  // Load dropdown lists once
  const loadDropdowns = async () => {
    try {
      const [dlrs, custs, prods, pgs, sls] = await Promise.all([
        fetchDealers({ type: 'bayi' }),
        fetchEndCustomers(),
        fetchProducts({ page: 1, pageSize: 1000 }),
        fetchPriceGroups(),
        fetchSalesmenDropdown()
      ])
      setDealers(dlrs)
      setEndCustomers(custs)
      setProducts(prods.items || [])
      setPriceGroups(pgs)
      setSalesmen(sls)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Dropdown verileri yüklenirken hata:', e)
    }
  }

  useEffect(() => {
    loadData()
    loadDropdowns()
  }, [])

  const handleOpenCreateModal = () => {
    setCreateModalOpen(true)
  }

  // Fetch next serial number when customer is selected
  useEffect(() => {
    if (!selectedCustomerCode) {
      setPreviewSerialNo('')
      return
    }

    const fetchSerial = async () => {
      try {
        const nextSerial = await fetchNextSerialNoPreview()
        setPreviewSerialNo(nextSerial)
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error('Sıradaki seri no alınamadı:', e)
        alert('Seri no yüklenirken hata oluştu (Lütfen backend sunucusunu yeniden başlatıp tekrar deneyin): ' + e.message)
      }
    }

    fetchSerial()
  }, [selectedCustomerCode])

  // Handle dynamic pricing lookup when customer or product changes
  useEffect(() => {
    if (!selectedCustomerCode || !selectedProductCode) return

    const lookupPrice = async () => {
      try {
        setPriceResolving(true)
        const priceInfo = await fetchWarrantyProductPrice(selectedCustomerCode, selectedProductCode)
        setCurrencyTypeId(priceInfo.currencyTypeId)
        const gross = priceInfo.price * quantity
        setGrossAmount(gross)
        const net = Math.max(0, gross - discountAmount)
        setNetAmount(net)
        const vat = net * (vatRate / 100)
        setVatAmount(vat)
        setTotalAmount(net + vat)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Fiyat yüklenirken hata:', e)
      } finally {
        setPriceResolving(false)
      }
    }

    lookupPrice()
  }, [selectedCustomerCode, selectedProductCode, quantity, discountAmount, vatRate])

  // Recalculate net, vat and total when amounts are edited manually
  const handleGrossChange = (val: number) => {
    setGrossAmount(val)
    const net = Math.max(0, val - discountAmount)
    setNetAmount(net)
    const vat = net * (vatRate / 100)
    setVatAmount(vat)
    setTotalAmount(net + vat)
  }

  const handleDiscountChange = (val: number) => {
    setDiscountAmount(val)
    const net = Math.max(0, grossAmount - val)
    setNetAmount(net)
    const vat = net * (vatRate / 100)
    setVatAmount(vat)
    setTotalAmount(net + vat)
  }

  const handleVatRateChange = (val: number) => {
    setVatRate(val)
    const vat = netAmount * (val / 100)
    setVatAmount(vat)
    setTotalAmount(netAmount + vat)
  }

  // Row click -> Detail Modal
  const handleRowClick = async (row: WarrantyRecord) => {
    try {
      setDetailLoading(true)
      setSelectedWarranty(row)
      setDetailModalOpen(true)
      const detail = await fetchWarrantyById(row.id)
      setSelectedWarranty(detail.data)
      setWarrantyHistories(detail.histories || [])
      setNewStatus(detail.data.status)
      setStatusDescription('')
    } catch (e: any) {
      alert(e.message || 'Detaylar yüklenirken hata oluştu.')
    } finally {
      setDetailLoading(false)
    }
  }

  // Create warranty submit
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedCustomerCode) return alert('Lütfen bir Cari/Müşteri seçin.')
    if (!selectedProductCode) return alert('Lütfen bir ürün seçin.')

    try {
      setLoading(true)
      await createWarranty({
        transactionType,
        customerCode: selectedCustomerCode,
        productCode: selectedProductCode,
        serialNo: serialNo || undefined,
        brandModel: brandModel || undefined,
        faultDescription: faultDescription || undefined,
        warrantyPeriodMonths: warrantyPeriod,
        grossAmount,
        discountAmount,
        netAmount,
        vatAmount,
        totalAmount,
        // Kur gönderilmiyor: backend TL değilse günün kurunu kendisi çeker.
        currencyTypeId,
        salesmanCode: salesmanCode || undefined
      })
      setCreateModalOpen(false)
      // Reset state
      setSelectedCustomerCode('')
      setSelectedProductCode('')
      setSerialNo('')
      setBrandModel('')
      setFaultDescription('')
      setGrossAmount(0)
      setDiscountAmount(0)
      setNetAmount(0)
      setVatAmount(0)
      setTotalAmount(0)
      setQuantity(1)
      setVatRate(0)
      setWarrantyPeriod(36)
      setPreviewSerialNo('')

      loadData()
    } catch (e: any) {
      alert(e.message || 'Garanti kaydı oluşturulamadı.')
    } finally {
      setLoading(false)
    }
  }

  // Update status submit
  const handleStatusUpdateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedWarranty || !newStatus) return

    try {
      setStatusUpdating(true)
      await updateWarrantyStatus(selectedWarranty.id, {
        status: newStatus,
        description: statusDescription || undefined
      })
      // Reload details to get new history
      const detail = await fetchWarrantyById(selectedWarranty.id)
      setSelectedWarranty(detail.data)
      setWarrantyHistories(detail.histories || [])
      setStatusDescription('')
      loadData()
    } catch (e: any) {
      alert(e.message || 'Durum güncellenemedi.')
    } finally {
      setStatusUpdating(false)
    }
  }

  // Open add customer sub-modal
  const handleOpenAddCustomer = async () => {
    try {
      setAddCustomerModalOpen(true)
      const nextCode = await fetchNextCustomerCode('müşteri')
      setNewCustomerCode(nextCode)
      setNewCustomerName('')
      setNewCustomerPhone('')
      setNewCustomerTaxOffice('')
      setNewCustomerTaxNumber('')
      setNewCustomerPriceGroupId('')
      setNewCustomerCity('')
      setNewCustomerDistrict('')
      setNewCustomerAddress('')
    } catch (e: any) {
      alert(e.message || 'Müşteri kodu alınamadı.')
    }
  }

  // Add customer submit
  const handleAddCustomerSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newCustomerName) return alert('Müşteri adı boş olamaz.')

    try {
      setCustomerSaving(true)
      const created = await createEndCustomer({
        customerCode: newCustomerCode,
        name: newCustomerName,
        phone: newCustomerPhone,
        address: newCustomerAddress,
        city: newCustomerCity,
        district: newCustomerDistrict,
        taxOffice: newCustomerTaxOffice,
        taxNumber: newCustomerTaxNumber,
        priceGroupId: newCustomerPriceGroupId
      })

      // Add to list and select it
      setEndCustomers(prev => [...prev, created])
      setCustomerType('müşteri')
      setSelectedCustomerCode(created.customerCode)
      setAddCustomerModalOpen(false)
    } catch (e: any) {
      alert(e.message || 'Müşteri kaydedilemedi.')
    } finally {
      setCustomerSaving(false)
    }
  }

  const columns: TableColumn<WarrantyRecord>[] = useMemo(() => [
    {
      key: 'warrantyNo',
      label: 'Garanti No',
      searchable: true,
      render: (v) => <span className="font-bold text-blue-600 hover:underline">{v}</span>
    },
    {
      key: 'transactionType',
      label: 'İşlem Tipi',
      searchable: true,
      render: (v) => (
        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
          v === 'DEĞİŞİM' ? 'bg-purple-50 text-purple-700 border border-purple-100' :
          v === 'SERVİS GARANTİ' ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' :
          'bg-sky-50 text-sky-700 border border-sky-100'
        }`}>
          {v}
        </span>
      )
    },
    {
      key: 'recordDate',
      label: 'Tarih',
      render: (v) => v ? new Date(v as string).toLocaleDateString('tr-TR') : ''
    },
    {
      key: 'customerName',
      label: 'Cari / Müşteri',
      searchable: true
    },
    {
      key: 'productName',
      label: 'Ürün Adı',
      searchable: true
    },
    {
      key: 'status',
      label: 'Fatura/Açık (Durum)',
      searchable: true,
      render: (v) => {
        const s = String(v ?? 'AÇIK')
        let cls = 'bg-gray-100 text-gray-800'
        if (s === 'AÇIK') cls = 'bg-blue-50 text-blue-700 border border-blue-100'
        else if (s === 'SERVİSTE') cls = 'bg-amber-50 text-amber-700 border border-amber-100'
        else if (s === 'BEKLEMEDE') cls = 'bg-orange-50 text-orange-700 border border-orange-100'
        else if (s === 'TAMAMLANDI') cls = 'bg-green-50 text-green-700 border border-green-100'
        else if (s === 'DEĞİŞİM YAPILDI') cls = 'bg-purple-50 text-purple-700 border border-purple-100'
        else if (s === 'İPTAL') cls = 'bg-red-50 text-red-700 border border-red-100'
        return <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${cls}`}>{s}</span>
      }
    },
    // Her tutar SATIRIN kendi para biriminde. İkinci argüman verilmezse hepsi ₺ çıkar —
    // listede dolarlı ve TL'li kayıtlar yan yana durduğu için hata gözle görülmezdi.
    {
      key: 'grossAmount',
      label: 'Brüt Tutar',
      render: (v, r) => formatMoney(v as number, r.currencyTypeId)
    },
    {
      key: 'discountAmount',
      label: 'İskonto',
      render: (v, r) => formatMoney(v as number, r.currencyTypeId)
    },
    {
      key: 'netAmount',
      label: 'Net Tutar',
      render: (v, r) => formatMoney(v as number, r.currencyTypeId)
    },
    {
      key: 'vatAmount',
      label: 'KDV Tutarı',
      render: (v, r) => formatMoney(v as number, r.currencyTypeId)
    },
    {
      key: 'totalAmount',
      label: 'Genel Toplam',
      render: (v, r) => formatMoney(v as number, r.currencyTypeId)
    },
    {
      key: 'salesmanCode',
      label: 'Plasiyer',
      render: (v) => v || '-'
    },
    {
      key: 'createdByUserName',
      label: 'İşlem Yapan'
    }
  ], [])

  return (
    <div className="p-1 space-y-6">
      {/* Title */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Garanti Takip Raporları</h2>
          <p className="text-xs text-gray-400">Garanti, servis ve değişim kayıtlarının finansal ve operasyonel takibi</p>
        </div>
        <button
          onClick={handleOpenCreateModal}
          className="flex items-center space-x-1.5 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-sm font-semibold text-xs"
        >
          <Plus className="w-4 h-4" />
          <span>Yeni Garanti Kaydı</span>
        </button>
      </div>

      {/* KPI summaries */}
      {kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-6">
          <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-center space-x-3 hover:shadow-md transition-shadow">
            <div className="p-2.5 bg-blue-50 text-blue-600 rounded-lg">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Toplam Garanti</p>
              <h4 className="text-lg font-bold text-gray-800">{kpis.totalCount}</h4>
            </div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-center space-x-3 hover:shadow-md transition-shadow">
            <div className="p-2.5 bg-red-50 text-red-600 rounded-lg">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Açık Kayıt</p>
              <h4 className="text-lg font-bold text-gray-800">{kpis.openCount}</h4>
            </div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-center space-x-3 hover:shadow-md transition-shadow">
            <div className="p-2.5 bg-amber-50 text-amber-600 rounded-lg">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Servistekiler</p>
              <h4 className="text-lg font-bold text-gray-800">{kpis.inServiceCount}</h4>
            </div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-center space-x-3 hover:shadow-md transition-shadow">
            <div className="p-2.5 bg-green-50 text-green-600 rounded-lg">
              <CheckCircle className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Tamamlananlar</p>
              <h4 className="text-lg font-bold text-gray-800">{kpis.completedCount}</h4>
            </div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-center space-x-3 hover:shadow-md transition-shadow">
            <div className="p-2.5 bg-purple-50 text-purple-600 rounded-lg">
              <RefreshCw className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Değişen Ürünler</p>
              <h4 className="text-lg font-bold text-gray-800">{kpis.changedProductCount}</h4>
            </div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-center space-x-3 hover:shadow-md transition-shadow">
            <div className="p-2.5 bg-teal-50 text-teal-600 rounded-lg">
              <Info className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Ort. Çözüm Süresi</p>
              <h4 className="text-lg font-bold text-gray-800">{kpis.averageResolutionDays} Gün</h4>
            </div>
          </div>
        </div>
      )}

      {/* Filter form */}
      <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <FormInput
            label="Arama (No, Cari, Ürün, Seri No)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Ara..."
          />
          <FormSelect
            label="Durum"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            options={[
              { value: '', label: 'Tümü' },
              { value: 'AÇIK', label: 'Açık' },
              { value: 'SERVİSTE', label: 'Serviste' },
              { value: 'BEKLEMEDE', label: 'Beklemede' },
              { value: 'TAMAMLANDI', label: 'Tamamlandı' },
              { value: 'DEĞİŞİM YAPILDI', label: 'Değişim Yapıldı' },
              { value: 'İPTAL', label: 'İptal' }
            ]}
          />
          <FormInput
            type="date"
            label="Başlangıç Tarihi"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <FormInput
            type="date"
            label="Bitiş Tarihi"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
          <div className="flex items-end space-x-2">
            <button
              onClick={loadData}
              disabled={loading}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-xs transition-colors"
            >
              {loading ? 'Yükleniyor...' : 'Raporla'}
            </button>
          </div>
        </div>
      </div>

      {/* Error alert */}
      {error && (
        <div className="p-3 bg-red-50 text-red-700 border border-red-100 rounded-lg text-xs font-semibold flex items-center space-x-2">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}

      {/* Table grid */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto min-w-full">
          <Table
          onRefresh={() => void loadData()}
            columns={columns}
            data={data}
            showColumnFilters
            onRowClick={handleRowClick}
            rowClassName={() => "cursor-pointer hover:bg-slate-50 transition-colors"}
            rowKey={(r) => r.id}
          />
        </div>
      </div>

      {/* 1. CREATE WARRANTY RECORD MODAL */}
      <Modal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Yeni Garanti / Servis Kaydı Ekle"
        containerClassName="max-w-4xl max-h-[90vh]"
      >
        <form onSubmit={handleCreateSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-50 p-3 rounded-lg border border-slate-100">
            <div>
              <label className="block text-gray-500 font-medium mb-1">Kayıt Tipi</label>
              <select
                value={customerType}
                onChange={(e) => {
                  setCustomerType(e.target.value as any)
                  setSelectedCustomerCode('')
                }}
                className="w-full p-2 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="cari">Cari (Bayi)</option>
                <option value="müşteri">Müşteri (End Customer)</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block text-gray-500 font-medium mb-1">Cari / Müşteri Seçimi</label>
              <div className="flex items-center space-x-2">
                <select
                  value={selectedCustomerCode}
                  onChange={(e) => setSelectedCustomerCode(e.target.value)}
                  required
                  className="flex-1 p-2 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">-- Seçiniz --</option>
                  {customerType === 'cari' ? (
                    dealers.map((d) => (
                      <option key={d.customerCode} value={d.customerCode}>
                        {d.customerCode} - {d.name}
                      </option>
                    ))
                  ) : (
                    endCustomers.map((c) => (
                      <option key={c.customerCode} value={c.customerCode}>
                        {c.customerCode} - {c.name}
                      </option>
                    ))
                  )}
                </select>
                {customerType === 'müşteri' && (
                  <button
                    type="button"
                    onClick={handleOpenAddCustomer}
                    className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm transition-colors flex items-center justify-center"
                    title="Yeni Müşteri Ekle"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <FormSelect
              label="İşlem Tipi"
              value={transactionType}
              onChange={(e) => setTransactionType(e.target.value)}
              options={[
                { value: 'GARANTİ', label: 'Garanti' },
                { value: 'SERVİS GARANTİ', label: 'Servis Garantisi' },
                { value: 'DEĞİŞİM', label: 'Birebir Ürün Değişimi' }
              ]}
            />
            <div className="md:col-span-2">
              <label className="block text-gray-500 font-medium mb-1">Ürün Seçimi</label>
              <select
                value={selectedProductCode}
                onChange={(e) => setSelectedProductCode(e.target.value)}
                required
                className="w-full p-2 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">-- Seçiniz --</option>
                {products.map((p) => (
                  <option key={p.stockCode} value={p.stockCode}>
                    {p.stockCode} - {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <FormInput
              label="Seri Numarası"
              value={previewSerialNo}
              disabled
              readOnly
            />
            <FormInput
              label="Marka / Model"
              value={brandModel}
              onChange={(e) => setBrandModel(e.target.value)}
              placeholder="Örn: Vestel 4K TV"
            />
            <FormSelect
              label="Teknik Personel (Plasiyer)"
              value={salesmanCode}
              onChange={(e) => setSalesmanCode(e.target.value)}
              options={[
                { value: '', label: '-- Seçiniz --' },
                ...salesmen.map((s) => ({ value: s.salesmanCode, label: `${s.salesmanCode} - ${s.description}` }))
              ]}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <FormInput
              type="number"
              label="Garanti Süresi (Ay)"
              value={String(warrantyPeriod)}
              onChange={(e) => setWarrantyPeriod(Number(e.target.value))}
            />
            <div className="md:col-span-2">
              <label className="block text-gray-500 font-medium mb-1">Arıza Açıklaması</label>
              <textarea
                value={faultDescription}
                onChange={(e) => setFaultDescription(e.target.value)}
                rows={2}
                className="w-full p-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Müşteri şikayeti ve ilk kontrol bulguları..."
              />
            </div>
          </div>

          {/* Pricing calculations */}
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 space-y-3">
            <h5 className="font-bold text-gray-700 flex items-center space-x-1.5 border-b pb-1.5 border-slate-200">
              <span>Maliyet / Fiyatlandırma Bilgileri</span>
              {priceResolving && <span className="text-[10px] text-blue-500 font-normal">(Fiyat çekiliyor...)</span>}
            </h5>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <FormInput
                type="number"
                label="Miktar"
                value={String(quantity)}
                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
              />
              <FormInput
                type="number"
                label="Brüt Tutar"
                value={String(grossAmount)}
                onChange={(e) => handleGrossChange(Number(e.target.value))}
              />
              <FormInput
                type="number"
                label="İskonto"
                value={String(discountAmount)}
                onChange={(e) => handleDiscountChange(Number(e.target.value))}
              />
              <FormInput
                type="number"
                label="KDV Oranı (%)"
                value={String(vatRate)}
                onChange={(e) => handleVatRateChange(Number(e.target.value))}
              />
              <div>
                <label className="block text-gray-500 font-medium mb-1">KDV Tutarı</label>
                <div className="p-2 bg-gray-100 rounded-lg border border-gray-200 font-semibold text-gray-600">
                  {formatMoney(vatAmount, currencyTypeId)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 border-t pt-3 border-slate-200">
              <div>
                <label className="block text-gray-500 font-medium mb-1">Ara Toplam (Net)</label>
                <div className="p-2 bg-gray-100 rounded-lg border border-gray-200 font-semibold text-gray-600">
                  {formatMoney(netAmount, currencyTypeId)}
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="block text-gray-700 font-bold mb-1 text-sm">Genel Toplam</label>
                <div className="p-2.5 bg-blue-50 text-blue-700 rounded-lg border border-blue-100 font-bold text-sm">
                  {formatMoney(totalAmount, currencyTypeId)}
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-3 border-t">
            <button
              type="button"
              onClick={() => setCreateModalOpen(false)}
              className="px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors font-semibold"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold shadow-sm"
            >
              {loading ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        </form>
      </Modal>

      {/* 2. ADD CUSTOMER MODAL (SUB-MODAL) */}
      <Modal
        isOpen={addCustomerModalOpen}
        onClose={() => setAddCustomerModalOpen(false)}
        title="Yeni Müşteri Ekle"
        containerClassName="max-w-2xl max-h-[85vh] z-50"
      >
        <form onSubmit={handleAddCustomerSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormInput
              label="Cari Kodu"
              value={newCustomerCode}
              onChange={(e) => setNewCustomerCode(e.target.value.toLocaleUpperCase('tr-TR'))}
              required
            />
            <FormInput
              label="İsim-Soyisim"
              value={newCustomerName}
              onChange={(e) => setNewCustomerName(e.target.value.toLocaleUpperCase('tr-TR'))}
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormInput
              label="Telefon"
              value={newCustomerPhone}
              onChange={(e) => setNewCustomerPhone(formatPhoneNumber(e.target.value))}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormInput
              label="Vergi Dairesi"
              value={newCustomerTaxOffice}
              onChange={(e) => setNewCustomerTaxOffice(e.target.value.toLocaleUpperCase('tr-TR'))}
            />
            <FormInput
              label="Vergi No / T.C. No"
              value={newCustomerTaxNumber}
              onChange={(e) => setNewCustomerTaxNumber(e.target.value.toLocaleUpperCase('tr-TR'))}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormInput
              label="İl"
              value={newCustomerCity}
              onChange={(e) => setNewCustomerCity(e.target.value.toLocaleUpperCase('tr-TR'))}
            />
            <FormInput
              label="İlçe"
              value={newCustomerDistrict}
              onChange={(e) => setNewCustomerDistrict(e.target.value.toLocaleUpperCase('tr-TR'))}
            />
          </div>

          <FormInput
            label="Adres"
            value={newCustomerAddress}
            onChange={(e) => setNewCustomerAddress(e.target.value.toLocaleUpperCase('tr-TR'))}
          />

          <div className="flex justify-end space-x-2 pt-3 border-t">
            <button
              type="button"
              onClick={() => setAddCustomerModalOpen(false)}
              className="px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors font-semibold"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={customerSaving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold shadow-sm"
            >
              {customerSaving ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        </form>
      </Modal>

      {/* 3. DETAIL & TIMELINE MODAL */}
      <Modal
        isOpen={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        title={selectedWarranty ? `Garanti Detayı - ${selectedWarranty.warrantyNo}` : 'Garanti Detayı'}
        containerClassName="max-w-5xl max-h-[95vh]"
      >
        {detailLoading && <div className="p-8 text-center text-xs text-gray-500">Detaylar yükleniyor...</div>}

        {!detailLoading && selectedWarranty && (
          <div className="space-y-6 text-xs">
            {/* Header info bar */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-100">
              <div>
                <p className="text-[10px] text-gray-400 font-medium uppercase">Kayıt Tipi</p>
                <p className="font-bold text-gray-800 text-sm mt-0.5">{selectedWarranty.transactionType}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400 font-medium uppercase">Kayıt Tarihi</p>
                <p className="font-bold text-gray-800 text-sm mt-0.5">
                  {new Date(selectedWarranty.recordDate).toLocaleDateString('tr-TR')}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400 font-medium uppercase">Garanti Süresi</p>
                <p className="font-bold text-gray-800 text-sm mt-0.5">{selectedWarranty.warrantyPeriodMonths} Ay</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400 font-medium uppercase">Mevcut Durum</p>
                <span className={`inline-block px-2.5 py-0.5 rounded-full font-bold text-[10px] mt-1 ${
                  selectedWarranty.status === 'AÇIK' ? 'bg-blue-50 text-blue-700 border border-blue-100' :
                  selectedWarranty.status === 'SERVİSTE' ? 'bg-amber-50 text-amber-700 border border-amber-100' :
                  selectedWarranty.status === 'BEKLEMEDE' ? 'bg-orange-50 text-orange-700 border border-orange-100' :
                  selectedWarranty.status === 'TAMAMLANDI' ? 'bg-green-50 text-green-700 border border-green-100' :
                  selectedWarranty.status === 'DEĞİŞİM YAPILDI' ? 'bg-purple-50 text-purple-700 border border-purple-100' :
                  'bg-red-50 text-red-700 border border-red-100'
                }`}>
                  {selectedWarranty.status}
                </span>
              </div>
            </div>

            {/* Info details columns */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <h4 className="font-bold text-gray-700 border-b pb-1.5 flex items-center space-x-1.5">
                  <User className="w-4 h-4 text-slate-400" />
                  <span>Cari ve Ürün Bilgileri</span>
                </h4>
                <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm space-y-2">
                  <div className="grid grid-cols-3">
                    <span className="text-gray-400">Cari Kodu/Adı:</span>
                    <span className="col-span-2 font-semibold text-gray-800">{selectedWarranty.customerCode} - {selectedWarranty.customerName}</span>
                  </div>
                  <div className="grid grid-cols-3">
                    <span className="text-gray-400">Ürün Kodu/Adı:</span>
                    <span className="col-span-2 font-semibold text-gray-800">{selectedWarranty.productCode} - {selectedWarranty.productName}</span>
                  </div>
                  <div className="grid grid-cols-3">
                    <span className="text-gray-400">Seri Numarası:</span>
                    <span className="col-span-2 font-semibold text-gray-800">{selectedWarranty.serialNo || '-'}</span>
                  </div>
                  <div className="grid grid-cols-3">
                    <span className="text-gray-400">Marka / Model:</span>
                    <span className="col-span-2 font-semibold text-gray-800">{selectedWarranty.brandModel || '-'}</span>
                  </div>
                  <div className="grid grid-cols-3">
                    <span className="text-gray-400">Teknik Personel:</span>
                    <span className="col-span-2 font-semibold text-gray-800">{selectedWarranty.salesmanCode || '-'}</span>
                  </div>
                  <div className="grid grid-cols-3">
                    <span className="text-gray-400">İşlem Yapan:</span>
                    <span className="col-span-2 font-semibold text-gray-800">{selectedWarranty.createdByUserName}</span>
                  </div>
                </div>

                <h4 className="font-bold text-gray-700 border-b pb-1.5 flex items-center space-x-1.5">
                  <Info className="w-4 h-4 text-slate-400" />
                  <span>Arıza Açıklaması</span>
                </h4>
                <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                  {selectedWarranty.faultDescription || 'Açıklama belirtilmemiş.'}
                </div>

                <h4 className="font-bold text-gray-700 border-b pb-1.5">Maliyet Takip</h4>
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 grid grid-cols-2 md:grid-cols-3 gap-2.5">
                  <div>
                    <span className="text-gray-400 block">Brüt Tutar:</span>
                    <span className="font-semibold text-gray-700">{formatMoney(selectedWarranty.grossAmount, selectedWarranty.currencyTypeId)}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block">İskonto:</span>
                    <span className="font-semibold text-gray-700">{formatMoney(selectedWarranty.discountAmount, selectedWarranty.currencyTypeId)}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block">Ara Toplam:</span>
                    <span className="font-semibold text-gray-700">{formatMoney(selectedWarranty.netAmount, selectedWarranty.currencyTypeId)}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block">KDV Tutarı:</span>
                    <span className="font-semibold text-gray-700">{formatMoney(selectedWarranty.vatAmount, selectedWarranty.currencyTypeId)}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-gray-700 block font-bold">Genel Toplam:</span>
                    <span className="font-bold text-blue-700 text-sm">{formatMoney(selectedWarranty.totalAmount, selectedWarranty.currencyTypeId)}</span>
                  </div>
                </div>
              </div>

              {/* TIMELINE HISTORY PANEL */}
              <div className="flex flex-col space-y-4">
                <h4 className="font-bold text-gray-700 border-b pb-1.5 flex items-center justify-between">
                  <span>Operasyonel Hareket Geçmişi (Timeline)</span>
                  <span className="text-[10px] text-gray-400 font-normal">Son durum: {selectedWarranty.lastStatusDate ? new Date(selectedWarranty.lastStatusDate).toLocaleDateString('tr-TR') : ''}</span>
                </h4>

                {/* Timeline visual representation */}
                <div className="flex-1 bg-white p-4 rounded-xl border border-gray-100 shadow-sm max-h-[300px] overflow-y-auto space-y-4 relative">
                  {warrantyHistories.length === 0 ? (
                    <div className="text-gray-400 text-center py-6">Kayıtlı hareket bulunamadı.</div>
                  ) : (
                    <div className="relative border-l-2 border-slate-100 pl-4 space-y-4 ml-1">
                      {warrantyHistories.map((h, i) => (
                        <div key={h.id} className="relative">
                          {/* Dot indicator */}
                          <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full border-2 border-white ${
                            h.status === 'TAMAMLANDI' ? 'bg-green-600 ring-2 ring-green-100' :
                            h.status === 'SERVİSTE' ? 'bg-amber-500 ring-2 ring-amber-100' :
                            h.status === 'BEKLEMEDE' ? 'bg-orange-500 ring-2 ring-orange-100' :
                            h.status === 'DEĞİŞİM YAPILDI' ? 'bg-purple-500 ring-2 ring-purple-100' :
                            h.status === 'İPTAL' ? 'bg-red-500 ring-2 ring-red-100' :
                            'bg-blue-500 ring-2 ring-blue-100'
                          }`} />
                          <div>
                            <div className="flex items-center space-x-1.5">
                              <span className="font-bold text-gray-800">{h.status}</span>
                              <span className="text-[10px] text-gray-400">
                                {new Date(h.createdTime).toLocaleString('tr-TR')}
                              </span>
                            </div>
                            <p className="text-gray-500 mt-0.5 leading-relaxed">{h.description}</p>
                            <span className="text-[9px] text-slate-400 block mt-0.5">İşlem Yapan: {h.createdByUser}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Update Status form */}
                {selectedWarranty.status !== 'TAMAMLANDI' && selectedWarranty.status !== 'İPTAL' && selectedWarranty.status !== 'DEĞİŞİM YAPILDI' && (
                  <form onSubmit={handleStatusUpdateSubmit} className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-3">
                    <h5 className="font-bold text-gray-700">Durum Güncelle / Timeline Hareketi Ekle</h5>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <FormSelect
                        label="Yeni Durum"
                        value={newStatus}
                        onChange={(e) => setNewStatus(e.target.value)}
                        required
                        options={[
                          { value: 'AÇIK', label: 'AÇIK (Yeni Kayıt)' },
                          { value: 'SERVİSTE', label: 'SERVİSTE (İşlemde)' },
                          { value: 'BEKLEMEDE', label: 'BEKLEMEDE (Onay/Parça Bekliyor)' },
                          { value: 'TAMAMLANDI', label: 'TAMAMLANDI (Kapatıldı)' },
                          { value: 'DEĞİŞİM YAPILDI', label: 'DEĞİŞİM YAPILDI' },
                          { value: 'İPTAL', label: 'İPTAL' }
                        ]}
                      />
                      <FormInput
                        label="Hareket Açıklaması"
                        value={statusDescription}
                        onChange={(e) => setStatusDescription(e.target.value)}
                        placeholder="Örn: Parça sipariş edildi."
                        required
                      />
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={statusUpdating}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors"
                      >
                        {statusUpdating ? 'Güncelleniyor...' : 'Güncelle'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t">
              <button
                type="button"
                onClick={() => setDetailModalOpen(false)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors font-semibold"
              >
                Kapat
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
