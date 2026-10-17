export type FaqItem = {
  question: string
  answer: string
}

export const defaultFaqs: FaqItem[] = [
  {
    question: 'KKTC geneline teslimat süresi ve ücreti nedir?',
    answer:
      'Web sitemizden yapacağınız alışverişlerde KKTC geneline (Lefkoşa, Girne, Gazimağusa, İskele, Güzelyurt, Lefke ve Karpaz) adrese teslimat ücretsizdir. Stoktaki ürünler sipariş onayının ardından 24-48 saat içerisinde güvenli ve sigortalı araçlarımızla teslim edilmektedir.',
  },
  {
    question: 'Ankastre ve beyaz eşyalarda kurulum & montaj ücretsiz mi?',
    answer:
      'Ankastre fırın, set üstü ocak, davlumbaz ve beyaz eşya siparişlerinizde KKTC yetkili servis ekiplerimiz randevulu olarak adresinize gelir; montaj ve ilk çalıştırma ücretsizdir. Televizyon gibi askı aparatı gerektiren ürünlerde montaj bedeli ürünün sayfasında ve sepette ayrıca yazar — ödeme öncesinde tam tutarı görürsünüz.',
  },
  {
    question: 'Garanti süresi ve yetkili servis şartları nelerdir?',
    answer:
      'Tüm Stilsoft ürünleri 3 Yıl Resmi Distribütör Garantisi kapsamındadır. Arıza veya bakım durumunda KKTC merkezli yetkili servisimiz orijinal yedek parça ve hızlı yerinde müdahale hizmeti sunmaktadır.',
  },
  {
    question: 'Kredi kartına taksit ve güvenli ödeme seçenekleri mevcut mu?',
    answer:
      'Sitemizde 256-Bit SSL sertifikası ve banka onaylı 3D Secure altyapısı kullanılmaktadır. Anlaşmalı tüm bankaların kredi kartlarıyla tek çekim veya taksitli ödeme yapabilirsiniz. Ödeme yalnızca kredi/banka kartı ile alınır; havale/EFT ve kapıda ödeme kabul edilmemektedir.',
  },
  {
    question: 'Siparişimin durumunu nasıl takip edebilirim?',
    answer:
      'Hesabınızla giriş yaptıktan sonra üst menüdeki "Sipariş Takibi" sayfasına veya "Hesabım → Siparişlerim" ekranına sipariş numaranızı girerek sipariş, ödeme ve teslimat durumunu anlık izleyebilirsiniz.',
  },
]
