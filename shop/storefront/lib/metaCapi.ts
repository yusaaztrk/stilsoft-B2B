import { createHash } from 'node:crypto'
import { cookies, headers } from 'next/headers'
import { after } from 'next/server'
import { getStorefront } from '@/lib/api'

/**
 * META CONVERSIONS API — satışı sunucudan da bildirmek (2026-10-15).
 *
 * NEDEN: tarayıcıdaki Pixel; reklam engelleyici, iOS izin penceresi ya da müşterinin bankadan
 * dönerken sekmeyi hemen kapatması yüzünden satışların bir kısmını kaçırıyor. Reklam
 * platformu görmediği satışı "reklam işe yaramadı" sayıyor. Aynı olay sunucudan da gidiyor;
 * Meta ikisini `event_id` (sipariş numarası) ile tekilleştiriyor, satış iki kez sayılmıyor.
 *
 * NE ZAMAN ÇALIŞIR: yalnız ikisi birden varsa — panelde Pixel kimliği (`metaPixelId`) ve
 * sunucudaki `.env.production` dosyasında `META_CAPI_TOKEN`. Biri eksikse hiçbir şey
 * gönderilmez. Anahtar NEXT_PUBLIC_ değil: tarayıcıya hiç inmiyor.
 *
 * NE GÖNDERİLİYOR: IP, tarayıcı bilgisi, Meta'nın kendi çerezleri (_fbp/_fbc) ve müşteri
 * kodunun SHA-256 özeti. Telefon ve e-posta GÖNDERİLMİYOR: sitede henüz çerez onayı yok;
 * eklenirse eşleşme oranını artırmak için özetlenmiş telefon eklenebilir.
 *
 * Gönderim `after()` ile sayfa müşteriye gittikten SONRA yapılıyor: Meta'ya ulaşılamazsa
 * sonuç sayfası bundan hiç etkilenmez.
 */

const API_VERSION = process.env.META_API_VERSION?.trim() || 'v24.0'

const sha256 = (s: string) => createHash('sha256').update(s.trim().toLowerCase()).digest('hex')

type ServerEvent = {
  eventName: 'Purchase' | 'Lead'
  eventId: string
  value: number
  /** Olayın gerçekleştiği sayfanın yolu ("/odeme/sonuc"); tam adres buradan kurulur. */
  path: string
  externalId?: string | null
}

export async function scheduleMetaServerEvent(ev: ServerEvent) {
  const token = process.env.META_CAPI_TOKEN?.trim()
  if (!token) return

  // İstek bilgileri `after()` İÇİNDE okunamıyor (sunucu bileşeni kuralı); önce okunup aktarılıyor.
  const [h, c, settings] = await Promise.all([headers(), cookies(), getStorefront()])
  const pixelId = settings.metaPixelId?.trim()
  if (!pixelId) return

  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || undefined
  const ua = h.get('user-agent') ?? undefined
  const fbp = c.get('_fbp')?.value
  const fbc = c.get('_fbc')?.value
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

  const body = {
    data: [
      {
        event_name: ev.eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: ev.eventId,
        action_source: 'website',
        event_source_url: `${siteUrl}${ev.path}`,
        user_data: {
          ...(ip ? { client_ip_address: ip } : {}),
          ...(ua ? { client_user_agent: ua } : {}),
          ...(fbp ? { fbp } : {}),
          ...(fbc ? { fbc } : {}),
          ...(ev.externalId ? { external_id: [sha256(ev.externalId)] } : {}),
        },
        custom_data: { currency: 'TRY', value: Math.round(ev.value * 100) / 100 },
      },
    ],
  }

  after(async () => {
    try {
      const res = await fetch(
        `https://graph.facebook.com/${API_VERSION}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(token)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' },
      )
      if (!res.ok) {
        // Anahtar ya da Pixel hatalıysa sunucu günlüğünde görünsün; sipariş akışı etkilenmez.
        console.warn('[meta-capi]', ev.eventName, res.status, (await res.text()).slice(0, 300))
      }
    } catch (err) {
      console.warn('[meta-capi] gönderilemedi', String(err).slice(0, 200))
    }
  })
}
