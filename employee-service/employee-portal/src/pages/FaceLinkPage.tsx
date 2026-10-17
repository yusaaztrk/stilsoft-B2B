import React, { useEffect, useMemo, useState } from 'react'
import { Camera, Copy, Check, QrCode, LogIn, LogOut } from 'lucide-react'
import QRCode from 'qrcode'
import Layout from '../components/Layout'

/**
 * Anonim yüz ile giriş/çıkış linki üretir.
 *
 * Personelin kullanıcı adı/şifre girmesine gerek yoktur: link telefonda açılır, kamera hemen
 * açılır ve yüz okunana kadar taramaya devam eder. Kimlik doğrulama yüzün kendisidir —
 * `FaceAuth/check-in` ve `check-out` uçları bu yüzden `[AllowAnonymous]`.
 *
 * Link kalıcıdır; tek değişken firma kodudur. Günlük bir gizli anahtar yoktur çünkü linki bilen
 * biri yalnızca KENDİ yüzüyle giriş yapabilir — kayıtlı bir yüz olmadan hiçbir işlem oluşmaz.
 */
export default function FaceLinkPage() {
  const tenant = useMemo(() => {
    try {
      return String(localStorage.getItem('tenantCode') ?? '').trim()
    } catch {
      return ''
    }
  }, [])

  const [tenantInput, setTenantInput] = useState(tenant)
  const [copied, setCopied] = useState<string | null>(null)
  const [qrIn, setQrIn] = useState<string>('')
  const [qrOut, setQrOut] = useState<string>('')

  const effectiveTenant = (tenantInput || tenant).trim().toUpperCase()

  const links = useMemo(() => {
    const base = window.location.origin
    const q = effectiveTenant ? `?tenant=${encodeURIComponent(effectiveTenant)}` : ''
    return {
      checkIn: `${base}/face-checkin${q}`,
      checkOut: `${base}/face-checkout${q}`
    }
  }, [effectiveTenant])

  useEffect(() => {
    if (!effectiveTenant) {
      setQrIn(''); setQrOut('')
      return
    }
    void QRCode.toDataURL(links.checkIn, { width: 260, margin: 1 }).then(setQrIn).catch(() => setQrIn(''))
    void QRCode.toDataURL(links.checkOut, { width: 260, margin: 1 }).then(setQrOut).catch(() => setQrOut(''))
  }, [links, effectiveTenant])

  const copy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(key)
      window.setTimeout(() => setCopied(null), 2000)
    } catch {
      setCopied(null)
    }
  }

  const Card = ({
    title,
    href,
    qr,
    Icon,
    accent
  }: { title: string; href: string; qr: string; Icon: typeof LogIn; accent: string }) => (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <Icon size={16} className={accent} />
        <h3 className="text-sm font-extrabold text-slate-800">{title}</h3>
      </div>

      {qr ? (
        <img src={qr} alt={`${title} QR`} className="mx-auto rounded-lg border border-slate-200" />
      ) : (
        <div className="h-[260px] flex items-center justify-center text-xs text-slate-400">
          Firma kodu girilince QR oluşur
        </div>
      )}

      <div className="mt-3 space-y-2">
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-2 text-[11px] break-all text-slate-600">
          {href}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void copy(href, title)}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            {copied === title ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
            {copied === title ? 'Kopyalandı' : 'Linki Kopyala'}
          </button>
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800"
          >
            <Camera size={13} />
            Aç
          </a>
        </div>
      </div>
    </div>
  )

  return (
    <Layout>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900 flex items-center gap-2">
            <QrCode size={18} />
            Yüz ile Giriş Linki
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            Personel bu linki telefonundan açar, kamera hemen açılır ve yüzü okunana kadar taramaya
            devam eder. Kullanıcı adı veya şifre sorulmaz — kimlik yüzün kendisidir.
          </p>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Önce yüz kaydı gerekir.</strong> Çalışan Yönetimi ekranından personelin yüzü
          tanıtılmadan bu link çalışmaz; kayıtlı yüz yoksa her deneme "yüz eşleşmedi" döner.
        </div>

        <div className="rounded-xl border border-ivory-300 bg-white p-4">
          <label htmlFor="face-tenant" className="block text-[11px] uppercase tracking-wider text-neutral-400 mb-1">
            Firma Kodu
          </label>
          <input
            id="face-tenant"
            value={tenantInput}
            onChange={(e) => setTenantInput(e.target.value)}
            placeholder="Örn. DEMOTEST"
            className="input-base max-w-xs"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card title="Giriş" href={links.checkIn} qr={qrIn} Icon={LogIn} accent="text-emerald-600" />
          <Card title="Çıkış" href={links.checkOut} qr={qrOut} Icon={LogOut} accent="text-rose-600" />
        </div>

        <div className="text-[11px] text-neutral-400">
          Not: Tarayıcılar kamerayı yalnızca HTTPS ya da localhost üzerinden açar. Telefondan
          kullanacaksan portalı HTTPS ile yayınla, aksi hâlde kamera açılmaz ve sayfa fotoğraf
          yükleme moduna düşer.
        </div>
      </div>
    </Layout>
  )
}
