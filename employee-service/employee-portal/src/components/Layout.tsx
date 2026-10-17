import React from 'react'
import Sidebar from './Sidebar'

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f8f7f4] text-[#1a1a1a] font-sans flex flex-col md:flex-row selection:bg-[#c5a059]/20 selection:text-[#5e432a]">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 bg-[#f8f7f4]">
        {/*
          Genislik SINIRLANMAZ. Onceden `max-w-[1700px] mx-auto` vardi; genis ekranda icerik
          ortalanip iki yanda genis bosluk birakiyordu, personel tablosu ise 20'ye yakin sutunla
          bu daralmis alanin icinde yatay kaydirmaya dusuyordu. `min-w-0` sart: flex cocugunun
          varsayilan min-width'i `auto` oldugu icin tablonun `overflow-x-auto` kutusu tasar.
        */}
        <main className="flex-1 w-full min-w-0 p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  )
}


