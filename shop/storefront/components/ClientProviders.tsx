'use client'

import React from 'react'
import { CartProvider } from '@/context/CartContext'
import { StorefrontProvider } from '@/context/StorefrontContext'
import CartDrawer from '@/components/CartDrawer'
import AfterAddModal from '@/components/AfterAddModal'
import WhatsAppWidget from '@/components/WhatsAppWidget'
import VisitTracker from '@/components/VisitTracker'
import MarketingTracker from '@/components/MarketingTracker'

export default function ClientProviders({
  children,
  whatsAppNumber,
  lowStockThreshold,
  deliveryPromise,
}: {
  children: React.ReactNode
  whatsAppNumber?: string
  /** Bayi panelindeki "son N adet" eşiği; ürün kartları buradan okuyor. */
  lowStockThreshold?: number
  /** Bayi panelindeki teslimat vaadi; sepet çekmecesi buradan okuyor. */
  deliveryPromise?: string
}) {
  return (
    <StorefrontProvider value={{ lowStockThreshold, deliveryPromise }}>
      <CartProvider>
        {children}
        <CartDrawer />
        <AfterAddModal />
        <WhatsAppWidget number={whatsAppNumber} />
        {/*
          Ziyaret hunisi (2026-09-21) — ekrana hiçbir şey basmaz. Burada, yani her sayfada:
          adım adresten türetiliyor, tek tek sayfalara çağrı serpiştirmek birinin unutulması
          demekti.
        */}
        <VisitTracker />
        {/* Reklam ölçümü (2026-10-15): kaynak etiketi + telefon/WhatsApp tıklamaları. */}
        <MarketingTracker />
      </CartProvider>
    </StorefrontProvider>
  )
}
