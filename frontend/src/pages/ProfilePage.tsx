import React from 'react'

export default function ProfilePage() {
  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Profil</h1>
          <p className="text-xs text-gray-400 mt-0.5">Kullanıcı Ayarları</p>
        </div>
      </div>
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm px-6 py-10 text-center">
        <div className="text-gray-300 text-2xl mb-1">👤</div>
        <div className="text-xs text-gray-400 font-medium">Bu ekran sonraki adımda yapılacak.</div>
      </div>
    </div>
  )
}
