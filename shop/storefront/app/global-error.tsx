'use client'

/**
 * Kök düzenin (layout) kendisi patlarsa devreye giren son çare.
 *
 * `error.tsx` yalnızca sayfa ve alt bileşen hatalarını yakalıyor; başlık ya da alt bilginin
 * render'ında oluşan bir hata onun DIŞINDA kalıyor. O durumda düzen hiç kurulamadığı için bu
 * dosya kendi <html> ve <body>'sini basmak zorunda — site stilleri de yüklenmemiş olabilir,
 * bu yüzden biçim satır içinde ve en aza indirilmiş.
 *
 * Buraya düşmek beklenen bir durum değil: mağaza API'si kapalıyken bile katalog çağrıları
 * boş sonuca düşüyor (lib/api.ts) ve sayfa ayakta kalıyor. Yine de düşülürse ziyaretçinin
 * tarayıcının kendi hata ekranını görmemesi gerekiyor.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="tr">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', color: '#1a1a1c' }}>
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '80px 24px', textAlign: 'center' }}>
          <h1 style={{ fontSize: 26, fontWeight: 400, margin: '0 0 12px' }}>Bir şeyler ters gitti</h1>
          <p style={{ color: '#6e6e73', fontSize: 15, lineHeight: 1.7, margin: '0 0 24px' }}>
            Site şu anda görüntülenemiyor. Lütfen birazdan tekrar deneyin.
          </p>

          <button
            type="button"
            onClick={reset}
            style={{
              height: 48,
              padding: '0 28px',
              borderRadius: 999,
              border: 0,
              background: '#1a1a1c',
              color: '#fff',
              fontSize: 15,
              cursor: 'pointer',
            }}
          >
            Tekrar dene
          </button>

          {error.digest ? (
            <p style={{ color: '#96969b', fontSize: 12.5, marginTop: 24 }}>Hata kodu: {error.digest}</p>
          ) : null}
        </div>
      </body>
    </html>
  )
}
