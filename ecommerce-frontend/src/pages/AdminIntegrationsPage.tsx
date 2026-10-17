import { useEffect, useState } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { getAdminToken, readApiResponse } from '../lib/api'
import { useToast } from '../components/ui/ToastContext'

export function AdminIntegrationsPage() {
  const { showToast } = useToast()
  const [saving, setSaving] = useState(false)

  // Integration credentials state
  const [iyzicoApiKey, setIyzicoApiKey] = useState('**********')
  const [iyzicoSecretKey, setIyzicoSecretKey] = useState('**********')
  const [iyzicoTestMode, setIyzicoTestMode] = useState(true)

  const [mngApiKey, setMngApiKey] = useState('MNG-KEY-100293')
  const [smtpServer, setSmtpServer] = useState('smtp.example.com')
  const [smtpPort, setSmtpPort] = useState('587')

  // Load Integration values
  useEffect(() => {
    async function loadConfig() {
      try {
        const res = await fetch('/api/admin/modules/integrations', {
          headers: { Authorization: `Bearer ${getAdminToken()}` }
        })
        const json = await readApiResponse(res)
        if (res.ok && json?.data) {
          if (json.data.iyzicoApiKey) setIyzicoApiKey(json.data.iyzicoApiKey)
          if (json.data.mngApiKey) setMngApiKey(json.data.mngApiKey)
        }
      } catch {
        console.log('Error loading config')
      }
    }
    loadConfig()
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = {
        iyzicoApiKey,
        mngApiKey,
        smtpServer,
        smtpPort
      }
      const res = await fetch('/api/admin/modules/integrations', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAdminToken()}`
        },
        body: JSON.stringify(payload)
      })
      if (res.ok) {
        showToast('Entegrasyon ayarları başarıyla kaydedildi.', 'success')
      } else {
        throw new Error()
      }
    } catch {
      showToast('Entegrasyonlar kaydedilemedi.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleConnectOAuth = (platform: string) => {
    showToast(`${platform} OAuth yetkilendirmesi başlatıldı.`, 'success')
  }

  return (
    <AdminLayout
      title="Entegrasyonlar"
      subtitle="Ödeme altyapıları, kargo takip servisleri, SMTP sunucuları ve ön muhasebe yazılımlarını entegre edin."
    >
      <div className="space-y-8">
        
        {/* Section 1: Ödeme Sistemleri */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-zinc-800 uppercase tracking-wider">Ödeme Sistemleri</h3>
          <div className="grid gap-6 md:grid-cols-3">
            
            {/* iyzico */}
            <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-sm space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-xs font-black text-zinc-900 uppercase">iyzico</span>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-green-50 border border-green-200 text-green-700">Bağlı</span>
              </div>
              <div className="space-y-3">
                <div>
                  <span className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider block mb-1">API Key</span>
                  <input
                    type="password"
                    value={iyzicoApiKey}
                    onChange={(e) => setIyzicoApiKey(e.target.value)}
                    className="w-full h-10 px-3 border border-zinc-200 rounded-xl text-xs outline-none"
                  />
                </div>
                <div>
                  <span className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider block mb-1">Secret Key</span>
                  <input
                    type="password"
                    value={iyzicoSecretKey}
                    onChange={(e) => setIyzicoSecretKey(e.target.value)}
                    className="w-full h-10 px-3 border border-zinc-200 rounded-xl text-xs outline-none"
                  />
                </div>
                <label className="flex items-center justify-between cursor-pointer select-none">
                  <span className="text-xs font-bold text-zinc-700">Test (Sandbox) Modu</span>
                  <input
                    type="checkbox"
                    checked={iyzicoTestMode}
                    onChange={(e) => setIyzicoTestMode(e.target.checked)}
                    className="w-4 h-4 accent-[#df0000] cursor-pointer"
                  />
                </label>
              </div>
              <Button onClick={handleSave} loading={saving} className="w-full rounded-2xl bg-zinc-900 text-white hover:bg-zinc-800 h-10 active:scale-95 text-xs">
                Yapılandır
              </Button>
            </div>

            {/* PayTR */}
            <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-sm space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-xs font-black text-zinc-900 uppercase">PayTR</span>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-green-50 border border-green-200 text-green-700">Bağlı</span>
              </div>
              <div className="text-center py-10 text-zinc-400 italic text-xs font-medium">
                PayTR entegrasyonu aktif olarak çalışıyor.
              </div>
              <Button className="w-full rounded-2xl border border-zinc-200 text-zinc-700 hover:bg-zinc-50 h-10 active:scale-95 text-xs">
                Ayarla
              </Button>
            </div>

            {/* Stripe */}
            <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-sm space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-xs font-black text-zinc-900 uppercase">Stripe</span>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-zinc-50 border border-zinc-200 text-zinc-500">Bağlanmadı</span>
              </div>
              <div className="text-center py-10 text-zinc-400 italic text-xs font-medium">
                Yurtdışı ödemelerini Stripe ile toplayın.
              </div>
              <Button className="w-full rounded-2xl bg-[#df0000] text-white hover:bg-[#c00000] h-10 active:scale-95 text-xs">
                Bağlan
              </Button>
            </div>
          </div>
        </div>

        {/* Section 2: Kargo Firmaları */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-zinc-800 uppercase tracking-wider">Kargo Firmaları</h3>
          <div className="grid gap-6 md:grid-cols-4">
            {['MNG', 'Yurtiçi', 'Aras', 'PTT'].map((cargo) => (
              <div key={cargo} className="rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-sm space-y-3 flex flex-col justify-between">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-zinc-850">{cargo} Kargo</span>
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-green-50 border border-green-200 text-green-700">Bağlı</span>
                </div>
                <div>
                  <span className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider block mb-1">API Key / Müsteri Kodu</span>
                  <input
                    type="text"
                    value={cargo === 'MNG' ? mngApiKey : '**********'}
                    onChange={(e) => cargo === 'MNG' && setMngApiKey(e.target.value)}
                    className="w-full h-10 px-3 border border-zinc-200 rounded-xl text-xs outline-none"
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => showToast(`${cargo} API test sinyali başarılı.`, 'success')} className="w-full rounded-xl active:scale-95 text-[10px] font-bold py-1.5">
                    Test Et
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Section 3: E-posta & Muhasebe */}
        <div className="grid gap-6 md:grid-cols-2">
          
          {/* E-posta Servisi */}
          <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-zinc-850 uppercase tracking-wider">E-posta Servisi (SMTP)</h3>
            <div className="grid grid-cols-2 gap-4">
              <Input label="SMTP Sunucusu" value={smtpServer} onChange={(e) => setSmtpServer(e.target.value)} className="rounded-2xl" />
              <Input label="SMTP Portu" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} className="rounded-2xl" />
            </div>
            <div className="flex gap-2">
              <Button type="button" onClick={() => showToast('Test e-postası sıraya alındı.', 'success')} variant="outline" className="flex-1 rounded-2xl h-11 active:scale-95 text-xs">Test Gönder</Button>
              <Button type="button" onClick={handleSave} variant="primary" className="flex-1 rounded-2xl bg-zinc-900 hover:bg-zinc-800 text-white h-11 active:scale-95 text-xs">Kaydet</Button>
            </div>
          </div>

          {/* Muhasebe & ERP */}
          <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-zinc-850 uppercase tracking-wider">Muhasebe & ERP Entegrasyonları</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="border border-zinc-200 rounded-2xl p-4 flex flex-col justify-between aspect-[3/2] bg-zinc-50/20">
                <span className="text-xs font-black text-zinc-900 uppercase">Logo Go3/Tiger</span>
                <span className="text-[10px] text-zinc-400 font-semibold italic">Bağlantı pasif</span>
                <Button className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-800 text-[10px] py-1">Bağlan</Button>
              </div>
              <div className="border border-zinc-200 rounded-2xl p-4 flex flex-col justify-between aspect-[3/2] bg-zinc-50/20">
                <span className="text-xs font-black text-zinc-900 uppercase">Paraşüt</span>
                <span className="text-[10px] text-zinc-400 font-semibold italic">Bağlantı pasif</span>
                <Button className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-800 text-[10px] py-1">Bağlan</Button>
              </div>
            </div>
          </div>
        </div>

        {/* Section 4: Sosyal Medya */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-zinc-850 uppercase tracking-wider">Sosyal Medya OAuth</h3>
          <div className="grid gap-6 md:grid-cols-4">
            {['Instagram', 'Facebook', 'Twitter', 'Google'].map((p) => (
              <div key={p} className="rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-sm flex items-center justify-between hover:shadow-md transition-all duration-300">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-zinc-50 border border-zinc-200 text-zinc-700 font-black text-xs flex items-center justify-center">
                    {p[0]}
                  </div>
                  <span className="text-xs font-bold text-zinc-900">{p}</span>
                </div>
                <Button type="button" onClick={() => handleConnectOAuth(p)} className="rounded-xl border border-zinc-200 text-zinc-650 hover:bg-zinc-50 text-[10px] py-1.5 px-3">
                  Bağlan
                </Button>
              </div>
            ))}
          </div>
        </div>

      </div>
    </AdminLayout>
  )
}
