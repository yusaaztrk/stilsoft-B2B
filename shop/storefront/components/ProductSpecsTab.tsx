'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CatalogDetail } from '@/lib/api'
import { formatPrice } from '@/lib/format'

export default function ProductSpecsTab({ product }: { product: CatalogDetail }) {
  const [activeTab, setActiveTab] = useState<'desc' | 'specs' | 'delivery'>('desc')

  // Parse features into key-value or item bullets
  const parsedSpecs: { label: string; value: string }[] = []

  // Default core specifications
  if (product.categoryName) {
    parsedSpecs.push({ label: 'Ürün Grubu', value: product.categoryName })
  }
  parsedSpecs.push({ label: 'Marka', value: 'STILSOFT' })
  parsedSpecs.push({ label: 'Model / Stok Kodu', value: product.stockCode })

  if (product.barcode) {
    parsedSpecs.push({ label: 'Barkod / EAN', value: product.barcode })
  }
  if (product.unit) {
    parsedSpecs.push({ label: 'Birim', value: product.unit })
  }
  parsedSpecs.push({ label: 'Garanti Süresi', value: '36 Ay (3 Yıl) Resmi Distribütör Garantisi' })
  parsedSpecs.push({
    label: 'Montaj & Kurulum',
    value: product.isInstallable ? 'Yetkili Servis Ücretsiz Kurulum' : 'Kullanıma Hazır / Tak-Çalıştır',
  })
  parsedSpecs.push({ label: 'Teslimat Bölgesi', value: 'Tüm KKTC (Lefkoşa, Girne, Mağusa, Güzelyurt, İskele)' })

  // Parse extra features if present
  if (product.features && product.features.length > 0) {
    product.features.forEach((feat) => {
      const trimmed = feat.trim()
      if (!trimmed) return

      const parts = trimmed.split(/[:：]/)
      if (parts.length >= 2 && parts[0].trim().length > 1 && parts[1].trim().length > 0) {
        parsedSpecs.push({
          label: parts[0].trim(),
          value: parts.slice(1).join(':').trim(),
        })
      } else {
        // İki nokta içermeyen maddeler için akıllı etiketleme
        let label = 'Ürün Özelliği'
        if (/watt|w|volt|hz|220|240/i.test(trimmed)) label = 'Güç & Gerilim'
        else if (/taban|seramik|çelik|kaplama/i.test(trimmed)) label = 'Taban / Gövde Yapısı'
        else if (/tank|kapasite|lt|ml/i.test(trimmed)) label = 'Kapasite / Hacim'
        else if (/bar|basınç|buhar|gr/i.test(trimmed)) label = 'Buhar & Basınç Performansı'
        else if (/kapanma|emniyet|kilit|güvenlik/i.test(trimmed)) label = 'Güvenlik & Koruma'
        else if (/ısı|ayar|kademe|program/i.test(trimmed)) label = 'Isı & Program Ayarı'
        else if (/kireç|temiz|filtre/i.test(trimmed)) label = 'Bakım & Kireç Önleme'
        else if (/eco|enerji|tasarruf/i.test(trimmed)) label = 'Enerji Yönetimi'

        parsedSpecs.push({
          label,
          value: trimmed,
        })
      }
    })
  }

  return (
    <div className="pdp-details-tabs-wrapper">
      {/* Tab Butonları */}
      <div className="pdp-tabs-nav" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'desc'}
          className={`pdp-tab-btn ${activeTab === 'desc' ? 'active' : ''}`}
          onClick={() => setActiveTab('desc')}
        >
          Ürün Açıklaması
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'specs'}
          className={`pdp-tab-btn ${activeTab === 'specs' ? 'active' : ''}`}
          onClick={() => setActiveTab('specs')}
        >
          Teknik Özellikler ({parsedSpecs.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'delivery'}
          className={`pdp-tab-btn ${activeTab === 'delivery' ? 'active' : ''}`}
          onClick={() => setActiveTab('delivery')}
        >
          Teslimat &amp; Garanti
        </button>
      </div>

      {/* Tab İçerikleri */}
      <div className="pdp-tab-content-box">
        {/* 1. TAB: AÇIKLAMA */}
        {activeTab === 'desc' && (
          <div className="pdp-tab-pane animate-fade">
            <div className="pdp-desc-text">
              <h3>{product.name}</h3>
              <p>
                {product.description ||
                  `${product.name}, Stilsoft kalitesi ve yüksek performansıyla evinizdeki işlerinizi kolaylaştırmak için tasarlandı. Ergonomik tasarımı, enerji tasarrufu ve dayanıklı gövde yapısıyla uzun yıllar güvenle kullanabilirsiniz.`}
              </p>
            </div>

            {/* 4'lü Güvence Vurgu Kartları */}
            <div className="pdp-perks-row">
              <div className="pdp-perk-card">
                <div className="p-accent-bar" />
                <h4>3 Yıl Resmi Garanti</h4>
                <p>KKTC distribütör güvencesiyle 36 ay parça ve işçilik garantisi.</p>
              </div>
              <div className="pdp-perk-card">
                <div className="p-accent-bar" />
                <h4>Ücretsiz Teslimat</h4>
                <p>KKTC genelindeki tüm ilçelere randevulu adrese teslim.</p>
              </div>
              <div className="pdp-perk-card">
                <div className="p-accent-bar" />
                <h4>Orijinal Yedek Parça</h4>
                <p>%100 orijinal Stilsoft fabrika yedek parçaları ile teknik servis.</p>
              </div>
              <div className="pdp-perk-card">
                <div className="p-accent-bar" />
                <h4>Güvenli Alışveriş</h4>
                <p>256-Bit SSL korumalı 3D Secure güvenli ödeme altyapısı.</p>
              </div>
            </div>

            {/* Ekstra Liste Özellikleri */}
            {product.features && product.features.length > 0 && (
              <div className="pdp-bullet-highlights">
                <h4>Öne Çıkan Başlıca Özellikler</h4>
                <div className="highlights-chips-grid">
                  {product.features.map((feat, idx) => (
                    <div key={idx} className="h-chip-item">
                      <span className="h-dot">•</span>
                      <span>{feat}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 2. TAB: TEKNİK ÖZELLİKLER TABLOSU */}
        {activeTab === 'specs' && (
          <div className="pdp-tab-pane animate-fade">
            <div className="pdp-specs-head">
              <h3>Teknik Detaylar ve Ürün Bilgileri</h3>
              <p>Stilsoft tarafından onaylanan resmi ürün özellikleri aşağıda listelenmiştir:</p>
            </div>

            <div className="pdp-table-container">
              <table className="pdp-spec-table">
                <tbody>
                  {parsedSpecs.map((spec, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'even' : 'odd'}>
                      <th>{spec.label}</th>
                      <td>{spec.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 3. TAB: TESLİMAT & GARANTİ */}
        {activeTab === 'delivery' && (
          <div className="pdp-tab-pane animate-fade">
            <div className="pdp-delivery-info-grid">
              <div className="d-info-card">
                <h4>Teslimat Süreci</h4>
                <p>
                  Siparişiniz onaylandıktan sonra sevkiyat ekibimiz sizinle iletişime geçerek uygun olduğunuz gün ve saat aralığında randevu belirler.
                </p>
                <ul>
                  <li>KKTC genelinde tüm ilçelere (Lefkoşa, Girne, Mağusa, Güzelyurt, İskele) <b>ücretsiz teslimat</b> yapılır.</li>
                  <li>Siparişiniz depodan çıkış yapmadan önce özenle kontrol edilir ve faturası düzenlenir.</li>
                </ul>
              </div>

              <div className="d-info-card">
                <h4>Garanti &amp; Yetkili Servis</h4>
                <p>
                  Bu ürün 3 Yıl süreyle Stilsoft KKTC resmi distribütör garantisi altındadır.
                </p>
                <ul>
                  <li>Yetkili servis ve arıza kayıtlarınız için <Link href="/servis" style={{ color: '#d71920', fontWeight: 600 }}>Servis Talebi</Link> sayfamızı kullanabilirsiniz.</li>
                  <li>Detaylı koşullar için <Link href="/garanti" style={{ color: '#d71920', fontWeight: 600 }}>Garanti &amp; İade Koşulları</Link> sayfasını inceleyebilirsiniz.</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
