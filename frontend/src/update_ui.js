const fs = require('fs');
const files = [
  'C:/Users/Admin/Desktop/B2B-ERP/frontend/src/pages/StokHareketDokumuPage.tsx',
  'C:/Users/Admin/Desktop/B2B-ERP/frontend/src/pages/DepoTransferPage.tsx',
  'C:/Users/Admin/Desktop/B2B-ERP/frontend/src/pages/DepoStokPage.tsx'
];

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');

  // 1. Replace sharp borders
  content = content.replace(/border-gray-300/g, 'border-slate-200');

  // 2. Container styles
  content = content.replace(/bg-white border border-gray-100 rounded-xl shadow-sm/g, 'bg-white rounded-xl shadow-sm border border-slate-200');
  content = content.replace(/bg-white rounded-lg shadow-md/g, 'bg-white rounded-xl shadow-sm border border-slate-200');

  // 3. Inputs / selects / dates
  content = content.replace(/className="input-base"/g, 'className="h-10 px-3 text-sm rounded-lg border-slate-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all outline-none bg-white"');
  content = content.replace(/className="input-base text-right"/g, 'className="text-right h-10 px-3 text-sm rounded-lg border-slate-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all outline-none bg-white"');

  // 4. Tables wrappers
  content = content.replace(/<table className="w-full(.*?)">/g, (match, p1) => {
     let minW = p1.includes('min-w-[520px]') ? ' min-w-[520px]' : (p1.includes('min-w-[700px]') ? ' min-w-[700px]' : '');
     return '<div className="overflow-x-auto"><table className="w-full text-left border-collapse text-xs whitespace-nowrap' + minW + '">';
  });

  // Table headers bg
  content = content.replace(/<tr className="bg-gray-50 text-\[10px\] font-semibold text-gray-500 uppercase tracking-widest border-b border-gray-100">/g, '<tr className="bg-slate-50/80">');
  content = content.replace(/<tr className="bg-gray-50 text-\[11px\] font-semibold text-gray-600">/g, '<tr className="bg-slate-50/80">');
  
  // th cells
  content = content.replace(/<th className="px-3 py-2 text-left">/g, '<th className="px-4 py-3 font-semibold text-slate-600 uppercase tracking-wider text-left">');
  content = content.replace(/<th className="px-3 py-2 text-right( w-\[.*?\])?">/g, (match, p1) => '<th className="px-4 py-3 font-semibold text-slate-600 uppercase tracking-wider text-right' + (p1 || '') + '">');
  content = content.replace(/<th className="px-3 py-2">/g, '<th className="px-4 py-3 font-semibold text-slate-600 uppercase tracking-wider">');
  
  // tbody
  content = content.replace(/<tbody className="text-\[12px\]">/g, '<tbody className="divide-y divide-slate-100">');
  
  // tr in body
  content = content.replace(/<tr(.*?)className="border-t border-gray-100 hover:bg-gray-50">/g, '<tr$1className="hover:bg-slate-50 cursor-pointer transition-colors">');
  content = content.replace(/<tr(.*?)className="border-t border-gray-100">/g, '<tr$1className="hover:bg-slate-50 cursor-pointer transition-colors">');
  content = content.replace(/<tr(.*?)className="border-t border-gray-50">/g, '<tr$1className="hover:bg-slate-50 cursor-pointer transition-colors">');

  // 5. Labels
  content = content.replace(/text-xs font-semibold text-gray-600 uppercase tracking-wide/g, 'text-xs font-semibold text-slate-600 uppercase tracking-wide');
  
  // Cleanup duplicate overflow-x-auto if any
  content = content.replace(/<div className="overflow-x-auto">\s*<div className="overflow-x-auto">/g, '<div className="overflow-x-auto">');
  
  fs.writeFileSync(file, content);
});
console.log('Done!');
