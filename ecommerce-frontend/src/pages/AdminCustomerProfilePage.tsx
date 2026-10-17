import { useState } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useToast } from '../components/ui/ToastContext'

export function AdminCustomerProfilePage() {
  const { showToast } = useToast()
  const [activeTab, setActiveTab] = useState('orders') // orders, addresses, reviews, notes

  // Customer State
  const [fullName, setFullName] = useState('Ahmet Yılmaz')
  const [email, setEmail] = useState('ahmet@gmail.com')
  const [phone, setPhone] = useState('0543 543 2110')
  const [segment, setSegment] = useState('VIP')
  const [newsletter, setNewsletter] = useState(true)

  // Internal Notes State
  const [newNote, setNewNote] = useState('')
  const [notes, setNotes] = useState([
    { text: 'Kargoların MNG ile gönderilmesini tercih ediyor.', date: '01.06.2025 14:10' },
    { text: 'Telefon üzerinden indirim kuponu talep etti.', date: '15.05.2025 11:20' }
  ])

  const handleAddNote = () => {
    if (newNote.trim()) {
      setNotes([{ text: newNote.trim(), date: 'Bugün' }, ...notes])
      setNewNote('')
      showToast('Müşteri notu eklendi.', 'success')
    }
  }

  const handleSaveInfo = () => {
    showToast('Müşteri bilgileri başarıyla güncellendi.', 'success')
  }

  return (
    <AdminLayout
      title="Müşteri Profili"
      subtitle="Müşterinin geçmiş siparişlerini, adreslerini, yorumlarını ve hesap bilgilerini inceleyin."
    >
      {/* Hero Card */}
      <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="flex items-center gap-4.5">
          <div className="w-16 h-16 rounded-full bg-[#df0000]/10 text-[#df0000] border border-[#df0000]/20 flex items-center justify-center font-black text-xl">
            AY
          </div>
          <div>
            <h2 className="text-xl font-black text-zinc-950 flex items-center gap-2 leading-none">
              {fullName}
              <span className="inline-flex items-center px-3 py-1 rounded-full text-[9px] font-bold bg-purple-50 border border-purple-100 text-purple-700 uppercase tracking-wider">
                {segment}
              </span>
            </h2>
            <span className="block text-xs font-semibold text-zinc-450 mt-1.5">{email} | {phone}</span>
          </div>
        </div>

        {/* 5 KPI Chips */}
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'Siparişler', value: '47 Sipariş' },
            { label: 'Harcama', value: '84.290 ₺' },
            { label: 'Ort. Sepet', value: '1.793 ₺' },
            { label: 'Sadakat Puanı', value: '2.840 Puan' },
            { label: 'Üyelik Süresi', value: '1 Yıl 5 Ay' },
          ].map((chip) => (
            <div key={chip.label} className="bg-zinc-50 border border-zinc-150 rounded-2xl px-4 py-2.5 flex flex-col items-center">
              <span className="text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider">{chip.label}</span>
              <span className="text-xs font-black text-zinc-800 mt-0.5">{chip.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column - Tabs (63%) */}
        <div className="lg:col-span-8 space-y-6">
          <div className="flex gap-2 border-b border-zinc-200 pb-3 overflow-x-auto">
            {[
              { key: 'orders', label: 'Siparişler' },
              { key: 'addresses', label: 'Adresler' },
              { key: 'reviews', label: 'Yorumlar' },
              { key: 'notes', label: 'Dahili Notlar' },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4.5 py-2 rounded-2xl text-xs font-bold transition-all shrink-0 ${
                  activeTab === tab.key
                    ? 'bg-zinc-900 text-white shadow-sm'
                    : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Orders Tab */}
          {activeTab === 'orders' && (
            <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-zinc-800 uppercase tracking-wider">Sipariş Geçmişi</h3>
              <div className="overflow-hidden border border-zinc-150 rounded-2xl">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-zinc-50 border-b border-zinc-150 text-[10px] font-extrabold tracking-wider text-zinc-400 uppercase">
                      <th className="px-5 py-3">Sipariş No</th>
                      <th className="px-5 py-3">Tarih</th>
                      <th className="px-5 py-3">Ürünler</th>
                      <th className="px-5 py-3 text-center">Tutar</th>
                      <th className="px-5 py-3 text-right">Durum</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-150/60 text-xs text-zinc-750">
                    {[
                      { no: '#10234', date: '06.06.2025 14:20', items: 'Samsung S24, AirPods Pro', total: '76.462 ₺', status: 'Teslim Edildi' },
                      { no: '#10198', date: '20.05.2025 11:10', items: 'Levi\'s 501, Nike Air Max', total: '6.798 ₺', status: 'Teslim Edildi' },
                      { no: '#10150', date: '01.04.2025 15:40', items: 'Dyson V15 Detect', total: '18.999 ₺', status: 'Teslim Edildi' }
                    ].map((order, idx) => (
                      <tr key={idx} className="hover:bg-zinc-50/30">
                        <td className="px-5 py-3.5 font-mono font-bold text-zinc-700">{order.no}</td>
                        <td className="px-5 py-3.5 text-zinc-500 font-medium">{order.date}</td>
                        <td className="px-5 py-3.5 font-semibold text-zinc-900">{order.items}</td>
                        <td className="px-5 py-3.5 text-center font-bold text-zinc-950">{order.total}</td>
                        <td className="px-5 py-3.5 text-right">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold border bg-green-50 border-green-150 text-green-700">
                            {order.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Addresses Tab */}
          {activeTab === 'addresses' && (
            <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-sm space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-bold text-zinc-800 uppercase tracking-wider">Kayıtlı Adresler</h3>
                <Button variant="outline" className="rounded-2xl text-[10px] font-bold py-1.5 px-3">Yeni Adres Ekle</Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { title: 'Ev Adresi', text: 'Moda Cd. No:45 D:2 Kadıköy / İstanbul' },
                  { title: 'İş Adresi', text: 'Büyükdere Cd. No:193 Kat:4 Şişli / İstanbul' }
                ].map((addr, idx) => (
                  <div key={idx} className="border border-zinc-200 rounded-2xl p-4.5 bg-zinc-50/50 space-y-2 relative">
                    <span className="block text-[11px] font-extrabold text-[#df0000] uppercase tracking-wider">{addr.title}</span>
                    <p className="text-xs font-semibold text-zinc-750 leading-relaxed">{addr.text}</p>
                    <div className="absolute right-3.5 top-3.5 flex gap-1">
                      <button type="button" className="text-zinc-400 hover:text-zinc-750 flex items-center">
                        <span className="material-symbols-outlined text-[16px]">edit</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reviews Tab */}
          {activeTab === 'reviews' && (
            <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-zinc-800 uppercase tracking-wider">Müşteri Yorumları</h3>
              
              <div className="space-y-3">
                {[
                  { product: 'Ultra-Blend 5000', rating: 5, text: 'Ürün beklediğimden çok daha kaliteli, motor gücü harika.', date: '06.06.2025', status: 'Onaylandı' },
                  { product: 'Dyson V15 Detect', rating: 5, text: 'Çekim gücü mükemmel, temizlik süremiz yarıya indi.', date: '12.05.2025', status: 'Onaylandı' },
                  { product: 'AirPods Pro 2. Nesil', rating: 3, text: 'Ses kalitesi güzel ama kutusu çabuk çiziliyor.', date: '20.04.2025', status: 'Onaylandı' }
                ].map((rev, idx) => (
                  <div key={idx} className="border border-zinc-150 rounded-2xl p-4 bg-zinc-50/20 space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-zinc-900">{rev.product}</span>
                      <span className="text-[10px] text-zinc-400 font-medium">{rev.date}</span>
                    </div>
                    <div className="flex items-center gap-0.5 text-amber-500">
                      {Array.from({ length: rev.rating }).map((_, i) => (
                        <span key={i} className="material-symbols-outlined text-[16px] fill-current">star</span>
                      ))}
                    </div>
                    <p className="text-xs font-medium text-zinc-750">{rev.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes Tab */}
          {activeTab === 'notes' && (
            <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-zinc-800 uppercase tracking-wider">Dahili Müşteri Notları</h3>
              
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Yalnızca yöneticilerin görebileceği iç notlar ekleyin..."
                  rows={2}
                  className="flex-1 rounded-2xl border border-zinc-200 p-3 text-xs font-semibold text-zinc-700 outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000]"
                />
                <Button onClick={handleAddNote} className="rounded-2xl shrink-0 self-end bg-zinc-900 text-white hover:bg-zinc-800 h-11 active:scale-95 px-5">
                  Not Ekle
                </Button>
              </div>

              <div className="space-y-2">
                {notes.map((n, idx) => (
                  <div key={idx} className="bg-zinc-50 border border-zinc-150 rounded-2xl p-4 text-xs font-medium text-zinc-700">
                    <div className="flex justify-between items-center text-[10px] font-extrabold text-zinc-450 uppercase tracking-wider mb-1">
                      <span>Sistem Notu</span>
                      <span>{n.date}</span>
                    </div>
                    {n.text}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column - Sidebar (37%) */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Hesap Bilgileri Formu */}
          <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-zinc-800 uppercase tracking-wider">Hesap Bilgileri</h3>
            
            <Input label="Müşteri Adı Soyadı" value={fullName} onChange={(e) => setFullName(e.target.value)} className="rounded-2xl h-11" />
            <Input label="E-posta Adresi" value={email} onChange={(e) => setEmail(e.target.value)} className="rounded-2xl h-11" />
            <Input label="Telefon" value={phone} onChange={(e) => setPhone(e.target.value)} className="rounded-2xl h-11" />

            <div className="space-y-1.5">
              <label className="text-[10px] font-extrabold tracking-wider text-zinc-400 uppercase">Segment</label>
              <select
                value={segment}
                onChange={(e) => setSegment(e.target.value)}
                className="w-full h-11 px-4 border border-zinc-200 rounded-2xl text-xs font-semibold text-zinc-750 bg-white outline-none"
              >
                <option value="VIP">VIP Müşteri</option>
                <option value="Active">Aktif Üye</option>
                <option value="New">Yeni Üye</option>
              </select>
            </div>

            <Button onClick={handleSaveInfo} className="w-full rounded-2xl bg-zinc-900 text-white hover:bg-zinc-800 h-11 active:scale-95">
              Bilgileri Kaydet
            </Button>
          </div>

          {/* Abonelik & KVKK */}
          <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-zinc-800 uppercase tracking-wider">Abonelik & KVKK</h3>
            
            <label className="flex items-center justify-between cursor-pointer select-none">
              <span className="text-xs font-bold text-zinc-700">E-Bülten Aboneliği</span>
              <input
                type="checkbox"
                checked={newsletter}
                onChange={(e) => setNewsletter(e.target.checked)}
                className="w-4 h-4 accent-[#df0000] cursor-pointer"
              />
            </label>

            <div className="flex justify-between items-center text-xs font-semibold text-zinc-650 pt-2 border-t border-zinc-100">
              <span>KVKK Onay Tarihi</span>
              <span className="text-zinc-850 font-bold">12.01.2024</span>
            </div>
          </div>

          {/* Hesap Durumu */}
          <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-sm space-y-3">
            <h3 className="text-sm font-bold text-zinc-800 uppercase tracking-wider">Hesap Durumu</h3>
            
            <div className="bg-green-50 border border-green-200 rounded-2xl p-4 flex justify-between items-center text-xs font-bold text-green-700">
              <span>Hesap Durumu:</span>
              <span className="uppercase tracking-wider">AKTİF</span>
            </div>

            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1 rounded-2xl border-rose-200 hover:bg-rose-50 text-rose-600 h-11 active:scale-95 text-[10px] font-bold uppercase tracking-wider">
                Hesabı Bloke Et
              </Button>
              <Button type="button" variant="outline" className="flex-1 rounded-2xl border-rose-400 bg-rose-600 hover:bg-rose-700 text-white h-11 active:scale-95 text-[10px] font-bold uppercase tracking-wider">
                Hesabı Sil
              </Button>
            </div>
          </div>

        </div>
      </div>
    </AdminLayout>
  )
}
