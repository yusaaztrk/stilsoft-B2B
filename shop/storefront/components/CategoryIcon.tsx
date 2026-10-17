/*
  KATEGORİ SİMGELERİ (2026-09-21).

  ÖNCEKİ HÂL: mega menüdeki kategori kartlarında kategorinin BAŞ HARFLERİ yazıyordu
  ("A", "GH", "İH", "BM"…). 2026-09-09'da bilerek böyle yapılmıştı çünkü ondan önceki
  48x48 görseller güvenilmezdi: bir kısmı ürün fotoğrafının kırpılmış hâliydi, karşılığı
  olmayan kategoriler kırık görsel gösteriyordu ve ERP'ye yeni kategori eklendiğinde aynı
  boşluk tekrar oluşuyordu.

  ŞİMDİ: harfler yerine ÇİZİLMİŞ simgeler. Görsel dosyası değil, satır içi SVG —
  yüklenecek bir şey yok, kırılmaz, her boyutta net.

  ESKİ SORUN NASIL ÖNLENİYOR: eşleme tablosunda olmayan kategori BOŞ KALMIYOR, baş harf
  yedeğine düşüyor. Yani ERP'ye yarın "Su Arıtma" eklense kart yine dolu görünür; simgesi
  sonra eklenir. Eşleme slug üzerinden yapılıyor (Türkçe "İ" tuzağına girmemek için ad
  değil slug karşılaştırılıyor).
*/

type IconProps = { className?: string }

const S = (d: string | string[]) => {
  const paths = Array.isArray(d) ? d : [d]
  return function Icon({ className }: IconProps) {
    return (
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {paths.map((p, i) => (
          <path key={i} d={p} />
        ))}
      </svg>
    )
  }
}

/** slug → simge. Anahtarlar `Slugify.ToSlug` çıktısıyla aynı biçimde. */
const SIMGELER: Record<string, (p: IconProps) => React.ReactElement> = {
  // Ankastre fırın: gövde + kapak çizgisi + düğmeler
  ankastre: S(['M3 4h18v16H3z', 'M3 9h18', 'M6.5 6.5h.01', 'M9.5 6.5h.01', 'M7 12.5h10v5H7z']),
  'solo-firin': S(['M4 3h16v18H4z', 'M4 8h16', 'M7 5.5h.01', 'M10 5.5h.01', 'M8 11.5h8v6H8z']),

  // Gıda hazırlama: blender sürahisi
  'gida-hazirlama': S(['M8 2h8l-1 9H9z', 'M9 11h6l-.6 8a1 1 0 0 1-1 1h-2.8a1 1 0 0 1-1-1z', 'M7 22h10']),

  // İçecek: çay/kahve fincanı
  'icecek-hazirlama': S(['M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z', 'M17 9h2a2.5 2.5 0 0 1 0 5h-2', 'M6 3v2M10 2v3M14 3v2']),
  // Sebil: iki ad da kullanımda — test kataloğunda "su-sebili", canlıda "sebil".
  // ERP'den gelen ada göre slug değiştiği için ikisi de eşlenmeli.
  sebil: S(['M7 3h10v5H7z', 'M8 8v11a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V8', 'M10 13h4']),
  'su-sebili': S(['M7 3h10v5H7z', 'M8 8v11a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V8', 'M10 13h4']),

  // Soğutucular: iki bölmeli dolap
  buzdolabi: S(['M5 2h14v20H5z', 'M5 10h14', 'M8 6v2M8 13v3']),
  'derin-dondurucu': S(['M3 6h18v12H3z', 'M12 6v12', 'M7 11h.01M16 11h.01']),

  // Yıkama: tambur
  'camasir-makinesi': S(['M4 2h16v20H4z', 'M12 14.5m-4.5 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0', 'M7.5 5.5h.01M10.5 5.5h.01']),
  'bulasik-makinesi': S(['M4 2h16v20H4z', 'M4 7h16', 'M7 4.5h.01M10 4.5h.01', 'M8 11h8v7H8z']),

  // İklim
  klima: S(['M3 5h18v7H3z', 'M6 9h12', 'M7 16c1.5 0 1.5 2 3 2M14 16c1.5 0 1.5 2 3 2']),

  // Ev
  utu: S(['M3 16h14a4 4 0 0 0-4-4H8a5 5 0 0 0-5 4z', 'M6 12V9a3 3 0 0 1 3-3h6', 'M3 19h14']),
  'ev-temizligi': S(['M9 3h6l1 7H8z', 'M8 10h8v5a4 4 0 0 1-4 4 4 4 0 0 1-4-4z', 'M12 19v3']),
  'ev-gerecleri': S(['M4 7h16l-1.2 12a2 2 0 0 1-2 1.8H7.2a2 2 0 0 1-2-1.8z', 'M9 7V5a3 3 0 0 1 6 0v2']),

  // Yatak odası
  baza: S(['M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6', 'M3 18h18', 'M5 18v2M19 18v2', 'M7 10V8h10v2']),
  silte: S(['M3 8h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M7 12h.01M12 12h.01M17 12h.01']),
  baslik: S(['M4 18V9a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v9', 'M4 18h16', 'M8 6V4h8v2']),
  tekstil: S(['M8 3 5 6v15h14V6l-3-3', 'M9 3a3 3 0 0 0 6 0']),

  // Elektronik
  'televizyon-ses-ve-goruntu': S(['M3 4h18v12H3z', 'M8 20h8', 'M12 16v4']),
  televizyon: S(['M3 4h18v12H3z', 'M8 20h8', 'M12 16v4']),
  'televizyon-ses-goruntu': S(['M3 4h18v12H3z', 'M8 20h8', 'M12 16v4']),
  elektro: S(['M13 2 4 14h7l-1 8 9-12h-7z']),

  // Kişisel bakım: saç kurutma makinesi
  'kisisel-bakim': S(['M4 6h9a5 5 0 0 1 0 10H9l-1 6H5l1-6H4a5 5 0 0 1 0-10z', 'M17 11h4']),
}

/** Baş harf yedeği — eşlemede olmayan kategori boş kalmasın. */
function basHarf(ad: string): string {
  return ad
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((k) => k[0])
    .join('')
    .toLocaleUpperCase('tr-TR')
}

export default function CategoryIcon({
  name,
  slug,
  className,
}: {
  /** Yalnız yedek baş harf için; eşleşme adla YAPILMIYOR. */
  name: string
  /** Kategorinin adres parçası — eşleşmenin tek anahtarı. */
  slug: string
  className?: string
}) {
  /*
    EŞLEŞME SLUG ÜZERİNDEN, AD ÜZERİNDEN DEĞİL.

    Türkçe ad karşılaştırması "İ/ı" yüzünden sessizce ıskalıyor (bu projede daha önce üç kez
    yaşandı). Slug zaten katalogdan geliyor ve ASCII; güvenilir olan o.
  */
  const Simge = SIMGELER[(slug ?? '').toLowerCase()]

  if (Simge) return <Simge className={className} />

  return (
    <span className={className} aria-hidden="true" data-harf="1">
      {basHarf(name)}
    </span>
  )
}
