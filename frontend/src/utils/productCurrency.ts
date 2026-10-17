/**
 * Ürünün SATIŞ para birimini çözer. Fiyat gösteren, sepete ekleyen ve siparişe yazan
 * ekranların TEK kaynağı burasıdır.
 *
 * ## Neden ayrı bir dosya
 *
 * Ürünün İKİ para birimi vardır ve bunlar çelişmez:
 * - `currencyCode` → **ALIŞ** dövizi (`Product.CurrencyCode`)
 * - `salesCurrencyCode` → **SATIŞ** dövizi (`Product.SalesCurrencyCode`)
 *
 * "Dolarla al, TL sat" bu sistemde istisna değil KURAL: b2b_erp'deki 281 üründen 211'i
 * alışı USD / satışı TL. Ekranlarda satış dövizi bulunamayınca ALIŞ dövizine düşülüyordu.
 * 2026-08-14 kodlama göçüne kadar (43=USD → 3=USD) bu hata görünmüyordu, çünkü eski alış
 * kodu 43 eşleyicinin hiçbir dalına uymayıp sessizce "TRY" dönüyordu. Göçten sonra aynı
 * satır USD dönmeye başladı: TL satılan fritöz sipariş ekranında "USD 2172.41" listelendi,
 * sepete USD olarak girdi ve `SalesOrderLine.CurrencyTypeId = 3` ile siparişe yazılacaktı.
 *
 * **ALIŞ dövizine ASLA düşülmez.** Sunucu tarafındaki karşılığı
 * `ProductsController.LabelCurrency` — o da satış dövizini çapa alır.
 */

/** TEK KODLAMA: 1=TRY 2=EUR 3=USD 4=GBP (0 = eski TL varsayılanı). */
export function currencyCodeByProductCurrencyCode(cur: number): string {
  const v = Number(cur ?? 0)
  return v === 2 ? 'EUR' : v === 3 ? 'USD' : v === 4 ? 'GBP' : 'TRY'
}

type ProductCurrencySource = {
  /** Fiyat satırının para birimi (`ProductPrices.Currency`) — "TRY" | "USD" | "EUR" | "GBP". */
  currency?: unknown
  /** Ürünün satış dövizi kodu (`Product.SalesCurrencyCode`). */
  salesCurrencyCode?: unknown
}

/**
 * Gösterilecek tutarın para birimi.
 *
 * Önce fiyat satırının kendi para birimine bakar: ekrandaki SAYI o satırdan geliyor, dolayısıyla
 * etiketin de ondan gelmesi gerekir. Satır TL/boş ise ürünün satış dövizine düşer.
 * Sonuç her zaman geçerli bir koddur; para birimi hiç çözülemezse "TRY".
 *
 * `source` verilirse (fiyat grubu 4 kısıtındaki `displayCurrency`/`displayCurrencyCode` gibi)
 * ürün yerine o kaynak okunur.
 */
export function resolveProductSalesCurrency(source: ProductCurrencySource | null | undefined): string {
  const raw = String(source?.currency ?? '').trim().toUpperCase()
  if (raw && raw !== 'TL' && raw !== 'TRY') return raw

  const code = Number(source?.salesCurrencyCode ?? 0)
  if (code > 0) return currencyCodeByProductCurrencyCode(code)

  return 'TRY'
}

/** Para birimi fiilen TL mi? ("", "TL" ve "TRY" aynı şeydir.) */
export function isTryCurrency(code: string | null | undefined): boolean {
  const c = String(code ?? '').trim().toUpperCase()
  return !c || c === 'TL' || c === 'TRY'
}
