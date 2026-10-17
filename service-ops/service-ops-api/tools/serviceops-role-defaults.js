#!/usr/bin/env node
/**
 * ServiceOps rol yetkilerini bir firmaya uygular.
 *
 * İki mod var ve ikisi de tekrar çalıştırılabilir:
 *
 *   --compat    Bugünkü davranışı korur. Kapsam anahtarı (X.tumIsleriGorme) olmayan ama sayfası
 *               açık olan her role o anahtarı verir. Sayfaya erişimin tek başına "hepsini gör"
 *               saydığı eski kural kalktığı için, bu yapılmazsa mevcut roller sessizce daralır.
 *
 *   --defaults  Montaj / Büyük Ürün / Küçük Ürün için tasarlanan 4 rollük matrisi yazar.
 *               Yalnızca bu üç modülün anahtarlarına dokunur; diğer sayfalar olduğu gibi kalır.
 *
 * Kullanım:
 *   node tools/serviceops-role-defaults.js --tenant DEMOTEST --compat
 *   node tools/serviceops-role-defaults.js --tenant DEMOTEST --defaults
 *   node tools/serviceops-role-defaults.js --tenant DEMOTEST --defaults --dry-run
 */

const { Client } = require('pg')

const PG = { host: 'localhost', port: 5434, user: 'b2b', password: 'b2b' }
const MASTER_DB = 'b2b_erp_master'

// ---------------------------------------------------------------------------
// Yeni roller. Code benzersiz; varsa dokunulmaz.
// ---------------------------------------------------------------------------
const NEW_ROLES = [
  { code: 'KlimaEkibi', name: 'Klima Ekibi', displayName: 'Klima Ekibi', description: 'Klima montaj ve saha ekibi' },
  { code: 'SahaMontajEkibi', name: 'Saha Montaj Ekibi', displayName: 'Saha Montaj Ekibi', description: 'Saha montaj ve teslimat ekibi' }
]

// ---------------------------------------------------------------------------
// Kapsamı olan sayfalar: bunlarda "X" sayfayı açar, "X.tumIsleriGorme" kapsamı genişletir.
// Anahtar kapalıysa yalnızca kullanıcıya ait olan (kabul sayfalarında cari, diğerlerinde
// atanan iş) görünür.
// ---------------------------------------------------------------------------
const SCOPED_KEYS = [
  // Alt sekmesi olmayan sayfalar: kapsam kökte durur
  'montajKabul',
  'buyukEvAletleriKabul',
  'kucukUrunKabul',
  'kargoTakibi',
  'kargoPlanlama',
  'teknisyenler',
  'stok',
  'aracDepolari',
  // Sekmeler: kapsam sekmenin kendisinde
  'montajYonetimi.planlama',
  'montajYonetimi.teslimat',
  'buyukUrun.planlama',
  'buyukUrun.sahaPlanlama',
  'buyukUrun.atolye',
  'buyukUrun.hazirTeslimat',
  'buyukUrun.teslimattakiler',
  'atolyeAriza.atolye',
  'atolyeAriza.hazirTeslimat',
  'atolyeAriza.teslimattakiler'
]

/** Sekme kapsam anahtarlarının sayfa satırları. Id'ler B2B seeder'ındakilerle aynı olmalı. */
const SCOPE_PAGES = [
  [5061, 'montajYonetimi.planlama.tumIsleriGorme'],
  [5062, 'montajYonetimi.teslimat.tumIsleriGorme'],
  [5063, 'buyukUrun.planlama.tumIsleriGorme'],
  [5064, 'buyukUrun.sahaPlanlama.tumIsleriGorme'],
  [5065, 'buyukUrun.atolye.tumIsleriGorme'],
  [5066, 'buyukUrun.hazirTeslimat.tumIsleriGorme'],
  [5067, 'buyukUrun.teslimattakiler.tumIsleriGorme'],
  [5068, 'atolyeAriza.atolye.tumIsleriGorme'],
  [5069, 'atolyeAriza.hazirTeslimat.tumIsleriGorme'],
  [5070, 'atolyeAriza.teslimattakiler.tumIsleriGorme']
]

// ---------------------------------------------------------------------------
// Tasarlanan varsayılanlar. 'hepsi' = sayfa + kapsam anahtarı, 'kendi' = yalnızca sayfa.
// Burada adı geçmeyen her anahtar bu roller için KAPATILIR (yalnızca aşağıdaki üç modülde).
// ---------------------------------------------------------------------------
const MODULE_SCOPE = ['montajKabul', 'montajYonetimi', 'buyukEvAletleriKabul', 'buyukUrun', 'kucukUrunKabul', 'atolyeAriza']

const DEFAULTS = {
  ServisMudur: {
    hepsi: [
      'montajKabul',
      'montajYonetimi.planlama', 'montajYonetimi.teslimat',
      'buyukEvAletleriKabul',
      'buyukUrun.planlama', 'buyukUrun.sahaPlanlama', 'buyukUrun.atolye',
      'buyukUrun.hazirTeslimat', 'buyukUrun.teslimattakiler',
      'kucukUrunKabul',
      'atolyeAriza.atolye', 'atolyeAriza.hazirTeslimat', 'atolyeAriza.teslimattakiler'
    ],
    ac: [
      'montajYonetimi', 'buyukUrun', 'atolyeAriza',
      'montajKabul.yeniKabul', 'montajKabul.kabulDuzenle', 'montajYonetimi.geriPlanlama',
      'buyukEvAletleriKabul.yeniKabul', 'kucukUrunKabul.yeniKabul',
      'buyukUrun.islemKaydet', 'buyukUrun.yedekParca',
      'atolyeAriza.islemKaydet', 'atolyeAriza.yedekParca'
    ]
  },

  // Montaj komple kapalı. Yalnızca atölye, orada da her şeyi görür.
  ServisPersonel: {
    hepsi: ['buyukUrun.atolye', 'atolyeAriza.atolye'],
    ac: [
      'buyukUrun', 'atolyeAriza',
      'buyukUrun.islemKaydet', 'buyukUrun.yedekParca',
      'atolyeAriza.islemKaydet', 'atolyeAriza.yedekParca'
    ]
  },

  // Küçük üründe hiçbir şey. Montajda ve büyük üründe yalnızca kendine atananlar.
  KlimaEkibi: {
    hepsi: [],
    ac: [
      'montajYonetimi', 'montajYonetimi.teslimat',
      'buyukUrun', 'buyukUrun.sahaPlanlama', 'buyukUrun.teslimattakiler',
      'buyukUrun.islemKaydet'
    ]
  },

  SahaMontajEkibi: {
    hepsi: [],
    ac: [
      'montajYonetimi', 'montajYonetimi.teslimat',
      'buyukUrun', 'buyukUrun.sahaPlanlama', 'buyukUrun.teslimattakiler',
      'buyukUrun.islemKaydet',
      'atolyeAriza', 'atolyeAriza.teslimattakiler'
    ]
  },

  // B2B'nin müdür rolü büyük ev kabulde her şeyi görür. Başka sayfasına dokunulmaz.
  Mudur: {
    hepsi: ['buyukEvAletleriKabul'],
    ac: [],
    sadeceListelenenler: true
  }
}

// ---------------------------------------------------------------------------

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : null
}
const HAS = (name) => process.argv.includes(name)

async function resolveDb(tenantCode) {
  const m = new Client({ ...PG, database: MASTER_DB })
  await m.connect()
  try {
    const r = await m.query('SELECT "DbName" FROM public."Tenants" WHERE LOWER("Code") = $1 LIMIT 1', [tenantCode.toLowerCase()])
    if (r.rowCount === 0) throw new Error(`Firma bulunamadi: ${tenantCode}`)
    return r.rows[0].DbName || 'b2b_erp'
  } finally {
    await m.end()
  }
}

async function main() {
  const tenant = arg('--tenant')
  const compat = HAS('--compat')
  const defaults = HAS('--defaults')
  const dryRun = HAS('--dry-run')

  if (!tenant || (!compat && !defaults)) {
    console.error('Kullanim: --tenant <KOD> (--compat | --defaults) [--dry-run]')
    process.exit(2)
  }

  const db = await resolveDb(tenant)
  console.log(`Firma: ${tenant}  DB: ${db}  Mod: ${compat ? 'compat' : 'defaults'}${dryRun ? '  (DENEME)' : ''}`)

  const c = new Client({ ...PG, database: db })
  await c.connect()

  try {
    await c.query('BEGIN')

    // 1. Eksik roller
    for (const r of NEW_ROLES) {
      const res = await c.query(
        `INSERT INTO public."Roles" ("Code","Name","DisplayName","Description","IsActive","IsSuperAdmin","CreatedAt")
         VALUES ($1,$2,$3,$4,TRUE,FALSE,NOW())
         ON CONFLICT ("Code") DO NOTHING`,
        [r.code, r.name, r.displayName, r.description]
      )
      if (res.rowCount > 0) console.log(`  + rol olusturuldu: ${r.code}`)
    }

    // 2. Sekme kapsam anahtarlari. Ayni satirlari B2B'deki PagesController seeder'i da yazar;
    //    burada tekrarlanmasinin sebebi aracin API yeniden baslatilmadan calisabilmesi.
    for (const [id, key] of SCOPE_PAGES) {
      const res = await c.query(
        `INSERT INTO public."Pages" ("Id","DisplayName","IsActive","Key","ModuleKey","SortOrder")
         SELECT $1::int, 'Tüm İşleri Görme Yetkisi', TRUE, $2::text, 'serviceOps', $3::int
         WHERE NOT EXISTS (SELECT 1 FROM public."Pages" WHERE "Id" = $1::int OR ("ModuleKey" = 'serviceOps' AND "Key" = $2::text))`,
        [id, key, id - 5000]
      )
      if (res.rowCount > 0) console.log(`  + sayfa anahtari: ${key}`)
    }

    // Kapsam sekmeye indigi icin kok kapsam anahtarlari gecersiz. Silinmiyor, pasife cekiliyor.
    const off = await c.query(
      `UPDATE public."Pages" SET "IsActive" = FALSE
       WHERE "ModuleKey" = 'serviceOps'
         AND "Key" = ANY($1::text[])
         AND "IsActive" = TRUE`,
      [['montajYonetimi.tumIsleriGorme', 'buyukUrun.tumIsleriGorme', 'atolyeAriza.tumIsleriGorme']]
    )
    if (off.rowCount > 0) console.log(`  - ${off.rowCount} kok kapsam anahtari pasife cekildi`)

    // 3. Sayfa haritasi
    const pagesRes = await c.query(`SELECT "Id","Key" FROM public."Pages" WHERE "ModuleKey" = 'serviceOps' AND "IsActive" = TRUE`)
    const pageId = new Map(pagesRes.rows.map((p) => [p.Key, p.Id]))

    const rolesRes = await c.query(`SELECT "Id","Code" FROM public."Roles"`)
    const roleId = new Map(rolesRes.rows.map((r) => [r.Code, r.Id]))

    const missing = SCOPED_KEYS.map((k) => `${k}.tumIsleriGorme`).filter((k) => !pageId.has(k))
    if (missing.length) {
      console.log(`  ! su kapsam anahtarlari DB'de yok, B2B API bir kez /api/pages cagrilinca olusur:\n    ${missing.join('\n    ')}`)
    }

    const grant = async (roleCode, key, on) => {
      const rid = roleId.get(roleCode)
      const pid = pageId.get(key)
      if (!rid || !pid) return false
      if (dryRun) return true
      await c.query(
        `INSERT INTO public."RolePagePermissions" ("RoleId","PageId","CanAccess")
         VALUES ($1,$2,$3)
         ON CONFLICT ("RoleId","PageId") DO UPDATE SET "CanAccess" = EXCLUDED."CanAccess"`,
        [rid, pid, on]
      )
      return true
    }

    if (compat) {
      // Sayfasi acik olan her role kapsam anahtarini da ver: eski kural sayfaya erisimi
      // "hepsini gor" sayiyordu, bu onu yazili hale getirir.
      let n = 0
      for (const key of SCOPED_KEYS) {
        const scopeKey = `${key}.tumIsleriGorme`
        if (!pageId.has(key) || !pageId.has(scopeKey)) continue
        const holders = await c.query(
          `SELECT r."Code"
           FROM public."RolePagePermissions" rp
           JOIN public."Roles" r ON r."Id" = rp."RoleId"
           WHERE rp."PageId" = $1 AND rp."CanAccess" = TRUE`,
          [pageId.get(key)]
        )
        for (const h of holders.rows) {
          if (await grant(h.Code, scopeKey, true)) n++
        }
      }
      console.log(`  compat: ${n} kapsam anahtari yazildi`)
    }

    if (defaults) {
      for (const [roleCode, spec] of Object.entries(DEFAULTS)) {
        if (!roleId.has(roleCode)) {
          console.log(`  ! rol yok, atlandi: ${roleCode}`)
          continue
        }

        const on = new Set()
        for (const k of spec.hepsi) {
          on.add(k)
          on.add(`${k}.tumIsleriGorme`)
        }
        for (const k of spec.ac) on.add(k)

        // Sayfayi acmadan kapsam vermek anlamsiz: 'hepsi' listesindekilerin ustu de acilir.
        for (const k of spec.hepsi) {
          const dot = k.indexOf('.')
          if (dot > 0) on.add(k.slice(0, dot))
        }

        let acilan = 0
        let kapanan = 0
        for (const [key, pid] of pageId.entries()) {
          const root = key.split('.')[0]
          if (!MODULE_SCOPE.includes(root)) continue
          if (spec.sadeceListelenenler && !on.has(key)) continue // bu rolde sadece verilenlere dokun

          const shouldBeOn = on.has(key)
          await grant(roleCode, key, shouldBeOn)
          if (shouldBeOn) acilan++
          else kapanan++
          void pid
        }
        console.log(`  ${roleCode}: ${acilan} acik, ${kapanan} kapali`)
      }
    }

    if (dryRun) {
      await c.query('ROLLBACK')
      console.log('DENEME modu — hicbir sey yazilmadi.')
    } else {
      await c.query('COMMIT')
      console.log('Tamam.')
    }
  } catch (e) {
    await c.query('ROLLBACK')
    throw e
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error('HATA:', e.message)
  process.exit(1)
})
