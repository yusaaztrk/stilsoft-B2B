import React from 'react'
import { X } from 'lucide-react'
import type { ActiveCampaignDto } from '../../api/campaigns'
import { CAMPAIGN_BACKGROUNDS, parseCampaignDescription } from '../../utils/campaignBgHelper'

type Props = {
    isOpen: boolean
    onClose: () => void
    campaigns: ActiveCampaignDto[]
    productName?: string
    campaign?: ActiveCampaignDto | null
}

export default function CampaignDetailPopover({ isOpen, onClose, campaigns, productName, campaign }: Props) {
    const list = campaign ? [campaign] : campaigns
    if (!isOpen || list.length === 0) return null

    const getDiscountText = (campaign: ActiveCampaignDto) => {
        if (campaign.discounts.length === 0) return null
        const discount = campaign.discounts[0]
        if (discount.iskontoTipiText === 'Oran') {
            return `%${discount.deger} İndirim`
        }
        return `${discount.deger} TL İndirim`
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <div
                className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="bg-white border-b px-5 py-4 flex items-center justify-between shrink-0">
                    <h3 className="text-base font-bold text-gray-900 font-montserrat">
                        {campaign ? 'Kampanya Detayı' : productName ? `${productName} - Kampanyalar` : 'Kampanyalar'}
                    </h3>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-gray-100 rounded-full transition-colors text-gray-400 hover:text-gray-600"
                        aria-label="Close"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Campaigns List */}
                <div className="p-4 space-y-3 overflow-y-auto flex-1 min-h-0">
                    {list.map((c) => {
                        const parsed = parseCampaignDescription(c.description)
                        const customBg = CAMPAIGN_BACKGROUNDS.find((bg) => bg.id === parsed.bgId)
                        const textColor = parsed.textColor || (customBg ? customBg.textColor : undefined)
                        const textShadow = customBg ? customBg.textShadow : undefined

                        return (
                            <div
                                key={c.id}
                                className={`border rounded-xl p-4 transition-all shadow-xs flex flex-col ${
                                    customBg ? 'border-white/20' : 'border-gray-200 bg-gradient-to-r from-orange-50/60 to-red-50/60'
                                }`}
                                style={customBg ? { background: customBg.style } : undefined}
                            >
                                {/* Discount Badge */}
                                {getDiscountText(c) && (
                                    <div className="flex items-center justify-end mb-2">
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-100 border border-emerald-300/30">
                                            {getDiscountText(c)}
                                        </span>
                                    </div>
                                )}

                                {/* Campaign Name */}
                                <h4
                                    className="font-bold text-base mb-1.5 leading-snug font-montserrat"
                                    style={{
                                        color: textColor || '#111827',
                                        textShadow: textShadow || 'none'
                                    }}
                                >
                                    {c.name}
                                </h4>

                                {/* Campaign Description */}
                                {parsed.description && (
                                    <p
                                        className="text-xs mb-3 leading-relaxed font-montserrat opacity-90"
                                        style={{
                                            color: textColor || '#4b5563',
                                            textShadow: textShadow || 'none'
                                        }}
                                    >
                                        {parsed.description}
                                    </p>
                                )}

                                {/* Campaign Dates & Metadata */}
                                <div
                                    className={`pt-3 border-t flex flex-col gap-1 mt-auto text-[11px] font-montserrat ${
                                        customBg ? 'border-white/20' : 'border-gray-200'
                                    }`}
                                    style={{
                                        color: textColor || '#6b7280',
                                        textShadow: textShadow || 'none',
                                        opacity: 0.95
                                    }}
                                >
                                    {c.startDate && c.endDate && (
                                        <div className="flex items-center justify-between">
                                            <span className="font-semibold">Geçerlilik Tarihi:</span>
                                            <span className="font-medium">
                                                {new Date(c.startDate).toLocaleDateString('tr-TR')} -{' '}
                                                {new Date(c.endDate).toLocaleDateString('tr-TR')}
                                            </span>
                                        </div>
                                    )}

                                    {c.discounts.length > 0 && c.discounts[0].minSepetTutari > 0 && (
                                        <div className="flex items-center justify-between">
                                            <span className="font-semibold">Min. Sepet Tutarı:</span>
                                            <span className="font-bold">{c.discounts[0].minSepetTutari} TL</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>

                {/* Footer */}
                <div className="bg-white border-t p-3 shrink-0">
                    <button
                        onClick={onClose}
                        className="w-full px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold text-xs rounded-lg transition-colors"
                    >
                        Kapat
                    </button>
                </div>
            </div>
        </div>
    )
}
