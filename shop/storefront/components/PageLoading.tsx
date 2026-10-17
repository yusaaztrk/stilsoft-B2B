/*
  SAYFA YÜKLENİYOR (2026-10-05 kullanıcı bildirimi: "giriş yap'a basıyorum gelmiyor, yavaşlamış
  sanki"). Giriş, üyelik, ödeme ve hesap sayfaları sunucuda oturuma bakarak hazırlanıyor; o
  sürede ekranda hiçbir değişiklik olmuyor, müşteri tıklamanın çalışmadığını sanıp tekrar
  basıyordu. Next `loading.tsx` ile bu bileşen tıklamanın hemen ardından görünür.
*/
export default function PageLoading({ metin = 'Yükleniyor…' }: { metin?: string }) {
  return (
    <div className="wrap">
      <div className="page-loading" role="status" aria-live="polite">
        <span className="page-loading-spin" aria-hidden="true" />
        <span>{metin}</span>
      </div>
    </div>
  )
}
