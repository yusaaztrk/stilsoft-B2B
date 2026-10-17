import React from 'react'
import EticaretKampanyalarSection from '../EticaretKampanyalarSection'
import EticaretKampanyaSms from '../EticaretKampanyaSms'
import { PageHeader } from './shared'

export default function KampanyalarPage() {
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Kampanyalar" desc="B2B kampanyalarından hangileri vitrinde uygulanacak; anahtar açıkken indirim Fiyat 4 üzerinden düşer. Altta üyelere kampanya SMS'i." />
      <EticaretKampanyalarSection />
      <EticaretKampanyaSms />
    </div>
  )
}
