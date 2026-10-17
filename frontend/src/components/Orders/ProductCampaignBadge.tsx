import React from 'react'
import { Gift } from 'lucide-react'
import type { ActiveCampaignDto } from '../../api/campaigns'
import { campaignAppliesToPriceGroup } from '../../services/campaignApplier'

type Props = {
    productStockCode: string
    productCategory?: string | null
    productSubCategory?: string | null
    /**
     * Marka alanları. Kampanyanın marka süzgeci `brandField` ile HANGİ alana bakılacağını
     * söylüyor (KOD4 / KOD5 / alt kategori); bu iki alan gelmezse KOD4-KOD5 üzerine kurulmuş
     * kampanyalar doğru eşleşemez.
     */
    productKod4?: string | null
    productKod5?: string | null
    campaigns: ActiveCampaignDto[]
    /**
     * Seçili carinin fiyat grubu kodu. Verilirse yalnız bu gruba UYGULANAN kampanyalar
     * rozet çıkarır (2026-09-21): kampanya 1-2-3'e tanımlıyken 7 (askeriye) carisinde de
     * hediye ikonu çıkıyor, kartta üstü çizili fiyat gelmeyince "kampanya çalışmıyor"
     * sanılıyordu. Grup bilinmiyorsa (undefined) eski davranış.
     */
    priceGroupCode?: number
    onClick?: () => void
    position?: 'top-left' | 'top-right'
    className?: string
}

export default function ProductCampaignBadge({ productStockCode, productCategory, productSubCategory, productKod4, productKod5, campaigns, priceGroupCode, onClick, position = 'top-right', className }: Props) {
    const norm = (v: unknown) => String(v ?? '').trim().toUpperCase()
    const sc = norm(productStockCode)
    const pc = norm(productCategory)
    const psc = norm(productSubCategory)
    const k4 = norm(productKod4)
    const k5 = norm(productKod5)

    // Find campaigns applicable to this product
    const applicableCampaigns = (campaigns ?? []).filter((campaign) => {
        if (!campaign) return false
        if (!campaignAppliesToPriceGroup(campaign, priceGroupCode)) return false
        // 1. Check conditions
        for (const condition of campaign.conditions ?? []) {
            if (!condition) continue
            const json = String(condition.productStockCodesJson ?? '').trim()
            if (json) {
                try {
                    const parsed = JSON.parse(json)
                    // If QuantityTierTargets format (Type 2 targets object)
                    if (parsed && typeof parsed === 'object' && ('ProductStockCodes' in parsed || 'GroupCodes' in parsed || 'productStockCodes' in parsed || 'groupCodes' in parsed)) {
                        const targetStocks = (parsed.ProductStockCodes || parsed.productStockCodes || []) as string[]
                        const targetGroups = (parsed.GroupCodes || parsed.groupCodes || []) as string[]

                        const normStocks = targetStocks.map(x => norm(x)).filter(Boolean)
                        const normGroups = targetGroups.map(x => norm(x)).filter(Boolean)

                        const scMatch = sc && normStocks.includes(sc)
                        const catMatch = (pc && normGroups.includes(pc)) || (psc && normGroups.includes(psc))

                        if (normStocks.length > 0) {
                            if (scMatch) return true
                        } else {
                            if (catMatch) return true
                        }
                    } else if (Array.isArray(parsed)) {
                        // Flat array
                        const normalized = parsed.map((x) => norm(x)).filter(Boolean)
                        if (sc && normalized.includes(sc)) return true
                    }
                } catch {
                    // Ignore parsing error
                }
                continue;
            }

            // CategoryBased conditions (like Type 5)
            if (condition.categoryCode) {
                const condCat = norm(condition.categoryCode)
                const isMainMatch = pc && pc === condCat
                const isSubMatch = psc && psc === condCat

                if (isMainMatch || isSubMatch) {
                    // MARKA SÜZGECİ, SUNUCUYLA AYNI ALANA BAKMALI.
                    //
                    // Burada marka kodu HER ZAMAN alt kategoriyle karşılaştırılıyordu. Oysa
                    // sunucu (CampaignService.IsConditionSatisfied) `brandField`e göre karar
                    // veriyor: KOD4 ise Kod4, KOD5 ise Kod5, SUBCATEGORY ise alt kategori.
                    // Sonuç: KOD4/KOD5 üzerine kurulmuş kampanyalarda rozet yanlış ürünlerde
                    // çıkıyor, indirimin gerçekten uygulandığı üründe çıkmıyordu.
                    const brandCode = norm(condition.brandCode)
                    const brandField = norm(condition.brandField)
                    const hasBrandFilter = brandCode.length > 0 && brandField.length > 0

                    if (!hasBrandFilter) {
                        return true
                    }

                    if (brandField === 'KOD4') {
                        if (k4 && k4 === brandCode) return true
                    } else if (brandField === 'KOD5') {
                        if (k5 && k5 === brandCode) return true
                    } else if (brandField === 'SUBCATEGORY') {
                        if (psc && psc === brandCode) return true
                    }
                }
            }
        }

        // 2. Check discounts
        for (const discount of campaign.discounts ?? []) {
            if (!discount) continue
            if (sc && norm(discount.stokKodu) === sc) {
                return true
            }
            /*
              GRUP EŞLEŞMESİ YALNIZ ÜRÜN SEÇİLMEMİŞ SATIRDA (2026-09-18).

              Seçili ürün indiriminde satırda hem stok kodu hem grup kodu duruyordu; buradaki
              grup kontrolü yüzünden rozet kategorinin BÜTÜN ürünlerinde çıkıyordu. Sunucu artık
              ürünlü satıra grup kodu yazmıyor; ESKİ kampanyalarda alan dolu kaldığı için kural
              burada da var: stok kodu olan satır yalnız o ürünü kapsar.
            */
            if (!discount.stokKodu && discount.grupKodu) {
                const discGroup = norm(discount.grupKodu)
                if (pc && pc === discGroup) return true
                if (psc && psc === discGroup) return true
            }
        }

        return false
    })

    if (applicableCampaigns.length === 0) {
        return null
    }

    const isLeft = position === 'top-left' || (className && className.includes('left-'))
    const buttonClass = className || (isLeft
        ? "group absolute top-2 left-2 z-10 bg-indigo-600 text-white p-1.5 rounded-lg shadow-sm border border-indigo-500/10 hover:bg-indigo-700 hover:scale-105 transition-all duration-200"
        : "group absolute top-2 right-2 z-10 bg-indigo-600 text-white p-1.5 rounded-lg shadow-sm border border-indigo-500/10 hover:bg-indigo-700 hover:scale-105 transition-all duration-200")
    
    const tooltipClass = `pointer-events-none invisible group-hover:visible absolute ${isLeft ? 'left-0' : 'right-0'} top-full mt-2.5 z-50 w-72 bg-white border border-slate-100 rounded-xl shadow-lg p-4 text-left transition-all duration-150`

    return (
        <button
            type="button"
            onClick={onClick}
            className={buttonClass}
            title={`${applicableCampaigns.length} kampanya mevcut`}
        >
            <Gift size={15} />
            {applicableCampaigns.length > 1 && (
                <span className="absolute -top-1.5 -right-1.5 bg-emerald-500 text-[9px] font-black text-white rounded-full w-4.5 h-4.5 flex items-center justify-center border border-white">
                    {applicableCampaigns.length}
                </span>
            )}
            {/* Hover Tooltip */}
            <div className={tooltipClass}>
                <div className="text-[10px] font-bold uppercase text-indigo-600 tracking-wider mb-2.5 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                    {applicableCampaigns.length} Kampanya Tanımlı
                </div>
                <div className="space-y-3">
                    {applicableCampaigns.slice(0, 3).map((c) => (
                        <div key={c.id} className="pb-2.5 border-b border-slate-50 last:border-0 last:pb-0">
                            <div className="text-xs font-bold text-slate-800 leading-snug">{c.name}</div>
                            {c.description && (
                                <div className="text-[10px] text-slate-400 mt-0.5 line-clamp-2 leading-relaxed">{c.description}</div>
                            )}
                            {c.discounts?.[0] && (
                                <div className="text-[10px] font-bold text-emerald-600 mt-1">
                                    {c.discounts[0].iskontoTipiText === 'Oran'
                                        ? `%${c.discounts[0].deger} İndirim`
                                        : `${c.discounts[0].deger} TL İndirim`}
                                    {c.discounts[0].minSepetTutari > 0
                                        ? ` (min. ${c.discounts[0].minSepetTutari} TL)` : ''}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
                {applicableCampaigns.length > 3 && (
                    <div className="text-[10px] text-slate-400 font-medium mt-2 pt-2 border-t border-slate-50 text-center">
                        +{applicableCampaigns.length - 3} kampanya daha mevcut
                    </div>
                )}
            </div>
        </button>
    )
}
