'use client'

import React, { useState, useSyncExternalStore } from 'react'
import {
  getChatProduct,
  getChatProductServer,
  subscribeChatProduct,
} from '@/lib/chatContext'
import { trackContact } from '@/lib/track'

/**
 * HAZIR MESAJ ŞABLONLARI.
 *
 * Kullanıcı isteği (2026-09-09): "basınca hazır mesaj şablonları çıksın, seçtiğine basınca
 * ws numaramıza göndersin". Üç şablon vardı; müşterinin en sık yazdığı konular kapsanmıyordu
 * (montaj randevusu, yedek parça, kampanya). Metinler burada TEK yerde duruyor — düğmelerin
 * içine gömülü olsaydı yenisini eklemek her seferinde JSX kopyalamak olurdu.
 *
 * Metinler müşterinin ağzından yazılı ve konuyu açıkça söylüyor: WhatsApp'a düşen ilk satır
 * destek ekibinin sohbeti sınıflandırdığı şey.
 */
const QUICK_TEMPLATES: { icon: string; label: string; message: string }[] = [
  {
    icon: '📦',
    label: 'Siparişimi Sorgula',
    message: 'Merhaba, siparişimin durumu hakkında bilgi almak istiyorum. Sipariş numaram: ',
  },
  {
    icon: '🛠️',
    label: 'Montaj Randevusu',
    message: 'Merhaba, satın aldığım ürün için montaj randevusu oluşturmak istiyorum.',
  },
  {
    icon: '🔧',
    label: 'Arıza & Yetkili Servis',
    message: 'Merhaba, cihazımda bir arıza var. Yetkili servis kaydı açtırmak istiyorum.',
  },
  {
    icon: '🏷️',
    label: 'Fiyat & Stok Bilgisi',
    message: 'Merhaba, bir ürünün güncel fiyatı ve stok durumu hakkında bilgi alabilir miyim?',
  },
  {
    icon: '⚙️',
    label: 'Yedek Parça',
    message: 'Merhaba, cihazım için yedek parça temin etmek istiyorum.',
  },
  {
    icon: '🎁',
    label: 'Kampanya & Set Fiyatı',
    message: 'Merhaba, ankastre set ve güncel kampanyalar hakkında bilgi almak istiyorum.',
  },
]

/**
 * Numara artık panelden geliyor (E-Ticaret → Vitrin Yönetimi → WhatsApp Numarası).
 *
 * Daha önce burada sabit kodlanmış bir numara vardı (`905338408837`) — panelde ayarlanan
 * telefon numarasından tamamen farklı bir formattaydı (KKTC sabit hat değil, TR cep telefonu)
 * ve gerçek işletme hattı olup olmadığı belirsizdi; panelden asla değiştirilemiyordu
 * (2026-09-05 denetiminde bulundu). Numara girilmediyse widget hiç gösterilmez — sessizce
 * yanlış bir hatta mesaj gönderme ihtimali, hiç buton olmamasından kötüdür.
 */
export default function WhatsAppWidget({ number }: { number?: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [hasUnread, setHasUnread] = useState(true)

  /*
    ŞU AN BAKILAN ÜRÜN (2026-09-21).

    Ürün sayfası açıkken `ChatProductBeacon` burayı besliyor. Bağlam varsa gönderilen her
    mesajın altına ürün adı + kodu + fiyatı + adresi ekleniyor; yoksa eski davranış aynen
    sürüyor. Sunucu anlık görüntüsü bilerek `null` — ilk boyamada ürün bilgisi henüz yok,
    farklı dönseydi hidrasyon uyuşmazlığı olurdu.
  */
  const urun = useSyncExternalStore(subscribeChatProduct, getChatProduct, getChatProductServer)

  const whatsAppNumber = (number ?? '').replace(/\D/g, '')

  const handleToggle = () => {
    setIsOpen((prev) => !prev)
    setHasUnread(false)
  }

  /** Mesajın altına ürün künyesi ekler; temsilci hangi üründen bahsedildiğini sormak zorunda kalmasın. */
  const urunEkle = (metin: string) => {
    if (!urun) return metin
    const satirlar = [metin.trim(), '', `Ürün: ${urun.name}`, `Kod: ${urun.stockCode}`]
    if (urun.price) satirlar.push(`Fiyat: ${urun.price}`)
    if (urun.url) satirlar.push(urun.url)
    return satirlar.join('\n')
  }

  const handleSend = (textToSend?: string) => {
    const finalMsg = textToSend || message
    if (!finalMsg.trim()) return

    const url = `https://wa.me/${whatsAppNumber}?text=${encodeURIComponent(urunEkle(finalMsg))}`
    // Reklam ölçümü (2026-10-15): balon `window.open` kullandığı için site geneli bağlantı
    // dinleyicisi (MarketingTracker) bunu yakalamıyor; burada ayrıca ölçülüyor.
    trackContact('whatsapp', { stockCode: urun?.stockCode, label: finalMsg })
    window.open(url, '_blank', 'noopener,noreferrer')
    setMessage('')
    setIsOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSend()
    }
  }

  /*
    Numara yoksa widget hiç çizilmez — yanlış bir hatta mesaj göndermek, hiç buton
    olmamasından kötü.

    Bu kontrol EN BAŞTAYDI ve altındaki `useEffect` erken `return null`'dan sonra kalıyordu:
    React'in hook kuralının ihlali (koşullu hook). Etki zaten boş bir zamanlayıcıdan ibaretti,
    kaldırıldı; kontrol de hook'ların altına, JSX'in hemen üstüne alındı.
  */
  if (!whatsAppNumber) return null

  return (
    <div className="whatsapp-widget-container">
      {/* SOHBET PENCERESİ POPOVER */}
      {isOpen && (
        <div className="whatsapp-chat-popover" role="dialog" aria-label="WhatsApp Canlı Destek">
          {/* Başlık (Teal / WhatsApp Green Header) */}
          <div className="wa-popover-header">
            <div className="wa-header-avatar">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.465 3.488" />
              </svg>
            </div>
            <div className="wa-header-info">
              <h4 className="wa-title">Stilsoft KKTC Destek</h4>
              <p className="wa-status">
                <span className="wa-online-dot" />
                Genellikle birkaç dakika içinde yanıt verir
              </p>
            </div>
            <button
              type="button"
              className="wa-close-btn"
              onClick={() => setIsOpen(false)}
              aria-label="Kapat"
            >
              ✕
            </button>
          </div>

          {/* Sohbet Alanı (WhatsApp Mesaj Balonları) */}
          <div className="wa-popover-body">
            {/*
              ÜRÜN SAYFASINDA KARŞILAMA KISALIYOR (2026-09-21).

              Sohbet gövdesi 260px ile sınırlı ve kaydırılabilir. Ürün künyesi eklenince
              uzun karşılama metni, en önemli düğmeyi ("Bu Ürünü Sipariş Et") görünür alanın
              ALTINA itiyordu — müşteri kaydırmadan göremiyor, yani düğme yok sayılır.
              Ürün bağlamı varken tarih rozeti ve ikinci satır düşüyor.
            */}
            {!urun && <div className="wa-time-badge">Bugün</div>}

            {/* Hoş Geldiniz Mesajı */}
            <div className="wa-message-bubble incoming">
              <p className="wa-bubble-text">
                {urun ? (
                  <>Merhaba! 👋 Bu ürünle ilgili size nasıl yardımcı olabiliriz?</>
                ) : (
                  <>
                    Merhaba! 👋 Stilsoft KKTC Canlı Destek hattına hoş geldiniz.
                    <br />
                    Size nasıl yardımcı olabiliriz?
                  </>
                )}
              </p>
              <span className="wa-bubble-time">Şimdi</span>
            </div>

            {/*
              ÜRÜN BAĞLAMI GÖRÜNÜR OLSUN (2026-09-21).

              Müşteriye "hangi ürünü konuşacağız" açıkça gösteriliyor; hem yanlış üründe
              olduğunu fark etmesini sağlıyor hem de en üstteki düğme doğrudan SATIN ALMA
              niyetini iletiyor. Sipariş düğmesi ilk sırada çünkü bu balona basan müşterinin
              çoğunluğu "alacağım ama soracağım bir şey var" durumunda.
            */}
            {urun && (
              <div className="wa-urun-baglam">
                <span className="wa-urun-etiket">Baktığınız ürün</span>
                <strong className="wa-urun-ad">{urun.name}</strong>
                {urun.price && <span className="wa-urun-fiyat num">{urun.price}</span>}
              </div>
            )}

            {/* Hızlı Seçenekler */}
            <div className="wa-quick-options">
              {urun && (
                <button
                  type="button"
                  className="wa-quick-chip wa-quick-chip-birincil"
                  onClick={() => handleSend('Merhaba, bu ürünü sipariş etmek istiyorum.')}
                >
                  <span aria-hidden="true">🛒</span> Bu Ürünü Sipariş Et
                </button>
              )}
              {QUICK_TEMPLATES.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  className="wa-quick-chip"
                  onClick={() => handleSend(t.message)}
                >
                  <span aria-hidden="true">{t.icon}</span> {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Giriş & Gönder Alanı */}
          <div className="wa-popover-footer">
            <input
              type="text"
              className="wa-input"
              placeholder="Mesajınızı yazın..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
            <button
              type="button"
              className="wa-send-btn"
              onClick={() => handleSend()}
              aria-label="WhatsApp'a Gönder"
              disabled={!message.trim()}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* YÜZEN WHATSAPP BUTONU (PULSING AURA) */}
      <button
        type="button"
        className={`whatsapp-floating-btn ${isOpen ? 'is-active' : ''}`}
        onClick={handleToggle}
        aria-label="WhatsApp Destek Hattı"
      >
        {/*
          İKON — 2026-09-09'da DEĞİŞTİRİLDİ.

          Eskisi iki alt yoldan oluşan bir WhatsApp glifiydi: dış balon + iç ahize. İki alt
          yol da aynı yönde çizildiği için varsayılan `nonzero` dolgu kuralında iç ahize
          DELİK AÇMIYOR, dolu basılıyordu — ekranda balonun içinde beyaz bir leke, ahize ise
          kenardan taşmış görünüyordu ("iç telefon kaymış").

          Yerine tek parça, kendi içinde tutarlı simple-icons yolu kondu; `fill-rule`den
          bağımsız olarak her tarayıcıda aynı çiziliyor.
        */}
        <div className="wa-float-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.465 3.488" />
          </svg>
        </div>

        {hasUnread && !isOpen && (
          <span className="wa-unread-badge" aria-label="Yeni Mesaj">
            1
          </span>
        )}
      </button>
    </div>
  )
}
