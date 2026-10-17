import React, { useMemo, useState } from 'react'
import { X, Search, Filter } from 'lucide-react'
import type { ActiveCampaignDto } from '../../api/campaigns'
import { CAMPAIGN_BACKGROUNDS, parseCampaignDescription } from '../../utils/campaignBgHelper'

type Props = {
    isOpen: boolean
    onClose: () => void
    campaigns: ActiveCampaignDto[]
}

export default function CampaignsListModal({ isOpen, onClose, campaigns }: Props) {
    const [searchTerm, setSearchTerm] = useState('')
    const [filterType, setFilterType] = useState<string>('all')

    const filteredCampaigns = useMemo(() => {
        let filtered = campaigns

        // Search filter
        if (searchTerm.trim()) {
            const term = searchTerm.toLowerCase()
            filtered = filtered.filter(
                (c) =>
                    c.name.toLowerCase().includes(term) ||
                    (c.description && c.description.toLowerCase().includes(term))
            )
        }

        // Type filter
        if (filterType !== 'all') {
            filtered = filtered.filter((c) => String(c.kampanyaTipi) === filterType)
        }

        return filtered
    }, [campaigns, searchTerm, filterType])

    if (!isOpen) return null

    const getCampaignTypeText = (campaign: ActiveCampaignDto) => {
        const apiText = String((campaign as any)?.kampanyaTipiText ?? '').trim()
        if (apiText) return apiText

        const type = Number((campaign as any)?.kampanyaTipi ?? 0)
        const types: Record<number, string> = {
            1: 'Sepet Toplam İndirimi',
            2: 'Adet Bazlı Kademeli İndirim',
            3: 'X Alana Y Hediye / İndirimli Ürün',
            4: 'Seçili Ürün İndirimi',
            5: 'Kategori/Marka İndirimi',
            6: 'Paket Kampanya'
        }
        return types[type] || 'Diğer'
    }

    const getDiscountText = (campaign: ActiveCampaignDto) => {
        if (campaign.discounts.length === 0) return null
        const discount = campaign.discounts[0]
        if (discount.iskontoTipiText === 'Oran') {
            return `%${discount.deger} İndirim`
        }
        return `${discount.deger} TL İndirim`
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 sm:p-6" onClick={onClose}>
            <div
                className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col border border-slate-100 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
                    <div>
                        <h2 className="text-xl font-bold text-slate-800">Aktif Kampanyalar</h2>
                        <p className="text-xs text-slate-400 mt-1">Sistemde tanımlı tüm kampanyaları inceleyin</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
                        aria-label="Close"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Search and Filter */}
                <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                    <div className="flex flex-col sm:flex-row gap-3">
                        {/* Search */}
                        <div className="flex-1 relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                            <input
                                type="text"
                                placeholder="Kampanya ara..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full h-10 pl-10 pr-4 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none"
                            />
                        </div>

                        {/* Filter */}
                        <div className="relative">
                            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                            <select
                                value={filterType}
                                onChange={(e) => setFilterType(e.target.value)}
                                className="pl-10 pr-8 h-10 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 appearance-none bg-white font-medium text-slate-700 min-w-[200px]"
                            >
                                <option value="all">Tüm Kampanyalar</option>
                                <option value="1">Sepet Toplam İndirimi</option>
                                <option value="2">Adet Bazlı Kademeli İndirim</option>
                                <option value="3">X Alana Y Hediye / İndirimli Ürün</option>
                                <option value="4">Seçili Ürün İndirimi</option>
                                <option value="5">Kategori/Marka İndirimi</option>
                                <option value="6">Paket Kampanya</option>
                            </select>
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-xs">▼</span>
                        </div>
                    </div>
                </div>

                {/* Campaigns List */}
                <div className="flex-1 overflow-y-auto p-6 bg-slate-50/20">
                    {filteredCampaigns.length === 0 ? (
                        <div className="text-center py-16 text-slate-400">
                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-3 text-slate-300"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                            <p className="text-sm font-medium">Uyumlu kampanya bulunamadı</p>
                            <p className="text-xs mt-1 text-slate-400">Filtreleri veya arama kriterlerini değiştirip tekrar deneyin</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {filteredCampaigns.map((campaign) => {
                                const parsed = parseCampaignDescription(campaign.description)
                                const customBg = CAMPAIGN_BACKGROUNDS.find((bg) => bg.id === parsed.bgId)

                                return (
                                    <div
                                        key={campaign.id}
                                        className={`border rounded-xl p-5 hover:shadow-lg transition-all duration-300 flex flex-col justify-between ${
                                            customBg ? 'border-slate-200 bg-white text-slate-800' : 'border-slate-100 bg-white text-slate-800'
                                        }`}
                                        style={customBg ? { background: customBg.style } : undefined}
                                    >
                                        <div>
                                            {/* Discount Tag Badge (if any) */}
                                            {getDiscountText(campaign) && (
                                                <div className="flex items-start justify-end mb-2">
                                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-100 border border-emerald-300/30">
                                                        {getDiscountText(campaign)}
                                                    </span>
                                                </div>
                                            )}

                                            {/* Campaign Name */}
                                            <h3
                                                className="text-base font-bold mb-2 leading-snug font-montserrat"
                                                style={{
                                                    color: parsed.textColor || (customBg ? customBg.textColor : undefined),
                                                    textShadow: customBg ? customBg.textShadow : undefined,
                                                    fontFamily: 'Montserrat, sans-serif',
                                                    fontWeight: 700
                                                }}
                                            >
                                                {campaign.name}
                                            </h3>

                                            {/* Campaign Description */}
                                            {parsed.description && (
                                                <p
                                                    className="text-xs mb-4 leading-relaxed line-clamp-3 font-montserrat opacity-90"
                                                    style={{
                                                        color: parsed.textColor || (customBg ? customBg.textColor : 'rgb(100 116 139)'),
                                                        textShadow: customBg ? customBg.textShadow : undefined,
                                                        fontFamily: 'Montserrat, sans-serif',
                                                        fontWeight: 400
                                                    }}
                                                >
                                                    {parsed.description}
                                                </p>
                                            )}
                                        </div>

                                        {/* Campaign Footer Metadata */}
                                        <div className={`pt-3 border-t flex flex-col gap-1.5 mt-auto ${
                                            customBg ? 'border-white/20' : 'border-slate-100'
                                        }`}>
                                            <div
                                                className="flex items-center justify-between text-[11px] font-montserrat"
                                                style={{
                                                    color: parsed.textColor || (customBg ? customBg.textColor : 'rgb(100 116 139)'),
                                                    textShadow: customBg ? customBg.textShadow : undefined,
                                                    opacity: 0.95
                                                }}
                                            >
                                                <span className="font-semibold">Geçerlilik Tarihi:</span>
                                                {campaign.startDate && campaign.endDate ? (
                                                    <span className="font-medium">
                                                        {new Date(campaign.startDate).toLocaleDateString('tr-TR')} - {new Date(campaign.endDate).toLocaleDateString('tr-TR')}
                                                    </span>
                                                ) : (
                                                    <span className="font-medium">Süresiz</span>
                                                )}
                                            </div>

                                            {/* Minimum Basket Amount */}
                                            {campaign.discounts.length > 0 && campaign.discounts[0].minSepetTutari > 0 && (
                                                <div
                                                    className="flex items-center justify-between text-[11px] font-montserrat"
                                                    style={{
                                                        color: parsed.textColor || (customBg ? customBg.textColor : 'rgb(100 116 139)'),
                                                        textShadow: customBg ? customBg.textShadow : undefined,
                                                        opacity: 0.95
                                                    }}
                                                >
                                                    <span className="font-semibold">Min. Sepet Tutarı:</span>
                                                    <span className="font-bold">
                                                        {campaign.discounts[0].minSepetTutari} TL
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex justify-between items-center">
                    <p className="text-xs text-slate-400 font-medium">
                        Toplam <span className="font-bold text-slate-600">{filteredCampaigns.length}</span> kampanya gösteriliyor
                    </p>
                    <button
                        onClick={onClose}
                        className="h-9 px-4 bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-semibold rounded-lg transition-colors focus:outline-none"
                    >
                        Kapat
                    </button>
                </div>
            </div>
        </div>
    )
}
