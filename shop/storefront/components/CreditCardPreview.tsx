'use client'

import { Wifi } from 'lucide-react'
import { motion } from 'framer-motion'
import React, { useMemo, useState } from 'react'

/**
 * B2B panelindeki Sanal POS kart görseliyle BİREBİR aynı bileşen (2026-09-13 kullanıcı isteği:
 * "sanal pos sayfasındakinin aynısı olsun banka tanıması felan"). Kaynak:
 * frontend/src/app/components/CreditCard.tsx — mağaza tarafında aynı paket kurulumları
 * (framer-motion, lucide-react) yapılıp değişmeden taşındı.
 */

export type CardType = 'visa' | 'mastercard' | 'amex' | 'troy' | 'discover' | 'jcb' | 'unionpay'
export type BankVariant =
  | 'isbank'
  | 'garanti'
  | 'yapikredi'
  | 'akbank'
  | 'ziraat'
  | 'halkbank'
  | 'qnb'
  | 'denizbank'
  | 'teb'
  | 'enpara'
  | 'albaraka'
  | 'kuveytturk'

export type ThemeVariant = 'gradient-blue' | 'gradient-purple' | 'gradient-gold' | 'gradient-red' | 'black'

export type CreditCardProps = {
  cardNumber: string
  cardHolder: string
  expiryDate: string
  cvv: string
  cardType: CardType | ''
  bankName: string
  variant?: BankVariant | ThemeVariant
  hasContactless?: boolean
  flipped?: boolean
  onFlippedChange?: (next: boolean) => void
}

const bankGradients: Record<BankVariant, string> = {
  isbank: 'bg-gradient-to-br from-blue-900 via-blue-800 to-blue-900',
  garanti: 'bg-gradient-to-br from-green-600 via-green-700 to-green-800',
  yapikredi: 'bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800',
  akbank: 'bg-gradient-to-br from-red-600 via-red-700 to-red-800',
  ziraat: 'bg-gradient-to-br from-green-700 via-green-800 to-green-900',
  halkbank: 'bg-gradient-to-br from-blue-800 via-blue-900 to-slate-900',
  qnb: 'bg-gradient-to-br from-purple-800 via-purple-900 to-indigo-900',
  denizbank: 'bg-gradient-to-br from-blue-500 via-blue-600 to-cyan-700',
  teb: 'bg-gradient-to-br from-cyan-600 via-cyan-700 to-blue-800',
  enpara: 'bg-gradient-to-br from-orange-500 via-orange-600 to-orange-700',
  albaraka: 'bg-gradient-to-br from-teal-700 via-teal-800 to-teal-900',
  kuveytturk: 'bg-gradient-to-br from-emerald-600 via-emerald-700 to-emerald-800'
}

const themeGradients: Record<ThemeVariant, string> = {
  'gradient-blue': 'bg-gradient-to-br from-blue-900 via-blue-700 to-indigo-900',
  'gradient-purple': 'bg-gradient-to-br from-purple-800 via-purple-900 to-indigo-950',
  'gradient-gold': 'bg-gradient-to-br from-amber-500 via-yellow-600 to-orange-700',
  'gradient-red': 'bg-gradient-to-br from-rose-700 via-red-700 to-red-900',
  black: 'bg-gradient-to-br from-zinc-950 via-zinc-900 to-black'
}

const digitsOnly = (v: string) => String(v ?? '').replace(/\D+/g, '')

const formatCardNumberMasked = (input: string) => {
  const d = digitsOnly(input).slice(0, 16)
  const masked = (d + '################').slice(0, 16)
  return masked.replace(/(.{4})/g, '$1 ').trim().replace(/#/g, '•')
}

const formatExpiryMasked = (input: string) => {
  const d = digitsOnly(input).slice(0, 4)
  if (d.length <= 2) return d
  return `${d.slice(0, 2)}/${d.slice(2)}`
}

const formatCvvMasked = (input: string) => {
  const d = digitsOnly(input).slice(0, 3)
  return (d || '***').padEnd(3, '•')
}

function Chip() {
  return (
    <div className="w-12 h-10 rounded-lg bg-gradient-to-br from-amber-300 via-amber-400 to-yellow-500 shadow-inner border border-amber-200">
      <div className="h-full w-full rounded-lg border border-black/10 p-1">
        <div className="h-full w-full rounded-md border border-black/10" />
      </div>
    </div>
  )
}

function LogoVisa() {
  return (
    <div className="bg-white rounded px-6 py-2">
      <svg width="56" height="18" viewBox="0 0 56 18" xmlns="http://www.w3.org/2000/svg">
        <text x="0" y="14" fill="#1434CB" fontSize="16" fontWeight="800" fontFamily="ui-sans-serif, system-ui">
          VISA
        </text>
      </svg>
    </div>
  )
}

function LogoMastercard() {
  return (
    <div className="bg-white/10 rounded px-4 py-2">
      <svg width="54" height="20" viewBox="0 0 54 20" xmlns="http://www.w3.org/2000/svg">
        <circle cx="22" cy="10" r="9" fill="#EB001B" />
        <circle cx="32" cy="10" r="9" fill="#F79E1B" />
        <circle cx="27" cy="10" r="9" fill="#FF5F00" opacity="0.85" />
      </svg>
    </div>
  )
}

function LogoAmex() {
  return (
    <div className="rounded px-5 py-2" style={{ background: '#006FCF' }}>
      <svg width="66" height="18" viewBox="0 0 66 18" xmlns="http://www.w3.org/2000/svg">
        <text x="0" y="14" fill="#ffffff" fontSize="14" fontWeight="800" fontFamily="ui-sans-serif, system-ui">
          AMEX
        </text>
      </svg>
    </div>
  )
}

function LogoTroy() {
  return (
    <div className="bg-white rounded px-5 py-2">
      <svg width="60" height="18" viewBox="0 0 60 18" xmlns="http://www.w3.org/2000/svg">
        <text x="0" y="14" fill="#00A651" fontSize="14" fontWeight="900" fontFamily="ui-sans-serif, system-ui">
          TROY
        </text>
      </svg>
    </div>
  )
}

function LogoDiscover() {
  return (
    <div className="rounded px-5 py-2" style={{ background: '#FF6000' }}>
      <svg width="86" height="18" viewBox="0 0 86 18" xmlns="http://www.w3.org/2000/svg">
        <text x="0" y="14" fill="#ffffff" fontSize="14" fontWeight="800" fontFamily="ui-sans-serif, system-ui">
          DISCOVER
        </text>
      </svg>
    </div>
  )
}

function LogoJcb() {
  return (
    <div className="bg-white rounded px-4 py-2">
      <svg width="70" height="18" viewBox="0 0 70 18" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="22" height="18" fill="#004B9B" />
        <rect x="24" y="0" width="22" height="18" fill="#E4002B" />
        <rect x="48" y="0" width="22" height="18" fill="#00A651" />
      </svg>
    </div>
  )
}

function LogoUnionPay() {
  return (
    <div className="rounded px-5 py-2" style={{ background: '#0B5ED7' }}>
      <svg width="86" height="18" viewBox="0 0 86 18" xmlns="http://www.w3.org/2000/svg">
        <circle cx="14" cy="9" r="7" fill="#d32f2f" opacity="0.95" />
        <circle cx="21" cy="9" r="7" fill="#1976d2" opacity="0.9" />
        <text x="34" y="13" fill="#ffffff" fontSize="12" fontWeight="800" fontFamily="ui-sans-serif, system-ui">
          银联
        </text>
      </svg>
    </div>
  )
}

function CardLogo({ type }: { type: CardType }) {
  switch (type) {
    case 'visa':
      return <LogoVisa />
    case 'mastercard':
      return <LogoMastercard />
    case 'amex':
      return <LogoAmex />
    case 'troy':
      return <LogoTroy />
    case 'discover':
      return <LogoDiscover />
    case 'jcb':
      return <LogoJcb />
    case 'unionpay':
      return <LogoUnionPay />
    default:
      return null
  }
}

export default function CreditCardPreview({
  cardNumber,
  cardHolder,
  expiryDate,
  cvv,
  cardType,
  bankName,
  variant = 'gradient-blue',
  hasContactless = true,
  flipped,
  onFlippedChange
}: CreditCardProps) {
  const [uncontrolledFlipped, setUncontrolledFlipped] = useState(false)
  const isFlipped = flipped ?? uncontrolledFlipped

  const setFlippedSafe = (next: boolean) => {
    if (flipped === undefined) setUncontrolledFlipped(next)
    onFlippedChange?.(next)
  }

  const gradientClass = useMemo(() => {
    if (variant in bankGradients) return bankGradients[variant as BankVariant]
    if (variant in themeGradients) return themeGradients[variant as ThemeVariant]
    return themeGradients['gradient-blue']
  }, [variant])

  const holderText = String(cardHolder ?? '').trim() ? String(cardHolder).toUpperCase() : ''
  const expiryText = formatExpiryMasked(expiryDate || '') || 'AA/YY'
  const numberText = formatCardNumberMasked(cardNumber || '')
  const numberDigitsLen = digitsOnly(cardNumber || '').length
  const bankText = String(bankName ?? '').trim()
  const isCardTypeKnown = Boolean(String(cardType ?? '').trim())
  const safeCardType: CardType | null = isCardTypeKnown ? (cardType as CardType) : null
  const showDetectedMeta = numberDigitsLen >= 6
  const shouldShowBank = showDetectedMeta && bankText && !/tespit\s*edilemedi/i.test(bankText)

  return (
    <div className="w-full">
      <div className="[perspective:1000px]">
        <motion.button
          type="button"
          className="block w-full max-w-[420px] mx-auto"
          style={{ containerType: 'inline-size' }}
          onClick={() => setFlippedSafe(!isFlipped)}
          whileHover={{ scale: 1.01 }}
          transition={{ type: 'spring', stiffness: 100, damping: 14 }}
        >
          <motion.div
            className="relative w-full aspect-[1.586/1] rounded-2xl shadow-2xl"
            animate={{ rotateY: isFlipped ? 180 : 0 }}
            transition={{ type: 'spring', stiffness: 100, damping: 14, duration: 0.6 }}
            style={{ transformStyle: 'preserve-3d' }}
          >
            <div
              className={`absolute inset-0 rounded-2xl overflow-hidden ${gradientClass}`}
              style={{ backfaceVisibility: 'hidden' }}
            >
              <div
                className="absolute inset-0"
                style={{
                  background:
                    'radial-gradient(120% 90% at 12% 0%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 38%, transparent 68%)'
                }}
              />
              <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/15" />
              <div
                className="absolute inset-x-0 top-0 h-px"
                style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)' }}
              />

              <div className="relative h-full p-[6%] text-white flex flex-col justify-between">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {shouldShowBank && (
                      <div className="text-[clamp(9px,2.4cqw,12px)] font-semibold tracking-[0.16em] uppercase text-white/85 truncate">
                        {bankText}
                      </div>
                    )}
                  </div>
                  {hasContactless && (
                    <Wifi size={18} className="rotate-90 shrink-0 text-white/70" />
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <Chip />
                  {showDetectedMeta && safeCardType ? <CardLogo type={safeCardType} /> : <div />}
                </div>

                <div className="font-mono tabular-nums text-[clamp(13px,5.2cqw,22px)] tracking-[0.14em] text-white drop-shadow-sm">
                  {numberText}
                </div>

                <div className="flex items-end justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-[clamp(7px,1.8cqw,9px)] uppercase tracking-[0.18em] text-white/50">
                      Kart Sahibi
                    </div>
                    <div className="mt-0.5 text-[clamp(11px,3.4cqw,15px)] font-medium tracking-wide truncate">
                      {holderText || ' '}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[clamp(7px,1.8cqw,9px)] uppercase tracking-[0.18em] text-white/50">
                      Son Kullanma
                    </div>
                    <div className="mt-0.5 text-[clamp(11px,3.4cqw,15px)] font-medium tracking-wide tabular-nums">
                      {expiryText}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div
              className={`absolute inset-0 rounded-2xl overflow-hidden ${gradientClass}`}
              style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
            >
              <div
                className="absolute inset-0"
                style={{
                  background:
                    'radial-gradient(110% 80% at 88% 100%, rgba(0,0,0,0.28) 0%, transparent 62%)'
                }}
              />
              <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10" />

              <div className="relative h-full text-white flex flex-col">
                <div className="h-[15%] min-h-8 bg-black/75 mt-[7%]" />

                <div className="px-[6%] mt-[6%] flex-1 flex flex-col">
                  <div className="flex items-center gap-2">
                    <div
                      className="flex-1 h-9 rounded-[3px]"
                      style={{
                        background:
                          'repeating-linear-gradient(-45deg, #e8e8e8 0 6px, #dcdcdc 6px 12px)'
                      }}
                    />
                    <div className="h-9 px-3 rounded-[3px] bg-white flex items-center">
                      <span className="font-mono tabular-nums text-[clamp(11px,3.2cqw,15px)] font-semibold text-slate-900 tracking-[0.2em]">
                        {formatCvvMasked(cvv)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-[5%] text-[clamp(7px,1.9cqw,10px)] leading-relaxed text-white/45">
                    Bu kart sahibinin malıdır ve talep üzerine iade edilmelidir.
                  </div>

                  <div className="mt-auto pb-[6%] flex items-end justify-between">
                    {shouldShowBank && (
                      <div className="text-[clamp(7px,1.9cqw,10px)] uppercase tracking-[0.16em] text-white/40 truncate">
                        {bankText}
                      </div>
                    )}
                    {showDetectedMeta && safeCardType ? (
                      <div className="opacity-70 scale-[0.8] origin-bottom-right">
                        <CardLogo type={safeCardType} />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.button>
      </div>

      <div className="text-center text-xs text-gray-500 mt-3">Kartın arka yüzünü görmek için tıklayın</div>
    </div>
  )
}
