export type AssistantPageKey = string

export type AssistantKnowledgeItem = {
  key: AssistantPageKey
  title: string
  description: string
}

export type AssistantKnowledgeBase = {
  version: string
  items: Record<AssistantPageKey, AssistantKnowledgeItem>
}

export const assistantKnowledgeBase: AssistantKnowledgeBase = {
  version: '1.0.0',
  items: {
    'invoice/siparis': {
      key: 'invoice/siparis',
      title: 'Sipariş',
      description:
        'Sipariş ekranı, müşterilerden gelen siparişleri takip etmek için kullanılır. Buradan siparişleri listeleyebilir, arama ve filtreleme yapabilir, ilgili satıra tıklayarak detayları inceleyebilir ve süreçte hangi aşamada olduğunu görebilirsiniz.'
    },
    'invoice/satisFatura': {
      key: 'invoice/satisFatura',
      title: 'Satış Faturası',
      description:
        'Satış Faturası bölümü, satışa ait fatura süreçlerinin yönetildiği alandır. Bu bölümde fatura akışıyla ilgili ana adımlar (listeleme, kontrol, gerekli işlemler) yer alır ve operasyon ekibi faturaya ait bilgileri buradan görüntüler.'
    },
    'invoice/musteriTeklifi': {
      key: 'invoice/musteriTeklifi',
      title: 'Müşteri Teklifi',
      description:
        'Müşteri Teklifi ekranı, müşterilere sunulan fiyat/ürün tekliflerinin takibi içindir. Teklifin hangi müşteriye ait olduğu, içeriği ve süreçteki durumu gibi bilgileri buradan görüntüleyebilir; teklif sürecini operasyonel olarak buradan yönetebilirsiniz.'
    },
    'invoice/faturaDokum': {
      key: 'invoice/faturaDokum',
      title: 'Fatura Dökümü',
      description:
        'Fatura Dökümü ekranı, oluşturulmuş faturaların listesini ve detaylarını görmenizi sağlar. Listeden faturayı seçerek detay sayfasına girebilir, fatura kalemlerini ve ilgili bilgileri inceleyebilirsiniz.'
    },
    'invoice/etiketFiyatli': {
      key: 'invoice/etiketFiyatli',
      title: 'Etiket Basım (Fiyatlı)',
      description:
        'Etiket Basım (Fiyatlı) ekranı, ürün etiketlerini fiyat bilgisiyle birlikte hazırlamak ve basmak için kullanılır. Bu bölümde etiketleme sürecine ait temel adımlar bulunur ve mağaza/raf etiketleri operasyonunu destekler.'
    },
    'invoice/etiketFiyatsiz': {
      key: 'invoice/etiketFiyatsiz',
      title: 'Etiket Basım (Fiyatsız)',
      description:
        'Etiket Basım (Fiyatsız) ekranı, ürün etiketlerini fiyat göstermeden basmak için kullanılır. Depo/mağaza etiket operasyonlarında yalnızca ürün tanımı ve barkod gibi bilgilerle etiketleme yapılacak senaryolarda tercih edilir.'
    },
    'invoice/proforma': {
      key: 'invoice/proforma',
      title: 'Proforma',
      description:
        'Proforma ekranı, resmi fatura öncesi bilgilendirme amaçlı proforma dokümanlarının yönetimi içindir. Proforma üzerinden satışa ait özet bilgileri kontrol edebilir ve operasyonel teyit için kullanabilirsiniz.'
    },
    'invoice/magaza': {
      key: 'invoice/magaza',
      title: 'Mağaza Sipariş',
      description:
        'Mağaza Sipariş ekranı, mağaza kaynaklı siparişlerin takibi ve yönetimi içindir. Bu bölümde mağaza siparişlerinin listesi, durumları ve operasyon akışı yer alır; mağaza tarafı ile depo/operasyon koordinasyonunu kolaylaştırır.'
    },
    'invoice/alis': {
      key: 'invoice/alis',
      title: 'Alış Siparişleri',
      description:
        'Alış Siparişleri ekranı, tedarikçilerden gelen alış siparişlerinin takibi için kullanılır. Bu bölümde alış siparişlerinin kayıt ve kontrol süreci yürütülür; muhasebe/operasyon süreçleri için temel referans noktasıdır.'
    },
    'invoice/depoTransfer': {
      key: 'invoice/depoTransfer',
      title: 'Depo Transfer',
      description:
        'Depo Transfer ekranı, depolar arası ürün hareketlerini takip etmek için kullanılır. Transfer işlemlerinin hangi depodan hangi depoya yapıldığı, tarih ve ilgili kayıtlar gibi bilgiler buradan izlenir.'
    },
    'invoice/stokHareket': {
      key: 'invoice/stokHareket',
      title: 'Stok Hareket Dökümü',
      description:
        'Stok Hareket Dökümü, ürün bazında stok giriş/çıkış hareketlerini raporlamak için kullanılır. Ürün ve tarih filtreleriyle stok hareket geçmişini inceleyebilir; tutarsızlık kontrolü ve operasyon analizi yapabilirsiniz.'
    },
    'invoice/depoStock': {
      key: 'invoice/depoStock',
      title: 'Depo Stok Durumu',
      description:
        'Depo Stok Durumu ekranı, depodaki anlık stok seviyelerini görüntülemek için kullanılır. Hangi ürünün hangi miktarda stokta olduğu buradan takip edilir; satın alma ve satış planlaması için temel ekrandır.'
    },
    'invoice/irsaliye': {
      key: 'invoice/irsaliye',
      title: 'Konsinye',
      description:
        'Konsinye ekranı, konsinye/irsaliye kayıtlarının yönetimi içindir. Buradan kayıtları listeleyebilir ve yetkiniz varsa adet/durum gibi alanlarda işlem yapabilirsiniz. Durum “sevk edildi” olduğunda kayıt üzerindeki miktar alanları kilitlenir ve değişiklik yapılmaz.'
    },

    'reports/siparisRaporu': {
      key: 'reports/siparisRaporu',
      title: 'Sipariş Raporu',
      description:
        'Sipariş Raporu, siparişlerin özet ve analiz amaçlı görüntülendiği rapor ekranıdır. Tarih aralığı ve diğer filtrelerle sipariş performansını izleyebilir, operasyonun genel durumunu raporlayabilirsiniz.'
    },
    'users/rolYetkileri': {
      key: 'users/rolYetkileri',
      title: 'Rol Yetkileri',
      description:
        'Rol Yetkileri ekranı, kullanıcı rollerine göre hangi sayfalara erişileceğini belirlemek için kullanılır. Burada bir rol seçip sayfa checkbox’larını açıp kapatarak erişim yetkilerini yönetebilir ve kaydedebilirsiniz.'
    }
  }
}
