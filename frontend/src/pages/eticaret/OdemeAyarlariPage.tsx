import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Landmark, AlertTriangle, Info, RefreshCw } from 'lucide-react'
import { MessageBanner, PageHeader, SaveBar, input, label, usePanelMessage, useStorefrontSettings } from './shared'
import { useSmsStatus } from './shared'

/*
  SAĞLAYICI HATA KODLARININ KARŞILIĞI.

  Kodların kendisi (ör. "ERR01") panelden bakan kişiye hiçbir şey anlatmıyor. En sık görülen
  dördü burada yazılı; tanınmayan kod olduğu gibi gösteriliyor — uydurma bir açıklama, hiç
  açıklama olmamasından kötü.
*/
function smsHataAnlami(kod: string): string {
  const k = (kod || '').toUpperCase()
  if (k === 'TRANSPORT') return 'Sağlayıcıya hiç ulaşılamadı (ağ / zaman aşımı / sunucu kapalı).'
  if (k === 'SMS_DISABLED') return 'Servis kapalı — appsettings içindeki bilgiler girilmemiş.'
  if (k === 'INVALID_PHONE') return 'Numara geçersiz biçimde.'
  if (k === 'EMPTY_RESULT') return 'Sağlayıcı boş yanıt döndü; kullanıcı adı/şifre yanlış olabilir.'
  if (k.startsWith('ERR')) return 'Sağlayıcı reddetti — kredi, hesap yetkisi ya da gönderici adı kontrol edilmeli.'
  // KKTCELL TMessage (2026-10-11)
  if (k.startsWith('AUTH: KULLANICI')) return 'TMessage API kullanıcı adı/şifresi hatalı (TMessage panelindeki API kullanıcısı).'
  if (k === 'AUTH_HTTP_403' || k === 'TMSG_HTTP_403') return "KKTCELL sunucunun IP'sine izin vermemiş — IP'nin KKTCELL'e bildirilmesi gerekiyor."
  if (k.startsWith('AUTH')) return 'TMessage girişi başarısız (API kullanıcısı / IP izni kontrol edilmeli).'
  if (k.startsWith('TMSG_')) return 'TMessage gönderimi reddetti — bakiye, gönderici adı ya da kampanya adı kontrol edilmeli.'
  return kod
}

export default function OdemeAyarlariPage() {
  const { message, notify } = usePanelMessage()
  const { settings, update, saveSettings, saving } = useStorefrontSettings(notify)
  const { smsStatus, loadSmsStatus } = useSmsStatus()


  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Ödeme & Havale" desc="SMS servisi durumu, havale/EFT hesapları, havale süreleri ve üye olmadan sipariş anahtarı."  />
      <MessageBanner message={message} />

      {(
        <div className="max-w-4xl">
          {!settings ? (
            <div className="text-sm text-gray-500">Yükleniyor...</div>
          ) : (
            <>
              {/*
                SMS DURUMU.
                Doğrulama kodları buradan gidiyor; kredi bitince kayıt ekranı çalışmıyormuş
                gibi görünüyor ve sebebi hiçbir ekranda yazmıyordu. Servis metotları (kredi,
                gönderici adı) baştan beri vardı, panel tarafı yazılmamıştı.
              */}
              {smsStatus && !smsStatus.configured && (
                /*
                  SMS KAPALIYKEN SESSİZ KALMAMALI (2026-09-20).

                  Eskiden burada gri bir kutuda yalnızca "Kapalı." yazıyordu. Oysa üyeliksiz
                  sipariş tamamen SMS'e bağlı: kredensiyal girilmemişse vitrin ödeme adımında
                  SESSİZCE eski davranışa düşüyor ve müşteri "e-posta + şifre" duvarına
                  çarpıyor. Ekranda hata yok, log'da hata yok — bayi durumu ancak müşteri
                  şikâyet edince öğreniyor. Kapalıyken nelerin çalışmadığı tek tek yazıyor.
                */
                <div className="mb-4 rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3 text-[12px] text-amber-900">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-black uppercase tracking-wider text-[10px]">SMS</span>
                    <span className="font-black">Kapalı — satışı doğrudan etkiliyor.</span>
                    <button
                      type="button"
                      onClick={() => void loadSmsStatus()}
                      className="ml-auto text-[11px] font-semibold underline underline-offset-2"
                    >
                      Yenile
                    </button>
                  </div>
                  <div className="mb-1.5">
                    {smsStatus.message ?? 'Sunucudaki appsettings.Local.json dosyasına SMS (TMessage) bilgileri girilmemiş.'}
                    {' '}Girilmediği sürece:
                  </div>
                  <ul className="list-disc list-inside space-y-0.5">
                    <li><b>Üye olmadan sipariş verilemiyor</b> — müşteri ödeme adımında e-posta + şifre isteyen giriş ekranına düşüyor.</li>
                    <li>Telefonla giriş seçeneği vitrinde hiç görünmüyor.</li>
                    <li>&quot;Siparişiniz alındı&quot;, havale IBAN'ı ve &quot;ödemeniz alındı&quot; mesajları gitmiyor.</li>
                    <li>Havale hatırlatması, sepet hatırlatması ve kampanya SMS'i çalışmıyor.</li>
                  </ul>
                  <div className="mt-1.5">Bilgiler girilip mağaza servisi yeniden başlatılınca hepsi kendiliğinden açılır.</div>
                </div>
              )}

              {smsStatus && smsStatus.configured && (
                <div
                  className={`mb-4 rounded-2xl border px-4 py-3 text-[12px] flex flex-wrap items-center gap-x-4 gap-y-1 ${
                    smsStatus.credit === null
                      ? 'border-amber-200 bg-amber-50 text-amber-900'
                      : smsStatus.credit < 50 || (smsStatus.otpCredit != null && smsStatus.otpCredit < 50)
                        ? 'border-red-200 bg-red-50 text-red-800'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  }`}
                >
                  <span className="font-bold uppercase tracking-wider text-[10px]">SMS</span>

                  <span>
                    {smsStatus.otpCredit !== undefined ? 'Toplu SMS bakiyesi' : 'Kalan kredi'}: <b>{smsStatus.credit === null ? 'okunamadı' : smsStatus.credit.toLocaleString('tr-TR')}</b>
                  </span>
                  {smsStatus.otpCredit !== undefined && (
                    <span title="Üyelik doğrulama, telefonla giriş ve şifre sıfırlama kodları bu bakiyeden düşer.">
                      Doğrulama (OTP) bakiyesi: <b>{smsStatus.otpCredit === null ? 'okunamadı' : smsStatus.otpCredit.toLocaleString('tr-TR')}</b>
                    </span>
                  )}
                  {smsStatus.senderName && (
                    <span>Gönderici adı: <b>{smsStatus.senderName}</b></span>
                  )}
                  {smsStatus.message && <span>{smsStatus.message}</span>}
                  {smsStatus.otpCredit != null && smsStatus.otpCredit < 50 && (
                    <span className="font-bold">OTP bakiyesi azaldı — doğrulama ve şifre sıfırlama kodları kesilebilir.</span>
                  )}
                  {smsStatus.credit !== null && smsStatus.credit < 50 && (
                    <span className="font-bold">{smsStatus.otpCredit !== undefined ? 'Toplu SMS bakiyesi azaldı — sipariş/havale bildirimleri kesilebilir.' : "Kredi azaldı — doğrulama SMS'leri kesilebilir."}</span>
                  )}

                  <button
                    type="button"
                    onClick={() => void loadSmsStatus()}
                    className="ml-auto text-[11px] font-semibold underline underline-offset-2"
                  >
                    Yenile
                  </button>
                </div>
              )}

              {/*
                SON GÖNDERİM HATALARI (2026-09-21).

                "SMS gitmiyor / sağlayıcı bozuk" şikayetinde tek işe yarayan bilgi
                sağlayıcının döndürdüğü koddu ve yalnızca sunucu günlüğünde kalıyordu.
                Artık burada görünüyor; kodun karşılığı da yanında yazıyor ki panelden
                bakan kişi belgeye gitmek zorunda kalmasın.

                Liste bellekte tutuluyor: mağaza servisi yeniden başlayınca sıfırlanır.
              */}
              {smsStatus?.configured && (smsStatus.recentFailures?.length ?? 0) > 0 && (
                <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-red-200 text-[12px] font-black text-red-900">
                    Son başarısız SMS gönderimleri ({smsStatus.recentFailures!.length})
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="text-[10px] font-bold uppercase tracking-wide text-red-700 border-b border-red-100">
                          <th className="text-left px-4 py-1.5">Zaman</th>
                          <th className="text-left px-3 py-1.5">Numara</th>
                          <th className="text-left px-3 py-1.5">Sağlayıcı kodu</th>
                          <th className="text-left px-4 py-1.5">Anlamı</th>
                        </tr>
                      </thead>
                      <tbody>
                        {smsStatus.recentFailures!.map((f, i) => (
                          <tr key={`${f.atUtc}-${i}`} className="border-b border-red-100 last:border-0">
                            <td className="px-4 py-1.5 text-red-900 whitespace-nowrap">
                              {new Date(f.atUtc).toLocaleString('tr-TR', {
                                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                              })}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-red-800">{f.phone}</td>
                            <td className="px-3 py-1.5 font-mono font-bold text-red-900">{f.errorCode}</td>
                            <td className="px-4 py-1.5 text-red-800">{smsHataAnlami(f.errorCode)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden mt-4">
                <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-b from-gray-50 to-white flex items-center gap-2">
                  <Landmark size={16} className="text-gray-500" />
                  <div className="text-sm font-extrabold text-gray-900">Havale / EFT ve üyesiz sipariş</div>
                </div>
                <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2 text-[11px] text-gray-500">Havale seçeneği yalnız en az bir IBAN girildiğinde vitrinde görünür. Süreler arka planda işler; panel açık olmasa da çalışır.</div>
                  <div className="md:col-span-2">
                    <span className={label}>Havale / EFT hesapları (boşsa vitrinde havale seçeneği çıkmaz)</span>
                    <div className="space-y-2">
                      {(settings.bankTransferAccounts ?? []).map((acc, idx) => (
                        <div key={idx} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-center">
                          <input className={input} placeholder="Banka" value={acc.bankName} onChange={(e) => update('bankTransferAccounts', (settings.bankTransferAccounts ?? []).map((a, i) => (i === idx ? { ...a, bankName: e.target.value } : a)))} />
                          <input className={input} placeholder="Hesap sahibi" value={acc.accountHolder} onChange={(e) => update('bankTransferAccounts', (settings.bankTransferAccounts ?? []).map((a, i) => (i === idx ? { ...a, accountHolder: e.target.value } : a)))} />
                          <input className={input} placeholder="IBAN" value={acc.iban} onChange={(e) => update('bankTransferAccounts', (settings.bankTransferAccounts ?? []).map((a, i) => (i === idx ? { ...a, iban: e.target.value } : a)))} />
                          <div className="flex items-center gap-2">
                            <input className={input} placeholder="TL" value={acc.currency ?? 'TL'} onChange={(e) => update('bankTransferAccounts', (settings.bankTransferAccounts ?? []).map((a, i) => (i === idx ? { ...a, currency: e.target.value } : a)))} />
                            <button type="button" className="text-xs font-semibold text-red-600 hover:text-red-700 whitespace-nowrap" onClick={() => update('bankTransferAccounts', (settings.bankTransferAccounts ?? []).filter((_, i) => i !== idx))}>Sil</button>
                          </div>
                        </div>
                      ))}
                      <button type="button" className="text-xs font-semibold text-indigo-700 hover:text-indigo-900" onClick={() => update('bankTransferAccounts', [...(settings.bankTransferAccounts ?? []), { bankName: '', accountHolder: '', iban: '', currency: 'TL' }])}>+ Hesap ekle</button>
                    </div>
                  </div>
                  <div>
                    <span className={label}>Havale siparişi kaç saatte iptal olsun</span>
                    <input className={input} type="number" min={6} max={720} value={settings.bankTransferTimeoutHours ?? 72} onChange={(e) => update('bankTransferTimeoutHours', Number(e.target.value) || 72)} />
                    <div className="mt-1 text-[11px] text-gray-500">"Gönderdim" gelmeyen havale siparişleri bu süre sonunda kendiliğinden iptal edilir. Kapanma artık paneli açmana bağlı değil, arka planda çalışıyor.</div>
                  </div>
                  <div>
                    <span className={label}>Havale hatırlatması kaç saat sonra</span>
                    <input
                      className={input}
                      type="number"
                      min={0}
                      max={720}
                      value={settings.bankTransferReminderHours ?? 24}
                      onChange={(e) => update('bankTransferReminderHours', Number(e.target.value) || 0)}
                    />
                    <div className="mt-1 text-[11px] text-gray-500">
                      Havaleyi seçip &quot;Gönderdim&quot; demeyen müşteriye bu süre sonunda <b>bir kez</b> hatırlatma
                      SMS'i gider (IBAN ve kalan süreyle birlikte). <b>0</b> yazarsan gönderilmez.
                      İptal süresinden küçük olmalı, yoksa sipariş hatırlatma gitmeden kapanır.
                    </div>
                  </div>
                  {/*
                    SMS'SİZ ÜYESİZ SİPARİŞ (2026-09-20).
                    Üyeliksiz sipariş SMS servisine bağlı; kredensiyal girilmediği sürece müşteri
                    ödeme adımında e-posta+şifre duvarına çarpıyor. Bu anahtar o duvarı kaldırıyor
                    ama numarayı doğrulamıyor — politika kararı bayinin, o yüzden kapalı başlıyor.
                  */}
                  <div className="md:col-span-2 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
                    <label className="flex items-start gap-2 text-sm font-semibold text-gray-700">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={settings.allowGuestCheckoutWithoutSms ?? false}
                        onChange={(e) => update('allowGuestCheckoutWithoutSms', e.target.checked)}
                      />
                      <span>
                        SMS kapalıyken de üye olmadan sipariş alınsın
                        <span className="block text-[11px] font-normal text-gray-500 mt-0.5">
                          SMS (TMessage) bilgileri girilmediği sürece üyeliksiz sipariş çalışmıyor;
                          müşteri ödeme adımında e-posta + şifre isteyen giriş ekranına düşüyor.
                          Bu anahtar açıkken müşteri <b>ad + telefon + adres</b> yazıp siparişi
                          tamamlar — <b>numara doğrulanmaz</b>. Kartta 3D Secure, havalede
                          &quot;para gelmeden sevk yok&quot; kuralı devrede kaldığı için risk sahte
                          siparişin vaktinizi almasıyla sınırlı. SMS bilgileri girilince bu ayarın
                          etkisi kalmaz, doğrulamalı akış devreye girer.
                        </span>
                      </span>
                    </label>
                  </div>
                </div>
              </div>
              <SaveBar saving={saving} onSave={() => void saveSettings()} />
            </>
          )}
        </div>
      )}

    </div>
  )
}
