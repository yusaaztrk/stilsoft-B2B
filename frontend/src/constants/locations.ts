/*
  KKTC il / ilçe / bölge listeleri — TEK KAYNAK.

  Bu listeler eskiden yalnızca `CariEklePage` içinde yerel sabitlerdi. Mağaza Sipariş
  ekranındaki "Yeni Müşteri Ekle" kutusu ise serbest metin alıyordu; aynı ilçe iki
  ekranda iki farklı yazımla kaydedilebiliyordu (İ/I ve ş/s farkları dahil). Liste
  buraya taşındı ki iki ekran da aynı değerleri üretsin.
*/

export const CITIES = [
  'LEFKOŞA',
  'GİRNE',
  'LEFKE',
  'GAZİMAĞUSA',
  'İSKELE',
  'GÜZELYURT'
] as const

export const DISTRICTS = [
  'AKDENİZ', 'AKDOĞAN', 'ALAYKÖY', 'ALSANCAK', 'ALTAYLILAR', 'ASLANKÖY', 'AYDEMET', 'AYDINKÖY',
  'AYLUKA', 'BAFRA', 'BAHÇELER', 'BALIKESİR', 'BELLAPAİS', 'BOĞAZKÖY', 'BOSTANCI', 'ÇAĞLAYAN',
  'ÇAMLIBEL', 'ÇANAKKALE', 'ÇATALKÖY', 'DEĞİRMENLİK', 'DEMİRHAN', 'DEREBOYU', 'DERİNCE', 'DİKMEN',
  'DİPKARPAZ', 'DOĞANCI', 'DUMLUPINAR', 'EDREMİT', 'ERDEMLİ', 'ESENTEPE', 'GAZİVEREN', 'GEÇİTKALE',
  'GELİNCİK', 'GEMİKONAĞI', 'GÖÇMENKÖY', 'GÖNYELİ', 'GÜNGÖR', 'GÜVERCİNLİK', 'HAMİTKÖY', 'HASPOLAT',
  'KALECİK', 'KAPALI MARAŞ', 'KARAKUM', 'KARAOĞLANOĞLU', 'KERMİYA', 'KIRKLAR', 'KOZANKÖY',
  'KÖŞKLÜÇİFTLİK', 'KUMYALI', 'KUZUCUK', 'KÜÇÜKKAYMAKLI', 'LAPTA', 'MARMARA', 'MEHMETÇİK', 'MELİKGAZİ',
  'MERKEZ', 'MİNARELİKÖY', 'ORTAKÖY', 'OZANKÖY', 'ÖTÜKEN', 'PAŞAKÖY', 'SAKARYA', 'SALAMİSYOLU',
  'SANAYİ', 'SERDARLI', 'SINIRÜSTÜ', 'SURLARİÇİ', 'SÜTLÜCE', 'TAŞKINKÖY', 'TATLISU', 'TEPEBASI',
  'TUZLA', 'ULUKIŞLA', 'VADİLİ', 'YAYLA', 'YENİBOĞAZİÇİ', 'YENİERENKÖY', 'YENİKENT', 'YENİŞEHİR',
  'YILMAZKÖY', 'YUKARI GİRNE', 'ZEYTİNLİK'
] as const

/*
  Montaj formundaki "Bölge" kutusunun seçenekleri. Değerler ServiceOps'a bu yazımla
  gidiyor (`ResolveRegionIdAsync` bunlarla eşleştiriyor), o yüzden BÜYÜK HARFE
  çevrilmiyor — cari kartındaki İl alanı büyük harfli tutulduğu için eşleştirme
  `resolveRegionFromCity` üzerinden yapılıyor.
*/
export const MONTAJ_REGIONS = [
  'Lefkoşa',
  'Gazimağusa',
  'Girne',
  'Güzelyurt',
  'İskele',
  'Lefke'
] as const

/**
 * Cari kartındaki İl değerini montaj formunun Bölge seçeneğine çevirir.
 * Eşleşme bulunamazsa boş döner — uydurma bölge yazmaktansa kullanıcı seçsin.
 */
export function resolveRegionFromCity(city?: string | null): string {
  const needle = String(city ?? '').trim().toLocaleLowerCase('tr-TR')
  if (!needle) return ''
  return MONTAJ_REGIONS.find((r) => r.toLocaleLowerCase('tr-TR') === needle) ?? ''
}
