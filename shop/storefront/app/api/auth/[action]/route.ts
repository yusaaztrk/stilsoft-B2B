import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { GUEST_ORDER_COOKIE, SESSION_COOKIE } from '@/lib/session'

const API = process.env.SHOP_API_URL ?? 'http://localhost:5150'

/**
 * İstemcinin gerçek adresi.
 *
 * API bu köprünün arkasında olduğu için gördüğü adres HER ZAMAN vitrin sunucusunun adresi.
 * Giriş/kayıt hız sınırı bu yüzden adresi burada iletmeye bağlı: iletilmezse bütün ziyaretçiler
 * tek bir kovaya düşer ve tek kişinin denemeleri herkesi kilitler.
 *
 * Adresin kendisi ters vekilden geliyor (x-forwarded-for). API bu başlığı yalnızca güvendiği
 * kaynaklardan kabul ediyor, yoksa istemci kendi adresini uydurup sınırı atlardı.
 */
function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return request.headers.get('x-real-ip')
}

/**
 * Tarayıcı ile mağaza API'si arasındaki oturum köprüsü.
 *
 * Form doğrudan API'ye gitmiyor: cevaptaki oturum anahtarı burada httpOnly çereze yazılıyor.
 * Böylece anahtar hiçbir zaman tarayıcıdaki koda görünmüyor ve API'nin internete açık olması
 * gerekmiyor.
 */
export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params
  const store = await cookies()

  if (action === 'logout') {
    const token = store.get(SESSION_COOKIE)?.value
    if (token) {
      await fetch(`${API}/api/account/logout`, {
        method: 'POST',
        headers: { 'X-Shop-Session': token },
      }).catch(() => undefined)
    }

    /*
     * Çerez YANITIN üzerinden siliniyor, `cookies().delete()` ile değil.
     *
     * Sunucudaki oturum her hâlükârda kapanıyor (yukarıdaki çağrı), ama tarayıcıda çerez
     * kalırsa sonraki istek ölü bir anahtarla gider; sepet köprüsü onu 401 görüp taze bir
     * MİSAFİR oturumu açar ve müşteri "çıktım ama sepetim duruyor" hâline düşer. Silmeyi
     * yanıta yazmak, ara katman/önbellek ne yaparsa yapsın `Set-Cookie` başlığının
     * gitmesini garanti eder.
     */
    const response = NextResponse.json({ success: true })
    response.cookies.set(SESSION_COOKIE, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 0,
    })
    response.cookies.set(GUEST_ORDER_COOKIE, '', { path: '/', maxAge: 0 })
    return response
  }

  /*
   * Şifre değiştirme.
   *
   * Ayrı ele alınıyor çünkü OTURUM ANAHTARI GEREKİYOR (giriş/kayıtta yok) ve sunucu işlemden
   * sonra YENİ bir anahtar dönüyor: eski anahtar dahil bütün oturumlar düşürülüyor, bu sekmenin
   * ayakta kalması için yenisi çereze yazılıyor. Yazılmazsa kullanıcı şifresini değiştirdiği
   * anda giriş ekranına düşerdi.
   */
  if (action === 'password') {
    const token = store.get(SESSION_COOKIE)?.value
    if (!token) {
      return NextResponse.json({ message: 'Giriş yapmanız gerekiyor.' }, { status: 401 })
    }

    const res = await fetch(`${API}/api/account/password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shop-Session': token,
        ...(clientIp(request) ? { 'X-Client-Ip': clientIp(request)! } : {}),
      },
      body: await request.text(),
    })

    const data = await res.json().catch(() => null)

    if (!res.ok) {
      return NextResponse.json(
        { message: data?.message ?? 'Şifre değiştirilemedi.' },
        { status: res.status },
      )
    }

    if (data?.session) {
      store.set(SESSION_COOKIE, data.session, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
      })
    }

    return NextResponse.json({ message: data?.message ?? 'Şifreniz değiştirildi.' })
  }

  /*
   * SMS DOĞRULAMA — kod gönder / kodu doğrula.
   *
   * Tarayıcı mağaza API'sine doğrudan gitmiyor (API internete açık olmak zorunda değil) ve
   * asıl önemlisi: hız sınırı istemcinin GERÇEK adresine göre işlemeli. `X-Client-Ip`
   * iletilmezse bütün ziyaretçiler tek kovaya düşer ve tek kişi herkesi kilitler.
   *
   * Yol adı tek parça (`[action]`) olduğu için tire ile yazılıyor, API'de `/` ile karşılığı var.
   */
  if (action === 'phone-send-code' || action === 'phone-verify') {
    const target = action === 'phone-send-code' ? 'phone/send-code' : 'phone/verify'
    const ip = clientIp(request)

    const res = await fetch(`${API}/api/account/${target}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(ip ? { 'X-Client-Ip': ip } : {}),
      },
      body: await request.text(),
    })

    const data = await res.json().catch(() => null)

    if (!res.ok) {
      return NextResponse.json(
        {
          message: data?.message ?? 'İşlem tamamlanamadı.',
          // Bekleme süresi ekrana yazılacak; sunucu 429 döndüğünde geri sayım bununla kuruluyor.
          retryAfterSeconds: data?.retryAfterSeconds,
        },
        { status: res.status },
      )
    }

    // BİLET TARAYICIYA VERİLİYOR (oturum anahtarından farklı olarak).
    //
    // Sebebi: bilet daha sonra kayıt ya da şifre belirleme formuyla birlikte gönderilecek ve
    // formu tarayıcı kuruyor. Riski sınırlı — tek kullanımlık, 15 dakikalık, yalnız doğrulanan
    // numara için geçerli ve tek başına oturum açmaya yaramıyor.
    return NextResponse.json(data ?? { success: true })
  }

  if (action === 'forgot-password' || action === 'reset-password') {
    const body = await request.text()
    const ip = clientIp(request)
    const host = request.headers.get('host')
    const origin = request.headers.get('origin') ?? (host ? `http://${host}` : undefined)

    const res = await fetch(`${API}/api/account/${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(ip ? { 'X-Client-Ip': ip } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      body,
    })

    const data = await res.json().catch(() => null)

    if (!res.ok) {
      return NextResponse.json(
        { message: data?.message ?? 'İşlem tamamlanamadı.' },
        { status: res.status },
      )
    }

    return NextResponse.json({
      success: true,
      message: data?.message ?? 'İşleminiz tamamlandı.',
    })
  }

  // `phone-login` = şifresiz telefon girişi (2026-09-20); oturum çerezi login ile aynı yoldan yazılır.
  // `guest-checkout` = SMS kapalıyken üyesiz sipariş (2026-09-20). Aynı yoldan geçiyor çünkü
  // ihtiyacı aynı: oturum çerezini httpOnly yazmak ve misafir sepetini yeni üyeye devretmek.
  if (action !== 'login' && action !== 'register' && action !== 'phone-login' && action !== 'guest-checkout') {
    return NextResponse.json({ message: 'Geçersiz istek.' }, { status: 404 })
  }

  const body = await request.text()
  const ip = clientIp(request)

  // Misafirken açılan sepet bu token'a bağlı. İletilmezse API'nin kayıt/giriş ucu misafir
  // oturumunu hiç GÖREMEZ ve sepeti yeni üyeye taşıyamaz — üye olma anında sepet sıfırlanırdı
  // (2026-09-05 denetiminde bulundu, canlı testte doğrulandı). Var olan bir üye oturumu asla
  // buradan gelmez: API tarafı yalnızca misafir (@guest.stilsoft) e-postalı oturumu kabul eder.
  const existingToken = store.get(SESSION_COOKIE)?.value

  const res = await fetch(`${API}/api/account/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(ip ? { 'X-Client-Ip': ip } : {}),
      ...(existingToken ? { 'X-Shop-Session': existingToken } : {}),
    },
    body,
  })

  const data = await res.json().catch(() => null)

  if (!res.ok) {
    return NextResponse.json(
      {
        message: data?.message ?? 'İşlem tamamlanamadı.',
        phoneVerificationRequired: data?.phoneVerificationRequired === true,
        // Numara kayıtlı bir hesaba ait: ekran giriş / şifre sıfırlama bağlantısı gösterir.
        accountExists: data?.accountExists === true,
        // Üyesiz siparişte kayıtlı numara: SMS açıksa ekran kodla girişi aynı yerde açar.
        smsAvailable: data?.smsAvailable === true,
      },
      { status: res.status },
    )
  }

  // Telefonla girişte "ad gerekli" ara cevabı: oturum yok, ekran adı sorup aynı biletle döner.
  if (data?.needsProfile) {
    return NextResponse.json({ needsProfile: true })
  }

  if (data?.session) {
    /*
      ÜYE OLMADAN SİPARİŞTE OTURUM KALICI DEĞİL (2026-10-04 kullanıcı isteği: "oturum
      kaydolmasın, sipariş id'si dönsün yeterli"). `maxAge` verilmeyen çerez tarayıcı
      kapanınca silinir: ödeme ve 3D dönüşü boyunca oturum yaşar, sonra müşteri "üye"
      olarak hatırlanmaz. Ortak bilgisayarda bir sonraki kişi onun adresini görmez.
      Diğer yollar (giriş, kayıt, telefonla giriş) 30 gün hatırlanmaya devam ediyor.
    */
    const misafir = action === 'guest-checkout'
    store.set(SESSION_COOKIE, data.session, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      ...(misafir ? {} : { maxAge: 60 * 60 * 24 * 30 }),
    })
    // Sonuç sayfası "Siparişlerim" yerine sipariş numarasını öne çıkarsın diye işaret.
    store.set(GUEST_ORDER_COOKIE, misafir ? '1' : '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      ...(misafir ? {} : { maxAge: 0 }),
    })
  }

  return NextResponse.json({ member: data?.member ?? null })
}
