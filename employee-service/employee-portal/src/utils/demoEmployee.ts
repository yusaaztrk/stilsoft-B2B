/**
 * Test/demo amaçlı örnek çalışan verisi üretir.
 *
 * Amaç: yeni çalışan formunu elle doldurmadan geçerli bir kayıt oluşturabilmek.
 * Üretilen değerler sunucudaki doğrulamalardan geçecek şekilde seçilir: TC 11 hane ve
 * gerçek algoritmaya uygun, telefon 11 hane, e-posta benzersiz, şifre iki alanda aynı.
 */

const FIRST_NAMES = [
  'Ali', 'Ayşe', 'Mehmet', 'Fatma', 'Mustafa', 'Zeynep', 'Ahmet', 'Elif',
  'Hasan', 'Emine', 'Hüseyin', 'Merve', 'İbrahim', 'Hatice', 'Murat', 'Seda',
  'Emre', 'Büşra', 'Burak', 'Esra', 'Serkan', 'Derya', 'Onur', 'Gamze'
]

const LAST_NAMES = [
  'Yılmaz', 'Kaya', 'Demir', 'Çelik', 'Şahin', 'Yıldız', 'Yıldırım', 'Öztürk',
  'Aydın', 'Özdemir', 'Arslan', 'Doğan', 'Kılıç', 'Aslan', 'Çetin', 'Kara',
  'Koç', 'Kurt', 'Özkan', 'Şimşek'
]

const TAX_OFFICES = ['Çankaya', 'Kızılay', 'Ostim', 'Yıldırım Beyazıt', 'Ulus', 'Maltepe']

const BANKS = ['Ziraat Bankası', 'Garanti BBVA', 'İş Bankası', 'Yapı Kredi', 'Akbank', 'Vakıfbank']

const WORK_TYPES = ['Ofis', 'Sahada', 'Atölyede', 'Vardiyalı']

const NATIONALITIES = ['KKTC', 'TC', 'KKTC', 'TC']

const BIRTH_PLACES = ['Lefkoşa', 'Girne', 'Gazimağusa', 'Güzelyurt', 'İskele', 'Ankara', 'İstanbul']

const ADDRESS_DETAILS = ['İkametgâh', 'Şirket lojmanı', 'Kira']

const STREETS = ['Atatürk Caddesi', 'Şehit Mustafa Sokak', 'Barış Caddesi', 'Zafer Sokak', 'Cumhuriyet Caddesi']

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]
}

function randomDigits(length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += Math.floor(Math.random() * 10)
  return out
}

/**
 * Algoritmaya uygun TC kimlik numarası üretir.
 *
 * Kural: 11 hane, ilk hane 0 olamaz.
 * 10. hane = ((1,3,5,7,9. hanelerin toplamı × 7) − (2,4,6,8. hanelerin toplamı)) mod 10
 * 11. hane = ilk 10 hanenin toplamı mod 10
 *
 * Rastgele 11 hane üretmek yerine bu kural uygulanır; aksi hâlde numara TC doğrulaması
 * yapan her yerde (resmî entegrasyonlar dâhil) geçersiz kalır.
 */
export function generateTcNo(): string {
  const digits: number[] = [1 + Math.floor(Math.random() * 9)]
  for (let i = 1; i < 9; i++) digits.push(Math.floor(Math.random() * 10))

  const oddSum = digits[0] + digits[2] + digits[4] + digits[6] + digits[8]
  const evenSum = digits[1] + digits[3] + digits[5] + digits[7]

  const tenth = ((oddSum * 7 - evenSum) % 10 + 10) % 10
  digits.push(tenth)

  const eleventh = digits.reduce((sum, d) => sum + d, 0) % 10
  digits.push(eleventh)

  return digits.join('')
}

/** Türkiye formatında IBAN benzeri değer (TR + 24 hane). */
export function generateIban(): string {
  return `TR${randomDigits(24)}`
}

/** Türkçe karakterleri e-posta/kullanıcı adı için sadeleştirir. */
function slug(value: string): string {
  const map: Record<string, string> = {
    ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', İ: 'i', ö: 'o', Ö: 'o',
    ş: 's', Ş: 's', ü: 'u', Ü: 'u'
  }

  return value
    .split('')
    .map((ch) => map[ch] ?? ch)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

export type DemoEmployee = {
  firstName: string
  lastName: string
  mail: string
  username: string
  password: string
  tc: string
  phone: string
  taxNo: string
  taxOffice: string
  bankName: string
  iban: string
  salary: string
  mealAmount: string
  workType: string
  hireDate: string
  workPermitDay: string
  workPermitStartDate: string
  salaryDay: string
  passportNo: string
  nationality: string
  birthDate: string
  birthPlace: string
  providentFundNo: string
  socialSecurityNo: string
  ssdNo: string
  address: string
  addressDetail: string
}

/**
 * Formu dolduracak örnek çalışan verisi.
 *
 * Kullanıcı adı ve e-posta zaman damgası ile benzersizleştirilir; aksi hâlde aynı adı
 * ikinci kez üretmek "Username zaten mevcut" hatasına takılıyordu.
 */
export function generateDemoEmployee(): DemoEmployee {
  const firstName = pick(FIRST_NAMES)
  const lastName = pick(LAST_NAMES)
  const unique = String(Date.now()).slice(-5)
  const handle = `${slug(firstName)}.${slug(lastName)}${unique}`

  const today = new Date()
  const hire = new Date(today.getFullYear() - Math.floor(Math.random() * 6), Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 27))
  const permitStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const permit = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate())
  const birth = new Date(today.getFullYear() - (22 + Math.floor(Math.random() * 25)), Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 27))

  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  return {
    firstName,
    lastName,
    mail: `${handle}@firma.com`,
    username: handle,
    // Sabit ve tahmin edilebilir: yalnızca test kayıtları için.
    password: 'Deneme1234',
    tc: generateTcNo(),
    phone: `05${randomDigits(9)}`,
    taxNo: randomDigits(10),
    taxOffice: pick(TAX_OFFICES),
    bankName: pick(BANKS),
    iban: generateIban(),
    salary: String(30000 + Math.floor(Math.random() * 40) * 1000),
    mealAmount: String(150 + Math.floor(Math.random() * 10) * 25),
    workType: pick(WORK_TYPES),
    hireDate: ymd(hire),
    workPermitDay: ymd(permit),
    workPermitStartDate: ymd(permitStart),
    salaryDay: String(1 + Math.floor(Math.random() * 5)),
    passportNo: `U${randomDigits(7)}`,
    nationality: pick(NATIONALITIES),
    birthDate: ymd(birth),
    birthPlace: pick(BIRTH_PLACES),
    providentFundNo: randomDigits(7),
    socialSecurityNo: randomDigits(7),
    ssdNo: randomDigits(7),
    address: `${pick(STREETS)} No:${1 + Math.floor(Math.random() * 90)} / ${pick(BIRTH_PLACES)}`,
    addressDetail: pick(ADDRESS_DETAILS)
  }
}
