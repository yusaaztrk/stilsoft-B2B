import React, { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ActiveCampaignDto } from '../../api/campaigns'
import { CAMPAIGN_BACKGROUNDS, parseCampaignDescription } from '../../utils/campaignBgHelper'

type Props = {
    campaigns: ActiveCampaignDto[]
    autoPlayInterval?: number
    onCampaignClick?: (campaign: ActiveCampaignDto) => void
}

export default function CampaignCarousel({ campaigns, autoPlayInterval = 5000, onCampaignClick }: Props) {
    const [currentIndex, setCurrentIndex] = useState(0)
    const [isPaused, setIsPaused] = useState(false)

    const [bannerGradientFrom, setBannerGradientFrom] = useState<string | null>(
        () => localStorage.getItem('campaignBannerGradientFrom') || localStorage.getItem('campaignBannerBgColor') || null
    )
    const [bannerGradientTo, setBannerGradientTo] = useState<string | null>(
        () => localStorage.getItem('campaignBannerGradientTo') || localStorage.getItem('campaignBannerBgColor') || null
    )
    const [bannerTextColor, setBannerTextColor] = useState<string | null>(() => localStorage.getItem('campaignBannerTextColor') || null)

    useEffect(() => {
        const handleBrandingChange = () => {
            setBannerGradientFrom(localStorage.getItem('campaignBannerGradientFrom') || localStorage.getItem('campaignBannerBgColor') || null)
            setBannerGradientTo(localStorage.getItem('campaignBannerGradientTo') || localStorage.getItem('campaignBannerBgColor') || null)
            setBannerTextColor(localStorage.getItem('campaignBannerTextColor') || null)
        }
        window.addEventListener('tenant-branding-changed', handleBrandingChange)
        window.addEventListener('tenant-branding-loaded', handleBrandingChange)
        return () => {
            window.removeEventListener('tenant-branding-changed', handleBrandingChange)
            window.removeEventListener('tenant-branding-loaded', handleBrandingChange)
        }
    }, [])

    useEffect(() => {
        setCurrentIndex(0)
    }, [campaigns])

    useEffect(() => {
        if (campaigns.length <= 1 || isPaused) return

        const interval = setInterval(() => {
            setCurrentIndex((prev) => (prev + 1) % campaigns.length)
        }, autoPlayInterval)

        return () => clearInterval(interval)
    }, [campaigns.length, autoPlayInterval, isPaused])

    if (campaigns.length === 0) {
        return null
    }

    const currentCampaign = campaigns[currentIndex]

    const goToPrevious = () => {
        setCurrentIndex((prev) => (prev - 1 + campaigns.length) % campaigns.length)
    }

    const goToNext = () => {
        setCurrentIndex((prev) => (prev + 1) % campaigns.length)
    }

    const goToSlide = (index: number) => {
        setCurrentIndex(index)
    }

    const parsed = parseCampaignDescription(currentCampaign?.description)
    const customBg = CAMPAIGN_BACKGROUNDS.find((bg) => bg.id === parsed.bgId)

    const fromVal = bannerGradientFrom || '#ffffff'
    const toVal = bannerGradientTo || '#ffffff'
    const defaultBgStyle = fromVal === toVal ? fromVal : `linear-gradient(90deg, ${fromVal}, ${toVal})`

    const bgStyle = customBg ? customBg.style : defaultBgStyle
    const textColor = parsed.textColor || (customBg ? customBg.textColor : (bannerTextColor || undefined))
    const textShadow = customBg ? customBg.textShadow : undefined

    return (
        <div
            className="relative border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-300 h-full flex items-center"
            style={{
                background: bgStyle,
                color: textColor
            }}
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => setIsPaused(false)}
        >
            {/* Campaign Content */}
            <div className="container mx-auto px-2.5 py-1.5 sm:px-6 sm:py-6 relative z-10 w-full">
                <div className="flex items-center justify-between w-full">
                    {/* Left Arrow */}
                    {campaigns.length > 1 && (
                        <button
                            onClick={goToPrevious}
                            className="hidden sm:block p-2 rounded-lg bg-white/90 hover:bg-white border border-slate-200 text-slate-700 hover:text-slate-900 shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-slate-100"
                            aria-label="Previous campaign"
                        >
                            <ChevronLeft size={20} />
                        </button>
                    )}

                    {/* Campaign Info */}
                    <div
                        className="flex-1 mx-1 sm:mx-6 cursor-pointer select-none"
                        onClick={() => onCampaignClick?.(currentCampaign)}
                    >
                        <div className="text-center flex flex-col justify-center">
                            <h2
                                className="text-[11px] sm:text-xl md:text-2xl font-bold tracking-tight sm:mb-1.5 hover:opacity-80 transition-opacity font-montserrat leading-tight"
                                style={{
                                    color: textColor || '#000000',
                                    textShadow: textShadow || 'none',
                                    fontFamily: 'Montserrat, sans-serif',
                                    fontWeight: 700
                                }}
                            >
                                {currentCampaign.name}
                            </h2>
                            {parsed.description && (
                                <p
                                    className="hidden sm:block text-sm max-w-2xl mx-auto line-clamp-2 leading-relaxed font-montserrat mt-1"
                                    style={{
                                        color: textColor || (bannerTextColor ? `${bannerTextColor}cc` : 'rgb(100 116 139)'),
                                        textShadow: textShadow || 'none',
                                        fontFamily: 'Montserrat, sans-serif',
                                        fontWeight: 400
                                    }}
                                >
                                    {parsed.description}
                                </p>
                            )}
                            <div
                                className="flex mt-1 sm:mt-3 text-[9px] sm:text-xs font-medium items-center justify-center gap-1"
                                style={{
                                    color: textColor ? `${textColor}dd` : (bannerTextColor ? `${bannerTextColor}99` : 'rgb(148 163 184)'),
                                    textShadow: textShadow || 'none'
                                }}
                            >
                                <svg className="w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                                {currentCampaign.startDate && currentCampaign.endDate && (
                                    <span>
                                        {new Date(currentCampaign.startDate).toLocaleDateString('tr-TR')} -{' '}
                                        {new Date(currentCampaign.endDate).toLocaleDateString('tr-TR')}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right Arrow */}
                    {campaigns.length > 1 && (
                        <button
                            onClick={goToNext}
                            className="hidden sm:block p-2 rounded-lg bg-white/90 hover:bg-white border border-slate-200 text-slate-700 hover:text-slate-900 shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-slate-100"
                            aria-label="Next campaign"
                        >
                            <ChevronRight size={20} />
                        </button>
                    )}
                </div>

                {/* Dot Indicators */}
                {campaigns.length > 1 && (
                    <div className="hidden sm:flex justify-center gap-1.5 mt-5">
                        {campaigns.map((_, index) => (
                            <button
                                key={index}
                                onClick={() => goToSlide(index)}
                                className={`h-1.5 rounded-full transition-all duration-300 ${index === currentIndex ? 'bg-slate-700 w-6' : 'bg-slate-300 w-1.5 hover:bg-slate-400'
                                    }`}
                                aria-label={`Go to slide ${index + 1}`}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Decorative Background Pattern */}
            <div className="absolute inset-0 opacity-20 pointer-events-none">
                <div className="absolute top-0 left-0 w-48 h-48 bg-slate-400/20 rounded-full -translate-x-1/2 -translate-y-1/2 blur-2xl" />
                <div className="absolute bottom-0 right-0 w-64 h-64 bg-indigo-400/20 rounded-full translate-x-1/3 translate-y-1/3 blur-3xl" />
            </div>
        </div>
    )
}
