const fs = require('fs')
const path = require('path')

const files = [
  'CustomerOfferPage.tsx',
  'StokHareketDokumuPage.tsx',
  'DepoTransferPage.tsx',
  'DepoStokPage.tsx'
]

const dir = path.join(__dirname, '../src/pages')

for (const file of files) {
  const p = path.join(dir, file)
  if (!fs.existsSync(p)) {
    console.log(`Skipping ${file}, not found`)
    continue
  }
  
  let content = fs.readFileSync(p, 'utf8')
  
  // Container modernization
  content = content.replace(/border-gray-100 rounded-xl shadow-sm/g, 'rounded-xl border-slate-200 shadow-sm')
  
  // Table wrappers
  content = content.replace(/<table className="w-full border border-gray-200 border-collapse">/g, '<div className="overflow-x-auto"><table className="w-full text-left border-collapse text-xs whitespace-nowrap">')
  content = content.replace(/<table className="w-full border-collapse border border-gray-200">/g, '<div className="overflow-x-auto"><table className="w-full text-left border-collapse text-xs whitespace-nowrap">')
  // Add closing div for table wrappers if needed, but doing it safely via replace might be tricky for closing tags. 
  // Wait, if I just replace `table` classes it's safer. Let's revert wrapper idea and just do classes.

  content = content.replace(/className="w-full border border-gray-200 border-collapse"/g, 'className="w-full text-left border-collapse text-xs whitespace-nowrap"')
  content = content.replace(/className="w-full border-collapse border border-gray-200"/g, 'className="w-full text-left border-collapse text-xs whitespace-nowrap"')
  
  // Thead
  content = content.replace(/<tr className="bg-gray-100 border-b border-gray-300">/g, '<tr className="bg-slate-50/80 border-b border-slate-200">')
  content = content.replace(/<tr className="bg-gray-50 border-b border-gray-200">/g, '<tr className="bg-slate-50/80 border-b border-slate-200">')
  
  // Th
  content = content.replace(/className="px-3 py-2 text-left text-\[11px\] font-semibold text-gray-700 uppercase tracking-wide border border-gray-200/g, 'className="px-4 py-3 text-left font-semibold text-slate-600 uppercase tracking-wider relative group border-b border-slate-200')
  content = content.replace(/className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wide border border-gray-200/g, 'className="px-4 py-3 text-center font-semibold text-slate-600 uppercase tracking-wider relative group border-b border-slate-200')
  content = content.replace(/className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wide border border-gray-200/g, 'className="px-4 py-3 text-right font-semibold text-slate-600 uppercase tracking-wider relative group border-b border-slate-200')
  
  // Filter row
  content = content.replace(/<tr className="bg-white border-b border-gray-300">/g, '<tr className="bg-slate-50/50 border-b border-slate-200">')
  content = content.replace(/className="px-3 py-2 border border-gray-200"/g, 'className="px-3 py-2"')
  
  // Tbody rows
  content = content.replace(/className="px-3 py-3 text-sm text-gray-800 border border-gray-200"/g, 'className="px-4 py-3 text-slate-700"')
  content = content.replace(/className="px-4 py-3 text-sm text-gray-800 border border-gray-200"/g, 'className="px-4 py-3 text-slate-700"')
  content = content.replace(/className="px-4 py-3 text-sm text-gray-800 text-center border border-gray-200"/g, 'className="px-4 py-3 text-slate-700 text-center"')
  content = content.replace(/text-gray-800 text-right/g, 'text-slate-700 text-right')
  
  content = content.replace(/hover:bg-gray-50/g, 'hover:bg-slate-50')
  content = content.replace(/bg-gray-50\/50/g, 'bg-slate-50/50')
  
  // Buttons
  content = content.replace(/border-gray-200/g, 'border-slate-200')
  content = content.replace(/border-gray-300/g, 'border-slate-200')
  content = content.replace(/text-gray-800/g, 'text-slate-700')
  content = content.replace(/text-gray-700/g, 'text-slate-600')
  content = content.replace(/text-gray-600/g, 'text-slate-500')
  content = content.replace(/text-gray-500/g, 'text-slate-400')
  
  fs.writeFileSync(p, content)
  console.log(`Modernized ${file}`)
}
