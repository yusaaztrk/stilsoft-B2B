import React from 'react'
import { useOutletContext } from 'react-router-dom'
import VitrinAnasayfaPage from './eticaret/VitrinAnasayfaPage'
import FirmaBilgileriPage from './eticaret/FirmaBilgileriPage'
import OdemeAyarlariPage from './eticaret/OdemeAyarlariPage'
import PazarlamaPage from './eticaret/PazarlamaPage'
import KategorilerPage from './eticaret/KategorilerPage'
import GorsellerPage from './eticaret/GorsellerPage'
import UrunYonetimiPage from './eticaret/UrunYonetimiPage'
import IcerikSayfalariPage from './eticaret/IcerikSayfalariPage'
import SiparislerPage from './eticaret/SiparislerPage'
import UyelerPage from './eticaret/UyelerPage'
import KataloglarPage from './eticaret/KataloglarPage'
import KampanyalarPage from './eticaret/KampanyalarPage'
import TalepRaporuPage from './eticaret/TalepRaporuPage'
import AnalitikPage from './eticaret/AnalitikPage'
import MutabakatPage from './eticaret/MutabakatPage'

type LayoutContext = { activeMenuId: string; activeTabId?: string }

/*
  E-TİCARET MODÜLÜ — YÖNLENDİRİCİ (2026-09-21).

  Eskiden bu dosya ~3.900 satırlık tek bileşendi: bütün sekmeler, formlar, modallar tek state
  havuzunda. Artık her ekran `./eticaret/*Page.tsx` içinde ayrı bir sayfa; burada yalnız
  `/eticaret/<key>` → sayfa eşlemesi var. Anahtarlar AppLayout'taki `eticaretTabs` ve ERP'deki
  `Pages` tablosuyla (ModuleKey='eticaret') birebir aynı — sayfa görünürlüğü Rol Yetkileri'nden.
*/
export const ETICARET_PAGES: Record<string, React.ComponentType> = {
  vitrin: VitrinAnasayfaPage,
  firmaBilgileri: FirmaBilgileriPage,
  odeme: OdemeAyarlariPage,
  pazarlama: PazarlamaPage,
  kategoriler: KategorilerPage,
  gorseller: GorsellerPage,
  urunYayin: UrunYonetimiPage,
  sayfalar: IcerikSayfalariPage,
  siparisler: SiparislerPage,
  uyeler: UyelerPage,
  kataloglar: KataloglarPage,
  kampanyalar: KampanyalarPage,
  arama: TalepRaporuPage,
  analitik: AnalitikPage,
  mutabakat: MutabakatPage
}

export default function EticaretPage() {
  const { activeTabId } = useOutletContext<LayoutContext>()
  const key = activeTabId || 'siparisler'
  const Page = ETICARET_PAGES[key] ?? SiparislerPage
  // Sekme değişince bileşen baştan kurulsun (state karışmasın).
  return <Page key={key} />
}
