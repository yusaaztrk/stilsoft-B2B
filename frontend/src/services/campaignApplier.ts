import type { ActiveCampaignDto } from '../api/campaigns'
import { kampanyaKatalogIndirimi } from '../utils/priceFormula'

export type CartItem = {
    product: {
        id: string
        name: string
        stockCode: string
        unitPrice: number
        kdvRate: number
        imageUrl?: string | null
        isInstallable?: boolean
        installationFee?: number
    }
    dealer: {
        id: string
        label: string
    }
    montaj: 'Montaj istemiyorum.' | 'Montaj istiyorum.'
    qty: number
}

export type AppliedCampaign = {
    campaignId: string
    campaignName: string
    campaignType: number
    discountAmount: number
    discountType: 'Oran' | 'Tutar'
    appliedTo: 'product' | 'basket'
    productStockCode?: string
}

export type CampaignApplicationResult = {
    appliedCampaigns: AppliedCampaign[]
    totalDiscount: number
    giftItems: CartItem[]
    itemDiscounts: Record<string, number> // stockCode -> discount amount
}

export function parseUnitPrice(val: string | number | undefined | null): number {
    if (typeof val === 'number') return Number.isFinite(val) ? val : 0
    if (typeof val === 'string') {
        const parsed = parseFloat(val.replace(/\./g, '').replace(',', '.'))
        return Number.isFinite(parsed) ? parsed : 0
    }
    return 0
}

/**
 * Sepetteki ürünlere kampanyaları uygular
 */
export function applyCampaignsToCart(
    cartItems: CartItem[],
    campaigns: ActiveCampaignDto[],
    customerPriceGroupCode?: number
): CampaignApplicationResult {
    const result: CampaignApplicationResult = {
        appliedCampaigns: [],
        totalDiscount: 0,
        giftItems: [],
        itemDiscounts: {}
    }

    if (campaigns.length === 0 || cartItems.length === 0) {
        return result
    }

    // Sepet toplamını hesapla
    const basketTotal = cartItems.reduce((sum, item) => {
        const price = parseUnitPrice(item.product.unitPrice)
        const qty = Number(item.qty) || 0
        const basePrice = price * qty
        const installFee = item.montaj === 'Montaj istiyorum.' ? parseUnitPrice(item.product.installationFee) * qty : 0
        return sum + basePrice + installFee
    }, 0)

    // Kampanyaları önceliğe göre sırala
    const sortedCampaigns = [...campaigns].sort((a, b) => b.priority - a.priority)

    for (const campaign of sortedCampaigns) {
        // Fiyat grubu kontrolü
        if (customerPriceGroupCode) {
            const hasValidPriceGroup = campaign.discounts.some((d) => {
                const priceGroupField = `iskontoFiyat${customerPriceGroupCode}` as keyof typeof d
                const pgValue = d[priceGroupField]
                if (typeof pgValue === 'number' && Number.isFinite(pgValue) && pgValue > 0) return true
                const baseValue = (d as any)?.deger
                return typeof baseValue === 'number' && Number.isFinite(baseValue) && baseValue > 0
            })
            if (!hasValidPriceGroup) continue
        }

        const prevAppliedCount = result.appliedCampaigns.length

        // Kampanya tipine göre uygula
        switch (campaign.kampanyaTipi) {
            case 4: // Seçili Ürün İndirimi
                applyProductDiscount(campaign, cartItems, result, customerPriceGroupCode)
                break
            case 5: // Kategori/Marka İndirimi
                applyCategoryBrandDiscount(campaign, cartItems, result, customerPriceGroupCode)
                break
            case 6: // Paket Kampanya
                applyPackageCampaign(campaign, cartItems, result, customerPriceGroupCode)
                break
            case 1: // Sepet Toplam İndirimi
                applyBasketTotalDiscount(campaign, basketTotal, result, customerPriceGroupCode)
                break
            case 2: // Adet Bazlı Kademeli İndirim
                applyQuantityTieredDiscount(campaign, cartItems, result, customerPriceGroupCode)
                break
            case 3: // X Al Y Öde (Buy X Get Y)
                applyBuyXGetY(campaign, cartItems, result, customerPriceGroupCode)
                break
        }

        if (campaign.stopNext && result.appliedCampaigns.length > prevAppliedCount) {
            break
        }
    }

    return result
}

/**
 * Seçili ürün indirimi uygula
 */
function applyProductDiscount(
    campaign: ActiveCampaignDto,
    cartItems: CartItem[],
    result: CampaignApplicationResult,
    priceGroupCode?: number
) {
    for (const discount of campaign.discounts) {
        if (!discount.stokKodu) continue

        const cartItem = cartItems.find((item) => item.product.stockCode === discount.stokKodu)
        if (!cartItem) continue

        const discountValue = getDiscountValueForPriceGroup(discount, priceGroupCode)
        if (discountValue === null) continue

        const price = parseUnitPrice(cartItem.product.unitPrice)
        const qty = Number(cartItem.qty) || 0

        const itemTotal = price * qty
        const discountAmount =
            discount.iskontoTipiText === 'Oran'
                ? (itemTotal * discountValue) / 100
                : discountValue * qty

        result.itemDiscounts[cartItem.product.stockCode] =
            (result.itemDiscounts[cartItem.product.stockCode] || 0) + discountAmount
        result.totalDiscount += discountAmount

        result.appliedCampaigns.push({
            campaignId: campaign.id,
            campaignName: campaign.name,
            campaignType: campaign.kampanyaTipi,
            discountAmount,
            discountType: discount.iskontoTipiText as 'Oran' | 'Tutar',
            appliedTo: 'product',
            productStockCode: cartItem.product.stockCode
        })
    }
}

/**
 * Kategori/Marka indirimi uygula
 */
function applyCategoryBrandDiscount(
    campaign: ActiveCampaignDto,
    cartItems: CartItem[],
    result: CampaignApplicationResult,
    priceGroupCode?: number
) {
    for (const discount of campaign.discounts) {
        for (const condition of campaign.conditions) {
            if (!condition.productStockCodesJson) continue

            try {
                const stockCodes = JSON.parse(condition.productStockCodesJson) as string[]

                for (const stockCode of stockCodes) {
                    const cartItem = cartItems.find((item) => item.product.stockCode === stockCode)
                    if (!cartItem) continue

                    const discountValue = getDiscountValueForPriceGroup(discount, priceGroupCode)
                    if (discountValue === null) continue

                    const priceCat = parseUnitPrice(cartItem.product.unitPrice)
                    const qtyCat = Number(cartItem.qty) || 0
                    const itemTotal = priceCat * qtyCat
                    const discountAmount =
                        discount.iskontoTipiText === 'Oran'
                            ? (itemTotal * discountValue) / 100
                            : discountValue * cartItem.qty

                    result.itemDiscounts[cartItem.product.stockCode] =
                        (result.itemDiscounts[cartItem.product.stockCode] || 0) + discountAmount
                    result.totalDiscount += discountAmount

                    result.appliedCampaigns.push({
                        campaignId: campaign.id,
                        campaignName: campaign.name,
                        campaignType: campaign.kampanyaTipi,
                        discountAmount,
                        discountType: discount.iskontoTipiText as 'Oran' | 'Tutar',
                        appliedTo: 'product',
                        productStockCode: cartItem.product.stockCode
                    })
                }
            } catch {
                // Invalid JSON, skip
            }
        }
    }
}

/**
 * Paket kampanya uygula (hediye ürün)
 */
function applyPackageCampaign(
    campaign: ActiveCampaignDto,
    cartItems: CartItem[],
    result: CampaignApplicationResult,
    priceGroupCode?: number
) {
    // Paket kampanya: şart (paket içeriği) => conditions[conditionType=PackageProducts].packageItemsJson
    // indirim kurgusu => discounts[0] (IskontoTipiText: 'Tutar' => paket net fiyatı, 'Oran' => yüzde indirim)

    const cond = (campaign.conditions ?? []).find((c: any) => {
        const rawType = (c as any)?.conditionType
        const typeNum = Number(rawType ?? 0)
        const typeStr = String(rawType ?? '').trim()
        const hasPkg = String((c as any)?.packageItemsJson ?? '').trim().length > 0
        return typeNum === 6 || typeStr === '6' || typeStr.toLowerCase() === 'packageproducts' || hasPkg
    })

    const raw = String((cond as any)?.packageItemsJson ?? '').trim()
    if (!raw) return

    let pkgItems: Array<{ stockCode: string; quantity: number }> = []
    try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
            pkgItems = parsed
                .map((x: any) => ({
                    stockCode: String(x?.stockCode ?? '').trim(),
                    quantity: Number(x?.quantity ?? 0)
                }))
                .filter((x) => x.stockCode && Number.isFinite(x.quantity) && x.quantity > 0)
        }
    } catch {
        return
    }

    if (pkgItems.length === 0) return

    // Normalize and merge duplicates (stockCode is case-insensitive)
    const requiredQtyByStockCode = new Map<string, number>()
    for (const it of pkgItems) {
        const key = String(it.stockCode ?? '').trim().toUpperCase()
        if (!key) continue
        requiredQtyByStockCode.set(key, (requiredQtyByStockCode.get(key) || 0) + (Number(it.quantity) || 0))
    }

    if (requiredQtyByStockCode.size === 0) return

    const cartQtyByStockCode = new Map<string, number>()
    const cartTotalByStockCode = new Map<string, number>()
    for (const it of cartItems) {
        const sc = String(it.product.stockCode ?? '').trim().toUpperCase()
        if (!sc) continue
        const qty = Number(it.qty) || 0
        if (qty <= 0) continue

        const unit = parseUnitPrice(it.product.unitPrice)
        const base = unit * qty
        const installFee = it.montaj === 'Montaj istiyorum.' ? parseUnitPrice(it.product.installationFee) * qty : 0
        const lineTotal = base + installFee

        cartQtyByStockCode.set(sc, (cartQtyByStockCode.get(sc) || 0) + qty)
        cartTotalByStockCode.set(sc, (cartTotalByStockCode.get(sc) || 0) + lineTotal)
    }

    // eligibility
    for (const [sc, reqQty] of requiredQtyByStockCode.entries()) {
        const have = cartQtyByStockCode.get(sc) || 0
        if (have < reqQty) return
    }

    // only apply once per campaign
    const exists = result.appliedCampaigns.some((x) => x.campaignId === campaign.id && x.appliedTo === 'basket')
    if (exists) return

    const discount = (campaign.discounts ?? [])[0]
    if (!discount) return

    const discountValue = getDiscountValueForPriceGroup(discount, priceGroupCode)
    if (discountValue === null) return
    if (discountValue <= 0) return

    // total of required items only (package scope)
    const packageTotal = Array.from(requiredQtyByStockCode.entries()).reduce((sum, [stockCode, reqQty]) => {
        const totalForStock = cartTotalByStockCode.get(stockCode) || 0
        const cartQty = cartQtyByStockCode.get(stockCode) || 0
        if (cartQty <= 0) return sum
        const unit = totalForStock / cartQty
        return sum + unit * reqQty
    }, 0)

    if (packageTotal <= 0) return

    let discountAmount = 0
    if (discount.iskontoTipiText === 'Oran') {
        discountAmount = (packageTotal * discountValue) / 100
    } else {
        // 'Tutar' => sabit paket net fiyatı
        const packageNetPrice = discountValue
        discountAmount = packageTotal - packageNetPrice
    }

    if (discountAmount <= 0) return
    discountAmount = Math.min(discountAmount, packageTotal)

    result.totalDiscount += discountAmount
    result.appliedCampaigns.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        campaignType: campaign.kampanyaTipi,
        discountAmount,
        discountType: discount.iskontoTipiText as 'Oran' | 'Tutar',
        appliedTo: 'basket'
    })
}

/**
 * Sepet toplam indirimi uygula
 */
function applyBasketTotalDiscount(
    campaign: ActiveCampaignDto,
    basketTotal: number,
    result: CampaignApplicationResult,
    priceGroupCode?: number
) {
    // En uygun kademeyi seç (minSepetTutari en büyük olan)
    let best: ActiveCampaignDto['discounts'][0] | null = null
    let bestMin = -Infinity

    for (const d of campaign.discounts) {
        if (basketTotal < d.minSepetTutari) continue
        const v = getDiscountValueForPriceGroup(d, priceGroupCode)
        if (v === null) continue
        if (d.minSepetTutari >= bestMin) {
            best = d
            bestMin = d.minSepetTutari
        }
    }

    if (!best) return

    const discountValue = getDiscountValueForPriceGroup(best, priceGroupCode)
    if (discountValue === null) return

    const discountAmount =
        best.iskontoTipiText === 'Oran'
            ? (basketTotal * discountValue) / 100
            : discountValue

    if (discountAmount <= 0) return

    result.totalDiscount += discountAmount
    result.appliedCampaigns.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        campaignType: campaign.kampanyaTipi,
        discountAmount,
        discountType: best.iskontoTipiText as 'Oran' | 'Tutar',
        appliedTo: 'basket'
    })
}

/**
 * Adet bazlı kademeli indirim uygula
 */
function applyQuantityTieredDiscount(
    campaign: ActiveCampaignDto,
    cartItems: CartItem[],
    result: CampaignApplicationResult,
    priceGroupCode?: number
) {
    // If campaign specifies target stock codes, only those should contribute to tier quantity/amount.
    // Otherwise we fall back to all cart items.
    let targetedStockCodes: string[] | null = null
    for (const c of campaign.conditions || []) {
        const raw = (c as any)?.productStockCodesJson
        if (!raw) continue

        try {
            const parsed = JSON.parse(raw)

            // Backend may send either a string[] or an object like { productStockCodes: string[], groupCodes: string[] }
            if (Array.isArray(parsed)) {
                targetedStockCodes = parsed.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
                break
            }

            const arr = (parsed as any)?.productStockCodes
            if (Array.isArray(arr)) {
                targetedStockCodes = arr.filter((x: any) => typeof x === 'string' && x.trim()).map((x: string) => x.trim())
                break
            }
        } catch {
            // ignore invalid json
        }
    }

    const matchedItems = targetedStockCodes && targetedStockCodes.length > 0
        ? cartItems.filter((x) => targetedStockCodes!.includes(String(x.product.stockCode ?? '').trim()))
        : cartItems

    const totalQuantity = matchedItems.reduce((sum, item) => sum + (Number(item.qty) || 0), 0)
    if (totalQuantity <= 0) return

    const conditions = campaign.conditions || []
    const discounts = campaign.discounts || []

    const pairCount = Math.min(conditions.length, discounts.length)
    if (pairCount === 0) return

    let bestIndex = -1
    let bestMin = -Infinity

    for (let i = 0; i < pairCount; i++) {
        const c = conditions[i]
        const minQty = Number(c.minimum) || 0
        const maxQty = c.maximum === null || c.maximum === undefined ? null : Number(c.maximum)

        if (totalQuantity < minQty) continue
        if (maxQty !== null && totalQuantity > maxQty) continue

        if (minQty >= bestMin) {
            bestMin = minQty
            bestIndex = i
        }
    }

    if (bestIndex < 0) return

    const bestDiscount = discounts[bestIndex]
    const discountValue = getDiscountValueForPriceGroup(bestDiscount, priceGroupCode)
    if (discountValue === null) return
    if (discountValue <= 0) return

    const matchingTotal = matchedItems.reduce((sum, item) => {
        const price = parseUnitPrice(item.product.unitPrice)
        const qty = Number(item.qty) || 0
        return sum + price * qty
    }, 0)

    if (matchingTotal <= 0) return

    // For percentage tiers, apply discount once on the whole basket total (not per-line / not only on matched items).
    // Eligibility is still based on the matched item quantity tier.
    const basketTotal = cartItems.reduce((sum, item) => {
        const price = parseUnitPrice(item.product.unitPrice)
        const qty = Number(item.qty) || 0
        const basePrice = price * qty
        const installFee = item.montaj === 'Montaj istiyorum.' ? parseUnitPrice(item.product.installationFee) * qty : 0
        return sum + basePrice + installFee
    }, 0)

    const discountAmount =
        bestDiscount.iskontoTipiText === 'Oran'
            ? (basketTotal * discountValue) / 100
            : discountValue

    if (discountAmount <= 0) return

    const applied = Math.min(discountAmount, basketTotal)
    if (applied <= 0) return

    result.totalDiscount += applied

    const existingIdx = result.appliedCampaigns.findIndex(
        (x) => x.campaignId === campaign.id && x.appliedTo === 'basket'
    )

    const payload = {
        campaignId: campaign.id,
        campaignName: campaign.name,
        campaignType: campaign.kampanyaTipi,
        discountAmount: applied,
        discountType: bestDiscount.iskontoTipiText as 'Oran' | 'Tutar',
        appliedTo: 'basket' as const
    }

    if (existingIdx >= 0) result.appliedCampaigns[existingIdx] = payload
    else result.appliedCampaigns.push(payload)
}

/**
 * X Al Y Öde kampanyası uygula
 */
function applyBuyXGetY(
    campaign: ActiveCampaignDto,
    cartItems: CartItem[],
    result: CampaignApplicationResult,
    _priceGroupCode?: number
) {
    // 1. Find trigger condition — which products and how many needed
    let triggerStockCodes: string[] = []
    let triggerMinQty = 1
    for (const cond of campaign.conditions ?? []) {
        const raw = (cond as any)?.productStockCodesJson
        if (raw) {
            try {
                const parsed = JSON.parse(raw)
                if (Array.isArray(parsed)) {
                    triggerStockCodes = parsed.map((x: any) => String(x ?? '').trim()).filter(Boolean)
                }
            } catch { /* ignore */ }
        }
        if (Number(cond.minimum) > 0) triggerMinQty = Number(cond.minimum)
    }

    // 2. Check if trigger condition is satisfied
    const triggerItems = triggerStockCodes.length > 0
        ? cartItems.filter(it => triggerStockCodes.includes(String(it.product.stockCode ?? '').trim()))
        : cartItems
    const triggerQty = triggerItems.reduce((s, it) => s + (Number(it.qty) || 0), 0)
    if (triggerQty < triggerMinQty) return

    // Calculate multiplier (how many times the promotion fires)
    const multiplier = triggerMinQty > 0 ? Math.floor(triggerQty / triggerMinQty) : 1

    // 3. Apply actions
    for (const action of campaign.actions) {
        if (action.actionType === 3 && action.targetProductId) {
            // GiftProduct — backend handles adding gift lines with UnitPrice=0
            // Frontend just shows the campaign as applied
            const giftQty = (Number(action.quantity) || 1) * multiplier
            result.appliedCampaigns.push({
                campaignId: campaign.id,
                campaignName: campaign.name,
                campaignType: campaign.kampanyaTipi,
                discountAmount: 0,
                discountType: 'Tutar',
                appliedTo: 'basket'
            })
        } else if (action.actionType === 1 && action.value > 0) {
            // PercentageDiscount on trigger items
            const triggerTotal = triggerItems.reduce((s, it) => {
                const p = parseUnitPrice(it.product.unitPrice)
                const q = Number(it.qty) || 0
                return s + p * q
            }, 0)
            const discountAmount = (triggerTotal * action.value) / 100
            if (discountAmount <= 0) continue
            result.totalDiscount += discountAmount
            result.appliedCampaigns.push({
                campaignId: campaign.id,
                campaignName: campaign.name,
                campaignType: campaign.kampanyaTipi,
                discountAmount,
                discountType: 'Oran',
                appliedTo: 'basket'
            })
        } else if (action.actionType === 2 && action.value > 0) {
            // FixedAmountDiscount
            const discountAmount = action.value * multiplier
            if (discountAmount <= 0) continue
            result.totalDiscount += discountAmount
            result.appliedCampaigns.push({
                campaignId: campaign.id,
                campaignName: campaign.name,
                campaignType: campaign.kampanyaTipi,
                discountAmount,
                discountType: 'Tutar',
                appliedTo: 'basket'
            })
        }
    }

    // 4. Also check CampaignDiscounts for reward discounts (stokKodu-based)
    for (const discount of campaign.discounts ?? []) {
        if (!discount.stokKodu) continue
        const rewardItem = cartItems.find(it => String(it.product.stockCode ?? '').trim() === String(discount.stokKodu ?? '').trim())
        if (!rewardItem) continue

        const rewardQty = Math.min(Number(rewardItem.qty) || 0, (Number((campaign.actions?.[0] as any)?.quantity) || 1) * multiplier)
        if (rewardQty <= 0) continue

        const rewardPrice = parseUnitPrice(rewardItem.product.unitPrice)
        const rewardLineTotal = rewardPrice * rewardQty
        const discountValue = Number(discount.deger) || 0
        if (discountValue <= 0) continue

        const discountAmount = discount.iskontoTipiText === 'Oran'
            ? (rewardLineTotal * discountValue) / 100
            : discountValue * rewardQty

        if (discountAmount <= 0) continue
        result.totalDiscount += discountAmount
        result.itemDiscounts[rewardItem.product.stockCode] =
            (result.itemDiscounts[rewardItem.product.stockCode] || 0) + discountAmount
        result.appliedCampaigns.push({
            campaignId: campaign.id,
            campaignName: campaign.name,
            campaignType: campaign.kampanyaTipi,
            discountAmount,
            discountType: discount.iskontoTipiText as 'Oran' | 'Tutar',
            appliedTo: 'product',
            productStockCode: rewardItem.product.stockCode
        })
    }
}

/**
 * Fiyat grubuna göre indirim değerini al
 */
function getDiscountValueForPriceGroup(
    discount: ActiveCampaignDto['discounts'][0],
    priceGroupCode?: number
): number | null {
    if (!priceGroupCode) {
        return discount.deger
    }

    const priceGroupField = `iskontoFiyat${priceGroupCode}` as keyof typeof discount
    const value = discount[priceGroupField]

    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
    return typeof discount.deger === 'number' && Number.isFinite(discount.deger) ? discount.deger : null
}

/* ===========================================================================================
 * ÜRÜN KARTINDAKİ KAMPANYALI FİYAT (2026-09-18 kullanıcı isteği: "ürünün fiyatı değişmiyor,
 * eski fiyatın üstünü çizmeli").
 *
 * Sepetteki hesap (yukarısı) satır TOPLAMINDAN indirim düşüyor; listedeki kart ise ürünün
 * birim fiyatını gösteriyor ve kampanyadan habersizdi. Aynı indirim burada BİRİM FİYATA
 * uygulanıyor, böylece kartta eski fiyat üstü çizili, yeni fiyat yanında duruyor.
 *
 * FİYAT GRUBU ŞART: kampanya belirli fiyat gruplarına tanımlıysa (IskontoFiyat1..6) müşterinin
 * grubu o listede değilse kampanya bu müşteriye HİÇ uygulanmaz. Sepet tarafındaki
 * `getDiscountValueForPriceGroup` böyle bir durumda genel `deger`e düşüyor; o davranış
 * bilerek değiştirilmedi (kullanıcı kuralı: indirim/fiyat davranışı sorulmadan değişmez),
 * kart yalnızca müşterinin gerçekten hak ettiği fiyatı gösterir.
 * ========================================================================================= */

export type CampaignProductPrice = {
    /** Kampanyasız birim fiyat — kartta üstü çizili gösterilen. */
    oldPrice: number
    /** Kampanya uygulanmış birim fiyat. */
    newPrice: number
    /** Birim başına düşen indirim. */
    unitDiscount: number
    campaignName: string
    discountType: 'Oran' | 'Tutar'
    /** Oran kampanyasında yüzde değeri; tutar kampanyasında null. */
    percent: number | null
}

type CampaignPriceProduct = {
    stockCode?: string | null
    groupCode?: string | null
    subGroupCode?: string | null
    kod4?: string | null
    kod5?: string | null
}

/**
 * Kampanyalı fiyatın F4'ten türemesi için gereken katalog bilgisi.
 *
 * KAMPANYA İNDİRİMİ KATALOG FİYATINA (F4) UYGULANIR (2026-09-18 kullanıcı kuralı). Kart,
 * sepetle (sunucu `CampaignCatalogDiscount`) aynı sayıyı göstersin diye aynı girdileri alır:
 * ürünün F4'ü, carinin fiyat grubu formülü, ürünün KDV ve iskonto oranı. Bilgi eksikse
 * (F4 yok) eski hesap — birim fiyattan doğrudan düşme — kullanılır; sunucu da aynı yedeğe düşer.
 */
export type CampaignCatalogPricing = {
    /** Fiyat 4 (katalog) birim fiyatı. */
    catalogPrice?: number | null
    /** F4'ün para birimi (ürün listesindeki `catalogCurrency`). */
    catalogCurrency?: string | null
    /** Carinin fiyat grubu formülü; boşsa taban grup (F4) sayılır. */
    formula?: string | null
    taxRate?: number | null
    discountRate?: number | null
}

const isTryCode = (v: unknown) => {
    const c = String(v ?? '').trim().toUpperCase()
    return c === '' || c === 'TL' || c === 'TRY'
}

const campNorm = (v: unknown) => String(v ?? '').trim().toUpperCase()

/** Bu indirim satırı, müşterinin fiyat grubunda geçerli mi ve değeri ne? */
function discountValueForGroupStrict(
    discount: ActiveCampaignDto['discounts'][0],
    priceGroupCode?: number
): number | null {
    /*
      ÖNCE `priceGroupCodes` (2026-09-21). Sunucu fiyat grubu kısıtını artık alt tablodan
      (`CampaignDiscountPriceGroup`) okuyor ve orada 7 = ASKERİYE dahil KAÇ GRUP OLURSA OLSUN
      değer bulunuyor. Burası yalnız eski `iskontoFiyat1..6` kolonlarına bakıyordu: 7. grup
      için kolon yok → askeriye carilerinde HER kampanya "carinin fiyat grubuna uyan ürün
      bulunamadı" diyordu, Mağaza Sipariş kartında rozet/üstü çizili çıkmıyordu (sepet doğru
      hesaplıyordu, çünkü sunucu). Kural sunucudakiyle AYNI (CampaignService
      .ResolveDiscountValueForPriceGroup): liste doluysa liste kısıtlar, carinin grubu
      belirsizse eski davranış (uygulanır), listede yoksa uygulanmaz.
    */
    const codes = Array.isArray((discount as any)?.priceGroupCodes)
        ? ((discount as any).priceGroupCodes as unknown[]).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
        : []
    if (codes.length > 0) {
        const base = Number((discount as any)?.deger)
        if (!Number.isFinite(base) || base <= 0) return null
        if (!priceGroupCode) return base
        return codes.includes(priceGroupCode) ? base : null
    }

    const anyGroupDefined = [1, 2, 3, 4, 5, 6].some((n) => {
        const v = (discount as any)?.[`iskontoFiyat${n}`]
        return typeof v === 'number' && Number.isFinite(v) && v > 0
    })

    if (!anyGroupDefined) {
        const base = Number((discount as any)?.deger)
        return Number.isFinite(base) && base > 0 ? base : null
    }

    if (!priceGroupCode) return null
    const v = (discount as any)?.[`iskontoFiyat${priceGroupCode}`]
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

/**
 * Bir indirim satırının FİYAT GRUBU KAPSAMI: `priceGroupCodes` doluysa o liste; yoksa eski
 * iskontoFiyat1..6 kolonlarından dolu olanlar; hiçbiri yoksa boş dizi = "herkese".
 * (`discountValueForGroupStrict` ile aynı öncelik; rozet ve teşhis metni buradan okuyor.)
 */
export function discountPriceGroupScope(discount: ActiveCampaignDto['discounts'][0]): number[] {
    const codes = Array.isArray((discount as any)?.priceGroupCodes)
        ? ((discount as any).priceGroupCodes as unknown[]).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
        : []
    if (codes.length > 0) return Array.from(new Set(codes)).sort((a, b) => a - b)
    return [1, 2, 3, 4, 5, 6].filter((n) => {
        const v = (discount as any)?.[`iskontoFiyat${n}`]
        return typeof v === 'number' && Number.isFinite(v) && v > 0
    })
}

/** Kampanyanın bütün indirim satırlarının fiyat grubu kapsamı (birleşim); boş = herkese. */
export function campaignPriceGroupScope(campaign: ActiveCampaignDto): number[] {
    const out = new Set<number>()
    let herkese = false
    for (const d of campaign?.discounts ?? []) {
        const scope = discountPriceGroupScope(d)
        if (scope.length === 0) herkese = true
        for (const n of scope) out.add(n)
    }
    return herkese ? [] : Array.from(out).sort((a, b) => a - b)
}

/**
 * Kampanya bu fiyat grubundaki cariye UYGULANIR mı? Grup belirsizse (undefined) eski
 * davranış: uygulanır sayılır. Rozet (`ProductCampaignBadge`) ve "Kampanyalı" süzgeci bunu
 * kullanıyor; eskiden yalnız ürün eşleşmesine bakıp grubu dışarıda kalan cariye de hediye
 * ikonu basıyor, kartta üstü çizili fiyat çıkmayınca "kampanya çalışmıyor" sanılıyordu.
 */
export function campaignAppliesToPriceGroup(campaign: ActiveCampaignDto, priceGroupCode?: number): boolean {
    if (!priceGroupCode) return true
    const discounts = campaign?.discounts ?? []
    if (discounts.length === 0) return true
    return discounts.some((d) => discountValueForGroupStrict(d, priceGroupCode) !== null)
}

/** Kampanyanın kategori/marka şartı bu ürüne uyuyor mu (tip 5). */
function categoryConditionMatches(campaign: ActiveCampaignDto, product: CampaignPriceProduct): boolean {
    const pc = campNorm(product.groupCode)
    const psc = campNorm(product.subGroupCode)
    const k4 = campNorm(product.kod4)
    const k5 = campNorm(product.kod5)

    return (campaign.conditions ?? []).some((cond: any) => {
        const cat = campNorm(cond?.categoryCode)
        if (!cat) return false
        if (cat !== pc && cat !== psc) return false

        const brandCode = campNorm(cond?.brandCode)
        const brandField = campNorm(cond?.brandField)
        if (!brandCode || !brandField) return true
        if (brandField === 'KOD4') return k4 === brandCode
        if (brandField === 'KOD5') return k5 === brandCode
        if (brandField === 'SUBCATEGORY') return psc === brandCode
        return false
    })
}

/** Kampanyanın ürün listesi şartı bu ürünü kapsıyor mu. */
function stockConditionMatches(campaign: ActiveCampaignDto, stockCode: string): boolean {
    return (campaign.conditions ?? []).some((cond: any) => {
        const raw = String(cond?.productStockCodesJson ?? '').trim()
        if (!raw) return false
        try {
            const parsed = JSON.parse(raw)
            const list: string[] = Array.isArray(parsed)
                ? parsed
                : (parsed?.productStockCodes ?? parsed?.ProductStockCodes ?? [])
            return Array.isArray(list) && list.map(campNorm).includes(stockCode)
        } catch {
            return false
        }
    })
}

/**
 * Ürünün kampanyalı birim fiyatı. Kampanya yoksa `null`.
 *
 * Yalnızca BİRİM FİYATI değiştiren kampanyalar hesaplanır: Seçili Ürün İndirimi (4) ve
 * Kategori/Marka İndirimi (5). Sepet toplamı, adet kademesi, X al Y öde ve paket kampanyaları
 * sepetin tamamına bakar; kartta tek ürünün fiyatını değiştirmeleri yanıltıcı olurdu.
 *
 * Birden çok kampanya varsa MÜŞTERİ LEHİNE olan (en düşük fiyat) gösterilir; sepet tarafı da
 * indirimleri üst üste uygulamıyor, önceliğe göre tek tek deniyor.
 */
export function campaignPriceForProduct(
    product: CampaignPriceProduct,
    unitPrice: number,
    campaigns: ActiveCampaignDto[],
    priceGroupCode?: number,
    catalog?: CampaignCatalogPricing
): CampaignProductPrice | null {
    const price = Number(unitPrice)
    if (!Number.isFinite(price) || price <= 0) return null

    const sc = campNorm(product.stockCode)
    if (!sc) return null

    let best: CampaignProductPrice | null = null

    for (const campaign of campaigns ?? []) {
        const tip = Number((campaign as any)?.kampanyaTipi)
        if (tip !== 4 && tip !== 5) continue

        for (const discount of campaign.discounts ?? []) {
            const rowStock = campNorm(discount?.stokKodu)
            const rowGroup = campNorm(discount?.grupKodu)

            // Satır hangi ürünleri kapsıyor: stok kodu varsa yalnız o ürün; yoksa grup/şart.
            let covers = false
            if (rowStock) {
                /*
                  STOK KODLU SATIR YALNIZ KENDİ ÜRÜNÜNÜ KAPSAR (2026-10-07) — sunucudaki
                  CampaignService (UrunIndirimi dalı) ile aynı kural. Eskiden eşleşmeyince
                  aşağıdaki koşul listesine düşüyordu; kampanyanın ürün listesinde olan HER ürün
                  bu satırın değerini de alıyordu. Bütün satırları aynı değerli eski kampanyada
                  görünmüyordu; ürüne özel kampanyalı fiyatta (her ürünün farkı ayrı) ürün kartı
                  ve müşteri teklifi en büyük farkı uyguluyor, teklif bu yanlış fiyatla
                  kilitleniyordu.
                */
                if (rowStock !== sc) continue
                covers = true
            } else if (rowGroup) {
                covers = rowGroup === campNorm(product.groupCode) || rowGroup === campNorm(product.subGroupCode)
            }
            if (!covers) {
                covers = tip === 5
                    ? categoryConditionMatches(campaign, product)
                    : stockConditionMatches(campaign, sc)
            }
            if (!covers) continue

            const value = discountValueForGroupStrict(discount, priceGroupCode)
            if (value === null) continue

            const oran = String((discount as any)?.iskontoTipiText ?? '').trim() === 'Oran'

            /*
              F4 TABANLI HESAP: birim indirim = Formül(F4) − Formül(F4 − indirim). Tutar
              indirimi TL'dir; F4 başka para birimindeyse (dövizli ürün) kartta kur yok, yanlış
              sayı basmaktansa bu satır atlanır — sepet (sunucu) kuru bilir ve doğru uygular.
            */
            let unitDiscount: number
            const f4 = Number(catalog?.catalogPrice ?? 0)
            if (Number.isFinite(f4) && f4 > 0) {
                if (!oran && !isTryCode(catalog?.catalogCurrency)) continue
                const viaCatalog = kampanyaKatalogIndirimi({
                    katalogFiyati: f4,
                    formul: catalog?.formula,
                    kdvOrani: Number(catalog?.taxRate ?? 0),
                    iskontoOrani: Number(catalog?.discountRate ?? 0),
                    tip: oran ? 'Oran' : 'Tutar',
                    deger: value
                })
                unitDiscount = viaCatalog === null
                    ? (oran ? (price * value) / 100 : value)
                    : viaCatalog
            } else {
                unitDiscount = oran ? (price * value) / 100 : value
            }
            if (!Number.isFinite(unitDiscount) || unitDiscount <= 0) continue

            const newPrice = Math.max(0, price - unitDiscount)
            if (best === null || newPrice < best.newPrice) {
                best = {
                    oldPrice: price,
                    newPrice,
                    unitDiscount: price - newPrice,
                    campaignName: String((campaign as any)?.name ?? ''),
                    discountType: oran ? 'Oran' : 'Tutar',
                    percent: oran ? value : null
                }
            }
        }
    }

    return best
}
