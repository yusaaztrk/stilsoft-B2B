import React from 'react'
import EticaretKataloglarSection from '../EticaretKataloglarSection'
import { PageHeader } from './shared'

export default function KataloglarPage() {
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Kataloglar" desc="Anasayfadaki PDF kataloglar." />
      <EticaretKataloglarSection />
    </div>
  )
}
