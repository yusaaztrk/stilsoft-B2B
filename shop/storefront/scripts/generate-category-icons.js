const fs = require('fs');
const path = require('path');

const targetDir = path.join(__dirname, '..', 'public', 'categories');
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

const icons = {
  'ankastre.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
    <rect width="100" height="100" rx="20" fill="#F8FAFC"/>
    <rect x="18" y="20" width="64" height="60" rx="8" fill="#1E293B" stroke="#0F172A" stroke-width="2.5"/>
    <rect x="25" y="27" width="50" height="14" rx="4" fill="#334155"/>
    <circle cx="34" cy="34" r="3" fill="#E2E8F0"/>
    <circle cx="44" cy="34" r="3" fill="#E2E8F0"/>
    <circle cx="56" cy="34" r="3" fill="#E2E8F0"/>
    <circle cx="66" cy="34" r="3" fill="#E2E8F0"/>
    <rect x="25" y="47" width="50" height="26" rx="4" fill="#0F172A" stroke="#475569" stroke-width="1.5"/>
    <line x1="32" y1="52" x2="68" y2="52" stroke="#C8102E" stroke-width="2.5" stroke-linecap="round"/>
    <rect x="36" y="58" width="28" height="10" rx="2" fill="#E2E8F0" opacity="0.8"/>
  </svg>`,

  'gida-hazirlama.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
    <rect width="100" height="100" rx="20" fill="#F8FAFC"/>
    <!-- Airfryer & Blender Body -->
    <path d="M26 32C26 24 34 20 50 20C66 20 74 24 74 32V68C74 76 66 80 50 80C34 80 26 76 26 68V32Z" fill="#1E293B" stroke="#0F172A" stroke-width="2"/>
    <rect x="34" y="26" width="32" height="16" rx="4" fill="#0F172A" stroke="#475569" stroke-width="1.5"/>
    <text x="50" y="38" fill="#38BDF8" font-size="10" font-family="ui-monospace, monospace" font-weight="bold" text-anchor="middle">200°C</text>
    <rect x="30" y="48" width="40" height="26" rx="6" fill="#334155" stroke="#475569" stroke-width="1.5"/>
    <rect x="46" y="54" width="8" height="14" rx="3" fill="#C8102E"/>
  </svg>`,

  'icecek-hazirlama.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
    <rect width="100" height="100" rx="20" fill="#F8FAFC"/>
    <!-- Kettle / Tea Maker -->
    <path d="M35 38C35 30 40 24 50 24C60 24 65 30 65 38V72C65 76 60 78 50 78C40 78 35 76 35 72V38Z" fill="#E2E8F0" stroke="#475569" stroke-width="2"/>
    <path d="M30 78H70V82C70 83 69 84 68 84H32C31 84 30 83 30 82V78Z" fill="#1E293B"/>
    <path d="M65 42H75C78 42 80 44 80 47V63C80 66 78 68 75 68H65" stroke="#1E293B" stroke-width="3" stroke-linecap="round"/>
    <path d="M35 46L24 38L35 34" stroke="#475569" stroke-width="2" stroke-linejoin="round" fill="#E2E8F0"/>
    <rect x="42" y="44" width="16" height="22" rx="3" fill="#0284C7" opacity="0.3"/>
    <circle cx="50" cy="55" r="3" fill="#C8102E"/>
  </svg>`,

  'buzdolabi.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
    <rect width="100" height="100" rx="20" fill="#F8FAFC"/>
    <rect x="28" y="16" width="44" height="68" rx="6" fill="#F1F5F9" stroke="#334155" stroke-width="2.5"/>
    <line x1="28" y1="42" x2="72" y2="42" stroke="#334155" stroke-width="2"/>
    <rect x="33" y="24" width="3" height="12" rx="1.5" fill="#C8102E"/>
    <rect x="33" y="48" width="3" height="20" rx="1.5" fill="#334155"/>
    <rect x="42" y="22" width="22" height="10" rx="2" fill="#E2E8F0"/>
    <text x="53" y="30" fill="#0284C7" font-size="7" font-family="sans-serif" font-weight="bold" text-anchor="middle">-18°C</text>
  </svg>`,

  'ev-gerecleri.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
    <rect width="100" height="100" rx="20" fill="#F8FAFC"/>
    <!-- Vantilatör / Ev Gereci -->
    <circle cx="50" cy="38" r="20" fill="#F1F5F9" stroke="#334155" stroke-width="2"/>
    <circle cx="50" cy="38" r="4" fill="#C8102E"/>
    <path d="M50 38C44 32 42 24 50 22C58 24 56 32 50 38Z" fill="#94A3B8"/>
    <path d="M50 38C56 44 64 46 66 38C64 30 56 32 50 38Z" fill="#94A3B8"/>
    <path d="M50 38C44 44 36 42 34 50C36 58 44 56 50 38Z" fill="#94A3B8"/>
    <path d="M50 58V78" stroke="#334155" stroke-width="3" stroke-linecap="round"/>
    <path d="M34 82H66" stroke="#334155" stroke-width="3.5" stroke-linecap="round"/>
  </svg>`,

  'baza.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
    <rect width="100" height="100" rx="20" fill="#F8FAFC"/>
    <rect x="18" y="30" width="12" height="42" rx="3" fill="#475569" stroke="#1E293B" stroke-width="1.5"/>
    <rect x="30" y="44" width="52" height="20" rx="4" fill="#94A3B8" stroke="#334155" stroke-width="1.5"/>
    <line x1="30" y1="52" x2="82" y2="52" stroke="#CBD5E1" stroke-width="1.5"/>
    <rect x="30" y="64" width="52" height="8" rx="2" fill="#1E293B"/>
    <line x1="34" y1="72" x2="34" y2="78" stroke="#1E293B" stroke-width="3" stroke-linecap="round"/>
    <line x1="78" y1="72" x2="78" y2="78" stroke="#1E293B" stroke-width="3" stroke-linecap="round"/>
  </svg>`,

  'elektrikli-ev-aletleri.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
    <rect width="100" height="100" rx="20" fill="#F8FAFC"/>
    <rect x="18" y="24" width="64" height="42" rx="4" fill="#0F172A" stroke="#334155" stroke-width="2"/>
    <rect x="22" y="28" width="56" height="34" rx="2" fill="#1E293B"/>
    <path d="M42 45L58 35V55L42 45Z" fill="#C8102E"/>
    <path d="M44 66L40 76H60L56 66" fill="#475569"/>
    <line x1="34" y1="76" x2="66" y2="76" stroke="#1E293B" stroke-width="3" stroke-linecap="round"/>
  </svg>`,

  'kisisel-bakim.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
    <rect width="100" height="100" rx="20" fill="#F8FAFC"/>
    <!-- Saç Kurutma -->
    <rect x="26" y="28" width="34" height="20" rx="10" fill="#1E293B" stroke="#0F172A" stroke-width="2"/>
    <path d="M60 33L76 29V47L60 43V33Z" fill="#334155" stroke="#0F172A" stroke-width="1.5"/>
    <path d="M38 48L32 76C32 78 34 80 36 80H42C44 80 46 78 46 76L50 48" fill="#1E293B" stroke="#0F172A" stroke-width="2"/>
    <circle cx="39" cy="58" r="2.5" fill="#C8102E"/>
  </svg>`,

  'baslik.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
    <rect width="100" height="100" rx="20" fill="#F8FAFC"/>
    <rect x="18" y="24" width="64" height="48" rx="6" fill="#334155" stroke="#1E293B" stroke-width="2"/>
    <rect x="24" y="30" width="14" height="16" rx="2" fill="#475569"/>
    <rect x="43" y="30" width="14" height="16" rx="2" fill="#475569"/>
    <rect x="62" y="30" width="14" height="16" rx="2" fill="#475569"/>
    <rect x="24" y="50" width="14" height="16" rx="2" fill="#475569"/>
    <rect x="43" y="50" width="14" height="16" rx="2" fill="#475569"/>
    <rect x="62" y="50" width="14" height="16" rx="2" fill="#475569"/>
    <line x1="24" y1="72" x2="24" y2="80" stroke="#1E293B" stroke-width="3" stroke-linecap="round"/>
    <line x1="76" y1="72" x2="76" y2="80" stroke="#1E293B" stroke-width="3" stroke-linecap="round"/>
  </svg>`,

  'utu.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
    <rect width="100" height="100" rx="20" fill="#F8FAFC"/>
    <!-- Modern Ütü -->
    <path d="M22 64H78C78 64 74 44 54 44H34C26 44 22 52 22 64Z" fill="#C8102E" stroke="#991B1B" stroke-width="2"/>
    <path d="M20 68H80V72H20V68Z" fill="#64748B" rx="2"/>
    <path d="M42 44V34C42 30 46 26 50 26H64C68 26 72 30 72 34V46" stroke="#1E293B" stroke-width="3" stroke-linecap="round" fill="none"/>
    <circle cx="48" cy="54" r="3" fill="#FFFFFF"/>
  </svg>`,

  'derin-dondurucu.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
    <rect width="100" height="100" rx="20" fill="#F8FAFC"/>
    <rect x="20" y="32" width="60" height="46" rx="4" fill="#F8FAFC" stroke="#334155" stroke-width="2.5"/>
    <rect x="18" y="24" width="64" height="10" rx="3" fill="#E2E8F0" stroke="#334155" stroke-width="2"/>
    <rect x="42" y="36" width="16" height="4" rx="2" fill="#C8102E"/>
    <circle cx="70" cy="40" r="2" fill="#22C55E"/>
    <circle cx="70" cy="46" r="2" fill="#EF4444"/>
  </svg>`,

  'su-sebili.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
    <rect width="100" height="100" rx="20" fill="#F8FAFC"/>
    <rect x="32" y="20" width="36" height="66" rx="6" fill="#F1F5F9" stroke="#334155" stroke-width="2"/>
    <rect x="38" y="32" width="24" height="18" rx="3" fill="#0F172A"/>
    <circle cx="44" cy="38" r="2" fill="#0284C7"/>
    <circle cx="56" cy="38" r="2" fill="#DC2626"/>
    <line x1="38" y1="60" x2="62" y2="60" stroke="#CBD5E1" stroke-width="1.5"/>
  </svg>`,

  'silte.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
    <rect width="100" height="100" rx="20" fill="#F8FAFC"/>
    <path d="M22 46L50 32L78 46L50 60L22 46Z" fill="#F1F5F9" stroke="#334155" stroke-width="2"/>
    <path d="M22 46V56L50 70V60L22 46Z" fill="#CBD5E1" stroke="#334155" stroke-width="2"/>
    <path d="M78 46V56L50 70V60L78 46Z" fill="#94A3B8" stroke="#334155" stroke-width="2"/>
    <line x1="36" y1="46" x2="64" y2="46" stroke="#C8102E" stroke-width="1.5"/>
  </svg>`,

  'ev-temizligi.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
    <rect width="100" height="100" rx="20" fill="#F8FAFC"/>
    <!-- Şarjlı Dikey Süpürge -->
    <rect x="42" y="18" width="16" height="22" rx="8" fill="#C8102E" stroke="#991B1B" stroke-width="2"/>
    <rect x="46" y="24" width="8" height="10" rx="3" fill="#0F172A"/>
    <line x1="50" y1="40" x2="50" y2="68" stroke="#334155" stroke-width="4" stroke-linecap="round"/>
    <path d="M36 78H64L60 68H40L36 78Z" fill="#1E293B" stroke="#0F172A" stroke-width="2"/>
    <circle cx="50" cy="74" r="2" fill="#38BDF8"/>
  </svg>`,

  'camasir-makinesi.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
    <rect width="100" height="100" rx="20" fill="#F8FAFC"/>
    <rect x="24" y="18" width="52" height="66" rx="6" fill="#F8FAFC" stroke="#334155" stroke-width="2.5"/>
    <rect x="28" y="24" width="18" height="8" rx="2" fill="#E2E8F0"/>
    <circle cx="58" cy="28" r="3" fill="#334155"/>
    <circle cx="50" cy="56" r="18" fill="#E2E8F0" stroke="#334155" stroke-width="2"/>
    <circle cx="50" cy="56" r="12" fill="#0284C7" opacity="0.4"/>
  </svg>`,

  'klima.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
    <rect width="100" height="100" rx="20" fill="#F8FAFC"/>
    <rect x="18" y="34" width="64" height="28" rx="4" fill="#F8FAFC" stroke="#334155" stroke-width="2"/>
    <line x1="24" y1="54" x2="76" y2="54" stroke="#CBD5E1" stroke-width="1.5"/>
    <rect x="62" y="40" width="14" height="6" rx="1.5" fill="#0F172A"/>
    <text x="69" y="45" fill="#22C55E" font-size="5" font-family="ui-monospace" font-weight="bold" text-anchor="middle">24°</text>
    <path d="M30 66C36 74 44 74 50 66C56 74 64 74 70 66" stroke="#38BDF8" stroke-width="1.5" stroke-linecap="round" fill="none"/>
  </svg>`,

  'bulasik-makinesi.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
    <rect width="100" height="100" rx="20" fill="#F8FAFC"/>
    <rect x="24" y="18" width="52" height="66" rx="6" fill="#F8FAFC" stroke="#334155" stroke-width="2.5"/>
    <rect x="28" y="24" width="44" height="10" rx="2" fill="#1E293B"/>
    <circle cx="36" cy="29" r="2" fill="#22C55E"/>
    <circle cx="44" cy="29" r="2" fill="#E2E8F0"/>
    <rect x="36" y="40" width="28" height="3" rx="1.5" fill="#64748B"/>
    <rect x="30" y="48" width="40" height="30" rx="3" fill="#F1F5F9" stroke="#E2E8F0" stroke-width="1.5"/>
  </svg>`,

  'ev-tekstili.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
    <rect width="100" height="100" rx="20" fill="#F8FAFC"/>
    <!-- Visco Yastık -->
    <path d="M22 42C22 36 34 32 50 32C66 32 78 36 78 42V56C78 62 66 66 50 66C34 66 22 62 22 56V42Z" fill="#F1F5F9" stroke="#334155" stroke-width="2"/>
    <path d="M30 46C38 42 62 42 70 46" stroke="#C8102E" stroke-width="1.5" stroke-linecap="round"/>
    <circle cx="50" cy="50" r="3" fill="#E2E8F0"/>
  </svg>`
};

for (const [filename, content] of Object.entries(icons)) {
  fs.writeFileSync(path.join(targetDir, filename), content.trim());
}

console.log('Successfully generated all 18 category icons!');
