/**
 * Rol/yetki senaryo testleri.
 *
 * Amaç, "buton görünüyor mu" değil: sunucunun bir rolün YAPMAMASI gereken şeyi gerçekten
 * reddedip reddetmediğini ölçmek. Frontend'de düğme gizlemek yetki değildir.
 *
 * Kapsanan saldırı biçimleri:
 *  - Yatay yükseltme: A teknisyeni B'nin kaydına/deposuna/hak edişine erişiyor mu?
 *  - Dikey yükseltme: teknisyen planlama/silme/ödeme gibi yönetici işlerini yapabiliyor mu?
 *  - Parametre ile kapsam genişletme: ?technicianId=, ?scopeKey=, ?tenantCode= ile sınır aşımı
 *  - Firmalar arası sızıntı: A firmasının token'ı + B firmasının başlığı
 *  - Kimliksiz erişim
 *
 * Önce `node tests/hazirlik.js` çalıştırılmalı. Temizlik: `node tests/temizle.js`
 */
const SVC = 'http://localhost:5137'
const ERP = 'http://localhost:5200'
const TENANT = process.env.TEST_TENANT || 'DEMOTEST'
const OTHER_TENANT = process.env.TEST_OTHER_TENANT || 'DEMO'
const QA_PASS = 'QaTest!2026'

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '  GEÇTİ ' : '  AÇIK  '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function call(token, path, options = {}, tenant = TENANT) {
  const res = await fetch(`${SVC}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(tenant ? { 'X-Tenant-Code': tenant } : {}),
      ...(options.headers || {}),
    },
  })
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { status: res.status, body }
}

/** Reddedilmiş sayılan durumlar. 401 de kabul, ama 200 asla. */
const DENIED = [401, 403, 404]
function isDenied(status) { return DENIED.includes(status) }

async function loginQa(username) {
  const res = await fetch(`${SVC}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantCode: TENANT, username, password: QA_PASS }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || !body?.accessToken) throw new Error(`${username} girişi başarısız (${res.status}): ${JSON.stringify(body)}`)
  return { token: body.accessToken, technicianId: body.user?.technicianId, role: body.user?.role }
}

async function loginAdmin() {
  const erp = await (await fetch(`${ERP}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'ssa', password: '123', tenantCode: '' }),
  })).json()
  const ex = await (await fetch(`${SVC}/api/auth/exchange`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: erp.data.accessToken, tenantCode: TENANT }),
  })).json()
  return ex.accessToken
}

async function main() {
  console.log(`\n=== Rol / Yetki Senaryoları (${TENANT}) ===\n`)

  const admin = await loginAdmin()
  const techA = await loginQa('qatest_tech_a')
  const techB = await loginQa('qatest_tech_b')
  const bayi = await loginQa('qatest_bayi')
  check('QA hesapları giriş yapıyor', Boolean(admin && techA.token && techB.token && bayi.token),
    `techA=${techA.role}/${techA.technicianId?.slice(0, 8)} bayi=${bayi.role}`)

  // --- Hazırlık: admin iki kayıt açar, birini A'ya birini B'ye atar ---
  const regions = await call(admin, '/api/regions')
  const regionId = (Array.isArray(regions.body) ? regions.body : regions.body?.data ?? [])[0]?.id

  const dealers = await call(admin, '/api/erp/dealers?type=bayi')
  const dealerList = dealers.body?.data?.items ?? []
  const dealerA = dealerList[0]
  const dealerB = dealerList[1]

  async function createRecord(name, technicianId, dealer) {
    const r = await call(admin, '/api/servicerecords', {
      method: 'POST',
      body: JSON.stringify({
        regionId,
        customerName: name,
        customerPhone: '05330000009',
        productName: 'QA ÜRÜN',
        serialNumber: `SNTEST-${name}`,
        problemDescription: 'yetki senaryosu',
        type: 'Repair', category: 'large', priority: 'Normal',
        dealerName: dealer?.name, dealerCode: dealer?.customerCode,
      }),
    })
    const id = r.body?.id
    if (id && technicianId) {
      await call(admin, `/api/servicerecords/${id}/plan`, {
        method: 'PATCH',
        body: JSON.stringify({ plannedDate: new Date().toISOString(), technicianId, status: 'FieldPlanned' }),
      })
    }
    return id
  }

  const recA = await createRecord('TEST MÜŞTERİ QA-A', techA.technicianId, dealerA)
  const recB = await createRecord('TEST MÜŞTERİ QA-B', techB.technicianId, dealerB)
  check('Hazırlık: iki kayıt açıldı ve atandı', Boolean(recA && recB), `${recA?.slice(0, 8)} / ${recB?.slice(0, 8)}`)

  // ============ 1. KİMLİKSİZ ERİŞİM ============
  const anon = await call(null, '/api/servicerecords/paged?pageSize=1')
  check('Kimliksiz istek reddediliyor', isDenied(anon.status), `${anon.status}`)

  const anonErp = await call(null, '/api/erp/dealers')
  check('Kimliksiz ERP vekil isteği reddediliyor', isDenied(anonErp.status), `${anonErp.status}`)

  // ============ 2. YATAY YÜKSELTME: BAŞKASININ KAYDI ============
  const aReadsB = await call(techA.token, `/api/servicerecords/${recB}`)
  check('Teknisyen A, B\'nin kaydını AÇAMIYOR', isDenied(aReadsB.status), `${aReadsB.status}`)

  const aReadsOwn = await call(techA.token, `/api/servicerecords/${recA}`)
  check('  ↳ ama kendi kaydını açabiliyor', aReadsOwn.status === 200, `${aReadsOwn.status}`)

  // Liste: B'nin kaydı A'nın listesinde görünmemeli
  const aList = await call(techA.token, '/api/servicerecords/paged?pageSize=500&scopeKey=buyukUrun.sahaPlanlama')
  const aItems = aList.body?.items ?? []
  check('Teknisyen A\'nın listesinde B\'nin kaydı YOK',
    !aItems.some(r => r.id === recB), `${aItems.length} kayıt`)

  // ============ 3. PARAMETRE İLE KAPSAM GENİŞLETME ============
  const aAsB = await call(techA.token, `/api/servicerecords/paged?technicianId=${techB.technicianId}&pageSize=500&scopeKey=buyukUrun.sahaPlanlama`)
  const aAsBItems = aAsB.body?.items ?? []
  check('?technicianId=<başkası> kapsamı genişletmiyor',
    !aAsBItems.some(r => r.id === recB), `${aAsBItems.length} kayıt döndü`)

  const aWideScope = await call(techA.token, '/api/servicerecords/paged?pageSize=500&scopeKey=buyukUrun.atolye.tumIsleriGorme')
  const aWideItems = aWideScope.body?.items ?? []
  check('?scopeKey ile "tüm işleri görme" alınamıyor',
    !aWideItems.some(r => r.id === recB), `${aWideItems.length} kayıt döndü`)

  // ============ 4. DİKEY YÜKSELTME: YÖNETİCİ İŞLERİ ============
  const aPlans = await call(techA.token, `/api/servicerecords/${recB}/plan`, {
    method: 'PATCH',
    body: JSON.stringify({ plannedDate: new Date().toISOString(), technicianId: techA.technicianId }),
  })
  check('Teknisyen başkasının işini kendine planlayamıyor', isDenied(aPlans.status), `${aPlans.status}`)

  const aAssigns = await call(techA.token, `/api/servicerecords/${recB}/assign`, {
    method: 'POST', body: JSON.stringify({ technicianId: techA.technicianId }),
  })
  check('Teknisyen atama yapamıyor', isDenied(aAssigns.status), `${aAssigns.status}`)

  const aDeletes = await call(techA.token, `/api/servicerecords/${recB}`, { method: 'DELETE' })
  check('Teknisyen başkasının kaydını silemiyor', isDenied(aDeletes.status), `${aDeletes.status}`)

  const aCreates = await call(techA.token, '/api/servicerecords', {
    method: 'POST',
    body: JSON.stringify({ regionId, customerName: 'TEST MÜŞTERİ QA-YETKISIZ', customerPhone: '0533', productName: 'X', problemDescription: 'x', type: 'Repair', category: 'large', priority: 'Normal' }),
  })
  check('Teknisyen kabul kaydı açamıyor', isDenied(aCreates.status), `${aCreates.status}`)

  // ============ 5. ARAÇ DEPOSU (yatay) ============
  const aStockB = await call(techA.token, `/api/erp/admin/technician-stock/${techB.technicianId}`)
  check('Teknisyen A, B\'nin araç deposunu göremiyor', isDenied(aStockB.status), `${aStockB.status}`)

  const aSaleB = await call(techA.token, `/api/erp/admin/technician-sale/${techB.technicianId}`, {
    method: 'POST', body: JSON.stringify({ customerCode: dealerA?.customerCode, items: [] }),
  })
  check('Teknisyen A, B\'nin deposundan SATIŞ yapamıyor', isDenied(aSaleB.status), `${aSaleB.status}`)

  const aPricesB = await call(techA.token, `/api/erp/admin/technician-sale/calculate-prices/${techB.technicianId}`, {
    method: 'POST', body: JSON.stringify({ customerCode: dealerA?.customerCode, stockCodes: [] }),
  })
  check('Teknisyen A, B\'nin fiyat hesabını çağıramıyor', isDenied(aPricesB.status), `${aPricesB.status}`)

  // Kendi aracı için AYRI uç var (`technician-stock`, kimlik yoldan gelmiyor, oturumdan
  // çözülüyor). `admin/...` yönetici ucudur; teknisyenin oraya kendi kimliğiyle bile
  // erişememesi doğru davranıştır — yetki sayfa kapsamına bağlı (#35).
  const aStockOwn = await call(techA.token, '/api/erp/technician-stock')
  check('  ↳ kendi araç deposuna kendi ucundan erişebiliyor',
    aStockOwn.status === 200, `${aStockOwn.status}`)

  // ============ 6. FİRMALAR ARASI SIZINTI ============
  const crossTenant = await call(techA.token, '/api/erp/cash-accounts?tenantCode=' + OTHER_TENANT)
  const crossData = crossTenant.body?.data ?? crossTenant.body
  const ownTenantCash = await call(techA.token, '/api/erp/cash-accounts')
  const ownData = ownTenantCash.body?.data ?? ownTenantCash.body
  const sameAsOwn = JSON.stringify(crossData) === JSON.stringify(ownData)
  check('?tenantCode ile başka firmanın kasaları alınamıyor',
    isDenied(crossTenant.status) || sameAsOwn,
    `${crossTenant.status}, kendi firmasıyla aynı=${sameAsOwn}`)

  const crossHeader = await call(techA.token, '/api/servicerecords/paged?pageSize=5', {}, OTHER_TENANT)
  const crossItems = crossHeader.body?.items ?? []
  check('Başka firmanın başlığıyla o firmanın kayıtları alınamıyor',
    isDenied(crossHeader.status) || crossItems.length === 0,
    `${crossHeader.status}, ${crossItems.length} kayıt`)

  // ============ 7. HAK EDİŞ / EKSTRE ============
  const aLedgerB = await call(techA.token, `/api/earnings/ledger?technicianId=${techB.technicianId}`)
  const aLedgerRows = aLedgerB.body?.data ?? []
  const foreignRows = aLedgerRows.filter(r => r.technicianId !== techA.technicianId)
  check('Teknisyen başkasının hak ediş ekstresini göremiyor',
    isDenied(aLedgerB.status) || foreignRows.length === 0,
    `${aLedgerB.status}, ${foreignRows.length} yabancı satır`)

  const aPays = await call(techA.token, '/api/earnings/ledger/payment', {
    method: 'POST',
    body: JSON.stringify({ technicianId: techA.technicianId, amount: 999, currency: 'USD', description: 'yetkisiz ödeme denemesi' }),
  })
  check('Teknisyen kendi defterine ödeme YAZAMIYOR', isDenied(aPays.status), `${aPays.status}`)

  const aApproves = await call(techA.token, '/api/earnings')
  const aEarnings = aApproves.body?.data ?? []
  const foreignEarnings = aEarnings.filter(e => e.technicianId !== techA.technicianId)
  check('Teknisyen yalnızca kendi hak edişini görüyor',
    foreignEarnings.length === 0, `${aEarnings.length} kayıt, ${foreignEarnings.length} yabancı`)

  // ============ 8. BAYİ KAPSAMI ============
  if (dealerA && dealerB) {
    // Bayi kullanıcısının cari kodunu A bayisine sabitle
    const { Client } = require('pg')
    const db = new Client({ host: 'localhost', port: 5434, user: 'b2b', password: 'b2b', database: process.env.TEST_DB || 'b2b_serviceops_tenant_DEMOTEST' })
    await db.connect()
    await db.query(`UPDATE "ServiceUsers" SET "DealerCode" = $1 WHERE "Username" = 'qatest_bayi'`, [dealerA.customerCode])
    await db.end()

    const bayi2 = await loginQa('qatest_bayi')
    const bList = await call(bayi2.token, '/api/servicerecords/paged?pageSize=500&scopeKey=buyukEvAletleriKabul')
    const bItems = bList.body?.items ?? []
    const seesOther = bItems.some(r => r.id === recB)
    const seesOwn = bItems.some(r => r.id === recA)
    check('Bayi başka bayinin kaydını GÖRMÜYOR', !seesOther, `${bItems.length} kayıt`)
    // NOT: pozitif yön (bayi KENDİ kaydını görür) bu hesapla ölçülemez — QA bayisi yalnızca
    // ServiceOps'ta var, sayfa yetkileri B2B'deki rolden okunuyor ve orada karşılığı yok, yani
    // hiçbir sayfaya erişimi olmadığı için liste haklı olarak boş dönüyor (kapalı başarısızlık).
    // Süzgecin kod eşleşmesi ayrıca veri seviyesinde doğrulandı (ServiceRecords.DealerCode).
    check('  ↳ bayi kapsamı kapalı başarısız oluyor (yetkisiz → boş)',
      seesOwn || bItems.length === 0,
      seesOwn ? 'kendi kaydını görüyor' : 'yetki yok → boş liste')

    const bReadsOther = await call(bayi2.token, `/api/servicerecords/${recB}`)
    check('Bayi başka bayinin kaydını açamıyor', isDenied(bReadsOther.status), `${bReadsOther.status}`)
  }

  // ============ 9. RAPOR / YÖNETİM UÇLARI ============
  const aPerf = await call(techA.token, '/api/servicerecords/dealer-performance')
  const perfRows = aPerf.body?.data ?? []
  check('Teknisyen bayi performans raporunun tamamını alamıyor',
    isDenied(aPerf.status) || perfRows.length === 0, `${aPerf.status}, ${perfRows.length} satır`)

  // Onay metni BİLEREK gönderilmiyor: uç gerçekten veri siliyor. Reddedilmesi bekleniyor;
  // 400 (onay eksik) de kabul değil — teknisyen bu uca hiç ulaşamamalı.
  const aClearAll = await call(techA.token, '/api/servicerecords/clear-all', { method: 'DELETE' })
  check('Teknisyen "tümünü sil" ucunu çağıramıyor', isDenied(aClearAll.status), `${aClearAll.status}`)

  const aTechs = await call(techA.token, '/api/technicians')
  const techRows = Array.isArray(aTechs.body) ? aTechs.body : []
  const otherTechs = techRows.filter(t => t.id !== techA.technicianId)
  check('Teknisyen listesi teknisyene yalnızca kendini gösteriyor',
    otherTechs.length === 0, `${techRows.length} teknisyen`)

  // ============ 10. YAZMA KAPISI (varsayılan-reddet) ============
  // 2026-08-07 denetiminde 27 yazma ucunun gövdesinde hiçbir yetki kontrolü olmadığı görüldü.
  // Merkezî kapı (ServiceOpsWriteAuthorizationFilter) bunların hepsini kapsıyor; burada
  // temsilci bir örneklem sınanıyor.
  const writeProbes = [
    ['Stok kalemi oluşturma',     'POST',   '/api/spareparts',                 { name: 'QA', partNumber: 'QA-1' }],
    ['Stok güncelleme',           'PATCH',  '/api/spareparts/00000000-0000-0000-0000-000000000001/stock', { quantity: 5 }],
    ['Envanter kalemi oluşturma', 'POST',   '/api/inventory',                  { name: 'QA' }],
    ['Cari oluşturma',            'POST',   '/api/customers',                  { fullName: 'QA CARI' }],
    ['Cari silme',                'DELETE', '/api/customers/00000000-0000-0000-0000-000000000001', null],
    ['Bölge oluşturma',           'POST',   '/api/regions',                    { name: 'QA BOLGE' }],
    ['İş emri oluşturma',         'POST',   '/api/workorders',                 { serviceId: recB }],
    ['İş emri silme',             'DELETE', '/api/workorders/00000000-0000-0000-0000-000000000001', null],
    ['Servis ürünü oluşturma',    'POST',   '/api/serviceproducts',            { name: 'QA' }],
    ['Kargo bilgisi düzenleme',   'PUT',    '/api/cargotracking/00000000-0000-0000-0000-000000000001/details', { customerName: 'QA' }],
    ['Rota durağı güncelleme',    'PATCH',  '/api/routes/00000000-0000-0000-0000-000000000001/stops/1/status', { status: 1 }],
  ]

  for (const [label, method, path, body] of writeProbes) {
    const res = await call(techA.token, path, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    check(`Yazma kapısı — ${label}`, isDenied(res.status), `${res.status}`)
  }

  // ============ 11. KİMLİKSİZ ERİŞİLEBİLEN UÇLAR ============
  // Bu uçlar [AllowAnonymous] taşıyordu: ağdan erişen herkes montaj kaydı oluşturabiliyor,
  // FATURA NUMARASIYLA MONTAJ KAYITLARINI SİLEBİLİYOR, yedek parça siparişlerini okuyup
  // tamamlayabiliyor ve TÜM SERVİS VERİSİNİ TRUNCATE edebiliyordu.
  const anonProbes = [
    ['Montaj kaydı oluşturma', 'POST',   '/api/montaj', {}],
    ['Montaj kaydı silme',     'DELETE', '/api/montaj/invoice/TEST-YOK', null],
    ['Yedek parça isteği',     'GET',    '/api/SparePartOrderRequests', null],
    ['Tüm veriyi silme',       'DELETE', '/api/servicerecords/clear-all?confirm=TUM-SERVIS-VERISINI-SIL', null],
    ['Servis durumu geri alma','POST',   '/api/servicerecords/00000000-0000-0000-0000-000000000001/revert-to-ready', {}],
  ]
  for (const [label, method, path, body] of anonProbes) {
    const res = await call(null, path, { method, ...(body ? { body: JSON.stringify(body) } : {}) })
    check(`Kimliksiz erişim kapalı — ${label}`, isDenied(res.status), `${res.status}`)
  }

  // SignalR hub: eskiden anonimdi ve bağlanan her istemci BÜTÜN firmaların canlı
  // servis/montaj/kargo olaylarını alıyordu.
  const hubAnon = await fetch(`${SVC}/hubs/serviceops/negotiate?negotiateVersion=1`, { method: 'POST' })
  check('Kimliksiz erişim kapalı — SignalR hub', isDenied(hubAnon.status), `${hubAnon.status}`)

  // ============ 12. SAHTE TOKEN ============
  // İmza anahtarı CHANGE_ME_IN_PRODUCTION... idi; bilinen bir yer tutucuyla imzalanan token
  // herkes tarafından üretilebiliyordu, yani bütün yetki kontrolleri geçersizdi.
  const crypto = require('crypto')
  const forge = (secret) => {
    const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
    const pl = Buffer.from(JSON.stringify({
      sub: 'sahte', name: 'sahte', tenantCode: TENANT, role: 'SuperAdmin',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iss: 'service-ops-api', aud: 'service-ops-frontend',
    })).toString('base64url')
    const sig = crypto.createHmac('sha256', secret).update(`${h}.${pl}`).digest('base64url')
    return `${h}.${pl}.${sig}`
  }
  const forged = await call(forge('CHANGE_ME_IN_PRODUCTION_CHANGE_ME_IN_PRODUCTION'), '/api/servicerecords/paged?pageSize=1')
  check('Yer tutucu anahtarla üretilmiş token reddediliyor', isDenied(forged.status), `${forged.status}`)

  // ============ 13. CORS ============
  const corsRes = await fetch(`${SVC}/api/servicerecords/paged`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://kotu-site.example', 'Access-Control-Request-Method': 'GET' },
  })
  const allowOrigin = corsRes.headers.get('access-control-allow-origin')
  check('CORS yabancı kaynağa açık değil', !allowOrigin, allowOrigin ? `izin verildi: ${allowOrigin}` : 'izin başlığı yok')

  // ============ 14. DOSYA YÜKLEME ============
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), 'x.png')
  const uploadRes = await fetch(`${SVC}/api/servicerecords/${recB}/photo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${techA.token}`, 'X-Tenant-Code': TENANT },
    body: form,
  })
  check('Teknisyen başkasının kaydına fotoğraf yükleyemiyor', isDenied(uploadRes.status), `${uploadRes.status}`)

  // ============ 15. FATURA ============
  const aInvoices = await call(techA.token, '/api/erp/invoices/create-service-invoice', {
    method: 'POST',
    body: JSON.stringify({ customerCode: dealerB?.customerCode, productName: 'X', price: 1, serviceRecordId: recB }),
  })
  check('Teknisyen başkasının kaydına fatura kesemiyor', isDenied(aInvoices.status), `${aInvoices.status}`)

  finish()
}

function finish() {
  const passed = results.filter(r => r.ok).length
  const open = results.filter(r => !r.ok)
  console.log(`\n=== SONUÇ: ${passed}/${results.length} güvenli ===`)
  if (open.length) {
    console.log('\nAÇIKLAR:')
    for (const f of open) console.log(`  ! ${f.name}${f.detail ? ' — ' + f.detail : ''}`)
    process.exitCode = 1
  }
}

main().catch(e => { console.error('SENARYO KOŞUSU PATLADI:', e); process.exit(1) })
