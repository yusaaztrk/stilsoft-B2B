import React from 'react'

export default function SecurityTrustBar() {
  const badges = [
    { title: '🔒 3D Secure', sub: 'Banka Doğrulaması', desc: 'Güvenli SMS Onayı' },
    { title: '🛡️ 256-Bit SSL', sub: 'Şifreli İletişim', desc: 'Uçtan Uca Koruma' },
    { title: '💳 PCI-DSS Uyumlu', sub: 'Kart Saklanmaz', desc: 'Güvenli Veri Akışı' }
  ]

  return (
    <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 shadow-2xs">
      <div className="grid grid-cols-3 gap-2 text-center divide-x divide-slate-200">
        {badges.map((b) => (
          <div key={b.title} className="first:pl-0 pl-2 flex flex-col justify-center">
            <span className="text-xs font-bold text-slate-800 tracking-tight leading-none">
              {b.title}
            </span>
            <span className="text-[9px] font-bold text-slate-500 mt-1 leading-none">
              {b.sub}
            </span>
            <span className="text-[8px] text-slate-400 mt-0.5 leading-tight hidden sm:inline">
              {b.desc}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
