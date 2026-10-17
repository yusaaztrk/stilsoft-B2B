import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const ROUTE_TITLE_MAP: Record<string, string> = {
  '/login': 'Giriş Yap',
  '/qr-checkin': 'QR Giriş',
  '/face-checkin': 'Yüz Tanıma Giriş',
  '/404': 'Sayfa Bulunamadı',
  '/home': 'Ana Sayfa',
  '/profile': 'Profilim',

  // Invoice / Fatura Akışları
  '/invoice/siparis': 'Sipariş',
  '/invoice/satis-faturasi': 'Satış Faturası',
  '/invoice/fatura-dokumu': 'Fatura Dökümü',
  '/invoice/fatura-takip': 'Fatura Takip',
  '/invoice/proforma': 'Proforma Fatura',
  '/invoice/musteri-teklifi': 'Müşteri Teklifi',
  '/invoice/cari-teklifleri': 'Cari Teklifleri',
  '/invoice/bayi-teklifleri': 'Bayi Teklifleri',
  '/invoice/magaza-siparis': 'Mağaza Sipariş',
  '/invoice/alis-faturalari': 'Alış Siparişleri',
  '/invoice/depo-transfer': 'Depo Transfer',
  '/invoice/stok-hareket': 'Stok Hareketleri',
  '/invoice/depo-bakiye': 'Depo Bakiye',
  '/invoice/konsinye': 'Konsinye İrsaliye',
  '/invoice/etiket-basim-fiyatli': 'Etiket Basım (Fiyatlı)',
  '/invoice/etiket-basim-fiyatsiz': 'Etiket Basım (Fiyatsız)',
  '/invoice/termin': 'Termin Bilgisi',
  '/invoice': 'Fatura İşlemleri',

  // POS
  '/pos': 'Sanal POS',
  '/virtual-pos/raporlar': 'Sanal POS Raporları',

  // Cash / Kasa
  '/cash': 'Kasa İşlemleri',
  '/cash/virmanListesi': 'Virman Listesi',
  '/cash/kasaTahsilat': 'Kasa Tahsilat',
  '/cash/kasaOdeme': 'Kasa Ödeme',
  '/cash/kasaDevir': 'Kasa Devir',

  // Check / Çek Senet
  '/check': 'Çek / Senet İşlemleri',

  // Bank / Banka
  '/bank': 'Banka İşlemleri',

  // Service / Servis
  '/service': 'Servis İşlemleri',

  // Users / Ayarlar
  '/users/kullaniciListesi': 'Kullanıcı Listesi',
  '/users/allUsers': 'Tüm Kullanıcılar',
  '/users/genelAyarlar': 'Genel Ayarlar',
  '/users/sistemDenetimi': 'Sistem Denetimi',
  '/users/kampanya': 'Kampanya Tanım',
  '/users/kasalarim': 'Kasalarım',
  '/users/depolar': 'Depolar',
  '/users/subeler': 'Şube Tanımları',
  '/users/bankaHesapTanim': 'Banka Hesap Tanımları',
  '/users/rolYetkileri': 'Rol Yetkileri',
  '/users/kategoriYonetimi': 'Kategori Yönetimi',
  '/users/urunYonetimi': 'Ürün Yönetimi',
  '/users/atiliFiyatlandirma': 'Fiyat Atama',
  '/users/fiyatKategorileri': 'Fiyat Kategorileri',
  '/users/cariEkle': 'Cari Ekle',
  '/users/tedarikciEkle': 'Tedarikçi Ekle',
  '/users/silinenKayitlar': 'Silinen Kayıtlar',
  '/users/installmentRules': 'Taksit Bilgileri',
  '/users/bildirimler': 'Bildirimler',
  '/users/userActivities': 'Kullanıcı Hareketleri',
  '/users/maliDonemler': 'Mali Dönemler',
  '/users/systemErrorLogs': 'Hata Logları',
  '/users': 'Ayarlar & Yönetim',

  // Reports / Raporlar
  '/reports/order-report': 'Sipariş Raporu',
  '/reports/kasaRaporlari': 'Kasa Raporları',
  '/reports/yaslandirma': 'Müşteri Yaşlandırma Raporu',
  '/reports/urunSatisRaporuDetayli': 'Ürün Satış Raporu Detaylı',
  '/reports/urunSatisRaporuAylik': 'Ürün Satış Raporu (Aylık)',
  '/reports/fiyatListesi': 'Fiyat Listesi',
  '/reports/cariBorcAlacak': 'Cari Borç / Alacak Raporu',
  '/reports/cariEkstre': 'Cari Ekstre',
  '/reports/yonetimEkstre': 'Yönetim Ekstresi',
  '/reports/bankaRaporlari': 'Banka Raporları',
  '/reports/aktifSepetRaporu': 'Aktif Sepet Raporu',
  '/reports/limitRiskSatisRaporu': 'Limit Risk Satış Raporu',
  '/reports/muhasebeStokGirisCikisRaporu': 'Stok Giriş/Çıkış Raporu',
  '/reports/accountingSalesReport': 'Muhasebe Satış Raporu',
  '/reports/satisPazarlamaRaporu': 'Satış Pazarlama Raporu',
  '/reports/virmanRaporlari': 'Virman Raporları',
  '/reports': 'Raporlar'
}

function formatPathToTitle(path: string): string {
  const cleanPath = path.split('?')[0].split('#')[0]
  if (ROUTE_TITLE_MAP[cleanPath]) {
    return ROUTE_TITLE_MAP[cleanPath]
  }

  // Exact match for subpath prefixes
  for (const [route, title] of Object.entries(ROUTE_TITLE_MAP)) {
    if (cleanPath === route || cleanPath.startsWith(`${route}/`)) {
      return title
    }
  }

  // Generic fallback formatter
  const segments = cleanPath.split('/').filter(Boolean)
  if (segments.length === 0) return 'Ana Sayfa'

  const lastSegment = segments[segments.length - 1]
  const formatted = lastSegment
    .replace(/([A-Z])/g, ' $1')
    .replace(/[-_]/g, ' ')
    .trim()
  
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

export function useDocumentTitle() {
  const location = useLocation()

  useEffect(() => {
    const pageTitle = formatPathToTitle(location.pathname)
    document.title = `${pageTitle} | B2B ERP`
  }, [location.pathname])
}
