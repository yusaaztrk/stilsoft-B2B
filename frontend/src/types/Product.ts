export type Product = {
  id: string
  createdAt?: string
  stockCode: string
  name: string
  description?: string | null
  barcode?: string | null
  barcodeType?: string | null
  groupCode?: string | null
  subGroupCode?: string | null
  kod4?: string | null
  kod5?: string | null
  unit?: string
  taxRate: number
  productType?: string | null
  discountRate?: number
  supplierId?: number | null
  boxQuantity?: number
  purchasePrice?: number
  bsyVisibleFlag?: string | null
  containerQuantity?: number
  freight?: number
  /** ALIŞ para birimi — 1=TRY 2=EUR 3=USD 4=GBP. */
  currencyCode?: number
  /** SATIŞ para birimi; alıştan bağımsızdır ("dolarla al, TL sat"). Fiyat satırları buna göre yazılır. */
  salesCurrencyCode?: number
  isOfficial?: boolean
  stock?: number
  termin?: number
  /** Stok alarmı ("bitmek üzere" uyarısı). Satışı KAPATMAZ — onun için `bsyMinStock`. */
  minStock?: number
  /** Satışa kapanma eşiği: stok bunun altına düşünce ürün bayide otomatik kapanır (0 = kural kapalı). */
  bsyMinStock?: number
  isActive?: boolean
  imageUrl?: string | null
  imageUrls?: string[] | null
  videoUrl?: string | null
  videoUrls?: string[] | null
  isInstallable?: boolean
  installationFee?: number | null
  unitPrice: number | null
  currency?: string | null
  displayUnitPrice?: number | null
  displayCurrency?: string | null
  displayCurrencyCode?: number | null
  /** Fiyat 4 (katalog) — kampanyalı fiyat bundan türer (bkz. utils/priceFormula.ts). */
  catalogUnitPrice?: number | null
  catalogCurrency?: string | null
}

export type ProductListResponse = {
  items: Product[]
  total: number
  page: number
  pageSize: number
}
