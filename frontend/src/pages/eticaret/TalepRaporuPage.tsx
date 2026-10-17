import React from 'react'
import EticaretAramaRaporu from '../EticaretAramaRaporu'
import { PageHeader } from './shared'

export default function TalepRaporuPage() {
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Talep Raporu" desc="Sizi arayalım talepleri, fotoğrafsız ürünler, stok bekleyenler, aramalar ve sonuç çıkmayan aramalar." />
      <EticaretAramaRaporu />
    </div>
  )
}
